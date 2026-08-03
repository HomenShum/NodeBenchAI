import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NODEKIT_RFS_BENCHMARK_SCHEMA_VERSION,
  NODEKIT_RFS_RUNNER_CONTRACT_SCHEMA_VERSION,
  NODEKIT_RFS_STAGE_NAMES,
  NODEKIT_RFS_TRACE_PROTOCOL,
  buildNodekitRfsProofloopPlan,
  buildNodekitRfsTraceCompleteArgs,
  buildNodekitRfsTraceStartArgs,
  buildNodekitRfsTraceStepArgs,
  validateNodekitRfsBenchmarkReceipt,
  validateNodekitRfsRunnerContract,
  type Availability,
  type NodekitRfsBenchmarkReceipt,
  type NodekitRfsRunnerContract,
} from "../contracts/nodekitRfsBenchmark.js";

const SHA = "a".repeat(64);
const COMMIT = "b".repeat(40);

function available<T>(value: T): Availability<T> {
  return { value, unavailableReason: null };
}

function unavailable<T>(reason: string): Availability<T> {
  return { value: null, unavailableReason: reason };
}

function evidence(kind: string) {
  return available({ kind, uri: `proof/${kind}.json`, sha256: SHA });
}

function revision(repository: string) {
  return { repository, commitSha: COMMIT, worktreeDirty: false };
}

function validSealedReceipt(): NodekitRfsBenchmarkReceipt {
  return {
    schemaVersion: NODEKIT_RFS_BENCHMARK_SCHEMA_VERSION,
    runId: "rfs-2026-13-001",
    status: "sealed",
    request: {
      season: "Summer 2026",
      requestId: "13",
      title: "Software for Agents",
      sourceUrl: "https://www.ycombinator.com/rfs",
      retrievedAt: "2026-07-22T12:00:00.000Z",
      sourceSnapshotSha256: SHA,
      briefSha256: SHA,
    },
    oracle: {
      goalId: "goal-rfs-13",
      visionSnapshot: "Build and verify one bounded agent-native application substrate.",
      successCriteria: ["A deployed canonical artifact can be created and verified."],
      sourceRefs: ["https://www.ycombinator.com/rfs"],
      crossCheckStatus: "aligned",
      deltaFromVision: "No material drift.",
      dogfoodRunId: available("dogfood-rfs-13"),
    },
    productContract: {
      targetUser: "agent application builder",
      primaryJob: "perform consequential work through typed contracts",
      canonicalArtifact: "approved artifact and content-bound receipt",
      nonGoals: ["No ungoverned production writes."],
      contractSha256: SHA,
      designIntentSha256: SHA,
    },
    environment: {
      nodebench: revision("https://github.com/HomenShum/nodebench-ai"),
      nodekit: revision("https://github.com/HomenShum/node-platform"),
      nodeagent: revision("https://github.com/HomenShum/NodeAgent"),
      nodeproof: revision("https://github.com/HomenShum/NodeProof"),
      runnerPlanSha256: SHA,
    },
    trace: {
      sessionId: available("session-1"),
      traceId: available("trace-1"),
      publicTraceId: available("public-trace-1"),
    },
    stages: NODEKIT_RFS_STAGE_NAMES.map((name) => ({
      name,
      status: "passed",
      attempt: 1,
      startedAt: available("2026-07-22T12:00:00.000Z"),
      completedAt: available("2026-07-22T12:01:00.000Z"),
      wallClockMs: available(60_000),
      agentActiveMs: available(45_000),
      waitMs: available(15_000),
    })),
    modelUsage: [
      {
        stage: "implement",
        provider: "openrouter",
        requestedModel: "moonshotai/kimi-k3-20260715",
        resolvedModel: available("moonshotai/kimi-k3-20260715"),
        generationId: available("gen-1"),
        outcome: "completed",
        inputTokens: available(1_000),
        outputTokens: available(500),
        reasoningTokens: unavailable("Provider did not return a distinct reasoning-token count."),
        cacheReadTokens: available(0),
        cacheWriteTokens: unavailable("Provider did not report cache writes."),
        costUsd: available(0.02),
        costKind: "provider_reported",
      },
    ],
    accounting: {
      fullTokenAccounting: false,
      totalModelCostUsd: available(0.02),
      totalNonModelCostUsd: unavailable("The calibration run did not retain metered non-model costs."),
      totalCostUsd: unavailable("A total cannot be claimed while non-model costs are unavailable."),
      totalWallClockMs: available(660_000),
      totalAgentActiveMs: available(495_000),
      totalHumanAttentionMs: unavailable("No instrumented human-attention timer was present for this calibration run."),
    },
    nonModelCosts: [
      {
        kind: "deployment",
        amountUsd: unavailable("The deployment provider did not expose a per-run charge."),
        costKind: "unavailable",
        source: available("deployment provider account"),
        evidenceSha256: unavailable("No per-run billing artifact was retained."),
      },
    ],
    humanInterventions: [],
    proofs: {
      source: evidence("source"),
      local: evidence("local"),
      dogfood: evidence("dogfood"),
      taste: evidence("taste"),
      deployment: evidence("deployment"),
      productionBrowser: evidence("production-browser"),
    },
    result: {
      candidateCommit: available(COMMIT),
      applicationSha256: available(SHA),
      deploymentUrl: available("https://example.test"),
      deploymentRevision: available(COMMIT),
      releaseReady: true,
      limitations: ["This is a bounded benchmark application."],
    },
    publication: {
      claimPacketSha256: unavailable("Publication starts only after the sealed receipt is approved."),
      approvalId: unavailable("Publication approval has not been requested."),
      distributionReceiptSha256: unavailable("The run has not been published."),
    },
    integrity: {
      receiptSha256: available(SHA),
      digestExcludes: ["integrity.receiptSha256.value"],
    },
  };
}

function validRunnerContract(): NodekitRfsRunnerContract {
  return {
    schemaVersion: NODEKIT_RFS_RUNNER_CONTRACT_SCHEMA_VERSION,
    runId: "rfs-2026-13-001",
    receiptPath: "proof/rfs/rfs-2026-13-001/benchmark-run.json",
    workingDirectory: ".",
    receiptValidationCommand: "npx tsx scripts/nodekit-rfs/benchmark-contract.mts",
    budgetUsd: 100,
    candidateRevisions: {
      nodebench: revision("https://github.com/HomenShum/nodebench-ai"),
      nodekit: revision("https://github.com/HomenShum/node-platform"),
      nodeagent: revision("https://github.com/HomenShum/NodeAgent"),
      nodeproof: revision("https://github.com/HomenShum/NodeProof"),
    },
    traceProtocol: NODEKIT_RFS_TRACE_PROTOCOL,
    stages: NODEKIT_RFS_STAGE_NAMES.map((name) => ({
      name,
      command: `npm run rfs:${name}`,
      estimatedCostUsd: name === "implement" ? 25 : 0,
      timeoutMs: 30 * 60_000,
    })),
  };
}

describe("nodekit.rfs-benchmark-run/v1", () => {
  it("accepts a sealed receipt while preserving genuinely unavailable metrics as null plus reason", () => {
    const receipt = validSealedReceipt();
    const result = validateNodekitRfsBenchmarkReceipt(receipt, { mode: "seal" });
    expect(result).toEqual({ ok: true, value: receipt, issues: [] });
    expect(receipt.accounting.totalHumanAttentionMs).toEqual({
      value: null,
      unavailableReason: "No instrumented human-attention timer was present for this calibration run.",
    });
  });

  it("fails closed when null is presented without an unavailable reason", () => {
    const receipt = validSealedReceipt();
    receipt.accounting.totalHumanAttentionMs.unavailableReason = null;
    const result = validateNodekitRfsBenchmarkReceipt(receipt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: "missing_unavailable_reason" }));
  });

  it("fails closed on unknown receipt fields instead of silently dropping them", () => {
    const receipt = validSealedReceipt() as unknown as Record<string, unknown>;
    receipt.untrackedSpend = 12;
    const result = validateNodekitRfsBenchmarkReceipt(receipt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: "unknown_key", path: "$.untrackedSpend" }));
  });

  it("fails closed when a provider-started call has no resolved model", () => {
    const receipt = validSealedReceipt();
    receipt.modelUsage[0].resolvedModel = unavailable("Response model was omitted.");
    const result = validateNodekitRfsBenchmarkReceipt(receipt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: "model_resolution_required" }));
  });

  it("allows a pre-provider failure to retain an unavailable resolved model with a reason", () => {
    const receipt = validSealedReceipt();
    receipt.modelUsage[0].outcome = "failed_before_provider";
    receipt.modelUsage[0].resolvedModel = unavailable("The provider request was never admitted.");
    const result = validateNodekitRfsBenchmarkReceipt(receipt);
    expect(result.ok).toBe(true);
  });

  it("fails closed on missing production proof, dirty candidate revisions, or a false full-token claim", () => {
    const missingProof = validSealedReceipt();
    missingProof.proofs.productionBrowser = unavailable("Browser proof did not run.");
    const proofResult = validateNodekitRfsBenchmarkReceipt(missingProof);
    expect(proofResult.ok).toBe(false);
    if (!proofResult.ok) expect(proofResult.issues).toContainEqual(expect.objectContaining({ code: "required_for_seal" }));

    const dirty = validSealedReceipt();
    dirty.environment.nodekit.worktreeDirty = true;
    const dirtyResult = validateNodekitRfsBenchmarkReceipt(dirty);
    expect(dirtyResult.ok).toBe(false);
    if (!dirtyResult.ok) expect(dirtyResult.issues).toContainEqual(expect.objectContaining({ code: "dirty_candidate" }));

    const tokenClaim = validSealedReceipt();
    tokenClaim.accounting.fullTokenAccounting = true;
    const tokenResult = validateNodekitRfsBenchmarkReceipt(tokenClaim);
    expect(tokenResult.ok).toBe(false);
    if (!tokenResult.ok) expect(tokenResult.issues).toContainEqual(expect.objectContaining({ code: "full_token_accounting_false_claim" }));
  });

  it("enforces explicit passed checkpoints before a resumable runner advances", () => {
    const receipt = validSealedReceipt();
    receipt.status = "implemented";
    receipt.stages.find((stage) => stage.name === "dogfood")!.status = "queued";
    const result = validateNodekitRfsBenchmarkReceipt(receipt, { mode: "checkpoint", checkpoint: "dogfood" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: "checkpoint_not_passed" }));
  });

  it("keeps the checked-in JSON Schema identifier synchronized with the runtime contract", () => {
    const schema = JSON.parse(readFileSync(resolve("proof/contracts/nodekit-rfs-benchmark-run-v1.schema.json"), "utf8")) as {
      properties: { schemaVersion: { const: string } };
    };
    expect(schema.properties.schemaVersion.const).toBe(NODEKIT_RFS_BENCHMARK_SCHEMA_VERSION);
  });
});

describe("NodeKit RFS resumable ProofLoop contract", () => {
  it("compiles every standard stage into a command and fail-closed receipt checkpoint", () => {
    const contract = validRunnerContract();
    expect(validateNodekitRfsRunnerContract(contract)).toEqual({ ok: true, value: contract, issues: [] });
    const plan = buildNodekitRfsProofloopPlan(contract);
    expect(plan.schema).toBe("proofloop-runner-plan-v1");
    expect(plan.tasks).toHaveLength(NODEKIT_RFS_STAGE_NAMES.length * 2);
    expect(plan.tasks[0]).toEqual(expect.objectContaining({ id: "rfs.register", command: "npm run rfs:register" }));
    expect(plan.tasks[1].id).toBe("rfs.register.receipt-checkpoint");
    expect(plan.tasks.at(-1)?.command).toContain("--checkpoint seal --mode seal");
  });

  it("rejects missing stages, dirty immutable candidates, budget overflow, and renamed trace tools", () => {
    const missingStage = validRunnerContract();
    missingStage.stages = missingStage.stages.filter((stage) => stage.name !== "taste");
    const stageResult = validateNodekitRfsRunnerContract(missingStage);
    expect(stageResult.ok).toBe(false);
    if (!stageResult.ok) expect(stageResult.issues).toContainEqual(expect.objectContaining({ code: "missing_runner_stage" }));

    const dirty = validRunnerContract();
    dirty.candidateRevisions.nodekit.worktreeDirty = true;
    const dirtyResult = validateNodekitRfsRunnerContract(dirty);
    expect(dirtyResult.ok).toBe(false);
    if (!dirtyResult.ok) expect(dirtyResult.issues).toContainEqual(expect.objectContaining({ code: "dirty_candidate" }));

    const overBudget = validRunnerContract();
    overBudget.budgetUsd = 10;
    const budgetResult = validateNodekitRfsRunnerContract(overBudget);
    expect(budgetResult.ok).toBe(false);
    if (!budgetResult.ok) expect(budgetResult.issues).toContainEqual(expect.objectContaining({ code: "estimated_cost_exceeds_budget" }));

    const renamed = validRunnerContract() as unknown as Record<string, unknown>;
    renamed.traceProtocol = { ...NODEKIT_RFS_TRACE_PROTOCOL, complete: "finish_execution_run" };
    const protocolResult = validateNodekitRfsRunnerContract(renamed);
    expect(protocolResult.ok).toBe(false);
    if (!protocolResult.ok) expect(protocolResult.issues).toContainEqual(expect.objectContaining({ code: "invalid_trace_protocol" }));
  });

  it("builds exact arguments for the existing execution-trace primitives without inventing a parallel trace", () => {
    const contract = validRunnerContract();
    const receipt = validSealedReceipt();
    const start = buildNodekitRfsTraceStartArgs(contract, receipt);
    expect(start).toEqual(expect.objectContaining({ workflowName: "nodekit_rfs_benchmark", visibility: "private" }));
    expect(start).toEqual(expect.objectContaining({
      goalId: receipt.oracle.goalId,
      visionSnapshot: receipt.oracle.visionSnapshot,
      successCriteria: receipt.oracle.successCriteria,
    }));
    expect(start.metadata).toEqual(expect.objectContaining({ runId: contract.runId, candidateRevisions: contract.candidateRevisions }));

    const step = buildNodekitRfsTraceStepArgs({
      traceId: "trace-1",
      stage: "production_verify",
      title: "Production verification",
      action: "run browser proof",
      target: "https://example.test",
      resultSummary: "passed",
    });
    expect(step).toEqual(expect.objectContaining({ stage: "verify", type: "verification_passed", tool: "proofloop.runner" }));
    expect(step.metadata).toEqual(expect.objectContaining({ rfsStage: "production_verify" }));

    const complete = buildNodekitRfsTraceCompleteArgs(receipt);
    expect(complete).toEqual(expect.objectContaining({
      sessionId: "session-1",
      traceId: "trace-1",
      inputTokens: 1_000,
      outputTokens: 500,
      estimatedCostUsd: 0.02,
    }));
  });

  it("does not turn unavailable aggregate token counts into zeros on trace completion", () => {
    const receipt = validSealedReceipt();
    receipt.modelUsage[0].inputTokens = unavailable("The coding surface did not expose input tokens.");
    const complete = buildNodekitRfsTraceCompleteArgs(receipt);
    expect(complete).toHaveProperty("inputTokens", undefined);
    expect(complete).toHaveProperty("outputTokens", 500);
  });
});
