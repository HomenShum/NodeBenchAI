import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentOutputEnvelope } from "./agentOutputContract";
import {
  inspectNodeBenchWorkflowCandidate,
  type NodeBenchWorkflowCandidate,
} from "./nodeBenchWorkflowCandidate";
import {
  canonicalNodeWorkflowJson,
  NODE_WORKFLOW_PROTOCOL_VERSION,
  type NodeWorkflowRequest,
  type NodeWorkflowResult,
} from "./workflowExecutionPort";

const request: NodeWorkflowRequest = {
  schemaVersion: NODE_WORKFLOW_PROTOCOL_VERSION,
  app: "nodebenchai",
  workflow: "frozen-source-report",
  fixtureId: "nodebenchai-frozen-sources-v1",
  traceId: "trace-nodebenchai-frozen-sources-1",
  inputDigest: `sha256:${"1".repeat(64)}`,
  idempotencyKey: "nodebenchai-frozen-sources-v1:run-1",
  concurrency: 4,
  deadlineMs: 10_000,
};

describe("NodeBenchAI workflow execution port", () => {
  it("validates evidence-bound output without persisting artifacts or scores", async () => {
    const candidate = frozenStudyCandidate();
    const admission = await inspectNodeBenchWorkflowCandidate({
      request,
      result: resultFor(candidate),
      expectedAppCommit: "6ed0a58eeda993ff2a937ea4bacc2856756dd521",
      digestCandidate: digest,
      now: () => new Date("2026-07-15T10:00:00.000Z"),
    });

    expect(admission.accepted).toBe(true);
    expect(admission.receipt.finalWriteAuthority).toBe(
      "application_validation_cas_review",
    );
    expect(Object.keys(admission)).not.toContain("scoreId");
    expect(Object.keys(admission)).not.toContain("artifactId");
  });

  it("rejects application-policy violations and unknown evidence", async () => {
    const candidate = buildCandidate();
    candidate.outputs[0]!.visibility = "event_public";
    candidate.evidenceBindings[0]!.sourceRefs = ["source:missing"];

    const admission = await inspectNodeBenchWorkflowCandidate({
      request,
      result: resultFor(candidate),
      expectedAppCommit: "6ed0a58eeda993ff2a937ea4bacc2856756dd521",
      digestCandidate: digest,
    });

    expect(admission.accepted).toBe(false);
    expect(admission.receipt.issues.join("\n")).toContain("ART-007");
    expect(admission.receipt.issues).toContain(
      "NodeBenchAI claim claim-1 references unknown evidence.",
    );
  });
});

function frozenStudyCandidate(): NodeBenchWorkflowCandidate {
  const fixture = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "src/shared/fixtures/rocketride-nodebenchai-frozen-sources.json",
      ),
      "utf8",
    ),
  ) as { candidate: NodeBenchWorkflowCandidate };
  return fixture.candidate;
}

function buildCandidate(): NodeBenchWorkflowCandidate {
  const output: AgentOutputEnvelope = {
    id: "report-1",
    l1: "generated_artifact",
    l2: "meeting_brief",
    l3: "artifact.team_meeting_summary",
    target: { artifactId: "candidate-report-1", traceId: "trace-1" },
    visibility: "workspace",
    sourceRefs: ["source:frozen-1"],
    citationRefs: ["source:frozen-1"],
    traceRef: "trace-1",
    producedBy: {
      runId: "nodebenchai-native-001",
      skill: "frozen-source-report",
      toolChain: ["retrieve_frozen_source", "compile_report"],
    },
    version: {},
    output: {
      summary: "Frozen source finding",
      actionItems: ["Review the evidence"],
    },
  };
  return {
    kind: "answer-report-packet",
    outputs: [output],
    evidenceBindings: [{ claimId: "claim-1", sourceRefs: ["source:frozen-1"] }],
  };
}

function resultFor(
  candidate: NodeBenchWorkflowCandidate,
): NodeWorkflowResult<NodeBenchWorkflowCandidate> {
  return {
    schemaVersion: NODE_WORKFLOW_PROTOCOL_VERSION,
    runId: "nodebenchai-native-001",
    traceId: request.traceId,
    framework: "native",
    candidate,
    inputDigest: request.inputDigest,
    idempotencyKey: request.idempotencyKey,
    outputDigest: digest(candidate),
    events: [
      { sequence: 1, atMs: 0, kind: "run.started" },
      {
        sequence: 2,
        atMs: 9,
        kind: "source.captured",
        unitId: "source:frozen-1",
      },
      { sequence: 3, atMs: 14, kind: "candidate.produced", unitId: "report-1" },
    ],
    metrics: {
      coldStartMs: 1,
      warmupMs: 0,
      executionMs: 13,
      totalMs: 14,
      retryCount: 0,
      completedUnits: 2,
      failedUnits: 0,
      duplicateUnits: 0,
      leakedUnits: 0,
    },
    provenance: {
      adapter: "nodebenchai-native",
      adapterVersion: "1.0.0",
      runtime: "node",
      runtimeVersion: process.version,
      appCommit: "6ed0a58eeda993ff2a937ea4bacc2856756dd521",
      deterministic: true,
      location: "local",
    },
  };
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalNodeWorkflowJson(value)).digest("hex")}`;
}
