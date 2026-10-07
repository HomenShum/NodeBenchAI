/**
 * OpenClaw Domain Schema — Convex table definitions
 *
 * Tables for sandboxed OpenClaw agent orchestration:
 * - Workflow definitions with step configs
 * - Session lifecycle with policy enforcement
 * - Execution log for every skill invocation
 * - Delegation tracking from coordinator agent
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

// ── Workflow definitions ────────────────────────────────────────────────────

export const openclawWorkflows = defineTable({
  userId: v.id("users"),
  name: v.string(),
  description: v.optional(v.string()),
  steps: v.array(
    v.object({
      id: v.string(),
      type: v.union(
        v.literal("navigate"),
        v.literal("click"),
        v.literal("fill"),
        v.literal("extract"),
        v.literal("wait"),
        v.literal("branch")
      ),
      config: v.any(),
    })
  ),
  timeoutMs: v.number(),
  maxRetries: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_name", ["name"]);

// ── Sessions ────────────────────────────────────────────────────────────────

export const openclawSessions = defineTable({
  userId: v.id("users"),
  workflowId: v.optional(v.id("openclawWorkflows")),
  policyName: v.optional(v.string()),
  status: v.union(
    v.literal("active"),
    v.literal("suspended"),
    v.literal("completed"),
    v.literal("error")
  ),
  deployment: v.string(),
  totalCalls: v.number(),
  violations: v.number(),
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_status", ["status"]);

// ── Execution log ───────────────────────────────────────────────────────────

export const openclawExecutions = defineTable({
  sessionId: v.id("openclawSessions"),
  userId: v.id("users"),
  skillName: v.string(),
  args: v.optional(v.any()),
  resultStatus: v.string(),
  violationType: v.optional(v.string()),
  durationMs: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_session", ["sessionId"])
  .index("by_user", ["userId"]);

// ── Delegations from coordinator agent ──────────────────────────────────────

export const openclawDelegations = defineTable({
  agentId: v.optional(v.string()),
  sessionId: v.id("openclawSessions"),
  intent: v.string(),
  constraints: v.optional(v.any()),
  result: v.optional(v.any()),
  status: v.union(
    v.literal("pending"),
    v.literal("completed"),
    v.literal("failed")
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_session", ["sessionId"]);
