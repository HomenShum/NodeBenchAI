import React, { useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,             // ✅ overlay to prevent layout pop
  useSensor,
  useSensors,
  closestCenter,           // ✅ better collision for grids
} from "@dnd-kit/core";
import { restrictToWindowEdges, restrictToParentElement } from "@dnd-kit/modifiers";
import {
  SortableContext,
  rectSortingStrategy,      // ✅ best for grids
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface DocumentsGridSortableProps<T extends string | number = string> {
  items: T[];
  renderItem: (id: T, index: number, isDragging: boolean) => React.ReactNode;
  renderOverlayItem?: (id: T, index: number) => React.ReactNode;
  onReorder: (newOrder: T[]) => void;
  gridClassName?: string;
}

export function DocumentsGridSortable<T extends string | number = string>({
  items,
  renderItem,
  renderOverlayItem,
  onReorder,
  // ✅ stable auto-fill grid w/ larger gaps for premium spacing
  gridClassName = "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] auto-rows-fr gap-5",
}: DocumentsGridSortableProps<T>) {
  const [activeId, setActiveId] = useState<T | null>(null);

  const sensors = useSensors(
    // ✅ slightly higher threshold to avoid accidental drags
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const activeIndex = useMemo(
    () => (activeId == null ? -1 : items.findIndex((i) => i === activeId)),
    [activeId, items]
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as T);
    try { document.documentElement.classList.add("dnd-dragging"); } catch { /* no-op */ }
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
  };

  const handleDragCancel = () => {
    try { document.documentElement.classList.remove("dnd-dragging"); } catch { /* no-op */ }
    setActiveId(null);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      collisionDetection={closestCenter}
      modifiers={[restrictToWindowEdges, restrictToParentElement]}
    >
      <SortableContext items={items} strategy={rectSortingStrategy}>
        <div className={gridClassName}>
          {items.map((id, index) => (
            <SortableCardContainer key={String(id)} id={id}>
              {(isDragging) => renderItem(id, index, isDragging)}
            </SortableCardContainer>
          ))}
        </div>
      </SortableContext>

      {/* ✅ Overlay clone prevents layout shift while dragging; enable smooth drop animation */}
      <DragOverlay dropAnimation={null}>
        {activeId != null && activeIndex >= 0 ? (
          <div className="ring-2 ring-gray-900/20 rounded-lg shadow-lg">
            {renderOverlayItem
              ? renderOverlayItem(activeId, activeIndex)
              : renderItem(activeId, activeIndex, true)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableCardContainer<T extends string | number = string>({
  id,
  children,
}: {
  id: T;
  children: (isDragging: boolean) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition: transition ?? "transform 180ms cubic-bezier(0.2, 0, 0, 1)",
      willChange: transform ? "transform" : undefined, // ✅ smoother GPU hint
      zIndex: isDragging ? 50 : undefined,
      backfaceVisibility: "hidden",                     // ✅ avoid flicker in Safari
    }),
    [transform, transition, isDragging]
  );

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children(isDragging)}
    </div>
  );
}
