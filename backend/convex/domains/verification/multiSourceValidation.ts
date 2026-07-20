/**
 * Multi-Source Validation Pipeline
 *
 * Validates funding data against multiple external sources:
 * - Crunchbase (primary)
 * - PitchBook (secondary)
 * - SEC Form D filings (for US companies)
 * - News aggregation (cross-reference multiple news sources)
 *
 * Provides confidence scoring based on source agreement.
 */

import { v } from "convex/values";
import { action, internalAction, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidationSource {
  name: string;
  status: "verified" | "partial" | "not-found" | "error";
  confidence: number; // 0.0 - 1.0
  data?: {
    companyName?: string;
    amount?: string;
    amountUsd?: number;
    roundType?: string;
    announcedDate?: string;
    investors?: string[];
  };
  url?: string;
  error?: string;
}

export interface MultiSourceValidationResult {
  overallStatus: "verified" | "partial" | "conflicting" | "unverified";
  overallConfidence: number; // 0.0 - 1.0
  sources: ValidationSource[];
  agreements: {
    companyName: boolean;
    amount: boolean;
    roundType: boolean;
  };
  warnings: string[];
  recommendations: string[];
  needsManualReview: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate funding event against multiple external sources.
 */
export const validateFundingEvent = internalAction({
  args: {
    fundingEventId: v.id("fundingEvents"),
    // Control which sources to check
    checkCrunchbase: v.optional(v.boolean()),
    checkSEC: v.optional(v.boolean()),
    checkNews: v.optional(v.boolean()),
    // Performance options
    maxConcurrent: v.optional(v.number()),
    timeout: v.optional(v.number()), // Max time per source check (ms)
  },
  returns: v.object({
    eventId: v.string(),
    companyName: v.string(),
    amount: v.string(),
    roundType: v.string(),
    validation: v.object({
      overallStatus: v.string(),
      overallConfidence: v.number(),
      sources: v.array(v.object({
        name: v.string(),
        status: v.string(),
        confidence: v.number(),
        url: v.optional(v.string()),
        error: v.optional(v.string()),
      })),
      agreements: v.object({
        companyName: v.boolean(),
        amount: v.boolean(),
        roundType: v.boolean(),
      }),
      warnings: v.array(v.string()),
      recommendations: v.array(v.string()),
      needsManualReview: v.boolean(),
    }),
  }),
  handler: async (ctx, args) => {
    const timeout = args.timeout ?? 30000; // 30s default

    // Get the funding event
    const event = await ctx.runQuery(internal.domains.verification.multiSourceValidation.getEventForValidation, {
      eventId: args.fundingEventId,
    });

    if (!event) {
      throw new Error(`Funding event not found: ${args.fundingEventId}`);
    }

    console.log(`[validation] Validating: ${event.companyName} - ${event.amountRaw} ${event.roundType}`);

    const sources: ValidationSource[] = [];

    // Source 1: Original source URL (already have this)
    sources.push({
      name: "Original Source",
      status: "verified",
      confidence: event.confidence ?? 0.5,
      data: {
        companyName: event.companyName,
        amount: event.amountRaw,
        amountUsd: event.amountUsd,
        roundType: event.roundType,
      },
      url: event.sourceUrls?.[0],
    });

    // Source 2: Crunchbase (if enabled and large round)
    if (args.checkCrunchbase !== false && event.amountUsd && event.amountUsd >= 10_000_000) {
      try {
        const cbResult = await validateWithCrunchbase(ctx, event, timeout);
        sources.push(cbResult);
      } catch (error: any) {
        console.warn(`[validation] Crunchbase check failed:`, error.message);
        sources.push({
          name: "Crunchbase",
          status: "error",
          confidence: 0,
          error: error.message,
        });
      }
    }

    // Source 3: SEC Form D (if US company and large round)
    if (args.checkSEC !== false && event.amountUsd && event.amountUsd >= 5_000_000) {
      try {
        const secResult = await validateWithSEC(ctx, event, timeout);
        sources.push(secResult);
      } catch (error: any) {
        console.warn(`[validation] SEC check failed:`, error.message);
        sources.push({
          name: "SEC Form D",
          status: "error",
          confidence: 0,
          error: error.message,
        });
      }
    }

    // Source 4: News cross-reference (if enabled)
    if (args.checkNews !== false) {
      try {
        const newsResult = await validateWithNews(ctx, event, timeout);
        sources.push(newsResult);
      } catch (error: any) {
        console.warn(`[validation] News validation failed:`, error.message);
        sources.push({
          name: "News Aggregation",
          status: "error",
          confidence: 0,
          error: error.message,
        });
      }
    }

    // Analyze cross-source agreement
    const validation = analyzeSourceAgreement(event, sources);

    console.log(`[validation] Result: ${validation.overallStatus} (confidence: ${validation.overallConfidence.toFixed(2)})`);
    console.log(`  - Sources checked: ${sources.length}`);
    console.log(`  - Agreements: Company=${validation.agreements.companyName}, Amount=${validation.agreements.amount}, Round=${validation.agreements.roundType}`);

    return {
      eventId: event._id,
      companyName: event.companyName,
      amount: event.amountRaw,
      roundType: event.roundType,
      validation: {
        overallStatus: validation.overallStatus,
        overallConfidence: validation.overallConfidence,
        sources: sources.map(s => ({
          name: s.name,
          status: s.status,
          confidence: s.confidence,
          url: s.url,
          error: s.error,
        })),
        agreements: validation.agreements,
        warnings: validation.warnings,
        recommendations: validation.recommendations,
        needsManualReview: validation.needsManualReview,
      },
    };
  },
});

/**
 * Get funding event data for validation.
 */
export const getEventForValidation = internalQuery({
  args: {
    eventId: v.id("fundingEvents"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.eventId);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INDIVIDUAL SOURCE VALIDATORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate against Crunchbase (simulated - would use actual API in production).
 */
async function validateWithCrunchbase(
  ctx: any,
  event: any,
  timeout: number
): Promise<ValidationSource> {
  console.log(`[crunchbase] Checking ${event.companyName}...`);

  // TODO: Implement actual Crunchbase API call
  // For now, return "not-found" to indicate we couldn't verify

  // Simulated API call
  try {
    // const cbData = await fetch(`https://api.crunchbase.com/v4/entities/organizations/${companySlug}`, {
    //   headers: { 'X-cb-user-key': process.env.CRUNCHBASE_API_KEY }
    // });

    // Placeholder: Assume not found for now
    return {
      name: "Crunchbase",
      status: "not-found",
      confidence: 0,
      url: `https://www.crunchbase.com/organization/${event.companyName.toLowerCase().replace(/\s+/g, "-")}`,
    };
  } catch (error: any) {
    return {
      name: "Crunchbase",
      status: "error",
      confidence: 0,
      error: error.message,
    };
  }
}

/**
 * Validate against SEC Form D filings.
 */
async function validateWithSEC(
  ctx: any,
  event: any,
  timeout: number
): Promise<ValidationSource> {
  console.log(`[sec] Checking Form D for ${event.companyName}...`);

  // TODO: Implement SEC EDGAR API search for Form D filings
  // Search for recent Form D filings with company name match

  // Placeholder: Return not-found
  return {
    name: "SEC Form D",
    status: "not-found",
    confidence: 0,
    url: `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(event.companyName)}&type=D&dateb=&owner=exclude&count=10`,
  };
}

/**
 * Validate against multiple news sources.
 */
async function validateWithNews(
  ctx: any,
  event: any,
  timeout: number
): Promise<ValidationSource> {
  console.log(`[news] Cross-referencing news for ${event.companyName}...`);

  // Search for news articles about this funding
  const query = `"${event.companyName}" "${event.amountRaw}" funding`;

  try {
    // Use fusion search to find multiple sources
    const { SearchOrchestrator } = await import("../../domains/search/fusion/orchestrator");
    const orchestrator = new SearchOrchestrator(ctx);

    const searchResults = await orchestrator.search({
      query,
      mode: "fast",
      sources: ["brave", "serper"],
      maxPerSource: 5,
      maxTotal: 10,
    });

    const relevantResults = searchResults.results.filter(r => {
      const text = `${r.title} ${r.snippet}`.toLowerCase();
      return (
        text.includes(event.companyName.toLowerCase()) &&
        (text.includes("funding") || text.includes("raise") || text.includes("series"))
      );
    });

    if (relevantResults.length >= 2) {
      // Found multiple sources confirming this
      return {
        name: "News Aggregation",
        status: "verified",
        confidence: Math.min(0.9, 0.5 + relevantResults.length * 0.1),
        data: {
          companyName: event.companyName,
        },
      };
    } else if (relevantResults.length === 1) {
      return {
        name: "News Aggregation",
        status: "partial",
        confidence: 0.6,
      };
    } else {
      return {
        name: "News Aggregation",
        status: "not-found",
        confidence: 0,
      };
    }
  } catch (error: any) {
    return {
      name: "News Aggregation",
      status: "error",
      confidence: 0,
      error: error.message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSIS & SCORING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Analyze agreement across sources and compute overall validation.
 */
function analyzeSourceAgreement(
  event: any,
  sources: ValidationSource[]
): MultiSourceValidationResult {
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Count verified sources
  const verifiedSources = sources.filter(s => s.status === "verified").length;
  const partialSources = sources.filter(s => s.status === "partial").length;
  const totalSources = sources.length;

  // Check company name agreement
  const companyNames = sources
    .filter(s => s.data?.companyName)
    .map(s => s.data!.companyName!.toLowerCase().trim());

  const companyNameAgreement = companyNames.length > 1 && new Set(companyNames).size === 1;

  if (companyNames.length > 1 && !companyNameAgreement) {
    warnings.push(`Company name conflict: ${[...new Set(companyNames)].join(" vs ")}`);
  }

  // Check amount agreement
  const amounts = sources
    .filter(s => s.data?.amountUsd)
    .map(s => s.data!.amountUsd!);

  const amountAgreement =
    amounts.length > 1 &&
    amounts.every(amt => Math.abs(amt - amounts[0]) < amounts[0] * 0.1); // Within 10%

  if (amounts.length > 1 && !amountAgreement) {
    warnings.push(`Amount conflict: ${amounts.map(a => `$${(a / 1_000_000).toFixed(1)}M`).join(" vs ")}`);
  }

  // Check round type agreement
  const roundTypes = sources
    .filter(s => s.data?.roundType)
    .map(s => s.data!.roundType!.toLowerCase());

  const roundTypeAgreement = roundTypes.length > 1 && new Set(roundTypes).size === 1;

  if (roundTypes.length > 1 && !roundTypeAgreement) {
    warnings.push(`Round type conflict: ${[...new Set(roundTypes)].join(" vs ")}`);
  }

  // Calculate overall confidence
  let overallConfidence = 0;

  if (verifiedSources >= 3) {
    overallConfidence = 0.95;
  } else if (verifiedSources === 2) {
    overallConfidence = 0.85;
  } else if (verifiedSources === 1 && partialSources >= 1) {
    overallConfidence = 0.75;
  } else if (verifiedSources === 1) {
    overallConfidence = 0.6;
  } else if (partialSources >= 2) {
    overallConfidence = 0.5;
  } else {
    overallConfidence = 0.3;
  }

  // Adjust for conflicts
  if (warnings.length > 0) {
    overallConfidence -= warnings.length * 0.1;
  }

  overallConfidence = Math.max(0, Math.min(1, overallConfidence));

  // Determine overall status
  let overallStatus: "verified" | "partial" | "conflicting" | "unverified";

  if (verifiedSources >= 2 && warnings.length === 0) {
    overallStatus = "verified";
  } else if (verifiedSources >= 1 || partialSources >= 2) {
    overallStatus = warnings.length > 0 ? "conflicting" : "partial";
  } else {
    overallStatus = "unverified";
  }

  // Generate recommendations
  if (overallStatus === "unverified") {
    recommendations.push("Seek additional verification sources");
    recommendations.push("Consider manual review of source article");
  }

  if (warnings.length > 0) {
    recommendations.push("Resolve conflicts through manual review");
    recommendations.push("Contact company or investors for clarification");
  }

  if (event.amountUsd && event.amountUsd >= 50_000_000 && verifiedSources < 2) {
    recommendations.push("CRITICAL: Large round ($50M+) needs multi-source verification");
  }

  const needsManualReview =
    overallStatus === "conflicting" ||
    (overallStatus === "unverified" && event.amountUsd && event.amountUsd >= 20_000_000) ||
    warnings.length >= 2;

  return {
    overallStatus,
    overallConfidence,
    sources,
    agreements: {
      companyName: companyNameAgreement,
      amount: amountAgreement,
      roundType: roundTypeAgreement,
    },
    warnings,
    recommendations,
    needsManualReview,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate multiple funding events in batch.
 */
export const batchValidateFundingEvents = internalAction({
  args: {
    eventIds: v.array(v.id("fundingEvents")),
    maxConcurrent: v.optional(v.number()),
  },
  returns: v.array(v.object({
    eventId: v.string(),
    companyName: v.string(),
    overallStatus: v.string(),
    overallConfidence: v.number(),
    needsManualReview: v.boolean(),
    warnings: v.array(v.string()),
  })),
  handler: async (ctx, args) => {
    const maxConcurrent = args.maxConcurrent ?? 3;
    const results: any[] = [];

    console.log(`[batchValidation] Validating ${args.eventIds.length} events with max concurrency ${maxConcurrent}`);

    // Process in batches
    for (let i = 0; i < args.eventIds.length; i += maxConcurrent) {
      const batch = args.eventIds.slice(i, i + maxConcurrent);

      const batchPromises = batch.map(async (eventId) => {
        const result = await ctx.runAction(
          internal.domains.verification.multiSourceValidation.validateFundingEvent,
          { fundingEventId: eventId }
        );

        return {
          eventId: result.eventId,
          companyName: result.companyName,
          overallStatus: result.validation.overallStatus,
          overallConfidence: result.validation.overallConfidence,
          needsManualReview: result.validation.needsManualReview,
          warnings: result.validation.warnings,
        };
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      console.log(`[batchValidation] Processed batch ${Math.floor(i / maxConcurrent) + 1}/${Math.ceil(args.eventIds.length / maxConcurrent)}`);

      // Rate limiting
      if (i + maxConcurrent < args.eventIds.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    const needsReview = results.filter(r => r.needsManualReview).length;
    console.log(`[batchValidation] Complete: ${needsReview}/${results.length} need manual review`);

    return results;
  },
});
