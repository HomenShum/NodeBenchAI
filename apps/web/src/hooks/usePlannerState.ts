import { useMemo, useState, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Shared planner state across CalendarHomeHub and DocumentsHomeHub.
 *
 * Phase 1: focusedDateMs + setter
 * Phase 2: view handlers + quick-add task helper
 * Phase 3: upcoming lists + mini-month calendar data
 */
export function usePlannerState() {
  // Initialize to local midnight today
  const todayLocal = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const [focusedDateMs, setFocusedDateMs] = useState<number>(todayLocal);

  // Convex base data
  const loggedInUser = useQuery(api.domains.auth.auth.loggedInUser);
  const prefs = useQuery(api.domains.auth.userPreferences.getCalendarUiPrefs);

  // Compute timezone offset (minutes east of UTC) honoring user preference when available
  const tzOffsetMinutes = useMemo(() => {
    const timeZone: string | undefined = prefs?.timeZone;
    function offsetMinutesForZone(tz: string | undefined, date: Date): number {
      if (!tz) return -date.getTimezoneOffset();
      try {
        const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
        const parts = dtf.formatToParts(date);
        const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
        const y = get("year");
        const m = (get("month") || 1) - 1;
        const d = get("day") || 1;
        const h = get("hour") || 0;
        const mi = get("minute") || 0;
        const s = get("second") || 0;
        const asUTC = Date.UTC(y, m, d, h, mi, s);
        const diffMin = (asUTC - date.getTime()) / 60000;
        return diffMin;
      } catch {
        return -date.getTimezoneOffset();
      }
    }
    return offsetMinutesForZone(timeZone, new Date());
  }, [prefs]);
  const offsetMs = tzOffsetMinutes * 60 * 1000;

  // Agenda-selected date (canonical UTC of local day start)
  const [agendaSelectedDateMs, _setAgendaSelectedDateMs] = useState<number | null>(null);
  const todayStartUtc = useMemo(() => {
    const local = Date.now() + offsetMs;
    const d = new Date(local); d.setUTCHours(0,0,0,0);
    return d.getTime() - offsetMs;
  }, [offsetMs]);
  const agendaStartUtc = (agendaSelectedDateMs ?? todayStartUtc);
  const agendaEndUtc = agendaStartUtc + (24 * 60 * 60 * 1000 - 1);

  // Upcoming (week) range anchored on focused date
  const weekStartUtc = useMemo(() => {
    const anchorLocal = new Date(((focusedDateMs ?? todayStartUtc) + offsetMs));
    anchorLocal.setUTCHours(0, 0, 0, 0);
    const dow = anchorLocal.getUTCDay();
    const diffToMonday = (dow + 6) % 7; // 0=Mon..6=Sun
    const mondayLocal = new Date(anchorLocal.getTime() - diffToMonday * 24 * 60 * 60 * 1000);
    return mondayLocal.getTime() - offsetMs;
  }, [focusedDateMs, todayStartUtc, offsetMs]);
  const weekEndUtc = weekStartUtc + 7 * 24 * 60 * 60 * 1000 - 1;

  // Holiday ranges (local day/week)
  const todayHolidayRange = useMemo(() => {
    const d = new Date(agendaStartUtc + offsetMs);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    return { startUtc: Date.parse(`${key}T00:00:00Z`), endUtc: Date.parse(`${key}T23:59:59Z`) };
  }, [agendaStartUtc, offsetMs]);
  const weekHolidayRange = useMemo(() => ({ startUtc: weekStartUtc + offsetMs, endUtc: weekEndUtc + offsetMs }), [weekStartUtc, weekEndUtc, offsetMs]);

  // Aggregated agenda for today and week
  const todayAgendaRaw = useQuery(
    api.domains.calendar.calendar.listAgendaInRange,
    loggedInUser ? { start: agendaStartUtc, end: agendaEndUtc, country: "US", holidaysStartUtc: todayHolidayRange.startUtc, holidaysEndUtc: todayHolidayRange.endUtc } : "skip",
  );
  const weekAgendaRaw = useQuery(
    api.domains.calendar.calendar.listAgendaInRange,
    loggedInUser ? { start: weekStartUtc, end: weekEndUtc, country: "US", holidaysStartUtc: weekHolidayRange.startUtc, holidaysEndUtc: weekHolidayRange.endUtc } : "skip",
  );

  const tasksToday = todayAgendaRaw?.tasks ?? [];
  const eventsToday = todayAgendaRaw?.events ?? [];
  const holidaysToday = todayAgendaRaw?.holidays ?? [];
  const tasksThisWeek = weekAgendaRaw?.tasks ?? [];
  const eventsThisWeek = weekAgendaRaw?.events ?? [];
  const holidaysThisWeek = weekAgendaRaw?.holidays ?? [];

  // Build a simple "next" list: upcoming week entries excluding today's tasks (avoid duplicates across sections)
  const todayTaskIds = new Set((tasksToday ?? []).map((t: any) => String(t?._id ?? "")));
  const nextTasks = (tasksThisWeek ?? []).filter((t: any) => !todayTaskIds.has(String(t?._id ?? "")));
  const upcomingCounts = {
    todayTasks: (tasksToday ?? []).length,
    todayEvents: (eventsToday ?? []).length,
    weekTasks: (tasksThisWeek ?? []).length,
    weekEvents: (eventsThisWeek ?? []).length,
  } as const;

  // Convex mutations (can be no-ops if not used by the consumer)
  const createTask = useMutation(api.domains.tasks.userEvents.createTask);

  const startOfLocalDay = useCallback((ms: number) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const handleViewDay = useCallback((dateMs: number) => {
    setFocusedDateMs(startOfLocalDay(dateMs));
  }, [startOfLocalDay]);

  const handleViewWeek = useCallback((dateMs: number) => {
    setFocusedDateMs(startOfLocalDay(dateMs));
  }, [startOfLocalDay]);

  const handleAddTaskForDate = useCallback(async (
    dateMs: number,
    title: string,
    opts?: { documentId?: Id<"documents"> }
  ) => {
    const trimmed = (title ?? "").trim();
    if (!trimmed) return;
    const base = new Date(dateMs);
    base.setHours(17, 0, 0, 0); // 5pm local by convention
    await createTask({ title: trimmed, status: "todo", dueDate: base.getTime(), documentId: opts?.documentId });
  }, [createTask]);

  // Mini-month calendar state
  const [miniSelectedDateMs, setMiniSelectedDateMs] = useState<number>(() => todayLocal);
  const monthGrid = useMemo(() => {
    // Build a 6x7 grid starting from first visible week (Mon-Sun) of the month containing miniSelectedDateMs
    const d = new Date(miniSelectedDateMs);
    d.setHours(0, 0, 0, 0);
    const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    const firstDow = (firstOfMonth.getDay() + 6) % 7; // Mon=0
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(firstOfMonth.getDate() - firstDow);

    const weeks: Array<Array<{ dateMs: number; inMonth: boolean; isToday: boolean }>> = [];
    for (let w = 0; w < 6; w++) {
      const row: Array<{ dateMs: number; inMonth: boolean; isToday: boolean }> = [];
      for (let i = 0; i < 7; i++) {
        const cell = new Date(gridStart);
        cell.setDate(gridStart.getDate() + w * 7 + i);
        cell.setHours(0, 0, 0, 0);
        const inMonth = cell.getMonth() === d.getMonth();
        const isToday = (() => {
          const t = new Date(); t.setHours(0,0,0,0);
          return t.getTime() === cell.getTime();
        })();
        row.push({ dateMs: cell.getTime(), inMonth, isToday });
      }
      weeks.push(row);
    }
    return weeks;
  }, [miniSelectedDateMs]);

  const onPrevMonth = useCallback(() => {
    const d = new Date(miniSelectedDateMs);
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    setMiniSelectedDateMs(prev.getTime());
  }, [miniSelectedDateMs]);

  const onNextMonth = useCallback(() => {
    const d = new Date(miniSelectedDateMs);
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    setMiniSelectedDateMs(next.getTime());
  }, [miniSelectedDateMs]);

  const upcoming = useMemo(() => ({
    today: { tasks: tasksToday, events: eventsToday, holidays: holidaysToday },
    next: { tasks: nextTasks, events: eventsThisWeek },
    sevenDays: { tasks: tasksThisWeek, events: eventsThisWeek, holidays: holidaysThisWeek },
    counts: upcomingCounts,
    ranges: { agendaStartUtc, agendaEndUtc, weekStartUtc, weekEndUtc },
  }), [
    tasksToday,
    eventsToday,
    holidaysToday,
    nextTasks,
    tasksThisWeek,
    eventsThisWeek,
    holidaysThisWeek,
    upcomingCounts,
    agendaStartUtc,
    agendaEndUtc,
    weekStartUtc,
    weekEndUtc,
  ]);

  return {
    focusedDateMs,
    setFocusedDateMs,
    handleViewDay,
    handleViewWeek,
    handleAddTaskForDate,
    // Upcoming aggregates
    upcoming,
    // Mini-month calendar data
    miniMonth: {
      selectedDateMs: miniSelectedDateMs,
      setSelectedDateMs: setMiniSelectedDateMs,
      monthGrid,
      onPrevMonth,
      onNextMonth,
    },
  } as const;
}
