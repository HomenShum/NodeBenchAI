/**
 * Entity Linking Judge - LLM-based validation for entity links
 *
 * Uses an LLM judge to evaluate whether entity links are correct,
 * providing boolean accuracy metrics rather than heuristic confidence scores.
 *
 * Features:
 * - Post-hoc validation of entity links against ground truth
 * - Boolean pass/fail metrics for accuracy calculation
 * - Confidence calibration based on historical accuracy
 * - Batch validation for test suites
 *
 * @module domains/enrichment/entityLinkingJudge
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface JudgeResult {
  isCorrect: boolean;
  reasoning: string;
  judgeConfidence: number; // How confident the judge is in its verdict
  factorsConsidered: string[];
}

export interface ValidationResult {
  query: string;
  linkedEntity: {
    wikidataId: string;
    canonicalName: string;
    description?: string;
  };
  expectedWikidataId?: string;
  judgeVerdict: JudgeResult;
  originalConfidence: number;
  calibratedConfidence?: number;
}

export interface AccuracyMetrics {
  totalEvaluated: number;
  correctLinks: number;
  incorrectLinks: number;
  accuracy: number;
  precisionByConfidenceBucket: {
    bucket: string;
    range: [number, number];
    total: number;
    correct: number;
    precision: number;
  }[];
  calibrationError: number; // Mean absolute difference between confidence and accuracy
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM JUDGE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Use LLM to judge whether an entity link is correct
 */
async function judgeEntityLink(
  query: string,
  context: string | undefined,
  linkedWikidataId: string,
  linkedName: string,
  linkedDescription: string | undefined,
  expectedWikidataId?: string
): Promise<JudgeResult> {
  const prompt = `You are an expert entity linking judge. Evaluate whether the linked entity is the CORRECT match for the query.

QUERY: "${query}"
${context ? `CONTEXT: "${context}"` : ""}

LINKED ENTITY:
- Wikidata ID: ${linkedWikidataId}
- Name: ${linkedName}
- Description: ${linkedDescription || "No description"}

${expectedWikidataId ? `EXPECTED WIKIDATA ID: ${expectedWikidataId}` : ""}

EVALUATION CRITERIA:
1. Does the linked entity match what the query is referring to?
2. Is the entity type appropriate (person vs company vs place)?
3. Does the context support this being the correct entity?
4. If expected ID provided: Does the linked ID match?

RESPOND WITH JSON ONLY:
{
  "isCorrect": true/false,
  "reasoning": "Brief explanation of why this is correct/incorrect",
  "judgeConfidence": 0.0-1.0,
  "factorsConsidered": ["factor1", "factor2", ...]
}`;

  try {
    const result = await generateText({
      model: openai.chat("gpt-5.4-nano"),
      prompt,
      temperature: 0.1,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        isCorrect: Boolean(parsed.isCorrect),
        reasoning: parsed.reasoning || "No reasoning provided",
        judgeConfidence: parsed.judgeConfidence || 0.5,
        factorsConsidered: parsed.factorsConsidered || [],
      };
    }
  } catch (error) {
    console.error("[judgeEntityLink] Error:", error);
  }

  // Fallback: if expected ID provided, compare directly
  if (expectedWikidataId) {
    const isMatch = linkedWikidataId === expectedWikidataId;
    return {
      isCorrect: isMatch,
      reasoning: isMatch
        ? "Wikidata IDs match exactly"
        : "Wikidata IDs do not match",
      judgeConfidence: 1.0,
      factorsConsidered: ["wikidata_id_comparison"],
    };
  }

  return {
    isCorrect: false,
    reasoning: "Judge failed to evaluate",
    judgeConfidence: 0.0,
    factorsConsidered: ["judge_error"],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate a single entity link using LLM judge
 */
export const validateEntityLink = internalAction({
  args: {
    query: v.string(),
    context: v.optional(v.string()),
    linkedWikidataId: v.string(),
    linkedName: v.string(),
    linkedDescription: v.optional(v.string()),
    expectedWikidataId: v.optional(v.string()),
    originalConfidence: v.number(),
  },
  returns: v.object({
    isCorrect: v.boolean(),
    reasoning: v.string(),
    judgeConfidence: v.number(),
    factorsConsidered: v.array(v.string()),
    originalConfidence: v.number(),
  }),
  handler: async (ctx, args) => {
    const result = await judgeEntityLink(
      args.query,
      args.context,
      args.linkedWikidataId,
      args.linkedName,
      args.linkedDescription,
      args.expectedWikidataId
    );

    return {
      ...result,
      originalConfidence: args.originalConfidence,
    };
  },
});

/**
 * Batch validate entity links and compute accuracy metrics
 */
export const batchValidateAndComputeMetrics = internalAction({
  args: {
    testCases: v.array(
      v.object({
        query: v.string(),
        context: v.optional(v.string()),
        expectedWikidataId: v.string(),
        expectedType: v.optional(v.string()),
      })
    ),
  },
  returns: v.object({
    accuracy: v.number(),
    totalEvaluated: v.number(),
    correctLinks: v.number(),
    incorrectLinks: v.number(),
    calibrationError: v.number(),
    precisionByConfidenceBucket: v.array(
      v.object({
        bucket: v.string(),
        rangeMin: v.number(),
        rangeMax: v.number(),
        total: v.number(),
        correct: v.number(),
        precision: v.number(),
      })
    ),
    results: v.array(
      v.object({
        query: v.string(),
        expectedId: v.string(),
        linkedId: v.optional(v.string()),
        linkedName: v.optional(v.string()),
        isCorrect: v.boolean(),
        originalConfidence: v.number(),
        judgeConfidence: v.number(),
        reasoning: v.string(),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const results: Array<{
      query: string;
      expectedId: string;
      linkedId?: string;
      linkedName?: string;
      isCorrect: boolean;
      originalConfidence: number;
      judgeConfidence: number;
      reasoning: string;
    }> = [];

    // Step 1: Run entity linking on each test case
    for (const testCase of args.testCases) {
      const linkResult = await ctx.runAction(
        internal.domains.enrichment.entityLinkingService.linkEntity,
        {
          name: testCase.query,
          context: testCase.context,
          expectedType: testCase.expectedType as any,
        }
      );

      if (!linkResult.found || !linkResult.wikidataId) {
        results.push({
          query: testCase.query,
          expectedId: testCase.expectedWikidataId,
          isCorrect: false,
          originalConfidence: linkResult.confidence,
          judgeConfidence: 1.0, // We're certain it failed
          reasoning: "Entity not found",
        });
        continue;
      }

      // Step 2: Judge the result
      const judgeResult = await judgeEntityLink(
        testCase.query,
        testCase.context,
        linkResult.wikidataId,
        linkResult.canonicalName || "",
        linkResult.description,
        testCase.expectedWikidataId
      );

      results.push({
        query: testCase.query,
        expectedId: testCase.expectedWikidataId,
        linkedId: linkResult.wikidataId,
        linkedName: linkResult.canonicalName,
        isCorrect: judgeResult.isCorrect,
        originalConfidence: linkResult.confidence,
        judgeConfidence: judgeResult.judgeConfidence,
        reasoning: judgeResult.reasoning,
      });
    }

    // Step 3: Compute metrics
    const correctLinks = results.filter((r) => r.isCorrect).length;
    const incorrectLinks = results.length - correctLinks;
    const accuracy = results.length > 0 ? correctLinks / results.length : 0;

    // Step 4: Compute precision by confidence bucket
    const buckets = [
      { bucket: "0.0-0.3", rangeMin: 0.0, rangeMax: 0.3 },
      { bucket: "0.3-0.5", rangeMin: 0.3, rangeMax: 0.5 },
      { bucket: "0.5-0.7", rangeMin: 0.5, rangeMax: 0.7 },
      { bucket: "0.7-0.9", rangeMin: 0.7, rangeMax: 0.9 },
      { bucket: "0.9-1.0", rangeMin: 0.9, rangeMax: 1.0 },
    ];

    const precisionByConfidenceBucket = buckets.map((bucket) => {
      const inBucket = results.filter(
        (r) =>
          r.originalConfidence >= bucket.rangeMin &&
          r.originalConfidence < bucket.rangeMax
      );
      const correctInBucket = inBucket.filter((r) => r.isCorrect).length;
      return {
        ...bucket,
        total: inBucket.length,
        correct: correctInBucket,
        precision: inBucket.length > 0 ? correctInBucket / inBucket.length : 0,
      };
    });

    // Step 5: Compute calibration error (ECE - Expected Calibration Error)
    let calibrationError = 0;
    let totalWeight = 0;
    for (const bucket of precisionByConfidenceBucket) {
      if (bucket.total > 0) {
        const midpoint = (bucket.rangeMin + bucket.rangeMax) / 2;
        const error = Math.abs(midpoint - bucket.precision);
        calibrationError += error * bucket.total;
        totalWeight += bucket.total;
      }
    }
    calibrationError = totalWeight > 0 ? calibrationError / totalWeight : 0;

    return {
      accuracy,
      totalEvaluated: results.length,
      correctLinks,
      incorrectLinks,
      calibrationError,
      precisionByConfidenceBucket,
      results,
    };
  },
});

/**
 * Run comprehensive validation suite with ground truth test cases
 */
export const runValidationSuite = internalAction({
  args: {},
  returns: v.object({
    summary: v.object({
      accuracy: v.number(),
      total: v.number(),
      passed: v.number(),
      failed: v.number(),
      calibrationError: v.number(),
    }),
    categories: v.array(
      v.object({
        name: v.string(),
        accuracy: v.number(),
        total: v.number(),
        passed: v.number(),
      })
    ),
    calibrationAnalysis: v.object({
      isWellCalibrated: v.boolean(),
      recommendation: v.string(),
      bucketDetails: v.array(
        v.object({
          bucket: v.string(),
          expectedAccuracy: v.number(),
          actualAccuracy: v.number(),
          gap: v.number(),
        })
      ),
    }),
    failedCases: v.array(
      v.object({
        query: v.string(),
        expected: v.string(),
        got: v.optional(v.string()),
        confidence: v.number(),
        reason: v.string(),
      })
    ),
  }),
  handler: async (ctx) => {
    // Ground truth test cases organized by category
    const testSuites = {
      disambiguation: [
        { query: "Michael Jordan", context: "NBA basketball player", expectedWikidataId: "Q41421" },
        { query: "Michael Jordan", context: "machine learning professor", expectedWikidataId: "Q3308285" },
        { query: "Apple", context: "technology company iPhone", expectedWikidataId: "Q312" },
        { query: "Mercury", context: "planet solar system", expectedWikidataId: "Q308" },
        { query: "Mercury", context: "chemical element", expectedWikidataId: "Q925" },
      ],
      aliases: [
        { query: "Diddy", context: "rapper music producer", expectedWikidataId: "Q216936" },
        { query: "The Rock", context: "actor wrestler", expectedWikidataId: "Q10738" },
        { query: "Lady Gaga", context: "singer pop star", expectedWikidataId: "Q19848" },
        { query: "MBS", context: "Saudi Arabia crown prince", expectedWikidataId: "Q6892571" },
      ],
      typos: [
        { query: "Elon Muk", context: "Tesla CEO", expectedWikidataId: "Q317521" },
        { query: "Mark Zuckerburg", context: "Facebook Meta CEO", expectedWikidataId: "Q36215" },
        { query: "Jeff Besos", context: "Amazon founder", expectedWikidataId: "Q312556" },
      ],
      companies: [
        { query: "Tesla", context: "electric vehicle company", expectedWikidataId: "Q478214" },
        { query: "Amazon", context: "e-commerce Jeff Bezos", expectedWikidataId: "Q3884" },
        { query: "Ford", context: "automobile manufacturer", expectedWikidataId: "Q44294" },
      ],
      executives: [
        { query: "Bill Gates", context: "Microsoft founder", expectedWikidataId: "Q5284" },
        { query: "Warren Buffett", context: "Berkshire Hathaway investor", expectedWikidataId: "Q47213" },
        { query: "Jensen Huang", context: "NVIDIA CEO", expectedWikidataId: "Q305177" },
        { query: "Sundar Pichai", context: "Google Alphabet CEO", expectedWikidataId: "Q3503829" },
      ],
    };

    const allTests = Object.entries(testSuites).flatMap(([category, tests]) =>
      tests.map((t) => ({ ...t, category }))
    );

    // Run validation
    const metrics = await ctx.runAction(
      internal.domains.enrichment.entityLinkingJudge.batchValidateAndComputeMetrics,
      {
        testCases: allTests.map((t) => ({
          query: t.query,
          context: t.context,
          expectedWikidataId: t.expectedWikidataId,
        })),
      }
    );

    // Compute per-category accuracy
    const categoryResults: { [key: string]: { passed: number; total: number } } = {};
    for (let i = 0; i < allTests.length; i++) {
      const test = allTests[i];
      const result = metrics.results[i];
      if (!categoryResults[test.category]) {
        categoryResults[test.category] = { passed: 0, total: 0 };
      }
      categoryResults[test.category].total++;
      if (result.isCorrect) {
        categoryResults[test.category].passed++;
      }
    }

    const categories = Object.entries(categoryResults).map(([name, stats]) => ({
      name,
      accuracy: stats.total > 0 ? stats.passed / stats.total : 0,
      total: stats.total,
      passed: stats.passed,
    }));

    // Calibration analysis
    const bucketDetails = metrics.precisionByConfidenceBucket.map((b) => ({
      bucket: b.bucket,
      expectedAccuracy: (b.rangeMin + b.rangeMax) / 2,
      actualAccuracy: b.precision,
      gap: Math.abs((b.rangeMin + b.rangeMax) / 2 - b.precision),
    }));

    const isWellCalibrated = metrics.calibrationError < 0.1;
    const recommendation = isWellCalibrated
      ? "Confidence scores are well-calibrated. No adjustment needed."
      : metrics.calibrationError < 0.2
        ? "Confidence scores are slightly miscalibrated. Consider minor adjustments."
        : "Confidence scores are poorly calibrated. Recommend recalibration using Platt scaling.";

    // Failed cases
    const failedCases = metrics.results
      .filter((r) => !r.isCorrect)
      .map((r) => ({
        query: r.query,
        expected: r.expectedId,
        got: r.linkedId,
        confidence: r.originalConfidence,
        reason: r.reasoning,
      }));

    return {
      summary: {
        accuracy: metrics.accuracy,
        total: metrics.totalEvaluated,
        passed: metrics.correctLinks,
        failed: metrics.incorrectLinks,
        calibrationError: metrics.calibrationError,
      },
      categories,
      calibrationAnalysis: {
        isWellCalibrated,
        recommendation,
        bucketDetails,
      },
      failedCases,
    };
  },
});

/**
 * Calibrate confidence scores based on historical accuracy
 * Uses Platt scaling approach
 */
export const calibrateConfidence = internalAction({
  args: {
    originalConfidence: v.number(),
    method: v.optional(v.string()),
    calibrationData: v.optional(
      v.array(
        v.object({
          confidence: v.number(),
          wasCorrect: v.boolean(),
        })
      )
    ),
  },
  returns: v.object({
    originalConfidence: v.number(),
    calibratedConfidence: v.number(),
    adjustmentReason: v.string(),
  }),
  handler: async (ctx, args) => {
    // Simple calibration based on observed patterns
    // In production, this would use actual historical accuracy data
    const { originalConfidence } = args;

    // Default calibration adjustments based on typical miscalibration patterns
    // High confidence (0.9+) is often overconfident → reduce slightly
    // Medium confidence (0.5-0.7) is often underconfident → boost slightly
    let calibrated = originalConfidence;
    let reason = "No adjustment needed";

    if (originalConfidence >= 0.9) {
      calibrated = 0.85 + (originalConfidence - 0.9) * 0.5; // Cap at ~0.9
      reason = "High confidence reduced (typical overconfidence pattern)";
    } else if (originalConfidence >= 0.7 && originalConfidence < 0.9) {
      calibrated = originalConfidence; // Keep as-is, usually accurate
      reason = "Medium-high confidence maintained";
    } else if (originalConfidence >= 0.5 && originalConfidence < 0.7) {
      calibrated = originalConfidence + 0.05; // Slight boost
      reason = "Medium confidence slightly boosted";
    } else {
      calibrated = originalConfidence * 0.8; // Reduce low confidence further
      reason = "Low confidence reduced (likely incorrect)";
    }

    return {
      originalConfidence,
      calibratedConfidence: Math.min(Math.max(calibrated, 0), 1),
      adjustmentReason: reason,
    };
  },
});
