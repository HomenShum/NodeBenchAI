/**
 * Passport Enforcement Queries & Mutations
 *
 * Separated from passportEnforcement.ts because Convex requires that
 * "use node" files only export actions.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../../_generated/server";

// ═══════════════════════════════════════════════════════════════════════════
// Agentic Reliability Constants (BOUND)
// ═══════════════════════════════════════════════════════════════════════════

/** Max enforcement log entries queried at once */
const MAX_ENFORCEMENT_LOGS = 1000;

/** Max policy rules evaluated per check */
const MAX_POLICY_RULES = 100;

/** Max runSteps queried for spend calculation */
const MAX_SPEND_QUERY = 500;

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type EnforcementDecision = "allowed" | "denied" | "escalated";

interface PassportCheckResult {
  decision: EnforcementDecision;
  reason: string;
  policyKey?: string;
}

interface SpendCheckResult {
  withinBudget: boolean;
  totalSpent: number;
  remaining: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// checkPassport — evaluate policy rules against an agent + tool pair
// ═══════════════════════════════════════════════════════════════════════════

export const checkPassport = internalQuery({
  args: {
    agentId: v.string(),
    toolName: v.string(),
    missionId: v.optional(v.id("missions")),
  },
  returns: v.object({
    decision: v.string(),
    reason: v.string(),
    policyKey: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<PassportCheckResult> => {
    try {
      // 1. Fetch global active policies
      const globalPolicies = await ctx.db
        .query("agentPolicies")
        .withIndex("by_scope_active", (q) => q.eq("scope", "global").eq("active", true))
        .take(MAX_POLICY_RULES);

      // 2. Fetch agent-specific active policies
      const agentPolicies = await ctx.db
        .query("agentPolicies")
        .withIndex("by_scope_active", (q) => q.eq("scope", "agent").eq("active", true))
        .take(MAX_POLICY_RULES);

      // Filter agent policies to those matching this agent's scopeValue
      const agentSpecific = agentPolicies.filter(
        (p) => p.scopeValue === args.agentId
      );

      // Evaluate agent-specific policies first (highest priority), then global
      const orderedPolicies = [...agentSpecific, ...globalPolicies];

      for (const policy of orderedPolicies) {
        for (const rule of policy.rules) {
          // Match rule action against toolName (exact match or wildcard "*")
          if (rule.action !== args.toolName && rule.action !== "*") {
            continue;
          }

          if (rule.effect === "deny") {
            return {
              decision: "denied",
              reason: `Policy "${policy.name}" (${policy.policyKey}) denies tool "${args.toolName}"`,
              policyKey: policy.policyKey,
            };
          }

          if (rule.effect === "require_approval") {
            return {
              decision: "escalated",
              reason: `Policy "${policy.name}" (${policy.policyKey}) requires approval for tool "${args.toolName}"`,
              policyKey: policy.policyKey,
            };
          }

          // effect === "allow" — explicit allow, short-circuit
          if (rule.effect === "allow") {
            return {
              decision: "allowed",
              reason: `Policy "${policy.name}" (${policy.policyKey}) explicitly allows tool "${args.toolName}"`,
              policyKey: policy.policyKey,
            };
          }
        }
      }

      // No matching policy found — default behavior
      return {
        decision: "allowed",
        reason: `No policy rule matched tool "${args.toolName}" for agent "${args.agentId}" -- default allow`,
      };
    } catch (err) {
      // Fail-closed: deny on any error during policy evaluation
      return {
        decision: "denied",
        reason: `Passport check failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// checkSpendLimit — sum costUsd across runSteps for a mission
// ═══════════════════════════════════════════════════════════════════════════

export const checkSpendLimit = internalQuery({
  args: {
    missionId: v.id("missions"),
    spendLimitUsd: v.number(),
  },
  returns: v.object({
    withinBudget: v.boolean(),
    totalSpent: v.number(),
    remaining: v.number(),
  }),
  handler: async (ctx, args): Promise<SpendCheckResult> => {
    const steps = await ctx.db
      .query("runSteps")
      .withIndex("by_mission_created", (q) => q.eq("missionId", args.missionId))
      .take(MAX_SPEND_QUERY);

    let totalSpent = 0;
    for (const step of steps) {
      if (typeof step.costUsd === "number") {
        totalSpent += step.costUsd;
      }
    }

    const remaining = Math.max(0, args.spendLimitUsd - totalSpent);

    return {
      withinBudget: totalSpent <= args.spendLimitUsd,
      totalSpent,
      remaining,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// logEnforcement — audit trail for enforcement decisions
// ═══════════════════════════════════════════════════════════════════════════

export const logEnforcement = internalMutation({
  args: {
    agentId: v.string(),
    toolName: v.string(),
    decision: v.string(),
    reason: v.string(),
    trustTier: v.string(),
    policyKey: v.optional(v.string()),
    missionId: v.optional(v.id("missions")),
    spendCheckResult: v.optional(
      v.object({
        totalSpent: v.number(),
        limit: v.number(),
        withinBudget: v.boolean(),
      })
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // BOUND: evict oldest logs if approaching cap
    const existingLogs = await ctx.db
      .query("passportEnforcementLogs")
      .withIndex("by_agent_created", (q) => q.eq("agentId", args.agentId))
      .take(MAX_ENFORCEMENT_LOGS);

    if (existingLogs.length >= MAX_ENFORCEMENT_LOGS) {
      // Evict oldest 10% to make room
      const evictCount = Math.ceil(MAX_ENFORCEMENT_LOGS * 0.1);
      const toEvict = existingLogs.slice(0, evictCount);
      for (const log of toEvict) {
        await ctx.db.delete(log._id);
      }
    }

    await ctx.db.insert("passportEnforcementLogs", {
      agentId: args.agentId,
      toolName: args.toolName,
      decision: args.decision as "allowed" | "denied" | "escalated",
      reason: args.reason,
      trustTier: args.trustTier,
      policyKey: args.policyKey,
      missionId: args.missionId,
      spendCheckResult: args.spendCheckResult,
      createdAt: Date.now(),
    });

    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// Helper queries/mutations for enforcePassport orchestration
// ═══════════════════════════════════════════════════════════════════════════

/** Find an active task plan for a mission (for linking sniff checks) */
export const findActiveTask = internalQuery({
  args: { missionId: v.id("missions") },
  returns: v.union(
    v.object({ _id: v.id("taskPlans"), _creationTime: v.number() }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query("taskPlans")
      .withIndex("by_mission_status", (q) =>
        q.eq("missionId", args.missionId).eq("status", "in_progress")
      )
      .first();

    if (task) {
      return { _id: task._id, _creationTime: task._creationTime };
    }

    // Fallback: any pending task
    const pendingTask = await ctx.db
      .query("taskPlans")
      .withIndex("by_mission_status", (q) =>
        q.eq("missionId", args.missionId).eq("status", "pending")
      )
      .first();

    if (pendingTask) {
      return { _id: pendingTask._id, _creationTime: pendingTask._creationTime };
    }

    return null;
  },
});

/** Create a sniff check entry for escalated tool calls */
export const createSniffCheck = internalMutation({
  args: {
    taskId: v.id("taskPlans"),
    missionId: v.id("missions"),
    agentId: v.string(),
    toolName: v.string(),
    reason: v.string(),
  },
  returns: v.id("sniffChecks"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("sniffChecks", {
      taskId: args.taskId,
      missionId: args.missionId,
      status: "pending",
      reviewType: "irreversible_action",
      outputSummary: `Agent "${args.agentId}" requests approval to execute tool "${args.toolName}"`,
      evidenceSummary: args.reason,
      createdAt: Date.now(),
    });
  },
});
