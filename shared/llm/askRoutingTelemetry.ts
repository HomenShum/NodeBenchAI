/**
 * shared/llm/askRoutingTelemetry.ts — pure aggregation for LLM-router
 * observability (LLM Router roadmap #3).
 *
 * `convex/events.ts:getAskRoutingTelemetry` does a BOUNDED read of recent
 * `liveEventAnswers` rows and hands them here. Keeping the math in a pure,
 * dependency-free function (no `ctx.db`, no Convex types) means it can be
 * scenario-tested directly with plain arrays — exactly like `router.ts` itself
 * — and guarantees DETERMINISTIC output (sorted breakdowns, no Date/random).
 *
 * Floor vs. escalated is decided by the SAME `modelId.includes("haiku")`
 * convention the cost estimator in events.ts and the router's Haiku floor use,
 * so the panel can never disagree with what was actually billed/routed.
 *
 * Honesty (.claude/rules/agentic_reliability.md):
 *   - HONEST_SCORES: rates are `null` (not a fabricated 0%) when there's no
 *     denominator. The panel renders "—" for null.
 *   - DETERMINISTIC: same rows in → same object out; breakdowns are sorted by
 *     count then key.
 *   - BOUND lives in the caller (`.take(cap)`); this function is O(n) over
 *     whatever bounded slice it's given.
 */

/** The fields of a `liveEventAnswers` row this aggregate reads. Bounded subset. */
export interface AskRoutingRow {
  agentMode?: "deterministic" | "provider" | "provider_fallback" | "cache" | null;
  provider?: string | null;
  modelId?: string | null;
  estimatedCostCents?: number | null;
}

export type RouteTierBucket = "floor" | "escalated" | "other";

export interface AskRoutingTelemetry {
  /** Total /ask answers scanned (all modes). */
  total: number;
  /** True when the scan hit the read cap (more rows exist than were scanned). */
  capped: boolean;
  /** Answers that actually reached a model (provider + provider_fallback). */
  routedCount: number;
  /** Routed answers served by the Haiku floor. */
  floorCount: number;
  /** Routed answers that escalated above the floor (Sonnet / pinned heavy). */
  escalatedCount: number;
  /** escalated / (floor + escalated). Null when no routed answer recorded a model. */
  escalationRate: number | null;
  /** provider_fallback / (provider + provider_fallback). Null when no provider attempts. */
  providerFallbackRate: number | null;
  /** Avg estimated cost (cents) per routed answer. Null when nothing routed. */
  avgCostCents: number | null;
  /** Total estimated cost (cents) across routed answers. */
  totalCostCents: number;
  /** Count by agentMode across ALL scanned answers. */
  agentModes: { provider: number; provider_fallback: number; cache: number; deterministic: number };
  /** Routed-answer count per model id, sorted by count desc then id. */
  modelMix: Array<{ modelId: string; count: number; tier: RouteTierBucket }>;
  /** Routed-answer count per provider, sorted by count desc then provider. */
  providerMix: Array<{ provider: string; count: number }>;
}

function round(x: number, p: number): number {
  return Math.round(x * 10 ** p) / 10 ** p;
}

/** Classify a model id into the router's floor/escalated buckets. */
export function tierForModelId(modelId: string): RouteTierBucket {
  if (!modelId) return "other";
  // The router's ask_answer floor is Haiku; anything else it climbed up to.
  return modelId.toLowerCase().includes("haiku") ? "floor" : "escalated";
}

/**
 * Aggregate a bounded slice of recent /ask answers into the routing telemetry
 * the panel renders. `capped` is passed in by the caller (it knows whether the
 * slice hit the read cap).
 */
export function aggregateAskRouting(rows: readonly AskRoutingRow[], capped: boolean): AskRoutingTelemetry {
  const agentModes = { provider: 0, provider_fallback: 0, cache: 0, deterministic: 0 };
  const providers: Record<string, number> = {};
  const models: Record<string, { count: number; tier: RouteTierBucket }> = {};
  let floorCount = 0;
  let escalatedCount = 0;
  let routedCount = 0;
  let routedCostCentsTotal = 0;

  for (const r of rows) {
    const mode = (r.agentMode ?? "deterministic") as keyof typeof agentModes;
    if (mode in agentModes) agentModes[mode] += 1;

    const reachedModel = mode === "provider" || mode === "provider_fallback";
    if (!reachedModel) continue;

    routedCount += 1;
    routedCostCentsTotal += r.estimatedCostCents ?? 0;

    const provider = (r.provider ?? "unknown").trim() || "unknown";
    providers[provider] = (providers[provider] ?? 0) + 1;

    const modelId = (r.modelId ?? "").trim();
    const tier = tierForModelId(modelId);
    if (tier === "floor") floorCount += 1;
    else if (tier === "escalated") escalatedCount += 1;

    const modelKey = modelId || "(unrecorded model)";
    if (!models[modelKey]) models[modelKey] = { count: 0, tier };
    models[modelKey].count += 1;
  }

  const tierDenom = floorCount + escalatedCount;
  const fallbackAttempts = agentModes.provider + agentModes.provider_fallback;

  const modelMix = Object.entries(models)
    .map(([modelId, v]) => ({ modelId, count: v.count, tier: v.tier }))
    .sort((a, b) => b.count - a.count || a.modelId.localeCompare(b.modelId));
  const providerMix = Object.entries(providers)
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider));

  return {
    total: rows.length,
    capped,
    routedCount,
    floorCount,
    escalatedCount,
    escalationRate: tierDenom > 0 ? round(escalatedCount / tierDenom, 3) : null,
    providerFallbackRate:
      fallbackAttempts > 0 ? round(agentModes.provider_fallback / fallbackAttempts, 3) : null,
    avgCostCents: routedCount > 0 ? round(routedCostCentsTotal / routedCount, 4) : null,
    totalCostCents: round(routedCostCentsTotal, 4),
    agentModes,
    modelMix,
    providerMix,
  };
}
