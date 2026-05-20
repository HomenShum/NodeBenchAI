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

import { useViewportMobile } from "@/hooks/useViewportMobile";

import "./tokens.css";
import "./primitives.css";

import { RightInspector, type AgentRailSnapshot } from "./components/RightInspector";
import { MobileShell } from "./components/MobileShell";
import { TopNav } from "./components/TopNav";
import { ReportNotebookView } from "./components/ReportNotebookView";
import { CommandPalette, useCommandPalette } from "./components/CommandPalette";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { ToastViewport } from "./components/Toast";
import {
  HomeV2BriefingRail,
  HomeV2EditionRail,
  HomeV2Surface,
  PrototypeV2Center,
  PrototypeV2LeftRail,
  PrototypeV2RightRail,
  type PrototypeSurface,
} from "./surfaces/HomeV2PrototypeSurface";
import { ReportsSurface } from "./surfaces/ReportsSurface";
import { ChatSurface } from "./surfaces/ChatSurface";
import { InboxSurface } from "./surfaces/InboxSurface";
import { MeSurface } from "./surfaces/MeSurface";
import { WorkspaceSurface } from "./surfaces/WorkspaceSurface";
import { ReproducibleChatPage } from "./pages/ReproducibleChatPage";
import { useLiveArtifacts, type LiveArtifactDetail } from "./hooks/useLiveArtifacts";
import type { ReportCardData, SurfaceId } from "./fixtures";

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

function queryPrompt(search: string): string {
  const params = new URLSearchParams(search);
  return params.get("q")?.trim() ?? "";
}

function normalizeEntityKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
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
  const [wideMode, setWideMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("nodebench:redesign:wide-mode") === "1";
  });
  // Phase 7d preserves the redesign-specific 760px phone breakpoint.
  // The shared hook is parameterized so other call-sites (CockpitLayout,
  // ExactKit) can opt into their own breakpoint without forking.
  const isMobile = useViewportMobile("(max-width: 760px)") || forceMobile;
  const showQaChrome = useQaChromeFlag(location.search);
  const cmdk = useCommandPalette();

  const surface = useMemo(() => pathToSurface(location.pathname), [location.pathname]);
  const reportId = useMemo(() => pathToReportId(location.pathname), [location.pathname]);
  const chatHash = useMemo(() => pathToChatHash(location.pathname), [location.pathname]);
  const workspace = useMemo(() => workspaceParams(location.search), [location.search]);
  const initialChatPrompt = useMemo(() => queryPrompt(location.search), [location.search]);
  const isPrototypeKit = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("qa") === "home-v2-implementation";
  }, [location.search]);
  const shellLiveArtifacts = useLiveArtifacts(24, { enabled: !isPrototypeKit });
  const [selectedReport, setSelectedReport] = useState<ReportCardData | null>(null);
  const [prototypeEntity, setPrototypeEntity] = useState("Anthropic");
  const [reportsRailEntityMode, setReportsRailEntityMode] = useState(false);
  const [activeChatDetail, setActiveChatDetail] = useState<LiveArtifactDetail | null>(null);
  const [activeChatAgentRail, setActiveChatAgentRail] = useState<AgentRailSnapshot | null>(null);
  const goSurface = (id: SurfaceId) => {
    if (id !== "reports") {
      setSelectedReport(null);
      setReportsRailEntityMode(false);
    }
    const path = id === "home" ? "/redesign" : `/redesign/${id}`;
    navigate(isPrototypeKit ? `${path}?qa=home-v2-implementation` : path);
  };
  const sendPromptToChat = (prompt: string, context?: { reportId?: string; artifactKey?: string }) => {
    const params = new URLSearchParams();
    if (isPrototypeKit) params.set("qa", "home-v2-implementation");
    params.set("q", prompt);
    if (context?.reportId) params.set("report", context.reportId);
    if (context?.artifactKey) params.set("artifact", context.artifactKey);
    const query = params.toString();
    navigate(`/redesign/chat?${query}`);
  };
  const openTouchedReports = (reportId?: string) => {
    if (reportId && !isPrototypeKit) {
      navigate(`/redesign/reports/${encodeURIComponent(reportId)}`);
      return;
    }
    navigate(isPrototypeKit ? "/redesign/reports?qa=home-v2-implementation" : "/redesign/reports");
  };
  const selectPrototypeRailEntity = (entity: string) => {
    setPrototypeEntity(entity);
    if (!isPrototypeKit && surface === "reports") {
      setSelectedReport(null);
      setReportsRailEntityMode(true);
    }
  };
  const selectLiveReport = (report: ReportCardData | null) => {
    setReportsRailEntityMode(false);
    setSelectedReport(report);
    if (report) setPrototypeEntity(report.entity);
  };
  const routeReport = surface === "reports" && reportId
    ? shellLiveArtifacts.reports.find((report) => report.id === reportId) ?? null
    : null;
  const selectedRailReport =
    surface === "reports" && !reportsRailEntityMode
      ? routeReport ??
        (selectedReport && normalizeEntityKey(selectedReport.entity) === normalizeEntityKey(prototypeEntity)
          ? selectedReport
          : null)
      : null;

  // Optionally lock body scroll while shell is mounted
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("nodebench:redesign:wide-mode", wideMode ? "1" : "0");
  }, [wideMode]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "w") return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      event.preventDefault();
      setWideMode((current) => !current);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
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
  if (isMobile && surface !== "workspace" && !isPrototypeKit) {
    const mobileSurface: SurfaceId = (surface === "workspace" ? "reports" : surface) as SurfaceId;
    // Edition flag bypasses MobileShell at the home surface so the
    // single-column editorial layout stays responsive at any width.
    if (isEditionFlag && mobileSurface === "home") {
      return (
        <div data-redesign data-redesign-theme={theme} style={{ minHeight: "100dvh", overflow: "auto" }}>
          <HomeV2Surface
            onAsk={sendPromptToChat}
            onOpenReports={openTouchedReports}
            liveArtifacts={shellLiveArtifacts}
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

  // Phase 3 chat hashes and report detail pages own the full width. Other
  // desktop surfaces keep a right-side agent rail so the center can stay calm.
  const prototypeSurface = surface as PrototypeSurface;
  const isHomeV2 = surface === "home" || isPrototypeKit;
  const usesV2Canvas =
    surface === "home" ||
    surface === "reports" ||
    surface === "chat" ||
    surface === "inbox" ||
    surface === "me" ||
    isPrototypeKit;
  const suppressRightRail =
    !isPrototypeKit &&
    surface === "chat" &&
    Boolean(chatHash);

  return (
    <div
      data-redesign
      data-redesign-theme={theme}
      data-wide={wideMode ? "true" : undefined}
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
        wideMode={wideMode}
        onToggleWideMode={() => setWideMode((current) => !current)}
        prototypeMode={isPrototypeKit}
      />
      <div
        className={`rd-shell ${usesV2Canvas ? "rd-shell--home-v2" : ""} ${surface === "chat" && !isPrototypeKit ? "rd-shell--chat-v3" : ""} ${surface === "reports" ? "rd-shell--reports-v3" : ""} ${suppressRightRail ? "rd-shell--single" : ""}`}
        style={{ flex: 1, minHeight: 0 }}
      >
        {isPrototypeKit ? (
          <PrototypeV2LeftRail
            surface={prototypeSurface}
            selectedEntity={prototypeEntity}
            onSelectEntity={setPrototypeEntity}
          />
        ) : isHomeV2 ? (
          <HomeV2EditionRail liveArtifacts={shellLiveArtifacts} onAsk={sendPromptToChat} />
        ) : (
          <PrototypeV2LeftRail
            surface={prototypeSurface}
            selectedEntity={prototypeEntity}
            onSelectEntity={selectPrototypeRailEntity}
            guestSafe={surface === "me"}
            liveArtifacts={shellLiveArtifacts}
          />
        )}

        {suppressRightRail ? (
          <main id="main-content" data-main-content className="rd-pane" style={{ borderRight: "none" }}>
            {surface === "chat" && chatHash && <ReproducibleChatPage hash={chatHash} />}
            {surface === "reports" && reportId && <ReportDetailRoute reportId={reportId} />}
          </main>
        ) : (
          <div className="rd-shell__main">
            <main id="main-content" data-main-content className="rd-pane">
              {/* Keyed wrapper forces React to remount on surface change,
                  triggering the rd-surface-enter CSS animation reliably. */}
              <div key={isPrototypeKit ? `proto-${prototypeSurface}` : `${surface}${reportId ? `-${reportId}` : ""}`} className="rd-surface-content">
              {isPrototypeKit && (
                <PrototypeV2Center
                  surface={prototypeSurface}
                  onAsk={sendPromptToChat}
                  selectedEntity={prototypeEntity}
                  onSelectEntity={setPrototypeEntity}
                />
              )}
              {!isPrototypeKit && surface === "chat" && (
                <ChatSurface
                  initialPrompt={initialChatPrompt}
                  onActiveContextChange={setActiveChatDetail}
                  onAgentRailChange={setActiveChatAgentRail}
                />
              )}
              {!isPrototypeKit && surface === "home" && (
                <HomeV2Surface
                  onAsk={sendPromptToChat}
                  onOpenReports={openTouchedReports}
                  liveArtifacts={shellLiveArtifacts}
                />
              )}
            {!isPrototypeKit && surface === "reports" && !reportId && (
              <ReportsSurface
                onOpen={(id, tab) => {
                  if (tab === "brief") navigate(`/redesign/reports/${id}`);
                  else navigate(`/redesign/workspace?report=${id}&tab=${tab}`);
                }}
                inspectedReportId={reportsRailEntityMode ? "__rail_entity_override__" : selectedReport?.id ?? null}
                onSelectReport={selectLiveReport}
                onRunBatch={sendPromptToChat}
              />
            )}
            {!isPrototypeKit && surface === "reports" && reportId && <ReportDetailRoute reportId={reportId} />}
            {!isPrototypeKit && surface === "inbox" && <InboxSurface />}
            {!isPrototypeKit && surface === "me" && <MeSurface />}
              </div>
            </main>
            {isPrototypeKit ? (
              <PrototypeV2RightRail
                surface={prototypeSurface}
                onAsk={sendPromptToChat}
                selectedEntity={prototypeEntity}
                onSelectEntity={setPrototypeEntity}
              />
            ) : surface === "home" ? (
              <HomeV2BriefingRail
                onAsk={sendPromptToChat}
                onOpenReports={openTouchedReports}
                liveArtifacts={shellLiveArtifacts}
              />
            ) : surface === "chat" ? (
              <RightInspector
                activeLiveArtifactDetail={activeChatDetail ?? undefined}
                agentSnapshot={activeChatAgentRail}
              />
            ) : (
              <PrototypeV2RightRail
                surface={prototypeSurface}
                onAsk={sendPromptToChat}
                selectedEntity={surface === "reports" ? prototypeEntity : undefined}
                selectedReport={selectedRailReport}
                onSelectEntity={selectPrototypeRailEntity}
                guestSafe={surface === "me"}
                liveArtifacts={shellLiveArtifacts}
              />
            )}
          </div>
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
  return <ReportNotebookView reportId={reportId} liveDetail={liveDetail} showSidebar={false} />;
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
