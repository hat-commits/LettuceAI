use std::fs;
use std::path::PathBuf;

use tauri::AppHandle;
use tokio::sync::Mutex;

use super::types::{SdModelEntry, SdModelFiles};

static REGISTRY_LOCK: Mutex<()> = Mutex::const_new(());

pub fn diffusion_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::infra::utils::ensure_lettuce_dir(app)?.join("diffusion");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::infra::utils::ensure_lettuce_dir(app)?
        .join("models")
        .join("diffusion");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(diffusion_root(app)?.join("registry.json"))
}

fn read_entries(app: &AppHandle) -> Result<Vec<SdModelEntry>, String> {
    let path = registry_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("Failed to parse diffusion registry: {e}"))
}

fn write_entries(app: &AppHandle, entries: &[SdModelEntry]) -> Result<(), String> {
    let path = registry_path(app)?;
    let raw = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())
}

pub async fn list_models(app: &AppHandle) -> Result<Vec<SdModelEntry>, String> {
    let _guard = REGISTRY_LOCK.lock().await;
    read_entries(app)
}

pub async fn get_model(app: &AppHandle, model_id: &str) -> Result<Option<SdModelEntry>, String> {
    let _guard = REGISTRY_LOCK.lock().await;
    Ok(read_entries(app)?
        .into_iter()
        .find(|entry| entry.id == model_id))
}

pub async fn upsert_model(app: &AppHandle, entry: SdModelEntry) -> Result<SdModelEntry, String> {
    let _guard = REGISTRY_LOCK.lock().await;
    let mut entries = read_entries(app)?;
    match entries.iter_mut().find(|existing| existing.id == entry.id) {
        Some(existing) => *existing = entry.clone(),
        None => entries.push(entry.clone()),
    }
    write_entries(app, &entries)?;
    Ok(entry)
}

pub async fn update_model_files(
    app: &AppHandle,
    model_id: &str,
    files: SdModelFiles,
) -> Result<SdModelEntry, String> {
    let _guard = REGISTRY_LOCK.lock().await;
    let mut entries = read_entries(app)?;
    let entry = entries
        .iter_mut()
        .find(|existing| existing.id == model_id)
        .ok_or_else(|| format!("Unknown local diffusion model: {model_id}"))?;
    merge_files(&mut entry.files, files);
    entry.total_bytes = total_bytes(&entry.files);
    let updated = entry.clone();
    write_entries(app, &entries)?;
    Ok(updated)
}

pub async fn set_model_file(
    app: &AppHandle,
    model_id: &str,
    role: &str,
    path: Option<String>,
) -> Result<SdModelEntry, String> {
    let _guard = REGISTRY_LOCK.lock().await;
    let mut entries = read_entries(app)?;
    let entry = entries
        .iter_mut()
        .find(|existing| existing.id == model_id)
        .ok_or_else(|| format!("Unknown local diffusion model: {model_id}"))?;
    entry.files.assign_role(role, path)?;
    entry.total_bytes = total_bytes(&entry.files);
    let updated = entry.clone();
    write_entries(app, &entries)?;
    Ok(updated)
}

pub async fn set_measured(
    app: &AppHandle,
    model_id: &str,
    measured: super::types::SdMeasuredProfile,
) -> Result<(), String> {
    let _guard = REGISTRY_LOCK.lock().await;
    let mut entries = read_entries(app)?;
    if let Some(entry) = entries.iter_mut().find(|existing| existing.id == model_id) {
        entry.measured = Some(measured);
        write_entries(app, &entries)?;
    }
    Ok(())
}

pub async fn remove_model(app: &AppHandle, model_id: &str) -> Result<Option<SdModelEntry>, String> {
    let _guard = REGISTRY_LOCK.lock().await;
    let mut entries = read_entries(app)?;
    let removed = entries.iter().position(|entry| entry.id == model_id);
    let removed = removed.map(|index| entries.remove(index));
    if removed.is_some() {
        write_entries(app, &entries)?;
    }
    Ok(removed)
}

pub async fn find_by_repo(app: &AppHandle, repo: &str) -> Result<Option<SdModelEntry>, String> {
    let _guard = REGISTRY_LOCK.lock().await;
    Ok(read_entries(app)?
        .into_iter()
        .find(|entry| entry.repo.as_deref() == Some(repo)))
}

fn merge_files(target: &mut SdModelFiles, incoming: SdModelFiles) {
    if incoming.checkpoint.is_some() {
        target.checkpoint = incoming.checkpoint;
    }
    if incoming.diffusion_model.is_some() {
        target.diffusion_model = incoming.diffusion_model;
    }
    if incoming.clip_l.is_some() {
        target.clip_l = incoming.clip_l;
    }
    if incoming.clip_g.is_some() {
        target.clip_g = incoming.clip_g;
    }
    if incoming.t5xxl.is_some() {
        target.t5xxl = incoming.t5xxl;
    }
    if incoming.llm.is_some() {
        target.llm = incoming.llm;
    }
    if incoming.llm_vision.is_some() {
        target.llm_vision = incoming.llm_vision;
    }
    if incoming.vae.is_some() {
        target.vae = incoming.vae;
    }
}

pub fn total_bytes(files: &SdModelFiles) -> u64 {
    files
        .all_paths()
        .into_iter()
        .filter_map(|path| fs::metadata(path).ok())
        .map(|meta| meta.len())
        .sum()
}

pub fn validate_files_exist(files: &SdModelFiles) -> Result<(), String> {
    for path in files.all_paths() {
        if !PathBuf::from(path).is_file() {
            return Err(format!("File not found: {path}"));
        }
    }
    Ok(())
}
