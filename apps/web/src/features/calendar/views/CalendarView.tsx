// import { useBlockNoteSyncSafe } from "../lib/useBlockNoteSyncSafe";

import { useQuery, useMutation, useConvexAuth } from "convex/react";
import { useEffect, useState, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

import {
  CalendarIcon,
  Sparkles,
  X,
  Clock,
  ListTodo,
  RefreshCw,
  CheckSquare,
  Brain,
  Plus,
  Lightbulb,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeroHeader } from "@shared/ui/PageHeroHeader";

import { PresetChip } from "@shared/ui/PresetChip";

import { createCalendarDocument } from "@/lib/calendarHelpers";
import { useCalendarAgenda, getWeekRangeUtc, type CalendarEvent } from "../hooks/useCalendarAgenda";
const LazyMiniAgendaEditorPanel = lazy(() => import("@features/calendar/components/agenda/MiniAgendaEditorPanel"));
const LazyEventEditorPanel = lazy(() => import("@/features/calendar/components/EventEditorPanel"));

// Custom hook for calendar document
const useCalendarDocument = () => {
  const { isAuthenticated } = useConvexAuth();
  const documents = useQuery(api.domains.documents.documents.getSidebar);
  const loggedInUser = useQuery(api.domains.auth.auth.loggedInUser);
  const createWithSnapshot = useMutation(api.domains.documents.prosemirror.createDocumentWithInitialSnapshot);

  const [calendarDocId, setCalendarDocId] = useState<Id<"documents"> | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const didAttemptCreateRef = useRef(false);

  useEffect(() => {
    const findOrCreateCalendar = async () => {
      if (!isAuthenticated) return;
      if (!loggedInUser) return;
      if (!documents || isCreating) return;

      const now = new Date();
      const currentMonth = now.toLocaleDateString('en-US', { month: 'long' });
      const currentYear = now.getFullYear();
      const monthSpecificTitle = `${currentMonth} ${currentYear} Calendar`;

      // Look for existing calendar document
      let calendarDoc = documents.find((doc: any) =>
        doc.title === monthSpecificTitle ||
        doc.title.startsWith(`${currentMonth} ${currentYear}`)
      );

      // Fallback to any calendar from current month
      if (!calendarDoc) {
        calendarDoc = documents.find((doc: any) =>
          doc.title.toLowerCase().includes('calendar') &&
          doc.title.includes(currentMonth) &&
          doc.title.includes(currentYear.toString())
        );
      }

      if (!calendarDoc && !isCreating) {
        if (didAttemptCreateRef.current) return;
        didAttemptCreateRef.current = true;
        setIsCreating(true);
        try {
          const docId = await createCalendarDocument(createWithSnapshot);
          setCalendarDocId(docId);
          if (toast) {
            toast.success('Calendar created successfully!');
          }
        } catch (error) {
          console.error('Failed to create calendar document:', error);
          if (toast) {
            toast.error('Failed to create calendar');
          }
        } finally {
          setIsCreating(false);
        }
      } else if (calendarDoc) {
        setCalendarDocId(calendarDoc._id);
      }
    };



    void findOrCreateCalendar();
  }, [documents, createWithSnapshot, isCreating, loggedInUser, isAuthenticated]);

  return { calendarDocId, isCreating };
};

// Editor subcomponent that only mounts the sync hook when a valid documentId exists
function CalendarEditor(_props: {
  documentId: Id<"documents">;
  isDarkMode: boolean;
  quickAddText: string;
  setQuickAddText: (v: string) => void;
  handleQuickAddCreate: () => void | Promise<void>;
  anchorDate: Date;
  loggedInUser: any;
}) {
  // Calendar editor stripped: no ProseMirror/BlockNote usage needed here.
  return null;

}

// Main CalendarView Component
interface CalendarViewProps {
  // UTC ms representing the local day start to focus the calendar week on.
  // If omitted, the current week is shown.
  focusedDateMs?: number;
  onSelectDate?: (dateMs: number) => void;
  onViewWeek?: (dateMs: number) => void;
  onViewDay?: (dateMs: number) => void;
  onQuickAddTask?: (dateMs: number, title: string, opts?: { documentId?: Id<"documents"> }) => Promise<void> | void;
}

export function CalendarView({ focusedDateMs, onSelectDate: _onSelectDate, onViewWeek: _onViewWeek, onViewDay: _onViewDay, onQuickAddTask }: CalendarViewProps) {
  const { calendarDocId, isCreating } = useCalendarDocument();
  const editorContainerRef = useRef<HTMLDivElement>(null);
  // Event overlay removed; use inline popovers instead

  // Auth + event data for Google Calendar-like view
  const loggedInUser = useQuery(api.domains.auth.auth.loggedInUser);
  const needsCalendarDoc = !!loggedInUser;
  const tzOffsetMinutes = useMemo(() => -new Date().getTimezoneOffset(), []);
  // Ensure we use the same timestamp for both frontend week calculation and backend query
  const effectiveFocusedDateMs = useMemo(() => focusedDateMs ?? Date.now(), [focusedDateMs]);

  // Use unified calendar agenda hook for consistent data across all calendar views
  const weekRange = useMemo(() => getWeekRangeUtc(effectiveFocusedDateMs, tzOffsetMinutes), [effectiveFocusedDateMs, tzOffsetMinutes]);
  const { events: agendaEvents, isLoading: isLoadingAgenda } = useCalendarAgenda({
    startMs: weekRange.startMs,
    endMs: weekRange.endMs,
    skip: !loggedInUser,
  });

  const eventsThisWeek: WeekEvent[] = useMemo(() => {
    // Map CalendarEvent to WeekEvent format and deduplicate
    const map = new Map<string, WeekEvent>();
    for (const ev of agendaEvents) {
      const key = String(ev._id);
      if (!map.has(key)) {
        map.set(key, {
          _id: ev._id as Id<"events">,
          title: ev.title,
          startTime: ev.startTime,
          endTime: ev.endTime,
          allDay: ev.allDay,
          description: ev.description,
          location: ev.location,
          status: ev.status,
          color: ev.color,
          documentId: ev.documentId,
        });
      }
    }
    return Array.from(map.values());
  }, [agendaEvents]);
  const createEvent = useMutation(api.domains.calendar.events.createEvent);
  const updateEvent = useMutation(api.domains.calendar.events.updateEvent);
  const deleteEvent = useMutation(api.domains.calendar.events.deleteEvent);
  const createTask = useMutation(api.domains.tasks.userEvents.createTask);

  const [isAiMenuOpen, setIsAiMenuOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<Id<"events"> | null>(null);
  const [quickAddText, setQuickAddText] = useState("");
  const showWorkHoursOnly = false;
  const workdayStartHour = 9;
  const workdayEndHour = 17;
  const density: 'comfortable' | 'cozy' | 'compact' = 'cozy';
  const collapseEmpty = false;

  // ======= Google Calendar-like Week View helpers =======
  const startOfWeek = (d: Date) => {
    const date = new Date(d);
    // Align to Monday start: treat Monday as 0, Sunday as 6
    const day = (date.getDay() + 6) % 7; // 0 Mon .. 6 Sun
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - day);
    return date;
  };

  const anchorDate = useMemo(() => new Date(effectiveFocusedDateMs), [effectiveFocusedDateMs]);
  const weekDays: Date[] = useMemo(() => {
    const start = startOfWeek(anchorDate);
    return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [anchorDate]);

  const hours: number[] = Array.from({ length: 24 }, (_, i) => i);
  const hourLabel = (h: number) => {
    if (h === 0) return "12 AM";
    if (h < 12) return `${h} AM`;
    if (h === 12) return "12 PM";
    return `${h - 12} PM`;
  };

  type WeekEvent = { _id: Id<"events">; title: string; startTime: number; endTime?: number; allDay?: boolean; description?: string; location?: string; status?: string; color?: string; documentId?: Id<"documents"> };

  // Inline CRUD helpers
  const onCreateInline = async (title: string, startMs: number, endMs: number) => {
    if (!loggedInUser) { toast.error("Please sign in first"); return; }
    try {
      await createEvent({ title: title.trim() || "Untitled event", startTime: startMs, endTime: endMs });
      toast.success("Event created");



    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create");
    }
  };

  const onUpdateInline = async (eventId: Id<"events">, updates: any) => {
    if (!loggedInUser) { toast.error("Please sign in first"); return; }
    try {
      await updateEvent({ eventId, ...updates });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update");
    }
  };

  const onDeleteInline = async (eventId: Id<"events">) => {
    if (!loggedInUser) { toast.error("Please sign in first"); return; }
    try {
      await deleteEvent({ eventId });
      toast.success("Event deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete");
    }
  };



  // Quick Add handler (creates a task due on the anchor date at 5pm local)
  const handleQuickAddCreate = useCallback(async () => {
    const title = quickAddText.trim();
    if (!title) return;
    if (!loggedInUser) { toast.error("Please sign in to create items"); return; }
    try {
      if (onQuickAddTask) {
        await onQuickAddTask(anchorDate.getTime(), title, { documentId: calendarDocId ?? undefined });
      } else {
        const base = new Date(anchorDate);
        base.setHours(17, 0, 0, 0);
        await createTask({
          title,
          status: "todo",
          dueDate: base.getTime(),
          documentId: calendarDocId ?? undefined,
        });
      }
      setQuickAddText("");
      toast.success("Task created");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create task");
    }
  }, [quickAddText, loggedInUser, anchorDate, createTask, calendarDocId, onQuickAddTask]);

  // (Removed popup composer; inline draft used instead)

  // TODO: Extract GoogleWeekView to module scope to avoid inline component identity churn.
  // Currently kept inline because it captures parent closures (loggedInUser, anchorDate,
  // createEvent, _onViewDay, setSelectedEventId). The other perf fixes in this file
  // (memoized filters, ref-based hover, stable styles) reduce the cost of each re-render.
  const GoogleWeekView = ({
    events,
    onCreate,
    onUpdate,
    onDelete,
    showWorkHoursOnly = true,
    workdayStartHour = 9,
    workdayEndHour = 17,
    density = 'cozy',
    collapseEmpty = true,
    weekDaysFromParent,
  }: {
    events: WeekEvent[];
    onCreate: (title: string, startMs: number, endMs: number) => Promise<void>;
    onUpdate: (eventId: Id<"events">, updates: any) => Promise<void>;
    onDelete: (eventId: Id<"events">) => Promise<void>;
    showWorkHoursOnly?: boolean;
    workdayStartHour?: number;
    workdayEndHour?: number;
    density?: 'comfortable' | 'cozy' | 'compact';
    collapseEmpty?: boolean;
    weekDaysFromParent?: Date[];
  }) => {
    // Scrollable container
    const containerRef = useRef<HTMLDivElement | null>(null);
    const now = new Date();
    // Use the weekDays passed from parent to ensure columns match the focused date
    const weekDaysToUse = weekDaysFromParent ?? (() => {
      const weekStart = startOfWeek(now);
      return Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
    })();
    const weekStart = weekDaysToUse[0];
    const isCurrentWeek = (d: Date) => startOfWeek(d).getTime() === weekStart.getTime();

    // Density + visible hours
    const hourHeightLocal = density === 'compact' ? 32 : density === 'cozy' ? 44 : 56; // px per hour
    const visibleStartHour = showWorkHoursOnly ? workdayStartHour : 0;
    const visibleEndHour = showWorkHoursOnly ? Math.max(workdayEndHour, workdayStartHour + 1) : 24;
    const renderedHours = useMemo(() => showWorkHoursOnly ? hours.slice(visibleStartHour, visibleEndHour) : hours, [showWorkHoursOnly, visibleStartHour, visibleEndHour]);
    const currentTimeTop = ((now.getHours() + now.getMinutes() / 60) - visibleStartHour) * hourHeightLocal;
    const slotHeight = hourHeightLocal / 4; // 15-minute slots
    const hoverIndicatorRefs = useRef<Array<HTMLDivElement | null>>([]);
    const [draft, setDraft] = useState<{ dayIdx: number; start: number; end: number; title: string } | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState<string>("");
    const defaultDurationMs = 60 * 60 * 1000;
    const dayRefs = useRef<Array<HTMLDivElement | null>>([]);
    const eventRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const [expandedGaps, setExpandedGaps] = useState<Record<number, Set<number>>>({});
    const showHoverIndicator = useCallback((dayIdx: number, slotIdx: number) => {
      const indicator = hoverIndicatorRefs.current[dayIdx];
      if (!indicator) return;
      indicator.style.top = `${slotIdx * slotHeight}px`;
      indicator.style.display = "block";
    }, [slotHeight]);
    const hideHoverIndicator = useCallback((dayIdx: number) => {
      const indicator = hoverIndicatorRefs.current[dayIdx];
      if (indicator) {
        indicator.style.display = "none";
      }
    }, []);

    // ===== All-day events layout (strip above the grid) =====
    const isAllDayEvent = (e: WeekEvent): boolean => {
      if ((e as any).allDay === true) return true;
      const endMs = e.endTime ?? (e.startTime + defaultDurationMs);
      const s = new Date(e.startTime);
      const en = new Date(endMs);
      // Treat multi-day spans as all-day style
      const spansDays = s.getFullYear() !== en.getFullYear() || s.getMonth() !== en.getMonth() || s.getDate() !== en.getDate();
      const coversDay = s.getHours() === 0 && s.getMinutes() === 0 && en.getHours() >= 23 && en.getMinutes() >= 59;
      return spansDays || coversDay;
    };

    const weekStartDate = weekStart;
    const dayDiff = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));

    type AllDaySpan = { e: WeekEvent; startIdx: number; endIdx: number };
    const allDaySpansUnclipped: AllDaySpan[] = events
      .filter((e) => isAllDayEvent(e))
      .map((e) => {
        const endMs = e.endTime ?? (e.startTime + defaultDurationMs);
        const s = new Date(e.startTime);
        const en = new Date(endMs);
        // Normalize to local day indexes relative to Monday weekStart
        const sDayStart = new Date(s); sDayStart.setHours(0, 0, 0, 0);
        const eDayEnd = new Date(en); eDayEnd.setHours(23, 59, 59, 999);
        return {
          e,
          startIdx: dayDiff(sDayStart, weekStartDate),
          endIdx: dayDiff(eDayEnd, weekStartDate),
        };
      });

    const allDaySpans: AllDaySpan[] = allDaySpansUnclipped
      .map((s) => ({
        e: s.e,
        startIdx: Math.max(0, Math.min(6, s.startIdx)),
        endIdx: Math.max(0, Math.min(6, s.endIdx)),
      }))
      .filter((s) => s.endIdx >= 0 && s.startIdx <= 6 && s.endIdx >= s.startIdx);

    // Stack into rows without overlap
    const allDayRows: Array<AllDaySpan[]> = [];
    for (const span of allDaySpans.sort((a, b) => (a.startIdx - b.startIdx) || (b.endIdx - a.endIdx))) {
      let placed = false;
      for (const row of allDayRows) {
        const overlaps = row.some((r) => !(span.endIdx < r.startIdx || span.startIdx > r.endIdx));
        if (!overlaps) {
          row.push(span);
          placed = true;
          break;
        }
      }
      if (!placed) allDayRows.push([span]);
    }

    // Drag-to-select state
    const [dragState, setDragState] = useState<
      | null
      | {
          dayIdx: number;
          startMinute: number; // minutes from visible start
          currentMinute: number; // minutes from visible start (updates on move)
          isActive: boolean;
        }
    >(null);
    const justDraggedRef = useRef(false);

    const nowAnchorRef = useRef<HTMLDivElement | null>(null);

    const scrollToHour = (hour: number, minute = 0, behavior: ScrollBehavior = 'auto') => {
      if (!containerRef.current) return;
      const top = ((hour + minute / 60) - visibleStartHour) * hourHeightLocal - containerRef.current.clientHeight * 0.3;
      containerRef.current.scrollTo({ top: Math.max(0, top), behavior });
    };

    // Auto scroll on mount and when range/density changes
    useEffect(() => {
      const inRange = now.getHours() >= visibleStartHour && now.getHours() < visibleEndHour;
      if (collapseEmpty && nowAnchorRef.current) {
        // Use anchor to center view in collapsed mode
        nowAnchorRef.current.scrollIntoView({ behavior: 'auto', block: 'center' });
      } else {
        const hour = inRange ? now.getHours() : workdayStartHour;
        const minute = inRange ? now.getMinutes() : 0;
        scrollToHour(hour, minute, 'auto');
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showWorkHoursOnly, workdayStartHour, workdayEndHour, density, collapseEmpty]);

    const handleGoToNow = () => {
      const prefersReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (collapseEmpty && nowAnchorRef.current) {
        nowAnchorRef.current.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'center' });
      } else {
        scrollToHour(now.getHours(), now.getMinutes(), prefersReduced ? 'auto' : 'smooth');
      }
      // Propagate selection so both hubs sync to "today"
      const today = new Date(); today.setHours(0,0,0,0);
      _onViewDay?.(today.getTime());
    };

    const handleAddAllDayEvent = async () => {
      if (!loggedInUser) { toast.error("Please sign in first"); return; }
      try {
        const suggested = "All-day event";
        const input = window.prompt("All-day event title", suggested);
        const title = (input ?? "").trim();
        if (!title) return;

        // Use anchorDate for focused week/day
        const base = anchorDate;
        const d = new Date(base);
        d.setHours(0, 0, 0, 0);
        const startMs = d.getTime();
        const endOfDay = new Date(d);
        endOfDay.setHours(23, 59, 59, 999);
        const endMs = endOfDay.getTime();
        await createEvent({ title, startTime: startMs, endTime: endMs, allDay: true });
        toast.success("All-day event created");
      } catch (e: any) {
        toast.error(e?.message ?? "Failed to create all-day event");
      }
    };

    // Memoize stable style objects to avoid creating new objects every render
    const gridTemplateStyle = useMemo(() => ({
      gridTemplateColumns: collapseEmpty ? `repeat(7, minmax(0, 1fr))` : `auto repeat(7, minmax(0, 1fr))`
    }), [collapseEmpty]);
    const hourCellStyle = useMemo(() => ({ height: hourHeightLocal }), [hourHeightLocal]);
    const slotHighlightStyle = useMemo(() => ({ display: 'none' as const, height: slotHeight }), [slotHeight]);

    // Pre-compute day events for each column to avoid re-filtering on every render
    const dayEventsMap = useMemo(() => {
      return weekDaysToUse.map((d) => {
        const dayStart = new Date(d);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(d);
        dayEnd.setHours(23, 59, 59, 999);
        return events
          .filter((e) => {
            const eStart = new Date(e.startTime);
            const eEnd = new Date(e.endTime ?? e.startTime + defaultDurationMs);
            return eStart <= dayEnd && eEnd >= dayStart;
          })
          .filter((e) => !isAllDayEvent(e))
          .sort((a, b) => a.startTime - b.startTime);
      });
    }, [events, weekDaysToUse, defaultDurationMs]);

    return (
      <div className="bg-surface border border-edge rounded-lg overflow-hidden shadow-sm relative h-[calc(100vh-280px)] min-h-[600px] flex flex-col">
        {/* Day header */}
        <div
          className="grid px-2 py-1 bg-surface-secondary/95 backdrop-blur supports-[backdrop-filter]:bg-surface-secondary/80 border-b border-edge text-xs text-content-secondary"
          style={gridTemplateStyle}
        >
          {!collapseEmpty && (
            <div className="p-2 flex items-center justify-center">
              <Clock className="w-3.5 h-3.5 text-content-muted" />
            </div>
          )}
          {weekDaysToUse.map((d, idx) => (
            <div
              key={idx}
              className="p-2 text-center"
              title={`Column for ${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}. Drag below to schedule, click events to edit.`}
              aria-label={`Day column: ${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
            >
              <div className="font-medium text-content">
                {d.toLocaleDateString("en-US", { weekday: "short" })}
              </div>
              <div className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs mt-1 ${d.toDateString() === now.toDateString() ? "bg-indigo-600 text-white" : "text-content"}`}>
                {d.getDate()}
              </div>
            </div>
          ))}
        </div>

        {/* All-day strip */}
        {allDayRows.length > 0 && (
          <div className={`relative ${collapseEmpty ? 'grid grid-cols-7' : 'grid grid-cols-8'} border-b border-edge bg-surface`}
            style={{ gridTemplateRows: `repeat(${allDayRows.length}, 1.75rem)` }}
          >
            {!collapseEmpty && (
              <div
                className="text-xs pr-2 flex items-center justify-end border-r border-edge"
                style={{ gridRow: `1 / span ${allDayRows.length}` }}
                title="All-day or multi-day events appear in this strip"
                aria-label="All-day events strip"
              >
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                  <Lightbulb className="w-3 h-3" /> Allâ€‘day & multiâ€‘day
                </span>
              </div>
            )}
            {weekDaysToUse.map((d, idx) => (
              <div
                key={`alldaycell-${idx}`}
                className="relative border-l border-edge"
                style={{ gridRow: `1 / span ${allDayRows.length}` }}
                role="gridcell"
                tabIndex={0}
                aria-label={`All-day area for ${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}. Press Enter to add an all-day event.`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (!loggedInUser) { toast.error('Please sign in first'); return; }
                    const day = new Date(d);
                    day.setHours(0, 0, 0, 0);
                    const end = new Date(day); end.setHours(23, 59, 59, 999);
                    const title = window.prompt('All-day event title', 'All-day event')?.trim();
                    if (title) { void onCreate(title, day.getTime(), end.getTime()); }
                  }
                }}
                onClick={() => {
                  if (!loggedInUser) { toast.error('Please sign in first'); return; }
                  const day = new Date(d);
                  day.setHours(0, 0, 0, 0);
                  const end = new Date(day); end.setHours(23, 59, 59, 999);
                  const title = window.prompt('All-day event title', 'All-day event')?.trim();
                  if (title) { void onCreate(title, day.getTime(), end.getTime()); }
                }}
                title={`Click to add all-day on ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`}
              />
            ))}

            {/* Bars */}
            {allDayRows.map((row, rIdx) => (
              row.map(({ e, startIdx, endIdx }) => {
                const colStart = collapseEmpty ? (startIdx + 1) : (startIdx + 2);
                const colEnd = collapseEmpty ? (endIdx + 2) : (endIdx + 3);
                const isEditing = editingId === e._id;
                return (
                  <div
                    key={`allday-${String(e._id)}`}
                    className="relative m-0.5 rounded-md text-xs px-2 py-1 shadow-sm bg-indigo-500/10 border border-indigo-500/20 text-content hover:ring-2 hover:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-grab active:cursor-grabbing"
                    style={{ gridColumn: `${colStart} / ${colEnd}`, gridRow: rIdx + 1 }}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(ev) => {
                      // Set calendar event data for Fast Agent drop
                      const eventData = {
                        id: String(e._id),
                        title: e.title,
                        startTime: e.startTime,
                        endTime: e.endTime,
                        allDay: true,
                      };
                      ev.dataTransfer.setData('application/x-nodebench-calendar-event', JSON.stringify(eventData));
                      ev.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={(ev) => { ev.stopPropagation(); setEditingId(e._id); setEditingTitle(e.title); }}
                    onDoubleClick={(ev) => { ev.stopPropagation(); setSelectedEventId(e._id); }}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') { setEditingId(e._id); setEditingTitle(e.title); }
                      if (ev.key.toLowerCase() === 'e') { ev.preventDefault(); setSelectedEventId(e._id); }
                      if (ev.key === 'Delete') { ev.preventDefault(); void onDelete(e._id); }
                    }}
                    title={`${e.title} - Drag to AI assistant to create a report`}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editingTitle}
                        aria-label={`Edit title for event ${e.title}`}
                        onChange={(ev) => setEditingTitle(ev.target.value)}
                        onClick={(ev) => ev.stopPropagation()}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') {
                            void onUpdate(e._id, { title: editingTitle.trim() || e.title });
                            setEditingId(null);
                          }
                          if (ev.key === 'Escape') {
                            setEditingId(null);
                            setEditingTitle(e.title);
                          }
                        }}
                        onBlur={() => {
                          if (editingTitle !== e.title) {
                            void onUpdate(e._id, { title: editingTitle.trim() || e.title });
                          }
                          setEditingId(null);
                        }}
                        className="w-full text-xs bg-surface/70 rounded px-1 py-0.5 outline-none focus:ring-2 focus:ring-ring"
                      />
                    ) : (
                      <>
                        <span className="font-medium truncate pr-5 inline-block align-middle max-w-full">{e.title}</span>
                        <button
                          className="absolute top-0.5 right-0.5 w-5 h-5 rounded hover:bg-surface-hover text-content-secondary flex items-center justify-center"
                          onClick={(ev) => { ev.stopPropagation(); void onDelete(e._id); }}
                          title="Delete"
                          aria-label={`Delete event ${e.title}`}
                        >
                          ×
                        </button>
                      </>
                    )}
                  </div>
                );
              })
            ))}
          </div>
        )}

        {/* Grid */}
        <div
          ref={containerRef}
          className="grid flex-1 overflow-y-auto"
          style={gridTemplateStyle}
        >
          {/* Time gutter (hidden in collapsed mode due to non-linear scale) */}
          {!collapseEmpty && (
            <div className="relative">
              {renderedHours.map((h) => (
                <div key={h} style={hourCellStyle} className="text-xs text-content-muted pr-2 pl-2 flex items-start justify-end">
                  {hourLabel(h)}
                </div>
              ))}
            </div>
          )}

          {/* Day columns */}
          {weekDaysToUse.map((d, dayIdx) => {
            const dayStart = new Date(d);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(d);
            dayEnd.setHours(23, 59, 59, 999);

            const dayEvents = dayEventsMap[dayIdx] ?? [];

            // Build merged busy intervals (minutes from visible start)
            const totalMins = (visibleEndHour - visibleStartHour) * 60;
            const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
            const minsFromVisibleStart = (dt: Date) => clamp((dt.getHours() - visibleStartHour) * 60 + dt.getMinutes(), 0, totalMins);
            type Interval = { start: number; end: number };
            const busyIntervals: Interval[] = dayEvents.map((e) => {
              // Clip to the current day's bounds so multi-day events render correctly per-day
              const rawStart = e.startTime;
              const rawEnd = e.endTime ?? e.startTime + defaultDurationMs;
              const clippedStartMs = Math.max(rawStart, dayStart.getTime());
              const clippedEndMs = Math.min(rawEnd, dayEnd.getTime());
              const s = new Date(clippedStartMs);
              const eEnd = new Date(clippedEndMs);
              const start = minsFromVisibleStart(s);
              const end = minsFromVisibleStart(eEnd);
              return { start, end: Math.max(start, end) };
            })
            .filter((iv) => iv.end > 0 && iv.start < totalMins)
            .sort((a, b) => a.start - b.start);
            // Merge overlaps
            const merged: Interval[] = [];
            for (const iv of busyIntervals) {
              const last = merged[merged.length - 1];
              if (!last || iv.start > last.end) merged.push({ ...iv });
              else last.end = Math.max(last.end, iv.end);
            }
            // Build segments alternating gaps and busy
            type Segment = { kind: 'gap' | 'busy'; start: number; end: number };
            const segments: Segment[] = [];
            let prev = 0;
            for (const iv of merged) {
              if (iv.start > prev) segments.push({ kind: 'gap', start: prev, end: iv.start });
              segments.push({ kind: 'busy', start: iv.start, end: iv.end });
              prev = iv.end;
            }
            if (prev < totalMins) segments.push({ kind: 'gap', start: prev, end: totalMins });

            // Calculate display heights with collapsed gaps
            const COLLAPSED_GAP_PX = 12;
            const segActualPx = segments.map((s) => ((s.end - s.start) / 60) * hourHeightLocal);
            const segDisplayPx = segments.map((s, i) => {
              if (s.kind === 'gap' && collapseEmpty && !(expandedGaps[dayIdx]?.has(i))) {
                return Math.min(segActualPx[i], COLLAPSED_GAP_PX);
              }
              return segActualPx[i];
            });
            const totalDisplayHeight = segDisplayPx.reduce((a, b) => a + b, 0);

            const prefixHeights: number[] = [];
            let accH = 0;
            for (let i = 0; i < segDisplayPx.length; i++) {
              prefixHeights.push(accH);
              accH += segDisplayPx[i];
            }

            const timeToY = (minute: number) => {
              const m = clamp(minute, 0, totalMins);
              let top = 0;
              for (let i = 0; i < segments.length; i++) {
                const s = segments[i];
                const disp = segDisplayPx[i];
                if (m >= s.end) {
                  top += disp;
                  continue;
                }
                if (m <= s.start) return top;
                const ratio = (m - s.start) / (s.end - s.start || 1);
                return top + disp * ratio;
              }
              return top;
            };

            const yToTime = (y: number) => {
              let acc = 0;
              for (let i = 0; i < segments.length; i++) {
                const disp = segDisplayPx[i];
                const s = segments[i];
                if (y > acc + disp) {
                  acc += disp;
                  continue;
                }
                if (disp < 0.5) return s.start; // too small to map precisely
                const ratio = (y - acc) / disp;
                return s.start + ratio * (s.end - s.start);
              }
              return totalMins;
            };

            // Compute overlap columns and positions for side-by-side layout
            type Item = { e: WeekEvent; start: Date; end: Date; startMin: number; endMin: number };
            type Positioned = { e: WeekEvent; start: Date; end: Date; startMin: number; endMin: number; col: number; colCount: number; top: number; height: number };
            const items: Array<Item> = dayEvents
              .map((e) => {
                // Clip event to current day for correct per-day positioning
                const rawStart = e.startTime;
                const rawEnd = e.endTime ?? e.startTime + defaultDurationMs;
                const clippedStartMs = Math.max(rawStart, dayStart.getTime());
                const clippedEndMs = Math.min(rawEnd, dayEnd.getTime());
                const start = new Date(clippedStartMs);
                const end = new Date(clippedEndMs);
                const startMin = minsFromVisibleStart(start);
                const endMin = minsFromVisibleStart(end);
                return { e, start, end, startMin, endMin };
              })
              .sort((a, b) => (a.startMin - b.startMin) || (a.endMin - b.endMin));

            const positioned: Array<Positioned> = [];
            let cluster: Array<Item> = [];
            let clusterEnd = -Infinity;
            const flushCluster = () => {
              if (cluster.length === 0) return;
              // Assign columns greedily
              const colEndTimes: number[] = [];
              const colAssignment: number[] = [];
              for (const it of cluster) {
                let assignedCol = -1;
                for (let c = 0; c < colEndTimes.length; c++) {
                  if (colEndTimes[c] <= it.startMin) { assignedCol = c; break; }
                }
                if (assignedCol === -1) {
                  assignedCol = colEndTimes.length;
                  colEndTimes.push(it.endMin);
                } else {
                  colEndTimes[assignedCol] = Math.max(colEndTimes[assignedCol], it.endMin);
                }
                colAssignment.push(assignedCol);
              }
              const colCount = colEndTimes.length;
              for (let i = 0; i < cluster.length; i++) {
                const it = cluster[i];
                const col = colAssignment[i];
                const startTop = collapseEmpty
                  ? timeToY(it.startMin)
                  : ((it.start.getHours() + it.start.getMinutes() / 60) - (showWorkHoursOnly ? visibleStartHour : 0)) * hourHeightLocal;
                const endTop = collapseEmpty
                  ? timeToY(it.endMin)
                  : ((it.end.getHours() + it.end.getMinutes() / 60) - (showWorkHoursOnly ? visibleStartHour : 0)) * hourHeightLocal;
                const height = Math.max(endTop - startTop, 28);
                positioned.push({ e: it.e, start: it.start, end: it.end, startMin: it.startMin, endMin: it.endMin, col, colCount, top: startTop, height });
              }
              cluster = [];
            };

            for (const it of items) {
              if (cluster.length === 0) {
                cluster.push(it);
                clusterEnd = it.endMin;
              } else if (it.startMin < clusterEnd) {
                cluster.push(it);
                clusterEnd = Math.max(clusterEnd, it.endMin);
              } else {
                flushCluster();
                cluster.push(it);
                clusterEnd = it.endMin;
              }
            }
            flushCluster();

            return (
              <div
                key={dayIdx}
                ref={(el) => { dayRefs.current[dayIdx] = el; }}
                className="relative border-l border-edge cursor-crosshair focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring overflow-hidden"
                style={{ height: collapseEmpty ? totalDisplayHeight : hourHeightLocal * (showWorkHoursOnly ? (visibleEndHour - visibleStartHour) : 24) }}
                role="gridcell"
                tabIndex={0}
                aria-label={`Calendar day ${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}. Press Enter to add an event.`}
                title={`Click to add on ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`}
                onMouseDown={(e) => {
                  // Start drag selection if left button
                  if (e.button !== 0) return;
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  let y = e.clientY - rect.top;
                  if (y < 0) y = 0;
                  const minute = collapseEmpty ? yToTime(y) : ((y / hourHeightLocal) * 60) + (showWorkHoursOnly ? visibleStartHour * 60 : 0);
                  const rounded = Math.round(minute / 15) * 15;
                  setDragState({ dayIdx, startMinute: rounded, currentMinute: rounded, isActive: true });
                  justDraggedRef.current = false;
                }}
                onMouseMove={(e) => {
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  let y = e.clientY - rect.top;
                  if (y < 0) y = 0;
                  const idx = Math.floor(y / slotHeight);
                  if (!collapseEmpty) {
                    showHoverIndicator(dayIdx, idx);
                  }
                  if (dragState && dragState.isActive && dragState.dayIdx === dayIdx) {
                    const minute = collapseEmpty ? yToTime(y) : ((y / hourHeightLocal) * 60) + (showWorkHoursOnly ? visibleStartHour * 60 : 0);
                    const rounded = Math.round(minute / 15) * 15;
                    if (Math.abs(rounded - dragState.startMinute) >= 3) {
                      justDraggedRef.current = true;
                    }
                    setDragState({ ...dragState, currentMinute: Math.max(0, Math.min(totalMins, rounded)) });
                  }
                }}
                onMouseLeave={() => {
                  hideHoverIndicator(dayIdx);
                }}
                onClick={(e) => {
                  if (dragState && dragState.isActive) return; // avoid click create when finishing drag
                  if (justDraggedRef.current) { justDraggedRef.current = false; return; }
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  let y = e.clientY - rect.top;
                  if (y < 0) y = 0;
                  if (collapseEmpty) {
                    // Non-linear mapping
                    const minute = yToTime(y);
                    let rounded = Math.round(minute / 15) * 15;
                    rounded = clamp(rounded, 0, totalMins);
                    const h = Math.floor(rounded / 60) + visibleStartHour;
                    const m = Math.round(rounded % 60);
                    const start = new Date(d);
                    start.setHours(h, m, 0, 0);
                    const startMs = start.getTime();
                    setDraft({ dayIdx, start: startMs, end: startMs + defaultDurationMs, title: "" });
                  } else {
                    const colHeight = hourHeightLocal * (showWorkHoursOnly ? (visibleEndHour - visibleStartHour) : 24);
                    if (y > colHeight) y = colHeight;
                    const hourFloat = y / hourHeightLocal + (showWorkHoursOnly ? visibleStartHour : 0);
                    let hour = Math.floor(hourFloat);
                    let minutes = Math.round(((hourFloat - hour) * 60) / 15) * 15;
                    if (minutes === 60) { hour = Math.min(hour + 1, 23); minutes = 0; }
                    const start = new Date(d);
                    start.setHours(hour, minutes, 0, 0);
                    const startMs = start.getTime();
                    setDraft({ dayIdx, start: startMs, end: startMs + defaultDurationMs, title: "" });
                  }
                }}
                onMouseUp={(_e) => {
                  if (!dragState || !dragState.isActive || dragState.dayIdx !== dayIdx) return;
                  const startMin = Math.min(dragState.startMinute, dragState.currentMinute);
                  let endMin = Math.max(dragState.startMinute, dragState.currentMinute);
                  if (endMin === startMin) endMin = Math.min(totalMins, startMin + 15); // minimum 15m
                  const start = new Date(d);
                  start.setHours(0, 0, 0, 0);
                  const startMinutesFromMidnight = (showWorkHoursOnly ? visibleStartHour * 60 : 0) + startMin;
                  const endMinutesFromMidnight = (showWorkHoursOnly ? visibleStartHour * 60 : 0) + endMin;
                  const startDate = new Date(start);
                  startDate.setMinutes(startMinutesFromMidnight, 0, 0);
                  const endDate = new Date(start);
                  endDate.setMinutes(endMinutesFromMidnight, 0, 0);
                  const startMs = startDate.getTime();
                  const endMs = endDate.getTime();
                  setDraft({ dayIdx, start: startMs, end: endMs, title: "" });
                  setDragState(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const start = new Date(d);
                    start.setHours(9, 0, 0, 0); // Create at 9:00 AM by default for keyboard flow
                    const startMs = start.getTime();
                    setDraft({ dayIdx, start: startMs, end: startMs + defaultDurationMs, title: "" });
                  }
                  if (e.key === 'Escape' && draft) {
                    setDraft(null);
                  }
                }}
              >
                {/* Today background highlight */}
                {d.toDateString() === now.toDateString() && (
                  <div className="absolute inset-0 bg-indigo-500/10 pointer-events-none" />
                )}
                {/* Hour lines (disabled in collapsed mode) */}
                {!collapseEmpty && renderedHours.map((h) => (
                  <div key={h} style={hourCellStyle} className="relative border-b border-edge transition-colors hover:bg-surface-hover/40" />
                ))}

                {/* Hovered slot highlight (15-min granularity) - off in collapsed mode */}
                {!collapseEmpty && (
                  <div
                    id={`hover-slot-${dayIdx}`}
                    ref={(el) => { hoverIndicatorRefs.current[dayIdx] = el; }}
                    className="absolute left-0 right-0 bg-indigo-500/10 ring-1 ring-ring pointer-events-none"
                    style={slotHighlightStyle}
                  />
                )}

                {/* Draft inline composer */}
                {draft && draft.dayIdx === dayIdx && (() => {
                  const start = new Date(draft.start);
                  const end = new Date(draft.end);
                  const startMin = minsFromVisibleStart(start);
                  const endMin = minsFromVisibleStart(end);
                  const startTop = collapseEmpty
                    ? timeToY(startMin)
                    : ((start.getHours() + start.getMinutes() / 60) - (showWorkHoursOnly ? visibleStartHour : 0)) * hourHeightLocal;
                  const endTop = collapseEmpty
                    ? timeToY(endMin)
                    : ((end.getHours() + end.getMinutes() / 60) - (showWorkHoursOnly ? visibleStartHour : 0)) * hourHeightLocal;
                  const height = Math.max(endTop - startTop, 28);
                  return (
                    <div
                      className="absolute left-1 right-1 rounded-md border-2 border-dashed border-indigo-500/30 bg-indigo-500/10 p-1.5 shadow-sm"
                      style={{ top: startTop, height }}
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <input
                        autoFocus
                        placeholder="Add event title · Enter to save · Esc to cancel"
                        value={draft.title}
                        aria-label={`New event title input for ${d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}`}
                        onChange={(ev) => setDraft({ ...draft, title: ev.target.value })}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') {
                            void onCreate(draft.title, draft.start, draft.end);
                            setDraft(null);
                            // Return focus to the day column after create
                            setTimeout(() => dayRefs.current[draft.dayIdx]?.focus(), 0);
                          } else if (ev.key === 'Escape') {
                            setDraft(null);
                            // Restore focus to the day column when cancelling
                            setTimeout(() => dayRefs.current[draft.dayIdx]?.focus(), 0);
                          }
                        }}
                        onBlur={() => setDraft(null)}
                        className="w-full text-xs bg-transparent outline-none focus:ring-0 text-content placeholder:text-content-muted"
                      />
                    </div>
                  );
                })()}

                {/* Drag selection preview */}
                {dragState && dragState.isActive && dragState.dayIdx === dayIdx && (() => {
                  const minm = Math.min(dragState.startMinute, dragState.currentMinute);
                  const maxm = Math.max(dragState.startMinute, dragState.currentMinute);
                  const top = collapseEmpty ? timeToY(minm) : ((minm / 60) * hourHeightLocal);
                  const bottom = collapseEmpty ? timeToY(maxm) : ((maxm / 60) * hourHeightLocal);
                  const height = Math.max(bottom - top, 2);
                  return (
                    <div
                      className="absolute left-1 right-1 rounded-md border-2 border-dashed border-indigo-500/30/50 bg-indigo-500/10 pointer-events-none"
                      style={{ top, height }}
                    />
                  );
                })()}

                {/* Current time line (stronger) */}
                {isCurrentWeek(d) && d.toDateString() === now.toDateString() && (
                  <div
                    ref={(el) => { if (el) nowAnchorRef.current = el; }}
                    className="absolute left-0 right-0"
                    style={{ top: collapseEmpty ? timeToY(minsFromVisibleStart(now)) : currentTimeTop }}
                  >
                    <div className="relative">
                      <div className="absolute -left-1 w-2.5 h-2.5 bg-red-500 rounded-full ring-2 ring-white" />
                      <div className="h-0.5 bg-red-500" />
                    </div>
                  </div>
                )}

                {/* Gap expand/collapse toggles */}
                {collapseEmpty && segments.map((s, i) => (
                  s.kind === 'gap' && segActualPx[i] - segDisplayPx[i] > 1 ? (
                    <div
                      key={`gapbtn-${i}`}
                      className="absolute left-0 right-0 flex items-center justify-center"
                      style={{ top: prefixHeights[i], height: segDisplayPx[i] }}
                    >
                      <button
                        className="text-xs px-2 py-0.5 rounded border border-edge bg-surface/80 shadow-sm hover:bg-surface-hover"
                        onClick={(ev) => { ev.stopPropagation(); setExpandedGaps((prev) => {
                          const set = new Set(prev[dayIdx] ?? []);
                          if (set.has(i)) set.delete(i); else set.add(i);
                          return { ...prev, [dayIdx]: set };
                        }); }}
                        aria-label={expandedGaps[dayIdx]?.has(i) ? 'Collapse gap' : 'Expand gap'}
                        title={expandedGaps[dayIdx]?.has(i) ? 'Collapse gap' : 'Expand gap'}
                      >
                        {expandedGaps[dayIdx]?.has(i) ? 'Collapse' : 'Expand'}
                      </button>
                    </div>
                  ) : null
                ))}

                {/* Events with side-by-side layout for overlaps */}
                {positioned.map((pe) => {
                  const colWidth = 100 / pe.colCount;
                  const leftPercent = colWidth * pe.col;
                  const e = pe.e;
                  const start = pe.start;
                  const end = pe.end;
                  const allDay = (e as any).allDay === true || (
                    start.getHours() === 0 &&
                    start.getMinutes() === 0 &&
                    end.getHours() === 23 &&
                    end.getMinutes() >= 59
                  );
                  return (
                    <div
                      key={e._id}
                      ref={(el) => { if (el) eventRefs.current[String(e._id)] = el; }}
                      className="absolute rounded-md text-xs p-2 shadow-sm transition-shadow duration-150 hover:ring-2 hover:ring-ring hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-grab active:cursor-grabbing"
                      style={{
                        top: pe.top,
                        height: pe.height,
                        left: `calc(${leftPercent}% + 2px)`,
                        width: `calc(${colWidth}% - 4px)`,
                        backgroundColor: "var(--accent-primary-bg)",
                        borderLeft: "3px solid rgb(79, 70, 229)",
                      }}
                      title={`${start.toLocaleTimeString()} - ${end.toLocaleTimeString()} - Drag to AI assistant to create a report`}
                      data-event-block
                      tabIndex={0}
                      role="button"
                      draggable
                      onDragStart={(ev) => {
                        // Set calendar event data for Fast Agent drop
                        const eventData = {
                          id: String(e._id),
                          title: e.title,
                          startTime: e.startTime,
                          endTime: e.endTime,
                          allDay: allDay,
                        };
                        ev.dataTransfer.setData('application/x-nodebench-calendar-event', JSON.stringify(eventData));
                        ev.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={(ev) => { ev.stopPropagation(); setEditingId(e._id); setEditingTitle(e.title); }}
                      onDoubleClick={(ev) => { ev.stopPropagation(); setEditingId(e._id); setEditingTitle(e.title); }}
                      onMouseDown={(ev) => { ev.stopPropagation(); }}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter') { setEditingId(e._id); setEditingTitle(e.title); }
                        if (ev.key.toLowerCase() === 'e') { ev.preventDefault(); setEditingId(e._id); setEditingTitle(e.title); }
                        if (ev.key === 'Delete') {
                          ev.preventDefault();
                          void onDelete(e._id).then(() => {
                            // Focus the day column after deletion
                            dayRefs.current[dayIdx]?.focus();
                          });
                        }
                      }}
                    >
                      {editingId === e._id ? (
                        <div onClick={(ev) => ev.stopPropagation()}>
                          <Suspense fallback={null}>
                            <LazyMiniAgendaEditorPanel
                              kind="event"
                              eventId={e._id}
                              onClose={() => {
                                setEditingId(null);
                                // Return focus to the event block after close for keyboard users
                                setTimeout(() => eventRefs.current[String(e._id)]?.focus(), 0);
                              }}
                            />
                          </Suspense>
                        </div>
                      ) : (
                        <>
                          <div className="text-content font-medium truncate pr-6">{e.title}</div>
                          <div className="text-xs text-content-secondary truncate">
                            {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            {" - "}
                            {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                          {allDay && (
                            <div className="mt-0.5">
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md border text-xs bg-indigo-500/10 border-indigo-500/20 text-indigo-600 dark:text-indigo-400">
                                All-day
                              </span>
                            </div>
                          )}
                        <button
                          className="absolute top-1 right-1 w-5 h-5 rounded hover:bg-surface-hover text-content-secondary flex items-center justify-center"
                          onClick={(ev) => { ev.stopPropagation(); void onDelete(e._id); }}
                          title="Delete"
                          aria-label={`Delete event ${e.title}`}
                        >
                          ×
                        </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Mock event presets
  const addMockEvents = async (preset: "sprint" | "meetings" | "personal") => {
    if (!loggedInUser) {
      toast.error("Please sign in to add mock events");
      return;
    }
    const now = new Date();
    const start = startOfWeek(now);
    const day = (offset: number, hour: number, durationHours = 1) => {
      const s = new Date(start);
      s.setDate(s.getDate() + offset);
      s.setHours(hour, 0, 0, 0);
      const e = new Date(s);
      e.setHours(hour + durationHours, 0, 0, 0);
      return { start: s.getTime(), end: e.getTime() };
    };

    const plans: Record<string, Array<{ title: string; start: number; end: number }>> = {
      sprint: [
        { title: "Sprint Planning", ...day(1, 10, 2) },
        { title: "Implementation Block", ...day(2, 9, 3) },
        { title: "Code Review", ...day(3, 14, 2) },
        { title: "QA Testing", ...day(4, 11, 2) },
        { title: "Sprint Demo", ...day(5, 15, 1) },
      ],
      meetings: [
        { title: "1:1", ...day(1, 11, 1) },
        { title: "Design Sync", ...day(2, 13, 1) },
        { title: "Team Standup", ...day(0, 9, 1) },
        { title: "Stakeholder Update", ...day(4, 16, 1) },
      ],
      personal: [
        { title: "Workout", ...day(1, 7, 1) },
        { title: "Groceries", ...day(2, 18, 1) },
        { title: "Study Block", ...day(3, 20, 2) },
      ],
    };

    const items = plans[preset];
    try {
      for (const it of items) {
        await createEvent({ title: it.title, startTime: it.start, endTime: it.end });
      }
      toast.success("Mock events added");
    } catch (e: any) {
      toast.error(`Failed to add events: ${e?.message ?? e}`);
    }
  };

  return (
    <>
      <div className="flex-1 min-w-0 space-y-6">
        <div>
        {/* Loading State */}
        {needsCalendarDoc && (isCreating || !calendarDocId) && (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="motion-safe:animate-spin rounded-full h-12 w-12 border-4 border-edge"></div>
                <div className="motion-safe:animate-spin rounded-full h-12 w-12 border-4 border-indigo-500/30 border-t-transparent absolute inset-0"></div>
              </div>
              <p className="text-sm text-content-secondary font-medium">
                {isCreating ? 'Creating your calendar...' : 'Loading calendar...'}
              </p>
            </div>
          </div>
        )}

        {/* Main Calendar View */}
        {(!needsCalendarDoc || (calendarDocId && !isCreating)) && (
          <div className="relative">
            {/* Header */}
            <PageHeroHeader
              icon={<CalendarIcon className="h-5 w-5" />}
              title={"Agent Schedule"}
              date={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              presets={
                <>
                  <span className="text-xs text-content-secondary mr-2">Views:</span>
                  <PresetChip onClick={() => void addMockEvents('sprint')}>Research Sprints</PresetChip>
                  <PresetChip onClick={() => void addMockEvents('meetings')}>Review Sessions</PresetChip>
                  <PresetChip onClick={() => void addMockEvents('personal')}>Deadlines</PresetChip>
                </>
              }
            />

            {/* Google Calendar-like Week View */}
            <div className="mb-6 flex-1 min-h-0">
              {isLoadingAgenda ? (
                <div className="bg-surface border border-edge rounded-lg overflow-hidden shadow-sm h-[calc(100vh-280px)] min-h-[600px]" role="status" aria-label="Loading calendar events">
                  {/* Skeleton header row */}
                  <div className="grid grid-cols-7 gap-px bg-surface-secondary/80 border-b border-edge px-2 py-3">
                    {Array.from({ length: 7 }).map((_, i) => (
                      <div key={i} className="flex flex-col items-center gap-1">
                        <div className="h-3 w-8 bg-edge/60 rounded animate-pulse" />
                        <div className="h-5 w-5 bg-edge/40 rounded-full animate-pulse" />
                      </div>
                    ))}
                  </div>
                  {/* Skeleton time grid */}
                  <div className="p-2 space-y-0">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="flex items-start gap-2 border-b border-edge/30 py-3">
                        <div className="h-3 w-10 bg-edge/40 rounded animate-pulse shrink-0" />
                        <div className="flex-1 grid grid-cols-7 gap-2">
                          {Array.from({ length: 7 }).map((_, j) => (
                            <div key={j} className={`rounded ${i % 3 === 0 && j % 2 === 0 ? 'h-8 bg-indigo-500/10' : 'h-4 bg-transparent'}`} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
              <GoogleWeekView
                events={eventsThisWeek}
                onCreate={onCreateInline}
                onUpdate={onUpdateInline}
                onDelete={onDeleteInline}

                showWorkHoursOnly={showWorkHoursOnly}
                workdayStartHour={workdayStartHour}
                workdayEndHour={workdayEndHour}
                density={density}
                collapseEmpty={collapseEmpty}
                weekDaysFromParent={weekDays}
              />
              )}
            </div>

          </div>
        )}
        </div>
      </div>

      {/* Inline-only CRUD: popup composer removed */}

      {/* Event Editor Panel Overlay */}
      {selectedEventId && (
        <Suspense fallback={null}>
          <LazyEventEditorPanel
            eventId={selectedEventId}
            onClose={() => setSelectedEventId(null)}
            documentIdForAssociation={calendarDocId ?? null}
          />
        </Suspense>
      )}
    </>
  );
}
