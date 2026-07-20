import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export interface CalendarEvent {
  _id: Id<"events"> | string;
  title: string;
  startTime: number;
  endTime?: number;
  allDay?: boolean;
  description?: string;
  location?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  color?: string;
  documentId?: Id<"documents">;
  proposed?: boolean;
  rawSummary?: string;
  sourceType?: "gmail" | "gcal" | "doc";
}

export interface CalendarTask {
  _id: Id<"userEvents"> | string;
  title: string;
  dueDate?: number;
  status?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  documentId?: Id<"documents">;
}

export interface CalendarHoliday {
  _id?: string;
  name: string;
  dateKey: string;
}

export interface CalendarNote {
  _id: Id<"documents"> | string;
  title: string;
  documentId?: Id<"documents">;
  agendaDate?: number;
}

export interface CalendarAgendaResult {
  events: CalendarEvent[];
  tasks: CalendarTask[];
  holidays: CalendarHoliday[];
  notes: CalendarNote[];
  isLoading: boolean;
}

export interface UseCalendarAgendaOptions {
  startMs: number;
  endMs: number;
  country?: string;
  holidaysStartUtc?: number;
  holidaysEndUtc?: number;
  skip?: boolean;
}

/**
 * Unified hook for fetching calendar agenda data.
 * Both the main calendar and mini calendar should use this hook
 * to ensure consistent data across all calendar views.
 */
export function useCalendarAgenda({
  startMs,
  endMs,
  country = "US",
  holidaysStartUtc,
  holidaysEndUtc,
  skip = false,
}: UseCalendarAgendaOptions): CalendarAgendaResult {
  const agenda = useQuery(
    api.domains.calendar.calendar.listAgendaInRange,
    skip
      ? "skip"
      : {
          start: startMs,
          end: endMs,
          country,
          holidaysStartUtc: holidaysStartUtc ?? startMs,
          holidaysEndUtc: holidaysEndUtc ?? endMs,
        }
  );

  const events = useMemo<CalendarEvent[]>(() => {
    if (!agenda?.events) return [];
    return (agenda.events as CalendarEvent[]).map((ev) => ({
      _id: ev._id,
      title: ev.title ?? "Untitled",
      startTime: ev.startTime,
      endTime: ev.endTime,
      allDay: ev.allDay,
      description: ev.description,
      location: ev.location,
      status: ev.status,
      color: ev.color,
      documentId: ev.documentId,
      proposed: ev.proposed,
      rawSummary: ev.rawSummary,
      sourceType: ev.sourceType,
    }));
  }, [agenda?.events]);

  const tasks = useMemo<CalendarTask[]>(() => {
    if (!agenda?.tasks) return [];
    return (agenda.tasks as CalendarTask[]).map((t) => ({
      _id: t._id,
      title: t.title ?? "Untitled",
      dueDate: t.dueDate,
      status: t.status,
      priority: t.priority,
      documentId: t.documentId,
    }));
  }, [agenda?.tasks]);

  const holidays = useMemo<CalendarHoliday[]>(() => {
    if (!agenda?.holidays) return [];
    return (agenda.holidays as any[]).map((h) => ({
      _id: h._id ?? h.dateKey,
      name: h.name ?? h.title ?? "Holiday",
      dateKey: h.dateKey,
    }));
  }, [agenda?.holidays]);

  const notes = useMemo<CalendarNote[]>(() => {
    if (!agenda?.notes) return [];
    return (agenda.notes as any[]).map((n) => ({
      _id: n._id ?? n.documentId,
      title: n.title ?? "Note",
      documentId: n.documentId ?? n._id,
      agendaDate: n.agendaDate,
    }));
  }, [agenda?.notes]);

  return {
    events,
    tasks,
    holidays,
    notes,
    isLoading: agenda === undefined,
  };
}

/**
 * Helper to compute week range in UTC from a given date and timezone offset.
 */
export function getWeekRangeUtc(dateMs: number, tzOffsetMinutes: number): { startMs: number; endMs: number } {
  const offsetMs = tzOffsetMinutes * 60 * 1000;
  const local = dateMs + offsetMs;
  const d = new Date(local);
  const day = d.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(local - diffToMonday * 24 * 60 * 60 * 1000);
  monday.setUTCHours(0, 0, 0, 0);
  const startMs = monday.getTime() - offsetMs;
  const endMs = startMs + 7 * 24 * 60 * 60 * 1000 - 1;
  return { startMs, endMs };
}

/**
 * Helper to compute month range in UTC from an anchor date and timezone offset.
 */
export function getMonthRangeUtc(
  anchor: Date,
  tzOffsetMinutes: number
): { startMs: number; endMs: number; gridStartMs: number; gridEndMs: number } {
  const offsetMs = tzOffsetMinutes * 60 * 1000;
  
  // First day of month
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 0, 0, 0, 0);
  const monthStartMs = firstOfMonth.getTime() - offsetMs;
  
  // Last day of month
  const lastOfMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999);
  const monthEndMs = lastOfMonth.getTime() - offsetMs;
  
  // Grid range (6 weeks to cover full calendar grid)
  const dayOfWeek = (firstOfMonth.getDay() + 6) % 7; // 0=Mon..6=Sun
  const gridStartLocal = new Date(
    firstOfMonth.getFullYear(),
    firstOfMonth.getMonth(),
    firstOfMonth.getDate() - dayOfWeek,
    0, 0, 0, 0
  );
  const gridEndLocal = new Date(
    gridStartLocal.getFullYear(),
    gridStartLocal.getMonth(),
    gridStartLocal.getDate() + 41,
    23, 59, 59, 999
  );
  
  return {
    startMs: monthStartMs,
    endMs: monthEndMs,
    gridStartMs: gridStartLocal.getTime() - offsetMs,
    gridEndMs: gridEndLocal.getTime() - offsetMs,
  };
}
