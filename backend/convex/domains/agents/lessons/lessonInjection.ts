/**
 * Lesson Injection Runtime — wires the lesson capture/recall system into
 * actual LLM call sites.
 *
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (FU-3 follow-up to PR #116).
 *
 * Design decision: pre-router injection (helper called by callers before
 * `modelRouter.route`) rather than per-model injection (inside the router).
 *
 * Why pre-router:
 *   - Keeps `modelRouter` generic — it doesn't need to know about lessons.
 *   - Opt-in: callers without a `threadId` get unchanged behavior.
 *   - Simpler test surface: this helper has one job.
 *   - Token accounting stays in `buildSystemPromptPrefix` (already capped
 *     at MAX_PROMPT_PREFIX_BYTES = 8 KB).
 *
 * HONEST_STATUS rule: lesson injection is best-effort. If the lesson query
 * fails (e.g. transient Convex error), we log and return the original
 * prompt unchanged — never a fake "succeeded with empty lessons" status.
 *
 * Constraint enforcement (from AUTONOMOUS_CONTINUATION_PLAN.md §5):
 *   - Token Budget < 10 Lessons — enforced via `getRelevantLessons.limit`
 *     default of 5 plus pinned-lesson bypass capped by 8 KB byte budget.
 *   - No Cross-Thread Leakage — `getRelevantLessons` filters strictly by
 *     `threadId`. This helper does NOT widen that scope in v1.
 */

import { internal } from "../../../_generated/api";
import type { ActionCtx } from "../../../_generated/server";
import { injectLessonsIntoSystemPrompt } from "./systemPromptBuilder";

export interface InjectLessonsOptions {
  /** Current turn — used by `getRelevantLessons` to enforce lesson expiry. */
  turnId?: number;
  /** Tool the agent is about to call — boosts matching lessons in scoring. */
  currentToolName?: string;
  /** Cap on lessons (defaults to 5). Pinned lessons bypass this cap. */
  limit?: number;
}

/**
 * Augment a system prompt with relevant lessons for the given thread.
 *
 * Returns the prompt unchanged when:
 *   - `threadId` is falsy (caller has no thread context yet)
 *   - There are no live lessons for the thread
 *   - The lesson query throws (best-effort; logs warning)
 *
 * Otherwise returns `<lessons prefix>\n\n<originalSystemPrompt>`.
 *
 * Caller-side usage:
 *   const augmented = await injectLessonsForThread(ctx, threadId, INTENT_CLASSIFIER_SYSTEM, { turnId });
 *   await ctx.runAction(internal.domains.models.modelRouter.route, { systemPrompt: augmented, ... });
 */
export async function injectLessonsForThread(
  ctx: ActionCtx,
  threadId: string | undefined | null,
  originalSystemPrompt: string,
  options: InjectLessonsOptions = {},
): Promise<string> {
  if (!threadId) return originalSystemPrompt;

  try {
    const lessons = await ctx.runQuery(
      internal.domains.agents.lessons.getRelevantLessons.getRelevantLessons,
      {
        threadId,
        currentToolName: options.currentToolName,
        currentTurnId: options.turnId,
        limit: options.limit,
      },
    );

    if (!lessons || lessons.length === 0) return originalSystemPrompt;

    return injectLessonsIntoSystemPrompt(originalSystemPrompt, lessons);
  } catch (err) {
    // HONEST_STATUS: log but don't fail the LLM call. Missing lessons
    // degrades quality, not correctness.
    console.warn(
      "[injectLessonsForThread] lesson query failed; proceeding without injection:",
      err,
    );
    return originalSystemPrompt;
  }
}
