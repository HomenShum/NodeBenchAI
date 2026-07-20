/**
 * Oracle Career Progression Queries
 *
 * Player profiles, quest logs, EXP history, leaderboard, streak status, opportunities.
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";

// ─── EXP constants for streak status ────────────────────────────────────────

const STREAK_TIERS = [
  { days: 3, bonus: "10%" },
  { days: 5, bonus: "20%" },
  { days: 7, bonus: "30%" },
  { days: 14, bonus: "50%" },
  { days: 30, bonus: "100%" },
];

// ─── Player Profile ─────────────────────────────────────────────────────────

export const getPlayerProfile = query({
  args: { userId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query("oraclePlayerProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

// ─── Quest Queries ──────────────────────────────────────────────────────────

export const getActiveQuests = query({
  args: { userId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Get all quests that are not completed/expired/failed
    const allQuests = await ctx.db
      .query("oracleQuestLog")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    return allQuests.filter(
      (q) => q.status !== "completed" && q.status !== "expired" && q.status !== "failed",
    );
  },
});

export const getQuestsByStatus = query({
  args: {
    userId: v.string(),
    status: v.union(
      v.literal("locked"),
      v.literal("available"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("expired"),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query("oracleQuestLog")
      .withIndex("by_userId_status", (q) =>
        q.eq("userId", args.userId).eq("status", args.status),
      )
      .collect();
  },
});

export const getQuestById = query({
  args: { questId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query("oracleQuestLog")
      .withIndex("by_questId", (q) => q.eq("questId", args.questId))
      .first();
  },
});

// ─── EXP History ────────────────────────────────────────────────────────────

export const getExpHistory = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    return ctx.db
      .query("oracleExpTransactions")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);
  },
});

export const getExpSummary = query({
  args: { userId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const transactions = await ctx.db
      .query("oracleExpTransactions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    const byEventType: Record<string, number> = {};
    let totalExp = 0;

    for (const tx of transactions) {
      byEventType[tx.eventType] = (byEventType[tx.eventType] ?? 0) + tx.totalExp;
      totalExp += tx.totalExp;
    }

    return {
      totalExp,
      transactionCount: transactions.length,
      byEventType,
    };
  },
});

// ─── Class Advancement History ──────────────────────────────────────────────

export const getClassAdvancementHistory = query({
  args: { userId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query("oracleClassAdvancementLog")
      .withIndex("by_userId_advancedAt", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
  },
});

// ─── Temporal Opportunities ─────────────────────────────────────────────────

export const getOpenOpportunities = query({
  args: { userId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query("oracleTemporalOpportunities")
      .withIndex("by_userId_status", (q) =>
        q.eq("userId", args.userId).eq("status", "open"),
      )
      .collect();
  },
});

export const getAllOpportunities = query({
  args: { userId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query("oracleTemporalOpportunities")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

// ─── Leaderboard ────────────────────────────────────────────────────────────

export const getLeaderboard = query({
  args: { limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    // Query all profiles ordered by totalExp descending
    return ctx.db
      .query("oraclePlayerProfiles")
      .withIndex("by_totalExp")
      .order("desc")
      .take(limit);
  },
});

// ─── Streak Status ──────────────────────────────────────────────────────────

export const getStreakStatus = query({
  args: { userId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("oraclePlayerProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!profile) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        currentBonusTier: null,
        nextBonusTier: STREAK_TIERS[0],
        daysToNextTier: STREAK_TIERS[0].days,
      };
    }

    // Determine current bonus tier
    let currentBonusTier: { days: number; bonus: string } | null = null;
    let nextBonusTier: { days: number; bonus: string } | null = STREAK_TIERS[0];
    let daysToNextTier = STREAK_TIERS[0].days - profile.currentStreak;

    for (let i = STREAK_TIERS.length - 1; i >= 0; i--) {
      if (profile.currentStreak >= STREAK_TIERS[i].days) {
        currentBonusTier = STREAK_TIERS[i];
        nextBonusTier = i < STREAK_TIERS.length - 1 ? STREAK_TIERS[i + 1] : null;
        daysToNextTier = nextBonusTier
          ? nextBonusTier.days - profile.currentStreak
          : 0;
        break;
      }
    }

    return {
      currentStreak: profile.currentStreak,
      longestStreak: profile.longestStreak,
      lastActivityAt: profile.lastActivityAt,
      currentBonusTier,
      nextBonusTier,
      daysToNextTier: Math.max(0, daysToNextTier),
    };
  },
});
