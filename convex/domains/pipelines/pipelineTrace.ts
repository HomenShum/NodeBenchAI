/**
 * Pipeline Trace Helper
 *
 * Wraps `traceAuditLog.appendAuditEntry` with a stable signature for
 * pi-ai pipelines. Each pipeline step also writes a `traceAuditEntries`
 * row so the existing operator dashboards (per
 * `pipeline_operational_standard.md`) work unchanged.
 *
 * Choice-type mapping for code-gen / design-gen:
 *   - spec.parse / scaffold.plan → "gather_info"
 *   - scaffold.write / image.generate → "execute_data_op"
 *   - bundle.persist (document/zip handoff) → "execute_output"
 *   - verify.review (terminal) → "finalize"
 *
 * Failures are swallowed (per ERROR_BOUNDARY): tracing must never break
 * the pipeline write path. The mutation is fire-and-forget from the
 * caller's perspective.
 */

import type { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";

export type PipelineChoiceType =
  | "gather_info"
  | "execute_data_op"
  | "execute_output"
  | "finalize";

export interface PipelineTraceArgs {
  ctx: ActionCtx;
  /** runId from `pipelineRuns.runId` — used as both executionId and workflowTag prefix. */
  runId: string;
  /** Monotonic sequence number within the run. */
  seq: number;
  /** Step name, e.g. "spec.parse" or "image.generate". */
  toolName: string;
  /** One-line human-readable description for the operator dashboard. */
  description: string;
  /** Mapping of step → choiceType — see module header. */
  choiceType: PipelineChoiceType;
  /** Required: duration in ms + success flag (HONEST_SCORES). */
  durationMs: number;
  success: boolean;
  /** Optional structured metadata. */
  rowCount?: number;
  charCount?: number;
  wordCount?: number;
  keyTopics?: string[];
  errorMessage?: string;
  /** Completion-traceability: original spec → derived deliverable. */
  originalRequest?: string;
  deliverySummary?: string;
}

export async function appendPipelineTraceEntry(args: PipelineTraceArgs): Promise<void> {
  try {
    await args.ctx.runMutation(
      internal.domains.agents.traceAuditLog.appendAuditEntry,
      {
        executionId: args.runId,
        executionType: "pipeline_run" as const,
        workflowTag: `pipeline_${args.runId}`,
        seq: args.seq,
        choiceType: args.choiceType,
        toolName: args.toolName,
        description: args.description,
        metadata: {
          rowCount: args.rowCount,
          charCount: args.charCount,
          wordCount: args.wordCount,
          keyTopics: args.keyTopics,
          errorMessage: args.errorMessage,
          durationMs: args.durationMs,
          success: args.success,
          originalRequest: args.originalRequest,
          deliverySummary: args.deliverySummary,
        },
      },
    );
  } catch (e) {
    console.warn(
      `[pipelineTrace] appendAuditEntry failed seq=${args.seq} step=${args.toolName}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}
