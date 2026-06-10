import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Cpu, Download, HardDrive, Search, Trash2 } from "lucide-react";

import {
  sdDeleteModel,
  sdFinalizeBinaryInstall,
  sdGetStatus,
  sdListEngineVariants,
  sdListModels,
  sdQueueBinaryInstall,
  sdRemoveBinary,
  sdRemoveModelRow,
  type SdEngineVariant,
  type SdModelEntry,
  type SdStatus,
} from "../../../core/local-diffusion";
import { useDownloadQueue } from "../../../core/downloads/DownloadQueueContext";
import { useI18n } from "../../../core/i18n/context";
import { Routes } from "../../navigation";
import { toast } from "../../components/toast";

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent > 1 ? 1 : 0)} ${units[exponent]}`;
}

export function LocalImageGenSection() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { queue } = useDownloadQueue();
  const [status, setStatus] = useState<SdStatus | null>(null);
  const [models, setModels] = useState<SdModelEntry[]>([]);
  const [variants, setVariants] = useState<SdEngineVariant[] | null>(null);
  const [variantsError, setVariantsError] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string>("");
  const [installing, setInstalling] = useState(false);
  const finalizedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextModels] = await Promise.all([sdGetStatus(), sdListModels()]);
      setStatus(nextStatus);
      setModels(nextModels);
    } catch (err) {
      console.error("Failed to load local diffusion state:", err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const engineItems = useMemo(
    () => queue.filter((item) => item.queueKind === "sdcpp"),
    [queue],
  );
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
          void refresh();
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
  }, [installing, engineActive, engineFailed, engineItems, refresh, t]);

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

  const removeEngine = async () => {
    try {
      await sdRemoveBinary();
      setVariants(null);
      void refresh();
    } catch (err) {
      toast.error(
        t("imageGeneration.local.engineRemoveFailed"),
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const deleteEntry = async (entry: SdModelEntry) => {
    try {
      await sdDeleteModel(entry.id, true);
      await sdRemoveModelRow(entry.id);
      void refresh();
    } catch (err) {
      toast.error(
        t("imageGeneration.local.deleteFailed"),
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  if (!status) {
    return null;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[12px] border border-fg/10 bg-fg/5">
        <div className="flex items-start justify-between gap-3 border-b border-fg/8 px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-[9px] border border-info/30 bg-info/10 p-1.5 text-info/80">
              <Cpu className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-fg">
                {t("imageGeneration.local.engineTitle")}
              </h3>
              <p className="mt-1 text-sm leading-6 text-fg/48">
                {status.binary
                  ? t("imageGeneration.local.engineInstalledDescription")
                  : t("imageGeneration.local.engineDescription")}
              </p>
            </div>
          </div>
        </div>
        <div className="px-4 py-4">
          {status.binary ? (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-fg/70">
                <span className="font-medium text-fg">{status.binary.variant}</span>
                <span className="ml-2 text-xs text-fg/45">{status.binary.releaseTag}</span>
              </div>
              <button
                type="button"
                onClick={() => void removeEngine()}
                className="rounded-[9px] border border-danger/25 px-3 py-1.5 text-xs font-medium text-danger/80 transition-colors hover:bg-danger/10"
              >
                {t("common.buttons.remove")}
              </button>
            </div>
          ) : engineActive || installing ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-fg/55">
                <span>{t("imageGeneration.local.engineDownloading")}</span>
                <span>{engineProgress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-fg/10">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${engineProgress}%` }}
                />
              </div>
            </div>
          ) : variantsError ? (
            <p className="text-xs leading-5 text-danger/80">{variantsError}</p>
          ) : !variants ? (
            <p className="text-xs text-fg/45">{t("imageGeneration.local.engineLoadingVariants")}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={selectedVariant}
                onChange={(event) => setSelectedVariant(event.target.value)}
                className="rounded-[9px] border border-fg/12 bg-surface/60 px-3 py-2 text-sm text-fg focus:border-fg/25 focus:outline-none"
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
                className="inline-flex items-center gap-2 rounded-[9px] border border-accent/35 bg-accent/12 px-3.5 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20"
              >
                <Download className="h-4 w-4" />
                {t("imageGeneration.local.installEngine")}
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[12px] border border-fg/10 bg-fg/5">
        <div className="flex items-start justify-between gap-3 border-b border-fg/8 px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-[9px] border border-success/30 bg-success/10 p-1.5 text-success/80">
              <HardDrive className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-fg">
                {t("imageGeneration.local.modelsTitle")}
              </h3>
              <p className="mt-1 text-sm leading-6 text-fg/48">
                {t("imageGeneration.local.modelsDescription")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate(`${Routes.settingsModelsBrowse}?mode=sd`)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[9px] border border-fg/12 px-3 py-1.5 text-xs font-medium text-fg/70 transition-colors hover:bg-fg/8"
          >
            <Search className="h-3.5 w-3.5" />
            {t("imageGeneration.local.browseHf")}
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          {models.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-fg/12 bg-surface/30 px-3.5 py-3 text-sm text-fg/45">
              {t("imageGeneration.local.noModels")}
            </p>
          ) : (
            models.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-[10px] border border-fg/10 bg-surface/40 px-3.5 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-fg">{entry.name}</div>
                  <div className="mt-0.5 text-xs uppercase text-fg/45">
                    {entry.family}
                    {entry.totalBytes > 0 ? ` · ${formatBytes(entry.totalBytes)}` : ""}
                    {!entry.complete ? (
                      <span className="ml-2 normal-case text-warning/80">
                        {t("imageGeneration.local.incomplete")}
                      </span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void deleteEntry(entry)}
                  className="shrink-0 rounded-[8px] p-1.5 text-fg/40 transition-colors hover:bg-danger/10 hover:text-danger/80"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
