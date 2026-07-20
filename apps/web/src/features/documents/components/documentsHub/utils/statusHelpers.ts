/**
 * Status Helper Functions
 * 
 * Utility functions for handling task, event, and document statuses
 */

export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";

/**
 * Get CSS classes for task status chips
 */
export const statusChipClasses = (s?: string) => {
  switch (s) {
    case "in_progress":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "done":
      return "bg-indigo-50 text-content-secondary border-indigo-200";
    case "blocked":
      return "bg-rose-50 text-rose-700 border-rose-200";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
};

/**
 * Get human-readable label for task status
 */
export const statusLabel = (s?: string) => {
  switch (s) {
    case "in_progress":
      return "IN PROGRESS";
    case "done":
      return "DONE";
    case "blocked":
      return "BLOCKED";
    case "todo":
      return "TODO";
    default:
      return "TODO";
  }
};

/**
 * Type guard for task status
 */
export const isTaskStatus = (v: string): v is TaskStatus =>
  v === "todo" || v === "in_progress" || v === "done" || v === "blocked";

/**
 * Get CSS classes for event status bar
 */
export const eventStatusBar = (s?: string) => {
  switch (s) {
    case "confirmed":
      return "bg-indigo-500/60";
    case "tentative":
      return "bg-amber-500/60";
    case "cancelled":
      return "bg-rose-500/60";
    default:
      return "bg-[var(--border-color)]";
  }
};

/**
 * Get CSS classes for kanban status bar
 */
export const kanbanStatusBar = (s?: string) => {
  switch (s) {
    case "todo":
      return "bg-slate-400/70";
    case "in_progress":
      return "bg-blue-400/70";
    case "done":
      return "bg-indigo-500/80";
    case "blocked":
      return "bg-rose-500/80";
    default:
      return "bg-[var(--border-color)]";
  }
};

/**
 * Get CSS classes for priority levels
 */
export const priorityClasses = (p?: string) => {
  switch ((p || "").toLowerCase()) {
    case "low":
      return "bg-green-500/10 text-green-700 border-green-400/30";
    case "medium":
      return "bg-yellow-500/10 text-yellow-700 border-yellow-400/30";
    case "high":
      return "bg-orange-500/10 text-orange-700 border-orange-400/30";
    case "urgent":
      return "bg-red-500/10 text-red-700 border-red-400/30";
    default:
      return "bg-surface text-content-secondary border-edge";
  }
};

