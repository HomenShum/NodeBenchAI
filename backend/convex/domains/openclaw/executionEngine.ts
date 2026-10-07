/**
 * OpenClaw Execution Engine â€” Execution logging and result capture
 *
 * Logs every skill invocation through the sandbox enforcement point.
 * Captures results, violations, and timing for audit trail.
 */

import { internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { buildForecastAwareOpenClawHandoff } from "./forecastHandoffPolicy";
import type { ForecastGateDecision } from "../temporal/forecastGatePolicy";

/**
 * Log a skill execution (called after proxy enforcement)
 */
export const logExecution = internalMutation({
  args: {
    sessionId: v.id("openclawSessions"),
    userId: v.id("users"),
    skillName: v.string(),
    args: v.optional(v.any()),
    resultStatus: v.string(),
    violationType: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  },
  returns: v.id("openclawExecutions"),
  handler: async (ctx, args) => {
    const execId = await ctx.db.insert("openclawExecutions", {
      sessionId: args.sessionId,
      userId: args.userId,
      skillName: args.skillName,
      args: args.args,
      resultStatus: args.resultStatus,
      violationType: args.violationType,
      durationMs: args.durationMs,
      createdAt: Date.now(),
    });

    // Increment session call count
    await ctx.runMutation(
      internal.domains.openclaw.sessionManager.incrementCalls,
      {
        sessionId: args.sessionId,
        isViolation: !!args.violationType,
      }
    );

    return execId;
  },
});

/**
 * Get execution log for a session
 */
export const getExecutions = internalQuery({
  args: {
    sessionId: v.id("openclawSessions"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("openclawExecutions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

/**
 * Execute a skill through the sandbox (Convex action for external calls)
 *
 * This is the Convex-side enforcement point. The actual OpenClaw MCP proxy
 * is in the openclaw-mcp-nodebench package â€” this action logs to Convex
 * for persistent audit trail across sessions.
 */
export const executeSkill = internalAction({
  args: {
    userId: v.id("users"),
    sessionId: v.id("openclawSessions"),
    skillName: v.string(),
    skillArgs: v.optional(v.any()),
    justification: v.optional(v.string()),
    agentId: v.optional(v.string()),
    policyId: v.optional(v.string()),
    policyRuleName: v.optional(v.string()),
    channelId: v.optional(v.string()),
    sessionKey: v.optional(v.string()),
    direction: v.optional(
      v.union(
        v.literal("inbound"),
        v.literal("decision"),
        v.literal("draft"),
        v.literal("approval"),
        v.literal("outbound"),
        v.literal("error"),
      )
    ),
    deployment: v.optional(v.string()),
    evidenceRefs: v.optional(v.array(v.string())),
    actionSummary: v.optional(v.string()),
    canUndo: v.optional(v.boolean()),
    undoInstructions: v.optional(v.string()),
    requiresApproval: v.optional(v.boolean()),
    forecastGate: v.optional(v.any()),
    activePacketId: v.optional(v.string()),
    packetLineageId: v.optional(v.string()),
    currentCompanyTruth: v.optional(v.string()),
    constraints: v.optional(v.array(v.string())),
    successCriteria: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const t0 = Date.now();
    const skillArgsRecord =
      args.skillArgs && typeof args.skillArgs === "object" && !Array.isArray(args.skillArgs)
        ? (args.skillArgs as Record<string, unknown>)
        : {};
    const forecastGate =
      args.forecastGate && typeof args.forecastGate === "object" && !Array.isArray(args.forecastGate)
        ? (args.forecastGate as ForecastGateDecision)
        : undefined;
    const forecastHandoff = forecastGate
      ? buildForecastAwareOpenClawHandoff({
          forecastGate,
          activePacketId:
            args.activePacketId ??
            (typeof skillArgsRecord.packetId === "string" ? skillArgsRecord.packetId : undefined) ??
            (typeof skillArgsRecord.activePacketId === "string" ? skillArgsRecord.activePacketId : undefined),
          packetLineageId:
            args.packetLineageId ??
            (typeof skillArgsRecord.packetLineageId === "string" ? skillArgsRecord.packetLineageId : undefined),
          currentCompanyTruth:
            args.currentCompanyTruth ??
            (typeof skillArgsRecord.currentCompanyTruth === "string" ? skillArgsRecord.currentCompanyTruth : undefined),
          constraints: args.constraints,
          successCriteria: args.successCriteria,
          evidenceRefs: args.evidenceRefs,
          approvalRequired: args.requiresApproval,
          undoInstructions: args.undoInstructions,
        })
      : null;
    const blockedByForecastGate = forecastHandoff ? !forecastHandoff.shouldExecute : false;
    const requiresApproval = blockedByForecastGate
      ? forecastHandoff?.requiresApproval === true
      : args.requiresApproval ?? forecastHandoff?.requiresApproval ?? false;
    const resultStatus = blockedByForecastGate
      ? "blocked_by_forecast_gate"
      : requiresApproval
        ? "approval_required"
        : "success";

    // Log the execution attempt
    const execId = await ctx.runMutation(
      internal.domains.openclaw.executionEngine.logExecution,
      {
        sessionId: args.sessionId,
        userId: args.userId,
        skillName: args.skillName,
        args: forecastHandoff
          ? {
              ...(skillArgsRecord as Record<string, unknown>),
              forecastGate: forecastHandoff.packet.forecastGate,
              forecastHandoff,
            }
          : args.skillArgs,
        resultStatus,
        violationType: blockedByForecastGate ? "forecast_gate_hold" : undefined,
        durationMs: Date.now() - t0,
      }
    );

    const policyAction = blockedByForecastGate ? "denied" : requiresApproval ? "escalated" : "allowed";
    const approvalState = blockedByForecastGate && !requiresApproval
      ? "not_required"
      : requiresApproval
        ? "pending"
        : "not_required";
    const resultSuccess = !requiresApproval && !blockedByForecastGate;
    const actionSummary =
      args.actionSummary ??
      (forecastHandoff
        ? `OpenClaw ${forecastHandoff.executionDirective} for ${args.skillName}`
        : `OpenClaw ${requiresApproval ? "drafted" : "executed"} ${args.skillName}`);

    await ctx.runAction(
      internal.domains.agents.receipts.actionReceipts.emitReceipt,
      {
        agentId: args.agentId ?? "openclaw-agent",
        userId: args.userId,
        toolName: args.skillName,
        sessionKey: args.sessionKey,
        channelId: args.channelId,
        direction: args.direction ?? "draft",
        openclawSessionId: args.sessionId,
        openclawExecutionId: execId,
        deployment: args.deployment ?? "openclaw",
        params: forecastHandoff
          ? {
              ...(skillArgsRecord as Record<string, unknown>),
              forecastHandoff,
            }
          : args.skillArgs,
        actionSummary,
        policyId: args.policyId ?? "pol_openclaw_default",
        policyRuleName: args.policyRuleName ?? "OpenClaw default policy",
        policyAction,
        evidenceRefs: args.evidenceRefs ?? [],
        resultSuccess,
        resultSummary: blockedByForecastGate
          ? `${args.skillName} held by forecast gate: ${forecastHandoff?.reason ?? "no execution permitted"}`
          : requiresApproval
          ? `Held for approval before ${args.skillName} can execute`
          : `${args.skillName} completed in ${Date.now() - t0}ms`,
        resultOutputHash: undefined,
        canUndo: args.canUndo ?? false,
        undoInstructions: args.undoInstructions,
        approvalState,
        violations: blockedByForecastGate
          ? [
              {
                ruleId: "rule_openclaw_forecast_gate",
                ruleName: "Forecast Gate",
                severity: requiresApproval ? "warning" : "info",
                description: forecastHandoff?.reason ?? `OpenClaw action ${args.skillName} was held by forecast policy`,
                resolution: forecastGate?.explanation ?? "Inspect forecast gate context before retrying the handoff.",
              },
            ]
          : requiresApproval
          ? [
              {
                ruleId: "rule_openclaw_approval_required",
                ruleName: "Approval Required",
                severity: "warning",
                description: `OpenClaw action ${args.skillName} requires human approval before execution`,
                resolution: "Review the receipt in the approval queue and approve or deny it.",
              },
            ]
          : [],
      },
    );

    return {
      executionId: execId,
      skillName: args.skillName,
      status: resultStatus,
      approvalState,
      forecastHandoff,
      durationMs: Date.now() - t0,
    };
  },
});
