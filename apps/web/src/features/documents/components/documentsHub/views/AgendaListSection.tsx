/**
 * AgendaListSection Component
 * 
 * Renders a sortable list of agenda items (tasks, events, notes) for Today/Week views.
 * This is a pure presentational component that receives all data via props.
 */

import { type ReactNode, lazy, Suspense } from "react";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { SortableList } from "@/shared/components/SortableList";
import { TaskRowGlobal, HolidayRowGlobal } from "../rows";
import AgendaMiniRow from "@features/calendar/components/agenda/AgendaMiniRow";
const LazyMiniAgendaEditorPanel = lazy(() => import("@features/calendar/components/agenda/MiniAgendaEditorPanel"));
import type { AgendaEntry } from "../types";

// Re-export for convenience
export type { AgendaEntry };

// ============================================================================
// Types
// ============================================================================

export interface AgendaListSectionProps {
    /** Section title (e.g., "Today", "This Week") */
    title: string;
    /** Agenda entries to display */
    entries: AgendaEntry[];
    /** Holidays to display */
    holidays?: any[];
    /** Ordered keys for sorting */
    orderedKeys: string[];
    /** Map of keys to entries */
    entriesByKey: Map<string, AgendaEntry>;
    /** Display density */
    density?: "comfortable" | "compact";
    /** Whether reordering is enabled */
    reorderable?: boolean;
    /** Callback when order changes */
    onReorder?: (newKeys: string[]) => void;
    /** Currently selected task ID */
    selectedTaskId?: Id<"userEvents"> | null;
    /** Currently selected event ID */
    selectedEventId?: Id<"events"> | null;
    /** Callback when a task is selected */
    onSelectTask?: (id: Id<"userEvents">, source: "today" | "week") => void;
    /** Callback when an event is selected */
    onSelectEvent?: (id: Id<"events">) => void;
    /** Callback when task status changes */
    onChangeTaskStatus?: (id: Id<"userEvents">, status: string) => void;
    /** Callback to clear task selection */
    onClearTaskSelection?: () => void;
    /** Callback to clear event selection */
    onClearEventSelection?: () => void;
    /** Callback when a reference is opened */
    onOpenReference?: (ref: any) => void;
    /** Whether to show inline editors */
    showInlineEditors?: boolean;
    /** Selection source for tasks */
    selectionSource?: "today" | "week";
    /** Empty state message */
    emptyMessage?: string;
}

/**
 * Helper to generate a key for an agenda entry
 */
export function keyForEntry(entry: { kind: "task" | "event" | "note"; item: any }): string {
    const prefix = entry.kind === "event" ? "e" : entry.kind === "note" ? "n" : "t";
    return `${prefix}_${entry.item._id}`;
}

/**
 * Helper to convert item to agenda entry
 */
export function toAgendaEntry(item: any, kind: "task" | "event" | "note"): AgendaEntry {
    return {
        kind,
        time:
            kind === "event"
                ? (item.startTime as number)
                : kind === "task"
                    ? ((item.dueDate as number | undefined) ?? Number.POSITIVE_INFINITY)
                    : ((item.agendaDate as number | undefined) ??
                        (item._creationTime as number | undefined) ??
                        0),
        item,
    };
}

/**
 * AgendaListSection - Renders a sortable list of agenda items
 */
export function AgendaListSection({
    title,
    entries,
    holidays = [],
    orderedKeys,
    entriesByKey,
    density = "comfortable",
    reorderable = true,
    onReorder,
    selectedTaskId,
    selectedEventId,
    onSelectTask,
    onSelectEvent,
    onChangeTaskStatus,
    onClearTaskSelection,
    onClearEventSelection,
    onOpenReference,
    showInlineEditors = true,
    selectionSource = "today",
    emptyMessage = "No items scheduled.",
}: AgendaListSectionProps) {

    const isEmpty = entries.length === 0 && holidays.length === 0;

    const renderItem = (key: string): ReactNode => {
        const entry = entriesByKey.get(key);
        if (!entry) return null;

        if (entry.kind === "event") {
            return (
                <div key={`e_${entry.item._id}`} className="flex flex-col gap-1">
                    <AgendaMiniRow
                        item={entry.item}
                        kind="event"
                        onSelect={(id) => onSelectEvent?.(id as Id<"events">)}
                    />
                    {showInlineEditors && selectedEventId === entry.item._id && (
                        <Suspense fallback={null}>
                            <LazyMiniAgendaEditorPanel
                                kind="event"
                                eventId={entry.item._id}
                                onClose={() => onClearEventSelection?.()}
                            />
                        </Suspense>
                    )}
                </div>
            );
        }

        if (entry.kind === "note") {
            return (
                <AgendaMiniRow
                    key={`n_${entry.item._id}`}
                    item={entry.item}
                    kind="note"
                />
            );
        }

        // Task
        return (
            <div key={`t_${entry.item._id}`} className="flex flex-col gap-1">
                <TaskRowGlobal
                    t={entry.item}
                    density={density}
                    onSelect={(id) => onSelectTask?.(id as Id<"userEvents">, selectionSource)}
                    onChangeStatus={(id, status) => onChangeTaskStatus?.(id as Id<"userEvents">, status)}
                    onOpenRef={onOpenReference}
                />
                {showInlineEditors && selectedTaskId === entry.item._id && (
                    <Suspense fallback={null}>
                        <LazyMiniAgendaEditorPanel
                            kind="task"
                            taskId={entry.item._id}
                            onClose={() => onClearTaskSelection?.()}
                        />
                    </Suspense>
                )}
            </div>
        );
    };

    return (
        <div className="mt-4">
            <div className="text-xs tracking-wide text-content-muted mb-1">
                {title}
            </div>

            {/* Holidays */}
            {holidays.length > 0 && (
                <div className="flex flex-col gap-1 mb-2">
                    {holidays.map((h: any) => (
                        <HolidayRowGlobal key={h.name} h={h} />
                    ))}
                </div>
            )}

            {/* Empty state */}
            {isEmpty && (
                <div className="text-sm text-content-secondary">
                    {emptyMessage}
                </div>
            )}

            {/* Agenda items */}
            {entries.length > 0 && (
                reorderable && onReorder ? (
                    <SortableList
                        items={orderedKeys}
                        orientation="vertical"
                        containerClassName="flex flex-col gap-2"
                        onReorder={onReorder}
                        renderItem={renderItem}
                    />
                ) : (
                    <div className="flex flex-col gap-2">
                        {orderedKeys.map(renderItem)}
                    </div>
                )
            )}
        </div>
    );
}
