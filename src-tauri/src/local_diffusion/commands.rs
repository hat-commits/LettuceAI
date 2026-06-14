use tauri::AppHandle;

use super::binary;
use super::binary::{SdEngineVariant, SdQueuedInstall};
use super::registry;
use super::types::{
    family_slug, SdBinaryInfo, SdModelEntry, SdModelEntryDto, SdModelFiles, SdStatus,
};

#[tauri::command]
pub async fn sd_get_status(app: AppHandle) -> Result<SdStatus, String> {
    Ok(SdStatus {
        binary: binary::read_binary_info(&app),
        recommended_variant: binary::detect_recommended_variant(),
        models_dir: registry::models_dir(&app)?.to_string_lossy().to_string(),
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdModelsDirInfo {
    path: String,
    default_path: String,
    is_custom: bool,
    model_count: u32,
}

#[tauri::command]
pub async fn sd_get_models_dir(app: AppHandle) -> Result<SdModelsDirInfo, String> {
    let default_path = registry::default_models_dir(&app)?;
    let is_custom = registry::custom_models_dir(&app).is_some();
    let path = registry::models_dir(&app)?;
    let model_count = crate::infra::model_storage::count_models_in_dir(&path);
    Ok(SdModelsDirInfo {
        path: path.to_string_lossy().to_string(),
        default_path: default_path.to_string_lossy().to_string(),
        is_custom,
        model_count,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSdModelsDirResult {
    path: String,
    moved_entries: u32,
    rewired_models: u32,
}

#[tauri::command]
pub async fn sd_set_models_dir(
    app: AppHandle,
    new_dir: String,
    move_existing: bool,
) -> Result<SetSdModelsDirResult, String> {
    let new_path = std::path::PathBuf::from(new_dir.trim());
    if new_path.as_os_str().is_empty() {
        return Err("New models folder path is empty".to_string());
    }

    let old_path = registry::models_dir(&app)?;
    std::fs::create_dir_all(&new_path).map_err(|e| {
        crate::utils::err_msg(
            module_path!(),
            line!(),
            format!("Failed to create models folder: {}", e),
        )
    })?;

    let same = crate::infra::model_storage::paths_equal(&old_path, &new_path);
    let (moved_entries, rewired_models) = if move_existing && !same {
        crate::infra::model_storage::migrate_models_dir(&old_path, &new_path, |old, new| {
            registry::rewire_registry_paths(&app, old, new)
        })?
    } else {
        (0, 0)
    };

    if crate::infra::model_storage::paths_equal(&new_path, &registry::default_models_dir(&app)?) {
        crate::infra::model_storage::persist_custom_dir(&app, "customSdModelsDir", None)?;
    } else {
        crate::infra::model_storage::persist_custom_dir(
            &app,
            "customSdModelsDir",
            Some(new_path.to_string_lossy().as_ref()),
        )?;
    }

    Ok(SetSdModelsDirResult {
        path: new_path.to_string_lossy().to_string(),
        moved_entries,
        rewired_models,
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

fn derive_family(files: &SdModelFiles) -> String {
    let main = files
        .checkpoint
        .as_deref()
        .or(files.diffusion_model.as_deref())
        .unwrap_or("");
    let filename = main.rsplit(['/', '\\']).next().unwrap_or(main);
    crate::hf_browser::sd::guess_family(filename, 0).to_string()
}

#[tauri::command]
pub async fn sd_import_model(
    app: AppHandle,
    name: String,
    family: Option<String>,
    files: SdModelFiles,
) -> Result<SdModelEntryDto, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Model name is required".to_string());
    }
    if files.all_paths().is_empty() {
        return Err("At least one model file is required".to_string());
    }
    let family = family
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| derive_family(&files));
    let entry = SdModelEntry {
        id: format!("{}-{}", family_slug(&family), uuid::Uuid::new_v4()),
        name,
        family,
        total_bytes: registry::total_bytes(&files),
        files,
        source: "imported".to_string(),
        repo: None,
        created_at: crate::infra::utils::now_millis()?,
        measured: None,
    };
    Ok(registry::upsert_model(&app, entry).await?.into())
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdLocalFile {
    pub filename: String,
    pub path: String,
    pub size: u64,
}

const MODEL_FILE_EXTENSIONS: [&str; 4] = ["safetensors", "gguf", "ckpt", "sft"];

fn collect_model_files(root: &std::path::Path, out: &mut Vec<SdLocalFile>) {
    for entry in walkdir::WalkDir::new(root)
        .max_depth(4)
        .into_iter()
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let has_model_ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| {
                MODEL_FILE_EXTENSIONS
                    .iter()
                    .any(|known| known.eq_ignore_ascii_case(ext))
            })
            .unwrap_or(false);
        if !has_model_ext {
            continue;
        }
        let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        out.push(SdLocalFile {
            filename: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            size,
        });
    }
}

#[tauri::command]
pub async fn sd_list_local_files(app: AppHandle) -> Result<Vec<SdLocalFile>, String> {
    let mut files = Vec::new();
    collect_model_files(&registry::models_dir(&app)?, &mut files);
    let gguf_dir = crate::infra::utils::ensure_lettuce_dir(&app)?
        .join("models")
        .join("gguf");
    if gguf_dir.exists() {
        collect_model_files(&gguf_dir, &mut files);
    }
    files.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
    Ok(files)
}

pub fn loras_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = crate::infra::utils::ensure_lettuce_dir(app)?
        .join("models")
        .join("loras");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub async fn sd_list_loras(app: AppHandle) -> Result<Vec<SdLocalFile>, String> {
    let mut files = Vec::new();
    collect_model_files(&loras_dir(&app)?, &mut files);
    files.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
    Ok(files)
}

#[tauri::command]
pub async fn sd_import_lora(app: AppHandle, path: String) -> Result<SdLocalFile, String> {
    let source = std::path::PathBuf::from(&path);
    if !source.is_file() {
        return Err(format!("File not found: {path}"));
    }
    let filename = source
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| "Invalid file name".to_string())?;
    let destination = loras_dir(&app)?.join(&filename);
    if !destination.is_file() {
        std::fs::copy(&source, &destination).map_err(|e| format!("Failed to copy LoRA: {e}"))?;
    }
    let size = std::fs::metadata(&destination)
        .map(|meta| meta.len())
        .unwrap_or(0);
    Ok(SdLocalFile {
        filename,
        path: destination.to_string_lossy().to_string(),
        size,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdImageFile {
    pub filename: String,
    pub path: String,
    pub size: u64,
    pub role: String,
}

#[tauri::command]
pub async fn sd_list_image_files(app: AppHandle) -> Result<Vec<SdImageFile>, String> {
    let mut raw = Vec::new();
    collect_model_files(&registry::models_dir(&app)?, &mut raw);
    let mut files: Vec<SdImageFile> = raw
        .into_iter()
        .map(|file| SdImageFile {
            role: crate::hf_browser::sd::guess_role(&file.filename, file.size).to_string(),
            filename: file.filename,
            path: file.path,
            size: file.size,
        })
        .collect();
    let mut lora_raw = Vec::new();
    collect_model_files(&loras_dir(&app)?, &mut lora_raw);
    files.extend(lora_raw.into_iter().map(|file| SdImageFile {
        role: "lora".to_string(),
        filename: file.filename,
        path: file.path,
        size: file.size,
    }));
    files.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
    Ok(files)
}

#[tauri::command]
pub async fn sd_delete_image_file(app: AppHandle, path: String) -> Result<bool, String> {
    let target = std::path::PathBuf::from(&path);
    let models_root = registry::models_dir(&app)?;
    let loras_root = loras_dir(&app)?;
    if !(target.starts_with(&models_root) || target.starts_with(&loras_root)) {
        return Err("File is outside the managed model folders".to_string());
    }
    if target.is_file() {
        std::fs::remove_file(&target).map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn sd_delete_lora(app: AppHandle, filename: String) -> Result<bool, String> {
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("Invalid LoRA file name".to_string());
    }
    let path = loras_dir(&app)?.join(&filename);
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn sd_set_model_file(
    app: AppHandle,
    model_id: String,
    role: String,
    path: Option<String>,
) -> Result<SdModelEntryDto, String> {
    Ok(registry::set_model_file(&app, &model_id, &role, path)
        .await?
        .into())
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
pub async fn sd_list_engine_variants() -> Result<Vec<SdEngineVariant>, String> {
    binary::list_engine_variants().await
}

#[tauri::command]
pub async fn sd_queue_binary_install(
    app: AppHandle,
    variant: Option<String>,
) -> Result<SdQueuedInstall, String> {
    binary::queue_binary_install(&app, variant).await
}

#[tauri::command]
pub async fn sd_finalize_binary_install(app: AppHandle) -> Result<SdBinaryInfo, String> {
    binary::finalize_binary_install(&app)
}

#[tauri::command]
pub async fn sd_remove_binary(app: AppHandle) -> Result<(), String> {
    binary::remove_binary(&app)
}

#[tauri::command]
pub async fn sd_set_custom_binary(app: AppHandle, path: String) -> Result<SdBinaryInfo, String> {
    let binary_path = std::path::PathBuf::from(path.trim());
    if !binary_path.is_file() {
        return Err(format!("File not found: {}", binary_path.display()));
    }
    let info = SdBinaryInfo {
        path: binary_path.to_string_lossy().to_string(),
        variant: "custom".to_string(),
        release_tag: "external".to_string(),
    };
    binary::write_binary_info(&app, &info)?;
    Ok(info)
}

#[tauri::command]
pub async fn sd_cancel_generation() -> Result<bool, String> {
    super::generate::cancel().await
}

#[tauri::command]
pub async fn sd_register_hf_model(
    app: AppHandle,
    repo: String,
    file_path: String,
    role: String,
    family: Option<String>,
    display_name: Option<String>,
) -> Result<SdModelEntryDto, String> {
    if !std::path::PathBuf::from(&file_path).is_file() {
        return Err(format!("File not found: {file_path}"));
    }

    let mut files = SdModelFiles::default();
    files.set_role(&role, file_path)?;

    if let Some(existing) = registry::find_by_repo(&app, &repo).await? {
        return Ok(registry::update_model_files(&app, &existing.id, files)
            .await?
            .into());
    }

    let family = family
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| derive_family(&files));
    let name = display_name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            repo.split('/')
                .next_back()
                .unwrap_or(repo.as_str())
                .to_string()
        });
    let entry = SdModelEntry {
        id: format!("{}-{}", family_slug(&family), uuid::Uuid::new_v4()),
        name,
        family,
        total_bytes: registry::total_bytes(&files),
        files,
        source: "hf".to_string(),
        repo: Some(repo),
        created_at: crate::infra::utils::now_millis()?,
        measured: None,
    };
    Ok(registry::upsert_model(&app, entry).await?.into())
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
