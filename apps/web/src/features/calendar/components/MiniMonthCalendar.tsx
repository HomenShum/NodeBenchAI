import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import CalendarDatePopover from "./CalendarDatePopover";
import DualCreateMiniPanel from "@/features/documents/editors/DualCreateMiniPanel";
import DualEditMiniPanel from "@/features/documents/editors/DualEditMiniPanel";
import MiniEditorPopover from "@/shared/components/MiniEditorPopover";
import { toast } from "sonner";
import { useCalendarAgenda } from "../hooks/useCalendarAgenda";
type DayInfo = {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  key: string; // yyyy-mm-dd local
};

function fmtKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalMonth(base: Date, offsetMs: number): number {
  // Compute local month start using local calendar fields, then convert
  // to the internal ms convention (actual UTC ms minus offsetMs).
  const d = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
  return d.getTime() - offsetMs;
}

function nextMonthStartMs(base: Date, offsetMs: number): number {
  const d = new Date(base.getFullYear(), base.getMonth() + 1, 1, 0, 0, 0, 0);
  return d.getTime() - offsetMs;
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime();
}

// (removed addDays; not needed with per-day loop approach)

function toLocalDate(ms: number, offsetMs: number): Date {
  // Interpret ms as UTC, convert to local by adding offset
  return new Date(ms + offsetMs);
}

// Compute a YYYY-MM-DD key for a given timestamp in a specific IANA time zone.
// Falls back to system local if the zone is unavailable.
function getDateKeyForZone(timeZone: string | undefined, dateMs: number): string {
  try {
    if (!timeZone) return fmtKey(new Date(dateMs));
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = dtf.formatToParts(new Date(dateMs));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const y = get("year");
    const m = get("month");
    const d = get("day");
    return `${y}-${m}-${d}`;
  } catch {
    return fmtKey(new Date(dateMs));
  }
}

// Top-level helpers so hooks don't complain about function dependencies
// Compute minutes east of UTC for a given IANA time zone at a specific date.
function tzOffsetMinutesAt(timeZone: string | undefined, date: Date): number {
  if (!timeZone) {
    return -date.getTimezoneOffset();
  }
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const y = get("year");
    const m = (get("month") || 1) - 1;
    const d = get("day") || 1;
    const h = get("hour") || 0;
    const min = get("minute") || 0;
    const s = get("second") || 0;
    const asUTC = Date.UTC(y, m, d, h, min, s);
    // Positive when zone is ahead of UTC (east), negative when behind.
    return (asUTC - date.getTime()) / 60000;
  } catch {
    return -date.getTimezoneOffset();
  }
}

// Convert a UTC ms timestamp to a Date in the given IANA time zone, DST-safe.
function toLocalDateInZone(ms: number, timeZone: string | undefined): Date {
  const offMin = tzOffsetMinutesAt(timeZone, new Date(ms));
  return new Date(ms + offMin * 60 * 1000);
}

const FRIENDLY_TIMEZONE_LABELS: Record<string, string> = {
  UTC: "UTC",
  "America/Los_Angeles": "Pacific Time",
  "America/Denver": "Mountain Time",
  "America/Chicago": "Central Time",
  "America/New_York": "Eastern Time",
  "Europe/London": "United Kingdom",
  "Europe/Paris": "Central Europe",
  "Europe/Berlin": "Central Europe",
  "Asia/Tokyo": "Japan",
  "Asia/Shanghai": "China",
  "Asia/Kolkata": "India",
  "Australia/Sydney": "Australia East",
};

function formatTimezoneLabel(timeZone: string): string {
  if (!timeZone) return "System";
  if (FRIENDLY_TIMEZONE_LABELS[timeZone]) return FRIENDLY_TIMEZONE_LABELS[timeZone];
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone,
      timeZoneName: "longGeneric",
    }).formatToParts(new Date());
    const zoneName = parts.find((p) => p.type === "timeZoneName")?.value?.trim();
    if (zoneName) return zoneName;
  } catch {
    // keep fallback below
  }
  const normalized = timeZone.replace(/_/g, " ");
  const slashIndex = normalized.indexOf("/");
  if (slashIndex > 0) {
    const region = normalized.slice(0, slashIndex);
    const city = normalized.slice(slashIndex + 1).replace(/\//g, " • ");
    return `${city} (${region})`;
  }
  return normalized;
}

export interface MiniMonthCalendarProps {
  tzOffsetMinutes?: number; // default derived from browser
  anchorDateMs?: number; // optional externally-selected day to keep the month header in sync
  onSelectDate?: (dateMs: number) => void; // UTC ms of selected local day start
  onViewDay?: (dateMs: number) => void; // Optional: explicit day view handler
  onViewWeek?: (dateMs: number) => void; // Optional: explicit week view handler
  onWeeklyReview?: (weekAnchorMs: number) => void; // Optional: trigger weekly review
  onAddTask?: (dateMs: number) => void; // Optional: open New Task modal for this date
  onAddEvent?: (dateMs: number) => void; // Optional: open New Event dialog for this date
  onOpenDocument?: (docId: Id<"documents">) => void; // Optional: open document handler
  constrainToSidebar?: boolean; // If true, keep previews within sidebar width
}

export function MiniMonthCalendar({ tzOffsetMinutes, anchorDateMs, onSelectDate: _onSelectDate, onViewDay: _onViewDay, onViewWeek: _onViewWeek, onWeeklyReview: _onWeeklyReview, onAddTask: _onAddTask, onAddEvent: _onAddEvent, onOpenDocument, constrainToSidebar = false }: MiniMonthCalendarProps) {
  // Clock state (ticks every second)
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Load and persist preferred time zone
  const prefs = useQuery(api.domains.auth.userPreferences.getCalendarUiPrefs, {});
  const setTimeZonePref = useMutation(api.domains.auth.userPreferences.setTimeZonePreference);
  const updateEventMutation = useMutation(api.domains.calendar.events.updateEvent);
  const deleteEventMutation = useMutation(api.domains.calendar.events.deleteEvent);
  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone as string | undefined;
    } catch {
      return undefined;
    }
  }, []);
  const [selectedTz, setSelectedTz] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (prefs === undefined) return;
    const prefTz = prefs?.timeZone ?? browserTz;
    if (prefTz && prefTz !== selectedTz) {
      setSelectedTz(prefTz);
    }
  }, [prefs, browserTz, selectedTz]);

  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const effectiveOffsetMinutes = useMemo(() => {
    // Prefer the explicitly selected IANA timezone for ALL calculations.
    if (selectedTz && selectedTz.length > 0) {
      return tzOffsetMinutesAt(selectedTz, anchor);
    }
    // Fallback to numeric offset provided by parent, then browser/system.
    if (typeof tzOffsetMinutes === "number") return tzOffsetMinutes;
    return -new Date(anchor).getTimezoneOffset();
  }, [selectedTz, tzOffsetMinutes, anchor]);
  const offsetMs = effectiveOffsetMinutes * 60 * 1000;

  useEffect(() => {
    if (typeof anchorDateMs !== "number" || !Number.isFinite(anchorDateMs)) return;
    const externalAnchor = toLocalDateInZone(anchorDateMs, selectedTz);
    const nextMonth = externalAnchor.getMonth();
    const nextYear = externalAnchor.getFullYear();
    setAnchor((prev) => {
      if (prev.getFullYear() === nextYear && prev.getMonth() === nextMonth) {
        return prev;
      }
      return new Date(nextYear, nextMonth, 1);
    });
  }, [anchorDateMs, selectedTz]);

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const hoverOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editTarget, setEditTarget] = useState<
    | { kind: "task"; id: string }
    | { kind: "event"; id: string }
    | { kind: "holiday"; name: string }
    | { kind: "note"; id: string }
    | { kind: "create"; dateMs: number; defaultKind?: "task" | "event"; defaultTitle?: string; defaultAllDay?: boolean }
    | { kind: "createBoth"; dateMs: number; defaultTitle?: string; defaultAllDay?: boolean }
    | null
  >(null);

  // Today key in the selected timezone. Changes only when the calendar date changes
  // in that zone (not every second), thanks to memoization.
  const todayKey = useMemo(() => {
    // Prefer explicit IANA zone when available; otherwise use numeric offset path
    if (selectedTz && selectedTz.length > 0) return getDateKeyForZone(selectedTz, now);
    // When only an offset is available, shift the instant by the offset and
    // read UTC fields to get the wall date in that offset-based zone.
    const d = new Date(now + offsetMs);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, [selectedTz, now, offsetMs]);

  const clearHoverTimers = React.useCallback(() => {
    if (hoverOpenTimerRef.current) {
      clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }, []);

  const scheduleHoverOpen = React.useCallback((key: string) => {
    if (pinnedKey) return;
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    if (hoverOpenTimerRef.current) {
      clearTimeout(hoverOpenTimerRef.current);
    }
    hoverOpenTimerRef.current = setTimeout(() => {
      setHoveredKey(key);
      hoverOpenTimerRef.current = null;
    }, 110);
  }, [pinnedKey]);

  const scheduleHoverClose = React.useCallback((key: string) => {
    if (pinnedKey === key) return;
    if (hoverOpenTimerRef.current) {
      clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
    }
    hoverCloseTimerRef.current = setTimeout(() => {
      setHoveredKey((current) => (current === key ? null : current));
      hoverCloseTimerRef.current = null;
    }, 140);
  }, [pinnedKey]);

  const keepHoverPreviewOpen = React.useCallback((key: string) => {
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    if (!pinnedKey) {
      setHoveredKey(key);
    }
  }, [pinnedKey]);

  useEffect(() => () => clearHoverTimers(), [clearHoverTimers]);

  const handleAcceptProposed = React.useCallback(async (eventId: string) => {
    try {
      await updateEventMutation({
        eventId: eventId as Id<"events">,
        proposed: false,
        status: "confirmed",
      });
      toast.success("Event accepted");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to accept event");
    }
  }, [updateEventMutation]);

  const handleDeclineProposed = React.useCallback(async (eventId: string) => {
    try {
      await deleteEventMutation({ eventId: eventId as Id<"events"> });
      toast.success("Event declined");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to decline event");
    }
  }, [deleteEventMutation]);

  // Compute month range [start, end]
  const monthStart = useMemo(() => startOfLocalMonth(anchor, offsetMs), [anchor, offsetMs]);
  const _monthEnd = useMemo(() => nextMonthStartMs(anchor, offsetMs) - 1, [anchor, offsetMs]);
  // For holidays (stored at 00:00:00Z for dateKey), build a UTC range
  // covering the entire visible 6x7 grid (not just the current month).
  // This ensures days shown from the adjacent months are accurate too.
  const gridHolidayRange = useMemo(() => {
    const firstLocal = toLocalDate(monthStart, offsetMs); // local 1st of month
    const dayOfWeek = (firstLocal.getDay() + 6) % 7; // 0=Mon..6=Sun
    // Start of the grid (Monday of the first row)
    const gridStartLocal = new Date(
      firstLocal.getFullYear(),
      firstLocal.getMonth(),
      firstLocal.getDate() - dayOfWeek,
      0,
      0,
      0,
      0,
    );
    // End of the grid (6 weeks * 7 days = 42 days, zero-indexed => +41)
    const gridEndLocal = new Date(
      gridStartLocal.getFullYear(),
      gridStartLocal.getMonth(),
      gridStartLocal.getDate() + 41,
      0,
      0,
      0,
      0,
    );
    const startKey = fmtKey(gridStartLocal);
    const endKey = fmtKey(gridEndLocal);
    const startUtc = Date.parse(`${startKey}T00:00:00Z`);
    const endUtc = Date.parse(`${endKey}T23:59:59Z`);
    return { startUtc, endUtc };
  }, [monthStart, offsetMs]);

  // Compute the UTC range for the entire visible 6x7 grid using the same
  // timezone-aware midday trick used for single-day calculations. This makes
  // event/task queries consistent with the hover preview counts.
  const gridRangeUtc = useMemo(() => {
    const firstLocal = toLocalDate(monthStart, offsetMs);
    const dayOfWeek = (firstLocal.getDay() + 6) % 7; // 0=Mon..6=Sun
    const gridStartLocal = new Date(
      firstLocal.getFullYear(),
      firstLocal.getMonth(),
      firstLocal.getDate() - dayOfWeek,
      0, 0, 0, 0,
    );
    const gridEndLocal = new Date(
      gridStartLocal.getFullYear(),
      gridStartLocal.getMonth(),
      gridStartLocal.getDate() + 41,
      0, 0, 0, 0,
    );

    // Start of first grid day in the selected zone -> UTC
    const startKey = fmtKey(gridStartLocal);
    const startOffMin = tzOffsetMinutesAt(selectedTz, gridStartLocal);
    const startMiddayUtc = Date.parse(`${startKey}T12:00:00Z`);
    const startLocalNoon = startMiddayUtc + startOffMin * 60 * 1000;
    const s = new Date(startLocalNoon);
    s.setUTCHours(0, 0, 0, 0);
    const startUtc = s.getTime() - startOffMin * 60 * 1000;

    // End of last grid day in the selected zone -> UTC
    const endKey = fmtKey(gridEndLocal);
    const endOffMin = tzOffsetMinutesAt(selectedTz, gridEndLocal);
    const endMiddayUtc = Date.parse(`${endKey}T12:00:00Z`);
    const endLocalNoon = endMiddayUtc + endOffMin * 60 * 1000;
    const e = new Date(endLocalNoon);
    e.setUTCHours(0, 0, 0, 0);
    const endStartUtc = e.getTime() - endOffMin * 60 * 1000;
    const endUtc = endStartUtc + 24 * 60 * 60 * 1000 - 1;

    return { startUtc, endUtc };
  }, [monthStart, offsetMs, selectedTz]);

  // Use unified calendar agenda hook for consistent data across all calendar views
  const { events: monthEventsRaw, tasks: monthTasksRaw, holidays: monthHolidaysRaw, notes: monthNotesRaw } = useCalendarAgenda({
    startMs: gridRangeUtc.startUtc,
    endMs: gridRangeUtc.endUtc,
    country: "US",
    holidaysStartUtc: gridHolidayRange.startUtc,
    holidaysEndUtc: gridHolidayRange.endUtc,
  });

  // Build calendar grid starting Monday before the 1st, ending Sunday after last day, 6 rows x 7 cols
  const gridDays: DayInfo[] = useMemo(() => {
    const firstLocal = toLocalDate(monthStart, offsetMs); // local timezone Date at 1st 00:00
    const dayOfWeek = (firstLocal.getDay() + 6) % 7; // 0=Mon..6=Sun
    // Start from the Monday of the first grid row using local calendar arithmetic to avoid DST issues
    const gridStartLocal = new Date(
      firstLocal.getFullYear(),
      firstLocal.getMonth(),
      firstLocal.getDate() - dayOfWeek,
      0,
      0,
      0,
      0,
    );

    const days: DayInfo[] = [];
    for (let i = 0; i < 42; i++) {
      const dLocal = new Date(gridStartLocal);
      dLocal.setDate(gridStartLocal.getDate() + i); // DST-safe day increment
      const inMonth = dLocal.getMonth() === firstLocal.getMonth();
      const key = fmtKey(dLocal);
      days.push({ date: dLocal, inMonth, isToday: key === todayKey, key });
    }
    return days;
  }, [monthStart, offsetMs, todayKey]);

  // Precompute markers per day - use data from unified hook
  const monthEvents = useMemo(() => monthEventsRaw as any[], [monthEventsRaw]);
  const monthTasks = useMemo(() => monthTasksRaw as any[], [monthTasksRaw]);
  const monthHolidays = useMemo(() => monthHolidaysRaw as any[], [monthHolidaysRaw]);
  const monthNotes = useMemo(() => monthNotesRaw as any[], [monthNotesRaw]);

  const markers = useMemo(() => {
    // Count per grid day using the SAME UTC bounds the preview uses.
    // emailProposed: proposed events from Gmail that need user confirmation
    const m: Record<string, { events: number; tasks: number; holidays: number; notes: number; emailProposed: number; maxPriority: number }> = {};
    const events = monthEvents;
    const tasks = monthTasks;
    const holidays = monthHolidays as Array<{ dateKey: string }>;
    const notes = monthNotes as Array<{ agendaDate?: number }>;

    const priVal = (p?: "low" | "medium" | "high" | "urgent"): number =>
      p === "urgent" ? 4 : p === "high" ? 3 : p === "medium" ? 2 : p === "low" ? 1 : 0;

    const overlaps = (sa: number, ea: number | undefined, sb: number, eb: number) => {
      const aEnd = typeof ea === "number" ? ea : sa;
      return sa <= eb && aEnd >= sb;
    };

    for (const day of gridDays) {
      const key = day.key;
      // Compute UTC [start,end] for this day in the selected timezone using noon trick.
      const offsetAtDateMin = tzOffsetMinutesAt(selectedTz, day.date);
      const offsetAtDateMs = offsetAtDateMin * 60 * 1000;
      const middayUtc = Date.parse(`${key}T12:00:00Z`);
      const localNoon = middayUtc + offsetAtDateMs;
      const d0 = new Date(localNoon);
      d0.setUTCHours(0, 0, 0, 0);
      const startUtc = d0.getTime() - offsetAtDateMs;
      const endUtc = startUtc + 24 * 60 * 60 * 1000 - 1;

      // Initialize bucket
      if (!m[key]) m[key] = { events: 0, tasks: 0, holidays: 0, notes: 0, emailProposed: 0, maxPriority: 0 };

      // Holidays: match by canonical key
      m[key].holidays += holidays.filter((h) => h.dateKey === key).length;

      // Tasks: dueDate within [startUtc, endUtc]
      for (const t of tasks) {
        const dueRaw = (t as any).dueDate;
        const due = typeof dueRaw === "number" ? dueRaw : undefined;
        if (typeof due === "number" && due >= startUtc && due <= endUtc) {
          m[key].tasks += 1;
          const pv = priVal((t as any).priority);
          if (pv > m[key].maxPriority) m[key].maxPriority = pv;
        }
      }

      // Events: overlap with [startUtc, endUtc]
      // Track proposed email events separately for visual distinction
      for (const e of events) {
        const sRaw = (e as any).startTime;
        if (typeof sRaw !== "number") continue;
        const enRaw = (e as any).endTime;
        const en = typeof enRaw === "number" ? enRaw : undefined;
        if (overlaps(sRaw, en, startUtc, endUtc)) {
          const isEmailProposed = (e as any).proposed && (e as any).sourceType === "gmail";
          if (isEmailProposed) {
            m[key].emailProposed += 1;
          } else {
            m[key].events += 1;
          }
        }
      }

      // Notes: agendaDate within [startUtc, endUtc]
      for (const n of notes) {
        const a = (n as any).agendaDate;
        if (typeof a === "number" && a >= startUtc && a <= endUtc) {
          m[key].notes += 1;
        }
      }
    }

    return m;
  }, [monthEvents, monthTasks, monthHolidays, monthNotes, gridDays, selectedTz]);

  // Active preview day: either pinned or hovered
  const activeKey = pinnedKey ?? hoveredKey;
  const activeIdx = useMemo(() => activeKey ? gridDays.findIndex((d) => d.key === activeKey) : -1, [gridDays, activeKey]);
  const activeInfo = useMemo(() => {
    return activeIdx >= 0 ? gridDays[activeIdx] ?? null : null;
  }, [gridDays, activeIdx]);
  const activeStartUtc = useMemo(() => {
    if (!activeInfo) return null;
    // Compute start of day for the hovered/pinned date in the SELECTED time zone,
    // not the system zone. We do this by:
    // 1) Building a YYYY-MM-DD key for the visible date (already aligned to the selected zone).
    // 2) Taking noon UTC of that key to avoid DST edge cases.
    // 3) Converting that instant into the selected zone by adding the zone offset for that date.
    // 4) Zeroing out the day at UTC fields, then converting back by subtracting the same offset.
    const key = fmtKey(activeInfo.date);
    const offsetAtDateMin = tzOffsetMinutesAt(selectedTz, activeInfo.date);
    const offsetAtDateMs = offsetAtDateMin * 60 * 1000;
    const middayUtc = Date.parse(`${key}T12:00:00Z`);
    const localNoon = middayUtc + offsetAtDateMs; // noon in the selected zone
    const d = new Date(localNoon);
    d.setUTCHours(0, 0, 0, 0); // start of local day in selected zone
    return d.getTime() - offsetAtDateMs; // convert back to UTC for backend queries
  }, [activeInfo, selectedTz]);
  const [showQuickNote, setShowQuickNote] = useState(false);
  const [quickNoteAnchorEl, setQuickNoteAnchorEl] = useState<HTMLElement | null>(null);
  const activeEndUtc = useMemo(() => (activeStartUtc !== null ? (activeStartUtc + 24 * 60 * 60 * 1000 - 1) : null), [activeStartUtc]);
  // Use dateKey for holiday range to hit 00:00:00Z on that local day
  const previewHolidayRange = useMemo(() => {
    if (!activeInfo) return null;
    const key = fmtKey(activeInfo.date);
    return {
      startUtc: Date.parse(`${key}T00:00:00Z`),
      endUtc: Date.parse(`${key}T23:59:59Z`),
    };
    // Depend on activeInfo.date so key updates correctly
  }, [activeInfo]);
  const previewAgenda = useQuery(
    api.domains.calendar.calendar.listAgendaInRange,
    activeStartUtc !== null && activeEndUtc !== null && previewHolidayRange !== null
      ? {
          start: activeStartUtc,
          end: activeEndUtc,
          country: "US",
          holidaysStartUtc: previewHolidayRange.startUtc,
          holidaysEndUtc: previewHolidayRange.endUtc,
        }
      : "skip",
  );

  const previewEvents = useMemo(() => {
    if (!previewAgenda || typeof previewAgenda !== "object") return [];
    return [...(previewAgenda.events ?? [])]
      .sort((a: any, b: any) => (a?.startTime ?? 0) - (b?.startTime ?? 0))
      .map((ev: any) => ({
      _id: ev._id ?? ev.id,
      documentId: ev.documentId,
      title: ev.title ?? ev.name ?? ev.summary ?? ev.rawSummary ?? "Untitled event",
      startTime: typeof ev.startTime === "number" ? ev.startTime : undefined,
      endTime: typeof ev.endTime === "number" ? ev.endTime : undefined,
      allDay: ev.allDay ?? false,
      proposed: ev.proposed ?? ev.status === "proposed",
      sourceType: ev.sourceType ?? ev.meta?.sourceType,
      location: ev.location ?? ev.meta?.location,
      rawSummary: ev.rawSummary ?? ev.description,
    }));
  }, [previewAgenda]);

  const previewTasks = useMemo(() => {
    if (!previewAgenda || typeof previewAgenda !== "object") return [];
    return [...(previewAgenda.tasks ?? [])]
      .sort((a: any, b: any) => (a?.dueDate ?? 0) - (b?.dueDate ?? 0))
      .map((t: any) => ({
        _id: t._id ?? t.id,
        documentId: t.documentId,
        title: t.title ?? t.name ?? "Task",
        dueDate: typeof t.dueDate === "number" ? t.dueDate : undefined,
        status: t.status ?? t.state,
      }));
  }, [previewAgenda]);

  const previewNotes = useMemo(() => {
    if (!previewAgenda || typeof previewAgenda !== "object") return [];
    return [...(previewAgenda.notes ?? [])].map((n: any) => ({
      _id: n._id ?? n.id,
      documentId: n.documentId ?? n._id ?? n.id,
      title: n.title ?? n.name ?? "Note",
    }));
  }, [previewAgenda]);

  const previewHolidays = useMemo(() => {
    if (!previewAgenda || typeof previewAgenda !== "object") return [];
    return [...(previewAgenda.holidays ?? [])].map((h: any) => ({
      _id: h._id ?? h.id ?? h.dateKey,
      title: h.name ?? h.title ?? "Holiday",
      dateKey: h.dateKey,
    }));
  }, [previewAgenda]);

  const previewFiles = useMemo(() => {
    if (!previewAgenda || typeof previewAgenda !== "object") return [];
    const collected: Array<{ _id?: string; title: string; fileType?: string }> = [];
    const seen = new Set<string>();
    const pushFile = (id: any, title?: string, fileType?: string) => {
      const key = id ? String(id) : `t:${title ?? ""}`;
      if (!title || seen.has(key)) return;
      seen.add(key);
      collected.push({ _id: typeof id === "string" ? id : undefined, title, fileType });
    };
    (previewAgenda.notes ?? []).forEach((n: any) => pushFile(n.documentId ?? n._id ?? n.id, n.title ?? n.name ?? "Note", n.fileType));
    (previewAgenda.tasks ?? []).forEach((t: any) => pushFile(t.documentId ?? t._id ?? t.id, t.title ?? t.name ?? "Task", t.fileType ?? "task"));
    (previewAgenda.events ?? []).forEach((ev: any) => pushFile(ev.documentId ?? ev._id ?? ev.id, ev.title ?? ev.name ?? "Event", "event"));
    return collected;
  }, [previewAgenda]);

  const monthLabel = useMemo(() => {
    // Format from the anchor month directly so the header stays aligned with the
    // visible grid even when timezone math shifts the UTC boundary backward.
    const d = new Date(Date.UTC(anchor.getFullYear(), anchor.getMonth(), 15, 12, 0, 0));
    return new Intl.DateTimeFormat(undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(d);
  }, [anchor]);

  const dayLabels = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

  // Clock formatting in the selected timezone
  const effectiveTz = selectedTz;
  const clockText = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: effectiveTz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(now));
    } catch {
      return new Date(now).toLocaleTimeString();
    }
  }, [now, effectiveTz]);

  const tzOptions: Array<{ value: string; label: string }> = useMemo(() => {
    const common: Array<{ value: string; label: string }> = [
      // NOTE(coworker): Keep labels user-friendly; avoid raw IANA strings in the picker.
      { value: browserTz || "", label: browserTz ? `Local time · ${formatTimezoneLabel(browserTz)}` : "Local time" },
      { value: "UTC", label: "UTC" },
      { value: "America/Los_Angeles", label: formatTimezoneLabel("America/Los_Angeles") },
      { value: "America/Denver", label: formatTimezoneLabel("America/Denver") },
      { value: "America/Chicago", label: formatTimezoneLabel("America/Chicago") },
      { value: "America/New_York", label: formatTimezoneLabel("America/New_York") },
      { value: "Europe/London", label: formatTimezoneLabel("Europe/London") },
      { value: "Europe/Paris", label: formatTimezoneLabel("Europe/Paris") },
      { value: "Europe/Berlin", label: formatTimezoneLabel("Europe/Berlin") },
      { value: "Asia/Tokyo", label: formatTimezoneLabel("Asia/Tokyo") },
      { value: "Asia/Shanghai", label: formatTimezoneLabel("Asia/Shanghai") },
      { value: "Asia/Kolkata", label: formatTimezoneLabel("Asia/Kolkata") },
      { value: "Australia/Sydney", label: formatTimezoneLabel("Australia/Sydney") },
    ];
    // Deduplicate if browserTz equals one of the listed
    const seen = new Set<string>();
    const result: Array<{ value: string; label: string }> = [];
    for (const o of common) {
      if (!o.value) continue;
      if (seen.has(o.value)) continue;
      seen.add(o.value);
      result.push(o);
    }
    return result;
  }, [browserTz]);

  // Small formatter for tile badge counts to keep layout compact
  const fmtSmall = (n: number): string => (n > 9 ? "9+" : String(n));

  const onChangeTimeZone = async (value: string) => {
    const newTz = value || browserTz;
    setSelectedTz(newTz);
    try {
      if (newTz) await setTimeZonePref({ timeZone: newTz });
    } catch (e) {
      // no-op; UI already updated
      console.error("Failed to save timezone preference", e);
    }
  };

  const handleAddEventForDay = React.useCallback((dateMs: number) => {
    if (_onAddEvent) {
      _onAddEvent(dateMs);
      return;
    }
    setEditTarget({ kind: "create", dateMs });
  }, [_onAddEvent]);

  const handlePrepDay = React.useCallback((dateMs: number) => {
    setEditTarget({ kind: "createBoth", dateMs, defaultTitle: "Daily brief" });
    setQuickNoteAnchorEl(previewRef.current);
    setShowQuickNote(true);
  }, []);

  const handleTimeBlock = React.useCallback((dateMs: number) => {
    if (_onAddTask) {
      _onAddTask(dateMs);
      return;
    }
    setEditTarget({ kind: "createBoth", dateMs, defaultTitle: "Time block plan", defaultAllDay: false });
  }, [_onAddTask]);

  const goPrev = () => {
    setAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };
  const goNext = () => {
    setAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  // onClickDay removed; click now toggles a pinned preview. Use action buttons to view day/week.

  return (
    <div className="relative bg-gradient-to-br from-surface to-surface-secondary/50 border border-edge/60 rounded-lg overflow-visible shadow-[0_2px_8px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.02)]">
      {/* Singular watermark for mini calendar */}
      <span className="document-card__bg document-row__bg text-indigo-600 dark:text-indigo-400" aria-hidden>
        <CalendarDays className="h-10 w-10 rotate-12" />
      </span>
      {/* Clock + Timezone selector */}
      <div className="px-4 py-2 border-b border-edge/80 flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
            Current time
          </div>
          <div className="font-mono text-xs font-medium text-content tabular-nums" aria-live="polite" aria-label="Current time">
            {clockText}
          </div>
        </div>
        <select
          id="tz-select"
          aria-label="Timezone"
          className="h-7 text-xs leading-[1rem] bg-surface text-content border border-edge/60 rounded-lg px-2 py-0 shadow-sm focus:ring-2 focus:ring-ring focus:border-indigo-500/30 transition-all w-full truncate"
          value={effectiveTz || browserTz || "UTC"}
          onChange={(e) => { void onChangeTimeZone(e.target.value); }}
        >
          {tzOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div className="px-4 py-2.5 border-b border-edge/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-base font-semibold text-content tracking-tight">{monthLabel}</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface hover:bg-surface-hover border border-edge/60 shadow-sm transition-all duration-200 hover:shadow"
            onClick={goPrev}
            aria-label="Previous month"
            title="Previous month"
          >
            <ChevronLeft className="h-4 w-4 text-content-muted" />
          </button>
          <button
            className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface hover:bg-surface-hover border border-edge/60 shadow-sm transition-all duration-200 hover:shadow"
            onClick={goNext}
            aria-label="Next month"
            title="Next month"
          >
            <ChevronRight className="h-4 w-4 text-content-muted" />
          </button>
        </div>
      </div>
      <div className="p-3">
        <div className="mb-2 grid grid-cols-7 text-center text-xs text-content-secondary">
          {dayLabels.map((lbl, i) => (
            <div key={`lbl_${lbl}_${i}`} className="font-semibold tracking-[0.08em]">{lbl}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {gridDays.map((d, idx) => {
            const m = markers[d.key] ?? { events: 0, tasks: 0, holidays: 0, notes: 0, emailProposed: 0, maxPriority: 0 };
            const _hasMarkers = m.events > 0 || m.tasks > 0 || m.holidays > 0 || m.notes > 0 || m.emailProposed > 0;
            const pr = m.maxPriority ?? 0;
            const priorityRing = pr >= 1 ? "ring-2 ring-ring" : "";
            const isInteractive = d.inMonth;
            return (
              <div
                key={d.key}
                role={isInteractive ? "button" : undefined}
                tabIndex={isInteractive ? 0 : -1}
                aria-pressed={isInteractive ? pinnedKey === d.key : undefined}
                aria-current={d.isToday ? "date" : undefined}
                aria-label={`${isInteractive ? "Select" : "Outside current month"} ${d.date.toLocaleDateString('en-US', { month: "short", day: "numeric", year: "numeric" })}`}
                onClick={isInteractive ? (e) => {
                  e.preventDefault();
                  clearHoverTimers();
                  // Toggle pin on click; keep hover state consistent
                  setPinnedKey((cur) => (cur === d.key ? null : d.key));
                  setHoveredKey(d.key);
                  // Notify parent of selected date (UTC ms of local day start)
                  try {
                    const localMidnightMs = new Date(
                      d.date.getFullYear(), d.date.getMonth(), d.date.getDate(),
                      0, 0, 0, 0,
                    ).getTime();
                    _onSelectDate?.(localMidnightMs);
                  } catch {
                    // Date computation failed
                  }
                } : undefined}
                onDoubleClick={isInteractive ? (e) => {
                  e.preventDefault();
                  try {
                    const localMidnightMs = new Date(
                      d.date.getFullYear(), d.date.getMonth(), d.date.getDate(),
                      0, 0, 0, 0,
                    ).getTime();
                    _onViewDay?.(localMidnightMs);
                  } catch {
                    // Date computation failed
                  }
                } : undefined}
                onKeyDown={isInteractive ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    clearHoverTimers();
                    setPinnedKey((cur) => (cur === d.key ? null : d.key));
                    setHoveredKey(d.key);
                    try {
                      const localMidnightMs = new Date(
                        d.date.getFullYear(), d.date.getMonth(), d.date.getDate(),
                        0, 0, 0, 0,
                      ).getTime();
                      _onSelectDate?.(localMidnightMs);
                    } catch {
                      // Date computation failed
                    }
                  }
                } : undefined}
                onMouseEnter={isInteractive ? () => scheduleHoverOpen(d.key) : undefined}
                onMouseLeave={isInteractive ? () => scheduleHoverClose(d.key) : undefined}
                className={`relative rounded-lg p-1.5 text-left border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] min-w-[44px] ${
                  d.isToday && isInteractive
                    ? "border-indigo-500/40 bg-gradient-to-br from-[var(--accent-primary-bg)] to-surface-secondary shadow-sm"
                    : "border-transparent hover:bg-surface-hover hover:border-edge"
                  } ${isInteractive ? "text-content" : "text-content-muted opacity-50 pointer-events-none"}`}
                title={d.date.toDateString()}
              >
                <div className="text-[13px] font-semibold">
                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${d.isToday ? "bg-indigo-600 text-white shadow-sm" : ""} ${priorityRing}`}>
                    {isInteractive ? d.date.getDate() : ""}
                  </span>
                </div>
                {/* Markers (fixed positions; always rendered, zero counts muted) */}
                {isInteractive && (
                <div className="absolute bottom-1 left-1 right-1 space-y-0.5">
                    {/* Top row: events (left), email proposed (center), holidays (right) */}
                    <div className="flex items-center justify-between">
                      <span className="relative inline-flex items-center">
                        <span className={`inline-block w-1 h-1 rounded-full ${m.events > 0 ? "bg-indigo-600" : "opacity-0"}`} />
                        <span className={`ml-0.5 text-[8px] leading-none font-medium w-3 text-center ${m.events > 0 ? "text-indigo-600 dark:text-indigo-400" : "text-content-muted"}`}>{m.events > 0 ? fmtSmall(m.events) : ""}</span>
                      </span>
                      {/* Email proposed events (pulsing orange dot) */}
                      <span className="relative inline-flex items-center" title="Proposed email events needing confirmation">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${m.emailProposed > 0 ? "bg-indigo-600 motion-safe:animate-pulse" : "opacity-0"}`} />
                        <span className={`ml-0.5 text-[8px] leading-none font-semibold w-3 text-center ${m.emailProposed > 0 ? "text-indigo-600 dark:text-indigo-400" : "text-content-muted"}`}>{m.emailProposed > 0 ? fmtSmall(m.emailProposed) : ""}</span>
                      </span>
                      <span className="relative inline-flex items-center">
                        <span className={`inline-block w-1 h-1 rounded-full ${m.holidays > 0 ? "bg-indigo-600" : "opacity-0"}`} />
                        <span className={`ml-0.5 text-[8px] leading-none font-medium w-3 text-center ${m.holidays > 0 ? "text-indigo-600 dark:text-indigo-400" : "text-content-muted"}`}>{m.holidays > 0 ? fmtSmall(m.holidays) : ""}</span>
                      </span>
                    </div>
                    {/* Bottom row: tasks (left), notes (right) */}
                    <div className="flex items-center justify-between">
                      <span className="relative inline-flex items-center">
                        <span className={`inline-block w-1 h-1 rounded-full ${m.tasks > 0 ? "bg-indigo-600" : "opacity-0"}`} />
                        <span className={`ml-0.5 text-[8px] leading-none font-medium w-3 text-center ${m.tasks > 0 ? "text-indigo-600 dark:text-indigo-400" : "text-content-muted"}`}>{m.tasks > 0 ? fmtSmall(m.tasks) : ""}</span>
                      </span>
                      <span className="relative inline-flex items-center">
                        <span className={`inline-block w-1 h-1 rounded-full ${m.notes > 0 ? "bg-indigo-600" : "opacity-0"}`} />
                        <span className={`ml-0.5 text-[8px] leading-none font-medium w-3 text-center ${m.notes > 0 ? "text-indigo-600 dark:text-indigo-400" : "text-content-muted"}`}>{m.notes > 0 ? fmtSmall(m.notes) : ""}</span>
                      </span>
                    </div>
                  </div>
                )}

                {/* Preview hoisted out of per-cell map — see below grid */}
              </div>
            );
          })}
          {/* Hoisted preview — rendered once as a grid overlay item instead of per-cell */}
          {activeIdx >= 0 && activeInfo && (
            <div
              style={{ gridRow: Math.floor(activeIdx / 7) + 1, gridColumn: (activeIdx % 7) + 1 }}
              className="relative pointer-events-none"
            >
              <div
                className={`pointer-events-auto absolute z-30 top-1 ${constrainToSidebar ? "right-2" : ((activeIdx % 7) >= 4 ? "right-full mr-2" : "left-full ml-2")}`}
                role="dialog"
                aria-label={`Preview for ${activeInfo.date.toDateString()}`}
                ref={pinnedKey === activeKey ? previewRef : undefined}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseEnter={() => keepHoverPreviewOpen(activeKey!)}
                onMouseLeave={() => scheduleHoverClose(activeKey!)}
              >
                <CalendarDatePopover
                  date={activeInfo.date}
                  events={previewEvents}
                  tasks={previewTasks}
                  notes={previewNotes}
                  holidays={previewHolidays}
                  files={previewFiles}
                  isLoading={previewAgenda === undefined}
                  onClose={() => {
                    setPinnedKey(null);
                    setHoveredKey(null);
                    setEditTarget(null);
                    setShowQuickNote(false);
                    setQuickNoteAnchorEl(null);
                  }}
                  onAddEvent={() => {
                    const dayStart = startOfLocalDay(activeInfo.date);
                    handleAddEventForDay(dayStart);
                  }}
                  onPrepDay={() => {
                    const dayStart = startOfLocalDay(activeInfo.date);
                    handlePrepDay(dayStart);
                  }}
                  onTimeBlock={() => {
                    const dayStart = startOfLocalDay(activeInfo.date);
                    handleTimeBlock(dayStart);
                  }}
                  onAcceptProposed={(eventId) => {
                    if (!eventId) return;
                    void handleAcceptProposed(eventId);
                  }}
                  onDeclineProposed={(eventId) => {
                    if (!eventId) return;
                    void handleDeclineProposed(eventId);
                  }}
                  onSelectEvent={(_eventId, documentId) => {
                    if (documentId) {
                      onOpenDocument?.(documentId as Id<"documents">);
                    }
                  }}
                  onSelectTask={(_taskId, documentId) => {
                    if (documentId) {
                      onOpenDocument?.(documentId as Id<"documents">);
                    }
                  }}
                  onSelectNote={(_noteId, documentId) => {
                    if (documentId) {
                      onOpenDocument?.(documentId as Id<"documents">);
                    }
                  }}
                />
                {editTarget && (
                  <div className="mt-2 w-80 max-w-[20rem] rounded-lg border border-edge bg-surface shadow-lg p-2">
                    {editTarget.kind === "create" && (
                      <DualCreateMiniPanel
                        dateMs={editTarget.dateMs}
                        defaultTitle={editTarget.defaultTitle}
                        defaultAllDay={editTarget.defaultAllDay}
                        onClose={() => setEditTarget(null)}
                      />
                    )}
                    {editTarget.kind === "createBoth" && (
                      <DualEditMiniPanel
                        dateMs={editTarget.dateMs}
                        defaultTitle={editTarget.defaultTitle}
                        defaultAllDay={editTarget.defaultAllDay}
                        onClose={() => setEditTarget(null)}
                      />
                    )}
                  </div>
                )}
                {showQuickNote && activeInfo && activeStartUtc !== null && (
                  <div
                    className="mt-2"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <QuickNoteInitializer
                      isOpen={showQuickNote}
                      activeInfo={activeInfo}
                      activeStartUtc={activeStartUtc}
                      anchorEl={quickNoteAnchorEl ?? previewRef.current}
                      onClose={() => {
                        setShowQuickNote(false);
                        setQuickNoteAnchorEl(null);
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Helper component to create daily notes document and render editor
 */
function QuickNoteInitializer({
  isOpen,
  activeInfo,
  activeStartUtc,
  anchorEl,
  onClose,
}: {
  isOpen: boolean;
  activeInfo: any;
  activeStartUtc: number;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}) {
  const [docId, setDocId] = React.useState<Id<"documents"> | null>(null);
  const [loading, setLoading] = React.useState(false);
  const getOrCreateDailyNotes = useMutation(api.domains.tasks.dailyNotes.getOrCreateDailyNotes);

  React.useEffect(() => {
    if (!isOpen) {
      setDocId(null);
      return;
    }

    const init = async () => {
      setLoading(true);
      try {
        const newDocId = await getOrCreateDailyNotes({
          agendaDate: activeStartUtc,
          dateLabel: activeInfo.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        });
        setDocId(newDocId);
      } catch (e) {
        console.error("Failed to create daily notes:", e);
        toast.error("Failed to create daily notes");
      } finally {
        setLoading(false);
      }
    };

    void init();
  }, [isOpen, activeStartUtc, activeInfo, getOrCreateDailyNotes]);

  if (loading) {
    return null; // Show nothing while loading
  }

  if (!docId) {
    return null;
  }

  return (
    <MiniEditorPopover
      isOpen={isOpen}
      documentId={docId}
      anchorEl={anchorEl}
      onClose={onClose}
    />
  );
}
