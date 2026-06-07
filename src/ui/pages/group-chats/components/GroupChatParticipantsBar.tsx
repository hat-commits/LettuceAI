import { useCallback, useMemo, useRef } from "react";
import { VolumeX } from "lucide-react";
import { useI18n } from "../../../../core/i18n/context";
import type { Character } from "../../../../core/storage/schemas";
import { cn, interactive } from "../../../design-tokens";
import { useAvatar } from "../../../hooks/useAvatar";
import { AvatarImage } from "../../../components/AvatarImage";

const LONG_PRESS_MS = 450;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface MentionMatch {
  index: number;
  length: number;
}

function findMention(draft: string, name: string): MentionMatch | null {
  const escaped = escapeRegExp(name);

  const quoted = new RegExp(`@"${escaped}"`, "i").exec(draft);
  if (quoted) return { index: quoted.index, length: quoted[0].length };

  const unquoted = new RegExp(`(^|\\s)@${escaped}(?=$|\\s|[.,!?;:])`, "i").exec(draft);
  if (unquoted) {
    const at = unquoted.index + unquoted[1].length;
    return { index: at, length: name.length + 1 };
  }

  return null;
}

function mentionToken(name: string): string {
  return name.includes(" ") ? `@"${name}"` : `@${name}`;
}

function toggleMention(draft: string, name: string): string {
  const match = findMention(draft, name);
  if (match) {
    const before = draft.slice(0, match.index);
    const after = draft.slice(match.index + match.length);
    return `${before}${after}`.replace(/\s{2,}/g, " ").replace(/^\s+/, "");
  }
  const trimmed = draft.replace(/\s+$/, "");
  return trimmed.length ? `${trimmed} ${mentionToken(name)} ` : `${mentionToken(name)} `;
}

export type ParticipantsBarSize = "small" | "medium" | "large";
export type ParticipantsBarGap = "tight" | "normal" | "relaxed";
export type ParticipantsBarAlign = "left" | "center" | "right";

const SIZE_CLASS: Record<ParticipantsBarSize, string> = {
  small: "h-10 w-10",
  medium: "h-12 w-12",
  large: "h-14 w-14",
};

const GAP_CLASS: Record<ParticipantsBarGap, string> = {
  tight: "gap-1",
  normal: "gap-2",
  relaxed: "gap-3",
};

const ALIGN_CLASS: Record<ParticipantsBarAlign, string> = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
};

interface GroupChatParticipantsBarProps {
  characters: Character[];
  draft: string;
  setDraft: (value: string) => void;
  mutedCharacterIds: Set<string>;
  onToggleMute: (characterId: string, muted: boolean) => void;
  disabled?: boolean;
  size?: ParticipantsBarSize;
  gap?: ParticipantsBarGap;
  align?: ParticipantsBarAlign;
}

export function GroupChatParticipantsBar({
  characters,
  draft,
  setDraft,
  mutedCharacterIds,
  onToggleMute,
  disabled = false,
  size = "medium",
  gap = "normal",
  align = "left",
}: GroupChatParticipantsBarProps) {
  const mentionedIds = useMemo(() => {
    const set = new Set<string>();
    for (const character of characters) {
      if (findMention(draft, character.name)) set.add(character.id);
    }
    return set;
  }, [characters, draft]);

  const hasActiveMention = mentionedIds.size > 0;

  if (characters.length < 2) return null;

  return (
    <div
      className={cn(
        "mb-2 flex items-center overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        GAP_CLASS[gap],
        ALIGN_CLASS[align],
      )}
    >
      {characters.map((character) => (
        <ParticipantAvatar
          key={character.id}
          character={character}
          muted={mutedCharacterIds.has(character.id)}
          mentioned={mentionedIds.has(character.id)}
          dimmed={
            mutedCharacterIds.has(character.id) ||
            (hasActiveMention && !mentionedIds.has(character.id))
          }
          disabled={disabled}
          sizeClass={SIZE_CLASS[size]}
          onMention={() => setDraft(toggleMention(draft, character.name))}
          onToggleMute={(muted) => onToggleMute(character.id, muted)}
        />
      ))}
    </div>
  );
}

function ParticipantAvatar({
  character,
  muted,
  mentioned,
  dimmed,
  disabled,
  sizeClass,
  onMention,
  onToggleMute,
}: {
  character: Character;
  muted: boolean;
  mentioned: boolean;
  dimmed: boolean;
  disabled: boolean;
  sizeClass: string;
  onMention: () => void;
  onToggleMute: (muted: boolean) => void;
}) {
  const { t } = useI18n();
  const avatarUrl = useAvatar("character", character.id, character.avatarPath, "round");
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  const clearTimer = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(() => {
    if (disabled) return;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      onToggleMute(!muted);
    }, LONG_PRESS_MS);
  }, [disabled, muted, onToggleMute]);

  const handleClick = useCallback(() => {
    clearTimer();
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (!disabled) onMention();
  }, [clearTimer, disabled, onMention]);

  const label = muted
    ? t("groupChats.footer.participantMuted", { name: character.name })
    : mentioned
      ? t("groupChats.footer.removeMention", { name: character.name })
      : t("groupChats.footer.mentionParticipant", { name: character.name });

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={clearTimer}
      onPointerLeave={clearTimer}
      onPointerCancel={clearTimer}
      onContextMenu={(event) => {
        event.preventDefault();
        clearTimer();
        if (!disabled) onToggleMute(!muted);
      }}
      onClick={handleClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "relative shrink-0 select-none",
        sizeClass,
        interactive.transition.default,
        interactive.active.scale,
        "disabled:cursor-not-allowed",
      )}
    >
      <div
        className={cn(
          "h-full w-full rounded-full overflow-hidden bg-linear-to-br from-fg/8 to-fg/4",
          "ring-2",
          mentioned ? "ring-accent" : "ring-fg/10",
          interactive.transition.default,
          dimmed ? "opacity-40 grayscale" : "opacity-100",
        )}
      >
        {avatarUrl ? (
          <AvatarImage src={avatarUrl} alt={character.name} crop={character.avatarCrop} applyCrop />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm font-bold text-fg/60">
            {character.name.slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>
      {muted && (
        <span className="absolute -bottom-0.5 -right-0.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-surface text-fg/70 ring-1 ring-fg/15">
          <VolumeX size={11} />
        </span>
      )}
    </button>
  );
}
