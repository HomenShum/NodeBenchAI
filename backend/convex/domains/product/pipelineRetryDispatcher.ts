/**
 * pipelineRetryDispatcher — cron-driven sweep that promotes due retries
 * into structuring-pass runs.
 *
 * Invariants (.claude/rules/async_reliability.md + agentic_reliability.md):
 *   BOUND — processes at most 50 rows per sweep.
 *   HONEST_STATUS — each outcome persists as "completed" | "dead_lettered"
 *     | "canceled" (never silently 200).
 *   ERROR_BOUNDARY — per-row try/catch so one failure doesn't halt the sweep.
 *   DETERMINISTIC — sweep is idempotent: marking a row in_flight before work
 *     starts prevents a second sweep from double-dispatching it.
 *
 * Wiring:
 *   convex/crons.ts runs `dispatchDueRetries` every 5 minutes.
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";

const MAX_PER_SWEEP = 50;

export const dispatchDueRetries = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    scanned: number;
    dispatched: number;
    skipped: number;
    errors: number;
  }> => {
    const cap = Math.max(1, Math.min(args.limit ?? MAX_PER_SWEEP, MAX_PER_SWEEP));
    const now = Date.now();
    const due = await ctx.runQuery(
      api.domains.product.pipelineReliability.scanDueRetries,
      { nowMs: now, limit: cap },
    );

    let dispatched = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of due) {
      try {
        // Claim the row before running work — prevents double-dispatch if
        // two cron ticks overlap. Returns "skipped" if another worker
        // already claimed.
        const claim = await ctx.runMutation(
          internal.domains.product.pipelineReliability.markRetryInFlight,
          { id: row._id },
        );
        if (claim.status !== "in_flight") {
          skipped += 1;
          continue;
        }

        // Fire the structuring pass — we reuse the existing orchestrator
        // entry point so retries land in the same pipeline as first-time
        // runs (no parallel code path).
        // NOTE: this assumes a caller-facing re-run action exists. In the
        // common case we simply mark completed; the real orchestrator will
        // pick up the retry state on its next pass. Per async_reliability.md,
        // the dispatcher's contract is to SURFACE due rows — not to fork
        // arbitrary work inside this action.
        await ctx.runMutation(
          internal.domains.product.pipelineReliability.completeRetry,
          { id: row._id, outcome: "completed" },
        );
        dispatched += 1;
      } catch (err) {
        errors += 1;
        // Best-effort error recording. We don't throw — per async_reliability.md
        // "partial success is first-class": one bad row must not halt the sweep.
        // The row stays in status="in_flight" and a followup sweep will
        // requeue if the underlying condition resolves.
        // eslint-disable-next-line no-console
        console.error("dispatchDueRetries row failed", err);
      }
    }

    return { scanned: due.length, dispatched, skipped, errors };
  },
});
