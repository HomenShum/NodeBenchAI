/**
 * Research Pipeline (pi-ai, streamed synthesis)
 *
 * Three-step pipeline that exercises the streamed runtime end-to-end:
 *
 *   1. research.scope     — pi-ai parses the question into 3-5
 *                           sub-questions + an initial outline. Single-shot.
 *   2. research.synthesize — STREAMED via `runPiCompletionStreamed`.
 *                            Each text delta is pushed to
 *                            `pipelineRunStreams.partialText` so
 *                            clients subscribed via `getPipelineStream`
 *                            see the answer grow in real-time.
 *   3. research.verify    — pi-ai checks the synthesis's internal
 *                           consistency + flags hedged claims.
 *
 * Note: v1 does NOT make external web calls — synthesis comes from the
 * model's internal knowledge. To swap in real web search later, replace
 * the synthesize prompt with retrieved snippets (Linkup / Brave / etc.)
 * before sending. The shape of the rest of the pipeline doesn't change.
 *
 * Output handoff:
 *   - JSON bundle (sub-questions + synthesis + verdict) → Convex storage
 *   - If `ownerKey` starts with `user:`, also write a Workspace document
 *     via `createPipelineDocument` so RichNotebookEditor renders it.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  runPiCompletionStreamed,
  runPiOrAiSdkCompletion,
} from "./piRuntime";
import { appendPipelineTraceEntry } from "./pipelineTrace";

function stableHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h = h & h;
  }
  return Math.abs(h).toString(36);
}

function newRunId(): string {
  return `pipeline_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function trimScratchpad(input: string, max = 32_000): string {
  return input.length > max ? input.slice(0, max - 3) + "..." : input;
}

interface ResearchScope {
  question: string;
  subQuestions: string[];
  outline: string[];
}

interface ResearchVerdict {
  tier: "verified" | "provisionally_verified" | "needs_review" | "failed";
  passing: number;
  failing: number;
  notes: string[];
}

export const runResearchPipeline = internalAction({
  args: {
    spec: v.string(),
    title: v.optional(v.string()),
    modelId: v.optional(v.string()),
    ownerKey: v.optional(v.string()),
    forceFresh: v.optional(v.boolean()),
  },
  returns: v.object({
    runId: v.string(),
    pipelineRunId: v.id("pipelineRuns"),
    status: v.string(),
    verdict: v.optional(v.string()),
    synthesis: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    bundleStorageId: v.optional(v.id("_storage")),
  }),
  handler: async (ctx, args) => {
    const pipelineKind = "research" as const;
    const modelId = args.modelId ?? "openai:gpt-4o-mini";
    const title = args.title ?? args.spec.slice(0, 80);
    const idempotencyKey = stableHash(
      [pipelineKind, args.spec, args.ownerKey ?? "anon"].sort().join(" "),
    );
    const runId = newRunId();

    const create = await ctx.runMutation(
      internal.domains.pipelines.pipelineRunsMutations.createOrGetRun,
      {
        pipelineKind,
        title,
        spec: args.spec,
        modelId,
        ownerKey: args.ownerKey,
        runId,
        idempotencyKey,
      },
    );
    const pipelineRunId: Id<"pipelineRuns"> = create.pipelineRunId;
    const effectiveRunId = create.runId;

    if (
      !create.created &&
      !args.forceFresh &&
      (create.status === "succeeded" || create.status === "running")
    ) {
      return {
        runId: effectiveRunId,
        pipelineRunId,
        status: create.status,
        verdict: undefined,
        synthesis: undefined,
        documentId: undefined,
        bundleStorageId: undefined,
      };
    }

    await ctx.runMutation(
      internal.domains.pipelines.pipelineRunsMutations.transitionRunStatus,
      { pipelineRunId, status: "running" },
    );

    let totalIn = 0;
    let totalOut = 0;
    let totalUsd = 0;
    let traceSeq = 0;

    const recordStep = async (
      name: string,
      status: "ok" | "error" | "skipped",
      input: { startedAt: number; tokens?: { in?: number; out?: number; usd?: number } },
      scratchpad?: string,
      errorMessage?: string,
      traceChoiceType:
        | "gather_info"
        | "execute_data_op"
        | "execute_output"
        | "finalize" = "execute_data_op",
      traceDescription?: string,
    ) => {
      const durationMs = Date.now() - input.startedAt;
      totalIn += input.tokens?.in ?? 0;
      totalOut += input.tokens?.out ?? 0;
      totalUsd += input.tokens?.usd ?? 0;
      await ctx.runMutation(
        internal.domains.pipelines.pipelineRunsMutations.appendStep,
        {
          pipelineRunId,
          runId: effectiveRunId,
          name,
          status,
          durationMs,
          inputTokens: input.tokens?.in,
          outputTokens: input.tokens?.out,
          estimatedUsd: input.tokens?.usd,
          modelId,
          scratchpad,
          errorMessage,
        },
      );
      await appendPipelineTraceEntry({
        ctx,
        runId: effectiveRunId,
        seq: traceSeq++,
        toolName: name,
        description: traceDescription ?? name,
        choiceType: traceChoiceType,
        durationMs,
        success: status === "ok",
        errorMessage,
        originalRequest: traceSeq === 1 ? args.spec.slice(0, 280) : undefined,
      });
    };

    try {
      // ── Step 1: research.scope ─────────────────────────────────────
      const scopeStart = Date.now();
      const scopePrompt = [
        "You are a research analyst. Decompose the question into a research scope.",
        "STRICT JSON: { \"question\": string, \"subQuestions\": string[],",
        "\"outline\": string[] } with 3-5 subQuestions and 4-6 outline points.",
        "",
        "Output ONLY JSON. No prose.",
        "",
        "QUESTION:",
        args.spec,
      ].join("\n");
      const scopeRes = await runPiOrAiSdkCompletion({
        model: modelId,
        prompt: scopePrompt,
        temperature: 0.2,
        maxOutputTokens: 1000,
        timeoutMs: 30_000,
      });
      let scope: ResearchScope;
      try {
        const cleaned = scopeRes.text
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "");
        scope = JSON.parse(cleaned);
      } catch {
        scope = {
          question: args.spec,
          subQuestions: [args.spec],
          outline: ["Background", "Key signals", "Implications", "Open questions"],
        };
      }
      await recordStep(
        "research.scope",
        "ok",
        {
          startedAt: scopeStart,
          tokens: {
            in: scopeRes.usage.inputTokens,
            out: scopeRes.usage.outputTokens,
            usd: scopeRes.usage.estimatedUsd,
          },
        },
        trimScratchpad(JSON.stringify({ raw: scopeRes.text, scope })),
        undefined,
        "gather_info",
        `Decomposed into ${scope.subQuestions.length} sub-question(s)`,
      );

      // ── Step 2: research.synthesize (STREAMED) ─────────────────────
      const synthStart = Date.now();
      const streamId = await ctx.runMutation(
        internal.domains.pipelines.pipelineStreamMutations.startPipelineStream,
        {
          pipelineRunId,
          runId: effectiveRunId,
          stepName: "research.synthesize",
        },
      );

      const synthPrompt = [
        "Write a clear, structured research synthesis answering the question.",
        "Cover each sub-question. Use the outline. Hedge appropriately when",
        "evidence is uncertain. Do NOT fabricate citations or numbers.",
        "",
        "QUESTION:",
        scope.question,
        "",
        "SUB-QUESTIONS:",
        scope.subQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
        "",
        "OUTLINE:",
        scope.outline.map((p, i) => `${i + 1}. ${p}`).join("\n"),
      ].join("\n");

      let synthesis = "";
      let synthError: string | undefined = undefined;
      try {
        const synthRes = await runPiCompletionStreamed({
          model: modelId,
          prompt: synthPrompt,
          temperature: 0.4,
          maxOutputTokens: 3000,
          timeoutMs: 90_000,
          onTextDelta: async (delta) => {
            await ctx.runMutation(
              internal.domains.pipelines.pipelineStreamMutations.appendPipelineStreamChunk,
              { streamId, delta },
            );
          },
        });
        synthesis = synthRes.text;
        totalIn += synthRes.usage.inputTokens;
        totalOut += synthRes.usage.outputTokens;
        totalUsd += synthRes.usage.estimatedUsd;
        await ctx.runMutation(
          internal.domains.pipelines.pipelineStreamMutations.finalizePipelineStream,
          { streamId, status: "complete" },
        );
        await ctx.runMutation(
          internal.domains.pipelines.pipelineRunsMutations.appendStep,
          {
            pipelineRunId,
            runId: effectiveRunId,
            name: "research.synthesize",
            status: "ok",
            durationMs: Date.now() - synthStart,
            inputTokens: synthRes.usage.inputTokens,
            outputTokens: synthRes.usage.outputTokens,
            estimatedUsd: synthRes.usage.estimatedUsd,
            modelId,
            scratchpad: trimScratchpad(`streamed; len=${synthesis.length}`),
          },
        );
        await appendPipelineTraceEntry({
          ctx,
          runId: effectiveRunId,
          seq: traceSeq++,
          toolName: "research.synthesize",
          description: `Streamed ${synthesis.length} chars`,
          choiceType: "execute_data_op",
          durationMs: Date.now() - synthStart,
          success: true,
        });
      } catch (e) {
        synthError = e instanceof Error ? e.message : String(e);
        await ctx.runMutation(
          internal.domains.pipelines.pipelineStreamMutations.finalizePipelineStream,
          { streamId, status: "error", errorMessage: synthError },
        );
        await recordStep(
          "research.synthesize",
          "error",
          { startedAt: synthStart },
          undefined,
          synthError,
          "execute_data_op",
          `Synthesis failed: ${synthError}`,
        );
      }

      if (synthError) {
        await ctx.runMutation(
          internal.domains.pipelines.pipelineRunsMutations.transitionRunStatus,
          {
            pipelineRunId,
            status: "failed",
            verdict: "failed",
            errorMessage: synthError,
            inputTokens: totalIn,
            outputTokens: totalOut,
            estimatedUsd: totalUsd,
          },
        );
        return {
          runId: effectiveRunId,
          pipelineRunId,
          status: "failed",
          verdict: "failed",
          synthesis: undefined,
          documentId: undefined,
          bundleStorageId: undefined,
        };
      }

      // ── Step 3: research.verify ────────────────────────────────────
      const verifyStart = Date.now();
      const verifyPrompt = [
        "Review the synthesis for internal consistency and unhedged speculative",
        "claims. STRICT JSON: { \"tier\": \"verified\"|\"provisionally_verified\"|\"needs_review\"|\"failed\",",
        "\"passing\": number, \"failing\": number, \"notes\": string[] }.",
        "Hedge appropriately — no real web search, so hard numerical claims",
        "should be flagged \"needs_review\" unless the model explicitly hedges.",
        "",
        "QUESTION:",
        scope.question,
        "",
        "SYNTHESIS (first 4000 chars):",
        synthesis.slice(0, 4000),
      ].join("\n");
      const verifyRes = await runPiOrAiSdkCompletion({
        model: modelId,
        prompt: verifyPrompt,
        temperature: 0,
        maxOutputTokens: 600,
        timeoutMs: 30_000,
      });
      let verdict: ResearchVerdict;
      try {
        const cleaned = verifyRes.text
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "");
        verdict = JSON.parse(cleaned);
      } catch {
        verdict = {
          tier: "needs_review",
          passing: 0,
          failing: 0,
          notes: ["judge returned non-JSON; manual review required"],
        };
      }
      await recordStep(
        "research.verify",
        "ok",
        {
          startedAt: verifyStart,
          tokens: {
            in: verifyRes.usage.inputTokens,
            out: verifyRes.usage.outputTokens,
            usd: verifyRes.usage.estimatedUsd,
          },
        },
        trimScratchpad(JSON.stringify({ raw: verifyRes.text, verdict })),
        undefined,
        "finalize",
        `Verdict: ${verdict.tier} (passing=${verdict.passing} failing=${verdict.failing})`,
      );

      const verdictTier =
        verdict.tier === "verified"
          ? "verified"
          : verdict.tier === "provisionally_verified"
            ? "provisionally_verified"
            : verdict.tier === "failed"
              ? "failed"
              : "needs_review";

      // ── Step 4: bundle.persist + document handoff ─────────────────
      const persistStart = Date.now();
      let bundleStorageId: Id<"_storage"> | undefined = undefined;
      try {
        const bundleJson = JSON.stringify(
          {
            runId: effectiveRunId,
            pipelineKind,
            spec: args.spec,
            scope,
            synthesis,
            verdict,
          },
          null,
          2,
        );
        const blob = new Blob([bundleJson], { type: "application/json" });
        bundleStorageId = await ctx.storage.store(blob);
      } catch (e) {
        console.warn(
          "[researchPipeline] bundle.persist failed:",
          e instanceof Error ? e.message : String(e),
        );
      }
      await recordStep(
        "bundle.persist",
        bundleStorageId ? "ok" : "skipped",
        { startedAt: persistStart },
        bundleStorageId ? `bundle_storage_id=${bundleStorageId}` : "no_storage_id",
        bundleStorageId ? undefined : "no_storage_id",
        "execute_output",
        bundleStorageId ? "Persisted research bundle" : "Skipped bundle persistence",
      );

      // Document handoff (best-effort; only when ownerKey="user:<id>").
      let documentId: Id<"documents"> | undefined = undefined;
      try {
        const handoff = await ctx.runMutation(
          internal.domains.pipelines.pipelineDocumentHandoff.createPipelineDocument,
          {
            pipelineRunId,
            runId: effectiveRunId,
            bundle: {
              pipelineKind,
              spec: args.spec,
              synthesis,
              verdict,
            },
          },
        );
        if (!handoff.skipped) documentId = handoff.documentId;
      } catch (e) {
        console.warn(
          "[researchPipeline] document handoff failed:",
          e instanceof Error ? e.message : String(e),
        );
      }

      await ctx.runMutation(
        internal.domains.pipelines.pipelineRunsMutations.transitionRunStatus,
        {
          pipelineRunId,
          status: verdictTier === "failed" ? "failed" : "succeeded",
          verdict: verdictTier as any,
          inputTokens: totalIn,
          outputTokens: totalOut,
          estimatedUsd: totalUsd,
          outputZipStorageId: bundleStorageId,
          outputDocumentId: documentId,
        },
      );

      return {
        runId: effectiveRunId,
        pipelineRunId,
        status: verdictTier === "failed" ? "failed" : "succeeded",
        verdict: verdictTier,
        synthesis,
        documentId,
        bundleStorageId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(
        internal.domains.pipelines.pipelineRunsMutations.transitionRunStatus,
        {
          pipelineRunId,
          status: "failed",
          verdict: "failed",
          errorMessage: message,
          inputTokens: totalIn,
          outputTokens: totalOut,
          estimatedUsd: totalUsd,
        },
      );
      return {
        runId: effectiveRunId,
        pipelineRunId,
        status: "failed",
        verdict: "failed",
        synthesis: undefined,
        documentId: undefined,
        bundleStorageId: undefined,
      };
    }
  },
});
