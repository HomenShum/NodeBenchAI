/**
 * DocumentsPlannerSurface
 *
 * Lazy-loadable component that owns ALL planner runtime. Imports
 * usePlannerState and usePlannerController, wraps children in
 * DocumentsPlannerProvider, and renders the sidebar + planner overlays.
 *
 * This is loaded via React.lazy() so the planner bundle is code-split
 * away from the main documents surface.
 */

import { lazy, Suspense, useMemo } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { usePlannerState } from "@/hooks/usePlannerState";
import { usePlannerController } from "../hooks/usePlannerController";
import { DocumentsPlannerProvider } from "../context/DocumentsPlannerProvider";

const LazyDocumentSidebarPanel = lazy(() =>
  import("./DocumentSidebarPanel").then((m) => ({
    default: m.DocumentSidebarPanel,
  })),
);
const LazyDocumentsPlannerOverlays = lazy(
  () => import("./DocumentsPlannerOverlays"),
);

export interface DocumentsPlannerSurfaceProps {
  prefs: any;
  loggedInUser: unknown;
  selectedTaskId?: Id<"userEvents"> | null;
  onSelectTask?: (
    id: Id<"userEvents">,
    source: "today" | "upcoming" | "week" | "other",
  ) => void;
  onClearTaskSelection?: () => void;
  hideCalendarCard?: boolean;
  miniEditorRequest: {
    docId: Id<"documents">;
    anchorEl: HTMLElement;
  } | null;
  onClearMiniEditorRequest: () => void;
  onDocumentSelect: (docId: Id<"documents">) => void;
}

export default function DocumentsPlannerSurface({
  prefs,
  loggedInUser,
  selectedTaskId,
  onSelectTask,
  onClearTaskSelection,
  hideCalendarCard,
  miniEditorRequest,
  onClearMiniEditorRequest,
  onDocumentSelect,
}: DocumentsPlannerSurfaceProps) {
  const { upcoming } = usePlannerState();

  const planner = usePlannerController({
    prefs,
    loggedInUser,
    tasks: {
      today: upcoming.today.tasks,
      thisWeek: upcoming.sevenDays.tasks,
    },
    events: {
      today: upcoming.today.events,
      thisWeek: upcoming.sevenDays.events,
    },
    holidays: {
      today: upcoming.today.holidays,
      thisWeek: upcoming.sevenDays.holidays,
    },
    selectedTaskId,
    onSelectTask,
    onClearTaskSelection,
  });

  const { agendaState, editorState, viewState } = planner;

  // ── Mini editor bridge ────────────────────────────────────────────────────
  // Sync the request bridge from the hub into the planner editor state.
  // When miniEditorRequest is set, push the anchor into editorState so
  // DocumentsPlannerOverlays can render the popover.
  const miniEditorDocId = miniEditorRequest?.docId ?? null;

  // Keep the editor anchor in sync with the request bridge
  useMemo(() => {
    if (miniEditorRequest) {
      editorState.setMiniEditorAnchor(miniEditorRequest.anchorEl);
    } else {
      editorState.setMiniEditorAnchor(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [miniEditorRequest]);

  const closeMiniEditor = useMemo(
    () => () => {
      onClearMiniEditorRequest();
      editorState.setMiniEditorAnchor(null);
    },
    [onClearMiniEditorRequest, editorState],
  );

  // ── Sidebar props ─────────────────────────────────────────────────────────
  const handleSelectDocument = useMemo(
    () => (docId: string) => onDocumentSelect(docId as Id<"documents">),
    [onDocumentSelect],
  );

  return (
    <DocumentsPlannerProvider
      prefs={prefs}
      loggedInUser={loggedInUser}
      selectedTaskId={selectedTaskId}
      onSelectTask={onSelectTask}
      onClearTaskSelection={onClearTaskSelection}
    >
      {/* Sidebar column */}
      <Suspense fallback={null}>
        <LazyDocumentSidebarPanel
          hideCalendarCard={hideCalendarCard ?? false}
          upcoming={agendaState.upcoming}
          anchorDateMs={agendaState.focusedDateMs ?? agendaState.agendaStartUtc}
          onViewWeek={viewState.handleViewWeekLocal}
          onViewDay={viewState.handleViewDayLocal}
          onOpenDocument={handleSelectDocument}
        />
      </Suspense>

      {/* Planner overlays (modals, popovers, cinema viewer) */}
      <Suspense fallback={null}>
        <LazyDocumentsPlannerOverlays
          loggedInUser={loggedInUser}
          selectedTaskId={selectedTaskId}
          onClearTaskSelection={onClearTaskSelection}
          hideCalendarCard={hideCalendarCard}
          miniEditorDocId={miniEditorDocId}
          closeMiniEditor={closeMiniEditor}
        />
      </Suspense>
    </DocumentsPlannerProvider>
  );
}
