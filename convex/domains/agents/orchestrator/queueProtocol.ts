import { v } from "convex/values";
import { internalMutation, mutation, query, internalQuery } from "../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../../../_generated/dataModel";

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

function nowMs() {
  return Date.now();
}

export const getRun = internalQuery({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.runId);
  },
});

/** Fence each provider attempt and keep the run ledger aligned with its model. */
export const setEffectiveModel = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    workerId: v.string(),
    model: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId) as {
      leaseOwner?: string;
      leaseExpiresAt?: number;
      status?: string;
      model?: string;
    } | null;
    if (!run) throw new Error("Run not found");
    if (run.leaseOwner !== args.workerId) throw new Error("Not lease owner");
    if (run.status !== "running") throw new Error("Run is not active");

    const now = nowMs();
    if (typeof run.leaseExpiresAt !== "number" || run.leaseExpiresAt <= now) {
      throw new Error("Run lease expired");
    }

    // Each attempt is bounded below this window. Refreshing here prevents a live
    // stream from being reclaimed between provider fallbacks without allowing an
    // already-expired worker to resurrect its lease.
    await ctx.db.patch(args.runId, {
      model: args.model,
      leaseExpiresAt: now + DEFAULT_LEASE_MS,
      updatedAt: now,
    });
    return null;
  },
});

/**
 * Enqueue an existing agent run for worker processing.
 *
 * Idempotent: patching an already queued run is safe.
 */
export const enqueueRun = mutation({
  args: {
    runId: v.id("agentRuns"),
    priority: v.optional(v.number()),
    availableAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const run = await ctx.db.get(args.runId) as { userId: typeof userId; priority?: number; availableAt?: number } | null;
    if (!run) throw new Error("Run not found");
    if (run.userId !== userId) throw new Error("Not authorized");

    const now = nowMs();
    await ctx.db.patch(args.runId, {
      status: "queued",
      priority: args.priority ?? run.priority ?? 0,
      availableAt: args.availableAt ?? run.availableAt ?? now,
      updatedAt: now,
    });
    return null;
  },
});

/**
 * Claim the next available work item for a worker.
 *
 * Safe against concurrent claims because Convex serializes mutations.
 */
export const claimNextWorkItem = internalMutation({
  args: {
    workerId: v.string(),
    leaseMs: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      runId: v.id("agentRuns"),
      leaseOwner: v.string(),
      leaseExpiresAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const now = nowMs();
    const leaseMs = Math.max(30_000, Math.min(args.leaseMs ?? DEFAULT_LEASE_MS, 30 * 60 * 1000));
    const leaseExpiresAt = now + leaseMs;

    // Find the next runnable item: queued + availableAt <= now, and unleased or expired lease.
    const candidates = await ctx.db
      .query("agentRuns")
      .withIndex("by_status_availableAt", (q) => q.eq("status", "queued"))
      .order("asc")
      .take(50);

    const pick = candidates.find((r: any) => {
      const availableAt = typeof r.availableAt === "number" ? r.availableAt : r.createdAt;
      const leaseExpires = typeof r.leaseExpiresAt === "number" ? r.leaseExpiresAt : null;
      const leaseOwner = typeof r.leaseOwner === "string" ? r.leaseOwner : null;
      const isAvailable = availableAt <= now;
      const isUnleased = !leaseOwner;
      const isExpired = leaseExpires !== null && leaseExpires < now;
      return isAvailable && (isUnleased || isExpired);
    });

    if (!pick) return null;

    await ctx.db.patch(pick._id, {
      leaseOwner: args.workerId,
      leaseExpiresAt,
      status: "running",
      updatedAt: now,
    });

    return { runId: pick._id as Id<"agentRuns">, leaseOwner: args.workerId, leaseExpiresAt };
  },
});

/**
 * Extend an active lease for a run.
 */
export const heartbeatLease = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    workerId: v.string(),
    leaseMs: v.optional(v.number()),
  },
  returns: v.object({ ok: v.boolean(), leaseExpiresAt: v.optional(v.number()) }),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId) as { leaseOwner?: string; leaseExpiresAt?: number } | null;
    if (!run) return { ok: false, leaseExpiresAt: undefined };
    if (run.leaseOwner !== args.workerId) return { ok: false, leaseExpiresAt: run.leaseExpiresAt };

    const now = nowMs();
    const leaseMs = Math.max(30_000, Math.min(args.leaseMs ?? DEFAULT_LEASE_MS, 30 * 60 * 1000));
    const leaseExpiresAt = now + leaseMs;

    await ctx.db.patch(args.runId, { leaseExpiresAt, updatedAt: now });
    return { ok: true, leaseExpiresAt };
  },
});

export const completeWorkItem = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    workerId: v.string(),
    result: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId) as { leaseOwner?: string } | null;
    if (!run) throw new Error("Run not found");
    if (run.leaseOwner !== args.workerId) throw new Error("Not lease owner");

    const now = nowMs();
    await ctx.db.patch(args.runId, {
      status: "completed",
      finalResponse: typeof args.result === "string" ? args.result : JSON.stringify(args.result),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    return null;
  },
});

export const failWorkItem = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    workerId: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId) as { leaseOwner?: string } | null;
    if (!run) throw new Error("Run not found");
    if (run.leaseOwner !== args.workerId) throw new Error("Not lease owner");

    const now = nowMs();
    await ctx.db.patch(args.runId, {
      status: "error",
      errorMessage: args.error,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    return null;
  },
});

/**
 * Reclaim expired leases so other workers can pick them up.
 */
export const reclaimExpiredLeases = internalMutation({
  args: {},
  returns: v.object({ reclaimed: v.number() }),
  handler: async (ctx) => {
    const now = nowMs();
    const expired = await ctx.db
      .query("agentRuns")
      .withIndex("by_leaseExpiresAt", (q) => q.lt("leaseExpiresAt", now))
      .take(200);

    let reclaimed = 0;
    for (const run of expired) {
      if (!run.leaseOwner) continue;
      // Put it back to queued; preserve priority/availableAt.
      await ctx.db.patch(run._id, {
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        status: "queued",
        updatedAt: now,
      });
      reclaimed++;
    }

    return { reclaimed };
  },
});

/**
 * Debug query: list currently queued/running items.
 */
export const listQueue = query({
  args: {
    status: v.optional(v.union(v.literal("queued"), v.literal("running"))),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("agentRuns"),
      status: v.string(),
      priority: v.optional(v.number()),
      availableAt: v.optional(v.number()),
      leaseOwner: v.optional(v.string()),
      leaseExpiresAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 200) : 50;
    const status = args.status ?? "queued";
    const rows = await ctx.db
      .query("agentRuns")
      .withIndex("by_status_availableAt", (q) => q.eq("status", status))
      .order("asc")
      .take(limit);
    return rows.map((r) => ({
      _id: r._id,
      status: r.status,
      priority: r.priority,
      availableAt: r.availableAt,
      leaseOwner: r.leaseOwner,
      leaseExpiresAt: r.leaseExpiresAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  },
});
