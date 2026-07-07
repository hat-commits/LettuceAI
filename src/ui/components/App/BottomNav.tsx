import { MessageCircle, BadgePlus, BookOpen, Users, Compass } from "lucide-react";
import { useLocation } from "react-router-dom";

import { TabItem } from "./NavItem";
import { useI18n } from "../../../core/i18n/context";

export function BottomNav({ onCreateClick }: { onCreateClick: () => void }) {
  const { pathname } = useLocation();
  const { t } = useI18n();

  const handleCreateClick = () => {
    if (typeof window !== "undefined") {
      const globalWindow = window as any;
      if (pathname.startsWith("/settings/providers")) {
        if (typeof globalWindow.__openAddProvider === "function") {
          globalWindow.__openAddProvider();
        } else {
          window.dispatchEvent(new CustomEvent("providers:add"));
        }
        return;
      }

      if (pathname.startsWith("/settings/models")) {
        if (typeof globalWindow.__openAddModel === "function") {
          globalWindow.__openAddModel();
        } else {
          window.dispatchEvent(new CustomEvent("models:add"));
        }
        return;
      }

      if (pathname.startsWith("/settings/prompts")) {
        if (typeof globalWindow.__openAddPromptTemplate === "function") {
          globalWindow.__openAddPromptTemplate();
        } else {
          window.dispatchEvent(new CustomEvent("prompts:add"));
        }
        return;
      }
    }

    onCreateClick();
  };
  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-fg/8 bg-nav/95 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 text-fg shadow-[0_-12px_32px_rgba(0,0,0,0.35)]">
      <div className="mx-auto flex w-full max-w-md lg:max-w-none items-stretch gap-1 lg:gap-2 lg:px-6">
        <TabItem
          to="/chat"
          icon={MessageCircle}
          label={t("common.bottomNav.chats")}
          active={pathname === "/" || pathname.startsWith("/chat")}
          className="flex-1 h-12 text-sm"
          dataTourId="nav-chats"
        />

        <TabItem
          to="/group-chats"
          icon={Users}
          label={t("common.bottomNav.groups")}
          active={pathname.startsWith("/group-chats")}
          className="flex-1 h-12 text-sm"
          dataTourId="nav-groups"
        />

        <button
          onClick={handleCreateClick}
          data-tour-id="nav-create"
          className="flex flex-1 h-12 items-center justify-center rounded-full text-fg/80 transition hover:text-fg active:scale-95"
          aria-label={t("common.bottomNav.create")}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-fg/8 shadow-[0_0_24px_rgba(255,255,255,0.18)]">
            <BadgePlus size={23} strokeWidth={2.2} />
          </span>
        </button>

        <TabItem
          to="/discover"
          icon={Compass}
          label={t("common.bottomNav.discover")}
          active={pathname.startsWith("/discover")}
          className="flex-1 h-12 text-sm"
          dataTourId="nav-discover"
        />

        <TabItem
          to="/library"
          icon={BookOpen}
          label={t("common.bottomNav.library")}
          active={pathname.startsWith("/library")}
          className="flex-1 h-12 text-sm"
          dataTourId="nav-library"
        />
      </div>
    </div>
  );
}
