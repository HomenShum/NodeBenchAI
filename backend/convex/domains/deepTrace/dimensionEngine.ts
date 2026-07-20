"use node";

import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { buildCanonicalKey } from "../../lib/entityResolution";
import type {
  DeepTraceDimensionSourceRef,
  DimensionAvailability,
  DimensionMetric,
  DimensionState,
  PolicyContext,
} from "./dimensionModel";
import { createUnavailableMetric } from "./dimensionModel";

type EntityDoc = {
  _id?: Id<"entityContexts">;
  entityName?: string;
  entityType?: string;
  canonicalKey?: string;
  summary?: string;
  keyFacts?: string[];
  sources?: Array<{ name: string; url?: string; snippet?: string }>;
  crmFields?: any;
  funding?: any;
  people?: any;
  productPipeline?: any;
  recentNewsItems?: any[];
  freshness?: any;
  researchedAt?: number;
};

type RelationshipObservationDoc = {
  _id: Id<"relationshipObservations">;
  relatedEntityName: string;
  relationshipType: string;
  summary?: string;
  claimText: string;
  confidence: number;
  sourceRefs?: DeepTraceDimensionSourceRef[];
  observedAt: number;
  metadata?: Record<string, unknown>;
};

type TimeSignalDoc = {
  _id: Id<"timeSeriesSignals">;
  signalType: string;
  severity?: "low" | "medium" | "high";
  confidence: number;
  summary: string;
  plainEnglish: string;
  detectedAt: number;
  sourceRefs?: DeepTraceDimensionSourceRef[];
};

type WorldEventDoc = {
  _id: Id<"worldEvents">;
  topic: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  summary: string;
  sourceRefs?: DeepTraceDimensionSourceRef[];
  happenedAt: number;
};

type SourceBundle = {
  refs: DeepTraceDimensionSourceRef[];
  idsByKey: Map<string, string>;
};

type EvidenceRecord = {
  dimensionFamily: keyof DimensionState;
  dimensionName: string;
  metric: DimensionMetric;
};

type InteractionRecord = {
  interactionKey: string;
  dimensions: string[];
  effectDirection: "positive" | "negative" | "mixed";
  magnitude: number;
  interactionSummary: string;
  sourceRefIds: string[];
};

type ComputedBundle = {
  entityKey: string;
  entityName: string;
  entityType: string;
  dimensionState: DimensionState;
  regimeLabel: string;
  policyContext: PolicyContext;
  confidence: number;
  coverageRatio: number;
  summary: string;
  stateHash: string;
  sourceRefs: DeepTraceDimensionSourceRef[];
  evidence: EvidenceRecord[];
  interactions: InteractionRecord[];
};

const TOP_INVESTOR_PATTERNS = [
  /sequoia/i,
  /andreessen|a16z/i,
  /benchmark/i,
  /accel/i,
  /lightspeed/i,
  /greylock/i,
  /kleiner/i,
  /insight/i,
  /general catalyst/i,
  /founders fund/i,
  /bessemer/i,
  /union square/i,
  /index ventures/i,
  /coatue/i,
  /tiger global/i,
];

const TOP_ALUMNI_PATTERNS = [
  /google|alphabet/i,
  /meta|facebook/i,
  /openai/i,
  /microsoft/i,
  /amazon|aws/i,
  /apple/i,
  /stripe/i,
  /palantir/i,
  /tesla|spacex/i,
  /stanford|mit|harvard|berkeley|cmu/i,
];

const REGULATED_PATTERNS = [
  /fda|clinical|medtech|biotech|health/i,
  /bank|fintech|securities|insurance|finra|sec\b/i,
  /defense|govtech|export control|sanction/i,
];

const INFRA_PATTERNS = [
  /api|platform|cloud|infrastructure|data pipeline|sdk|developer/i,
  /aws|azure|gcp|kubernetes|gpu/i,
];

const DEMAND_PATTERNS = [
  /customer|contract|pipeline|booked|revenue|users|adoption|deploy/i,
  /waitlist|pilot|enterprise|signed/i,
];

const MOMENTUM_PATTERNS = [
  /launch|announced|raised|partnership|approval|hiring|expansion/i,
];

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dedupeSourceRefs(refs: DeepTraceDimensionSourceRef[]): SourceBundle {
  const deduped: DeepTraceDimensionSourceRef[] = [];
  const idsByKey = new Map<string, string>();

  for (const ref of refs) {
    const key = `${ref.label}|${ref.href ?? ""}|${ref.note ?? ""}|${ref.kind ?? ""}|${ref.publishedAtIso ?? ""}`;
    if (idsByKey.has(key)) continue;
    const id = `src_${stableHash(key)}`;
    idsByKey.set(key, id);
    deduped.push(ref);
  }

  return { refs: deduped, idsByKey };
}

function sourceRefIdsFor(bundle: SourceBundle, refs: DeepTraceDimensionSourceRef[]): string[] {
  const ids: string[] = [];
  for (const ref of refs) {
    const key = `${ref.label}|${ref.href ?? ""}|${ref.note ?? ""}|${ref.kind ?? ""}|${ref.publishedAtIso ?? ""}`;
    const id = bundle.idsByKey.get(key);
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

function metric(
  value: number | string | null,
  score: number | null,
  availability: DimensionAvailability,
  rationale: string,
  sourceRefIds: string[],
): DimensionMetric {
  return {
    value,
    score,
    availability,
    rationale,
    sourceRefIds: [...new Set(sourceRefIds)],
  };
}

function parseMoneyValue(raw: any): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const match = raw.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)\s*([kmb]|million|billion)?/i);
    if (!match) return null;
    const base = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    if (!Number.isFinite(base)) return null;
    if (!unit) return base;
    if (unit === "k") return base * 1_000;
    if (unit === "m" || unit === "million") return base * 1_000_000;
    if (unit === "b" || unit === "billion") return base * 1_000_000_000;
    return base;
  }
  if (typeof raw === "object") {
    if (typeof raw.amountUsd === "number") return raw.amountUsd;
    if (typeof raw.valueUsd === "number") return raw.valueUsd;
    if (typeof raw.totalUsd === "number") return raw.totalUsd;
    if (typeof raw.amount === "number") {
      const unit = typeof raw.unit === "string" ? raw.unit.toLowerCase() : "";
      if (unit === "k") return raw.amount * 1_000;
      if (unit === "m" || unit === "million") return raw.amount * 1_000_000;
      if (unit === "b" || unit === "billion") return raw.amount * 1_000_000_000;
      return raw.amount;
    }
    if (typeof raw.amount === "string") return parseMoneyValue(`${raw.amount} ${raw.unit ?? ""}`.trim());
  }
  return null;
}

function parseHeadcount(raw: any): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const range = raw.match(/(\d+)\s*-\s*(\d+)/);
    if (range) return (Number(range[1]) + Number(range[2])) / 2;
    const plus = raw.match(/(\d+)\s*\+/);
    if (plus) return Number(plus[1]);
    const solo = raw.match(/(\d+)/);
    if (solo) return Number(solo[1]);
  }
  return null;
}

function textIncludes(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function normalizeCount(count: number, max: number): number {
  return clamp(count / Math.max(1, max));
}

function average(scores: Array<number | null | undefined>): number {
  const filtered = scores.filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  if (filtered.length === 0) return 0;
  return filtered.reduce((sum, score) => sum + score, 0) / filtered.length;
}

function stringifyRecord(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return "";
  }
}

function coerceStringArray(value: any): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : typeof item?.name === "string" ? item.name : null))
      .filter((item): item is string => Boolean(item));
  }
  return [];
}

function founderProfiles(people: any): any[] {
  return Array.isArray(people?.founders) ? people.founders : [];
}

function executiveProfiles(people: any): any[] {
  return Array.isArray(people?.executives) ? people.executives : [];
}

function boardProfiles(people: any): any[] {
  return Array.isArray(people?.boardMembers) ? people.boardMembers : [];
}

function deriveRegimeLabel(state: DimensionState): string {
  const runway = typeof state.time.runwayMonths.value === "number" ? state.time.runwayMonths.value : null;
  const capitalSlack = state.capital.capitalSlack.score ?? 0;
  const urgency = state.market.urgencyScore.score ?? state.time.deadlinePressure.score ?? 0;
  const teamStrength = average([
    state.people.founderCredibilityScore.score,
    state.people.operatorStrengthScore.score,
    state.people.technicalExecutionScore.score,
  ]);
  const investorQuality = state.network.investorQualityScore.score ?? 0;
  const momentum = state.narrative.momentumScore.score ?? 0;

  if ((runway !== null && runway < 9) || (capitalSlack < 0.35 && urgency > 0.6)) {
    return "survival";
  }
  if (capitalSlack > 0.78 && investorQuality > 0.7 && urgency > 0.5 && momentum > 0.55) {
    return "aggressive_expansion";
  }
  if (capitalSlack > 0.58 && teamStrength > 0.62) {
    return "measured_scale";
  }
  if (teamStrength > 0.55 || momentum > 0.45) {
    return "focused_build";
  }
  return "high_uncertainty_watch";
}

function derivePolicyContext(regimeLabel: string, state: DimensionState): PolicyContext {
  const urgency = state.market.urgencyScore.score ?? 0;
  const uncertainty = 1 - average([
    state.capital.financingQualityScore.score,
    state.people.founderCredibilityScore.score,
    state.narrative.credibilityScore.score,
  ]);

  switch (regimeLabel) {
    case "survival":
      return {
        operatingMode: "survival",
        confidenceAdjustment: -0.2,
        recommendedTempo: clamp(0.8 + urgency * 0.2),
        explorationAllowance: 0.2,
        errorTolerance: 0.2,
      };
    case "aggressive_expansion":
      return {
        operatingMode: "aggressive_expansion",
        confidenceAdjustment: 0.18,
        recommendedTempo: 0.78,
        explorationAllowance: 0.72,
        errorTolerance: 0.55,
      };
    case "measured_scale":
      return {
        operatingMode: "measured_scale",
        confidenceAdjustment: 0.1,
        recommendedTempo: 0.58,
        explorationAllowance: 0.52,
        errorTolerance: 0.48,
      };
    case "focused_build":
      return {
        operatingMode: "focused_build",
        confidenceAdjustment: 0.04,
        recommendedTempo: 0.52,
        explorationAllowance: 0.42,
        errorTolerance: 0.36,
      };
    default:
      return {
        operatingMode: "high_uncertainty_watch",
        confidenceAdjustment: round(-0.1 * uncertainty, 3),
        recommendedTempo: 0.35,
        explorationAllowance: 0.28,
        errorTolerance: 0.22,
      };
  }
}

function materializeEvidence(state: DimensionState): EvidenceRecord[] {
  return (Object.entries(state) as Array<[keyof DimensionState, Record<string, DimensionMetric>]>)
    .flatMap(([dimensionFamily, metrics]) =>
      Object.entries(metrics).map(([dimensionName, metricValue]) => ({
        dimensionFamily,
        dimensionName,
        metric: metricValue,
      })),
    );
}

function buildInteractions(state: DimensionState): InteractionRecord[] {
  const interactions: InteractionRecord[] = [];

  const capital = state.capital.capitalSlack.score ?? 0;
  const investor = state.network.investorQualityScore.score ?? 0;
  const complexity = state.operations.infraDependenceScore.score ?? 0;
  const urgency = state.market.urgencyScore.score ?? 0;
  const team = average([
    state.people.operatorStrengthScore.score,
    state.people.technicalExecutionScore.score,
  ]);
  const credibility = state.narrative.credibilityScore.score ?? 0;
  const overclaim = state.narrative.overclaimRiskScore.score ?? 0;

  const capitalInteraction = round(clamp((capital + investor) / 2));
  if (capitalInteraction > 0.15) {
    interactions.push({
      interactionKey: "capital_investor_support",
      dimensions: ["capital.capitalSlack", "network.investorQualityScore"],
      effectDirection: "positive",
      magnitude: capitalInteraction,
      interactionSummary:
        "Capital slack combined with investor quality lowers near-term execution fragility and supports a more deliberate build window.",
      sourceRefIds: [
        ...state.capital.capitalSlack.sourceRefIds,
        ...state.network.investorQualityScore.sourceRefIds,
      ],
    });
  }

  const deliveryRisk = round(clamp((complexity + urgency + (1 - team)) / 3));
  if (deliveryRisk > 0.2) {
    interactions.push({
      interactionKey: "complexity_delivery_risk",
      dimensions: [
        "operations.infraDependenceScore",
        "market.urgencyScore",
        "people.technicalExecutionScore",
      ],
      effectDirection: "negative",
      magnitude: deliveryRisk,
      interactionSummary:
        "High technical and infrastructure dependence combined with urgency raises delivery risk unless operator strength improves.",
      sourceRefIds: [
        ...state.operations.infraDependenceScore.sourceRefIds,
        ...state.market.urgencyScore.sourceRefIds,
        ...state.people.technicalExecutionScore.sourceRefIds,
      ],
    });
  }

  const narrativeMismatch = round(clamp(((1 - credibility) + overclaim) / 2));
  if (narrativeMismatch > 0.18) {
    interactions.push({
      interactionKey: "narrative_execution_mismatch",
      dimensions: ["narrative.credibilityScore", "narrative.overclaimRiskScore"],
      effectDirection: "mixed",
      magnitude: narrativeMismatch,
      interactionSummary:
        "Narrative momentum is running ahead of durable evidence, so recommendations should stay close to verified adjacency.",
      sourceRefIds: [
        ...state.narrative.credibilityScore.sourceRefIds,
        ...state.narrative.overclaimRiskScore.sourceRefIds,
      ],
    });
  }

  return interactions.sort((a, b) => b.magnitude - a.magnitude);
}

function computeCoverageRatio(state: DimensionState): number {
  const evidence = materializeEvidence(state);
  const available = evidence.filter((item) => item.metric.availability !== "unavailable").length;
  return round(available / Math.max(1, evidence.length), 3);
}

function computeConfidence(state: DimensionState, coverageRatio: number): number {
  const weights: Record<DimensionAvailability, number> = {
    verified: 1,
    estimated: 0.75,
    inferred: 0.5,
    unavailable: 0,
  };
  const evidence = materializeEvidence(state);
  const availabilityScore =
    evidence.reduce((sum, item) => sum + weights[item.metric.availability], 0) / Math.max(1, evidence.length);
  return round((availabilityScore * 0.65) + (coverageRatio * 0.35), 3);
}

function buildSummary(entityName: string, regimeLabel: string, state: DimensionState, interactions: InteractionRecord[]): string {
  const tempo = typeof state.time.executionTempo.score === "number" ? state.time.executionTempo.score : 0;
  const capital = typeof state.capital.capitalSlack.score === "number" ? state.capital.capitalSlack.score : 0;
  const team = average([
    state.people.founderCredibilityScore.score,
    state.people.operatorStrengthScore.score,
    state.people.technicalExecutionScore.score,
  ]);
  const risk = average([
    state.operations.supplierFragilityScore.score,
    state.operations.customerConcentrationScore.score,
    state.operations.regulatoryExposureScore.score,
  ]);
  const strongestInteraction = interactions[0]?.interactionSummary;
  return [
    `${entityName} is currently in a ${regimeLabel.replace(/_/g, " ")} regime.`,
    `Capital slack scores ${round(capital, 2)}, team execution scores ${round(team, 2)}, and operating tempo scores ${round(tempo, 2)}.`,
    `Structural risk scores ${round(risk, 2)}.`,
    strongestInteraction ? strongestInteraction : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function computeDimensionBundle(input: {
  entityKey: string;
  entityName: string;
  entityType: string;
  entityContext: EntityDoc | null;
  relationshipObservations: RelationshipObservationDoc[];
  temporalSignals: TimeSignalDoc[];
  worldEvents: WorldEventDoc[];
}): ComputedBundle {
  const entityContext = input.entityContext;
  const summaryText = [
    entityContext?.summary ?? "",
    ...(entityContext?.keyFacts ?? []),
    stringifyRecord(entityContext?.crmFields),
    stringifyRecord(entityContext?.productPipeline),
  ]
    .filter(Boolean)
    .join(" ");

  const sourceRefs = dedupeSourceRefs([
    ...((entityContext?.sources ?? []).map((source) => ({
      label: source.name,
      href: source.url,
      note: source.snippet,
      kind: "entity_context",
      publishedAtIso: entityContext?.researchedAt ? new Date(entityContext.researchedAt).toISOString() : undefined,
    })) as DeepTraceDimensionSourceRef[]),
    ...input.relationshipObservations.flatMap((item) => item.sourceRefs ?? []),
    ...input.temporalSignals.flatMap((item) => item.sourceRefs ?? []),
    ...input.worldEvents.flatMap((item) => item.sourceRefs ?? []),
    ...((entityContext?.recentNewsItems ?? []).flatMap((item: any) => {
      if (!item) return [];
      return [
        {
          label: item.headline ?? item.title ?? "Recent news",
          href: item.url,
          note: item.summary ?? item.source,
          kind: "recent_news",
          publishedAtIso:
            typeof item.publishedAt === "number"
              ? new Date(item.publishedAt).toISOString()
              : typeof item.publishedAtIso === "string"
                ? item.publishedAtIso
                : undefined,
        },
      ];
    }) as DeepTraceDimensionSourceRef[]),
  ]);

  const fundingRaisedUsd =
    parseMoneyValue(entityContext?.funding?.totalRaised?.amountUsd) ??
    parseMoneyValue(entityContext?.funding?.totalRaised) ??
    parseMoneyValue(entityContext?.funding?.lastRound?.amountUsd) ??
    parseMoneyValue(entityContext?.crmFields?.totalFunding);
  const fundingStage =
    entityContext?.funding?.stage ??
    entityContext?.crmFields?.fundingStage ??
    entityContext?.funding?.lastRound?.roundType ??
    "unknown";
  const fundingRefs = sourceRefIdsFor(
    sourceRefs,
    sourceRefs.refs.filter((ref) => ref.kind === "entity_context" || ref.kind === "recent_news"),
  );

  const people = entityContext?.people ?? {};
  const founders = founderProfiles(people);
  const executives = executiveProfiles(people);
  const boardMembers = boardProfiles(people);
  const headcount =
    parseHeadcount(people?.headcount) ??
    parseHeadcount(entityContext?.crmFields?.headcount) ??
    parseHeadcount(entityContext?.crmFields?.employeeCount);

  const investors = [
    ...coerceStringArray(entityContext?.crmFields?.investors),
    ...coerceStringArray(entityContext?.funding?.investors),
    ...coerceStringArray(entityContext?.funding?.lastRound?.coLeads),
    ...coerceStringArray(entityContext?.funding?.lastRound?.participants),
  ];
  const partnerships = [
    ...coerceStringArray(entityContext?.crmFields?.partnerships),
    ...input.relationshipObservations
      .filter((item) => item.relationshipType === "partner")
      .map((item) => item.relatedEntityName),
  ];
  const competitors = [
    ...coerceStringArray(entityContext?.crmFields?.competitors),
    ...input.relationshipObservations
      .filter((item) => item.relationshipType === "competitor")
      .map((item) => item.relatedEntityName),
  ];
  const customers = input.relationshipObservations.filter((item) => item.relationshipType === "customer");
  const suppliers = input.relationshipObservations.filter((item) => item.relationshipType === "supplier");
  const recentNewsCount = (entityContext?.recentNewsItems ?? []).length + input.worldEvents.length;

  const strongInvestorMatches = investors.filter((name) => textIncludes(name, TOP_INVESTOR_PATTERNS)).length;
  const alumniMatches = `${stringifyRecord(founders)} ${stringifyRecord(executives)} ${entityContext?.crmFields?.foundersBackground ?? ""}`;
  const topAlumniHits = TOP_ALUMNI_PATTERNS.filter((pattern) => pattern.test(alumniMatches)).length;
  const priorExitHits = /acquired|exit|sold|ipo|founded/i.test(alumniMatches) ? 1 : 0;
  const regulated = textIncludes(summaryText, REGULATED_PATTERNS);
  const infraHeavy = textIncludes(summaryText, INFRA_PATTERNS);
  const hasDemandSignals = textIncludes(summaryText, DEMAND_PATTERNS) || customers.length > 0;
  const recentMomentumSignals =
    input.temporalSignals.length +
    (entityContext?.recentNewsItems ?? []).filter((item: any) =>
      MOMENTUM_PATTERNS.some((pattern) => pattern.test(`${item?.headline ?? ""} ${item?.summary ?? ""}`)),
    ).length;

  const highSeverityEvents = input.worldEvents.filter((event) => event.severity === "high" || event.severity === "critical").length;
  const highSeveritySignals = input.temporalSignals.filter((signal) => signal.severity === "high").length;

  const burnEstimateUsdPerMonth =
    headcount !== null
      ? Math.round(headcount * 22_000)
      : fundingRaisedUsd && typeof fundingStage === "string" && /seed|series a/i.test(fundingStage)
        ? Math.round(fundingRaisedUsd / 18)
        : null;
  const runwayMonths =
    fundingRaisedUsd && burnEstimateUsdPerMonth && burnEstimateUsdPerMonth > 0
      ? fundingRaisedUsd / burnEstimateUsdPerMonth
      : null;

  const capitalSlackScore =
    runwayMonths !== null
      ? clamp(runwayMonths / 24)
      : fundingRaisedUsd !== null
        ? clamp(Math.log10(fundingRaisedUsd + 1) / 8)
        : null;
  const financingQualityScore = clamp(
    (normalizeCount(investors.length, 6) * 0.55) + (normalizeCount(strongInvestorMatches, 2) * 0.45),
  );
  const founderCredibilityScore = clamp(
    (normalizeCount(founders.length, 3) * 0.4) +
      (normalizeCount(topAlumniHits, 3) * 0.35) +
      (priorExitHits * 0.25),
  );
  const operatorStrengthScore = clamp(
    (normalizeCount(executives.length + boardMembers.length, 6) * 0.6) +
      (normalizeCount(topAlumniHits, 4) * 0.4),
  );
  const technicalExecutionScore = clamp(
    (infraHeavy ? 0.55 : 0.35) +
      (normalizeCount(headcount ?? 0, 120) * 0.2) +
      (normalizeCount(recentMomentumSignals, 5) * 0.25),
  );
  const hiringDensityScore = headcount !== null ? clamp(headcount / 150) : founders.length > 0 ? 0.2 : null;
  const teamContinuityScore = founders.length > 0 ? clamp(0.45 + normalizeCount(executives.length, 4) * 0.3 + priorExitHits * 0.25) : null;
  const customerDemandScore = clamp(
    (hasDemandSignals ? 0.55 : 0.2) +
      normalizeCount(customers.length, 3) * 0.25 +
      normalizeCount(recentNewsCount, 8) * 0.2,
  );
  const urgencyScore = clamp(
    normalizeCount(highSeverityEvents + highSeveritySignals, 4) * 0.55 +
      normalizeCount(recentMomentumSignals, 6) * 0.45,
  );
  const competitionPressureScore = clamp(
    normalizeCount(competitors.length, 5) * 0.7 +
      (textIncludes(summaryText, [/crowded|competitive|fragmented/i]) ? 0.2 : 0),
  );
  const distributionAdvantageScore = clamp(
    normalizeCount(partnerships.length, 4) * 0.55 + normalizeCount(strongInvestorMatches + topAlumniHits, 4) * 0.45,
  );
  const investorQualityScore = clamp((financingQualityScore * 0.7) + (normalizeCount(strongInvestorMatches, 2) * 0.3));
  const partnerLeverageScore = clamp(normalizeCount(partnerships.length, 4) * 0.65 + normalizeCount(customers.length, 3) * 0.35);
  const alumniNetworkScore = clamp(normalizeCount(topAlumniHits, 4));
  const strategicBackerScore = clamp((normalizeCount(strongInvestorMatches, 2) * 0.6) + (normalizeCount(partnerships.length, 5) * 0.4));
  const supplierFragilityScore =
    suppliers.length > 0 ? clamp(1 - normalizeCount(suppliers.length, 4)) : regulated || infraHeavy ? 0.55 : null;
  const customerConcentrationScore =
    customers.length > 0 ? clamp(1 - normalizeCount(customers.length, 4)) : hasDemandSignals ? 0.45 : null;
  const infraDependenceScore = clamp((infraHeavy ? 0.65 : 0.25) + (regulated ? 0.1 : 0));
  const regulatoryExposureScore = clamp((regulated ? 0.75 : 0.2) + normalizeCount(highSeverityEvents, 3) * 0.15);
  const momentumScore = clamp(normalizeCount(recentMomentumSignals, 6) * 0.6 + normalizeCount(recentNewsCount, 8) * 0.4);
  const credibilityScore = clamp(
    normalizeCount(sourceRefs.refs.length, 10) * 0.45 +
      normalizeCount(strongInvestorMatches + topAlumniHits + founders.length, 8) * 0.25 +
      normalizeCount(input.relationshipObservations.length, 10) * 0.3,
  );
  const overclaimRiskScore = clamp((momentumScore * 0.5) + ((1 - credibilityScore) * 0.5));
  const deadlinePressureScore = clamp((urgencyScore * 0.7) + ((runwayMonths !== null && runwayMonths < 12) ? 0.2 : 0));
  const executionTempoScore = clamp((urgencyScore * 0.65) + ((capitalSlackScore ?? 0) < 0.35 ? 0.2 : 0));

  const availability = {
    funding: fundingRaisedUsd !== null ? "estimated" as const : "unavailable" as const,
    burn:
      burnEstimateUsdPerMonth !== null
        ? headcount !== null
          ? "estimated" as const
          : "inferred" as const
        : "unavailable" as const,
    runway: runwayMonths !== null ? "estimated" as const : "unavailable" as const,
    people: founders.length + executives.length + boardMembers.length > 0 ? "verified" as const : "unavailable" as const,
    network: investors.length + partnerships.length > 0 ? "verified" as const : "unavailable" as const,
  };

  const timeRefs = [
    ...input.temporalSignals.flatMap((item) => item.sourceRefs ?? []),
    ...input.worldEvents.flatMap((item) => item.sourceRefs ?? []),
  ];
  const peopleRefs = sourceRefs.refs.filter((ref) => ref.kind === "entity_context");
  const networkRefs = sourceRefs.refs.filter((ref) => ref.kind === "entity_context" || ref.kind === "recent_news");

  const state: DimensionState = {
    time: {
      runwayMonths:
        runwayMonths !== null
          ? metric(round(runwayMonths, 2), clamp(runwayMonths / 24), availability.runway, "Estimated from disclosed funding and inferred monthly burn.", fundingRefs)
          : createUnavailableMetric("Runway could not be estimated from current funding and headcount evidence."),
      deadlinePressure: metric(
        round(deadlinePressureScore, 3),
        round(deadlinePressureScore, 3),
        timeRefs.length > 0 ? "verified" : "inferred",
        "Derived from open signals, world events, and capital tightness.",
        sourceRefIdsFor(sourceRefs, timeRefs.length > 0 ? timeRefs : sourceRefs.refs),
      ),
      executionTempo: metric(
        round(executionTempoScore, 3),
        round(executionTempoScore, 3),
        "inferred",
        "Derived from urgency and capital flexibility.",
        sourceRefIdsFor(sourceRefs, timeRefs.length > 0 ? timeRefs : sourceRefs.refs),
      ),
      maturityStage: metric(
        typeof fundingStage === "string" ? fundingStage : "unknown",
        typeof fundingStage === "string"
          ? clamp(
              /growth|series c|series d|public/i.test(fundingStage)
                ? 0.9
                : /series b/i.test(fundingStage)
                  ? 0.7
                  : /series a/i.test(fundingStage)
                    ? 0.55
                    : /seed/i.test(fundingStage)
                      ? 0.35
                      : 0.15,
            )
          : 0.15,
        typeof fundingStage === "string" && fundingStage !== "unknown" ? "verified" : "inferred",
        "Taken from funding stage and company maturity signals.",
        fundingRefs,
      ),
    },
    capital: {
      fundingRaisedUsd:
        fundingRaisedUsd !== null
          ? metric(Math.round(fundingRaisedUsd), clamp(Math.log10(fundingRaisedUsd + 1) / 8), availability.funding, "Taken from structured funding fields when available, otherwise normalized from reported totals.", fundingRefs)
          : createUnavailableMetric("No durable total-raised signal was found."),
      burnEstimateUsdPerMonth:
        burnEstimateUsdPerMonth !== null
          ? metric(
              burnEstimateUsdPerMonth,
              clamp(Math.log10(burnEstimateUsdPerMonth + 1) / 8),
              availability.burn,
              "Estimated using headcount-driven monthly burn heuristics.",
              sourceRefIdsFor(sourceRefs, peopleRefs.length > 0 ? peopleRefs : networkRefs),
            )
          : createUnavailableMetric("Monthly burn could not be estimated from current evidence."),
      capitalSlack:
        capitalSlackScore !== null
          ? metric(round(capitalSlackScore, 3), round(capitalSlackScore, 3), runwayMonths !== null ? "estimated" : fundingRaisedUsd !== null ? "inferred" : "unavailable", "Normalized from runway estimate and funding scale.", fundingRefs)
          : createUnavailableMetric("Capital slack is unavailable without funding scale or runway evidence."),
      financingQualityScore: metric(
        round(financingQualityScore, 3),
        round(financingQualityScore, 3),
        investors.length > 0 ? "verified" : "inferred",
        "Scores both number of backers and presence of repeat high-signal investors.",
        fundingRefs,
      ),
    },
    people: {
      founderCredibilityScore: metric(round(founderCredibilityScore, 3), round(founderCredibilityScore, 3), availability.people, "Scores founder footprint, prior exits, and alumni strength.", sourceRefIdsFor(sourceRefs, peopleRefs)),
      operatorStrengthScore: metric(round(operatorStrengthScore, 3), round(operatorStrengthScore, 3), availability.people, "Based on executive and board density plus operator pedigree hints.", sourceRefIdsFor(sourceRefs, peopleRefs)),
      technicalExecutionScore: metric(round(technicalExecutionScore, 3), round(technicalExecutionScore, 3), founders.length + executives.length > 0 ? "estimated" : "inferred", "Derived from technical footprint, team density, and recent delivery signals.", sourceRefIdsFor(sourceRefs, [...peopleRefs, ...timeRefs])),
      hiringDensityScore:
        hiringDensityScore !== null
          ? metric(round(hiringDensityScore, 3), round(hiringDensityScore, 3), headcount !== null ? "estimated" : "inferred", "Normalized from headcount or team-size signals.", sourceRefIdsFor(sourceRefs, peopleRefs))
          : createUnavailableMetric("Hiring density is unavailable without headcount evidence."),
      teamContinuityScore:
        teamContinuityScore !== null
          ? metric(round(teamContinuityScore, 3), round(teamContinuityScore, 3), founders.length > 0 ? "estimated" : "inferred", "Derived from founder continuity, executive depth, and prior-exit signals.", sourceRefIdsFor(sourceRefs, peopleRefs))
          : createUnavailableMetric("Team continuity is unavailable without durable team composition evidence."),
    },
    market: {
      customerDemandScore: metric(round(customerDemandScore, 3), round(customerDemandScore, 3), hasDemandSignals ? "estimated" : "inferred", "Based on customer, revenue, pilot, and traction language plus customer relationships.", sourceRefIdsFor(sourceRefs, [...sourceRefs.refs.filter((ref) => ref.kind === "recent_news"), ...peopleRefs])),
      urgencyScore: metric(round(urgencyScore, 3), round(urgencyScore, 3), timeRefs.length > 0 ? "verified" : "inferred", "Derived from high-severity signals, world events, and recent momentum.", sourceRefIdsFor(sourceRefs, timeRefs.length > 0 ? timeRefs : sourceRefs.refs)),
      competitionPressureScore: metric(round(competitionPressureScore, 3), round(competitionPressureScore, 3), competitors.length > 0 ? "verified" : "inferred", "Based on known competitors and crowded-market language.", sourceRefIdsFor(sourceRefs, sourceRefs.refs)),
      distributionAdvantageScore: metric(round(distributionAdvantageScore, 3), round(distributionAdvantageScore, 3), partnerships.length + investors.length > 0 ? "estimated" : "inferred", "Combines partner leverage with investor and alumni access.", fundingRefs),
    },
    network: {
      investorQualityScore: metric(round(investorQualityScore, 3), round(investorQualityScore, 3), availability.network, "Normalized from investor roster quality and repeat top-tier patterns.", fundingRefs),
      partnerLeverageScore: metric(round(partnerLeverageScore, 3), round(partnerLeverageScore, 3), partnerships.length > 0 ? "verified" : "inferred", "Based on partnership density and customer adjacency.", fundingRefs),
      alumniNetworkScore: metric(round(alumniNetworkScore, 3), round(alumniNetworkScore, 3), topAlumniHits > 0 ? "estimated" : "inferred", "Measures network access signaled by known operator or university alumni.", sourceRefIdsFor(sourceRefs, peopleRefs)),
      strategicBackerScore: metric(round(strategicBackerScore, 3), round(strategicBackerScore, 3), partnerships.length + strongInvestorMatches > 0 ? "estimated" : "inferred", "Scores the extent to which investors and partners can accelerate distribution or hiring.", fundingRefs),
    },
    operations: {
      supplierFragilityScore:
        supplierFragilityScore !== null
          ? metric(round(supplierFragilityScore, 3), round(supplierFragilityScore, 3), suppliers.length > 0 ? "verified" : "inferred", "Few supplier relationships or specialized dependencies increase fragility.", sourceRefIdsFor(sourceRefs, sourceRefs.refs))
          : createUnavailableMetric("Supplier fragility is unavailable without supplier or dependency evidence."),
      customerConcentrationScore:
        customerConcentrationScore !== null
          ? metric(round(customerConcentrationScore, 3), round(customerConcentrationScore, 3), customers.length > 0 ? "verified" : "inferred", "Limited customer breadth increases concentration risk.", sourceRefIdsFor(sourceRefs, sourceRefs.refs))
          : createUnavailableMetric("Customer concentration is unavailable without customer evidence."),
      infraDependenceScore: metric(round(infraDependenceScore, 3), round(infraDependenceScore, 3), infraHeavy ? "estimated" : "inferred", "Based on infrastructure-heavy product language and platform dependence.", sourceRefIdsFor(sourceRefs, sourceRefs.refs)),
      regulatoryExposureScore: metric(round(regulatoryExposureScore, 3), round(regulatoryExposureScore, 3), regulated || input.worldEvents.length > 0 ? "estimated" : "inferred", "Sector regulation plus event pressure determine operational regulatory exposure.", sourceRefIdsFor(sourceRefs, [...timeRefs, ...sourceRefs.refs])),
    },
    narrative: {
      credibilityScore: metric(round(credibilityScore, 3), round(credibilityScore, 3), sourceRefs.refs.length > 0 ? "estimated" : "unavailable", "Grounded in source count, team footprint, and relationship density.", sourceRefIdsFor(sourceRefs, sourceRefs.refs)),
      overclaimRiskScore: metric(round(overclaimRiskScore, 3), round(overclaimRiskScore, 3), "inferred", "Higher when visible momentum exceeds durable source coverage.", sourceRefIdsFor(sourceRefs, sourceRefs.refs)),
      momentumScore: metric(round(momentumScore, 3), round(momentumScore, 3), recentNewsCount + input.temporalSignals.length > 0 ? "estimated" : "inferred", "Measures recency and density of external momentum signals.", sourceRefIdsFor(sourceRefs, [...timeRefs, ...sourceRefs.refs.filter((ref) => ref.kind === "recent_news")])),
    },
  };

  const coverageRatio = computeCoverageRatio(state);
  const confidence = computeConfidence(state, coverageRatio);
  const regimeLabel = deriveRegimeLabel(state);
  const policyContext = derivePolicyContext(regimeLabel, state);
  const interactions = buildInteractions(state);
  const summary = buildSummary(input.entityName, regimeLabel, state, interactions);
  const stateHash = stableHash(JSON.stringify({ regimeLabel, policyContext, state, interactions }));

  return {
    entityKey: input.entityKey,
    entityName: input.entityName,
    entityType: input.entityType,
    dimensionState: state,
    regimeLabel,
    policyContext,
    confidence,
    coverageRatio,
    summary,
    stateHash,
    sourceRefs: sourceRefs.refs,
    evidence: materializeEvidence(state),
    interactions,
  };
}

async function findEntityContext(
  ctx: MutationCtx,
  args: { entityKey?: string; entityId?: Id<"entityContexts">; entityName?: string; entityType?: string },
): Promise<EntityDoc | null> {
  if (args.entityId) {
    return (await ctx.db.get(args.entityId)) as EntityDoc | null;
  }

  if (args.entityKey) {
    const byCanonical = await ctx.db
      .query("entityContexts")
      .withIndex("by_canonicalKey", (q) => q.eq("canonicalKey", args.entityKey!))
      .first();
    if (byCanonical) return byCanonical as EntityDoc;
  }

  if (args.entityName && args.entityType) {
    const byEntity = await ctx.db
      .query("entityContexts")
      .withIndex("by_entity", (q) => q.eq("entityName", args.entityName!).eq("entityType", args.entityType as any))
      .first();
    if (byEntity) return byEntity as EntityDoc;
  }

  return null;
}

async function listRelationshipObservations(ctx: MutationCtx, entityKey: string): Promise<RelationshipObservationDoc[]> {
  return (await ctx.db
    .query("relationshipObservations")
    .withIndex("by_subject_time", (q) => q.eq("subjectEntityKey", entityKey))
    .order("desc")
    .take(60)) as RelationshipObservationDoc[];
}

async function listTemporalSignals(ctx: MutationCtx, entityKey: string): Promise<TimeSignalDoc[]> {
  return (await ctx.db
    .query("timeSeriesSignals")
    .withIndex("by_entity_detected", (q) => q.eq("entityKey", entityKey))
    .order("desc")
    .take(24)) as TimeSignalDoc[];
}

async function listWorldEvents(ctx: MutationCtx, entityKey: string): Promise<WorldEventDoc[]> {
  return (await ctx.db
    .query("worldEvents")
    .withIndex("by_primary_entity_detected", (q) => q.eq("primaryEntityKey", entityKey))
    .order("desc")
    .take(24)) as WorldEventDoc[];
}

async function upsertProfile(ctx: MutationCtx, bundle: ComputedBundle, entityId?: Id<"entityContexts">) {
  const now = Date.now();
  const existing = await ctx.db
    .query("dimensionProfiles")
    .withIndex("by_entity", (q) => q.eq("entityKey", bundle.entityKey))
    .first();

  const payload = {
    profileKey: `dimension_profile:${bundle.entityKey}`,
    entityKey: bundle.entityKey,
    entityId,
    entityType: bundle.entityType,
    entityName: bundle.entityName,
    dimensionState: bundle.dimensionState,
    regimeLabel: bundle.regimeLabel,
    policyContext: bundle.policyContext,
    confidence: bundle.confidence,
    coverageRatio: bundle.coverageRatio,
    summary: bundle.summary,
    stateHash: bundle.stateHash,
    sourceRefs: bundle.sourceRefs,
    lastComputedAt: now,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return existing._id;
  }

  return await ctx.db.insert("dimensionProfiles", payload);
}

async function maybeInsertSnapshot(
  ctx: MutationCtx,
  bundle: ComputedBundle,
  entityId?: Id<"entityContexts">,
  triggerEventKey?: string,
) {
  const latest = await ctx.db
    .query("dimensionSnapshots")
    .withIndex("by_entity_asOfDate", (q) => q.eq("entityKey", bundle.entityKey))
    .order("desc")
    .first();

  if (latest && latest.stateHash === bundle.stateHash && latest.regimeLabel === bundle.regimeLabel) {
    return null;
  }

  const now = Date.now();
  return await ctx.db.insert("dimensionSnapshots", {
    snapshotKey: `dimension_snapshot:${bundle.entityKey}:${now}`,
    entityKey: bundle.entityKey,
    entityId,
    entityType: bundle.entityType,
    entityName: bundle.entityName,
    asOfDate: new Date(now).toISOString(),
    dimensionState: bundle.dimensionState,
    regimeLabel: bundle.regimeLabel,
    policyContext: bundle.policyContext,
    stateHash: bundle.stateHash,
    triggerEventKey,
    sourceRefs: bundle.sourceRefs,
    createdAt: now,
  });
}

function refIdFor(ref: DeepTraceDimensionSourceRef): string {
  return `src_${stableHash(`${ref.label}|${ref.href ?? ""}|${ref.note ?? ""}|${ref.kind ?? ""}|${ref.publishedAtIso ?? ""}`)}`;
}

async function upsertEvidence(ctx: MutationCtx, bundle: ComputedBundle, entityId?: Id<"entityContexts">) {
  const now = Date.now();
  const evidenceKeys: string[] = [];

  for (const item of bundle.evidence) {
    const evidenceKey = `${bundle.entityKey}:${item.dimensionFamily}:${item.dimensionName}`;
    evidenceKeys.push(evidenceKey);
    const existing = await ctx.db
      .query("dimensionEvidence")
      .withIndex("by_evidence_key", (q) => q.eq("evidenceKey", evidenceKey))
      .first();

    const payload = {
      evidenceKey,
      entityKey: bundle.entityKey,
      entityId,
      entityType: bundle.entityType,
      entityName: bundle.entityName,
      dimensionFamily: item.dimensionFamily,
      dimensionName: item.dimensionName,
      availability: item.metric.availability,
      rawValue: item.metric.value,
      normalizedScore: item.metric.score ?? null,
      rationale: item.metric.rationale ?? "",
      sourceRefIds: item.metric.sourceRefIds,
      sourceRefs: bundle.sourceRefs.filter((ref) => item.metric.sourceRefIds.includes(refIdFor(ref))),
      observedAt: now,
      updatedAt: now,
    };

    if (existing) await ctx.db.patch(existing._id, payload);
    else await ctx.db.insert("dimensionEvidence", payload);
  }

  return evidenceKeys;
}

async function upsertInteractions(
  ctx: MutationCtx,
  bundle: ComputedBundle,
  evidenceKeys: string[],
  entityId?: Id<"entityContexts">,
) {
  const now = Date.now();
  const expectedInteractionKeys = new Set(
    bundle.interactions.map((interaction) => `${bundle.entityKey}:${interaction.interactionKey}`),
  );
  const existingInteractions = await ctx.db
    .query("dimensionInteractions")
    .withIndex("by_entity_updated", (q) => q.eq("entityKey", bundle.entityKey))
    .collect();

  for (const interaction of bundle.interactions) {
    const interactionKey = `${bundle.entityKey}:${interaction.interactionKey}`;
    const existing = await ctx.db
      .query("dimensionInteractions")
      .withIndex("by_interaction_key", (q) => q.eq("interactionKey", interactionKey))
      .first();

    const payload = {
      interactionKey,
      entityKey: bundle.entityKey,
      entityId,
      entityType: bundle.entityType,
      entityName: bundle.entityName,
      dimensions: interaction.dimensions,
      pairKey: interaction.dimensions.slice().sort().join("|"),
      effectDirection: interaction.effectDirection,
      magnitude: interaction.magnitude,
      interactionSummary: interaction.interactionSummary,
      sourceRefIds: interaction.sourceRefIds,
      sourceRefs: bundle.sourceRefs.filter((ref) => interaction.sourceRefIds.includes(refIdFor(ref))),
      linkedEvidenceKeys: evidenceKeys.filter((key) =>
        interaction.dimensions.some((dimensionPath) => key.endsWith(dimensionPath.split(".")[1] ?? "")),
      ),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existing) await ctx.db.patch(existing._id, payload);
    else await ctx.db.insert("dimensionInteractions", payload);
  }

  for (const existing of existingInteractions) {
    if (!expectedInteractionKeys.has(existing.interactionKey)) {
      await ctx.db.delete(existing._id);
    }
  }
}

export async function recomputeAndPersistDimensionProfile(
  ctx: MutationCtx,
  args: {
    entityKey?: string;
    entityId?: Id<"entityContexts">;
    entityName?: string;
    entityType?: string;
    triggerEventKey?: string;
  },
) {
  const entityContext = await findEntityContext(ctx, args);
  const entityName = args.entityName ?? entityContext?.entityName ?? args.entityKey ?? "Unknown entity";
  const entityType = args.entityType ?? entityContext?.entityType ?? "company";
  const entityKey =
    args.entityKey ??
    entityContext?.canonicalKey ??
    buildCanonicalKey((entityType === "person" ? "person" : "company") as "company" | "person", entityName);

  const [relationshipObservations, temporalSignals, worldEvents] = await Promise.all([
    listRelationshipObservations(ctx, entityKey),
    listTemporalSignals(ctx, entityKey),
    listWorldEvents(ctx, entityKey),
  ]);

  const bundle = computeDimensionBundle({
    entityKey,
    entityName,
    entityType,
    entityContext,
    relationshipObservations,
    temporalSignals,
    worldEvents,
  });

  const profileId = await upsertProfile(ctx, bundle, entityContext?._id);
  const snapshotId = await maybeInsertSnapshot(ctx, bundle, entityContext?._id, args.triggerEventKey);
  const evidenceKeys = await upsertEvidence(ctx, bundle, entityContext?._id);
  await upsertInteractions(ctx, bundle, evidenceKeys, entityContext?._id);

  return {
    profileId,
    snapshotId,
    entityKey: bundle.entityKey,
    entityName: bundle.entityName,
    regimeLabel: bundle.regimeLabel,
    confidence: bundle.confidence,
    coverageRatio: bundle.coverageRatio,
    summary: bundle.summary,
    sourceRefs: bundle.sourceRefs,
    stateHash: bundle.stateHash,
    dimensionState: bundle.dimensionState,
    policyContext: bundle.policyContext,
    interactionCount: bundle.interactions.length,
    evidenceCount: bundle.evidence.length,
  };
}

export { computeDimensionBundle };
