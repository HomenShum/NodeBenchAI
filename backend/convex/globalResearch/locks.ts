// convex/globalResearch/locks.ts
// Nonce-owned single-flight cache for global research queries.
// Prevents N concurrent users from running the same expensive search N times.

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { Doc } from "../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Lock becomes stale after 10 minutes (allows retry if action hangs) */
const LOCK_STALE_MS = 10 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type LockAcquireResult =
  | { action: "acquired"; runId: string; lockNonce: string }
  | { action: "cache_hit"; runId: string }
  | { action: "wait"; runId: string; startedAt: number }
  | { action: "stale_revalidate"; runId: string; lockNonce: string; cachedRunId: string };

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Attempt to acquire a lock for a query, or return cache status.
 * 
 * Returns one of:
 * - "acquired": You own the lock. Execute the query and call releaseLock when done.
 * - "cache_hit": A recent completed run exists. Use its results.
 * - "wait": Another caller is running this query. Poll or subscribe for completion.
 * - "stale_revalidate": Cache expired but usable. You own the lock for refresh.
 *   Use cachedRunId for immediate results while refreshing.
 */
export const acquireOrWait = internalMutation({
  args: {
    queryKey: v.string(),
    ttlMs: v.number(),
  },
  returns: v.object({
    action: v.union(
      v.literal("acquired"),
      v.literal("cache_hit"),
      v.literal("wait"),
      v.literal("stale_revalidate")
    ),
    runId: v.string(),
    lockNonce: v.optional(v.string()),
    cachedRunId: v.optional(v.string()),
    startedAt: v.optional(v.number()),
  }),
  handler: async (ctx, { queryKey, ttlMs }): Promise<LockAcquireResult & { startedAt?: number }> => {
    const existing = await ctx.db
      .query("globalQueryLocks")
      .withIndex("by_queryKey", (q) => q.eq("queryKey", queryKey))
      .first() as Doc<"globalQueryLocks"> | null;

    const now = Date.now();

    if (existing) {
      const lockAge = now - existing.startedAt;
      const isStale = lockAge > existing.staleAfterMs;

      // Case 1: Running and not stale - wait for it
      if (existing.status === "running" && !isStale) {
        return {
          action: "wait",
          runId: existing.runId,
          startedAt: existing.startedAt,
        };
      }

      // Case 2: Completed and not expired - cache hit
      if (existing.status === "completed" && existing.completedAt) {
        const expiresAt = existing.completedAt + ttlMs;
        if (now < expiresAt) {
          return {
            action: "cache_hit",
            runId: existing.runId,
          };
        }

        // Expired but usable - stale-while-revalidate
        // IMPORTANT: Store cachedRunId BEFORE patching
        const cachedRunId = existing.runId;
        const newRunId = `grr_${crypto.randomUUID()}`;
        const newNonce = crypto.randomUUID();

        await ctx.db.patch(existing._id, {
          status: "running",
          runId: newRunId,
          lockNonce: newNonce,
          startedAt: now,
          completedAt: undefined,
          failedAt: undefined,
          error: undefined,
          staleAfterMs: LOCK_STALE_MS,
        });

        return {
          action: "stale_revalidate",
          runId: newRunId,
          lockNonce: newNonce,
          cachedRunId,
        };
      }

      // Case 3: Failed or stale running - acquire fresh
      const newRunId = `grr_${crypto.randomUUID()}`;
      const newNonce = crypto.randomUUID();

      await ctx.db.patch(existing._id, {
        status: "running",
        runId: newRunId,
        lockNonce: newNonce,
        startedAt: now,
        completedAt: undefined,
        failedAt: undefined,
        error: undefined,
        staleAfterMs: LOCK_STALE_MS,
      });

      return {
        action: "acquired",
        runId: newRunId,
        lockNonce: newNonce,
      };
    }

    // No lock exists - create new
    const newRunId = `grr_${crypto.randomUUID()}`;
    const newNonce = crypto.randomUUID();

    await ctx.db.insert("globalQueryLocks", {
      queryKey,
      status: "running",
      runId: newRunId,
      lockNonce: newNonce,
      startedAt: now,
      staleAfterMs: LOCK_STALE_MS,
    });

    return {
      action: "acquired",
      runId: newRunId,
      lockNonce: newNonce,
    };
  },
});

/**
 * Release a lock after query completion or failure.
 * Only releases if both runId AND lockNonce match (ownership verification).
 */
export const releaseLock = internalMutation({
  args: {
    queryKey: v.string(),
    runId: v.string(),
    lockNonce: v.string(),
    success: v.boolean(),
    error: v.optional(v.string()),
    artifactCount: v.optional(v.number()),
  },
  returns: v.object({
    released: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, { queryKey, runId, lockNonce, success, error }) => {
    const lock = await ctx.db
      .query("globalQueryLocks")
      .withIndex("by_queryKey", (q) => q.eq("queryKey", queryKey))
      .first() as Doc<"globalQueryLocks"> | null;

    // Verify ownership: both runId AND lockNonce must match
    if (lock && lock.lockNonce === lockNonce && lock.runId === runId) {
      const now = Date.now();

      await ctx.db.patch(lock._id, {
        status: success ? "completed" : "failed",
        completedAt: success ? now : undefined,
        failedAt: success ? undefined : now,
        error: success ? undefined : error,
      });

      return { released: true };
    }

    // Ownership mismatch - log for debugging but don't throw
    if (lock) {
      const reason =
        lock.runId !== runId
          ? "runId_mismatch"
          : lock.lockNonce !== lockNonce
            ? "nonce_mismatch"
            : "unknown";
      console.warn(
        `[globalResearch/locks] Release failed: ${reason}`,
        { queryKey, expectedRunId: lock.runId, actualRunId: runId }
      );
      return { released: false, reason };
    }

    return { released: false, reason: "lock_not_found" };
  },
});

/**
 * Check if a lock exists and its current status.
 * Useful for polling from clients.
 */
export const getLockStatus = internalMutation({
  args: {
    queryKey: v.string(),
  },
  returns: v.union(
    v.object({
      exists: v.literal(true),
      status: v.union(
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed")
      ),
      runId: v.string(),
      startedAt: v.number(),
      completedAt: v.optional(v.number()),
      failedAt: v.optional(v.number()),
      isStale: v.boolean(),
    }),
    v.object({
      exists: v.literal(false),
    })
  ),
  handler: async (ctx, { queryKey }) => {
    const lock = await ctx.db
      .query("globalQueryLocks")
      .withIndex("by_queryKey", (q) => q.eq("queryKey", queryKey))
      .first() as Doc<"globalQueryLocks"> | null;

    if (!lock) {
      return { exists: false as const };
    }

    const now = Date.now();
    const lockAge = now - lock.startedAt;
    const isStale = lock.status === "running" && lockAge > lock.staleAfterMs;

    return {
      exists: true as const,
      status: lock.status,
      runId: lock.runId,
      startedAt: lock.startedAt,
      completedAt: lock.completedAt,
      failedAt: lock.failedAt,
      isStale,
    };
  },
});

/**
 * Force-release a stale lock (for admin/cron cleanup).
 * Only releases if the lock is actually stale.
 */
export const forceReleaseStale = internalMutation({
  args: {
    queryKey: v.string(),
  },
  returns: v.object({
    released: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, { queryKey }) => {
    const lock = await ctx.db
      .query("globalQueryLocks")
      .withIndex("by_queryKey", (q) => q.eq("queryKey", queryKey))
      .first() as Doc<"globalQueryLocks"> | null;

    if (!lock) {
      return { released: false, reason: "lock_not_found" };
    }

    if (lock.status !== "running") {
      return { released: false, reason: "not_running" };
    }

    const now = Date.now();
    const lockAge = now - lock.startedAt;

    if (lockAge <= lock.staleAfterMs) {
      return { released: false, reason: "not_stale_yet" };
    }

    // Force to failed status
    await ctx.db.patch(lock._id, {
      status: "failed",
      failedAt: now,
      error: "Force released: lock was stale",
    });

    console.log(
      `[globalResearch/locks] Force-released stale lock`,
      { queryKey, runId: lock.runId, ageMs: lockAge }
    );

    return { released: true };
  },
});
