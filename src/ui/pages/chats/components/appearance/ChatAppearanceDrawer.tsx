import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw } from "lucide-react";
import {
  createDefaultChatAppearanceSettings,
  mergeChatAppearance,
  type ChatAppearanceOverride,
  type ChatAppearanceSettings,
  type Character,
} from "../../../../../core/storage/schemas";
import {
  readSettings,
  updateCharacterChatAppearance,
} from "../../../../../core/storage/repo";
import { useI18n } from "../../../../../core/i18n/context";
import { cn } from "../../../../design-tokens";
import { toast } from "../../../../components/toast";
import {
  AppearanceTabBar,
  ChatAppearanceForm,
  type AppearanceKey,
  type AppearanceTab,
} from "./ChatAppearanceForm";
import {
  areOverridesEqual,
  deriveOverrideFromSettings,
  normalizeOverride,
} from "./overrideHelpers";

interface ChatAppearanceDrawerProps {
  open: boolean;
  onClose: () => void;
  character: Character;
  onCharacterUpdate: (next: Character) => void;
  setDraftOverride: (next: ChatAppearanceOverride | null) => void;
}

export function ChatAppearanceDrawer({
  open,
  onClose,
  character,
  onCharacterUpdate,
  setDraftOverride,
}: ChatAppearanceDrawerProps) {
  const { t } = useI18n();
  const [globalSettings, setGlobalSettings] = useState<ChatAppearanceSettings>(
    createDefaultChatAppearanceSettings(),
  );
  const [activeTab, setActiveTab] = useState<AppearanceTab>("typography");
  const [override, setOverride] = useState<ChatAppearanceOverride>(() =>
    normalizeOverride(character.chatAppearance ?? {}),
  );
  const [initialOverride, setInitialOverride] = useState<ChatAppearanceOverride>(() =>
    normalizeOverride(character.chatAppearance ?? {}),
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const settings = await readSettings();
        const global =
          settings.advancedSettings?.chatAppearance ?? createDefaultChatAppearanceSettings();
        if (!cancelled) setGlobalSettings(global);
      } catch (err) {
        console.error("ChatAppearanceDrawer: failed to load global settings", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const next = normalizeOverride(character.chatAppearance ?? {});
    setOverride(next);
    setInitialOverride(next);
  }, [open, character.chatAppearance]);

  useEffect(() => {
    if (!open) {
      setDraftOverride(null);
      return;
    }
    setDraftOverride(override);
    return () => {
      setDraftOverride(null);
    };
  }, [open, override, setDraftOverride]);

  const effectiveSettings = useMemo(
    () => mergeChatAppearance(globalSettings, override),
    [globalSettings, override],
  );

  const updateField = useCallback(
    <K extends AppearanceKey>(key: K, value: ChatAppearanceSettings[K]) => {
      setOverride((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const resetField = useCallback((key: AppearanceKey) => {
    setOverride((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const isOverridden = useCallback(
    (key: AppearanceKey): boolean => key in override && override[key] !== undefined,
    [override],
  );

  const isDirty = useMemo(
    () => !areOverridesEqual(override, initialOverride),
    [override, initialOverride],
  );

  const handleDiscard = useCallback(() => {
    setOverride(initialOverride);
  }, [initialOverride]);

  const handleSave = useCallback(async () => {
    if (!isDirty || isSaving) return;
    setIsSaving(true);
    try {
      const derived = deriveOverrideFromSettings(globalSettings, effectiveSettings);
      const saved = await updateCharacterChatAppearance(
        character.id,
        Object.keys(derived).length > 0 ? derived : null,
      );
      const normalized = normalizeOverride(derived);
      onCharacterUpdate({ ...saved, chatAppearance: normalized });
      setOverride(normalized);
      setInitialOverride(normalized);
      toast.success("Saved", "Character chat appearance updated.");
    } catch (err) {
      console.error("ChatAppearanceDrawer: save failed", err);
      toast.error("Save failed", err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }, [isDirty, isSaving, globalSettings, effectiveSettings, character.id, onCharacterUpdate]);

  useEffect(() => {
    const globalWindow = window as any;
    if (!open) {
      globalWindow.__unsavedChanges = false;
      return;
    }
    globalWindow.__unsavedChanges = isDirty && !isSaving;
    return () => {
      globalWindow.__unsavedChanges = false;
    };
  }, [open, isDirty, isSaving]);

  useEffect(() => {
    if (!open) return;
    const onDiscard = () => handleDiscard();
    const onSave = () => void handleSave();
    window.addEventListener("unsaved:discard", onDiscard);
    window.addEventListener("unsaved:save", onSave);
    return () => {
      window.removeEventListener("unsaved:discard", onDiscard);
      window.removeEventListener("unsaved:save", onSave);
    };
  }, [open, handleDiscard, handleSave]);

  const handleCloseAttempt = useCallback(() => {
    if (isDirty) {
      toast.warningSticky(
        "Unsaved appearance changes",
        "Save or discard before closing.",
        "Discard",
        () => {
          handleDiscard();
          onClose();
        },
        "appearance-drawer-unsaved",
        {
          label: "Save",
          onAction: () => {
            void handleSave().then(() => {
              toast.dismiss("appearance-drawer-unsaved");
              onClose();
            });
          },
        },
      );
      return;
    }
    onClose();
  }, [isDirty, handleDiscard, handleSave, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCloseAttempt}
          />
          <motion.aside
            className={cn(
              "fixed top-0 right-0 z-50 flex h-full w-[400px] flex-col",
              "border-l border-fg/10 bg-surface shadow-2xl",
            )}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <header className="flex items-center justify-between border-b border-fg/10 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-fg">Chat Appearance</div>
                <div className="text-[11px] text-fg/45">{character.name} only</div>
              </div>
              <button
                type="button"
                onClick={handleCloseAttempt}
                className="rounded-lg p-1.5 text-fg/50 hover:bg-fg/10 hover:text-fg"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </header>

            <div className="space-y-3 border-b border-fg/10 px-4 py-3">
              <AppearanceTabBar activeTab={activeTab} onChange={setActiveTab} />
              <button
                type="button"
                onClick={() => setOverride({})}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-[11px] font-medium transition-all",
                  "border-fg/10 bg-fg/5 text-fg/50 hover:border-fg/20 hover:bg-fg/10 hover:text-fg/70",
                )}
              >
                <RefreshCw size={11} />
                Clear all overrides
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              <ChatAppearanceForm
                settings={effectiveSettings}
                mode="character"
                activeTab={activeTab}
                onUpdate={updateField}
                onResetField={resetField}
                isOverridden={isOverridden}
              />
            </div>

            <footer className="flex gap-2 border-t border-fg/10 px-4 py-3">
              <button
                type="button"
                onClick={handleDiscard}
                disabled={!isDirty || isSaving}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-all",
                  "border-fg/10 bg-fg/5 text-fg/60 hover:border-fg/20 hover:bg-fg/10 hover:text-fg",
                  "disabled:opacity-40 disabled:pointer-events-none",
                )}
              >
                {t("common.buttons.discard")}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!isDirty || isSaving}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-all",
                  "border-accent/40 bg-accent/15 text-accent hover:border-accent/60 hover:bg-accent/25",
                  "disabled:opacity-40 disabled:pointer-events-none",
                )}
              >
                {isSaving ? "Saving..." : t("topNav.save")}
              </button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
