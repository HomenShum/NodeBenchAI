// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const RESEARCH_CELL_DEFAULTS = {
  maxBranches: 3,
  maxRefinementRounds: 2,
  maxWallClockMs: 90_000,
  maxToolCallsPerBranch: 15,
  /** Confidence threshold below which the cell triggers */
  confidenceThreshold: 0.65,
  /** Dimension coverage threshold below which the cell triggers */
  coverageThreshold: 0.70,
  /** Minimum durable sources required to skip the cell */
  minDurableSources: 3,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResearchBranchStrategy =
  | "evidence_gap_fill"
  | "counter_hypothesis"
  | "dimension_coverage"
  | "source_diversification";

export interface ResearchBranch {
  branchId: string;
  strategy: ResearchBranchStrategy;
  query: string;
  priority: number;
}

export interface BranchResult {
  branchId: string;
  strategy: ResearchBranchStrategy;
  observedFacts: string[];
  relationships: Array<{
    fromEntity: string;
    toEntity: string;
    type: string;
    confidence: number;
    evidence: string;
  }>;
  hypothesis: string | null;
  counterHypothesis: string | null;
  evidenceRefs: Array<{
    label: string;
    href?: string;
    kind?: string;
  }>;
  usefulness: number;
  toolCallCount: number;
  wallClockMs: number;
}

export interface ResearchCellOutput {
  triggered: boolean;
  triggerReason: string | null;
  branchCount: number;
  refinementRounds: number;
  totalWallClockMs: number;
  observedFacts: string[];
  relationships: Array<{
    fromEntity: string;
    toEntity: string;
    type: string;
    confidence: number;
    evidence: string;
  }>;
  dimensionProfile: Record<string, number> | null;
  strongestHypothesis: string | null;
  counterHypothesis: string | null;
  recommendation: string | null;
  limitations: string[];
  receipts: Array<{
    branchId: string;
    strategy: string;
    toolCallCount: number;
    wallClockMs: number;
    usefulness: number;
  }>;
  evidenceBundle: Array<{
    label: string;
    href?: string;
    kind?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Trigger evaluation
// ---------------------------------------------------------------------------

export interface TriggerInput {
  confidence: number;
  dimensionCoverage: number;
  durableSourceCount: number;
  operatorRequested: boolean;
}

export function shouldTriggerResearchCell(input: TriggerInput): {
  trigger: boolean;
  reason: string | null;
} {
  if (input.operatorRequested) {
    return { trigger: true, reason: "operator_requested" };
  }
  if (input.confidence < RESEARCH_CELL_DEFAULTS.confidenceThreshold) {
    return {
      trigger: true,
      reason: `confidence ${input.confidence.toFixed(2)} < ${RESEARCH_CELL_DEFAULTS.confidenceThreshold}`,
    };
  }
  if (input.dimensionCoverage < RESEARCH_CELL_DEFAULTS.coverageThreshold) {
    return {
      trigger: true,
      reason: `dimensionCoverage ${input.dimensionCoverage.toFixed(2)} < ${RESEARCH_CELL_DEFAULTS.coverageThreshold}`,
    };
  }
  if (input.durableSourceCount < RESEARCH_CELL_DEFAULTS.minDurableSources) {
    return {
      trigger: true,
      reason: `durableSources ${input.durableSourceCount} < ${RESEARCH_CELL_DEFAULTS.minDurableSources}`,
    };
  }
  return { trigger: false, reason: null };
}

// ---------------------------------------------------------------------------
// Branch planning
// ---------------------------------------------------------------------------

export function planResearchBranches(
  triggerReason: string,
  entityKey: string,
  existingFacts: string[],
  maxBranches: number = RESEARCH_CELL_DEFAULTS.maxBranches,
): ResearchBranch[] {
  const branches: ResearchBranch[] = [];
  let nextId = 0;

  // Always start with evidence gap fill when sources are sparse
  if (triggerReason.includes("durableSources") || triggerReason.includes("evidenceLinkage")) {
    branches.push({
      branchId: `branch-${nextId++}`,
      strategy: "evidence_gap_fill",
      query: `Find additional durable evidence sources for ${entityKey} to improve linkage`,
      priority: 1,
    });
  }

  // Counter-hypothesis when confidence is low
  if (triggerReason.includes("confidence") || triggerReason === "operator_requested") {
    branches.push({
      branchId: `branch-${nextId++}`,
      strategy: "counter_hypothesis",
      query: `Generate and evaluate counter-hypotheses for ${entityKey} given: ${existingFacts.slice(0, 3).join("; ")}`,
      priority: 2,
    });
  }

  // Dimension coverage when profile is sparse
  if (triggerReason.includes("dimensionCoverage") || triggerReason === "operator_requested") {
    branches.push({
      branchId: `branch-${nextId++}`,
      strategy: "dimension_coverage",
      query: `Fill missing dimension metrics for ${entityKey} across time/capital/people/market/network/operations/narrative`,
      priority: 1,
    });
  }

  // Source diversification as a lower-priority branch
  if (branches.length < maxBranches) {
    branches.push({
      branchId: `branch-${nextId++}`,
      strategy: "source_diversification",
      query: `Find diverse source types (filings, news, social, academic) for ${entityKey}`,
      priority: 3,
    });
  }

  return branches
    .sort((a, b) => a.priority - b.priority)
    .slice(0, maxBranches);
}

// ---------------------------------------------------------------------------
// Branch result judging
// ---------------------------------------------------------------------------

export function judgeBranches(results: BranchResult[]): BranchResult[] {
  return [...results].sort((a, b) => b.usefulness - a.usefulness);
}

// ---------------------------------------------------------------------------
// Result merging
// ---------------------------------------------------------------------------

export function mergeBranchResults(
  rankedResults: BranchResult[],
  entityKey: string,
): Omit<ResearchCellOutput, "triggered" | "triggerReason" | "branchCount" | "refinementRounds" | "totalWallClockMs"> {
  const allFacts = dedupeStrings(rankedResults.flatMap((r) => r.observedFacts));
  const allRelationships = dedupeRelationships(rankedResults.flatMap((r) => r.relationships));
  const allEvidence = dedupeEvidence(rankedResults.flatMap((r) => r.evidenceRefs));

  // Strongest hypothesis from the highest-ranked branch
  const strongestHypothesis = rankedResults.find((r) => r.hypothesis)?.hypothesis ?? null;
  const counterHypothesis = rankedResults.find((r) => r.counterHypothesis)?.counterHypothesis ?? null;

  // Build recommendation from top-2 branches
  const topBranches = rankedResults.slice(0, 2);
  const recommendation = topBranches.length > 0
    ? `Based on ${topBranches.length} research branches for ${entityKey}: ${topBranches.map((b) => `[${b.strategy}] usefulness=${b.usefulness.toFixed(2)}`).join(", ")}. ${strongestHypothesis ?? "No dominant hypothesis emerged."}`
    : null;

  const limitations: string[] = [];
  if (allFacts.length === 0) limitations.push("No new facts discovered across branches.");
  if (allEvidence.length < 3) limitations.push("Evidence bundle remains sparse.");
  const lowUseful = rankedResults.filter((r) => r.usefulness < 0.3);
  if (lowUseful.length > 0) {
    limitations.push(`${lowUseful.length} branch(es) produced low-usefulness results.`);
  }

  const receipts = rankedResults.map((r) => ({
    branchId: r.branchId,
    strategy: r.strategy,
    toolCallCount: r.toolCallCount,
    wallClockMs: r.wallClockMs,
    usefulness: r.usefulness,
  }));

  return {
    observedFacts: allFacts,
    relationships: allRelationships,
    dimensionProfile: null,
    strongestHypothesis,
    counterHypothesis,
    recommendation,
    limitations,
    receipts,
    evidenceBundle: allEvidence,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedupeStrings(items: string[]): string[] {
  return [...new Set(items)];
}

function dedupeRelationships(
  items: BranchResult["relationships"],
): BranchResult["relationships"] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.fromEntity}|${item.toEntity}|${item.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeEvidence(
  items: BranchResult["evidenceRefs"],
): BranchResult["evidenceRefs"] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify([item.label, item.href ?? ""]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
