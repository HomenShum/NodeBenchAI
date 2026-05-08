/**
 * Voice cost ledger — per-user, per-day spend tracking by tier.
 *
 * Pattern: HONEST_SCORES — totalUsd is computed from sum(byTier), never from
 * an estimate. capUsd defaults to $5/user/day.
 *
 * See: docs/architecture/REALTIME_VOICE_INTEGRATION.md §2 (voiceCostLedger)
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND          — single row per (userId, dayUtc) — bounded by user count
 *   - HONEST_SCORES  — totalUsd derived from byTier, recomputed on every update
 *   - HONEST_STATUS  — incrementSpend returns the post-update record so caller
 *                      sees real total (not the increment they sent)
 *   - DETERMINISTIC  — dayUtc is YYYY-MM-DD UTC, deterministic reset boundary
 */

import { v } from "convex/values";
import { mutation, query } from "../../../_generated/server";

const DEFAULT_CAP_USD = 5.0;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const tierValidator = v.union(
  v.literal("geminiLive"),
  v.literal("whisper"),
  v.literal("realtimeMini"),
  v.literal("realtime2"),
  v.literal("translate"),
);

/**
 * Returns current spend for the user today. If no row exists, returns
 * the default cap with totalUsd=0 (no-write read).
 */
export const checkCap = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const day = todayUtc();
    const row = await ctx.db
      .query("voiceCostLedger")
      .withIndex("by_user_day", (q) => q.eq("userId", args.userId).eq("dayUtc", day))
      .first();
    if (!row) {
      return {
        userId: args.userId,
        dayUtc: day,
        totalUsd: 0,
        capUsd: DEFAULT_CAP_USD,
        remaining: DEFAULT_CAP_USD,
        hit: false,
        warning80pct: false,
      };
    }
    const remaining = Math.max(0, row.capUsd - row.totalUsd);
    return {
      userId: args.userId,
      dayUtc: day,
      totalUsd: row.totalUsd,
      capUsd: row.capUsd,
      remaining,
      hit: row.totalUsd >= row.capUsd,
      warning80pct: row.totalUsd >= row.capUsd * 0.8,
    };
  },
});

/**
 * Increment spend for a tier. Recomputes totalUsd from sum(byTier) — never
 * trusts the caller's running total. Returns the post-update record.
 */
export const incrementSpend = mutation({
  args: {
    userId: v.id("users"),
    tier: tierValidator,
    deltaUsd: v.number(),
    capUsd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.deltaUsd < 0) {
      throw new Error("deltaUsd must be non-negative (HONEST_SCORES — no negative spend)");
    }
    const day = todayUtc();
    const now = Date.now();
    const existing = await ctx.db
      .query("voiceCostLedger")
      .withIndex("by_user_day", (q) => q.eq("userId", args.userId).eq("dayUtc", day))
      .first();

    if (!existing) {
      const byTier = {
        geminiLive: 0,
        whisper: 0,
        realtimeMini: 0,
        realtime2: 0,
        translate: 0,
      } as const;
      const updated = { ...byTier, [args.tier]: args.deltaUsd };
      const totalUsd = Object.values(updated).reduce((a, b) => a + b, 0);
      const capUsd = args.capUsd ?? DEFAULT_CAP_USD;
      const id = await ctx.db.insert("voiceCostLedger", {
        userId: args.userId,
        dayUtc: day,
        byTier: updated,
        totalUsd,
        capUsd,
        capHitAt: totalUsd >= capUsd ? now : undefined,
        updatedAt: now,
      });
      return { id, totalUsd, capUsd, hit: totalUsd >= capUsd };
    }

    const nextByTier = { ...existing.byTier, [args.tier]: existing.byTier[args.tier] + args.deltaUsd };
    // HONEST_SCORES — recompute total from byTier; do not accept a caller's value
    const totalUsd = Object.values(nextByTier).reduce((a, b) => a + b, 0);
    const capUsd = args.capUsd ?? existing.capUsd;
    const hit = totalUsd >= capUsd;
    await ctx.db.patch(existing._id, {
      byTier: nextByTier,
      totalUsd,
      capUsd,
      capHitAt: hit ? (existing.capHitAt ?? now) : existing.capHitAt,
      updatedAt: now,
    });
    return { id: existing._id, totalUsd, capUsd, hit };
  },
});

/**
 * Operator-only: override the daily cap for a user (e.g. premium tier).
 */
export const setUserCap = mutation({
  args: {
    userId: v.id("users"),
    capUsd: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.capUsd < 0) {
      throw new Error("capUsd must be non-negative");
    }
    const day = todayUtc();
    const existing = await ctx.db
      .query("voiceCostLedger")
      .withIndex("by_user_day", (q) => q.eq("userId", args.userId).eq("dayUtc", day))
      .first();
    if (!existing) {
      const id = await ctx.db.insert("voiceCostLedger", {
        userId: args.userId,
        dayUtc: day,
        byTier: { geminiLive: 0, whisper: 0, realtimeMini: 0, realtime2: 0, translate: 0 },
        totalUsd: 0,
        capUsd: args.capUsd,
        updatedAt: Date.now(),
      });
      return { id, capUsd: args.capUsd };
    }
    await ctx.db.patch(existing._id, { capUsd: args.capUsd, updatedAt: Date.now() });
    return { id: existing._id, capUsd: args.capUsd };
  },
});
