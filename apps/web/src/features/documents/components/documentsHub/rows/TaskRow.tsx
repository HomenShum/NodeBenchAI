/**
 * TaskRow Component
 * 
 * A row component for displaying tasks and events in list view with:
 * - Status stripe (clickable to cycle status)
 * - Checkbox for completion
 * - Metadata pills (status, priority, due date, refs)
 * - Quick actions (favorite, delete, open, convert)
 * - Event/Task conversion support
 */

import { memo } from "react";
import { useQuery, useMutation } from "convex/react";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { CalendarDays, ListTodo, Star, Trash2, Edit3, ArrowRightLeft } from "lucide-react";
import { api } from "../../../../../../convex/_generated/api";
import { toast } from "sonner";
import { statusChipClasses, statusLabel, priorityClasses, type TaskStatus } from "../utils/statusHelpers";
import { isAllDayEvent, renderEventTime } from "../utils/eventHelpers";
import { RefsPills } from "../pills/RefsPills";

export interface TaskRowProps {
  t: any;
  kind?: "task" | "event";
  onSelect?: (id: Id<"userEvents"> | Id<"events">) => void;
  onChangeStatus?: (
    id: Id<"userEvents"> | Id<"events">,
    status: TaskStatus | "confirmed" | "tentative" | "cancelled",
  ) => void;
  density?: "compact" | "comfortable";
  onOpenRef?: (kind: "document" | "task" | "event", id: string) => void;
}

/**
 * Cycle through task statuses: todo → in_progress → done → blocked → todo
 */
const cycleStatus = (current: TaskStatus): TaskStatus => {
  switch (current) {
    case "todo":
      return "in_progress";
    case "in_progress":
      return "done";
    case "done":
      return "blocked";
    case "blocked":
      return "todo";
    default:
      return "todo";
  }
};

/**
 * Cycle through event statuses: confirmed → tentative → cancelled → confirmed
 */
const cycleEventStatus = (current: string): "confirmed" | "tentative" | "cancelled" => {
  switch (current) {
    case "confirmed":
      return "tentative";
    case "tentative":
      return "cancelled";
    case "cancelled":
      return "confirmed";
    default:
      return "confirmed";
  }
};

export const TaskRowGlobal = memo(({
  t,
  kind = "task",
  onSelect,
  onChangeStatus: _onChangeStatus,
  density: _density = "comfortable",
  onOpenRef,
}: TaskRowProps) => {
  const me = useQuery(api.domains.auth.auth.loggedInUser);

  const taskStatusBar = (s?: string) => {
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

  const eventStatusBar = (s?: string) => {
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

  // Local mutations for favorite and delete actions
  const toggleTaskFavorite = useMutation(api.domains.tasks.userEvents.toggleFavorite);
  const deleteTaskLocal = useMutation(api.domains.tasks.userEvents.deleteTask);
  const updateTaskStatus = useMutation(api.domains.tasks.userEvents.updateTask);

  // Event-side actions
  const deleteEventLocal = useMutation(api.domains.calendar.events.deleteEvent);
  const createEventLocal = useMutation(api.domains.calendar.events.createEvent);
  const createTaskLocal = useMutation(api.domains.tasks.userEvents.createTask);

  const handleStarClick = (e: any) => {
    e.stopPropagation();
    toggleTaskFavorite({ taskId: t._id }).catch(console.error);
  };

  const handleDeleteTask = (e: any) => {
    e.stopPropagation();
    if (window.confirm("Delete this task? This cannot be undone.")) {
      deleteTaskLocal({ taskId: t._id }).catch(console.error);
    }
  };

  // Convert helpers scoped to this row
  const convertEventToTask = async () => {
    try {
      const ev: any = t;
      const title = String(ev?.title ?? "Untitled");
      const baseDesc = typeof ev?.description === "string" ? ev.description : "";
      const hasAllDay = !!ev?.allDay;
      const sMs = typeof ev?.startTime === "number" ? ev.startTime : undefined;
      const eMs = typeof ev?.endTime === "number" ? ev.endTime : sMs;

      const parts: string[] = [];
      if (typeof sMs === "number") {
        const s = new Date(sMs);
        const e = new Date(typeof eMs === "number" ? eMs : sMs);

        if (hasAllDay) {
          parts.push(`Event time: ${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
        } else {
          const sd = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const st = s.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const et = e.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          parts.push(`Event time: ${sd} ${st} - ${et}`);
        }
      }

      if (typeof ev?.location === "string" && ev.location.trim()) {
        parts.push(`Location: ${ev.location.trim()}`);
      }

      const metaBlock = parts.length ? `\n\n---\n${parts.join("\n")}` : "";
      const description = `${baseDesc}${metaBlock}`.trim();
      const descriptionJson = typeof ev?.descriptionJson === "string" ? ev.descriptionJson : undefined;
      const due = typeof ev?.startTime === "number" ? ev.startTime : undefined;
      const docId = ev?.documentId as Id<"documents"> | undefined;
      const tagsArr: string[] = Array.isArray(ev?.tags)
        ? ((ev.tags as any[]).filter((x) => typeof x === "string") as string[])
        : [];
      const colorVal = typeof ev?.color === "string" && ev.color.trim() ? ev.color.trim() : undefined;

      await createTaskLocal({
        title,
        description: description || undefined,
        descriptionJson,
        dueDate: due,
        documentId: docId,
        refs: [{ kind: "event", id: ev._id as Id<"events"> }],
        tags: tagsArr.length ? tagsArr : undefined,
        color: colorVal,
      });

      await deleteEventLocal({ eventId: ev._id as Id<"events"> });
      toast.success("Converted event to task");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to convert event");
    }
  };

  const convertTaskToEvent = async () => {
    try {
      const task: any = t;
      const title = String(task?.title ?? "Untitled");
      const description = typeof task?.description === "string" ? task.description : "";
      const descriptionJson = typeof task?.descriptionJson === "string" ? task.descriptionJson : undefined;
      const start =
        typeof task?.startDate === "number"
          ? task.startDate
          : typeof task?.dueDate === "number"
            ? task.dueDate
            : Date.now();
      const end = start + 60 * 60 * 1000;
      const colorVal = typeof task?.color === "string" && task.color.trim() ? task.color.trim() : undefined;
      const docId = task?.documentId as Id<"documents"> | undefined;
      const tagsArr: string[] = Array.isArray(task?.tags)
        ? ((task.tags as any[]).filter((x) => typeof x === "string") as string[])
        : [];

      await createEventLocal({
        title,
        description: description || undefined,
        descriptionJson,
        startTime: start,
        endTime: end,
        allDay: false,
        color: colorVal,
        documentId: docId,
        tags: tagsArr.length ? tagsArr : undefined,
        status: "confirmed",
      });

      await deleteTaskLocal({ taskId: task._id as Id<"userEvents"> });
      toast.success("Converted task to event");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to convert task");
    }
  };

  const handleStripeToggle = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();

    if (kind === "task") {
      const next = cycleStatus(t.status as TaskStatus);
      if (_onChangeStatus) {
        _onChangeStatus(t._id, next);
      } else {
        updateTaskStatus({ taskId: t._id, status: next }).catch(console.error);
      }
    } else {
      const next = cycleEventStatus(t.status as string);
      _onChangeStatus?.(t._id, next);
    }
  };

  return (
    <div className="group relative">
      <div
        className={
          "document-item group/doc relative px-3 py-2 rounded-sm overflow-hidden cursor-pointer text-sm " +
          "bg-surface-secondary border border-edge " +
          "transition-all duration-200 hover:bg-surface-hover " +
          "flex items-center justify-between " +
          "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring hover:ring-2 ring-1 ring-ring"
        }
        role="button"
        tabIndex={0}
        onClick={() => onSelect?.(t._id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect?.(t._id);
          }
        }}
      >
        {/* Watermark: consistent with DocumentCards via shared class */}
        <span
          className="document-card__bg document-row__bg text-indigo-600 dark:text-indigo-400"
          aria-hidden
        >
          {kind === "event" ? (
            <CalendarDays className="h-10 w-10 rotate-12" />
          ) : (
            <ListTodo className="h-10 w-10 rotate-12" />
          )}
        </span>

        {/* Left status bar: full-height clickable stripe to cycle status */}
        <span
          className={`absolute left-0 top-0 bottom-0 w-1 ${kind === "event" ? eventStatusBar(t.status) : taskStatusBar(t.status)} cursor-pointer`}
          role="button"
          tabIndex={0}
          title={
            kind === "event"
              ? "Cycle status"
              : "Cycle status (todo → in_progress → done → blocked)"
          }
          aria-label={kind === "event" ? "Cycle status" : "Cycle task status"}
          onClick={handleStripeToggle}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleStripeToggle(e);
            }
          }}
        />

        {/* Content row */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Completion / All-day checkbox */}
          {kind === "task" ? (
            <input
              type="checkbox"
              checked={t.status === "done"}
              onChange={(e) => {
                e.stopPropagation();
                const next: TaskStatus = t.status === "done" ? "todo" : "done";
                _onChangeStatus?.(t._id, next);
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label={t.status === "done" ? "Mark as not completed" : "Mark as completed"}
              className="h-4 w-4 rounded border-edge text-indigo-600 focus:ring-2 focus:ring-ring bg-surface"
            />
          ) : isAllDayEvent(t) ? (
            <input
              type="checkbox"
              checked={t.status !== "cancelled"}
              onChange={(e) => {
                e.stopPropagation();
                _onChangeStatus?.(t._id, e.target.checked ? "confirmed" : "cancelled");
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label={t.status !== "cancelled" ? "Mark event unchecked" : "Mark event checked"}
              className="h-4 w-4 rounded border-edge text-indigo-600 focus:ring-2 focus:ring-ring bg-surface"
            />
          ) : (
            <div className="w-4 h-4" />
          )}

          {/* Small neutral icon tile */}
          <div className="w-7 h-7 rounded-md bg-surface border border-edge text-content-secondary flex items-center justify-center shrink-0">
            {kind === "event" ? (
              <CalendarDays className="h-4 w-4 group-hover/doc:text-content" />
            ) : (
              <ListTodo className="h-4 w-4 group-hover/doc:text-content" />
            )}
          </div>

          <div className="min-w-0">
            <div
              className={`text-sm font-medium truncate ${kind === "task" && t.status === "done" ? "text-content-secondary line-through" : "text-content"}`}
            >
              {t.title}
            </div>

            <div className="mt-1 flex items-center gap-2 flex-nowrap overflow-hidden">
              {kind === "task" ? (
                <>
                  {t.status && (
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-md border ${statusChipClasses(t.status)}`}
                      title={`Status: ${t.status}`}
                    >
                      {statusLabel(t.status)}
                    </span>
                  )}

                  {t.priority && (
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-md border ${priorityClasses(t.priority)}`}
                      title={`Priority: ${t.priority}`}
                    >
                      {String(t.priority).toUpperCase()}
                    </span>
                  )}

                  {t.dueDate && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded-md border bg-surface text-content-secondary border-edge"
                      title={`Due ${new Date(t.dueDate).toLocaleString()}`}
                    >
                      Due {new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  )}

                  {/* References */}
                  <RefsPills
                    refs={(() => {
                      const o: unknown = t;
                      if (o && typeof o === "object" && "refs" in (o as Record<string, unknown>)) {
                        const r = (o as Record<string, unknown>).refs as unknown;
                        return Array.isArray(r)
                          ? (r as Array<{ kind: "document" | "task" | "event"; id: string }>)
                          : undefined;
                      }
                      return undefined;
                    })()}
                    onOpenRef={onOpenRef}
                  />
                </>
              ) : (
                <>
                  {renderEventTime(t)}

                  {isAllDayEvent(t) && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded-md border bg-surface text-content-secondary border-edge"
                      title={`Date ${new Date(t.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                    >
                      {new Date(t.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  )}

                  {/* Optional event references (for future) */}
                  <RefsPills
                    refs={(() => {
                      const o: unknown = t;
                      if (o && typeof o === "object" && "refs" in (o as Record<string, unknown>)) {
                        const r = (o as Record<string, unknown>).refs as unknown;
                        return Array.isArray(r)
                          ? (r as Array<{ kind: "document" | "task" | "event"; id: string }>)
                          : undefined;
                      }
                      return undefined;
                    })()}
                    onOpenRef={onOpenRef}
                  />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right-side meta */}
        <div className="ml-2 mr-1 flex items-center">
          <div className="w-5 h-5" />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 transition-opacity duration-200 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          {kind === "task" ? (
            <>
              {/* Favorite */}
              <button
                onClick={handleStarClick}
                aria-label={t.isFavorite ? "Unfavorite task" : "Favorite task"}
                title={t.isFavorite ? "Unfavorite" : "Favorite"}
                className={`w-6 h-6 rounded-md flex items-center justify-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  t.isFavorite
                    ? "bg-yellow-500 text-yellow-100 shadow-sm"
                    : "bg-surface hover:bg-surface-hover text-content-secondary hover:text-indigo-600 dark:text-indigo-400 border border-edge"
                }`}
              >
                <Star className={`h-3.5 w-3.5 ${t.isFavorite ? "fill-current" : ""}`} />
              </button>

              {/* Delete */}
              <button
                onClick={handleDeleteTask}
                aria-label="Delete task"
                title="Delete"
                className="w-6 h-6 rounded-md flex items-center justify-center bg-surface hover:bg-red-500 text-content-secondary hover:text-white border border-edge hover:border-red-500 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>

              {/* Open */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(t._id);
                }}
                aria-label="Open"
                title="Open"
                className="w-6 h-6 rounded-md flex items-center justify-center bg-surface hover:bg-surface-hover text-content-secondary hover:text-indigo-600 dark:text-indigo-400 border border-edge hover:border-indigo-500/30/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>

              {/* Convert to Event */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void convertTaskToEvent();
                }}
                aria-label="Convert to event"
                title="Convert to event"
                className="w-6 h-6 rounded-md flex items-center justify-center bg-surface hover:bg-surface-hover text-content-secondary hover:text-indigo-600 dark:text-indigo-400 border border-edge hover:border-indigo-500/30/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              {/* Delete event */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm("Delete this event? This cannot be undone.")) {
                    deleteEventLocal({ eventId: t._id }).catch(console.error);
                  }
                }}
                aria-label="Delete event"
                title="Delete"
                className="w-6 h-6 rounded-md flex items-center justify-center bg-surface hover:bg-red-500 text-content-secondary hover:text-white border border-edge hover:border-red-500 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>

              {/* Open event */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(t._id);
                }}
                aria-label="Open"
                title="Open"
                className="w-6 h-6 rounded-md flex items-center justify-center bg-surface hover:bg-surface-hover text-content-secondary hover:text-indigo-600 dark:text-indigo-400 border border-edge hover:border-indigo-500/30/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>

              {/* Convert to Task */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void convertEventToTask();
                }}
                aria-label="Convert to task"
                title="Convert to task"
                className="w-6 h-6 rounded-md flex items-center justify-center bg-surface hover:bg-surface-hover text-content-secondary hover:text-indigo-600 dark:text-indigo-400 border border-edge hover:border-indigo-500/30/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

