/**
 * actionReceipts.ts â€” Convex queries and mutations for the ActionReceipts table.
 *
 * Tamper-evident log of agent actions with policy enforcement, evidence links,
 * and violation tracking. Every receipt is content-addressed (SHA-256).
 *
 * @see src/features/controlPlane/types/actionReceipt.ts (frontend types)
 * @see convex/schema.ts (actionReceipts table definition)
 */

import { v } from "convex/values";
import { query, mutation, internalMutation, internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../../../_generated/dataModel";

async function getReceiptOwnerId(ctx: { auth: any }): Promise<Id<"users"> | null> {
  const userId = await getAuthUserId(ctx as any);
  return userId ? (userId as Id<"users">) : null;
}

function isOwnedBy(receipt: { userId?: Id<"users"> }, userId: Id<"users">): boolean {
  return receipt.userId !== undefined && String(receipt.userId) === String(userId);
}

// â”€â”€â”€ Validators â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const violationValidator = v.object({
  ruleId: v.string(),
  ruleName: v.string(),
  severity: v.string(), // "warning" | "block" | "audit_only"
  description: v.string(),
  resolution: v.optional(v.string()),
});

const approvalStateValidator = v.union(
  v.literal("not_required"),
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
);

const openclawDirectionValidator = v.union(
  v.literal("inbound"),
  v.literal("decision"),
  v.literal("draft"),
  v.literal("approval"),
  v.literal("outbound"),
  v.literal("error"),
);

/**
 * Immutable execution fields covered by the receipt hash. Approval review
 * fields are intentionally excluded because they are a mutable human workflow
 * layered on top of the original execution receipt.
 */
function canonicalReceiptPayload(receipt: Record<string, any>): string {
  return JSON.stringify({
    agentId: receipt.agentId,
    agentRunId: receipt.agentRunId ?? null,
    userId: receipt.userId ?? null,
    sessionKey: receipt.sessionKey ?? null,
    channelId: receipt.channelId ?? null,
    direction: receipt.direction ?? null,
    openclawSessionId: receipt.openclawSessionId ?? null,
    openclawExecutionId: receipt.openclawExecutionId ?? null,
    deployment: receipt.deployment ?? null,
    toolName: receipt.toolName,
    params: receipt.params ?? null,
    actionSummary: receipt.actionSummary,
    policyId: receipt.policyId,
    policyRuleName: receipt.policyRuleName,
    policyAction: receipt.policyAction,
    evidenceRefs: receipt.evidenceRefs,
    resultSuccess: receipt.resultSuccess,
    resultSummary: receipt.resultSummary,
    resultOutputHash: receipt.resultOutputHash ?? null,
    canUndo: receipt.canUndo,
    undoInstructions: receipt.undoInstructions ?? null,
    violations: receipt.violations,
    createdAt: receipt.createdAt,
  });
}

async function computeReceiptId(receipt: Record<string, any>): Promise<string> {
  const data = new TextEncoder().encode(canonicalReceiptPayload(receipt));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return "sha256:" + hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// â”€â”€â”€ Queries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** List receipts, newest first, with optional policy action filter. */
export const list = query({
  args: {
    policyAction: v.optional(v.string()),
    approvalState: v.optional(approvalStateValidator),
    sessionKey: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const userId = await getReceiptOwnerId(ctx);
    if (!userId) return [];
    const limit = args.limit ?? 50;
    const owned = ctx.db
      .query("actionReceipts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc");

    if (args.sessionKey) {
      return await owned
        .filter((q) => q.eq(q.field("sessionKey"), args.sessionKey))
        .take(limit);
    }

    if (args.approvalState) {
      return await owned
        .filter((q) => q.eq(q.field("approvalState"), args.approvalState))
        .take(limit);
    }

    if (args.policyAction) {
      return await owned
        .filter((q) => q.eq(q.field("policyAction"), args.policyAction))
        .take(limit);
    }

    return await owned.take(limit);
  },
});

/** Get receipts for a specific OpenClaw session key. */
export const listBySessionKey = query({
  args: {
    sessionKey: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const userId = await getReceiptOwnerId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("actionReceipts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .filter((q) => q.eq(q.field("sessionKey"), args.sessionKey))
      .take(args.limit ?? 50);
  },
});

/** Pending approvals sourced from receipts, not generic HITL prompts. */
export const listPendingApprovals = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const userId = await getReceiptOwnerId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("actionReceipts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .filter((q) => q.eq(q.field("approvalState"), "pending"))
      .take(args.limit ?? 25);
  },
});

/** Get a single receipt by its content-addressed receiptId. */
export const getByReceiptId = query({
  args: { receiptId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const userId = await getReceiptOwnerId(ctx);
    if (!userId) return null;
    const receipt = await ctx.db
      .query("actionReceipts")
      .withIndex("by_receiptId", (q) => q.eq("receiptId", args.receiptId))
      .unique();
    return receipt && isOwnedBy(receipt, userId) ? receipt : null;
  },
});

/** Get receipts for a specific agent run. */
export const listByAgentRun = query({
  args: { agentRunId: v.id("agentRuns") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const userId = await getReceiptOwnerId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("actionReceipts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .filter((q) => q.eq(q.field("agentRunId"), args.agentRunId))
      .collect();
  },
});

/** Aggregate stats â€” total, allowed, escalated, denied. */
export const stats = query({
  args: {},
  returns: v.object({
    total: v.number(),
    allowed: v.number(),
    escalated: v.number(),
    denied: v.number(),
    violations: v.number(),
  }),
  handler: async (ctx) => {
    const userId = await getReceiptOwnerId(ctx);
    if (!userId) return { total: 0, allowed: 0, escalated: 0, denied: 0, violations: 0 };
    const all = await ctx.db
      .query("actionReceipts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    let allowed = 0;
    let escalated = 0;
    let denied = 0;
    let violations = 0;
    for (const r of all) {
      if (r.policyAction === "allowed") allowed++;
      else if (r.policyAction === "escalated") escalated++;
      else if (r.policyAction === "denied") denied++;
      violations += (r.violations as unknown[]).length;
    }
    return { total: all.length, allowed, escalated, denied, violations };
  },
});

// â”€â”€â”€ Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Internal mutation for system-level receipt logging (crons, internal agents). */
export const logReceiptInternal = internalMutation({
  args: {
    receiptId: v.string(),
    agentId: v.string(),
    agentRunId: v.optional(v.id("agentRuns")),
    userId: v.optional(v.id("users")),
    toolName: v.string(),
    sessionKey: v.optional(v.string()),
    channelId: v.optional(v.string()),
    direction: v.optional(openclawDirectionValidator),
    openclawSessionId: v.optional(v.id("openclawSessions")),
    openclawExecutionId: v.optional(v.id("openclawExecutions")),
    deployment: v.optional(v.string()),
    params: v.optional(v.any()),
    actionSummary: v.string(),
    policyId: v.string(),
    policyRuleName: v.string(),
    policyAction: v.string(),
    evidenceRefs: v.array(v.string()),
    resultSuccess: v.boolean(),
    resultSummary: v.string(),
    resultOutputHash: v.optional(v.string()),
    canUndo: v.boolean(),
    undoInstructions: v.optional(v.string()),
    approvalState: v.optional(approvalStateValidator),
    approvalRequestedAt: v.optional(v.number()),
    approvalReviewedAt: v.optional(v.number()),
    approvalReviewedBy: v.optional(v.string()),
    approvalReviewNotes: v.optional(v.string()),
    violations: v.array(violationValidator),
    createdAt: v.optional(v.number()),
  },
  returns: v.id("actionReceipts"),
  handler: async (ctx, args) => {
    const createdAt = args.createdAt ?? Date.now();
    const approvalState =
      args.approvalState ?? (args.policyAction === "escalated" ? "pending" : "not_required");
    const approvalRequestedAt =
      args.approvalRequestedAt ?? (approvalState === "pending" ? createdAt : undefined);
    return await ctx.db.insert("actionReceipts", {
      ...args,
      approvalState,
      approvalRequestedAt,
      createdAt,
    });
  },
});

/** Move an escalated receipt into the approval queue. */
export const requestApproval = mutation({
  args: {
    receiptId: v.string(),
    reviewNotes: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await getReceiptOwnerId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const receipt = await ctx.db
      .query("actionReceipts")
      .withIndex("by_receiptId", (q) => q.eq("receiptId", args.receiptId))
      .unique();
    if (
      !receipt ||
      !isOwnedBy(receipt, userId) ||
      receipt.policyAction !== "escalated"
    ) return false;
    await ctx.db.patch(receipt._id, {
      approvalState: "pending",
      approvalRequestedAt: receipt.approvalRequestedAt ?? Date.now(),
      approvalReviewNotes: args.reviewNotes ?? receipt.approvalReviewNotes,
    });
    return true;
  },
});

/**
 * Record an approval decision for an existing receipt-backed action.
 *
 * This mutation is decision-only: no execution engine consumes the decision yet,
 * so the original policy and result fields must remain unchanged.
 */
export const resolveApproval = mutation({
  args: {
    receiptId: v.string(),
    decision: v.union(v.literal("approved"), v.literal("denied")),
    reviewNotes: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await getReceiptOwnerId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const receipt = await ctx.db
      .query("actionReceipts")
      .withIndex("by_receiptId", (q) => q.eq("receiptId", args.receiptId))
      .unique();
    if (
      !receipt ||
      !isOwnedBy(receipt, userId) ||
      receipt.approvalState !== "pending" ||
      receipt.policyAction !== "escalated"
    ) return false;

    await ctx.db.patch(receipt._id, {
      approvalState: args.decision,
      approvalReviewedAt: Date.now(),
      approvalReviewedBy: String(userId),
      approvalReviewNotes: args.reviewNotes,
    });
    return true;
  },
});

// â”€â”€â”€ Verification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Verify the integrity of a receipt by recomputing its content hash.
 * Returns { valid: true } if the stored receiptId matches the recomputed hash,
 * or { valid: false, expected, actual } if tampered.
 */
export const verifyReceiptHash = query({
  args: { receiptId: v.string() },
  returns: v.object({
    valid: v.boolean(),
    expected: v.string(),
    actual: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = await getReceiptOwnerId(ctx);
    if (!userId) {
      return { valid: false, expected: args.receiptId, actual: "NOT_FOUND" };
    }
    const receipt = await ctx.db
      .query("actionReceipts")
      .withIndex("by_receiptId", (q) => q.eq("receiptId", args.receiptId))
      .unique();
    if (!receipt || !isOwnedBy(receipt, userId)) {
      return { valid: false, expected: args.receiptId, actual: "NOT_FOUND" };
    }
    const actual = await computeReceiptId(receipt as Record<string, any>);
    return {
      valid: actual === receipt.receiptId,
      expected: receipt.receiptId,
      actual,
    };
  },
});

// â”€â”€â”€ Emission Helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * emitReceipt â€” internal action that computes the content hash and stores
 * the receipt atomically. Called by orchestrators after each tool execution.
 *
 * This is the primary entry point for instrumenting agent tool calls.
 */
export const emitReceipt = internalAction({
  args: {
    agentId: v.string(),
    agentRunId: v.optional(v.id("agentRuns")),
    userId: v.optional(v.id("users")),
    toolName: v.string(),
    sessionKey: v.optional(v.string()),
    channelId: v.optional(v.string()),
    direction: v.optional(openclawDirectionValidator),
    openclawSessionId: v.optional(v.id("openclawSessions")),
    openclawExecutionId: v.optional(v.id("openclawExecutions")),
    deployment: v.optional(v.string()),
    params: v.optional(v.any()),
    actionSummary: v.string(),
    policyId: v.string(),
    policyRuleName: v.string(),
    policyAction: v.string(),
    evidenceRefs: v.array(v.string()),
    resultSuccess: v.boolean(),
    resultSummary: v.string(),
    resultOutputHash: v.optional(v.string()),
    canUndo: v.boolean(),
    undoInstructions: v.optional(v.string()),
    approvalState: v.optional(approvalStateValidator),
    approvalRequestedAt: v.optional(v.number()),
    approvalReviewedAt: v.optional(v.number()),
    approvalReviewedBy: v.optional(v.string()),
    approvalReviewNotes: v.optional(v.string()),
    violations: v.array(violationValidator),
  },
  returns: v.id("actionReceipts"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const receiptId = await computeReceiptId({ ...args, createdAt: now });

    // Store via internal mutation
    return await ctx.runMutation(
      internal.domains.agents.receipts.actionReceipts.logReceiptInternal,
      { ...args, receiptId, createdAt: now },
    );
  },
});
