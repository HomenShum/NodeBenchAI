import { memo, useEffect, useState } from "react";
import { useConvexAuth, useQuery} from "convex/react";
import { Activity, Clock, Mic, Shield, TrendingUp, ChevronRight, ChevronLeft, Sparkles, Volume2 } from "lucide-react";
import { useConvexApi } from "@/lib/convexApi";
import { cn } from "@/lib/utils";
import type { CockpitSurfaceId, MainView } from "@/lib/registry/viewRegistry";
import { useVoiceOutput } from "@/hooks/useVoiceOutput";

interface AgentPresenceRailProps {
  currentSurface: CockpitSurfaceId;
  currentView: MainView;
  currentObjective: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onOpenAgent?: () => void;
  lastVoiceInstruction?: string | null;
  isVoiceListening?: boolean;
}

export const AgentPresenceRail = memo(function AgentPresenceRail({
  currentSurface: _currentSurface,
  currentView: _currentView,
  currentObjective,
  isCollapsed = false,
  onToggleCollapse,
  onOpenAgent,
  lastVoiceInstruction,
  isVoiceListening = false,
}: AgentPresenceRailProps) {
  const { isAuthenticated } = useConvexAuth();
  const api = useConvexApi();
  const agentStats = useQuery(
    isAuthenticated && api?.domains.agents.agentHubQueries.getAgentStats
      ? api.domains.agents.agentHubQueries.getAgentStats
      : "skip",
    isAuthenticated ? {} : "skip",
  );

  const pendingApprovals = useQuery(
    isAuthenticated && api?.domains.agents.receipts.actionReceipts.listPendingApprovals
      ? api.domains.agents.receipts.actionReceipts.listPendingApprovals
      : "skip",
    isAuthenticated ? { limit: 5 } : "skip",
  );
  const latestReceipts = useQuery(
    isAuthenticated && api?.domains.agents.receipts.actionReceipts.list
      ? api.domains.agents.receipts.actionReceipts.list
      : "skip",
    isAuthenticated ? { limit: 12 } : "skip",
  );

  const approvalCount = Array.isArray(pendingApprovals) ? pendingApprovals.length : 0;
  const evidenceCount = Array.isArray(latestReceipts) ? latestReceipts.length : 0;
  const successRate = agentStats?.successRate ?? 0;
  const activeAgentCount = agentStats?.activeNow ?? 0;
  const totalAgentCount = agentStats?.totalAgents ?? 0;

  // Voice output state
  const voiceOutput = useVoiceOutput();

  return (
    <aside
      className={cn(
        "relative shrink-0 border-l border-white/[0.06] bg-white/[0.04] backdrop-blur-xl transition-[width] duration-200 ease-in-out",
        isCollapsed ? "w-0 overflow-visible" : "block w-[292px]",
      )}
      role="complementary"
      aria-label="Agent presence rail"
      data-agent-id="cockpit:presence-rail"
    >
      {onToggleCollapse ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="absolute -left-6 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-l-md border border-r-0 border-white/[0.06] bg-white/[0.04] text-content-muted hover:text-content"
          aria-label={isCollapsed ? "Expand agent rail" : "Collapse agent rail"}
        >
          {isCollapsed ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      ) : null}

      <div
        className={cn(
          "flex h-full flex-col gap-3 px-3 py-3",
          isCollapsed ? "pointer-events-none overflow-hidden opacity-0" : "overflow-y-auto opacity-100",
        )}
      >
        {/*
          Removed: the prominent "Ask NodeBench" card at the top of the
          rail. Consolidated into a single app-level trigger in the top
          nav (AskNodeBenchPill, see src/layouts/ProductTopNav.tsx) so
          users see ONE canonical entry instead of 3+ scattered CTAs.
          The rail keeps its per-row / per-selection contextual triggers
          below — those carry specific context into the drawer.
          Keyboard shortcut: Cmd+J (Mac) / Ctrl+J (Win/Linux) works
          from anywhere in the app (see FastAgentContext.tsx).
        */}

        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-content-muted">
              <Activity className="h-3.5 w-3.5" />
              Status
            </div>
            {isAuthenticated ? (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                Live
              </div>
            ) : null}
          </div>
          <div className="mt-2 text-sm font-semibold text-content">{currentObjective}</div>
          {approvalCount > 0 && (
            <div className="mt-2 flex items-center gap-2 text-xs text-amber-400">
              <Shield className="h-3.5 w-3.5" />
              {approvalCount} action{approvalCount === 1 ? "" : "s"} waiting
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5" data-agent-id="cockpit:runtime-metrics">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-content-muted">
            <TrendingUp className="h-3.5 w-3.5" />
            Runtime metrics
          </div>
          {successRate > 0 || evidenceCount > 0 || activeAgentCount > 0 ? (
            <div className="mt-3 space-y-3">
              <MetricBar label="Success rate" value={`${successRate}%`} progress={successRate} tone="emerald" />
              <MetricBar label="Evidence" value={`${evidenceCount} receipts`} progress={Math.min(100, evidenceCount * 8)} tone="cyan" />
              <MetricBar
                label="Active agents"
                value={totalAgentCount > 0 ? `${activeAgentCount}/${totalAgentCount}` : `${activeAgentCount}`}
                progress={totalAgentCount > 0 ? (activeAgentCount / totalAgentCount) * 100 : 0}
                tone="amber"
              />
              <LatencyBadge />
            </div>
          ) : (
            <div className="mt-3 space-y-1.5 text-xs text-content-muted">
              <span className="text-content-muted">Metrics appear as you search and delegate</span>
              <LatencyBadge />
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-3" data-agent-id="cockpit:voice">
          <div className="flex items-center gap-2 text-xs text-content-muted">
            {isVoiceListening ? (
              <>
                <span className="relative flex h-3.5 w-3.5 items-center justify-center">
                  <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                <span className="font-medium text-red-400">Listening...</span>
              </>
            ) : (
              <>
                <Mic className="h-3.5 w-3.5 text-emerald-400" />
                {lastVoiceInstruction ? (
                  <span className="truncate" title={lastVoiceInstruction}>Last: {lastVoiceInstruction}</span>
                ) : (
                  "Voice input available"
                )}
              </>
            )}
          </div>

          {/* Voice output status + toggle */}
          <div className="mt-2 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-content-muted">
              {voiceOutput.isSpeaking ? (
                <>
                  <span className="relative flex h-3.5 w-3.5 items-center justify-center">
                    <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-violet-400 opacity-75" />
                    <Volume2 className="relative h-3.5 w-3.5 text-violet-400" />
                  </span>
                  <span className="font-medium text-violet-400">Speaking...</span>
                </>
              ) : (
                <>
                  <Volume2 className="h-3.5 w-3.5" />
                  <span>Voice output: {voiceOutput.isEnabled ? "on" : "off"}</span>
                  {voiceOutput.backend === "elevenlabs" && (
                    <span className="rounded bg-violet-500/20 px-1 py-0.5 text-[10px] text-violet-400">ElevenLabs</span>
                  )}
                </>
              )}
            </div>
            <button
              type="button"
              onClick={voiceOutput.toggleEnabled}
              className={cn(
                "flex h-5 w-9 items-center rounded-full px-0.5 transition-colors",
                voiceOutput.isEnabled ? "bg-violet-500/40" : "bg-white/10",
              )}
              aria-label={voiceOutput.isEnabled ? "Disable voice output" : "Enable voice output"}
              title={voiceOutput.isEnabled ? "Disable voice output" : "Enable voice output"}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                  voiceOutput.isEnabled ? "translate-x-3.5" : "translate-x-0",
                )}
              />
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
});

function MetricBar({
  label,
  value,
  progress,
  tone,
}: {
  label: string;
  value: string;
  progress: number;
  tone: "emerald" | "cyan" | "amber";
}) {
  const color =
    tone === "emerald"
      ? "bg-emerald-400"
      : tone === "cyan"
        ? "bg-cyan-400"
        : "bg-amber-400";

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-content-muted">{label}</span>
        <span className="font-semibold text-content">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} />
      </div>
    </div>
  );
}

/**
 * LatencyBadge shows average tool dispatch latency with color coding.
 * Fetches from the MCP gateway health endpoint.
 *
 * Color thresholds:
 *   < 200ms  -> emerald (fast)
 *   200-500ms -> amber (acceptable)
 *   > 500ms  -> rose (slow)
 */
const GATEWAY_HEALTH_URL = "/mcp/health";

function LatencyBadge() {
  const [avgMs, setAvgMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(GATEWAY_HEALTH_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.latency?.p50 != null) {
          setAvgMs(data.latency.p50);
        }
      })
      .catch(() => {
        if (!cancelled) setAvgMs(null);
      });
    return () => { cancelled = true; };
  }, []);

  const hasLatency = avgMs != null;
  const displayMs = avgMs ?? 0;
  const color =
    !hasLatency
      ? "text-content-muted"
      : displayMs < 200
      ? "text-emerald-400"
      : displayMs <= 500
        ? "text-amber-400"
        : "text-rose-400";
  const dotColor =
    !hasLatency
      ? "bg-content-muted"
      : displayMs < 200
      ? "bg-emerald-400"
      : displayMs <= 500
        ? "bg-amber-400"
        : "bg-rose-400";

  return (
    <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5" data-agent-id="cockpit:latency-badge">
      <div className="flex items-center gap-1.5 text-xs text-content-muted">
        <Clock className="h-3 w-3" />
        Avg latency
      </div>
      <div className={cn("flex items-center gap-1.5 text-xs font-semibold tabular-nums", color)}>
        <span className={cn("inline-block h-1.5 w-1.5 rounded-full", dotColor)} />
        {hasLatency ? `${displayMs}ms` : "Unavailable"}
      </div>
    </div>
  );
}

export default AgentPresenceRail;
