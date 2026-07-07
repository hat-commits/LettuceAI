use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use futures_util::StreamExt;
use hmac::{Hmac, Mac};
use reqwest::header::{CONTENT_TYPE, HOST};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

use super::types::{AudioModel, ProviderVoice};

type HmacSha256 = Hmac<Sha256>;

const PROVIDER_TYPE: &str = "doubao_tts";
const DEFAULT_TTS_BASE_URL: &str = "https://openspeech.bytedance.com";
const TTS_REQUEST_PATH: &str = "/api/v3/tts/unidirectional";
const OPENAPI_HOST: &str = "open.volcengineapi.com";
const OPENAPI_REGION: &str = "cn-beijing";
const OPENAPI_SERVICE: &str = "speech_saas_prod";
const OPENAPI_ACTION: &str = "ListSpeakers";
const OPENAPI_VERSION: &str = "2025-05-20";

#[derive(Debug, Clone, Copy)]
pub struct DoubaoConfig<'a> {
    pub api_key: &'a str,
    pub openapi_access_key: Option<&'a str>,
    pub openapi_secret_key: Option<&'a str>,
    pub resource_id: Option<&'a str>,
    pub base_url: Option<&'a str>,
    pub request_path: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoubaoStreamInfo {
    pub format: String,
    pub sample_rate: u32,
    pub mime_type: String,
}

#[derive(Debug, Clone)]
pub enum DoubaoAudioStreamEvent {
    Start(DoubaoStreamInfo),
    Chunk(Vec<u8>),
    End,
}

pub fn default_models() -> Vec<AudioModel> {
    vec![
        AudioModel {
            id: "seed-tts-2.0".to_string(),
            name: "Doubao TTS 2.0".to_string(),
            provider_type: PROVIDER_TYPE.to_string(),
        },
        AudioModel {
            id: "seed-tts-1.0".to_string(),
            name: "Doubao TTS 1.0".to_string(),
            provider_type: PROVIDER_TYPE.to_string(),
        },
        AudioModel {
            id: "seed-tts-1.0-concurr".to_string(),
            name: "Doubao TTS 1.0 Concurrency".to_string(),
            provider_type: PROVIDER_TYPE.to_string(),
        },
    ]
}

#[derive(Debug, Serialize)]
struct TtsUser<'a> {
    uid: &'a str,
}

#[derive(Debug, Serialize)]
struct TtsAudioParams<'a> {
    format: &'a str,
    sample_rate: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    bit_rate: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    emotion: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    emotion_scale: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    speech_rate: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    loudness_rate: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    enable_subtitle: Option<bool>,
}

#[derive(Debug, Serialize)]
struct TtsReqParams<'a> {
    text: &'a str,
    speaker: &'a str,
    audio_params: TtsAudioParams<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    additions: Option<String>,
}

#[derive(Debug, Serialize)]
struct TtsRequest<'a> {
    user: TtsUser<'a>,
    req_params: TtsReqParams<'a>,
}

#[derive(Debug, Deserialize)]
struct TtsStreamMessage {
    code: i64,
    #[serde(default)]
    message: String,
    #[serde(default)]
    data: Option<String>,
}

#[derive(Debug, Default)]
struct DoubaoPromptOptions {
    format: String,
    sample_rate: u32,
    bit_rate: Option<u32>,
    emotion: Option<String>,
    emotion_scale: Option<u8>,
    speech_rate: Option<i32>,
    loudness_rate: Option<i32>,
    pitch: Option<i32>,
    enable_subtitle: Option<bool>,
    additions: Option<serde_json::Map<String, serde_json::Value>>,
}

impl DoubaoPromptOptions {
    fn from_prompt(prompt: Option<&str>) -> Result<Self, String> {
        let mut options = Self {
            format: "mp3".to_string(),
            sample_rate: 24000,
            ..Self::default()
        };

        let Some(prompt) = prompt.map(str::trim).filter(|value| !value.is_empty()) else {
            return Ok(options);
        };

        let value: serde_json::Value = serde_json::from_str(prompt).map_err(|e| {
            crate::utils::err_msg(
                module_path!(),
                line!(),
                format!("Invalid Doubao TTS prompt JSON: {}", e),
            )
        })?;

        if let Some(format) = value.get("format").and_then(|v| v.as_str()) {
            options.format = match format {
                "mp3" | "ogg_opus" | "pcm" => format.to_string(),
                other => {
                    return Err(crate::utils::err_msg(
                        module_path!(),
                        line!(),
                        format!("Unsupported Doubao audio format: {}", other),
                    ));
                }
            };
        }
        if let Some(sample_rate) = value.get("sampleRate").and_then(|v| v.as_u64()) {
            options.sample_rate = clamp_u32(sample_rate, 8000, 48000);
        }
        if let Some(bit_rate) = value.get("bitRate").and_then(|v| v.as_u64()) {
            options.bit_rate = Some(clamp_u32(bit_rate, 8000, 320000));
        }
        if let Some(emotion) = value.get("emotion").and_then(|v| v.as_str()) {
            options.emotion = non_empty_string(emotion);
        }
        if let Some(emotion_scale) = value.get("emotionScale").and_then(|v| v.as_u64()) {
            options.emotion_scale = Some(clamp_u32(emotion_scale, 1, 5) as u8);
        }
        if let Some(speech_rate) = value.get("speechRate").and_then(|v| v.as_i64()) {
            options.speech_rate = Some((speech_rate as i32).clamp(-50, 100));
        }
        if let Some(loudness_rate) = value.get("loudnessRate").and_then(|v| v.as_i64()) {
            options.loudness_rate = Some((loudness_rate as i32).clamp(-50, 100));
        }
        if let Some(pitch) = value.get("pitch").and_then(|v| v.as_i64()) {
            options.pitch = Some((pitch as i32).clamp(-12, 12));
        }
        if let Some(enable_subtitle) = value.get("enableSubtitle").and_then(|v| v.as_bool()) {
            options.enable_subtitle = Some(enable_subtitle);
        }

        let mut additions = serde_json::Map::new();
        copy_json_field(&value, &mut additions, "contextTexts", "context_texts");
        copy_json_field(&value, &mut additions, "sectionId", "section_id");
        copy_json_field(
            &value,
            &mut additions,
            "enableLanguageDetector",
            "enable_language_detector",
        );
        copy_json_field(
            &value,
            &mut additions,
            "disableMarkdownFilter",
            "disable_markdown_filter",
        );
        copy_json_field(
            &value,
            &mut additions,
            "disableEmojiFilter",
            "disable_emoji_filter",
        );
        copy_json_field(
            &value,
            &mut additions,
            "explicitLanguage",
            "explicit_language",
        );
        copy_json_field(
            &value,
            &mut additions,
            "silenceDuration",
            "silence_duration",
        );
        copy_json_field(&value, &mut additions, "postProcess", "post_process");
        if let Some(extra) = value.get("additions").and_then(|v| v.as_object()) {
            for (key, value) in extra {
                additions.insert(key.clone(), value.clone());
            }
        }
        if let Some(pitch) = options.pitch {
            let post_process = additions
                .entry("post_process".to_string())
                .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
            if !post_process.is_object() {
                *post_process = serde_json::Value::Object(serde_json::Map::new());
            }
            if let Some(object) = post_process.as_object_mut() {
                object.insert("pitch".to_string(), serde_json::Value::from(pitch));
            }
        }
        if !additions.is_empty() {
            options.additions = Some(additions);
        }

        Ok(options)
    }

    fn force_stream_pcm(&mut self) {
        self.format = "pcm".to_string();
        self.bit_rate = None;
    }
}

pub async fn generate_speech(
    config: DoubaoConfig<'_>,
    text: &str,
    voice_id: &str,
    model: &str,
    prompt: Option<&str>,
) -> Result<(Vec<u8>, String), String> {
    let speaker = voice_id.trim();
    if speaker.is_empty() {
        return Err(crate::utils::err_msg(
            module_path!(),
            line!(),
            "Doubao TTS requires a voice id",
        ));
    }

    let resource_id = resolve_resource_id(config.resource_id, model);
    let options = DoubaoPromptOptions::from_prompt(prompt)?;
    let mut additions_map = options.additions.unwrap_or_default();
    additions_map
        .entry("max_length_to_filter_parenthesis".to_string())
        .or_insert_with(|| serde_json::Value::from(100));
    let additions = Some(
        serde_json::to_string(&additions_map)
            .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?,
    );

    let request = TtsRequest {
        user: TtsUser { uid: "lettuceai" },
        req_params: TtsReqParams {
            text,
            speaker,
            audio_params: TtsAudioParams {
                format: &options.format,
                sample_rate: options.sample_rate,
                bit_rate: options.bit_rate,
                emotion: options.emotion.as_deref(),
                emotion_scale: options.emotion_scale,
                speech_rate: options.speech_rate,
                loudness_rate: options.loudness_rate,
                enable_subtitle: options.enable_subtitle,
            },
            additions,
        },
    };

    let url = format!(
        "{}{}",
        normalize_base_url(config.base_url),
        normalize_request_path(config.request_path)
    );
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("X-Api-Key", config.api_key)
        .header("X-Api-Resource-Id", resource_id)
        .header("X-Api-Request-Id", uuid::Uuid::new_v4().to_string())
        .header(CONTENT_TYPE, "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            crate::utils::err_msg(module_path!(), line!(), format!("Request failed: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let log_id = response
            .headers()
            .get("X-Tt-Logid")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(crate::utils::err_msg(
            module_path!(),
            line!(),
            format!(
                "Doubao TTS error ({}){}: {}",
                status,
                format_log_id(&log_id),
                body
            ),
        ));
    }

    let mut audio = Vec::new();
    let mut buffer = String::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            crate::utils::err_msg(
                module_path!(),
                line!(),
                format!("Failed to read Doubao TTS stream: {}", e),
            )
        })?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(json) = pop_next_json_object(&mut buffer) {
            handle_tts_stream_message(&json, &mut audio)?;
        }
    }
    while let Some(json) = pop_next_json_object(&mut buffer) {
        handle_tts_stream_message(&json, &mut audio)?;
    }

    if audio.is_empty() {
        return Err(crate::utils::err_msg(
            module_path!(),
            line!(),
            "Doubao TTS returned no audio data",
        ));
    }

    Ok((audio, mime_for_format(&options.format).to_string()))
}

pub async fn stream_speech<F>(
    config: DoubaoConfig<'_>,
    text: &str,
    voice_id: &str,
    model: &str,
    prompt: Option<&str>,
    mut on_event: F,
) -> Result<(), String>
where
    F: FnMut(DoubaoAudioStreamEvent) -> Result<(), String>,
{
    let speaker = voice_id.trim();
    if speaker.is_empty() {
        return Err(crate::utils::err_msg(
            module_path!(),
            line!(),
            "Doubao TTS requires a voice id",
        ));
    }

    let resource_id = resolve_resource_id(config.resource_id, model);
    let mut options = DoubaoPromptOptions::from_prompt(prompt)?;
    options.force_stream_pcm();
    let mut additions_map = options.additions.unwrap_or_default();
    additions_map
        .entry("max_length_to_filter_parenthesis".to_string())
        .or_insert_with(|| serde_json::Value::from(100));
    let additions = Some(
        serde_json::to_string(&additions_map)
            .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?,
    );

    let request = TtsRequest {
        user: TtsUser { uid: "lettuceai" },
        req_params: TtsReqParams {
            text,
            speaker,
            audio_params: TtsAudioParams {
                format: &options.format,
                sample_rate: options.sample_rate,
                bit_rate: options.bit_rate,
                emotion: options.emotion.as_deref(),
                emotion_scale: options.emotion_scale,
                speech_rate: options.speech_rate,
                loudness_rate: options.loudness_rate,
                enable_subtitle: options.enable_subtitle,
            },
            additions,
        },
    };

    let url = format!(
        "{}{}",
        normalize_base_url(config.base_url),
        normalize_request_path(config.request_path)
    );
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("X-Api-Key", config.api_key)
        .header("X-Api-Resource-Id", resource_id)
        .header("X-Api-Request-Id", uuid::Uuid::new_v4().to_string())
        .header(CONTENT_TYPE, "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            crate::utils::err_msg(module_path!(), line!(), format!("Request failed: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let log_id = response
            .headers()
            .get("X-Tt-Logid")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(crate::utils::err_msg(
            module_path!(),
            line!(),
            format!(
                "Doubao TTS error ({}){}: {}",
                status,
                format_log_id(&log_id),
                body
            ),
        ));
    }

    on_event(DoubaoAudioStreamEvent::Start(DoubaoStreamInfo {
        format: options.format.clone(),
        sample_rate: options.sample_rate,
        mime_type: mime_for_format(&options.format).to_string(),
    }))?;

    let mut emitted_audio = false;
    let mut buffer = String::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            crate::utils::err_msg(
                module_path!(),
                line!(),
                format!("Failed to read Doubao TTS stream: {}", e),
            )
        })?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(json) = pop_next_json_object(&mut buffer) {
            if let Some(audio) = decode_tts_stream_message(&json)? {
                emitted_audio = true;
                on_event(DoubaoAudioStreamEvent::Chunk(audio))?;
            }
        }
    }
    while let Some(json) = pop_next_json_object(&mut buffer) {
        if let Some(audio) = decode_tts_stream_message(&json)? {
            emitted_audio = true;
            on_event(DoubaoAudioStreamEvent::Chunk(audio))?;
        }
    }

    if !emitted_audio {
        return Err(crate::utils::err_msg(
            module_path!(),
            line!(),
            "Doubao TTS returned no audio data",
        ));
    }

    on_event(DoubaoAudioStreamEvent::End)?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "PascalCase")]
struct ListSpeakersRequest<'a> {
    #[serde(rename = "ResourceIDs")]
    resource_ids: Vec<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "VoiceTypes")]
    voice_types: Option<Vec<&'a str>>,
    #[serde(rename = "Page")]
    page: u32,
    #[serde(rename = "Limit")]
    limit: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ListSpeakersResponse {
    #[serde(default)]
    response_metadata: Option<ResponseMetadata>,
    #[serde(default)]
    result: Option<ListSpeakersResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ResponseMetadata {
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    error: Option<OpenApiError>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct OpenApiError {
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ListSpeakersResult {
    #[serde(default)]
    total: u32,
    #[serde(default, deserialize_with = "null_as_default")]
    speakers: Vec<DoubaoSpeaker>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DoubaoSpeaker {
    voice_type: String,
    name: String,
    #[serde(default)]
    avatar: Option<String>,
    #[serde(default)]
    gender: Option<String>,
    #[serde(default)]
    age: Option<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    categories: Vec<DoubaoCategory>,
    #[serde(default, deserialize_with = "null_as_default")]
    normal_labels: Vec<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    special_labels: Vec<String>,
    #[serde(default)]
    trial_url: Option<String>,
    #[serde(default)]
    short_trial_url: Option<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    languages: Vec<DoubaoLanguage>,
    #[serde(default, deserialize_with = "null_as_default")]
    emotions: Vec<DoubaoEmotion>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    resource_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DoubaoCategory {
    #[serde(default, deserialize_with = "null_as_default")]
    categories: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DoubaoLanguage {
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    flag: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DoubaoEmotion {
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    value: Option<String>,
}

fn null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

pub async fn fetch_voices(config: DoubaoConfig<'_>) -> Result<Vec<ProviderVoice>, String> {
    let access_key = config
        .openapi_access_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            crate::utils::err_msg(
                module_path!(),
                line!(),
                "Doubao voice list requires Volcengine Access Key ID",
            )
        })?;
    let secret_key = config
        .openapi_secret_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            crate::utils::err_msg(
                module_path!(),
                line!(),
                "Doubao voice list requires Volcengine Secret Access Key",
            )
        })?;
    let resource_id = resolve_resource_id(config.resource_id, "");

    let mut page = 1;
    let limit = 100;
    let mut voices = Vec::new();
    loop {
        let request = ListSpeakersRequest {
            resource_ids: vec![resource_id],
            voice_types: None,
            page,
            limit,
        };
        let body = serde_json::to_string(&request)
            .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?;
        let response = signed_openapi_post(access_key, secret_key, body).await?;

        let result = response.result.ok_or_else(|| {
            let meta = response.response_metadata.as_ref();
            let detail = meta
                .and_then(|m| m.error.as_ref())
                .map(|e| {
                    format!(
                        "{}: {}",
                        e.code.as_deref().unwrap_or("Unknown"),
                        e.message.as_deref().unwrap_or("Unknown error")
                    )
                })
                .unwrap_or_else(|| "Missing Result".to_string());
            let request_id = meta
                .and_then(|m| m.request_id.as_deref())
                .map(|id| format!(" request_id={}", id))
                .unwrap_or_default();
            crate::utils::err_msg(
                module_path!(),
                line!(),
                format!("Doubao ListSpeakers error: {}{}", detail, request_id),
            )
        })?;

        let total = result.total;
        voices.extend(result.speakers.into_iter().map(provider_voice_from_speaker));
        if voices.len() >= total as usize || total == 0 {
            break;
        }
        page += 1;
    }

    Ok(voices)
}

pub async fn verify_api_key(config: DoubaoConfig<'_>) -> Result<bool, String> {
    Ok(
        !config.api_key.trim().is_empty()
            && !resolve_resource_id(config.resource_id, "").is_empty(),
    )
}

async fn signed_openapi_post(
    access_key: &str,
    secret_key: &str,
    body: String,
) -> Result<ListSpeakersResponse, String> {
    let now = Utc::now();
    let x_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let short_date = now.format("%Y%m%d").to_string();
    let body_hash = sha256_hex(body.as_bytes());
    let canonical_query = format!("Action={}&Version={}", OPENAPI_ACTION, OPENAPI_VERSION);
    let canonical_headers = format!(
        "host:{}\nx-content-sha256:{}\nx-date:{}\n",
        OPENAPI_HOST, body_hash, x_date
    );
    let signed_headers = "host;x-content-sha256;x-date";
    let canonical_request = format!(
        "POST\n/\n{}\n{}\n{}\n{}",
        canonical_query, canonical_headers, signed_headers, body_hash
    );
    let credential_scope = format!(
        "{}/{}/{}/request",
        short_date, OPENAPI_REGION, OPENAPI_SERVICE
    );
    let string_to_sign = format!(
        "HMAC-SHA256\n{}\n{}\n{}",
        x_date,
        credential_scope,
        sha256_hex(canonical_request.as_bytes())
    );
    let signing_key = volcengine_signing_key(secret_key, &short_date)?;
    let signature = hmac_hex(&signing_key, string_to_sign.as_bytes())?;
    let authorization = format!(
        "HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        access_key, credential_scope, signed_headers, signature
    );
    let url = format!("https://{}/?{}", OPENAPI_HOST, canonical_query);
    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header(HOST, OPENAPI_HOST)
        .header(CONTENT_TYPE, "application/json; charset=UTF-8")
        .header("X-Date", x_date)
        .header("X-Content-Sha256", body_hash)
        .header("Authorization", authorization)
        .body(body)
        .send()
        .await
        .map_err(|e| {
            crate::utils::err_msg(module_path!(), line!(), format!("Request failed: {}", e))
        })?;

    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(crate::utils::err_msg(
            module_path!(),
            line!(),
            format!("Doubao ListSpeakers HTTP error ({}): {}", status, text),
        ));
    }

    serde_json::from_str(&text).map_err(|e| {
        crate::utils::err_msg(
            module_path!(),
            line!(),
            format!("Failed to parse Doubao ListSpeakers response: {}", e),
        )
    })
}

fn handle_tts_stream_message(json: &str, audio: &mut Vec<u8>) -> Result<(), String> {
    if let Some(mut decoded) = decode_tts_stream_message(json)? {
        audio.append(&mut decoded);
    }
    Ok(())
}

fn decode_tts_stream_message(json: &str) -> Result<Option<Vec<u8>>, String> {
    let message: TtsStreamMessage = serde_json::from_str(json).map_err(|e| {
        crate::utils::err_msg(
            module_path!(),
            line!(),
            format!("Failed to parse Doubao TTS stream JSON: {}", e),
        )
    })?;
    if message.code == 0 {
        if let Some(data) = message.data.as_deref().filter(|value| !value.is_empty()) {
            let decoded = STANDARD.decode(data).map_err(|e| {
                crate::utils::err_msg(
                    module_path!(),
                    line!(),
                    format!("Failed to decode Doubao TTS audio chunk: {}", e),
                )
            })?;
            return Ok(Some(decoded));
        }
        return Ok(None);
    }
    if message.code == 20000000 {
        return Ok(None);
    }

    Err(crate::utils::err_msg(
        module_path!(),
        line!(),
        format!(
            "Doubao TTS stream error {}: {}",
            message.code, message.message
        ),
    ))
}

fn pop_next_json_object(buffer: &mut String) -> Option<String> {
    let mut start = None;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (index, ch) in buffer.char_indices() {
        if start.is_none() {
            if ch == '{' {
                start = Some(index);
                depth = 1;
            }
            continue;
        }

        if escaped {
            escaped = false;
            continue;
        }
        if in_string {
            if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    let start = start.unwrap_or(0);
                    let end = index + ch.len_utf8();
                    let json = buffer[start..end].to_string();
                    buffer.replace_range(..end, "");
                    return Some(json);
                }
            }
            _ => {}
        }
    }
    if let Some(start) = start {
        if start > 0 {
            buffer.replace_range(..start, "");
        }
    }
    None
}

fn provider_voice_from_speaker(speaker: DoubaoSpeaker) -> ProviderVoice {
    let mut labels = HashMap::new();
    insert_label(&mut labels, "gender", speaker.gender);
    insert_label(&mut labels, "age", speaker.age);
    insert_label(&mut labels, "avatar", speaker.avatar);
    insert_label(&mut labels, "shortTrialUrl", speaker.short_trial_url);
    insert_label(&mut labels, "description", speaker.description);
    insert_label(&mut labels, "resourceId", speaker.resource_id);
    if !speaker.normal_labels.is_empty() {
        labels.insert("normalLabels".to_string(), speaker.normal_labels.join(", "));
    }
    if !speaker.special_labels.is_empty() {
        labels.insert(
            "specialLabels".to_string(),
            speaker.special_labels.join(", "),
        );
    }
    let categories: Vec<String> = speaker
        .categories
        .into_iter()
        .flat_map(|entry| entry.categories)
        .collect();
    if !categories.is_empty() {
        labels.insert("categories".to_string(), categories.join(", "));
    }
    let languages: Vec<String> = speaker
        .languages
        .iter()
        .filter_map(|entry| entry.language.clone())
        .collect();
    if !languages.is_empty() {
        labels.insert("languages".to_string(), languages.join(", "));
    }
    let preview_texts: Vec<String> = speaker
        .languages
        .iter()
        .filter_map(|entry| entry.text.clone())
        .collect();
    if let Some(text) = preview_texts.first() {
        labels.insert("previewText".to_string(), text.clone());
    }
    let flags: Vec<String> = speaker
        .languages
        .iter()
        .filter_map(|entry| entry.flag.clone())
        .collect();
    if !flags.is_empty() {
        labels.insert("flags".to_string(), flags.join(" "));
    }
    let emotions: Vec<String> = speaker
        .emotions
        .iter()
        .filter_map(|entry| match (&entry.label, &entry.value) {
            (Some(label), Some(value)) => Some(format!("{}:{}", label, value)),
            (Some(label), None) => Some(label.clone()),
            (None, Some(value)) => Some(value.clone()),
            (None, None) => None,
        })
        .collect();
    if !emotions.is_empty() {
        labels.insert("emotions".to_string(), emotions.join(", "));
    }
    labels.insert("category".to_string(), "library".to_string());
    labels.insert("engine".to_string(), "doubao".to_string());

    ProviderVoice {
        voice_id: speaker.voice_type,
        name: speaker.name,
        preview_url: speaker.trial_url,
        labels,
    }
}

fn resolve_resource_id<'a>(configured: Option<&'a str>, model: &'a str) -> &'a str {
    configured
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "us-central1")
        .or_else(|| {
            let model = model.trim();
            if model.is_empty() {
                None
            } else {
                Some(model)
            }
        })
        .unwrap_or("seed-tts-2.0")
}

fn normalize_base_url(base_url: Option<&str>) -> String {
    base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_TTS_BASE_URL)
        .trim_end_matches('/')
        .to_string()
}

fn normalize_request_path(request_path: Option<&str>) -> String {
    let trimmed = request_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(TTS_REQUEST_PATH);
    if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{}", trimmed)
    }
}

fn copy_json_field(
    source: &serde_json::Value,
    target: &mut serde_json::Map<String, serde_json::Value>,
    source_key: &str,
    target_key: &str,
) {
    if let Some(value) = source.get(source_key) {
        target.insert(target_key.to_string(), value.clone());
    }
}

fn non_empty_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn clamp_u32(value: u64, min: u32, max: u32) -> u32 {
    (value as u32).clamp(min, max)
}

fn mime_for_format(format: &str) -> &'static str {
    match format {
        "ogg_opus" => "audio/ogg",
        "pcm" => "audio/pcm",
        _ => "audio/mpeg",
    }
}

fn insert_label(labels: &mut HashMap<String, String>, key: &str, value: Option<String>) {
    if let Some(value) = value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        labels.insert(key.to_string(), value);
    }
}

fn format_log_id(log_id: &str) -> String {
    if log_id.trim().is_empty() {
        String::new()
    } else {
        format!(" [logid={}]", log_id)
    }
}

fn sha256_hex(data: &[u8]) -> String {
    hex_lower(Sha256::digest(data).as_slice())
}

fn volcengine_signing_key(secret_key: &str, short_date: &str) -> Result<Vec<u8>, String> {
    let k_date = hmac_bytes(secret_key.as_bytes(), short_date.as_bytes())?;
    let k_region = hmac_bytes(&k_date, OPENAPI_REGION.as_bytes())?;
    let k_service = hmac_bytes(&k_region, OPENAPI_SERVICE.as_bytes())?;
    hmac_bytes(&k_service, b"request")
}

fn hmac_bytes(key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    let mut mac = HmacSha256::new_from_slice(key)
        .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?;
    mac.update(data);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn hmac_hex(key: &[u8], data: &[u8]) -> Result<String, String> {
    hmac_bytes(key, data).map(|bytes| hex_lower(&bytes))
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}
