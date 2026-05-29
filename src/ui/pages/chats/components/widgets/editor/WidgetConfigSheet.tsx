import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, ImagePlus, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { BottomMenu } from "../../../../../components";
import { NumberInput } from "../../../../../components/NumberInput";
import type {
  BoxNode,
  BoxVariant,
  ButtonAction,
  ButtonNode,
  DiceNode,
  DividerNode,
  ImageNode,
  ImageShape,
  ImageSource,
  QuickSnippetsNode,
  ScratchPadNode,
  SelectorKind,
  SelectorNode,
  StatTrackerNode,
  WidgetDesign,
  WidgetNode,
} from "../../../../../../core/storage/chatWidgetSchemas";
import { convertToImageRef } from "../../../../../../core/storage/images";
import { uuidv4 } from "../../../../../../core/storage/repo";
import { useImageData } from "../../../../../hooks/useImageData";
import { WIDGET_TYPE_LABEL } from "./widgetFactories";
import { useWidgetEdit } from "../WidgetEditContext";

const makeId = () => uuidv4();

interface FieldProps {
  label: string;
  children: React.ReactNode;
  hint?: string;
}
function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg/60">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-fg/40">{hint}</span>}
    </label>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}
function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
  return (
    <div
      className={`grid gap-1.5 ${options.length <= 3 ? "grid-cols-3" : "grid-cols-2"}`}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-lg border py-2 text-[11px] font-medium transition ${
            value === opt.value
              ? "border-accent/50 bg-accent/10 text-accent"
              : "border-fg/8 bg-fg/5 text-fg/55 hover:bg-fg/10"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const TEXT_INPUT_BASE =
  "rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg/80 focus:border-accent/40 focus:outline-none";
const TEXT_INPUT_CLASS = `w-full ${TEXT_INPUT_BASE}`;

interface WidgetConfigSheetProps {
  open: boolean;
  node: WidgetNode | null;
  onClose: () => void;
  onSave: (next: WidgetNode) => void;
}

export function WidgetConfigSheet({
  open,
  node,
  onClose,
  onSave,
}: WidgetConfigSheetProps) {
  const edit = useWidgetEdit();
  const [draft, setDraft] = useState<WidgetNode | null>(node);

  useEffect(() => {
    setDraft(node);
  }, [node]);

  if (!draft) {
    return (
      <BottomMenu isOpen={open} onClose={onClose} title="Edit widget">
        <div className="px-2 py-4 text-sm text-fg/50">No widget selected.</div>
      </BottomMenu>
    );
  }

  const commit = () => {
    onSave(draft);
    onClose();
  };

  const chooseLibrary = () => {
    if (draft.type !== "image") return;
    const next: WidgetNode = {
      ...draft,
      source: {
        kind: "library",
        path: draft.source.kind === "library" ? draft.source.path : "",
      },
    };
    edit.chooseLibraryImage(next);
  };

  return (
    <BottomMenu
      isOpen={open}
      onClose={onClose}
      title={WIDGET_TYPE_LABEL[draft.type]}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          commit();
        }}
      >
        {renderBody(draft, setDraft, chooseLibrary)}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg/70 hover:bg-fg/10"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg border border-accent/40 bg-accent/15 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/25"
          >
            Save
          </button>
        </div>
      </form>
    </BottomMenu>
  );
}

function DesignField({
  node,
  setNode,
}: {
  node: WidgetNode;
  setNode: (n: WidgetNode) => void;
}) {
  return (
    <Field label="Design">
      <Segmented<WidgetDesign>
        value={node.design ?? "default"}
        options={[
          { value: "default", label: "Default" },
          { value: "minimal", label: "Minimal" },
          { value: "solid", label: "Solid" },
          { value: "outline", label: "Outline" },
        ]}
        onChange={(v) => setNode({ ...node, design: v })}
      />
    </Field>
  );
}

function renderBody(
  draft: WidgetNode,
  setDraft: (next: WidgetNode) => void,
  onChooseLibrary: () => void,
): React.ReactNode {
  const design =
    draft.type !== "divider" && draft.type !== "box" ? (
      <DesignField node={draft} setNode={setDraft} />
    ) : null;
  switch (draft.type) {
    case "divider":
      return <DividerForm node={draft} setNode={setDraft} />;
    case "box":
      return <BoxForm node={draft} setNode={setDraft} />;
    case "character_info":
    case "persona_info":
      return design;
    case "scratch_pad":
      return (
        <>
          <ScratchPadForm node={draft} setNode={setDraft} />
          {design}
        </>
      );
    case "image":
      return (
        <>
          <ImageForm node={draft} setNode={setDraft} onChooseLibrary={onChooseLibrary} />
          {design}
        </>
      );
    case "selector":
      return (
        <>
          <SelectorForm node={draft} setNode={setDraft} />
          {design}
        </>
      );
    case "button":
      return (
        <>
          <ButtonForm node={draft} setNode={setDraft} />
          {design}
        </>
      );
    case "stat_tracker":
      return (
        <>
          <StatTrackerForm node={draft} setNode={setDraft} />
          {design}
        </>
      );
    case "quick_snippets":
      return (
        <>
          <QuickSnippetsForm node={draft} setNode={setDraft} />
          {design}
        </>
      );
    case "dice":
      return (
        <>
          <DiceForm node={draft} setNode={setDraft} />
          {design}
        </>
      );
    case "memory":
      return (
        <>
          <TitleOnlyForm node={draft} setNode={setDraft} />
          <Field label="Max entries shown" hint="Most recent memories to display.">
            <input
              type="number"
              min={1}
              max={100}
              className={TEXT_INPUT_CLASS}
              value={draft.limit ?? 10}
              onChange={(e) => {
                const n = Number(e.target.value);
                setDraft({ ...draft, limit: Number.isFinite(n) ? n : undefined });
              }}
            />
          </Field>
          {design}
        </>
      );
    case "companion_state":
    case "session_info":
      return (
        <>
          <TitleOnlyForm node={draft} setNode={setDraft} />
          {design}
        </>
      );
  }
}

function TitleOnlyForm({
  node,
  setNode,
}: {
  node: WidgetNode & { title?: string };
  setNode: (n: WidgetNode) => void;
}) {
  return (
    <Field label="Title (optional)">
      <input
        type="text"
        className={TEXT_INPUT_CLASS}
        value={node.title ?? ""}
        onChange={(e) => setNode({ ...node, title: e.target.value } as WidgetNode)}
      />
    </Field>
  );
}

function StatTrackerForm({
  node,
  setNode,
}: {
  node: StatTrackerNode;
  setNode: (n: StatTrackerNode) => void;
}) {
  const updateStat = (
    id: string,
    patch: Partial<{ label: string; value: number; min?: number; max?: number }>,
  ) =>
    setNode({
      ...node,
      stats: node.stats.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  return (
    <>
      <Field label="Title (optional)">
        <input
          type="text"
          className={TEXT_INPUT_CLASS}
          value={node.title ?? ""}
          onChange={(e) => setNode({ ...node, title: e.target.value })}
        />
      </Field>
      <Field label="Stats">
        <div className="flex flex-col gap-2">
          {node.stats.map((stat) => (
            <div
              key={stat.id}
              className="flex flex-col gap-2 rounded-lg border border-fg/10 bg-fg/[0.03] p-2"
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Label"
                  className={`${TEXT_INPUT_BASE} min-w-0 flex-1`}
                  value={stat.label}
                  onChange={(e) => updateStat(stat.id, { label: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() =>
                    setNode({ ...node, stats: node.stats.filter((s) => s.id !== stat.id) })
                  }
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-fg/15 bg-fg/5 text-fg/50 hover:border-danger/40 hover:text-danger"
                  aria-label="Remove stat"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-fg/45">
                    Min
                  </span>
                  <NumberInput
                    value={stat.min ?? null}
                    max={stat.max}
                    placeholder="—"
                    className={`${TEXT_INPUT_BASE} w-full`}
                    onChange={(next) => updateStat(stat.id, { min: next ?? undefined })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-fg/45">
                    Start
                  </span>
                  <NumberInput
                    value={stat.value}
                    min={stat.min}
                    max={stat.max}
                    className={`${TEXT_INPUT_BASE} w-full`}
                    onChange={(next) => updateStat(stat.id, { value: next ?? 0 })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-fg/45">
                    Max
                  </span>
                  <NumberInput
                    value={stat.max ?? null}
                    min={stat.min}
                    placeholder="—"
                    className={`${TEXT_INPUT_BASE} w-full`}
                    onChange={(next) => updateStat(stat.id, { max: next ?? undefined })}
                  />
                </label>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setNode({
                ...node,
                stats: [...node.stats, { id: makeId(), label: "Stat", value: 0 }],
              })
            }
            className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-fg/20 py-1.5 text-[11px] font-medium text-fg/60 hover:border-accent/40 hover:text-accent"
          >
            <Plus size={12} strokeWidth={2.4} /> Add stat
          </button>
        </div>
      </Field>
    </>
  );
}

function QuickSnippetsForm({
  node,
  setNode,
}: {
  node: QuickSnippetsNode;
  setNode: (n: QuickSnippetsNode) => void;
}) {
  const updateSnippet = (id: string, patch: Partial<{ label: string; text: string }>) =>
    setNode({
      ...node,
      snippets: node.snippets.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  return (
    <>
      <Field label="Title (optional)">
        <input
          type="text"
          className={TEXT_INPUT_CLASS}
          value={node.title ?? ""}
          onChange={(e) => setNode({ ...node, title: e.target.value })}
        />
      </Field>
      <Field label="Snippets">
        <div className="flex flex-col gap-2">
          {node.snippets.map((snippet) => (
            <div key={snippet.id} className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Label"
                className={`${TEXT_INPUT_BASE} w-24 shrink-0`}
                value={snippet.label}
                onChange={(e) => updateSnippet(snippet.id, { label: e.target.value })}
              />
              <input
                type="text"
                placeholder="Inserted text"
                className={`${TEXT_INPUT_BASE} min-w-0 flex-1`}
                value={snippet.text}
                onChange={(e) => updateSnippet(snippet.id, { text: e.target.value })}
              />
              <button
                type="button"
                onClick={() =>
                  setNode({
                    ...node,
                    snippets: node.snippets.filter((s) => s.id !== snippet.id),
                  })
                }
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-fg/15 bg-fg/5 text-fg/50 hover:border-danger/40 hover:text-danger"
                aria-label="Remove snippet"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setNode({
                ...node,
                snippets: [...node.snippets, { id: makeId(), label: "New", text: "" }],
              })
            }
            className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-fg/20 py-1.5 text-[11px] font-medium text-fg/60 hover:border-accent/40 hover:text-accent"
          >
            <Plus size={12} strokeWidth={2.4} /> Add snippet
          </button>
        </div>
      </Field>
    </>
  );
}

function DiceForm({
  node,
  setNode,
}: {
  node: DiceNode;
  setNode: (n: DiceNode) => void;
}) {
  return (
    <>
      <Field label="Title (optional)">
        <input
          type="text"
          className={TEXT_INPUT_CLASS}
          value={node.title ?? ""}
          onChange={(e) => setNode({ ...node, title: e.target.value })}
        />
      </Field>
      <Field label="Notation" hint="e.g. 1d20, 2d6+3">
        <input
          type="text"
          className={TEXT_INPUT_CLASS}
          value={node.notation ?? ""}
          placeholder="1d20"
          onChange={(e) => setNode({ ...node, notation: e.target.value })}
        />
      </Field>
    </>
  );
}

function DividerForm({
  node,
  setNode,
}: {
  node: DividerNode;
  setNode: (n: DividerNode) => void;
}) {
  return (
    <Field label="Style">
      <Segmented
        value={node.style ?? "line"}
        options={[
          { value: "line", label: "Line" },
          { value: "space", label: "Space" },
        ]}
        onChange={(v) => setNode({ ...node, style: v })}
      />
    </Field>
  );
}

function BoxForm({
  node,
  setNode,
}: {
  node: BoxNode;
  setNode: (n: BoxNode) => void;
}) {
  return (
    <>
      <Field label="Title">
        <input
          type="text"
          className={TEXT_INPUT_CLASS}
          value={node.title ?? ""}
          onChange={(e) => setNode({ ...node, title: e.target.value })}
        />
      </Field>
      <Field label="Description (optional)">
        <input
          type="text"
          className={TEXT_INPUT_CLASS}
          value={node.description ?? ""}
          onChange={(e) => setNode({ ...node, description: e.target.value })}
        />
      </Field>
      <Field label="Variant">
        <Segmented<BoxVariant>
          value={node.variant ?? "default"}
          options={[
            { value: "default", label: "Default" },
            { value: "subtle", label: "Subtle" },
            { value: "info", label: "Info" },
            { value: "warning", label: "Warning" },
            { value: "success", label: "Success" },
            { value: "danger", label: "Danger" },
          ]}
          onChange={(v) => setNode({ ...node, variant: v })}
        />
      </Field>
      <p className="text-[11px] text-fg/40">
        Children are edited from the slot list (each child appears as a row).
      </p>
    </>
  );
}

function ScratchPadForm({
  node,
  setNode,
}: {
  node: ScratchPadNode;
  setNode: (n: ScratchPadNode) => void;
}) {
  return (
    <>
      <Field label="Title">
        <input
          type="text"
          className={TEXT_INPUT_CLASS}
          value={node.title ?? ""}
          onChange={(e) => setNode({ ...node, title: e.target.value })}
        />
      </Field>
      <Field label="Description (optional)">
        <input
          type="text"
          className={TEXT_INPUT_CLASS}
          value={node.description ?? ""}
          onChange={(e) => setNode({ ...node, description: e.target.value })}
        />
      </Field>
      <Field label="Content" hint="Markdown supported.">
        <textarea
          rows={8}
          className={`${TEXT_INPUT_CLASS} resize-y font-mono text-[12px]`}
          value={node.content ?? ""}
          onChange={(e) => setNode({ ...node, content: e.target.value })}
        />
      </Field>
    </>
  );
}

function ImageForm({
  node,
  setNode,
  onChooseLibrary,
}: {
  node: ImageNode;
  setNode: (n: ImageNode) => void;
  onChooseLibrary: () => void;
}) {
  const sourceKind = node.source.kind;
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const updateSource = (next: ImageSource) => setNode({ ...node, source: next });

  const currentPath =
    node.source.kind === "upload" || node.source.kind === "library"
      ? node.source.path
      : "";
  const previewUrl = useImageData(currentPath || null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const id = await convertToImageRef(dataUrl);
      if (id) updateSource({ kind: "upload", path: id });
    } catch (err) {
      console.error("Widget image upload failed:", err);
    } finally {
      setUploadBusy(false);
    }
  };

  const handleSourceClick = (kind: ImageSource["kind"]) => {
    if (kind === "character_avatar") {
      updateSource({ kind: "character_avatar" });
    } else if (kind === "persona_avatar") {
      updateSource({ kind: "persona_avatar" });
    } else if (kind === "library") {
      onChooseLibrary();
    } else {
      if (node.source.kind !== "upload") updateSource({ kind: "upload", path: "" });
      fileRef.current?.click();
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <Field label="Title (optional)">
        <input
          type="text"
          className={TEXT_INPUT_CLASS}
          value={node.title ?? ""}
          onChange={(e) => setNode({ ...node, title: e.target.value })}
        />
      </Field>
      <Field label="Description (optional)">
        <input
          type="text"
          className={TEXT_INPUT_CLASS}
          value={node.description ?? ""}
          onChange={(e) => setNode({ ...node, description: e.target.value })}
        />
      </Field>
      <Field label="Source">
        <Segmented<ImageSource["kind"]>
          value={sourceKind}
          options={[
            { value: "character_avatar", label: "Character" },
            { value: "persona_avatar", label: "Persona" },
            { value: "library", label: "Library" },
            { value: "upload", label: "Upload" },
          ]}
          onChange={handleSourceClick}
        />
      </Field>
      {(sourceKind === "library" || sourceKind === "upload") && (
        <div className="flex items-center gap-3 rounded-lg border border-fg/10 bg-fg/5 p-2.5">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-fg/10 bg-fg/5">
            {uploadBusy ? (
              <div className="flex h-full w-full items-center justify-center text-fg/40">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : previewUrl ? (
              <img src={previewUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-fg/30">
                <ImagePlus size={18} />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-fg/60">
              {currentPath ? "Image selected." : "No image selected yet."}
            </p>
            <button
              type="button"
              onClick={() =>
                sourceKind === "library" ? onChooseLibrary() : fileRef.current?.click()
              }
              className="mt-1.5 flex items-center gap-1.5 rounded-md border border-fg/15 bg-fg/5 px-2.5 py-1.5 text-[12px] text-fg/80 transition hover:bg-fg/10"
            >
              {sourceKind === "library" ? (
                <ImageIcon size={13} />
              ) : (
                <Upload size={13} />
              )}
              {currentPath
                ? sourceKind === "library"
                  ? "Choose another"
                  : "Replace image"
                : sourceKind === "library"
                  ? "Choose from library"
                  : "Choose file"}
            </button>
          </div>
        </div>
      )}
      <Field label="Shape">
        <Segmented<ImageShape>
          value={node.shape ?? "auto"}
          options={[
            { value: "auto", label: "Auto" },
            { value: "square", label: "Square" },
            { value: "wide", label: "Wide" },
            { value: "circle", label: "Circle" },
          ]}
          onChange={(v) => setNode({ ...node, shape: v })}
        />
      </Field>
    </>
  );
}

function SelectorForm({
  node,
  setNode,
}: {
  node: SelectorNode;
  setNode: (n: SelectorNode) => void;
}) {
  return (
    <>
      <Field label="Title (optional)">
        <input
          type="text"
          className={TEXT_INPUT_CLASS}
          value={node.title ?? ""}
          onChange={(e) => setNode({ ...node, title: e.target.value })}
        />
      </Field>
      <Field label="Description (optional)">
        <input
          type="text"
          className={TEXT_INPUT_CLASS}
          value={node.description ?? ""}
          onChange={(e) => setNode({ ...node, description: e.target.value })}
        />
      </Field>
      <Field label="Selects">
        <Segmented<SelectorKind>
          value={node.kind}
          options={[
            { value: "persona", label: "Persona" },
            { value: "model", label: "Model" },
            { value: "fallback_model", label: "Fallback" },
            { value: "author_note", label: "Author's note" },
          ]}
          onChange={(v) => setNode({ ...node, kind: v })}
        />
      </Field>
    </>
  );
}

function ButtonForm({
  node,
  setNode,
}: {
  node: ButtonNode;
  setNode: (n: ButtonNode) => void;
}) {
  return (
    <>
      <Field label="Title (optional)">
        <input
          type="text"
          className={TEXT_INPUT_CLASS}
          value={node.title ?? ""}
          onChange={(e) => setNode({ ...node, title: e.target.value })}
        />
      </Field>
      <Field label="Description (optional)">
        <input
          type="text"
          className={TEXT_INPUT_CLASS}
          value={node.description ?? ""}
          onChange={(e) => setNode({ ...node, description: e.target.value })}
        />
      </Field>
      <Field label="Action">
        <Segmented<ButtonAction>
          value={node.action}
          options={[
            { value: "regenerate", label: "Regenerate" },
            { value: "continue", label: "Continue" },
            { value: "swap_places", label: "Swap places" },
            { value: "abort", label: "Stop" },
            { value: "new_session", label: "New session" },
            { value: "view_history", label: "History" },
            { value: "open_memories", label: "Memories" },
            { value: "open_search", label: "Search" },
            { value: "toggle_voice_autoplay", label: "Voice" },
          ]}
          onChange={(v) => setNode({ ...node, action: v })}
        />
      </Field>
    </>
  );
}
