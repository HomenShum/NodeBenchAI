/**
 * Oracle Career Progression Mutations
 *
 * EXP awards, quest management, debuff system, class advancement, temporal opportunities.
 */

import { internalMutation, mutation } from "../../_generated/server";
import { v } from "convex/values";
import {
  playerClassValidator,
  questTypeValidator,
  questStatusValidator,
  eventTypeValidator,
  signalTypeValidator,
  debuffSeverityValidator,
  debuffTypeValidator,
  objectiveValidator,
  opportunityStatusValidator,
} from "./schema";

// ─── EXP Calculation (mirrors frontend EXP_RULES) ──────────────────────────

const BASE_EXP: Record<string, number> = {
  daily_standup: 50,
  commit: 25,
  pull_request: 100,
  code_review: 75,
  document_created: 150,
  conversation: 30,
  presentation: 200,
  architecture_decision: 300,
  poc_deployed: 500,
  budget_discussion: 250,
  custom: 50,
};

const SIGNAL_MULTIPLIERS: Record<string, number> = {
  mentionedMetrics: 1.2,
  mentionedBusinessImpact: 1.3,
  mentionedOwnership: 1.25,
  demonstratedInitiative: 1.4,
  crossFunctionalCollaboration: 1.35,
};

const STREAK_BONUSES: [number, number][] = [
  [30, 2.0],
  [14, 1.5],
  [7, 1.3],
  [5, 1.2],
  [3, 1.1],
];

const CLASS_EVOLUTION_EXP: Record<string, number> = {
  contract_executioner: 0,
  junior_developer: 5000,
  mid_level_engineer: 15000,
  senior_engineer: 40000,
  tech_lead: 80000,
  staff_engineer: 150000,
  principal_engineer: 300000,
  platform_architect: 500000,
  ai_implementation_lead: 450000,
  engineering_manager: 200000,
  director_of_engineering: 600000,
};

// Ordered tiers for linear progression (main track)
const CLASS_TIERS: string[] = [
  "contract_executioner",
  "junior_developer",
  "mid_level_engineer",
  "senior_engineer",
  "tech_lead",
  "staff_engineer",
  "principal_engineer",
  "platform_architect",
  "director_of_engineering",
];

function computeExp(
  eventType: string,
  signals: Record<string, boolean> | undefined,
  streakDay: number,
): { baseExp: number; multiplier: number; bonusExp: number; totalExp: number } {
  const baseExp = BASE_EXP[eventType] ?? 50;
  let multiplier = 1.0;

  // Signal multipliers (compound)
  if (signals) {
    for (const [signal, active] of Object.entries(signals)) {
      if (active && SIGNAL_MULTIPLIERS[signal]) {
        multiplier *= SIGNAL_MULTIPLIERS[signal];
      }
    }
  }

  // Streak bonus (best tier)
  for (const [threshold, bonus] of STREAK_BONUSES) {
    if (streakDay >= threshold) {
      multiplier *= bonus;
      break;
    }
  }

  const totalExp = Math.round(baseExp * multiplier);
  const bonusExp = totalExp - baseExp;

  return { baseExp, multiplier: Math.round(multiplier * 100) / 100, bonusExp, totalExp };
}

function determineClassForExp(totalExp: number): string {
  let result = CLASS_TIERS[0];
  for (const tier of CLASS_TIERS) {
    if (totalExp >= (CLASS_EVOLUTION_EXP[tier] ?? 0)) {
      result = tier;
    }
  }
  return result;
}

// ─── Award EXP ──────────────────────────────────────────────────────────────

export const awardExp = mutation({
  args: {
    userId: v.string(),
    eventType: eventTypeValidator,
    sourceRef: v.string(),
    signals: v.optional(v.object({
      mentionedMetrics: v.boolean(),
      mentionedBusinessImpact: v.boolean(),
      mentionedOwnership: v.boolean(),
      demonstratedInitiative: v.boolean(),
      crossFunctionalCollaboration: v.boolean(),
    })),
    streakDay: v.optional(v.number()),
  },
  returns: v.object({
    transactionId: v.id("oracleExpTransactions"),
    expAwarded: v.number(),
    newTotalExp: v.number(),
    classAdvanced: v.boolean(),
    newClass: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Find or create player profile
    const existing = await ctx.db
      .query("oraclePlayerProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    const streakDay = args.streakDay ?? (existing?.currentStreak ?? 0);
    const exp = computeExp(args.eventType, args.signals as Record<string, boolean> | undefined, streakDay);

    // Insert EXP transaction
    const transactionId = await ctx.db.insert("oracleExpTransactions", {
      userId: args.userId,
      eventType: args.eventType,
      baseExp: exp.baseExp,
      multiplier: exp.multiplier,
      bonusExp: exp.bonusExp,
      totalExp: exp.totalExp,
      sourceRef: args.sourceRef,
      streakDay,
      createdAt: now,
    });

    let classAdvanced = false;
    let newClass: string | undefined;

    if (existing) {
      const newTotalExp = existing.totalExp + exp.totalExp;
      const currentClassStr = existing.playerClass;
      const computedClass = determineClassForExp(newTotalExp);

      if (computedClass !== currentClassStr) {
        classAdvanced = true;
        newClass = computedClass;

        // Log class advancement
        await ctx.db.insert("oracleClassAdvancementLog", {
          userId: args.userId,
          fromClass: currentClassStr as never,
          toClass: computedClass as never,
          fromLevel: existing.level,
          toLevel: existing.level + 1,
          triggeredBy: "system",
          evidence: [args.sourceRef],
          advancedAt: now,
        });
      }

      await ctx.db.patch(existing._id, {
        totalExp: newTotalExp,
        lastActivityAt: now,
        ...(classAdvanced ? { playerClass: computedClass as never, level: existing.level + 1 } : {}),
      });

      return {
        transactionId,
        expAwarded: exp.totalExp,
        newTotalExp,
        classAdvanced,
        newClass,
      };
    } else {
      // Create new player profile
      const computedClass = determineClassForExp(exp.totalExp);
      await ctx.db.insert("oraclePlayerProfiles", {
        userId: args.userId,
        playerClass: computedClass as never,
        level: 1,
        totalExp: exp.totalExp,
        currentStreak: streakDay,
        longestStreak: streakDay,
        lastActivityAt: now,
        debuffs: [],
        inventory: [],
        joinedAt: now,
      });

      return {
        transactionId,
        expAwarded: exp.totalExp,
        newTotalExp: exp.totalExp,
        classAdvanced: false,
        newClass: undefined,
      };
    }
  },
});

// ─── Quest Management ───────────────────────────────────────────────────────

export const createQuest = mutation({
  args: {
    userId: v.string(),
    questType: questTypeValidator,
    title: v.string(),
    description: v.string(),
    objectives: v.array(objectiveValidator),
    expReward: v.number(),
    deadline: v.optional(v.number()),
  },
  returns: v.id("oracleQuestLog"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const questId = `quest_${now}_${Math.random().toString(36).slice(2, 8)}`;

    return ctx.db.insert("oracleQuestLog", {
      userId: args.userId,
      questId,
      questType: args.questType,
      title: args.title,
      description: args.description,
      status: "available",
      objectives: args.objectives,
      expReward: args.expReward,
      deadline: args.deadline,
      startedAt: undefined,
      completedAt: undefined,
      linkedSignalIds: [],
      linkedArtifactIds: [],
    });
  },
});

export const updateQuestStatus = mutation({
  args: {
    questId: v.string(),
    status: questStatusValidator,
    objectives: v.optional(v.array(objectiveValidator)),
  },
  returns: v.object({
    updated: v.boolean(),
    expAwarded: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const quest = await ctx.db
      .query("oracleQuestLog")
      .withIndex("by_questId", (q) => q.eq("questId", args.questId))
      .first();

    if (!quest) {
      return { updated: false, expAwarded: undefined };
    }

    const patch: Record<string, unknown> = { status: args.status };
    if (args.objectives) {
      patch.objectives = args.objectives;
    }

    if (args.status === "in_progress" && !quest.startedAt) {
      patch.startedAt = now;
    }

    let expAwarded: number | undefined;

    if (args.status === "completed" && quest.status !== "completed") {
      patch.completedAt = now;

      // Award quest completion EXP
      const txId = await ctx.db.insert("oracleExpTransactions", {
        userId: quest.userId,
        eventType: "custom",
        baseExp: quest.expReward,
        multiplier: 1.0,
        bonusExp: 0,
        totalExp: quest.expReward,
        sourceRef: `quest:${quest.questId}`,
        streakDay: 0,
        createdAt: now,
      });

      // Update player total EXP
      const profile = await ctx.db
        .query("oraclePlayerProfiles")
        .withIndex("by_userId", (q) => q.eq("userId", quest.userId))
        .first();

      if (profile) {
        const newTotalExp = profile.totalExp + quest.expReward;
        const computedClass = determineClassForExp(newTotalExp);
        const classChanged = computedClass !== profile.playerClass;

        await ctx.db.patch(profile._id, {
          totalExp: newTotalExp,
          lastActivityAt: now,
          ...(classChanged ? { playerClass: computedClass as never, level: profile.level + 1 } : {}),
        });

        if (classChanged) {
          await ctx.db.insert("oracleClassAdvancementLog", {
            userId: quest.userId,
            fromClass: profile.playerClass,
            toClass: computedClass as never,
            fromLevel: profile.level,
            toLevel: profile.level + 1,
            triggeredBy: "quest_completion",
            evidence: [`quest:${quest.questId}`],
            advancedAt: now,
          });
        }
      }

      expAwarded = quest.expReward;
    }

    await ctx.db.patch(quest._id, patch as never);
    return { updated: true, expAwarded };
  },
});

// ─── Debuff System ──────────────────────────────────────────────────────────

export const applyDebuff = mutation({
  args: {
    userId: v.string(),
    debuffType: debuffTypeValidator,
    severity: debuffSeverityValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("oraclePlayerProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!profile) return false;

    const now = Date.now();
    const newDebuffs = [
      ...profile.debuffs,
      { type: args.debuffType, severity: args.severity, acquiredAt: now },
    ];

    await ctx.db.patch(profile._id, { debuffs: newDebuffs });
    return true;
  },
});

export const removeDebuff = mutation({
  args: {
    userId: v.string(),
    debuffType: debuffTypeValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("oraclePlayerProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!profile) return false;

    const newDebuffs = profile.debuffs.filter((d) => d.type !== args.debuffType);
    if (newDebuffs.length === profile.debuffs.length) return false; // nothing removed

    await ctx.db.patch(profile._id, { debuffs: newDebuffs });
    return true;
  },
});

// ─── Class Advancement ──────────────────────────────────────────────────────

export const recordClassAdvancement = mutation({
  args: {
    userId: v.string(),
    fromClass: playerClassValidator,
    toClass: playerClassValidator,
    triggeredBy: v.union(
      v.literal("quest_completion"),
      v.literal("manual"),
      v.literal("system"),
    ),
    evidence: v.array(v.string()),
  },
  returns: v.id("oracleClassAdvancementLog"),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Update player profile class
    const profile = await ctx.db
      .query("oraclePlayerProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    const fromLevel = profile?.level ?? 1;
    const toLevel = fromLevel + 1;

    if (profile) {
      await ctx.db.patch(profile._id, {
        playerClass: args.toClass,
        level: toLevel,
        lastActivityAt: now,
      });
    }

    return ctx.db.insert("oracleClassAdvancementLog", {
      userId: args.userId,
      fromClass: args.fromClass,
      toClass: args.toClass,
      fromLevel,
      toLevel,
      triggeredBy: args.triggeredBy,
      evidence: args.evidence,
      advancedAt: now,
    });
  },
});

// ─── Temporal Opportunities ─────────────────────────────────────────────────

export const detectTemporalOpportunity = mutation({
  args: {
    userId: v.string(),
    signalType: signalTypeValidator,
    title: v.string(),
    description: v.string(),
    windowStart: v.number(),
    windowEnd: v.number(),
    confidence: v.number(),
    signalId: v.optional(v.id("timeSeriesSignals")),
    recommendedAction: v.optional(v.string()),
    zeroDraftArtifactId: v.optional(v.id("zeroDraftArtifacts")),
  },
  returns: v.id("oracleTemporalOpportunities"),
  handler: async (ctx, args) => {
    return ctx.db.insert("oracleTemporalOpportunities", {
      userId: args.userId,
      signalType: args.signalType,
      title: args.title,
      description: args.description,
      windowStartAt: args.windowStart,
      windowEndAt: args.windowEnd,
      confidence: args.confidence,
      status: "open",
      linkedSignalId: args.signalId,
      recommendedAction: args.recommendedAction,
      zeroDraftArtifactId: args.zeroDraftArtifactId,
    });
  },
});

export const updateOpportunityStatus = mutation({
  args: {
    opportunityId: v.id("oracleTemporalOpportunities"),
    status: opportunityStatusValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const opp = await ctx.db.get(args.opportunityId);
    if (!opp) return false;
    await ctx.db.patch(args.opportunityId, { status: args.status });
    return true;
  },
});

// ─── Streak Management ──────────────────────────────────────────────────────

export const updateStreak = mutation({
  args: {
    userId: v.string(),
    newStreak: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("oraclePlayerProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!profile) return false;

    await ctx.db.patch(profile._id, {
      currentStreak: args.newStreak,
      longestStreak: Math.max(profile.longestStreak, args.newStreak),
      lastActivityAt: Date.now(),
    });
    return true;
  },
});

// ─── Player Profile Init ────────────────────────────────────────────────────

export const initPlayerProfile = mutation({
  args: {
    userId: v.string(),
    playerClass: v.optional(playerClassValidator),
  },
  returns: v.id("oraclePlayerProfiles"),
  handler: async (ctx, args) => {
    // Check for existing
    const existing = await ctx.db
      .query("oraclePlayerProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) return existing._id;

    const now = Date.now();
    return ctx.db.insert("oraclePlayerProfiles", {
      userId: args.userId,
      playerClass: (args.playerClass ?? "contract_executioner") as never,
      level: 1,
      totalExp: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActivityAt: now,
      debuffs: [],
      inventory: [],
      joinedAt: now,
    });
  },
});
