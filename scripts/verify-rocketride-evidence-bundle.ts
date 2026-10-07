import { readFile } from "node:fs/promises";
import process from "node:process";
import { validateNodeBenchWorkflowCandidate } from "../apps/web/src/shared/nodeBenchWorkflowCandidate";
import {
  buildRocketRideEvidenceReportCandidate,
  validateRocketRideEvidenceBundle,
  type RocketRideEvidenceBundle,
} from "../apps/web/src/shared/rocketRideEvidenceBundle";

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  console.error(
    "usage: tsx scripts/verify-rocketride-evidence-bundle.ts EVIDENCE_BUNDLE.json",
  );
  process.exit(2);
}

const bundle = JSON.parse(
  await readFile(inputPath, "utf8"),
) as RocketRideEvidenceBundle;
const bundleIssues = validateRocketRideEvidenceBundle(bundle);
if (bundleIssues.length > 0) {
  console.error(
    JSON.stringify({ status: "rejected", issues: bundleIssues }, null, 2),
  );
  process.exit(1);
}

const candidate = buildRocketRideEvidenceReportCandidate(bundle, {
  runId: `nodebench-ingest-${bundle.studyId}`,
  traceId: `trace-nodebench-ingest-${bundle.studyId}`,
});
const candidateIssues = validateNodeBenchWorkflowCandidate(candidate);
if (candidateIssues.length > 0) {
  console.error(
    JSON.stringify({ status: "rejected", issues: candidateIssues }, null, 2),
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      schemaVersion: "node.rocketride.evidence-ingestion-receipt/v1",
      status: "candidate_validated",
      studyId: bundle.studyId,
      publicationStatus: bundle.publicationStatus,
      failureSignals: bundle.failureSignals,
      negativeFindings: bundle.negativeFindings,
      evidenceGaps: bundle.evidenceGaps,
      sourceRefs: candidate.outputs[0]?.sourceRefs.length ?? 0,
      finalWriteAuthority: "nodebench_application_review",
    },
    null,
    2,
  ),
);
