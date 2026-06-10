use tauri::AppHandle;

use super::binary;
use super::registry;
use super::types::{SdFamily, SdModelEntry, SdModelEntryDto, SdModelFiles, SdStatus};

#[tauri::command]
pub async fn sd_get_status(app: AppHandle) -> Result<SdStatus, String> {
    Ok(SdStatus {
        binary: binary::read_binary_info(&app),
        recommended_variant: binary::detect_recommended_variant(),
        models_dir: registry::models_dir(&app)?.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn sd_list_models(app: AppHandle) -> Result<Vec<SdModelEntryDto>, String> {
    Ok(registry::list_models(&app)
        .await?
        .into_iter()
        .map(SdModelEntryDto::from)
        .collect())
}

#[tauri::command]
pub async fn sd_import_model(
    app: AppHandle,
    name: String,
    family: String,
    files: SdModelFiles,
) -> Result<SdModelEntryDto, String> {
    let family = SdFamily::parse(&family).ok_or_else(|| format!("Unknown family: {family}"))?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Model name is required".to_string());
    }
    if files.all_paths().is_empty() {
        return Err("At least one model file is required".to_string());
    }
    registry::validate_files_exist(&files)?;
    let entry = SdModelEntry {
        id: format!("{}-{}", family.prefix(), uuid::Uuid::new_v4()),
        name,
        family,
        total_bytes: registry::total_bytes(&files),
        files,
        source: "imported".to_string(),
        repo: None,
        created_at: crate::infra::utils::now_millis()?,
    };
    Ok(registry::upsert_model(&app, entry).await?.into())
}

#[tauri::command]
pub async fn sd_update_model_files(
    app: AppHandle,
    model_id: String,
    files: SdModelFiles,
) -> Result<SdModelEntryDto, String> {
    registry::validate_files_exist(&files)?;
    Ok(registry::update_model_files(&app, &model_id, files)
        .await?
        .into())
}

#[tauri::command]
pub async fn sd_delete_model(
    app: AppHandle,
    model_id: String,
    delete_files: bool,
) -> Result<bool, String> {
    let removed = registry::remove_model(&app, &model_id).await?;
    let Some(entry) = removed else {
        return Ok(false);
    };
    if delete_files {
        let models_root = registry::models_dir(&app)?;
        for path in entry.files.all_paths() {
            let path = std::path::PathBuf::from(path);
            if path.starts_with(&models_root) && path.is_file() {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    Ok(true)
}
