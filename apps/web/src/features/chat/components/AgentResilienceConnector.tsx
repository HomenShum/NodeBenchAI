/**
 * AgentResilienceConnector — settings-surface wrapper that wires the
 * pure `ResilienceSettings` and `LessonsPanel` components to Convex.
 *
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116) — follow-up
 * wiring step.
 *
 * The two panels were intentionally shipped as pure presentational
 * components in B-PR7 / A-PR-B.7 so they could be reused across modal,
 * drawer, and standalone settings surfaces. This connector is the first
 * concrete consumer — it owns:
 *
 *   - Resolving the operator's `ownerKey` (anonymous session id; trivial
 *     to swap to a signed-in user id later)
 *   - Reading the current budget row (`getBudgetForOwner`)
 *   - Saving budget edits (`upsertBudgetForOwner`)
 *   - Reading every lesson for the chosen thread
 *     (`listAllLessonsForThreadPublic`)
 *   - Pinning / deprecating lessons (`pinLessonPublic`,
 *     `deprecateLessonPublic`)
 *
 * Thread selection:
 *   - Reads `?session=...` from the URL when available so the operator
 *     can deep-link from a chat surface to "lessons for this thread"
 *   - Falls back to a manual input field so the panel still works when
 *     mounted in a settings tab with no inherent thread context.
 *
 * HONEST_STATUS:
 *   - `useQuery` is skipped when the underlying Convex symbols are not
 *     yet present in the generated API (codegen can lag during local
 *     dev), and the panel renders the "not enrolled" / empty-state UI
 *     instead of crashing.
 *   - Mutation errors surface a small inline banner above the relevant
 *     panel rather than a blocking toast — the audit trail in the
 *     lessons table itself remains the source of truth.
 */

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { useConvexApi } from "@/lib/convexApi";
import { useAnonymousSession } from "@/features/agents/hooks/useAnonymousSession";
import {
  ResilienceSettings,
  type BudgetSnapshot,
  type ResilienceSettingsValues,
} from "./ResilienceSettings";
import {
  LessonsPanel,
  type LessonsPanelLesson,
} from "./LessonsPanel";

// ════════════════════════════════════════════════════════════════════════
// PROPS
// ════════════════════════════════════════════════════════════════════════

export interface AgentResilienceConnectorProps {
  /**
   * Optional pre-resolved thread id (e.g. when mounted inside a chat
   * surface that already knows which thread is active). When omitted the
   * connector reads `?session=...` from the URL and falls back to a
   * manual input.
   */
  threadId?: string | null;
  /** Optional className passthrough for layout integration. */
  className?: string;
}

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════

function readSessionParamFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const session = params.get("session")?.trim();
    return session && session.length > 0 ? session : null;
  } catch {
    return null;
  }
}

function asBudgetSnapshot(
  row:
    | {
        dailyTokenCap: number;
        dailyCostCapUsd: number;
        consumedTokensToday: number;
        consumedCostUsdToday: number;
        resetAt: number;
        enforced: boolean;
      }
    | null
    | undefined,
): BudgetSnapshot | null {
  if (!row) return null;
  return {
    dailyTokenCap: row.dailyTokenCap,
    dailyCostCapUsd: row.dailyCostCapUsd,
    consumedTokensToday: row.consumedTokensToday,
    consumedCostUsdToday: row.consumedCostUsdToday,
    resetAt: row.resetAt,
    enforced: row.enforced,
  };
}

// ════════════════════════════════════════════════════════════════════════
// COMPONENT
// ════════════════════════════════════════════════════════════════════════

export function AgentResilienceConnector({
  threadId: explicitThreadId,
  className,
}: AgentResilienceConnectorProps) {
  const api = useConvexApi();
  const session = useAnonymousSession();
  // Anonymous users => session id; signed-in users => `auth:<n>` placeholder
  // until the budget gate gains a first-class user-id resolution path.
  const ownerKey = session.sessionId ?? null;

  // ─── Thread selection ───────────────────────────────────────────────
  const urlSession = useMemo(readSessionParamFromUrl, []);
  const [manualThreadId, setManualThreadId] = useState("");
  const effectiveThreadId =
    explicitThreadId?.trim() ||
    urlSession?.trim() ||
    manualThreadId.trim() ||
    null;

  // ─── Budget query + mutation ────────────────────────────────────────
  const budgetQueryRef =
    api?.domains?.agents?.budget?.budgetGate?.getBudgetForOwner;
  const budgetRow = useQuery(
    budgetQueryRef ?? "skip",
    budgetQueryRef && ownerKey ? { ownerKey } : "skip",
  );
  const upsertBudgetRef =
    api?.domains?.agents?.budget?.budgetGate?.upsertBudgetForOwner;
  const upsertBudget = useMutation(upsertBudgetRef ?? ("skip" as any));
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);

  const handleBudgetSave = useCallback(
    async (values: ResilienceSettingsValues) => {
      if (!upsertBudgetRef || !ownerKey) {
        setBudgetError(
          "Budget API not available yet (Convex codegen pending).",
        );
        return;
      }
      setBudgetSaving(true);
      setBudgetError(null);
      try {
        await upsertBudget({
          ownerKey,
          dailyTokenCap: Math.max(0, Math.floor(values.dailyTokenCap)),
          dailyCostCapUsd: Math.max(0, values.dailyCostCapUsd),
          enforced: values.enforced,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setBudgetError(message);
        throw err;
      } finally {
        setBudgetSaving(false);
      }
    },
    [upsertBudget, upsertBudgetRef, ownerKey],
  );

  // ─── Lessons query + mutations ──────────────────────────────────────
  const lessonsQueryRef =
    api?.domains?.agents?.lessons?.lessonsPublic?.listAllLessonsForThreadPublic;
  const lessonRows = useQuery(
    lessonsQueryRef ?? "skip",
    lessonsQueryRef && effectiveThreadId
      ? { threadId: effectiveThreadId }
      : "skip",
  );
  const pinRef =
    api?.domains?.agents?.lessons?.lessonsPublic?.pinLessonPublic;
  const deprecateRef =
    api?.domains?.agents?.lessons?.lessonsPublic?.deprecateLessonPublic;
  const pinLesson = useMutation(pinRef ?? ("skip" as any));
  const deprecateLesson = useMutation(deprecateRef ?? ("skip" as any));
  const [lessonError, setLessonError] = useState<string | null>(null);

  const lessons = useMemo<readonly LessonsPanelLesson[]>(
    () => (lessonRows ?? []) as readonly LessonsPanelLesson[],
    [lessonRows],
  );

  const handlePin = useCallback(
    async (lessonId: string, pinned: boolean) => {
      if (!pinRef) {
        setLessonError("Pin API not available yet (Convex codegen pending).");
        return;
      }
      setLessonError(null);
      try {
        await pinLesson({ lessonId: lessonId as any, pinned });
      } catch (err) {
        setLessonError(err instanceof Error ? err.message : String(err));
      }
    },
    [pinLesson, pinRef],
  );

  const handleDeprecate = useCallback(
    async (lessonId: string) => {
      if (!deprecateRef) {
        setLessonError(
          "Deprecate API not available yet (Convex codegen pending).",
        );
        return;
      }
      setLessonError(null);
      try {
        await deprecateLesson({ lessonId: lessonId as any });
      } catch (err) {
        setLessonError(err instanceof Error ? err.message : String(err));
      }
    },
    [deprecateLesson, deprecateRef],
  );

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div className={`space-y-4 ${className ?? ""}`}>
      <ResilienceSettings
        snapshot={asBudgetSnapshot(budgetRow)}
        onSave={handleBudgetSave}
        saving={budgetSaving}
        saveError={budgetError}
      />

      <div className="rounded-lg border border-edge bg-surface p-4 space-y-3">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-semibold">Agent Lessons</div>
          <div className="text-xs text-content-secondary">
            Audit what the agent has learned in this thread. Pin lessons
            that should always inject; deprecate ones that are no longer
            relevant.
          </div>
        </div>

        {!explicitThreadId ? (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="agent-resilience-thread-id"
              className="text-xs font-medium text-content-secondary"
            >
              Thread id
              {urlSession ? (
                <span className="ml-1 text-content-muted">
                  (defaulted from URL)
                </span>
              ) : null}
            </label>
            <input
              id="agent-resilience-thread-id"
              type="text"
              value={manualThreadId || urlSession || ""}
              onChange={(event) => setManualThreadId(event.target.value)}
              placeholder="paste a thread id to inspect its lessons"
              className="rounded-md border border-edge bg-surface-secondary px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
        ) : null}

        {lessonError ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-500/[0.2] dark:bg-rose-500/[0.08] dark:text-rose-200">
            {lessonError}
          </div>
        ) : null}

        {effectiveThreadId ? (
          <LessonsPanel
            lessons={lessons}
            onPin={handlePin}
            onDeprecate={handleDeprecate}
            threadLabel={effectiveThreadId}
          />
        ) : (
          <div className="rounded-md border border-dashed border-edge bg-surface-secondary px-3 py-4 text-xs text-content-secondary">
            Paste a thread id (or open this surface from a chat session) to
            see captured lessons.
          </div>
        )}
      </div>
    </div>
  );
}
