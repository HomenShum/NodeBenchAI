import { useMemo } from "react";
import type { Id } from "@convex/_generated/dataModel";
import DualCreateMiniPanel from "@/features/documents/editors/DualCreateMiniPanel";
import DualEditMiniPanel from "@/features/documents/editors/DualEditMiniPanel";
import PopoverMiniEditor from "@/features/documents/editors/PopoverMiniEditor";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ai-ui/popover";

type Props = {
  isOpen: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  kind: "event" | "task" | "create" | "createBoth";
  eventId?: Id<"events">;
  taskId?: Id<"userEvents">;
  dateMs?: number;
  defaultKind?: "task" | "event";
  defaultTitle?: string;
  defaultAllDay?: boolean;
  documentIdForAssociation?: Id<"documents"> | null;
};

export default function AgendaEditorPopover({ isOpen, anchorEl, onClose, kind, eventId, taskId, dateMs, defaultKind: _defaultKind, defaultTitle, defaultAllDay, documentIdForAssociation }: Props) {
  const virtualTarget = useMemo(
    () => anchorEl?.querySelector<HTMLElement>('[data-agenda-mini-row]') ?? anchorEl,
    [anchorEl],
  );
  const virtualAnchorRef = useMemo(() => ({ current: virtualTarget }), [virtualTarget]);
  if (!anchorEl) return null;

  return (
    <Popover open={isOpen} onOpenChange={(next) => { if (!next) onClose(); }}>
      <PopoverAnchor virtualRef={virtualAnchorRef} />
      <PopoverContent
      role="dialog"
      aria-modal="false"
      aria-label="Agenda editor"
      side="right"
      align="start"
      sideOffset={8}
      collisionPadding={8}
      onOpenAutoFocus={(event) => event.preventDefault()}
      className="z-[9999] w-[min(560px,calc(100vw-24px))] p-0 shadow-2xl rounded-lg border border-edge bg-surface-secondary"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="p-2">
        {kind === "event" && eventId && (
          <PopoverMiniEditor kind="event" eventId={eventId} onClose={onClose} documentIdForAssociation={documentIdForAssociation} />
        )}
        {kind === "task" && taskId && (
          <PopoverMiniEditor kind="task" taskId={taskId} onClose={onClose} />
        )}
        {kind === "create" && typeof dateMs === "number" && (
          <DualCreateMiniPanel
            dateMs={dateMs}
            onClose={onClose}
            defaultTitle={defaultTitle}
            defaultAllDay={defaultAllDay}
            documentIdForAssociation={documentIdForAssociation}
          />
        )}
        {kind === "createBoth" && typeof dateMs === "number" && (
          <DualEditMiniPanel
            dateMs={dateMs}
            onClose={onClose}
            defaultTitle={defaultTitle}
            defaultAllDay={defaultAllDay}
            documentIdForAssociation={documentIdForAssociation}
          />
        )}
      </div>
      </PopoverContent>
    </Popover>
  );
}
