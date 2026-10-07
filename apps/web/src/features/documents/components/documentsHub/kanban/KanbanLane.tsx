/**
 * KanbanLane Component
 * 
 * A droppable lane wrapper for Kanban boards using dnd-kit with:
 * - Drop zone support
 * - Status-based background tinting
 * - Hover effects
 * - Compact/comfortable density options
 */

import { memo, type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";

export interface KanbanLaneProps {
  laneId: string; // supports task status lanes and an "events" lane
  density: "compact" | "comfortable";
  children: ReactNode;
}

export const KanbanLane = memo(function KanbanLane({ laneId, density, children }: KanbanLaneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: laneId });

  return (
    <div
      ref={setNodeRef}
      className={`document-card--hybrid relative overflow-hidden ${density === "compact" ? "p-0" : "p-0.5"} min-h-[260px] flex flex-col gap-1 rounded-none border-0 transition-none hover:ring-0 hover:scale-100 hover:bg-transparent ${
        // status-tinted background per lane
        laneId === "in_progress"
          ? "bg-blue-500/5"
          : laneId === "done"
            ? "bg-indigo-500/5"
            : laneId === "blocked"
              ? "bg-rose-500/5"
              : laneId === "events"
                ? "bg-amber-500/5"
                : "bg-slate-500/5"
      } ${isOver ? "ring-1 ring-ring" : ""}`}
    >
      {children}
    </div>
  );
});

