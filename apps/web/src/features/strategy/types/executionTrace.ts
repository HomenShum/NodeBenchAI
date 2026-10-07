import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const SourceRefSchema = z
  .object({
    label: z.string(),
    url: z.string().url().optional(),
    source_type: z
      .enum([
        "uploaded_file",
        "company_website",
        "press_release",
        "job_posting",
        "resume",
        "news_article",
        "research_paper",
        "rendered_artifact",
        "tool_output",
        "other",
      ])
      .optional(),
  })
  .strict();

const EvidenceItemSchema = z
  .object({
    evidence_id: z.string(),
    title: z.string(),
    summary: z.string(),
    source_refs: z.array(SourceRefSchema),
    supported_claims: z.array(z.string()).default([]),
    unsupported_claims: z.array(z.string()).default([]),
  })
  .strict();

const WorkflowStepSchema = z
  .object({
    step_id: z.string(),
    stage: z.enum([
      "ingest",
      "inspect",
      "research",
      "propose",
      "edit",
      "verify",
      "export",
      "summarize",
    ]),
    type: z.enum([
      "task_started",
      "file_loaded",
      "sheet_inspected",
      "format_detected",
      "research_query_executed",
      "evidence_attached",
      "decision_recorded",
      "cells_updated",
      "comment_added",
      "style_changed",
      "render_generated",
      "issue_detected",
      "issue_fixed",
      "verification_passed",
      "artifact_exported",
      "task_completed",
    ]),
    title: z.string(),
    tool: z.string(),
    action: z.string(),
    target: z.string(),
    result_summary: z.string(),
    evidence_refs: z.array(z.string()).default([]),
    artifacts_out: z.array(z.string()).default([]),
    verification: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

const DecisionRecordSchema = z
  .object({
    decision_id: z.string(),
    decision_type: z.string(),
    statement: z.string(),
    basis: z.array(z.string()),
    evidence_refs: z.array(z.string()).default([]),
    alternatives_considered: z.array(z.string()).default([]),
  })
  .strict();

const CellChangeSchema = z
  .object({
    cell: z.string(),
    before: z.string().nullable(),
    after: z.string().nullable(),
  })
  .strict();

const DiffRecordSchema = z
  .object({
    diff_id: z.string(),
    target: z.string(),
    summary: z.string(),
    cell_changes: z.array(CellChangeSchema).default([]),
    structural_changes: z.array(z.string()).default([]),
  })
  .strict();

const VerificationCheckSchema = z
  .object({
    check_id: z.string(),
    label: z.string(),
    status: z.enum(["passed", "warning", "failed", "fixed"]),
    details: z.string(),
    related_artifact_ids: z.array(z.string()).default([]),
  })
  .strict();

const OutputArtifactSchema = z
  .object({
    output_id: z.string(),
    label: z.string(),
    kind: z.enum(["xlsx", "png", "json", "memo", "other"]),
    path: z.string(),
    summary: z.string(),
  })
  .strict();

export const ExecutionTraceSchema = z
  .object({
    meta: z
      .object({
        analysis_id: z.string(),
        workflow_template: z.literal("research_edit_verify_export"),
        generated_at: z.string().datetime(),
        status: z.enum(["completed", "in_progress", "failed"]),
        confidence_level: z.enum(["high", "medium", "low"]),
      })
      .strict(),
    run: z
      .object({
        run_id: z.string(),
        workflow_type: z.string(),
        user_goal: z.string(),
        status: z.enum(["completed", "in_progress", "failed"]),
        started_at: z.string().datetime(),
        completed_at: z.string().datetime(),
      })
      .strict(),
    inputs: z
      .object({
        uploaded_files: z.array(z.string()),
        instructions: z.array(z.string()),
      })
      .strict(),
    steps: z.array(WorkflowStepSchema).min(1),
    evidence_catalog: z.array(EvidenceItemSchema),
    decisions: z.array(DecisionRecordSchema),
    diffs: z.array(DiffRecordSchema),
    verification_checks: z.array(VerificationCheckSchema),
    limitations: z.array(z.string()),
    outputs: z.array(OutputArtifactSchema),
  })
  .strict();

export type ExecutionTrace = z.infer<typeof ExecutionTraceSchema>;

export const EXECUTION_TRACE_JSON_SCHEMA = zodToJsonSchema(ExecutionTraceSchema, {
  name: "NodeBenchExecutionTrace",
  target: "jsonSchema7",
  $refStrategy: "none",
});
