import React, { CSSProperties, ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function AgendaSortableItem({
  id,
  children,
  className,
  style: styleOverride,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const baseTransform = CSS.Transform.toString(transform);
  const composedTransform = isDragging && baseTransform ? `${baseTransform} scale(1.02)` : baseTransform;
  const style: CSSProperties = {
    ...styleOverride,
    transform: composedTransform,
    transition: transition ?? "transform 180ms cubic-bezier(0.2, 0, 0, 1)",
    willChange: transform ? "transform" : undefined,
    zIndex: isDragging ? 40 : undefined,
    backfaceVisibility: "hidden",
  };
  return (
    <div ref={setNodeRef} style={style} className={className} {...attributes} {...listeners}>
      {children}
    </div>
  );
}
