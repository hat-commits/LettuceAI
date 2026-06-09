import { useCallback, useEffect, useMemo, useState } from "react";
import { Cpu, Download, HardDrive, Loader2, Play, Square } from "lucide-react";
import { listen } from "@tauri-apps/api/event";

import {
  storageBridge,
  type SdcppConfig,
  type SdcppStatus,
} from "../../../core/storage/files";
import {
  addOrUpdateModel,
  addOrUpdateProviderCredential,
  readSettings,
} from "../../../core/storage/repo";
import { cn } from "../../design-tokens";
import { Switch } from "../../components/Switch";
import { toast } from "../../components/toast";

interface ModelFile {
  name: string;
  path: string;
  sizeBytes: string;
}

const BACKEND_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "vulkan", label: "Vulkan" },
  { value: "cuda", label: "CUDA" },
  { value: "rocm", label: "ROCm" },
  { value: "cpu", label: "CPU" },
];

const SDCPP_MODEL_NAME = "sdcpp-local";

function formatBytes(raw: string): string {
  const bytes = Number(raw);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function FileSelect({
  label,
  value,
  files,
  onChange,
}: {
  label: string;
  value: string | null | undefined;
  files: ModelFile[];
  onChange: (path: string | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg/60">{label}</span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className={cn(
          "w-full rounded-lg border border-fg/10 bg-surface px-3 py-2 text-sm text-fg/80",
          "focus:border-accent/40 focus:outline-none",
        )}
      >
        <option value="">None</option>
        {files.map((file) => (
          <option key={file.path} value={file.path}>
            {file.name} {formatBytes(file.sizeBytes) ? `(${formatBytes(file.sizeBytes)})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LocalImageGenSection() {
  const [status, setStatus] = useState<SdcppStatus | null>(null);
  const [config, setConfig] = useState<SdcppConfig | null>(null);
  const [files, setFiles] = useState<ModelFile[]>([]);
  const [downloadBackend, setDownloadBackend] = useState("auto");
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{
    downloaded: number;
    total: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [enabledAsModel, setEnabledAsModel] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextConfig, nextFiles, settings] = await Promise.all([
        storageBridge.sdcppGetStatus(),
        storageBridge.sdcppGetConfig(),
        storageBridge.sdcppListModelFiles(),
        readSettings(),
      ]);
      setStatus(nextStatus);
      setConfig(nextConfig);
      setFiles(nextFiles);
      setEnabledAsModel(settings.models.some((model) => model.providerId === "sdcpp"));
    } catch (err) {
      console.error("Failed to load local image gen state:", err);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unlistenPromises = [
      listen<{ phase: string; detail?: string }>("sdcpp_status", (event) => {
        setPhase(event.payload.phase);
        if (["ready", "stopped", "error", "binary_ready"].includes(event.payload.phase)) {
          void refresh();
        }
      }),
      listen<{ downloaded: number; total: number; status: string }>(
        "sdcpp_download_progress",
        (event) => {
          if (event.payload.status === "complete") {
            setDownloadProgress(null);
          } else {
            setDownloadProgress({
              downloaded: event.payload.downloaded,
              total: event.payload.total,
            });
          }
        },
      ),
    ];
    return () => {
      for (const promise of unlistenPromises) {
        void promise.then((unlisten) => unlisten());
      }
    };
  }, [refresh]);

  const updateConfig = useCallback(
    async (patch: Partial<SdcppConfig>) => {
      if (!config) return;
      const next = { ...config, ...patch };
      setConfig(next);
      try {
        await storageBridge.sdcppSetConfig(next);
      } catch (err) {
        toast.error("Save failed", err instanceof Error ? err.message : String(err));
      }
    },
    [config],
  );

  const handleDownloadBinary = useCallback(async () => {
    setDownloading(true);
    try {
      const tag = await storageBridge.sdcppDownloadBinary(
        downloadBackend === "auto" ? null : downloadBackend,
      );
      toast.success("Runtime installed", `stable-diffusion.cpp ${tag}`);
    } catch (err) {
      toast.error("Download failed", err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
      void refresh();
    }
  }, [downloadBackend, refresh]);

  const handleEnableAsModel = useCallback(async () => {
    setBusy(true);
    try {
      const settings = await readSettings();
      let credential = settings.providerCredentials.find((cred) => cred.providerId === "sdcpp");
      if (!credential) {
        credential = await addOrUpdateProviderCredential({
          providerId: "sdcpp",
          label: "Stable Diffusion (Local)",
          baseUrl: "http://127.0.0.1:17861",
        });
      }
      const existing = settings.models.find((model) => model.providerId === "sdcpp");
      if (!existing) {
        await addOrUpdateModel({
          name: SDCPP_MODEL_NAME,
          providerId: "sdcpp",
          providerCredentialId: credential.id,
          providerLabel: credential.label,
          displayName: "Local Diffusion (sd.cpp)",
          inputScopes: ["text", "image"],
          outputScopes: ["image"],
        });
      }
      setEnabledAsModel(true);
      toast.success(
        "Local image model added",
        "Select it above as your avatar or scene model.",
      );
    } catch (err) {
      toast.error("Failed to add model", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleStart = useCallback(async () => {
    setBusy(true);
    try {
      await storageBridge.sdcppStartServer();
    } catch (err) {
      toast.error("Failed to start", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      void refresh();
    }
  }, [refresh]);

  const handleStop = useCallback(async () => {
    setBusy(true);
    try {
      await storageBridge.sdcppStopServer();
    } finally {
      setBusy(false);
      void refresh();
    }
  }, [refresh]);

  const statusLabel = useMemo(() => {
    if (phase === "loading_model" || phase === "starting") return "Loading model...";
    if (!status?.binaryInstalled) return "Runtime not installed";
    if (!status.modelConfigured) return "No model selected";
    if (status.serverReady) return "Running";
    if (status.serverRunning) return "Starting...";
    return "Stopped";
  }, [status, phase]);

  const statusDotClass = useMemo(() => {
    if (status?.serverReady) return "bg-accent";
    if (status?.serverRunning || phase === "loading_model") return "bg-warning animate-pulse";
    return "bg-fg/25";
  }, [status, phase]);

  if (!config) {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-fg/10 bg-surface/40 px-3.5 py-3 text-sm text-fg/50">
        <Loader2 size={14} className="animate-spin" />
        Loading local runtime state...
      </div>
    );
  }

  const downloadPercent =
    downloadProgress && downloadProgress.total > 0
      ? Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)
      : null;

  return (
    <div className="space-y-3">
      <div className="rounded-[10px] border border-fg/10 bg-surface/40 px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-fg/10 bg-fg/5">
              <HardDrive className="h-4 w-4 text-fg/45" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-fg">stable-diffusion.cpp runtime</div>
              <div className="truncate text-xs text-fg/45">
                {status?.binaryInstalled
                  ? `${status.binaryTag ?? "installed"} · ${status.binaryBackend ?? ""}`
                  : "Generates images on this device. Download the runtime to get started."}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <select
              value={downloadBackend}
              onChange={(event) => setDownloadBackend(event.target.value)}
              disabled={downloading}
              className="rounded-lg border border-fg/10 bg-surface px-2 py-1.5 text-xs text-fg/70 focus:outline-none"
            >
              {BACKEND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleDownloadBinary()}
              disabled={downloading}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent",
                "hover:bg-accent/25 disabled:opacity-50",
              )}
            >
              {downloading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Download size={12} />
              )}
              {status?.binaryInstalled ? "Update" : "Download"}
            </button>
          </div>
        </div>
        {downloadPercent !== null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fg/10">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${downloadPercent}%` }}
            />
          </div>
        )}
      </div>

      {status?.binaryInstalled && (
        <div className="space-y-3 rounded-[10px] border border-fg/10 bg-surface/40 px-3.5 py-3">
          <FileSelect
            label="Model (single file, e.g. SD 1.5 / SDXL)"
            value={config.fullModelPath}
            files={files}
            onChange={(path) =>
              void updateConfig({ fullModelPath: path, diffusionModelPath: null })
            }
          />
          <FileSelect
            label="Diffusion model (component pipelines, e.g. Z-Image / Flux)"
            value={config.diffusionModelPath}
            files={files}
            onChange={(path) =>
              void updateConfig({ diffusionModelPath: path, fullModelPath: null })
            }
          />
          {config.diffusionModelPath && (
            <>
              <FileSelect
                label="VAE"
                value={config.vaePath}
                files={files}
                onChange={(path) => void updateConfig({ vaePath: path })}
              />
              <FileSelect
                label="Text encoder (LLM, e.g. Qwen for Z-Image)"
                value={config.llmPath}
                files={files}
                onChange={(path) => void updateConfig({ llmPath: path })}
              />
              <FileSelect
                label="CLIP-L (optional)"
                value={config.clipLPath}
                files={files}
                onChange={(path) => void updateConfig({ clipLPath: path })}
              />
              <FileSelect
                label="T5-XXL (optional, Flux/SD3)"
                value={config.t5xxlPath}
                files={files}
                onChange={(path) => void updateConfig({ t5xxlPath: path })}
              />
            </>
          )}
          <p className="text-[11px] text-fg/40">
            Files are read from the local models folder. Download GGUF or safetensors weights
            with the HuggingFace browser in Settings.
          </p>

          <div className="flex items-center justify-between gap-3 border-t border-fg/10 pt-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-fg">Offload to CPU</div>
              <div className="text-xs text-fg/45">
                Keeps weights in RAM and streams them to the GPU. Slower, but fits big models in
                low VRAM.
              </div>
            </div>
            <Switch
              checked={config.offloadToCpu}
              onChange={(next) => void updateConfig({ offloadToCpu: next })}
              aria-label="Offload to CPU"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-fg">Flash attention</div>
              <div className="text-xs text-fg/45">Reduces memory use during diffusion.</div>
            </div>
            <Switch
              checked={config.flashAttention}
              onChange={(next) => void updateConfig({ flashAttention: next })}
              aria-label="Flash attention"
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-fg/10 pt-3">
            <div className="flex items-center gap-2 text-sm text-fg/70">
              <span className={cn("h-2 w-2 rounded-full", statusDotClass)} />
              {statusLabel}
            </div>
            <div className="flex items-center gap-2">
              {status.serverRunning ? (
                <button
                  type="button"
                  onClick={() => void handleStop()}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-lg border border-fg/15 bg-fg/5 px-3 py-1.5 text-xs font-medium text-fg/70 hover:bg-fg/10 disabled:opacity-50"
                >
                  <Square size={11} />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleStart()}
                  disabled={busy || !status.modelConfigured}
                  className="flex items-center gap-1.5 rounded-lg border border-fg/15 bg-fg/5 px-3 py-1.5 text-xs font-medium text-fg/70 hover:bg-fg/10 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                  Load now
                </button>
              )}
              {!enabledAsModel && (
                <button
                  type="button"
                  onClick={() => void handleEnableAsModel()}
                  disabled={busy || !status.modelConfigured}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent",
                    "hover:bg-accent/25 disabled:opacity-50",
                  )}
                >
                  <Cpu size={11} />
                  Add as image model
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
