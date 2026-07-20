/**
 * usePlannerAgendaData
 *
 * Agenda data shaping: queries Convex for week agenda items, deduplicates
 * and merges with parent-provided data.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { PlannerDateNavSlice } from "./usePlannerDateNav";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgendaMode = "list" | "kanban" | "weekly" | "mini";
type UpcomingMode = "list" | "mini";

export interface PlannerAgendaDataParams {
  loggedInUser: any | null;
  tasks: { thisWeek: any[] };
  events: { thisWeek: any[] };
  holidays: { thisWeek: any[] };
  /** Date nav outputs needed for query ranges */
  dateNav: Pick<
    PlannerDateNavSlice,
    | "weekStartUtc"
    | "weekEndUtc"
    | "offsetMs"
    | "agendaSelectedDateMs"
    | "startOfWeekMs"
    | "agendaStartUtc"
    | "applyAgendaCanonical"
    | "agendaScope"
  >;
  /** Focused date from usePlannerState */
  focusedDateMs: number;
  /** Convex mutation for persisting planner view prefs */
  setPlannerViewPrefs: (args: any) => Promise<any>;
  /** Convex mutation for persisting upcoming view prefs */
  setUpcomingViewPrefs: (args: any) => Promise<any>;
}

export interface PlannerAgendaSlice {
  agendaMode: AgendaMode;
  setAgendaMode: React.Dispatch<React.SetStateAction<AgendaMode>>;
  lastNonWeeklyAgendaMode: "list" | "kanban" | "mini";
  setLastNonWeeklyAgendaMode: React.Dispatch<
    React.SetStateAction<"list" | "kanban" | "mini">
  >;

  // Query results
  agendaWeekTasks: any[];
  agendaWeekEvents: any[];
  agendaWeekHolidays: any[];
  agendaWeekNotes: any[];

  // Merged
  weekEventsMerged: any[];
  weekTasksMerged: any[];
  weekHolidaysMerged: any[];

  // Week picker state
  showUpcomingWeekPicker: boolean;
  setShowUpcomingWeekPicker: React.Dispatch<React.SetStateAction<boolean>>;
  showAgendaWeekPicker: boolean;
  setShowAgendaWeekPicker: React.Dispatch<React.SetStateAction<boolean>>;
  upcomingWeekPickerAnchorRef: React.MutableRefObject<HTMLDivElement | null>;
  upcomingWeekPickerPanelRef: React.MutableRefObject<HTMLDivElement | null>;
  agendaWeekPickerAnchorRef: React.MutableRefObject<HTMLDivElement | null>;
  agendaWeekPickerPanelRef: React.MutableRefObject<HTMLDivElement | null>;

  // Mode change callbacks
  onChangeAgendaMode: (m: AgendaMode) => void;
  onChangeUpcomingMode: (m: UpcomingMode) => void;

  // Upcoming mode
  upcomingMode: UpcomingMode;
  setUpcomingMode: React.Dispatch<React.SetStateAction<UpcomingMode>>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlannerAgendaData(
  params: PlannerAgendaDataParams,
): PlannerAgendaSlice {
  const {
    loggedInUser,
    tasks,
    events,
    holidays,
    dateNav,
    setPlannerViewPrefs,
    setUpcomingViewPrefs,
  } = params;

  const {
    weekStartUtc,
    weekEndUtc,
    offsetMs,
  } = dateNav;

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const [agendaMode, setAgendaMode] = useState<AgendaMode>("mini");
  const [lastNonWeeklyAgendaMode, setLastNonWeeklyAgendaMode] = useState<
    "list" | "kanban" | "mini"
  >("list");

  const [showUpcomingWeekPicker, setShowUpcomingWeekPicker] =
    useState<boolean>(false);
  const [showAgendaWeekPicker, setShowAgendaWeekPicker] =
    useState<boolean>(false);

  const [upcomingMode, setUpcomingMode] = useState<UpcomingMode>("mini");

  const upcomingWeekPickerAnchorRef = useRef<HTMLDivElement | null>(null);
  const upcomingWeekPickerPanelRef = useRef<HTMLDivElement | null>(null);
  const agendaWeekPickerAnchorRef = useRef<HTMLDivElement | null>(null);
  const agendaWeekPickerPanelRef = useRef<HTMLDivElement | null>(null);

  // -------------------------------------------------------------------------
  // Convex queries
  // -------------------------------------------------------------------------

  const agendaWeekStartUtc = weekStartUtc;
  const agendaWeekEndUtc = weekEndUtc;

  const agendaWeekHolidayRange = useMemo(
    () => ({
      startUtc: agendaWeekStartUtc + offsetMs,
      endUtc: agendaWeekEndUtc + offsetMs,
    }),
    [agendaWeekStartUtc, agendaWeekEndUtc, offsetMs],
  );

  const agendaSelectedWeekRaw = useQuery(
    api.domains.calendar.calendar.listAgendaInRange,
    loggedInUser
      ? {
          start: agendaWeekStartUtc,
          end: agendaWeekEndUtc,
          country: "US",
          holidaysStartUtc: agendaWeekHolidayRange.startUtc,
          holidaysEndUtc: agendaWeekHolidayRange.endUtc,
        }
      : "skip",
  );

  const agendaWeekTasks = useMemo(
    () => agendaSelectedWeekRaw?.tasks ?? [],
    [agendaSelectedWeekRaw],
  );
  const agendaWeekEvents = useMemo(
    () => agendaSelectedWeekRaw?.events ?? [],
    [agendaSelectedWeekRaw],
  );
  const agendaWeekHolidays = useMemo(
    () => agendaSelectedWeekRaw?.holidays ?? [],
    [agendaSelectedWeekRaw],
  );

  const agendaWeekNotesRaw = useQuery(
    api.domains.documents.documents.listNotesInRange as any,
    loggedInUser
      ? { start: agendaWeekStartUtc, end: agendaWeekEndUtc }
      : "skip",
  );
  const agendaWeekNotes = useMemo(
    () => agendaWeekNotesRaw ?? [],
    [agendaWeekNotesRaw],
  );

  // -------------------------------------------------------------------------
  // Dedup + merge
  // -------------------------------------------------------------------------

  const dedupById = useCallback((arr: any[]) => {
    const m = new Map<string, any>();
    for (const it of arr || []) {
      const id = String((it && (it._id ?? it.id ?? "")) || Math.random());
      m.set(id, it);
    }
    return Array.from(m.values());
  }, []);

  const tasksThisWeek = tasks.thisWeek;
  const eventsThisWeek = events.thisWeek;
  const holidaysThisWeek = holidays.thisWeek;

  const weekEventsMerged = useMemo(
    () => dedupById([...(agendaWeekEvents || []), ...(eventsThisWeek || [])]),
    [agendaWeekEvents, eventsThisWeek, dedupById],
  );
  const weekTasksMerged = useMemo(
    () => dedupById([...(agendaWeekTasks || []), ...(tasksThisWeek || [])]),
    [agendaWeekTasks, tasksThisWeek, dedupById],
  );
  const weekHolidaysMerged = useMemo(
    () =>
      dedupById([...(agendaWeekHolidays || []), ...(holidaysThisWeek || [])]),
    [agendaWeekHolidays, holidaysThisWeek, dedupById],
  );

  // -------------------------------------------------------------------------
  // Click-away effects for week pickers
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!showUpcomingWeekPicker) return;

    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        upcomingWeekPickerAnchorRef.current &&
        (upcomingWeekPickerAnchorRef.current.contains(t) ||
          (upcomingWeekPickerPanelRef.current?.contains(t) ?? false))
      ) {
        return;
      }
      setShowUpcomingWeekPicker(false);
    };

    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [showUpcomingWeekPicker]);

  useEffect(() => {
    if (!showAgendaWeekPicker) return;

    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        agendaWeekPickerAnchorRef.current &&
        (agendaWeekPickerAnchorRef.current.contains(t) ||
          (agendaWeekPickerPanelRef.current?.contains(t) ?? false))
      ) {
        return;
      }
      setShowAgendaWeekPicker(false);
    };

    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [showAgendaWeekPicker]);

  // -------------------------------------------------------------------------
  // Mode change callbacks with persistence
  // -------------------------------------------------------------------------

  const onChangeAgendaMode = useCallback(
    (m: AgendaMode) => {
      setAgendaMode(m);
      if (m !== "weekly") setLastNonWeeklyAgendaMode(m);

      if (loggedInUser) {
        setPlannerViewPrefs({ agendaMode: m }).catch(() => {});
      } else {
        try {
          localStorage.setItem("nodebench:agendaMode", m);
        } catch {}
      }
    },
    [loggedInUser, setPlannerViewPrefs],
  );

  const onChangeUpcomingMode = useCallback(
    (m: UpcomingMode) => {
      setUpcomingMode(m);

      if (loggedInUser) {
        (
          setUpcomingViewPrefs as unknown as (args: {
            upcomingMode: "list" | "mini";
          }) => Promise<any>
        )({ upcomingMode: m }).catch(() => {});
      }

      try {
        localStorage.setItem("nodebench:upcomingMode", m);
      } catch {}
    },
    [loggedInUser, setUpcomingViewPrefs],
  );

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    agendaMode,
    setAgendaMode,
    lastNonWeeklyAgendaMode,
    setLastNonWeeklyAgendaMode,
    agendaWeekTasks,
    agendaWeekEvents,
    agendaWeekHolidays,
    agendaWeekNotes,
    weekEventsMerged,
    weekTasksMerged,
    weekHolidaysMerged,
    showUpcomingWeekPicker,
    setShowUpcomingWeekPicker,
    showAgendaWeekPicker,
    setShowAgendaWeekPicker,
    upcomingWeekPickerAnchorRef,
    upcomingWeekPickerPanelRef,
    agendaWeekPickerAnchorRef,
    agendaWeekPickerPanelRef,
    onChangeAgendaMode,
    onChangeUpcomingMode,
    upcomingMode,
    setUpcomingMode,
  };
}
