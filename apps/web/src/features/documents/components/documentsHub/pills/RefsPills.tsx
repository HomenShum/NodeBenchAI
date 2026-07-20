/**
 * RefsPills Component
 * 
 * Displays reference pills for documents, tasks, and events with:
 * - Clickable pills showing referenced items
 * - Title fetching from Convex
 * - Truncated display with "+" indicator for overflow
 * - Hover tooltips with full titles
 */

import { useMemo } from "react";
import { useQuery } from "convex/react";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { api } from "../../../../../../convex/_generated/api";

export interface RefsPillsProps {
  refs?: Array<{ kind: "document" | "task" | "event"; id: string }> | null;
  onOpenRef?: (kind: "document" | "task" | "event", id: string) => void;
}

export const RefsPills = ({ refs, onOpenRef }: RefsPillsProps) => {
  const list = Array.isArray(refs) ? refs : [];

  const docIds = useMemo(
    () => list.filter((r) => r.kind === "document").map((r) => r.id),
    [list],
  );

  const taskIds = useMemo(
    () => list.filter((r) => r.kind === "task").map((r) => r.id),
    [list],
  );

  const eventIds = useMemo(
    () => list.filter((r) => r.kind === "event").map((r) => r.id),
    [list],
  );

  const docIdsTyped = docIds as unknown as Array<Id<"documents">>;
  const taskIdsTyped = taskIds as unknown as Array<Id<"userEvents">>;
  const eventIdsTyped = eventIds as unknown as Array<Id<"events">>;

  const docTitles = useQuery(
    api.domains.documents.documents.getTitles,
    docIdsTyped.length ? { ids: docIdsTyped } : "skip",
  ) as Array<{ _id: Id<"documents">; title: string }> | undefined;

  const taskTitles = useQuery(
    api.domains.tasks.userEvents.getTitles,
    taskIdsTyped.length ? { ids: taskIdsTyped } : "skip",
  ) as Array<{ _id: Id<"userEvents">; title: string }> | undefined;

  const eventTitles = useQuery(
    api.domains.calendar.events.getTitles,
    eventIdsTyped.length ? { ids: eventIdsTyped } : "skip",
  ) as Array<{ _id: Id<"events">; title: string }> | undefined;

  const titleById = useMemo(() => {
    const m: Record<string, string> = {};

    for (const a of docTitles ?? []) if (a?._id) m[String(a._id)] = a.title;
    for (const a of taskTitles ?? []) if (a?._id) m[String(a._id)] = a.title;
    for (const a of eventTitles ?? []) if (a?._id) m[String(a._id)] = a.title;

    return m;
  }, [docTitles, taskTitles, eventTitles]);

  if (!list.length) return null;

  return (
    <>
      {list.slice(0, 3).map((r, idx) => (
        <button
          key={`${r.kind}:${r.id}:${idx}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenRef?.(r.kind, r.id);
          }}
          className="text-xs px-1.5 py-0.5 rounded-md border bg-surface text-content-secondary border-edge hover:bg-surface-hover"
          title={`${r.kind.toUpperCase()}: ${titleById[r.id] ?? r.id}`}
        >
          <span className="mr-1">{r.kind[0]}</span>

          <span className="truncate inline-block max-w-[120px] align-top">
            {titleById[r.id] ?? r.id}
          </span>
        </button>
      ))}

      {list.length > 3 && (
        <span
          className="text-xs px-1.5 py-0.5 rounded-md border bg-surface text-content-muted border-edge"
          title={`${list.length - 3} more references`}
        >
          +{list.length - 3}
        </span>
      )}
    </>
  );
};

