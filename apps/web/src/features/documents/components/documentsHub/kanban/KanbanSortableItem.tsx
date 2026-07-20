/**
 * KanbanSortableItem Component
 * 
 * A sortable wrapper for Kanban items using dnd-kit with:
 * - Drag and drop support
 * - Transform animations
 * - Accessibility attributes
 * - Scale effect while dragging
 */

import { type ReactNode, type CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Id } from "../../../../../../convex/_generated/dataModel";

export interface KanbanSortableItemProps {
  id: Id<"userEvents"> | Id<"events"> | string; // supports both task and event ids
  rowStyle: CSSProperties;
  children: (isDragging: boolean) => ReactNode;
}

export function KanbanSortableItem({
  id,
  rowStyle,
  children,
}: KanbanSortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const baseTransform = CSS.Transform.toString(transform);

  const composedTransform =
    isDragging && baseTransform
      ? `${baseTransform} scale(1.03)`
      : baseTransform;

  const style: CSSProperties = {
    ...rowStyle,
    transform: composedTransform,
    transition: transition ?? "transform 180ms cubic-bezier(0.2, 0, 0, 1)",
    willChange: transform ? "transform" : undefined,
    zIndex: isDragging ? 50 : undefined,
    backfaceVisibility: "hidden",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      tabIndex={0}
      aria-grabbed={isDragging}
    >
      {children(isDragging)}
    </div>
  );
}

