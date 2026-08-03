export const NODEKIT_RFS_BENCHMARK_SCHEMA_VERSION = "nodekit.rfs-benchmark-run/v1" as const;
export const NODEKIT_RFS_RUNNER_CONTRACT_SCHEMA_VERSION = "nodekit.rfs-proofloop-runner/v1" as const;

export const NODEKIT_RFS_STAGE_NAMES = [
  "register",
  "research",
  "contract",
  "scaffold",
  "implement",
  "local_verify",
  "dogfood",
  "taste",
  "deploy",
  "production_verify",
  "seal",
] as const;

export type NodekitRfsStageName = (typeof NODEKIT_RFS_STAGE_NAMES)[number];
export type NodekitRfsRunStatus =
  | "registered"
  | "researched"
  | "contracted"
  | "scaffolded"
  | "implemented"
  | "locally_verified"
  | "dogfood_verified"
  | "taste_evaluated"
  | "deployed"
  | "production_verified"
  | "sealed"
  | "publication_approved"
  | "published"
  | "distribution_verified"
  | "engagement_observed"
  | "failed";

export type Availability<T> = {
  value: T | null;
  unavailableReason: string | null;
};

export type CandidateRevision = {
  repository: string;
  commitSha: string;
  worktreeDirty: boolean;
};

export type ArtifactEvidence = {
  kind: string;
  uri: string;
  sha256: string;
};

export type NodekitRfsBenchmarkStage = {
  name: NodekitRfsStageName;
  status: "queued" | "running" | "passed" | "failed";
  attempt: number;
  startedAt: Availability<string>;
  completedAt: Availability<string>;
  wallClockMs: Availability<number>;
  agentActiveMs: Availability<number>;
  waitMs: Availability<number>;
};

export type NodekitRfsModelUsage = {
  stage: NodekitRfsStageName;
  provider: string;
  requestedModel: string;
  resolvedModel: Availability<string>;
  generationId: Availability<string>;
  outcome: "completed" | "failed_before_provider" | "failed_after_provider";
  inputTokens: Availability<number>;
  outputTokens: Availability<number>;
  reasoningTokens: Availability<number>;
  cacheReadTokens: Availability<number>;
  cacheWriteTokens: Availability<number>;
  costUsd: Availability<number>;
  costKind: "provider_reported" | "estimated" | "unavailable";
};

export type NodekitRfsBenchmarkReceipt = {
  schemaVersion: typeof NODEKIT_RFS_BENCHMARK_SCHEMA_VERSION;
  runId: string;
  status: NodekitRfsRunStatus;
  request: {
    season: string;
    requestId: string;
    title: string;
    sourceUrl: string;
    retrievedAt: string;
    sourceSnapshotSha256: string;
    briefSha256: string;
  };
  oracle: {
    goalId: string;
    visionSnapshot: string;
    successCriteria: string[];
    sourceRefs: string[];
    crossCheckStatus: "pending" | "aligned" | "drifting" | "violated";
    deltaFromVision: string;
    dogfoodRunId: Availability<string>;
  };
  productContract: {
    targetUser: string;
    primaryJob: string;
    canonicalArtifact: string;
    nonGoals: string[];
    contractSha256: string;
    designIntentSha256: string;
  };
  environment: {
    nodebench: CandidateRevision;
    nodekit: CandidateRevision;
    nodeagent: CandidateRevision;
    nodeproof: CandidateRevision;
    runnerPlanSha256: string;
  };
  trace: {
    sessionId: Availability<string>;
    traceId: Availability<string>;
    publicTraceId: Availability<string>;
  };
  stages: NodekitRfsBenchmarkStage[];
  modelUsage: NodekitRfsModelUsage[];
  accounting: {
    fullTokenAccounting: boolean;
    totalModelCostUsd: Availability<number>;
    totalNonModelCostUsd: Availability<number>;
    totalCostUsd: Availability<number>;
    totalWallClockMs: Availability<number>;
    totalAgentActiveMs: Availability<number>;
    totalHumanAttentionMs: Availability<number>;
  };
  nonModelCosts: Array<{
    kind: "search" | "browser" | "ci" | "deployment" | "human_panel" | "other";
    amountUsd: Availability<number>;
    costKind: "metered" | "estimated" | "unavailable";
    source: Availability<string>;
    evidenceSha256: Availability<string>;
  }>;
  humanInterventions: Array<{
    kind: "approval" | "credential" | "review" | "manual_repair";
    startedAt: string;
    completedAt: Availability<string>;
    activeMs: Availability<number>;
    reason: string;
    decisionId: Availability<string>;
  }>;
  proofs: {
    source: Availability<ArtifactEvidence>;
    local: Availability<ArtifactEvidence>;
    dogfood: Availability<ArtifactEvidence>;
    taste: Availability<ArtifactEvidence>;
    deployment: Availability<ArtifactEvidence>;
    productionBrowser: Availability<ArtifactEvidence>;
  };
  result: {
    candidateCommit: Availability<string>;
    applicationSha256: Availability<string>;
    deploymentUrl: Availability<string>;
    deploymentRevision: Availability<string>;
    releaseReady: boolean;
    limitations: string[];
  };
  publication: {
    claimPacketSha256: Availability<string>;
    approvalId: Availability<string>;
    distributionReceiptSha256: Availability<string>;
  };
  integrity: {
    receiptSha256: Availability<string>;
    digestExcludes: ["integrity.receiptSha256.value"];
  };
};

export type NodekitRfsValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type NodekitRfsValidationResult<T> =
  | { ok: true; value: T; issues: [] }
  | { ok: false; issues: NodekitRfsValidationIssue[] };

export type ProofloopRunnerTaskPlanV1 = {
  id: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  estimatedCostUsd?: number;
  timeoutMs?: number;
};

export type ProofloopRunnerPlanV1 = {
  schema: "proofloop-runner-plan-v1";
  tasks: ProofloopRunnerTaskPlanV1[];
};

export const NODEKIT_RFS_TRACE_PROTOCOL = {
  start: "start_execution_run",
  step: "record_execution_step",
  decision: "record_execution_decision",
  verification: "record_execution_verification",
  evidence: "attach_execution_evidence",
  approval: "request_execution_approval",
  complete: "complete_execution_run",
} as const;

export type NodekitRfsRunnerContract = {
  schemaVersion: typeof NODEKIT_RFS_RUNNER_CONTRACT_SCHEMA_VERSION;
  runId: string;
  receiptPath: string;
  workingDirectory: string;
  receiptValidationCommand: string;
  budgetUsd: number;
  candidateRevisions: {
    nodebench: CandidateRevision;
    nodekit: CandidateRevision;
    nodeagent: CandidateRevision;
    nodeproof: CandidateRevision;
  };
  traceProtocol: typeof NODEKIT_RFS_TRACE_PROTOCOL;
  stages: Array<{
    name: NodekitRfsStageName;
    command: string;
    cwd?: string;
    estimatedCostUsd: number;
    timeoutMs: number;
  }>;
};

const RUN_STATUSES = new Set<NodekitRfsRunStatus>([
  "registered",
  "researched",
  "contracted",
  "scaffolded",
  "implemented",
  "locally_verified",
  "dogfood_verified",
  "taste_evaluated",
  "deployed",
  "production_verified",
  "sealed",
  "publication_approved",
  "published",
  "distribution_verified",
  "engagement_observed",
  "failed",
]);

const SEALED_OR_LATER = new Set<NodekitRfsRunStatus>([
  "sealed",
  "publication_approved",
  "published",
  "distribution_verified",
  "engagement_observed",
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const REQUEST_ID_PATTERN = /^(0[1-9]|1[0-6])$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(
  issues: NodekitRfsValidationIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: NodekitRfsValidationIssue[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issue(issues, `${path}.${key}`, "unknown_key", `${path} contains unknown key ${key}`);
    }
  }
}

function requireRecord(
  value: unknown,
  path: string,
  issues: NodekitRfsValidationIssue[],
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    issue(issues, path, "required_object", `${path} must be an object`);
    return null;
  }
  return value;
}

function requireString(
  value: unknown,
  path: string,
  issues: NodekitRfsValidationIssue[],
  pattern?: RegExp,
): value is string {
  if (typeof value !== "string" || !value.trim()) {
    issue(issues, path, "required_string", `${path} must be a non-empty string`);
    return false;
  }
  if (pattern && !pattern.test(value)) {
    issue(issues, path, "invalid_format", `${path} has an invalid format`);
    return false;
  }
  return true;
}

function requireIsoDate(value: unknown, path: string, issues: NodekitRfsValidationIssue[]): void {
  if (!requireString(value, path, issues)) return;
  if (!Number.isFinite(Date.parse(value))) {
    issue(issues, path, "invalid_iso_date", `${path} must be an ISO-8601 timestamp`);
  }
}

function requireStringArray(value: unknown, path: string, issues: NodekitRfsValidationIssue[], min = 0): void {
  if (!Array.isArray(value)) {
    issue(issues, path, "required_array", `${path} must be an array`);
    return;
  }
  if (value.length < min) {
    issue(issues, path, "array_too_short", `${path} must contain at least ${min} item(s)`);
  }
  value.forEach((entry, index) => requireString(entry, `${path}[${index}]`, issues));
}

function validateAvailability<T>(args: {
  value: unknown;
  path: string;
  issues: NodekitRfsValidationIssue[];
  validatePresent: (value: unknown, path: string, issues: NodekitRfsValidationIssue[]) => value is T;
}): args is { value: Availability<T>; path: string; issues: NodekitRfsValidationIssue[]; validatePresent: typeof args.validatePresent } {
  const record = requireRecord(args.value, args.path, args.issues);
  if (!record) return false;
  rejectUnknownKeys(record, ["value", "unavailableReason"], args.path, args.issues);
  const reason = record.unavailableReason;
  if (record.value === null) {
    if (typeof reason !== "string" || !reason.trim()) {
      issue(
        args.issues,
        `${args.path}.unavailableReason`,
        "missing_unavailable_reason",
        `${args.path}.unavailableReason is required when value is null`,
      );
      return false;
    }
    return true;
  }
  if (reason !== null) {
    issue(
      args.issues,
      `${args.path}.unavailableReason`,
      "unexpected_unavailable_reason",
      `${args.path}.unavailableReason must be null when value is present`,
    );
  }
  return args.validatePresent(record.value, `${args.path}.value`, args.issues);
}

function validateAvailableString(value: unknown, path: string, issues: NodekitRfsValidationIssue[]): value is string {
  return requireString(value, path, issues);
}

function validateAvailableSha(value: unknown, path: string, issues: NodekitRfsValidationIssue[]): value is string {
  return requireString(value, path, issues, SHA256_PATTERN);
}

function validateAvailableCommit(value: unknown, path: string, issues: NodekitRfsValidationIssue[]): value is string {
  return requireString(value, path, issues, COMMIT_SHA_PATTERN);
}

function validateAvailableNumber(value: unknown, path: string, issues: NodekitRfsValidationIssue[]): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    issue(issues, path, "invalid_nonnegative_number", `${path} must be a finite non-negative number`);
    return false;
  }
  return true;
}

function validateArtifactEvidence(value: unknown, path: string, issues: NodekitRfsValidationIssue[]): value is ArtifactEvidence {
  const record = requireRecord(value, path, issues);
  if (!record) return false;
  rejectUnknownKeys(record, ["kind", "uri", "sha256"], path, issues);
  const before = issues.length;
  requireString(record.kind, `${path}.kind`, issues);
  requireString(record.uri, `${path}.uri`, issues);
  requireString(record.sha256, `${path}.sha256`, issues, SHA256_PATTERN);
  return issues.length === before;
}

function validateCandidateRevision(
  value: unknown,
  path: string,
  issues: NodekitRfsValidationIssue[],
  requireClean: boolean,
): void {
  const record = requireRecord(value, path, issues);
  if (!record) return;
  rejectUnknownKeys(record, ["repository", "commitSha", "worktreeDirty"], path, issues);
  requireString(record.repository, `${path}.repository`, issues);
  requireString(record.commitSha, `${path}.commitSha`, issues, COMMIT_SHA_PATTERN);
  if (typeof record.worktreeDirty !== "boolean") {
    issue(issues, `${path}.worktreeDirty`, "required_boolean", `${path}.worktreeDirty must be boolean`);
  } else if (requireClean && record.worktreeDirty) {
    issue(issues, `${path}.worktreeDirty`, "dirty_candidate", `${path} must be clean before sealing`);
  }
}

function availabilityHasValue(value: unknown): boolean {
  return isRecord(value) && value.value !== null && value.value !== undefined;
}

function requireAvailable(value: unknown, path: string, issues: NodekitRfsValidationIssue[]): void {
  if (!availabilityHasValue(value)) {
    issue(issues, path, "required_for_seal", `${path} must be available before sealing`);
  }
}

export function validateNodekitRfsBenchmarkReceipt(
  input: unknown,
  options: { mode?: "checkpoint" | "seal"; checkpoint?: NodekitRfsStageName } = {},
): NodekitRfsValidationResult<NodekitRfsBenchmarkReceipt> {
  const issues: NodekitRfsValidationIssue[] = [];
  const root = requireRecord(input, "$", issues);
  if (!root) return { ok: false, issues };
  rejectUnknownKeys(root, [
    "schemaVersion",
    "runId",
    "status",
    "request",
    "oracle",
    "productContract",
    "environment",
    "trace",
    "stages",
    "modelUsage",
    "accounting",
    "nonModelCosts",
    "humanInterventions",
    "proofs",
    "result",
    "publication",
    "integrity",
  ], "$", issues);

  if (root.schemaVersion !== NODEKIT_RFS_BENCHMARK_SCHEMA_VERSION) {
    issue(issues, "$.schemaVersion", "wrong_schema_version", `schemaVersion must be ${NODEKIT_RFS_BENCHMARK_SCHEMA_VERSION}`);
  }
  requireString(root.runId, "$.runId", issues);
  if (typeof root.status !== "string" || !RUN_STATUSES.has(root.status as NodekitRfsRunStatus)) {
    issue(issues, "$.status", "invalid_status", "status is not a supported NodeKit RFS lifecycle status");
  }
  const shouldSeal = options.mode === "seal" || (typeof root.status === "string" && SEALED_OR_LATER.has(root.status as NodekitRfsRunStatus));

  const request = requireRecord(root.request, "$.request", issues);
  if (request) {
    rejectUnknownKeys(request, ["season", "requestId", "title", "sourceUrl", "retrievedAt", "sourceSnapshotSha256", "briefSha256"], "$.request", issues);
    requireString(request.season, "$.request.season", issues);
    requireString(request.requestId, "$.request.requestId", issues, REQUEST_ID_PATTERN);
    requireString(request.title, "$.request.title", issues);
    requireString(request.sourceUrl, "$.request.sourceUrl", issues);
    requireIsoDate(request.retrievedAt, "$.request.retrievedAt", issues);
    requireString(request.sourceSnapshotSha256, "$.request.sourceSnapshotSha256", issues, SHA256_PATTERN);
    requireString(request.briefSha256, "$.request.briefSha256", issues, SHA256_PATTERN);
  }

  const oracle = requireRecord(root.oracle, "$.oracle", issues);
  if (oracle) {
    rejectUnknownKeys(oracle, ["goalId", "visionSnapshot", "successCriteria", "sourceRefs", "crossCheckStatus", "deltaFromVision", "dogfoodRunId"], "$.oracle", issues);
    requireString(oracle.goalId, "$.oracle.goalId", issues);
    requireString(oracle.visionSnapshot, "$.oracle.visionSnapshot", issues);
    requireStringArray(oracle.successCriteria, "$.oracle.successCriteria", issues, 1);
    requireStringArray(oracle.sourceRefs, "$.oracle.sourceRefs", issues, 1);
    if (!new Set(["pending", "aligned", "drifting", "violated"]).has(String(oracle.crossCheckStatus))) {
      issue(issues, "$.oracle.crossCheckStatus", "invalid_cross_check", "crossCheckStatus is invalid");
    }
    if (oracle.crossCheckStatus === "drifting" || oracle.crossCheckStatus === "violated") {
      requireString(oracle.deltaFromVision, "$.oracle.deltaFromVision", issues);
    } else if (typeof oracle.deltaFromVision !== "string") {
      issue(issues, "$.oracle.deltaFromVision", "required_string", "deltaFromVision must be a string");
    }
    validateAvailability({ value: oracle.dogfoodRunId, path: "$.oracle.dogfoodRunId", issues, validatePresent: validateAvailableString });
    if (shouldSeal && oracle.crossCheckStatus === "violated") {
      issue(issues, "$.oracle.crossCheckStatus", "vision_violated", "a vision-violated run cannot be sealed");
    }
  }

  const product = requireRecord(root.productContract, "$.productContract", issues);
  if (product) {
    rejectUnknownKeys(product, ["targetUser", "primaryJob", "canonicalArtifact", "nonGoals", "contractSha256", "designIntentSha256"], "$.productContract", issues);
    requireString(product.targetUser, "$.productContract.targetUser", issues);
    requireString(product.primaryJob, "$.productContract.primaryJob", issues);
    requireString(product.canonicalArtifact, "$.productContract.canonicalArtifact", issues);
    requireStringArray(product.nonGoals, "$.productContract.nonGoals", issues, 1);
    requireString(product.contractSha256, "$.productContract.contractSha256", issues, SHA256_PATTERN);
    requireString(product.designIntentSha256, "$.productContract.designIntentSha256", issues, SHA256_PATTERN);
  }

  const environment = requireRecord(root.environment, "$.environment", issues);
  if (environment) {
    rejectUnknownKeys(environment, ["nodebench", "nodekit", "nodeagent", "nodeproof", "runnerPlanSha256"], "$.environment", issues);
    validateCandidateRevision(environment.nodebench, "$.environment.nodebench", issues, shouldSeal);
    validateCandidateRevision(environment.nodekit, "$.environment.nodekit", issues, shouldSeal);
    validateCandidateRevision(environment.nodeagent, "$.environment.nodeagent", issues, shouldSeal);
    validateCandidateRevision(environment.nodeproof, "$.environment.nodeproof", issues, shouldSeal);
    requireString(environment.runnerPlanSha256, "$.environment.runnerPlanSha256", issues, SHA256_PATTERN);
  }

  const trace = requireRecord(root.trace, "$.trace", issues);
  if (trace) {
    rejectUnknownKeys(trace, ["sessionId", "traceId", "publicTraceId"], "$.trace", issues);
    validateAvailability({ value: trace.sessionId, path: "$.trace.sessionId", issues, validatePresent: validateAvailableString });
    validateAvailability({ value: trace.traceId, path: "$.trace.traceId", issues, validatePresent: validateAvailableString });
    validateAvailability({ value: trace.publicTraceId, path: "$.trace.publicTraceId", issues, validatePresent: validateAvailableString });
    if (shouldSeal) {
      requireAvailable(trace.sessionId, "$.trace.sessionId", issues);
      requireAvailable(trace.traceId, "$.trace.traceId", issues);
      requireAvailable(trace.publicTraceId, "$.trace.publicTraceId", issues);
    }
  }

  const stageByName = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(root.stages)) {
    issue(issues, "$.stages", "required_array", "stages must be an array");
  } else {
    root.stages.forEach((entry, index) => {
      const path = `$.stages[${index}]`;
      const stage = requireRecord(entry, path, issues);
      if (!stage) return;
      rejectUnknownKeys(stage, ["name", "status", "attempt", "startedAt", "completedAt", "wallClockMs", "agentActiveMs", "waitMs"], path, issues);
      if (typeof stage.name !== "string" || !NODEKIT_RFS_STAGE_NAMES.includes(stage.name as NodekitRfsStageName)) {
        issue(issues, `${path}.name`, "invalid_stage", "stage name is invalid");
      } else if (stageByName.has(stage.name)) {
        issue(issues, `${path}.name`, "duplicate_stage", `duplicate stage ${stage.name}`);
      } else {
        stageByName.set(stage.name, stage);
      }
      if (!new Set(["queued", "running", "passed", "failed"]).has(String(stage.status))) {
        issue(issues, `${path}.status`, "invalid_stage_status", "stage status is invalid");
      }
      if (!Number.isInteger(stage.attempt) || Number(stage.attempt) < 1) {
        issue(issues, `${path}.attempt`, "invalid_attempt", "stage attempt must be a positive integer");
      }
      validateAvailability({ value: stage.startedAt, path: `${path}.startedAt`, issues, validatePresent: (value, valuePath, valueIssues): value is string => {
        requireIsoDate(value, valuePath, valueIssues);
        return typeof value === "string" && Number.isFinite(Date.parse(value));
      } });
      validateAvailability({ value: stage.completedAt, path: `${path}.completedAt`, issues, validatePresent: (value, valuePath, valueIssues): value is string => {
        requireIsoDate(value, valuePath, valueIssues);
        return typeof value === "string" && Number.isFinite(Date.parse(value));
      } });
      validateAvailability({ value: stage.wallClockMs, path: `${path}.wallClockMs`, issues, validatePresent: validateAvailableNumber });
      validateAvailability({ value: stage.agentActiveMs, path: `${path}.agentActiveMs`, issues, validatePresent: validateAvailableNumber });
      validateAvailability({ value: stage.waitMs, path: `${path}.waitMs`, issues, validatePresent: validateAvailableNumber });
    });
  }

  if (options.checkpoint) {
    const checkpoint = stageByName.get(options.checkpoint);
    if (!checkpoint || checkpoint.status !== "passed") {
      issue(issues, "$.stages", "checkpoint_not_passed", `checkpoint stage ${options.checkpoint} must be present and passed`);
    }
  }
  if (shouldSeal) {
    for (const stageName of NODEKIT_RFS_STAGE_NAMES) {
      const stage = stageByName.get(stageName);
      if (!stage || stage.status !== "passed") {
        issue(issues, "$.stages", "required_stage_not_passed", `stage ${stageName} must be present and passed before sealing`);
      }
    }
  }

  if (!Array.isArray(root.modelUsage)) {
    issue(issues, "$.modelUsage", "required_array", "modelUsage must be an array");
  } else {
    if (shouldSeal && root.modelUsage.length === 0) {
      issue(issues, "$.modelUsage", "model_usage_required", "at least one model usage row is required before sealing");
    }
    root.modelUsage.forEach((entry, index) => {
      const path = `$.modelUsage[${index}]`;
      const usage = requireRecord(entry, path, issues);
      if (!usage) return;
      rejectUnknownKeys(usage, [
        "stage",
        "provider",
        "requestedModel",
        "resolvedModel",
        "generationId",
        "outcome",
        "inputTokens",
        "outputTokens",
        "reasoningTokens",
        "cacheReadTokens",
        "cacheWriteTokens",
        "costUsd",
        "costKind",
      ], path, issues);
      if (typeof usage.stage !== "string" || !NODEKIT_RFS_STAGE_NAMES.includes(usage.stage as NodekitRfsStageName)) {
        issue(issues, `${path}.stage`, "invalid_stage", "model usage stage is invalid");
      }
      requireString(usage.provider, `${path}.provider`, issues);
      requireString(usage.requestedModel, `${path}.requestedModel`, issues);
      validateAvailability({ value: usage.resolvedModel, path: `${path}.resolvedModel`, issues, validatePresent: validateAvailableString });
      validateAvailability({ value: usage.generationId, path: `${path}.generationId`, issues, validatePresent: validateAvailableString });
      if (!new Set(["completed", "failed_before_provider", "failed_after_provider"]).has(String(usage.outcome))) {
        issue(issues, `${path}.outcome`, "invalid_model_outcome", "model usage outcome is invalid");
      }
      for (const key of ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens", "costUsd"] as const) {
        validateAvailability({ value: usage[key], path: `${path}.${key}`, issues, validatePresent: validateAvailableNumber });
      }
      if (!new Set(["provider_reported", "estimated", "unavailable"]).has(String(usage.costKind))) {
        issue(issues, `${path}.costKind`, "invalid_cost_kind", "costKind is invalid");
      }
      if ((usage.outcome === "completed" || usage.outcome === "failed_after_provider") && !availabilityHasValue(usage.resolvedModel)) {
        issue(issues, `${path}.resolvedModel`, "model_resolution_required", "resolvedModel is required after provider execution begins");
      }
      if (usage.costKind === "unavailable" && availabilityHasValue(usage.costUsd)) {
        issue(issues, `${path}.costUsd`, "inconsistent_cost_kind", "costUsd must be unavailable when costKind is unavailable");
      }
      if (usage.costKind !== "unavailable" && !availabilityHasValue(usage.costUsd)) {
        issue(issues, `${path}.costUsd`, "cost_required", "costUsd is required for provider_reported or estimated costKind");
      }
    });
  }

  const accounting = requireRecord(root.accounting, "$.accounting", issues);
  if (accounting) {
    rejectUnknownKeys(accounting, [
      "fullTokenAccounting",
      "totalModelCostUsd",
      "totalNonModelCostUsd",
      "totalCostUsd",
      "totalWallClockMs",
      "totalAgentActiveMs",
      "totalHumanAttentionMs",
    ], "$.accounting", issues);
    if (typeof accounting.fullTokenAccounting !== "boolean") {
      issue(issues, "$.accounting.fullTokenAccounting", "required_boolean", "fullTokenAccounting must be boolean");
    }
    for (const key of ["totalModelCostUsd", "totalNonModelCostUsd", "totalCostUsd", "totalWallClockMs", "totalAgentActiveMs", "totalHumanAttentionMs"] as const) {
      validateAvailability({ value: accounting[key], path: `$.accounting.${key}`, issues, validatePresent: validateAvailableNumber });
    }
    if (accounting.fullTokenAccounting === true && Array.isArray(root.modelUsage)) {
      root.modelUsage.forEach((entry, index) => {
        if (!isRecord(entry)) return;
        for (const key of ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens"] as const) {
          if (!availabilityHasValue(entry[key])) {
            issue(issues, `$.modelUsage[${index}].${key}`, "full_token_accounting_false_claim", `${key} must be available when fullTokenAccounting is true`);
          }
        }
      });
    }
  }

  if (!Array.isArray(root.nonModelCosts)) {
    issue(issues, "$.nonModelCosts", "required_array", "nonModelCosts must be an array");
  } else {
    root.nonModelCosts.forEach((entry, index) => {
      const path = `$.nonModelCosts[${index}]`;
      const cost = requireRecord(entry, path, issues);
      if (!cost) return;
      rejectUnknownKeys(cost, ["kind", "amountUsd", "costKind", "source", "evidenceSha256"], path, issues);
      if (!new Set(["search", "browser", "ci", "deployment", "human_panel", "other"]).has(String(cost.kind))) {
        issue(issues, `${path}.kind`, "invalid_non_model_cost_kind", "non-model cost kind is invalid");
      }
      validateAvailability({ value: cost.amountUsd, path: `${path}.amountUsd`, issues, validatePresent: validateAvailableNumber });
      if (!new Set(["metered", "estimated", "unavailable"]).has(String(cost.costKind))) {
        issue(issues, `${path}.costKind`, "invalid_cost_kind", "non-model costKind is invalid");
      }
      validateAvailability({ value: cost.source, path: `${path}.source`, issues, validatePresent: validateAvailableString });
      validateAvailability({ value: cost.evidenceSha256, path: `${path}.evidenceSha256`, issues, validatePresent: validateAvailableSha });
      if (cost.costKind === "unavailable" && availabilityHasValue(cost.amountUsd)) {
        issue(issues, `${path}.amountUsd`, "inconsistent_cost_kind", "amountUsd must be unavailable when costKind is unavailable");
      }
      if (cost.costKind !== "unavailable" && !availabilityHasValue(cost.amountUsd)) {
        issue(issues, `${path}.amountUsd`, "cost_required", "amountUsd is required for metered or estimated non-model costs");
      }
    });
  }

  if (!Array.isArray(root.humanInterventions)) {
    issue(issues, "$.humanInterventions", "required_array", "humanInterventions must be an array");
  } else {
    root.humanInterventions.forEach((entry, index) => {
      const path = `$.humanInterventions[${index}]`;
      const intervention = requireRecord(entry, path, issues);
      if (!intervention) return;
      rejectUnknownKeys(intervention, ["kind", "startedAt", "completedAt", "activeMs", "reason", "decisionId"], path, issues);
      if (!new Set(["approval", "credential", "review", "manual_repair"]).has(String(intervention.kind))) {
        issue(issues, `${path}.kind`, "invalid_intervention_kind", "human intervention kind is invalid");
      }
      requireIsoDate(intervention.startedAt, `${path}.startedAt`, issues);
      validateAvailability({ value: intervention.completedAt, path: `${path}.completedAt`, issues, validatePresent: (value, valuePath, valueIssues): value is string => {
        requireIsoDate(value, valuePath, valueIssues);
        return typeof value === "string" && Number.isFinite(Date.parse(value));
      } });
      validateAvailability({ value: intervention.activeMs, path: `${path}.activeMs`, issues, validatePresent: validateAvailableNumber });
      requireString(intervention.reason, `${path}.reason`, issues);
      validateAvailability({ value: intervention.decisionId, path: `${path}.decisionId`, issues, validatePresent: validateAvailableString });
    });
  }

  const proofs = requireRecord(root.proofs, "$.proofs", issues);
  if (proofs) {
    rejectUnknownKeys(proofs, ["source", "local", "dogfood", "taste", "deployment", "productionBrowser"], "$.proofs", issues);
    for (const key of ["source", "local", "dogfood", "taste", "deployment", "productionBrowser"] as const) {
      validateAvailability({ value: proofs[key], path: `$.proofs.${key}`, issues, validatePresent: validateArtifactEvidence });
      if (shouldSeal) requireAvailable(proofs[key], `$.proofs.${key}`, issues);
    }
  }

  const result = requireRecord(root.result, "$.result", issues);
  if (result) {
    rejectUnknownKeys(result, ["candidateCommit", "applicationSha256", "deploymentUrl", "deploymentRevision", "releaseReady", "limitations"], "$.result", issues);
    validateAvailability({ value: result.candidateCommit, path: "$.result.candidateCommit", issues, validatePresent: validateAvailableCommit });
    validateAvailability({ value: result.applicationSha256, path: "$.result.applicationSha256", issues, validatePresent: validateAvailableSha });
    validateAvailability({ value: result.deploymentUrl, path: "$.result.deploymentUrl", issues, validatePresent: validateAvailableString });
    validateAvailability({ value: result.deploymentRevision, path: "$.result.deploymentRevision", issues, validatePresent: validateAvailableCommit });
    if (typeof result.releaseReady !== "boolean") {
      issue(issues, "$.result.releaseReady", "required_boolean", "releaseReady must be boolean");
    }
    requireStringArray(result.limitations, "$.result.limitations", issues);
    if (shouldSeal) {
      for (const key of ["candidateCommit", "applicationSha256", "deploymentUrl", "deploymentRevision"] as const) {
        requireAvailable(result[key], `$.result.${key}`, issues);
      }
      if (result.releaseReady !== true) {
        issue(issues, "$.result.releaseReady", "release_not_ready", "releaseReady must be true before sealing");
      }
    }
  }

  const publication = requireRecord(root.publication, "$.publication", issues);
  if (publication) {
    rejectUnknownKeys(publication, ["claimPacketSha256", "approvalId", "distributionReceiptSha256"], "$.publication", issues);
    validateAvailability({ value: publication.claimPacketSha256, path: "$.publication.claimPacketSha256", issues, validatePresent: validateAvailableSha });
    validateAvailability({ value: publication.approvalId, path: "$.publication.approvalId", issues, validatePresent: validateAvailableString });
    validateAvailability({ value: publication.distributionReceiptSha256, path: "$.publication.distributionReceiptSha256", issues, validatePresent: validateAvailableSha });
    if (new Set(["publication_approved", "published", "distribution_verified", "engagement_observed"]).has(String(root.status))) {
      requireAvailable(publication.claimPacketSha256, "$.publication.claimPacketSha256", issues);
      requireAvailable(publication.approvalId, "$.publication.approvalId", issues);
    }
    if (new Set(["distribution_verified", "engagement_observed"]).has(String(root.status))) {
      requireAvailable(publication.distributionReceiptSha256, "$.publication.distributionReceiptSha256", issues);
    }
  }

  const integrity = requireRecord(root.integrity, "$.integrity", issues);
  if (integrity) {
    rejectUnknownKeys(integrity, ["receiptSha256", "digestExcludes"], "$.integrity", issues);
    validateAvailability({ value: integrity.receiptSha256, path: "$.integrity.receiptSha256", issues, validatePresent: validateAvailableSha });
    if (!Array.isArray(integrity.digestExcludes) || integrity.digestExcludes.length !== 1 || integrity.digestExcludes[0] !== "integrity.receiptSha256.value") {
      issue(issues, "$.integrity.digestExcludes", "invalid_digest_exclusion", "digestExcludes must contain only integrity.receiptSha256.value");
    }
    if (shouldSeal) requireAvailable(integrity.receiptSha256, "$.integrity.receiptSha256", issues);
  }

  return issues.length === 0
    ? { ok: true, value: input as NodekitRfsBenchmarkReceipt, issues: [] }
    : { ok: false, issues };
}

function sameTraceProtocol(value: unknown): value is typeof NODEKIT_RFS_TRACE_PROTOCOL {
  if (!isRecord(value)) return false;
  return (Object.keys(NODEKIT_RFS_TRACE_PROTOCOL) as Array<keyof typeof NODEKIT_RFS_TRACE_PROTOCOL>)
    .every((key) => value[key] === NODEKIT_RFS_TRACE_PROTOCOL[key]);
}

export function validateNodekitRfsRunnerContract(input: unknown): NodekitRfsValidationResult<NodekitRfsRunnerContract> {
  const issues: NodekitRfsValidationIssue[] = [];
  const root = requireRecord(input, "$", issues);
  if (!root) return { ok: false, issues };
  rejectUnknownKeys(root, [
    "schemaVersion",
    "runId",
    "receiptPath",
    "workingDirectory",
    "receiptValidationCommand",
    "budgetUsd",
    "candidateRevisions",
    "traceProtocol",
    "stages",
  ], "$", issues);
  if (root.schemaVersion !== NODEKIT_RFS_RUNNER_CONTRACT_SCHEMA_VERSION) {
    issue(issues, "$.schemaVersion", "wrong_schema_version", `schemaVersion must be ${NODEKIT_RFS_RUNNER_CONTRACT_SCHEMA_VERSION}`);
  }
  requireString(root.runId, "$.runId", issues);
  requireString(root.receiptPath, "$.receiptPath", issues);
  requireString(root.workingDirectory, "$.workingDirectory", issues);
  requireString(root.receiptValidationCommand, "$.receiptValidationCommand", issues);
  validateAvailableNumber(root.budgetUsd, "$.budgetUsd", issues);
  if (typeof root.budgetUsd === "number" && root.budgetUsd <= 0) {
    issue(issues, "$.budgetUsd", "invalid_budget", "budgetUsd must be greater than zero");
  }
  const revisions = requireRecord(root.candidateRevisions, "$.candidateRevisions", issues);
  if (revisions) {
    rejectUnknownKeys(revisions, ["nodebench", "nodekit", "nodeagent", "nodeproof"], "$.candidateRevisions", issues);
    for (const key of ["nodebench", "nodekit", "nodeagent", "nodeproof"] as const) {
      validateCandidateRevision(revisions[key], `$.candidateRevisions.${key}`, issues, true);
    }
  }
  if (!sameTraceProtocol(root.traceProtocol)) {
    issue(issues, "$.traceProtocol", "invalid_trace_protocol", "traceProtocol must use the canonical execution-trace primitive names");
  }
  const names = new Set<string>();
  let estimatedTotal = 0;
  if (!Array.isArray(root.stages)) {
    issue(issues, "$.stages", "required_array", "stages must be an array");
  } else {
    root.stages.forEach((entry, index) => {
      const path = `$.stages[${index}]`;
      const stage = requireRecord(entry, path, issues);
      if (!stage) return;
      rejectUnknownKeys(stage, ["name", "command", "cwd", "estimatedCostUsd", "timeoutMs"], path, issues);
      if (typeof stage.name !== "string" || !NODEKIT_RFS_STAGE_NAMES.includes(stage.name as NodekitRfsStageName)) {
        issue(issues, `${path}.name`, "invalid_stage", "stage name is invalid");
      } else if (names.has(stage.name)) {
        issue(issues, `${path}.name`, "duplicate_stage", `duplicate stage ${stage.name}`);
      } else {
        names.add(stage.name);
      }
      requireString(stage.command, `${path}.command`, issues);
      if (stage.cwd !== undefined) requireString(stage.cwd, `${path}.cwd`, issues);
      if (validateAvailableNumber(stage.estimatedCostUsd, `${path}.estimatedCostUsd`, issues)) estimatedTotal += stage.estimatedCostUsd;
      if (!Number.isInteger(stage.timeoutMs) || Number(stage.timeoutMs) <= 0) {
        issue(issues, `${path}.timeoutMs`, "invalid_timeout", "timeoutMs must be a positive integer");
      }
    });
  }
  for (const stageName of NODEKIT_RFS_STAGE_NAMES) {
    if (!names.has(stageName)) {
      issue(issues, "$.stages", "missing_runner_stage", `runner contract is missing stage ${stageName}`);
    }
  }
  if (typeof root.budgetUsd === "number" && estimatedTotal > root.budgetUsd) {
    issue(issues, "$.budgetUsd", "estimated_cost_exceeds_budget", `estimated stage cost ${estimatedTotal} exceeds budget ${root.budgetUsd}`);
  }
  return issues.length === 0
    ? { ok: true, value: input as NodekitRfsRunnerContract, issues: [] }
    : { ok: false, issues };
}

function quoteArg(value: string): string {
  return JSON.stringify(value);
}

export function buildNodekitRfsProofloopPlan(contractInput: unknown): ProofloopRunnerPlanV1 {
  const validation = validateNodekitRfsRunnerContract(contractInput);
  if (!validation.ok) {
    throw new Error(validation.issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n"));
  }
  const contract = validation.value;
  const tasks: ProofloopRunnerTaskPlanV1[] = [];
  for (const stage of contract.stages) {
    tasks.push({
      id: `rfs.${stage.name}`,
      command: stage.command,
      cwd: stage.cwd ?? contract.workingDirectory,
      estimatedCostUsd: stage.estimatedCostUsd,
      timeoutMs: stage.timeoutMs,
    });
    tasks.push({
      id: `rfs.${stage.name}.receipt-checkpoint`,
      command: `${contract.receiptValidationCommand} validate-receipt --file ${quoteArg(contract.receiptPath)} --checkpoint ${stage.name}${stage.name === "seal" ? " --mode seal" : ""}`,
      cwd: contract.workingDirectory,
      estimatedCostUsd: 0,
      timeoutMs: 60_000,
    });
  }
  return { schema: "proofloop-runner-plan-v1", tasks };
}

export function buildNodekitRfsTraceStartArgs(
  contract: NodekitRfsRunnerContract,
  receipt: NodekitRfsBenchmarkReceipt,
): Record<string, unknown> {
  return {
    title: `NodeKit RFS benchmark ${contract.runId}`,
    workflowName: "nodekit_rfs_benchmark",
    description: `${receipt.request.requestId}/16 ${receipt.request.title}: ${receipt.productContract.primaryJob}`,
    type: "agent",
    visibility: "private",
    goalId: receipt.oracle.goalId,
    visionSnapshot: receipt.oracle.visionSnapshot,
    successCriteria: receipt.oracle.successCriteria,
    sourceRefs: receipt.oracle.sourceRefs.map((href) => ({ label: href, href, kind: "benchmark_source" })),
    metadata: {
      runId: contract.runId,
      receiptSchemaVersion: NODEKIT_RFS_BENCHMARK_SCHEMA_VERSION,
      runnerContractSchemaVersion: contract.schemaVersion,
      receiptPath: contract.receiptPath,
      candidateRevisions: contract.candidateRevisions,
    },
  };
}

export function buildNodekitRfsTraceStepArgs(args: {
  traceId: string;
  stage: NodekitRfsStageName;
  title: string;
  action: string;
  target: string;
  resultSummary: string;
  startedAt?: number;
  endedAt?: number;
  evidenceRefs?: string[];
}): Record<string, unknown> {
  const traceStage = args.stage === "local_verify" || args.stage === "dogfood" || args.stage === "production_verify" || args.stage === "seal"
    ? "verify"
    : args.stage === "register" || args.stage === "contract" || args.stage === "scaffold" || args.stage === "implement" || args.stage === "deploy"
      ? "edit"
      : args.stage === "taste"
        ? "inspect"
        : args.stage;
  return {
    traceId: args.traceId,
    stage: traceStage,
    type: traceStage === "verify" ? "verification_passed" : "task_completed",
    title: args.title,
    tool: "proofloop.runner",
    action: args.action,
    target: args.target,
    resultSummary: args.resultSummary,
    evidenceRefs: args.evidenceRefs ?? [],
    startedAt: args.startedAt,
    endedAt: args.endedAt,
    metadata: {
      rfsStage: args.stage,
      receiptSchemaVersion: NODEKIT_RFS_BENCHMARK_SCHEMA_VERSION,
    },
  };
}

export function buildNodekitRfsTraceCompleteArgs(receipt: NodekitRfsBenchmarkReceipt): Record<string, unknown> {
  const inputTokens = receipt.modelUsage.every((entry) => entry.inputTokens.value !== null)
    ? receipt.modelUsage.reduce((total, entry) => total + (entry.inputTokens.value ?? 0), 0)
    : undefined;
  const outputTokens = receipt.modelUsage.every((entry) => entry.outputTokens.value !== null)
    ? receipt.modelUsage.reduce((total, entry) => total + (entry.outputTokens.value ?? 0), 0)
    : undefined;
  return {
    sessionId: receipt.trace.sessionId.value,
    traceId: receipt.trace.traceId.value,
    status: receipt.status === "failed" ? "failed" : "completed",
    crossCheckStatus: receipt.oracle.crossCheckStatus === "pending" ? undefined : receipt.oracle.crossCheckStatus,
    deltaFromVision: receipt.oracle.deltaFromVision,
    inputTokens,
    outputTokens,
    estimatedCostUsd: receipt.accounting.totalModelCostUsd.value ?? undefined,
    toolsUsed: Object.values(NODEKIT_RFS_TRACE_PROTOCOL),
  };
}
