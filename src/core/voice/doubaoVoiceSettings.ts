import type { CharacterVoiceConfig } from "../storage/schemas";

export const DEFAULT_DOUBAO_VOICE_SETTINGS = {
  pitch: 0,
  speechRate: 0,
  loudnessRate: 0,
};

export type DoubaoVoiceSettings = typeof DEFAULT_DOUBAO_VOICE_SETTINGS;

export function clampDoubaoVoiceSetting(
  key: keyof DoubaoVoiceSettings,
  value: number,
): number {
  const min = key === "pitch" ? -12 : -50;
  const max = key === "pitch" ? 12 : 100;
  return Math.trunc(Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0)));
}

export function normalizeDoubaoVoiceSettings(
  settings: CharacterVoiceConfig["doubaoVoiceSettings"] | null | undefined,
): DoubaoVoiceSettings {
  return {
    pitch: clampDoubaoVoiceSetting("pitch", settings?.pitch ?? 0),
    speechRate: clampDoubaoVoiceSetting("speechRate", settings?.speechRate ?? 0),
    loudnessRate: clampDoubaoVoiceSetting("loudnessRate", settings?.loudnessRate ?? 0),
  };
}

export function buildDoubaoVoicePrompt(
  settings: CharacterVoiceConfig["doubaoVoiceSettings"] | null | undefined,
): string | undefined {
  const normalized = normalizeDoubaoVoiceSettings(settings);
  if (
    normalized.pitch === 0 &&
    normalized.speechRate === 0 &&
    normalized.loudnessRate === 0
  ) {
    return undefined;
  }
  return JSON.stringify(normalized);
}
