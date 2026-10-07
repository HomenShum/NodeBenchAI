/**
 * blipClaimExtraction.ts - NLP claim extraction from news items
 *
 * Extracts atomic, verifiable claims and spans from news content.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { ClaimType, EntityType } from "./types";

// ============================================================================
// Claim Extraction Actions
// ============================================================================

/**
 * Extract claims from a single news item
 */
export const extractClaimsFromNewsItem = internalAction({
  args: {
    newsItemId: v.id("newsItems"),
  },
  handler: async (ctx, args) => {
    // Get the news item
    const newsItem = await ctx.runQuery(
      internal.domains.blips.blipQueries.getNewsItemBySourceId,
      { sourceId: "" }  // We need to get by ID - let me fix this
    );

    // For now, get via the pending items query and filter
    const pendingItems = await ctx.runQuery(
      internal.domains.blips.blipQueries.getPendingNewsItems,
      { status: "ingested", limit: 100 }
    );

    const newsItem2 = pendingItems.find((i: any) => i._id === args.newsItemId);
    if (!newsItem2) {
      console.error("[ClaimExtraction] News item not found:", args.newsItemId);
      return { claims: [], error: "News item not found" };
    }

    // Update status to claim_extraction
    await ctx.runMutation(
      internal.domains.blips.blipMutations.updateNewsItemStatus,
      { newsItemId: args.newsItemId, status: "claim_extraction" }
    );

    // Extract claims using LLM
    const claims = await extractWithLLM(newsItem2.title, newsItem2.fullContent || newsItem2.summary || "");

    // Insert claims into database
    for (const claim of claims) {
      await ctx.runMutation(
        internal.domains.blips.blipMutations.insertClaimSpan,
        {
          newsItemId: args.newsItemId,
          claimText: claim.claimText,
          originalSpan: claim.originalSpan,
          spanStartIdx: claim.spanStartIdx,
          spanEndIdx: claim.spanEndIdx,
          claimType: claim.claimType,
          entities: claim.entities,
          extractionConfidence: claim.confidence,
        }
      );
    }

    return {
      newsItemId: args.newsItemId,
      claimsExtracted: claims.length,
    };
  },
});

/**
 * Process batch of pending news items
 */
export const extractClaimsBatch = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    // Get pending items
    const pendingItems = await ctx.runQuery(
      internal.domains.blips.blipQueries.getPendingNewsItems,
      { status: "ingested", limit }
    );

    const results: any[] = [];

    for (const item of pendingItems) {
      try {
        const result = await ctx.runAction(
          internal.domains.blips.blipClaimExtraction.extractClaimsFromNewsItem,
          { newsItemId: item._id }
        );
        results.push(result);
      } catch (error) {
        console.error(`[ClaimExtraction] Error processing ${item._id}:`, error);
        results.push({ newsItemId: item._id, error: String(error) });
      }
    }

    return {
      processed: results.length,
      successful: results.filter((r) => !r.error).length,
      totalClaims: results.reduce((sum, r) => sum + (r.claimsExtracted || 0), 0),
    };
  },
});

// ============================================================================
// LLM Extraction
// ============================================================================

interface ExtractedClaim {
  claimText: string;
  originalSpan: string;
  spanStartIdx: number;
  spanEndIdx: number;
  claimType: ClaimType;
  entities: Array<{
    name: string;
    type: EntityType;
  }>;
  confidence: number;
}

async function extractWithLLM(title: string, content: string): Promise<ExtractedClaim[]> {
  const claims: ExtractedClaim[] = [];

  try {
    const { generateText } = await import("ai");
    const { getLanguageModelSafe } = await import("../agents/mcp_tools/models/modelResolver");

    const model = await getLanguageModelSafe("qwen3-coder-free");
    if (!model) {
      // Fallback to regex extraction
      return extractWithRegex(title, content);
    }

    const text = `${title}\n\n${content}`.slice(0, 3000);

    const prompt = `Extract factual claims from this news article that could be verified. Return ONLY valid JSON.

Article:
${text}

Return this exact format:
{
  "claims": [
    {
      "claim": "The specific factual claim",
      "type": "factual|quantitative|attribution|temporal|causal|comparative|predictive|opinion",
      "entities": [
        {"name": "Entity Name", "type": "company|person|product|technology|organization|location"}
      ],
      "span": "Original text this claim comes from",
      "confidence": 0.8
    }
  ]
}

Rules:
- Only extract verifiable claims, not opinions
- "quantitative" = claims with numbers/statistics
- "attribution" = quotes or "X said Y"
- "temporal" = claims about dates/times
- "causal" = claims about cause and effect
- Max 5 claims per article
- Confidence should be 0.5-1.0 based on claim clarity`;

    const { text: response } = await generateText({
      model,
      prompt,
      maxOutputTokens: 1000,
      temperature: 0.1,
    });

    if (!response) return claims;

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return claims;

    const parsed = JSON.parse(jsonMatch[0]);

    for (const c of parsed.claims || []) {
      // Find span position in text
      const spanIdx = text.indexOf(c.span);

      claims.push({
        claimText: c.claim,
        originalSpan: c.span || c.claim,
        spanStartIdx: spanIdx >= 0 ? spanIdx : 0,
        spanEndIdx: spanIdx >= 0 ? spanIdx + (c.span?.length || c.claim.length) : c.claim.length,
        claimType: validateClaimType(c.type),
        entities: (c.entities || []).map((e: any) => ({
          name: e.name,
          type: validateEntityType(e.type),
        })),
        confidence: Math.min(1, Math.max(0.5, c.confidence || 0.7)),
      });
    }
  } catch (error) {
    console.error("[ClaimExtraction] LLM error:", error);
    return extractWithRegex(title, content);
  }

  return claims.slice(0, 5);
}

/**
 * Regex-based claim extraction (fallback)
 */
function extractWithRegex(title: string, content: string): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  const text = `${title}\n\n${content}`;

  // Pattern: Numbers with context
  const numberPattern = /([A-Z][^.]*\$?\d+(?:\.\d+)?(?:\s*(?:million|billion|M|B|K|%|percent))?[^.]*\.)/g;

  let match;
  while ((match = numberPattern.exec(text)) !== null && claims.length < 3) {
    const span = match[1].trim();
    if (span.length > 20 && span.length < 200) {
      claims.push({
        claimText: span,
        originalSpan: span,
        spanStartIdx: match.index,
        spanEndIdx: match.index + span.length,
        claimType: "quantitative",
        entities: extractEntitiesFromText(span),
        confidence: 0.6,
      });
    }
  }

  // Pattern: "X said" or "according to"
  const quotePattern = /([A-Z][^.]*(?:said|stated|announced|according to)[^.]*\.)/g;

  while ((match = quotePattern.exec(text)) !== null && claims.length < 5) {
    const span = match[1].trim();
    if (span.length > 20 && span.length < 200) {
      claims.push({
        claimText: span,
        originalSpan: span,
        spanStartIdx: match.index,
        spanEndIdx: match.index + span.length,
        claimType: "attribution",
        entities: extractEntitiesFromText(span),
        confidence: 0.5,
      });
    }
  }

  return claims;
}

function extractEntitiesFromText(text: string): Array<{ name: string; type: EntityType }> {
  const entities: Array<{ name: string; type: EntityType }> = [];

  // Simple capitalized word extraction
  const namePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g;
  let match;

  while ((match = namePattern.exec(text)) !== null && entities.length < 3) {
    const name = match[1];
    // Guess type based on common patterns
    let type: EntityType = "organization";

    if (name.match(/Inc|Corp|LLC|Labs|Tech|AI|Systems/)) {
      type = "company";
    } else if (name.split(" ").length === 2 && !name.match(/[A-Z][a-z]+[A-Z]/)) {
      type = "person";
    }

    entities.push({ name, type });
  }

  return entities;
}

function validateClaimType(type: string): ClaimType {
  const valid: ClaimType[] = [
    "factual",
    "quantitative",
    "attribution",
    "temporal",
    "causal",
    "comparative",
    "predictive",
    "opinion",
  ];
  return valid.includes(type as ClaimType) ? (type as ClaimType) : "factual";
}

function validateEntityType(type: string): EntityType {
  const valid: EntityType[] = [
    "company",
    "person",
    "product",
    "technology",
    "organization",
    "location",
  ];
  return valid.includes(type as EntityType) ? (type as EntityType) : "organization";
}
