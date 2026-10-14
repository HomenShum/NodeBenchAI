#!/usr/bin/env npx tsx
import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

type BenchmarkMode = "baseline" | "deeptrace";

interface BenchmarkFamily {
  id: string;
  label: string;
  requiredOutputs: string[];
}

interface BenchmarkSpec {
  name: string;
  version: string;
  modes: BenchmarkMode[];
  families: BenchmarkFamily[];
  metadataKeys: string[];
  releaseGuards: {
    minimumRelativeUplift: number;
    minimumEvidenceLinkage: number;
    minimumReceiptCompleteness: number;
    maximumFalseConfidenceRate: number;
  };
}

interface ScorecardSchema {
  weights: {
    factualAccuracy: number;
    relationshipAccuracy: number;
    causalChainQuality: number;
    counterHypothesisQuality: number;
    limitationsHonesty: number;
    evidenceLinkage: number;
    receiptCompleteness: number;
    humanEditDistance: number;
  };
  trackedMetrics: string[];
  comparisonOutputs: string[];
}

interface CaseTargets {
  factCount: number;
  relationshipCount: number;
  causalLinkCount: number;
  limitationCount: number;
  evidenceLinkCount: number;
  receiptCount: number;
}

interface SyntheticProfile {
  factCount: number;
  relationshipCount: number;
  causalRelationshipCount: number;
  limitationCount: number;
  evidenceCount: number;
  linkedClaimCount: number;
  receiptsCount: number;
  includeCounterHypothesis: boolean;
  includeDimensionProfile: boolean;
  taskCompletionRate: number;
  confidenceCalibration: number;
  falseConfidenceRate: number;
  timeToFirstUsableDraftMs: number;
  blockedStepCount: number;
  toolCallCount: number;
  tokenCount: number;
  wallClockMs: number;
  humanEditDistance: number;
}

interface BenchmarkCase {
  benchmarkCaseId: string;
  familyId: string;
  title: string;
  subject: string;
  scenario: string;
  targets: CaseTargets;
  baseline: SyntheticProfile;
  deeptrace: SyntheticProfile;
}

interface RelationshipRecord {
  source: string;
  target: string;
  relation: string;
  evidenceRefs: string[];
}

interface ReceiptRecord {
  step: string;
  status: "completed";
  note: string;
}

interface EvidenceRecord {
  id: string;
  claim: string;
  source: string;
}

interface NormalizedOutput {
  observed_facts: string[];
  relationships: RelationshipRecord[];
  dimension_profile: Record<string, unknown>;
  hypothesis: string;
  counter_hypothesis: string;
  recommendation: string;
  limitations: string[];
  receipts: ReceiptRecord[];
  evidence: EvidenceRecord[];
}

interface RunMetadata {
  runId: string;
  benchmarkCaseId: string;
  mode: BenchmarkMode;
  timestamp: string;
  repoCommit: string;
  inputSnapshotHash: string;
  promptTemplateHash: string;
  mcpConfigHash: string;
  modelName: string;
  claudeCodeVersion: string | null;
  wallClockMs: number;
  toolCallCount: number;
  tokenCount: number;
  artifactPaths: string[];
}

interface ScoredRun {
  metadata: RunMetadata;
  output: NormalizedOutput;
  dimensionScores: ScorecardSchema["weights"];
  weightedScore: number;
  trackedMetrics: Record<string, number>;
}

const CURRENT_FILE = fileURLToPath(import.meta.url);
const CURRENT_DIR = path.dirname(CURRENT_FILE);
const REPO_ROOT = path.resolve(CURRENT_DIR, "..", "..", "..");
const RESULTS_DIR = path.join(CURRENT_DIR, "paired-results");

const BASELINE_PROMPT_PATH = path.join(CURRENT_DIR, "claude-baseline.prompt.md");
const DEEPTRACE_PROMPT_PATH = path.join(CURRENT_DIR, "claude-nodebench.prompt.md");
const SPEC_PATH = path.join(CURRENT_DIR, "canary-benchmark-spec.json");
const SCORECARD_PATH = path.join(CURRENT_DIR, "scorecard-schema.json");
const SIMULATION_EVIDENCE = {
  evidenceStatus: "simulation",
  releaseEligible: false,
  evidenceNote: "Synthetic fixture diagnostics; prompts are hashed, not executed. No measured model quality, latency or uplift.",
} as const;
const SIMULATION_NOTICE = "> SIMULATION — synthetic fixture diagnostics. Release eligible: false. Prompts are hashed, not executed; no measured model quality, latency or uplift.\n\n";

const CASES: BenchmarkCase[] = [
  {
    benchmarkCaseId: "company-direction-anthropic",
    familyId: "company_direction",
    title: "Anthropic company direction analysis",
    subject: "Anthropic",
    scenario: "Assess current company direction, likely priorities, and immediate decision posture.",
    targets: { factCount: 4, relationshipCount: 3, causalLinkCount: 2, limitationCount: 2, evidenceLinkCount: 4, receiptCount: 3 },
    baseline: { factCount: 3, relationshipCount: 2, causalRelationshipCount: 1, limitationCount: 1, evidenceCount: 1, linkedClaimCount: 1, receiptsCount: 0, includeCounterHypothesis: true, includeDimensionProfile: false, taskCompletionRate: 0.88, confidenceCalibration: 0.63, falseConfidenceRate: 0.08, timeToFirstUsableDraftMs: 1180, blockedStepCount: 1, toolCallCount: 4, tokenCount: 980, wallClockMs: 1420, humanEditDistance: 44 },
    deeptrace: { factCount: 4, relationshipCount: 3, causalRelationshipCount: 2, limitationCount: 2, evidenceCount: 4, linkedClaimCount: 4, receiptsCount: 3, includeCounterHypothesis: true, includeDimensionProfile: true, taskCompletionRate: 0.97, confidenceCalibration: 0.87, falseConfidenceRate: 0.03, timeToFirstUsableDraftMs: 1510, blockedStepCount: 0, toolCallCount: 8, tokenCount: 1610, wallClockMs: 1960, humanEditDistance: 16 },
  },
  {
    benchmarkCaseId: "relationship-mapping-stealth-startup",
    familyId: "relationship_mapping",
    title: "Stealth startup relationship graph mapping",
    subject: "Stealth AI Startup",
    scenario: "Map the strongest investor, operator, and product relationships from sparse evidence.",
    targets: { factCount: 3, relationshipCount: 4, causalLinkCount: 1, limitationCount: 2, evidenceLinkCount: 4, receiptCount: 3 },
    baseline: { factCount: 2, relationshipCount: 2, causalRelationshipCount: 0, limitationCount: 1, evidenceCount: 1, linkedClaimCount: 1, receiptsCount: 0, includeCounterHypothesis: false, includeDimensionProfile: false, taskCompletionRate: 0.82, confidenceCalibration: 0.58, falseConfidenceRate: 0.09, timeToFirstUsableDraftMs: 1040, blockedStepCount: 2, toolCallCount: 3, tokenCount: 860, wallClockMs: 1280, humanEditDistance: 49 },
    deeptrace: { factCount: 3, relationshipCount: 4, causalRelationshipCount: 1, limitationCount: 2, evidenceCount: 4, linkedClaimCount: 4, receiptsCount: 3, includeCounterHypothesis: true, includeDimensionProfile: true, taskCompletionRate: 0.94, confidenceCalibration: 0.84, falseConfidenceRate: 0.04, timeToFirstUsableDraftMs: 1430, blockedStepCount: 0, toolCallCount: 9, tokenCount: 1690, wallClockMs: 2010, humanEditDistance: 19 },
  },
  {
    benchmarkCaseId: "repo-intelligence-nodebench",
    familyId: "repo_intelligence",
    title: "NodeBench repository and contributor intelligence",
    subject: "nodebench-ai repository",
    scenario: "Summarize repository intelligence, contributor signals, and the most credible maintenance hypothesis.",
    targets: { factCount: 4, relationshipCount: 3, causalLinkCount: 1, limitationCount: 2, evidenceLinkCount: 3, receiptCount: 2 },
    baseline: { factCount: 3, relationshipCount: 2, causalRelationshipCount: 1, limitationCount: 2, evidenceCount: 1, linkedClaimCount: 1, receiptsCount: 0, includeCounterHypothesis: true, includeDimensionProfile: false, taskCompletionRate: 0.86, confidenceCalibration: 0.66, falseConfidenceRate: 0.07, timeToFirstUsableDraftMs: 1250, blockedStepCount: 1, toolCallCount: 4, tokenCount: 1020, wallClockMs: 1470, humanEditDistance: 41 },
    deeptrace: { factCount: 4, relationshipCount: 3, causalRelationshipCount: 1, limitationCount: 2, evidenceCount: 3, linkedClaimCount: 3, receiptsCount: 2, includeCounterHypothesis: true, includeDimensionProfile: true, taskCompletionRate: 0.95, confidenceCalibration: 0.85, falseConfidenceRate: 0.03, timeToFirstUsableDraftMs: 1490, blockedStepCount: 0, toolCallCount: 7, tokenCount: 1490, wallClockMs: 1880, humanEditDistance: 18 },
  },
  {
    benchmarkCaseId: "world-to-company-gpu-controls",
    familyId: "world_to_company",
    title: "World event to company impact causal analysis",
    subject: "GPU export control update",
    scenario: "Trace how a world event changes company execution risk, evidence posture, and recommended response.",
    targets: { factCount: 3, relationshipCount: 3, causalLinkCount: 2, limitationCount: 2, evidenceLinkCount: 3, receiptCount: 3 },
    baseline: { factCount: 2, relationshipCount: 2, causalRelationshipCount: 1, limitationCount: 1, evidenceCount: 1, linkedClaimCount: 1, receiptsCount: 0, includeCounterHypothesis: true, includeDimensionProfile: false, taskCompletionRate: 0.84, confidenceCalibration: 0.61, falseConfidenceRate: 0.08, timeToFirstUsableDraftMs: 1130, blockedStepCount: 2, toolCallCount: 4, tokenCount: 930, wallClockMs: 1390, humanEditDistance: 46 },
    deeptrace: { factCount: 3, relationshipCount: 3, causalRelationshipCount: 2, limitationCount: 2, evidenceCount: 3, linkedClaimCount: 3, receiptsCount: 3, includeCounterHypothesis: true, includeDimensionProfile: true, taskCompletionRate: 0.93, confidenceCalibration: 0.82, falseConfidenceRate: 0.04, timeToFirstUsableDraftMs: 1460, blockedStepCount: 0, toolCallCount: 8, tokenCount: 1570, wallClockMs: 1940, humanEditDistance: 20 },
  },
  {
    benchmarkCaseId: "trace-backed-draft-verdict",
    familyId: "trace_backed_draft",
    title: "Trace-backed draft and verdict generation",
    subject: "Investment memo verdict",
    scenario: "Produce a draft verdict that is ready for human review with receipts and explicit evidence coverage.",
    targets: { factCount: 3, relationshipCount: 2, causalLinkCount: 1, limitationCount: 2, evidenceLinkCount: 4, receiptCount: 4 },
    baseline: { factCount: 2, relationshipCount: 1, causalRelationshipCount: 1, limitationCount: 1, evidenceCount: 1, linkedClaimCount: 1, receiptsCount: 0, includeCounterHypothesis: true, includeDimensionProfile: false, taskCompletionRate: 0.80, confidenceCalibration: 0.55, falseConfidenceRate: 0.10, timeToFirstUsableDraftMs: 1010, blockedStepCount: 2, toolCallCount: 3, tokenCount: 880, wallClockMs: 1320, humanEditDistance: 53 },
    deeptrace: { factCount: 3, relationshipCount: 2, causalRelationshipCount: 1, limitationCount: 2, evidenceCount: 4, linkedClaimCount: 4, receiptsCount: 4, includeCounterHypothesis: true, includeDimensionProfile: true, taskCompletionRate: 0.96, confidenceCalibration: 0.89, falseConfidenceRate: 0.02, timeToFirstUsableDraftMs: 1440, blockedStepCount: 0, toolCallCount: 10, tokenCount: 1740, wallClockMs: 2050, humanEditDistance: 15 },
  },
];

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clampRatio(value: number, target: number): number {
  if (target <= 0) return 1;
  return Math.max(0, Math.min(1, value / target));
}

function repoRelative(filePath: string): string {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
}

function getRepoCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    return "unknown";
  }
}

function getPromptPath(mode: BenchmarkMode): string {
  return mode === "baseline" ? BASELINE_PROMPT_PATH : DEEPTRACE_PROMPT_PATH;
}

function getMcpConfig(mode: BenchmarkMode): Record<string, unknown> {
  return mode === "baseline"
    ? { builtinToolsOnly: true, nodebenchMcp: false, customCliBridge: false }
    : { builtinToolsOnly: false, nodebenchMcp: true, customCliBridge: true, traceBundles: true, receiptsRequired: true };
}

function buildOutput(testCase: BenchmarkCase, mode: BenchmarkMode, profile: SyntheticProfile): NormalizedOutput {
  const observedFacts = Array.from({ length: profile.factCount }, (_, index) => `${testCase.subject} fact ${index + 1}: ${testCase.scenario}`);
  const relationships = Array.from({ length: profile.relationshipCount }, (_, index) => ({
    source: testCase.subject,
    target: `${testCase.subject} counterpart ${index + 1}`,
    relation: index < profile.causalRelationshipCount ? "causal_influence" : "linked_signal",
    evidenceRefs: index < Math.min(profile.linkedClaimCount, profile.relationshipCount) ? [`ev-${index + 1}`] : [],
  }));
  const evidence = Array.from({ length: profile.evidenceCount }, (_, index) => ({
    id: `ev-${index + 1}`,
    claim: `${testCase.subject} evidence-backed claim ${index + 1}`,
    source: mode === "baseline" ? "repo_snapshot" : "deeptrace_trace_bundle",
  }));
  const receipts = Array.from({ length: profile.receiptsCount }, (_, index) => ({
    step: `step-${index + 1}`,
    status: "completed" as const,
    note: `${mode} execution receipt for ${testCase.benchmarkCaseId}`,
  }));
  const limitations = Array.from({ length: profile.limitationCount }, (_, index) => `${testCase.subject} limitation ${index + 1}: evidence remains bounded to the supplied benchmark fixture.`);

  return {
    observed_facts: observedFacts,
    relationships,
    dimension_profile: profile.includeDimensionProfile
      ? {
          status: "bounded",
          coverage: clampRatio(profile.factCount + profile.relationshipCount, testCase.targets.factCount + testCase.targets.relationshipCount),
          traceability: clampRatio(profile.linkedClaimCount, testCase.targets.evidenceLinkCount),
          subject: testCase.subject,
        }
      : {},
    hypothesis: `${testCase.subject} likely benefits from a ${mode === "baseline" ? "coarse" : "trace-backed"} next action aligned to ${testCase.familyId}.`,
    counter_hypothesis: profile.includeCounterHypothesis
      ? `${testCase.subject} may instead reflect noise or missing evidence, so claims should remain bounded.`
      : "",
    recommendation: `Prioritize the next review step for ${testCase.subject} using the ${mode} benchmark contract.`,
    limitations,
    receipts,
    evidence,
  };
}

function buildArtifactPayload(mode: BenchmarkMode, output: NormalizedOutput): Record<string, unknown> {
  if (mode === "baseline") {
    return {
      observed_facts: output.observed_facts,
      relationships: output.relationships,
      hypothesis: output.hypothesis,
      counter_hypothesis: output.counter_hypothesis,
      recommendation: output.recommendation,
      limitations: output.limitations,
    };
  }
  return {
    observed_facts: output.observed_facts,
    relationships: output.relationships,
    dimension_profile: output.dimension_profile,
    hypothesis: output.hypothesis,
    counter_hypothesis: output.counter_hypothesis,
    recommendation: output.recommendation,
    limitations: output.limitations,
    receipts: output.receipts,
    evidence: output.evidence,
  };
}

function validateRequiredOutputs(family: BenchmarkFamily, output: NormalizedOutput): void {
  for (const key of family.requiredOutputs) {
    const present = Object.prototype.hasOwnProperty.call(output, key);
    if (!present) {
      throw new Error(`Missing required output '${key}' for family '${family.id}'.`);
    }
  }
}

function scoreRun(weights: ScorecardSchema["weights"], targets: CaseTargets, profile: SyntheticProfile, output: NormalizedOutput): { dimensionScores: ScorecardSchema["weights"]; weightedScore: number; trackedMetrics: Record<string, number>; } {
  const dimensionScores = {
    factualAccuracy: clampRatio(output.observed_facts.length, targets.factCount),
    relationshipAccuracy: clampRatio(output.relationships.length, targets.relationshipCount),
    causalChainQuality: clampRatio(profile.causalRelationshipCount, targets.causalLinkCount),
    counterHypothesisQuality: output.counter_hypothesis ? 1 : 0,
    limitationsHonesty: clampRatio(output.limitations.length, targets.limitationCount),
    evidenceLinkage: clampRatio(profile.linkedClaimCount, targets.evidenceLinkCount),
    receiptCompleteness: targets.receiptCount === 0 ? 1 : clampRatio(output.receipts.length, targets.receiptCount),
    humanEditDistance: Math.max(0, 1 - profile.humanEditDistance / 100),
  };

  const weightedScore =
    dimensionScores.factualAccuracy * weights.factualAccuracy +
    dimensionScores.relationshipAccuracy * weights.relationshipAccuracy +
    dimensionScores.causalChainQuality * weights.causalChainQuality +
    dimensionScores.counterHypothesisQuality * weights.counterHypothesisQuality +
    dimensionScores.limitationsHonesty * weights.limitationsHonesty +
    dimensionScores.evidenceLinkage * weights.evidenceLinkage +
    dimensionScores.receiptCompleteness * weights.receiptCompleteness +
    dimensionScores.humanEditDistance * weights.humanEditDistance;

  return {
    dimensionScores,
    weightedScore,
    trackedMetrics: {
      taskCompletionRate: profile.taskCompletionRate,
      confidenceCalibration: profile.confidenceCalibration,
      falseConfidenceRate: profile.falseConfidenceRate,
      timeToFirstUsableDraftMs: profile.timeToFirstUsableDraftMs,
      blockedStepCount: profile.blockedStepCount,
    },
  };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function writeJson(filePath: string, value: object): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify({ ...value, ...SIMULATION_EVIDENCE }, null, 2));
}

function writeMarkdown(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, SIMULATION_NOTICE + content);
}

function buildRunArtifacts(
  suiteDir: string,
  testCase: BenchmarkCase,
  family: BenchmarkFamily,
  mode: BenchmarkMode,
  output: NormalizedOutput,
  dimensionScores: ScorecardSchema["weights"],
  weightedScore: number,
  trackedMetrics: Record<string, number>,
  metadataBase: Omit<RunMetadata, "artifactPaths">,
): RunMetadata {
  const modeDir = path.join(suiteDir, testCase.benchmarkCaseId, mode);
  const resultPath = path.join(modeDir, mode === "baseline" ? "baseline_result.json" : "tool_result.json");
  const reportPath = path.join(modeDir, mode === "baseline" ? "baseline_report.md" : "tool_report.md");
  const tracePath = mode === "deeptrace" ? path.join(modeDir, "tool_trace_bundle.json") : null;
  const metadataPath = path.join(modeDir, "run-metadata.json");
  const artifactPaths = [resultPath, reportPath, tracePath, metadataPath].filter((value): value is string => Boolean(value)).map(repoRelative);

  writeJson(resultPath, buildArtifactPayload(mode, output));
  writeMarkdown(
    reportPath,
    [
      `# ${testCase.title} (${mode})`,
      "",
      `- Family: ${family.label}`,
      `- Weighted score: ${weightedScore.toFixed(4)}`,
      `- Facts: ${output.observed_facts.length}`,
      `- Relationships: ${output.relationships.length}`,
      `- Evidence linkage: ${dimensionScores.evidenceLinkage.toFixed(2)}`,
      `- Receipt completeness: ${dimensionScores.receiptCompleteness.toFixed(2)}`,
      `- Time to first usable draft: ${trackedMetrics.timeToFirstUsableDraftMs.toFixed(0)}ms`,
    ].join("\n"),
  );
  if (tracePath) {
    writeJson(tracePath, {
      benchmarkCaseId: testCase.benchmarkCaseId,
      mode,
      receipts: output.receipts,
      evidence: output.evidence,
      dimension_profile: output.dimension_profile,
    });
  }

  const metadata: RunMetadata = { ...metadataBase, artifactPaths };
  writeJson(metadataPath, metadata);
  return metadata;
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--simulate")) {
    throw new Error("This runner only generates synthetic diagnostics. Pass --simulate explicitly; measured evaluation is not implemented. No artifacts were written.");
  }
  const outDir = getArg("--outDir") ? path.resolve(REPO_ROOT, getArg("--outDir")!) : RESULTS_DIR;
  const spec = readJsonFile<BenchmarkSpec>(SPEC_PATH);
  const scorecard = readJsonFile<ScorecardSchema>(SCORECARD_PATH);
  const baselinePromptHash = sha256(fs.readFileSync(BASELINE_PROMPT_PATH, "utf-8"));
  const deeptracePromptHash = sha256(fs.readFileSync(DEEPTRACE_PROMPT_PATH, "utf-8"));
  const repoCommit = getRepoCommit();
  const suiteId = `paired-${Date.now()}`;
  const suiteDir = path.join(outDir, suiteId);
  ensureDir(suiteDir);

  const caseResults = CASES.map((testCase) => {
    const family = spec.families.find((candidate) => candidate.id === testCase.familyId);
    if (!family) {
      throw new Error(`Unknown benchmark family '${testCase.familyId}'.`);
    }

    const inputSnapshotHash = sha256(JSON.stringify({ subject: testCase.subject, scenario: testCase.scenario, targets: testCase.targets }));
    const baselineOutput = buildOutput(testCase, "baseline", testCase.baseline);
    const deeptraceOutput = buildOutput(testCase, "deeptrace", testCase.deeptrace);
    validateRequiredOutputs(family, baselineOutput);
    validateRequiredOutputs(family, deeptraceOutput);

    const baselineScore = scoreRun(scorecard.weights, testCase.targets, testCase.baseline, baselineOutput);
    const deeptraceScore = scoreRun(scorecard.weights, testCase.targets, testCase.deeptrace, deeptraceOutput);

    const baselineMetadata = buildRunArtifacts(
      suiteDir,
      testCase,
      family,
      "baseline",
      baselineOutput,
      baselineScore.dimensionScores,
      baselineScore.weightedScore,
      baselineScore.trackedMetrics,
      {
        runId: `${suiteId}-${testCase.benchmarkCaseId}-baseline`,
        benchmarkCaseId: testCase.benchmarkCaseId,
        mode: "baseline",
        timestamp: new Date().toISOString(),
        repoCommit,
        inputSnapshotHash,
        promptTemplateHash: baselinePromptHash,
        mcpConfigHash: sha256(JSON.stringify(getMcpConfig("baseline"))),
        modelName: "claude-code-simulated-baseline",
        claudeCodeVersion: null,
        wallClockMs: testCase.baseline.wallClockMs,
        toolCallCount: testCase.baseline.toolCallCount,
        tokenCount: testCase.baseline.tokenCount,
      },
    );
    const deeptraceMetadata = buildRunArtifacts(
      suiteDir,
      testCase,
      family,
      "deeptrace",
      deeptraceOutput,
      deeptraceScore.dimensionScores,
      deeptraceScore.weightedScore,
      deeptraceScore.trackedMetrics,
      {
        runId: `${suiteId}-${testCase.benchmarkCaseId}-deeptrace`,
        benchmarkCaseId: testCase.benchmarkCaseId,
        mode: "deeptrace",
        timestamp: new Date().toISOString(),
        repoCommit,
        inputSnapshotHash,
        promptTemplateHash: deeptracePromptHash,
        mcpConfigHash: sha256(JSON.stringify(getMcpConfig("deeptrace"))),
        modelName: "claude-code-simulated-nodebench",
        claudeCodeVersion: null,
        wallClockMs: testCase.deeptrace.wallClockMs,
        toolCallCount: testCase.deeptrace.toolCallCount,
        tokenCount: testCase.deeptrace.tokenCount,
      },
    );

    return {
      benchmarkCaseId: testCase.benchmarkCaseId,
      familyId: family.id,
      familyLabel: family.label,
      baseline: { metadata: baselineMetadata, score: baselineScore.weightedScore, dimensions: baselineScore.dimensionScores, trackedMetrics: baselineScore.trackedMetrics },
      deeptrace: { metadata: deeptraceMetadata, score: deeptraceScore.weightedScore, dimensions: deeptraceScore.dimensionScores, trackedMetrics: deeptraceScore.trackedMetrics },
      comparison: {
        baselineScore: baselineScore.weightedScore,
        deeptraceScore: deeptraceScore.weightedScore,
        relativeUplift: (deeptraceScore.weightedScore - baselineScore.weightedScore) / Math.max(baselineScore.weightedScore, 0.0001),
        regression: deeptraceScore.weightedScore < baselineScore.weightedScore,
      },
    };
  });

  const baselineScores = caseResults.map((result) => result.baseline.score);
  const deeptraceScores = caseResults.map((result) => result.deeptrace.score);
  const summary = {
    suiteId,
    benchmarkName: spec.name,
    benchmarkVersion: spec.version,
    timestamp: new Date().toISOString(),
    repoCommit,
    promptTemplateHashes: { baseline: baselinePromptHash, deeptrace: deeptracePromptHash },
    scorecardWeights: scorecard.weights,
    metadataKeys: spec.metadataKeys,
    comparisonOutputs: scorecard.comparisonOutputs,
    cases: caseResults,
    simulationDiagnostics: {
      baselineScore: average(baselineScores),
      deeptraceScore: average(deeptraceScores),
      relativeUplift: (average(deeptraceScores) - average(baselineScores)) / Math.max(average(baselineScores), 0.0001),
      regression: average(deeptraceScores) < average(baselineScores),
      averages: {
        baseline: {
          evidenceLinkage: average(caseResults.map((result) => result.baseline.dimensions.evidenceLinkage)),
          receiptCompleteness: average(caseResults.map((result) => result.baseline.dimensions.receiptCompleteness)),
          falseConfidenceRate: average(caseResults.map((result) => result.baseline.trackedMetrics.falseConfidenceRate)),
        },
        deeptrace: {
          evidenceLinkage: average(caseResults.map((result) => result.deeptrace.dimensions.evidenceLinkage)),
          receiptCompleteness: average(caseResults.map((result) => result.deeptrace.dimensions.receiptCompleteness)),
          falseConfidenceRate: average(caseResults.map((result) => result.deeptrace.trackedMetrics.falseConfidenceRate)),
        },
      },
    },
  };

  const thresholdChecks = {
    relativeUpliftPass: summary.simulationDiagnostics.relativeUplift >= spec.releaseGuards.minimumRelativeUplift,
    evidenceLinkagePass: summary.simulationDiagnostics.averages.deeptrace.evidenceLinkage >= spec.releaseGuards.minimumEvidenceLinkage,
    receiptCompletenessPass: summary.simulationDiagnostics.averages.deeptrace.receiptCompleteness >= spec.releaseGuards.minimumReceiptCompleteness,
    falseConfidencePass: summary.simulationDiagnostics.averages.deeptrace.falseConfidenceRate <= spec.releaseGuards.maximumFalseConfidenceRate,
  };

  const finalSummary = { ...summary, simulationDiagnostics: { ...summary.simulationDiagnostics, thresholdChecks } };
  const summaryPath = path.join(suiteDir, "paired-summary.json");
  const reportPath = path.join(suiteDir, "paired-summary.md");
  writeJson(summaryPath, finalSummary);
  writeMarkdown(
    reportPath,
    [
      `# DeepTrace paired simulation ${suiteId}`,
      "",
      `- Simulated baseline score: ${finalSummary.simulationDiagnostics.baselineScore.toFixed(4)}`,
      `- Simulated DeepTrace score: ${finalSummary.simulationDiagnostics.deeptraceScore.toFixed(4)}`,
      `- Simulated relative uplift: ${(finalSummary.simulationDiagnostics.relativeUplift * 100).toFixed(2)}%`,
      `- Simulated DeepTrace evidence linkage: ${finalSummary.simulationDiagnostics.averages.deeptrace.evidenceLinkage.toFixed(2)}`,
      `- Simulated DeepTrace receipt completeness: ${finalSummary.simulationDiagnostics.averages.deeptrace.receiptCompleteness.toFixed(2)}`,
      `- Simulated DeepTrace false-confidence rate: ${finalSummary.simulationDiagnostics.averages.deeptrace.falseConfidenceRate.toFixed(2)}`,
      `- Simulation diagnostic thresholds (not release guards): ${JSON.stringify(thresholdChecks)}`,
    ].join("\n"),
  );

  console.log("SIMULATION — synthetic fixture diagnostics; prompts are hashed, not executed.");
  console.log("Release eligible: false. Measured evaluation is not implemented.");
  console.log(`Paired simulation suite: ${suiteId}`);
  console.log(`Cases: ${caseResults.length}`);
  console.log(`Simulated baseline score: ${finalSummary.simulationDiagnostics.baselineScore.toFixed(4)}`);
  console.log(`Simulated DeepTrace score: ${finalSummary.simulationDiagnostics.deeptraceScore.toFixed(4)}`);
  console.log(`Simulated relative uplift: ${(finalSummary.simulationDiagnostics.relativeUplift * 100).toFixed(2)}%`);
  console.log(`Summary JSON: ${repoRelative(summaryPath)}`);
  console.log(`Summary report: ${repoRelative(reportPath)}`);
  console.log(`Simulation diagnostic thresholds (not release guards): ${JSON.stringify(thresholdChecks)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
