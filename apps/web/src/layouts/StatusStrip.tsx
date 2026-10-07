import { memo, useEffect, useRef, useState } from "react";
import { useConvexAuth } from "convex/react";
import { Search } from "lucide-react";
import { useOnlineStatus } from "@/lib/performance/useOnlineStatus";
import { VIEW_TITLES } from "./cockpitModes";
import type { MainView } from "@/lib/registry/viewRegistry";

type SystemStatus = "operational" | "degraded" | "offline";
type ConnectionState = "offline" | "degraded" | "loading" | "authenticated" | "guest";

function useSystemStatus(
  isLoading: boolean,
  online: boolean,
  convexConnected: boolean,
): SystemStatus {
  const [convexDegraded, setConvexDegraded] = useState(false);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLoading) {
      loadingTimerRef.current = setTimeout(() => {
        setConvexDegraded(true);
      }, 5000);
    } else {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
      setConvexDegraded(false);
    }
    return () => {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
      }
    };
  }, [isLoading]);

  if (!online) return "offline";
  if (!convexConnected || convexDegraded) return "degraded";
  return "operational";
}

const CONNECTION_CONFIG: Record<ConnectionState, { dotClass: string; label: string }> = {
  offline: { dotClass: "bg-red-500", label: "You are offline" },
  degraded: { dotClass: "bg-amber-400", label: "Session connection delayed" },
  loading: { dotClass: "bg-amber-400 animate-pulse", label: "Checking session" },
  authenticated: { dotClass: "bg-emerald-500", label: "Connected" },
  guest: { dotClass: "bg-slate-400", label: "Guest session" },
};

function resolveConnectionState(
  systemStatus: SystemStatus,
  isLoading: boolean,
  isAuthenticated: boolean,
): ConnectionState {
  if (systemStatus === "offline") return "offline";
  if (systemStatus === "degraded") return "degraded";
  if (isLoading) return "loading";
  return isAuthenticated ? "authenticated" : "guest";
}

interface StatusStripProps {
  currentView: MainView;
  entityName?: string | null;
  chatHasSession?: boolean;
  onOpenPalette?: () => void;
}

export const StatusStrip = memo(function StatusStrip({
  currentView,
  entityName,
  onOpenPalette,
}: StatusStripProps) {
  const viewTitle = VIEW_TITLES[currentView] ?? currentView;
  const isChatView = viewTitle === "Chat";
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { online, convexConnected } = useOnlineStatus();
  const systemStatus = useSystemStatus(isLoading, online, convexConnected);
  const connectionState = resolveConnectionState(systemStatus, isLoading, isAuthenticated);
  const { dotClass: statusDotClass, label: connectionLabel } = CONNECTION_CONFIG[connectionState];
  const headerTitle = entityName?.trim() || "Chat";

  if (isChatView) {
    return (
      <header
        className="relative flex shrink-0 items-center justify-between border-b border-white/[0.08] bg-[rgba(15,18,23,0.98)] px-4 pb-2.5 pt-[max(10px,env(safe-area-inset-top))] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_14px_30px_-20px_rgba(0,0,0,0.78)] backdrop-blur-2xl"
        role="banner"
        data-agent-id="cockpit:status-strip"
      >
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold tracking-[-0.02em] text-gray-50">
            {headerTitle}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-400">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${statusDotClass}`}
              aria-label={connectionLabel}
              role="status"
            />
            <span>{connectionLabel}</span>
          </div>
        </div>

        {onOpenPalette ? (
          <button
            type="button"
            onClick={onOpenPalette}
            className="nb-pressable inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.04] text-gray-100 shadow-[0_12px_26px_-18px_rgba(0,0,0,0.92)] transition hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40"
            aria-label="Open search"
          >
            <Search className="h-4.5 w-4.5" />
          </button>
        ) : null}
      </header>
    );
  }

  return (
    <header
      className="flex h-8 shrink-0 select-none items-center gap-3 border-b border-white/[0.06] bg-white/[0.01] px-4"
      role="banner"
      data-agent-id="cockpit:status-strip"
    >
      <nav
        className="flex min-w-0 items-center gap-1.5 text-[12px] tracking-wide"
        aria-label="Breadcrumb"
      >
        <span className="font-semibold uppercase text-content-muted">NODEBENCH</span>
        <span className="text-content-muted/60" aria-hidden="true">
          /
        </span>
        <span className="truncate font-medium text-content-muted">{viewTitle}</span>
        {entityName ? (
          <>
            <span className="text-content-muted/60" aria-hidden="true">
              /
            </span>
            <span className="max-w-[160px] truncate font-medium text-content-muted" title={entityName}>
              {entityName}
            </span>
          </>
        ) : null}
        <span className="ml-1.5 flex items-center gap-1" title={connectionLabel}>
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${statusDotClass}`}
            aria-label={connectionLabel}
            role="status"
          />
        </span>
      </nav>

      <div className="flex-1" />

      <div className="hidden shrink-0 items-center gap-2 text-[12px] text-content-muted/70 xl:flex">
        <span>{connectionLabel}</span>
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${statusDotClass}`}
          title={connectionLabel}
          aria-hidden="true"
        />
      </div>
      {onOpenPalette ? (
        <button
          type="button"
          onClick={onOpenPalette}
          className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.08] text-content-muted/80 transition hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40"
          aria-label="Open search"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </header>
  );
});
