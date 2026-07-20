/**
 * Shared Context Operations — Vercel-durable delegation flow
 *
 * Replaces ephemeral SQLite /tmp/.nodebench.db writes with durable Convex
 * persistence so context packets, peers, tasks, and messages survive across
 * serverless function invocations.
 *
 * All list queries are bounded with .take() to prevent unbounded reads.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";

// ===========================================================================
// Peers
// ===========================================================================

export const registerPeer = mutation({
  args: {
    peerId: v.string(),
    product: v.union(v.literal("nodebench"), v.literal("ta_studio")),
    tenantId: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    surface: v.union(
      v.literal("web"),
      v.literal("browser"),
      v.literal("runner"),
      v.literal("evaluator"),
      v.literal("packet_engine"),
      v.literal("qa_runner"),
      v.literal("monitor"),
      v.literal("local_runtime"),
      v.literal("api"),
    ),
    role: v.union(
      v.literal("researcher"),
      v.literal("compiler"),
      v.literal("judge"),
      v.literal("explorer"),
      v.literal("replay"),
      v.literal("environment_builder"),
      v.literal("runner"),
      v.literal("observer"),
      v.literal("monitor"),
      v.literal("router"),
    ),
    capabilities: v.optional(v.array(v.string())),
    contextScopes: v.optional(v.array(v.string())),
    summary: v.optional(v.object({
      currentTask: v.optional(v.string()),
      focusEntity: v.optional(v.string()),
      focusWorkflow: v.optional(v.string()),
      currentState: v.optional(v.string()),
      confidence: v.optional(v.number()),
      lastUpdate: v.optional(v.string()),
      availableArtifacts: v.optional(v.array(v.string())),
      permissionScope: v.optional(v.array(v.string())),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Upsert: check if peer already exists
    const existing = await ctx.db
      .query("sharedContextPeers")
      .withIndex("by_peerId", (q) => q.eq("peerId", args.peerId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        product: args.product,
        tenantId: args.tenantId,
        workspaceId: args.workspaceId,
        surface: args.surface,
        role: args.role,
        capabilities: args.capabilities ?? existing.capabilities,
        contextScopes: args.contextScopes ?? existing.contextScopes,
        summary: args.summary ?? existing.summary,
        status: "active" as const,
        lastHeartbeatAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("sharedContextPeers", {
      peerId: args.peerId,
      product: args.product,
      tenantId: args.tenantId,
      workspaceId: args.workspaceId,
      surface: args.surface,
      role: args.role,
      capabilities: args.capabilities ?? [],
      contextScopes: args.contextScopes ?? [],
      status: "active",
      summary: args.summary ?? {},
      lastHeartbeatAt: now,
      createdAt: now,
    });
  },
});

export const listPeers = query({
  args: {
    tenantId: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    role: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("idle"), v.literal("stale"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const take = Math.min(args.limit ?? 50, 200);

    if (args.workspaceId) {
      const status = args.status ?? "active";
      return ctx.db
        .query("sharedContextPeers")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("status", status),
        )
        .take(take);
    }

    if (args.tenantId) {
      const status = args.status ?? "active";
      return ctx.db
        .query("sharedContextPeers")
        .withIndex("by_tenant", (q) =>
          q.eq("tenantId", args.tenantId).eq("status", status),
        )
        .take(take);
    }

    // Fallback: scan with take bound
    return ctx.db
      .query("sharedContextPeers")
      .take(take);
  },
});

export const heartbeatPeer = mutation({
  args: {
    peerId: v.string(),
    summary: v.optional(v.object({
      currentTask: v.optional(v.string()),
      focusEntity: v.optional(v.string()),
      focusWorkflow: v.optional(v.string()),
      currentState: v.optional(v.string()),
      confidence: v.optional(v.number()),
      lastUpdate: v.optional(v.string()),
      availableArtifacts: v.optional(v.array(v.string())),
      permissionScope: v.optional(v.array(v.string())),
    })),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sharedContextPeers")
      .withIndex("by_peerId", (q) => q.eq("peerId", args.peerId))
      .first();
    if (!existing) throw new Error(`Peer not found: ${args.peerId}`);
    await ctx.db.patch(existing._id, {
      lastHeartbeatAt: Date.now(),
      status: "active" as const,
      ...(args.summary ? { summary: args.summary } : {}),
    });
  },
});

// ===========================================================================
// Packets
// ===========================================================================

export const publishPacket = mutation({
  args: {
    contextId: v.string(),
    contextType: v.union(
      v.literal("entity_packet"),
      v.literal("workflow_packet"),
      v.literal("trace_packet"),
      v.literal("judge_packet"),
      v.literal("environment_packet"),
      v.literal("failure_packet"),
      v.literal("state_snapshot_packet"),
      v.literal("verdict_packet"),
      v.literal("scenario_packet"),
      v.literal("change_packet"),
    ),
    producerPeerId: v.string(),
    tenantId: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    scope: v.optional(v.array(v.string())),
    subject: v.string(),
    summary: v.string(),
    claims: v.optional(v.array(v.string())),
    evidenceRefs: v.optional(v.array(v.string())),
    confidence: v.optional(v.number()),
    lineage: v.optional(v.object({
      parentContextIds: v.optional(v.array(v.string())),
      sourceRunId: v.optional(v.string()),
      sourceTraceId: v.optional(v.string()),
      supersedes: v.optional(v.string()),
    })),
    version: v.optional(v.number()),
    invalidates: v.optional(v.array(v.string())),
    freshness: v.optional(v.object({
      status: v.optional(v.union(v.literal("fresh"), v.literal("warming"), v.literal("stale"))),
      expiresAt: v.optional(v.string()),
      trustTier: v.optional(v.union(v.literal("internal"), v.literal("verified"), v.literal("directional"))),
    })),
    visibility: v.optional(v.union(v.literal("internal"), v.literal("workspace"), v.literal("tenant"))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // If this packet supersedes another, mark the old one
    if (args.lineage?.supersedes) {
      const old = await ctx.db
        .query("sharedContextPackets")
        .withIndex("by_contextId", (q) =>
          q.eq("contextId", args.lineage!.supersedes!),
        )
        .first();
      if (old) {
        await ctx.db.patch(old._id, { status: "superseded" as const });
      }
    }

    // Invalidate any packets listed in invalidates
    if (args.invalidates?.length) {
      for (const invId of args.invalidates) {
        const inv = await ctx.db
          .query("sharedContextPackets")
          .withIndex("by_contextId", (q) => q.eq("contextId", invId))
          .first();
        if (inv) {
          await ctx.db.patch(inv._id, { status: "invalidated" as const });
        }
      }
    }

    return ctx.db.insert("sharedContextPackets", {
      contextId: args.contextId,
      contextType: args.contextType,
      producerPeerId: args.producerPeerId,
      tenantId: args.tenantId,
      workspaceId: args.workspaceId,
      scope: args.scope ?? [],
      subject: args.subject,
      summary: args.summary,
      claims: args.claims ?? [],
      evidenceRefs: args.evidenceRefs ?? [],
      confidence: args.confidence,
      lineage: args.lineage,
      version: args.version ?? 1,
      invalidates: args.invalidates,
      freshness: args.freshness,
      visibility: args.visibility,
      status: "active",
      createdAt: now,
    });
  },
});

export const getPacket = query({
  args: { contextId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("sharedContextPackets")
      .withIndex("by_contextId", (q) => q.eq("contextId", args.contextId))
      .first();
  },
});

export const listPackets = query({
  args: {
    tenantId: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    contextType: v.optional(v.string()),
    producerPeerId: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("superseded"), v.literal("invalidated"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const take = Math.min(args.limit ?? 50, 200);
    const status = args.status ?? "active";

    // Primary path: tenant + workspace filter
    if (args.tenantId) {
      const results = await ctx.db
        .query("sharedContextPackets")
        .withIndex("by_tenant_workspace", (q) => {
          let q2 = q.eq("tenantId", args.tenantId);
          if (args.workspaceId) q2 = q2.eq("workspaceId", args.workspaceId);
          return q2.eq("status", status);
        })
        .take(take);
      return results;
    }

    // By producer
    if (args.producerPeerId) {
      return ctx.db
        .query("sharedContextPackets")
        .withIndex("by_producer", (q) =>
          q.eq("producerPeerId", args.producerPeerId).eq("status", status),
        )
        .take(take);
    }

    // By type
    if (args.contextType) {
      // contextType arg is a string, but the index expects the union type.
      // We trust the caller to pass a valid contextType.
      return ctx.db
        .query("sharedContextPackets")
        .withIndex("by_type", (q) =>
          q.eq("contextType", args.contextType as any).eq("status", status),
        )
        .take(take);
    }

    // Fallback
    return ctx.db.query("sharedContextPackets").take(take);
  },
});

// ===========================================================================
// Tasks
// ===========================================================================

export const proposeTask = mutation({
  args: {
    taskId: v.string(),
    taskType: v.string(),
    proposerPeerId: v.string(),
    assigneePeerId: v.string(),
    tenantId: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    description: v.optional(v.string()),
    taskSpec: v.optional(v.any()),
    inputContextIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert("sharedContextTasks", {
      taskId: args.taskId,
      taskType: args.taskType,
      proposerPeerId: args.proposerPeerId,
      assigneePeerId: args.assigneePeerId,
      tenantId: args.tenantId,
      workspaceId: args.workspaceId,
      description: args.description,
      status: "proposed",
      taskSpec: args.taskSpec,
      inputContextIds: args.inputContextIds ?? [],
      createdAt: now,
    });
  },
});

export const completeTask = mutation({
  args: {
    taskId: v.string(),
    outputContextId: v.optional(v.string()),
    reason: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("completed"),
      v.literal("rejected"),
      v.literal("escalated"),
    )),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query("sharedContextTasks")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .first();
    if (!task) throw new Error(`Task not found: ${args.taskId}`);

    await ctx.db.patch(task._id, {
      status: args.status ?? "completed",
      outputContextId: args.outputContextId,
      reason: args.reason,
      completedAt: Date.now(),
    });
  },
});

export const acceptTask = mutation({
  args: { taskId: v.string() },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query("sharedContextTasks")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .first();
    if (!task) throw new Error(`Task not found: ${args.taskId}`);
    if (task.status !== "proposed") {
      throw new Error(`Task ${args.taskId} is ${task.status}, cannot accept`);
    }
    await ctx.db.patch(task._id, { status: "accepted" as const });
  },
});

export const listTasks = query({
  args: {
    tenantId: v.optional(v.string()),
    assigneePeerId: v.optional(v.string()),
    proposerPeerId: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("proposed"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("completed"),
      v.literal("escalated"),
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const take = Math.min(args.limit ?? 50, 200);

    if (args.assigneePeerId) {
      const q = ctx.db
        .query("sharedContextTasks")
        .withIndex("by_assignee", (q) => {
          let q2 = q.eq("assigneePeerId", args.assigneePeerId!);
          if (args.status) q2 = q2.eq("status", args.status);
          return q2;
        });
      return q.take(take);
    }

    if (args.proposerPeerId) {
      const q = ctx.db
        .query("sharedContextTasks")
        .withIndex("by_proposer", (q) => {
          let q2 = q.eq("proposerPeerId", args.proposerPeerId!);
          if (args.status) q2 = q2.eq("status", args.status);
          return q2;
        });
      return q.take(take);
    }

    if (args.tenantId) {
      const q = ctx.db
        .query("sharedContextTasks")
        .withIndex("by_tenant", (q) => {
          let q2 = q.eq("tenantId", args.tenantId!);
          if (args.status) q2 = q2.eq("status", args.status);
          return q2;
        });
      return q.take(take);
    }

    return ctx.db.query("sharedContextTasks").take(take);
  },
});

// ===========================================================================
// Messages
// ===========================================================================

export const sendMessage = mutation({
  args: {
    fromPeerId: v.string(),
    toPeerId: v.string(),
    tenantId: v.optional(v.string()),
    messageType: v.union(
      v.literal("request"),
      v.literal("response"),
      v.literal("context_offer"),
      v.literal("context_pull"),
      v.literal("task_handoff"),
      v.literal("status_update"),
      v.literal("verdict"),
      v.literal("escalation"),
      v.literal("invalidation"),
    ),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("sharedContextMessages", {
      fromPeerId: args.fromPeerId,
      toPeerId: args.toPeerId,
      tenantId: args.tenantId,
      messageType: args.messageType,
      content: args.content,
      acknowledged: false,
      createdAt: Date.now(),
    });
  },
});

export const acknowledgeMessage = mutation({
  args: { messageId: v.id("sharedContextMessages") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { acknowledged: true });
  },
});

export const listMessages = query({
  args: {
    toPeerId: v.optional(v.string()),
    fromPeerId: v.optional(v.string()),
    tenantId: v.optional(v.string()),
    unacknowledgedOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const take = Math.min(args.limit ?? 50, 200);

    if (args.toPeerId) {
      if (args.unacknowledgedOnly) {
        return ctx.db
          .query("sharedContextMessages")
          .withIndex("by_to", (q) =>
            q.eq("toPeerId", args.toPeerId!).eq("acknowledged", false),
          )
          .take(take);
      }
      return ctx.db
        .query("sharedContextMessages")
        .withIndex("by_to", (q) => q.eq("toPeerId", args.toPeerId!))
        .take(take);
    }

    if (args.fromPeerId) {
      return ctx.db
        .query("sharedContextMessages")
        .withIndex("by_from", (q) => q.eq("fromPeerId", args.fromPeerId!))
        .take(take);
    }

    if (args.tenantId) {
      return ctx.db
        .query("sharedContextMessages")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId!))
        .take(take);
    }

    return ctx.db.query("sharedContextMessages").take(take);
  },
});
