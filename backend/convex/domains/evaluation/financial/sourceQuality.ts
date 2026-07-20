/**
 * Source Quality Scoring
 *
 * Classifies sources into reliability tiers using machine-checkable rules:
 * - Tier 1: Authoritative (SEC filings, official government data)
 * - Tier 2: Reliable (earnings calls, IR presentations)
 * - Tier 3: Secondary (sell-side research, industry reports)
 * - Tier 4: News (news articles, press releases)
 * - Tier 5: Unverified (LLM inference, social media)
 *
 * Scoring factors:
 * - Domain reputation (URL pattern matching)
 * - Freshness (date recency)
 * - Metadata completeness (required fields present)
 * - Citation coverage (source attribution quality)
 */

import { internalQuery, internalMutation, query, action } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";

// Tier definitions
export type SourceTier =
  | "tier1_authoritative"
  | "tier2_reliable"
  | "tier3_secondary"
  | "tier4_news"
  | "tier5_unverified";

export interface SourceQualityResult {
  tier: SourceTier;
  score: number; // 0-100
  matchedRules: string[];
  confidence: number; // 0-1
  scoreBreakdown: {
    domainScore: number;
    freshnessScore: number;
    metadataScore: number;
    citationScore: number;
  };
}

/**
 * Seed default source quality rules
 */
export const seedSourceQualityRules = internalMutation({
  args: {},
  returns: v.object({ rulesCreated: v.number() }),
  handler: async (ctx, args) => {
    // Check if rules already exist
    const existing = await ctx.db.query("sourceQualityRules").collect();
    if (existing.length > 0) {
      return { rulesCreated: 0 };
    }

    const rules = [
      // Tier 1: Authoritative
      {
        ruleId: "sec-edgar-filings",
        ruleName: "SEC EDGAR Filings",
        tier: "tier1_authoritative" as const,
        urlPatterns: [
          "https?://www\\.sec\\.gov/.*",
          "https?://www\\.sec\\.gov/cgi-bin/.*",
          "https?://www\\.sec\\.gov/Archives/edgar/.*",
        ],
        domainAllowlist: ["sec.gov"],
        requiredMetadata: ["filingDate", "accessionNumber"],
        maxAgeDays: undefined, // No freshness requirement
        reliabilityScore: 100,
        citationWeight: 1.0,
        examples: [
          "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810",
          "https://www.sec.gov/Archives/edgar/data/1045810/000104581024000057/nvda-20240128.htm",
        ],
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        ruleId: "uspto-patents",
        ruleName: "USPTO Patents",
        tier: "tier1_authoritative" as const,
        urlPatterns: [
          "https?://patft\\.uspto\\.gov/.*",
          "https?://appft\\.uspto\\.gov/.*",
          "https?://patents\\.google\\.com/.*",
        ],
        domainAllowlist: ["uspto.gov", "patents.google.com"],
        requiredMetadata: ["patentNumber"],
        maxAgeDays: undefined,
        reliabilityScore: 100,
        citationWeight: 1.0,
        examples: ["https://patft.uspto.gov/netacgi/nph-Parser?Sect1=PTO1"],
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },

      // Tier 2: Reliable
      {
        ruleId: "earnings-calls",
        ruleName: "Earnings Call Transcripts",
        tier: "tier2_reliable" as const,
        urlPatterns: [
          "https?://seekingalpha\\.com/article/.*-earnings-call-transcript.*",
          "https?://.*investor\\..*\\.com/.*earnings.*",
        ],
        domainAllowlist: ["seekingalpha.com"],
        requiredMetadata: ["date"],
        maxAgeDays: 365, // Must be within 1 year
        reliabilityScore: 90,
        citationWeight: 0.9,
        examples: ["https://seekingalpha.com/article/4667890-nvidia-earnings-call-transcript"],
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        ruleId: "investor-relations",
        ruleName: "Investor Relations Sites",
        tier: "tier2_reliable" as const,
        urlPatterns: [
          "https?://investor\\..*\\.com/.*",
          "https?://ir\\..*\\.com/.*",
        ],
        domainAllowlist: [],
        requiredMetadata: ["date"],
        maxAgeDays: 180,
        reliabilityScore: 85,
        citationWeight: 0.85,
        examples: ["https://investor.nvidia.com/"],
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },

      // Tier 3: Secondary
      {
        ruleId: "sell-side-research",
        ruleName: "Sell-Side Research",
        tier: "tier3_secondary" as const,
        urlPatterns: [
          "https?://.*\\.bloomberg\\.com/.*",
          "https?://.*\\.reuters\\.com/.*",
          "https?://.*\\.wsj\\.com/.*",
        ],
        domainAllowlist: ["bloomberg.com", "reuters.com", "wsj.com"],
        requiredMetadata: ["date", "author"],
        maxAgeDays: 90,
        reliabilityScore: 70,
        citationWeight: 0.7,
        examples: [],
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },

      // Tier 4: News
      {
        ruleId: "news-articles",
        ruleName: "News Articles",
        tier: "tier4_news" as const,
        urlPatterns: [
          "https?://.*\\.cnbc\\.com/.*",
          "https?://.*\\.techcrunch\\.com/.*",
          "https?://.*\\.theverge\\.com/.*",
        ],
        domainAllowlist: ["cnbc.com", "techcrunch.com", "theverge.com"],
        requiredMetadata: ["date"],
        maxAgeDays: 30,
        reliabilityScore: 50,
        citationWeight: 0.5,
        examples: [],
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        ruleId: "press-releases",
        ruleName: "Press Releases",
        tier: "tier4_news" as const,
        urlPatterns: [
          "https?://.*\\.prnewswire\\.com/.*",
          "https?://.*\\.businesswire\\.com/.*",
        ],
        domainAllowlist: ["prnewswire.com", "businesswire.com"],
        requiredMetadata: ["date"],
        maxAgeDays: 30,
        reliabilityScore: 55,
        citationWeight: 0.55,
        examples: [],
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },

      // Tier 5: Unverified
      {
        ruleId: "llm-inference",
        ruleName: "LLM Inference (Unverified)",
        tier: "tier5_unverified" as const,
        urlPatterns: [],
        domainAllowlist: [],
        requiredMetadata: [],
        maxAgeDays: undefined,
        reliabilityScore: 20,
        citationWeight: 0.2,
        examples: ["No direct source, LLM inference"],
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    let createdCount = 0;
    for (const rule of rules) {
      await ctx.db.insert("sourceQualityRules", rule);
      createdCount++;
    }

    return { rulesCreated: createdCount };
  },
});

/**
 * Get all active source quality rules
 */
export const getSourceQualityRules = internalQuery({
  args: { tier: v.optional(v.string()) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    let rules = ctx.db.query("sourceQualityRules")
      .filter(q => q.eq(q.field("isActive"), true));

    if (args.tier) {
      rules = rules.filter(q => q.eq(q.field("tier"), args.tier));
    }

    return await rules.collect();
  },
});

/**
 * Classify a source URL into a tier
 */
export const classifySource = action({
  args: {
    url: v.string(),
    sourceDate: v.optional(v.string()), // ISO date
    metadata: v.optional(v.any()),
  },
  returns: v.object({
    tier: v.string(),
    score: v.number(),
    matchedRules: v.array(v.string()),
    confidence: v.number(),
    scoreBreakdown: v.object({
      domainScore: v.number(),
      freshnessScore: v.number(),
      metadataScore: v.number(),
      citationScore: v.number(),
    }),
  }),
  handler: async (ctx, args): Promise<SourceQualityResult> => {
    // Get all active rules
    const rules = await ctx.runQuery(internal.domains.evaluation.financial.sourceQuality.getSourceQualityRules, {});

    // Try to match URL against rules
    let matchedRule: any = null;
    let matchedRuleNames: string[] = [];

    for (const rule of rules) {
      // Check URL patterns
      for (const pattern of rule.urlPatterns) {
        const regex = new RegExp(pattern);
        if (regex.test(args.url)) {
          matchedRule = rule;
          matchedRuleNames.push(rule.ruleName);
          break;
        }
      }

      if (matchedRule) break;

      // Check domain allowlist
      if (rule.domainAllowlist && rule.domainAllowlist.length > 0) {
        const urlDomain = extractDomain(args.url);
        if (rule.domainAllowlist.some(domain => urlDomain.includes(domain))) {
          matchedRule = rule;
          matchedRuleNames.push(rule.ruleName);
          break;
        }
      }
    }

    // Default to tier5 if no match
    if (!matchedRule) {
      matchedRule = rules.find((r: any) => r.tier === "tier5_unverified");
      matchedRuleNames = ["No direct match - unverified"];
    }

    // Calculate domain score
    const domainScore = matchedRule!.reliabilityScore;

    // Calculate freshness score
    let freshnessScore = 100;
    if (matchedRule!.maxAgeDays && args.sourceDate) {
      const sourceTimestamp = new Date(args.sourceDate).getTime();
      const ageInDays = (Date.now() - sourceTimestamp) / (1000 * 60 * 60 * 24);
      if (ageInDays > matchedRule!.maxAgeDays) {
        freshnessScore = Math.max(0, 100 - (ageInDays - matchedRule!.maxAgeDays) * 2);
      }
    }

    // Calculate metadata score
    let metadataScore = 100;
    if (matchedRule!.requiredMetadata && matchedRule!.requiredMetadata.length > 0) {
      const providedFields = Object.keys(args.metadata || {});
      const requiredFields = matchedRule!.requiredMetadata;
      const matchedFields = requiredFields.filter(field => providedFields.includes(field));
      metadataScore = (matchedFields.length / requiredFields.length) * 100;
    }

    // Citation score (defaults to rule weight)
    const citationScore = matchedRule!.citationWeight * 100;

    // Overall score (weighted average)
    const score = (
      domainScore * 0.5 +
      freshnessScore * 0.2 +
      metadataScore * 0.2 +
      citationScore * 0.1
    );

    // Confidence based on how many checks passed
    const checks = [
      domainScore >= 70,
      freshnessScore >= 70,
      metadataScore >= 70,
    ];
    const confidence = checks.filter(Boolean).length / checks.length;

    const result: SourceQualityResult = {
      tier: matchedRule!.tier as SourceTier,
      score: Math.round(score),
      matchedRules: matchedRuleNames,
      confidence,
      scoreBreakdown: {
        domainScore: Math.round(domainScore),
        freshnessScore: Math.round(freshnessScore),
        metadataScore: Math.round(metadataScore),
        citationScore: Math.round(citationScore),
      },
    };

    return result;
  },
});

/**
 * Log source quality classification for calibration
 */
export const logSourceQuality = internalMutation({
  args: {
    url: v.string(),
    domain: v.string(),
    sourceDate: v.optional(v.string()),
    metadata: v.optional(v.any()),
    tier: v.string(),
    score: v.number(),
    matchedRules: v.array(v.string()),
    confidence: v.number(),
    scoreBreakdown: v.object({
      domainScore: v.number(),
      freshnessScore: v.number(),
      metadataScore: v.number(),
      citationScore: v.number(),
    }),
    entityKey: v.optional(v.string()),
    evaluationId: v.optional(v.string()),
  },
  returns: v.id("sourceQualityLog"),
  handler: async (ctx, args) => {
    const logId = await ctx.db.insert("sourceQualityLog", {
      url: args.url,
      domain: args.domain,
      sourceDate: args.sourceDate,
      metadata: args.metadata,
      tier: args.tier,
      score: args.score,
      matchedRules: args.matchedRules,
      confidence: args.confidence,
      scoreBreakdown: args.scoreBreakdown,
      entityKey: args.entityKey,
      evaluationId: args.evaluationId,
      classifiedAt: Date.now(),
    });

    return logId;
  },
});

/**
 * Score source quality for a DCF model
 */
export const scoreDCFSourceQuality = action({
  args: {
    dcfModelId: v.id("dcfModels"),
    entityKey: v.string(),
    evaluationId: v.optional(v.string()),
  },
  returns: v.object({
    overallScore: v.number(),
    tierDistribution: v.any(),
    sourceCount: v.number(),
    tier1Percent: v.number(),
    tier2Percent: v.number(),
    averageSourceScore: v.number(),
  }),
  handler: async (ctx, args) => {
    // Get DCF model
    const model = await ctx.runQuery(internal.domains.evaluation.financial.dcfComparison.getDCFModel, {
      modelId: args.dcfModelId,
    });

    if (!model) {
      throw new Error(`DCF model ${args.dcfModelId} not found`);
    }

    // Get all source artifacts referenced by the model
    const sourceArtifactIds = model.citationArtifactIds || [];

    if (sourceArtifactIds.length === 0) {
      // No sources cited - lowest score
      return {
        overallScore: 20,
        tierDistribution: { tier5_unverified: 1 },
        sourceCount: 0,
        tier1Percent: 0,
        tier2Percent: 0,
        averageSourceScore: 20,
      };
    }

    // Classify each source
    const classifications: SourceQualityResult[] = [];
    for (const artifactId of sourceArtifactIds) {
      // Get artifact
      const artifact = await ctx.runQuery(internal.domains.artifacts.sourceArtifacts.getArtifactById, {
        artifactId,
      });

      if (!artifact) continue;

      // Classify source
      const classification = await ctx.runAction(
        internal.domains.evaluation.financial.sourceQuality.classifySource,
        {
          url: artifact.sourceUrl || "",
          sourceDate: artifact.fetchedAt ? new Date(artifact.fetchedAt).toISOString() : undefined,
          metadata: artifact.extractedData,
        }
      );

      classifications.push(classification);

      // Log classification
      await ctx.runMutation(internal.domains.evaluation.financial.sourceQuality.logSourceQuality, {
        url: artifact.sourceUrl || "",
        domain: extractDomain(artifact.sourceUrl || ""),
        sourceDate: artifact.fetchedAt ? new Date(artifact.fetchedAt).toISOString() : undefined,
        metadata: artifact.extractedData,
        tier: classification.tier,
        score: classification.score,
        matchedRules: classification.matchedRules,
        confidence: classification.confidence,
        scoreBreakdown: classification.scoreBreakdown,
        entityKey: args.entityKey,
        evaluationId: args.evaluationId,
      });
    }

    // Calculate tier distribution
    const tierCounts: Record<string, number> = {};
    let totalScore = 0;
    for (const classification of classifications) {
      tierCounts[classification.tier] = (tierCounts[classification.tier] || 0) + 1;
      totalScore += classification.score;
    }

    const sourceCount = classifications.length;
    const tier1Count = tierCounts["tier1_authoritative"] || 0;
    const tier2Count = tierCounts["tier2_reliable"] || 0;

    const tier1Percent = (tier1Count / sourceCount) * 100;
    const tier2Percent = (tier2Count / sourceCount) * 100;
    const averageSourceScore = totalScore / sourceCount;

    // Overall score (weighted by tier quality)
    const tier1Weight = tier1Count * 100;
    const tier2Weight = tier2Count * 90;
    const tier3Weight = (tierCounts["tier3_secondary"] || 0) * 70;
    const tier4Weight = (tierCounts["tier4_news"] || 0) * 50;
    const tier5Weight = (tierCounts["tier5_unverified"] || 0) * 20;

    const overallScore = (tier1Weight + tier2Weight + tier3Weight + tier4Weight + tier5Weight) / sourceCount;

    return {
      overallScore: Math.round(overallScore),
      tierDistribution: tierCounts,
      sourceCount,
      tier1Percent: Math.round(tier1Percent),
      tier2Percent: Math.round(tier2Percent),
      averageSourceScore: Math.round(averageSourceScore),
    };
  },
});

/**
 * Helper: Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (e) {
    return "";
  }
}
