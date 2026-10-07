import { describe, expect, it } from "vitest";
import { validateNodeBenchWorkflowCandidate } from "./nodeBenchWorkflowCandidate";
import {
  buildRocketRideEvidenceReportCandidate,
  validateRocketRideEvidenceBundle,
  type RocketRideEvidenceBundle,
} from "./rocketRideEvidenceBundle";

describe("RocketRide evidence ingestion", () => {
  it("builds a source-bound report while preserving an unfavorable unsubmitted result", () => {
    const bundle = evidenceBundle();
    const candidate = buildRocketRideEvidenceReportCandidate(bundle, {
      runId: "nodebench-rocketride-ingest-1",
      traceId: "trace-nodebench-rocketride-ingest-1",
    });

    expect(validateNodeBenchWorkflowCandidate(candidate)).toEqual([]);
    expect(candidate.outputs[0]?.output).toMatchObject({
      publicationStatus: "independent_unsubmitted",
      negativeFindings: [
        "RocketRide M=16 retained 152 SQLite rows where 80 were expected.",
      ],
    });
    expect(candidate.evidenceBindings[0]?.sourceRefs).toHaveLength(2);
  });

  it("blocks an official claim without an externally issued acceptance receipt", () => {
    const bundle = evidenceBundle();
    bundle.publicationStatus = "externally_accepted";

    expect(validateRocketRideEvidenceBundle(bundle)).toContain(
      "Externally accepted RocketRide status requires a hashed acceptance receipt.",
    );
    expect(() =>
      buildRocketRideEvidenceReportCandidate(bundle, {
        runId: "nodebench-rocketride-ingest-2",
        traceId: "trace-nodebench-rocketride-ingest-2",
      }),
    ).toThrow("acceptance receipt");
  });

  it("rejects drive-qualified evidence paths", () => {
    const bundle = evidenceBundle();
    bundle.artifacts[0]!.path = "C:\\benchmark\\summary.json";

    expect(validateRocketRideEvidenceBundle(bundle)).toContain(
      "Unsafe RocketRide evidence path: C:\\benchmark\\summary.json.",
    );
  });
});

function evidenceBundle(): RocketRideEvidenceBundle {
  return {
    schemaVersion: "node.rocketride.evidence-bundle/v1",
    studyId: "rocketride-node-study-20260715",
    sourceCommit: "43be41acb58558dfae8e2e3deb86d8a00cb1b1c8",
    publicationStatus: "independent_unsubmitted",
    evidenceStatus: "complete",
    failureSignals: 4,
    modelCostUsd: 0,
    cloudCostUsd: 0,
    negativeFindings: [
      "RocketRide M=16 retained 152 SQLite rows where 80 were expected.",
    ],
    evidenceGaps: ["RocketRide has not externally accepted this reproduction."],
    artifacts: [
      {
        path: "baseline/aggregate/summary.json",
        sha256: "1".repeat(64),
        bytes: 4_096,
        kind: "scorecard",
      },
      {
        path: "failures.jsonl",
        sha256: "2".repeat(64),
        bytes: 1_024,
        kind: "failure_ledger",
      },
    ],
  };
}
