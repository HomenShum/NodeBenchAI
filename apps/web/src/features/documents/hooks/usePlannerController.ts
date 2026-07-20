/**
 * usePlannerController
 *
 * Extracts ALL planner/agenda-domain state from DocumentsHomeHub into a
 * standalone hook for render-isolation and testability.
 *
 * Consumers destructure the return into sub-objects:
 *   dateNav     - week navigation callbacks + labels
 *   agendaState - agenda mode, scope, selected date, week data
 *   editorState - event/task editing state (toolbar dialog, mini editor, inline create, etc.)
 *   viewState   - mode, density, kanban orientation, view menu, upcoming mode
 *
 * Implementation: composes 5 focused sub-hooks for maintainability.
 */

import { useEffect, useMemo } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { PlannerMode, AgendaPopoverState } from "@features/documents/components/documentsHub";
import { usePlannerState } from "@/hooks/usePlannerState";
import { usePlannerMutations } from "./usePlannerMutations";
import { usePlannerDateNav } from "./usePlannerDateNav";
import { usePlannerAgendaData } from "./usePlannerAgendaData";
import { usePlannerViewPrefs } from "./usePlannerViewPrefs";
import { usePlannerEditor } from "./usePlannerEditor";

// Re-export sub-hook slice types for consumers
export type { PlannerDateNavSlice } from "./usePlannerDateNav";
export type { PlannerAgendaSlice } from "./usePlannerAgendaData";
export type { PlannerViewSlice } from "./usePlannerViewPrefs";
export type { PlannerEditorSlice } from "./usePlannerEditor";
export type { PlannerMutationSlice } from "./usePlannerMutations";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgendaMode = "list" | "kanban" | "weekly" | "mini";
type AgendaScope = "day" | "week";
type Density = "comfortable" | "compact";
type KanbanOrientation = "columns" | "rows";
type UpcomingMode = "list" | "mini";

export interface UsePlannerControllerParams {
  prefs: any | undefined;
  loggedInUser: any | null;
  tasks: {
    today: any[];
    thisWeek: any[];
  };
  events: {
    today: any[];
    thisWeek: any[];
  };
  holidays: {
    today: any[];
    thisWeek: any[];
  };
  notes?: any[];
  selectedTaskId?: Id<"userEvents"> | null;
  onSelectTask?: (id: Id<"userEvents">, source: "today" | "upcoming" | "week" | "other") => void;
  onClearTaskSelection?: () => void;
}

export interface DateNavReturn {
  /** Monday-Sunday range label for the focused week */
  weekRangeLabel: string;
  /** Agenda day label (e.g. "Monday, Mar 20") */
  agendaDayLabel: string;
  /** Agenda range label (day or week depending on scope) */
  agendaRangeLabel: string;
  /** Agenda week label (same as weekRangeLabel, aligned) */
  agendaWeekLabel: string;
  /** Navigate to the previous week */
  onPrevWeek: () => void;
  /** Navigate to the next week */
  onNextWeek: () => void;
  /** Navigate to the current week */
  onTodayWeek: () => void;
  /** Navigate agenda to previous period (day or week) */
  onPrevAgenda: () => void;
  /** Navigate agenda to next period (day or week) */
  onNextAgenda: () => void;
  /** Set agenda scope (day or week) */
  onSetAgendaScope: (scope: AgendaScope) => void;
  /** Navigate agenda to previous week */
  onPrevAgendaWeek: () => void;
  /** Navigate agenda to next week */
  onNextAgendaWeek: () => void;
  /** Navigate agenda to today */
  onAgendaToday: () => void;
  /** Navigate agenda to previous day */
  onPrevAgendaDay: () => void;
  /** Navigate agenda to next day */
  onNextAgendaDay: () => void;
  /** Compute start-of-week (Monday) from any ms timestamp */
  startOfWeekMs: (ms: number) => number;
  /** Format a week range label from a Monday timestamp */
  formatWeekRange: (weekStartMs: number) => string;
}

export interface AgendaStateReturn {
  agendaMode: AgendaMode;
  setAgendaMode: React.Dispatch<React.SetStateAction<AgendaMode>>;
  lastNonWeeklyAgendaMode: "list" | "kanban" | "mini";
  setLastNonWeeklyAgendaMode: React.Dispatch<React.SetStateAction<"list" | "kanban" | "mini">>;
  agendaScope: AgendaScope;
  setAgendaScope: React.Dispatch<React.SetStateAction<AgendaScope>>;
  agendaSelectedDateMs: number | null;
  setAgendaSelectedDateMs: React.Dispatch<React.SetStateAction<number | null>>;
  /** Canonical start of the current agenda day (UTC) */
  agendaStartUtc: number;
  /** Canonical end of the current agenda day (UTC) */
  agendaEndUtc: number;
  /** Timezone offset in minutes east of UTC */
  tzOffsetMinutes: number;
  /** Timezone offset in ms */
  offsetMs: number;
  /** UTC start of today (local midnight -> UTC) */
  todayStartUtc: number;
  /** UTC start of the focused week (Monday) */
  weekStartUtc: number;
  /** UTC end of the focused week (Sunday 23:59:59.999) */
  weekEndUtc: number;
  /** Agenda week tasks (from Convex query) */
  agendaWeekTasks: any[];
  /** Agenda week events */
  agendaWeekEvents: any[];
  /** Agenda week holidays */
  agendaWeekHolidays: any[];
  /** Agenda week notes */
  agendaWeekNotes: any[];
  /** Merged week events (calendar query + upcoming.sevenDays) */
  weekEventsMerged: any[];
  /** Merged week tasks */
  weekTasksMerged: any[];
  /** Merged week holidays */
  weekHolidaysMerged: any[];
  /** Week picker open state (upcoming) */
  showUpcomingWeekPicker: boolean;
  setShowUpcomingWeekPicker: React.Dispatch<React.SetStateAction<boolean>>;
  /** Week picker open state (agenda) */
  showAgendaWeekPicker: boolean;
  setShowAgendaWeekPicker: React.Dispatch<React.SetStateAction<boolean>>;
  /** Refs for click-away detection on upcoming week picker */
  upcomingWeekPickerAnchorRef: React.MutableRefObject<HTMLDivElement | null>;
  upcomingWeekPickerPanelRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Refs for click-away detection on agenda week picker */
  agendaWeekPickerAnchorRef: React.MutableRefObject<HTMLDivElement | null>;
  agendaWeekPickerPanelRef: React.MutableRefObject<HTMLDivElement | null>;
  /** Change agenda mode with persistence */
  onChangeAgendaMode: (m: AgendaMode) => void;
  /** Change upcoming mode with persistence */
  onChangeUpcomingMode: (m: UpcomingMode) => void;
  /** Apply canonical date to agenda (with persistence) */
  applyAgendaCanonical: (canonical: number) => void;
  /** Shared planner state from usePlannerState */
  focusedDateMs: number;
  setFocusedDateMs: (ms: number) => void;
  handleViewWeek: (dateMs: number) => void;
  handleViewDay: (dateMs: number) => void;
  upcoming: ReturnType<typeof usePlannerState>["upcoming"];
}

export interface EditorStateReturn {
  /** Toolbar inline event dialog visibility */
  showToolbarEventDialog: boolean;
  setShowToolbarEventDialog: React.Dispatch<React.SetStateAction<boolean>>;
  toolbarEventTitle: string;
  setToolbarEventTitle: React.Dispatch<React.SetStateAction<string>>;
  toolbarEventStart: string;
  setToolbarEventStart: React.Dispatch<React.SetStateAction<string>>;
  toolbarEventEnd: string;
  setToolbarEventEnd: React.Dispatch<React.SetStateAction<string>>;
  toolbarAllDay: boolean;
  setToolbarAllDay: React.Dispatch<React.SetStateAction<boolean>>;
  toolbarTitleRef: React.MutableRefObject<HTMLInputElement | null>;
  /** Mini editor popover (for document quick-note) */
  miniEditorAnchor: HTMLElement | null;
  setMiniEditorAnchor: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
  /** Selected event for inline editing */
  selectedEventId: Id<"events"> | null;
  setSelectedEventId: React.Dispatch<React.SetStateAction<Id<"events"> | null>>;
  /** Quick agenda text input */
  quickAgendaText: string;
  setQuickAgendaText: React.Dispatch<React.SetStateAction<string>>;
  /** Agenda editor popover state */
  agendaPopover: AgendaPopoverState;
  setAgendaPopover: React.Dispatch<React.SetStateAction<AgendaPopoverState>>;
  /** AI prompt bar text */
  prompt: string;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
  /** New task modal state */
  showNewTaskModal: boolean;
  setShowNewTaskModal: React.Dispatch<React.SetStateAction<boolean>>;
  newTaskModalTitle: string;
  setNewTaskModalTitle: React.Dispatch<React.SetStateAction<string>>;
  newTaskModalDue: string;
  setNewTaskModalDue: React.Dispatch<React.SetStateAction<string>>;
  newTaskModalPriority: string;
  setNewTaskModalPriority: React.Dispatch<React.SetStateAction<string>>;
  newTaskModalDescription: string;
  setNewTaskModalDescription: React.Dispatch<React.SetStateAction<string>>;
  isSubmittingTask: boolean;
  setIsSubmittingTask: React.Dispatch<React.SetStateAction<boolean>>;
  newTaskTitleRef: React.MutableRefObject<HTMLInputElement | null>;
  modalRef: React.MutableRefObject<HTMLDivElement | null>;
  prevFocusRef: React.MutableRefObject<HTMLElement | null>;
  /** Inline create state for floating agenda create popover */
  inlineCreate: {
    dateMs: number;
    defaultKind?: "task" | "event";
    defaultTitle?: string;
    defaultAllDay?: boolean;
  } | null;
  setInlineCreate: React.Dispatch<React.SetStateAction<{
    dateMs: number;
    defaultKind?: "task" | "event";
    defaultTitle?: string;
    defaultAllDay?: boolean;
  } | null>>;
  /** Event editor inline toggle */
  eventEditorInline: boolean;
  setEventEditorInline: React.Dispatch<React.SetStateAction<boolean>>;
  /** Submit handler for new task modal */
  handleSubmitNewTask: () => Promise<void>;
  /** Modal focus trap keydown handler */
  handleModalKeyDown: (e: React.KeyboardEvent) => void;
}

export interface ViewStateReturn {
  /** Planner mode (list | kanban | weekly) */
  mode: PlannerMode;
  setMode: React.Dispatch<React.SetStateAction<PlannerMode>>;
  /** Display density */
  density: Density;
  setDensity: React.Dispatch<React.SetStateAction<Density>>;
  /** Kanban board orientation */
  kanbanOrientation: KanbanOrientation;
  setKanbanOrientation: React.Dispatch<React.SetStateAction<KanbanOrientation>>;
  /** View options menu open state */
  viewMenuOpen: boolean;
  setViewMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  viewMenuRef: React.MutableRefObject<HTMLDivElement | null>;
  viewButtonRef: React.MutableRefObject<HTMLButtonElement | null>;
  /** Show week section in agenda */
  showWeekInAgenda: boolean;
  setShowWeekInAgenda: React.Dispatch<React.SetStateAction<boolean>>;
  /** Upcoming section list mode */
  upcomingMode: UpcomingMode;
  setUpcomingMode: React.Dispatch<React.SetStateAction<UpcomingMode>>;
  /** Change density with persistence */
  onChangeDensity: (d: Density) => void;
  /** Toggle showWeekInAgenda with persistence */
  onToggleShowWeek: () => void;
  /** View day on mini calendar (sets weekly mode) */
  handleViewDayLocal: (dateMs: number) => void;
  /** View week on mini calendar (sets weekly mode) */
  handleViewWeekLocal: (dateMs: number) => void;
}

export interface UsePlannerControllerReturn {
  dateNav: DateNavReturn;
  agendaState: AgendaStateReturn;
  editorState: EditorStateReturn;
  viewState: ViewStateReturn;
  /** Convex mutation: persist planner view preferences */
  setPlannerViewPrefs: (args: any) => Promise<any>;
  /** Convex mutation: persist planner mode */
  setPlannerModeMutation: (args: any) => Promise<any>;
  /** Convex mutation: persist upcoming view preferences */
  setUpcomingViewPrefs: (args: any) => Promise<any>;
}

// ---------------------------------------------------------------------------
// Hook Implementation
// ---------------------------------------------------------------------------

export function usePlannerController(
  params: UsePlannerControllerParams,
): UsePlannerControllerReturn {
  const { prefs, loggedInUser } = params;

  // -------------------------------------------------------------------------
  // Layer 0: Mutations (no deps on other sub-hooks)
  // -------------------------------------------------------------------------

  const mutations = usePlannerMutations();

  // -------------------------------------------------------------------------
  // Layer 0: Shared planner state (from centralized hook)
  // -------------------------------------------------------------------------

  const {
    focusedDateMs,
    setFocusedDateMs,
    handleViewWeek,
    handleViewDay,
    upcoming,
  } = usePlannerState();

  // -------------------------------------------------------------------------
  // Layer 1: Date navigation (depends on mutations + plannerState)
  // -------------------------------------------------------------------------

  const dateNav = usePlannerDateNav({
    prefs,
    loggedInUser,
    focusedDateMs,
    handleViewWeek,
    setPlannerViewPrefs: mutations.setPlannerViewPrefs,
  });

  // -------------------------------------------------------------------------
  // Layer 2: Agenda data (depends on dateNav + mutations)
  // -------------------------------------------------------------------------

  const agendaData = usePlannerAgendaData({
    loggedInUser,
    tasks: params.tasks,
    events: params.events,
    holidays: params.holidays,
    dateNav,
    focusedDateMs,
    setPlannerViewPrefs: mutations.setPlannerViewPrefs,
    setUpcomingViewPrefs: mutations.setUpcomingViewPrefs,
  });

  // -------------------------------------------------------------------------
  // Layer 2: View preferences (depends on mutations + plannerState)
  // -------------------------------------------------------------------------

  const viewPrefs = usePlannerViewPrefs({
    prefs,
    loggedInUser,
    setPlannerViewPrefs: mutations.setPlannerViewPrefs,
    setPlannerModeMutation: mutations.setPlannerModeMutation,
    handleViewDay,
    handleViewWeek,
  });

  // -------------------------------------------------------------------------
  // Layer 3: Editor (depends on mutations + viewPrefs.mode)
  // -------------------------------------------------------------------------

  const editor = usePlannerEditor({
    mode: viewPrefs.mode,
    createTask: mutations.createTask,
  });

  // -------------------------------------------------------------------------
  // Cross-hook effects: Agenda mini sync with focused date
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (agendaData.agendaMode !== "mini") return;
    if (typeof focusedDateMs !== "number" || !Number.isFinite(focusedDateMs))
      return;

    const localAnchor = focusedDateMs + dateNav.offsetMs;
    let canonical: number;

    if (dateNav.agendaScope === "week") {
      const wStartLocal = dateNav.startOfWeekMs(localAnchor);
      canonical = wStartLocal - dateNav.offsetMs;
    } else {
      const d = new Date(localAnchor);
      d.setUTCHours(0, 0, 0, 0);
      canonical = d.getTime() - dateNav.offsetMs;
    }

    if (dateNav.agendaSelectedDateMs !== canonical) {
      dateNav.applyAgendaCanonical(canonical);
    }
  }, [
    agendaData.agendaMode,
    dateNav.agendaScope,
    focusedDateMs,
    dateNav.offsetMs,
    dateNav.startOfWeekMs,
    dateNav.agendaSelectedDateMs,
    dateNav.applyAgendaCanonical,
  ]);

  // -------------------------------------------------------------------------
  // Cross-hook effects: Keyboard shortcuts for week navigation
  // -------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const isTyping =
        tag === "input" ||
        tag === "textarea" ||
        (e.target as HTMLElement | null)?.isContentEditable;

      if (isTyping) return;

      if (
        e.key === "Escape" &&
        (agendaData.showUpcomingWeekPicker || agendaData.showAgendaWeekPicker)
      ) {
        agendaData.setShowUpcomingWeekPicker(false);
        agendaData.setShowAgendaWeekPicker(false);
        return;
      }

      if (e.key === "ArrowLeft" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        dateNav.onPrevWeek();
      } else if (
        e.key === "ArrowRight" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        dateNav.onNextWeek();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dateNav.onPrevWeek, dateNav.onNextWeek, agendaData.showUpcomingWeekPicker, agendaData.showAgendaWeekPicker]);

  // -------------------------------------------------------------------------
  // Cross-hook effects: Initialize agendaMode, agendaSelectedDateMs from prefs
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!prefs) return;

    const am = prefs.agendaMode as AgendaMode | undefined;
    if (am === "list" || am === "kanban" || am === "weekly" || am === "mini")
      agendaData.setAgendaMode(am);

    const sel = prefs.agendaSelectedDateMs as number | undefined;
    if (typeof sel === "number" && Number.isFinite(sel)) {
      dateNav.setAgendaSelectedDateMs(sel);
    }
  }, [prefs]);

  // -------------------------------------------------------------------------
  // Cross-hook effects: Agenda scope persistence (local only)
  // -------------------------------------------------------------------------

  useEffect(() => {
    try {
      const s =
        typeof window !== "undefined"
          ? localStorage.getItem("nodebench:agendaScope")
          : null;
      if (s === "day" || s === "week") dateNav.setAgendaScope(s);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      if (typeof window !== "undefined")
        localStorage.setItem("nodebench:agendaScope", dateNav.agendaScope);
    } catch {}
  }, [dateNav.agendaScope]);

  // -------------------------------------------------------------------------
  // Cross-hook effects: localStorage fallback for agenda state when logged out
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (loggedInUser) return;

    try {
      const am =
        typeof window !== "undefined"
          ? localStorage.getItem("nodebench:agendaMode")
          : null;
      if (am === "list" || am === "kanban" || am === "weekly" || am === "mini")
        agendaData.setAgendaMode(am);
    } catch {}
  }, [loggedInUser]);

  // Initialize agendaSelectedDateMs from localStorage if logged out
  useEffect(() => {
    if (loggedInUser) return;

    try {
      const v =
        typeof window !== "undefined"
          ? localStorage.getItem("nodebench:agendaSelectedDateMs")
          : null;
      if (v) {
        const n = Number(v);
        if (Number.isFinite(n)) dateNav.setAgendaSelectedDateMs(n);
      }
    } catch {}
  }, [loggedInUser]);

  // -------------------------------------------------------------------------
  // Build return objects (preserving exact shape for consumers)
  // -------------------------------------------------------------------------

  const dateNavReturn: DateNavReturn = useMemo(
    () => ({
      weekRangeLabel: dateNav.weekRangeLabel,
      agendaDayLabel: dateNav.agendaDayLabel,
      agendaRangeLabel: dateNav.agendaRangeLabel,
      agendaWeekLabel: dateNav.agendaWeekLabel,
      onPrevWeek: dateNav.onPrevWeek,
      onNextWeek: dateNav.onNextWeek,
      onTodayWeek: dateNav.onTodayWeek,
      onPrevAgenda: dateNav.onPrevAgenda,
      onNextAgenda: dateNav.onNextAgenda,
      onSetAgendaScope: dateNav.onSetAgendaScope,
      onPrevAgendaWeek: dateNav.onPrevAgendaWeek,
      onNextAgendaWeek: dateNav.onNextAgendaWeek,
      onAgendaToday: dateNav.onAgendaToday,
      onPrevAgendaDay: dateNav.onPrevAgendaDay,
      onNextAgendaDay: dateNav.onNextAgendaDay,
      startOfWeekMs: dateNav.startOfWeekMs,
      formatWeekRange: dateNav.formatWeekRange,
    }),
    [
      dateNav.weekRangeLabel,
      dateNav.agendaDayLabel,
      dateNav.agendaRangeLabel,
      dateNav.agendaWeekLabel,
      dateNav.onPrevWeek,
      dateNav.onNextWeek,
      dateNav.onTodayWeek,
      dateNav.onPrevAgenda,
      dateNav.onNextAgenda,
      dateNav.onSetAgendaScope,
      dateNav.onPrevAgendaWeek,
      dateNav.onNextAgendaWeek,
      dateNav.onAgendaToday,
      dateNav.onPrevAgendaDay,
      dateNav.onNextAgendaDay,
      dateNav.startOfWeekMs,
      dateNav.formatWeekRange,
    ],
  );

  const agendaState: AgendaStateReturn = useMemo(
    () => ({
      agendaMode: agendaData.agendaMode,
      setAgendaMode: agendaData.setAgendaMode,
      lastNonWeeklyAgendaMode: agendaData.lastNonWeeklyAgendaMode,
      setLastNonWeeklyAgendaMode: agendaData.setLastNonWeeklyAgendaMode,
      agendaScope: dateNav.agendaScope,
      setAgendaScope: dateNav.setAgendaScope,
      agendaSelectedDateMs: dateNav.agendaSelectedDateMs,
      setAgendaSelectedDateMs: dateNav.setAgendaSelectedDateMs,
      agendaStartUtc: dateNav.agendaStartUtc,
      agendaEndUtc: dateNav.agendaEndUtc,
      tzOffsetMinutes: dateNav.tzOffsetMinutes,
      offsetMs: dateNav.offsetMs,
      todayStartUtc: dateNav.todayStartUtc,
      weekStartUtc: dateNav.weekStartUtc,
      weekEndUtc: dateNav.weekEndUtc,
      agendaWeekTasks: agendaData.agendaWeekTasks,
      agendaWeekEvents: agendaData.agendaWeekEvents,
      agendaWeekHolidays: agendaData.agendaWeekHolidays,
      agendaWeekNotes: agendaData.agendaWeekNotes,
      weekEventsMerged: agendaData.weekEventsMerged,
      weekTasksMerged: agendaData.weekTasksMerged,
      weekHolidaysMerged: agendaData.weekHolidaysMerged,
      showUpcomingWeekPicker: agendaData.showUpcomingWeekPicker,
      setShowUpcomingWeekPicker: agendaData.setShowUpcomingWeekPicker,
      showAgendaWeekPicker: agendaData.showAgendaWeekPicker,
      setShowAgendaWeekPicker: agendaData.setShowAgendaWeekPicker,
      upcomingWeekPickerAnchorRef: agendaData.upcomingWeekPickerAnchorRef,
      upcomingWeekPickerPanelRef: agendaData.upcomingWeekPickerPanelRef,
      agendaWeekPickerAnchorRef: agendaData.agendaWeekPickerAnchorRef,
      agendaWeekPickerPanelRef: agendaData.agendaWeekPickerPanelRef,
      onChangeAgendaMode: agendaData.onChangeAgendaMode,
      onChangeUpcomingMode: agendaData.onChangeUpcomingMode,
      applyAgendaCanonical: dateNav.applyAgendaCanonical,
      focusedDateMs,
      setFocusedDateMs,
      handleViewWeek,
      handleViewDay,
      upcoming,
    }),
    [
      agendaData.agendaMode,
      agendaData.lastNonWeeklyAgendaMode,
      dateNav.agendaScope,
      dateNav.agendaSelectedDateMs,
      dateNav.agendaStartUtc,
      dateNav.agendaEndUtc,
      dateNav.tzOffsetMinutes,
      dateNav.offsetMs,
      dateNav.todayStartUtc,
      dateNav.weekStartUtc,
      dateNav.weekEndUtc,
      agendaData.agendaWeekTasks,
      agendaData.agendaWeekEvents,
      agendaData.agendaWeekHolidays,
      agendaData.agendaWeekNotes,
      agendaData.weekEventsMerged,
      agendaData.weekTasksMerged,
      agendaData.weekHolidaysMerged,
      agendaData.showUpcomingWeekPicker,
      agendaData.showAgendaWeekPicker,
      agendaData.onChangeAgendaMode,
      agendaData.onChangeUpcomingMode,
      dateNav.applyAgendaCanonical,
      focusedDateMs,
      setFocusedDateMs,
      handleViewWeek,
      handleViewDay,
      upcoming,
    ],
  );

  const editorState: EditorStateReturn = useMemo(
    () => ({
      showToolbarEventDialog: editor.showToolbarEventDialog,
      setShowToolbarEventDialog: editor.setShowToolbarEventDialog,
      toolbarEventTitle: editor.toolbarEventTitle,
      setToolbarEventTitle: editor.setToolbarEventTitle,
      toolbarEventStart: editor.toolbarEventStart,
      setToolbarEventStart: editor.setToolbarEventStart,
      toolbarEventEnd: editor.toolbarEventEnd,
      setToolbarEventEnd: editor.setToolbarEventEnd,
      toolbarAllDay: editor.toolbarAllDay,
      setToolbarAllDay: editor.setToolbarAllDay,
      toolbarTitleRef: editor.toolbarTitleRef,
      miniEditorAnchor: editor.miniEditorAnchor,
      setMiniEditorAnchor: editor.setMiniEditorAnchor,
      selectedEventId: editor.selectedEventId,
      setSelectedEventId: editor.setSelectedEventId,
      quickAgendaText: editor.quickAgendaText,
      setQuickAgendaText: editor.setQuickAgendaText,
      agendaPopover: editor.agendaPopover,
      setAgendaPopover: editor.setAgendaPopover,
      prompt: editor.prompt,
      setPrompt: editor.setPrompt,
      showNewTaskModal: editor.showNewTaskModal,
      setShowNewTaskModal: editor.setShowNewTaskModal,
      newTaskModalTitle: editor.newTaskModalTitle,
      setNewTaskModalTitle: editor.setNewTaskModalTitle,
      newTaskModalDue: editor.newTaskModalDue,
      setNewTaskModalDue: editor.setNewTaskModalDue,
      newTaskModalPriority: editor.newTaskModalPriority,
      setNewTaskModalPriority: editor.setNewTaskModalPriority,
      newTaskModalDescription: editor.newTaskModalDescription,
      setNewTaskModalDescription: editor.setNewTaskModalDescription,
      isSubmittingTask: editor.isSubmittingTask,
      setIsSubmittingTask: editor.setIsSubmittingTask,
      newTaskTitleRef: editor.newTaskTitleRef,
      modalRef: editor.modalRef,
      prevFocusRef: editor.prevFocusRef,
      inlineCreate: editor.inlineCreate,
      setInlineCreate: editor.setInlineCreate,
      eventEditorInline: editor.eventEditorInline,
      setEventEditorInline: editor.setEventEditorInline,
      handleSubmitNewTask: editor.handleSubmitNewTask,
      handleModalKeyDown: editor.handleModalKeyDown,
    }),
    [
      editor.showToolbarEventDialog,
      editor.toolbarEventTitle,
      editor.toolbarEventStart,
      editor.toolbarEventEnd,
      editor.toolbarAllDay,
      editor.miniEditorAnchor,
      editor.selectedEventId,
      editor.quickAgendaText,
      editor.agendaPopover,
      editor.prompt,
      editor.showNewTaskModal,
      editor.newTaskModalTitle,
      editor.newTaskModalDue,
      editor.newTaskModalPriority,
      editor.newTaskModalDescription,
      editor.isSubmittingTask,
      editor.inlineCreate,
      editor.eventEditorInline,
      editor.handleSubmitNewTask,
      editor.handleModalKeyDown,
    ],
  );

  const viewState: ViewStateReturn = useMemo(
    () => ({
      mode: viewPrefs.mode,
      setMode: viewPrefs.setMode,
      density: viewPrefs.density,
      setDensity: viewPrefs.setDensity,
      kanbanOrientation: viewPrefs.kanbanOrientation,
      setKanbanOrientation: viewPrefs.setKanbanOrientation,
      viewMenuOpen: viewPrefs.viewMenuOpen,
      setViewMenuOpen: viewPrefs.setViewMenuOpen,
      viewMenuRef: viewPrefs.viewMenuRef,
      viewButtonRef: viewPrefs.viewButtonRef,
      showWeekInAgenda: viewPrefs.showWeekInAgenda,
      setShowWeekInAgenda: viewPrefs.setShowWeekInAgenda,
      upcomingMode: viewPrefs.upcomingMode,
      setUpcomingMode: viewPrefs.setUpcomingMode,
      onChangeDensity: viewPrefs.onChangeDensity,
      onToggleShowWeek: viewPrefs.onToggleShowWeek,
      handleViewDayLocal: viewPrefs.handleViewDayLocal,
      handleViewWeekLocal: viewPrefs.handleViewWeekLocal,
    }),
    [
      viewPrefs.mode,
      viewPrefs.density,
      viewPrefs.kanbanOrientation,
      viewPrefs.viewMenuOpen,
      viewPrefs.showWeekInAgenda,
      viewPrefs.upcomingMode,
      viewPrefs.onChangeDensity,
      viewPrefs.onToggleShowWeek,
      viewPrefs.handleViewDayLocal,
      viewPrefs.handleViewWeekLocal,
    ],
  );

  return {
    dateNav: dateNavReturn,
    agendaState,
    editorState,
    viewState,
    setPlannerViewPrefs: mutations.setPlannerViewPrefs,
    setPlannerModeMutation: mutations.setPlannerModeMutation,
    setUpcomingViewPrefs: mutations.setUpcomingViewPrefs,
  };
}
