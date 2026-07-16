/**
 * Pipeline Workflow Orchestrator
 *
 * Wraps pi-ai pipelines (`code_gen` / `design_gen` / `research`) in
 * `@convex-dev/workflow` for durable retries, scheduling, and resumable
 * execution. Each pipeline kind becomes a `step.runAction` call with
 * provider-specific retry policy.
 *
 * Why a separate workflow layer instead of putting retries inside each
 * pipeline action:
 *   - The pipeline's internalAction already handles per-LLM-call retry
 *     in `runPiOrAiSdkCompletion` + handles per-step idempotency via
 *     `createOrGetRun`. Workflow adds *coarse-grained* retry/scheduling
 *     on top — e.g., re-run a whole pipeline on transient infra errors.
 *   - Lets users schedule a pipeline run via cron / cron-extra without
 *     standing up a per-pipeline trigger.
 *
 * Pattern: durable-workflow (Convex / Inngest / Temporal).
 * Prior art: bankingMemoWorkflow.ts (existing in this repo).
 */

import { v } from "convex/values";
import { internalMutation, mutation } from "../../_generated/server";
import { components, internal } from "../../_generated/api";
import { WorkflowManager } from "@convex-dev/workflow";
import { requireAuthenticatedPipelineOwnerKey } from "./pipelineOwnership";
import {
  normalizePipelineLaunchText,
  normalizePipelineOwnerKey,
  reservePipelineLaunchAdmission,
} from "./pipelineAdmission";
import {
  createManualPipelineAttemptKey,
  createPipelineWorkflowExecutionKey,
} from "./pipelineAttempt";

const workflowManager = new WorkflowManager(components.workflow);

// ─────────────────────────────────────────────────────────────────────────
// Workflow definition — one per pipeline kind, all routed through the
// same step.runAction shape so the launcher can target any of them.
// ─────────────────────────────────────────────────────────────────────────

export const runPipelineWorkflow = workflowManager.define({
  args: {
    pipelineKind: v.union(
      v.literal("code_gen"),
      v.literal("design_gen"),
      v.literal("research"),
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
  handler: async (
    step,
    args,
  ): Promise<{
    runId: string;
    pipelineRunId: any;
    status: string;
    verdict?: string;
  }> => {
    // Each pipeline runs as a single durable step. The step.runAction
    // call will retry on transient failures (rate limits, 5xx) using
    // the configured backoff. The pipeline's idempotency-keyed
    // `createOrGetRun` ensures a retry doesn't double-create runs.
    const retry = { maxAttempts: 3, initialBackoffMs: 2000, base: 2 };

    if (args.pipelineKind === "code_gen") {
      const result: any = await step.runAction(
        internal.domains.pipelines.codeGenPipeline.runCodeGenPipeline,
        {
          spec: args.spec,
          title: args.title,
          modelId: args.modelId,
          ownerKey: args.ownerKey,
          forceFresh: args.forceFresh,
          attemptKey: args.attemptKey,
          workflowExecutionKey: args.workflowExecutionKey,
        },
        { retry },
      );
      return {
        runId: result.runId,
        pipelineRunId: result.pipelineRunId,
        status: result.status,
        verdict: result.verdict,
      };
    }

    if (args.pipelineKind === "design_gen") {
      const result: any = await step.runAction(
        internal.domains.pipelines.designGenPipeline.runDesignGenPipeline,
        {
          spec: args.spec,
          title: args.title,
          modelId: args.modelId,
          ownerKey: args.ownerKey,
          forceFresh: args.forceFresh,
          attemptKey: args.attemptKey,
          workflowExecutionKey: args.workflowExecutionKey,
        },
        { retry },
      );
      return {
        runId: result.runId,
        pipelineRunId: result.pipelineRunId,
        status: result.status,
        verdict: result.verdict,
      };
    }

    // research
    const result: any = await step.runAction(
      internal.domains.pipelines.researchPipeline.runResearchPipeline,
      {
        spec: args.spec,
        title: args.title,
        modelId: args.modelId,
        ownerKey: args.ownerKey,
        forceFresh: args.forceFresh,
        attemptKey: args.attemptKey,
        workflowExecutionKey: args.workflowExecutionKey,
        linkupDepth: args.linkupDepth,
      },
      { retry },
    );
    return {
      runId: result.runId,
      pipelineRunId: result.pipelineRunId,
      status: result.status,
      verdict: result.verdict,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Public mutation: kick off a pipeline workflow from the frontend.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Start a pipeline workflow. Returns the workflow ID immediately so the
 * caller can poll status (or just rely on the reactive PipelineRunsPanel
 * to surface the new run). Use this from the launcher UI instead of
 * calling each pipeline directly.
 */
const pipelineKindValidator = v.union(
  v.literal("code_gen"),
  v.literal("design_gen"),
  v.literal("research"),
);

const pipelineLaunchArgs = {
  pipelineKind: pipelineKindValidator,
  spec: v.string(),
  title: v.optional(v.string()),
  modelId: v.optional(v.string()),
  forceFresh: v.optional(v.boolean()),
  linkupDepth: v.optional(v.union(v.literal("standard"), v.literal("deep"))),
};

async function startPipelineWorkflowForOwner(
  ctx: any,
  args: {
    pipelineKind: "code_gen" | "design_gen" | "research";
    spec: string;
    title?: string;
    modelId?: string;
    forceFresh?: boolean;
    attemptKey?: string;
    linkupDepth?: "standard" | "deep";
  },
  ownerKey: string,
): Promise<{ workflowId: string }> {
  const launchArgs = normalizePipelineLaunchText(args);
  const attemptKey =
    launchArgs.attemptKey ??
    (launchArgs.forceFresh ? createManualPipelineAttemptKey() : undefined);
  const workflowExecutionKey = createPipelineWorkflowExecutionKey();
  const workflowId = await workflowManager.start(
    ctx,
    internal.domains.pipelines.pipelineWorkflow.runPipelineWorkflow,
    { ...launchArgs, ownerKey, attemptKey, workflowExecutionKey },
  );
  return { workflowId: String(workflowId) };
}

export const startPipelineRun = mutation({
  args: pipelineLaunchArgs,
  returns: v.object({
    workflowId: v.string(),
  }),
  handler: async (ctx, args): Promise<{ workflowId: string }> => {
    const ownerKey = await requireAuthenticatedPipelineOwnerKey(ctx);
    await reservePipelineLaunchAdmission(ctx, ownerKey);
    return await startPipelineWorkflowForOwner(ctx, args, ownerKey);
  },
});

/** Trusted cron/worker entrypoint. Public clients cannot choose this owner. */
export const startPipelineRunInternal = internalMutation({
  args: {
    ...pipelineLaunchArgs,
    ownerKey: v.string(),
    attemptKey: v.optional(v.string()),
  },
  returns: v.object({ workflowId: v.string() }),
  handler: async (ctx, args): Promise<{ workflowId: string }> => {
    const ownerKey = normalizePipelineOwnerKey(args.ownerKey);
    const { ownerKey: _ownerKey, ...launchArgs } = args;
    if (ownerKey.startsWith("user:")) {
      await reservePipelineLaunchAdmission(ctx, ownerKey);
    }
    return await startPipelineWorkflowForOwner(ctx, launchArgs, ownerKey);
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Composed pipeline (research → code, research → design, code → design)
// ─────────────────────────────────────────────────────────────────────────

export const runComposedWorkflow = workflowManager.define({
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
  handler: async (step, args): Promise<any> => {
    return await step.runAction(
      internal.domains.pipelines.composedPipeline.runComposedPipeline,
      args,
      { retry: { maxAttempts: 2, initialBackoffMs: 5000, base: 2 } },
    );
  },
});

export const startComposedPipelineRun = mutation({
  args: {
    composition: v.union(
      v.literal("research_then_code"),
      v.literal("research_then_design"),
      v.literal("code_then_design"),
    ),
    spec: v.string(),
    title: v.optional(v.string()),
    modelId: v.optional(v.string()),
    forceFresh: v.optional(v.boolean()),
    linkupDepth: v.optional(v.union(v.literal("standard"), v.literal("deep"))),
  },
  returns: v.object({ workflowId: v.string() }),
  handler: async (ctx, args): Promise<{ workflowId: string }> => {
    const ownerKey = await requireAuthenticatedPipelineOwnerKey(ctx);
    await reservePipelineLaunchAdmission(ctx, ownerKey, { units: 2 });
    const launchArgs = normalizePipelineLaunchText(args);
    const attemptKey = launchArgs.forceFresh
      ? createManualPipelineAttemptKey()
      : undefined;
    const workflowExecutionKey = createPipelineWorkflowExecutionKey();
    const workflowId = await workflowManager.start(
      ctx,
      internal.domains.pipelines.pipelineWorkflow.runComposedWorkflow,
      { ...launchArgs, ownerKey, attemptKey, workflowExecutionKey },
    );
    return { workflowId: String(workflowId) };
  },
});

/** Trusted bridge entrypoint for secret-gated service callers. */
export const startComposedPipelineRunInternal = internalMutation({
  args: {
    composition: v.union(
      v.literal("research_then_code"),
      v.literal("research_then_design"),
      v.literal("code_then_design"),
    ),
    spec: v.string(),
    title: v.optional(v.string()),
    modelId: v.optional(v.string()),
    ownerKey: v.string(),
    forceFresh: v.optional(v.boolean()),
    attemptKey: v.optional(v.string()),
    linkupDepth: v.optional(v.union(v.literal("standard"), v.literal("deep"))),
  },
  returns: v.object({ workflowId: v.string() }),
  handler: async (ctx, args): Promise<{ workflowId: string }> => {
    const ownerKey = normalizePipelineOwnerKey(args.ownerKey);
    const { ownerKey: _ownerKey, ...rawLaunchArgs } = args;
    if (ownerKey.startsWith("user:")) {
      await reservePipelineLaunchAdmission(ctx, ownerKey, { units: 2 });
    }
    const launchArgs = normalizePipelineLaunchText(rawLaunchArgs);
    const attemptKey =
      launchArgs.attemptKey ??
      (launchArgs.forceFresh ? createManualPipelineAttemptKey() : undefined);
    const workflowExecutionKey = createPipelineWorkflowExecutionKey();
    const workflowId = await workflowManager.start(
      ctx,
      internal.domains.pipelines.pipelineWorkflow.runComposedWorkflow,
      { ...launchArgs, ownerKey, attemptKey, workflowExecutionKey },
    );
    return { workflowId: String(workflowId) };
  },
});
