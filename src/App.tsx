import { Authenticated, Unauthenticated, useConvexAuth } from "convex/react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { CockpitLayout } from "./layouts/CockpitLayout";
import { TutorialPage } from "@/features/onboarding/views/TutorialPage";
import { useState, useEffect, useCallback, lazy, Suspense, useRef } from "react";
import { Id } from "../convex/_generated/dataModel";
import { ContextPillsProvider } from "./hooks/contextPills";
import { FastAgentProvider, useFastAgent } from "@/features/agents/context/FastAgentContext";
import { SelectionProvider } from "@/features/agents/context/SelectionContext";
import { FeedbackListener } from "@/shared/hooks/FeedbackListener";
import { ThemeProvider } from "./contexts/ThemeContext";
import { OracleSessionProvider } from "./contexts/OracleSessionContext";
import { SkipLinks } from "./shared/components/SkipLinks";
import { EvidenceProvider } from "@/features/research/contexts/EvidenceContext";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { ViewSkeleton } from "@/components/skeletons/ViewSkeleton";
import { useWebMcpProvider } from "./hooks/useWebMcpProvider";
import { getReportWorkspaceRouteFromPath } from "@/features/reports/lib/reportNotebookRouting";
import type { MainView } from "@/lib/registry/viewRegistry";
import { buildCockpitPathForView } from "@/lib/registry/viewRegistry";
import { initErrorReporting } from "@/lib/errorReporting";
import { FinancialOperatorOverlay } from "@/features/financialOperator/components/FinancialOperatorOverlay";
import { WorkspaceModeToggle } from "@/features/financialOperator/components/WorkspaceModeToggle";
import { WorkspaceModePane } from "@/features/financialOperator/components/WorkspaceModePane";

const RedesignShell = lazy(() => import("@/features/redesign/RedesignShell"));
const EditionPrintPage = lazy(() =>
  import("@/features/redesign/pages/EditionPrintPage").then((m) => ({
    default: m.EditionPrintPage,
  })),
);
const ShareableMemoView = lazy(() => import("@/features/founder/views/ShareableMemoView"));
const PublicEntityShareView = lazy(() => import("@/features/share/views/PublicEntityShareView"));
const PublicCompanyProfileView = lazy(() => import("@/features/founder/views/PublicCompanyProfileView"));
const PublicReportView = lazy(() => import("@/features/reports/views/PublicReportView"));
const ReportNotebookDetail = lazy(() =>
  import("@/features/reports/views/ReportNotebookDetail").then((m) => ({
    default: m.ReportNotebookDetail,
  })),
);
const ReportDetailPage = lazy(() =>
  import("@/features/research/views/ReportDetailPage").then((m) => ({
    default: m.ReportDetailPage,
  })),
);
const UniversalWorkspacePage = lazy(() =>
  import("@/features/workspace/views/UniversalWorkspacePage").then((m) => ({
    default: m.UniversalWorkspacePage,
  })),
);
const EmbedView = lazy(() => import("@/features/founder/views/EmbedView"));
const FounderRouteResolver = lazy(() => import("@/features/founder/views/FounderRouteResolver"));
// My Wiki — Phase 1 routes. See docs/architecture/ME_AGENT_DESIGN.md
const WikiLandingRoute = lazy(() => import("@/features/me/components/wiki/WikiLandingRoute"));
const WikiPageDetailRoute = lazy(() => import("@/features/me/components/wiki/WikiPageDetailRoute"));

const FastAgentPanel = lazy(() =>
  import("@/features/agents/components/FastAgentPanel/FastAgentPanel").then((mod) => ({
    default: mod.FastAgentPanel,
  })),
);

/**
 * GlobalFastAgentPanel - Renders FastAgentPanel connected to FastAgentContext.
 *
 * The cockpit shell owns the in-layout agent panel, so this global overlay only
 * appears when no external handler is registered.
 */
function GlobalFastAgentPanel() {
  const { isOpen, close, options, clearOptions, hasExternalHandler } = useFastAgent();

  // Skip when the active shell is handling the panel directly.
  if (hasExternalHandler) return null;

  const handleClose = () => {
    close();
    clearOptions();
  };

  return (
    <Suspense fallback={isOpen ? <div className="fixed inset-y-0 right-0 w-96 bg-background border-l border-border/60 flex items-center justify-center text-sm text-muted-foreground">Loading assistant...</div> : null}>
      <FastAgentPanel
        isOpen={isOpen}
        onClose={handleClose}
        variant="overlay"
        openOptions={options}
        onOptionsConsumed={clearOptions}
      />
    </Suspense>
  );
}

function App() {
  const location = useLocation();
  const [showTutorial, setShowTutorial] = useState(false);

  // Initialize global error tracking once on mount
  const errorInitRef = useRef(false);
  useEffect(() => {
    if (!errorInitRef.current) {
      errorInitRef.current = true;
      initErrorReporting();
    }
  }, []);
  const [selectedDocumentId, setSelectedDocumentId] = useState<Id<"documents"> | null>(null);

  // WebMCP provider — expose NodeBench tools to browser agents via navigator.modelContext
  const [webmcpEnabled] = useState(() => localStorage.getItem("nodebench_webmcp_provider_enabled") === "true");
  const { isAuthenticated: webmcpIsAuth } = useConvexAuth();
  const nav = useNavigate();
  const handleWebMcpNavigate = useCallback((view: MainView) => {
    nav(buildCockpitPathForView({ view }));
  }, [nav]);
  useWebMcpProvider({
    enabled: webmcpEnabled,
    currentPath: location.pathname,
    isAuthenticated: webmcpIsAuth,
    onNavigate: handleWebMcpNavigate,
  });

  // Deep link: ?doc=ID auto-opens a shared document
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const docId = params.get('doc');
    if (docId) {
      setSelectedDocumentId(docId as Id<"documents">);
      setShowTutorial(false);
    }
  }, [location.search]);

  // Any navigation away from /onboarding dismisses the tutorial
  useEffect(() => {
    if (location.pathname.toLowerCase().startsWith("/onboarding")) {
      setShowTutorial(true);
    } else {
      setShowTutorial(false);
    }
  }, [location.pathname]);

  const handleGetStarted = () => {
    setShowTutorial(false);
  };

  const handleDocumentSelect = (documentId: string) => {
    setSelectedDocumentId(documentId as Id<"documents">);
    setShowTutorial(false);
  };

  const workspaceHostname =
    typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
  const isWorkspaceHost =
    workspaceHostname === "nodebench.workspace" ||
    workspaceHostname === "workspace.nodebenchai.com" ||
    workspaceHostname === "nodebench-workspace.vercel.app";
  const isStandaloneWorkspaceRoute =
    location.pathname === "/workspace" ||
    location.pathname.startsWith("/workspace/") ||
    (isWorkspaceHost &&
      (location.pathname === "/" ||
        location.pathname.startsWith("/w/") ||
        location.pathname.startsWith("/share/")));
  if (isStandaloneWorkspaceRoute) {
    return (
      <ThemeProvider>
        <ErrorBoundary title="Workspace failed to load">
          <Suspense fallback={<ViewSkeleton />}>
            <div key="workspace" className="route-fade-in h-screen">
              <UniversalWorkspacePage />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  const rootParams = new URLSearchParams(location.search);
  const rootSurface = rootParams.get("surface");
  // QA fix (2026-05-08): the / → /redesign redirect (PR #260) broke mobile
  // because mobile clients lost the legacy MobileHomeSurface — which the
  // audit (NODEBENCH_DESIGN_PRINCIPLES_AUDIT.md) explicitly called out as
  // the closest existing thing to the Daily Intelligence Pulse vision.
  // Detect mobile via UA + viewport so mobile / continues to render
  // HomeLanding → MobileHomeSurface, restoring the smoke contract
  // (live-smoke-mobile.spec.ts:35,273) without losing the redesign route
  // for desktop users who actively prefer it.
  const isMobileViewport = typeof window !== "undefined" && (
    window.matchMedia?.("(max-width: 767px)").matches ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent)
  );
  const shouldUseRedesignLanding =
    location.pathname === "/" &&
    !isMobileViewport &&
    (rootSurface === null || rootSurface === "home") &&
    !rootParams.has("doc") &&
    !rootParams.has("session") &&
    !rootParams.has("reportId");
  if (shouldUseRedesignLanding) {
    rootParams.delete("surface");
    const nextSearch = rootParams.toString();
    return <Navigate to={`/redesign${nextSearch ? `?${nextSearch}` : ""}`} replace />;
  }

  // Phase 7c — print-friendly edition route at /redesign/edition/print.
  // MUST be checked before the general /redesign/* match below so the
  // page renders without the surrounding shell chrome (no rail, no
  // toast viewport, no body-overflow lock).
  const isEditionPrintRoute = location.pathname === "/redesign/edition/print";
  if (isEditionPrintRoute) {
    return (
      <ThemeProvider>
        <ErrorBoundary title="Something went wrong">
          <Suspense fallback={<ViewSkeleton />}>
            <div key="edition-print" className="route-fade-in">
              <EditionPrintPage />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Standalone route: /redesign* showcases the parity-studio + open-design redesign.
  // Mounts a self-contained shell with its own tokens — does not touch the main cockpit.
  const isRedesignRoute = location.pathname === "/redesign" || location.pathname.startsWith("/redesign/");
  if (isRedesignRoute) {
    return (
      <ThemeProvider>
        <ErrorBoundary title="Something went wrong">
          <Suspense fallback={<ViewSkeleton />}>
            <div key="redesign" className="route-fade-in">
              <RedesignShell />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Standalone route: /memo/:id renders without cockpit chrome or auth wrapper
  const isMemoRoute = location.pathname.startsWith("/memo/");
  if (isMemoRoute) {
    return (
      <ThemeProvider>
        <ErrorBoundary title="Something went wrong">
          <Suspense fallback={<ViewSkeleton />}>
            <div key="memo" className="route-fade-in">
              <ShareableMemoView />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Standalone route: /share/{token} renders anonymous read-only diligence
  // brief. Token IS the auth credential — no sign-in required.
  const isShareRoute = location.pathname.startsWith("/share/");
  if (isShareRoute) {
    return (
      <ThemeProvider>
        <ErrorBoundary title="Something went wrong">
          <Suspense fallback={<ViewSkeleton />}>
            <div key="share" className="route-fade-in">
              <PublicEntityShareView />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Standalone route: /company/:slug renders public company intelligence profile
  const isCompanyRoute = location.pathname.startsWith("/company/");
  if (isCompanyRoute) {
    return (
      <ThemeProvider>
        <ErrorBoundary title="Something went wrong">
          <Suspense fallback={<ViewSkeleton />}>
            <div key="company" className="route-fade-in">
              <PublicCompanyProfileView />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Standalone route: /reports/:reportId/graph renders the canonical
  // entity graph workspace. Must match BEFORE the /report/ startsWith
  // check below (which would also match /reports/).
  const graphRouteMatch = location.pathname.match(
    /^\/reports\/([^/]+)\/graph\/?$/,
  );
  if (graphRouteMatch) {
    return (
      <ThemeProvider>
        <ErrorBoundary title="Something went wrong">
          <Suspense fallback={<ViewSkeleton />}>
            <div
              key={`report-graph-${graphRouteMatch[1]}`}
              className="route-fade-in h-screen"
            >
              <ReportDetailPage />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // without any cockpit shell — the workspace owns its own header.
  // Lightweight web report notebook. This stays on nodebenchai.com for quick
  // memo cleanup while full recursive work remains in Workspace.
  const reportNotebookRouteMatch = location.pathname.match(
    /^\/reports\/([^/]+)\/notebook\/?$/,
  );
  if (reportNotebookRouteMatch) {
    return (
      <ThemeProvider>
        <ErrorBoundary title="Something went wrong">
          <Suspense fallback={<ViewSkeleton />}>
            <div
              key={`report-notebook-${reportNotebookRouteMatch[1]}`}
              className="route-fade-in"
            >
              <ReportNotebookDetail />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  const reportWorkspaceRouteMatch = getReportWorkspaceRouteFromPath(
    location.pathname,
  );
  if (reportWorkspaceRouteMatch) {
    return (
      <ThemeProvider>
        <ErrorBoundary title="Something went wrong">
          <Suspense fallback={<ViewSkeleton />}>
            <div
              key={`report-workspace-${reportWorkspaceRouteMatch.reportId}-${reportWorkspaceRouteMatch.tab}`}
              className="route-fade-in h-screen"
            >
              <ReportDetailPage />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  const isReportRoute = location.pathname.startsWith("/report/");
  if (isReportRoute) {
    if (webmcpIsAuth) {
      const reportId = location.pathname.split("/report/")[1]?.split("/")[0] ?? "";
      const nextParams = new URLSearchParams(location.search);
      nextParams.set("surface", "reports");
      if (reportId) nextParams.set("reportId", decodeURIComponent(reportId));
      return <Navigate to={`/?${nextParams.toString()}`} replace />;
    }
    return (
      <ThemeProvider>
        <ErrorBoundary title="Something went wrong">
          <Suspense fallback={<ViewSkeleton />}>
            <div key="report" className="route-fade-in">
              <PublicReportView />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Standalone route: /embed/:type/:id renders minimal iframe-friendly widget
  const isEmbedRoute = location.pathname.startsWith("/embed/");
  if (isEmbedRoute) {
    return (
      <ThemeProvider>
        <ErrorBoundary title="Something went wrong">
          <Suspense fallback={<ViewSkeleton />}>
            <div key="embed" className="route-fade-in">
              <EmbedView />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // My Wiki — personal synthesis layer under /me/wiki.
  // Detail: /me/wiki/:pageType/:slug  (handled first, more specific)
  // Landing: /me/wiki  (list view)
  // See: docs/architecture/ME_PAGE_WIKI_SPEC.md + ME_AGENT_DESIGN.md
  const wikiDetailMatch = location.pathname.match(
    /^\/me\/wiki\/(topic|company|person|product|event|location|job|contradiction)\/([^/]+)\/?$/,
  );
  if (wikiDetailMatch) {
    return (
      <ThemeProvider>
        <ErrorBoundary title="Something went wrong">
          <Suspense fallback={<ViewSkeleton />}>
            <div key="wiki-detail" className="route-fade-in">
              <WikiPageDetailRoute />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }
  const isWikiLandingRoute =
    location.pathname === "/me/wiki" || location.pathname === "/me/wiki/";
  if (isWikiLandingRoute) {
    return (
      <ThemeProvider>
        <ErrorBoundary title="Something went wrong">
          <Suspense fallback={<ViewSkeleton />}>
            <div key="wiki-landing" className="route-fade-in">
              <WikiLandingRoute />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Smart /founder route — promised in agent-setup.txt + pitch copy.
  // Resolves to a useful destination based on session state.
  // See: src/features/founder/views/FounderRouteResolver.tsx
  //      docs/architecture/FOUNDER_FEATURE.md
  const isFounderRoute =
    location.pathname === "/founder" || location.pathname.startsWith("/founder/");
  if (isFounderRoute) {
    return (
      <ThemeProvider>
        <ErrorBoundary title="Something went wrong">
          <Suspense fallback={<ViewSkeleton />}>
            <div key="founder" className="route-fade-in">
              <FounderRouteResolver />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <EvidenceProvider>
        <SkipLinks />
        <main
          id="main-content"
          className="h-screen bg-surface text-content"
          data-app-id="nodebench-ai"
          data-app-shell="main"
          data-agent-surface="app"
          data-mcp-compat="webmcp chrome-devtools-mcp"
          data-webmcp-enabled={webmcpEnabled ? "true" : "false"}
        >
          <FinancialOperatorOverlay />
          <WorkspaceModeToggle />
          <WorkspaceModePane />
          <Unauthenticated>
            <FastAgentProvider>
              <SelectionProvider>
                <OracleSessionProvider>
                <ContextPillsProvider>
                  <ErrorBoundary title="Something went wrong">
                    <Suspense fallback={<ViewSkeleton />}>
                      <CockpitLayout
                        selectedDocumentId={null}
                        onDocumentSelect={() => { }}
                      />
                    </Suspense>
                  </ErrorBoundary>
                  {/* Global Fast Agent Panel for guests */}
                  <GlobalFastAgentPanel />
                </ContextPillsProvider>
                </OracleSessionProvider>
              </SelectionProvider>
            </FastAgentProvider>
          </Unauthenticated>
          <Authenticated>
            <FastAgentProvider>
              <SelectionProvider>
                <OracleSessionProvider>
                <ContextPillsProvider>
                  <ErrorBoundary title="Something went wrong">
                    <Suspense fallback={<ViewSkeleton />}>
                      {showTutorial ? (
                        <TutorialPage
                          onGetStarted={handleGetStarted}
                          onDocumentSelect={handleDocumentSelect}
                        />
                      ) : (
                        <CockpitLayout
                          selectedDocumentId={selectedDocumentId}
                          onDocumentSelect={setSelectedDocumentId}
                        />
                      )}
                    </Suspense>
                  </ErrorBoundary>
                  {/* Global Fast Agent Panel - controlled via context */}
                  <GlobalFastAgentPanel />
                  {/* Global Feedback Listener for audio/visual cues */}
                  <FeedbackListener />
                </ContextPillsProvider>
                </OracleSessionProvider>
              </SelectionProvider>
            </FastAgentProvider>
          </Authenticated>
        </main>
      </EvidenceProvider>
    </ThemeProvider>
  );
}

export default App;
