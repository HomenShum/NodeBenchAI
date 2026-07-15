/**
 * CockpitLayout — 5-region cockpit shell.
 *
 * +--------------------------------------+
 * | StatusStrip                          |
 * +--------+------------------+----------+
 * | Work-  |  ActiveSurface   |  Agent   |
 * | space  |      Host        | Presence |
 * | Rail   |                  |  Rail    |
 * +--------+------------------+----------+
 * | TraceStrip                           |
 * +--------------------------------------+
 *
 * CSS Grid: status / left center right / trace
 * CommandBar floats via Cmd+K. FastAgent panel overlays.
 */

import { useState, useEffect, useCallback, useRef, useMemo, startTransition, Suspense, lazy } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useConvexAuth } from "convex/react";
import { Id } from "../../convex/_generated/dataModel";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";
import { useCommandPalette } from "../hooks/useCommandPalette";
import { useGlobalEventListeners } from "../hooks/useGlobalEventListeners";
import { useViewWebMcpTools } from "../hooks/useViewWebMcpTools";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { ViewSkeleton } from "@/components/skeletons";
import {
  AgentMetadata,
  CommandPalette,
  QuickCaptureWidget,
  type ExecutedCommand,
  HashtagQuickNotePopover,
} from "@/layouts/chrome";
import MiniEditorPopover from "@/shared/components/MiniEditorPopover";
import { useTheme } from "../contexts/ThemeContext";
import { parseVoiceIntent, useVoiceIntentRouter } from "../hooks/useVoiceIntentRouter";
import { useIntentTelemetry } from "@/lib/hooks/useIntentTelemetry";
import {
  buildCockpitPath,
  buildCockpitPathForView,
  getDefaultViewForSurface,
  getSurfaceForView,
  SURFACE_TITLES,
  VIEW_MAP,
  type CockpitSurfaceId,
  type MainView,
} from "@/lib/registry/viewRegistry";
import { cn } from "@/lib/utils";

import { trackEvent } from "@/lib/analytics";
import { usePathTracking } from "../hooks/usePathTracking";
import { useCockpitMode } from "./useCockpitMode";
import { type CockpitMode, MODES } from "./cockpitModes";
import type { CommandAction } from "@/layouts/chrome";
import { StatusStrip } from "./StatusStrip";
import { CommandBar } from "./CommandBar";
import { ActiveSurfaceHost } from "./ActiveSurfaceHost";
import { WorkspaceRail } from "./WorkspaceRail";
import { MobileTabBar } from "./MobileTabBar";
import { MobileCaptureFab } from "./MobileCaptureFab";
import { IOSChrome } from "./IOSChrome";
import { ProductTopNav } from "./ProductTopNav";
// AgentPresenceRail removed — replaced by floating FAB + slide-over panel
// FeedbackWidget removed — overlapped FastAgent FAB, localStorage-only
// useBottomSheet removed — unified panel uses fixed position overlay
import { useSwipeNavigation } from "@/lib/hooks/useSwipeNavigation";
import { loadLastChatPath } from "@/features/product/lib/productSession";
import { ObjectFirstGlobalToggle } from "./ObjectFirstToggle";
import { useObjectFirstStatus } from "@/lib/featureFlags";
import "./hud.css";

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);

const OnboardingWizard = lazy(() =>
  import("@features/onboarding/components/OnboardingWizard").then((mod) => ({
    default: mod.OnboardingWizard,
  })),
);

const FastAgentPanel = lazy(() =>
  import("@features/agents/components/FastAgentPanel/FastAgentPanel").then((mod) => ({
    default: mod.FastAgentPanel,
  })),
);
const SettingsModal = lazy(() => import("@/layouts/settings/SettingsModal"));

const viewFallback = <ViewSkeleton variant="default" />;

interface CockpitLayoutProps {
  selectedDocumentId: Id<"documents"> | null;
  onDocumentSelect: (documentId: Id<"documents"> | null) => void;
}

export function CockpitLayout({
  selectedDocumentId,
  onDocumentSelect,
}: CockpitLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated } = useConvexAuth();

  const { setLayout, setMode: setThemeMode, resolvedMode, theme } = useTheme();

  // Path tracking — records navigation steps for founder platform telemetry
  usePathTracking();

  // Cockpit mode routing (wraps useMainLayoutRouting + mode derivation)
  const cockpit = useCockpitMode();
  const {
    currentView,
    setCurrentView,
    currentSurface,
    setCurrentSurface,
    entityName,
    setEntityName,
    selectedSpreadsheetId,
    setSelectedSpreadsheetId,
    researchHubInitialTab,
    setResearchHubInitialTab,
    setIsTransitioning,
    mode,
    setMode,
    modeConfig,
    panel,
    runId,
    documentParam,
    workspaceParam,
    canonicalPath,
    isLegacyRedirect,
    isUnknownRoute,
  } = cockpit;

  // ── Object-first layout detection ───────────────────────────────────────────
  // Only hide chrome for workspace (chat) and packets (reports) surfaces
  // when object-first layout is actually enabled for them
  const isObjectFirstSurface = currentSurface === "workspace" || currentSurface === "packets";
  const objectFirstStatus = useObjectFirstStatus();
  const isObjectFirstActive = objectFirstStatus.enabled && isObjectFirstSurface;

  // ── Mobile daily brief redirect ─────────────────────────────────────────────
  // On mobile, default landing is the Founder Dashboard (daily brief) not Ask.
  // Only fires once per session, only on exact "/" path.


  // ── Surface collapse state ─────────────────────────────────────────────────
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastVoiceInstruction, setLastVoiceInstruction] = useState<string | null>(null);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [chatDetailChromeHidden, setChatDetailChromeHidden] = useState(false);
  const [chatDetailPinned, setChatDetailPinned] = useState(false);

  // Listen for voice state broadcasts from the home intake surface
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ isListening: boolean }>).detail;
      setIsVoiceListening(detail.isListening);
    };
    window.addEventListener("nodebench:voice-listening", handler);
    return () => window.removeEventListener("nodebench:voice-listening", handler);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ hideMobileChrome?: boolean; pinned?: boolean }>).detail;
      setChatDetailChromeHidden(Boolean(detail?.hideMobileChrome));
      setChatDetailPinned(Boolean(detail?.pinned));
    };
    window.addEventListener("nodebench:chat-detail-state", handler as EventListener);
    return () =>
      window.removeEventListener(
        "nodebench:chat-detail-state",
        handler as EventListener,
      );
  }, []);

  const trackIntentEvent = useIntentTelemetry();
  const lastTrackedViewRef = useRef<string | null>(null);

  // Analytics: track surface views
  useEffect(() => {
    if (lastTrackedViewRef.current !== currentView) {
      lastTrackedViewRef.current = currentView;
      trackEvent("surface_view", { view: currentView, surface: currentSurface });
    }
  }, [currentView, currentSurface]);

  // Per-view WebMCP tools
  const webmcpViewEnabled = typeof navigator !== "undefined" && !!navigator.modelContext;
  useViewWebMcpTools(currentView, webmcpViewEnabled);

  // Agent panel state
  const [showFastAgent, setShowFastAgent] = useState(false);
  const [fastAgentHasMounted, setFastAgentHasMounted] = useState(false);
  const [selectedDocumentIdsForAgent, setSelectedDocumentIdsForAgent] = useState<Id<"documents">[]>([]);
  const [fastAgentThreadId, setFastAgentThreadId] = useState<string | null>(null);

  // Bottom-sheet removed — unified slide-over panel for all breakpoints

  // ── R7: Gesture swipe navigation between mobile surfaces ───────────────
  const swipeRef = useRef<HTMLDivElement>(null);
  const MOBILE_SURFACE_ORDER = useMemo(
    () => [
      buildCockpitPath({ surfaceId: "ask" }),
      buildCockpitPath({ surfaceId: "packets" }),
      buildCockpitPath({ surfaceId: "workspace" }),
      buildCockpitPath({ surfaceId: "history" }),
      buildCockpitPath({ surfaceId: "connect" }),
    ],
    [],
  );
  const isCompactLayout = typeof window !== "undefined" && window.innerWidth < 1280;
  const isPublicEntityView = currentSurface === "packets" && currentView === "entity";
  const isDeveloperInfoView = currentView === "developers";
  const isStandaloneInfoView = isDeveloperInfoView;
  const isDesktopPublicShell =
    !isCompactLayout &&
    (isDeveloperInfoView ||
      isPublicEntityView ||
      (["ask", "workspace", "packets", "history", "connect"].includes(currentSurface) &&
        currentView === getDefaultViewForSurface(currentSurface)));
  const compactSearchParams = new URLSearchParams(location.search);
  const hasFocusedChatRun = Boolean(
    compactSearchParams.get("session")?.trim() ||
      compactSearchParams.get("q")?.trim() ||
      compactSearchParams.get("draft")?.trim(),
  );
  const isMobileAskRoot = isCompactLayout && currentSurface === "ask" && location.pathname === "/";
  const hideMobileBottomChrome =
    isCompactLayout &&
    currentView === "chat-home" &&
    (hasFocusedChatRun || chatDetailChromeHidden);
  // Compact parity uses the mobile-kit header inside each surface. The global
  // status strip would duplicate navigation and create the old shell shape.
  const shouldHideStatusStrip = isCompactLayout || (isMobileAskRoot && currentView !== "chat-home");
  useSwipeNavigation({
    ref: swipeRef,
    surfaces: MOBILE_SURFACE_ORDER,
    currentPath: canonicalPath,
    onNavigate: (path) => {
      navigate(path);
    },
    enabled: isCompactLayout,
  });

  const {
    registerExternalState,
    openWithContext,
    options: fastAgentOpenOptions,
    clearOptions: clearFastAgentOptions,
  } = useFastAgent();

  useEffect(() => {
    registerExternalState(setShowFastAgent, () => showFastAgent);
  }, [registerExternalState, showFastAgent]);

  useEffect(() => {
    if (showFastAgent) setFastAgentHasMounted(true);
  }, [showFastAgent]);

  const handleOpenFastAgentWithPrompt = useCallback(
    (prompt: string) => {
      const normalized = prompt.trim();
      if (!normalized) {
        setShowFastAgent(true);
        return;
      }
      openWithContext({ initialMessage: normalized });
    },
    [openWithContext],
  );

  // Document / task state
  const [isGridMode, setIsGridMode] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"userEvents"> | null>(null);
  const [selectedTaskSource, setSelectedTaskSource] = useState<"today" | "upcoming" | "week" | "other" | null>(null);
  const handleSelectTask = useCallback((id: Id<"userEvents">, source: "today" | "upcoming" | "week" | "other") => {
    setSelectedTaskId(id);
    setSelectedTaskSource(source);
  }, []);
  const clearTaskSelection = useCallback(() => {
    setSelectedTaskId(null);
    setSelectedTaskSource(null);
  }, []);

  // Sources
  const [activeSources, setActiveSources] = useState<string[]>(["ycombinator", "techcrunch", "reddit", "twitter", "github", "arxiv"]);

  // Popovers
  const [hashtagPopover, setHashtagPopover] = useState<{ dossierId: Id<"documents">; hashtag: string; anchorEl: HTMLElement } | null>(null);
  const [mentionPopover, setMentionPopover] = useState<{ documentId: Id<"documents">; anchorEl: HTMLElement } | null>(null);

  // Settings
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsInitialTab, setSettingsTab] = useState<string>("usage");
  const openSettings = useCallback((tab?: string) => {
    if (tab) setSettingsTab(tab);
    setShowSettingsModal(true);
  }, []);

  useEffect(() => {
    if (location.pathname === "/settings" || location.pathname.startsWith("/settings/")) {
      const params = new URLSearchParams(location.search);
      const pathTab = location.pathname.split("/")[2];
      openSettings(params.get("tab") ?? pathTab ?? undefined);
    }
  }, [location.pathname, location.search, openSettings]);

  // Command palette
  const commandPalette = useCommandPalette();
  const paletteWasOpenRef = useRef(false);

  // Previous view tracking for "go back" voice command + scroll restoration
  const previousViewRef = useRef<typeof currentView | null>(null);
  const currentViewRef = useRef(currentView);
  const currentRouteRef = useRef(`${location.pathname}${location.search}`);
  const scrollPositions = useRef<Map<string, number>>(new Map());
  const MAX_SCROLL_ENTRIES = 20;
  useEffect(() => {
    if (currentViewRef.current !== currentView) {
      const focalEl = document.querySelector<HTMLElement>("[data-cockpit-area='center']");
      const scrollChild = focalEl?.querySelector<HTMLElement>(".nb-lazy-view") ?? focalEl;
      if (scrollChild) {
        scrollPositions.current.set(currentViewRef.current, scrollChild.scrollTop);
        if (scrollPositions.current.size > MAX_SCROLL_ENTRIES) {
          const firstKey = scrollPositions.current.keys().next().value;
          if (firstKey !== undefined) scrollPositions.current.delete(firstKey);
        }
      }
      previousViewRef.current = currentViewRef.current;
      currentViewRef.current = currentView;
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>("[data-cockpit-area='center']");
        const target = el?.querySelector<HTMLElement>(".nb-lazy-view") ?? el;
        const saved = scrollPositions.current.get(currentView);
        if (target && saved) {
          target.scrollTop = saved;
        }
      });
    }
  }, [currentView]);

  useEffect(() => {
    const nextRoute = `${location.pathname}${location.search}`;
    if (currentRouteRef.current === nextRoute) {
      return;
    }
    currentRouteRef.current = nextRoute;
    requestAnimationFrame(() => {
      const centerArea = document.querySelector<HTMLElement>("[data-cockpit-area='center']");
      const target = centerArea?.querySelector<HTMLElement>(".nb-lazy-view") ?? centerArea;
      if (target) {
        target.scrollTop = 0;
      }
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (commandPalette.isOpen && !paletteWasOpenRef.current) {
      trackIntentEvent({
        source: "system",
        intentKey: "system.openCommandPalette",
        action: "openCommandPalette",
        status: "handled",
        route: location.pathname,
        targetView: currentView,
        metadata: {
          cockpitMode: mode,
        },
      });
    }
    paletteWasOpenRef.current = commandPalette.isOpen;
  }, [commandPalette.isOpen, currentView, location.pathname, mode, trackIntentEvent]);

  useEffect(() => {
    if (theme.layout !== "cockpit") {
      setLayout("cockpit");
    }
  }, [setLayout, theme.layout]);

  useEffect(() => {
    if (!canonicalPath || !isLegacyRedirect) return;
    const currentFullPath = `${location.pathname}${location.search}`;
    // `useCockpitRouting` rebuilds canonicalPath from surface/view/entity
    // primitives; it does NOT know about cross-cutting params like `view`
    // (edit/read mode). Preserve those here so the legacy redirect can't
    // silently strip the user's mode choice.
    const preserved = new URLSearchParams(location.search);
    const viewParam = preserved.get("view");
    const [pathOnly, canonicalQuery = ""] = canonicalPath.split("?");
    const mergedParams = new URLSearchParams(canonicalQuery);
    if (viewParam === "read") mergedParams.set("view", "read");
    const mergedQuery = mergedParams.toString();
    const targetPath = mergedQuery ? `${pathOnly}?${mergedQuery}` : pathOnly;
    if (currentFullPath === targetPath) return;
    // Defer redirect to next frame — ensures useCockpitRouting state is fully settled
    // before we navigate, preventing stale surface/view in ActiveSurfaceHost
    const rafId = requestAnimationFrame(() => {
      navigate(targetPath, { replace: true });
    });
    return () => cancelAnimationFrame(rafId);
  }, [canonicalPath, isLegacyRedirect, location.pathname, location.search, navigate]);

  const navigateToView = useCallback((view: typeof currentView) => {
    const nextSurface = getSurfaceForView(view);
    // NOTE: runId is intentionally omitted — reading it from stale React state
    // causes the previous trace run to pollute non-trace surface URLs.
    // The trace surface picks up runId from the URL via useCockpitRouting.
    const path = buildCockpitPathForView({
      view,
      entity: null,
      run: null,
      doc: null,
      workspace: null,
      panel: view === "delegation" ? "permissions" : null,
      tab: null,
    });
    const apply = () => {
      startTransition(() => {
        setCurrentView(view);
        navigate(path);
      });
    };
    // Root-level view transitions caused intermittent blank-frame flashing in
    // dogfood video capture. Keep navigation deterministic and let per-surface
    // components own any local motion instead of crossfading the whole app.
    apply();
  }, [navigate, setCurrentView]);

  const navigateToSurface = useCallback((surfaceId: CockpitSurfaceId) => {
    const defaultView = getDefaultViewForSurface(surfaceId);
    setCurrentSurface(surfaceId);
    setCurrentView(defaultView);
    setEntityName(null);
    setResearchHubInitialTab("overview");

    if (surfaceId === "workspace") {
      const lastChatPath = loadLastChatPath();
      if (lastChatPath) {
        navigate(lastChatPath);
        return;
      }
    }
    // NOTE: Always reset to default view when switching surfaces via sidebar.
    // Previously carried over currentView when surface matched, but founder
    // views (entities, coordination) share the "ask" surface and leaked their
    // view into the URL when switching back to Ask.
    navigate(
      buildCockpitPath({
        surfaceId,
        view: null,
        entity: null,
        run: null,
        doc: null,
        workspace: null,
        panel: null,
        tab: null,
      }),
    );
  }, [navigate, setCurrentSurface, setCurrentView, setEntityName, setResearchHubInitialTab]);

  const dispatchDeferred = useCallback((eventName: string, detail?: Record<string, unknown>) => {
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(eventName, detail ? { detail } : undefined));
    }, 0);
  }, []);

  const voiceIntentActions = useMemo(() => ({
    navigateToView: (viewId: string) => {
      const v = viewId as typeof currentView;
      navigateToView(v);
    },
    openSettings: () => openSettings(),
    openCommandPalette: () => window.setTimeout(() => commandPalette.open(), 0),
    createDocument: () => {
      navigateToView("chat-home");
      onDocumentSelect(null);
      dispatchDeferred("document:create");
    },
    createTask: () => {
      navigateToView("chat-home");
      onDocumentSelect(null);
      dispatchDeferred("voice:create-task");
    },
    createEvent: () => {
      navigateToView("nudges-home");
      onDocumentSelect(null);
      dispatchDeferred("voice:create-event");
    },
    setCockpitMode: (m: string) => setMode(m as CockpitMode),
    setLayout: () => setLayout("cockpit"),
    setThemeMode: (m: 'light' | 'dark') => setThemeMode(m),
    toggleTheme: () => setThemeMode(resolvedMode === "dark" ? "light" : "dark"),
    toggleLayout: () => setLayout("cockpit"),
    selectThread: (_index: number) => {
      setShowFastAgent(true);
      setFastAgentHasMounted(true);
      dispatchDeferred("voice:select-thread", { index: _index });
    },
    triggerSearch: (query: string) => {
      const populateVisibleSearchInput = () => {
        const selectors = [
          'input[type="search"]',
          'input[placeholder*="search" i]',
          'input[aria-label*="search" i]',
          'textarea[placeholder*="search" i]',
        ].join(", ");
        const candidates = Array.from(
          document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(selectors),
        ).filter((element) => {
          const htmlElement = element as HTMLElement;
          return !element.disabled && htmlElement.offsetParent !== null;
        });
        const target = candidates[0];
        if (!target) return false;
        target.focus();
        const prototype = target instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        setter?.call(target, query);
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      };

      window.dispatchEvent(new CustomEvent("voice:search", { detail: { query } }));
      if (populateVisibleSearchInput()) return;
      window.requestAnimationFrame(() => {
        if (populateVisibleSearchInput()) return;
        window.setTimeout(() => {
          populateVisibleSearchInput();
        }, 150);
      });
    },
    scrollTo: (position: 'top' | 'bottom') => {
      window.scrollTo({ top: position === 'top' ? 0 : document.body.scrollHeight, behavior: 'smooth' });
    },
    goBack: () => {
      if (previousViewRef.current) {
        navigateToView(previousViewRef.current);
      }
    },
    refresh: () => setRefreshNonce((value) => value + 1),
  }), [commandPalette.open, dispatchDeferred, navigateToView, onDocumentSelect, openSettings, resolvedMode, setFastAgentHasMounted, setLayout, setMode, setShowFastAgent, setThemeMode]);

  const { handleIntent: routeVoiceIntent } = useVoiceIntentRouter(voiceIntentActions);
  const handleVoiceIntent = useCallback(
    (text: string, source: "voice" | "text" = "voice") => {
      if (source === "voice" && text.trim()) {
        setLastVoiceInstruction(text.trim());
      }
      const parsed = parseVoiceIntent(text);
      const handled = routeVoiceIntent(text);
      trackIntentEvent({
        source,
        intentKey: parsed ? `${parsed.intent}.${parsed.action}` : "agent.fallthrough",
        action: parsed?.action ?? "fallthrough",
        status: handled ? "handled" : parsed ? "failed" : "fallback",
        inputText: text,
        route: location.pathname,
        targetView: typeof parsed?.params.view === "string" ? parsed.params.view : undefined,
        metadata: {
          cockpitMode: mode,
          currentView,
        },
      });
      return handled;
    },
    [currentView, location.pathname, mode, routeVoiceIntent, trackIntentEvent],
  );

  // Global event listeners
  useGlobalEventListeners({
    setShowFastAgent,
    setFastAgentThreadId,
    setSelectedDocumentIdsForAgent,
    setCurrentView,
    navigateToView,
    onDocumentSelect,
    setIsGridMode,
    setIsTransitioning,
    setMentionPopover,
    setHashtagPopover,
    openSettings,
  });

  // Deep link: ?doc=<id> opens document context in the current shell.
  useEffect(() => {
    if (documentParam) {
      onDocumentSelect(documentParam as Id<"documents">);
    }
  }, [documentParam, onDocumentSelect]);

  const { close: closePalette } = commandPalette;

  const currentObjective = useMemo(() => {
    const viewTitle = VIEW_MAP[currentView]?.title ?? SURFACE_TITLES[currentSurface];
    if (entityName) return `${viewTitle}: ${entityName}`;
    return viewTitle;
  }, [currentSurface, currentView, entityName]);

  const trackCommandPaletteExecution = useCallback((command: ExecutedCommand) => {
    const targetView =
      command.id.startsWith("nav-")
        ? command.id.replace("nav-", "")
        : command.id === "create-document" || command.id === "create-task"
          ? "chat-home"
          : currentView;
    const action =
      command.section === "navigation"
        ? "navigateToView"
        : command.section === "mode"
          ? "setCockpitMode"
          : command.section === "settings"
            ? "openSettings"
            : command.section === "create"
              ? command.id === "create-task"
                ? "createTask"
                : command.id === "create-event"
                  ? "navigateToView"
                  : "createDocument"
              : "commandAction";
    trackIntentEvent({
      source: "system",
      intentKey: `palette.${command.id}`,
      action,
      status: "handled",
      route: location.pathname,
      targetView,
      metadata: {
        label: command.label,
        section: command.section,
        cockpitMode: mode,
      },
    });
  }, [currentView, location.pathname, mode, trackIntentEvent]);

  // Mode-switch actions for CommandPalette
  const modeSwitchActions: CommandAction[] = useMemo(
    () =>
      MODES.map((m, idx) => ({
        id: `mode-${m.id}`,
        label: `Switch to ${m.label} Mode`,
        description: m.description,
        icon: <span style={{ color: m.color, fontWeight: 700 }}>&#9670;</span>,
        keywords: [m.id, m.label.toLowerCase(), ...m.views],
        section: "mode" as const,
        shortcut: `${isMac ? "\u2325" : "Alt+"}${idx + 1}`,
        action: () => {
          setMode(m.id);
          closePalette();
        },
      })),
    [closePalette, setMode],
  );

  // ARIA live region: announce mode changes to screen readers
  const [modeAnnouncement, setModeAnnouncement] = useState("");
  const modeAnnouncedRef = useRef(false);
  useEffect(() => {
    if (!modeAnnouncedRef.current) {
      modeAnnouncedRef.current = true;
      return;
    }
    setModeAnnouncement(`${modeConfig.label} mode \u2014 ${modeConfig.views.length} views`);
    const timer = setTimeout(() => setModeAnnouncement(""), 3000);
    return () => clearTimeout(timer);
  }, [mode, modeConfig]);

  // Pause infinite HUD animations when tab is hidden
  useEffect(() => {
    const handler = () => {
      document.documentElement.classList.toggle("hud-tab-hidden", document.hidden);
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // Alt+1-5 keyboard shortcuts to switch cockpit modes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) return;
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < MODES.length) {
        e.preventDefault();
        setMode(MODES[idx].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setMode]);

  // ── Onboarding wizard (first visit) ──────────────────────────────────────
  // Only show on main app surfaces (/ or /?surface=...), not on static info pages.
  const INFO_PAGE_PREFIXES = ["/developers", "/pricing", "/changelog", "/legal", "/about", "/api-docs"];
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      const isRootPath =
        typeof window !== "undefined" &&
        window.location.pathname === "/";
      const isMobileAskEntry =
        typeof window !== "undefined" &&
        window.innerWidth < 1280 &&
        isRootPath;
      const hasExplicitProductSurface =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).has("surface");
      const isInfoPage =
        typeof window !== "undefined" &&
        INFO_PAGE_PREFIXES.some((prefix) => window.location.pathname.startsWith(prefix));
      return (
        Boolean(isRootPath) &&
        !localStorage.getItem("nodebench-onboarded") &&
        !isMobileAskEntry &&
        !isInfoPage &&
        !hasExplicitProductSurface
      );
    } catch {
      return false;
    }
  });

  // ── Offline banner ─────────────────────────────────────────────────────
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  // ── Keyboard shortcuts overlay (? key) ────────────────────────────────────
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) return;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }
      if (e.key === "Escape" && showShortcuts) {
        setShowShortcuts(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showShortcuts]);

  // ── Suppress unused var warnings for values kept for downstream compatibility ──
  void refreshNonce;

  const chatHasSession =
    currentView === "chat-home" &&
    (new URLSearchParams(location.search).has("session") || chatDetailChromeHidden);

  return (
    <div
      className={cn(
        "h-[100dvh] overflow-hidden bg-surface cockpit-grid pt-[calc(env(safe-area-inset-top,0px)+22px)] sm:pt-0",
        isDesktopPublicShell && "nb-public-shell",
      )}
      data-left-collapsed={leftCollapsed ? "" : undefined}
      data-right-collapsed=""
      data-public-shell={isDesktopPublicShell ? "" : undefined}
    >
      {/* Offline banner */}
      {isOffline && (
        <div
          className="fixed top-0 left-0 right-0 z-[70] bg-amber-600 text-white text-center py-2 text-sm"
          role="alert"
        >
          You're offline. Some features may be unavailable.
        </div>
      )}

      {/* Onboarding wizard (first visit) */}
      {showOnboarding && (
        <Suspense fallback={null}>
          <OnboardingWizard onClose={() => setShowOnboarding(false)} />
        </Suspense>
      )}

      {/* Screen reader: announce mode changes */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {modeAnnouncement}
      </div>

      {/* JSON-LD metadata for agent crawlers */}
      <AgentMetadata currentView={currentView} currentPath={location.pathname} />

      {/* ── Top: Status Strip ─────────────────────────────────────────── */}
      {!shouldHideStatusStrip && !isStandaloneInfoView && !isDesktopPublicShell && !isObjectFirstActive ? (
        <div style={{ gridArea: "status" }}>
          <StatusStrip
            currentView={currentView}
            entityName={entityName}
            chatHasSession={chatHasSession}
            onOpenPalette={commandPalette.toggle}
          />
        </div>
      ) : null}

      {/* ── Left: WorkspaceRail (replaces ModeRail + CleanSidebar) ──── */}
      <div style={{ gridArea: "left" }}>
        {!isCompactLayout && !isStandaloneInfoView && !isDesktopPublicShell && !isObjectFirstActive ? (
          <WorkspaceRail
            activeSurface={currentSurface}
            onSurfaceChange={navigateToSurface}
            isCollapsed={leftCollapsed}
            onToggleCollapse={() => setLeftCollapsed((v) => !v)}
            onOpenSettings={() => openSettings("usage")}
            onOpenPalette={commandPalette.toggle}
          />
        ) : null}
      </div>

      {/* ── iOS faux chrome (mobile only): status bar + home indicator ── */}
      <IOSChrome />

      {/* ── Compact: MobileTabBar (visible below xl, swaps with WorkspaceRail) ── */}
      <MobileTabBar
        activeSurface={currentSurface}
        onSurfaceChange={navigateToSurface}
        agentActive={showFastAgent}
        hidden={hideMobileBottomChrome || isStandaloneInfoView}
      />

      {/* ── Mobile capture FAB — matches ui_kits/nodebench-mobile/Fab.jsx.
          Hidden together with the bottom chrome so fullscreen flows
          (memo / share / embed) stay clean. */}
      {!hideMobileBottomChrome && !isStandaloneInfoView ? <MobileCaptureFab /> : null}

      {/* ── Center: ActiveSurfaceHost + Agent Panel (resizable) ──────── */}
      <div
        ref={swipeRef}
        style={{ gridArea: "center" }}
        className={cn(
          hideMobileBottomChrome || isStandaloneInfoView
            ? "relative min-w-0 min-h-0 overflow-hidden flex pb-0"
            : "relative min-w-0 min-h-0 overflow-hidden flex pb-[calc(56px+env(safe-area-inset-bottom,0px))] xl:pb-0",
          isDesktopPublicShell && "nb-public-stage",
        )}
        role="main"
        aria-label="Main content"
        data-cockpit-area="center"
      >
        <div className="flex min-h-0 h-full min-w-0 flex-1 flex-col">
          {isDesktopPublicShell ? (
            <ProductTopNav
              activeSurface={currentSurface}
              onSurfaceChange={navigateToSurface}
              onOpenPalette={commandPalette.toggle}
            />
          ) : null}

          <div className="min-h-0 flex-1">
          <ActiveSurfaceHost
            currentSurface={currentSurface}
            currentView={currentView}
            panel={panel}
            entityName={entityName}
            selectedSpreadsheetId={selectedSpreadsheetId}
            setSelectedSpreadsheetId={setSelectedSpreadsheetId}
            selectedDocumentId={selectedDocumentId}
            onDocumentSelect={onDocumentSelect}
            isGridMode={isGridMode}
            setIsGridMode={setIsGridMode}
            selectedTaskId={selectedTaskId}
            selectedTaskSource={selectedTaskSource}
            onSelectTask={handleSelectTask}
            onClearTaskSelection={clearTaskSelection}
            researchHubInitialTab={researchHubInitialTab}
            setResearchHubInitialTab={setResearchHubInitialTab}
            activeSources={activeSources}
            setActiveSources={setActiveSources}
            setCurrentView={setCurrentView}
            setEntityName={setEntityName}
            onNavigateToView={navigateToView}
            onOpenFastAgent={() => setShowFastAgent(true)}
            onOpenFastAgentWithPrompt={handleOpenFastAgentWithPrompt}
            isUnknownRoute={isUnknownRoute}
          />
          </div>
        </div>

      </div>

        {/* ── Layout toggle — floating pill for object-first opt-in ───
             BUG FIX (2026-07-01): on xl+ screens this floated at bottom-4/right-4, the same
             corner as the trace bar's right-aligned clock (line ~932, `ml-auto` timestamp) —
             the toggle's ~34px height overlapped the trace bar's ~28px band, visually clipping
             the clock on every surface where both render (found via live visual-judge scan:
             benchmarks/pulse/changelog/about). Raised the xl offset to clear the trace bar. */}
        {isObjectFirstSurface && !isCompactLayout && !isStandaloneInfoView && !isDesktopPublicShell ? (
          <div className="fixed bottom-16 right-4 z-50 xl:bottom-12">
            <ObjectFirstGlobalToggle showLabel />
          </div>
        ) : null}

        {/* ── Bottom: Trace bar — live status (Datadog pattern) ──────── */}
        {/* ── Agent panel — single slide-over for all breakpoints ─── */}

        {!isStandaloneInfoView && !isMobileAskRoot && !isDesktopPublicShell ? (
        <div
          style={{ gridArea: "trace" }}
          className="hidden items-center gap-4 border-t border-white/[0.06] bg-white/[0.02] px-4 py-1.5 text-[11px] text-content-muted xl:flex"
        >
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/60" />
            Ready
          </span>
          <span className="text-content-muted/60">·</span>
          <span>NodeBench</span>
          <span className="ml-auto tabular-nums">{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        ) : null}

        {/* ── Command Bar — mobile only ── */}
        <div className={`xl:hidden ${isStandaloneInfoView || isMobileAskRoot || hideMobileBottomChrome ? "hidden" : ""}`}>
          <CommandBar
            mode={mode}
            currentView={currentView}
            onViewChange={navigateToView}
            onOpenPalette={commandPalette.toggle}
            onToggleAgent={() => setShowFastAgent((v) => !v)}
            agentOpen={showFastAgent}
          />
        </div>

        {/* ── Unified Agent Panel — single slide-over for all breakpoints ── */}
        {showFastAgent && fastAgentHasMounted && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setShowFastAgent(false)}
              aria-hidden="true"
            />
            {/* Panel */}
            <div
              className="fixed top-0 right-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-white/[0.06] bg-surface shadow-2xl"
              role="complementary"
              aria-label="Ask NodeBench assistant"
            >
              <ErrorBoundary title="Agent Panel Error">
                <Suspense fallback={viewFallback}>
                  <FastAgentPanel
                    isOpen={true}
                    onClose={() => setShowFastAgent(false)}
                    selectedDocumentIds={selectedDocumentIdsForAgent}
                    initialThreadId={fastAgentThreadId}
                    variant="sidebar"
                    openOptions={fastAgentOpenOptions}
                    onOptionsConsumed={clearFastAgentOptions}
                    onVoiceIntent={handleVoiceIntent}
                  />
                </Suspense>
              </ErrorBoundary>
            </div>
          </>
        )}

        {/* Command Palette */}
        <CommandPalette
          isOpen={commandPalette.isOpen}
          onClose={commandPalette.close}
          onCommandExecuted={trackCommandPaletteExecution}
          onCreateDocument={() => {
            navigateToView("chat-home");
            onDocumentSelect(null);
            window.dispatchEvent(new CustomEvent("document:create"));
          }}
          onCreateTask={() => {
            navigateToView("chat-home");
            onDocumentSelect(null);
            dispatchDeferred("voice:create-task");
          }}
          onOpenSettings={() => openSettings("usage")}
          additionalActions={modeSwitchActions}
        />

        {/* Popovers */}
        <MiniEditorPopover
          isOpen={!!mentionPopover}
          documentId={mentionPopover?.documentId || null}
          anchorEl={mentionPopover?.anchorEl || null}
          onClose={() => setMentionPopover(null)}
        />
        <HashtagQuickNotePopover
          isOpen={!!hashtagPopover}
          dossierId={hashtagPopover?.dossierId || null}
          hashtag={hashtagPopover?.hashtag || null}
          anchorEl={hashtagPopover?.anchorEl || null}
          onClose={() => setHashtagPopover(null)}
        />

        {/* Quick-capture FAB is suppressed anywhere the product already presents
            a primary composer: entity notebooks, Home, and Chat. The goal is
            one obvious input surface, not a second floating CTA competing with it. */}
        {isAuthenticated &&
        !location.pathname.startsWith("/entity/") &&
        currentSurface !== "ask" &&
        currentSurface !== "workspace" ? (
          <QuickCaptureWidget />
        ) : null}

        {showSettingsModal && (
          <ErrorBoundary title="Settings failed to load">
            <Suspense fallback={null}>
              <SettingsModal
                isOpen={showSettingsModal}
                onClose={() => setShowSettingsModal(false)}
                initialTab={settingsInitialTab as any}
              />
            </Suspense>
          </ErrorBoundary>
        )}

        {/* Jarvis HUD — disabled, agent panel handles chat */}

        {/* Keyboard shortcuts overlay */}
        {showShortcuts && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowShortcuts(false)}
            role="presentation"
          >
            <div
              className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[rgba(20,22,28,0.96)] p-6 shadow-2xl backdrop-blur-2xl"
              role="dialog"
              aria-label="Keyboard shortcuts"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-base font-semibold text-content">Keyboard Shortcuts</h2>
                <button
                  type="button"
                  onClick={() => setShowShortcuts(false)}
                  className="rounded-lg p-1.5 text-content-muted transition-colors hover:bg-white/[0.06] hover:text-content"
                  aria-label="Close shortcuts panel"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="space-y-3">
                {([
                  [isMac ? "\u2318K" : "Ctrl+K", "Command palette"],
                  [`${isMac ? "\u2325" : "Alt+"}1\u20135`, "Switch surfaces"],
                  ["?", "Keyboard shortcuts"],
                  ["Esc", "Close panel / modal"],
                ] as const).map(([shortcut, label]) => (
                  <div key={shortcut} className="flex items-center justify-between">
                    <span className="text-sm text-content-muted">{label}</span>
                    <kbd className="inline-flex min-w-[2rem] items-center justify-center rounded-md border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-xs font-medium text-content">
                      {shortcut}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
  );
}
