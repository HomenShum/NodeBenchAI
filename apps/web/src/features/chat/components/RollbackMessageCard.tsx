/**
 * RollbackMessageCard — visible audit card for rollback events in chat.
 *
 * A-PR-A.5 of the Autonomous Continuation System.
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Renders the structured outcome from `useRollbackInterceptor` as a
 * grey, non-blocking card that lives inside the chat thread. Replaces
 * the transient toast surface from A-PR-A.4 for the persistent audit
 * trail use case. The toast still fires for immediate feedback; this
 * card is the durable record.
 *
 * Two presentations:
 *   - Success: header, restored turn range, per-artifact outcome list,
 *              optional lesson preview (populated by A-PR-B.6).
 *   - Failure: header, error class, oldestAvailable hint when the user
 *              tried to roll back past the retention window.
 *
 * Pure presentation. No hooks, no Convex calls. Caller passes in the
 * `RollbackOutcome` from the interceptor.
 */

import { History, RotateCcw, AlertTriangle, Info } from "lucide-react";

import type { RollbackOutcome } from "@/features/chat/hooks/useRollbackInterceptor";
import { cn } from "@/lib/utils";

export interface RollbackMessageCardProps {
  outcome: RollbackOutcome;
  /** Artifact-id → human label resolver for nicer per-artifact rows. */
  artifactLabelResolver?: (artifactType: string, artifactId: string) => string;
  /** Optional lesson note captured from the post-rollback toast. */
  lesson?: string | null;
  /** Pass through className for layout integration. */
  className?: string;
  /** Unix ms when the rollback fired. Defaults to "just now". */
  timestamp?: number;
  /** Optional per-artifact outcome list (success cases only). */
  outcomes?: ReadonlyArray<{
    artifactType: string;
    artifactId: string;
    ok: boolean;
    reason?: string;
  }>;
}

function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 5_000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

function defaultArtifactLabel(artifactType: string, artifactId: string): string {
  // Truncate long IDs for readability while keeping enough characters
  // to be unambiguous in a thread audit.
  const shortId = artifactId.length > 8 ? `${artifactId.slice(0, 8)}…` : artifactId;
  return `${artifactType}: ${shortId}`;
}

export function RollbackMessageCard({
  outcome,
  artifactLabelResolver = defaultArtifactLabel,
  lesson,
  className,
  timestamp,
  outcomes,
}: RollbackMessageCardProps) {
  const stamp = timestamp ?? Date.now();

  if (!outcome.ok) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="rollback-message-card-failure"
        className={cn(
          "flex flex-col gap-2 rounded-2xl border border-amber-200/60 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 shadow-[0_8px_24px_-20px_rgba(180,83,9,0.4)] dark:border-amber-400/20 dark:bg-amber-500/[0.06] dark:text-amber-200",
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <span className="font-medium">Rollback failed</span>
          <span className="ml-auto text-xs opacity-70">{formatRelativeTime(stamp)}</span>
        </div>
        <div className="text-xs leading-relaxed text-amber-900/90 dark:text-amber-100/90">
          {outcome.detail}
        </div>
        {outcome.error === "snapshot_expired" && outcome.oldestAvailableTurnId !== undefined ? (
          <div className="rounded-lg bg-amber-100/70 px-2 py-1.5 text-xs text-amber-950 dark:bg-amber-500/[0.1] dark:text-amber-100">
            <span className="opacity-70">Try:</span>{" "}
            <code className="font-mono text-[11px]">
              /rollback to {outcome.oldestAvailableTurnId}
            </code>
          </div>
        ) : null}
      </div>
    );
  }

  const list = outcomes ?? [];
  const restoredCount = outcome.restoredCount;
  const successCount = outcome.successCount;
  const allSuccess = successCount === restoredCount && restoredCount > 0;
  const someUnwired = successCount < restoredCount;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="rollback-message-card-success"
      className={cn(
        "flex flex-col gap-2 rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 text-sm text-slate-700 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.2)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <RotateCcw className="h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden />
        <span className="font-medium text-slate-800 dark:text-slate-100">
          Rolled back to turn {outcome.restoredTurnId}
        </span>
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
          {formatRelativeTime(stamp)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <span className="inline-flex items-center gap-1 rounded-md bg-white/80 px-2 py-0.5 font-mono text-[11px] dark:bg-white/[0.06]">
          <History className="h-3 w-3" aria-hidden />
          turn {outcome.fromTurnId} → {outcome.restoredTurnId}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]",
            allSuccess
              ? "bg-emerald-100/80 text-emerald-800 dark:bg-emerald-500/[0.1] dark:text-emerald-200"
              : "bg-amber-100/80 text-amber-800 dark:bg-amber-500/[0.1] dark:text-amber-200",
          )}
        >
          {successCount} of {restoredCount} restored
        </span>
      </div>

      {someUnwired ? (
        <div className="flex items-start gap-1.5 rounded-lg bg-amber-50/80 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-500/[0.06] dark:text-amber-200">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>
            Some artifact restore handlers are not wired yet. The rollback marker is
            captured in the audit trail; affected artifacts may still reflect the
            pre-rollback state until each domain owner ships its handler.
          </span>
        </div>
      ) : null}

      {list.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
          {list.map((item) => (
            <li
              key={`${item.artifactType}:${item.artifactId}`}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1",
                item.ok
                  ? "bg-emerald-50/60 dark:bg-emerald-500/[0.04]"
                  : "bg-slate-100/70 dark:bg-white/[0.03]",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  item.ok ? "bg-emerald-500" : "bg-slate-400 dark:bg-slate-500",
                )}
                aria-hidden
              />
              <span className="font-mono text-[11px]">
                {artifactLabelResolver(item.artifactType, item.artifactId)}
              </span>
              {item.ok ? (
                <span className="ml-auto text-[10px] text-emerald-700 dark:text-emerald-300">
                  restored
                </span>
              ) : (
                <span className="ml-auto text-[10px] text-slate-500 dark:text-slate-400">
                  {item.reason ?? "skipped"}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {lesson ? (
        <div className="rounded-lg border border-slate-200/60 bg-white/70 px-2 py-1.5 text-xs text-slate-700 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300">
          <span className="font-medium text-slate-800 dark:text-slate-100">
            Lesson captured:
          </span>{" "}
          {lesson}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Discriminated `ChatMessage.kind = 'rollback'` shape that surfaces this
 * card inside the chat thread renderer. Wiring into the actual chat
 * stream (`chatMessagesStream` / `agentMessages`) lands in a follow-up.
 */
export interface RollbackChatMessage {
  kind: "rollback";
  outcome: RollbackOutcome;
  outcomes?: RollbackMessageCardProps["outcomes"];
  lesson?: string | null;
  timestamp: number;
}
