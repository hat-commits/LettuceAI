import {
  ArrowLeftRight,
  Box as BoxIcon,
  Image as ImageIcon,
  ListChecks,
  Minus,
  NotebookPen,
  User,
  UserCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BottomMenu, MenuButton } from "../../../../../components";
import {
  WIDGET_TYPE_DESC,
  WIDGET_TYPE_LABEL,
  type WidgetType,
} from "./widgetFactories";

const TYPE_ORDER: WidgetType[] = [
  "character_info",
  "persona_info",
  "scratch_pad",
  "selector",
  "button",
  "image",
  "box",
  "divider",
];

const TYPE_ICON: Record<WidgetType, LucideIcon> = {
  divider: Minus,
  box: BoxIcon,
  character_info: User,
  persona_info: UserCircle,
  scratch_pad: NotebookPen,
  image: ImageIcon,
  selector: ListChecks,
  button: ArrowLeftRight,
};

interface WidgetTypePickerSheetProps {
  open: boolean;
  onClose: () => void;
  onPick: (type: WidgetType) => void;
}

export function WidgetTypePickerSheet({
  open,
  onClose,
  onPick,
}: WidgetTypePickerSheetProps) {
  return (
    <BottomMenu isOpen={open} onClose={onClose} title="Add widget">
      <div className="flex flex-col gap-2">
        {TYPE_ORDER.map((type) => (
          <MenuButton
            key={type}
            icon={TYPE_ICON[type]}
            title={WIDGET_TYPE_LABEL[type]}
            description={WIDGET_TYPE_DESC[type]}
            onClick={() => {
              onPick(type);
              onClose();
            }}
          />
        ))}
      </div>
    </BottomMenu>
  );
}
