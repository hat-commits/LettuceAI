import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, ImagePlus, Loader2, Upload } from "lucide-react";
import { BottomMenu } from "../../../../../components";
import type {
  BoxNode,
  BoxVariant,
  ButtonAction,
  ButtonNode,
  DividerNode,
  ImageNode,
  ImageShape,
  ImageSource,
  ScratchPadNode,
  SelectorKind,
  SelectorNode,
  WidgetNode,
} from "../../../../../../core/storage/chatWidgetSchemas";
import { convertToImageRef } from "../../../../../../core/storage/images";
import { useImageData } from "../../../../../hooks/useImageData";
import { WIDGET_TYPE_LABEL } from "./widgetFactories";
import { useWidgetEdit } from "../WidgetEditContext";

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

const TEXT_INPUT_CLASS =
  "w-full rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-sm text-fg/80 focus:border-accent/40 focus:outline-none";

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

function renderBody(
  draft: WidgetNode,
  setDraft: (next: WidgetNode) => void,
  onChooseLibrary: () => void,
): React.ReactNode {
  switch (draft.type) {
    case "divider":
      return <DividerForm node={draft} setNode={setDraft} />;
    case "box":
      return <BoxForm node={draft} setNode={setDraft} />;
    case "character_info":
    case "persona_info":
      return (
        <p className="text-[12px] italic text-fg/50">
          This widget has no configuration yet.
        </p>
      );
    case "scratch_pad":
      return <ScratchPadForm node={draft} setNode={setDraft} />;
    case "image":
      return <ImageForm node={draft} setNode={setDraft} onChooseLibrary={onChooseLibrary} />;
    case "selector":
      return <SelectorForm node={draft} setNode={setDraft} />;
    case "button":
      return <ButtonForm node={draft} setNode={setDraft} />;
  }
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
