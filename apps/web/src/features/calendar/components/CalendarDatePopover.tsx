import React from "react";
import {
  Calendar as CalIcon,
  FileText,
  Plus,
  Sparkles,
  Clock,
  X,
  Sun,
  Mail,
  Check,
  CheckSquare,
  StickyNote,
  MessageCircle,
} from "lucide-react";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";

type BriefEvent = {
  _id?: string;
  title: string;
  startTime?: number;
  endTime?: number;
  allDay?: boolean;
  proposed?: boolean;
  sourceType?: string;
  location?: string;
  rawSummary?: string;
  documentId?: string;
};

type BriefTask = { _id?: string; title: string; dueDate?: number; status?: string; documentId?: string };
type BriefNote = { _id?: string; title: string; documentId?: string };
type BriefHoliday = { _id?: string; title: string; dateKey?: string };
type BriefFile = { _id?: string; title: string; fileType?: string };

export interface CalendarDatePopoverProps {
  date: Date;
  events?: BriefEvent[];
  tasks?: BriefTask[];
  notes?: BriefNote[];
  holidays?: BriefHoliday[];
  files?: BriefFile[];
  isLoading?: boolean;
  onClose?: () => void;
  onAddEvent?: (dateMs: number) => void;
  onPrepDay?: (dateMs: number) => void;
  onTimeBlock?: (dateMs: number) => void;
  onAcceptProposed?: (eventId?: string) => void;
  onDeclineProposed?: (eventId?: string) => void;
  onSelectEvent?: (eventId?: string, documentId?: string) => void;
  onSelectTask?: (taskId?: string, documentId?: string) => void;
  onSelectNote?: (noteId?: string, documentId?: string) => void;
  className?: string;
}

function formatShortTime(ms?: number, allDay?: boolean) {
  if (!ms || allDay) return "All day";
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function CalendarDatePopover({
  date,
  events = [],
  tasks = [],
  notes = [],
  holidays = [],
  files = [],
  isLoading = false,
  onClose,
  onAddEvent,
  onPrepDay,
  onTimeBlock,
  onAcceptProposed,
  onDeclineProposed,
  onSelectEvent,
  onSelectTask,
  onSelectNote,
  className = "",
}: CalendarDatePopoverProps) {
  const dateMs = date.getTime();
  const { openWithContext } = useFastAgent();

  // Handler to open Fast Agent with email event context
  const handleAskAgent = React.useCallback((evt: BriefEvent) => {
    const shortDate = date.toLocaleDateString('en-US', { month: "short", day: "numeric" });
    const timeStr = formatShortTime(evt.startTime, evt.allDay);
    const prompt = evt.proposed
      ? `I have a proposed email event "${evt.title}" on ${shortDate} at ${timeStr}. Can you help me understand this event and decide if I should accept it?${evt.rawSummary ? ` Here's the context: ${evt.rawSummary}` : ""}`
      : `Tell me more about the event "${evt.title}" on ${shortDate} at ${timeStr}.${evt.location ? ` Location: ${evt.location}.` : ""}`;

    openWithContext({
      initialMessage: prompt,
      contextTitle: `Calendar: ${evt.title}`,
    });
    onClose?.();
  }, [date, openWithContext, onClose]);
  const isToday = new Date().toDateString() === date.toDateString();
  const weekday = date.toLocaleDateString('en-US', { weekday: "long" });
  const shortDate = date.toLocaleDateString('en-US', { month: "short", day: "numeric" });
  const hasEvents = events.length > 0;
  const hasTasks = tasks.length > 0;
  const hasNotes = notes.length > 0;
  const hasHolidays = holidays.length > 0;
  const hasFiles = files.length > 0;
  const focusLabel =
    hasEvents || hasTasks
      ? `${events.length + tasks.length} ${events.length + tasks.length === 1 ? "Item" : "Items"}`
      : "✨ Focus Mode";
  const firstEvent = hasEvents
    ? events.slice().sort((a, b) => (a.startTime || 0) - (b.startTime || 0))[0]
    : null;

  return (
    <div
      className={`w-80 bg-surface/95 backdrop-blur-xl rounded-lg shadow-2xl border border-surface/70 overflow-hidden ${className}`}
      role="dialog"
      aria-label={`Daily brief for ${shortDate}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className={`px-5 py-4 ${(hasEvents || hasTasks || hasNotes || hasHolidays || hasFiles) ? "bg-surface" : "bg-white/[0.03]"}`}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold text-content-secondary">
            {isToday ? "Today" : weekday}
          </span>
          <div className="px-2 py-0.5 bg-surface/70 rounded-full border border-edge text-xs font-medium text-content-secondary">
            {focusLabel}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <h2 className="text-2xl text-content">{shortDate}</h2>
          {onClose && (
            <button
              aria-label="Close"
              className="w-7 h-7 rounded-full border border-edge text-content-secondary hover:bg-surface-hover"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
            >
              <X className="w-4 h-4 mx-auto" />
            </button>
          )}
        </div>
        <div className="mt-2 inline-flex items-center gap-1 text-xs text-content-secondary">
          <Sun className="w-3.5 h-3.5" />
          {hasEvents
            ? `First: ${formatShortTime(firstEvent?.startTime, firstEvent?.allDay)}`
            : "Clear schedule · Great for deep work"}
        </div>
      </div>

      {/* Body */}
      <div className="p-3 space-y-3 max-h-[360px] overflow-y-auto">
        {isLoading ? (
          <div className="h-16 flex items-center justify-center text-xs text-content-secondary">Loading…</div>
        ) : (
          <>
            {!hasEvents && !hasTasks && !hasNotes && !hasHolidays && !hasFiles && (
              <div className="py-5 text-center text-sm text-content-secondary">
                Clear schedule. Great day for deep work.
              </div>
            )}

            {/* Holidays */}
            {hasHolidays && (
              <div className="space-y-1.5">
                <div className="px-1 text-xs font-semibold text-[var(--accent-primary)] tracking-wide flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Holidays
                </div>
                {holidays.slice(0, 4).map((h) => (
                  <div
                    key={h._id || h.title}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--accent-primary-bg)] border border-[var(--accent-primary)]/20 text-xs text-[var(--accent-primary)]"
                  >
                    <span className="w-1 h-4 bg-[var(--accent-primary)] rounded-full" />
                    <span className="truncate">{h.title}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Events */}
            {hasEvents && (
              <div className="space-y-1.5">
                <div className="px-1 text-xs font-semibold text-[var(--accent-primary)] tracking-wide flex items-center gap-1">
                  <CalIcon className="w-3 h-3" />
                  Events
                </div>
                {events.slice(0, 4).map((evt) => (
                  <div
                    key={evt._id || `${evt.title}-${evt.startTime}`}
                    className="flex items-start gap-3 p-2 rounded-lg hover:bg-surface-hover transition-colors border border-edge cursor-pointer"
                    onClick={() => onSelectEvent?.(evt._id, evt.documentId)}
                  >
                    <div className="w-1 h-12 rounded-full bg-[var(--accent-primary)]" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium text-content truncate">{evt.title}</div>
                        {evt.proposed && (
                          <span className="px-2 py-0.5 text-xs rounded-full bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border border-[var(--accent-primary)]/20">
                            Proposed
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-content-secondary">
                        <span>{formatShortTime(evt.startTime, evt.allDay)}</span>
                        {evt.location && <span className="truncate text-content-secondary">· {evt.location}</span>}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-content-secondary">
                        {evt.sourceType === "gmail" && <Mail className="w-3.5 h-3.5 text-[var(--accent-primary)]" />}
                        {evt.sourceType === "gcal" && <CalIcon className="w-3.5 h-3.5 text-[var(--accent-primary)]" />}
                        {evt.rawSummary && <span className="truncate text-content-muted">{evt.rawSummary}</span>}
                      </div>
                      {/* Action buttons for email events */}
                      {(evt.proposed || evt.sourceType === "gmail") && (
                        <div className="flex items-center gap-2 pt-1 flex-wrap">
                          {evt.proposed && evt._id && (
                            <>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAcceptProposed?.(evt._id);
                                }}
                              >
                                <Check className="w-3 h-3" />
                                Accept
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeclineProposed?.(evt._id);
                                }}
                              >
                                <X className="w-3 h-3" />
                                Decline
                              </button>
                            </>
                          )}
                          {/* Ask Agent button for email events */}
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAskAgent(evt);
                            }}
                            title="Ask AI agent about this event"
                          >
                            <MessageCircle className="w-3 h-3" />
                            Ask Agent
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tasks */}
            {hasTasks && (
              <div className="space-y-1.5">
                <div className="px-1 text-xs font-semibold text-[var(--accent-primary)] tracking-wide flex items-center gap-1">
                  <CheckSquare className="w-3 h-3" />
                  Tasks
                </div>
                {tasks.slice(0, 4).map((task) => (
                  <div
                    key={task._id || task.title}
                    className="flex items-center gap-3 p-2 rounded-lg border border-edge hover:bg-surface-hover transition-colors cursor-pointer"
                    onClick={() => onSelectTask?.(task._id, task.documentId)}
                  >
                    <CheckSquare className="w-4 h-4 text-[var(--accent-primary)]" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-content truncate">{task.title}</div>
                      <div className="text-xs text-content-secondary">
                        {formatShortTime(task.dueDate, false)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Notes */}
            {hasNotes && (
              <div className="space-y-1.5">
                <div className="px-1 text-xs font-semibold text-[var(--accent-primary)] tracking-wide flex items-center gap-1">
                  <StickyNote className="w-3 h-3" />
                  Notes
                </div>
                {notes.slice(0, 4).map((note) => (
                  <div
                    key={note._id || note.title}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--accent-primary-bg)] border border-[var(--accent-primary)]/20 transition-colors cursor-pointer text-xs text-content"
                    onClick={() => onSelectNote?.(note._id, note.documentId)}
                  >
                    <StickyNote className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                    <span className="truncate">{note.title}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Files */}
            {hasFiles && (
              <div className="pt-1 border-t border-edge space-y-1">
                <div className="px-1 text-xs font-semibold text-content-muted mb-1">Related work</div>
                <div className="space-y-1">
                  {files.slice(0, 4).map((f) => (
                    <div
                      key={f._id || f.title}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--accent-primary-bg)] text-content text-xs border border-edge"
                    >
                      <FileText className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                      <span className="truncate">{f.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer actions */}
      <div className="p-3 bg-surface-secondary/60 border-t border-edge grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onAddEvent?.(dateMs)}
          className="flex items-center justify-center gap-2 py-2 bg-surface border border-edge shadow-sm rounded-lg text-xs font-medium text-content hover:bg-surface-hover hover:border-edge transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Event
        </button>
        <button
          type="button"
          onClick={() => onPrepDay?.(dateMs)}
          className="flex items-center justify-center gap-2 py-2 bg-[var(--accent-primary)] text-white shadow-md rounded-lg text-xs font-medium hover:bg-[var(--accent-primary-hover)] transition-all"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Prep Day
        </button>
        <button
          type="button"
          onClick={() => onTimeBlock?.(dateMs)}
          className="col-span-2 flex items-center justify-center gap-2 py-2 bg-surface border border-edge rounded-lg text-xs font-medium text-content hover:bg-surface-hover transition-all"
        >
          <Clock className="w-3.5 h-3.5" />
          Time Block Suggestions
        </button>
      </div>
    </div>
  );
}

export default CalendarDatePopover;
