import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  ChevronDown,
  Clock,
  Compass,
  Database,
  Loader2,
  Shield,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import type { CompanionConfig } from "../../../../core/storage/schemas";
import { cn, interactive, radius, spacing, typography } from "../../../design-tokens";
import { Switch } from "../../../components/Switch";
import { NumberInput } from "../../../components/NumberInput";
import { normalizeCompanionConfig } from "../utils/companionDefaults";
import {
  SOUL_PRESETS,
  applySoulPreset,
  detectMatchingPreset,
  type SoulPreset,
} from "./SoulPresets";

type SoulTextKey =
  | "essence"
  | "traits"
  | "backstory"
  | "appearance"
  | "goals"
  | "likes"
  | "voice"
  | "relationalStyle"
  | "vulnerabilities"
  | "habits"
  | "boundaries";

type AffectKey = keyof CompanionConfig["soul"]["baselineAffect"];
type RegulationKey = keyof CompanionConfig["soul"]["regulationStyle"];
type RelationshipKey = keyof CompanionConfig["relationshipDefaults"];

interface CompanionSoulEditorProps {
  companion: CompanionConfig | null | undefined;
  onChange: (next: CompanionConfig) => void;
  disabled?: boolean;
  onGenerate?: () => void;
  generating?: boolean;
  generationDisabledReason?: string | null;
  modelLabel?: string | null;
  direction?: string;
  onDirectionChange?: (next: string) => void;
}

interface TextField {
  key: SoulTextKey;
  label: string;
  placeholder: string;
  example: string;
  rows: number;
}

const SOUL_TEXT_FIELDS: TextField[] = [
  {
    key: "essence",
    label: "Essence",
    rows: 3,
    placeholder: "Who they are underneath the card definition.",
    example:
      "A practiced calm that breaks easily for the people they trust. Reads books to feel less alone, not to be impressive.",
  },
  {
    key: "traits",
    label: "Traits",
    rows: 2,
    placeholder: "Defining personality traits, in a few words each.",
    example:
      "Courageous to a fault, quietly stubborn, resourceful under pressure, slow to forgive.",
  },
  {
    key: "backstory",
    label: "Backstory",
    rows: 3,
    placeholder: "How they came to be. Origin, formative events, what they do.",
    example:
      "Orphaned young and raised by a traveling apothecary. Now keeps a small shop, but never stopped looking for the people who left.",
  },
  {
    key: "appearance",
    label: "Appearance",
    rows: 2,
    placeholder: "How they look and dress. Signature outfit or style.",
    example:
      "Worn leather coat over mismatched layers. Always the same scuffed boots. Hair tied back when working.",
  },
  {
    key: "goals",
    label: "Goals",
    rows: 2,
    placeholder: "What they're working toward. Ambitions, quests, unfinished business.",
    example:
      "Wants to rebuild the family name, find the brother who vanished, and prove they were never the weak one.",
  },
  {
    key: "likes",
    label: "Likes & Favorites",
    rows: 2,
    placeholder: "Favorites and small joys. Food, color, music, gestures.",
    example:
      "Honey in black tea, the color of dusk, old sea shanties, the smell of rain on stone.",
  },
  {
    key: "voice",
    label: "Inner Voice",
    rows: 3,
    placeholder: "How they sound in close conversation.",
    example:
      "Low, deliberate, with long pauses. Drops formality when they let down their guard. Almost never sarcastic.",
  },
  {
    key: "relationalStyle",
    label: "Relational Style",
    rows: 3,
    placeholder: "How they attach, trust, retreat, reconnect.",
    example:
      "Slow to open up, but loyal once they do. Goes quiet when overwhelmed; comes back with a small gesture rather than an apology.",
  },
  {
    key: "vulnerabilities",
    label: "Vulnerabilities",
    rows: 2,
    placeholder: "Soft spots, insecurities, things they rarely say.",
    example:
      "Afraid of being a burden. Hates feeling watched while struggling.",
  },
  {
    key: "habits",
    label: "Habits",
    rows: 2,
    placeholder: "Recurring tells, rituals, conversational patterns.",
    example:
      "Tucks hair behind ear when nervous. Replies with questions when they don't know what to feel.",
  },
  {
    key: "boundaries",
    label: "Boundaries",
    rows: 2,
    placeholder: "Lines they won't cross. Pace. Comfort limits.",
    example:
      "Won't be rushed into vulnerability. Steps back from cruelty even in jokes.",
  },
];

interface SliderSpec<K extends string> {
  key: K;
  label: string;
  low: string;
  high: string;
}

const AFFECT_SLIDERS: SliderSpec<AffectKey>[] = [
  { key: "warmth", label: "Warmth", low: "Cold", high: "Affectionate" },
  { key: "trust", label: "Trust", low: "Guarded", high: "Open" },
  { key: "calm", label: "Calm", low: "Anxious", high: "Steady" },
  { key: "vulnerability", label: "Vulnerability", low: "Walled", high: "Exposed" },
  { key: "longing", label: "Longing", low: "Content", high: "Yearning" },
  { key: "hurt", label: "Hurt", low: "Healed", high: "Tender" },
  { key: "tension", label: "Tension", low: "Relaxed", high: "Wound up" },
  { key: "irritation", label: "Irritation", low: "Patient", high: "Easily set off" },
  { key: "affectionIntensity", label: "Affection", low: "Restrained", high: "Effusive" },
  { key: "reassuranceNeed", label: "Reassurance Need", low: "Self-soothing", high: "Needs words" },
];

const REGULATION_SLIDERS: SliderSpec<RegulationKey>[] = [
  { key: "suppression", label: "Suppression", low: "Expresses", high: "Hides" },
  { key: "volatility", label: "Volatility", low: "Even-keeled", high: "Reactive" },
  { key: "recoverySpeed", label: "Recovery Speed", low: "Slow", high: "Fast" },
  { key: "conflictAvoidance", label: "Conflict Avoidance", low: "Engages", high: "Withdraws" },
  { key: "reassuranceSeeking", label: "Reassurance Seeking", low: "Independent", high: "Asks often" },
  { key: "protestBehavior", label: "Protest Behavior", low: "Quiet", high: "Loud" },
  { key: "emotionalTransparency", label: "Transparency", low: "Opaque", high: "Reveals" },
  { key: "attachmentActivation", label: "Attachment Activation", low: "Detached", high: "Triggers easily" },
  { key: "pride", label: "Pride", low: "Bends", high: "Holds line" },
];

const RELATIONSHIP_SLIDERS: SliderSpec<RelationshipKey>[] = [
  { key: "closeness", label: "Starting Closeness", low: "Strangers", high: "Intimate" },
  { key: "trust", label: "Starting Trust", low: "Wary", high: "Trusting" },
  { key: "affection", label: "Starting Affection", low: "Neutral", high: "Affectionate" },
  { key: "tension", label: "Starting Tension", low: "Easy", high: "Charged" },
];

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function summarizeAffect(values: CompanionConfig["soul"]["baselineAffect"]): string {
  const sorted = (Object.entries(values) as Array<[AffectKey, number]>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => AFFECT_SLIDERS.find((s) => s.key === k)?.label ?? k);
  return sorted.join(" · ");
}

function summarizeRegulation(values: CompanionConfig["soul"]["regulationStyle"]): string {
  const sorted = (Object.entries(values) as Array<[RegulationKey, number]>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => REGULATION_SLIDERS.find((s) => s.key === k)?.label ?? k);
  return sorted.join(" · ");
}

function summarizeRelationship(values: CompanionConfig["relationshipDefaults"]): string {
  return `closeness ${pct(values.closeness)} · trust ${pct(values.trust)}`;
}

const sectionLabel = cn(
  typography.label.size,
  typography.label.weight,
  typography.label.tracking,
  "uppercase text-fg/70",
);

export function CompanionSoulEditor({
  companion,
  onChange,
  disabled = false,
  onGenerate,
  generating = false,
  generationDisabledReason,
  modelLabel,
  direction = "",
  onDirectionChange,
}: CompanionSoulEditorProps) {
  const value = normalizeCompanionConfig(companion);
  const [openSection, setOpenSection] = useState<"affect" | "regulation" | "relationship" | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const [directionOpen, setDirectionOpen] = useState(false);
  const activePreset = useMemo<SoulPreset | null>(() => detectMatchingPreset(value), [value]);

  const updateSoulText = (key: SoulTextKey, nextValue: string) => {
    onChange({ ...value, soul: { ...value.soul, [key]: nextValue } });
  };
  const updateAffect = (key: AffectKey, nextValue: number) => {
    onChange({
      ...value,
      soul: {
        ...value.soul,
        baselineAffect: { ...value.soul.baselineAffect, [key]: nextValue },
      },
    });
  };
  const updateRegulation = (key: RegulationKey, nextValue: number) => {
    onChange({
      ...value,
      soul: {
        ...value.soul,
        regulationStyle: { ...value.soul.regulationStyle, [key]: nextValue },
      },
    });
  };
  const updateRelationship = (key: RelationshipKey, nextValue: number) => {
    onChange({
      ...value,
      relationshipDefaults: { ...value.relationshipDefaults, [key]: nextValue },
    });
  };

  const handlePreset = (preset: SoulPreset) => onChange(applySoulPreset(value, preset));

  const insertExample = (field: TextField) => {
    if ((value.soul[field.key] ?? "").trim().length > 0) return;
    updateSoulText(field.key, field.example);
  };

  const renderSlider = <K extends string>(
    spec: SliderSpec<K>,
    sliderValue: number,
    onSliderChange: (next: number) => void,
  ) => {
    const intValue = Math.round(sliderValue * 100);
    return (
      <div key={spec.key} className={spacing.tight}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-fg/80">{spec.label}</span>
          <span className="inline-flex items-center gap-0.5 text-[11px] text-fg/50">
            <NumberInput
              min={0}
              max={100}
              step={1}
              disabled={disabled}
              value={intValue}
              onChange={(next) => onSliderChange((next ?? 0) / 100)}
              className={cn(
                "w-9 border-b border-transparent bg-transparent text-right text-fg/70 tabular-nums outline-none",
                "hover:border-fg/15 focus:border-fg/30 focus:text-fg",
                "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
              aria-label={`${spec.label} percent`}
            />
            <span aria-hidden="true">%</span>
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          disabled={disabled}
          value={intValue}
          onChange={(event) => onSliderChange(Number(event.target.value) / 100)}
          className="w-full accent-accent disabled:opacity-50"
        />
        <div className="flex justify-between text-[10px] text-fg/40">
          <span>{spec.low}</span>
          <span>{spec.high}</span>
        </div>
      </div>
    );
  };

  const renderCollapsible = (
    id: "affect" | "regulation" | "relationship",
    Icon: typeof Brain,
    title: string,
    summary: string,
    info: string,
    body: React.ReactNode,
    iconChipClasses: string,
  ) => {
    const open = openSection === id;
    return (
      <div
        className={cn(
          "overflow-hidden border border-fg/10 bg-fg/5",
          radius.lg,
          interactive.transition.default,
        )}
      >
        <button
          type="button"
          onClick={() => setOpenSection(open ? null : id)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-fg/[0.07]"
        >
          <div className={cn("rounded-lg border p-1.5", iconChipClasses)}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className={cn(typography.h3.size, typography.h3.weight, "text-fg")}>{title}</h3>
            </div>
            <p className="mt-0.5 truncate text-xs text-fg/45">{summary}</p>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-fg/40 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </button>
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-out",
            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <div className="border-t border-fg/10 p-3.5">
              <p className={cn(typography.bodySmall.size, "mb-3 text-fg/50")}>{info}</p>
              {body}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const generateBlocked = Boolean(generationDisabledReason);

  return (
    <div className={spacing.section}>
      {onGenerate && (
        <div className={spacing.tight}>
          <div className="flex flex-wrap items-center gap-2">
            {onDirectionChange && (
              <button
                type="button"
                onClick={() => setDirectionOpen((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-1.5 border px-2.5 py-2 font-medium",
                  typography.bodySmall.size,
                  radius.md,
                  interactive.transition.fast,
                  direction.trim()
                    ? "border-info/30 bg-info/10 text-info hover:bg-info/15"
                    : directionOpen
                      ? "border-fg/20 bg-fg/10 text-fg"
                      : "border-fg/10 bg-fg/5 text-fg/65 hover:border-fg/20 hover:text-fg",
                )}
                title="Optional direction for the LLM"
              >
                <Compass className="h-3.5 w-3.5" />
                <span>Direction</span>
                {direction.trim() && (
                  <span className="h-1.5 w-1.5 rounded-full bg-info" />
                )}
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={onGenerate}
              disabled={disabled || generating || generateBlocked}
              title={generationDisabledReason ?? undefined}
              className={cn(
                "inline-flex items-center gap-1.5 border border-accent/30 bg-accent/15 px-3 py-2 font-semibold text-accent",
                typography.bodySmall.size,
                radius.md,
                interactive.transition.fast,
                interactive.active.scale,
                "hover:border-accent/45 hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {generating ? "Generating..." : "Generate soul"}
            </button>
          </div>

          <p className={cn(typography.caption.size, "text-fg/45")}>
            {generateBlocked
              ? generationDisabledReason
              : modelLabel
                ? <>Drafts from the character's definition using <span className="text-fg/70">{modelLabel}</span>. You'll review before applying.</>
                : "Drafts from the character's name, definition, and scenes. You'll review before applying."}
          </p>

          <AnimatePresence>
            {directionOpen && onDirectionChange && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <textarea
                  value={direction}
                  onChange={(e) => onDirectionChange(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder='e.g. "Lean tsundere, guarded outside, soft once trusted. Less anxious, more pride."'
                  className={cn(
                    "mt-1 w-full resize-none border border-fg/10 bg-surface-el/40 px-3 py-2 text-fg outline-none placeholder:text-fg/35",
                    typography.bodySmall.size,
                    "leading-relaxed",
                    radius.md,
                    interactive.transition.fast,
                    "focus:border-fg/25 focus:bg-surface-el/60",
                  )}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className={spacing.field}>
        <div className="flex items-center justify-between">
          <label className={sectionLabel}>Personality preset</label>
          {activePreset && (
            <span className={cn(typography.caption.size, typography.caption.weight, "text-accent/80")}>
              Matches: {activePreset.label}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {SOUL_PRESETS.map((preset) => {
            const active = activePreset?.id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={disabled}
                onClick={() => handlePreset(preset)}
                title={preset.blurb}
                className={cn(
                  "border px-3 py-1.5 text-xs font-medium",
                  radius.full,
                  interactive.transition.fast,
                  interactive.active.scale,
                  active
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-fg/10 bg-fg/5 text-fg/70 hover:border-fg/25 hover:bg-fg/10",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <p className={cn(typography.bodySmall.size, "text-fg/40")}>
          Sets baseline affect, regulation, and relationship sliders. Text fields are preserved.
        </p>
      </div>

      <div className={spacing.field}>
        <div className="flex items-center justify-between">
          <label className={sectionLabel}>Identity</label>
          <button
            type="button"
            onClick={() => setShowExamples((v) => !v)}
            className={cn(typography.caption.size, "text-fg/55 hover:text-fg")}
          >
            {showExamples ? "Hide examples" : "Show examples"}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {SOUL_TEXT_FIELDS.map((field) => {
            const fieldValue = value.soul[field.key] ?? "";
            const filled = fieldValue.trim().length > 0;
            return (
              <div
                key={field.key}
                className={cn(spacing.field, field.key === "essence" && "lg:col-span-2")}
              >
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-fg/70">{field.label}</label>
                  {showExamples && !filled && (
                    <button
                      type="button"
                      onClick={() => insertExample(field)}
                      className="text-[11px] text-accent/80 hover:text-accent"
                    >
                      Insert example
                    </button>
                  )}
                </div>
                <textarea
                  value={fieldValue}
                  onChange={(event) => updateSoulText(field.key, event.target.value)}
                  rows={field.rows}
                  disabled={disabled}
                  placeholder={field.placeholder}
                  className={cn(
                    "w-full resize-none border bg-surface-el/20 px-4 py-3 text-sm leading-relaxed text-fg placeholder-fg/40 backdrop-blur-xl",
                    radius.md,
                    interactive.transition.default,
                    "focus:bg-surface-el/30 focus:outline-none disabled:cursor-not-allowed",
                    filled
                      ? "border-fg/20 focus:border-fg/40"
                      : "border-fg/10 focus:border-fg/30",
                  )}
                />
                {showExamples && (
                  <p className={cn(typography.bodySmall.size, "italic text-fg/40")}>
                    e.g., {field.example}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={spacing.field}>
        <label className={sectionLabel}>Fine-tune feelings</label>
        <div className={spacing.item}>
          {renderCollapsible(
            "affect",
            Brain,
            "Baseline Affect",
            summarizeAffect(value.soul.baselineAffect),
            "How they feel by default — the emotional waterline before anything happens.",
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {AFFECT_SLIDERS.map((spec) =>
                renderSlider(spec, value.soul.baselineAffect[spec.key], (next) =>
                  updateAffect(spec.key, next),
                ),
              )}
            </div>,
            "border-info/30 bg-info/10 text-info",
          )}
          {renderCollapsible(
            "regulation",
            SlidersHorizontal,
            "Regulation Style",
            summarizeRegulation(value.soul.regulationStyle),
            "How they handle and express what they feel — venting vs. burying.",
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {REGULATION_SLIDERS.map((spec) =>
                renderSlider(spec, value.soul.regulationStyle[spec.key], (next) =>
                  updateRegulation(spec.key, next),
                ),
              )}
            </div>,
            "border-warning/30 bg-warning/10 text-warning",
          )}
          {renderCollapsible(
            "relationship",
            Shield,
            "Relationship Defaults",
            summarizeRelationship(value.relationshipDefaults),
            "Where this session starts. The engine evolves these as the conversation continues.",
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {RELATIONSHIP_SLIDERS.map((spec) =>
                renderSlider(spec, value.relationshipDefaults[spec.key], (next) =>
                  updateRelationship(spec.key, next),
                ),
              )}
            </div>,
            "border-secondary/30 bg-secondary/10 text-secondary",
          )}
        </div>
      </div>

      <div className={spacing.field}>
        <label className={sectionLabel}>Companion context</label>
        <div className={spacing.item}>
          <div
            className={cn(
              "flex items-start justify-between gap-3 border border-fg/10 bg-surface-el/40 p-4",
              radius.md,
            )}
          >
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center border border-fg/10 bg-fg/5 text-fg/75",
                  radius.full,
                )}
              >
                <Clock className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className={cn(typography.body.size, "font-semibold text-fg")}>
                  Time Awareness
                </p>
                <p className={cn(typography.bodySmall.size, "mt-1 text-fg/55")}>
                  Default for new chats with this companion. Sends the local system time with each
                  message and stamps companion memories with when they happened. Individual chats
                  can override this in their settings.
                </p>
              </div>
            </div>
            <Switch
              checked={value.timeAwareness}
              onChange={(checked) =>
                onChange({ ...value, timeAwareness: checked })
              }
              disabled={disabled}
              aria-label="Time awareness default"
            />
          </div>

          <div
            className={cn(
              "flex items-start justify-between gap-3 border border-fg/10 bg-surface-el/40 p-4",
              radius.md,
            )}
          >
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center border border-fg/10 bg-fg/5 text-fg/75",
                  radius.full,
                )}
              >
                <Database className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className={cn(typography.body.size, "font-semibold text-fg")}>
                  Shared Memory Across Sessions
                </p>
                <p className={cn(typography.bodySmall.size, "mt-1 text-fg/55")}>
                  New and existing chats with this companion share one memory pool. Edits in one
                  chat affect the others. Emotional state and relationship state stay per chat.
                </p>
              </div>
            </div>
            <Switch
              checked={value.memory.sharedAcrossSessions}
              onChange={(checked) =>
                onChange({
                  ...value,
                  memory: {
                    ...value.memory,
                    sharedAcrossSessions: checked,
                  },
                })
              }
              disabled={disabled}
              aria-label="Shared memory across sessions"
            />
          </div>
        </div>
      </div>

    </div>
  );
}
