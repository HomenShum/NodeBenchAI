/**
 * Snapshot Checkpoint — Pre-hook for destructive agent tool calls
 *
 * A-PR-A.2 of the Autonomous Continuation System.
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Captures the pre-mutation state of an artifact (notebook, entity, report,
 * claim, etc.) into the `agentSnapshots` table just before an agent calls a
 * destructive tool. Used by `rollbackToCheckpoint` (A-PR-A.3) to restore
 * artifact state after an agent semantic spiral or a user `/rollback`.
 *
 * Design properties:
 *   - sha256 dedup: identical content for the same (threadId, artifactId)
 *     reuses the existing row instead of creating a duplicate. Ten retries
 *     of the same failing tool call do not blow up storage.
 *   - 100/thread cap: bounded by `MAX_SNAPSHOTS_PER_THREAD`. Oldest entries
 *     are pruned by `createdAt`. Caller gets `pruned: N` so it can be logged.
 *   - Internal-only: not callable from clients. Pre-hook fires from the
 *     coordinator/subagent pipeline immediately before invoking a tool.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
} from "../../../_generated/server";
import type { Doc } from "../../../_generated/dataModel";

/**
 * Hard cap on snapshots retained per thread (BOUND rule).
 * Exceeding this triggers FIFO eviction inside `captureSnapshot`.
 */
export const MAX_SNAPSHOTS_PER_THREAD = 100;

/**
 * Compute a hex sha256 digest of the supplied string.
 * Uses Web Crypto API which is available in the Convex V8 isolate.
 */
async function computeSha256Hex(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validator describing the public shape of a snapshot row.
 * Mirrors the table schema in `convex/schema.ts` (see A-PR-A.1).
 */
const snapshotDocValidator = v.object({
  _id: v.id("agentSnapshots"),
  _creationTime: v.number(),
  threadId: v.string(),
  turnId: v.number(),
  toolName: v.string(),
  artifactType: v.string(),
  artifactId: v.string(),
  contentSha256: v.string(),
  content: v.string(),
  parentTurnId: v.optional(v.number()),
  createdAt: v.number(),
});

/**
 * Pre-hook mutation — write the pre-mutation artifact state into
 * `agentSnapshots`. Returns `{ snapshotId, deduped, contentSha256, pruned }`
 * so the caller can log the dedup outcome and any FIFO eviction count.
 *
 * Callers (coordinator / subagent runtimes) MUST invoke this before any
 * destructive tool call (`patch_notebook`, `export_report`,
 * `update_entity`, `merge_claims`, etc.). The current artifact state is
 * the responsibility of the caller — this mutation does not read live
 * artifact state itself, it only persists what was passed in.
 */
export const captureSnapshot = internalMutation({
  args: {
    /** Convex agent thread that owns the snapshot. */
    threadId: v.string(),
    /** Monotonic turn counter within the thread. */
    turnId: v.number(),
    /** Tool that is about to mutate (informational). */
    toolName: v.string(),
    /** Artifact category — `notebook`, `entity`, `report`, `claim`, etc. */
    artifactType: v.string(),
    /** Stable identifier of the artifact being snapshotted. */
    artifactId: v.string(),
    /** Serialized JSON of the pre-mutation artifact state. */
    content: v.string(),
    /** Previous turn that this snapshot extends (for chain visualization). */
    parentTurnId: v.optional(v.number()),
  },
  returns: v.object({
    snapshotId: v.id("agentSnapshots"),
    deduped: v.boolean(),
    contentSha256: v.string(),
    pruned: v.number(),
  }),
  handler: async (ctx, args) => {
    const contentSha256 = await computeSha256Hex(args.content);

    // Dedup: if the most recent snapshot for this (threadId, artifactType,
    // artifactId) already has the same content hash, reuse it. This keeps
    // retries / no-op tool calls from inflating storage.
    const existing = await ctx.db
      .query("agentSnapshots")
      .withIndex("by_thread_artifact", (q) =>
        q
          .eq("threadId", args.threadId)
          .eq("artifactType", args.artifactType)
          .eq("artifactId", args.artifactId),
      )
      .order("desc")
      .first();

    if (existing && existing.contentSha256 === contentSha256) {
      return {
        snapshotId: existing._id,
        deduped: true,
        contentSha256,
        pruned: 0,
      };
    }

    // Otherwise insert a fresh snapshot row.
    const snapshotId = await ctx.db.insert("agentSnapshots", {
      threadId: args.threadId,
      turnId: args.turnId,
      toolName: args.toolName,
      artifactType: args.artifactType,
      artifactId: args.artifactId,
      contentSha256,
      content: args.content,
      parentTurnId: args.parentTurnId,
      createdAt: Date.now(),
    });

    // Enforce per-thread cap. We collect the entire thread's snapshots so
    // we can sort and evict the oldest. With MAX_SNAPSHOTS_PER_THREAD = 100
    // this remains well under Convex's per-mutation read limit.
    const allForThread = await ctx.db
      .query("agentSnapshots")
      .withIndex("by_thread_turn", (q) => q.eq("threadId", args.threadId))
      .collect();

    let pruned = 0;
    if (allForThread.length > MAX_SNAPSHOTS_PER_THREAD) {
      const overflow = allForThread.length - MAX_SNAPSHOTS_PER_THREAD;
      const toDelete = [...allForThread]
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, overflow);
      for (const old of toDelete) {
        await ctx.db.delete(old._id);
        pruned += 1;
      }
    }

    return {
      snapshotId,
      deduped: false,
      contentSha256,
      pruned,
    };
  },
});

/**
 * Internal helper — fetch the latest snapshot for a given
 * (threadId, artifactType, artifactId) tuple. Used by `rollbackToCheckpoint`
 * (A-PR-A.3) to look up the artifact state to restore. Returns `null` when
 * no snapshot exists, never a fake-success placeholder.
 */
export const getLatestSnapshotForArtifact = internalQuery({
  args: {
    threadId: v.string(),
    artifactType: v.string(),
    artifactId: v.string(),
  },
  returns: v.union(v.null(), snapshotDocValidator),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("agentSnapshots")
      .withIndex("by_thread_artifact", (q) =>
        q
          .eq("threadId", args.threadId)
          .eq("artifactType", args.artifactType)
          .eq("artifactId", args.artifactId),
      )
      .order("desc")
      .first();
    return (row as Doc<"agentSnapshots"> | null) ?? null;
  },
});

/**
 * Internal helper — fetch the most recent N snapshots for a thread,
 * regardless of artifact. Used by audit views and by `rollbackToCheckpoint`
 * when a user asks for `/rollback N` (steps back). Order is descending by
 * `turnId` so the caller can take the first `stepsBack` items.
 */
export const listRecentSnapshotsForThread = internalQuery({
  args: {
    threadId: v.string(),
    /** Maximum number of rows to return. Defaults to 25. */
    limit: v.optional(v.number()),
  },
  returns: v.array(snapshotDocValidator),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 25;
    const rows = await ctx.db
      .query("agentSnapshots")
      .withIndex("by_thread_turn", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(limit);
    return rows;
  },
});
