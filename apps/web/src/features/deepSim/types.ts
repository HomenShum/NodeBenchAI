/* ------------------------------------------------------------------ */
/*  Deep Sim — Decision Memo types                                    */
/* ------------------------------------------------------------------ */

/** Confidence thresholds used for color-coding across the feature. */
export type ConfidenceCategory = "high" | "medium" | "low" | "very_low";

export function confidenceCategory(c: number): ConfidenceCategory {
  if (c >= 0.7) return "high";
  if (c >= 0.5) return "medium";
  if (c >= 0.3) return "low";
  return "very_low";
}

/** A single evidence claim with provenance and falsification metadata. */
export interface DeepSimClaim {
  id: string;
  text: string;
  confidence: number;
  confidenceCategory: ConfidenceCategory;
  sources: string[];
  contradictions: string[];
  whatWouldChangeMyMind: string;
}

/** A variable that feeds the simulation model. */
export interface DeepSimVariable {
  id: string;
  name: string;
  category: string;
  weight: number;
  currentValue: string;
  sensitivity: "high" | "medium" | "low";
  dataCompleteness: number;
  whatWouldChangeMyMind: string;
}

/** One of at most three scenario projections. */
export interface DeepSimScenario {
  id: string;
  title: string;
  confidence: number;
  keyAssumptions: string[];
  expectedOutcome: string;
  risks: string[];
  interventionsNeeded: string[];
}

/** A ranked intervention the decision-maker can take. */
export interface DeepSimIntervention {
  rank: number;
  title: string;
  expectedDelta: string;
  confidence: number;
  category: string;
  cost: string;
  timeframe: string;
  whatWouldConfirm: string;
  whatWouldDeny: string;
}

/** An alternative model that challenges the primary recommendation. */
export interface DeepSimCounterModel {
  id: string;
  thesis: string;
  confidence: number;
  keyEvidence: string[];
  keyAssumption: string;
  whatWouldValidate: string;
}

/** Top-level decision memo produced by a Deep Sim run. */
export interface DeepSimMemo {
  question: string;
  recommendation: string;
  confidence: number;
  topVariables: DeepSimVariable[];
  scenarios: DeepSimScenario[];
  interventions: DeepSimIntervention[];
  evidence: DeepSimClaim[];
  counterModel: DeepSimCounterModel;
  forecastCheckDate: string;
  whatWouldChangeMyMind: string;
}

export interface DeepSimSourceRef {
  type: string;
  ref: string;
  summary: string;
}

export interface DeepSimEvidenceSummary {
  sourceCount: number;
  verifiedCount: number;
  partialCount: number;
  unverifiedCount: number;
}

export type HcsnNodeLevel =
  | "evidence"
  | "observation"
  | "signal"
  | "causal_chain"
  | "trajectory"
  | "intervention"
  | "outcome_loop";

export type HcsnNodeStatus = "grounded" | "inferred" | "projected" | "needs_review";

export interface HcsnNode {
  id: string;
  level: HcsnNodeLevel;
  label: string;
  summary: string;
  confidence: number;
  status: HcsnNodeStatus;
  sourceRefs: string[];
}

export type HcsnEdgeRelationship =
  | "supports"
  | "aggregates_into"
  | "signals"
  | "drives"
  | "adjusts"
  | "tests"
  | "constrains"
  | "validates";

export interface HcsnEdge {
  id: string;
  from: string;
  to: string;
  relationship: HcsnEdgeRelationship;
  confidence: number;
  explanation: string;
}

export interface HcsnGraph {
  title: string;
  thesis: string;
  topDriverNodeId: string;
  topInterventionNodeId: string;
  topRiskNodeId?: string;
  nodes: HcsnNode[];
  edges: HcsnEdge[];
}

export interface DeepSimFixture {
  key: string;
  id: string;
  name: string;
  workflow: string;
  frozenAt: string;
  memo: DeepSimMemo;
  sourcePacket: {
    sources: DeepSimSourceRef[];
  };
  evidenceSummary: DeepSimEvidenceSummary;
  hcsn: HcsnGraph;
}

/* ------------------------------------------------------------------ */
/*  Postmortem Scorecard — forecast scorekeeping                      */
/* ------------------------------------------------------------------ */

/** Outcome category describing how the prediction related to reality. */
export type PostmortemOutcomeCategory =
  | "correct"
  | "partially_correct"
  | "wrong_direction"
  | "right_concern_wrong_mechanism"
  | "right_narrative_wrong_timing"
  | "intervention_successful"
  | "intervention_noise";

/** Scorecard produced when revisiting a decision memo against actual outcomes. */
export interface PostmortemScorecard {
  memoId: string;
  originalQuestion: string;
  originalRecommendation: string;
  originalConfidence: number;
  forecastCheckDate: string;
  /** What actually happened */
  actualOutcome: string;
  outcomeCategory: PostmortemOutcomeCategory;
  /** Scoring dimensions (all 0-1) */
  variableRecall: number;
  scenarioUsefulness: number;
  interventionUsefulness: number;
  recommendationClarity: number;
  outcomeAlignment: number;
  confidenceCalibration: number;
  /** What we learned */
  whatWeMissed: string[];
  whatVariableMoved: string[];
  whatAssumptionFailed: string[];
  whatInterventionMattered: string[];
  updatedPriors: string[];
}
