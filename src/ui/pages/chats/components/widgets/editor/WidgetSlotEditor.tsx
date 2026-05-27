import { useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import type { WidgetNode } from "../../../../../../core/storage/chatWidgetSchemas";
import { createWidgetNode, widgetSummary, WIDGET_TYPE_LABEL } from "./widgetFactories";
import { WidgetTypePickerSheet } from "./WidgetTypePickerSheet";
import { WidgetConfigSheet } from "./WidgetConfigSheet";

interface WidgetSlotEditorProps {
  label: string;
  nodes: WidgetNode[];
  onChange: (next: WidgetNode[]) => void;
}

export function WidgetSlotEditor({ label, nodes, onChange }: WidgetSlotEditorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<WidgetNode | null>(null);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-fg/10 bg-fg/3 px-3 py-3">
      <header className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-fg/35">
          {label}
        </span>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/20"
        >
          <Plus size={12} strokeWidth={2.4} />
          Add
        </button>
      </header>

      {nodes.length === 0 ? (
        <p className="text-[11px] italic text-fg/35">No widgets yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {nodes.map((node, i) => (
            <WidgetRow
              key={node.id}
              node={node}
              canMoveUp={i > 0}
              canMoveDown={i < nodes.length - 1}
              onMoveUp={() => onChange(moveItem(nodes, i, -1))}
              onMoveDown={() => onChange(moveItem(nodes, i, 1))}
              onEdit={() => setEditing(node)}
              onDelete={() => onChange(nodes.filter((_, j) => j !== i))}
              onChildrenChange={
                node.type === "box"
                  ? (children) =>
                      onChange(
                        nodes.map((n, j) =>
                          j === i && n.type === "box" ? { ...n, children } : n,
                        ),
                      )
                  : undefined
              }
            />
          ))}
        </ul>
      )}

      <WidgetTypePickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(type) => onChange([...nodes, createWidgetNode(type)])}
      />
      <WidgetConfigSheet
        open={editing !== null}
        node={editing}
        onClose={() => setEditing(null)}
        onSave={(next) =>
          onChange(nodes.map((n) => (n.id === next.id ? next : n)))
        }
      />
    </div>
  );
}

interface WidgetRowProps {
  node: WidgetNode;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onChildrenChange?: (children: WidgetNode[]) => void;
}

function WidgetRow({
  node,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
  onChildrenChange,
}: WidgetRowProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-fg/8 bg-fg/4 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.2em] text-fg/35">
            {WIDGET_TYPE_LABEL[node.type]}
          </div>
          <div className="truncate text-[12px] text-fg/75">{widgetSummary(node)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton onClick={onMoveUp} disabled={!canMoveUp} aria-label="Move up">
            <ChevronUp size={14} strokeWidth={2.2} />
          </IconButton>
          <IconButton onClick={onMoveDown} disabled={!canMoveDown} aria-label="Move down">
            <ChevronDown size={14} strokeWidth={2.2} />
          </IconButton>
          <IconButton onClick={onEdit} aria-label="Edit widget">
            <Pencil size={13} strokeWidth={2.2} />
          </IconButton>
          <IconButton onClick={onDelete} aria-label="Delete widget" danger>
            <Trash2 size={13} strokeWidth={2.2} />
          </IconButton>
        </div>
      </div>
      {node.type === "box" && onChildrenChange && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="self-start text-[11px] text-accent/80 hover:text-accent"
          >
            {expanded ? "Hide" : "Show"} children ({node.children.length})
          </button>
          {expanded && (
            <div className="ml-2 border-l border-fg/10 pl-2">
              <WidgetSlotEditor
                label="Box children"
                nodes={node.children}
                onChange={onChildrenChange}
              />
            </div>
          )}
        </>
      )}
    </li>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  danger,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  "aria-label": string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`flex h-6 w-6 items-center justify-center rounded-md transition ${
        disabled
          ? "cursor-not-allowed text-fg/20"
          : danger
            ? "text-fg/55 hover:bg-danger/15 hover:text-danger"
            : "text-fg/55 hover:bg-fg/10 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function moveItem<T>(arr: T[], index: number, delta: -1 | 1): T[] {
  const next = [...arr];
  const target = index + delta;
  if (target < 0 || target >= next.length) return arr;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
