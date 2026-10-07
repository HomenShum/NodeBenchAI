/**
 * usePlannerDateNav
 *
 * Date navigation and week/day labeling for the planner.
 * Extracts: agendaSelectedDateMs, showWeekInAgenda, tzOffsetMinutes,
 * weekRangeLabel, agendaDayLabel, agendaRangeLabel, all week/day nav callbacks.
 */

import { useState, useMemo, useCallback } from "react";
type MutReturnType<T extends (...args: any) => any> = ReturnType<T>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgendaScope = "day" | "week";

export interface PlannerDateNavParams {
  prefs: any | undefined;
  loggedInUser: any | null;
  /** Focused date ms from usePlannerState */
  focusedDateMs: number;
  /** Set focused date from usePlannerState */
  handleViewWeek: (dateMs: number) => void;
  /** Convex mutation for persisting planner view prefs */
  setPlannerViewPrefs: (args: any) => Promise<any>;
}

export interface PlannerDateNavSlice {
  // State
  agendaSelectedDateMs: number | null;
  setAgendaSelectedDateMs: React.Dispatch<React.SetStateAction<number | null>>;
  showWeekInAgenda: boolean;
  setShowWeekInAgenda: React.Dispatch<React.SetStateAction<boolean>>;

  // Derived timezone values
  tzOffsetMinutes: number;
  offsetMs: number;

  // UTC anchors
  todayStartUtc: number;
  weekStartUtc: number;
  weekEndUtc: number;
  agendaStartUtc: number;
  agendaEndUtc: number;

  // Labels
  weekRangeLabel: string;
  agendaDayLabel: string;
  agendaRangeLabel: string;
  agendaWeekLabel: string;

  // Nav callbacks
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onTodayWeek: () => void;
  onPrevAgenda: () => void;
  onNextAgenda: () => void;
  onSetAgendaScope: (scope: AgendaScope) => void;
  onPrevAgendaWeek: () => void;
  onNextAgendaWeek: () => void;
  onAgendaToday: () => void;
  onPrevAgendaDay: () => void;
  onNextAgendaDay: () => void;

  // Utilities
  startOfWeekMs: (ms: number) => number;
  formatWeekRange: (weekStartMs: number) => string;
  applyAgendaCanonical: (canonical: number) => void;

  // Scope
  agendaScope: AgendaScope;
  setAgendaScope: React.Dispatch<React.SetStateAction<AgendaScope>>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlannerDateNav(
  params: PlannerDateNavParams,
): PlannerDateNavSlice {
  const {
    prefs,
    loggedInUser,
    focusedDateMs,
    handleViewWeek,
    setPlannerViewPrefs,
  } = params;

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const [agendaSelectedDateMs, setAgendaSelectedDateMs] = useState<
    number | null
  >(null);
  const [showWeekInAgenda, setShowWeekInAgenda] = useState<boolean>(true);
  const [agendaScope, setAgendaScope] = useState<AgendaScope>("week");

  // -------------------------------------------------------------------------
  // Timezone offset
  // -------------------------------------------------------------------------

  const tzOffsetMinutes = useMemo(() => {
    const timeZone: string | undefined = prefs?.timeZone as
      | string
      | undefined;

    function offsetMinutesForZone(
      timeZoneInner: string | undefined,
      date: Date,
    ): number {
      if (!timeZoneInner) {
        return -date.getTimezoneOffset();
      }

      try {
        const dtf = new Intl.DateTimeFormat("en-US", {
          timeZone: timeZoneInner,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });

        const parts = dtf.formatToParts(date);
        const get = (t: string) =>
          Number(parts.find((p) => p.type === t)?.value);

        const y = get("year");
        const m = (get("month") || 1) - 1;
        const d = get("day") || 1;
        const h = get("hour") || 0;
        const min = get("minute") || 0;
        const s = get("second") || 0;

        const asUTC = Date.UTC(y, m, d, h, min, s);
        const diffMin = (asUTC - date.getTime()) / 60000;
        return diffMin;
      } catch {
        return -date.getTimezoneOffset();
      }
    }

    if (timeZone && timeZone.length > 0) {
      return offsetMinutesForZone(timeZone, new Date());
    }

    return -new Date().getTimezoneOffset();
  }, [prefs]);

  const offsetMs = tzOffsetMinutes * 60 * 1000;

  // -------------------------------------------------------------------------
  // Today / week UTC anchors
  // -------------------------------------------------------------------------

  const _nowLocal = new Date(Date.now() + offsetMs);
  _nowLocal.setUTCHours(0, 0, 0, 0);
  const todayStartUtc = _nowLocal.getTime() - offsetMs;

  const anchorLocal = new Date((focusedDateMs ?? todayStartUtc) + offsetMs);
  anchorLocal.setUTCHours(0, 0, 0, 0);
  const _dow = anchorLocal.getUTCDay();
  const _diffToMonday = (_dow + 6) % 7;
  const _mondayLocal = new Date(
    anchorLocal.getTime() - _diffToMonday * 24 * 60 * 60 * 1000,
  );
  const weekStartUtc = _mondayLocal.getTime() - offsetMs;
  const weekEndUtc = weekStartUtc + 7 * 24 * 60 * 60 * 1000 - 1;

  const agendaStartUtc = agendaSelectedDateMs ?? todayStartUtc;
  const agendaEndUtc = agendaStartUtc + (24 * 60 * 60 * 1000 - 1);

  // -------------------------------------------------------------------------
  // Week navigation helpers
  // -------------------------------------------------------------------------

  const startOfWeekMs = useCallback((ms: number): number => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    const delta = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - delta);
    return d.getTime();
  }, []);

  const formatWeekRange = useCallback((weekStartMs: number): string => {
    const start = new Date(weekStartMs);
    const end = new Date(weekStartMs);
    end.setDate(start.getDate() + 6);

    const sameMonth =
      start.getMonth() === end.getMonth() &&
      start.getFullYear() === end.getFullYear();

    if (sameMonth) {
      const month = start.toLocaleString(undefined, { month: "long" });
      return `${month} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`;
    }

    const startStr = start.toLocaleString(undefined, {
      month: "long",
      day: "numeric",
    });
    const endStr = end.toLocaleString(undefined, {
      month: "long",
      day: "numeric",
    });
    const yearSame = start.getFullYear() === end.getFullYear();
    return `${startStr} - ${endStr}${yearSame ? `, ${start.getFullYear()}` : ` ${end.getFullYear()}`}`;
  }, []);

  // -------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------

  const weekRangeLabel = useMemo(() => {
    const anchor = focusedDateMs ?? Date.now();
    const wStart = startOfWeekMs(anchor);
    return formatWeekRange(wStart);
  }, [focusedDateMs, startOfWeekMs, formatWeekRange]);

  const agendaWeekLabel = weekRangeLabel;

  const agendaDayLabel = useMemo(() => {
    const d = new Date(agendaStartUtc + offsetMs);
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }, [agendaStartUtc, offsetMs]);

  const agendaRangeLabel = useMemo(
    () => (agendaScope === "week" ? agendaWeekLabel : agendaDayLabel),
    [agendaScope, agendaWeekLabel, agendaDayLabel],
  );

  // -------------------------------------------------------------------------
  // Canonical date helpers
  // -------------------------------------------------------------------------

  const applyAgendaCanonical = useCallback(
    (canonical: number) => {
      setAgendaSelectedDateMs(canonical);

      if (loggedInUser) {
        void setPlannerViewPrefs({ agendaSelectedDateMs: canonical }).catch(
          () => {},
        );
      } else {
        try {
          localStorage.setItem(
            "nodebench:agendaSelectedDateMs",
            String(canonical),
          );
        } catch {}
      }
    },
    [loggedInUser, setPlannerViewPrefs],
  );

  const changeAgendaByDays = useCallback(
    (delta: number) => {
      const d = new Date(agendaStartUtc + offsetMs);
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() + delta);
      const canonical = d.getTime() - offsetMs;
      applyAgendaCanonical(canonical);
    },
    [agendaStartUtc, offsetMs, applyAgendaCanonical],
  );

  // -------------------------------------------------------------------------
  // Week navigation callbacks
  // -------------------------------------------------------------------------

  const onPrevWeek = useCallback(() => {
    const anchor = focusedDateMs ?? Date.now();
    const start = startOfWeekMs(anchor);
    handleViewWeek(start - 7 * 24 * 60 * 60 * 1000);
  }, [focusedDateMs, startOfWeekMs, handleViewWeek]);

  const onNextWeek = useCallback(() => {
    const anchor = focusedDateMs ?? Date.now();
    const start = startOfWeekMs(anchor);
    handleViewWeek(start + 7 * 24 * 60 * 60 * 1000);
  }, [focusedDateMs, startOfWeekMs, handleViewWeek]);

  const onTodayWeek = useCallback(() => {
    handleViewWeek(startOfWeekMs(Date.now()));
  }, [startOfWeekMs, handleViewWeek]);

  // -------------------------------------------------------------------------
  // Agenda navigation callbacks
  // -------------------------------------------------------------------------

  const onPrevAgendaWeek = useCallback(() => {
    const wStartLocal = startOfWeekMs(agendaStartUtc + offsetMs);
    const newLocal = wStartLocal - 7 * 24 * 60 * 60 * 1000;
    const canonical = newLocal - offsetMs;
    setAgendaSelectedDateMs(canonical);

    if (loggedInUser) {
      void setPlannerViewPrefs({ agendaSelectedDateMs: canonical }).catch(
        () => {},
      );
    } else {
      try {
        localStorage.setItem(
          "nodebench:agendaSelectedDateMs",
          String(canonical),
        );
      } catch {}
    }
  }, [agendaStartUtc, offsetMs, startOfWeekMs, loggedInUser, setPlannerViewPrefs]);

  const onNextAgendaWeek = useCallback(() => {
    const wStartLocal = startOfWeekMs(agendaStartUtc + offsetMs);
    const newLocal = wStartLocal + 7 * 24 * 60 * 60 * 1000;
    const canonical = newLocal - offsetMs;
    setAgendaSelectedDateMs(canonical);

    if (loggedInUser) {
      void setPlannerViewPrefs({ agendaSelectedDateMs: canonical }).catch(
        () => {},
      );
    } else {
      try {
        localStorage.setItem(
          "nodebench:agendaSelectedDateMs",
          String(canonical),
        );
      } catch {}
    }
  }, [agendaStartUtc, offsetMs, startOfWeekMs, loggedInUser, setPlannerViewPrefs]);

  const onAgendaToday = useCallback(() => {
    setAgendaSelectedDateMs(null);

    if (loggedInUser) {
      void setPlannerViewPrefs({}).catch(() => {});
    } else {
      try {
        localStorage.removeItem("nodebench:agendaSelectedDateMs");
      } catch {}
    }
  }, [loggedInUser, setPlannerViewPrefs]);

  const onPrevAgendaDay = useCallback(
    () => changeAgendaByDays(-1),
    [changeAgendaByDays],
  );

  const onNextAgendaDay = useCallback(
    () => changeAgendaByDays(1),
    [changeAgendaByDays],
  );

  const onPrevAgenda = useCallback(() => {
    if (agendaScope === "week") onPrevAgendaWeek();
    else onPrevAgendaDay();
  }, [agendaScope, onPrevAgendaDay, onPrevAgendaWeek]);

  const onNextAgenda = useCallback(() => {
    if (agendaScope === "week") onNextAgendaWeek();
    else onNextAgendaDay();
  }, [agendaScope, onNextAgendaDay, onNextAgendaWeek]);

  const onSetAgendaScope = useCallback((scope: AgendaScope) => {
    setAgendaScope(scope);
  }, []);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    agendaSelectedDateMs,
    setAgendaSelectedDateMs,
    showWeekInAgenda,
    setShowWeekInAgenda,
    tzOffsetMinutes,
    offsetMs,
    todayStartUtc,
    weekStartUtc,
    weekEndUtc,
    agendaStartUtc,
    agendaEndUtc,
    weekRangeLabel,
    agendaDayLabel,
    agendaRangeLabel,
    agendaWeekLabel,
    onPrevWeek,
    onNextWeek,
    onTodayWeek,
    onPrevAgenda,
    onNextAgenda,
    onSetAgendaScope,
    onPrevAgendaWeek,
    onNextAgendaWeek,
    onAgendaToday,
    onPrevAgendaDay,
    onNextAgendaDay,
    startOfWeekMs,
    formatWeekRange,
    applyAgendaCanonical,
    agendaScope,
    setAgendaScope,
  };
}
