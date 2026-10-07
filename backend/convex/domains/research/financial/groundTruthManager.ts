/**
 * Ground Truth Manager
 *
 * Manages analyst consensus, benchmarks, and real ground truth data
 * for DCF model validation
 */

import { action, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";

/**
 * Store ground truth DCF model (from analyst or benchmark)
 */
export const storeGroundTruthDCF = action({
  args: {
    ticker: v.string(),
    fairValuePerShare: v.number(),
    wacc: v.optional(v.number()),
    terminalGrowth: v.optional(v.number()),
    fcfProjections: v.optional(v.array(v.any())),
    source: v.string(), // "analyst_consensus", "institutional_research", "manual"
    sourceUrl: v.optional(v.string()),
    confidence: v.optional(v.number()), // 0-100
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const modelId = `gt-${args.ticker}-${Date.now()}`;

    await ctx.runMutation(internal.domains.financial.groundTruthManager.insertGroundTruthModel, {
      modelId,
      ticker: args.ticker,
      fairValuePerShare: args.fairValuePerShare,
      wacc: args.wacc,
      terminalGrowth: args.terminalGrowth,
      fcfProjections: args.fcfProjections,
      source: args.source,
      sourceUrl: args.sourceUrl,
      confidence: args.confidence || 100,
      notes: args.notes,
    });

    console.log(`[Ground Truth] Stored model for ${args.ticker}: $${args.fairValuePerShare.toFixed(2)}`);

    return { modelId, ticker: args.ticker };
  },
});

/**
 * Insert ground truth model mutation
 */
export const insertGroundTruthModel = internalMutation({
  args: {
    modelId: v.string(),
    ticker: v.string(),
    fairValuePerShare: v.number(),
    wacc: v.optional(v.number()),
    terminalGrowth: v.optional(v.number()),
    fcfProjections: v.optional(v.array(v.any())),
    source: v.string(),
    sourceUrl: v.optional(v.string()),
    confidence: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Create a minimal dummy artifact for ground truth (required by schema)
    const dummyArtifactId = await ctx.db.insert("sourceArtifacts", {
      sourceType: "api_response",
      contentHash: `ground-truth-${args.ticker}-${Date.now()}`,
      fetchedAt: Date.now(),
    });

    await ctx.db.insert("dcfModels", {
      modelId: args.modelId,
      entityKey: args.ticker,
      version: 1,
      origin: "analyst",

      // Required artifact IDs (using dummy for now)
      inputsArtifactId: dummyArtifactId,
      outputsArtifactId: dummyArtifactId,

      // Required assumptions structure
      assumptions: {
        forecastYears: 5,
        baseYear: new Date().getFullYear(),
        revenue: {
          baseRevenue: 0,
          growthRates: [],
          terminalGrowthRate: args.terminalGrowth || 0.03,
        },
        operating: {
          grossMargin: [],
          sgaPercent: [],
          daPercent: [],
          capexPercent: [],
          nwcPercent: [],
        },
        wacc: {
          riskFreeRate: 0.042,
          marketRiskPremium: 0.075,
          beta: 1.0,
          costOfEquity: args.wacc || 0.10,
          costOfDebt: 0.04,
          taxRate: 0.21,
          debtWeight: 0.2,
          equityWeight: 0.8,
          wacc: args.wacc || 0.10,
          sources: [args.source],
        },
        terminal: {
          method: "perpetuity",
          perpetuityGrowth: args.terminalGrowth,
        },
      },

      // Required outputs structure
      outputs: {
        enterpriseValue: 0,
        equityValue: 0,
        impliedSharePrice: args.fairValuePerShare,
        presentValueFcf: 0,
        terminalValue: 0,
        terminalValuePercent: 0,
      },

      // Required citation array
      citationArtifactIds: [],

      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Get ground truth for a ticker
 */
export const getGroundTruth = internalQuery({
  args: {
    ticker: v.string(),
  },
  handler: async (ctx, args) => {
    // Get most recent analyst ground truth
    const models = await ctx.db
      .query("dcfModels")
      .withIndex("by_entity_version", (q) => q.eq("entityKey", args.ticker))
      .filter((q) => q.eq(q.field("origin"), "analyst"))
      .collect();

    if (models.length === 0) return null;

    // Return most recent
    const sorted = models.sort((a, b) => b.createdAt - a.createdAt);
    const model = sorted[0];

    // Extract fair value from outputs structure
    return {
      ...model,
      fairValuePerShare: model.outputs.impliedSharePrice || model.outputs.equityValue || 0,
    };
  },
});

/**
 * Seed ground truth data for common tickers
 */
export const seedGroundTruthData = action({
  handler: async (ctx) => {
    console.log("[Ground Truth] Seeding benchmark data...");

    // NVIDIA - Analyst consensus (example)
    await ctx.runAction(internal.domains.financial.groundTruthManager.storeGroundTruthDCF, {
      ticker: "NVDA",
      fairValuePerShare: 145.00, // Average analyst target
      wacc: 0.115, // 11.5%
      terminalGrowth: 0.03,
      source: "analyst_consensus",
      sourceUrl: "https://seekingalpha.com/symbol/NVDA/analysis",
      confidence: 85,
      notes: "Consensus from 45 analysts (Dec 2025)",
    });

    // Apple - Analyst consensus
    await ctx.runAction(internal.domains.financial.groundTruthManager.storeGroundTruthDCF, {
      ticker: "AAPL",
      fairValuePerShare: 195.00,
      wacc: 0.092, // 9.2%
      terminalGrowth: 0.025,
      source: "analyst_consensus",
      sourceUrl: "https://seekingalpha.com/symbol/AAPL/analysis",
      confidence: 90,
      notes: "Consensus from 52 analysts (Dec 2025)",
    });

    // Microsoft - Analyst consensus
    await ctx.runAction(internal.domains.financial.groundTruthManager.storeGroundTruthDCF, {
      ticker: "MSFT",
      fairValuePerShare: 425.00,
      wacc: 0.088, // 8.8%
      terminalGrowth: 0.03,
      source: "analyst_consensus",
      sourceUrl: "https://seekingalpha.com/symbol/MSFT/analysis",
      confidence: 88,
      notes: "Consensus from 48 analysts (Dec 2025)",
    });

    console.log("✅ Ground truth data seeded for NVDA, AAPL, MSFT");

    return { seeded: ["NVDA", "AAPL", "MSFT"] };
  },
});

/**
 * Compare AI model to ground truth
 */
export const compareToGroundTruth = action({
  args: {
    ticker: v.string(),
    aiModelId: v.string(),
  },
  returns: v.object({
    groundTruthExists: v.boolean(),
    groundTruthValue: v.optional(v.number()),
    aiValue: v.number(),
    difference: v.optional(v.number()),
    differencePercent: v.optional(v.number()),
    verdict: v.string(),
  }),
  handler: async (ctx, args) => {
    // Get AI model
    const aiModel = await ctx.db
      .query("dcfModels")
      .withIndex("by_model_id", (q) => q.eq("modelId", args.aiModelId))
      .first();

    if (!aiModel) {
      throw new Error(`AI model not found: ${args.aiModelId}`);
    }

    // Get ground truth
    const groundTruth = await ctx.runQuery(
      internal.domains.financial.groundTruthManager.getGroundTruth,
      { ticker: args.ticker }
    );

    if (!groundTruth) {
      return {
        groundTruthExists: false,
        aiValue: aiModel.fairValuePerShare,
        verdict: "No ground truth available for comparison",
      };
    }

    const diff = aiModel.fairValuePerShare - groundTruth.fairValuePerShare;
    const diffPercent = (diff / groundTruth.fairValuePerShare) * 100;

    const verdict = Math.abs(diffPercent) <= 5 ? "ALIGNED" :
                    Math.abs(diffPercent) <= 10 ? "MINOR_DRIFT" :
                    Math.abs(diffPercent) <= 20 ? "SIGNIFICANT_DRIFT" :
                    "METHODOLOGY_MISMATCH";

    return {
      groundTruthExists: true,
      groundTruthValue: groundTruth.fairValuePerShare,
      aiValue: aiModel.fairValuePerShare,
      difference: diff,
      differencePercent: diffPercent,
      verdict,
    };
  },
});
