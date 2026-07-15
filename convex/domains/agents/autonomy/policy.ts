export const AUTONOMY_OPERATION = "notebook.update_block" as const;
export const AUTONOMY_AGENT_ID = "nodebench.notebook_coordinator" as const;
export const AUTONOMY_AGENT_LABEL = "NodeBench Notebook Coordinator" as const;
export const AUTONOMY_RUNTIME = "nodebench" as const;

export const AUTONOMY_RESTRICTED_OPERATIONS = Object.freeze([
  "notebook.create_block",
  "notebook.delete_block",
  "notebook.move_block",
  "notebook.publish",
  "notebook.share",
  "notebook.export",
  "notebook.change_access",
  "external.sync",
  "network.egress",
  "filesystem.read",
  "filesystem.write",
] as const);

export const AUTONOMY_CAPABILITY_ENVELOPE = Object.freeze({
  networkEgress: "deny" as const,
  fileAccess: "deny" as const,
  spendLimitUsd: 0 as const,
});

export const AUTONOMY_LIMITS = Object.freeze({
  maxAgentIdLength: 128,
  maxLabelLength: 120,
  maxRuntimeLength: 80,
  maxRunIdLength: 160,
  maxOperationKeyLength: 240,
  maxReasonLength: 500,
  maxKeyLength: 200,
  maxBlockIds: 100,
  maxSourceRefIds: 100,
  maxSourceRefLength: 240,
  maxSourceRefBytes: 20_000,
  sourceReportLookback: 25,
  maxProjectionVersionLookback: 50,
  maxOperationAttempts: 10,
  maxRemainderDrafts: 24,
  maxRemainderTotalBytes: 200_000,
  maxOperations: 100,
  minGrantTtlMs: 60_000,
  maxRunGrantTtlMs: 2 * 60 * 60 * 1_000,
  maxWorkspaceGrantTtlMs: 24 * 60 * 60 * 1_000,
  maxBlockContentBytes: 50_000,
} as const);

export type AutonomyGrantMode = "run" | "workspace";
export type AutonomyGrantStatus =
  | "active"
  | "paused"
  | "revoked"
  | "expired"
  | "consumed";
export type AutonomyApprovalMode = "explicit" | "delegated";

export type AutonomyValidationCheck = {
  code: string;
  passed: boolean;
  detail?: string;
};

export type GrantPolicyRecord = {
  ownerKey: string;
  mode: AutonomyGrantMode;
  operation: string;
  entityId?: string;
  runId?: string;
  runBinding?: "not_applicable" | "first_operation" | "bound";
  blockIds?: readonly string[];
  agentId: string;
  capabilityEnvelope?: {
    networkEgress: string;
    fileAccess: string;
    spendLimitUsd: number;
  };
  maxOperations: number;
  usedOperations: number;
  expiresAt: number;
  status: AutonomyGrantStatus;
};

export type DelegatedOperationRequest = {
  ownerKey: string;
  operation: string;
  entityId: string;
  blockId: string;
  runId?: string;
  agentId: string;
  now: number;
};

export type GrantRequest = {
  mode: AutonomyGrantMode;
  entityId?: string;
  runId?: string;
  blockIds?: readonly string[];
  agentId: string;
  agentLabel?: string;
  runtime?: string;
  maxOperations: number;
  expiresAt: number;
  now: number;
};

export type AuthorityDecision = {
  allowed: boolean;
  status: AutonomyGrantStatus | "missing";
  reasonCode?: string;
  checks: AutonomyValidationCheck[];
};

export type CommitSnapshotRequest = {
  expectedRevision: number;
  currentRevision: number;
  expectedContentHash: string;
  currentContentHash: string;
  proposedContentHash: string;
  expectedSourceRefIdsHash: string;
  currentSourceRefIdsHash: string;
  proposedSourceRefIdsHash: string;
};

export type UndoEligibilityRequest = {
  receiptOwnerKey: string;
  requesterOwnerKey: string;
  receiptEvent: "commit" | "undo";
  canUndoAtCommit: boolean;
  receiptAfterRevision: number;
  currentRevision: number;
  receiptAfterContentHash: string;
  currentContentHash: string;
  receiptAfterSourceRefIdsHash: string;
  currentSourceRefIdsHash: string;
  alreadyUndone: boolean;
};

export class AutonomyPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "AutonomyPolicyError";
    this.code = code;
  }
}

function check(code: string, passed: boolean, detail?: string): AutonomyValidationCheck {
  return detail ? { code, passed, detail } : { code, passed };
}

function hasText(value: string | undefined, maxLength: number): boolean {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 && trimmed.length <= maxLength;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function effectiveGrantStatus(
  grant: Pick<GrantPolicyRecord, "status" | "expiresAt" | "maxOperations" | "usedOperations">,
  now: number,
): AutonomyGrantStatus {
  if (grant.status === "revoked" || grant.status === "expired" || grant.status === "consumed") {
    return grant.status;
  }
  if (grant.expiresAt <= now) return "expired";
  if (grant.usedOperations >= grant.maxOperations) return "consumed";
  return grant.status;
}

export function validateGrantRequest(request: GrantRequest): AutonomyValidationCheck[] {
  const maxTtl =
    request.mode === "run"
      ? AUTONOMY_LIMITS.maxRunGrantTtlMs
      : AUTONOMY_LIMITS.maxWorkspaceGrantTtlMs;
  const blockIds = request.blockIds ?? [];
  const uniqueBlockIds = new Set(blockIds);

  return [
    check("mode_supported", request.mode === "run" || request.mode === "workspace"),
    check(
      "entity_scope_valid",
      request.mode === "run"
        ? hasText(request.entityId, AUTONOMY_LIMITS.maxKeyLength)
        : request.entityId === undefined,
      request.mode === "run"
        ? "Run grants require a concrete product entity scope."
        : "Workspace grants are explicitly owner-wide and must omit entityId.",
    ),
    check(
      "run_scope_valid",
      request.mode === "run"
        ? hasText(request.runId, AUTONOMY_LIMITS.maxRunIdLength)
        : request.runId === undefined,
      request.mode === "run"
        ? "Run grants require the concrete current scratchpad runId."
        : "Workspace grants must not carry a runId.",
    ),
    check("agent_id_valid", hasText(request.agentId, AUTONOMY_LIMITS.maxAgentIdLength)),
    check(
      "agent_label_valid",
      request.agentLabel === undefined || request.agentLabel.length <= AUTONOMY_LIMITS.maxLabelLength,
    ),
    check(
      "runtime_valid",
      request.runtime === undefined || request.runtime.length <= AUTONOMY_LIMITS.maxRuntimeLength,
    ),
    check(
      "operation_cap_valid",
      isPositiveInteger(request.maxOperations) && request.maxOperations <= AUTONOMY_LIMITS.maxOperations,
    ),
    check(
      "expiry_valid",
      Number.isSafeInteger(request.expiresAt) &&
        request.expiresAt - request.now >= AUTONOMY_LIMITS.minGrantTtlMs &&
        request.expiresAt - request.now <= maxTtl,
      `Expiry must be between ${AUTONOMY_LIMITS.minGrantTtlMs}ms and ${maxTtl}ms from creation.`,
    ),
    check(
      "block_scope_valid",
      blockIds.length <= AUTONOMY_LIMITS.maxBlockIds && uniqueBlockIds.size === blockIds.length,
      "Optional block allowlist must be unique and bounded.",
    ),
  ];
}

export function assertValidGrantRequest(request: GrantRequest): void {
  const failed = validateGrantRequest(request).find((item) => !item.passed);
  if (failed) {
    throw new AutonomyPolicyError(failed.code, failed.detail ?? "Grant request is invalid.");
  }
}

/**
 * Fail-closed authority decision. Every check is independently recorded so a
 * receipt can show exactly why delegated approval was accepted or refused.
 */
export function evaluateDelegatedAuthority(
  grant: GrantPolicyRecord | null | undefined,
  request: DelegatedOperationRequest,
): AuthorityDecision {
  if (!grant) {
    return {
      allowed: false,
      status: "missing",
      reasonCode: "grant_missing",
      checks: [check("grant_present", false, "Review mode has no delegated grant.")],
    };
  }

  const status = effectiveGrantStatus(grant, request.now);
  const checks = [
    check("grant_active", status === "active", `Effective grant status is ${status}.`),
    check("owner_matches", grant.ownerKey === request.ownerKey),
    check(
      "operation_allowed",
      grant.operation === AUTONOMY_OPERATION && request.operation === AUTONOMY_OPERATION,
      "V1 permits only notebook.update_block.",
    ),
    check(
      "entity_scope_shape_valid",
      grant.mode === "workspace"
        ? grant.entityId === undefined
        : hasText(grant.entityId, AUTONOMY_LIMITS.maxKeyLength),
    ),
    check(
      "entity_scope_matches",
      grant.mode === "workspace" || grant.entityId === request.entityId,
    ),
    check(
      "run_scope_matches",
      grant.mode === "workspace" ||
        (hasText(request.runId, AUTONOMY_LIMITS.maxRunIdLength) &&
          hasText(grant.runId, AUTONOMY_LIMITS.maxRunIdLength) &&
          grant.runId === request.runId),
    ),
    check(
      "run_binding_state_valid",
      grant.mode === "workspace"
        ? grant.runId === undefined && grant.runBinding === "not_applicable"
        : hasText(grant.runId, AUTONOMY_LIMITS.maxRunIdLength) &&
          grant.runBinding === "bound",
    ),
    check(
      "block_scope_matches",
      !grant.blockIds || grant.blockIds.length === 0 || grant.blockIds.includes(request.blockId),
    ),
    check(
      "server_agent_matches",
      grant.agentId === AUTONOMY_AGENT_ID && request.agentId === AUTONOMY_AGENT_ID,
      "V1 permits only the server-selected NodeBench notebook coordinator.",
    ),
    check(
      "network_egress_denied",
      grant.capabilityEnvelope?.networkEgress === AUTONOMY_CAPABILITY_ENVELOPE.networkEgress,
    ),
    check(
      "file_access_denied",
      grant.capabilityEnvelope?.fileAccess === AUTONOMY_CAPABILITY_ENVELOPE.fileAccess,
    ),
    check(
      "spend_limit_zero",
      grant.capabilityEnvelope?.spendLimitUsd === AUTONOMY_CAPABILITY_ENVELOPE.spendLimitUsd,
    ),
    check(
      "operation_cap_available",
      isPositiveInteger(grant.maxOperations) &&
        Number.isSafeInteger(grant.usedOperations) &&
        grant.usedOperations >= 0 &&
        grant.usedOperations < grant.maxOperations,
    ),
    check("not_expired", grant.expiresAt > request.now),
  ];
  const failed = checks.find((item) => !item.passed);

  return {
    allowed: !failed,
    status,
    reasonCode: failed?.code,
    checks,
  };
}

export function evaluateCommitSnapshot(request: CommitSnapshotRequest): AutonomyValidationCheck[] {
  return [
    check(
      "base_revision_matches",
      Number.isSafeInteger(request.expectedRevision) &&
        request.expectedRevision === request.currentRevision,
    ),
    check(
      "before_content_matches",
      request.expectedContentHash.length > 0 &&
        request.expectedContentHash === request.currentContentHash,
    ),
    check(
      "before_source_refs_match",
      request.expectedSourceRefIdsHash.length > 0 &&
        request.expectedSourceRefIdsHash === request.currentSourceRefIdsHash,
    ),
    check(
      "proposal_changes_state",
      (request.proposedContentHash.length > 0 &&
        request.proposedContentHash !== request.expectedContentHash) ||
        (request.proposedSourceRefIdsHash.length > 0 &&
          request.proposedSourceRefIdsHash !== request.expectedSourceRefIdsHash),
    ),
  ];
}

export function evaluateUndoEligibility(request: UndoEligibilityRequest): AutonomyValidationCheck[] {
  return [
    check("undo_owner_matches", request.receiptOwnerKey === request.requesterOwnerKey),
    check("undo_source_is_commit", request.receiptEvent === "commit"),
    check("undo_was_available", request.canUndoAtCommit),
    check("undo_not_already_applied", !request.alreadyUndone),
    check("undo_revision_is_current", request.receiptAfterRevision === request.currentRevision),
    check(
      "undo_content_is_current",
      request.receiptAfterContentHash.length > 0 &&
        request.receiptAfterContentHash === request.currentContentHash,
    ),
    check(
      "undo_source_refs_are_current",
      request.receiptAfterSourceRefIdsHash.length > 0 &&
        request.receiptAfterSourceRefIdsHash === request.currentSourceRefIdsHash,
    ),
  ];
}

export function assertChecksPassed(
  checks: readonly AutonomyValidationCheck[],
  fallbackCode = "validation_failed",
): void {
  const failed = checks.find((item) => !item.passed);
  if (failed) {
    throw new AutonomyPolicyError(failed.code || fallbackCode, failed.detail ?? "Validation failed.");
  }
}

/** Stable JSON for policy digests and content-addressed evidence. */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input !== "object") {
      if (typeof input === "number" && !Number.isFinite(input)) {
        throw new AutonomyPolicyError("non_finite_number", "Canonical values must be finite.");
      }
      return input;
    }
    if (seen.has(input)) {
      throw new AutonomyPolicyError("cyclic_value", "Canonical values must be acyclic.");
    }
    seen.add(input);
    if (Array.isArray(input)) {
      const result = input.map(normalize);
      seen.delete(input);
      return result;
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(input as Record<string, unknown>).sort()) {
      const normalized = normalize((input as Record<string, unknown>)[key]);
      if (normalized !== undefined) result[key] = normalized;
    }
    seen.delete(input);
    return result;
  };
  return JSON.stringify(normalize(value));
}
