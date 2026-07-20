/**
 * DocumentsHomeHub Types
 * 
 * Shared types and interfaces for DocumentsHomeHub and its child components.
 * 
 * Note: Some types like TaskStatus, DocumentCardData are defined in ./utils
 * to maintain backward compatibility. This file defines additional types.
 */

import { Id } from "../../../../../convex/_generated/dataModel";

// Re-export core types from utils for convenience
export type { TaskStatus } from "./utils/statusHelpers";
export type { DocumentCardData } from "./utils/documentHelpers";
export { isTaskStatus } from "./utils/statusHelpers";

// ============================================================================
// Additional Status Types (not in utils)
// ============================================================================

/** Alias for TaskStatus - used in Kanban views */
export type Status = "todo" | "in_progress" | "done" | "blocked";

/** Task priority levels */
export type TaskPriority = "low" | "medium" | "high" | "urgent";

/** Event status values */
export type EventStatus = "confirmed" | "tentative" | "cancelled";

// ============================================================================
// View Mode Types
// ============================================================================

/** Document view display modes */
export type DocViewMode = "cards" | "list" | "segmented";

/** Agenda view display modes */
export type AgendaMode = "list" | "kanban" | "weekly" | "mini";

/** Planner mode for Today/This Week views */
export type PlannerViewMode = "list" | "kanban" | "mini";

/** Agenda scope for date range */
export type AgendaScope = "day" | "week";

/** List range filter options */
export type ListRange = "today" | "week" | "month" | "custom";

/** Task selection source */
export type TaskSelectionSource = "today" | "upcoming" | "week" | "other";

// ============================================================================
// Agenda Types
// ============================================================================

/** Unified agenda entry for tasks, events, and notes */
export interface AgendaEntry {
    kind: "task" | "event" | "note";
    time: number;
    item: any; // TODO: Narrow this type when task/event types are available
}

// ============================================================================
// Component Props
// ============================================================================

/** Main DocumentsHomeHub component props */
export interface DocumentsHomeHubProps {
    /** Callback when a document is selected */
    onDocumentSelect: (documentId: Id<"documents">) => void;

    /** Callback to toggle grid mode */
    onGridModeToggle?: () => void;

    /** Whether to hide the calendar card */
    hideCalendarCard?: boolean;

    /** Currently selected task ID (lifted from MainLayout) */
    selectedTaskId?: Id<"userEvents"> | null;

    /** Source section of the selected task */
    selectedTaskSource?: TaskSelectionSource | null;

    /** Callback when a task is selected */
    onSelectTask?: (
        id: Id<"userEvents">,
        source: TaskSelectionSource
    ) => void;

    /** Callback to clear task selection */
    onClearTaskSelection?: () => void;
}

/** Props for ListView component */
export interface ListViewProps {
    /** Task selection callback */
    onSelectTask?: (id: Id<"userEvents">, source: TaskSelectionSource) => void;
    /** Currently selected task */
    selectedTaskId?: Id<"userEvents"> | null;
    /** Selected task source */
    selectedTaskSource?: TaskSelectionSource | null;
    /** Callback when a task is clicked */
    onTaskClick?: (taskId: Id<"userEvents">) => void;
}

/** Props for KanbanView component */
export interface KanbanViewProps {
    /** Task selection callback */
    onSelectTask?: (id: Id<"userEvents">, source: TaskSelectionSource) => void;
    /** Currently selected task */
    selectedTaskId?: Id<"userEvents"> | null;
}

/** Props for WeeklyView component */
export interface WeeklyViewProps {
    /** Week start timestamp (UTC) */
    weekStartUtc: number;
    /** Week end timestamp (UTC) */
    weekEndUtc: number;
    /** Timezone offset in minutes */
    tzOffsetMinutes: number;
    /** Callback for adding task on a specific date */
    onAddTaskForDate: (dateMs: number) => void;
}

/** Props for WeeklyDayCell component */
export interface WeeklyDayCellProps {
    /** Date for this cell */
    date: Date;
    /** Items (tasks/events) for this day */
    items: any[];
    /** Holidays for this day */
    holidays?: any[];
    /** Whether this is today */
    isToday: boolean;
    /** Callback to add a task */
    onAddTask: () => void;
}

// ============================================================================
// Utility Type Guards
// ============================================================================

/** Type guard for EventStatus */
export function isEventStatus(value: string): value is EventStatus {
    return ["confirmed", "tentative", "cancelled"].includes(value);
}

/** Type guard for ListRange */
export function isListRange(value: string): value is ListRange {
    return ["today", "week", "month", "custom"].includes(value);
}

/** Convert string to TaskPriority with fallback */
export function toTaskPriority(
    p?: string
): TaskPriority | undefined {
    if (!p) return undefined;
    if (["low", "medium", "high", "urgent"].includes(p)) {
        return p as TaskPriority;
    }
    return undefined;
}

// ============================================================================
// Style Constants
// ============================================================================

/** Shared section header class for consistent typography */
export const SECTION_HEADER_CLASS = "text-base font-semibold text-content-secondary";
