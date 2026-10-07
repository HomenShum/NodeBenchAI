/**
 * Budget Gate — B-PR6 of the Autonomous Continuation System
 *
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Per-user budget caps for agent requests. The model router (B-PR4)
 * calls `checkAndDeductBudget` before each routed request and refuses
 * to spend tokens / cost beyond the user's daily cap. When the gate
 * denies a request, it captures a BUDGET lesson via A-PR-B.6 so the
 * next planning turn can size its work to fit the remaining budget.
 *
 * v1 surface:
 *   - Per-user caps keyed by `ownerKey`. Per-thread caps deferred to v2.
 *   - Daily reset window. Wall-clock based; the row's `resetAt` field
 *     is bumped to the next 24h boundary on the first request after
 *     it has elapsed.
 *   - HONEST_STATUS: every denial returns a structured reason
 *     (`token_cap` | `cost_cap` | `not_enrolled` …) so the chat surface
 *     can render an actionable message.
 *   - Caps of `0` mean "no cap on this dimension". Both caps zero +
 *     `enforced: false` means the gate auto-allows everything.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../../_generated/server";
import { internal } from "../../../_generated/api";

// ════════════════════════════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════════════════════════════

/** Default daily token cap when a user enrolls without specifying one. */
export const DEFAULT_DAILY_TOKEN_CAP = 1_000_000;
/** Default daily USD cap when a user enrolls without specifying one. */
export const DEFAULT_DAILY_COST_CAP_USD = 5;
/** 24h reset window. */
const RESET_WINDOW_MS = 24 * 60 * 60 * 1000;

// ════════════════════════════════════════════════════════════════════════
// VALIDATORS
// ════════════════════════════════════════════════════════════════════════

const decisionValidator = v.union(
  v.object({
    allowed: v.literal(true),
    /** Tokens still available today after the deduction. */
    dailyTokensRemaining: v.number(),
    /** USD still available today after the deduction. */
    dailyCostRemainingUsd: v.number(),
    /** Whether the gate auto-created the row on first use. */
    autoEnrolled: v.boolean(),
  }),
  v.object({
    allowed: v.literal(false),
    reason: v.union(
      v.literal("token_cap"),
      v.literal("cost_cap"),
      v.literal("not_enrolled"),
    ),
    /** Estimated tokens remaining when the cap fired (0 when over). */
    estimatedTokensRemaining: v.number(),
    /** USD remaining when the cap fired (0 when over). */
    dailyCostRemainingUsd: v.number(),
    /** ms until the next reset. Caller can show a countdown. */
    msUntilReset: v.number(),
    /** ID of the captured budget lesson, if any. */
    lessonId: v.union(v.id("agentLessons"), v.null()),
  }),
);

const budgetRowValidator = v.union(
  v.null(),
  v.object({
    _id: v.id("userBudgets"),
    _creationTime: v.number(),
    ownerKey: v.string(),
    dailyTokenCap: v.number(),
    dailyCostCapUsd: v.number(),
    consumedTokensToday: v.number(),
    consumedCostUsdToday: v.number(),
    resetAt: v.number(),
    enforced: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
);

// ════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ════════════════════════════════════════════════════════════════════════

function nextResetAt(now: number): number {
  return now + RESET_WINDOW_MS;
}

// ════════════════════════════════════════════════════════════════════════
// CHECK + DEDUCT
// ════════════════════════════════════════════════════════════════════════

/**
 * Internal mutation invoked by the model router (B-PR4) before each
 * routed request. Atomically checks the user's budget and either
 * deducts the estimated cost or denies the request and captures a
 * BUDGET lesson for the agent to learn from.
 *
 * `taskCategory` is forwarded to the lesson record so future planning
 * can size category-specific work to fit the remaining budget.
 */
export const checkAndDeductBudget = internalMutation({
  args: {
    /** Owner identity. Anonymous + authed sessions reuse the same key. */
    ownerKey: v.string(),
    /** Thread the request belongs to (for lesson capture context). */
    threadId: v.string(),
    /** Current turn id (for lesson capture). */
    turnId: v.number(),
    /** Task category (research / synthesis / publishing / …). */
    taskCategory: v.string(),
    /** Pre-call estimate of tokens this request will consume. */
    estimatedTokens: v.number(),
    /** Pre-call estimate of USD this request will consume. */
    estimatedCostUsd: v.number(),
    /**
     * When `true`, the gate auto-creates the budget row with the default
     * caps if it doesn't exist. When `false`, missing rows result in
     * `not_enrolled`. Defaults to `true`.
     */
    autoEnroll: v.optional(v.boolean()),
  },
  returns: decisionValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const autoEnroll = args.autoEnroll ?? true;

    let row = await ctx.db
      .query("userBudgets")
      .withIndex("by_owner", (q) => q.eq("ownerKey", args.ownerKey))
      .first();

    // ─── Auto-enrol on first request ─────────────────────────────────
    if (!row) {
      if (!autoEnroll) {
        return {
          allowed: false as const,
          reason: "not_enrolled" as const,
          estimatedTokensRemaining: 0,
          dailyCostRemainingUsd: 0,
          msUntilReset: 0,
          lessonId: null,
        };
      }
      const insertedId = await ctx.db.insert("userBudgets", {
        ownerKey: args.ownerKey,
        dailyTokenCap: DEFAULT_DAILY_TOKEN_CAP,
        dailyCostCapUsd: DEFAULT_DAILY_COST_CAP_USD,
        consumedTokensToday: 0,
        consumedCostUsdToday: 0,
        resetAt: nextResetAt(now),
        enforced: true,
        createdAt: now,
        updatedAt: now,
      });
      const inserted = await ctx.db.get(insertedId);
      if (!inserted) {
        // Should be impossible right after insert, but stay HONEST.
        throw new Error("Budget row vanished immediately after insert");
      }
      row = inserted;
    }

    // ─── Reset window if elapsed ─────────────────────────────────────
    if (now >= row.resetAt) {
      await ctx.db.patch(row._id, {
        consumedTokensToday: 0,
        consumedCostUsdToday: 0,
        resetAt: nextResetAt(now),
        updatedAt: now,
      });
      row = {
        ...row,
        consumedTokensToday: 0,
        consumedCostUsdToday: 0,
        resetAt: nextResetAt(now),
        updatedAt: now,
      };
    }

    // ─── Bypass when not enforced ────────────────────────────────────
    if (!row.enforced) {
      // Still bump telemetry counters for visibility, but never deny.
      await ctx.db.patch(row._id, {
        consumedTokensToday: row.consumedTokensToday + args.estimatedTokens,
        consumedCostUsdToday: row.consumedCostUsdToday + args.estimatedCostUsd,
        updatedAt: now,
      });
      return {
        allowed: true as const,
        dailyTokensRemaining: Number.POSITIVE_INFINITY,
        dailyCostRemainingUsd: Number.POSITIVE_INFINITY,
        autoEnrolled: false,
      };
    }

    // ─── Compute projected usage ─────────────────────────────────────
    const projectedTokens =
      row.consumedTokensToday + args.estimatedTokens;
    const projectedCost =
      row.consumedCostUsdToday + args.estimatedCostUsd;
    const tokenCapHit =
      row.dailyTokenCap > 0 && projectedTokens > row.dailyTokenCap;
    const costCapHit =
      row.dailyCostCapUsd > 0 && projectedCost > row.dailyCostCapUsd;

    if (tokenCapHit || costCapHit) {
      const reason: "token_cap" | "cost_cap" = tokenCapHit
        ? "token_cap"
        : "cost_cap";
      const remainingTokens = Math.max(
        row.dailyTokenCap - row.consumedTokensToday,
        0,
      );
      const remainingCost = Math.max(
        row.dailyCostCapUsd - row.consumedCostUsdToday,
        0,
      );

      // HONEST_STATUS: capture a budget lesson so future planning sizes
      // work to fit the remaining budget. Best-effort — capture
      // failures must not bring down the gate itself.
      let lessonId: import("../../../_generated/dataModel").Id<"agentLessons"> | null =
        null;
      try {
        lessonId = await ctx.runMutation(
          internal.domains.agents.lessons.captureLesson.captureBudgetLesson,
          {
            threadId: args.threadId,
            turnId: args.turnId,
            taskCategory: args.taskCategory,
            estimatedTokensRemaining: remainingTokens,
          },
        );
      } catch (err) {
        console.warn(
          "[budgetGate] captureBudgetLesson failed; gate will still deny:",
          err instanceof Error ? err.message : String(err),
        );
      }

      return {
        allowed: false as const,
        reason,
        estimatedTokensRemaining: remainingTokens,
        dailyCostRemainingUsd: remainingCost,
        msUntilReset: Math.max(row.resetAt - now, 0),
        lessonId,
      };
    }

    // ─── Allow + deduct ──────────────────────────────────────────────
    await ctx.db.patch(row._id, {
      consumedTokensToday: projectedTokens,
      consumedCostUsdToday: projectedCost,
      updatedAt: now,
    });

    const dailyTokensRemaining =
      row.dailyTokenCap > 0
        ? Math.max(row.dailyTokenCap - projectedTokens, 0)
        : Number.POSITIVE_INFINITY;
    const dailyCostRemainingUsd =
      row.dailyCostCapUsd > 0
        ? Math.max(row.dailyCostCapUsd - projectedCost, 0)
        : Number.POSITIVE_INFINITY;

    return {
      allowed: true as const,
      dailyTokensRemaining,
      dailyCostRemainingUsd,
      autoEnrolled: row.consumedTokensToday === 0 && row.createdAt === now,
    };
  },
});

// ════════════════════════════════════════════════════════════════════════
// READ + UPSERT (for ResilienceSettings UI in B-PR7)
// ════════════════════════════════════════════════════════════════════════

/**
 * Read the current budget row for a user. Returns `null` (HONEST_STATUS)
 * when the user has not been enrolled yet — UI shows the default
 * placeholder instead of pretending zeros are real consumption.
 */
export const getBudgetForOwner = query({
  args: { ownerKey: v.string() },
  returns: budgetRowValidator,
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("userBudgets")
      .withIndex("by_owner", (q) => q.eq("ownerKey", args.ownerKey))
      .first();
    return row ?? null;
  },
});

/**
 * Upsert the budget caps for a user. Used by the ResilienceSettings UI
 * (B-PR7) when the operator changes their daily caps. Public mutation
 * so the React layer can call it directly.
 *
 * Setting a cap to 0 means "no cap". Setting `enforced` to `false`
 * disables the gate without losing the configured caps.
 */
export const upsertBudgetForOwner = mutation({
  args: {
    ownerKey: v.string(),
    dailyTokenCap: v.number(),
    dailyCostCapUsd: v.number(),
    enforced: v.optional(v.boolean()),
  },
  returns: v.id("userBudgets"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const enforced = args.enforced ?? true;
    const existing = await ctx.db
      .query("userBudgets")
      .withIndex("by_owner", (q) => q.eq("ownerKey", args.ownerKey))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        dailyTokenCap: args.dailyTokenCap,
        dailyCostCapUsd: args.dailyCostCapUsd,
        enforced,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("userBudgets", {
      ownerKey: args.ownerKey,
      dailyTokenCap: args.dailyTokenCap,
      dailyCostCapUsd: args.dailyCostCapUsd,
      consumedTokensToday: 0,
      consumedCostUsdToday: 0,
      resetAt: nextResetAt(now),
      enforced,
      createdAt: now,
      updatedAt: now,
    });
  },
});
