import { lazy, Suspense, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Id } from "@convex/_generated/dataModel";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { ViewSkeleton } from "@/components/skeletons";
import { AgentScreen } from "@/shared/agent-ui/AgentScreen";
import {
  ExactChatSurface,
  ExactHomeSurface,
  ExactInboxSurface,
  ExactMeSurface,
  ExactReportsSurface,
} from "@/features/designKit/exact/ExactKit";
// EXACT KIT PARITY: cockpit routes through the kit's pixel-perfect surfaces.
// Each Exact*Surface in src/features/designKit/exact/ExactKit.tsx is being
// wired to real Convex queries one surface at a time so users see the kit's
// exact visual chrome with their own honest data instead of static fixtures.
//
// Wiring status:
//   - history (Inbox)   → ExactInboxSurface  ✅ wired (this commit)
//   - packets (Reports) → ExactReportsSurface ⏳ next
//   - connect (Me)      → ExactMeSurface      ⏳
//   - ask (Home)        → ExactHomeSurface    ⏳
//   - workspace (Chat)  → ExactChatSurface    ⏳
//
// HomeLanding may still be reachable via deep-link routes; keep it.
// ChatHome / ReportsHome / MeHome are PHANTOM — viewRegistry.ts now
// sets `component: null` for chat-home / reports-home / me-home (all
// custom-rendered in this file's switch below). Their lazy imports
// were dead but kept getting "phantom maintenance" edits because
// devs grep'd by name and assumed they were canonical. Removed in
// the stabilization cleanup sprint. If a deep-link route needs to
// resurrect them, route through VIEW_MAP[viewId].component (which
// is null today by design).
const HomeLanding = lazy(() =>
  import("@/features/home/views/HomeLanding").then((mod) => ({ default: mod.HomeLanding })),
);
import {
  getDefaultViewForSurface,
  type CockpitSurfaceId,
  type MainView,
  type ResearchTab,
  SURFACE_DEFAULT_VIEW,
  SURFACE_TITLES,
  VIEW_MAP,
} from "@/lib/registry/viewRegistry";

/* ── Lazy imports: 5 product surfaces + EntityPage + NotFound ─────── */
const NotFoundPage = lazy(() =>
  import("@/features/controlPlane/views/NotFoundPage").then((mod) => ({ default: mod.NotFoundPage })),
);

const SURFACE_SKELETON_VARIANT: Record<CockpitSurfaceId, "default" | "ask"> = {
  ask: "ask",
  workspace: "default",
  packets: "default",
  history: "default",
  connect: "default",
  trace: "default",
};

const MAX_CACHED_SURFACES = 4;
const DIRECT_ROUTE_COMPONENT_EXCLUSIONS = new Set<MainView>([
  "control-plane",
]);

interface ActiveSurfaceHostProps {
  currentSurface: CockpitSurfaceId;
  currentView: MainView;
  panel?: string | null;
  entityName: string | null;
  selectedSpreadsheetId: Id<"spreadsheets"> | null;
  setSelectedSpreadsheetId: (id: Id<"spreadsheets"> | null) => void;
  selectedDocumentId: Id<"documents"> | null;
  onDocumentSelect: (id: Id<"documents"> | null) => void;
  isGridMode: boolean;
  setIsGridMode: React.Dispatch<React.SetStateAction<boolean>>;
  selectedTaskId: Id<"userEvents"> | null;
  selectedTaskSource: "today" | "upcoming" | "week" | "other" | null;
  onSelectTask: (id: Id<"userEvents">, source: "today" | "upcoming" | "week" | "other") => void;
  onClearTaskSelection: () => void;
  researchHubInitialTab: ResearchTab;
  setResearchHubInitialTab: (tab: ResearchTab) => void;
  activeSources: string[];
  setActiveSources: React.Dispatch<React.SetStateAction<string[]>>;
  setCurrentView: (view: MainView) => void;
  setEntityName: (name: string | null) => void;
  onNavigateToView: (view: MainView) => void;
  onOpenFastAgent: () => void;
  onOpenFastAgentWithPrompt?: (prompt: string) => void;
  isUnknownRoute?: boolean;
}

function deriveMounted(prev: CockpitSurfaceId[], active: CockpitSurfaceId) {
  const next = prev.filter((id) => id !== active);
  next.push(active);
  return next.slice(-MAX_CACHED_SURFACES);
}

function SurfaceFrame({
  surfaceId,
  active,
  entityName,
  children,
}: {
  surfaceId: CockpitSurfaceId;
  active: boolean;
  entityName: string | null;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const title = SURFACE_TITLES[surfaceId] ?? surfaceId;

  return (
    <AgentScreen
      className={active ? "h-full overflow-auto" : "hidden"}
      screenId={`surface:${surfaceId}`}
      screenTitle={title}
      screenPath={location.pathname + location.search}
      routeView={`surface:${surfaceId}`}
      data-surface-id={surfaceId}
      data-surface-mode={surfaceId}
      data-surface-entity={entityName ?? ""}
      data-surface-status={active ? "active" : "cached"}
      data-active-scope-id={active ? `${surfaceId}:active` : `${surfaceId}:cached`}
    >
      {children}
    </AgentScreen>
  );
}

export function ActiveSurfaceHost(props: ActiveSurfaceHostProps) {
  const {
    currentSurface,
    currentView,
    entityName,
    isUnknownRoute,
  } = props;
  const mountedRef = useRef<CockpitSurfaceId[]>([currentSurface]);
  mountedRef.current = deriveMounted(mountedRef.current, currentSurface);

  const renderSurface = (surfaceId: CockpitSurfaceId) => {
    const defaultView = getDefaultViewForSurface(surfaceId);
    const directRouteComponent =
      surfaceId === currentSurface &&
      currentView !== defaultView &&
      !DIRECT_ROUTE_COMPONENT_EXCLUSIONS.has(currentView)
        ? VIEW_MAP[currentView]?.component
        : null;

    if (directRouteComponent) {
      const DirectRouteComponent = directRouteComponent;
      return <DirectRouteComponent />;
    }

    switch (surfaceId) {
      case "ask":
        if (isUnknownRoute) {
          return <NotFoundPage />;
        }
        return <ExactHomeSurface />;
      case "workspace":
        return <ExactChatSurface />;
      case "packets":
        return <ExactReportsSurface />;
      case "history":
        return <ExactInboxSurface />;
      case "connect":
        return <ExactMeSurface />;
      case "trace": {
        // QA fix (2026-05-08): /mcp/ledger landed on NotFoundPage because
        // the trace surface had no real renderer. The view registry maps
        // /mcp/ledger → "mcp-ledger" view → McpLedgerPage component, but
        // ActiveSurfaceHost's switch hardcoded NotFoundPage for "trace".
        // Resolve via SURFACE_DEFAULT_VIEW so the same fix covers
        // any future trace-surface views (audit, activity, receipts).
        const TraceComponent = VIEW_MAP[SURFACE_DEFAULT_VIEW.trace]?.component;
        return TraceComponent ? <TraceComponent /> : <NotFoundPage />;
      }
      default:
        return <ExactHomeSurface />;
    }
  };

  return (
    <div className="relative h-full min-w-0 flex-1 overflow-hidden">
      {mountedRef.current.map((surfaceId) => (
        <SurfaceFrame
          key={surfaceId}
          surfaceId={surfaceId}
          active={surfaceId === currentSurface}
          entityName={entityName}
        >
          <ErrorBoundary title={`${SURFACE_TITLES[surfaceId]} failed to load`}>
            <Suspense fallback={<ViewSkeleton variant={SURFACE_SKELETON_VARIANT[surfaceId] ?? "default"} />}>{renderSurface(surfaceId)}</Suspense>
          </ErrorBoundary>
        </SurfaceFrame>
      ))}
    </div>
  );
}

export default ActiveSurfaceHost;
