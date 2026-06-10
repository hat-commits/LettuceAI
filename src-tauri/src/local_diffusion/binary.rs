use std::fs;
use std::path::PathBuf;

use tauri::AppHandle;

use super::registry::diffusion_root;
use super::types::SdBinaryInfo;

pub fn bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = diffusion_root(app)?.join("bin");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn binary_info_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(diffusion_root(app)?.join("binary.json"))
}

pub fn read_binary_info(app: &AppHandle) -> Option<SdBinaryInfo> {
    let path = binary_info_path(app).ok()?;
    let raw = fs::read_to_string(path).ok()?;
    let info: SdBinaryInfo = serde_json::from_str(&raw).ok()?;
    if PathBuf::from(&info.path).is_file() {
        Some(info)
    } else {
        None
    }
}

pub fn write_binary_info(app: &AppHandle, info: &SdBinaryInfo) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(info).map_err(|e| e.to_string())?;
    fs::write(binary_info_path(app)?, raw).map_err(|e| e.to_string())
}

pub fn detect_recommended_variant() -> String {
    if cfg!(target_os = "macos") {
        return "default".to_string();
    }
    if cfg!(target_os = "windows") && has_nvidia_gpu() {
        return "cuda".to_string();
    }
    "vulkan".to_string()
}

fn has_nvidia_gpu() -> bool {
    if cfg!(target_os = "macos") {
        return false;
    }
    std::process::Command::new("nvidia-smi")
        .arg("-L")
        .output()
        .map(|output| output.status.success() && !output.stdout.is_empty())
        .unwrap_or(false)
}
