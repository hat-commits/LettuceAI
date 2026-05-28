import { AnimatePresence, motion } from "framer-motion";
import { Check, Pencil, RotateCcw } from "lucide-react";
import type { WidgetNode } from "../../../../../core/storage/schemas";
import { WidgetRenderer } from "./WidgetRenderer";
import { WidgetEditList } from "./WidgetEditList";
import { WidgetEmptyState } from "./WidgetEmptyState";
import { useWidgetEdit, type WidgetSide } from "./WidgetEditContext";

interface WidgetListProps {
  nodes: WidgetNode[];
  side: WidgetSide;
  canMove: boolean;
}

export function WidgetList({ nodes, side, canMove }: WidgetListProps) {
  const edit = useWidgetEdit();
  const displayNodes = edit.editing ? edit.getNodes(side) : nodes;

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      <Toolbar
        editing={edit.editing}
        saving={edit.saving}
        onEnter={edit.enterEdit}
        onRevert={edit.revert}
        onDone={edit.done}
      />

      {edit.editing ? (
        <WidgetEditList
          nodes={displayNodes}
          onChange={(next) => edit.setNodes(side, next)}
          side={canMove ? side : undefined}
        />
      ) : displayNodes.length === 0 ? (
        <AnimatePresence>
          <WidgetEmptyState key="empty" editing={false} />
        </AnimatePresence>
      ) : (
        <div className="flex flex-col gap-3 px-3 pb-4">
          <AnimatePresence initial={false} mode="popLayout">
            {displayNodes.map((node) => (
              <motion.div
                key={node.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6, transition: { duration: 0.14 } }}
                transition={{ duration: 0.22, ease: "easeOut" }}
              >
                <WidgetRenderer node={node} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

interface ToolbarProps {
  editing: boolean;
  saving: boolean;
  onEnter: () => void;
  onRevert: () => void;
  onDone: () => void;
}

function Toolbar({ editing, saving, onEnter, onRevert, onDone }: ToolbarProps) {
  return (
    <div className="flex min-h-[44px] items-center justify-end gap-2 px-2 py-2">
      <AnimatePresence mode="wait" initial={false}>
        {editing ? (
          <motion.div
            key="edit"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="flex items-center gap-1"
          >
            <button
              type="button"
              onClick={onRevert}
              disabled={saving}
              className="flex items-center gap-1 rounded-md border border-fg/20 bg-surface-el px-2.5 py-1.5 text-[11px] text-fg/80 shadow-sm transition hover:bg-fg/15 disabled:opacity-50"
            >
              <RotateCcw size={11} strokeWidth={2.2} />
              Revert
            </button>
            <button
              type="button"
              onClick={onDone}
              disabled={saving}
              className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-black shadow-sm transition hover:brightness-110 disabled:opacity-50"
            >
              <Check size={12} strokeWidth={2.4} />
              Done
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <button
              type="button"
              onClick={onEnter}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-fg/15 bg-surface-el/80 text-fg/70 backdrop-blur-md transition hover:bg-surface-el hover:text-fg"
              aria-label="Edit widgets"
            >
              <Pencil size={14} strokeWidth={2.2} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
