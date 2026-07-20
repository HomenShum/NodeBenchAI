import React from "react";
import type { Id } from "@convex/_generated/dataModel";
import { Mail, CalendarDays } from "lucide-react";
import { Checkbox } from "@/components/ai-ui/checkbox";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ai-ui/hover-card";

export type AgendaMiniKind = "task" | "event" | "holiday" | "note";

export interface AgendaMiniRowProps {
  item: any;
  kind: AgendaMiniKind;
  onSelect?: (id: Id<"userEvents"> | Id<"events"> | string) => void;
  // When provided for kind === 'task', show a checkbox and call handler on toggle
  showCheckbox?: boolean;
  onToggleComplete?: (id: Id<"userEvents">, completed: boolean) => void;
  onAcceptProposed?: (id: Id<"events">) => void | Promise<void>;
  onDeclineProposed?: (id: Id<"events">) => void | Promise<void>;
}

function stripeClass(kind: AgendaMiniKind, status?: string): string {
  if (kind === "event") {
    switch (status) {
      case "cancelled":
        return "bg-rose-500/60";
      case "tentative":
        return "bg-[var(--accent-primary)]/60";
      default:
        return "bg-content-muted";
    }
  }
  if (kind === "holiday") {
    return "bg-[var(--accent-primary)]/70";
  }
  if (kind === "note") {
    return "bg-[var(--accent-primary)]/70";
  }
  switch (status) {
    case "blocked":
      return "bg-rose-500/80";
    case "in_progress":
      return "bg-[var(--accent-primary)]/70";
    case "done":
      return "bg-[var(--accent-primary)]/80";
    default:
      return "bg-content-muted";
  }
}

function eventContainerClasses(color?: string): string {
  switch (color) {
    case "green":
      return "border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)]";
    case "amber":
      return "border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)]";
    case "red":
      return "border-rose-200 bg-rose-50";
    case "purple":
      return "border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)]";
    case "gray":
      return "border-edge bg-surface-secondary";
    case "blue":
    default:
      return "border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)]";
  }
}

// Container styling for notes
function noteContainerClasses(): string {
  return "border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)]";
}

function eventBadgeClasses(color?: string): string {
  switch (color) {
    case "green":
      return "border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]";
    case "amber":
      return "border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]";
    case "red":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "purple":
      return "border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]";
    case "gray":
      return "border-edge bg-surface-secondary text-content-secondary";
    case "blue":
    default:
      return "border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]";
  }
}

function formatTimeShort(d: Date): string {
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  if (minutes === 0) return `${hours} ${ampm}`;
  const mm = String(minutes).padStart(2, "0");
  return `${hours}:${mm} ${ampm}`;
}

function eventTime(item: any): string | undefined {
  if (typeof item?.startTime !== "number") return undefined;
  const s = new Date(item.startTime);
  const e = new Date(typeof item?.endTime === "number" ? item.endTime : item.startTime);
  return `${formatTimeShort(s)} – ${formatTimeShort(e)}`;
}

function holidayDate(item: any): string | undefined {
  // Prefer canonical dateKey (YYYY-MM-DD), which represents the wall date
  // independent of timezone. Render it as a local Date to avoid UTC shift.
  if (typeof item?.dateKey === "string") {
    const parts = String(item.dateKey).split("-");
    if (parts.length === 3) {
      const y = Number(parts[0]);
      const m = Number(parts[1]);
      const d = Number(parts[2]);
      if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d)) {
        const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
    }
  }
  // Fallback: use dateMs if provided
  const ms = typeof item?.dateMs === "number" ? item.dateMs : undefined;
  if (ms) {
    const d = new Date(ms);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return undefined;
}

function renderSourceBadge(item: any) {
  const sourceType = item?.sourceType as string | undefined;
  if (!sourceType) return null;
  const isProposed = item?.proposed === true;
  const base = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-tight";
  const pill = isProposed
    ? "border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]"
    : "border-edge bg-surface-secondary text-content-secondary";
  const icon = sourceType === "gmail" ? <Mail className="h-3 w-3" /> : <CalendarDays className="h-3 w-3" />;
  const label = sourceType === "gmail" ? "Gmail" : sourceType === "gcal" ? "GCal" : "Doc";
  return (
    <span className={`${base} ${pill}`} title={isProposed ? "Proposed event" : "Synced event"}>
      {icon}
      {label}
      {isProposed ? "· Proposed" : null}
    </span>
  );
}

export const AgendaMiniRow: React.FC<AgendaMiniRowProps> = React.memo(function AgendaMiniRow({ item, kind, onSelect, showCheckbox, onToggleComplete, onAcceptProposed, onDeclineProposed }) {
  const title: string = String(
    item?.title || (
      kind === "event"
        ? "(Untitled event)"
        : kind === "holiday"
          ? String(item?.name ?? "Holiday")
          : kind === "note"
            ? "(Untitled note)"
            : "(Untitled task)"
    )
  );
  const time = kind === "event" ? eventTime(item) : undefined;
  const id = String(item?._id ?? "");
  return (
    <HoverCard openDelay={90} closeDelay={120}>
      <HoverCardTrigger asChild>
        <div
      data-agenda-mini-row
      data-note-id={kind === 'note' ? id : undefined}
      data-event-id={kind === 'event' ? id : undefined}
      data-task-id={kind === 'task' ? id : undefined}
      className={`relative overflow-visible pl-2 py-1 pr-1 rounded-sm cursor-pointer border ${
        kind === 'event'
          ? eventContainerClasses(item?.color)
          : kind === 'holiday'
            ? 'border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)]'
            : kind === 'note'
              ? noteContainerClasses()
              : 'border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)]'
      }`}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : -1}
      onClick={() => onSelect?.(id)}
      onKeyDown={(e) => { if (onSelect && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect(id); } }}
    >
      <span className={`absolute left-0 top-0 bottom-0 w-0.5 ${stripeClass(kind, item?.status)}`} aria-hidden />
      <div className="min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {kind === 'task' && showCheckbox ? (
            <Checkbox
              checked={String(item?.status ?? 'todo') === 'done'}
              onCheckedChange={(checked) => {
                const tid = (item?._id ?? "") as Id<any>;
                onToggleComplete?.(tid, checked === true);
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label={String(item?.status ?? 'todo') === 'done' ? 'Mark task as not done' : 'Mark task as done'}
              className="h-3.5 w-3.5 rounded border-edge bg-surface text-[var(--accent-primary)] focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/50 dark:bg-surface"
            />
          ) : null}
          <span
            className={`text-xs px-1 rounded border ${
              kind === 'event'
                ? eventBadgeClasses(item?.color)
                : kind === 'holiday'
                  ? 'border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]'
                  : kind === 'note'
                    ? 'border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]'
                  : 'border-[var(--accent-primary)]/20 bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]'
            }`}
          >
            {kind === 'event' ? 'Event' : kind === 'holiday' ? 'Holiday' : kind === 'note' ? 'Note' : 'Task'}
          </span>
          {kind === 'event' ? renderSourceBadge(item) : null}
          <span className={`truncate text-xs ${kind === 'task' && String(item?.status ?? 'todo') === 'done' ? 'text-content-secondary line-through' : 'text-content'}`}>{title}</span>
        </div>
      </div>
        </div>
      </HoverCardTrigger>
      <HoverCardContent
        align="end"
        side="bottom"
        sideOffset={4}
        collisionPadding={8}
        className="z-[9999] w-64 max-w-[80vw] border-edge bg-surface p-2 text-content shadow-lg"
      >
          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-xs font-semibold" title={title}>{title}</div>
            {kind === 'event' ? (
              <span className={`text-xs px-1.5 py-0.5 rounded border ${
                item?.status === 'cancelled' ? 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-700/40' :
                item?.status === 'tentative' ? 'bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border-[var(--accent-primary)]/20' :
                'bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border-[var(--accent-primary)]/20'
              }`}>
                {String(item?.status ?? 'confirmed')}
              </span>
            ) : kind === 'task' ? (
              <span className={`text-xs px-1.5 py-0.5 rounded border ${
                item?.status === 'blocked' ? 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-700/40' :
                item?.status === 'in_progress' ? 'bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border-[var(--accent-primary)]/20' :
                item?.status === 'done' ? 'bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border-[var(--accent-primary)]/20' :
                'bg-surface-secondary text-content-secondary border-edge'
              }`}>
                {String(item?.status ?? 'todo')}
              </span>
            ) : kind === 'holiday' ? (
              <span className="text-xs px-1.5 py-0.5 rounded border bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border-[var(--accent-primary)]/20">Holiday</span>
            ) : (
              <span className="text-xs px-1.5 py-0.5 rounded border bg-[var(--accent-primary-bg)] text-[var(--accent-primary)] border-[var(--accent-primary)]/20">Note</span>
            )}
          </div>
          {/* Meta */}
          <div className="mt-1 space-y-1">
            {kind === 'event' ? (
              <>
                {time && (
                  <div className="text-xs text-content-secondary">{time}</div>
                )}
                {item?.location && (
                  <div className="text-xs text-content-secondary">📍 {String(item.location)}</div>
                )}
                {Array.isArray(item?.attendees) && item.attendees.length > 0 && (
                  <div className="text-xs text-content-secondary">👥 {item.attendees.length} attendee{item.attendees.length > 1 ? 's' : ''}</div>
                )}
                {item?.description && (
                  <div className="text-xs text-content-secondary">
                    {String(item.description).slice(0, 120)}{String(item.description).length > 120 ? '…' : ''}
                  </div>
                )}
                {item?.proposed && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      className="px-2 py-1 text-xs rounded bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary-hover)]"
                      onClick={(e) => { e.stopPropagation(); onAcceptProposed?.(item?._id as Id<"events">); }}
                    >
                      Accept
                    </button>
                    <button
                      className="px-2 py-1 text-xs rounded border border-edge text-content-secondary hover:bg-surface-hover"
                      onClick={(e) => { e.stopPropagation(); onDeclineProposed?.(item?._id as Id<"events">); }}
                    >
                      Decline
                    </button>
                  </div>
                )}
              </>
            ) : kind === 'task' ? (
              <>
                {typeof item?.dueDate === 'number' && (
                  <div className="text-xs text-content-secondary">Due: {new Date(item.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                )}
                {item?.priority && (
                  <div className="text-xs text-content-secondary">Priority: {String(item.priority)}</div>
                )}
                {item?.description && (
                  <div className="text-xs text-content-secondary">
                    {String(item.description).slice(0, 120)}{String(item.description).length > 120 ? '…' : ''}
                  </div>
                )}
              </>
            ) : kind === 'holiday' ? (
              <>
                <div className="text-xs text-content-secondary">Date: {holidayDate(item) ?? ''}</div>
                {item?.country && (
                  <div className="text-xs text-content-secondary">Country: {String(item.country)}</div>
                )}
              </>
            ) : (
              <>
                {typeof item?.agendaDate === 'number' && (
                  <div className="text-xs text-content-secondary">Date: {new Date(item.agendaDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                )}
              </>
            )}
          </div>
      </HoverCardContent>
    </HoverCard>
  );
});

export default AgendaMiniRow;
