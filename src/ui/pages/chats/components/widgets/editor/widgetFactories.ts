import { uuidv4 } from "../../../../../../core/storage/repo";
import type { WidgetNode } from "../../../../../../core/storage/chatWidgetSchemas";

export type WidgetType = WidgetNode["type"];

export const WIDGET_TYPE_LABEL: Record<WidgetType, string> = {
  divider: "Divider",
  box: "Box",
  character_info: "Character info",
  persona_info: "Persona info",
  scratch_pad: "Scratch pad",
  image: "Image",
  selector: "Selector",
  button: "Button",
};

export const WIDGET_TYPE_DESC: Record<WidgetType, string> = {
  divider: "A line or space between widgets.",
  box: "Group widgets with an optional title and color.",
  character_info: "Avatar, name, and description of the current character.",
  persona_info: "Avatar, name, and description of the current persona.",
  scratch_pad: "Markdown notes that travel with the chat.",
  image: "Picture from character, persona, library, or upload.",
  selector: "Pick persona, model, or fallback model.",
  button: "Trigger an action like regenerate or swap places.",
};

export function createWidgetNode(type: WidgetType): WidgetNode {
  const id = uuidv4();
  switch (type) {
    case "divider":
      return { id, type: "divider", style: "line" };
    case "box":
      return {
        id,
        type: "box",
        variant: "default",
        title: "Untitled",
        children: [],
      };
    case "character_info":
      return { id, type: "character_info" };
    case "persona_info":
      return { id, type: "persona_info" };
    case "scratch_pad":
      return { id, type: "scratch_pad", title: "Notes", content: "" };
    case "image":
      return { id, type: "image", source: { kind: "character_avatar" } };
    case "selector":
      return { id, type: "selector", kind: "persona", title: "Persona" };
    case "button":
      return {
        id,
        type: "button",
        action: "regenerate",
        title: "Regenerate last reply",
      };
  }
}

export function widgetSummary(node: WidgetNode): string {
  switch (node.type) {
    case "divider":
      return node.style === "space" ? "Space" : "Line";
    case "box":
      return node.title || "Untitled box";
    case "character_info":
    case "persona_info":
      return WIDGET_TYPE_LABEL[node.type];
    case "scratch_pad":
      return node.title || "Scratch pad";
    case "image":
      return node.title || `Image: ${node.source.kind.replace("_", " ")}`;
    case "selector":
      return node.title || `Selector: ${node.kind.replace("_", " ")}`;
    case "button":
      return node.title || `Button: ${node.action.replace("_", " ")}`;
  }
}
