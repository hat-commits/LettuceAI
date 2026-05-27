//! Gathered from inline tests in src/storage_manager/entity_transfer/mod.rs.

use lettuceai_lib::storage_manager::entity_transfer::{
    normalize_uec_for_read, parse_uec_character, stringify_v2_uec,
    UEC_SCHEMA_VERSION as SCHEMA_VERSION, UEC_SCHEMA_VERSION_V2 as SCHEMA_VERSION_V2,
};
use serde_json::{json, Map as JsonMap, Value as JsonValue};
use unified_entity_card::{create_character_uec, UecKind};

#[test]
fn normalize_uec_for_read_accepts_v1_schema() {
    let card = json!({
        "schema": { "name": "UEC", "version": SCHEMA_VERSION },
        "kind": "character",
        "payload": {
            "id": "char-v1",
            "name": "Aster Vale"
        }
    });

    let parsed = normalize_uec_for_read(&card, false).expect("v1 UEC should be readable");
    assert_eq!(parsed.kind, UecKind::Character);
    assert_eq!(parsed.schema.version, SCHEMA_VERSION);
}

#[test]
fn normalize_uec_for_read_downgrades_v2_schema_for_legacy_parser() {
    let card = json!({
        "schema": {
            "name": "UEC",
            "version": SCHEMA_VERSION_V2
        },
        "kind": "character",
        "payload": {
            "id": "char-v2",
            "name": "Aster Vale",
            "scene": {
                "id": "scene-1",
                "content": "Hello there",
                "selectedVariant": 0,
                "variants": []
            }
        },
        "meta": {
            "originalCreatedAt": 1,
            "originalUpdatedAt": 2
        }
    });

    let parsed = normalize_uec_for_read(&card, false).expect("v2 UEC should be readable");
    assert_eq!(parsed.kind, UecKind::Character);
    assert_eq!(parsed.schema.version, SCHEMA_VERSION);
    let payload = parsed.payload.as_object().expect("payload object");
    assert!(payload.get("scenes").is_some());
    assert!(payload.get("scene").is_none());
}

#[test]
fn stringify_v2_uec_upgrades_v1_schema_to_v2() {
    let mut payload = JsonMap::new();
    payload.insert("id".into(), JsonValue::String("char-1".to_string()));
    payload.insert("name".into(), JsonValue::String("Aster Vale".to_string()));
    payload.insert(
        "avatar".into(),
        JsonValue::String("data:image/webp;base64,QUJD".to_string()),
    );
    payload.insert(
        "chatBackground".into(),
        JsonValue::String("https://example.com/bg.png".to_string()),
    );
    payload.insert(
        "scenes".into(),
        JsonValue::Array(vec![json!({
            "id": "scene-1",
            "content": "Hello there",
            "selectedVariantId": null,
            "variants": []
        })]),
    );
    payload.insert(
        "defaultSceneId".into(),
        JsonValue::String("scene-1".to_string()),
    );
    payload.insert("createdAt".into(), JsonValue::from(1));
    payload.insert("updatedAt".into(), JsonValue::from(2));

    let v1 = create_character_uec(
        payload,
        false,
        None,
        None,
        Some(json!({ "createdAt": 1, "updatedAt": 2, "source": "lettuceai" })),
        None,
    );
    let value: JsonValue =
        serde_json::from_str(&stringify_v2_uec(&v1).expect("v2 json")).expect("valid json");
    let schema = value
        .get("schema")
        .and_then(|schema| schema.as_object())
        .expect("schema object");

    assert_eq!(
        schema.get("version").and_then(|value| value.as_str()),
        Some(SCHEMA_VERSION_V2)
    );
    let payload = value
        .get("payload")
        .and_then(|payload| payload.as_object())
        .expect("payload object");
    assert!(payload.get("scene").is_some());
    assert!(payload.get("scenes").is_none());
    assert_eq!(
        payload
            .get("avatar")
            .and_then(|avatar| avatar.get("type"))
            .and_then(|value| value.as_str()),
        Some("inline_base64")
    );
    assert_eq!(
        payload
            .get("chatBackground")
            .and_then(|background| background.get("type"))
            .and_then(|value| value.as_str()),
        Some("remote_url")
    );
}

#[test]
fn stringify_v2_uec_preserves_scene_variants_and_selected_id() {
    let mut payload = JsonMap::new();
    payload.insert("id".into(), JsonValue::String("char-1".to_string()));
    payload.insert("name".into(), JsonValue::String("Aster Vale".to_string()));
    payload.insert(
        "scenes".into(),
        JsonValue::Array(vec![json!({
            "id": "scene-1",
            "content": "Hello there",
            "selectedVariantId": "variant-2",
            "variants": [
                {
                    "id": "variant-1",
                    "content": "Variant one",
                    "createdAt": 10
                },
                {
                    "id": "variant-2",
                    "content": "Variant two",
                    "direction": "Second",
                    "createdAt": 20
                }
            ]
        })]),
    );
    payload.insert(
        "defaultSceneId".into(),
        JsonValue::String("scene-1".to_string()),
    );
    payload.insert("createdAt".into(), JsonValue::from(1));
    payload.insert("updatedAt".into(), JsonValue::from(2));

    let v1 = create_character_uec(
        payload,
        false,
        None,
        None,
        Some(json!({ "createdAt": 1, "updatedAt": 2, "source": "lettuceai" })),
        None,
    );

    let value: JsonValue =
        serde_json::from_str(&stringify_v2_uec(&v1).expect("v2 json")).expect("valid json");
    let scene = value
        .get("payload")
        .and_then(|payload| payload.get("scene"))
        .and_then(JsonValue::as_object)
        .expect("scene object");

    assert_eq!(
        scene.get("selectedVariant").and_then(JsonValue::as_str),
        Some("variant-2")
    );
    let variants = scene
        .get("variants")
        .and_then(JsonValue::as_array)
        .expect("variants array");
    assert_eq!(variants.len(), 2);
    assert_eq!(
        variants[1].get("id").and_then(JsonValue::as_str),
        Some("variant-2")
    );
    assert_eq!(
        variants[1].get("direction").and_then(JsonValue::as_str),
        Some("Second")
    );
}

#[test]
fn stringify_v2_uec_flattens_additional_scenes_into_variants() {
    let mut payload = JsonMap::new();
    payload.insert("id".into(), JsonValue::String("char-1".to_string()));
    payload.insert("name".into(), JsonValue::String("Aster Vale".to_string()));
    payload.insert(
        "scenes".into(),
        JsonValue::Array(vec![
            json!({
                "id": "scene-1",
                "content": "Primary scene",
                "selectedVariantId": null,
                "variants": []
            }),
            json!({
                "id": "scene-2",
                "content": "Second scene",
                "direction": "alt",
                "createdAt": 20,
                "selectedVariantId": null,
                "variants": []
            }),
            json!({
                "id": "scene-3",
                "content": "Third scene",
                "createdAt": 30,
                "selectedVariantId": null,
                "variants": []
            }),
        ]),
    );
    payload.insert(
        "defaultSceneId".into(),
        JsonValue::String("scene-1".to_string()),
    );
    payload.insert("createdAt".into(), JsonValue::from(1));
    payload.insert("updatedAt".into(), JsonValue::from(2));

    let v1 = create_character_uec(
        payload,
        false,
        None,
        None,
        Some(json!({ "createdAt": 1, "updatedAt": 2, "source": "lettuceai" })),
        None,
    );

    let value: JsonValue =
        serde_json::from_str(&stringify_v2_uec(&v1).expect("v2 json")).expect("valid json");
    let scene = value
        .get("payload")
        .and_then(|payload| payload.get("scene"))
        .and_then(JsonValue::as_object)
        .expect("scene object");
    let variants = scene
        .get("variants")
        .and_then(JsonValue::as_array)
        .expect("variants array");

    assert_eq!(variants.len(), 2);
    assert_eq!(
        variants[0].get("id").and_then(JsonValue::as_str),
        Some("scene-2")
    );
    assert_eq!(
        variants[1].get("id").and_then(JsonValue::as_str),
        Some("scene-3")
    );
}

#[test]
fn parse_uec_character_reads_v2_asset_locators() {
    let card = json!({
        "schema": { "name": "UEC", "version": SCHEMA_VERSION_V2 },
        "kind": "character",
        "payload": {
            "id": "char-v2",
            "name": "Aster Vale",
            "avatar": {
                "type": "inline_base64",
                "mimeType": "image/webp",
                "data": "QUJD"
            },
            "chatBackground": {
                "type": "remote_url",
                "url": "https://example.com/bg.png"
            },
            "scene": {
                "id": "scene-1",
                "content": "Hello there",
                "selectedVariant": 0,
                "variants": []
            }
        },
        "meta": {
            "createdAt": 1,
            "updatedAt": 2,
            "originalCreatedAt": 1,
            "originalUpdatedAt": 2
        }
    });

    let package = parse_uec_character(&card).expect("v2 character should parse");
    assert_eq!(
        package.avatar_data.as_deref(),
        Some("data:image/webp;base64,QUJD")
    );
    assert_eq!(
        package.background_image_data.as_deref(),
        Some("https://example.com/bg.png")
    );
}

#[test]
fn parse_uec_character_expands_v2_scene_variants_into_scenes() {
    let card = json!({
        "schema": { "name": "UEC", "version": SCHEMA_VERSION_V2 },
        "kind": "character",
        "payload": {
            "id": "char-v2",
            "name": "Aster Vale",
            "scene": {
                "id": "scene-1",
                "content": "Primary scene",
                "selectedVariant": "scene-3",
                "variants": [
                    {
                        "id": "scene-2",
                        "content": "Second scene",
                        "direction": "Alt two",
                        "createdAt": 20
                    },
                    {
                        "id": "scene-3",
                        "content": "Third scene",
                        "createdAt": 30
                    }
                ]
            }
        },
        "meta": {
            "createdAt": 1,
            "updatedAt": 2,
            "originalCreatedAt": 1,
            "originalUpdatedAt": 2
        }
    });

    let package = parse_uec_character(&card).expect("v2 character should parse");
    assert_eq!(package.character.scenes.len(), 3);
    assert_eq!(package.character.scenes[0].id, "scene-1");
    assert_eq!(package.character.scenes[1].id, "scene-2");
    assert_eq!(package.character.scenes[2].id, "scene-3");
    assert_eq!(
        package.character.default_scene_id.as_deref(),
        Some("scene-3")
    );
}
