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
