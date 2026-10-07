export type TrajectoryScoreLabel = "compounding" | "improving" | "flat" | "drifting";

export type TrajectoryScoreCard = {
  score: number;
  label: TrajectoryScoreLabel;
  explanation: string;
};

export type TrajectorySummaryData = {
  entityKey: string;
  entityType: string;
  windowDays: number;
  summary: string;
  narrative: string;
  nextReviewAt: number;
  spanCount: number;
  evidenceBundleCount: number;
  verdictCount: number;
  feedbackCount: number;
  interventionCount: number;
  benchmarkCount: number;
  trustNodeCount: number;
  trustEdgeCount: number;
  topInterventions: Array<{
    title: string;
    observedScoreDelta?: number;
    status: string;
  }>;
  scoreBreakdown: {
    spanQuality: TrajectoryScoreCard;
    evidenceCompleteness: TrajectoryScoreCard;
    adaptationVelocity: TrajectoryScoreCard;
    trustLeverage: TrajectoryScoreCard;
    interventionEffect: TrajectoryScoreCard;
    drift: TrajectoryScoreCard;
    rawCompounding: TrajectoryScoreCard;
    trustAdjustedCompounding: TrajectoryScoreCard;
  };
};

export type TrajectoryTimelineItem = {
  id: string;
  kind: "span" | "verdict" | "feedback" | "intervention" | "benchmark";
  title: string;
  summary: string;
  status: string;
  occurredAt: number;
  score?: number;
  sourceRecordType?: string;
  sourceRecordId?: string;
};

export type TrajectoryCompoundingData = {
  entityKey: string;
  entityType: string;
  windowDays: number;
  rawScore: number;
  rawLabel: TrajectoryScoreLabel;
  rawExplanation: string;
  trustAdjustedScore: number;
  trustAdjustedLabel: TrajectoryScoreLabel;
  trustAdjustedExplanation: string;
  driftScore: number;
  driftLabel: TrajectoryScoreLabel;
  driftExplanation: string;
};
