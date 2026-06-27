import { Reorder, useDragControls } from "framer-motion";
import { GripVertical, RotateCcw } from "lucide-react";

import {
  DEFAULT_LLAMA_SAMPLER_ORDER,
  LLAMA_SAMPLER_ORDER_PRESETS,
  normalizeLlamaSamplerOrder,
  type LlamaSamplerOrderPreset,
  type LlamaSamplerOrderStage,
} from "../../core/storage/schemas";
import { cn } from "../design-tokens";
import { useI18n, type TranslationKey } from "../../core/i18n/context";

const STAGE_META: Record<
  LlamaSamplerOrderStage,
  { labelKey?: TranslationKey; descriptionKey?: TranslationKey; label: string; description: string }
> = {
  penalties: {
    labelKey: "samplerOrder.stages.penalties.label",
    descriptionKey: "samplerOrder.stages.penalties.desc",
    label: "Penalties",
    description: "Apply frequency and presence penalties before filtering.",
  },
  grammar: {
    labelKey: "samplerOrder.stages.grammar.label",
    descriptionKey: "samplerOrder.stages.grammar.desc",
    label: "Grammar",
    description: "Constrain tokens when a native chat template grammar is active.",
  },
  top_k: {
    labelKey: "samplerOrder.stages.topK.label",
    descriptionKey: "samplerOrder.stages.topK.desc",
    label: "Top K",
    description: "Trim the candidate pool to the strongest tokens.",
  },
  top_p: {
    labelKey: "samplerOrder.stages.topP.label",
    descriptionKey: "samplerOrder.stages.topP.desc",
    label: "Top P",
    description: "Apply nucleus filtering to the remaining distribution.",
  },
  min_p: {
    labelKey: "samplerOrder.stages.minP.label",
    descriptionKey: "samplerOrder.stages.minP.desc",
    label: "Min P",
    description: "Drop low-probability tail tokens using a minimum floor.",
  },
  dry: {
    labelKey: "samplerOrder.stages.dry.label",
    descriptionKey: "samplerOrder.stages.dry.description",
    label: "DRY",
    description: "Penalize repeated multi-token sequences before they loop.",
  },
  typical: {
    labelKey: "samplerOrder.stages.typical.label",
    descriptionKey: "samplerOrder.stages.typical.desc",
    label: "Typical P",
    description: "Prefer statistically typical tokens in the current distribution.",
  },
  xtc: {
    labelKey: "samplerOrder.stages.xtc.label",
    descriptionKey: "samplerOrder.stages.xtc.desc",
    label: "XTC",
    description: "Exclude Top Choices — drops high-probability tokens for variety.",
  },
  temp: {
    labelKey: "samplerOrder.stages.temp.label",
    descriptionKey: "samplerOrder.stages.temp.desc",
    label: "Temperature",
    description: "Flatten or sharpen the final distribution before selection.",
  },
};

const PRESET_META: Record<
  LlamaSamplerOrderPreset,
  { labelKey: TranslationKey; hintKey: TranslationKey }
> = {
  default: { labelKey: "samplerOrder.presets.default.label", hintKey: "samplerOrder.presets.default.hint" },
  unsloth: { labelKey: "samplerOrder.presets.unsloth.label", hintKey: "samplerOrder.presets.unsloth.hint" },
  focused: { labelKey: "samplerOrder.presets.focused.label", hintKey: "samplerOrder.presets.focused.hint" },
  creative: { labelKey: "samplerOrder.presets.creative.label", hintKey: "samplerOrder.presets.creative.hint" },
};

function ordersEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((stage, index) => stage === right[index]);
}

export function LlamaSamplerOrderEditor({
  value,
  onChange,
  className,
}: {
  value: LlamaSamplerOrderStage[] | null | undefined;
  onChange: (value: LlamaSamplerOrderStage[]) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const order = normalizeLlamaSamplerOrder(value) ?? [...DEFAULT_LLAMA_SAMPLER_ORDER];
  const activePreset =
    (Object.entries(LLAMA_SAMPLER_ORDER_PRESETS).find(([, presetOrder]) =>
      ordersEqual(order, presetOrder),
    )?.[0] as LlamaSamplerOrderPreset | undefined) ?? null;
  const isDefault = activePreset === "default";

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <span className="block text-[13px] font-medium text-fg/70">{t("samplerOrder.title")}</span>
          <span className="block text-[13px] text-fg/40">
            {t("samplerOrder.description")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onChange([...DEFAULT_LLAMA_SAMPLER_ORDER])}
          disabled={isDefault}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition",
            isDefault
              ? "cursor-default border-fg/5 bg-transparent text-fg/25"
              : "border-fg/10 bg-fg/5 text-fg/65 hover:border-fg/20 hover:bg-fg/8 hover:text-fg",
          )}
          aria-label={t("samplerOrder.resetAria")}
        >
          <RotateCcw size={12} />
          {t("samplerOrder.reset")}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(LLAMA_SAMPLER_ORDER_PRESETS) as LlamaSamplerOrderPreset[]).map((preset) => {
          const isActive = activePreset === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChange([...LLAMA_SAMPLER_ORDER_PRESETS[preset]])}
              className={cn(
                "group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition",
                isActive
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-fg/10 bg-fg/5 text-fg/70 hover:border-fg/20 hover:bg-fg/8 hover:text-fg",
              )}
            >
              <span className="font-medium">{t(PRESET_META[preset].labelKey)}</span>
              <span
                className={cn(
                  "text-[10px] transition",
                  isActive ? "text-accent/70" : "text-fg/35 group-hover:text-fg/50",
                )}
              >
                {t(PRESET_META[preset].hintKey)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-fg/10 bg-fg/[0.03]">
        <Reorder.Group
          axis="y"
          values={order}
          onReorder={(nextOrder) => onChange(nextOrder)}
          className="divide-y divide-fg/8"
        >
          {order.map((stage, index) => (
            <SamplerOrderItem key={stage} stage={stage} index={index} />
          ))}
        </Reorder.Group>
      </div>
    </div>
  );
}

function SamplerOrderItem({
  stage,
  index,
}: {
  stage: LlamaSamplerOrderStage;
  index: number;
}) {
  const { t } = useI18n();
  const controls = useDragControls();
  const meta = STAGE_META[stage];
  const label = meta.labelKey ? t(meta.labelKey) : meta.label;
  const description = meta.descriptionKey ? t(meta.descriptionKey) : meta.description;

  return (
    <Reorder.Item
      value={stage}
      dragListener={false}
      dragControls={controls}
      dragMomentum={false}
      dragElastic={0}
      layout="position"
      whileDrag={{
        zIndex: 20,
        boxShadow: "0 16px 32px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.06)",
      }}
      transition={{ layout: { duration: 0.18, ease: "easeOut" } }}
      className="flex items-center gap-3 bg-transparent px-3 py-2.5"
      style={{ position: "relative" }}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-fg/10 bg-fg/5 text-[10px] font-semibold tabular-nums text-fg/55">
        {index + 1}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-fg">{label}</div>
        <div className="text-[11px] leading-relaxed text-fg/45">
          {description}
        </div>
      </div>
      <button
        type="button"
        onPointerDown={(event) => controls.start(event)}
        className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-fg/40 transition hover:bg-fg/8 hover:text-fg/80 active:cursor-grabbing"
        aria-label={t("samplerOrder.dragToReorder", { label })}
      >
        <GripVertical size={14} />
      </button>
    </Reorder.Item>
  );
}
