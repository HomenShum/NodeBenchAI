/**
 * Composed Pipeline
 *
 * Chains primitive pipelines into multi-stage flows:
 *
 *   research_then_code:
 *     research(spec) → code_gen(synthesis as enriched spec)
 *
 *   research_then_design:
 *     research(spec) → design_gen(brief synthesized from research)
 *
 *   code_then_design:
 *     code_gen(spec) → design_gen(brief: "design a UI for the code generated below")
 *
 * Each stage runs as its own pipelineRuns row, so users see two timeline
 * entries (one per stage). The composition links them via metadata.
 *
 * Pattern: pipeline-of-pipelines. Each child pipeline retains its own
 * idempotency key + verdict + storage bundle, so any stage can be
 * re-run independently.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { resolvePipelineModelSelection } from "../agents/mcp_tools/models/modelResolver";
import { deriveComposedStageKey } from "./pipelineAttempt";

const HEADING = {
  research: "RESEARCH SYNTHESIS",
  code_gen: "GENERATED CODE BUNDLE",
  design_gen: "DESIGN BUNDLE",
} as const;

export const runComposedPipeline = internalAction({
  args: {
    composition: v.union(
      v.literal("research_then_code"),
      v.literal("research_then_design"),
      v.literal("code_then_design"),
    ),
    spec: v.string(),
    title: v.optional(v.string()),
    modelId: v.optional(v.string()),
    ownerKey: v.optional(v.string()),
    forceFresh: v.optional(v.boolean()),
    attemptKey: v.optional(v.string()),
    workflowExecutionKey: v.string(),
    linkupDepth: v.optional(v.union(v.literal("standard"), v.literal("deep"))),
  },
  returns: v.object({
    composition: v.string(),
    stage1: v.object({
      pipelineKind: v.string(),
      runId: v.string(),
      status: v.string(),
      verdict: v.optional(v.string()),
    }),
    stage2: v.object({
      pipelineKind: v.string(),
      runId: v.string(),
      status: v.string(),
      verdict: v.optional(v.string()),
    }),
  }),
  handler: async (ctx, args) => {
    const modelSelection = resolvePipelineModelSelection(args.modelId);
    const modelId = modelSelection.resolvedModelId;
    const ownerKey = args.ownerKey;

    // ── Stage 1 ─────────────────────────────────────────────────────
    let stage1RunId = "";
    let stage1Status = "skipped";
    let stage1Verdict: string | undefined = undefined;
    let stage1OutputText = "";

    if (args.composition === "research_then_code" || args.composition === "research_then_design") {
      const r: any = await ctx.runAction(
        internal.domains.pipelines.researchPipeline.runResearchPipeline,
        {
          spec: args.spec,
          title: args.title ? `${args.title} · research` : undefined,
          modelId,
          ownerKey,
          forceFresh: args.forceFresh,
          attemptKey: args.attemptKey
            ? deriveComposedStageKey(args.attemptKey, 1)
            : undefined,
          workflowExecutionKey: deriveComposedStageKey(
            args.workflowExecutionKey,
            1,
          ),
          linkupDepth: args.linkupDepth,
        },
      );
      stage1RunId = r.runId;
      stage1Status = r.status;
      stage1Verdict = r.verdict;
      stage1OutputText = r.synthesis ?? "";
    } else if (args.composition === "code_then_design") {
      const r: any = await ctx.runAction(
        internal.domains.pipelines.codeGenPipeline.runCodeGenPipeline,
        {
          spec: args.spec,
          title: args.title ? `${args.title} · code` : undefined,
          modelId,
          ownerKey,
          forceFresh: args.forceFresh,
          attemptKey: args.attemptKey
            ? deriveComposedStageKey(args.attemptKey, 1)
            : undefined,
          workflowExecutionKey: deriveComposedStageKey(
            args.workflowExecutionKey,
            1,
          ),
        },
      );
      stage1RunId = r.runId;
      stage1Status = r.status;
      stage1Verdict = r.verdict;
      // Summarize file paths so stage2 has structural context.
      stage1OutputText = (r.bundle?.files ?? [])
        .map((f: any) => `- ${f.path} (${f.content?.length ?? 0} chars)`)
        .join("\n");
    }

    // Bail if stage 1 failed — propagate the failure rather than running
    // stage 2 with garbage input (HONEST_STATUS).
    if (stage1Status === "failed") {
      return {
        composition: args.composition,
        stage1: {
          pipelineKind: args.composition.startsWith("research") ? "research" : "code_gen",
          runId: stage1RunId,
          status: stage1Status,
          verdict: stage1Verdict,
        },
        stage2: {
          pipelineKind: "skipped",
          runId: "",
          status: "skipped",
          verdict: undefined,
        },
      };
    }

    // ── Stage 2 ─────────────────────────────────────────────────────
    const stage1Heading =
      args.composition.startsWith("research")
        ? HEADING.research
        : args.composition.startsWith("code")
          ? HEADING.code_gen
          : HEADING.design_gen;

    const enrichedSpec = [
      "ORIGINAL SPEC:",
      args.spec,
      "",
      `${stage1Heading} (from prior pipeline run ${stage1RunId}):`,
      stage1OutputText.slice(0, 8000),
      "",
      "Use the prior output as context. Don't repeat it verbatim — extend it.",
    ].join("\n");

    let stage2Kind = "skipped";
    let stage2RunId = "";
    let stage2Status = "skipped";
    let stage2Verdict: string | undefined = undefined;

    if (args.composition === "research_then_code") {
      const r: any = await ctx.runAction(
        internal.domains.pipelines.codeGenPipeline.runCodeGenPipeline,
        {
          spec: enrichedSpec,
          title: args.title ? `${args.title} · code` : undefined,
          modelId,
          ownerKey,
          forceFresh: true, // composition stages must run fresh — different spec hash
          attemptKey: deriveComposedStageKey(
            args.attemptKey ?? args.workflowExecutionKey,
            2,
          ),
          workflowExecutionKey: deriveComposedStageKey(
            args.workflowExecutionKey,
            2,
          ),
        },
      );
      stage2Kind = "code_gen";
      stage2RunId = r.runId;
      stage2Status = r.status;
      stage2Verdict = r.verdict;
    } else if (
      args.composition === "research_then_design" ||
      args.composition === "code_then_design"
    ) {
      const r: any = await ctx.runAction(
        internal.domains.pipelines.designGenPipeline.runDesignGenPipeline,
        {
          spec: enrichedSpec,
          title: args.title ? `${args.title} · design` : undefined,
          modelId,
          ownerKey,
          forceFresh: true,
          attemptKey: deriveComposedStageKey(
            args.attemptKey ?? args.workflowExecutionKey,
            2,
          ),
          workflowExecutionKey: deriveComposedStageKey(
            args.workflowExecutionKey,
            2,
          ),
        },
      );
      stage2Kind = "design_gen";
      stage2RunId = r.runId;
      stage2Status = r.status;
      stage2Verdict = r.verdict;
    }

    return {
      composition: args.composition,
      stage1: {
        pipelineKind: args.composition.startsWith("research") ? "research" : "code_gen",
        runId: stage1RunId,
        status: stage1Status,
        verdict: stage1Verdict,
      },
      stage2: {
        pipelineKind: stage2Kind,
        runId: stage2RunId,
        status: stage2Status,
        verdict: stage2Verdict,
      },
    };
  },
});
