import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "../../_generated/server";

// ============================================================
// Chat Memories — persistent cross-thread memory
// ============================================================

export const listMemories = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object({
    _id: v.id("chatMemories"),
    _creationTime: v.number(),
    userId: v.id("users"),
    text: v.string(),
    source: v.optional(v.union(v.literal("user"), v.literal("context_menu"), v.literal("auto"))),
    threadId: v.optional(v.string()),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();
    if (!user) return [];
    return await ctx.db
      .query("chatMemories")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const addMemory = mutation({
  args: {
    text: v.string(),
    source: v.optional(v.union(v.literal("user"), v.literal("context_menu"), v.literal("auto"))),
    threadId: v.optional(v.string()),
  },
  returns: v.id("chatMemories"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();
    if (!user) throw new Error("User not found");
    return await ctx.db.insert("chatMemories", {
      userId: user._id,
      text: args.text,
      source: args.source ?? "user",
      threadId: args.threadId,
      createdAt: Date.now(),
    });
  },
});

export const removeMemory = mutation({
  args: { id: v.id("chatMemories") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const mem = await ctx.db.get(args.id);
    if (!mem) return null;
    await ctx.db.delete(args.id);
    return null;
  },
});

// ============================================================
// Chat Snapshots — save/restore conversation state
// ============================================================

export const listSnapshots = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object({
    _id: v.id("chatSnapshots"),
    _creationTime: v.number(),
    userId: v.id("users"),
    threadId: v.optional(v.string()),
    name: v.string(),
    messageCount: v.number(),
    messages: v.array(v.object({ role: v.string(), text: v.string() })),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();
    if (!user) return [];
    return await ctx.db
      .query("chatSnapshots")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(args.limit ?? 20);
  },
});

export const saveSnapshot = mutation({
  args: {
    threadId: v.optional(v.string()),
    name: v.string(),
    messages: v.array(v.object({ role: v.string(), text: v.string() })),
  },
  returns: v.id("chatSnapshots"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();
    if (!user) throw new Error("User not found");
    return await ctx.db.insert("chatSnapshots", {
      userId: user._id,
      threadId: args.threadId,
      name: args.name,
      messageCount: args.messages.length,
      messages: args.messages,
      createdAt: Date.now(),
    });
  },
});

export const deleteSnapshot = mutation({
  args: { id: v.id("chatSnapshots") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
});

// ============================================================
// Chat Annotations — per-message notes
// ============================================================

export const listAnnotations = query({
  args: { threadId: v.optional(v.string()) },
  returns: v.array(v.object({
    _id: v.id("chatAnnotations"),
    _creationTime: v.number(),
    userId: v.id("users"),
    messageId: v.string(),
    threadId: v.optional(v.string()),
    note: v.string(),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();
    if (!user) return [];
    if (args.threadId) {
      return await ctx.db
        .query("chatAnnotations")
        .withIndex("by_user_thread", (q) => q.eq("userId", user._id).eq("threadId", args.threadId))
        .order("desc")
        .take(200);
    }
    return await ctx.db
      .query("chatAnnotations")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(200);
  },
});

export const addAnnotation = mutation({
  args: {
    messageId: v.string(),
    threadId: v.optional(v.string()),
    note: v.string(),
  },
  returns: v.id("chatAnnotations"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();
    if (!user) throw new Error("User not found");
    return await ctx.db.insert("chatAnnotations", {
      userId: user._id,
      messageId: args.messageId,
      threadId: args.threadId,
      note: args.note,
      createdAt: Date.now(),
    });
  },
});

// ============================================================
// Tool Approvals — human-in-the-loop tool approval
// ============================================================

export const listPendingApprovals = query({
  args: { threadId: v.optional(v.string()) },
  returns: v.array(v.object({
    _id: v.id("toolApprovals"),
    _creationTime: v.number(),
    userId: v.id("users"),
    threadId: v.string(),
    toolName: v.string(),
    toolArgs: v.any(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    riskLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    reason: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();
    if (!user) return [];
    if (args.threadId) {
      return await ctx.db
        .query("toolApprovals")
        .withIndex("by_thread", (q) => q.eq("threadId", args.threadId).eq("status", "pending"))
        .order("desc")
        .take(50);
    }
    return await ctx.db
      .query("toolApprovals")
      .withIndex("by_user_pending", (q) => q.eq("userId", user._id).eq("status", "pending"))
      .order("desc")
      .take(50);
  },
});

export const decideApproval = mutation({
  args: {
    id: v.id("toolApprovals"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.decision,
      reason: args.reason,
      decidedAt: Date.now(),
    });
    return null;
  },
});

export const createToolApproval = internalMutation({
  args: {
    userId: v.id("users"),
    threadId: v.string(),
    toolName: v.string(),
    toolArgs: v.any(),
    riskLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  },
  returns: v.id("toolApprovals"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("toolApprovals", {
      userId: args.userId,
      threadId: args.threadId,
      toolName: args.toolName,
      toolArgs: args.toolArgs,
      status: "pending",
      riskLevel: args.riskLevel,
      createdAt: Date.now(),
    });
  },
});
