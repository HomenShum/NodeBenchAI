import React, { Suspense } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import InlineTaskEditor from "@features/calendar/components/agenda/InlineTaskEditor";
import InlineEventEditor from "@features/calendar/components/agenda/InlineEventEditor";
import DocumentMiniEditor from "./DocumentMiniEditor";

// Spreadsheet editor is heavy (xlsx/react-spreadsheet). Lazy-load it so it doesn't bloat the main bundle.
const SpreadsheetMiniEditor = React.lazy(() => import("./SpreadsheetMiniEditor"));

export type PopoverMiniEditorProps =
  | { kind: "task"; taskId: Id<"userEvents">; onClose: () => void }
  | { kind: "event"; eventId: Id<"events">; onClose: () => void; documentIdForAssociation?: Id<"documents"> | null }
  | { kind: "document"; documentId: Id<"documents">; onClose: () => void }
  | { kind: "spreadsheet"; documentId: Id<"documents">; onClose: () => void };

export default function PopoverMiniEditor(props: PopoverMiniEditorProps) {
  if (props.kind === "task") {
    return <InlineTaskEditor taskId={props.taskId} onClose={props.onClose} />;
  }
  if (props.kind === "event") {
    return (
      <InlineEventEditor
        eventId={props.eventId}
        onClose={props.onClose}
        documentIdForAssociation={props.documentIdForAssociation}
      />
    );
  }
  if (props.kind === "document") {
    return <DocumentMiniEditor documentId={props.documentId} onClose={props.onClose} />;
  }
  // spreadsheet
  return (
    <Suspense fallback={<div className="text-xs text-content-secondary">Loading spreadsheet…</div>}>
      <SpreadsheetMiniEditor documentId={props.documentId} onClose={props.onClose} />
    </Suspense>
  );
}
