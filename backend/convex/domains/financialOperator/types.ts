/**
 * Financial Operator Console — typed step payloads.
 *
 * Each step's `payload` field is stored as v.any() in Convex but its
 * shape per `kind` is enforced by these TS types. The frontend renders
 * one card per kind by switching on `step.kind`.
 *
 * Pattern: scratchpad-first + orchestrator-workers (per .claude/rules)
 *   - Each step is one observable unit of work
 *   - Each step lists its sources / inputs / outputs
 *   - Math runs in a deterministic JS sandbox (NOT in the LLM)
 *
 * Trust boundary: extractors return values + confidence + sourceRef.
 * The chat surface MUST display the source for every value.
 */

export type StepKind =
  | "run_brief"
  | "tool_call"
  | "extraction"
  | "validation"
  | "calculation"
  | "evidence"
  | "artifact"
  | "approval_request"
  | "result";

export type StepStatus =
  | "pending"
  | "running"
  | "complete"
  | "error"
  | "needs_review"
  | "approved"
  | "rejected";

export type RunStatus =
  | "created"
  | "planning"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "rejected"
  | "error";

export type TaskType =
  | "financial_metric_extraction"
  | "financial_data_cleanup"
  | "covenant_compliance"
  | "variance_analysis"
  | "custom";

/** Initial plan card. Lists numbered steps and offers run/cancel buttons. */
export interface RunBriefPayload {
  goal: string;
  numberedSteps: string[]; // 4-6 short steps, plain language
  estimatedDurationMs?: number;
  outputFormat: string;     // e.g. "Notebook + CSV + PR"
}

/** Generic tool invocation. Shows input/output summaries, not raw blobs. */
export interface ToolCallPayload {
  toolName: string;          // e.g. "document.locate_sections"
  inputSummary: string;      // human-readable input
  outputSummary?: string;    // human-readable output
  rawArgs?: unknown;         // optional drill-down (kept small; bounded)
  rawResult?: unknown;       // optional drill-down (kept small; bounded)
}

/** Single extracted field with provenance + confidence. */
export interface ExtractedField {
  fieldName: string;         // "Income before taxes"
  value: number | string | null;
  unit?: string;             // "USD millions", "decimal", "percent"
  sourceRef: string;         // "10-K p.72" or "Balance Sheet!B21"
  confidence: number;        // 0..1
  status: "verified" | "needs_review" | "unresolved";
  reviewNote?: string;
}

export interface ExtractionPayload {
  schemaName: string;        // "tax_and_debt_inputs"
  fields: ExtractedField[];
  totalFound: number;
  needsReviewCount: number;
}

export interface ValidationFinding {
  level: "info" | "warning" | "error";
  message: string;
  fieldRef?: string;
}

export interface ValidationPayload {
  schemaPassed: boolean;
  unitsNormalized: boolean;
  findings: ValidationFinding[];
  // Bounded (HONEST_SCORES): only count what was actually checked.
  checksRun: number;
  checksPassed: number;
}

/**
 * Calculation card payload.
 * IMPORTANT: this represents work done in a deterministic JS sandbox,
 * NOT LLM math. The frontend MUST render a "Math executed in sandbox,
 * not by the language model." disclosure on this card.
 */
export interface CalculationPayload {
  formulaLabel: string;       // "Effective tax rate"
  formulaText: string;        // "income_tax_expense / income_before_taxes"
  inputs: Record<string, number | string>;
  outputs: Record<string, number | string>;
  sandboxKind: "js_pure";     // future: "python" | "wasm" | "convex_action"
  computedAt: number;         // epoch ms
  formattedOutputs?: Record<string, string>; // for display: "16.86%"
}

export interface EvidenceAnchor {
  label: string;
  sourceRef: string;       // "10-K p.72"
  excerpt?: string;        // short quoted snippet
  url?: string;
}

export interface EvidencePayload {
  anchors: EvidenceAnchor[];
  totalSources: number;
}

export type ArtifactKind = "notebook" | "csv" | "pr_draft" | "memo" | "report";

export interface ArtifactPayload {
  kind: ArtifactKind;
  label: string;
  description?: string;
  artifactRef?: string;     // foreign key (documentId, fileId, etc)
  url?: string;
  diffSummary?: string[];   // for PR drafts: list of changes
}

export interface ApprovalRequestPayload {
  question: string;
  context?: string;
  options: Array<{
    id: "approve" | "reject" | "override" | "rerun" | "narrow";
    label: string;
    description?: string;
  }>;
  // What the agent will do on each option (transparency).
  consequences?: Record<string, string>;
}

export interface ResultPayload {
  headline: string;          // 1-line bottom-line answer
  prose: string;             // 2-4 sentences of detail
  metrics?: Record<string, string>; // formatted final values
  openIssues?: string[];     // remaining caveats
  nextActions: Array<{
    id: string;
    label: string;
    kind: "open" | "approve" | "export" | "follow_up";
  }>;
}

export type StepPayload =
  | { kind: "run_brief"; data: RunBriefPayload }
  | { kind: "tool_call"; data: ToolCallPayload }
  | { kind: "extraction"; data: ExtractionPayload }
  | { kind: "validation"; data: ValidationPayload }
  | { kind: "calculation"; data: CalculationPayload }
  | { kind: "evidence"; data: EvidencePayload }
  | { kind: "artifact"; data: ArtifactPayload }
  | { kind: "approval_request"; data: ApprovalRequestPayload }
  | { kind: "result"; data: ResultPayload };
