import { describe, expect, it } from "vitest";

import {
  AUTONOMY_AGENT_ID,
  AUTONOMY_CAPABILITY_ENVELOPE,
  AUTONOMY_LIMITS,
  AUTONOMY_OPERATION,
  AutonomyPolicyError,
  assertChecksPassed,
  assertValidGrantRequest,
  effectiveGrantStatus,
  evaluateCommitSnapshot,
  evaluateDelegatedAuthority,
  evaluateUndoEligibility,
  stableStringify,
  validateGrantRequest,
  type DelegatedOperationRequest,
  type GrantPolicyRecord,
} from "./policy";

const NOW = 1_800_000_000_000;

function workspaceGrant(
  overrides: Partial<GrantPolicyRecord> = {},
): GrantPolicyRecord {
  return {
    ownerKey: "user:owner-a",
    mode: "workspace",
    operation: AUTONOMY_OPERATION,
    entityId: undefined,
    runId: undefined,
    runBinding: "not_applicable",
    agentId: AUTONOMY_AGENT_ID,
    capabilityEnvelope: AUTONOMY_CAPABILITY_ENVELOPE,
    maxOperations: 10,
    usedOperations: 0,
    expiresAt: NOW + 60_000,
    status: "active",
    ...overrides,
  };
}

function runGrant(overrides: Partial<GrantPolicyRecord> = {}): GrantPolicyRecord {
  return {
    ...workspaceGrant(),
    mode: "run",
    entityId: "entity-a",
    runId: "run-a",
    runBinding: "bound",
    ...overrides,
  };
}

function operation(
  overrides: Partial<DelegatedOperationRequest> = {},
): DelegatedOperationRequest {
  return {
    ownerKey: "user:owner-a",
    operation: AUTONOMY_OPERATION,
    entityId: "entity-a",
    blockId: "block-a",
    runId: "run-a",
    agentId: AUTONOMY_AGENT_ID,
    now: NOW,
    ...overrides,
  };
}

describe("autonomy grant shape", () => {
  it("accepts owner-wide workspace grants and rejects mixed workspace/entity scope", () => {
    const valid = validateGrantRequest({
      mode: "workspace",
      entityId: undefined,
      agentId: AUTONOMY_AGENT_ID,
      maxOperations: 5,
      expiresAt: NOW + AUTONOMY_LIMITS.minGrantTtlMs,
      now: NOW,
    });
    expect(valid.every((item) => item.passed)).toBe(true);

    const invalid = validateGrantRequest({
      mode: "workspace",
      entityId: "entity-a",
      agentId: AUTONOMY_AGENT_ID,
      maxOperations: 5,
      expiresAt: NOW + AUTONOMY_LIMITS.minGrantTtlMs,
      now: NOW,
    });
    expect(invalid.find((item) => item.code === "entity_scope_valid")?.passed).toBe(false);
  });

  it("requires a concrete entity and current run for run grants", () => {
    expect(() =>
      assertValidGrantRequest({
        mode: "run",
        entityId: undefined,
        agentId: AUTONOMY_AGENT_ID,
        maxOperations: 1,
        expiresAt: NOW + AUTONOMY_LIMITS.minGrantTtlMs,
        now: NOW,
      }),
    ).toThrowError(AutonomyPolicyError);

    expect(() =>
      assertValidGrantRequest({
        mode: "run",
        entityId: "entity-a",
        runId: "run-a",
        agentId: AUTONOMY_AGENT_ID,
        maxOperations: 1,
        expiresAt: NOW + AUTONOMY_LIMITS.minGrantTtlMs,
        now: NOW,
      }),
    ).not.toThrow();
  });

  it("enforces bounded TTL, operation cap, and unique block scope", () => {
    const checks = validateGrantRequest({
      mode: "run",
      entityId: "entity-a",
      runId: "run-a",
      blockIds: ["block-a", "block-a"],
      agentId: AUTONOMY_AGENT_ID,
      maxOperations: AUTONOMY_LIMITS.maxOperations + 1,
      expiresAt: NOW + AUTONOMY_LIMITS.maxRunGrantTtlMs + 1,
      now: NOW,
    });
    expect(checks.filter((item) => !item.passed).map((item) => item.code)).toEqual(
      expect.arrayContaining(["operation_cap_valid", "expiry_valid", "block_scope_valid"]),
    );
  });
});

describe("delegated authority", () => {
  it("treats absence of a grant as review mode and denies the write", () => {
    const decision = evaluateDelegatedAuthority(null, operation());
    expect(decision).toMatchObject({
      allowed: false,
      status: "missing",
      reasonCode: "grant_missing",
    });
  });

  it("allows a valid owner-wide workspace block update", () => {
    const decision = evaluateDelegatedAuthority(workspaceGrant(), operation());
    expect(decision.allowed).toBe(true);
    expect(decision.checks.every((item) => item.passed)).toBe(true);
  });

  it("requires the proposal runId to exactly match the bound run", () => {
    expect(evaluateDelegatedAuthority(runGrant(), operation()).allowed).toBe(true);
    const denied = evaluateDelegatedAuthority(runGrant(), operation({ runId: undefined }));
    expect(denied.allowed).toBe(false);
    expect(denied.reasonCode).toBe("run_scope_matches");
  });

  it("rejects later run drift after the grant is bound", () => {
    const grant = runGrant({ runId: "run-a", runBinding: "bound" });
    expect(evaluateDelegatedAuthority(grant, operation()).allowed).toBe(true);
    const denied = evaluateDelegatedAuthority(grant, operation({ runId: "run-b" }));
    expect(denied.reasonCode).toBe("run_scope_matches");
  });

  it.each([
    ["wrong owner", workspaceGrant(), operation({ ownerKey: "user:owner-b" }), "owner_matches"],
    [
      "wrong operation",
      workspaceGrant(),
      operation({ operation: "notebook.delete_block" }),
      "operation_allowed",
    ],
    [
      "wrong server agent",
      workspaceGrant(),
      operation({ agentId: "caller.asserted.agent" }),
      "server_agent_matches",
    ],
    [
      "wrong entity",
      runGrant(),
      operation({ entityId: "entity-b" }),
      "entity_scope_matches",
    ],
    [
      "block outside allowlist",
      workspaceGrant({ blockIds: ["block-b"] }),
      operation(),
      "block_scope_matches",
    ],
  ])("denies %s", (_label, grant, request, reasonCode) => {
    const decision = evaluateDelegatedAuthority(grant, request);
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe(reasonCode);
  });

  it.each([
    ["paused", workspaceGrant({ status: "paused" }), "paused"],
    ["revoked", workspaceGrant({ status: "revoked" }), "revoked"],
    ["expired", workspaceGrant({ expiresAt: NOW }), "expired"],
    ["consumed", workspaceGrant({ usedOperations: 10 }), "consumed"],
  ])("denies a %s grant", (_label, grant, status) => {
    const decision = evaluateDelegatedAuthority(grant, operation());
    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe(status);
    expect(decision.reasonCode).toBe("grant_active");
  });

  it("fails closed if the fixed-deny/zero capability envelope drifts", () => {
    const network = evaluateDelegatedAuthority(
      workspaceGrant({
        capabilityEnvelope: { networkEgress: "allow", fileAccess: "deny", spendLimitUsd: 0 },
      }),
      operation(),
    );
    expect(network.reasonCode).toBe("network_egress_denied");

    const spend = evaluateDelegatedAuthority(
      workspaceGrant({
        capabilityEnvelope: { networkEgress: "deny", fileAccess: "deny", spendLimitUsd: 1 },
      }),
      operation(),
    );
    expect(spend.reasonCode).toBe("spend_limit_zero");
  });

  it("computes effective expiry and cap status without trusting stored active", () => {
    expect(effectiveGrantStatus(workspaceGrant({ expiresAt: NOW }), NOW)).toBe("expired");
    expect(effectiveGrantStatus(workspaceGrant({ usedOperations: 10 }), NOW)).toBe("consumed");
  });
});

describe("commit and undo snapshots", () => {
  it("requires OCC, an unchanged before snapshot, and a real content change", () => {
    const valid = evaluateCommitSnapshot({
      expectedRevision: 3,
      currentRevision: 3,
      expectedContentHash: "before",
      currentContentHash: "before",
      proposedContentHash: "after",
      expectedSourceRefIdsHash: "refs-before",
      currentSourceRefIdsHash: "refs-before",
      proposedSourceRefIdsHash: "refs-before",
    });
    expect(valid.every((item) => item.passed)).toBe(true);

    const stale = evaluateCommitSnapshot({
      expectedRevision: 3,
      currentRevision: 4,
      expectedContentHash: "before",
      currentContentHash: "drift",
      proposedContentHash: "before",
      expectedSourceRefIdsHash: "refs-before",
      currentSourceRefIdsHash: "refs-drift",
      proposedSourceRefIdsHash: "refs-before",
    });
    expect(stale.filter((item) => !item.passed).map((item) => item.code)).toEqual([
      "base_revision_matches",
      "before_content_matches",
      "before_source_refs_match",
      "proposal_changes_state",
    ]);
    expect(() => assertChecksPassed(stale)).toThrowError(AutonomyPolicyError);
  });

  it("permits a source-only proposal while preserving content", () => {
    const checks = evaluateCommitSnapshot({
      expectedRevision: 3,
      currentRevision: 3,
      expectedContentHash: "same-content",
      currentContentHash: "same-content",
      proposedContentHash: "same-content",
      expectedSourceRefIdsHash: "refs-before",
      currentSourceRefIdsHash: "refs-before",
      proposedSourceRefIdsHash: "refs-after",
    });
    expect(checks.every((item) => item.passed)).toBe(true);
  });

  it("allows undo only for the owner while the receipt revision is still current", () => {
    const valid = evaluateUndoEligibility({
      receiptOwnerKey: "user:owner-a",
      requesterOwnerKey: "user:owner-a",
      receiptEvent: "commit",
      canUndoAtCommit: true,
      receiptAfterRevision: 4,
      currentRevision: 4,
      receiptAfterContentHash: "after",
      currentContentHash: "after",
      receiptAfterSourceRefIdsHash: "refs-after",
      currentSourceRefIdsHash: "refs-after",
      alreadyUndone: false,
    });
    expect(valid.every((item) => item.passed)).toBe(true);

    const stale = evaluateUndoEligibility({
      receiptOwnerKey: "user:owner-a",
      requesterOwnerKey: "user:owner-b",
      receiptEvent: "undo",
      canUndoAtCommit: false,
      receiptAfterRevision: 4,
      currentRevision: 5,
      receiptAfterContentHash: "after",
      currentContentHash: "newer",
      receiptAfterSourceRefIdsHash: "refs-after",
      currentSourceRefIdsHash: "refs-newer",
      alreadyUndone: true,
    });
    expect(stale.every((item) => item.passed)).toBe(false);
  });
});

describe("canonical evidence", () => {
  it("sorts object keys while preserving array order", () => {
    expect(stableStringify({ z: 1, a: { d: 2, c: 1 }, list: [2, 1] })).toBe(
      '{"a":{"c":1,"d":2},"list":[2,1],"z":1}',
    );
  });

  it("rejects cyclic and non-finite evidence", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => stableStringify(cyclic)).toThrowError(AutonomyPolicyError);
    expect(() => stableStringify({ value: Number.NaN })).toThrowError(AutonomyPolicyError);
  });
});
