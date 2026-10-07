import type { Doc } from "../../../_generated/dataModel";

type OracleSourceRef = NonNullable<Doc<"agentTaskSessions">["sourceRefs"]>[number];

type DecisionRecord = {
  decisionType?: string;
  statement?: string;
  basis?: string[];
  evidenceRefs?: string[];
  alternativesConsidered?: string[];
  confidence?: number;
  limitations?: string[];
  recordedAt?: number;
};

type VerificationRecord = {
  label?: string;
  status?: "passed" | "warning" | "failed" | "fixed";
  details?: string;
  relatedArtifactIds?: string[];
  recordedAt?: number;
};

type EvidenceRecord = {
  title?: string;
  summary?: string;
  sourceRefs?: OracleSourceRef[];
  supportedClaims?: string[];
  unsupportedClaims?: string[];
  recordedAt?: number;
};

type ApprovalRecord = {
  approvalId?: string;
  toolName?: string;
  riskLevel?: "low" | "medium" | "high";
  justification?: string;
  status?: string;
  recordedAt?: number;
};

export type TaskSessionProofVerdict =
  | "verified"
  | "provisionally_verified"
  | "needs_review"
  | "awaiting_approval"
  | "failed"
  | "in_progress";

export type TaskSessionProofPack = {
  verdict: TaskSessionProofVerdict;
  verdictLabel: string;
  summary: string;
  evidenceCount: number;
  citationCount: number;
  sourceRefCount: number;
  decisionCount: number;
  progressiveDisclosureUsed: boolean;
  progressiveDisclosureTools: string[];
  verificationCounts: {
    total: number;
    passed: number;
    warning: number;
    failed: number;
    fixed: number;
  };
  approvalCounts: {
    total: number;
    pending: number;
  };
  keyFindings: string[];
  openIssues: string[];
  nextActions: string[];
  topSourceRefs: OracleSourceRef[];
  traceHighlights: Array<{
    traceId: string;
    workflowName: string;
    status: string;
    summary?: string;
  }>;
};

const PROGRESSIVE_DISCLOSURE_TOOLS = [
  "discover_tools",
  "smart_select_tools",
  "get_tool_quick_ref",
  "get_workflow_chain",
  "findTools",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const next = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      next.add(value.trim());
    }
  }
  return Array.from(next);
}

function sourceRefKey(ref: OracleSourceRef): string {
  return `${ref.href ?? ""}::${ref.label ?? ""}::${ref.kind ?? ""}`;
}

function uniqueSourceRefs(refs: OracleSourceRef[]): OracleSourceRef[] {
  const seen = new Set<string>();
  const result: OracleSourceRef[] = [];
  for (const ref of refs) {
    const key = sourceRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

function getTraceSummary(trace: Doc<"agentTaskTraces">): string | undefined {
  const metadata = asRecord(trace.metadata);
  const summary = metadata?.summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : undefined;
}

function getMetadataList<T>(trace: Doc<"agentTaskTraces">, key: string): T[] {
  const metadata = asRecord(trace.metadata);
  return asArray<T>(metadata?.[key]);
}

function getVerdictLabel(verdict: TaskSessionProofVerdict): string {
  switch (verdict) {
    case "verified":
      return "Verified";
    case "provisionally_verified":
      return "Provisionally verified";
    case "needs_review":
      return "Needs review";
    case "awaiting_approval":
      return "Awaiting approval";
    case "failed":
      return "Failed";
    default:
      return "In progress";
  }
}

export function buildTaskSessionProofPack(
  session: Doc<"agentTaskSessions">,
  traces: Doc<"agentTaskTraces">[],
): TaskSessionProofPack {
  const decisions = traces.flatMap((trace) =>
    getMetadataList<DecisionRecord>(trace, "executionTraceDecisions"),
  );
  const verifications = traces.flatMap((trace) =>
    getMetadataList<VerificationRecord>(trace, "executionTraceVerificationChecks"),
  );
  const evidenceCatalog = traces.flatMap((trace) =>
    getMetadataList<EvidenceRecord>(trace, "executionTraceEvidence"),
  );
  const approvals = traces.flatMap((trace) =>
    getMetadataList<ApprovalRecord>(trace, "executionTraceApprovals"),
  );

  const sessionSourceRefs = session.sourceRefs ?? [];
  const evidenceSourceRefs = evidenceCatalog.flatMap((item) => item.sourceRefs ?? []);
  const traceSourceRefs = traces.flatMap((trace) => trace.sourceRefs ?? []);
  const topSourceRefs = uniqueSourceRefs([
    ...sessionSourceRefs,
    ...traceSourceRefs,
    ...evidenceSourceRefs,
  ]);

  const verificationCounts = {
    total: verifications.length,
    passed: verifications.filter((item) => item.status === "passed").length,
    warning: verifications.filter((item) => item.status === "warning").length,
    failed: verifications.filter((item) => item.status === "failed").length,
    fixed: verifications.filter((item) => item.status === "fixed").length,
  };

  const approvalCounts = {
    total: approvals.length,
    pending: approvals.filter((item) => item.status === "pending").length,
  };

  const unsupportedClaims = uniqueStrings(
    evidenceCatalog.flatMap((item) => item.unsupportedClaims ?? []),
  );
  const supportedClaims = uniqueStrings(
    evidenceCatalog.flatMap((item) => item.supportedClaims ?? []),
  );

  const progressiveDisclosureTools = (session.toolsUsed ?? []).filter((tool) =>
    PROGRESSIVE_DISCLOSURE_TOOLS.includes(tool),
  );
  const progressiveDisclosureUsed = progressiveDisclosureTools.length > 0;

  const openIssues = uniqueStrings([
    ...(session.crossCheckStatus === "violated"
      ? ["Oracle cross-check violated the original goal or constraints."]
      : []),
    ...(session.crossCheckStatus === "drifting"
      ? ["Oracle cross-check detected drift from the original goal."]
      : []),
    ...verifications
      .filter((item) => item.status === "failed" || item.status === "warning")
      .map((item) => item.details ?? item.label),
    ...unsupportedClaims.map((claim) => `Unsupported claim: ${claim}`),
    ...(approvalCounts.pending > 0
      ? [`${approvalCounts.pending} approval${approvalCounts.pending === 1 ? "" : "s"} still pending.`]
      : []),
    ...(session.errorMessage ? [session.errorMessage] : []),
  ]).slice(0, 6);

  const keyFindings = uniqueStrings([
    ...decisions.map((item) => item.statement),
    ...supportedClaims,
    ...evidenceCatalog.map((item) => item.summary),
  ]).slice(0, 6);

  let verdict: TaskSessionProofVerdict;
  if (session.status === "pending" || session.status === "running") {
    verdict = "in_progress";
  } else if (approvalCounts.pending > 0) {
    verdict = "awaiting_approval";
  } else if (session.status === "failed") {
    verdict = "failed";
  } else if (verificationCounts.failed > 0 || session.crossCheckStatus === "violated") {
    verdict = "failed";
  } else if (
    verificationCounts.warning > 0 ||
    session.crossCheckStatus === "drifting" ||
    unsupportedClaims.length > 0 ||
    topSourceRefs.length === 0
  ) {
    verdict = "needs_review";
  } else if (session.status === "completed" && verificationCounts.total > 0 && topSourceRefs.length > 0) {
    verdict = "verified";
  } else if (session.status === "completed" && topSourceRefs.length > 0) {
    verdict = "provisionally_verified";
  } else {
    verdict = "in_progress";
  }

  const nextActions = uniqueStrings([
    !progressiveDisclosureUsed
      ? "Resolve tool selection with discover_tools or get_workflow_chain before the next run."
      : undefined,
    topSourceRefs.length === 0
      ? "Attach open-source source references before treating this run as verified."
      : undefined,
    verificationCounts.total === 0
      ? "Run at least one explicit verification check before finalizing the result."
      : undefined,
    verificationCounts.failed > 0 || verificationCounts.warning > 0
      ? "Address failing or warning verification checks, then rerun verification."
      : undefined,
    unsupportedClaims.length > 0
      ? "Either support or remove unsupported claims before drafting a final response."
      : undefined,
    approvalCounts.pending > 0
      ? "Resolve pending approvals before executing externally visible or risky actions."
      : undefined,
    verdict === "verified" || verdict === "provisionally_verified"
      ? "Draft the final memo or response with citations and link back to this trace."
      : undefined,
  ]).slice(0, 5);

  const summary =
    verdict === "verified"
      ? `Completed with ${topSourceRefs.length} cited source${topSourceRefs.length === 1 ? "" : "s"}, ${verificationCounts.total} verification check${verificationCounts.total === 1 ? "" : "s"}, and trace-backed evidence.`
      : verdict === "provisionally_verified"
        ? `Completed with citations, but the run still needs stronger verification before it should be treated as final.`
        : verdict === "needs_review"
          ? `The run produced useful output, but evidence, verification, or cross-check drift still needs review.`
          : verdict === "awaiting_approval"
            ? `The run gathered evidence and trace history, but it is blocked on approval before the next action.`
            : verdict === "failed"
              ? `The run is not safe to treat as final because verification failed, the cross-check was violated, or the session itself failed.`
              : `The run is still active. Use the trace and evidence catalog to determine the next action.`;

  return {
    verdict,
    verdictLabel: getVerdictLabel(verdict),
    summary,
    evidenceCount: evidenceCatalog.length,
    citationCount: topSourceRefs.length,
    sourceRefCount: topSourceRefs.length,
    decisionCount: decisions.length,
    progressiveDisclosureUsed,
    progressiveDisclosureTools,
    verificationCounts,
    approvalCounts,
    keyFindings,
    openIssues,
    nextActions,
    topSourceRefs: topSourceRefs.slice(0, 8),
    traceHighlights: traces.map((trace) => ({
      traceId: trace.traceId,
      workflowName: trace.workflowName,
      status: trace.status,
      summary: getTraceSummary(trace),
    })),
  };
}
