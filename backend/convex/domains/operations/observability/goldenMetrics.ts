/**
 * goldenMetrics.ts — the three golden agent metrics, by exact name.
 *
 *   "task-completion-rate"  — latest swarm_evolution cron result
 *                             (actionItemQuality.completionRate,
 *                             backend/convex/domains/agents/autonomousCrons.ts)
 *   "tool-call-error-rate"  — errors / calls over the modelRouterCalls window,
 *                             same computation as getRoutingStats in
 *                             backend/convex/domains/ai/models/modelRouterQueries.ts.
 *                             SCOPING: this counts MODEL-call errors — the model
 *                             router is the closest true measure of tool-call
 *                             failures this runtime records; per-tool MCP errors
 *                             are recorded in the Node worker, not here.
 *   "p99-latency-ms"        — NOT visible from Convex. The source
 *                             (McpSession.getLatencyPercentiles) lives in the
 *                             Node worker runtime; the exact name is exposed on
 *                             its existing /mcp/health surface
 *                             (workers/node/mcpGateway.ts healthHandler).
 *                             Reported as null here rather than inventing a
 *                             cross-runtime aggregator.
 */

import { v } from "convex/values";
import { query } from "../../../_generated/server";

/** Pure computation — unit-testable without a Convex harness. */
export function computeGoldenMetrics(input: {
  /** Model-router calls in the window (success flag per call). */
  modelCalls: Array<{ success: boolean }>;
  /** Latest swarm_evolution actionItemQuality.completionRate (0-1), or null. */
  completionRate: number | null;
  /** p99 tool-call latency in ms, or null when the worker runtime isn't visible. */
  p99LatencyMs: number | null;
}): {
  "task-completion-rate": number | null;
  "tool-call-error-rate": number;
  "p99-latency-ms": number | null;
} {
  const errors = input.modelCalls.filter((c) => !c.success).length;
  return {
    "task-completion-rate": input.completionRate,
    // Model-call errors / total model calls (see scoping note above).
    "tool-call-error-rate":
      input.modelCalls.length > 0 ? errors / input.modelCalls.length : 0,
    "p99-latency-ms": input.p99LatencyMs,
  };
}

/** Query the three golden metrics from live data (last 24h of model calls). */
export const getGoldenMetrics = query({
  args: {},
  returns: v.object({
    "task-completion-rate": v.union(v.number(), v.null()),
    "tool-call-error-rate": v.number(),
    "p99-latency-ms": v.union(v.number(), v.null()),
  }),
  handler: async (ctx) => {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const calls = await ctx.db
      .query("modelRouterCalls")
      .filter((q) => q.gte(q.field("calledAt"), since))
      .collect();

    const latestEvolution = await ctx.db
      .query("agentTaskSessions")
      .withIndex("by_cron", (q) => q.eq("cronJobName", "swarm_evolution"))
      .order("desc")
      .first();
    const meta = latestEvolution?.metadata as
      | { actionItemQuality?: { completionRate?: number } }
      | undefined;
    const completionRate =
      typeof meta?.actionItemQuality?.completionRate === "number"
        ? meta.actionItemQuality.completionRate
        : null;

    return computeGoldenMetrics({
      modelCalls: calls.map((c) => ({ success: c.success })),
      completionRate,
      p99LatencyMs: null, // worker-runtime metric; see header comment
    });
  },
});
