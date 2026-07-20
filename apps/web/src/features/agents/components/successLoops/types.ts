export type SuccessLoopType =
  | "problem_selection"
  | "activation"
  | "retained_value"
  | "outcome_attribution"
  | "distribution_proof"
  | "revenue_expansion"
  | "market_sensing"
  | "organization_learning";

export type SuccessLoopHealth = "strengthening" | "mixed" | "weakening" | "missing";
export type MetricSource = "observed" | "proxy" | "manual" | "missing";

export interface SuccessLoopMetricValue {
  key: string;
  label: string;
  value: number;
  displayValue: string;
  score: number;
  unit?: string;
  source: MetricSource;
  targetDirection: "higher" | "lower" | "balanced";
  note?: string;
}

export interface SuccessLoopCard {
  loopId: string;
  loopType: SuccessLoopType;
  title: string;
  goal: string;
  owner: string;
  reviewCadence: string;
  currentState: string;
  status: SuccessLoopHealth;
  score: number;
  leadingMetrics: SuccessLoopMetricValue[];
  laggingMetrics: SuccessLoopMetricValue[];
  interventionTypes: string[];
  lastReviewAt?: number;
  nextReviewAt: number;
  gaps: string[];
}

export interface SuccessLoopTopExperiment {
  experimentKey: string;
  loopType: SuccessLoopType;
  title: string;
  status: string;
  owner: string;
  expectedEffect: string;
  outcomeSummary?: string;
  observedDelta?: number;
  observationWindowDays?: number;
}

export interface SuccessLoopDecisionCard {
  decisionKey: string;
  title: string;
  decisionType: string;
  owner: string;
  confidence: number;
  status: string;
  createdAt: number;
  latestOutcomeVerdict?: string;
  expectedOutcomeSummary?: string;
  observationWindowDays?: number;
}

export interface SuccessLoopProofNode {
  nodeKey: string;
  label: string;
  kind: "benchmark" | "dogfood" | "case_study" | "social_post" | "pipeline";
  score: number;
  value: string;
  detail: string;
}

export interface SuccessLoopProofEdge {
  source: string;
  target: string;
  label: string;
  strength: number;
}

export interface SuccessLoopAccountNode {
  accountKey: string;
  label: string;
  activationState: SuccessLoopHealth;
  retentionState: SuccessLoopHealth;
  expansionState: SuccessLoopHealth;
  workflowRuns30d: number;
  timeToFirstValueMinutes?: number;
  integrationsConnected: number;
}

export interface SuccessLoopsDashboardSnapshot {
  generatedAt?: number;
  entityKey?: string;
  entityType?: string;
  summary: {
    totalLoops: number;
    strengtheningCount: number;
    mixedCount: number;
    weakeningCount: number;
    missingCount: number;
    strongestLoop?: { loopType: SuccessLoopType; title: string; score: number } | null;
    weakestLoop?: { loopType: SuccessLoopType; title: string; score: number } | null;
  };
  loops: SuccessLoopCard[];
  topExperiments: SuccessLoopTopExperiment[];
  frozenDecisions: SuccessLoopDecisionCard[];
  proofGraph: {
    nodes: SuccessLoopProofNode[];
    edges: SuccessLoopProofEdge[];
  };
  accountValueGraph: {
    nodes: SuccessLoopAccountNode[];
  };
  nextRecommendedAction: string;
}
