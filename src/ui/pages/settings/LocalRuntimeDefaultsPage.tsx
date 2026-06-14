import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  Cpu,
  Download,
  FolderInput,
  FolderOpen,
  HardDrive,
  Image,
  Layers,
  Loader2,
  RotateCcw,
  Ruler,
  Trash2,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

import { BottomMenu, MenuButton, MenuButtonGroup, MenuDivider } from "../../components/BottomMenu";

import {
  sdFinalizeBinaryInstall,
  sdGetStatus,
  sdListEngineVariants,
  sdQueueBinaryInstall,
  sdRemoveBinary,
  sdSetCustomBinary,
  type SdEngineVariant,
  type SdStatus,
} from "../../../core/local-diffusion";
import { readSettings, saveAdvancedSettings } from "../../../core/storage/repo";
import { useDownloadQueue } from "../../../core/downloads/DownloadQueueContext";
import { useI18n } from "../../../core/i18n/context";
import { cn } from "../../design-tokens";
import { toast } from "../../components/toast";
import { NumberInput } from "../../components/NumberInput";

type RuntimeDefaults = {
  llamaDefaultContextLength: number | null;
  llamaDefaultKvCacheType: "auto" | "f16" | "q8_0" | "q4_0";
  sdDefaultOffloadMode: "auto" | "gpu" | "mixed";
  sdDefaultSize: string;
};

type ModelDirKind = "llm" | "sd";

type LlmModelsDirInfo = {
  path: string;
  defaultPath: string;
  isCustom: boolean;
  modelCount: number;
};

type SetLlmModelsDirResult = {
  path: string;
  movedEntries: number;
  rewiredModels: number;
};

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent > 1 ? 1 : 0)} ${units[exponent]}`;
}

function SectionHeading({ label }: { label: string }) {
  return (
    <h3 className="px-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-fg/35">
      {label}
    </h3>
  );
}

function SettingRow({
  icon,
  iconClassName,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  iconClassName: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-fg/10 bg-fg/5 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn("rounded-lg border p-1.5", iconClassName)}>{icon}</div>
          <div className="min-w-0">
            <span className="text-sm font-medium text-fg">{title}</span>
            <p className="text-[11px] text-fg/45">{description}</p>
          </div>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </div>
  );
}

const controlClassName =
  "rounded-xl border border-fg/10 bg-surface-el/20 px-3 py-2 text-sm text-fg transition hover:bg-surface-el/30 focus:border-fg/25 focus:outline-none";

export function LocalRuntimeDefaultsPage() {
  const { t } = useI18n();
  const { queue } = useDownloadQueue();
  const [status, setStatus] = useState<SdStatus | null>(null);
  const [variants, setVariants] = useState<SdEngineVariant[] | null>(null);
  const [variantsError, setVariantsError] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string>("");
  const [installing, setInstalling] = useState(false);
  const [defaults, setDefaults] = useState<RuntimeDefaults | null>(null);
  const [modelsDir, setModelsDir] = useState<LlmModelsDirInfo | null>(null);
  const [sdModelsDir, setSdModelsDir] = useState<LlmModelsDirInfo | null>(null);
  const [pending, setPending] = useState<{ kind: ModelDirKind; dir: string } | null>(null);
  const [movingDir, setMovingDir] = useState(false);
  const finalizedRef = useRef(false);

  const refreshModelsDir = useCallback(async () => {
    try {
      setModelsDir(await invoke<LlmModelsDirInfo>("hf_get_llm_models_dir"));
    } catch (err) {
      console.error("Failed to load LLM models dir:", err);
    }
    try {
      setSdModelsDir(await invoke<LlmModelsDirInfo>("sd_get_models_dir"));
    } catch (err) {
      console.error("Failed to load SD models dir:", err);
    }
  }, []);

  const applyModelsDir = useCallback(
    async (kind: ModelDirKind, newDir: string, moveExisting: boolean) => {
      setMovingDir(true);
      try {
        const command = kind === "llm" ? "hf_set_llm_models_dir" : "sd_set_models_dir";
        const result = await invoke<SetLlmModelsDirResult>(command, { newDir, moveExisting });
        await refreshModelsDir();
        if (moveExisting && result.movedEntries > 0) {
          toast.success(
            t("runtimeDefaults.folderChanged"),
            t("runtimeDefaults.folderChangedMoved", { count: result.movedEntries }),
          );
        } else {
          toast.success(t("runtimeDefaults.folderChanged"));
        }
      } catch (err) {
        toast.error(
          t("runtimeDefaults.folderChangeFailed"),
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        setMovingDir(false);
        setPending(null);
      }
    },
    [refreshModelsDir, t],
  );

  const pickModelsFolder = useCallback(
    async (kind: ModelDirKind) => {
      const info = kind === "llm" ? modelsDir : sdModelsDir;
      const selection = await open({ directory: true, multiple: false });
      if (typeof selection !== "string") return;
      if (info && selection === info.path) return;
      if (info && info.modelCount > 0) {
        setPending({ kind, dir: selection });
      } else {
        void applyModelsDir(kind, selection, false);
      }
    },
    [modelsDir, sdModelsDir, applyModelsDir],
  );

  const resetModelsFolder = useCallback(
    (kind: ModelDirKind) => {
      const info = kind === "llm" ? modelsDir : sdModelsDir;
      if (!info) return;
      if (info.modelCount > 0) {
        setPending({ kind, dir: info.defaultPath });
      } else {
        void applyModelsDir(kind, info.defaultPath, false);
      }
    },
    [modelsDir, sdModelsDir, applyModelsDir],
  );

  const pendingInfo = pending
    ? pending.kind === "llm"
      ? modelsDir
      : sdModelsDir
    : null;

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await sdGetStatus());
    } catch (err) {
      console.error("Failed to load sd.cpp status:", err);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void refreshModelsDir();
    readSettings()
      .then((settings) => {
        const advanced = settings.advancedSettings ?? {};
        setDefaults({
          llamaDefaultContextLength: advanced.llamaDefaultContextLength ?? null,
          llamaDefaultKvCacheType: advanced.llamaDefaultKvCacheType ?? "auto",
          sdDefaultOffloadMode: advanced.sdDefaultOffloadMode ?? "auto",
          sdDefaultSize: advanced.sdDefaultSize ?? "",
        });
      })
      .catch(() => {});
  }, [refreshStatus, refreshModelsDir]);

  useEffect(() => {
    if (!status || status.binary || variants) return;
    sdListEngineVariants()
      .then((list) => {
        setVariants(list);
        setVariantsError(null);
        const recommended = list.find((variant) => variant.recommended);
        setSelectedVariant((current) => current || recommended?.id || list[0]?.id || "");
      })
      .catch((err) => {
        setVariantsError(err instanceof Error ? err.message : String(err));
      });
  }, [status, variants]);

  const persistDefaults = useCallback(
    async (next: RuntimeDefaults) => {
      setDefaults(next);
      try {
        const settings = await readSettings();
        await saveAdvancedSettings({
          ...(settings.advancedSettings ?? {}),
          llamaDefaultContextLength: next.llamaDefaultContextLength ?? undefined,
          llamaDefaultKvCacheType:
            next.llamaDefaultKvCacheType === "auto" ? undefined : next.llamaDefaultKvCacheType,
          sdDefaultOffloadMode:
            next.sdDefaultOffloadMode === "auto" ? undefined : next.sdDefaultOffloadMode,
          sdDefaultSize: next.sdDefaultSize.trim() || undefined,
        });
      } catch (err) {
        toast.error(
          t("runtimeDefaults.saveFailed"),
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    [t],
  );

  const engineItems = useMemo(() => queue.filter((item) => item.queueKind === "sdcpp"), [queue]);
  const engineActive = engineItems.some(
    (item) => item.status === "queued" || item.status === "downloading",
  );
  const engineFailed = engineItems.find((item) => item.status === "error");
  const engineProgress = useMemo(() => {
    const total = engineItems.reduce((sum, item) => sum + item.total, 0);
    const downloaded = engineItems.reduce((sum, item) => sum + item.downloaded, 0);
    return total > 0 ? Math.round((downloaded / total) * 100) : 0;
  }, [engineItems]);

  useEffect(() => {
    if (!installing || engineItems.length === 0) return;
    if (engineActive || finalizedRef.current) return;
    if (engineItems.every((item) => item.status === "complete")) {
      finalizedRef.current = true;
      sdFinalizeBinaryInstall()
        .then(() => {
          toast.success(t("imageGeneration.local.engineInstalled"));
          setInstalling(false);
          void refreshStatus();
        })
        .catch((err) => {
          toast.error(
            t("imageGeneration.local.engineInstallFailed"),
            err instanceof Error ? err.message : String(err),
          );
          setInstalling(false);
        });
    } else if (engineFailed) {
      toast.error(t("imageGeneration.local.engineInstallFailed"), engineFailed.error ?? "");
      setInstalling(false);
    }
  }, [installing, engineActive, engineFailed, engineItems, refreshStatus, t]);

  const startEngineInstall = async () => {
    try {
      finalizedRef.current = false;
      setInstalling(true);
      await sdQueueBinaryInstall(selectedVariant || null);
    } catch (err) {
      setInstalling(false);
      toast.error(
        t("imageGeneration.local.engineInstallFailed"),
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const pickCustomBinary = async () => {
    const selection = await open({ multiple: false });
    if (typeof selection !== "string") return;
    try {
      await sdSetCustomBinary(selection);
      toast.success(t("runtimeDefaults.customBinarySet"));
      void refreshStatus();
    } catch (err) {
      toast.error(
        t("runtimeDefaults.customBinaryFailed"),
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const removeEngine = async () => {
    try {
      await sdRemoveBinary();
      setVariants(null);
      void refreshStatus();
    } catch (err) {
      toast.error(
        t("imageGeneration.local.engineRemoveFailed"),
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const renderFolderRow = (kind: ModelDirKind, info: LlmModelsDirInfo | null, title: string) => (
    <div className="rounded-xl border border-fg/10 bg-fg/5 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-lg border border-info/30 bg-info/10 p-1.5">
            <HardDrive className="h-4 w-4 text-info/80" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-fg">{title}</span>
              <span className="rounded border border-fg/15 bg-fg/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-fg/55">
                {info?.isCustom
                  ? t("runtimeDefaults.modelsFolderCustomBadge")
                  : t("runtimeDefaults.modelsFolderDefaultBadge")}
              </span>
            </div>
            <p className="truncate font-mono text-[11px] text-fg/45" title={info?.path}>
              {info?.path ?? ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {info?.isCustom && (
            <button
              type="button"
              onClick={() => resetModelsFolder(kind)}
              disabled={movingDir}
              title={t("runtimeDefaults.modelsFolderReset")}
              className="rounded-lg p-2 text-fg/40 transition-colors hover:bg-fg/10 hover:text-fg/70 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void pickModelsFolder(kind)}
            disabled={movingDir}
            className="inline-flex items-center gap-2 rounded-xl border border-fg/10 bg-surface-el/20 px-3 py-2 text-sm font-medium text-fg/85 transition hover:bg-surface-el/30 disabled:opacity-50"
          >
            {movingDir ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FolderOpen className="h-4 w-4 text-fg/45" />
            )}
            {t("runtimeDefaults.modelsFolderChange")}
          </button>
        </div>
      </div>
    </div>
  );

  if (!status || !defaults) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fg/10 border-t-fg/60" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1 px-4 pb-24 pt-4">
        <div className="mx-auto w-full max-w-5xl space-y-6">
          <div className="space-y-4">
            <SectionHeading label={t("runtimeDefaults.engineSection")} />

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg border border-info/30 bg-info/10 p-1.5">
                  <Image className="h-4 w-4 text-info/80" />
                </div>
                <h3 className="text-sm font-semibold text-fg">
                  {t("runtimeDefaults.engineTitle")}
                </h3>
              </div>

              {status.binary ? (
                <div className="rounded-xl border border-fg/10 bg-fg/5 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-fg">
                        {status.binary.variant}
                        <span className="ml-2 text-xs font-normal text-fg/45">
                          {status.binary.releaseTag}
                        </span>
                      </span>
                      <p
                        className="truncate font-mono text-[11px] text-fg/45"
                        title={status.binary.path}
                      >
                        {status.binary.path}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeEngine()}
                      className="shrink-0 rounded-lg p-2 text-fg/40 transition-colors hover:bg-danger/10 hover:text-danger/80"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : engineActive || installing ? (
                <div className="rounded-xl border border-fg/10 bg-fg/5 px-4 py-3">
                  <div className="flex items-center justify-between text-xs text-fg/55">
                    <span>{t("imageGeneration.local.engineDownloading")}</span>
                    <span>{engineProgress}%</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fg/10">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${engineProgress}%` }}
                    />
                  </div>
                </div>
              ) : variantsError ? (
                <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3">
                  <p className="text-xs leading-relaxed text-danger/80">{variantsError}</p>
                </div>
              ) : !variants ? (
                <div className="rounded-xl border border-fg/10 bg-surface-el/20 px-4 py-3">
                  <p className="text-sm text-fg/50">
                    {t("imageGeneration.local.engineLoadingVariants")}
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={selectedVariant}
                    onChange={(event) => setSelectedVariant(event.target.value)}
                    className={cn(controlClassName, "min-w-0 flex-1")}
                  >
                    {variants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.id}
                        {variant.recommended
                          ? ` (${t("imageGeneration.local.recommended")})`
                          : ""}{" "}
                        · {formatBytes(variant.size)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void startEngineInstall()}
                    className="inline-flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3.5 py-2 text-sm font-medium text-accent transition hover:bg-accent/20"
                  >
                    <Download className="h-4 w-4" />
                    {t("imageGeneration.local.installEngine")}
                  </button>
                </div>
              )}

              {!engineActive && !installing ? (
                <button
                  type="button"
                  onClick={() => void pickCustomBinary()}
                  className="flex w-full items-center justify-between rounded-xl border border-fg/10 bg-surface-el/20 px-3.5 py-3 text-left transition hover:bg-surface-el/30"
                >
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-fg/45" />
                    <span className="text-sm text-fg/85">
                      {t("runtimeDefaults.useExistingBinary")}
                    </span>
                  </div>
                </button>
              ) : null}
              <p className="px-1 text-xs text-fg/50">{t("runtimeDefaults.customBinaryHint")}</p>
            </div>
          </div>

          <div className="space-y-4">
            <SectionHeading label={t("runtimeDefaults.storageSection")} />
            <p className="px-1 text-xs text-fg/50">{t("runtimeDefaults.storageDescription")}</p>

            <div className="space-y-3">
              {renderFolderRow("llm", modelsDir, t("runtimeDefaults.modelsFolderTitle"))}
              {renderFolderRow("sd", sdModelsDir, t("runtimeDefaults.sdModelsFolderTitle"))}
            </div>
          </div>

          <div className="space-y-4">
            <SectionHeading label={t("runtimeDefaults.llamaSection")} />
            <p className="px-1 text-xs text-fg/50">{t("runtimeDefaults.llamaDescription")}</p>

            <SettingRow
              icon={<Brain className="h-4 w-4 text-warning/80" />}
              iconClassName="border-warning/30 bg-warning/10"
              title={t("runtimeDefaults.llamaContextTitle")}
              description={t("runtimeDefaults.llamaContextDescription")}
            >
              <div className="w-28">
                <NumberInput
                  min={512}
                  max={1048576}
                  step={1024}
                  value={defaults.llamaDefaultContextLength}
                  onChange={(next) =>
                    void persistDefaults({
                      ...defaults,
                      llamaDefaultContextLength: next === null ? null : Math.trunc(next),
                    })
                  }
                  placeholder="8192"
                  className={cn(controlClassName, "w-full text-center")}
                />
              </div>
            </SettingRow>

            <SettingRow
              icon={<Layers className="h-4 w-4 text-warning/80" />}
              iconClassName="border-warning/30 bg-warning/10"
              title={t("runtimeDefaults.llamaKvTitle")}
              description={t("runtimeDefaults.llamaKvDescription")}
            >
              <select
                value={defaults.llamaDefaultKvCacheType}
                onChange={(event) =>
                  void persistDefaults({
                    ...defaults,
                    llamaDefaultKvCacheType: event.target
                      .value as RuntimeDefaults["llamaDefaultKvCacheType"],
                  })
                }
                className={controlClassName}
              >
                <option value="auto">{t("common.labels.auto")}</option>
                <option value="f16">F16</option>
                <option value="q8_0">Q8_0</option>
                <option value="q4_0">Q4_0</option>
              </select>
            </SettingRow>
          </div>

          <div className="space-y-4">
            <SectionHeading label={t("runtimeDefaults.sdSection")} />
            <p className="px-1 text-xs text-fg/50">{t("runtimeDefaults.sdDescription")}</p>

            <SettingRow
              icon={<Cpu className="h-4 w-4 text-accent/80" />}
              iconClassName="border-accent/30 bg-accent/10"
              title={t("runtimeDefaults.sdOffloadTitle")}
              description={t("runtimeDefaults.sdOffloadDescription")}
            >
              <select
                value={defaults.sdDefaultOffloadMode}
                onChange={(event) =>
                  void persistDefaults({
                    ...defaults,
                    sdDefaultOffloadMode: event.target
                      .value as RuntimeDefaults["sdDefaultOffloadMode"],
                  })
                }
                className={controlClassName}
              >
                <option value="auto">{t("editModel.sdOffload.auto")}</option>
                <option value="gpu">{t("editModel.sdOffload.gpu")}</option>
                <option value="mixed">{t("editModel.sdOffload.mixed")}</option>
              </select>
            </SettingRow>

            <SettingRow
              icon={<Ruler className="h-4 w-4 text-accent/80" />}
              iconClassName="border-accent/30 bg-accent/10"
              title={t("runtimeDefaults.sdSizeTitle")}
              description={t("runtimeDefaults.sdSizeDescription")}
            >
              <input
                type="text"
                value={defaults.sdDefaultSize}
                onChange={(event) => setDefaults({ ...defaults, sdDefaultSize: event.target.value })}
                onBlur={(event) =>
                  void persistDefaults({ ...defaults, sdDefaultSize: event.target.value })
                }
                placeholder="1024x1024"
                className={cn(controlClassName, "w-28 text-center placeholder:text-fg/35")}
              />
            </SettingRow>
          </div>
        </div>
      </main>

      <BottomMenu
        isOpen={pending !== null}
        onClose={() => {
          if (!movingDir) setPending(null);
        }}
        title={t("runtimeDefaults.moveMenuTitle")}
      >
        <MenuButtonGroup>
          <MenuButton
            icon={movingDir ? <Loader2 className="h-5 w-5 animate-spin" /> : FolderInput}
            title={movingDir ? t("runtimeDefaults.moveWorking") : t("runtimeDefaults.moveConfirm")}
            description={
              pendingInfo
                ? `${t("runtimeDefaults.moveCount", { count: pendingInfo.modelCount })} ${t("runtimeDefaults.moveConfirmDescription")}`
                : t("runtimeDefaults.moveConfirmDescription")
            }
            color="#34d399"
            disabled={movingDir}
            onClick={() => {
              if (pending) void applyModelsDir(pending.kind, pending.dir, true);
            }}
          />
          <MenuButton
            icon={FolderOpen}
            title={t("runtimeDefaults.moveKeep")}
            description={t("runtimeDefaults.moveKeepDescription")}
            disabled={movingDir}
            onClick={() => {
              if (pending) void applyModelsDir(pending.kind, pending.dir, false);
            }}
          />
          <MenuDivider />
          <MenuButton
            icon={X}
            title={t("common.buttons.cancel")}
            disabled={movingDir}
            onClick={() => setPending(null)}
          />
        </MenuButtonGroup>
      </BottomMenu>
    </div>
  );
}
