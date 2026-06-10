use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdModelFiles {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diffusion_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip_l: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip_g: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub t5xxl: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_vision: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vae: Option<String>,
}

impl SdModelFiles {
    pub fn all_paths(&self) -> Vec<&String> {
        [
            self.checkpoint.as_ref(),
            self.diffusion_model.as_ref(),
            self.clip_l.as_ref(),
            self.clip_g.as_ref(),
            self.t5xxl.as_ref(),
            self.llm.as_ref(),
            self.llm_vision.as_ref(),
            self.vae.as_ref(),
        ]
        .into_iter()
        .flatten()
        .collect()
    }

    pub fn has_main_model(&self) -> bool {
        self.checkpoint.is_some() || self.diffusion_model.is_some()
    }

    pub fn set_role(&mut self, role: &str, path: String) -> Result<(), String> {
        self.assign_role(role, Some(path))
    }

    pub fn assign_role(&mut self, role: &str, path: Option<String>) -> Result<(), String> {
        let path = path
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        match role {
            "checkpoint" => self.checkpoint = path,
            "diffusionModel" => self.diffusion_model = path,
            "clipL" => self.clip_l = path,
            "clipG" => self.clip_g = path,
            "t5xxl" => self.t5xxl = path,
            "llm" => self.llm = path,
            "llmVision" => self.llm_vision = path,
            "vae" => self.vae = path,
            other => return Err(format!("Unknown file role: {other}")),
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdMeasuredProfile {
    pub total_params_mb: f64,
    pub text_encoders_mb: f64,
    pub diffusion_mb: f64,
    pub vae_mb: f64,
    pub max_compute_vram_mb: f64,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdModelEntry {
    pub id: String,
    pub name: String,
    pub family: String,
    pub files: SdModelFiles,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub total_bytes: u64,
    pub created_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measured: Option<SdMeasuredProfile>,
}

impl SdModelEntry {
    pub fn is_complete(&self) -> bool {
        self.files.has_main_model()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdModelEntryDto {
    #[serde(flatten)]
    pub entry: SdModelEntry,
    pub complete: bool,
}

impl From<SdModelEntry> for SdModelEntryDto {
    fn from(entry: SdModelEntry) -> Self {
        SdModelEntryDto {
            complete: entry.is_complete(),
            entry,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdBinaryInfo {
    pub path: String,
    pub variant: String,
    pub release_tag: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdStatus {
    pub binary: Option<SdBinaryInfo>,
    pub recommended_variant: String,
    pub models_dir: String,
}

pub fn family_slug(label: &str) -> String {
    let slug: String = label
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "model".to_string()
    } else {
        slug
    }
}
