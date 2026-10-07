import type { AgentOutputEnvelope } from "./agentOutputContract";
import type { NodeBenchWorkflowCandidate } from "./nodeBenchWorkflowCandidate";

export type RocketRidePublicationStatus =
  "independent_unsubmitted" | "submitted_pending" | "externally_accepted";

export interface RocketRideEvidenceArtifact {
  path: string;
  sha256: string;
  bytes: number;
  kind:
    | "environment"
    | "result"
    | "trace"
    | "failure_ledger"
    | "scorecard"
    | "submission_receipt"
    | "log"
    | "deviation"
    | "manifest";
}

export interface RocketRideEvidenceBundle {
  schemaVersion: "node.rocketride.evidence-bundle/v1";
  studyId: string;
  sourceCommit: string;
  publicationStatus: RocketRidePublicationStatus;
  evidenceStatus: "complete" | "incomplete";
  failureSignals: number;
  modelCostUsd: number;
  cloudCostUsd: number;
  negativeFindings: string[];
  evidenceGaps: string[];
  artifacts: RocketRideEvidenceArtifact[];
  externalAcceptanceReceiptSha256?: string;
}

export function validateRocketRideEvidenceBundle(
  bundle: RocketRideEvidenceBundle,
): string[] {
  const issues: string[] = [];
  if (bundle?.schemaVersion !== "node.rocketride.evidence-bundle/v1") {
    return ["RocketRide evidence bundle schema is unsupported."];
  }
  if (!bounded(bundle.studyId, 1, 160))
    issues.push("RocketRide study ID is invalid.");
  if (!/^[0-9a-f]{40}$/.test(bundle.sourceCommit)) {
    issues.push("RocketRide source commit must be a full Git SHA.");
  }
  if (
    ![
      "independent_unsubmitted",
      "submitted_pending",
      "externally_accepted",
    ].includes(bundle.publicationStatus)
  ) {
    issues.push("RocketRide publication status is invalid.");
  }
  if (!["complete", "incomplete"].includes(bundle.evidenceStatus)) {
    issues.push("RocketRide evidence status is invalid.");
  }
  if (!nonNegativeInteger(bundle.failureSignals))
    issues.push("RocketRide failure count is invalid.");
  for (const [label, value] of [
    ["model", bundle.modelCostUsd],
    ["cloud", bundle.cloudCostUsd],
  ] as const) {
    if (!Number.isFinite(value) || value < 0)
      issues.push(`RocketRide ${label} cost is invalid.`);
  }
  if (!boundedTextList(bundle.negativeFindings, 0, 256, 2_000)) {
    issues.push("RocketRide negative findings are invalid.");
  }
  if (!boundedTextList(bundle.evidenceGaps, 0, 256, 2_000)) {
    issues.push("RocketRide evidence gaps are invalid.");
  }
  if (
    bundle.evidenceStatus === "incomplete" &&
    bundle.evidenceGaps.length === 0
  ) {
    issues.push("Incomplete RocketRide evidence must name at least one gap.");
  }

  if (
    !Array.isArray(bundle.artifacts) ||
    bundle.artifacts.length < 1 ||
    bundle.artifacts.length > 10_000
  ) {
    issues.push(
      "RocketRide evidence bundle must contain 1 to 10000 artifacts.",
    );
    return issues;
  }
  const paths = new Set<string>();
  const hashes = new Set<string>();
  for (const artifact of bundle.artifacts) {
    if (!safeRelativePath(artifact.path))
      issues.push(`Unsafe RocketRide evidence path: ${artifact.path}.`);
    if (paths.has(artifact.path))
      issues.push(`Duplicate RocketRide evidence path: ${artifact.path}.`);
    paths.add(artifact.path);
    if (!/^[0-9a-f]{64}$/.test(artifact.sha256)) {
      issues.push(`RocketRide evidence hash is invalid for ${artifact.path}.`);
    }
    hashes.add(artifact.sha256);
    if (!nonNegativeInteger(artifact.bytes)) {
      issues.push(
        `RocketRide evidence byte count is invalid for ${artifact.path}.`,
      );
    }
    if (
      ![
        "environment",
        "result",
        "trace",
        "failure_ledger",
        "scorecard",
        "submission_receipt",
        "log",
        "deviation",
        "manifest",
      ].includes(artifact.kind)
    ) {
      issues.push(`RocketRide evidence kind is invalid for ${artifact.path}.`);
    }
  }

  if (bundle.publicationStatus === "externally_accepted") {
    const receipt = bundle.externalAcceptanceReceiptSha256;
    if (!receipt || !hashes.has(receipt)) {
      issues.push(
        "Externally accepted RocketRide status requires a hashed acceptance receipt.",
      );
    } else if (
      !bundle.artifacts.some(
        (artifact) =>
          artifact.sha256 === receipt && artifact.kind === "submission_receipt",
      )
    ) {
      issues.push(
        "RocketRide acceptance hash must identify a submission-receipt artifact.",
      );
    }
  } else if (bundle.externalAcceptanceReceiptSha256) {
    issues.push(
      "Unaccepted RocketRide evidence must not attach an acceptance receipt claim.",
    );
  }
  return [...new Set(issues)];
}

export function buildRocketRideEvidenceReportCandidate(
  bundle: RocketRideEvidenceBundle,
  context: { runId: string; traceId: string },
): NodeBenchWorkflowCandidate {
  const issues = validateRocketRideEvidenceBundle(bundle);
  if (issues.length > 0) throw new Error(issues.join(" "));
  if (!bounded(context.runId, 1, 256) || !bounded(context.traceId, 1, 256)) {
    throw new Error(
      "RocketRide evidence report run and trace IDs are required.",
    );
  }
  const sourceRefs = bundle.artifacts.map(
    (artifact) => `source:sha256:${artifact.sha256}`,
  );
  const output: AgentOutputEnvelope = {
    id: `rocketride-evidence-${bundle.studyId}`,
    l1: "generated_artifact",
    l2: "source_bundle",
    l3: "artifact.source_bundle",
    target: {
      artifactId: `rocketride-${bundle.studyId}`,
      traceId: context.traceId,
    },
    visibility: "workspace",
    sourceRefs,
    citationRefs: sourceRefs,
    traceRef: context.traceId,
    producedBy: {
      runId: context.runId,
      skill: "rocketride_evidence_ingestion",
      toolChain: [
        "verify_manifest",
        "preserve_failures",
        "build_dimensional_report",
      ],
    },
    version: { sourceBundleVersion: 1 },
    output: {
      studyId: bundle.studyId,
      sourceCommit: bundle.sourceCommit,
      publicationStatus: bundle.publicationStatus,
      evidenceStatus: bundle.evidenceStatus,
      failureSignals: bundle.failureSignals,
      negativeFindings: bundle.negativeFindings,
      evidenceGaps: bundle.evidenceGaps,
      costs: { modelUsd: bundle.modelCostUsd, cloudUsd: bundle.cloudCostUsd },
      artifactCount: bundle.artifacts.length,
    },
  };
  const findings =
    bundle.negativeFindings.length > 0
      ? bundle.negativeFindings
      : ["evidence bundle validated"];
  return {
    kind: "answer-report-packet",
    outputs: [output],
    evidenceBindings: findings.map((_, index) => ({
      claimId: `rocketride-finding-${index + 1}`,
      sourceRefs,
    })),
  };
}

function safeRelativePath(value: unknown): value is string {
  if (
    !bounded(value, 1, 1_024) ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[a-z]:[\\/]/i.test(value) ||
    value.includes("\0")
  ) {
    return false;
  }
  const segments = value.replaceAll("\\", "/").split("/");
  return !segments.some(
    (segment) => segment === "" || segment === "." || segment === "..",
  );
}

function boundedTextList(
  value: unknown,
  min: number,
  max: number,
  itemMax: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every((item) => bounded(item, 1, itemMax))
  );
}

function bounded(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= min &&
    value.length <= max
  );
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
