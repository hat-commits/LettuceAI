use std::fs;
use std::path::PathBuf;

use base64::{engine::general_purpose, Engine};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;

use std::sync::Mutex as StdMutex;
use std::sync::Arc;

use super::binary;
use super::registry;
use super::types::{SdMeasuredProfile, SdModelEntry};
use crate::image_generator::storage::save_image_bytes;
use crate::image_generator::types::{
    GeneratedImage, ImageGenerationRequest, ImageGenerationResponse,
};

static RUNNING: Mutex<Option<tokio::process::Child>> = Mutex::const_new(None);

#[derive(Debug, Default, Clone)]
struct MemoryReport {
    total_params_mb: f64,
    text_encoders_mb: f64,
    diffusion_mb: f64,
    vae_mb: f64,
    max_compute_vram_mb: f64,
    has_params: bool,
}

struct MemoryParser {
    params_re: regex::Regex,
    compute_re: regex::Regex,
    report: StdMutex<MemoryReport>,
}

impl MemoryParser {
    fn new() -> Result<Self, String> {
        Ok(MemoryParser {
            params_re: regex::Regex::new(
                r"total params memory size = ([0-9.]+)MB \(VRAM [0-9.]+MB, RAM [0-9.]+MB\): text_encoders ([0-9.]+)MB\([^)]*\), diffusion_model ([0-9.]+)MB\([^)]*\), vae ([0-9.]+)MB",
            )
            .map_err(|e| e.to_string())?,
            compute_re: regex::Regex::new(r"compute buffer size: ([0-9.]+) MB\(VRAM\)")
                .map_err(|e| e.to_string())?,
            report: StdMutex::new(MemoryReport::default()),
        })
    }

    fn parse_line(&self, line: &str) {
        if let Some(captures) = self.params_re.captures(line) {
            let parse = |index: usize| captures[index].parse::<f64>().unwrap_or(0.0);
            if let Ok(mut report) = self.report.lock() {
                report.total_params_mb = parse(1);
                report.text_encoders_mb = parse(2);
                report.diffusion_mb = parse(3);
                report.vae_mb = parse(4);
                report.has_params = true;
            }
        } else if let Some(captures) = self.compute_re.captures(line) {
            let value = captures[1].parse::<f64>().unwrap_or(0.0);
            if let Ok(mut report) = self.report.lock() {
                if value > report.max_compute_vram_mb {
                    report.max_compute_vram_mb = value;
                }
            }
        }
    }

    fn snapshot(&self) -> MemoryReport {
        self.report.lock().map(|r| r.clone()).unwrap_or_default()
    }
}

const OOM_PATTERNS: [&str; 6] = [
    "out of memory",
    "failed to allocate",
    "allocation failed",
    "backend buffer failed",
    "compute buffer failed",
    "erroroutofdevicememory",
];

fn is_oom_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    OOM_PATTERNS.iter().any(|pattern| lower.contains(pattern))
}

const DISTILLED_TOKENS: [&str; 5] = ["turbo", "schnell", "lightning", "hyper", "lcm"];

fn model_text(entry: &SdModelEntry) -> String {
    let mut text = format!("{} {} {}", entry.id, entry.name, entry.family);
    for path in entry.files.all_paths() {
        text.push(' ');
        text.push_str(path);
    }
    text.to_ascii_lowercase()
}

fn is_distilled(entry: &SdModelEntry) -> bool {
    let text = model_text(entry);
    DISTILLED_TOKENS.iter().any(|token| text.contains(token))
}

fn is_guidance_distilled(entry: &SdModelEntry) -> bool {
    let text = model_text(entry);
    text.contains("flux") || text.contains("chroma")
}

fn parse_size(size: Option<&str>) -> Option<(u32, u32)> {
    let value = size?;
    let normalized = value.trim().to_ascii_lowercase();
    let (w, h) = normalized.split_once('x')?;
    let parsed = (w.trim().parse::<u32>().ok()?, h.trim().parse::<u32>().ok()?);
    Some((round_to_64(parsed.0), round_to_64(parsed.1)))
}

fn file_size(path: Option<&String>) -> f64 {
    path.and_then(|value| std::fs::metadata(value).ok())
        .map(|meta| meta.len() as f64)
        .unwrap_or(0.0)
}

fn offload_args(entry: &SdModelEntry, width: u32, height: u32, mode: &str) -> Vec<String> {
    const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
    const MIB: f64 = 1024.0 * 1024.0;
    let full_gpu: Vec<String> = vec!["--diffusion-fa".into()];
    let clip_cpu: Vec<String> = vec!["--clip-on-cpu".into(), "--diffusion-fa".into()];
    let clip_vae_cpu: Vec<String> = vec![
        "--clip-on-cpu".into(),
        "--vae-on-cpu".into(),
        "--diffusion-fa".into(),
        "--vae-tiling".into(),
    ];
    let mixed: Vec<String> = vec![
        "--offload-to-cpu".into(),
        "--diffusion-fa".into(),
        "--vae-tiling".into(),
    ];
    match mode {
        "gpu" => return Vec::new(),
        "mixed" => return mixed,
        _ => {}
    }

    let vram = crate::llama_cpp::available_vram_bytes().unwrap_or(0) as f64;
    if vram <= 0.0 {
        return Vec::new();
    }
    if crate::llama_cpp::is_unified_memory() {
        return full_gpu;
    }
    let budget = vram * 0.9;

    let (encoders, main, vae, activations, overhead) = if let Some(measured) = entry.measured {
        let pixel_scale = (width as f64 * height as f64)
            / (measured.width as f64 * measured.height as f64).max(1.0);
        let activations = if measured.max_compute_vram_mb > 0.0 {
            measured.max_compute_vram_mb * MIB * pixel_scale
        } else {
            crate::hf_browser::sd::estimate_activation_bytes(&entry.family, width, height)
        };
        (
            measured.text_encoders_mb * MIB,
            measured.diffusion_mb * MIB,
            measured.vae_mb * MIB,
            activations,
            0.4 * GIB,
        )
    } else {
        let files = &entry.files;
        let main =
            file_size(files.checkpoint.as_ref()).max(file_size(files.diffusion_model.as_ref()));
        let encoders = file_size(files.clip_l.as_ref())
            + file_size(files.clip_g.as_ref())
            + file_size(files.t5xxl.as_ref())
            + file_size(files.llm.as_ref())
            + file_size(files.llm_vision.as_ref());
        let vae = file_size(files.vae.as_ref());
        let activations =
            crate::hf_browser::sd::estimate_activation_bytes(&entry.family, width, height);
        (encoders, main, vae, activations, 0.6 * GIB)
    };

    if main + encoders + vae + activations + overhead <= budget {
        return full_gpu;
    }
    if main + vae + activations + overhead <= budget {
        return clip_cpu;
    }
    if main + activations + overhead <= budget {
        return clip_vae_cpu;
    }
    mixed
}

fn round_to_64(value: u32) -> u32 {
    ((value.clamp(64, 2048) + 32) / 64) * 64
}

fn map_sampler(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.contains("euler") && lower.contains('a') && !lower.contains("ancestral") {
        "euler_a"
    } else if lower.contains("euler") {
        "euler"
    } else if lower.contains("dpm++") && lower.contains("2m") {
        "dpm++2m"
    } else if lower.contains("dpm++") && lower.contains("2s") {
        "dpm++2s_a"
    } else if lower.contains("heun") {
        "heun"
    } else if lower.contains("lcm") {
        "lcm"
    } else if lower.contains("ipndm") {
        "ipndm"
    } else {
        "euler_a"
    }
}

fn decode_input_image(data: &str) -> Result<Vec<u8>, String> {
    let base64_data = if data.starts_with("data:") {
        data.split(',')
            .nth(1)
            .ok_or_else(|| "Invalid input image data URL".to_string())?
    } else {
        data
    };
    general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Failed to decode input image: {e}"))
}

fn build_args(
    entry: &SdModelEntry,
    request: &ImageGenerationRequest,
    out_path: &PathBuf,
    init_image: Option<&PathBuf>,
    mode_override: Option<&str>,
) -> Vec<String> {
    let settings = request.advanced_model_settings.as_ref();
    let size = request
        .size
        .as_deref()
        .or_else(|| settings.and_then(|s| s.sd_size.as_deref()));

    let mut args: Vec<String> = Vec::new();
    let files = &entry.files;
    if let Some(checkpoint) = &files.checkpoint {
        args.extend(["-m".into(), checkpoint.clone()]);
    } else if let Some(diffusion_model) = &files.diffusion_model {
        args.extend(["--diffusion-model".into(), diffusion_model.clone()]);
    }
    if let Some(clip_l) = &files.clip_l {
        args.extend(["--clip_l".into(), clip_l.clone()]);
    }
    if let Some(clip_g) = &files.clip_g {
        args.extend(["--clip_g".into(), clip_g.clone()]);
    }
    if let Some(t5xxl) = &files.t5xxl {
        args.extend(["--t5xxl".into(), t5xxl.clone()]);
    }
    if let Some(llm) = &files.llm {
        args.extend(["--llm".into(), llm.clone()]);
    }
    if let Some(llm_vision) = &files.llm_vision {
        args.extend(["--llm_vision".into(), llm_vision.clone()]);
    }
    if let Some(vae) = &files.vae {
        args.extend(["--vae".into(), vae.clone()]);
    }

    args.extend(["-p".into(), request.prompt.clone()]);
    if let Some(negative) = settings.and_then(|s| s.sd_negative_prompt.as_ref()) {
        if !negative.trim().is_empty() {
            args.extend(["-n".into(), negative.clone()]);
        }
    }
    let parsed_size = parse_size(size);
    if let Some((width, height)) = parsed_size {
        args.extend(["-W".into(), width.to_string()]);
        args.extend(["-H".into(), height.to_string()]);
    }

    let (est_width, est_height) = parsed_size.unwrap_or((1024, 1024));
    let offload_mode = mode_override.unwrap_or_else(|| {
        settings
            .and_then(|s| s.sd_offload_mode.as_deref())
            .unwrap_or("auto")
    });
    args.extend(offload_args(entry, est_width, est_height, offload_mode));

    let distilled = is_distilled(entry);
    let steps = settings
        .and_then(|s| s.sd_steps)
        .or(if distilled { Some(8) } else { None });
    if let Some(steps) = steps {
        args.extend(["--steps".into(), steps.to_string()]);
    }
    let cfg_scale = settings.and_then(|s| s.sd_cfg_scale).or(
        if distilled || is_guidance_distilled(entry) {
            Some(1.0)
        } else {
            None
        },
    );
    if let Some(cfg_scale) = cfg_scale {
        args.extend(["--cfg-scale".into(), format!("{cfg_scale}")]);
    }

    if let Some(seed) = settings.and_then(|s| s.sd_seed) {
        args.extend(["-s".into(), seed.to_string()]);
    } else {
        args.extend(["-s".into(), "-1".into()]);
    }
    if let Some(sampler) = settings.and_then(|s| s.sd_sampler.as_deref()) {
        if !sampler.trim().is_empty() {
            args.extend(["--sampling-method".into(), map_sampler(sampler).into()]);
        }
    }
    let count = request.n.unwrap_or(1).clamp(1, 4);
    if count > 1 {
        args.extend(["-b".into(), count.to_string()]);
    }
    if let Some(init) = init_image {
        let strength = settings
            .and_then(|s| s.sd_denoising_strength)
            .unwrap_or(0.65);
        args.extend(["-i".into(), init.to_string_lossy().to_string()]);
        args.extend(["--strength".into(), format!("{strength}")]);
    }
    args.extend(["-o".into(), out_path.to_string_lossy().to_string()]);
    args.push("-v".into());
    args
}

pub async fn generate(
    app: &AppHandle,
    request: &ImageGenerationRequest,
) -> Result<ImageGenerationResponse, String> {
    let binary_info = binary::read_binary_info(app)
        .ok_or_else(|| "Local diffusion engine is not installed".to_string())?;
    let entry = registry::get_model(app, &request.model)
        .await?
        .ok_or_else(|| format!("Local diffusion model not found: {}", request.model))?;
    if !entry.is_complete() {
        return Err(format!(
            "Model {} has no checkpoint or diffusion model file",
            entry.name
        ));
    }

    let tmp_dir = registry::diffusion_root(app)?
        .join("tmp")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;

    let user_mode = request
        .advanced_model_settings
        .as_ref()
        .and_then(|s| s.sd_offload_mode.as_deref())
        .unwrap_or("auto")
        .to_string();
    let mut result = run_generation(app, &binary_info.path, &entry, request, &tmp_dir, None).await;

    if let Err(message) = &result {
        let retryable = user_mode == "auto"
            && is_oom_error(message)
            && !message.contains("already in progress");
        if retryable {
            crate::utils::log_warn(
                app,
                "local_diffusion",
                "generation ran out of memory, retrying with full CPU offload".to_string(),
            );
            result =
                run_generation(app, &binary_info.path, &entry, request, &tmp_dir, Some("mixed"))
                    .await;
        }
    }

    let _ = fs::remove_dir_all(&tmp_dir);

    match result {
        Ok((response, report)) => {
            if report.has_params {
                let size = parse_size(
                    request.size.as_deref().or_else(|| {
                        request
                            .advanced_model_settings
                            .as_ref()
                            .and_then(|s| s.sd_size.as_deref())
                    }),
                )
                .unwrap_or((1024, 1024));
                let _ = registry::set_measured(
                    app,
                    &entry.id,
                    SdMeasuredProfile {
                        total_params_mb: report.total_params_mb,
                        text_encoders_mb: report.text_encoders_mb,
                        diffusion_mb: report.diffusion_mb,
                        vae_mb: report.vae_mb,
                        max_compute_vram_mb: report.max_compute_vram_mb,
                        width: size.0,
                        height: size.1,
                    },
                )
                .await;
            }
            Ok(response)
        }
        Err(message) => Err(message),
    }
}

async fn run_generation(
    app: &AppHandle,
    binary_path: &str,
    entry: &SdModelEntry,
    request: &ImageGenerationRequest,
    tmp_dir: &PathBuf,
    mode_override: Option<&str>,
) -> Result<(ImageGenerationResponse, MemoryReport), String> {
    let init_image = match request.input_images.as_deref() {
        Some([single]) => {
            let bytes = decode_input_image(single)?;
            let path = tmp_dir.join("input.png");
            fs::write(&path, bytes).map_err(|e| e.to_string())?;
            Some(path)
        }
        _ => None,
    };

    let out_path = tmp_dir.join("out.png");
    let args = build_args(entry, request, &out_path, init_image.as_ref(), mode_override);
    let offload_flags: Vec<&String> = args
        .iter()
        .filter(|arg| {
            matches!(
                arg.as_str(),
                "--offload-to-cpu" | "--clip-on-cpu" | "--vae-on-cpu" | "--diffusion-fa" | "--vae-tiling"
            )
        })
        .collect();
    crate::utils::log_info(
        app,
        "local_diffusion",
        format!(
            "generating with {} (offload: {})",
            entry.name,
            if offload_flags.is_empty() {
                "full GPU".to_string()
            } else {
                offload_flags
                    .iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            }
        ),
    );

    {
        let mut slot = RUNNING.lock().await;
        if slot.is_some() {
            return Err("Local image generation is already in progress".to_string());
        }
        let bin_dir = PathBuf::from(binary_path)
            .parent()
            .map(|dir| dir.to_path_buf())
            .ok_or_else(|| "Invalid engine path".to_string())?;
        let mut command = tokio::process::Command::new(binary_path);
        command
            .args(&args)
            .current_dir(bin_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        let child = command
            .spawn()
            .map_err(|e| format!("Failed to start engine: {e}"))?;
        *slot = Some(child);
    }

    let (stdout, stderr) = {
        let mut slot = RUNNING.lock().await;
        let child = slot.as_mut().ok_or_else(|| "Generation was cancelled".to_string())?;
        (child.stdout.take(), child.stderr.take())
    };

    let progress_re = regex::Regex::new(r"(\d+)/(\d+)").map_err(|e| e.to_string())?;
    let memory_parser = Arc::new(MemoryParser::new()?);
    let mut stderr_tail: Vec<String> = Vec::new();

    let app_clone = app.clone();
    let re_clone = progress_re.clone();
    let parser_clone = Arc::clone(&memory_parser);
    let stdout_task = tokio::spawn(async move {
        if let Some(stdout) = stdout {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                emit_progress(&app_clone, &re_clone, &line);
                parser_clone.parse_line(&line);
            }
        }
    });
    if let Some(stderr) = stderr {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            emit_progress(app, &progress_re, &line);
            memory_parser.parse_line(&line);
            stderr_tail.push(line);
            if stderr_tail.len() > 20 {
                stderr_tail.remove(0);
            }
        }
    }
    let _ = stdout_task.await;

    let status = {
        let mut slot = RUNNING.lock().await;
        let child = slot.take();
        match child {
            Some(mut child) => child.wait().await.map_err(|e| e.to_string())?,
            None => return Err("Generation was cancelled".to_string()),
        }
    };

    if !status.success() {
        let detail = stderr_tail.join("\n");
        return Err(format!(
            "Local image generation failed (exit {}). {}",
            status.code().unwrap_or(-1),
            detail
        ));
    }

    let mut outputs: Vec<PathBuf> = fs::read_dir(tmp_dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|dir_entry| dir_entry.path())
        .filter(|path| {
            path.extension()
                .map(|ext| ext.eq_ignore_ascii_case("png"))
                .unwrap_or(false)
        })
        .filter(|path| init_image.as_ref() != Some(path))
        .collect();
    outputs.sort();
    if outputs.is_empty() {
        return Err("Engine produced no output image".to_string());
    }

    let mut images = Vec::new();
    for path in outputs {
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let saved = save_image_bytes(app, &bytes)?;
        images.push(GeneratedImage {
            asset_id: saved.asset_id,
            file_path: saved.file_path,
            mime_type: saved.mime_type,
            url: None,
            width: saved.width,
            height: saved.height,
            text: None,
        });
    }

    Ok((
        ImageGenerationResponse {
            images,
            model: request.model.clone(),
            provider_id: request.provider_id.clone(),
        },
        memory_parser.snapshot(),
    ))
}

fn emit_progress(app: &AppHandle, re: &regex::Regex, line: &str) {
    if let Some(captures) = re.captures(line) {
        let step: u32 = captures[1].parse().unwrap_or(0);
        let steps: u32 = captures[2].parse().unwrap_or(0);
        if steps > 0 && step <= steps {
            let _ = app.emit(
                "local_diffusion_progress",
                serde_json::json!({ "step": step, "steps": steps }),
            );
        }
    }
}

pub async fn cancel() -> Result<bool, String> {
    let mut slot = RUNNING.lock().await;
    if let Some(child) = slot.as_mut() {
        child.start_kill().map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}
