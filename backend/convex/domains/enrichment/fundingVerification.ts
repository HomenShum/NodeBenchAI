/**
 * Funding Verification
 *
 * Cross-source verification of funding claims.
 * Searches for corroborating sources and updates confidence scores.
 */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";

interface VerificationResult {
  fundingEventId: Id<"fundingEvents">;
  verified: boolean;
  confidence: number;
  newSources: string[];
  corroboratingCount: number;
  contradictions: string[];
  verificationStatus: "unverified" | "single-source" | "multi-source" | "verified";
}

/**
 * Verify a funding claim by searching for corroborating sources.
 */
export const verifyFundingClaim = internalAction({
  args: {
    fundingEventId: v.id("fundingEvents"),
    maxNewSources: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<VerificationResult> => {
    const maxSources = args.maxNewSources ?? 3;

    // Get the funding event
    const fundingEvent = await ctx.runQuery(
      internal.domains.enrichment.fundingVerification.getFundingEventInternal,
      { fundingEventId: args.fundingEventId }
    );

    if (!fundingEvent) {
      throw new Error(`Funding event not found: ${args.fundingEventId}`);
    }

    console.log(`[fundingVerification] Verifying: ${fundingEvent.companyName} ${fundingEvent.roundType}`);

    // Build search query for corroborating sources
    const searchQuery = buildVerificationSearchQuery(
      fundingEvent.companyName,
      fundingEvent.roundType,
      fundingEvent.amountRaw
    );

    // Search for corroborating sources using Linkup
    let searchResults: { sources: Array<{ url: string; name: string; snippet?: string }> } | null = null;
    try {
      const searchResponse = await ctx.runAction(
        internal.domains.enrichment.fundingVerification.searchForCorroboration,
        { query: searchQuery, maxResults: 10 }
      );
      searchResults = searchResponse;
    } catch (error) {
      console.warn(`[fundingVerification] Search failed:`, error);
    }

    const newSources: string[] = [];
    const contradictions: string[] = [];
    let corroboratingCount = 0;

    if (searchResults?.sources) {
      // Filter out already-known sources
      const existingUrls = new Set(fundingEvent.sourceUrls.map((u: string) => u.toLowerCase()));

      for (const source of searchResults.sources) {
        if (newSources.length >= maxSources) break;
        if (existingUrls.has(source.url.toLowerCase())) continue;

        // Analyze source for corroboration or contradiction
        const analysis = analyzeSourceForCorroboration(
          source.snippet || "",
          fundingEvent.companyName,
          fundingEvent.amountRaw,
          fundingEvent.roundType
        );

        if (analysis.corroborates) {
          newSources.push(source.url);
          corroboratingCount++;
        } else if (analysis.contradicts) {
          contradictions.push(
            `${source.name}: ${analysis.contradictionReason || "Conflicting data"}`
          );
        }
      }
    }

    // Calculate new confidence
    let newConfidence = fundingEvent.confidence;

    // Boost for corroborating sources
    if (corroboratingCount >= 2) {
      newConfidence = Math.min(newConfidence + 0.2, 1);
    } else if (corroboratingCount === 1) {
      newConfidence = Math.min(newConfidence + 0.1, 1);
    }

    // Penalty for contradictions
    newConfidence -= contradictions.length * 0.15;
    newConfidence = Math.max(newConfidence, 0);

    // Determine verification status
    const totalSources = fundingEvent.sourceUrls.length + newSources.length;
    let verificationStatus: "unverified" | "single-source" | "multi-source" | "verified";

    if (totalSources >= 3 && newConfidence >= 0.8) {
      verificationStatus = "verified";
    } else if (totalSources >= 2) {
      verificationStatus = "multi-source";
    } else if (totalSources === 1) {
      verificationStatus = "single-source";
    } else {
      verificationStatus = "unverified";
    }

    // Update the funding event
    await ctx.runMutation(
      internal.domains.enrichment.fundingMutations.updateVerificationStatus,
      {
        fundingEventId: args.fundingEventId,
        verificationStatus,
        confidence: newConfidence,
        newSources: newSources.length > 0 ? newSources : undefined,
      }
    );

    // Log contradictions as potential facts
    if (contradictions.length > 0) {
      console.warn(
        `[fundingVerification] Contradictions found for ${fundingEvent.companyName}:`,
        contradictions
      );
    }

    console.log(`[fundingVerification] Verified ${fundingEvent.companyName}:`, {
      newSources: newSources.length,
      corroborating: corroboratingCount,
      contradictions: contradictions.length,
      confidence: newConfidence,
      status: verificationStatus,
    });

    return {
      fundingEventId: args.fundingEventId,
      verified: verificationStatus === "verified" || verificationStatus === "multi-source",
      confidence: newConfidence,
      newSources,
      corroboratingCount,
      contradictions,
      verificationStatus,
    };
  },
});

/**
 * Build a search query for finding corroborating sources.
 */
function buildVerificationSearchQuery(
  companyName: string,
  roundType: string,
  amountRaw: string
): string {
  const roundLabel = roundType.replace(/-/g, " ");
  return `"${companyName}" funding ${roundLabel} ${amountRaw}`;
}

/**
 * Analyze a source snippet for corroboration or contradiction.
 */
function analyzeSourceForCorroboration(
  snippet: string,
  companyName: string,
  amountRaw: string,
  roundType: string
): {
  corroborates: boolean;
  contradicts: boolean;
  contradictionReason?: string;
} {
  const lowerSnippet = snippet.toLowerCase();
  const lowerCompany = companyName.toLowerCase();

  // Check if company is mentioned
  if (!lowerSnippet.includes(lowerCompany)) {
    return { corroborates: false, contradicts: false };
  }

  // Check for funding keywords
  const hasFundingContext =
    lowerSnippet.includes("funding") ||
    lowerSnippet.includes("raises") ||
    lowerSnippet.includes("raised") ||
    lowerSnippet.includes("investment") ||
    lowerSnippet.includes("series");

  if (!hasFundingContext) {
    return { corroborates: false, contradicts: false };
  }

  // Check for amount match (with some tolerance)
  const amountMatch = extractAmountFromText(amountRaw);
  const snippetAmount = extractAmountFromText(snippet);

  if (amountMatch && snippetAmount) {
    // Allow 10% tolerance for rounding differences
    const tolerance = amountMatch * 0.1;
    if (Math.abs(amountMatch - snippetAmount) > tolerance) {
      return {
        corroborates: false,
        contradicts: true,
        contradictionReason: `Amount mismatch: expected ${amountRaw}, found $${snippetAmount}M`,
      };
    }
  }

  // Check for round type match
  const roundLabel = roundType.replace(/-/g, " ").toLowerCase();
  if (lowerSnippet.includes(roundLabel) || lowerSnippet.includes(roundType.toLowerCase())) {
    return { corroborates: true, contradicts: false };
  }

  // If company + funding context but no specific match, consider weak corroboration
  return { corroborates: true, contradicts: false };
}

/**
 * Extract numeric amount from text (in millions).
 */
function extractAmountFromText(text: string): number | null {
  const match = text.match(/\$?(\d+(?:\.\d+)?)\s*(million|billion|m|b|mn|bn)/i);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  if (unit.startsWith("b")) {
    return value * 1000; // Convert billions to millions
  }
  return value;
}

/**
 * Query helper for getting funding event.
 */
export const getFundingEventInternal = internalQuery({
  args: {
    fundingEventId: v.id("fundingEvents"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.fundingEventId);
  },
});

/**
 * Search for corroborating sources using Linkup.
 */
export const searchForCorroboration = internalAction({
  args: {
    query: v.string(),
    maxResults: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.LINKUP_API_KEY;
    if (!apiKey) {
      throw new Error("LINKUP_API_KEY not set");
    }

    try {
      const response = await fetch("https://api.linkup.so/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: args.query,
          depth: "standard",
          outputType: "searchResults",
          maxResults: args.maxResults ?? 10,
          fromDate: getDateDaysAgo(7), // Last 7 days
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("[searchForCorroboration] API error:", error);
        throw new Error(`Linkup API error: ${response.status}`);
      }

      const data = await response.json();

      return {
        sources: (data.results || [])
          .filter((r: any) => r.type === "text")
          .map((r: any) => ({
            url: r.url,
            name: r.name,
            snippet: r.content?.substring(0, 500),
          })),
      };
    } catch (error) {
      console.error("[searchForCorroboration] Error:", error);
      throw error;
    }
  },
});

function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split("T")[0];
}

/**
 * Batch verify multiple funding events.
 */
export const batchVerifyFundingEvents = internalAction({
  args: {
    lookbackHours: v.optional(v.number()),
    minConfidence: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackHours ?? 24) * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;

    // Get unverified funding events
    const events = await ctx.runQuery(
      internal.domains.enrichment.fundingVerification.getUnverifiedFundingEvents,
      {
        cutoff,
        minConfidence: args.minConfidence ?? 0.3,
        limit: args.limit ?? 10,
      }
    );

    const results: Array<{
      fundingEventId: string;
      companyName: string;
      verified: boolean;
      newConfidence: number;
      error?: string;
    }> = [];

    for (const event of events) {
      try {
        const result = await ctx.runAction(
          internal.domains.enrichment.fundingVerification.verifyFundingClaim,
          { fundingEventId: event._id }
        );

        results.push({
          fundingEventId: event._id,
          companyName: event.companyName,
          verified: result.verified,
          newConfidence: result.confidence,
        });
      } catch (error) {
        results.push({
          fundingEventId: event._id,
          companyName: event.companyName,
          verified: false,
          newConfidence: event.confidence,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const verified = results.filter((r) => r.verified).length;
    console.log(`[batchVerifyFundingEvents] Verified ${verified}/${events.length} events`);

    return {
      total: events.length,
      verified,
      failed: events.length - verified,
      results,
    };
  },
});

/**
 * Get funding events that need verification.
 */
export const getUnverifiedFundingEvents = internalQuery({
  args: {
    cutoff: v.number(),
    minConfidence: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt")
      .order("desc")
      .filter((q) =>
        q.and(
          q.gte(q.field("announcedAt"), args.cutoff),
          q.gte(q.field("confidence"), args.minConfidence),
          q.or(
            q.eq(q.field("verificationStatus"), "unverified"),
            q.eq(q.field("verificationStatus"), "single-source")
          )
        )
      )
      .take(args.limit);
  },
});
