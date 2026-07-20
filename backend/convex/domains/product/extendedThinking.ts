/**
 * extendedThinking — orchestrator for multi-checkpoint autonomous Claude runs.
 *
 * The pitch-line promise "drop in 'Anthropic' → watch a 90-minute autonomous
 * build" cannot live in a single Convex action (Convex caps individual
 * action wall-clock). Instead we chain short checkpoints via
 * `ctx.scheduler.runAfter`. Each checkpoint is ONE extended-thinking call
 * (~30s-3min), its result persists, then the next checkpoint is scheduled
 * — the run resumes naturally across action boundaries.
 *
 * Contract:
 *   - requestExtendedRun (mutation): user kicks off a run. Creates the run
 *     row, schedules the first advanceRun action, returns { runId }.
 *   - advanceRun (internalAction): fires ONE Claude call with extended
 *     thinking, persists a checkpoint row, updates the run row. If
 *     shouldContinue → schedules itself for the next checkpoint. If not →
 *     marks the run completed.
 *   - cancelExtendedRun (mutation): user stops mid-run.
 *   - listRunsForEntity / getRun / listCheckpointsForRun (queries).
 *
 * Role (agentic_reliability.md):
 *   - BOUND: checkpoint cap, thinking budget, response size all enforced.
 *   - HONEST_STATUS: failures persist status="failed" / checkpoint
 *     status="parse_error"|"request_failed" — never silent 200.
 *   - TIMEOUT: AbortController with 120s budget per Claude call.
 *   - BOUND_READ: Claude response capped at 1MB.
 *   - ERROR_BOUNDARY: parse/request failures mark the checkpoint failed
 *     and continue the chain up to a tolerance; if 3 consecutive
 *     checkpoints fail the run is marked failed.
 *
 * Canonical reference:
 *   docs/architecture/PIPELINE_OPERATIONAL_STANDARD.md §extensions
 *   .claude/rules/async_reliability.md (long-horizon reliability)
 */

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import {
  buildCheckpointPrompt,
  parseCheckpointResponse,
  shouldContinue,
  MAX_CHECKPOINTS,
  MAX_THINKING_BUDGET_TOKENS,
  MAX_OUTPUT_TOKENS,
} from "../../../server/pipeline/extendedThinkingRunner";

const DEFAULT_MODEL = "claude-sonnet-4.6";
const DEFAULT_CHECKPOINTS = 8;
const DEFAULT_THINKING_BUDGET = 40_000;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 1_048_576; // 1 MB BOUND_READ cap
const MAX_LIST = 100;
const CHECKPOINT_DELAY_MS = 500; // small gap between checkpoints to let DB writes commit
const CONSECUTIVE_FAILURE_LIMIT = 3; // ERROR_BOUNDARY tolerance

/* ==========================================================================
 * requestExtendedRun — public entry point.
 * ========================================================================== */
export const requestExtendedRun = mutation({
  args: {
    entitySlug: v.string(),
    goal: v.string(),
    totalCheckpoints: v.optional(v.number()),
    thinkingBudgetTokens: v.optional(v.number()),
    modelName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("requestExtendedRun: not authenticated");

    const goal = args.goal.trim();
    if (goal.length === 0) {
      throw new Error("requestExtendedRun: goal is required");
    }
    if (goal.length > 2_000) {
      throw new Error("requestExtendedRun: goal must be <= 2000 chars");
    }

    const totalCheckpoints = Math.max(
      1,
      Math.min(args.totalCheckpoints ?? DEFAULT_CHECKPOINTS, MAX_CHECKPOINTS),
    );
    const thinkingBudget = Math.max(
      5_000,
      Math.min(
        args.thinkingBudgetTokens ?? DEFAULT_THINKING_BUDGET,
        MAX_THINKING_BUDGET_TOKENS * totalCheckpoints,
      ),
    );
    const modelName = args.modelName ?? DEFAULT_MODEL;
    const now = Date.now();

    const runId = await ctx.db.insert("extendedThinkingRuns", {
      entitySlug: args.entitySlug,
      ownerKey: String(userId),
      goal,
      status: "queued",
      currentCheckpoint: 0,
      totalCheckpoints,
      thinkingBudgetTokens: thinkingBudget,
      thinkingTokensUsed: 0,
      modelName,
      startedAt: now,
      lastActivityAt: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.domains.product.extendedThinking.advanceRun,
      { runId },
    );

    return { runId, totalCheckpoints, thinkingBudget };
  },
});

/* ==========================================================================
 * Internal persistence helpers (mutations)
 * ========================================================================== */

export const updateRunStatus = internalMutation({
  args: {
    runId: v.id("extendedThinkingRuns"),
    status: v.string(),
    currentCheckpoint: v.optional(v.number()),
    thinkingTokensUsedDelta: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    researchComplete: v.optional(v.boolean()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.runId);
    if (!row) throw new Error("updateRunStatus: run not found");
    const delta = args.thinkingTokensUsedDelta ?? 0;
    const patch: Record<string, unknown> = {
      status: args.status,
      lastActivityAt: Date.now(),
    };
    if (typeof args.currentCheckpoint === "number") {
      patch.currentCheckpoint = args.currentCheckpoint;
    }
    if (delta !== 0) {
      patch.thinkingTokensUsed = row.thinkingTokensUsed + delta;
    }
    if (args.errorMessage !== undefined) patch.errorMessage = args.errorMessage;
    if (args.researchComplete !== undefined) patch.researchComplete = args.researchComplete;
    if (args.completedAt !== undefined) patch.completedAt = args.completedAt;
    await ctx.db.patch(args.runId, patch);
  },
});

export const recordCheckpoint = internalMutation({
  args: {
    runId: v.id("extendedThinkingRuns"),
    index: v.number(),
    status: v.string(),
    promptHash: v.string(),
    modelName: v.string(),
    headline: v.optional(v.string()),
    findingsJson: v.optional(v.string()),
    nextFocus: v.optional(v.string()),
    reasoning: v.optional(v.string()),
    researchComplete: v.optional(v.boolean()),
    focus: v.optional(v.string()),
    latencyMs: v.number(),
    thinkingTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("extendedThinkingCheckpoints", {
      runId: args.runId,
      index: args.index,
      status: args.status,
      promptHash: args.promptHash,
      modelName: args.modelName,
      headline: args.headline,
      findingsJson: args.findingsJson,
      nextFocus: args.nextFocus,
      reasoning: args.reasoning,
      researchComplete: args.researchComplete,
      focus: args.focus,
      latencyMs: args.latencyMs,
      thinkingTokens: args.thinkingTokens,
      outputTokens: args.outputTokens,
      errorMessage: args.errorMessage,
      judgedAt: Date.now(),
    });
    return { id };
  },
});

/* ==========================================================================
 * advanceRun — internalAction that fires ONE Claude call then self-schedules.
 * ========================================================================== */

type RunRow = {
  _id: string;
  entitySlug: string;
  goal: string;
  status: string;
  currentCheckpoint: number;
  totalCheckpoints: number;
  thinkingBudgetTokens: number;
  thinkingTokensUsed: number;
  modelName: string;
};

type CheckpointRow = {
  index: number;
  status: string;
  findingsJson?: string;
  headline?: string;
  nextFocus?: string;
};

export const loadRunSnapshot = query({
  args: { runId: v.id("extendedThinkingRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const checkpoints = await ctx.db
      .query("extendedThinkingCheckpoints")
      .withIndex("by_run_index", (q) => q.eq("runId", args.runId))
      .take(MAX_CHECKPOINTS + 5);
    return { run, checkpoints };
  },
});

export const advanceRun = internalAction({
  args: {
    runId: v.id("extendedThinkingRuns"),
  },
  handler: async (ctx, args): Promise<{ status: string; reason?: string }> => {
    const snapshot = await ctx.runQuery(
      api.domains.product.extendedThinking.loadRunSnapshot,
      { runId: args.runId },
    );
    if (!snapshot) return { status: "not_found" };
    const run = snapshot.run as RunRow;
    const checkpoints = snapshot.checkpoints as ReadonlyArray<CheckpointRow>;

    if (run.status === "canceled" || run.status === "completed" || run.status === "failed") {
      return { status: run.status };
    }

    const nextIndex = run.currentCheckpoint + 1;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(
        internal.domains.product.extendedThinking.recordCheckpoint,
        {
          runId: args.runId,
          index: nextIndex,
          status: "request_failed",
          promptHash: "",
          modelName: run.modelName,
          latencyMs: 0,
          errorMessage: "ANTHROPIC_API_KEY not configured in Convex env",
        },
      );
      await ctx.runMutation(
        internal.domains.product.extendedThinking.updateRunStatus,
        {
          runId: args.runId,
          status: "failed",
          errorMessage: "ANTHROPIC_API_KEY not configured in Convex env",
          completedAt: Date.now(),
        },
      );
      return { status: "failed", reason: "api_key_missing" };
    }

    // Build prior findings list from prior checkpoints (newest first).
    const priorFindings: Array<{ text: string; sourceRefId?: string }> = [];
    const sortedCheckpoints = [...checkpoints]
      .filter((c) => c.status === "scored")
      .sort((a, b) => b.index - a.index);
    for (const cp of sortedCheckpoints) {
      if (!cp.findingsJson) continue;
      try {
        const parsed = JSON.parse(cp.findingsJson);
        if (Array.isArray(parsed)) {
          for (const f of parsed) {
            if (f && typeof f === "object" && typeof f.text === "string") {
              priorFindings.push({ text: f.text, sourceRefId: f.sourceRefId });
            }
          }
        }
      } catch {
        // skip malformed
      }
    }

    const focus = sortedCheckpoints[0]?.nextFocus;
    const prompt = buildCheckpointPrompt({
      runId: args.runId,
      entityLabel: run.entitySlug,
      goal: run.goal,
      checkpointIndex: nextIndex,
      totalCheckpoints: run.totalCheckpoints,
      priorFindings,
      focus,
    });

    await ctx.runMutation(
      internal.domains.product.extendedThinking.updateRunStatus,
      { runId: args.runId, status: "running" },
    );

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let rawText: string | null = null;
    let errorMessage: string | null = null;
    let thinkingTokens = 0;
    let outputTokens = 0;

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: run.modelName,
          max_tokens: MAX_OUTPUT_TOKENS,
          thinking: {
            type: "enabled",
            budget_tokens: Math.min(10_000, run.thinkingBudgetTokens - run.thinkingTokensUsed),
          },
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
        }),
      });

      if (!response.ok) {
        errorMessage = `anthropic http ${response.status}`;
      } else if (!response.body) {
        errorMessage = "anthropic returned no body";
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let total = 0;
        const chunks: string[] = [];
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value?.byteLength ?? 0;
          if (total > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            errorMessage = `response exceeded ${MAX_RESPONSE_BYTES} bytes`;
            break;
          }
          chunks.push(decoder.decode(value, { stream: true }));
        }
        if (!errorMessage) {
          const bodyJson = chunks.join("");
          try {
            const envelope = JSON.parse(bodyJson) as {
              content?: Array<{ type: string; text?: string; thinking?: string }>;
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                cache_creation_input_tokens?: number;
                cache_read_input_tokens?: number;
              };
            };
            const textBlock = envelope.content?.find((b) => b.type === "text");
            rawText = textBlock?.text ?? null;
            outputTokens = envelope.usage?.output_tokens ?? 0;
            // Anthropic returns total tokens; extended thinking tokens are
            // included in output_tokens for billing.  We approximate
            // thinkingTokens from the length of the 'thinking' block.
            const thinkingBlock = envelope.content?.find((b) => b.type === "thinking");
            thinkingTokens = thinkingBlock?.thinking
              ? Math.ceil(thinkingBlock.thinking.length / 4)
              : 0;
            if (!rawText) errorMessage = "no text block in anthropic response";
          } catch (err) {
            errorMessage = `anthropic envelope parse: ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
      }
    } catch (err) {
      errorMessage =
        err instanceof Error
          ? err.name === "AbortError"
            ? "request timeout"
            : err.message
          : String(err);
    } finally {
      clearTimeout(timeoutHandle);
    }

    const latencyMs = Date.now() - startedAt;

    let checkpointStatus = "request_failed";
    let parsedHeadline: string | undefined;
    let parsedFindingsJson: string | undefined;
    let parsedNextFocus: string | undefined;
    let parsedReasoning: string | undefined;
    let researchComplete = false;

    if (rawText) {
      const parsed = parseCheckpointResponse(rawText);
      if (parsed.ok) {
        checkpointStatus = "scored";
        parsedHeadline = parsed.result.headline;
        parsedFindingsJson = JSON.stringify(parsed.result.findings);
        parsedNextFocus = parsed.result.nextFocus;
        parsedReasoning = parsed.result.reasoning;
        researchComplete = parsed.result.researchComplete;
      } else {
        checkpointStatus = "parse_error";
        errorMessage = parsed.error;
      }
    }

    await ctx.runMutation(
      internal.domains.product.extendedThinking.recordCheckpoint,
      {
        runId: args.runId,
        index: nextIndex,
        status: checkpointStatus,
        promptHash: prompt.promptHash,
        modelName: run.modelName,
        headline: parsedHeadline,
        findingsJson: parsedFindingsJson,
        nextFocus: parsedNextFocus,
        reasoning: parsedReasoning,
        researchComplete,
        focus,
        latencyMs,
        thinkingTokens: thinkingTokens || undefined,
        outputTokens: outputTokens || undefined,
        errorMessage: errorMessage ?? undefined,
      },
    );

    // Count consecutive failures (including this one).
    const recent = [...checkpoints].sort((a, b) => b.index - a.index).slice(0, CONSECUTIVE_FAILURE_LIMIT - 1);
    const priorConsecutiveFailures = recent.every(
      (c) => c.status === "parse_error" || c.status === "request_failed",
    )
      ? recent.length
      : 0;
    const totalConsecutiveFailures =
      checkpointStatus === "scored" ? 0 : priorConsecutiveFailures + 1;

    if (totalConsecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
      await ctx.runMutation(
        internal.domains.product.extendedThinking.updateRunStatus,
        {
          runId: args.runId,
          status: "failed",
          currentCheckpoint: nextIndex,
          thinkingTokensUsedDelta: thinkingTokens,
          errorMessage: `${CONSECUTIVE_FAILURE_LIMIT} consecutive checkpoint failures`,
          completedAt: Date.now(),
        },
      );
      return { status: "failed", reason: "consecutive_failures" };
    }

    const decision = shouldContinue({
      currentCheckpoint: nextIndex,
      totalCheckpoints: run.totalCheckpoints,
      researchComplete,
      thinkingTokensUsed: run.thinkingTokensUsed + thinkingTokens,
      thinkingBudgetTokens: run.thinkingBudgetTokens,
    });

    if (decision.continue) {
      await ctx.runMutation(
        internal.domains.product.extendedThinking.updateRunStatus,
        {
          runId: args.runId,
          status: "waiting_checkpoint",
          currentCheckpoint: nextIndex,
          thinkingTokensUsedDelta: thinkingTokens,
        },
      );
      await ctx.scheduler.runAfter(
        CHECKPOINT_DELAY_MS,
        internal.domains.product.extendedThinking.advanceRun,
        { runId: args.runId },
      );
      return { status: "scheduled_next", reason: decision.reason };
    }

    await ctx.runMutation(
      internal.domains.product.extendedThinking.updateRunStatus,
      {
        runId: args.runId,
        status: "completed",
        currentCheckpoint: nextIndex,
        thinkingTokensUsedDelta: thinkingTokens,
        researchComplete,
        completedAt: Date.now(),
      },
    );
    return { status: "completed", reason: decision.reason };
  },
});

/* ==========================================================================
 * cancelExtendedRun — user stop mid-run. Idempotent.
 * ========================================================================== */
export const cancelExtendedRun = mutation({
  args: { runId: v.id("extendedThinkingRuns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("cancelExtendedRun: not authenticated");
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("cancelExtendedRun: run not found");
    if (run.ownerKey !== String(userId)) {
      throw new Error("cancelExtendedRun: not the owner");
    }
    if (run.status === "completed" || run.status === "canceled" || run.status === "failed") {
      return { status: run.status };
    }
    await ctx.db.patch(args.runId, {
      status: "canceled",
      canceledAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    return { status: "canceled" };
  },
});

/* ==========================================================================
 * Queries
 * ========================================================================== */

export const listRunsForEntity = query({
  args: {
    entitySlug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cap = Math.max(1, Math.min(args.limit ?? 10, MAX_LIST));
    return await ctx.db
      .query("extendedThinkingRuns")
      .withIndex("by_entity", (q) => q.eq("entitySlug", args.entitySlug))
      .order("desc")
      .take(cap);
  },
});

export const listCheckpointsForRun = query({
  args: {
    runId: v.id("extendedThinkingRuns"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("extendedThinkingCheckpoints")
      .withIndex("by_run_index", (q) => q.eq("runId", args.runId))
      .take(MAX_CHECKPOINTS + 5);
  },
});

export const getRun = query({
  args: { runId: v.id("extendedThinkingRuns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.runId);
  },
});
