/**
 * useRollbackInterceptor — React hook that intercepts rollback-shortcut
 * inputs from the chat composer and dispatches the Convex rollback action.
 *
 * A-PR-A.4 of the Autonomous Continuation System.
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Usage:
 *   const interceptor = useRollbackInterceptor({ threadId });
 *   const handleSubmit = async () => {
 *     const intercepted = await interceptor.tryIntercept(value);
 *     if (intercepted) return; // rollback already fired; do not call LLM
 *     // ...normal LLM submit flow
 *   };
 *
 * The hook consumes the `detectRollbackIntent` parser and the
 * `rollbackToCheckpoint` action. It surfaces the result via toast for
 * v1 — A-PR-A.5 will replace the toast with a structured chat message
 * card so the rollback shows up in the persistent thread audit trail.
 */

import { useCallback, useState } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import {
  detectRollbackIntent,
  type RollbackIntent,
} from "../lib/detectRollbackIntent";

export type RollbackOutcome =
  | {
      ok: true;
      restoredTurnId: number;
      fromTurnId: number;
      restoredCount: number;
      successCount: number;
    }
  | {
      ok: false;
      error: "no_snapshot" | "snapshot_expired" | "invalid_args";
      detail: string;
      oldestAvailableTurnId?: number;
    };

export interface UseRollbackInterceptorArgs {
  /** Convex agent thread the rollback is scoped to. */
  threadId: string | null | undefined;
  /** Called when a rollback completes (success or failure). */
  onRollback?: (outcome: RollbackOutcome) => void;
  /** Disable interception entirely (for previews / read-only views). */
  disabled?: boolean;
}

export interface RollbackInterceptor {
  /** True when the action is in flight. */
  pending: boolean;
  /**
   * Attempt to intercept the supplied composer text. Returns `true` when
   * the text was a rollback shortcut and the action was dispatched. The
   * caller should NOT proceed with the normal LLM submit when `true`.
   * Returns `false` for non-rollback inputs — caller proceeds normally.
   */
  tryIntercept: (rawInput: string) => Promise<boolean>;
  /**
   * Pure-parser passthrough — useful for showing UI hints ("press Enter
   * to roll back 3 turns") without firing the action yet.
   */
  detect: (rawInput: string) => RollbackIntent | null;
}

export function useRollbackInterceptor({
  threadId,
  onRollback,
  disabled = false,
}: UseRollbackInterceptorArgs): RollbackInterceptor {
  const [pending, setPending] = useState(false);
  const rollback = useAction(
    api.domains.agents.snapshots.rollbackToCheckpoint.rollbackToCheckpoint,
  );

  const detect = useCallback((rawInput: string) => {
    if (disabled) return null;
    return detectRollbackIntent(rawInput);
  }, [disabled]);

  const tryIntercept = useCallback(
    async (rawInput: string): Promise<boolean> => {
      if (disabled) return false;
      if (!threadId) return false;

      const intent = detectRollbackIntent(rawInput);
      if (!intent) return false;

      setPending(true);
      try {
        const args =
          intent.kind === "turnId"
            ? { threadId, turnId: intent.turnId }
            : { threadId, stepsBack: intent.stepsBack };

        const result = await rollback(args);

        if (result.ok) {
          const successCount = result.outcomes.filter((o) => o.ok).length;
          const restoredCount = result.outcomes.length;
          if (successCount === restoredCount) {
            toast.success(
              `Rolled back to turn ${result.restoredTurnId} (${restoredCount} artifact${restoredCount === 1 ? "" : "s"} restored)`,
            );
          } else if (successCount === 0) {
            toast.warning(
              `Rolled back marker only — ${restoredCount} artifact${restoredCount === 1 ? "" : "s"} could not be restored automatically. Domain restore handlers are not wired yet.`,
            );
          } else {
            toast.warning(
              `Partial rollback: ${successCount} of ${restoredCount} artifacts restored. Unwired handlers logged.`,
            );
          }
          onRollback?.({
            ok: true,
            restoredTurnId: result.restoredTurnId,
            fromTurnId: result.fromTurnId,
            restoredCount,
            successCount,
          });
        } else {
          if (result.error === "snapshot_expired") {
            toast.error(
              `Cannot roll back that far. ${result.detail}${
                result.oldestAvailableTurnId !== undefined
                  ? ` Try /rollback to ${result.oldestAvailableTurnId}.`
                  : ""
              }`,
            );
          } else if (result.error === "no_snapshot") {
            toast.info("No snapshots recorded yet for this thread.");
          } else {
            toast.error(`Rollback failed: ${result.detail}`);
          }
          onRollback?.({
            ok: false,
            error: result.error,
            detail: result.detail,
            oldestAvailableTurnId: result.oldestAvailableTurnId,
          });
        }
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Rollback failed: ${message}`);
        onRollback?.({
          ok: false,
          error: "invalid_args",
          detail: message,
        });
        return true; // we still intercepted — don't fall through to LLM
      } finally {
        setPending(false);
      }
    },
    [disabled, threadId, rollback, onRollback],
  );

  return { pending, tryIntercept, detect };
}
