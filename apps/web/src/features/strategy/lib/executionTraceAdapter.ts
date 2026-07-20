import type {
  OracleSourceRef,
  TaskSession,
  TaskSpan,
  TaskTrace,
} from "@/features/agents/components/TaskManager/types";

import { ExecutionTraceSchema, type ExecutionTrace } from "../types/executionTrace";

type LiveTaskSession = TaskSession & {
  metadata?: unknown;
  errorStack?: string;
};

type LiveTaskTrace = TaskTrace & {
  metadata?: unknown;
};

type LiveTaskSpan = TaskSpan;

type DiffRecord = ExecutionTrace["diffs"][number];
type OutputRecord = ExecutionTrace["outputs"][number];
type DecisionRecord = ExecutionTrace["decisions"][number];
type VerificationRecord = ExecutionTrace["verification_checks"][number];
type WorkflowStep = ExecutionTrace["steps"][number];
type EvidenceRecord = ExecutionTrace["evidence_catalog"][number];

const FILE_METADATA_KEYS = ["uploadedFiles", "inputFiles", "files", "fileUris", "artifactPaths", "paths"];
const INSTRUCTION_METADATA_KEYS = ["instructions", "tasks", "constraints", "prompts", "goals"];
const OUTPUT_METADATA_KEYS = ["outputs", "artifacts", "exportedFiles", "outputFiles"];
const DIFF_METADATA_KEYS = ["diffs", "changes", "artifactDiffs"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function toIso(timestamp?: number): string {
  const safeValue = typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : Date.now();
  return new Date(safeValue).toISOString();
}

function normalizeRunStatus(status: TaskSession["status"]): ExecutionTrace["run"]["status"] {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "cancelled") return "failed";
  return "in_progress";
}

function extractStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(
    value.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (isRecord(item)) {
        return [item.path, item.uri, item.file, item.label, item.title].map(normalizeString);
      }
      return [];
    }),
  );
}

function extractStringLists(metadata: unknown, keys: string[]): string[] {
  if (!isRecord(metadata)) return [];
  return uniqueStrings(keys.flatMap((key) => extractStringList(metadata[key])));
}

function extractExplicitMetadataList(metadata: unknown, keys: string[]): Record<string, unknown>[] {
  if (!isRecord(metadata)) return [];
  return keys.flatMap((key) => {
    const items = metadata[key];
    if (!Array.isArray(items)) return [];
    return items.filter(isRecord);
  });
}

function getSummaryFromMetadata(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;
  return (
    normalizeString(metadata.summary) ??
    normalizeString(metadata.description) ??
    normalizeString(metadata.resultSummary) ??
    normalizeString(metadata.detail) ??
    normalizeString(metadata.message)
  );
}

function inferStage(name: string, spanType?: LiveTaskSpan["spanType"]): WorkflowStep["stage"] {
  const value = name.toLowerCase();
  if (value.includes("ingest") || value.includes("load input")) return "ingest";
  if (
    value.includes("inspect") ||
    value.includes("scan") ||
    value.includes("enumerat") ||
    value.includes("structure") ||
    value.includes("load")
  ) {
    return "inspect";
  }
  if (
    value.includes("research") ||
    value.includes("search") ||
    value.includes("retrieve") ||
    value.includes("collect") ||
    value.includes("brief") ||
    spanType === "retrieval"
  ) {
    return "research";
  }
  if (
    value.includes("plan") ||
    value.includes("propos") ||
    value.includes("rank") ||
    value.includes("select") ||
    value.includes("decid") ||
    spanType === "generation" ||
    spanType === "delegation"
  ) {
    return "propose";
  }
  if (
    value.includes("edit") ||
    value.includes("write") ||
    value.includes("update") ||
    value.includes("patch") ||
    value.includes("draft") ||
    value.includes("create")
  ) {
    return "edit";
  }
  if (
    value.includes("verify") ||
    value.includes("check") ||
    value.includes("guard") ||
    value.includes("dogfood") ||
    value.includes("audit") ||
    value.includes("render") ||
    value.includes("test") ||
    spanType === "guardrail"
  ) {
    return "verify";
  }
  if (value.includes("export") || value.includes("publish") || value.includes("ship")) return "export";
  return "summarize";
}

function inferStepType(stage: WorkflowStep["stage"]): WorkflowStep["type"] {
  switch (stage) {
    case "ingest":
      return "task_started";
    case "inspect":
      return "sheet_inspected";
    case "research":
      return "research_query_executed";
    case "propose":
      return "decision_recorded";
    case "edit":
      return "cells_updated";
    case "verify":
      return "verification_passed";
    case "export":
      return "artifact_exported";
    case "summarize":
    default:
      return "task_completed";
  }
}

function confidenceLevelForRun(
  status: ExecutionTrace["run"]["status"],
  traces: LiveTaskTrace[],
  evidenceCount: number,
): ExecutionTrace["meta"]["confidence_level"] {
  const richness = traces.length + evidenceCount;
  if (status === "failed") return richness >= 4 ? "medium" : "low";
  return richness >= 5 ? "high" : "medium";
}

function sourceRefUrl(ref: OracleSourceRef): string | undefined {
  if (typeof ref.href === "string" && ref.href.startsWith("http")) return ref.href;
  return undefined;
}

function sourceTypeForRef(ref: OracleSourceRef): EvidenceRecord["source_refs"][number]["source_type"] {
  const kind = ref.kind?.toLowerCase() ?? "";
  if (kind.includes("render")) return "rendered_artifact";
  if (kind.includes("tool")) return "tool_output";
  if (kind.includes("press")) return "press_release";
  if (kind.includes("resume")) return "resume";
  if (kind.includes("research") || kind.includes("paper")) return "research_paper";
  if (kind.includes("job")) return "job_posting";
  if (kind.includes("news")) return "news_article";
  if (kind.includes("company") || kind.includes("site")) return "company_website";
  return ref.href ? "company_website" : "other";
}

function buildEvidenceCatalog(
  session: LiveTaskSession,
  traces: LiveTaskTrace[],
  uploadedFiles: string[],
) {
  const evidence: EvidenceRecord[] = [];
  const evidenceIdByKey = new Map<string, string>();

  uploadedFiles.forEach((path, index) => {
    const evidenceId = `evidence_file_${index + 1}`;
    evidence.push({
      evidence_id: evidenceId,
      title: path.split(/[\\/]/).pop() ?? path,
      summary: `Uploaded file attached to the live run "${session.title}".`,
      source_refs: [{ label: path, source_type: "uploaded_file" }],
      supported_claims: ["uploaded workflow input"],
      unsupported_claims: [],
    });
    evidenceIdByKey.set(`file:${path}`, evidenceId);
  });

  const allRefs = [
    ...(session.sourceRefs ?? []),
    ...traces.flatMap((trace) => trace.sourceRefs ?? []),
  ];

  allRefs.forEach((ref) => {
    const key = `${ref.label}|${ref.href ?? ""}|${ref.note ?? ""}`;
    if (evidenceIdByKey.has(key)) return;
    const evidenceId = `evidence_ref_${evidence.length + 1}`;
    evidence.push({
      evidence_id: evidenceId,
      title: ref.label,
      summary:
        ref.note?.trim() ||
        `Source reference captured while executing "${session.title}".`,
      source_refs: [
        {
          label: ref.label,
          url: sourceRefUrl(ref),
          source_type: sourceTypeForRef(ref),
        },
      ],
      supported_claims: ref.kind ? [ref.kind] : [],
      unsupported_claims: [],
    });
    evidenceIdByKey.set(key, evidenceId);
  });

  const explicitEvidence = [
    ...extractExplicitMetadataList(session.metadata, ["executionTraceEvidence", "evidenceCatalog"]),
    ...traces.flatMap((trace) => extractExplicitMetadataList(trace.metadata, ["executionTraceEvidence", "evidenceCatalog"])),
  ];

  explicitEvidence.forEach((item, index) => {
    const title = normalizeString(item.title);
    const summary = normalizeString(item.summary);
    const refs = Array.isArray(item.sourceRefs)
      ? item.sourceRefs.filter(isRecord).map((ref) => ({
          label: normalizeString(ref.label) ?? "Untitled source",
          href: normalizeString(ref.href) ?? undefined,
          note: normalizeString(ref.note) ?? undefined,
          kind: normalizeString(ref.kind) ?? undefined,
        }))
      : [];
    if (!title || !summary || refs.length === 0) return;
    const key = `explicit:${title}|${summary}|${refs.map((ref) => `${ref.label}|${ref.href ?? ""}`).join("::")}`;
    if (evidenceIdByKey.has(key)) return;
    const evidenceId = `evidence_explicit_${index + 1}`;
    evidence.push({
      evidence_id: evidenceId,
      title,
      summary,
      source_refs: refs.map((ref) => ({
        label: ref.label,
        url: sourceRefUrl(ref),
        source_type: sourceTypeForRef(ref),
      })),
      supported_claims: extractStringList(item.supportedClaims),
      unsupported_claims: extractStringList(item.unsupportedClaims),
    });
    evidenceIdByKey.set(key, evidenceId);
  });

  return { evidence, evidenceIdByKey };
}

function evidenceIdsForSourceRefs(
  refs: OracleSourceRef[] | undefined,
  evidenceIdByKey: Map<string, string>,
): string[] {
  if (!refs?.length) return [];
  return uniqueStrings(
    refs.map((ref) => evidenceIdByKey.get(`${ref.label}|${ref.href ?? ""}|${ref.note ?? ""}`) ?? null),
  );
}

function buildWorkflowSteps(
  session: LiveTaskSession,
  traces: LiveTaskTrace[],
  spans: LiveTaskSpan[],
  evidenceIdByKey: Map<string, string>,
): WorkflowStep[] {
  const steps: WorkflowStep[] = [
    {
      step_id: `step_session_${String(session._id)}`,
      stage: "ingest",
      type: "task_started",
      title: `Started ${session.title}`,
      tool: "nodebench_runtime",
      action: "open_saved_run",
      target: session.title,
      result_summary:
        session.description?.trim() ||
        `Loaded the saved task session "${session.title}" from the live execution substrate.`,
      evidence_refs: evidenceIdsForSourceRefs(session.sourceRefs, evidenceIdByKey),
      artifacts_out: [],
      verification: [],
      confidence: 0.95,
    },
  ];

  traces.forEach((trace) => {
    const stage = inferStage(trace.workflowName);
    steps.push({
      step_id: `step_trace_${String(trace._id)}`,
      stage,
      type: inferStepType(stage),
      title: trace.workflowName,
      tool:
        normalizeString(trace.model) ??
        extractStringLists(trace.metadata, ["toolSequence"])[0] ??
        "nodebench_runtime",
      action: normalizeString((trace.metadata as Record<string, unknown> | undefined)?.action) ?? "replay_trace",
      target: trace.goalId ?? trace.traceId,
      result_summary:
        getSummaryFromMetadata(trace.metadata) ??
        trace.deltaFromVision ??
        (trace.status === "error"
          ? `Trace failed while executing ${trace.workflowName}.`
          : `Trace completed as part of the live saved run.`),
      evidence_refs: evidenceIdsForSourceRefs(trace.sourceRefs, evidenceIdByKey),
      artifacts_out: extractStringLists(trace.metadata, OUTPUT_METADATA_KEYS),
      verification: uniqueStrings([
        trace.crossCheckStatus ? `Cross-check status: ${trace.crossCheckStatus}.` : null,
        trace.deltaFromVision ?? null,
      ]),
      confidence: trace.status === "error" ? 0.62 : 0.86,
    });
  });

  spans.slice(0, 10).forEach((span) => {
    const explicitStep = isRecord(span.data) && isRecord(span.data.executionTraceStep)
      ? span.data.executionTraceStep
      : null;
    if (explicitStep) {
      steps.push({
        step_id: `step_span_${String(span._id)}`,
        stage: (normalizeString(explicitStep.stage) as WorkflowStep["stage"] | null) ?? inferStage(span.name, span.spanType),
        type: (normalizeString(explicitStep.type) as WorkflowStep["type"] | null) ?? inferStepType(inferStage(span.name, span.spanType)),
        title: normalizeString(explicitStep.title) ?? span.name,
        tool: normalizeString(explicitStep.tool) ?? span.spanType,
        action: normalizeString(explicitStep.action) ?? span.spanType,
        target: normalizeString(explicitStep.target) ?? span.name,
        result_summary:
          normalizeString(explicitStep.resultSummary) ??
          getSummaryFromMetadata(span.metadata) ??
          `${span.name} ${span.status === "completed" ? "completed" : span.status}.`,
        evidence_refs: extractStringList(explicitStep.evidenceRefs),
        artifacts_out: extractStringList(explicitStep.artifactsOut),
        verification: extractStringList(explicitStep.verification),
        confidence:
          typeof explicitStep.confidence === "number" ? explicitStep.confidence : span.status === "error" ? 0.51 : 0.79,
      });
      return;
    }

    const stage = inferStage(span.name, span.spanType);
    const metadataSummary = getSummaryFromMetadata(span.metadata) ?? getSummaryFromMetadata(span.data);
    steps.push({
      step_id: `step_span_${String(span._id)}`,
      stage,
      type:
        span.status === "error"
          ? "issue_detected"
          : stage === "verify"
            ? "verification_passed"
            : inferStepType(stage),
      title: span.name,
      tool:
        normalizeString((span.data as Record<string, unknown> | undefined)?.tool) ??
        normalizeString((span.data as Record<string, unknown> | undefined)?.model) ??
        span.spanType,
      action: span.spanType,
      target: normalizeString((span.data as Record<string, unknown> | undefined)?.query) ?? span.name,
      result_summary:
        metadataSummary ??
        span.error?.message ??
        `${span.name} ${span.status === "completed" ? "completed" : span.status}.`,
      evidence_refs: [],
      artifacts_out: extractStringLists(span.data, OUTPUT_METADATA_KEYS),
      verification: uniqueStrings([
        span.durationMs ? `Latency ${Math.round(span.durationMs)}ms.` : null,
        span.error?.message ?? null,
      ]),
      confidence: span.status === "error" ? 0.51 : 0.79,
    });
  });

  return steps;
}

function buildDecisionRecords(session: LiveTaskSession, traces: LiveTaskTrace[]): DecisionRecord[] {
  const decisions: DecisionRecord[] = [];

  const explicitDecisions = [
    ...extractExplicitMetadataList(session.metadata, ["executionTraceDecisions", "decisions"]),
    ...traces.flatMap((trace) => extractExplicitMetadataList(trace.metadata, ["executionTraceDecisions", "decisions"])),
  ];

  explicitDecisions.forEach((item, index) => {
    const statement = normalizeString(item.statement);
    if (!statement) return;
    decisions.push({
      decision_id: `decision_explicit_${index + 1}`,
      decision_type: normalizeString(item.decisionType) ?? "trace_decision",
      statement,
      basis: extractStringList(item.basis),
      evidence_refs: extractStringList(item.evidenceRefs),
      alternatives_considered: extractStringList(item.alternativesConsidered),
    });
  });

  if (decisions.length > 0) {
    return decisions;
  }

  if (session.goalId || session.successCriteria?.length || session.crossCheckStatus) {
    decisions.push({
      decision_id: `decision_session_${String(session._id)}`,
      decision_type: "goal_alignment",
      statement:
        session.crossCheckStatus === "violated"
          ? `${session.title} drifted from the original goal and needs intervention.`
          : session.crossCheckStatus === "drifting"
            ? `${session.title} is drifting from the original goal and should be reviewed.`
            : `${session.title} is being evaluated against an explicit goal and success criteria.`,
      basis: uniqueStrings([
        ...(session.successCriteria ?? []),
        session.visionSnapshot ?? null,
        session.deltaFromVision ?? null,
      ]).slice(0, 5),
      evidence_refs: [],
      alternatives_considered: [],
    });
  }

  traces.forEach((trace) => {
    const metadata = isRecord(trace.metadata) ? trace.metadata : null;
    const explicitDecisions = metadata && Array.isArray(metadata.decisions) ? metadata.decisions : null;
    if (explicitDecisions) {
      explicitDecisions.forEach((item, index) => {
        if (!isRecord(item)) return;
        const statement = normalizeString(item.statement);
        if (!statement) return;
        decisions.push({
          decision_id: `decision_trace_${String(trace._id)}_${index + 1}`,
          decision_type: normalizeString(item.decisionType) ?? "trace_decision",
          statement,
          basis: extractStringList(item.basis),
          evidence_refs: [],
          alternatives_considered: extractStringList(item.alternativesConsidered),
        });
      });
    } else if (trace.deltaFromVision || trace.crossCheckStatus) {
      decisions.push({
        decision_id: `decision_trace_${String(trace._id)}`,
        decision_type: "trace_cross_check",
        statement:
          trace.crossCheckStatus === "violated"
            ? `${trace.workflowName} violated the current vision checkpoint.`
            : trace.crossCheckStatus === "drifting"
              ? `${trace.workflowName} introduced measurable drift from the vision checkpoint.`
              : `${trace.workflowName} stayed aligned to the current checkpoint.`,
        basis: uniqueStrings([
          trace.deltaFromVision ?? null,
          ...(trace.successCriteria ?? []),
        ]).slice(0, 4),
        evidence_refs: [],
        alternatives_considered: [],
      });
    }
  });

  return decisions;
}

function buildDiffRecords(session: LiveTaskSession, traces: LiveTaskTrace[]): DiffRecord[] {
  const records: DiffRecord[] = [];

  const maybeDiffs = [session.metadata, ...traces.map((trace) => trace.metadata)]
    .flatMap((metadata) => {
      if (!isRecord(metadata)) return [];
      return DIFF_METADATA_KEYS.flatMap((key) => (Array.isArray(metadata[key]) ? metadata[key] : []));
    });

  maybeDiffs.forEach((item, index) => {
    if (!isRecord(item)) return;
    const target = normalizeString(item.target) ?? normalizeString(item.path) ?? `artifact_${index + 1}`;
    const summary = normalizeString(item.summary) ?? normalizeString(item.description);
    if (!target || !summary) return;
    const cellChangesRaw = Array.isArray(item.cellChanges) ? item.cellChanges : [];
    records.push({
      diff_id: `diff_live_${index + 1}`,
      target,
      summary,
      cell_changes: cellChangesRaw
        .filter(isRecord)
        .map((change) => ({
          cell: normalizeString(change.cell) ?? "unknown",
          before: normalizeString(change.before),
          after: normalizeString(change.after),
        })),
      structural_changes: extractStringList(item.structuralChanges),
    });
  });

  if (records.length === 0 && session.toolsUsed?.length) {
    records.push({
      diff_id: `diff_session_${String(session._id)}`,
      target: session.title,
      summary: "This live run changed state through saved tool executions rather than a file diff artifact.",
      cell_changes: [],
      structural_changes: session.toolsUsed.map((tool) => `Tool invoked: ${tool}`),
    });
  }

  return records;
}

function buildVerificationChecks(
  session: LiveTaskSession,
  traces: LiveTaskTrace[],
  spans: LiveTaskSpan[],
): VerificationRecord[] {
  const checks: VerificationRecord[] = [
    {
      check_id: `verify_session_${String(session._id)}`,
      label: "Saved session integrity",
      status:
        session.status === "failed"
          ? "failed"
          : session.status === "running" || session.status === "pending"
            ? "warning"
            : "passed",
      details:
        session.errorMessage?.trim() ||
        `Loaded the saved task session "${session.title}" and reconstructed its execution summary.`,
      related_artifact_ids: [],
    },
  ];

  const explicitChecks = [
    ...extractExplicitMetadataList(session.metadata, ["executionTraceVerificationChecks", "verificationChecks"]),
    ...traces.flatMap((trace) =>
      extractExplicitMetadataList(trace.metadata, ["executionTraceVerificationChecks", "verificationChecks"]),
    ),
  ];

  explicitChecks.forEach((item, index) => {
    const label = normalizeString(item.label);
    const status = normalizeString(item.status) as VerificationRecord["status"] | null;
    const details = normalizeString(item.details);
    if (!label || !status || !details) return;
    checks.push({
      check_id: `verify_explicit_${index + 1}`,
      label,
      status,
      details,
      related_artifact_ids: extractStringList(item.relatedArtifactIds),
    });
  });

  traces.forEach((trace) => {
    checks.push({
      check_id: `verify_trace_${String(trace._id)}`,
      label: trace.workflowName,
      status:
        trace.status === "error"
          ? "failed"
          : trace.crossCheckStatus === "violated"
            ? "failed"
            : trace.crossCheckStatus === "drifting"
              ? "warning"
              : "passed",
      details:
        trace.deltaFromVision ??
        getSummaryFromMetadata(trace.metadata) ??
        `${trace.workflowName} finished with status ${trace.status}.`,
      related_artifact_ids: extractStringLists(trace.metadata, OUTPUT_METADATA_KEYS),
    });
  });

  spans
    .filter((span) => span.spanType === "guardrail" || span.status === "error")
    .slice(0, 8)
    .forEach((span) => {
      const explicitVerification =
        isRecord(span.data) && isRecord(span.data.executionTraceVerification)
          ? span.data.executionTraceVerification
          : null;
      const explicitArtifactIds = extractStringList(explicitVerification?.relatedArtifactIds);
      checks.push({
        check_id: `verify_span_${String(span._id)}`,
        label: normalizeString(explicitVerification?.label) ?? span.name,
        status:
          (normalizeString(explicitVerification?.status) as VerificationRecord["status"] | null) ??
          (span.status === "error" ? "failed" : "passed"),
        details:
          normalizeString(explicitVerification?.details) ??
          span.error?.message ??
          getSummaryFromMetadata(span.metadata) ??
          `${span.name} ${span.status}.`,
        related_artifact_ids:
          explicitArtifactIds.length > 0
            ? explicitArtifactIds
            : extractStringLists(span.data, OUTPUT_METADATA_KEYS),
      });
    });

  return checks;
}

function buildOutputArtifacts(session: LiveTaskSession, traces: LiveTaskTrace[]): OutputRecord[] {
  const outputs: OutputRecord[] = [];
  const seen = new Set<string>();

  [session.metadata, ...traces.map((trace) => trace.metadata)].forEach((metadata) => {
    if (!isRecord(metadata)) return;
    OUTPUT_METADATA_KEYS.forEach((key) => {
      const items = metadata[key];
      if (!Array.isArray(items)) return;
      items.forEach((item, index) => {
        if (typeof item === "string") {
          if (seen.has(item)) return;
          seen.add(item);
          outputs.push({
            output_id: `output_${outputs.length + 1}`,
            label: item.split(/[\\/]/).pop() ?? item,
            kind: item.endsWith(".json")
              ? "json"
              : item.endsWith(".xlsx")
                ? "xlsx"
                : item.endsWith(".png")
                  ? "png"
                  : "other",
            path: item,
            summary: `Exported artifact recorded on the live saved run (${key}).`,
          });
          return;
        }
        if (!isRecord(item)) return;
        const path = normalizeString(item.path) ?? normalizeString(item.uri);
        if (!path || seen.has(path)) return;
        seen.add(path);
        const kind = normalizeString(item.kind);
        outputs.push({
          output_id: `output_${outputs.length + 1}`,
          label: normalizeString(item.label) ?? path.split(/[\\/]/).pop() ?? `Artifact ${index + 1}`,
          kind:
            kind === "xlsx" || kind === "png" || kind === "json" || kind === "memo"
              ? (kind as OutputRecord["kind"])
              : "other",
          path,
          summary:
            normalizeString(item.summary) ??
            `Exported artifact recorded on the live saved run (${key}).`,
        });
      });
    });
  });

  return outputs;
}

function buildLimitations(session: LiveTaskSession, traces: LiveTaskTrace[], spans: LiveTaskSpan[]): string[] {
  return uniqueStrings([
    "This live execution trace is reconstructed from saved task sessions, traces, actions, and Oracle cross-check metadata rather than raw chain-of-thought.",
    traces.length === 0 ? "No saved traces were attached to this session, so the reconstruction is based on session-level metadata only." : null,
    spans.length === 0 ? "No saved actions were available for the primary trace, so the fine-grained tool timeline is partial." : null,
    session.crossCheckStatus === "violated" || traces.some((trace) => trace.crossCheckStatus === "violated")
      ? "At least one checkpoint on this run was marked as violated and should be reviewed before treating the workflow as fully trustworthy."
      : null,
    session.errorMessage ?? null,
  ]);
}

export function buildExecutionTraceFromLiveRun({
  session,
  traces,
  spans = [],
}: {
  session: LiveTaskSession;
  traces: LiveTaskTrace[];
  spans?: LiveTaskSpan[];
}): ExecutionTrace {
  const uploadedFiles = uniqueStrings([
    ...extractStringLists(session.metadata, FILE_METADATA_KEYS),
    ...traces.flatMap((trace) => extractStringLists(trace.metadata, FILE_METADATA_KEYS)),
  ]);
  const instructions = uniqueStrings([
    session.description ?? null,
    ...(session.successCriteria ?? []),
    ...extractStringLists(session.metadata, INSTRUCTION_METADATA_KEYS),
    ...traces.flatMap((trace) => extractStringLists(trace.metadata, INSTRUCTION_METADATA_KEYS)),
  ]);
  const { evidence, evidenceIdByKey } = buildEvidenceCatalog(session, traces, uploadedFiles);

  return ExecutionTraceSchema.parse({
    meta: {
      analysis_id: `execution_trace_live_${String(session._id)}`,
      workflow_template: "research_edit_verify_export",
      generated_at: new Date().toISOString(),
      status: normalizeRunStatus(session.status),
      confidence_level: confidenceLevelForRun(normalizeRunStatus(session.status), traces, evidence.length),
    },
    run: {
      run_id: String(session._id),
      workflow_type: session.type,
      user_goal: session.description?.trim() || session.title,
      status: normalizeRunStatus(session.status),
      started_at: toIso(session.startedAt),
      completed_at: toIso(session.completedAt ?? session.startedAt),
    },
    inputs: {
      uploaded_files: uploadedFiles,
      instructions,
    },
    steps: buildWorkflowSteps(session, traces, spans, evidenceIdByKey),
    evidence_catalog: evidence,
    decisions: buildDecisionRecords(session, traces),
    diffs: buildDiffRecords(session, traces),
    verification_checks: buildVerificationChecks(session, traces, spans),
    limitations: buildLimitations(session, traces, spans),
    outputs: buildOutputArtifacts(session, traces),
  });
}
