use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SdFamily {
    Sd15,
    Sdxl,
    Sd3,
    Flux,
}

impl SdFamily {
    pub fn prefix(&self) -> &'static str {
        match self {
            SdFamily::Sd15 => "sd15",
            SdFamily::Sdxl => "sdxl",
            SdFamily::Sd3 => "sd3",
            SdFamily::Flux => "flux",
        }
    }

    pub fn parse(value: &str) -> Option<SdFamily> {
        match value.trim().to_ascii_lowercase().as_str() {
            "sd15" => Some(SdFamily::Sd15),
            "sdxl" => Some(SdFamily::Sdxl),
            "sd3" => Some(SdFamily::Sd3),
            "flux" => Some(SdFamily::Flux),
            _ => None,
        }
    }
}

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
            self.vae.as_ref(),
        ]
        .into_iter()
        .flatten()
        .collect()
    }

    pub fn missing_roles(&self, family: SdFamily) -> Vec<&'static str> {
        let mut missing = Vec::new();
        match family {
            SdFamily::Sd15 | SdFamily::Sdxl => {
                if self.checkpoint.is_none() {
                    missing.push("checkpoint");
                }
            }
            SdFamily::Flux | SdFamily::Sd3 => {
                if self.diffusion_model.is_none() && self.checkpoint.is_none() {
                    missing.push("diffusionModel");
                }
                if self.clip_l.is_none() {
                    missing.push("clipL");
                }
                if family == SdFamily::Sd3 && self.clip_g.is_none() {
                    missing.push("clipG");
                }
                if self.t5xxl.is_none() {
                    missing.push("t5xxl");
                }
                if self.vae.is_none() {
                    missing.push("vae");
                }
            }
        }
        missing
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdModelEntry {
    pub id: String,
    pub name: String,
    pub family: SdFamily,
    pub files: SdModelFiles,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub total_bytes: u64,
    pub created_at: u64,
}

impl SdModelEntry {
    pub fn missing_roles(&self) -> Vec<&'static str> {
        self.files.missing_roles(self.family)
    }

    pub fn is_complete(&self) -> bool {
        self.missing_roles().is_empty()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdModelEntryDto {
    #[serde(flatten)]
    pub entry: SdModelEntry,
    pub complete: bool,
    pub missing_roles: Vec<&'static str>,
}

impl From<SdModelEntry> for SdModelEntryDto {
    fn from(entry: SdModelEntry) -> Self {
        let missing_roles = entry.missing_roles();
        SdModelEntryDto {
            complete: missing_roles.is_empty(),
            missing_roles,
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
