/**
 * usePlannerViewPrefs
 *
 * Planner view preferences: mode, density, kanban orientation, view menu,
 * upcoming mode, and their persistence effects.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { PlannerMode } from "@features/documents/components/documentsHub";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Density = "comfortable" | "compact";
type KanbanOrientation = "columns" | "rows";

export interface PlannerViewPrefsParams {
  prefs: any | undefined;
  loggedInUser: any | null;
  /** Convex mutation: persist planner view preferences */
  setPlannerViewPrefs: (args: any) => Promise<any>;
  /** Convex mutation: persist planner mode */
  setPlannerModeMutation: (args: any) => Promise<any>;
  /** handleViewDay from usePlannerState */
  handleViewDay: (dateMs: number) => void;
  /** handleViewWeek from usePlannerState */
  handleViewWeek: (dateMs: number) => void;
}

export interface PlannerViewSlice {
  mode: PlannerMode;
  setMode: React.Dispatch<React.SetStateAction<PlannerMode>>;
  density: Density;
  setDensity: React.Dispatch<React.SetStateAction<Density>>;
  kanbanOrientation: KanbanOrientation;
  setKanbanOrientation: React.Dispatch<React.SetStateAction<KanbanOrientation>>;
  viewMenuOpen: boolean;
  setViewMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  viewMenuRef: React.MutableRefObject<HTMLDivElement | null>;
  viewButtonRef: React.MutableRefObject<HTMLButtonElement | null>;
  showWeekInAgenda: boolean;
  setShowWeekInAgenda: React.Dispatch<React.SetStateAction<boolean>>;
  upcomingMode: "list" | "mini";
  setUpcomingMode: React.Dispatch<React.SetStateAction<"list" | "mini">>;
  onChangeDensity: (d: Density) => void;
  onToggleShowWeek: () => void;
  handleViewDayLocal: (dateMs: number) => void;
  handleViewWeekLocal: (dateMs: number) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlannerViewPrefs(
  params: PlannerViewPrefsParams,
): PlannerViewSlice {
  const {
    prefs,
    loggedInUser,
    setPlannerViewPrefs,
    setPlannerModeMutation,
    handleViewDay,
    handleViewWeek,
  } = params;

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const [mode, setMode] = useState<PlannerMode>("list");
  const [density, setDensity] = useState<Density>("comfortable");
  const [kanbanOrientation, setKanbanOrientation] =
    useState<KanbanOrientation>(() => {
      try {
        const v =
          typeof window !== "undefined"
            ? localStorage.getItem("nodebench:kanbanOrientation")
            : null;
        return v === "rows" ? "rows" : "columns";
      } catch {
        return "columns";
      }
    });
  const [viewMenuOpen, setViewMenuOpen] = useState<boolean>(false);
  const [showWeekInAgenda, setShowWeekInAgenda] = useState<boolean>(true);
  const [upcomingMode, setUpcomingMode] = useState<"list" | "mini">("mini");

  const viewMenuRef = useRef<HTMLDivElement | null>(null);
  const viewButtonRef = useRef<HTMLButtonElement | null>(null);

  // -------------------------------------------------------------------------
  // Effects: Kanban orientation persistence
  // -------------------------------------------------------------------------

  useEffect(() => {
    try {
      if (typeof window !== "undefined")
        localStorage.setItem("nodebench:kanbanOrientation", kanbanOrientation);
    } catch {}
  }, [kanbanOrientation]);

  // -------------------------------------------------------------------------
  // Effects: Initialize mode from server preferences
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!prefs) return;

    const serverModeRaw = prefs.plannerMode ?? "list";
    let serverMode: "list" | "kanban" | "weekly" = "list";
    if (
      serverModeRaw === "list" ||
      serverModeRaw === "kanban" ||
      serverModeRaw === "weekly"
    ) {
      serverMode = serverModeRaw;
    }
    setMode(serverMode);
  }, [prefs, loggedInUser, setPlannerModeMutation]);

  // Persist planner mode to server when it changes
  useEffect(() => {
    if (!loggedInUser) return;
    setPlannerModeMutation({ mode }).catch(() => {});
  }, [mode, loggedInUser, setPlannerModeMutation]);

  // -------------------------------------------------------------------------
  // Effects: Initialize density, showWeekInAgenda, etc. from prefs
  // -------------------------------------------------------------------------

  useEffect(() => {
    const d = prefs?.plannerDensity as Density | undefined;
    if (d === "comfortable" || d === "compact") setDensity(d);

    const s = prefs?.showWeekInAgenda as boolean | undefined;
    if (typeof s === "boolean") setShowWeekInAgenda(s);

    const um = prefs?.upcomingMode as "list" | "mini" | undefined;
    if (um === "list" || um === "mini") setUpcomingMode(um);

    // Fallback to localStorage for upcoming mode
    try {
      const umLS =
        typeof window !== "undefined"
          ? localStorage.getItem("nodebench:upcomingMode")
          : null;
      if (umLS === "list" || umLS === "mini") setUpcomingMode(umLS);
    } catch {}
  }, [prefs]);

  // -------------------------------------------------------------------------
  // Effects: When not logged in, fall back to localStorage for view prefs
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (loggedInUser) return;

    try {
      const d =
        typeof window !== "undefined"
          ? localStorage.getItem("nodebench:plannerDensity")
          : null;
      if (d === "comfortable" || d === "compact") setDensity(d);

      const s =
        typeof window !== "undefined"
          ? localStorage.getItem("nodebench:showWeekInAgenda")
          : null;
      if (s === "true" || s === "false") setShowWeekInAgenda(s === "true");

      const um =
        typeof window !== "undefined"
          ? localStorage.getItem("nodebench:upcomingMode")
          : null;
      if (um === "list" || um === "mini") setUpcomingMode(um);
    } catch {}
  }, [loggedInUser]);

  // -------------------------------------------------------------------------
  // Effects: Planner mode localStorage fallback (not logged in)
  // -------------------------------------------------------------------------

  const isPlannerMode = (v: string): v is PlannerMode =>
    v === "list" || v === "kanban" || v === "weekly";

  useEffect(() => {
    if (loggedInUser) return;
    try {
      const saved =
        typeof window !== "undefined"
          ? localStorage.getItem("nodebench:plannerMode")
          : null;
      if (saved) {
        const mapped = saved === "calendar" ? "list" : saved;
        if (isPlannerMode(mapped)) setMode(mapped);
      }
    } catch {}
  }, [loggedInUser]);

  useEffect(() => {
    if (loggedInUser) return;
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("nodebench:plannerMode", mode);
      }
    } catch {}
  }, [mode, loggedInUser]);

  // -------------------------------------------------------------------------
  // Effects: View menu outside click / escape
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!viewMenuOpen) return;

    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        viewMenuRef.current &&
        !viewMenuRef.current.contains(t) &&
        viewButtonRef.current &&
        !viewButtonRef.current.contains(t)
      ) {
        setViewMenuOpen(false);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewMenuOpen(false);
    };

    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [viewMenuOpen]);

  // -------------------------------------------------------------------------
  // Callbacks
  // -------------------------------------------------------------------------

  const onChangeDensity = useCallback(
    (d: Density) => {
      setDensity(d);

      if (loggedInUser) {
        setPlannerViewPrefs({ density: d }).catch(() => {});
      } else {
        try {
          localStorage.setItem("nodebench:plannerDensity", d);
        } catch {}
      }
    },
    [loggedInUser, setPlannerViewPrefs],
  );

  const onToggleShowWeek = useCallback(() => {
    const next = !showWeekInAgenda;
    setShowWeekInAgenda(next);

    if (loggedInUser) {
      setPlannerViewPrefs({ showWeekInAgenda: next }).catch(() => {});
    } else {
      try {
        localStorage.setItem("nodebench:showWeekInAgenda", String(next));
      } catch {}
    }
  }, [showWeekInAgenda, loggedInUser, setPlannerViewPrefs]);

  const handleViewDayLocal = useCallback(
    (dateMs: number) => {
      handleViewDay(dateMs);
      setMode("weekly");
    },
    [handleViewDay],
  );

  const handleViewWeekLocal = useCallback(
    (dateMs: number) => {
      handleViewWeek(dateMs);
      setMode("weekly");
    },
    [handleViewWeek],
  );

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    mode,
    setMode,
    density,
    setDensity,
    kanbanOrientation,
    setKanbanOrientation,
    viewMenuOpen,
    setViewMenuOpen,
    viewMenuRef,
    viewButtonRef,
    showWeekInAgenda,
    setShowWeekInAgenda,
    upcomingMode,
    setUpcomingMode,
    onChangeDensity,
    onToggleShowWeek,
    handleViewDayLocal,
    handleViewWeekLocal,
  };
}
