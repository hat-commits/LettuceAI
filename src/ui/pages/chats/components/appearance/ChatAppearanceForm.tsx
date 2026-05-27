import { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { ChatAppearanceSettings } from "../../../../../core/storage/schemas";
import { cn } from "../../../../design-tokens";
import { Switch } from "../../../../components/Switch";
import { NumberInput } from "../../../../components/NumberInput";
import { WidgetSlotEditor } from "../widgets/editor/WidgetSlotEditor";
import { normalizeHexColor } from "../../../../../core/utils/imageAnalysis";
import { useI18n } from "../../../../../core/i18n/context";

export type AppearanceKey = keyof ChatAppearanceSettings;

export type AppearanceTab =
  | "typography"
  | "bubbles"
  | "layout"
  | "colors"
  | "background";

export const APPEARANCE_TABS: { id: AppearanceTab; labelKey: string }[] = [
  { id: "typography", labelKey: "chatAppearance.tabs.typography" },
  { id: "bubbles", labelKey: "chatAppearance.tabs.bubbles" },
  { id: "layout", labelKey: "chatAppearance.tabs.layout" },
  { id: "colors", labelKey: "chatAppearance.tabs.colors" },
  { id: "background", labelKey: "chatAppearance.tabs.background" },
];

interface OptionGridProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  overridden?: boolean;
  onReset?: () => void;
}

function OptionGrid<T extends string>({
  label,
  value,
  options,
  onChange,
  overridden,
  onReset,
}: OptionGridProps<T>) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-fg/60">{label}</span>
        {overridden && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-1 text-[10px] text-accent/70 hover:text-accent"
          >
            <RotateCcw size={10} />
            Reset
          </button>
        )}
      </div>
      <div className={`grid gap-1.5 ${options.length <= 3 ? "grid-cols-3" : "grid-cols-4"}`}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-lg border py-2 text-[11px] font-medium transition-all",
              value === opt.value
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-fg/5 bg-fg/5 text-fg/40 hover:bg-fg/10",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  overridden?: boolean;
  onReset?: () => void;
}

function SliderControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
  overridden,
  onReset,
}: SliderControlProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-fg/60">{label}</span>
        <div className="flex items-center gap-2">
          {overridden && onReset && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1 text-[10px] text-accent/70 hover:text-accent"
            >
              <RotateCcw size={10} />
              Reset
            </button>
          )}
          <span className="text-[11px] text-fg/50">
            {value}
            {unit}
          </span>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </div>
  );
}

interface HexColorControlProps {
  label: string;
  value?: string;
  onChange: (v: string | undefined) => void;
  overridden?: boolean;
  onReset?: () => void;
}

function HexColorControl({ label, value, onChange, overridden, onReset }: HexColorControlProps) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const applyDraft = useCallback(() => {
    onChange(normalizeHexColor(draft));
  }, [draft, onChange]);

  const swatch = normalizeHexColor(draft) ?? "#000000";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-fg/60">{label}</span>
        <div className="flex items-center gap-2">
          {overridden && onReset && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1 text-[10px] text-accent/70 hover:text-accent"
            >
              <RotateCcw size={10} />
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-[10px] text-fg/45 transition hover:text-fg/70"
          >
            Use token
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={applyDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              applyDraft();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          placeholder="#00FFAA"
          className="h-9 flex-1 rounded-lg border border-fg/10 bg-fg/5 px-3 text-xs text-fg outline-none transition focus:border-accent/40"
        />
        <input
          type="color"
          value={swatch}
          onChange={(e) => {
            setDraft(e.target.value);
            onChange(normalizeHexColor(e.target.value));
          }}
          className="h-9 w-12 cursor-pointer rounded-md border border-fg/15 bg-fg/5 p-1"
          aria-label={`${label} picker`}
        />
      </div>
      {draft.trim().length > 0 && !normalizeHexColor(draft) && (
        <p className="text-[10px] text-warning">Use 3, 4, 6, or 8-digit hex. Example: #22CCAA</p>
      )}
    </div>
  );
}

interface ToggleControlProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  overridden?: boolean;
  onReset?: () => void;
  disabled?: boolean;
}

function ToggleControl({
  label,
  description,
  checked,
  onChange,
  overridden,
  onReset,
  disabled,
}: ToggleControlProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-fg/60">{label}</div>
          {description ? <div className="mt-0.5 text-[11px] text-fg/45">{description}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {overridden && onReset && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1 text-[10px] text-accent/70 hover:text-accent"
            >
              <RotateCcw size={10} />
              Reset
            </button>
          )}
          <Switch checked={checked} onChange={onChange} disabled={disabled} aria-label={label} />
        </div>
      </div>
    </div>
  );
}

export interface ChatAppearanceFormProps {
  settings: ChatAppearanceSettings;
  mode: "global" | "character";
  activeTab: AppearanceTab;
  onUpdate: <K extends AppearanceKey>(key: K, value: ChatAppearanceSettings[K]) => void;
  onResetField: (key: AppearanceKey) => void;
  isOverridden: (key: AppearanceKey) => boolean;
}

export function ChatAppearanceForm({
  settings,
  mode,
  activeTab,
  onUpdate,
  onResetField,
  isOverridden,
}: ChatAppearanceFormProps) {
  const { t } = useI18n();
  const resetFor = (key: AppearanceKey) =>
    mode === "character" ? () => onResetField(key) : undefined;

  if (activeTab === "typography") {
    return (
      <div className="space-y-4 rounded-xl border border-fg/10 bg-fg/5 px-4 py-3">
        <OptionGrid
          label={t("chatAppearance.fontSize.label")}
          value={settings.fontSize}
          options={[
            { value: "small", label: t("chatAppearance.fontSize.small") },
            { value: "medium", label: t("chatAppearance.fontSize.medium") },
            { value: "large", label: t("chatAppearance.fontSize.large") },
            { value: "xlarge", label: t("chatAppearance.fontSize.xLarge") },
          ]}
          onChange={(v) => onUpdate("fontSize", v)}
          overridden={isOverridden("fontSize")}
          onReset={resetFor("fontSize")}
        />
        <OptionGrid
          label={t("chatAppearance.lineSpacing.label")}
          value={settings.lineSpacing}
          options={[
            { value: "tight", label: t("chatAppearance.lineSpacing.tight") },
            { value: "normal", label: t("chatAppearance.lineSpacing.normal") },
            { value: "relaxed", label: t("chatAppearance.lineSpacing.relaxed") },
          ]}
          onChange={(v) => onUpdate("lineSpacing", v)}
          overridden={isOverridden("lineSpacing")}
          onReset={resetFor("lineSpacing")}
        />
      </div>
    );
  }

  if (activeTab === "bubbles") {
    return (
      <div className="space-y-4 rounded-xl border border-fg/10 bg-fg/5 px-4 py-3">
        <OptionGrid
          label={t("chatAppearance.messageBubbles.style.label")}
          value={settings.bubbleStyle}
          options={[
            { value: "bordered", label: t("chatAppearance.messageBubbles.style.bordered") },
            { value: "filled", label: t("chatAppearance.messageBubbles.style.filled") },
            { value: "minimal", label: t("chatAppearance.messageBubbles.style.minimal") },
          ]}
          onChange={(v) => onUpdate("bubbleStyle", v)}
          overridden={isOverridden("bubbleStyle")}
          onReset={resetFor("bubbleStyle")}
        />
        <OptionGrid
          label={t("chatAppearance.messageBubbles.cornerRadius.label")}
          value={settings.bubbleRadius}
          options={[
            { value: "sharp", label: t("chatAppearance.messageBubbles.cornerRadius.sharp") },
            { value: "rounded", label: t("chatAppearance.messageBubbles.cornerRadius.rounded") },
            { value: "pill", label: t("chatAppearance.messageBubbles.cornerRadius.pill") },
          ]}
          onChange={(v) => onUpdate("bubbleRadius", v)}
          overridden={isOverridden("bubbleRadius")}
          onReset={resetFor("bubbleRadius")}
        />
        <OptionGrid
          label={t("chatAppearance.messageBubbles.maxWidth.label")}
          value={settings.bubbleMaxWidth}
          options={[
            { value: "compact", label: t("chatAppearance.messageBubbles.maxWidth.compact") },
            { value: "normal", label: t("chatAppearance.messageBubbles.maxWidth.normal") },
            { value: "wide", label: t("chatAppearance.messageBubbles.maxWidth.wide") },
          ]}
          onChange={(v) => onUpdate("bubbleMaxWidth", v)}
          overridden={isOverridden("bubbleMaxWidth")}
          onReset={resetFor("bubbleMaxWidth")}
        />
        <OptionGrid
          label={t("chatAppearance.messageBubbles.padding.label")}
          value={settings.bubblePadding}
          options={[
            { value: "compact", label: t("chatAppearance.messageBubbles.padding.compact") },
            { value: "normal", label: t("chatAppearance.messageBubbles.padding.normal") },
            { value: "spacious", label: t("chatAppearance.messageBubbles.padding.spacious") },
          ]}
          onChange={(v) => onUpdate("bubblePadding", v)}
          overridden={isOverridden("bubblePadding")}
          onReset={resetFor("bubblePadding")}
        />
      </div>
    );
  }

  if (activeTab === "layout") {
    return (
      <div className="space-y-4 rounded-xl border border-fg/10 bg-fg/5 px-4 py-3">
        <OptionGrid
          label={t("chatAppearance.layout.messageSpacing")}
          value={settings.messageGap}
          options={[
            { value: "tight", label: t("chatAppearance.layout.tight") },
            { value: "normal", label: t("chatAppearance.layout.normal") },
            { value: "relaxed", label: t("chatAppearance.layout.relaxed") },
          ]}
          onChange={(v) => onUpdate("messageGap", v)}
          overridden={isOverridden("messageGap")}
          onReset={resetFor("messageGap")}
        />
        <OptionGrid
          label={t("chatAppearance.avatar.shape.label")}
          value={settings.avatarShape}
          options={[
            { value: "circle", label: t("chatAppearance.avatar.shape.circle") },
            { value: "rounded", label: t("chatAppearance.avatar.shape.rounded") },
            { value: "hidden", label: t("chatAppearance.avatar.shape.hidden") },
          ]}
          onChange={(v) => onUpdate("avatarShape", v)}
          overridden={isOverridden("avatarShape")}
          onReset={resetFor("avatarShape")}
        />
        <OptionGrid
          label={t("chatAppearance.avatar.size.label")}
          value={settings.avatarSize}
          options={[
            { value: "small", label: t("chatAppearance.avatar.size.small") },
            { value: "medium", label: t("chatAppearance.avatar.size.medium") },
            { value: "large", label: t("chatAppearance.avatar.size.large") },
          ]}
          onChange={(v) => onUpdate("avatarSize", v)}
          overridden={isOverridden("avatarSize")}
          onReset={resetFor("avatarSize")}
        />
        <div className="hidden space-y-4 lg:block lg:space-y-4">
        <OptionGrid
          label={t("chatAppearance.layout.chatColumn.widthLabel")}
          value={settings.chatColumnWidth}
          options={[
            { value: "narrow", label: t("chatAppearance.layout.chatColumn.width.narrow") },
            { value: "normal", label: t("chatAppearance.layout.chatColumn.width.normal") },
            { value: "wide", label: t("chatAppearance.layout.chatColumn.width.wide") },
            { value: "xl", label: t("chatAppearance.layout.chatColumn.width.xl") },
            { value: "full", label: t("chatAppearance.layout.chatColumn.width.full") },
            { value: "custom", label: t("chatAppearance.layout.chatColumn.width.custom") },
          ]}
          onChange={(v) => {
            onUpdate("chatColumnWidth", v);
            if (v === "custom" && settings.chatColumnWidthPx == null) {
              onUpdate("chatColumnWidthPx", 800);
            }
          }}
          overridden={isOverridden("chatColumnWidth")}
          onReset={resetFor("chatColumnWidth")}
        />
        {settings.chatColumnWidth === "custom" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-fg/60">
                {t("chatAppearance.layout.chatColumn.customPx")}
              </span>
              {isOverridden("chatColumnWidthPx") && (
                <button
                  type="button"
                  onClick={resetFor("chatColumnWidthPx")}
                  className="flex items-center gap-1 text-[10px] text-accent/70 hover:text-accent"
                >
                  <RotateCcw size={10} />
                  Reset
                </button>
              )}
            </div>
            <NumberInput
              min={400}
              max={2400}
              step={10}
              value={settings.chatColumnWidthPx ?? 800}
              onChange={(next) => {
                if (next == null) return;
                onUpdate("chatColumnWidthPx", next);
              }}
              className={cn(
                "w-full rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg/80",
                "focus:border-accent/40 focus:outline-none",
              )}
            />
          </div>
        )}
        <OptionGrid
          label={t("chatAppearance.layout.chatColumn.alignLabel")}
          value={settings.chatColumnAlign}
          options={[
            { value: "left", label: t("chatAppearance.layout.chatColumn.align.left") },
            { value: "center", label: t("chatAppearance.layout.chatColumn.align.center") },
            { value: "right", label: t("chatAppearance.layout.chatColumn.align.right") },
          ]}
          onChange={(v) => onUpdate("chatColumnAlign", v)}
          overridden={isOverridden("chatColumnAlign")}
          onReset={resetFor("chatColumnAlign")}
        />
        <ToggleControl
          label={t("chatAppearance.layout.chatColumn.moveHeader")}
          description={t("chatAppearance.layout.chatColumn.moveHeaderDesc")}
          checked={settings.chatHeaderMoves}
          onChange={(v) => onUpdate("chatHeaderMoves", v)}
          overridden={isOverridden("chatHeaderMoves")}
          onReset={resetFor("chatHeaderMoves")}
        />
        <ToggleControl
          label={t("chatAppearance.layout.chatColumn.moveFooter")}
          description={t("chatAppearance.layout.chatColumn.moveFooterDesc")}
          checked={settings.chatFooterMoves}
          onChange={(v) => onUpdate("chatFooterMoves", v)}
          overridden={isOverridden("chatFooterMoves")}
          onReset={resetFor("chatFooterMoves")}
        />
        {settings.chatColumnWidth !== "full" && (
          <ToggleControl
            label={t("chatAppearance.layout.chatColumn.widgetArea")}
            description={t("chatAppearance.layout.chatColumn.widgetAreaDesc")}
            checked={settings.chatWidgetAreaEnabled}
            onChange={(v) => onUpdate("chatWidgetAreaEnabled", v)}
            overridden={isOverridden("chatWidgetAreaEnabled")}
            onReset={resetFor("chatWidgetAreaEnabled")}
          />
        )}
        {settings.chatColumnWidth !== "full" &&
          settings.chatWidgetAreaEnabled &&
          settings.chatColumnAlign === "center" && (
            <OptionGrid
              label={t("chatAppearance.layout.chatColumn.widgetCenterModeLabel")}
              value={settings.chatWidgetCenterMode}
              options={[
                {
                  value: "both",
                  label: t("chatAppearance.layout.chatColumn.widgetCenterMode.both"),
                },
                {
                  value: "left",
                  label: t("chatAppearance.layout.chatColumn.widgetCenterMode.left"),
                },
                {
                  value: "right",
                  label: t("chatAppearance.layout.chatColumn.widgetCenterMode.right"),
                },
              ]}
              onChange={(v) => onUpdate("chatWidgetCenterMode", v)}
              overridden={isOverridden("chatWidgetCenterMode")}
              onReset={resetFor("chatWidgetCenterMode")}
            />
          )}
        {settings.chatColumnWidth !== "full" && settings.chatWidgetAreaEnabled && (
          <div className="flex flex-col gap-3 pt-1">
            <WidgetSlotEditor
              label="Left slot"
              nodes={settings.chatWidgetSlots.left}
              onChange={(left) =>
                onUpdate("chatWidgetSlots", {
                  ...settings.chatWidgetSlots,
                  left,
                })
              }
            />
            <WidgetSlotEditor
              label="Right slot"
              nodes={settings.chatWidgetSlots.right}
              onChange={(right) =>
                onUpdate("chatWidgetSlots", {
                  ...settings.chatWidgetSlots,
                  right,
                })
              }
            />
          </div>
        )}
        </div>
      </div>
    );
  }

  if (activeTab === "colors") {
    return (
      <div className="space-y-5">
        <div className="space-y-4 rounded-xl border border-fg/10 bg-fg/5 px-4 py-3">
          <OptionGrid
            label={t("chatAppearance.colors.userBubble")}
            value={settings.userBubbleColor}
            options={[
              { value: "accent", label: t("chatAppearance.colors.accent") },
              { value: "info", label: t("chatAppearance.colors.info") },
              { value: "secondary", label: t("chatAppearance.colors.secondary") },
              { value: "warning", label: t("chatAppearance.colors.warning") },
            ]}
            onChange={(v) => onUpdate("userBubbleColor", v)}
            overridden={isOverridden("userBubbleColor")}
            onReset={resetFor("userBubbleColor")}
          />
          <OptionGrid
            label={t("chatAppearance.colors.assistantBubble")}
            value={settings.assistantBubbleColor}
            options={[
              { value: "neutral", label: t("chatAppearance.colors.neutral") },
              { value: "accent", label: t("chatAppearance.colors.accent") },
              { value: "info", label: t("chatAppearance.colors.info") },
              { value: "secondary", label: t("chatAppearance.colors.secondary") },
            ]}
            onChange={(v) => onUpdate("assistantBubbleColor", v)}
            overridden={isOverridden("assistantBubbleColor")}
            onReset={resetFor("assistantBubbleColor")}
          />
          <HexColorControl
            label={t("chatAppearance.colors.userBubbleHex")}
            value={settings.userBubbleColorHex}
            onChange={(v) => onUpdate("userBubbleColorHex", v)}
            overridden={isOverridden("userBubbleColorHex")}
            onReset={resetFor("userBubbleColorHex")}
          />
          <HexColorControl
            label={t("chatAppearance.colors.assistantBubbleHex")}
            value={settings.assistantBubbleColorHex}
            onChange={(v) => onUpdate("assistantBubbleColorHex", v)}
            overridden={isOverridden("assistantBubbleColorHex")}
            onReset={resetFor("assistantBubbleColorHex")}
          />
        </div>

        <div>
          <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-fg/35">
            {t("chatAppearance.colors.textColors")}
          </h3>
          <div className="space-y-4 rounded-xl border border-fg/10 bg-fg/5 px-4 py-3">
            <HexColorControl
              label={t("chatAppearance.colors.messageTextHex")}
              value={settings.messageTextColorHex}
              onChange={(v) => onUpdate("messageTextColorHex", v)}
              overridden={isOverridden("messageTextColorHex")}
              onReset={resetFor("messageTextColorHex")}
            />
            <HexColorControl
              label={t("chatAppearance.colors.plainTextHex")}
              value={settings.plainTextColorHex}
              onChange={(v) => onUpdate("plainTextColorHex", v)}
              overridden={isOverridden("plainTextColorHex")}
              onReset={resetFor("plainTextColorHex")}
            />
            <HexColorControl
              label={t("chatAppearance.colors.italicTextHex")}
              value={settings.italicTextColorHex}
              onChange={(v) => onUpdate("italicTextColorHex", v)}
              overridden={isOverridden("italicTextColorHex")}
              onReset={resetFor("italicTextColorHex")}
            />
            <HexColorControl
              label={t("chatAppearance.colors.quotedTextHex")}
              value={settings.quotedTextColorHex}
              onChange={(v) => onUpdate("quotedTextColorHex", v)}
              overridden={isOverridden("quotedTextColorHex")}
              onReset={resetFor("quotedTextColorHex")}
            />
            <HexColorControl
              label={t("chatAppearance.colors.inlineCodeTextHex")}
              value={settings.inlineCodeTextColorHex}
              onChange={(v) => onUpdate("inlineCodeTextColorHex", v)}
              overridden={isOverridden("inlineCodeTextColorHex")}
              onReset={resetFor("inlineCodeTextColorHex")}
            />
          </div>
        </div>

        <div>
          <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-fg/35">
            {t("chatAppearance.textColorMode.label")}
          </h3>
          <div className="space-y-4 rounded-xl border border-fg/10 bg-fg/5 px-4 py-3">
            <OptionGrid
              label={t("chatAppearance.textColorMode.label")}
              value={settings.textMode}
              options={[
                { value: "auto", label: t("chatAppearance.textColorMode.auto") },
                { value: "light", label: t("chatAppearance.textColorMode.light") },
                { value: "dark", label: t("chatAppearance.textColorMode.dark") },
              ]}
              onChange={(v) => onUpdate("textMode", v)}
              overridden={isOverridden("textMode")}
              onReset={resetFor("textMode")}
            />
          </div>
        </div>
      </div>
    );
  }

  // background
  return (
    <div className="space-y-4 rounded-xl border border-fg/10 bg-fg/5 px-4 py-3">
      <ToggleControl
        label="Transparent Header"
        description="When a chat background image is active, remove the header scrim and let the image show through."
        checked={settings.transparentHeader}
        onChange={(v) => onUpdate("transparentHeader", v)}
        overridden={isOverridden("transparentHeader")}
        onReset={resetFor("transparentHeader")}
      />
      <SliderControl
        label={t("chatAppearance.backgroundTransparency.backgroundDim")}
        value={settings.backgroundDim}
        min={0}
        max={80}
        step={5}
        unit="%"
        onChange={(v) => onUpdate("backgroundDim", v)}
        overridden={isOverridden("backgroundDim")}
        onReset={resetFor("backgroundDim")}
      />
      <SliderControl
        label={t("chatAppearance.backgroundTransparency.backgroundBlur")}
        value={settings.backgroundBlur}
        min={0}
        max={20}
        step={1}
        unit="px"
        onChange={(v) => onUpdate("backgroundBlur", v)}
        overridden={isOverridden("backgroundBlur")}
        onReset={resetFor("backgroundBlur")}
      />
      <SliderControl
        label={t("chatAppearance.backgroundTransparency.bubbleOpacity")}
        value={settings.bubbleOpacity}
        min={20}
        max={100}
        step={5}
        unit="%"
        onChange={(v) => onUpdate("bubbleOpacity", v)}
        overridden={isOverridden("bubbleOpacity")}
        onReset={resetFor("bubbleOpacity")}
      />
    </div>
  );
}

interface AppearanceTabBarProps {
  activeTab: AppearanceTab;
  onChange: (tab: AppearanceTab) => void;
}

export function AppearanceTabBar({ activeTab, onChange }: AppearanceTabBarProps) {
  const { t } = useI18n();
  return (
    <div className="flex gap-1 rounded-xl border border-fg/8 bg-fg/5 p-1">
      {APPEARANCE_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            "flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors",
            activeTab === tab.id
              ? "bg-fg/10 text-fg"
              : "text-fg/40 hover:text-fg/60",
          )}
        >
          {t(tab.labelKey as Parameters<typeof t>[0])}
        </button>
      ))}
    </div>
  );
}
