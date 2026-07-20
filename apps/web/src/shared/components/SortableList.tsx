import React, { useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  DragStartEvent,
  DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToHorizontalAxis, restrictToWindowEdges } from "@dnd-kit/modifiers";

export interface SortableListProps<T extends string | number = string> {
  items: T[];
  renderItem: (id: T, index: number, isDragging: boolean) => React.ReactNode;
  onReorder: (newOrder: T[]) => void;
  containerClassName?: string;
  orientation?: "vertical" | "horizontal";
  onDragStart?: (activeId: T) => void;
  onDragEnd?: (activeId: T | null) => void;
  // If true, uses a grid strategy and allows free movement (no axis restriction)
  isGrid?: boolean;
  // If true, allow drag to start from interactive elements like buttons/inputs
  activateOnInteractive?: boolean;
}

export function SortableList<T extends string | number = string>({
  items,
  renderItem,
  onReorder,
  containerClassName = "space-y-2",
  orientation = "vertical",
  onDragStart: onStart,
  onDragEnd: onEnd,
  isGrid = false,
  activateOnInteractive = false,
}: SortableListProps<T>) {
  const [_activeId, setActiveId] = useState<T | null>(null);
  // Custom PointerSensor that ignores interactive elements so inputs remain editable/focusable
  const InteractivePointerSensor = useMemo(() => {
    // Helper: detect interactive elements (inputs, buttons, selects, textareas, contentEditable)
    const isInteractive = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return true;
      const ce = (el as HTMLElement).isContentEditable || (el as HTMLElement).getAttribute("contenteditable") === "true";
      if (ce) return true;
      // Consider common ARIA textboxes as interactive
      const role = el.getAttribute("role");
      if (role === "textbox" || role === "combobox" || role === "spinbutton") return true;
      return false;
    };

    class _InteractivePointerSensor extends PointerSensor {
      static activators = [
        {
          eventName: "onPointerDown" as const,
          handler: (event: React.PointerEvent) => {
            const target = event.target as Element | null;
            // If the pointer originated from an interactive element, do NOT activate drag
            if (isInteractive(target)) return false;
            // If occurring within the inline editor, don't activate drag either
            if (target?.closest?.('[data-inline-editor="true"]')) return false;
            // If within an interactive ancestor, also do NOT activate drag
            let el: Element | null = target;
            const container = event.currentTarget as unknown as Element | null;
            while (el && el !== container) {
              if (isInteractive(el)) return false;
              el = el.parentElement;
            }
            return true;
          },
        },
      ];
    }
    return _InteractivePointerSensor;
  }, []);

  const sensors = useSensors(
    useSensor(
      (activateOnInteractive ? PointerSensor : (InteractivePointerSensor as unknown as typeof PointerSensor)),
      { activationConstraint: { distance: 4 } }
    ),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as T);
    try { document.documentElement.classList.add("dnd-dragging"); } catch { /* no-op */ }
    if (onStart) onStart(event.active.id as T);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    try { document.documentElement.classList.remove("dnd-dragging"); } catch { /* no-op */ }
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((i) => i === (active.id as T));
    const newIndex = items.findIndex((i) => i === (over.id as T));
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
    const newOrder = arrayMove(items, oldIndex, newIndex);
    onReorder(newOrder);
    if (onEnd) onEnd(event.active.id as T);
  };

  const handleDragCancel = () => {
    try { document.documentElement.classList.remove("dnd-dragging"); } catch { /* no-op */ }
    setActiveId(null);
    if (onEnd) onEnd(null);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      modifiers={
        isGrid
          ? [restrictToWindowEdges]
          : [
              orientation === "horizontal" ? restrictToHorizontalAxis : restrictToVerticalAxis,
              restrictToWindowEdges,
            ]
      }
    >
      <SortableContext
        items={items}
        strategy={
          isGrid
            ? rectSortingStrategy
            : (orientation === "horizontal" ? horizontalListSortingStrategy : verticalListSortingStrategy)
        }
      >
        <div className={containerClassName}>
          {items.map((id, index) => (
            <SortableRow key={String(id)} id={id}>
              {(isDragging) => renderItem(id, index, isDragging)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow<T extends string | number = string>({
  id,
  children,
}: {
  id: T;
  children: (isDragging: boolean) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = useMemo(() => ({
    transform: CSS.Transform.toString(transform),
    transition,
    willChange: transform ? "transform" : undefined,
    zIndex: isDragging ? 50 : undefined,
  }), [transform, transition, isDragging]);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children(isDragging)}
    </div>
  );
}
