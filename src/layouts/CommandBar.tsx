/**
 * CommandBar - bottom cockpit control strip.
 *
 * Left: mode-specific sub-views
 * Center: command surface entry point
 * Right: agent panel toggle
 */

import { useNavigate } from "react-router-dom";
import { memo, useCallback, useMemo } from "react";
import { useConvexAuth, useQuery} from "convex/react";
import { useConvexApi } from "@/lib/convexApi";
import { MessageSquare } from "lucide-react";
import {
  ICON_MAP,
  MODES,
  type CockpitMode,
  VIEW_TITLES,
} from "./cockpitModes";
import type { MainView } from "@/lib/registry/viewRegistry";
import { buildCockpitPathForView } from "@/lib/registry/viewRegistry";
import { haptic } from "@/lib/haptics";

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);

interface CommandBarProps {
  mode: CockpitMode;
  currentView: MainView;
  onViewChange: (view: MainView) => void;
  onOpenPalette: () => void;
  onToggleAgent?: () => void;
  agentOpen?: boolean;
}

/** Badge counts from live Convex subscriptions — isolated here to avoid re-rendering CockpitLayout. */
function useBadgeCounts(): Partial<Record<CockpitMode, number>> {
  const api = useConvexApi();

  const { isAuthenticated } = useConvexAuth();
  const agentStats = useQuery(
    isAuthenticated && api?.domains.agents.agentHubQueries.getAgentStats
      ? api.domains.agents.agentHubQueries.getAgentStats
      : "skip",
    isAuthenticated ? {} : "skip",
  );
  const pendingHITL = useQuery(
    isAuthenticated && api?.domains.hitl.adjudicationWorkflow.getPendingAdjudicationRequests
      ? api.domains.hitl.adjudicationWorkflow.getPendingAdjudicationRequests
      : "skip",
    isAuthenticated ? {} : "skip",
  );
  return useMemo(() => {
    const counts: Partial<Record<CockpitMode, number>> = {};
    const activeAgents = agentStats?.activeNow ?? 0;
    if (activeAgents > 0) counts.agents = activeAgents;
    const pendingCount = Array.isArray(pendingHITL) ? pendingHITL.length : 0;
    if (pendingCount > 0) counts.system = pendingCount;
    return counts;
  }, [agentStats, pendingHITL]);
}

export const CommandBar = memo(function CommandBar({
  mode,
  currentView,
  onViewChange,
  onOpenPalette,
  onToggleAgent,
  agentOpen,
}: CommandBarProps) {
  const navigate = useNavigate();
  const badgeCounts = useBadgeCounts();
  const modeConfig = MODES.find((entry) => entry.id === mode);
  const modeViews = modeConfig?.views ?? [];

  const handleViewClick = useCallback((view: MainView) => {
    haptic("light");
    onViewChange(view);
    navigate(buildCockpitPathForView({ view }));
  }, [navigate, onViewChange]);



  return (
    <footer
      className="hud-border-t hud-glass hud-depth-bottom hud-mono shrink-0 select-none"
      aria-label="Command bar"
      data-agent-id="cockpit:command-bar"
    >
      {/* ── Desktop: sub-view tabs within current mode (unchanged) ── */}
      {modeViews.length > 1 && (
        <div
          role="navigation"
          className="hidden lg:flex overflow-x-auto scrollbar-none hud-border-b"
          aria-label="Sub-view navigation"
        >
          {modeViews.map((view) => {
            const isViewActive = view === currentView;
            return (
              <button
                key={view}
                type="button"
                className="hud-tab flex-none h-8"
                data-active={isViewActive ? "true" : undefined}
                aria-current={isViewActive ? "page" : undefined}
                style={isViewActive ? { color: modeConfig?.color } : undefined}
                onClick={() => handleViewClick(view)}
                data-agent-id={`cockpit:mobile-view:${view}`}
                data-agent-action="navigate"
                data-agent-label={VIEW_TITLES[view] ?? view}
              >
                {VIEW_TITLES[view] ?? view}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Desktop: full mode tabs (hidden on mobile) ── */}
      <div
        role="navigation"
        className="hidden lg:flex items-center h-14 px-1 justify-around"
        aria-label="Mode navigation"
      >
        {MODES.map((entry) => {
          const isActive = mode === entry.id;
          const Icon = ICON_MAP[entry.icon];
          return (
            <button
              key={entry.id}
              type="button"
              className="hud-mobile-tab"
              data-active={isActive ? "true" : undefined}
              onClick={() => handleViewClick(entry.defaultView)}
              aria-label={entry.label}
              aria-current={isActive ? "page" : undefined}
              style={isActive ? { color: entry.color } : undefined}
              data-agent-id={`cockpit:mobile-tab:${entry.id}`}
              data-agent-action="navigate"
              data-agent-label={entry.label}
            >
              <span className="w-5 h-5 flex items-center justify-center">
                {Icon ? <Icon className="w-4 h-4" /> : null}
              </span>
              <span className="text-[9px] font-mono">{entry.label}</span>
              {!!badgeCounts?.[entry.id] && (
                <span
                  className="hud-mobile-badge"
                  style={{ background: entry.color }}
                  aria-label={`${badgeCounts[entry.id]} pending`}
                />
              )}
            </button>
          );
        })}
        {onToggleAgent && (
          <button
            type="button"
            className="hud-mobile-tab"
            data-active={agentOpen ? "true" : undefined}
            onClick={onToggleAgent}
            aria-label={agentOpen ? "Close agent panel" : "Open agent panel"}
            style={agentOpen ? { color: "#d97757" } : undefined}
            data-agent-id="cockpit:mobile-tab:agent"
            data-agent-action="toggle"
            data-agent-label="Agent"
          >
            <span className="w-5 h-5 flex items-center justify-center">
              <MessageSquare className="w-4 h-4" />
            </span>
            <span className="text-[9px] font-mono">Agent</span>
          </button>
        )}
      </div>

      {/* Mobile surface navigation has been moved to MobileTabBar.tsx */}

      <div className="hidden lg:flex items-center justify-between h-10 px-4 gap-4">
        {/* Left: mode tabs */}
        <div
          role="navigation"
          className="flex items-center gap-1 overflow-x-auto scrollbar-none min-w-0"
          aria-label="Mode views"
        >
          {modeViews.map((view) => (
            <button
              key={view}
              type="button"
              className="hud-tab"
              data-active={view === currentView ? "true" : undefined}
              aria-current={view === currentView ? "page" : undefined}
              style={view === currentView ? { color: modeConfig?.color } : undefined}
              onClick={() => handleViewClick(view)}
              data-agent-id={`cockpit:tab:${view}`}
              data-agent-action="navigate"
              data-agent-label={VIEW_TITLES[view] ?? view}
            >
              {VIEW_TITLES[view] ?? view}
            </button>
          ))}
        </div>

        {/* Center: subtle palette hint — Cmd+K shortcut is the real trigger */}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onOpenPalette}
          className="inline-flex items-center gap-1.5 text-[10px] text-content-muted/40 transition-colors hover:text-content-muted"
          aria-label="Open command palette"
          data-agent-id="cockpit:action:palette"
          data-agent-action="search"
          data-agent-label="Open command palette"
        >
          <kbd className="rounded border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5">{isMac ? "⌘K" : "Ctrl+K"}</kbd>
        </button>
      </div>
    </footer>
  );
});
