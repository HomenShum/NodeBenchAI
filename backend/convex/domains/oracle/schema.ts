/**
 * Oracle Career Progression Schema
 *
 * Solo Leveling-style gamification backend for career advancement.
 * Tables: playerProfiles, questLog, expTransactions, classAdvancementLog, temporalOpportunities
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

// ─── Shared validators ──────────────────────────────────────────────────────

const playerClassValidator = v.union(
  v.literal("contract_executioner"),
  v.literal("junior_developer"),
  v.literal("mid_level_engineer"),
  v.literal("senior_engineer"),
  v.literal("tech_lead"),
  v.literal("staff_engineer"),
  v.literal("principal_engineer"),
  v.literal("platform_architect"),
  v.literal("ai_implementation_lead"),
  v.literal("engineering_manager"),
  v.literal("director_of_engineering"),
);

const questTypeValidator = v.union(
  v.literal("main_scenario"),
  v.literal("daily"),
  v.literal("side"),
  v.literal("weekly"),
  v.literal("achievement"),
);

const questStatusValidator = v.union(
  v.literal("locked"),
  v.literal("available"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("expired"),
);

const eventTypeValidator = v.union(
  v.literal("daily_standup"),
  v.literal("commit"),
  v.literal("pull_request"),
  v.literal("code_review"),
  v.literal("document_created"),
  v.literal("conversation"),
  v.literal("presentation"),
  v.literal("architecture_decision"),
  v.literal("poc_deployed"),
  v.literal("budget_discussion"),
  v.literal("custom"),
);

const signalTypeValidator = v.union(
  v.literal("budget_drop"),
  v.literal("vendor_panic"),
  v.literal("integration_bottleneck"),
  v.literal("hiring_surge"),
  v.literal("funding_round"),
  v.literal("leadership_change"),
  v.literal("competitor_move"),
);

const debuffSeverityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

const debuffTypeValidator = v.union(
  v.literal("imposter_syndrome"),
  v.literal("scope_creep"),
  v.literal("analysis_paralysis"),
  v.literal("burnout"),
  v.literal("context_switching"),
  v.literal("perfectionism"),
  v.literal("isolation"),
  v.literal("custom"),
);

const objectiveValidator = v.object({
  label: v.string(),
  completed: v.boolean(),
  evidence: v.optional(v.string()),
});

const debuffValidator = v.object({
  type: debuffTypeValidator,
  severity: debuffSeverityValidator,
  acquiredAt: v.number(),
});

const inventoryItemValidator = v.object({
  id: v.string(),
  name: v.string(),
  category: v.union(
    v.literal("paper_trail"),
    v.literal("working_prototype"),
    v.literal("institutional_memory"),
    v.literal("network"),
    v.literal("skill"),
  ),
  acquiredAt: v.number(),
});

const opportunityStatusValidator = v.union(
  v.literal("open"),
  v.literal("acted"),
  v.literal("missed"),
  v.literal("expired"),
);

// ─── Exported validators (for use in mutations/queries) ─────────────────────

export {
  playerClassValidator,
  questTypeValidator,
  questStatusValidator,
  eventTypeValidator,
  signalTypeValidator,
  debuffSeverityValidator,
  debuffTypeValidator,
  objectiveValidator,
  debuffValidator,
  inventoryItemValidator,
  opportunityStatusValidator,
};

// ─── Tables ─────────────────────────────────────────────────────────────────

export const oraclePlayerProfiles = defineTable({
  userId: v.string(),
  playerClass: playerClassValidator,
  level: v.number(),
  totalExp: v.number(),
  currentStreak: v.number(),
  longestStreak: v.number(),
  lastActivityAt: v.number(),
  debuffs: v.array(debuffValidator),
  inventory: v.array(inventoryItemValidator),
  joinedAt: v.number(),
})
  .index("by_userId", ["userId"])
  .index("by_totalExp", ["totalExp"])
  .index("by_playerClass", ["playerClass"]);

export const oracleQuestLog = defineTable({
  userId: v.string(),
  questId: v.string(),
  questType: questTypeValidator,
  title: v.string(),
  description: v.string(),
  status: questStatusValidator,
  objectives: v.array(objectiveValidator),
  expReward: v.number(),
  deadline: v.optional(v.number()),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  linkedSignalIds: v.array(v.string()),
  linkedArtifactIds: v.array(v.string()),
})
  .index("by_userId", ["userId"])
  .index("by_userId_status", ["userId", "status"])
  .index("by_questId", ["questId"]);

export const oracleExpTransactions = defineTable({
  userId: v.string(),
  eventType: eventTypeValidator,
  baseExp: v.number(),
  multiplier: v.number(),
  bonusExp: v.number(),
  totalExp: v.number(),
  sourceRef: v.string(),
  streakDay: v.number(),
  createdAt: v.number(),
})
  .index("by_userId", ["userId"])
  .index("by_userId_createdAt", ["userId", "createdAt"])
  .index("by_createdAt", ["createdAt"]);

export const oracleClassAdvancementLog = defineTable({
  userId: v.string(),
  fromClass: playerClassValidator,
  toClass: playerClassValidator,
  fromLevel: v.number(),
  toLevel: v.number(),
  triggeredBy: v.union(
    v.literal("quest_completion"),
    v.literal("manual"),
    v.literal("system"),
  ),
  evidence: v.array(v.string()),
  advancedAt: v.number(),
})
  .index("by_userId", ["userId"])
  .index("by_userId_advancedAt", ["userId", "advancedAt"])
  .index("by_advancedAt", ["advancedAt"]);

export const oracleTemporalOpportunities = defineTable({
  userId: v.string(),
  signalType: signalTypeValidator,
  title: v.string(),
  description: v.string(),
  windowStartAt: v.number(),
  windowEndAt: v.number(),
  confidence: v.number(),
  status: opportunityStatusValidator,
  linkedSignalId: v.optional(v.id("timeSeriesSignals")),
  recommendedAction: v.optional(v.string()),
  zeroDraftArtifactId: v.optional(v.id("zeroDraftArtifacts")),
})
  .index("by_userId", ["userId"])
  .index("by_userId_status", ["userId", "status"])
  .index("by_windowEndAt", ["windowEndAt"]);
