"use node";
/**
 * Passport Enforcement -- Runtime permission checks before tool dispatch
 *
 * Checks agent passport (trust tier, allowed/denied tools, spend limits)
 * before allowing tool execution. Fail-closed: on error, deny by default.
 *
 * Queries and mutations live in passportEnforcementQueries.ts because
 * Convex requires that "use node" files only export actions.
 */

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// enforcePassport — main entry point: orchestrates check + spend + log
// ═══════════════════════════════════════════════════════════════════════════

export const enforcePassport = internalAction({
  args: {
    agentId: v.string(),
    toolName: v.string(),
    missionId: v.optional(v.id("missions")),
    spendLimitUsd: v.optional(v.number()),
    trustTier: v.optional(v.string()),
  },
  returns: v.object({
    decision: v.string(),
    reason: v.string(),
  }),
  handler: async (ctx, args): Promise<{ decision: string; reason: string }> => {
    const trustTier = args.trustTier ?? "autonomous";

    try {
      // 1. Check passport policies
      const passportResult = await ctx.runQuery(
        internal.domains.agents.orchestrator.passportEnforcementQueries.checkPassport,
        {
          agentId: args.agentId,
          toolName: args.toolName,
          missionId: args.missionId,
        }
      );

      // 2. If passport denied or escalated, log and return immediately
      if (passportResult.decision === "denied") {
        await ctx.runMutation(
          internal.domains.agents.orchestrator.passportEnforcementQueries.logEnforcement,
          {
            agentId: args.agentId,
            toolName: args.toolName,
            decision: "denied",
            reason: passportResult.reason,
            trustTier,
            policyKey: passportResult.policyKey,
            missionId: args.missionId,
          }
        );
        return { decision: "denied", reason: passportResult.reason };
      }

      // 3. Check spend limit if mission + limit provided
      if (args.missionId && typeof args.spendLimitUsd === "number") {
        const spendResult = await ctx.runQuery(
          internal.domains.agents.orchestrator.passportEnforcementQueries.checkSpendLimit,
          {
            missionId: args.missionId,
            spendLimitUsd: args.spendLimitUsd,
          }
        );

        if (!spendResult.withinBudget) {
          const reason = `Spend limit exceeded: $${spendResult.totalSpent.toFixed(4)} spent of $${args.spendLimitUsd.toFixed(4)} budget ($${spendResult.remaining.toFixed(4)} remaining)`;
          await ctx.runMutation(
            internal.domains.agents.orchestrator.passportEnforcementQueries.logEnforcement,
            {
              agentId: args.agentId,
              toolName: args.toolName,
              decision: "denied",
              reason,
              trustTier,
              missionId: args.missionId,
              spendCheckResult: {
                totalSpent: spendResult.totalSpent,
                limit: args.spendLimitUsd,
                withinBudget: false,
              },
            }
          );
          return { decision: "denied", reason };
        }
      }

      // 4. Handle escalation — create sniff check for human review
      if (passportResult.decision === "escalated") {
        if (args.missionId) {
          const task = await ctx.runQuery(
            internal.domains.agents.orchestrator.passportEnforcementQueries.findActiveTask,
            { missionId: args.missionId }
          );

          if (task) {
            await ctx.runMutation(
              internal.domains.agents.orchestrator.passportEnforcementQueries.createSniffCheck,
              {
                taskId: task._id,
                missionId: args.missionId,
                agentId: args.agentId,
                toolName: args.toolName,
                reason: passportResult.reason,
              }
            );
          }
        }

        await ctx.runMutation(
          internal.domains.agents.orchestrator.passportEnforcementQueries.logEnforcement,
          {
            agentId: args.agentId,
            toolName: args.toolName,
            decision: "escalated",
            reason: passportResult.reason,
            trustTier,
            policyKey: passportResult.policyKey,
            missionId: args.missionId,
          }
        );
        return { decision: "escalated", reason: passportResult.reason };
      }

      // 5. Allowed — log and return
      await ctx.runMutation(
        internal.domains.agents.orchestrator.passportEnforcementQueries.logEnforcement,
        {
          agentId: args.agentId,
          toolName: args.toolName,
          decision: "allowed",
          reason: passportResult.reason,
          trustTier,
          policyKey: passportResult.policyKey,
          missionId: args.missionId,
        }
      );

      return { decision: "allowed", reason: passportResult.reason };
    } catch (err) {
      // Fail-closed: deny on any unhandled error
      const reason = `Passport enforcement error: ${err instanceof Error ? err.message : String(err)}`;

      try {
        await ctx.runMutation(
          internal.domains.agents.orchestrator.passportEnforcementQueries.logEnforcement,
          {
            agentId: args.agentId,
            toolName: args.toolName,
            decision: "denied",
            reason,
            trustTier,
            missionId: args.missionId,
          }
        );
      } catch {
        // If logging also fails, still deny — just without audit trail
      }

      return { decision: "denied", reason };
    }
  },
});
