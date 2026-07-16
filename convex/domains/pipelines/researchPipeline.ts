/**
 * Research Pipeline (pi-ai, streamed synthesis)
 *
 * Four-step pipeline that exercises the streamed runtime end-to-end:
 *
 *   1. research.scope     — pi-ai parses the question into 3-5
 *                           sub-questions + an initial outline. Single-shot.
 *   2. research.gather     — retrieves bounded external snippets via Linkup.
 *   3. research.synthesize — STREAMED via `runPiCompletionStreamed`.
 *                            Each text delta is pushed to
 *                            `pipelineRunStreams.partialText` so
 *                            clients subscribed via `getPipelineStream`
 *                            see the answer grow in real-time.
 *   4. research.verify     — combines model review with deterministic
 *                            citation-marker binding before final verdict.
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
import { resolvePipelineModelSelection } from "../agents/mcp_tools/models/modelResolver";
import {
  runPiCompletionStreamed,
  runPiOrAiSdkCompletion,
} from "./piRuntime";
import { appendPipelineTraceEntry } from "./pipelineTrace";
import {
  runLinkupSearch,
  formatSnippetsForPrompt,
  type LinkupSnippet,
} from "./linkupAdapter";
import { buildPipelineIdempotencyKey } from "./pipelineAttempt";
import {
  applyCitationBoundVerdict,
  selectCitationsUsed,
  validateCitationMarkers,
  type ResearchVerdict,
} from "./researchProvenance";

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

export const runResearchPipeline = internalAction({
  args: {
    spec: v.string(),
    title: v.optional(v.string()),
    modelId: v.optional(v.string()),
    ownerKey: v.optional(v.string()),
    forceFresh: v.optional(v.boolean()),
    attemptKey: v.optional(v.string()),
    workflowExecutionKey: v.string(),
    /**
     * Linkup search depth — "standard" (~€0.005) or "deep" (~€0.05).
     * Use "deep" for gnarlier multi-hop research. Default "standard".
     */
    linkupDepth: v.optional(v.union(v.literal("standard"), v.literal("deep"))),
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
    if (args.forceFresh && !args.attemptKey) {
      throw new Error("forceFresh pipeline execution requires an attemptKey");
    }
    const pipelineKind = "research" as const;
    const modelSelection = resolvePipelineModelSelection(args.modelId);
    const modelId = modelSelection.resolvedModelId;
    const title = args.title ?? args.spec.slice(0, 80);
    const idempotencyKey = buildPipelineIdempotencyKey({
      pipelineKind,
      spec: args.spec,
      ownerKey: args.ownerKey,
      attemptKey: args.attemptKey,
    });
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
        attemptKey: args.attemptKey,
        workflowExecutionKey: args.workflowExecutionKey,
        idempotencyKey,
      },
    );
    const pipelineRunId: Id<"pipelineRuns"> = create.pipelineRunId;
    const effectiveRunId = create.runId;
    const executionGeneration = create.executionGeneration;
    const executionFence = {
      workflowExecutionKey: args.workflowExecutionKey,
      executionGeneration,
    };

    if (!create.acquired) {
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
          ...executionFence,
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
        ownerKey: args.ownerKey,
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

      // ── Step 2: research.gather ────────────────────────────────────
      // Best-effort web search per sub-question via Linkup. Falls back
      // gracefully when LINKUP_API_KEY isn't set (common in local dev),
      // in which case `gathered` is empty and synthesis runs from the
      // model's internal knowledge only.
      const gatherStart = Date.now();
      const allSnippets: LinkupSnippet[] = [];
      let gatherFallback = false;
      let gatherErrors = 0;
      const perSubResults: Array<{
        subQuestion: string;
        count: number;
        fallback: boolean;
      }> = [];
      for (const sub of scope.subQuestions.slice(0, 5)) {
        try {
          const res = await runLinkupSearch({
            query: sub,
            depth: args.linkupDepth ?? "standard",
            maxResults: args.linkupDepth === "deep" ? 6 : 4,
            timeoutMs: args.linkupDepth === "deep" ? 60_000 : 25_000,
          });
          if (res.fallback) gatherFallback = true;
          for (const snip of res.snippets) {
            // Dedupe on URL across sub-questions.
            if (!allSnippets.some((s) => s.url === snip.url)) {
              allSnippets.push(snip);
            }
          }
          perSubResults.push({
            subQuestion: sub,
            count: res.snippets.length,
            fallback: res.fallback,
          });
        } catch (e) {
          gatherErrors += 1;
          console.warn(
            `[researchPipeline] gather subQuestion failed: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
          perSubResults.push({ subQuestion: sub, count: 0, fallback: false });
        }
      }
      const gatherStatus =
        gatherFallback && allSnippets.length === 0
          ? "skipped"
          : gatherErrors > 0 && allSnippets.length === 0
            ? "error"
            : "ok";
      await recordStep(
        "research.gather",
        gatherStatus,
        { startedAt: gatherStart },
        trimScratchpad(
          JSON.stringify({
            totalSnippets: allSnippets.length,
            perSub: perSubResults,
            fallback: gatherFallback,
            errors: gatherErrors,
          }),
        ),
        gatherStatus === "error" ? "all_subqueries_failed" : undefined,
        "gather_info",
        gatherFallback
          ? "Skipped Linkup (no API key) — synthesis from internal knowledge only"
          : `Gathered ${allSnippets.length} snippets across ${scope.subQuestions.length} sub-questions`,
      );

      // ── Step 3: research.synthesize (STREAMED) ─────────────────────
      const synthStart = Date.now();
      const streamId = await ctx.runMutation(
        internal.domains.pipelines.pipelineStreamMutations.startPipelineStream,
        {
          pipelineRunId,
          runId: effectiveRunId,
          stepName: "research.synthesize",
          ...executionFence,
        },
      );

      const sourcesSection =
        allSnippets.length > 0
          ? [
              "",
              "RETRIEVED SOURCES (cite with [N] markers using these numbers):",
              formatSnippetsForPrompt(allSnippets),
              "",
              "When you cite a fact, use the [N] marker matching the source above.",
              "Do not invent citations — use ONLY the numbered sources.",
            ].join("\n")
          : [
              "",
              "(No external sources were retrieved. Answer from internal knowledge.",
              "Hedge claims, especially numeric ones, since you cannot verify.)",
            ].join("\n");

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
        sourcesSection,
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
              { streamId, delta, ...executionFence },
            );
          },
        });
        synthesis = synthRes.text;
        totalIn += synthRes.usage.inputTokens;
        totalOut += synthRes.usage.outputTokens;
        totalUsd += synthRes.usage.estimatedUsd;
        await ctx.runMutation(
          internal.domains.pipelines.pipelineStreamMutations.finalizePipelineStream,
          { streamId, status: "complete", ...executionFence },
        );
        await ctx.runMutation(
          internal.domains.pipelines.pipelineRunsMutations.appendStep,
          {
            pipelineRunId,
            ...executionFence,
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
          ownerKey: args.ownerKey,
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
          {
            streamId,
            status: "error",
            errorMessage: synthError,
            ...executionFence,
          },
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
            ...executionFence,
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
      const citationValidation = validateCitationMarkers(
        synthesis,
        allSnippets.length,
      );
      const citationsUsed = selectCitationsUsed(
        allSnippets,
        citationValidation,
      );

      const verifyStart = Date.now();
      const verifyPrompt = [
        "Review the synthesis for internal consistency and unhedged speculative",
        "claims. STRICT JSON: { \"tier\": \"verified\"|\"provisionally_verified\"|\"needs_review\"|\"failed\",",
        "\"passing\": number, \"failing\": number, \"notes\": string[] }.",
        "Check hard claims against the externally retrieved evidence where available.",
        "External evidence is usable only when synthesis [N] markers bind to",
        "the retrieved source with that number. Never call unbound claims verified.",
        `CITATION STATE: ${citationValidation.state}`,
        `VALID MARKERS: ${citationValidation.validMarkers.join(", ") || "none"}`,
        `INVALID MARKERS: ${citationValidation.invalidMarkers.join(", ") || "none"}`,
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
      let candidateVerdict: ResearchVerdict;
      try {
        const cleaned = verifyRes.text
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "");
        candidateVerdict = JSON.parse(cleaned);
      } catch {
        candidateVerdict = {
          tier: "needs_review",
          passing: 0,
          failing: 0,
          notes: ["judge returned non-JSON; manual review required"],
        };
      }
      const verdict = applyCitationBoundVerdict(
        candidateVerdict,
        citationValidation,
      );
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
        trimScratchpad(
          JSON.stringify({
            raw: verifyRes.text,
            candidateVerdict,
            verdict,
            citationValidation,
          }),
        ),
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
            sourcesConsulted: allSnippets,
            citationsUsed,
            citationValidation,
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
            ...executionFence,
            bundle: {
              pipelineKind,
              spec: args.spec,
              synthesis,
              sourcesConsulted: allSnippets.map((source, index) => ({
                idx: index + 1,
                title: source.title,
                url: source.url,
              })),
              citationsUsed,
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
          ...executionFence,
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
          ...executionFence,
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
