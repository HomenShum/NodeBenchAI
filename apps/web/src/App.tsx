import { useConvexAuth } from "convex/react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback, lazy, Suspense, useRef } from "react";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { ViewSkeleton } from "@/components/skeletons/ViewSkeleton";
import { useWebMcpProvider } from "./hooks/useWebMcpProvider";
import type { MainView } from "@/lib/registry/viewRegistry";
import { initErrorReporting } from "@/lib/errorReporting";

const RedesignShell = lazy(() => import("@/features/redesign/RedesignShell"));
const EditionPrintPage = lazy(() =>
  import("@/features/redesign/pages/EditionPrintPage").then((m) => ({
    default: m.EditionPrintPage,
  })),
);
// Step 9 of scratchnode release loop: ScratchNode → NodeBench handoff.
// These are top-level standalone routes (NOT inside the cockpit) so the
// page renders without auth — the data is gated server-side by ownerKey
// matching the user's ScratchNode sn_session_id from localStorage.
// See: convex/scratchnodeHandoff.ts, src/features/redesign/surfaces/ScratchnodeEventsSurface.tsx
const ScratchnodeEventsSurface = lazy(() =>
  import("@/features/redesign/surfaces/ScratchnodeEventsSurface").then((m) => ({
    default: m.ScratchnodeEventsSurface,
  })),
);
const ScratchnodeNoteDetailPage = lazy(() =>
  import("@/features/redesign/pages/ScratchnodeNoteDetailPage").then((m) => ({
    default: m.ScratchnodeNoteDetailPage,
  })),
);
const ShareableMemoView = lazy(() => import("@/features/founder/views/ShareableMemoView"));
const PublicEntityShareView = lazy(() => import("@/features/share/views/PublicEntityShareView"));
const PublicCompanyProfileView = lazy(() => import("@/features/founder/views/PublicCompanyProfileView"));
const PublicReportView = lazy(() => import("@/features/reports/views/PublicReportView"));
const UniversalWorkspacePage = lazy(() =>
  import("@/features/workspace/views/UniversalWorkspacePage").then((m) => ({
    default: m.UniversalWorkspacePage,
  })),
);
const EmbedView = lazy(() => import("@/features/founder/views/EmbedView"));
const FounderRouteResolver = lazy(() => import("@/features/founder/views/FounderRouteResolver"));
// /events/:eventId — corpus explorer for one event. See viewRegistry "event-corpus" entry.
const EventCorpusExplorer = lazy(() =>
  import("@/features/events/views/EventCorpusExplorer").then((m) => ({
    default: m.EventCorpusExplorer,
  })),
);
// /events/:slug/wiki — the ScratchNode -> NodeBench bridge receiving surface.
// Renders a published ScratchNode wiki (public getPublishedWikiBySlug) inside
// NodeBench with a conversion frame. Mounted ABOVE /events/:eventId so the
// trailing /wiki segment is captured before the single-segment matcher.
const ScratchnodeWikiBridge = lazy(() =>
  import("@/features/events/views/ScratchnodeWikiBridge").then((m) => ({
    default: m.ScratchnodeWikiBridge,
  })),
);
// /events/:slug/private — the cross-domain private-notes handoff receiving
// surface. Consumes an opaque `?token=` (minted on scratchnode.live after a
// membership check) and renders the read-only notes snapshot. Mounted ABOVE
// /events/:eventId so the trailing /private segment is captured first.
const ScratchnodePrivateBridge = lazy(() =>
  import("@/features/events/views/ScratchnodePrivateBridge").then((m) => ({
    default: m.ScratchnodePrivateBridge,
  })),
);
// My Wiki — Phase 1 routes. See docs/architecture/ME_AGENT_DESIGN.md
const WikiLandingRoute = lazy(() => import("@/features/me/components/wiki/WikiLandingRoute"));
const WikiPageDetailRoute = lazy(() => import("@/features/me/components/wiki/WikiPageDetailRoute"));

function App() {
  const location = useLocation();

  // Initialize global error tracking once on mount
  const errorInitRef = useRef(false);
  useEffect(() => {
    if (!errorInitRef.current) {
      errorInitRef.current = true;
      initErrorReporting();
    }
  }, []);
  // WebMCP provider — expose NodeBench tools to browser agents via navigator.modelContext
  const [webmcpEnabled] = useState(() => localStorage.getItem("nodebench_webmcp_provider_enabled") === "true");
  const { isAuthenticated: webmcpIsAuth } = useConvexAuth();
  const nav = useNavigate();
  const handleWebMcpNavigate = useCallback((view: MainView) => {
    const target = view === "home" || view === "ask" || view === "chat"
      ? "/redesign/chat"
      : `/redesign/chat?intent=${encodeURIComponent(view)}`;
    nav(target);
  }, [nav]);
  useWebMcpProvider({
    enabled: webmcpEnabled,
    currentPath: location.pathname,
    isAuthenticated: webmcpIsAuth,
    onNavigate: handleWebMcpNavigate,
  });

  const workspaceHostname =
    typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
  const isWorkspaceHost =
    workspaceHostname === "nodebench.workspace" ||
    workspaceHostname === "workspace.nodebenchai.com" ||
    workspaceHostname === "nodebench-workspace.vercel.app";
  const isStandaloneWorkspaceRoute = isWorkspaceHost &&
    (location.pathname === "/" ||
      location.pathname === "/workspace" ||
      location.pathname.startsWith("/workspace/") ||
      location.pathname.startsWith("/w/") ||
      location.pathname.startsWith("/share/"));
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
  // The root is a compatibility entry point into the one decision workspace.
  // Preserve useful legacy context while removing device-specific product trees.
  const shouldUseRedesignLanding = location.pathname === "/";
  if (shouldUseRedesignLanding) {
    const legacySurface = rootSurface;
    rootParams.delete("surface");

    const legacyReportId = rootParams.get("reportId");
    if (legacyReportId && !rootParams.has("report")) {
      rootParams.set("report", legacyReportId);
      rootParams.delete("reportId");
    }

    if (
      legacySurface &&
      legacySurface !== "home" &&
      legacySurface !== "ask" &&
      legacySurface !== "chat" &&
      legacySurface !== "workspace"
    ) {
      const intent = legacySurface === "packets" || legacySurface === "reports"
        ? "reports"
        : legacySurface === "history" || legacySurface === "inbox"
          ? "attention"
          : legacySurface === "me"
            ? "account"
            : legacySurface;
      rootParams.set("intent", intent);
    }

    const nextSearch = rootParams.toString();
    return <Navigate to={`/redesign/chat${nextSearch ? `?${nextSearch}` : ""}`} replace />;
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

  // Step 9: ScratchNode → NodeBench handoff routes (must match BEFORE the
  // cockpit fall-through). Both render without requiring NodeBench auth —
  // the data is gated server-side by ownerKey matching the visitor's
  // sn_session_id localStorage value. See:
  //   - convex/scratchnodeHandoff.ts (listMyJoinedEvents query)
  //   - src/features/redesign/surfaces/ScratchnodeEventsSurface.tsx
  //   - src/features/redesign/pages/ScratchnodeNoteDetailPage.tsx
  // Order matters: the more-specific note-detail path must come first so
  // its segment count doesn't shadow the list page.
  const scratchnodeNoteRouteMatch = location.pathname.match(
    /^\/scratchnode-event\/([^/]+)\/notes\/([^/]+)\/?$/,
  );
  if (scratchnodeNoteRouteMatch) {
    return (
      <ThemeProvider>
        <ErrorBoundary title="ScratchNode note failed to load">
          <Suspense fallback={<ViewSkeleton />}>
            <div
              key={`scratchnode-note-${scratchnodeNoteRouteMatch[2]}`}
              className="route-fade-in"
            >
              <ScratchnodeNoteDetailPage />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }
  const isScratchnodeEventsRoute =
    location.pathname === "/scratchnode-events" ||
    location.pathname === "/scratchnode-events/";
  if (isScratchnodeEventsRoute) {
    return (
      <ThemeProvider>
        <ErrorBoundary title="ScratchNode handoff failed to load">
          <Suspense fallback={<ViewSkeleton />}>
            <div key="scratchnode-events" className="route-fade-in">
              <ScratchnodeEventsSurface />
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

  // Retired main-site report editors are context aliases, not peer surfaces.
  // Recursive report editing remains available only on the Workspace host.
  const reportWorkspaceRouteMatch = location.pathname.match(
    /^\/reports\/([^/]+)(?:\/(brief|cards|notebook|sources|graph|map))?\/?$/,
  );
  if (reportWorkspaceRouteMatch && !isWorkspaceHost) {
    let reportId = reportWorkspaceRouteMatch[1] ?? "";
    try {
      reportId = decodeURIComponent(reportId);
    } catch {
      // Invalid HTTP percent escapes are rejected before React in production;
      // keep this in-memory route boundary total for tests and BrowserRouter.
    }
    const artifact = reportWorkspaceRouteMatch[2] === "graph"
      ? "map"
      : reportWorkspaceRouteMatch[2] ?? "brief";
    const nextParams = new URLSearchParams(location.search);
    nextParams.set("report", reportId);
    nextParams.set("artifact", artifact);
    nextParams.delete("tab");
    return <Navigate to={`/redesign/chat?${nextParams.toString()}`} replace />;
  }

  // Singular /report/:id is a bounded public delivery route for guests.
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

  // /events/:eventId — corpus explorer for one event. Mounted as a top-level
  // standalone route (NOT inside the cockpit) because the cockpit's path
  // resolver does prefix-style longest-match and would happily swallow
  // /events/* into "/" if no explicit branch ran first.
  // See viewRegistry.ts "event-corpus" entry — that entry exists so Cmd-K
  // and other discovery surfaces know about the route, but the actual
  // rendering happens here.
  // /events/:slug/wiki — ScratchNode → NodeBench bridge. MUST come before the
  // single-segment /events/:eventId matcher below (which rejects trailing
  // segments and would otherwise let this 404 — the original broken-bridge bug).
  const eventWikiRouteMatch = location.pathname.match(/^\/events\/([^/]+)\/wiki\/?$/);
  if (eventWikiRouteMatch) {
    const slug = decodeURIComponent(eventWikiRouteMatch[1] ?? "");
    const params = new URLSearchParams(location.search);
    return (
      <ThemeProvider>
        <ErrorBoundary title="Event recap failed to load">
          <Suspense fallback={<ViewSkeleton />}>
            <div key={`event-wiki-${slug}`} className="route-fade-in">
              <ScratchnodeWikiBridge
                slug={slug}
                source={params.get("source")}
                roomCode={params.get("room")}
              />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // /events/:slug/private — ScratchNode → NodeBench private-notes handoff. Also
  // ABOVE the single-segment matcher so the trailing /private is captured first.
  const eventPrivateRouteMatch = location.pathname.match(/^\/events\/([^/]+)\/private\/?$/);
  if (eventPrivateRouteMatch) {
    const slug = decodeURIComponent(eventPrivateRouteMatch[1] ?? "");
    const params = new URLSearchParams(location.search);
    return (
      <ThemeProvider>
        <ErrorBoundary title="Private notes failed to load">
          <Suspense fallback={<ViewSkeleton />}>
            <div key={`event-private-${slug}`} className="route-fade-in">
              <ScratchnodePrivateBridge slug={slug} token={params.get("token")} />
            </div>
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  const eventsRouteMatch = location.pathname.match(/^\/events\/([^/]+)\/?$/);
  if (eventsRouteMatch) {
    const eventId = decodeURIComponent(eventsRouteMatch[1] ?? "");
    return (
      <ThemeProvider>
        <ErrorBoundary title="Event corpus failed to load">
          <Suspense fallback={<ViewSkeleton />}>
            <div key={`events-${eventId}`} className="route-fade-in">
              <EventCorpusExplorer eventId={eventId} />
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

  // The main site has no default cockpit. Any retired or unknown product path
  // contracts into the same decision workspace. Purpose-built read-only
  // delivery routes above, plus the dedicated Workspace hostname, retain their
  // separate runtime contracts without becoming peer application surfaces.
  return <Navigate to="/redesign/chat" replace />;
}

export default App;
