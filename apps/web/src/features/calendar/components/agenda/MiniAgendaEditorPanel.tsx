import React from "react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import PopoverMiniEditor from "@/features/documents/editors/PopoverMiniEditor";

export type MiniAgendaEditorPanelProps =
  | { kind: "task"; taskId: Id<"userEvents">; onClose: () => void }
  | { kind: "event"; eventId: Id<"events">; onClose: () => void; documentIdForAssociation?: Id<"documents"> | null };

export default function MiniAgendaEditorPanel(props: MiniAgendaEditorPanelProps) {
  if (props.kind === "task") {
    return <PopoverMiniEditor kind="task" taskId={props.taskId} onClose={props.onClose} />;
  }
  return (
    <PopoverMiniEditor
      kind="event"
      eventId={props.eventId}
      onClose={props.onClose}
      documentIdForAssociation={props.documentIdForAssociation}
    />
  );
}
