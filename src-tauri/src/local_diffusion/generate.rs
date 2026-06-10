use std::fs;
use std::path::PathBuf;

use base64::{engine::general_purpose, Engine};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;

use super::binary;
use super::registry;
use super::types::{SdFamily, SdModelEntry};
use crate::image_generator::storage::save_image_bytes;
use crate::image_generator::types::{
    GeneratedImage, ImageGenerationRequest, ImageGenerationResponse,
};

static RUNNING: Mutex<Option<tokio::process::Child>> = Mutex::const_new(None);

struct FamilyDefaults {
    width: u32,
    height: u32,
    steps: u32,
    cfg_scale: f64,
}

fn defaults_for(entry: &SdModelEntry) -> FamilyDefaults {
    match entry.family {
        SdFamily::Sd15 => FamilyDefaults {
            width: 512,
            height: 512,
            steps: 20,
            cfg_scale: 7.0,
        },
        SdFamily::Sdxl => FamilyDefaults {
            width: 1024,
            height: 1024,
            steps: 25,
            cfg_scale: 6.0,
        },
        SdFamily::Sd3 => FamilyDefaults {
            width: 1024,
            height: 1024,
            steps: 28,
            cfg_scale: 4.5,
        },
        SdFamily::Flux => {
            let schnell = entry.name.to_ascii_lowercase().contains("schnell")
                || entry.id.to_ascii_lowercase().contains("schnell");
            FamilyDefaults {
                width: 1024,
                height: 1024,
                steps: if schnell { 4 } else { 20 },
                cfg_scale: 1.0,
            }
        }
    }
}

fn parse_size(size: Option<&str>, defaults: &FamilyDefaults) -> (u32, u32) {
    let parsed = size.and_then(|value| {
        let normalized = value.trim().to_ascii_lowercase();
        let (w, h) = normalized.split_once('x')?;
        Some((w.trim().parse::<u32>().ok()?, h.trim().parse::<u32>().ok()?))
    });
    let (width, height) = parsed.unwrap_or((defaults.width, defaults.height));
    (round_to_64(width), round_to_64(height))
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
) -> Vec<String> {
    let defaults = defaults_for(entry);
    let settings = request.advanced_model_settings.as_ref();
    let size = request
        .size
        .as_deref()
        .or_else(|| settings.and_then(|s| s.sd_size.as_deref()));
    let (width, height) = parse_size(size, &defaults);
    let steps = settings.and_then(|s| s.sd_steps).unwrap_or(defaults.steps);
    let cfg_scale = settings
        .and_then(|s| s.sd_cfg_scale)
        .unwrap_or(defaults.cfg_scale);

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
    if let Some(vae) = &files.vae {
        args.extend(["--vae".into(), vae.clone()]);
    }

    args.extend(["-p".into(), request.prompt.clone()]);
    if let Some(negative) = settings.and_then(|s| s.sd_negative_prompt.as_ref()) {
        if !negative.trim().is_empty() {
            args.extend(["-n".into(), negative.clone()]);
        }
    }
    args.extend(["-W".into(), width.to_string()]);
    args.extend(["-H".into(), height.to_string()]);
    args.extend(["--steps".into(), steps.to_string()]);
    args.extend(["--cfg-scale".into(), format!("{cfg_scale}")]);
    if entry.family == SdFamily::Flux {
        let schnell = entry.name.to_ascii_lowercase().contains("schnell")
            || entry.id.to_ascii_lowercase().contains("schnell");
        if !schnell {
            args.extend(["--guidance".into(), "3.5".into()]);
        }
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
        args.extend(["-M".into(), "img2img".into()]);
        args.extend(["-i".into(), init.to_string_lossy().to_string()]);
        args.extend(["--strength".into(), format!("{strength}")]);
    }
    args.extend(["-o".into(), out_path.to_string_lossy().to_string()]);
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
            "Model {} is missing required files: {}",
            entry.name,
            entry.missing_roles().join(", ")
        ));
    }

    let tmp_dir = registry::diffusion_root(app)?
        .join("tmp")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let result = run_generation(app, &binary_info.path, &entry, request, &tmp_dir).await;
    let _ = fs::remove_dir_all(&tmp_dir);
    result
}

async fn run_generation(
    app: &AppHandle,
    binary_path: &str,
    entry: &SdModelEntry,
    request: &ImageGenerationRequest,
    tmp_dir: &PathBuf,
) -> Result<ImageGenerationResponse, String> {
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
    let args = build_args(entry, request, &out_path, init_image.as_ref());

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
    let mut stderr_tail: Vec<String> = Vec::new();

    let app_clone = app.clone();
    let re_clone = progress_re.clone();
    let stdout_task = tokio::spawn(async move {
        if let Some(stdout) = stdout {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                emit_progress(&app_clone, &re_clone, &line);
            }
        }
    });
    if let Some(stderr) = stderr {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            emit_progress(app, &progress_re, &line);
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

    Ok(ImageGenerationResponse {
        images,
        model: request.model.clone(),
        provider_id: request.provider_id.clone(),
    })
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
