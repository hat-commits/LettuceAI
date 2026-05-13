use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;

use super::db::{now_ms, open_db, SwappablePool};

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JsonlImportOptions {
    pub target_character_id: Option<String>,
    pub participant_character_map: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JsonlInspectParticipant {
    name: String,
    message_count: i64,
}

fn get_downloads_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        Ok(PathBuf::from("/storage/emulated/0/Download"))
    }

    #[cfg(not(target_os = "android"))]
    {
        dirs::download_dir().ok_or_else(|| "Could not find Downloads directory".to_string())
    }
}

fn sanitize_filename(input: &str) -> String {
    let s = input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    let s = s.trim_matches('_').to_lowercase();
    if s.is_empty() {
        "chat".to_string()
    } else {
        s
    }
}

fn send_date(created_at_ms: i64) -> String {
    Utc.timestamp_millis_opt(created_at_ms)
        .single()
        .unwrap_or_else(Utc::now)
        .format("%Y-%m-%dT%H:%M:%S%.3f")
        .to_string()
}

fn parse_created_at(value: Option<&JsonValue>) -> Option<i64> {
    let raw = value?;
    if let Some(v) = raw.as_i64() {
        return Some(if v < 10_000_000_000 { v * 1000 } else { v });
    }
    if let Some(s) = raw.as_str() {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            return None;
        }
        if let Ok(v) = trimmed.parse::<i64>() {
            return Some(if v < 10_000_000_000 { v * 1000 } else { v });
        }
        if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
            return Some(dt.timestamp_millis());
        }
        if let Ok(dt) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S%.f") {
            return Some(dt.and_utc().timestamp_millis());
        }
        if let Ok(dt) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S%.f") {
            return Some(dt.and_utc().timestamp_millis());
        }
    }
    None
}

fn pick_message_content(message: &JsonValue) -> String {
    if let Some(content) = message.get("content").and_then(|v| v.as_str()) {
        return content.to_string();
    }
    if let Some(variants) = message.get("variants").and_then(|v| v.as_array()) {
        if let Some(selected_id) = message.get("selectedVariantId").and_then(|v| v.as_str()) {
            if let Some(selected) = variants
                .iter()
                .find(|variant| variant.get("id").and_then(|v| v.as_str()) == Some(selected_id))
            {
                if let Some(content) = selected.get("content").and_then(|v| v.as_str()) {
                    return content.to_string();
                }
            }
        }
        if let Some(first) = variants.first() {
            if let Some(content) = first.get("content").and_then(|v| v.as_str()) {
                return content.to_string();
            }
        }
    }
    String::new()
}

// ------------------- Export: single chat -------------------

#[tauri::command]
pub fn jsonl_export_single_chat(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<String, String> {
    let session_json = super::sessions::session_get(app.clone(), session_id)?
        .ok_or_else(|| crate::utils::err_msg(module_path!(), line!(), "Session not found"))?;
    let session: JsonValue = serde_json::from_str(&session_json)
        .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?;

    let title = session
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("chat");
    let character_id = session.get("characterId").and_then(|v| v.as_str());
    let persona_id = session.get("personaId").and_then(|v| v.as_str());
    let messages = session
        .get("messages")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let conn = open_db(&app)?;
    let character_name = match character_id {
        Some(cid) => conn
            .query_row(
                "SELECT name FROM characters WHERE id = ?1",
                params![cid],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?
            .unwrap_or_else(|| "Character".to_string()),
        None => "Character".to_string(),
    };
    let user_name = match persona_id {
        Some(pid) => conn
            .query_row(
                "SELECT title FROM personas WHERE id = ?1",
                params![pid],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?
            .unwrap_or_else(|| "User".to_string()),
        None => "User".to_string(),
    };

    let first_created_at = messages
        .first()
        .and_then(|v| v.get("createdAt"))
        .and_then(|v| v.as_i64())
        .unwrap_or_else(|| now_ms() as i64);

    let mut lines: Vec<String> = Vec::with_capacity(messages.len() + 1);
    let metadata = json!({
        "user_name": user_name,
        "character_name": character_name,
        "create_date": send_date(first_created_at),
        "chat_metadata": {},
    });
    lines.push(serde_json::to_string(&metadata).unwrap());

    for message in messages {
        let role = message
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or("assistant");
        let created_at = message
            .get("createdAt")
            .and_then(|v| v.as_i64())
            .unwrap_or_else(|| now_ms() as i64);
        let content = pick_message_content(&message);
        if content.trim().is_empty() {
            continue;
        }

        let (name, is_user, is_system) = match role {
            "user" => (user_name.as_str(), true, false),
            "system" => ("System", false, true),
            _ => (character_name.as_str(), false, false),
        };
        let line = json!({
            "name": name,
            "is_user": is_user,
            "is_system": is_system,
            "send_date": send_date(created_at),
            "mes": content,
            "extra": {},
            "original_avatar": "",
        });
        lines.push(serde_json::to_string(&line).unwrap());
    }

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("chat_{}_{}.jsonl", sanitize_filename(title), timestamp);
    let output_path = get_downloads_dir()?.join(filename);
    fs::write(&output_path, lines.join("\n"))
        .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?;
    Ok(output_path.to_string_lossy().to_string())
}

// ------------------- Export: group chat -------------------

#[tauri::command]
pub fn jsonl_export_group_chat(
    session_id: String,
    pool: State<'_, SwappablePool>,
) -> Result<String, String> {
    let conn = pool.get_connection()?;

    let (title, persona_id) = conn
        .query_row(
            "SELECT name, persona_id FROM group_sessions WHERE id = ?1",
            params![&session_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?
        .ok_or_else(|| crate::utils::err_msg(module_path!(), line!(), "Session not found"))?;

    let user_name = match persona_id.as_deref() {
        Some(pid) => conn
            .query_row(
                "SELECT title FROM personas WHERE id = ?1",
                params![pid],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?
            .unwrap_or_else(|| "User".to_string()),
        None => "User".to_string(),
    };

    // Preload character_id -> display name so each line carries the speaker's name.
    let mut char_name_stmt = conn
        .prepare("SELECT id, name FROM characters")
        .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?;
    let char_name_rows = char_name_stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?;
    let mut char_names: HashMap<String, String> = HashMap::new();
    for row in char_name_rows {
        let (id, name) = row.map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?;
        char_names.insert(id, name);
    }

    let mut msg_stmt = conn
        .prepare(
            "SELECT role, content, speaker_character_id, created_at, selected_variant_id
             FROM group_messages WHERE session_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?;

    let msg_rows = msg_stmt
        .query_map(params![&session_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?;

    let mut messages: Vec<(String, String, Option<String>, i64, Option<String>)> = Vec::new();
    for row in msg_rows {
        messages.push(row.map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?);
    }

    let first_created_at = messages
        .first()
        .map(|m| m.3)
        .unwrap_or_else(|| now_ms() as i64);

    let mut lines: Vec<String> = Vec::with_capacity(messages.len() + 1);
    let metadata = json!({
        "user_name": user_name,
        "character_name": title,
        "create_date": send_date(first_created_at),
        "chat_metadata": { "group": true },
    });
    lines.push(serde_json::to_string(&metadata).unwrap());

    for (role, content_db, speaker_character_id, created_at, selected_variant_id) in messages {
        // Resolve content: prefer selected variant.
        let content = if let Some(vid) = selected_variant_id.as_deref() {
            conn.query_row(
                "SELECT content FROM group_message_variants WHERE id = ?1",
                params![vid],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?
            .unwrap_or(content_db)
        } else {
            content_db
        };

        if content.trim().is_empty() {
            continue;
        }

        let (name, is_user, is_system) = match role.as_str() {
            "user" => (user_name.clone(), true, false),
            "system" => ("System".to_string(), false, true),
            _ => {
                let speaker = speaker_character_id
                    .as_deref()
                    .and_then(|id| char_names.get(id).cloned())
                    .unwrap_or_else(|| "Character".to_string());
                (speaker, false, false)
            }
        };

        let line = json!({
            "name": name,
            "is_user": is_user,
            "is_system": is_system,
            "send_date": send_date(created_at),
            "mes": content,
            "extra": {},
            "original_avatar": "",
        });
        lines.push(serde_json::to_string(&line).unwrap());
    }

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!(
        "group_chat_{}_{}.jsonl",
        sanitize_filename(&title),
        timestamp
    );
    let output_path = get_downloads_dir()?.join(filename);
    fs::write(&output_path, lines.join("\n"))
        .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?;
    Ok(output_path.to_string_lossy().to_string())
}

// ------------------- Read / parse -------------------

struct ParsedJsonl {
    metadata: Option<JsonValue>,
    messages: Vec<JsonValue>,
}

fn read_jsonl(path: &str) -> Result<ParsedJsonl, String> {
    let raw = fs::read_to_string(path)
        .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?;
    let mut entries: Vec<JsonValue> = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: JsonValue = serde_json::from_str(trimmed)
            .map_err(|_| crate::utils::err_msg(module_path!(), line!(), "JSONL_INVALID_LINE"))?;
        entries.push(parsed);
    }
    if entries.is_empty() {
        return Err(crate::utils::err_msg(
            module_path!(),
            line!(),
            "JSONL_EMPTY",
        ));
    }

    // First entry is metadata iff it has no `mes` and has user/character markers.
    let first_is_metadata = {
        let first = &entries[0];
        first.get("mes").is_none()
            && (first.get("user_name").is_some()
                || first.get("character_name").is_some()
                || first.get("chat_metadata").is_some())
    };

    let (metadata, messages) = if first_is_metadata {
        let metadata = Some(entries.remove(0));
        (metadata, entries)
    } else {
        (None, entries)
    };

    Ok(ParsedJsonl { metadata, messages })
}

fn message_role(entry: &JsonValue) -> &'static str {
    if entry
        .get("is_system")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        "system"
    } else if entry
        .get("is_user")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        "user"
    } else {
        "assistant"
    }
}

fn message_text(entry: &JsonValue) -> Option<String> {
    for key in ["mes", "content", "text", "message"] {
        if let Some(value) = entry.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn message_created_at(entry: &JsonValue) -> i64 {
    for key in ["send_date", "createdAt", "timestamp", "time"] {
        if let Some(v) = parse_created_at(entry.get(key)) {
            return v;
        }
    }
    now_ms() as i64
}

// ------------------- Inspect -------------------

#[tauri::command]
pub fn jsonl_inspect(path: String) -> Result<String, String> {
    let parsed = read_jsonl(&path)?;

    let title = parsed
        .metadata
        .as_ref()
        .and_then(|m| m.get("character_name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            std::path::Path::new(&path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Imported Chat")
                .to_string()
        });

    // Group inspect: count messages per non-user, non-system `name`.
    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    for entry in &parsed.messages {
        let role = message_role(entry);
        if role != "assistant" {
            continue;
        }
        let name = entry
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Character")
            .to_string();
        *counts.entry(name).or_insert(0) += 1;
    }

    let participants: Vec<JsonlInspectParticipant> = counts
        .into_iter()
        .map(|(name, message_count)| JsonlInspectParticipant {
            name,
            message_count,
        })
        .collect();

    let is_group = participants.len() > 1;
    let out = json!({
        "type": if is_group { "group_chat" } else { "single_chat" },
        "title": title,
        "messageCount": parsed.messages.len(),
        "participants": participants,
        "requiresCharacterSelection": !is_group,
        "requiresParticipantMapping": is_group,
    });
    serde_json::to_string(&out)
        .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))
}

// ------------------- Import -------------------

#[tauri::command]
pub fn jsonl_import(
    app: tauri::AppHandle,
    path: String,
    options_json: Option<String>,
    pool: State<'_, SwappablePool>,
) -> Result<String, String> {
    let options: JsonlImportOptions = match options_json {
        Some(raw) => serde_json::from_str(&raw)
            .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?,
        None => JsonlImportOptions::default(),
    };

    let parsed = read_jsonl(&path)?;

    // Determine single vs group from distinct assistant speakers.
    let mut speakers: HashSet<String> = HashSet::new();
    for entry in &parsed.messages {
        if message_role(entry) == "assistant" {
            if let Some(name) = entry.get("name").and_then(|v| v.as_str()) {
                speakers.insert(name.to_string());
            }
        }
    }
    let is_group = speakers.len() > 1;

    if is_group {
        import_group(&parsed, &options, &pool, &speakers)
    } else {
        import_single(&app, &parsed, &options, &path)
    }
}

fn import_single(
    app: &tauri::AppHandle,
    parsed: &ParsedJsonl,
    options: &JsonlImportOptions,
    source_path: &str,
) -> Result<String, String> {
    let target_character_id = options.target_character_id.clone().ok_or_else(|| {
        crate::utils::err_msg(module_path!(), line!(), "TARGET_CHARACTER_REQUIRED")
    })?;

    let new_session_id = Uuid::new_v4().to_string();
    let now = now_ms() as i64;

    let title = parsed
        .metadata
        .as_ref()
        .and_then(|m| m.get("character_name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            std::path::Path::new(source_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Imported Chat")
                .to_string()
        });

    let session = json!({
        "id": new_session_id,
        "characterId": target_character_id,
        "title": title,
        "personaId": JsonValue::Null,
        "archived": false,
        "createdAt": now,
        "updatedAt": now,
        "messages": [],
    });

    super::sessions::session_upsert_meta(
        app.clone(),
        serde_json::to_string(&session)
            .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?,
    )?;

    let mut messages: Vec<JsonValue> = Vec::with_capacity(parsed.messages.len());
    for entry in &parsed.messages {
        let Some(content) = message_text(entry) else {
            continue;
        };
        let role = message_role(entry);
        let created_at = message_created_at(entry);
        messages.push(json!({
            "id": Uuid::new_v4().to_string(),
            "role": role,
            "content": content,
            "createdAt": created_at,
            "attachments": [],
        }));
    }

    super::sessions::messages_upsert_batch(
        app.clone(),
        new_session_id.clone(),
        serde_json::to_string(&messages)
            .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?,
    )?;

    let out = json!({
        "type": "single_chat",
        "sessionId": new_session_id,
        "characterId": target_character_id,
    });
    serde_json::to_string(&out)
        .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))
}

fn import_group(
    parsed: &ParsedJsonl,
    options: &JsonlImportOptions,
    pool: &State<'_, SwappablePool>,
    speakers: &HashSet<String>,
) -> Result<String, String> {
    let map = options
        .participant_character_map
        .clone()
        .unwrap_or_default();

    let conn = pool.get_connection()?;
    let now = now_ms() as i64;

    let mut unresolved: Vec<String> = Vec::new();
    let mut speaker_to_char: HashMap<String, String> = HashMap::new();
    for speaker in speakers {
        let Some(char_id) = map.get(speaker) else {
            unresolved.push(speaker.clone());
            continue;
        };
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM characters WHERE id = ?1",
                params![char_id],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !exists {
            unresolved.push(speaker.clone());
            continue;
        }
        speaker_to_char.insert(speaker.clone(), char_id.clone());
    }

    if !unresolved.is_empty() {
        return Err(crate::utils::err_msg(
            module_path!(),
            line!(),
            format!("UNRESOLVED_PARTICIPANTS:{}", unresolved.join(", ")),
        ));
    }

    let mut unique_character_ids: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    for cid in speaker_to_char.values() {
        if seen.insert(cid.clone()) {
            unique_character_ids.push(cid.clone());
        }
    }

    if unique_character_ids.is_empty() {
        return Err(crate::utils::err_msg(
            module_path!(),
            line!(),
            "GROUP_CHAT_IMPORT_REQUIRES_CHARACTER_MAPPING",
        ));
    }

    let new_session_id = Uuid::new_v4().to_string();
    let title = parsed
        .metadata
        .as_ref()
        .and_then(|m| m.get("character_name"))
        .and_then(|v| v.as_str())
        .unwrap_or("Imported Group Chat");

    let none_str: Option<String> = None;
    conn.execute(
        "INSERT INTO group_sessions (id, name, character_ids, muted_character_ids, persona_id, created_at, updated_at, archived,
         chat_type, starting_scene, background_image_path, memories, memory_embeddings, memory_summary,
         memory_summary_token_count, memory_tool_events, speaker_selection_method)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        params![
            &new_session_id,
            title,
            serde_json::to_string(&unique_character_ids)
                .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?,
            "[]",
            &none_str,
            now,
            now,
            0_i64,
            "conversation",
            &none_str,
            &none_str,
            "[]",
            "[]",
            "",
            0_i64,
            "[]",
            "llm",
        ],
    )
    .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?;

    for cid in &unique_character_ids {
        conn.execute(
            "INSERT INTO group_participation (id, session_id, character_id, speak_count, last_spoke_turn, last_spoke_at)
             VALUES (?1, ?2, ?3, 0, NULL, NULL)",
            params![Uuid::new_v4().to_string(), &new_session_id, cid],
        )
        .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?;
    }

    let mut turn_number: i64 = 0;
    for entry in &parsed.messages {
        let Some(content) = message_text(entry) else {
            continue;
        };
        let role = message_role(entry);
        let created_at = message_created_at(entry);
        let speaker_char_id = if role == "assistant" {
            entry
                .get("name")
                .and_then(|v| v.as_str())
                .and_then(|name| speaker_to_char.get(name).cloned())
        } else {
            None
        };

        turn_number += 1;
        conn.execute(
            "INSERT INTO group_messages (id, session_id, role, content, speaker_character_id, turn_number,
             created_at, prompt_tokens, completion_tokens, total_tokens, selected_variant_id, is_pinned,
             attachments, used_lorebook_entries, reasoning, selection_reasoning, model_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, NULL, NULL, 0, ?7, '[]', NULL, NULL, NULL)",
            params![
                Uuid::new_v4().to_string(),
                &new_session_id,
                role,
                content,
                speaker_char_id,
                turn_number,
                created_at,
            ],
        )
        .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))?;
    }

    let out = json!({
        "type": "group_chat",
        "sessionId": new_session_id,
    });
    serde_json::to_string(&out)
        .map_err(|e| crate::utils::err_to_string(module_path!(), line!(), e))
}
