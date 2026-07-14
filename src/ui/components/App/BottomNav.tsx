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
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-[max(12px,env(safe-area-inset-left))] pb-[calc(env(safe-area-inset-bottom)+15px)] text-fg"
      style={{ paddingRight: "max(12px, env(safe-area-inset-right))" }}
    >
      <div
        className="pointer-events-auto relative mx-auto w-full max-w-md overflow-hidden rounded-[28px] p-px shadow-[0_-12px_30px_rgba(255,255,255,0.08),0_-4px_14px_rgba(255,255,255,0.11),0_12px_30px_rgba(0,0,0,0.30)] lg:max-w-[620px]"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.14) 42%, rgba(255,255,255,0.045) 100%)",
        }}
      >
        <div className="absolute inset-x-5 top-0 h-px bg-white/35 blur-[0.5px]" />
        <div className="relative flex h-[72px] items-stretch gap-1 rounded-[27px] bg-nav/88 px-2 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] backdrop-blur-xl">
          <TabItem
            to="/chat"
            icon={MessageCircle}
            label={t("common.bottomNav.chats")}
            active={pathname === "/" || pathname.startsWith("/chat")}
            className="flex-1 h-14 text-sm"
            dataTourId="nav-chats"
          />

          <TabItem
            to="/group-chats"
            icon={Users}
            label={t("common.bottomNav.groups")}
            active={pathname.startsWith("/group-chats")}
            className="flex-1 h-14 text-sm"
            dataTourId="nav-groups"
          />

          <button
            onClick={handleCreateClick}
            data-tour-id="nav-create"
            className="flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-fg/80 transition hover:text-fg active:scale-95"
            aria-label={t("common.bottomNav.create")}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-fg/8 shadow-[0_0_24px_rgba(255,255,255,0.18)]">
              <BadgePlus size={23} strokeWidth={2.2} />
            </span>
            <span className="text-[10px] leading-none">{t("common.bottomNav.create")}</span>
          </button>

          <TabItem
            to="/discover"
            icon={Compass}
            label={t("common.bottomNav.discover")}
            active={pathname.startsWith("/discover")}
            className="flex-1 h-14 text-sm"
            dataTourId="nav-discover"
          />

          <TabItem
            to="/library"
            icon={BookOpen}
            label={t("common.bottomNav.library")}
            active={pathname.startsWith("/library")}
            className="flex-1 h-14 text-sm"
            dataTourId="nav-library"
          />
        </div>
      </div>
    </div>
  );
}
