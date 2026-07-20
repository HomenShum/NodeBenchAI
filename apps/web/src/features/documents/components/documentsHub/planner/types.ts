import type { Id } from "../../../../../../convex/_generated/dataModel";

export type AgendaPopoverState =
  | {
      kind: "event";
      anchor: HTMLElement | null;
      eventId: Id<"events">;
      documentIdForAssociation?: Id<"documents"> | null;
    }
  | {
      kind: "task";
      anchor: HTMLElement | null;
      taskId: Id<"userEvents">;
    }
  | {
      kind: "create";
      anchor: HTMLElement | null;
      dateMs: number;
      defaultKind?: "task" | "event";
      defaultTitle?: string;
      defaultAllDay?: boolean;
    }
  | {
      kind: "createBoth";
      anchor: HTMLElement | null;
      dateMs: number;
      defaultKind?: "task" | "event";
      defaultTitle?: string;
      defaultAllDay?: boolean;
      documentIdForAssociation?: Id<"documents"> | null;
    }
  | null;
