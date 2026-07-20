import { v } from "convex/values";

export type DimensionAvailability = "verified" | "estimated" | "inferred" | "unavailable";

export type DimensionMetric = {
  value: number | string | null;
  score?: number | null;
  availability: DimensionAvailability;
  rationale?: string;
  sourceRefIds: string[];
};

export type DimensionState = {
  time: {
    runwayMonths: DimensionMetric;
    deadlinePressure: DimensionMetric;
    executionTempo: DimensionMetric;
    maturityStage: DimensionMetric;
  };
  capital: {
    fundingRaisedUsd: DimensionMetric;
    burnEstimateUsdPerMonth: DimensionMetric;
    capitalSlack: DimensionMetric;
    financingQualityScore: DimensionMetric;
  };
  people: {
    founderCredibilityScore: DimensionMetric;
    operatorStrengthScore: DimensionMetric;
    technicalExecutionScore: DimensionMetric;
    hiringDensityScore: DimensionMetric;
    teamContinuityScore: DimensionMetric;
  };
  market: {
    customerDemandScore: DimensionMetric;
    urgencyScore: DimensionMetric;
    competitionPressureScore: DimensionMetric;
    distributionAdvantageScore: DimensionMetric;
  };
  network: {
    investorQualityScore: DimensionMetric;
    partnerLeverageScore: DimensionMetric;
    alumniNetworkScore: DimensionMetric;
    strategicBackerScore: DimensionMetric;
  };
  operations: {
    supplierFragilityScore: DimensionMetric;
    customerConcentrationScore: DimensionMetric;
    infraDependenceScore: DimensionMetric;
    regulatoryExposureScore: DimensionMetric;
  };
  narrative: {
    credibilityScore: DimensionMetric;
    overclaimRiskScore: DimensionMetric;
    momentumScore: DimensionMetric;
  };
};

export type PolicyContext = {
  operatingMode:
    | "survival"
    | "focused_build"
    | "measured_scale"
    | "aggressive_expansion"
    | "high_uncertainty_watch";
  confidenceAdjustment: number;
  recommendedTempo: number;
  explorationAllowance: number;
  errorTolerance: number;
};

export type DeepTraceDimensionSourceRef = {
  label: string;
  href?: string;
  note?: string;
  kind?: string;
  publishedAtIso?: string;
};

export const deepTraceDimensionSourceRefValidator = v.object({
  label: v.string(),
  href: v.optional(v.string()),
  note: v.optional(v.string()),
  kind: v.optional(v.string()),
  publishedAtIso: v.optional(v.string()),
});

export const dimensionAvailabilityValidator = v.union(
  v.literal("verified"),
  v.literal("estimated"),
  v.literal("inferred"),
  v.literal("unavailable"),
);

export const dimensionMetricValidator = v.object({
  value: v.union(v.number(), v.string(), v.null()),
  score: v.optional(v.union(v.number(), v.null())),
  availability: dimensionAvailabilityValidator,
  rationale: v.optional(v.string()),
  sourceRefIds: v.array(v.string()),
});

export const dimensionStateValidator = v.object({
  time: v.object({
    runwayMonths: dimensionMetricValidator,
    deadlinePressure: dimensionMetricValidator,
    executionTempo: dimensionMetricValidator,
    maturityStage: dimensionMetricValidator,
  }),
  capital: v.object({
    fundingRaisedUsd: dimensionMetricValidator,
    burnEstimateUsdPerMonth: dimensionMetricValidator,
    capitalSlack: dimensionMetricValidator,
    financingQualityScore: dimensionMetricValidator,
  }),
  people: v.object({
    founderCredibilityScore: dimensionMetricValidator,
    operatorStrengthScore: dimensionMetricValidator,
    technicalExecutionScore: dimensionMetricValidator,
    hiringDensityScore: dimensionMetricValidator,
    teamContinuityScore: dimensionMetricValidator,
  }),
  market: v.object({
    customerDemandScore: dimensionMetricValidator,
    urgencyScore: dimensionMetricValidator,
    competitionPressureScore: dimensionMetricValidator,
    distributionAdvantageScore: dimensionMetricValidator,
  }),
  network: v.object({
    investorQualityScore: dimensionMetricValidator,
    partnerLeverageScore: dimensionMetricValidator,
    alumniNetworkScore: dimensionMetricValidator,
    strategicBackerScore: dimensionMetricValidator,
  }),
  operations: v.object({
    supplierFragilityScore: dimensionMetricValidator,
    customerConcentrationScore: dimensionMetricValidator,
    infraDependenceScore: dimensionMetricValidator,
    regulatoryExposureScore: dimensionMetricValidator,
  }),
  narrative: v.object({
    credibilityScore: dimensionMetricValidator,
    overclaimRiskScore: dimensionMetricValidator,
    momentumScore: dimensionMetricValidator,
  }),
});

export const policyContextValidator = v.object({
  operatingMode: v.union(
    v.literal("survival"),
    v.literal("focused_build"),
    v.literal("measured_scale"),
    v.literal("aggressive_expansion"),
    v.literal("high_uncertainty_watch"),
  ),
  confidenceAdjustment: v.number(),
  recommendedTempo: v.number(),
  explorationAllowance: v.number(),
  errorTolerance: v.number(),
});

export const dimensionFamilyValidator = v.union(
  v.literal("time"),
  v.literal("capital"),
  v.literal("people"),
  v.literal("market"),
  v.literal("network"),
  v.literal("operations"),
  v.literal("narrative"),
);

export const effectDirectionValidator = v.union(
  v.literal("positive"),
  v.literal("negative"),
  v.literal("mixed"),
);

export function createUnavailableMetric(rationale = "No durable evidence is currently available."): DimensionMetric {
  return {
    value: null,
    score: null,
    availability: "unavailable",
    rationale,
    sourceRefIds: [],
  };
}

