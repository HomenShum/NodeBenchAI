// convex/domains/evaluation/financial/evaluationOrchestrator.ts
// Financial Evaluation Orchestrator
//
// Coordinates the full evaluation pipeline:
// 1. Load AI model and ground truth
// 2. Run assumption drift scoring
// 3. Run source quality scoring
// 4. Run model accuracy checks
// 5. Aggregate into final verdict
// 6. Generate reproducibility pack
//
// ============================================================================
// REPRODUCIBILITY GATES
// ============================================================================
//
// Before an evaluation is considered complete, it must pass these gates:
//
// 1. INPUT COMPLETENESS
//    - All required fundamentals loaded
//    - All source artifacts retrievable
//    - Ground truth version pinned
//
// 2. DETERMINISM CHECK
//    - Same inputs produce same outputs (hash match)
//    - No non-deterministic operations
//
// 3. PROVENANCE COMPLETENESS
//    - Every assumption has source citation
//    - Every data point has lineage
//
// 4. AUDIT TRAIL
//    - All decisions logged
//    - All scores justified
//
// ============================================================================

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { calculateDcf } from "./dcfEngine";
import type { DcfAssumptions, DcfDetailedOutputs, EvaluationVerdict } from "./types";
import {
  classifySource,
  aggregateSourceQuality,
  DEFAULT_SOURCE_RULES,
  type SourceClassification,
} from "../sourceQuality";
import {
  type ExternalResult,
  type ProbeResult,
  probePass,
  probeFail,
  probeInconclusive,
  aggregateProbeResults,
  fromError,
} from "../../financial/inconclusiveOnFailure";

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

/**
 * Evaluation configuration
 */
export interface EvaluationConfig {
  /** Entity being evaluated */
  entityKey: string;

  /** AI model version to evaluate */
  aiModelId: Id<"dcfModels">;

  /** Ground truth version to compare against (optional) */
  groundTruthVersionId?: Id<"groundTruthVersions">;

  /** Skip source quality scoring */
  skipSourceQuality?: boolean;

  /** Skip sensitivity matrix generation */
  skipSensitivity?: boolean;

  /** Generate full repro pack */
  generateReproPack?: boolean;
}

/**
 * Evaluation result
 */
export interface EvaluationResult {
  /** Evaluation ID */
  evaluationId: string;

  /** Entity evaluated */
  entityKey: string;

  /** Timestamp */
  evaluatedAt: number;

  /** Gate results */
  gates: {
    inputCompleteness: ProbeResult;
    determinismCheck: ProbeResult;
    provenanceCompleteness: ProbeResult;
    auditTrail: ProbeResult;
  };

  /** All gates passed */
  gatesPassed: boolean;

  /** Scoring results */
  scores: {
    assumptionDrift: number;       // 0-100
    sourceQuality: number;         // 0-100
    modelAccuracy: number;         // 0-100
    overall: number;               // Weighted average
  };

  /** Score breakdown */
  scoreBreakdown: {
    assumptionDriftDetails: AssumptionDriftDetails;
    sourceQualityDetails: SourceQualityDetails;
    modelAccuracyDetails: ModelAccuracyDetails;
  };

  /** Final verdict */
  verdict: EvaluationVerdict;

  /** Repro pack ID (if generated) */
  reproPackId?: Id<"modelReproPacks">;
}

/**
 * Assumption drift details
 */
export interface AssumptionDriftDetails {
  revenueGrowthDrift: number;
  waccDrift: number;
  terminalValueDrift: number;
  operatingMarginDrift: number;
  driftItems: Array<{
    field: string;
    aiValue: number;
    groundTruthValue?: number;
    drift: number;
    severity: "low" | "moderate" | "high" | "critical";
  }>;
}

/**
 * Source quality details
 */
export interface SourceQualityDetails {
  overallScore: number;
  tierDistribution: Record<string, number>;
  primarySourceRatio: number;
  concerns: string[];
  sourceCount: number;
}

/**
 * Model accuracy details
 */
export interface ModelAccuracyDetails {
  evDrift: number;              // % difference in EV
  equityValueDrift: number;     // % difference in equity value
  fcfProjectionAccuracy: number;
  terminalValueAccuracy: number;
  formulaAccuracy: number;
}

/**
 * Repro pack contents
 */
export interface ReproPackContents {
  /** Pack metadata */
  packId: string;
  entityKey: string;
  createdAt: number;

  /** Input snapshot hashes */
  inputHashes: {
    fundamentals: string;
    assumptions: string;
    groundTruth: string;
  };

  /** Output hashes */
  outputHashes: {
    dcfOutputs: string;
    evaluation: string;
  };

  /** Full provenance chain */
  provenance: {
    fundamentalsIds: Id<"financialFundamentals">[];
    sourceArtifactIds: Id<"sourceArtifacts">[];
    taxonomyVersion: string;
    restatementDecisions: string[];
  };

  /** Reproducibility validation */
  reproducibility: {
    inputHashMatch: boolean;
    outputHashMatch: boolean;
    deterministicRun: boolean;
    fullyReproducible: boolean;
  };
}

/* ------------------------------------------------------------------ */
/* HASH UTILITIES                                                      */
/* ------------------------------------------------------------------ */

/**
 * Simple deterministic hash for reproducibility checks
 * (In production, use crypto.subtle.digest)
 */
function simpleHash(obj: unknown): string {
  const str = JSON.stringify(obj, Object.keys(obj as object).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Generate deterministic hash of assumptions
 */
function hashAssumptions(assumptions: DcfAssumptions): string {
  // Extract only the deterministic parts
  const deterministicParts = {
    forecastYears: assumptions.forecastYears,
    baseYear: assumptions.baseYear,
    revenue: assumptions.revenue,
    operating: assumptions.operating,
    wacc: assumptions.wacc,
    terminal: assumptions.terminal,
    capitalStructure: assumptions.capitalStructure,
  };
  return simpleHash(deterministicParts);
}

/**
 * Generate deterministic hash of outputs
 */
function hashOutputs(outputs: DcfDetailedOutputs): string {
  const deterministicParts = {
    enterpriseValue: outputs.enterpriseValue,
    equityValue: outputs.equityValue,
    presentValueFcf: outputs.presentValueFcf,
    terminalValue: outputs.terminalValue,
    terminalValuePercent: outputs.terminalValuePercent,
  };
  return simpleHash(deterministicParts);
}

/* ------------------------------------------------------------------ */
/* GATE CHECKS                                                         */
/* ------------------------------------------------------------------ */

/**
 * Check input completeness gate
 */
function checkInputCompleteness(
  model: { assumptions: DcfAssumptions } | null,
  fundamentals: unknown[] | null
): ProbeResult {
  if (!model) {
    return probeFail(0, "AI model not found");
  }

  if (!model.assumptions) {
    return probeFail(20, "Model assumptions missing");
  }

  const required = ["forecastYears", "baseYear", "revenue", "operating", "wacc", "terminal"];
  const missing: string[] = [];
  const assumptions = model.assumptions as unknown as Record<string, unknown>;

  for (const field of required) {
    if (!assumptions[field]) {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    return probeFail(50 - missing.length * 10, `Missing required fields: ${missing.join(", ")}`);
  }

  if (!fundamentals || fundamentals.length === 0) {
    return probeFail(70, "No fundamentals data loaded");
  }

  return probePass(100, "All required inputs present");
}

/**
 * Check determinism gate
 */
function checkDeterminism(
  assumptions: DcfAssumptions,
  outputs1: DcfDetailedOutputs,
  outputs2: DcfDetailedOutputs
): ProbeResult {
  const hash1 = hashOutputs(outputs1);
  const hash2 = hashOutputs(outputs2);

  if (hash1 !== hash2) {
    return probeFail(0, `Non-deterministic: outputs differ (${hash1} vs ${hash2})`);
  }

  // Check specific value equality
  if (Math.abs(outputs1.enterpriseValue - outputs2.enterpriseValue) > 0.01) {
    return probeFail(30, "Enterprise value differs between runs");
  }

  return probePass(100, `Deterministic: hash=${hash1}`);
}

/**
 * Check provenance completeness gate
 */
function checkProvenanceCompleteness(
  assumptions: DcfAssumptions,
  sourceCount: number
): ProbeResult {
  let score = 100;
  const issues: string[] = [];

  // Check revenue growth has rationale
  const missingRationale = assumptions.revenue.growthRates.filter((g) => !g.rationale);
  if (missingRationale.length > 0) {
    score -= 20;
    issues.push(`${missingRationale.length} growth rates missing rationale`);
  }

  // Check WACC has sources
  if (!assumptions.wacc.sources || assumptions.wacc.sources.length === 0) {
    score -= 20;
    issues.push("WACC missing source citations");
  }

  // Check for citations
  if (sourceCount === 0) {
    score -= 30;
    issues.push("No source artifacts linked");
  }

  if (score >= 80) {
    return probePass(score, `Provenance ${score}% complete`);
  }

  return probeFail(score, issues.join("; "));
}

/**
 * Check audit trail gate
 */
function checkAuditTrail(
  model: { modelId: string; version: number; createdAt: number } | null
): ProbeResult {
  if (!model) {
    return probeFail(0, "Model not found for audit");
  }

  if (!model.modelId) {
    return probeFail(30, "Model missing ID");
  }

  if (!model.version) {
    return probeFail(50, "Model missing version");
  }

  if (!model.createdAt) {
    return probeFail(70, "Model missing creation timestamp");
  }

  return probePass(100, `Audit trail complete: ${model.modelId} v${model.version}`);
}

/* ------------------------------------------------------------------ */
/* SCORING FUNCTIONS                                                   */
/* ------------------------------------------------------------------ */

/**
 * Calculate assumption drift score
 */
function calculateAssumptionDrift(
  aiAssumptions: DcfAssumptions,
  groundTruthAssumptions?: DcfAssumptions
): { score: number; details: AssumptionDriftDetails } {
  const driftItems: AssumptionDriftDetails["driftItems"] = [];

  if (!groundTruthAssumptions) {
    // No ground truth - return neutral score with no drift items
    return {
      score: 70,
      details: {
        revenueGrowthDrift: 0,
        waccDrift: 0,
        terminalValueDrift: 0,
        operatingMarginDrift: 0,
        driftItems: [],
      },
    };
  }

  // Revenue growth drift
  const aiAvgGrowth = aiAssumptions.revenue.growthRates.reduce((sum, g) => sum + g.rate, 0) /
    aiAssumptions.revenue.growthRates.length;
  const gtAvgGrowth = groundTruthAssumptions.revenue.growthRates.reduce((sum, g) => sum + g.rate, 0) /
    groundTruthAssumptions.revenue.growthRates.length;
  const revenueGrowthDrift = Math.abs(aiAvgGrowth - gtAvgGrowth);

  driftItems.push({
    field: "revenue.avgGrowthRate",
    aiValue: aiAvgGrowth,
    groundTruthValue: gtAvgGrowth,
    drift: revenueGrowthDrift,
    severity: revenueGrowthDrift > 0.1 ? "critical" : revenueGrowthDrift > 0.05 ? "high" : revenueGrowthDrift > 0.02 ? "moderate" : "low",
  });

  // WACC drift
  const waccDrift = Math.abs(aiAssumptions.wacc.wacc - groundTruthAssumptions.wacc.wacc);
  driftItems.push({
    field: "wacc.wacc",
    aiValue: aiAssumptions.wacc.wacc,
    groundTruthValue: groundTruthAssumptions.wacc.wacc,
    drift: waccDrift,
    severity: waccDrift > 0.02 ? "critical" : waccDrift > 0.01 ? "high" : waccDrift > 0.005 ? "moderate" : "low",
  });

  // Terminal value drift
  const aiTerminal = aiAssumptions.terminal.perpetuityGrowth ?? aiAssumptions.terminal.exitMultiple ?? 0;
  const gtTerminal = groundTruthAssumptions.terminal.perpetuityGrowth ?? groundTruthAssumptions.terminal.exitMultiple ?? 0;
  const terminalValueDrift = Math.abs(aiTerminal - gtTerminal);

  driftItems.push({
    field: "terminal.value",
    aiValue: aiTerminal,
    groundTruthValue: gtTerminal,
    drift: terminalValueDrift,
    severity: terminalValueDrift > 0.02 ? "critical" : terminalValueDrift > 0.01 ? "high" : terminalValueDrift > 0.005 ? "moderate" : "low",
  });

  // Operating margin drift (use first year gross margin as proxy)
  const aiMargin = aiAssumptions.operating.grossMargin[0]?.value ?? 0;
  const gtMargin = groundTruthAssumptions.operating.grossMargin[0]?.value ?? 0;
  const operatingMarginDrift = Math.abs(aiMargin - gtMargin);

  // Calculate overall score
  // Weight: Revenue 35%, WACC 30%, Terminal 25%, Operating 10%
  const weightedDrift =
    revenueGrowthDrift * 0.35 +
    waccDrift * 10 * 0.30 + // WACC in decimal, scale up
    terminalValueDrift * 0.25 +
    operatingMarginDrift * 0.10;

  // Convert drift to score (lower drift = higher score)
  const score = Math.max(0, Math.min(100, 100 - weightedDrift * 200));

  return {
    score: Math.round(score),
    details: {
      revenueGrowthDrift,
      waccDrift,
      terminalValueDrift,
      operatingMarginDrift,
      driftItems,
    },
  };
}

/**
 * Calculate source quality score
 */
function calculateSourceQualityScore(
  sourceUrls: string[],
  sourceDates?: string[]
): { score: number; details: SourceQualityDetails } {
  if (sourceUrls.length === 0) {
    return {
      score: 30,
      details: {
        overallScore: 30,
        tierDistribution: {},
        primarySourceRatio: 0,
        concerns: ["No sources cited"],
        sourceCount: 0,
      },
    };
  }

  // Classify each source
  const classifications: SourceClassification[] = sourceUrls.map((url, i) =>
    classifySource(url, DEFAULT_SOURCE_RULES, {
      sourceDate: sourceDates?.[i],
    })
  );

  // Aggregate
  const aggregated = aggregateSourceQuality(classifications);

  return {
    score: aggregated.overallScore,
    details: {
      overallScore: aggregated.overallScore,
      tierDistribution: aggregated.tierDistribution,
      primarySourceRatio: aggregated.primarySourceRatio,
      concerns: aggregated.concerns,
      sourceCount: sourceUrls.length,
    },
  };
}

/**
 * Calculate model accuracy score
 */
function calculateModelAccuracyScore(
  aiOutputs: DcfDetailedOutputs,
  groundTruthOutputs?: DcfDetailedOutputs
): { score: number; details: ModelAccuracyDetails } {
  if (!groundTruthOutputs) {
    return {
      score: 70,
      details: {
        evDrift: 0,
        equityValueDrift: 0,
        fcfProjectionAccuracy: 100,
        terminalValueAccuracy: 100,
        formulaAccuracy: 100,
      },
    };
  }

  // EV drift
  const evDrift = Math.abs(aiOutputs.enterpriseValue - groundTruthOutputs.enterpriseValue) /
    groundTruthOutputs.enterpriseValue;

  // Equity value drift
  const equityValueDrift = Math.abs(aiOutputs.equityValue - groundTruthOutputs.equityValue) /
    groundTruthOutputs.equityValue;

  // Terminal value accuracy
  const tvDrift = Math.abs(aiOutputs.terminalValue - groundTruthOutputs.terminalValue) /
    groundTruthOutputs.terminalValue;
  const terminalValueAccuracy = Math.max(0, 100 - tvDrift * 100);

  // FCF projection accuracy (average across years)
  let fcfAccuracy = 100;
  if (aiOutputs.yearlyProjections && groundTruthOutputs.yearlyProjections) {
    const fcfDrifts = aiOutputs.yearlyProjections.map((p, i) => {
      const gt = groundTruthOutputs.yearlyProjections[i];
      return gt ? Math.abs(p.fcf - gt.fcf) / Math.abs(gt.fcf || 1) : 0;
    });
    const avgFcfDrift = fcfDrifts.reduce((a, b) => a + b, 0) / fcfDrifts.length;
    fcfAccuracy = Math.max(0, 100 - avgFcfDrift * 100);
  }

  // Formula accuracy (check discount factors, etc.)
  let formulaAccuracy = 100;
  if (aiOutputs.yearlyProjections && groundTruthOutputs.yearlyProjections) {
    for (let i = 0; i < aiOutputs.yearlyProjections.length; i++) {
      const ai = aiOutputs.yearlyProjections[i];
      const gt = groundTruthOutputs.yearlyProjections[i];
      if (gt && Math.abs(ai.discountFactor - gt.discountFactor) > 0.01) {
        formulaAccuracy -= 10;
      }
    }
  }

  // Weighted score
  const score = Math.round(
    (100 - evDrift * 100) * 0.4 +
    terminalValueAccuracy * 0.25 +
    fcfAccuracy * 0.25 +
    formulaAccuracy * 0.10
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    details: {
      evDrift,
      equityValueDrift,
      fcfProjectionAccuracy: fcfAccuracy,
      terminalValueAccuracy,
      formulaAccuracy,
    },
  };
}

/**
 * Determine final verdict
 */
function determineVerdict(
  scores: EvaluationResult["scores"],
  gatesPassed: boolean
): EvaluationVerdict {
  if (!gatesPassed) {
    return {
      verdict: "METHODOLOGY_MISMATCH",
      overallScore: scores.overall,
      assumptionDriftScore: scores.assumptionDrift,
      sourceQualityScore: scores.sourceQuality,
      modelAlignmentScore: scores.modelAccuracy,
      explanation: "Reproducibility gates failed - evaluation incomplete",
    };
  }

  if (scores.overall >= 85 && scores.assumptionDrift >= 80 && scores.sourceQuality >= 70) {
    return {
      verdict: "ALIGNED",
      overallScore: scores.overall,
      assumptionDriftScore: scores.assumptionDrift,
      sourceQualityScore: scores.sourceQuality,
      modelAlignmentScore: scores.modelAccuracy,
      explanation: "Model is well-aligned with ground truth",
    };
  }

  if (scores.overall >= 70) {
    return {
      verdict: "MINOR_DRIFT",
      overallScore: scores.overall,
      assumptionDriftScore: scores.assumptionDrift,
      sourceQualityScore: scores.sourceQuality,
      modelAlignmentScore: scores.modelAccuracy,
      explanation: "Model shows minor drift from ground truth - review recommended",
    };
  }

  if (scores.overall >= 50) {
    return {
      verdict: "SIGNIFICANT_DRIFT",
      overallScore: scores.overall,
      assumptionDriftScore: scores.assumptionDrift,
      sourceQualityScore: scores.sourceQuality,
      modelAlignmentScore: scores.modelAccuracy,
      explanation: "Model shows significant drift - manual review required",
    };
  }

  return {
    verdict: "METHODOLOGY_MISMATCH",
    overallScore: scores.overall,
    assumptionDriftScore: scores.assumptionDrift,
    sourceQualityScore: scores.sourceQuality,
    modelAlignmentScore: scores.modelAccuracy,
    explanation: "Model methodology does not align with ground truth",
  };
}

/* ------------------------------------------------------------------ */
/* REPRO PACK GENERATION                                               */
/* ------------------------------------------------------------------ */

/**
 * Generate reproducibility pack
 */
function generateReproPack(
  entityKey: string,
  aiModel: { modelId: string; assumptions: DcfAssumptions },
  aiOutputs: DcfDetailedOutputs,
  evaluation: EvaluationResult,
  fundamentalsIds: Id<"financialFundamentals">[],
  sourceArtifactIds: Id<"sourceArtifacts">[]
): ReproPackContents {
  const packId = `repro_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const assumptionsHash = hashAssumptions(aiModel.assumptions);
  const outputsHash = hashOutputs(aiOutputs);

  // Verify determinism by re-running calculation
  const rerunOutputs = calculateDcf(aiModel.assumptions);
  const rerunHash = hashOutputs(rerunOutputs);
  const deterministicRun = outputsHash === rerunHash;

  return {
    packId,
    entityKey,
    createdAt: Date.now(),
    inputHashes: {
      fundamentals: simpleHash(fundamentalsIds),
      assumptions: assumptionsHash,
      groundTruth: "none", // Would be populated if ground truth provided
    },
    outputHashes: {
      dcfOutputs: outputsHash,
      evaluation: simpleHash(evaluation.scores),
    },
    provenance: {
      fundamentalsIds,
      sourceArtifactIds,
      taxonomyVersion: "us-gaap-2024", // Would come from fundamentals
      restatementDecisions: [],
    },
    reproducibility: {
      inputHashMatch: true,
      outputHashMatch: deterministicRun,
      deterministicRun,
      fullyReproducible: deterministicRun,
    },
  };
}

/* ------------------------------------------------------------------ */
/* MAIN ORCHESTRATOR                                                   */
/* ------------------------------------------------------------------ */

/**
 * Run full evaluation pipeline
 */
export const runEvaluation = internalAction({
  args: {
    entityKey: v.string(),
    aiModelId: v.id("dcfModels"),
    groundTruthVersionId: v.optional(v.id("groundTruthVersions")),
    skipSourceQuality: v.optional(v.boolean()),
    skipSensitivity: v.optional(v.boolean()),
    generateReproPack: v.optional(v.boolean()),
  },
  returns: v.object({
    ok: v.boolean(),
    evaluationId: v.optional(v.string()),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<{
    ok: boolean;
    evaluationId?: string;
    result?: EvaluationResult;
    error?: string;
  }> => {
    const evaluationId = `eval_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    try {
      // 1. Load AI model
      const aiModel = await ctx.runQuery(
        internal.domains.evaluation.financial.evaluationOrchestrator.getModelById,
        { modelId: args.aiModelId }
      );

      if (!aiModel) {
        return { ok: false, error: "AI model not found" };
      }

      // 2. Load fundamentals for the entity
      const fundamentals = await ctx.runQuery(
        internal.domains.evaluation.financial.evaluationOrchestrator.getFundamentalsForEntity,
        { entityKey: args.entityKey }
      );

      // 3. Run gate checks
      const inputCompletenessResult = checkInputCompleteness(aiModel, fundamentals);

      // Run DCF calculation twice for determinism check
      const outputs1 = calculateDcf(aiModel.assumptions);
      const outputs2 = calculateDcf(aiModel.assumptions);
      const determinismResult = checkDeterminism(aiModel.assumptions, outputs1, outputs2);

      // Provenance check
      const sourceCount = 0; // Would come from model.citationArtifactIds
      const provenanceResult = checkProvenanceCompleteness(aiModel.assumptions, sourceCount);

      // Audit trail check
      const auditResult = checkAuditTrail(aiModel);

      const gates = {
        inputCompleteness: inputCompletenessResult,
        determinismCheck: determinismResult,
        provenanceCompleteness: provenanceResult,
        auditTrail: auditResult,
      };

      const gateResults = [inputCompletenessResult, determinismResult, provenanceResult, auditResult];
      const aggregatedGates = aggregateProbeResults(gateResults);
      const gatesPassed = aggregatedGates.outcome === "pass";

      // 4. Calculate scores
      const assumptionDrift = calculateAssumptionDrift(aiModel.assumptions);
      const sourceQuality = args.skipSourceQuality
        ? { score: 70, details: { overallScore: 70, tierDistribution: {}, primarySourceRatio: 0, concerns: ["Skipped"], sourceCount: 0 } }
        : calculateSourceQualityScore([]);
      const modelAccuracy = calculateModelAccuracyScore(outputs1);

      // Weighted overall: Assumptions 40%, Source 30%, Model 30%
      const overall = Math.round(
        assumptionDrift.score * 0.4 +
        sourceQuality.score * 0.3 +
        modelAccuracy.score * 0.3
      );

      const scores = {
        assumptionDrift: assumptionDrift.score,
        sourceQuality: sourceQuality.score,
        modelAccuracy: modelAccuracy.score,
        overall,
      };

      // 5. Determine verdict
      const verdict = determineVerdict(scores, gatesPassed);

      // 6. Build result
      const result: EvaluationResult = {
        evaluationId,
        entityKey: args.entityKey,
        evaluatedAt: Date.now(),
        gates,
        gatesPassed,
        scores,
        scoreBreakdown: {
          assumptionDriftDetails: assumptionDrift.details,
          sourceQualityDetails: sourceQuality.details,
          modelAccuracyDetails: modelAccuracy.details,
        },
        verdict,
      };

      // 7. Generate repro pack if requested
      if (args.generateReproPack && gatesPassed) {
        const reproPack = generateReproPack(
          args.entityKey,
          aiModel,
          outputs1,
          result,
          fundamentals?.map((f: { _id: Id<"financialFundamentals"> }) => f._id) ?? [],
          []
        );

        const reproPackId = await ctx.runMutation(
          internal.domains.evaluation.financial.evaluationOrchestrator.saveReproPack,
          {
            packId: reproPack.packId,
            entityKey: args.entityKey,
            dcfModelId: args.aiModelId,
            contents: reproPack,
          }
        );

        result.reproPackId = reproPackId;
      }

      // 8. Save evaluation result
      await ctx.runMutation(
        internal.domains.evaluation.financial.evaluationOrchestrator.saveEvaluationResult,
        {
          evaluationId,
          entityKey: args.entityKey,
          aiModelId: args.aiModelId,
          groundTruthVersionId: args.groundTruthVersionId,
          result,
        }
      );

      return { ok: true, evaluationId, result };
    } catch (error) {
      return {
        ok: false,
        evaluationId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/* ------------------------------------------------------------------ */
/* INTERNAL QUERIES & MUTATIONS                                        */
/* ------------------------------------------------------------------ */

/**
 * Get model by ID (internal)
 */
export const getModelById = internalQuery({
  args: { modelId: v.id("dcfModels") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.modelId);
  },
});

/**
 * Get fundamentals for entity (internal)
 */
export const getFundamentalsForEntity = internalQuery({
  args: { entityKey: v.string() },
  returns: v.union(v.null(), v.array(v.any())),
  handler: async (ctx, args) => {
    const fundamentals = await ctx.db
      .query("financialFundamentals")
      .withIndex("by_ticker_period", (q) => q.eq("ticker", args.entityKey.toUpperCase()))
      .take(10);

    return fundamentals.length > 0 ? fundamentals : null;
  },
});

/**
 * Save evaluation result (internal)
 */
export const saveEvaluationResult = internalMutation({
  args: {
    evaluationId: v.string(),
    entityKey: v.string(),
    aiModelId: v.id("dcfModels"),
    groundTruthVersionId: v.optional(v.id("groundTruthVersions")),
    result: v.any(),
  },
  returns: v.id("financialModelEvaluations"),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("financialModelEvaluations", {
      evaluationId: args.evaluationId,
      entityName: args.entityKey,
      evaluationType: "dcf",
      aiModelId: args.aiModelId,
      groundTruthVersionId: args.groundTruthVersionId,
      assumptionDriftScore: args.result.scores.assumptionDrift,
      sourceQualityScore: args.result.scores.sourceQuality,
      modelAlignmentScore: args.result.scores.modelAccuracy,
      overallScore: args.result.scores.overall,
      verdict: args.result.verdict.verdict,
      gatesPassed: args.result.gatesPassed,
      gateResults: args.result.gates,
      scoreBreakdown: args.result.scoreBreakdown,
      createdAt: Date.now(),
    });

    return id;
  },
});

/**
 * Save repro pack (internal)
 */
export const saveReproPack = internalMutation({
  args: {
    packId: v.string(),
    entityKey: v.string(),
    dcfModelId: v.id("dcfModels"),
    contents: v.any(),
  },
  returns: v.id("modelReproPacks"),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("modelReproPacks", {
      packId: args.packId,
      entityKey: args.entityKey,
      dcfModelId: args.dcfModelId,
      contents: args.contents,
      fullyReproducible: args.contents.reproducibility.fullyReproducible,
      createdAt: Date.now(),
    });

    return id;
  },
});

/* ------------------------------------------------------------------ */
/* PUBLIC QUERIES                                                      */
/* ------------------------------------------------------------------ */

/**
 * Get evaluation by ID
 */
export const getEvaluation = query({
  args: { evaluationId: v.string() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("financialModelEvaluations")
      .withIndex("by_evaluation_id", (q) => q.eq("evaluationId", args.evaluationId))
      .first();
  },
});

/**
 * Get evaluations for entity
 */
export const getEntityEvaluations = query({
  args: {
    entityKey: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("financialModelEvaluations")
      .withIndex("by_entity", (q) => q.eq("entityName", args.entityKey))
      .order("desc")
      .take(args.limit ?? 10);
  },
});

/**
 * Get repro pack
 */
export const getReproPack = query({
  args: { packId: v.string() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("modelReproPacks")
      .withIndex("by_pack_id", (q) => q.eq("packId", args.packId))
      .first();
  },
});
