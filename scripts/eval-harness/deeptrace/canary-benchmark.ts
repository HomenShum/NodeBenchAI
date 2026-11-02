/** Source-bound comparison of production policy on fixed synthetic state; no agent/model execution. */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  BranchResult,
  TriggerInput,
} from "../../../backend/convex/domains/deepTrace/researchCellPolicy.js";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const WORKER_FILE = fileURLToPath(
  new URL("./research-policy-worker.mjs", import.meta.url),
);
const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const WORKER_TIMEOUT_MS = 10_000;
let activeComparisons = 0;

function readBounded(file: string, maxBytes: number): string {
  if (!statSync(file).isFile() || statSync(file).size > maxBytes)
    throw new Error("Invalid or oversized file: " + file);
  const value = readFileSync(file, "utf8");
  if (Buffer.byteLength(value) > maxBytes)
    throw new Error("File grew beyond limit: " + file);
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

type Reference = BranchResult["evidenceRefs"][number];
interface PolicyCase {
  persona: string;
  input: {
    caseId: string;
    entityKey: string;
    repetitions: number;
    triggerInput: TriggerInput;
    existingFacts: string[];
    storedResults: Record<string, Partial<BranchResult>>;
  };
  expected: {
    trigger: boolean;
    reason: string | null;
    strategies: string[];
    rankedBranchIds: string[];
    evidence: Reference[];
    facts: string[];
    hypothesis: string | null;
  };
}

function policyCases(): PolicyCase[] {
  const healthy = {
    confidence: 0.85,
    dimensionCoverage: 0.8,
    durableSourceCount: 4,
    operatorRequested: false,
  };
  const routing = (
    caseId: string,
    persona: string,
    triggerInput: TriggerInput,
    reason: string | null,
    strategies: string[],
    rankedBranchIds: string[],
  ): PolicyCase => ({
    persona,
    input: {
      caseId,
      entityKey: "company/example",
      repetitions: 1,
      triggerInput,
      existingFacts: [],
      storedResults: {},
    },
    expected: {
      trigger: reason !== null,
      reason,
      strategies,
      rankedBranchIds,
      evidence: [],
      facts: [],
      hypothesis: null,
    },
  });
  const first = {
    label: "Quarterly report|https://archive.example/source",
    href: "https://publisher.example/report",
    kind: "filing",
  };
  const second = {
    label: "Quarterly report",
    href: "https://archive.example/source|https://publisher.example/report",
    kind: "archive",
  };
  const normal = {
    label: "Board report",
    href: "https://board.example/report",
    kind: "filing",
  };
  const evidence = (
    caseId: string,
    persona: string,
    refs: Reference[],
    expected: Reference[],
    repetitions = 1,
  ): PolicyCase => ({
    persona,
    input: {
      caseId,
      entityKey: "company/example",
      repetitions,
      triggerInput: { ...healthy, durableSourceCount: 1 },
      existingFacts: ["An existing source needs review."],
      storedResults: {
        source_diversification: {
          evidenceRefs: refs,
          observedFacts: [
            "Stored source remains available.",
            "Stored source remains available.",
          ],
          usefulness: 0.8,
          hypothesis: "Stored sources require analyst review.",
        },
      },
    },
    expected: {
      trigger: true,
      reason: "durableSources 1 < 3",
      strategies: ["evidence_gap_fill", "source_diversification"],
      rankedBranchIds: ["branch-1", "branch-0"],
      evidence: expected,
      facts: ["Stored source remains available."],
      hypothesis: "Stored sources require analyst review.",
    },
  });
  const many = Array.from({ length: 128 }, (_, i) => ({
    label: "Archived filing " + i,
    href: "https://archive.example/filing/" + i,
    kind: "filing",
  }));
  return [
    routing(
      "healthy",
      "An analyst avoids needless re-analysis of a well-covered company.",
      healthy,
      null,
      [],
      [],
    ),
    routing(
      "low-confidence",
      "A reviewer asks for competing explanations when confidence is low.",
      { ...healthy, confidence: 0.4 },
      "confidence 0.40 < 0.65",
      ["counter_hypothesis", "source_diversification"],
      ["branch-0", "branch-1"],
    ),
    routing(
      "coverage-gap",
      "An analyst with reliable but incomplete data needs missing dimensions surfaced.",
      { ...healthy, dimensionCoverage: 0.4 },
      "dimensionCoverage 0.40 < 0.7",
      ["dimension_coverage", "source_diversification"],
      ["branch-0", "branch-1"],
    ),
    routing(
      "sparse-sources",
      "A researcher with few durable sources needs an evidence-gap branch.",
      { ...healthy, durableSourceCount: 1 },
      "durableSources 1 < 3",
      ["evidence_gap_fill", "source_diversification"],
      ["branch-0", "branch-1"],
    ),
    routing(
      "operator-request",
      "An operator requests a review despite otherwise healthy inputs.",
      { ...healthy, operatorRequested: true },
      "operator_requested",
      ["dimension_coverage", "counter_hypothesis", "source_diversification"],
      ["branch-1", "branch-0", "branch-2"],
    ),
    routing(
      "threshold-boundary",
      "A reviewer at the documented thresholds avoids an unnecessary run.",
      {
        ...healthy,
        confidence: 0.65,
        dimensionCoverage: 0.7,
        durableSourceCount: 3,
      },
      null,
      [],
      [],
    ),
    evidence(
      "duplicate-source",
      "An analyst sees one citation when two branches return the same source.",
      [normal, normal],
      [normal],
    ),
    evidence(
      "distinct-source-tuples",
      "An imported archive contains separator characters; the analyst must retain both distinct citations.",
      [first, second, first],
      [first, second],
    ),
    evidence(
      "missing-url",
      "A reviewer retains a labeled offline record while collapsing its identical repeat.",
      [{ label: "Offline record" }, { label: "Offline record", href: "" }],
      [{ label: "Offline record" }],
    ),
    evidence(
      "archive-burst",
      "An analyst merges 128 distinct archived filings with repeated references.",
      [...many, ...many],
      many,
    ),
    evidence(
      "sustained-review",
      "An operator repeats the same review 128 times without losing sources or accumulating state.",
      [first, second, normal, first],
      [first, second, normal],
      128,
    ),
  ];
}

const CASES = policyCases();
const EVALUATOR_SOURCE = readBounded(CURRENT_FILE, MAX_SOURCE_BYTES);
const WORKER_SOURCE = readBounded(WORKER_FILE, MAX_SOURCE_BYTES);

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Malformed policy observation");
  return value as RecordValue;
}

function grade(raw: unknown, cases: PolicyCase[]) {
  if (!Array.isArray(raw) || raw.length !== cases.length)
    throw new Error("Wrong observation count");
  return cases.map((fixture, index) => {
    const row = record(raw[index]);
    if (
      row.caseId !== fixture.input.caseId ||
      !Array.isArray(row.observations) ||
      row.observations.length !== fixture.input.repetitions
    ) {
      throw new Error("Wrong case identity or repetition count");
    }
    const repetitions = row.observations.map((value) => {
      const observed = record(value);
      const merged = record(observed.merged);
      if (
        typeof observed.trigger !== "boolean" ||
        !Array.isArray(observed.branches) ||
        !Array.isArray(observed.rankedBranchIds) ||
        !Array.isArray(merged.evidenceBundle) ||
        !Array.isArray(merged.observedFacts) ||
        !Array.isArray(merged.relationships) ||
        !Array.isArray(merged.receipts)
      ) {
        throw new Error("Malformed policy output");
      }
      const strategies = observed.branches.map(
        (branch) => record(branch).strategy,
      );
      const expected = fixture.expected;
      return {
        trigger: observed.trigger === expected.trigger,
        reason: observed.reason === expected.reason,
        strategies: isDeepStrictEqual(strategies, expected.strategies),
        branchBound: observed.branches.length <= 3,
        ranking: isDeepStrictEqual(
          observed.rankedBranchIds,
          expected.rankedBranchIds,
        ),
        evidence: isDeepStrictEqual(merged.evidenceBundle, expected.evidence),
        facts: isDeepStrictEqual(merged.observedFacts, expected.facts),
        relationships: merged.relationships.length === 0,
        hypothesis: merged.strongestHypothesis === expected.hypothesis,
        counterHypothesis: merged.counterHypothesis === null,
        receipts: isDeepStrictEqual(
          merged.receipts.map((receipt) => record(receipt).branchId),
          expected.rankedBranchIds,
        ),
      };
    });
    const checks = Object.keys(repetitions[0]).map((name) => ({
      id: fixture.input.caseId + "." + name,
      passed: repetitions.every(
        (repetition) => repetition[name as keyof typeof repetition],
      ),
    }));
    return {
      caseId: fixture.input.caseId,
      repetitions: repetitions.length,
      passed: checks.every((check) => check.passed),
      checks,
    };
  });
}

async function executePolicy(source: string, inputs: PolicyCase["input"][]) {
  const request = JSON.stringify({ source, inputs });
  if (Buffer.byteLength(request) > 256 * 1024)
    throw new Error("Policy request exceeds 256 KiB");
  const started = performance.now();
  const stdout = await new Promise<string>((accept, reject) => {
    const child = execFile(
      process.execPath,
      [
        "--disable-warning=ExperimentalWarning",
        "--input-type=module",
        "--eval",
        WORKER_SOURCE,
      ],
      {
        timeout: WORKER_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: "utf8",
        windowsHide: true,
        // No provider secrets or inherited loader configuration is required.
        env: {
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
        },
      },
      (error, output, stderr) =>
        error
          ? reject(
              new Error(
                "Policy execution failed: " +
                  (stderr.slice(0, 1200) || error.message),
              ),
            )
          : accept(output),
    );
    child.stdin?.on("error", reject);
    child.stdin?.end(request);
  });
  return {
    raw: JSON.parse(stdout) as unknown,
    workerElapsedMs: performance.now() - started,
  };
}

export async function comparePolicies(
  baselineFile: string,
  candidateFile: string,
) {
  if (activeComparisons >= 4)
    throw new Error("At most four policy comparisons may run concurrently");
  activeComparisons++;
  try {
    const baselineSource = readBounded(baselineFile, MAX_SOURCE_BYTES);
    const candidateSource = readBounded(candidateFile, MAX_SOURCE_BYTES);
    const cases: PolicyCase[] = structuredClone(CASES);
    const inputs = cases.map((fixture) => fixture.input);
    const identity = {
      baseline: { path: resolve(baselineFile), sha256: sha256(baselineSource) },
      candidate: {
        path: resolve(candidateFile),
        sha256: sha256(candidateSource),
      },
      evaluatorSha256: sha256(EVALUATOR_SOURCE),
      workerSha256: sha256(WORKER_SOURCE),
      fixturesSha256: sha256(canonicalJson(cases)),
      nodeVersion: process.version,
    };
    const baseline = await executePolicy(baselineSource, inputs);
    const candidate = await executePolicy(candidateSource, inputs);
    if (
      readBounded(baselineFile, MAX_SOURCE_BYTES) !== baselineSource ||
      readBounded(candidateFile, MAX_SOURCE_BYTES) !== candidateSource ||
      readBounded(CURRENT_FILE, MAX_SOURCE_BYTES) !== EVALUATOR_SOURCE ||
      readBounded(WORKER_FILE, MAX_SOURCE_BYTES) !== WORKER_SOURCE
    ) {
      throw new Error("Source or evaluator changed during comparison");
    }
    const baselineCases = grade(baseline.raw, cases);
    const candidateCases = grade(candidate.raw, cases);
    const before = baselineCases.flatMap((row) => row.checks);
    const after = candidateCases.flatMap((row) => row.checks);
    const fixed = after
      .filter((check, i) => check.passed && !before[i].passed)
      .map((check) => check.id);
    const regressions = after
      .filter((check, i) => !check.passed && before[i].passed)
      .map((check) => check.id);
    const allPassed = after.every((check) => check.passed);
    const verdict = regressions.length
      ? "regressed"
      : allPassed && fixed.length
        ? "policy-improved"
        : isDeepStrictEqual(before, after)
          ? "equivalent"
          : "inconclusive";
    return {
      schema: "deeptrace-policy-comparison/v1",
      runId: randomUUID(),
      timestamp: new Date().toISOString(),
      scope: "production policy on fixed synthetic stored state",
      evidenceStatus: "measured-policy",
      releaseEligible: false,
      agentExecuted: false,
      modelExecuted: false,
      acceptedBaselineChanged: false,
      identity,
      verdict,
      fixed,
      regressions,
      candidateAllChecksPassed: allPassed,
      counts: {
        cases: cases.length,
        checks: before.length,
        baselinePassed: before.filter((check) => check.passed).length,
        candidatePassed: after.filter((check) => check.passed).length,
      },
      cases,
      baseline: { ...baseline, cases: baselineCases },
      candidate: { ...candidate, cases: candidateCases },
    };
  } finally {
    activeComparisons--;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === CURRENT_FILE) {
  const args = process.argv.slice(2);
  const flags = new Map<string, string>();
  try {
    if (args.length !== 6)
      throw new Error(
        "Usage: node canary-benchmark.ts --baseline-policy <file.ts> --candidate-policy <file.ts> --out <new-report.json>",
      );
    for (let i = 0; i < args.length; i += 2) {
      if (
        !["--baseline-policy", "--candidate-policy", "--out"].includes(
          args[i],
        ) ||
        flags.has(args[i])
      )
        throw new Error("Unknown or duplicate flag");
      flags.set(args[i], args[i + 1]);
    }
    const result = await comparePolicies(
      flags.get("--baseline-policy")!,
      flags.get("--candidate-policy")!,
    );
    writeFileSync(flags.get("--out")!, JSON.stringify(result, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(
      JSON.stringify({
        verdict: result.verdict,
        counts: result.counts,
        fixed: result.fixed,
        regressions: result.regressions,
        releaseEligible: false,
      }),
    );
    if (!result.candidateAllChecksPassed || result.verdict === "inconclusive")
      process.exitCode = 1;
  } catch (error) {
    console.error(
      "Policy comparison inconclusive: " +
        (error instanceof Error ? error.message : String(error)),
    );
    process.exitCode = 1;
  }
}
