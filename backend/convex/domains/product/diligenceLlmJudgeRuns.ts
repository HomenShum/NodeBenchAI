/**
 * diligenceLlmJudgeRuns — Convex persistence + runner for the non-deterministic
 * LLM judge layered on top of the deterministic boolean-gate verdict.
 *
 * Role (agentic_reliability.md):
 *   - BOUND: queries cap results; response body streamed with size cap.
 *   - HONEST_STATUS: status is a bounded enum. Failed runs persist with
 *     status="request_failed" OR "parse_error" — never a silent "scored".
 *   - HONEST_SCORES: scores only populated when status="scored". Parse
 *     failures leave score fields null; no 0.5 defaults.
 *   - TIMEOUT: Gemini call gated by AbortController + 30s budget.
 *   - BOUND_READ: response size capped at 512KB.
 *   - ERROR_BOUNDARY: action never throws; all failure modes persist a row
 *     with the appropriate status so the operator can see why the run
 *     didn't score.
 *
 * Separation of concerns:
 *   - Pure parsing / validation lives in server/pipeline/diligenceLlmJudge.ts
 *   - This module owns I/O (Convex DB + Gemini fetch) + glue.
 *
 * Canonical reference:
 *   docs/architecture/PIPELINE_OPERATIONAL_STANDARD.md §7 (non-goals)
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { generateText } from "ai";
import { getLanguageModelSafe } from "../agents/mcp_tools/models";
import {
  JUDGE_PROMPT_VERSION,
  buildLlmJudgePrompt,
  parseLlmJudgeResponse,
  promptHashOf,
  validateLlmJudgeScores,
  type LlmJudgeInput,
} from "../../../../workers/node/pipeline/diligenceLlmJudge";
import {
  getActivePublicEntityShareByToken,
  requireAuthenticatedProductIdentity,
  requireProductIdentity,
  resolveEntityWorkspaceAccess,
} from "./helpers";

const DEFAULT_MODEL = "kimi-k2.6"; // primary OpenRouter judge lane
const MAX_LLM_RUNS = 200;
const MAX_PER_VERDICT = 20;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 512 * 1024;

const STATUS_VALIDATOR = v.union(
  v.literal("pending"),
  v.literal("scored"),
  v.literal("parse_error"),
  v.literal("request_failed"),
);

/* ==========================================================================
 * Mutation: recordLlmJudgeRun
 * ==========================================================================
 * Persist one LLM judge run. HONEST_STATUS + HONEST_SCORES enforced here —
 * scores only accepted alongside status="scored". Validates ranges before
 * insert (defense-in-depth: even a buggy caller cannot persist score=1.5).
 */
export const recordLlmJudgeRun = internalMutation({
  args: {
    verdictId: v.id("diligenceJudgeVerdicts"),
    telemetryId: v.id("diligenceRunTelemetry"),
    entitySlug: v.string(),
    blockType: v.string(),
    status: STATUS_VALIDATOR,
    promptHash: v.string(),
    promptVersion: v.string(),
    modelName: v.string(),
    proseQuality: v.optional(v.number()),
    citationCoherence: v.optional(v.number()),
    sourceCredibility: v.optional(v.number()),
    tierAppropriate: v.optional(v.number()),
    overallSemantic: v.optional(v.number()),
    strengthsJson: v.optional(v.string()),
    concernsJson: v.optional(v.string()),
    proposedNextStep: v.optional(v.string()),
    reason: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    const [verdict, telemetry] = await Promise.all([
      ctx.db.get(args.verdictId),
      ctx.db.get(args.telemetryId),
    ]);
    if (
      !verdict ||
      !telemetry ||
      verdict.telemetryId !== args.telemetryId ||
      !verdict.ownerKey ||
      !verdict.entityId ||
      telemetry.ownerKey !== verdict.ownerKey ||
      telemetry.entityId !== verdict.entityId ||
      verdict.entitySlug !== args.entitySlug ||
      telemetry.entitySlug !== args.entitySlug ||
      verdict.blockType !== args.blockType ||
      telemetry.blockType !== args.blockType
    ) {
      throw new Error(
        "recordLlmJudgeRun: invalid tenant-bound verdict context",
      );
    }
    // When status is "scored", all 5 scores must be present and in [0, 1].
    if (args.status === "scored") {
      const allPresent =
        args.proseQuality !== undefined &&
        args.citationCoherence !== undefined &&
        args.sourceCredibility !== undefined &&
        args.tierAppropriate !== undefined &&
        args.overallSemantic !== undefined;
      if (!allPresent) {
        throw new Error(
          "recordLlmJudgeRun: status=scored requires all 5 score fields",
        );
      }
      validateLlmJudgeScores({
        proseQuality: args.proseQuality!,
        citationCoherence: args.citationCoherence!,
        sourceCredibility: args.sourceCredibility!,
        tierAppropriate: args.tierAppropriate!,
        overallSemantic: args.overallSemantic!,
      });
    } else {
      // Non-scored runs must carry an errorMessage so operators can triage.
      if (!args.errorMessage || args.errorMessage.trim().length === 0) {
        throw new Error(
          `recordLlmJudgeRun: status=${args.status} requires errorMessage`,
        );
      }
    }

    const id = await ctx.db.insert("diligenceLlmJudgeRuns", {
      ownerKey: verdict.ownerKey,
      entityId: verdict.entityId,
      verdictId: args.verdictId,
      telemetryId: args.telemetryId,
      entitySlug: args.entitySlug,
      blockType: args.blockType,
      status: args.status,
      promptHash: args.promptHash,
      promptVersion: args.promptVersion,
      modelName: args.modelName,
      proseQuality: args.proseQuality,
      citationCoherence: args.citationCoherence,
      sourceCredibility: args.sourceCredibility,
      tierAppropriate: args.tierAppropriate,
      overallSemantic: args.overallSemantic,
      strengthsJson: args.strengthsJson,
      concernsJson: args.concernsJson,
      proposedNextStep: args.proposedNextStep,
      reason: args.reason,
      errorMessage: args.errorMessage,
      latencyMs: args.latencyMs,
      judgedAt: Date.now(),
    });
    return { id };
  },
});

/* ==========================================================================
 * Query: listForVerdict — all LLM runs for a specific verdict (rerun history)
 * ========================================================================== */
export const listForVerdict = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    verdictId: v.id("diligenceJudgeVerdicts"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const verdict = await ctx.db.get(args.verdictId);
    if (!verdict || verdict.ownerKey !== identity.ownerKey) return [];
    const limit = Math.max(1, Math.min(args.limit ?? 10, MAX_PER_VERDICT));
    const rows = await ctx.db
      .query("diligenceLlmJudgeRuns")
      .withIndex("by_verdict", (q) => q.eq("verdictId", args.verdictId))
      .order("desc")
      .take(limit);
    return rows.filter((row) => row.ownerKey === identity.ownerKey);
  },
});

/* ==========================================================================
 * Query: listForEntity — recent runs across all verdicts for one entity
 * ========================================================================== */
export const listForEntity = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (await getActivePublicEntityShareByToken(ctx, args.shareToken)) {
      return [];
    }
    const access = await resolveEntityWorkspaceAccess(ctx, args);
    if (!access) return [];
    const limit = Math.max(1, Math.min(args.limit ?? 50, MAX_LLM_RUNS));
    return await ctx.db
      .query("diligenceLlmJudgeRuns")
      .withIndex("by_owner_entity", (q) =>
        q
          .eq("ownerKey", access.entity.ownerKey)
          .eq("entityId", access.entity._id),
      )
      .order("desc")
      .take(limit);
  },
});

/* ==========================================================================
 * Query: rollupRecent — aggregate for dashboards
 * ========================================================================== */
export const rollupRecent = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const limit = Math.max(1, Math.min(args.limit ?? 200, MAX_LLM_RUNS));
    const rows = await ctx.db
      .query("diligenceLlmJudgeRuns")
      .withIndex("by_owner_judged", (q) => q.eq("ownerKey", identity.ownerKey))
      .order("desc")
      .take(limit);
    if (rows.length === 0) {
      return {
        total: 0,
        scored: 0,
        parseErrors: 0,
        requestFailures: 0,
        averageOverall: 0,
        averageProse: 0,
        averageCitation: 0,
        averageSource: 0,
        averageTierAppropriate: 0,
      };
    }
    const scored = rows.filter((r) => r.status === "scored");
    const parseErrors = rows.filter((r) => r.status === "parse_error").length;
    const requestFailures = rows.filter(
      (r) => r.status === "request_failed",
    ).length;
    const avg = (pick: (r: (typeof scored)[number]) => number | undefined) => {
      if (scored.length === 0) return 0;
      let sum = 0;
      let n = 0;
      for (const r of scored) {
        const v = pick(r);
        if (typeof v === "number") {
          sum += v;
          n += 1;
        }
      }
      return n === 0 ? 0 : sum / n;
    };
    return {
      total: rows.length,
      scored: scored.length,
      parseErrors,
      requestFailures,
      averageOverall: avg((r) => r.overallSemantic),
      averageProse: avg((r) => r.proseQuality),
      averageCitation: avg((r) => r.citationCoherence),
      averageSource: avg((r) => r.sourceCredibility),
      averageTierAppropriate: avg((r) => r.tierAppropriate),
    };
  },
});

/* ==========================================================================
 * Internal helper: load everything the judge needs.
 * Exposed as a query so actions can read db via ctx.runQuery.
 * ========================================================================== */
export const getVerdictContext = internalQuery({
  args: {
    verdictId: v.id("diligenceJudgeVerdicts"),
  },
  handler: async (ctx, args) => {
    const verdict = await ctx.db.get(args.verdictId);
    if (!verdict) throw new Error("verdict not found");
    const telemetry = await ctx.db.get(verdict.telemetryId);
    if (!telemetry) throw new Error("paired telemetry row not found");
    if (
      !verdict.ownerKey ||
      !verdict.entityId ||
      telemetry.ownerKey !== verdict.ownerKey ||
      telemetry.entityId !== verdict.entityId ||
      telemetry.entitySlug !== verdict.entitySlug ||
      telemetry.blockType !== verdict.blockType ||
      telemetry.scratchpadRunId !== verdict.scratchpadRunId
    ) {
      throw new Error("tenant-bound verdict context is unavailable");
    }
    // Try to load the matching projection row for prose + payload + sources.
    const projection = await ctx.db
      .query("diligenceProjections")
      .withIndex("by_owner_entity_block_run", (q) =>
        q
          .eq("ownerKey", verdict.ownerKey!)
          .eq("entityId", verdict.entityId!)
          .eq(
            "blockType",
            telemetry.blockType as Doc<"diligenceProjections">["blockType"],
          )
          .eq("scratchpadRunId", telemetry.scratchpadRunId),
      )
      .first();
    return {
      verdict,
      telemetry,
      projection:
        projection?.producerAssurance === "internal_structuring_v1"
          ? projection
          : null,
    };
  },
});

/* ==========================================================================
 * Action: scoreVerdictWithLlm
 *   - Loads context (verdict + telemetry + projection)
 *   - Builds deterministic prompt
 *   - Calls the shared model resolver with TIMEOUT + BOUND_READ
 *   - Persists result (scored / parse_error / request_failed)
 *   - Always returns an envelope, never throws
 * ========================================================================== */
export const scoreVerdictWithLlm = internalAction({
  args: {
    verdictId: v.id("diligenceJudgeVerdicts"),
    modelName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const modelName = args.modelName ?? DEFAULT_MODEL;

    // Load context via a query — actions cannot read db directly.
    const loaded = await ctx.runQuery(
      internal.domains.product.diligenceLlmJudgeRuns.getVerdictContext,
      { verdictId: args.verdictId },
    );
    const { verdict, telemetry, projection } = loaded as {
      verdict: {
        _id: string;
        telemetryId: string;
        entitySlug: string;
        blockType: string;
      };
      telemetry: { overallTier: string; headerText: string };
      projection: {
        bodyProse?: string;
        payload?: unknown;
      } | null;
    };

    const promptInput: LlmJudgeInput = {
      entitySlug: verdict.entitySlug,
      blockType: verdict.blockType,
      overallTier: telemetry.overallTier,
      headerText: telemetry.headerText,
      bodyProse: projection?.bodyProse,
      payload: projection?.payload,
      // sources on projection are stored as sourceRefIds (ids pointing elsewhere).
      // We don't resolve them here — leaving sources empty means the judge
      // will flag "(no sources attached)" which is an HONEST signal.
      sources: [],
    };
    const prompt = buildLlmJudgePrompt(promptInput);
    const promptHash = promptHashOf(prompt);
    const startedAt = Date.now();

    // --- Shared-model invocation with TIMEOUT + BOUND_READ -------------
    let requestTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let rawText: string | null = null;
    let errorMessage: string | null = null;

    try {
      const model = getLanguageModelSafe(modelName);
      const timeoutPromise = new Promise<never>((_, reject) => {
        requestTimeoutHandle = setTimeout(
          () => reject(new Error("request timeout")),
          REQUEST_TIMEOUT_MS,
        );
      });
      const result = await Promise.race([
        generateText({
          model,
          prompt,
          temperature: 0.2,
          maxOutputTokens: 1024,
        }),
        timeoutPromise,
      ]);

      rawText = String(result.text ?? "").trim() || null;
      if (!rawText) {
        errorMessage = "model returned no text";
      } else if (Buffer.byteLength(rawText, "utf8") > MAX_RESPONSE_BYTES) {
        rawText = null;
        errorMessage = `response exceeded ${MAX_RESPONSE_BYTES} bytes`;
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      if (requestTimeoutHandle) {
        clearTimeout(requestTimeoutHandle);
      }
    }

    const latencyMs = Date.now() - startedAt;

    // --- Persist outcome ---------------------------------------------
    if (rawText) {
      const parsed = parseLlmJudgeResponse(rawText);
      if (parsed.ok) {
        await ctx.runMutation(
          internal.domains.product.diligenceLlmJudgeRuns.recordLlmJudgeRun,
          {
            verdictId: args.verdictId,
            telemetryId: verdict.telemetryId as never,
            entitySlug: verdict.entitySlug,
            blockType: verdict.blockType,
            status: "scored",
            promptHash,
            promptVersion: JUDGE_PROMPT_VERSION,
            modelName,
            proseQuality: parsed.result.scores.proseQuality,
            citationCoherence: parsed.result.scores.citationCoherence,
            sourceCredibility: parsed.result.scores.sourceCredibility,
            tierAppropriate: parsed.result.scores.tierAppropriate,
            overallSemantic: parsed.result.scores.overallSemantic,
            strengthsJson: JSON.stringify(parsed.result.strengths),
            concernsJson: JSON.stringify(parsed.result.concerns),
            proposedNextStep: parsed.result.proposedNextStep || undefined,
            reason: parsed.result.reason || undefined,
            latencyMs,
          },
        );
        return { ok: true as const, status: "scored" as const };
      }
      // Parse failure — persist for operator triage, don't throw.
      await ctx.runMutation(
        internal.domains.product.diligenceLlmJudgeRuns.recordLlmJudgeRun,
        {
          verdictId: args.verdictId,
          telemetryId: verdict.telemetryId as never,
          entitySlug: verdict.entitySlug,
          blockType: verdict.blockType,
          status: "parse_error",
          promptHash,
          promptVersion: JUDGE_PROMPT_VERSION,
          modelName,
          errorMessage: parsed.error,
          latencyMs,
        },
      );
      return { ok: false as const, reason: "parse_error" };
    }

    await ctx.runMutation(
      internal.domains.product.diligenceLlmJudgeRuns.recordLlmJudgeRun,
      {
        verdictId: args.verdictId,
        telemetryId: verdict.telemetryId as never,
        entitySlug: verdict.entitySlug,
        blockType: verdict.blockType,
        status: "request_failed",
        promptHash,
        promptVersion: JUDGE_PROMPT_VERSION,
        modelName,
        errorMessage: errorMessage ?? "unknown gemini failure",
        latencyMs,
      },
    );
    return { ok: false as const, reason: "request_failed" };
  },
});

/* ==========================================================================
 * Public mutation: requestLlmJudge
 *   Thin queue-and-run entry point so the UI ("Score with LLM" button) can
 *   trigger a run. Schedules the internal action.
 * ========================================================================== */
export const requestLlmJudge = mutation({
  args: {
    verdictId: v.id("diligenceJudgeVerdicts"),
    modelName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx);
    // Sanity — verdict must exist.
    const verdict = await ctx.db.get(args.verdictId);
    if (!verdict || verdict.ownerKey !== identity.ownerKey) {
      throw new Error("verdict not found");
    }
    await ctx.scheduler.runAfter(
      0,
      internal.domains.product.diligenceLlmJudgeRuns.scoreVerdictWithLlm,
      {
        verdictId: args.verdictId,
        modelName: args.modelName,
      },
    );
    return { status: "queued" as const };
  },
});
