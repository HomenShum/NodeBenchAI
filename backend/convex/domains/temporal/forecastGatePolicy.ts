export type ForecastTrendDirection =
  | "improving"
  | "stable"
  | "declining"
  | "volatile"
  | "insufficient_data";

export type ForecastRecommendedAction =
  | "suppress"
  | "refresh_packet"
  | "deepen_diligence"
  | "escalate"
  | "delegate"
  | "observe";

export interface ForecastPoint {
  predicted: number;
  lower: number;
  upper: number;
}

export interface ForecastGateInput {
  streamKey: string;
  values: number[];
  modelUsed?: string | null;
  forecasts?: ForecastPoint[];
  evidenceRefs?: string[];
  delegateEligible?: boolean;
}

export interface ForecastGateDecision {
  streamKey: string;
  valuesCount: number;
  modelUsed: string;
  trendDirection: ForecastTrendDirection;
  latestOutsideInterval: boolean;
  confidenceBandWidth: number | null;
  recommendedAction: ForecastRecommendedAction;
  explanation: string;
  evidenceRefs: string[];
}

function finiteValues(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

function relativeDelta(from: number, to: number): number {
  const denominator = Math.max(1, Math.abs(from));
  return (to - from) / denominator;
}

function averageConfidenceBandWidth(forecasts: ForecastPoint[] | undefined): number | null {
  if (!forecasts || forecasts.length === 0) return null;

  const widths = forecasts
    .filter((point) => Number.isFinite(point.predicted) && Number.isFinite(point.lower) && Number.isFinite(point.upper))
    .map((point) => {
      const denominator = Math.max(1, Math.abs(point.predicted));
      return Math.abs(point.upper - point.lower) / denominator;
    });

  if (widths.length === 0) return null;
  return widths.reduce((sum, value) => sum + value, 0) / widths.length;
}

function linearForecastIntervalForLatest(values: number[]): { lower: number; upper: number } | null {
  if (values.length < 4) return null;

  const history = values.slice(0, -1);
  const n = history.length;
  const xMean = (n - 1) / 2;
  const yMean = history.reduce((sum, value) => sum + value, 0) / n;

  let ssXX = 0;
  let ssXY = 0;
  for (let i = 0; i < n; i += 1) {
    ssXX += (i - xMean) ** 2;
    ssXY += (i - xMean) * (history[i]! - yMean);
  }

  const slope = ssXX === 0 ? 0 : ssXY / ssXX;
  const predictedLatest = yMean + slope * (n - xMean);
  const residuals = history.map((value, index) => value - (yMean + slope * (index - xMean)));
  const residualStd = Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / Math.max(1, residuals.length - 1));
  const minWidth = Math.max(1e-6, Math.abs(yMean) * 0.05);
  const width = Math.max(minWidth, 1.96 * residualStd);

  return {
    lower: predictedLatest - width,
    upper: predictedLatest + width,
  };
}

function classifyTrend(values: number[], forecasts: ForecastPoint[] | undefined): ForecastTrendDirection {
  if (values.length < 3) return "insufficient_data";

  const first = values[0]!;
  const latest = values[values.length - 1]!;
  const observedDelta = relativeDelta(first, latest);
  const changes = values.slice(1).map((value, index) => value - values[index]!);
  const averageMagnitude = values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length;
  const meaningfulChangeThreshold = Math.max(1e-6, averageMagnitude * 0.01);
  const meaningfulChanges = changes.filter((change) => Math.abs(change) >= meaningfulChangeThreshold);
  const signChanges = meaningfulChanges
    .slice(1)
    .filter((change, index) => Math.sign(change) !== Math.sign(meaningfulChanges[index]!))
    .length;

  const bandWidth = averageConfidenceBandWidth(forecasts);
  if (signChanges >= Math.max(2, Math.floor(meaningfulChanges.length / 2)) || (bandWidth !== null && bandWidth > 0.75)) {
    return "volatile";
  }

  const forecastAverage = forecasts && forecasts.length > 0
    ? forecasts.reduce((sum, point) => sum + point.predicted, 0) / forecasts.length
    : latest;
  const forecastDelta = relativeDelta(latest, forecastAverage);
  const blendedDelta = (observedDelta + forecastDelta) / 2;

  if (blendedDelta > 0.03) return "improving";
  if (blendedDelta < -0.03) return "declining";
  return "stable";
}

export function classifyForecastGate(input: ForecastGateInput): ForecastGateDecision {
  const values = finiteValues(input.values);
  const valuesCount = values.length;
  const modelUsed = input.modelUsed?.trim() || "unmodeled";
  const evidenceRefs = input.evidenceRefs ?? [];

  if (valuesCount < 3) {
    return {
      streamKey: input.streamKey,
      valuesCount,
      modelUsed: "insufficient_data",
      trendDirection: "insufficient_data",
      latestOutsideInterval: false,
      confidenceBandWidth: null,
      recommendedAction: "observe",
      explanation: `Need at least 3 numeric observations before forecast-aware orchestration; found ${valuesCount}.`,
      evidenceRefs,
    };
  }

  const forecasts = input.forecasts?.filter(
    (point) => Number.isFinite(point.predicted) && Number.isFinite(point.lower) && Number.isFinite(point.upper),
  );
  const trendDirection = classifyTrend(values, forecasts);
  const interval = linearForecastIntervalForLatest(values);
  const latest = values[values.length - 1]!;
  const latestOutsideInterval = interval ? latest < interval.lower || latest > interval.upper : false;
  const confidenceBandWidth = averageConfidenceBandWidth(forecasts);
  const delegateEligible = input.delegateEligible === true;

  let recommendedAction: ForecastRecommendedAction = "observe";
  let explanation = "Forecast gate recommends observation until the stream has a clearer decision signal.";

  if (latestOutsideInterval) {
    recommendedAction = "escalate";
    explanation = "Latest observation is outside the expected interval; create an important-change review before acting.";
  } else if (trendDirection === "declining") {
    recommendedAction = "refresh_packet";
    explanation = "Trajectory is declining; refresh the packet or rerun diligence before delegating.";
  } else if (trendDirection === "volatile") {
    recommendedAction = "deepen_diligence";
    explanation = "Trajectory is volatile or uncertainty is wide; deepen diligence before making an execution handoff.";
  } else if (trendDirection === "stable" && valuesCount >= 8 && (confidenceBandWidth ?? 0) <= 0.35) {
    recommendedAction = "suppress";
    explanation = "Trajectory is stable with enough history; suppress redundant diligence and reuse the current packet.";
  } else if (trendDirection === "improving" && valuesCount >= 8 && delegateEligible && (confidenceBandWidth ?? 0.36) <= 0.35) {
    recommendedAction = "delegate";
    explanation = "Trajectory is improving with enough history and a bounded delegation target; hand off with the forecast gate attached.";
  } else if (trendDirection === "improving") {
    recommendedAction = "observe";
    explanation = "Trajectory is improving, but history or delegation constraints are not strong enough to trigger autonomous handoff.";
  }

  return {
    streamKey: input.streamKey,
    valuesCount,
    modelUsed,
    trendDirection,
    latestOutsideInterval,
    confidenceBandWidth: confidenceBandWidth === null ? null : Number(confidenceBandWidth.toFixed(6)),
    recommendedAction,
    explanation,
    evidenceRefs,
  };
}
