/**
 * ddEvaluation.ts
 *
 * DD-specific evaluation framework.
 * - Boolean quality factors (not arbitrary scores)
 * - Ground truth validation
 * - DD-specific test scenarios
 */

import { v } from "convex/values";
import { mutation, query, internalAction, internalMutation } from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import { Doc, Id } from "../../_generated/dataModel";
import {
  DDBooleanFactors,
  DDEvaluationResult,
  DDMemo,
  Verdict,
} from "../agents/dueDiligence/types";

// ============================================================================
// Boolean Factor Evaluation
// ============================================================================

/**
 * Evaluate DD memo against boolean quality factors
 */
export function evaluateBooleanFactors(memo: DDMemo): DDBooleanFactors {
  return {
    // Core factors
    hasCompanyProfile: Boolean(
      memo.companyOverview?.description &&
      memo.companyOverview.description.length > 20
    ),
    hasTeamData: Boolean(
      memo.teamAnalysis?.founders?.length > 0 ||
      memo.teamAnalysis?.executives?.length > 0
    ),
    hasMarketAnalysis: Boolean(
      memo.marketAnalysis?.marketSize ||
      memo.marketAnalysis?.competitors?.length > 0
    ),
    hasRiskAssessment: Boolean(memo.risks?.length > 0),
    hasInvestmentThesis: Boolean(
      memo.investmentThesis?.thesisSummary &&
      memo.investmentThesis.thesisSummary.length > 10
    ),

    // Verification factors
    fundingVerifiedViaSEC: memo.sources?.some(
      s => s.sourceType === "sec_filing"
    ) ?? false,
    teamVerifiedViaLinkedIn: memo.sources?.some(
      s => s.sourceType === "linkedin"
    ) ?? false,
    patentsVerifiedViaUSPTO: memo.sources?.some(
      s => s.sourceType === "patent_db"
    ) ?? false,

    // Cross-check factors
    noCriticalContradictions:
      (memo.verificationSummary?.contradictionsFound ?? 0) -
      (memo.verificationSummary?.contradictionsResolved ?? 0) === 0,
    allContradictionsResolved:
      (memo.verificationSummary?.contradictionsFound ?? 0) ===
      (memo.verificationSummary?.contradictionsResolved ?? 0),

    // Completeness
    allCoreBranchesCompleted: Boolean(
      memo.companyOverview?.description &&
      memo.teamAnalysis &&
      memo.marketAnalysis
    ),
    conditionalBranchesAppropriate: true, // Would need job context to validate

    // Traditional memo structure
    hasExecutiveSummary: Boolean(
      memo.executiveSummary && memo.executiveSummary.length > 50
    ),
    hasVerdict: Boolean(memo.verdict && memo.verdict !== "INSUFFICIENT_DATA"),

    // Quality thresholds
    confidenceAboveThreshold:
      (memo.verificationSummary?.overallConfidence ?? 0) >= 0.6,
    dataCompletenessAboveThreshold:
      (memo.verificationSummary?.dataCompleteness ?? 0) >= 0.6,
  };
}

/**
 * Calculate overall pass/fail from boolean factors
 */
export function calculatePassFail(factors: DDBooleanFactors): {
  passed: boolean;
  passedCount: number;
  totalCount: number;
  failedFactors: string[];
} {
  const entries = Object.entries(factors);
  const failedFactors: string[] = [];

  for (const [key, value] of entries) {
    if (!value) {
      failedFactors.push(key);
    }
  }

  const passedCount = entries.length - failedFactors.length;
  const passed = passedCount >= entries.length * 0.8; // 80% threshold

  return {
    passed,
    passedCount,
    totalCount: entries.length,
    failedFactors,
  };
}

// ============================================================================
// Ground Truth Validation
// ============================================================================

/**
 * Validate memo against ground truth
 */
export function validateAgainstGroundTruth(
  memo: DDMemo,
  groundTruth: Doc<"ddGroundTruth">
): {
  matches: number;
  mismatches: number;
  details: Array<{
    field: string;
    expected: any;
    actual: any;
    matched: boolean;
  }>;
} {
  const details: Array<{
    field: string;
    expected: any;
    actual: any;
    matched: boolean;
  }> = [];

  const verifiedFacts = groundTruth.verifiedFacts;

  // Validate founded year
  if (verifiedFacts.foundedYear) {
    const expected = verifiedFacts.foundedYear.value;
    const actual = memo.companyOverview?.foundedYear;
    details.push({
      field: "foundedYear",
      expected,
      actual,
      matched: expected === actual,
    });
  }

  // Validate HQ location
  if (verifiedFacts.hqLocation) {
    const expected = verifiedFacts.hqLocation.value.toLowerCase();
    const actual = memo.companyOverview?.hqLocation?.toLowerCase();
    const matched = actual?.includes(expected) || expected.includes(actual ?? "xxx");
    details.push({
      field: "hqLocation",
      expected: verifiedFacts.hqLocation.value,
      actual: memo.companyOverview?.hqLocation,
      matched,
    });
  }

  // Validate employee count (with tolerance)
  if (verifiedFacts.employeeCount) {
    const expected = verifiedFacts.employeeCount.value;
    const actual = memo.companyOverview?.employeeCount;
    const tolerance = 0.3; // 30% tolerance
    const matched = actual !== undefined &&
      Math.abs(expected - actual) / expected <= tolerance;
    details.push({
      field: "employeeCount",
      expected,
      actual,
      matched,
    });
  }

  // Validate funding rounds
  if (verifiedFacts.fundingRounds && verifiedFacts.fundingRounds.length > 0) {
    const expectedRounds = verifiedFacts.fundingRounds;
    const actualRounds = memo.fundingHistory?.rounds ?? [];

    // Check if expected rounds are present
    for (const expected of expectedRounds) {
      const found = actualRounds.some(
        a => a.roundType.toLowerCase() === expected.roundType.toLowerCase()
      );
      details.push({
        field: `fundingRound_${expected.roundType}`,
        expected: expected.roundType,
        actual: found ? expected.roundType : "not found",
        matched: found,
      });
    }
  }

  // Validate key people
  if (verifiedFacts.keyPeople && verifiedFacts.keyPeople.length > 0) {
    const expectedPeople = verifiedFacts.keyPeople;
    const actualPeople = [
      ...(memo.teamAnalysis?.founders ?? []),
      ...(memo.teamAnalysis?.executives ?? []),
    ];

    for (const expected of expectedPeople) {
      const found = actualPeople.some(
        a => a.name?.toLowerCase() === expected.name.toLowerCase()
      );
      details.push({
        field: `keyPerson_${expected.name}`,
        expected: expected.name,
        actual: found ? expected.name : "not found",
        matched: found,
      });
    }
  }

  const matches = details.filter(d => d.matched).length;
  const mismatches = details.filter(d => !d.matched).length;

  return { matches, mismatches, details };
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get ground truth for an entity
 */
export const getGroundTruth = query({
  args: {
    entityName: v.string(),
    entityType: v.union(v.literal("company"), v.literal("fund"), v.literal("person")),
  },
  handler: async (ctx, { entityName, entityType }) => {
    return await ctx.db
      .query("ddGroundTruth")
      .withIndex("by_entity", q => q.eq("entityName", entityName).eq("entityType", entityType))
      .first() as Doc<"ddGroundTruth"> | null;
  },
});

/**
 * Get all ground truth entries
 */
export const listGroundTruth = query({
  args: {
    curationStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("verified"),
      v.literal("contested")
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { curationStatus, limit = 50 }) => {
    let query = ctx.db.query("ddGroundTruth");

    if (curationStatus) {
      query = query.withIndex("by_curation_status", q => q.eq("curationStatus", curationStatus));
    }

    return await query.take(limit) as Doc<"ddGroundTruth">[];
  },
});

// ============================================================================
// Mutations - Ground Truth Management
// ============================================================================

/**
 * Create or update ground truth entry
 */
export const upsertGroundTruth = mutation({
  args: {
    entityName: v.string(),
    entityType: v.union(v.literal("company"), v.literal("fund"), v.literal("person")),
    verifiedFacts: v.any(),
    expectedMemo: v.optional(v.any()),
    curatorId: v.optional(v.id("users")),
    curationStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("verified"),
      v.literal("contested")
    )),
    curatorNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check for existing
    const existing = await ctx.db
      .query("ddGroundTruth")
      .withIndex("by_entity", q =>
        q.eq("entityName", args.entityName).eq("entityType", args.entityType)
      )
      .first() as Doc<"ddGroundTruth"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        verifiedFacts: args.verifiedFacts,
        expectedMemo: args.expectedMemo,
        curatorId: args.curatorId,
        curationStatus: args.curationStatus ?? existing.curationStatus,
        curatorNotes: args.curatorNotes,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("ddGroundTruth", {
      entityName: args.entityName,
      entityType: args.entityType,
      verifiedFacts: args.verifiedFacts,
      expectedMemo: args.expectedMemo,
      curatorId: args.curatorId,
      curationStatus: args.curationStatus ?? "pending",
      curatorNotes: args.curatorNotes,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update curation status
 */
export const updateCurationStatus = mutation({
  args: {
    groundTruthId: v.id("ddGroundTruth"),
    curationStatus: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("verified"),
      v.literal("contested")
    ),
    curatorId: v.optional(v.id("users")),
    curatorNotes: v.optional(v.string()),
  },
  handler: async (ctx, { groundTruthId, curationStatus, curatorId, curatorNotes }) => {
    await ctx.db.patch(groundTruthId, {
      curationStatus,
      curatorId,
      curatorNotes,
      updatedAt: Date.now(),
    });
  },
});

// ============================================================================
// Actions - Full Evaluation
// ============================================================================

/**
 * Run full DD evaluation against ground truth
 */
export const evaluateDDJobInternal = internalAction({
  args: {
    jobId: v.string(),
    userId: v.id("users"),
    groundTruthId: v.optional(v.id("ddGroundTruth")),
  },
  handler: async (ctx, { jobId, userId, groundTruthId }): Promise<DDEvaluationResult> => {
    const startTime = Date.now();

    // Get the DD job and memo
    const jobResult = await ctx.runQuery(
      internal.domains.agents.dueDiligence.ddMutations.getDDJobDetailInternal,
      { jobId, userId }
    );

    if (!jobResult?.job || !jobResult?.memo) {
      throw new Error(`DD job or memo not found: ${jobId}`);
    }

    const memo = jobResult.memo as DDMemo;

    // Evaluate boolean factors
    const booleanFactors = evaluateBooleanFactors(memo);
    const { passed, failedFactors } = calculatePassFail(booleanFactors);

    // Warnings
    const warnings: string[] = [];

    // Validate against ground truth if available
    if (groundTruthId) {
      const groundTruth = await ctx.runQuery(
        api.domains.evaluation.ddEvaluation.getGroundTruth,
        {
          entityName: memo.entityName,
          entityType: memo.entityType,
        }
      );

      if (groundTruth) {
        const validation = validateAgainstGroundTruth(memo, groundTruth);

        if (validation.mismatches > 0) {
          warnings.push(`${validation.mismatches} ground truth mismatches found`);
        }
      }
    }

    // Check for data gaps
    if (!booleanFactors.hasTeamData) {
      warnings.push("Missing team/founder data");
    }
    if (!booleanFactors.hasMarketAnalysis) {
      warnings.push("Missing market analysis");
    }
    if (!booleanFactors.fundingVerifiedViaSEC) {
      warnings.push("Funding not verified via SEC filings");
    }

    const executionTimeMs = Date.now() - startTime;

    return {
      entityName: memo.entityName,
      passed,
      booleanFactors,
      failedFactors,
      warnings,
      executionTimeMs,
    };
  },
});

// ============================================================================
// Test Scenarios
// ============================================================================

/**
 * DD-specific test scenarios
 */
export const DD_TEST_SCENARIOS = {
  // Full DD on a biotech company (banker persona)
  dd_disco_banker: {
    entityName: "DISCO Pharmaceuticals",
    entityType: "company" as const,
    triggerSource: "manual" as const,
    expectedVerdict: "HOLD" as Verdict,
    requiredFactors: [
      "hasCompanyProfile",
      "hasTeamData",
      "hasRiskAssessment",
      "hasInvestmentThesis",
    ],
    description: "Full DD for JPM Startup Banker persona",
  },

  // Technical DD on OSS project (CTO persona)
  dd_oss_cto: {
    entityName: "OpenAutoGLM",
    entityType: "company" as const,
    triggerSource: "manual" as const,
    expectedVerdict: "BUY" as Verdict,
    requiredFactors: [
      "hasCompanyProfile",
      "hasMarketAnalysis",
    ],
    description: "Technical DD for CTO persona",
  },

  // VC thesis generation
  dd_ambros_vc: {
    entityName: "Ambros Therapeutics",
    entityType: "company" as const,
    triggerSource: "manual" as const,
    expectedVerdict: "BUY" as Verdict,
    requiredFactors: [
      "hasCompanyProfile",
      "hasTeamData",
      "hasMarketAnalysis",
      "hasInvestmentThesis",
    ],
    description: "VC thesis for Early Stage VC persona",
  },
};

/**
 * Seed ground truth for test entities
 */
export const seedTestGroundTruth = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const testEntities = [
      {
        entityName: "DISCO Pharmaceuticals",
        entityType: "company" as const,
        verifiedFacts: {
          foundedYear: { value: 2020, source: "Crunchbase", verifiedAt: now },
          hqLocation: { value: "Cambridge, MA", source: "Company website", verifiedAt: now },
          keyPeople: [
            { name: "John Smith", role: "CEO", verified: true },
          ],
          fundingRounds: [
            { roundType: "Series A", amount: 50000000, date: "2023-01", verified: true },
          ],
        },
        expectedMemo: {
          expectedVerdict: "HOLD",
          expectedRiskCategories: ["Regulatory", "Execution"],
        },
        curationStatus: "verified" as const,
      },
      {
        entityName: "Ambros Therapeutics",
        entityType: "company" as const,
        verifiedFacts: {
          foundedYear: { value: 2021, source: "SEC Form D", verifiedAt: now },
          hqLocation: { value: "San Francisco, CA", source: "LinkedIn", verifiedAt: now },
          fundingRounds: [
            { roundType: "Seed", amount: 10000000, date: "2022-06", verified: true },
          ],
        },
        expectedMemo: {
          expectedVerdict: "BUY",
          expectedRiskCategories: ["Market", "Team"],
        },
        curationStatus: "verified" as const,
      },
    ];

    for (const entity of testEntities) {
      // Check if exists
      const existing = await ctx.db
        .query("ddGroundTruth")
        .withIndex("by_entity", q =>
          q.eq("entityName", entity.entityName).eq("entityType", entity.entityType)
        )
        .first() as Doc<"ddGroundTruth"> | null;

      if (!existing) {
        await ctx.db.insert("ddGroundTruth", {
          ...entity,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return { seeded: testEntities.length };
  },
});
