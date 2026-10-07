import type { Doc } from "../../_generated/dataModel";

export const TRAJECTORY_ENTITY_TYPES = [
  "workflow",
  "agent",
  "mission",
  "product",
  "startup",
  "founder",
  "team",
] as const;

export type TrajectoryEntityType = (typeof TRAJECTORY_ENTITY_TYPES)[number];

export const TRAJECTORY_SCORE_LABELS = [
  "compounding",
  "improving",
  "flat",
  "drifting",
] as const;

export type TrajectoryScoreLabel = (typeof TRAJECTORY_SCORE_LABELS)[number];

export type TrajectoryWindow = {
  windowDays: number;
  windowStart: number;
  windowEnd: number;
};

export type TrajectoryScoreCard = {
  score: number;
  label: TrajectoryScoreLabel;
  explanation: string;
};

export type TrajectoryScoreBreakdown = {
  spanQuality: TrajectoryScoreCard;
  evidenceCompleteness: TrajectoryScoreCard;
  adaptationVelocity: TrajectoryScoreCard;
  trustLeverage: TrajectoryScoreCard;
  interventionEffect: TrajectoryScoreCard;
  drift: TrajectoryScoreCard;
  rawCompounding: TrajectoryScoreCard;
  trustAdjustedCompounding: TrajectoryScoreCard;
};

export type TrajectoryScoreInputs = {
  spanCount: number;
  completedSpanRatio: number;
  errorSpanRatio: number;
  averageVerdictConfidence: number;
  verdictPassRatio: number;
  evidenceBundleCount: number;
  sourceRefCount: number;
  checklistPassRatio: number;
  feedbackPositiveRatio: number;
  benchmarkImprovementRatio: number;
  interventionCount: number;
  interventionSuccessRatio: number;
  averageInterventionUplift: number;
  trustAmplification: number;
  driftPressure: number;
};

export type TrajectorySourceRef = {
  label: string;
  href?: string;
  note?: string;
  kind?: string;
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

export function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function normalizeWindowDays(value?: number | null) {
  if (!value || !Number.isFinite(value)) return 90;
  return Math.max(7, Math.min(365, Math.round(value)));
}

export function createTrajectoryWindow(windowDays?: number | null, now = Date.now()): TrajectoryWindow {
  const normalizedDays = normalizeWindowDays(windowDays);
  return {
    windowDays: normalizedDays,
    windowStart: now - normalizedDays * 24 * 60 * 60 * 1000,
    windowEnd: now,
  };
}

export function slugifyTrajectoryValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeTrajectoryEntityType(value?: string | null): TrajectoryEntityType {
  switch (value) {
    case "workflow":
    case "agent":
    case "mission":
    case "product":
    case "startup":
    case "founder":
    case "team":
      return value;
    case "company":
      return "startup";
    case "person":
      return "founder";
    default:
      return "product";
  }
}

export function getDefaultProductEntityKey() {
  return "product:nodebench-ai";
}

export function buildTrajectoryEntityKey(entityType: TrajectoryEntityType, value: string) {
  if (value.startsWith(`${entityType}:`)) return value;
  return `${entityType}:${slugifyTrajectoryValue(value)}`;
}

export function inferTrajectoryEntityLabel(entityKey: string, entityType: TrajectoryEntityType) {
  const [, rawValue = entityKey] = entityKey.split(":");
  const label = rawValue
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
  if (label) return label;
  if (entityType === "product") return "NodeBench AI";
  return entityKey;
}

function scoreLabel(value: number, driftScore?: number): TrajectoryScoreLabel {
  if (driftScore !== undefined && driftScore >= 0.58 && value < 0.62) {
    return "drifting";
  }
  if (value >= 0.74) return "compounding";
  if (value >= 0.58) return "improving";
  if (value >= 0.4) return "flat";
  return "drifting";
}

function card(score: number, explanation: string, driftScore?: number): TrajectoryScoreCard {
  const normalized = clampScore(score);
  return {
    score: normalized,
    label: scoreLabel(normalized, driftScore),
    explanation,
  };
}

function driftCard(score: number, explanation: string): TrajectoryScoreCard {
  const normalized = clampScore(score);
  let label: TrajectoryScoreLabel = "drifting";
  if (normalized <= 0.25) {
    label = "compounding";
  } else if (normalized <= 0.45) {
    label = "improving";
  } else if (normalized <= 0.6) {
    label = "flat";
  }
  return {
    score: normalized,
    label,
    explanation,
  };
}

export function computeTrajectoryScores(inputs: TrajectoryScoreInputs): TrajectoryScoreBreakdown {
  const spanEvidenceDensity = clampScore(inputs.sourceRefCount / Math.max(inputs.spanCount * 3, 6));
  const interventionUpliftNormalized = clampScore(inputs.averageInterventionUplift);
  const benchmarkLiftNormalized = clampScore(inputs.benchmarkImprovementRatio);
  const trustReduction = clampScore(inputs.trustAmplification * 0.35);

  const spanQuality = clampScore(
    inputs.completedSpanRatio * 0.45 +
      inputs.verdictPassRatio * 0.35 +
      (1 - inputs.errorSpanRatio) * 0.2,
  );

  const evidenceCompleteness = clampScore(
    spanEvidenceDensity * 0.4 +
      clampScore(inputs.checklistPassRatio) * 0.35 +
      inputs.averageVerdictConfidence * 0.25,
  );

  const adaptationVelocity = clampScore(
    inputs.interventionSuccessRatio * 0.45 +
      interventionUpliftNormalized * 0.35 +
      inputs.feedbackPositiveRatio * 0.2,
  );

  const trustLeverage = clampScore(inputs.trustAmplification);

  const interventionEffect = clampScore(
    interventionUpliftNormalized * 0.6 +
      benchmarkLiftNormalized * 0.4,
  );

  const drift = clampScore(
    inputs.driftPressure * 0.5 +
      inputs.errorSpanRatio * 0.3 +
      (1 - inputs.feedbackPositiveRatio) * 0.2,
  );

  const rawCompounding = clampScore(
    spanQuality * 0.22 +
      evidenceCompleteness * 0.18 +
      adaptationVelocity * 0.18 +
      interventionEffect * 0.16 +
      benchmarkLiftNormalized * 0.12 +
      (1 - drift) * 0.14,
  );

  const trustAdjustedCompounding = clampScore(
    rawCompounding * (1 - trustReduction) +
      inputs.feedbackPositiveRatio * 0.08 +
      clampScore(inputs.evidenceBundleCount / 8) * 0.04,
  );

  return {
    spanQuality: card(
      spanQuality,
      `${inputs.spanCount} spans projected, ${Math.round(inputs.completedSpanRatio * 100)}% completed, ${Math.round(inputs.verdictPassRatio * 100)}% judged pass/partial.`,
      drift,
    ),
    evidenceCompleteness: card(
      evidenceCompleteness,
      `${inputs.evidenceBundleCount} evidence bundles with ${inputs.sourceRefCount} linked citations and ${Math.round(inputs.checklistPassRatio * 100)}% proof-pack pass rate.`,
      drift,
    ),
    adaptationVelocity: card(
      adaptationVelocity,
      `${inputs.interventionCount} interventions observed; ${Math.round(inputs.interventionSuccessRatio * 100)}% showed positive post-window uplift.`,
      drift,
    ),
    trustLeverage: card(
      trustLeverage,
      `${Math.round(inputs.trustAmplification * 100)}% of the visible lift appears amplified by trusted channels or institutions.`,
      drift,
    ),
    interventionEffect: card(
      interventionEffect,
      `${Math.round(interventionUpliftNormalized * 100)}% normalized uplift with ${Math.round(benchmarkLiftNormalized * 100)}% benchmark improvement support.`,
      drift,
    ),
    drift: driftCard(
      drift,
      `${Math.round(inputs.driftPressure * 100)}% drift pressure from violated loops, errors, or negative feedback.`,
    ),
    rawCompounding: card(
      rawCompounding,
      "Raw compounding before trust-adjustment. Useful for audit, not for operator-facing prioritization.",
      drift,
    ),
    trustAdjustedCompounding: card(
      trustAdjustedCompounding,
      "Primary operator score after discounting externally amplified wins and weighting repeated evidence-backed improvement.",
      drift,
    ),
  };
}

export function summarizeChecklistPassRate(checklists: Array<Array<{ passed: boolean }>>) {
  const totalChecks = checklists.reduce((sum, checklist) => sum + checklist.length, 0);
  if (totalChecks === 0) return 0;
  const passedChecks = checklists.reduce(
    (sum, checklist) => sum + checklist.filter((item) => item.passed).length,
    0,
  );
  return clampScore(passedChecks / totalChecks);
}

export function summarizePositiveFeedbackRatio(
  feedbackEvents: Array<{
    status: string;
    scoreDelta?: number;
    outcomeScore?: number;
  }>,
) {
  if (!feedbackEvents.length) return 0.5;
  const positive = feedbackEvents.filter((event) => {
    if (typeof event.scoreDelta === "number") return event.scoreDelta > 0;
    if (typeof event.outcomeScore === "number") return event.outcomeScore >= 0.6;
    return event.status === "positive" || event.status === "validated" || event.status === "approved";
  }).length;
  return clampScore(positive / feedbackEvents.length);
}

export function summarizeInterventionSuccessRatio(
  interventions: Array<{
    observedScoreDelta?: number;
    status: string;
  }>,
) {
  if (!interventions.length) return 0;
  const successful = interventions.filter((intervention) => {
    if (typeof intervention.observedScoreDelta === "number") {
      return intervention.observedScoreDelta > 0;
    }
    return intervention.status === "validated" || intervention.status === "improved";
  }).length;
  return clampScore(successful / interventions.length);
}

export function summarizeAverageInterventionUplift(
  interventions: Array<{
    observedScoreDelta?: number;
    expectedScoreDelta?: number;
  }>,
) {
  if (!interventions.length) return 0;
  const values = interventions
    .map((intervention) =>
      typeof intervention.observedScoreDelta === "number"
        ? intervention.observedScoreDelta
        : typeof intervention.expectedScoreDelta === "number"
          ? intervention.expectedScoreDelta
          : 0,
    )
    .filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return clampScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizeAverageVerdictConfidence(
  verdicts: Array<{
    confidence?: number;
    compositeConfidence?: number;
  }>,
) {
  if (!verdicts.length) return 0;
  const values = verdicts
    .map((verdict) =>
      typeof verdict.confidence === "number"
        ? verdict.confidence
        : typeof verdict.compositeConfidence === "number"
          ? verdict.compositeConfidence
          : 0,
    )
    .filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return clampScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizePassRatio(
  verdicts: Array<{
    verdict?: string;
    status?: string;
  }>,
) {
  if (!verdicts.length) return 0;
  const positive = verdicts.filter((verdict) => {
    const value = verdict.verdict ?? verdict.status ?? "";
    return value === "pass" || value === "partial" || value === "improved" || value === "validated";
  }).length;
  return clampScore(positive / verdicts.length);
}

export function summarizeTrustAmplification(
  trustEdges: Array<{
    leverageScore?: number;
    confidence?: number;
  }>,
) {
  if (!trustEdges.length) return 0;
  const values = trustEdges
    .map((edge) => {
      if (typeof edge.leverageScore === "number") return edge.leverageScore;
      if (typeof edge.confidence === "number") return edge.confidence;
      return 0;
    })
    .filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return clampScore(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizeDriftPressure(params: {
  violatedLoops: number;
  driftingLoops: number;
  totalLoops: number;
  failedBenchmarks: number;
  negativeFeedbackCount: number;
}) {
  const loopPressure =
    params.totalLoops > 0
      ? clampScore((params.violatedLoops * 1 + params.driftingLoops * 0.6) / params.totalLoops)
      : 0;
  const failurePressure = clampScore(params.failedBenchmarks / Math.max(params.failedBenchmarks + 1, 3));
  const feedbackPressure = clampScore(params.negativeFeedbackCount / Math.max(params.negativeFeedbackCount + 2, 4));
  return clampScore(loopPressure * 0.5 + failurePressure * 0.3 + feedbackPressure * 0.2);
}

export function buildBenchmarkImprovementRatio(
  benchmarkRuns: Array<{
    verdict?: string;
    overallUplift?: number;
    deltaFromPrevious?: number;
  }>,
) {
  if (!benchmarkRuns.length) return 0;
  const upliftValues = benchmarkRuns.map((run) => {
    if (typeof run.overallUplift === "number") return clampScore(run.overallUplift);
    if (typeof run.deltaFromPrevious === "number") return clampScore((run.deltaFromPrevious + 1) / 2);
    return run.verdict === "improved" || run.verdict === "pass" ? 0.75 : 0.2;
  });
  return clampScore(upliftValues.reduce((sum, value) => sum + value, 0) / upliftValues.length);
}

export function toTimelineItems(input: {
  spans: Array<Pick<Doc<"trajectorySpans">, "_id" | "name" | "summary" | "status" | "createdAt" | "score" | "sourceRecordType" | "sourceRecordId">>;
  verdicts: Array<Pick<Doc<"trajectoryJudgeVerdicts">, "_id" | "verdict" | "summary" | "createdAt" | "confidence" | "sourceRecordType" | "sourceRecordId">>;
  feedbackEvents: Array<Pick<Doc<"trajectoryFeedbackEvents">, "_id" | "title" | "eventType" | "status" | "summary" | "observedAt" | "outcomeScore" | "sourceRecordType" | "sourceRecordId">>;
  interventions: Array<Pick<Doc<"trajectoryInterventionEvents">, "_id" | "title" | "status" | "summary" | "observedWindowEndAt" | "expectedWindowEndAt" | "observedScoreDelta" | "sourceRecordType" | "sourceRecordId">>;
  benchmarkRuns: Array<Pick<Doc<"trajectoryBenchmarkRuns">, "_id" | "benchmarkLabel" | "verdict" | "summary" | "createdAt" | "overallUplift" | "sourceRecordType" | "sourceRecordId">>;
}) {
  const items: TrajectoryTimelineItem[] = [
    ...input.spans.map((span) => ({
      id: String(span._id),
      kind: "span" as const,
      title: span.name,
      summary: span.summary,
      status: span.status,
      occurredAt: span.createdAt,
      score: span.score,
      sourceRecordType: span.sourceRecordType,
      sourceRecordId: span.sourceRecordId,
    })),
    ...input.verdicts.map((verdict) => ({
      id: String(verdict._id),
      kind: "verdict" as const,
      title: verdict.verdict,
      summary: verdict.summary,
      status: verdict.verdict,
      occurredAt: verdict.createdAt,
      score: verdict.confidence,
      sourceRecordType: verdict.sourceRecordType,
      sourceRecordId: verdict.sourceRecordId,
    })),
    ...input.feedbackEvents.map((event) => ({
      id: String(event._id),
      kind: "feedback" as const,
      title: event.title ?? event.eventType,
      summary: event.summary,
      status: event.status,
      occurredAt: event.observedAt,
      score: event.outcomeScore,
      sourceRecordType: event.sourceRecordType,
      sourceRecordId: event.sourceRecordId,
    })),
    ...input.interventions.map((intervention) => ({
      id: String(intervention._id),
      kind: "intervention" as const,
      title: intervention.title,
      summary: intervention.summary,
      status: intervention.status,
      occurredAt: intervention.observedWindowEndAt ?? intervention.expectedWindowEndAt,
      score: intervention.observedScoreDelta,
      sourceRecordType: intervention.sourceRecordType,
      sourceRecordId: intervention.sourceRecordId,
    })),
    ...input.benchmarkRuns.map((run) => ({
      id: String(run._id),
      kind: "benchmark" as const,
      title: run.benchmarkLabel,
      summary: run.summary,
      status: run.verdict,
      occurredAt: run.createdAt,
      score: run.overallUplift,
      sourceRecordType: run.sourceRecordType,
      sourceRecordId: run.sourceRecordId,
    })),
  ];
  return items.sort((a, b) => b.occurredAt - a.occurredAt);
}
