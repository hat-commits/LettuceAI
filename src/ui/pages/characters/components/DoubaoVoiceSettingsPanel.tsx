import React from "react";
import { Loader2, Play, Square } from "lucide-react";
import {
  generateTtsPreview,
  playAudioFromBase64,
} from "../../../../core/storage/audioProviders";
import type { CharacterVoiceConfig } from "../../../../core/storage/schemas";
import {
  DEFAULT_DOUBAO_VOICE_SETTINGS,
  buildDoubaoVoicePrompt,
  clampDoubaoVoiceSetting,
  normalizeDoubaoVoiceSettings,
  type DoubaoVoiceSettings,
} from "../../../../core/voice/doubaoVoiceSettings";

const DEFAULT_PREVIEW_TEXT = "你好呀，有什么我可以帮你的";

interface DoubaoVoiceSettingsPanelProps {
  settings: CharacterVoiceConfig["doubaoVoiceSettings"] | null | undefined;
  providerId?: string;
  modelId?: string;
  voiceId?: string;
  onChange: (settings: DoubaoVoiceSettings) => void;
  labels: {
    title: string;
    reset: string;
    pitch: string;
    speechRate: string;
    loudnessRate: string;
    previewPlaceholder: string;
    previewPlay: string;
    previewStop: string;
    previewError: string;
  };
}

export function DoubaoVoiceSettingsPanel({
  settings,
  providerId,
  modelId,
  voiceId,
  onChange,
  labels,
}: DoubaoVoiceSettingsPanelProps) {
  const normalized = normalizeDoubaoVoiceSettings(settings);
  const [previewText, setPreviewText] = React.useState("");
  const [playing, setPlaying] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  React.useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const updateSetting = (key: keyof DoubaoVoiceSettings, value: number) => {
    onChange({
      ...normalized,
      [key]: clampDoubaoVoiceSetting(key, value),
    });
  };

  const stopPreview = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
    setLoading(false);
  };

  const playPreview = async () => {
    if (!providerId || !modelId || !voiceId) return;
    stopPreview();
    setError(null);
    setLoading(true);
    try {
      const response = await generateTtsPreview(
        providerId,
        modelId,
        voiceId,
        previewText.trim() || DEFAULT_PREVIEW_TEXT,
        buildDoubaoVoicePrompt(normalized),
      );
      const audio = playAudioFromBase64(response.audioBase64, response.format);
      audioRef.current = audio;
      setPlaying(true);
      audio.onended = () => {
        if (audioRef.current === audio) {
          audioRef.current = null;
          setPlaying(false);
        }
      };
      audio.onerror = () => {
        if (audioRef.current === audio) {
          audioRef.current = null;
          setPlaying(false);
          setError(labels.previewError);
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const sliders = [
    { key: "pitch" as const, label: labels.pitch, min: -12, max: 12 },
    { key: "speechRate" as const, label: labels.speechRate, min: -50, max: 100 },
    { key: "loudnessRate" as const, label: labels.loudnessRate, min: -50, max: 100 },
  ];

  return (
    <div className="space-y-3 rounded-xl border border-fg/10 bg-surface-el/20 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-fg">{labels.title}</p>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_DOUBAO_VOICE_SETTINGS)}
          className="text-xs text-fg/50 underline-offset-2 transition hover:text-fg hover:underline"
        >
          {labels.reset}
        </button>
      </div>

      {sliders.map((item) => (
        <label key={item.key} className="block space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-fg/70">{item.label}</span>
            <span className="tabular-nums text-fg/50">{normalized[item.key]}</span>
          </div>
          <input
            type="range"
            min={item.min}
            max={item.max}
            step={1}
            value={normalized[item.key]}
            onChange={(event) => updateSetting(item.key, Number(event.currentTarget.value))}
            className="h-2 w-full accent-accent"
          />
        </label>
      ))}

      <div className="border-t border-fg/10 pt-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={previewText}
            onChange={(event) => setPreviewText(event.currentTarget.value)}
            placeholder={labels.previewPlaceholder}
            className="min-w-0 flex-1 rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg placeholder-fg/35 focus:border-fg/25 focus:outline-none"
          />
          <button
            type="button"
            onClick={playing || loading ? stopPreview : playPreview}
            disabled={!providerId || !modelId || !voiceId}
            className="inline-flex h-10 min-w-10 items-center justify-center rounded-lg border border-fg/10 bg-fg/5 px-3 text-sm font-medium text-fg/70 transition hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-40"
            title={playing || loading ? labels.previewStop : labels.previewPlay}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : playing ? (
              <Square className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>
        </div>
        {error && <p className="mt-2 text-xs font-medium text-danger">{error}</p>}
      </div>
    </div>
  );
}
