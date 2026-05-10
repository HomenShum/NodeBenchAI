/**
 * RedesignShell — top-level container for the /redesign showcase.
 *
 * Mounts tokens.css + primitives.css, owns the URL-driven surface state,
 * lays out the rail + main + (optional) right rail.
 *
 * Routes (parsed from useLocation, no nested router needed):
 *   /redesign                  → Home
 *   /redesign/reports          → Reports
 *   /redesign/chat             → Chat
 *   /redesign/inbox            → Inbox
 *   /redesign/me               → Me
 *   /redesign/workspace[/...]  → Workspace (separate full-height surface)
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import "./tokens.css";
import "./primitives.css";

import { Rail } from "./components/Rail";
import { RightInspector } from "./components/RightInspector";
import { MobileShell } from "./components/MobileShell";
import { TopNav } from "./components/TopNav";
import { ReportNotebookView } from "./components/ReportNotebookView";
import { CommandPalette, useCommandPalette } from "./components/CommandPalette";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { ToastViewport } from "./components/Toast";
import { HomeSurface } from "./surfaces/HomeSurface";
import { ReportsSurface } from "./surfaces/ReportsSurface";
import { ChatSurface } from "./surfaces/ChatSurface";
import { InboxSurface } from "./surfaces/InboxSurface";
import { MeSurface } from "./surfaces/MeSurface";
import { WorkspaceSurface } from "./surfaces/WorkspaceSurface";
import { ReproducibleChatPage } from "./pages/ReproducibleChatPage";
import { useLiveArtifacts } from "./hooks/useLiveArtifacts";
import type { SurfaceId } from "./fixtures";

const PATH_TO_SURFACE: Record<string, SurfaceId | "workspace"> = {
  "": "home",
  "/": "home",
  "reports": "reports",
  "chat": "chat",
  "inbox": "inbox",
  "me": "me",
  "workspace": "workspace",
};

function pathToSurface(pathname: string): SurfaceId | "workspace" {
  const rest = pathname.replace(/^\/redesign\/?/, "").split("/")[0] ?? "";
  return (PATH_TO_SURFACE[rest] ?? "home") as SurfaceId | "workspace";
}

function pathToReportId(pathname: string): string | null {
  // /redesign/reports/<id> → <id>
  const match = pathname.match(/^\/redesign\/reports\/([^/]+)/);
  return match?.[1] ?? null;
}

function pathToChatHash(pathname: string): string | null {
  // /redesign/chat/r/<hash> → <hash> (Phase 3 reproducibility URL)
  const match = pathname.match(/^\/redesign\/chat\/r\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

type WorkspaceTab = "brief" | "cards" | "notebook" | "sources" | "chat" | "map";

function workspaceParams(search: string): { reportId?: string; tab: WorkspaceTab } {
  const params = new URLSearchParams(search);
  const reportId = params.get("report") || undefined;
  const tab = params.get("tab");
  const workspaceTab: WorkspaceTab =
    tab === "cards" || tab === "notebook" || tab === "sources" || tab === "chat" || tab === "map"
      ? tab
      : "brief";
  return { reportId, tab: workspaceTab };
}

export default function RedesignShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [forceMobile, setForceMobile] = useState(false);
  const isMobile = useViewportMobile() || forceMobile;
  const showQaChrome = useQaChromeFlag(location.search);
  const cmdk = useCommandPalette();

  const surface = useMemo(() => pathToSurface(location.pathname), [location.pathname]);
  const reportId = useMemo(() => pathToReportId(location.pathname), [location.pathname]);
  const chatHash = useMemo(() => pathToChatHash(location.pathname), [location.pathname]);
  const workspace = useMemo(() => workspaceParams(location.search), [location.search]);
  const shellLiveArtifacts = useLiveArtifacts(24);
  const railStats = useMemo(() => ({
    entities: shellLiveArtifacts.publicResearch.length,
    reports: shellLiveArtifacts.reports.length,
    followUps: shellLiveArtifacts.reports.reduce((total, report) => total + report.followUps, 0),
  }), [shellLiveArtifacts.publicResearch.length, shellLiveArtifacts.reports]);
  const goSurface = (id: SurfaceId) => {
    navigate(id === "home" ? "/redesign" : `/redesign/${id}`);
  };
  const goWorkspace = () => navigate("/redesign/workspace");

  // Optionally lock body scroll while shell is mounted
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Phase 7d (2026-05-08): editorial is the default at /redesign on
  // both mobile + desktop.  Legacy is opt-out via `?classic=1`
  // (canonical) or `?edition=0` (back-compat).  Per
  // docs/architecture/HOME_EDITORIAL_REDESIGN.md §3 Variant C
  // ("mobile and desktop are identical"), the editorial single-column
  // layout bypasses MobileShell at the home surface so it stays
  // responsive at any width.
  const isEditionFlag =
    typeof window === "undefined" ||
    (() => {
      const params = new URLSearchParams(location.search);
      if (params.get("classic") === "1") return false;
      if (params.get("edition") === "0") return false;
      return true;
    })();

  // Mobile path overrides everything except /redesign/workspace (which keeps its own surface).
  if (isMobile && surface !== "workspace") {
    const mobileSurface: SurfaceId = (surface === "workspace" ? "reports" : surface) as SurfaceId;
    // Edition flag bypasses MobileShell at the home surface so the
    // single-column editorial layout stays responsive at any width.
    if (isEditionFlag && mobileSurface === "home") {
      return (
        <div data-redesign data-redesign-theme={theme} style={{ minHeight: "100dvh", overflow: "auto" }}>
          <HomeSurface
            onAsk={(text) => navigate(`/redesign/chat?q=${encodeURIComponent(text)}`)}
            onOpenReport={(id) => navigate(`/redesign/reports/${id}`)}
          />
          {showQaChrome && <ThemeFab theme={theme} setTheme={setTheme} />}
          {showQaChrome && <ViewportFab forceMobile={forceMobile} setForceMobile={setForceMobile} />}
          <NavBanner pathname={location.pathname} />
          <CommandPalette open={cmdk.open} onClose={() => cmdk.setOpen(false)} />
          <ShortcutsOverlay />
          <ToastViewport />
        </div>
      );
    }
    return (
      <div data-redesign data-redesign-theme={theme} style={{ height: "100dvh", overflow: "hidden" }}>
        <MobileShell active={mobileSurface} onChange={(id) => goSurface(id)} />
        {showQaChrome && <ThemeFab theme={theme} setTheme={setTheme} />}
        {showQaChrome && <ViewportFab forceMobile={forceMobile} setForceMobile={setForceMobile} />}
        <NavBanner pathname={location.pathname} />
        <CommandPalette open={cmdk.open} onClose={() => cmdk.setOpen(false)} />
        <ShortcutsOverlay />
        <ToastViewport />
      </div>
    );
  }

  if (surface === "workspace") {
    return (
      <div data-redesign data-redesign-theme={theme} style={{ height: "100vh", overflow: "hidden" }}>
        <main id="main-content" data-main-content className="rd-pane rd-workspace-standalone">
          <WorkspaceSurface reportId={workspace.reportId} initialTab={workspace.tab} />
        </main>
        {showQaChrome && <ThemeFab theme={theme} setTheme={setTheme} />}
        <CommandPalette open={cmdk.open} onClose={() => cmdk.setOpen(false)} />
        <ShortcutsOverlay />
        <ToastViewport />
      </div>
    );
  }

  // Single-pane surfaces (Home, Reports, Inbox, Me) → no right rail
  // Two-pane surfaces (Chat) → right inspector visible
  // Phase 3 — /redesign/chat/r/{hash} is a chat sub-route but renders a
  // standalone reproducible answer page; suppress the right inspector.
  const showInspector = surface === "chat" && !chatHash;

  return (
    <div
      data-redesign
      data-redesign-theme={theme}
      style={{
        height: "100vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <TopNav
        active={surface as SurfaceId}
        onChange={(id) => goSurface(id)}
        onOpenPalette={() => cmdk.setOpen(true)}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "light" ? "dark" : "light")}
      />
      <div
        className={`rd-shell ${showInspector ? "" : "rd-shell--single"}`}
        style={{ flex: 1, minHeight: 0 }}
      >
        <Rail
          active={surface as SurfaceId}
          onChange={(id) => goSurface(id)}
          onOpenWorkspace={goWorkspace}
          liveStats={railStats}
        />

        {showInspector ? (
          <div className="rd-shell__main">
            <main id="main-content" data-main-content className="rd-pane" style={{ borderRight: "1px solid var(--rd-line-faint)" }}>
              <ChatSurface />
            </main>
            <RightInspector />
          </div>
        ) : (
          <main id="main-content" data-main-content className="rd-pane" style={{ borderRight: "none" }}>
            {/* Phase 3 — /redesign/chat/r/{hash} renders the immutable cached run. */}
            {surface === "chat" && chatHash && <ReproducibleChatPage hash={chatHash} />}
            {surface === "home" && (
              <HomeSurface
                onAsk={() => goSurface("chat")}
                onOpenReport={(id) => navigate(`/redesign/workspace?report=${id}`)}
              />
            )}
            {surface === "reports" && !reportId && (
              <ReportsSurface
                onOpen={(id, tab) => {
                  if (id.startsWith("li_") || id.startsWith("daily_") || id.startsWith("run_")) {
                    const workspaceTab = tab === "chat" ? "chat" : tab === "cards" ? "cards" : "brief";
                    navigate(`/redesign/workspace?report=${id}&tab=${workspaceTab}`);
                    return;
                  }
                  if (tab === "brief") navigate(`/redesign/reports/${id}`);
                  else navigate(`/redesign/workspace?report=${id}&tab=${tab}`);
                }}
              />
            )}
            {surface === "reports" && reportId && <ReportDetailRoute reportId={reportId} />}
            {surface === "inbox" && <InboxSurface />}
            {surface === "me" && <MeSurface />}
          </main>
        )}
      </div>

      {showQaChrome && <ThemeFab theme={theme} setTheme={setTheme} />}
      {showQaChrome && <ViewportFab forceMobile={forceMobile} setForceMobile={setForceMobile} />}
      <NavBanner pathname={location.pathname} />

      {/* Cross-surface primitives — Cmd+K palette, ? shortcuts, toasts */}
      <CommandPalette open={cmdk.open} onClose={() => cmdk.setOpen(false)} />
      <ShortcutsOverlay />
      <ToastViewport />
    </div>
  );
}

function ReportDetailRoute({ reportId }: { reportId: string }) {
  const liveArtifacts = useLiveArtifacts(60);
  const liveDetail = liveArtifacts.details.find((detail) => detail.id === reportId);
  return <ReportNotebookView reportId={reportId} liveDetail={liveDetail} />;
}

function useQaChromeFlag(search: string): boolean {
  return useMemo(() => {
    const params = new URLSearchParams(search);
    if (params.get("qaChrome") === "1" || params.get("debugUi") === "1") return true;
    try {
      return window.localStorage.getItem("nodebench-redesign-qa-chrome") === "1";
    } catch {
      return false;
    }
  }, [search]);
}

function useViewportMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 760px)").matches : false
  );
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 760px)");
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

function ViewportFab({ forceMobile, setForceMobile }: { forceMobile: boolean; setForceMobile: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => setForceMobile(!forceMobile)}
      aria-label="Toggle mobile preview"
      title={forceMobile ? "Switch to desktop view" : "Preview on phone"}
      className="rd-btn rd-btn--ghost"
      style={{
        position: "fixed",
        bottom: 18,
        right: 64,
        height: 36,
        padding: "0 12px",
        borderRadius: "var(--rd-r-pill)",
        boxShadow: "var(--rd-shadow-md)",
        zIndex: 50,
        fontSize: 11,
        fontWeight: 590,
      }}
    >
      {forceMobile ? "Desktop" : "Phone"}
    </button>
  );
}

function ThemeFab({ theme, setTheme }: { theme: "light" | "dark"; setTheme: (t: "light" | "dark") => void }) {
  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      aria-label="Toggle theme"
      title="Toggle light / dark"
      className="rd-btn rd-btn--ghost"
      style={{
        position: "fixed",
        bottom: 18,
        right: 18,
        width: 36,
        height: 36,
        padding: 0,
        borderRadius: "50%",
        boxShadow: "var(--rd-shadow-md)",
        zIndex: 50,
      }}
    >
      {theme === "light" ? "◐" : "◑"}
    </button>
  );
}

function NavBanner({ pathname }: { pathname: string }) {
  // Visual signal: which redesign surface is mounted (in-DOM signal for live verification)
  return (
    <div
      data-testid="redesign-active"
      data-redesign-surface={pathname}
      style={{ position: "absolute", left: -9999, top: -9999, opacity: 0 }}
      aria-hidden="true"
    >
      NodeBench redesign · {pathname}
    </div>
  );
}
