/**
 * LlmRoutingPanel — operator-facing observability for the NodeBench LLM Router.
 *
 * Surfaces the EXISTING per-answer routing telemetry that the `/ask` path
 * persists on `liveEventAnswers` (modelId / provider / agentMode /
 * estimatedCostCents) so an operator can SEE `shared/llm/router.ts`'s
 * `routeLLM("ask_answer", …)` decision working in production: how often the
 * cheap Haiku floor served the turn vs. escalated to Sonnet, avg cost/answer,
 * and the provider-fallback rate.
 *
 * Pattern: read-only projection over a bounded aggregate.
 * Data source: `api.events.getAskRoutingTelemetry` (convex/events.ts) — a
 *   GLOBAL, ≤1000-row bounded scan. Additive; does NOT touch routeLLM or the
 *   /ask write path.
 *
 * Honesty (.claude/rules/agentic_reliability.md → HONEST_SCORES):
 *   - Every number comes from the query. Rates that have no denominator arrive
 *     as `null` and render "—" / a "no data yet" empty state — never a fake 0%.
 *   - No animation; respects prefers-reduced-motion by construction.
 *
 * See: shared/llm/router.ts, docs/architecture/LLM_ROUTER.md
 */
import { memo } from "react";
import { useQuery } from "convex/react";
import { Cpu, ArrowUpRight, ShieldAlert } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/utils";
import { SurfaceSection, SurfaceCard, SurfaceGrid, SurfaceStat, SurfaceBadge } from "@/shared/ui/SurfacePrimitives";
import type { AskRoutingTelemetry } from "shared/llm/askRoutingTelemetry";

const TERRACOTTA = "#d97757";

/** Format a 0..1 rate as a percent string, or an honest dash when null. */
function pct(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? "—" : `${Math.round(rate * 100)}%`;
}

/** Format cents to a compact $ string, or an honest dash when null. */
function centsToUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toFixed(4)}`;
}

const SECTION_HEADER = "text-[11px] uppercase tracking-[0.2em] text-content-muted";

/** Empty state — shown when the query returns no routed /ask traffic. */
const RoutingEmptyState = memo(function RoutingEmptyState() {
  return (
    <SurfaceCard data-agent-action="llm-routing-empty">
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <Cpu className="h-5 w-5 text-content-muted" aria-hidden="true" />
        <p className="text-sm font-medium text-content-secondary">No routed /ask traffic yet</p>
        <p className="max-w-md text-xs text-content-muted">
          The LLM router records a decision on every <code className="font-mono">/ask</code> answer
          that reaches a provider. Once attendees ask questions in a live event room, the model mix
          (Haiku floor vs. Sonnet escalation), escalation rate, and cost per answer appear here.
        </p>
      </div>
    </SurfaceCard>
  );
});

/** A labeled horizontal bar in a small distribution list. */
const DistributionRow = memo(function DistributionRow({
  label,
  count,
  total,
  accent,
}: {
  label: string;
  count: number;
  total: number;
  accent?: string;
}) {
  const widthPct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-44 shrink-0 truncate font-mono text-xs text-content-secondary" title={label}>
        {label}
      </span>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.04]"
        role="presentation"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${widthPct}%`, backgroundColor: accent ?? "rgba(255,255,255,0.25)" }}
        />
      </div>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-content-muted">
        {count} ({widthPct}%)
      </span>
    </div>
  );
});

export interface LlmRoutingPanelProps {
  /** Override the data (used in tests/storybook). When omitted, queries live data. */
  dataOverride?: AskRoutingTelemetry | null | undefined;
}

/**
 * The routing observability panel. Composes into the telemetry surface as a
 * `SurfaceSection`. Loading (undefined) → skeleton-ish card; empty → empty
 * state; data → stat grid + distributions.
 */
export const LlmRoutingPanel = memo(function LlmRoutingPanel({ dataOverride }: LlmRoutingPanelProps) {
  const liveData = useQuery(api.events.getAskRoutingTelemetry, {}) as AskRoutingTelemetry | undefined;
  const data = dataOverride !== undefined ? dataOverride : liveData;

  const isLoading = data === undefined;
  const isEmpty = !!data && data.routedCount === 0;

  const action = (
    <span className="text-xs text-content-muted tabular-nums">
      {data ? `${data.total} /ask answers${data.capped ? " (capped at 1000)" : ""}` : "loading…"}
    </span>
  );

  return (
    <SurfaceSection
      title="LLM Routing"
      subtitle="How the router splits /ask answers between the Haiku floor and Sonnet escalation — live, from real answers."
      action={action}
      data-agent-id="llm-routing"
    >
      {isLoading ? (
        <SurfaceCard data-agent-action="llm-routing-loading">
          <div className="flex items-center gap-2 py-4 text-sm text-content-muted">
            <Cpu className="h-4 w-4 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
            Loading routing telemetry…
          </div>
        </SurfaceCard>
      ) : isEmpty || !data ? (
        <RoutingEmptyState />
      ) : (
        <div className="flex flex-col gap-4" role="region" aria-label="LLM routing telemetry">
          {/* Headline stats */}
          <SurfaceGrid>
            <SurfaceCard data-agent-action="llm-routing-routed">
              <SurfaceStat
                value={data.routedCount}
                label="Routed /ask answers"
                sublabel={`${data.total} total · ${data.agentModes.cache} cache · ${data.agentModes.deterministic} deterministic`}
              />
            </SurfaceCard>
            <SurfaceCard data-agent-action="llm-routing-escalation">
              <div className="flex flex-col gap-1">
                <span
                  className="text-2xl font-semibold tabular-nums"
                  style={{ color: data.escalationRate === null ? undefined : TERRACOTTA }}
                >
                  {pct(data.escalationRate)}
                </span>
                <span className={SECTION_HEADER}>Escalation rate</span>
                <span className="text-[10px] text-content-muted">
                  {data.escalatedCount} Sonnet / {data.floorCount} Haiku floor
                </span>
              </div>
            </SurfaceCard>
            <SurfaceCard data-agent-action="llm-routing-cost">
              <SurfaceStat
                value={centsToUsd(data.avgCostCents)}
                label="Avg cost / answer"
                sublabel={`${centsToUsd(data.totalCostCents)} across routed answers`}
              />
            </SurfaceCard>
            <SurfaceCard data-agent-action="llm-routing-fallback">
              <div className="flex flex-col gap-1">
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-2xl font-semibold tabular-nums",
                    data.providerFallbackRate && data.providerFallbackRate > 0
                      ? "text-amber-400"
                      : "text-content",
                  )}
                >
                  {data.providerFallbackRate && data.providerFallbackRate > 0 && (
                    <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                  )}
                  {pct(data.providerFallbackRate)}
                </span>
                <span className={SECTION_HEADER}>Provider-fallback rate</span>
                <span className="text-[10px] text-content-muted">
                  share of provider attempts that fell back
                </span>
              </div>
            </SurfaceCard>
          </SurfaceGrid>

          {/* Model mix (floor vs escalated) */}
          <SurfaceCard data-agent-action="llm-routing-model-mix">
            <div className="mb-3 flex items-center gap-2">
              <ArrowUpRight className="h-4 w-4 text-content-muted" aria-hidden="true" />
              <span className={SECTION_HEADER}>Model mix</span>
            </div>
            <div className="flex flex-col gap-2">
              {data.modelMix.map((m) => (
                <div key={m.modelId} className="flex items-center gap-3">
                  <DistributionRow
                    label={m.modelId}
                    count={m.count}
                    total={data.routedCount}
                    accent={m.tier === "escalated" ? TERRACOTTA : "rgba(255,255,255,0.35)"}
                  />
                  <SurfaceBadge tone={m.tier === "escalated" ? "warning" : m.tier === "floor" ? "info" : "neutral"}>
                    {m.tier === "escalated" ? "escalated" : m.tier === "floor" ? "floor" : "other"}
                  </SurfaceBadge>
                </div>
              ))}
            </div>
          </SurfaceCard>

          {/* Provider / agentMode mix */}
          <SurfaceCard data-agent-action="llm-routing-provider-mix">
            <div className="mb-3 flex items-center gap-2">
              <Cpu className="h-4 w-4 text-content-muted" aria-hidden="true" />
              <span className={SECTION_HEADER}>Provider mix</span>
            </div>
            <div className="flex flex-col gap-2">
              {data.providerMix.map((p) => (
                <DistributionRow
                  key={p.provider}
                  label={p.provider}
                  count={p.count}
                  total={data.routedCount}
                />
              ))}
            </div>
          </SurfaceCard>
        </div>
      )}
    </SurfaceSection>
  );
});

export default LlmRoutingPanel;
