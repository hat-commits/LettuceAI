use serde::Serialize;

use super::{quant_quality_score, score_label, RunabilityFileInput};

const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
const FIXED_OVERHEAD_BYTES: f64 = 0.6 * GIB;
const RESOLUTIONS: [u32; 3] = [512, 768, 1024];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdRunabilityScore {
    pub filename: String,
    pub score: u32,
    pub label: String,
    pub family_guess: String,
    pub fits_in_vram: bool,
    pub fits_in_ram: bool,
    pub max_comfortable_resolution: u32,
}

pub fn guess_family(filename: &str, size: u64) -> &'static str {
    let lower = filename.to_ascii_lowercase();
    if lower.contains("z_image") || lower.contains("z-image") || lower.contains("zimage") {
        return "zimage";
    }
    if lower.contains("qwen") {
        return "qwen-image";
    }
    if lower.contains("chroma") {
        return "chroma";
    }
    if lower.contains("flux") {
        return "flux";
    }
    if lower.contains("sd3") || lower.contains("sd_3") || lower.contains("sd35") {
        return "sd3";
    }
    if lower.contains("xl") || lower.contains("sdxl") || lower.contains("pony") {
        return "sdxl";
    }
    if lower.contains("v1-5") || lower.contains("sd15") || lower.contains("sd-v1") {
        return "sd15";
    }
    let gib = size as f64 / GIB;
    if gib > 8.0 {
        "flux"
    } else if gib > 5.5 {
        "sdxl"
    } else if gib > 0.0 {
        "sd15"
    } else {
        "model"
    }
}

fn needs_separate_components(family: &str) -> bool {
    !matches!(family, "sd15" | "sdxl" | "model")
}

pub fn guess_role(filename: &str, size: u64) -> &'static str {
    let lower = filename.to_ascii_lowercase();
    if lower.contains("clip_l") || lower.contains("clip-l") {
        return "clipL";
    }
    if lower.contains("clip_g") || lower.contains("clip-g") {
        return "clipG";
    }
    if lower.contains("t5xxl") || lower.contains("t5-xxl") || lower.contains("t5_xxl") {
        return "t5xxl";
    }
    if lower.contains("vae") || lower == "ae.safetensors" || lower == "ae.sft" {
        return "vae";
    }
    let llm_token = lower.contains("qwen3")
        || lower.contains("qwen2")
        || lower.contains("qwen-2")
        || lower.contains("mistral")
        || lower.contains("text_encoder")
        || lower.contains("text-encoder");
    if llm_token {
        if lower.contains("vision") || lower.contains("mmproj") {
            return "llmVision";
        }
        return "llm";
    }
    let family = guess_family(filename, size);
    if lower.ends_with(".gguf") || needs_separate_components(family) {
        return "diffusionModel";
    }
    "checkpoint"
}

fn encoder_overhead_bytes(family: &str) -> f64 {
    match family {
        "flux" | "chroma" => 5.5 * GIB,
        "sd3" => 6.9 * GIB,
        "zimage" => 3.0 * GIB,
        "qwen-image" => 8.0 * GIB,
        "sd15" | "sdxl" => 0.0,
        _ => 3.0 * GIB,
    }
}

fn activation_bytes_at_1024(family: &str) -> f64 {
    match family {
        "flux" | "chroma" | "qwen-image" => 5.0 * GIB,
        "sd3" => 4.0 * GIB,
        "sdxl" | "zimage" => 3.0 * GIB,
        "sd15" => 1.5 * GIB,
        _ => 3.0 * GIB,
    }
}

fn native_resolution(family: &str) -> u32 {
    if family == "sd15" {
        512
    } else {
        1024
    }
}

fn needed_bytes(family: &str, file_size: u64, resolution: u32) -> f64 {
    let pixels_ratio = (resolution as f64 * resolution as f64) / (1024.0 * 1024.0);
    file_size as f64
        + encoder_overhead_bytes(family)
        + activation_bytes_at_1024(family) * pixels_ratio
        + FIXED_OVERHEAD_BYTES
}

fn memory_score(needed: f64, available: f64) -> f64 {
    if available <= 0.0 {
        return 0.0;
    }
    let ratio = needed / available;
    if ratio <= 0.5 {
        100.0
    } else if ratio <= 0.7 {
        90.0
    } else if ratio <= 0.85 {
        75.0
    } else if ratio <= 1.0 {
        55.0
    } else if ratio <= 1.2 {
        25.0
    } else {
        0.0
    }
}

#[tauri::command]
pub async fn hf_compute_sd_runability(
    files: Vec<RunabilityFileInput>,
) -> Result<Vec<SdRunabilityScore>, String> {
    Ok(compute_sd_runability(&files))
}

pub fn compute_sd_runability(files: &[RunabilityFileInput]) -> Vec<SdRunabilityScore> {
    let available_ram = crate::llama_cpp::available_memory_bytes().unwrap_or(0) as f64;
    let available_vram = crate::llama_cpp::available_vram_bytes().unwrap_or(0) as f64;
    let unified = crate::llama_cpp::is_unified_memory();
    let total_available = if unified {
        available_ram.max(available_vram)
    } else {
        available_ram + available_vram
    };

    files
        .iter()
        .map(|file| {
            let family = guess_family(&file.filename, file.size);
            let native = native_resolution(family);
            let needed_native = needed_bytes(family, file.size, native);

            let fits_in_vram = available_vram > 0.0 && needed_native <= available_vram * 0.9;
            let fits_in_ram = needed_native <= available_ram * 0.8;

            let max_comfortable_resolution = RESOLUTIONS
                .iter()
                .copied()
                .filter(|&res| {
                    let needed = needed_bytes(family, file.size, res);
                    if available_vram > 0.0 && !unified {
                        needed <= available_vram * 0.9 || needed <= total_available * 0.8
                    } else {
                        needed <= total_available * 0.8
                    }
                })
                .max()
                .unwrap_or(0);

            let mem = memory_score(needed_native, total_available);
            let quant = quant_quality_score(&file.quantization);
            let speed = if fits_in_vram {
                100.0
            } else if available_vram > 0.0 && (file.size as f64) <= available_vram * 0.9 {
                55.0
            } else {
                20.0
            };
            let score = (mem * 0.6 + quant * 0.25 + speed * 0.15).round() as u32;
            let score = if mem <= 0.0 { 0 } else { score.min(100) };

            SdRunabilityScore {
                filename: file.filename.clone(),
                score,
                label: score_label(score),
                family_guess: family.to_string(),
                fits_in_vram,
                fits_in_ram,
                max_comfortable_resolution,
            }
        })
        .collect()
}
