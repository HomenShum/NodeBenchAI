/**
 * Interrupt Manager
 * 
 * Manages HITL interrupt state in Convex
 * Based on LangChain interrupt/resume pattern
 */

import { v } from "convex/values";
import { mutation, query } from "../../../_generated/server";
import type { DecisionType, InterruptRequest, DecisionResponse } from "./config";

/**
 * Create a new interrupt request
 */
export const createInterrupt = mutation({
  args: {
    threadId: v.string(),
    toolName: v.string(),
    arguments: v.any(),
    description: v.string(),
    allowedDecisions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const interruptId = await ctx.db.insert("agentInterrupts", {
      threadId: args.threadId,
      toolName: args.toolName,
      arguments: args.arguments,
      description: args.description,
      allowedDecisions: args.allowedDecisions,
      status: "pending",
      createdAt: Date.now(),
    });
    
    console.log(`[HITL] Created interrupt ${interruptId} for tool: ${args.toolName}`);
    return interruptId;
  },
});

/**
 * Get pending interrupts for a thread
 */
export const getPendingInterrupts = query({
  args: {
    threadId: v.string(),
  },
  returns: v.array(v.object({
    _id: v.id("agentInterrupts"),
    threadId: v.string(),
    toolName: v.string(),
    arguments: v.any(),
    description: v.string(),
    allowedDecisions: v.array(v.string()),
    status: v.string(),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const interrupts = await ctx.db
      .query("agentInterrupts")
      .filter((q) => q.eq(q.field("threadId"), args.threadId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();
    
    return interrupts;
  },
});

/**
 * Resolve an interrupt with a decision
 */
export const resolveInterrupt = mutation({
  args: {
    interruptId: v.id("agentInterrupts"),
    decision: v.object({
      type: v.string(),
      editedAction: v.optional(v.object({
        name: v.string(),
        args: v.any(),
      })),
      message: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const interrupt = await ctx.db.get(args.interruptId) as { _id: typeof args.interruptId; status: string; allowedDecisions: string[] } | null;
    if (!interrupt) {
      throw new Error(`Interrupt ${args.interruptId} not found`);
    }

    if (interrupt.status !== "pending") {
      throw new Error(`Interrupt ${args.interruptId} already resolved`);
    }

    // Validate decision type
    if (!interrupt.allowedDecisions.includes(args.decision.type)) {
      throw new Error(`Decision type '${args.decision.type}' not allowed. Allowed: ${interrupt.allowedDecisions.join(", ")}`);
    }

    await ctx.db.patch(args.interruptId, {
      status: args.decision.type, // "approve", "edit", or "reject"
      decision: args.decision,
      resolvedAt: Date.now(),
    });

    console.log(`[HITL] Resolved interrupt ${args.interruptId} with decision: ${args.decision.type}`);
    return { success: true, decision: args.decision };
  },
});

/**
 * Get interrupt by ID
 */
export const getInterrupt = query({
  args: {
    interruptId: v.id("agentInterrupts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.interruptId);
  },
});

/**
 * Cancel a pending interrupt
 */
export const cancelInterrupt = mutation({
  args: {
    interruptId: v.id("agentInterrupts"),
  },
  handler: async (ctx, args) => {
    const interrupt = await ctx.db.get(args.interruptId);
    if (!interrupt) {
      throw new Error(`Interrupt ${args.interruptId} not found`);
    }
    
    await ctx.db.patch(args.interruptId, {
      status: "cancelled",
      resolvedAt: Date.now(),
    });
    
    return { success: true };
  },
});
