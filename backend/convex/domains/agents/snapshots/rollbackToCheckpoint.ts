/**
 * Rollback To Checkpoint — Agent + user-callable rollback action
 *
 * A-PR-A.3 of the Autonomous Continuation System.
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Public action invoked from:
 *   - The chat composer keyword interceptor (A-PR-A.4) when a user types
 *     `/rollback`, `/rollback N`, "undo that", "revert that", etc.
 *   - Future agent self-rollback when the spiral detector trips
 *     (A-PR-B.7).
 *
 * Flow:
 *   1. Resolve which snapshot to restore from. Two modes:
 *        a) Explicit `turnId`        → exact-turn rollback (an audit pin).
 *        b) Implicit `stepsBack: N`  → rollback N most-recent destructive
 *                                      tool calls in this thread.
 *   2. Dispatch to a per-artifactType restore handler. Unknown types
 *      return `restore_handler_not_wired_for_<type>` (HONEST_STATUS rule —
 *      we never fake-success a missing handler). Domain owners wire their
 *      handler in a follow-up PR.
 *   3. Return a structured `RollbackResult`. The caller (composer) decides
 *      how to render it (`RollbackMessageCard` in A-PR-A.5).
 *
 * Anti-patterns avoided:
 *   - Auto-applying rollback without a user/agent command (only fired by
 *     explicit invocation).
 *   - Fake-success when a snapshot has been pruned past the retention
 *     window — we surface `snapshot_expired` with the oldest available
 *     turnId so the caller can negotiate with the user.
 *   - Cross-thread snapshot leakage — every lookup is gated on `threadId`.
 */

import { v } from "convex/values";
import { action } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Doc } from "../../../_generated/dataModel";

// ════════════════════════════════════════════════════════════════════════
// PUBLIC RESULT VALIDATORS
// ════════════════════════════════════════════════════════════════════════

/**
 * Restore-handler outcome for a single snapshot dispatch.
 * `ok: true`  → handler completed and applied the artifact restore.
 * `ok: false` → either the handler is unwired for this `artifactType` or
 *               the handler signaled failure. The reason is surfaced
 *               verbatim to the chat audit trail.
 */
const restoreOutcomeValidator = v.object({
  artifactType: v.string(),
  artifactId: v.string(),
  ok: v.boolean(),
  reason: v.optional(v.string()),
  restoredTurnId: v.number(),
});

const rollbackSuccessValidator = v.object({
  ok: v.literal(true),
  threadId: v.string(),
  /** turnId of the snapshot we rolled back TO (state at end of this turn). */
  restoredTurnId: v.number(),
  /** turnId we rolled back FROM (the live head before rollback). */
  fromTurnId: v.number(),
  /** Per-artifact dispatch outcomes. */
  outcomes: v.array(restoreOutcomeValidator),
  /** Wall-clock when the rollback completed. */
  rolledBackAt: v.number(),
});

const rollbackFailureValidator = v.object({
  ok: v.literal(false),
  threadId: v.string(),
  error: v.union(
    v.literal("no_snapshot"),
    v.literal("snapshot_expired"),
    v.literal("invalid_args"),
  ),
  /** When `snapshot_expired`, the oldest snapshot still on file. */
  oldestAvailableTurnId: v.optional(v.number()),
  /** Human-readable detail. */
  detail: v.string(),
});

const rollbackResultValidator = v.union(
  rollbackSuccessValidator,
  rollbackFailureValidator,
);

// ════════════════════════════════════════════════════════════════════════
// ARTIFACT-TYPE RESTORE DISPATCH
// ════════════════════════════════════════════════════════════════════════

/**
 * Per-artifactType restore dispatch.
 *
 * Each branch is responsible for taking the snapshot's serialized
 * `content` and applying it back to the live artifact table. Until a
 * domain owner wires their branch, the default is HONEST_STATUS — we
 * return an unwired marker rather than silently succeed.
 *
 * Adding a handler:
 *   1. Implement `internal.domains.<domain>.restore.fromSnapshot`
 *      as an internalMutation taking { artifactId, content } and
 *      returning { ok: boolean; reason?: string }.
 *   2. Add a case here that runs `await ctx.runMutation(...)`.
 *   3. Add a regression test under
 *      `convex/domains/agents/__tests__/rollbackToCheckpoint.spec.ts`.
 */
async function dispatchRestore(
  _ctx: unknown,
  snapshot: Doc<"agentSnapshots">,
): Promise<{ ok: boolean; reason?: string }> {
  // Intentional: no domain handlers wired in this PR. Each artifact
  // owner adds their branch in a follow-up wiring PR.
  switch (snapshot.artifactType) {
    case "notebook":
    case "entity":
    case "report":
    case "claim":
    default:
      return {
        ok: false,
        reason: `restore_handler_not_wired_for_${snapshot.artifactType}`,
      };
  }
}

// ════════════════════════════════════════════════════════════════════════
// PUBLIC ACTION
// ════════════════════════════════════════════════════════════════════════

/**
 * Roll a thread back to a prior checkpoint.
 *
 * Exactly one of `turnId` or `stepsBack` should be supplied. If both are
 * supplied, `turnId` wins. If neither is supplied we default to
 * `stepsBack: 1` (undo the most recent destructive tool call).
 */
export const rollbackToCheckpoint = action({
  args: {
    threadId: v.string(),
    /** Exact turnId to roll back to. */
    turnId: v.optional(v.number()),
    /** Or: roll back N most recent destructive turns. Default 1. */
    stepsBack: v.optional(v.number()),
  },
  returns: rollbackResultValidator,
  handler: async (ctx, args): Promise<typeof rollbackResultValidator.type> => {
    const now = Date.now();

    // ─── Resolve target turn ─────────────────────────────────────────
    if (args.turnId === undefined && (args.stepsBack ?? 0) < 0) {
      return {
        ok: false as const,
        threadId: args.threadId,
        error: "invalid_args" as const,
        detail: "stepsBack must be a positive integer",
      };
    }

    // Pull the most recent slice of snapshots so we can pick the right
    // one. We over-fetch (50) to handle stepsBack up to ~50.
    const recent = await ctx.runQuery(
      internal.domains.agents.snapshots.snapshotCheckpoint
        .listRecentSnapshotsForThread,
      { threadId: args.threadId, limit: 50 },
    );

    if (recent.length === 0) {
      return {
        ok: false as const,
        threadId: args.threadId,
        error: "no_snapshot" as const,
        detail: "no snapshots recorded for this thread",
      };
    }

    let target: (typeof recent)[number] | null = null;
    let fromTurnId = recent[0].turnId;

    if (args.turnId !== undefined) {
      const exact = recent.find((s) => s.turnId === args.turnId);
      if (!exact) {
        const oldest = recent[recent.length - 1];
        return {
          ok: false as const,
          threadId: args.threadId,
          error: "snapshot_expired" as const,
          oldestAvailableTurnId: oldest.turnId,
          detail: `requested turnId ${args.turnId} not in retention window (oldest=${oldest.turnId})`,
        };
      }
      target = exact;
    } else {
      const stepsBack = args.stepsBack ?? 1;
      // recent is desc by turnId. stepsBack=1 means take index 0 (most
      // recent destructive turn — the one we're undoing).
      const idx = stepsBack - 1;
      if (idx >= recent.length) {
        const oldest = recent[recent.length - 1];
        return {
          ok: false as const,
          threadId: args.threadId,
          error: "snapshot_expired" as const,
          oldestAvailableTurnId: oldest.turnId,
          detail: `cannot step back ${stepsBack}; only ${recent.length} snapshots in retention window`,
        };
      }
      target = recent[idx];
    }

    // ─── Dispatch per-artifact restore ───────────────────────────────
    // For an exact turnId rollback we restore exactly one snapshot. For
    // stepsBack N we restore the snapshots from the most recent N turns
    // so the user gets back to the state before all of them.
    const toRestore =
      args.turnId !== undefined ? [target!] : recent.slice(0, args.stepsBack ?? 1);

    const outcomes: Array<{
      artifactType: string;
      artifactId: string;
      ok: boolean;
      reason?: string;
      restoredTurnId: number;
    }> = [];

    for (const snapshot of toRestore) {
      const result = await dispatchRestore(ctx, snapshot);
      outcomes.push({
        artifactType: snapshot.artifactType,
        artifactId: snapshot.artifactId,
        ok: result.ok,
        reason: result.reason,
        restoredTurnId: snapshot.turnId,
      });
    }

    // ─── Diagnostic log ──────────────────────────────────────────────
    // Visible in Convex logs immediately. The chat composer (A-PR-A.5)
    // will render a RollbackMessageCard from the structured return value.
    console.log(
      `[rollbackToCheckpoint] thread=${args.threadId} from=${fromTurnId} to=${target!.turnId} restored=${outcomes.length} ok=${outcomes.filter((o) => o.ok).length}`,
    );

    return {
      ok: true as const,
      threadId: args.threadId,
      restoredTurnId: target!.turnId,
      fromTurnId,
      outcomes,
      rolledBackAt: now,
    };
  },
});
