/**
 * blipGeneration.ts - Generate 5/10/20 word meaning blips
 *
 * Creates universal blips with strict word constraints.
 * No persona baked in - persona lens applied at render time.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { KeyFact, BlipSource, SourceReliability } from "./types";

// ============================================================================
// Blip Generation Actions
// ============================================================================

/**
 * Generate blip for a single news item
 */
export const generateBlipForNewsItem = internalAction({
  args: {
    newsItemId: v.id("newsItems"),
  },
  handler: async (ctx, args) => {
    // Get the news item
    const pendingItems = await ctx.runQuery(
      internal.domains.blips.blipQueries.getPendingNewsItems,
      { status: "claim_extraction", limit: 100 }
    );

    const newsItem = pendingItems.find((i: any) => i._id === args.newsItemId);
    if (!newsItem) {
      // Try ingested status as well
      const ingestedItems = await ctx.runQuery(
        internal.domains.blips.blipQueries.getPendingNewsItems,
        { status: "ingested", limit: 100 }
      );
      const newsItem2 = ingestedItems.find((i: any) => i._id === args.newsItemId);
      if (!newsItem2) {
        console.error("[BlipGeneration] News item not found:", args.newsItemId);
        return { error: "News item not found" };
      }
    }

    const item = newsItem || pendingItems[0];

    // Get claims for this news item
    const claims = await ctx.runQuery(
      internal.domains.blips.blipQueries.getClaimsForNewsItem,
      { newsItemId: args.newsItemId }
    );

    // Generate blip using LLM
    const blipContent = await generateBlipWithLLM(
      item.title,
      item.fullContent || item.summary || "",
      claims
    );

    // Build key facts from claims
    const keyFacts: KeyFact[] = claims.slice(0, 3).map((claim: any) => ({
      fact: claim.claimText,
      source: item.source,
      confidence: claim.extractionConfidence,
    }));

    // Build sources
    const sources: BlipSource[] = [
      {
        name: inferSourceName(item.source),
        url: item.sourceUrl,
        publishedAt: item.publishedAt,
        reliability: inferReliability(item.source),
      },
    ];

    // Calculate scores
    const now = Date.now();
    const ageHours = (now - item.publishedAt) / (1000 * 60 * 60);
    const freshnessScore = Math.max(0, 100 - ageHours * 2);

    // Insert blip
    const blipId = await ctx.runMutation(
      internal.domains.blips.blipMutations.insertMeaningBlip,
      {
        newsItemId: args.newsItemId,
        headline: blipContent.headline,
        summary: blipContent.summary,
        context: blipContent.context,
        keyFacts,
        primaryEntity: blipContent.primaryEntity,
        verificationSummary: {
          totalClaims: claims.length,
          verifiedClaims: 0,
          contradictedClaims: 0,
          overallConfidence: 0.5,
        },
        sources,
        relevanceScore: item.engagementScore,
        engagementScore: item.engagementScore,
        freshnessScore: Math.round(freshnessScore),
        category: item.category,
        tags: item.tags,
        publishedAt: item.publishedAt,
      }
    );

    // Update news item status
    await ctx.runMutation(
      internal.domains.blips.blipMutations.updateNewsItemStatus,
      { newsItemId: args.newsItemId, status: "blips_generated" }
    );

    return {
      blipId,
      headline: blipContent.headline,
      summary: blipContent.summary,
      context: blipContent.context,
    };
  },
});

/**
 * Generate blips for batch of news items
 */
export const generateBlipsBatch = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    // Get items that have claims extracted
    const pendingItems = await ctx.runQuery(
      internal.domains.blips.blipQueries.getPendingNewsItems,
      { status: "claim_extraction", limit }
    );

    // Also get items that went straight to ingested (no claims)
    const ingestedItems = await ctx.runQuery(
      internal.domains.blips.blipQueries.getPendingNewsItems,
      { status: "ingested", limit: limit - pendingItems.length }
    );

    const allItems = [...pendingItems, ...ingestedItems].slice(0, limit);
    const results: any[] = [];

    for (const item of allItems) {
      try {
        const result = await ctx.runAction(
          internal.domains.blips.blipGeneration.generateBlipForNewsItem,
          { newsItemId: item._id }
        );
        results.push(result);
      } catch (error) {
        console.error(`[BlipGeneration] Error for ${item._id}:`, error);
        results.push({ newsItemId: item._id, error: String(error) });
      }
    }

    return {
      processed: results.length,
      successful: results.filter((r) => !r.error).length,
    };
  },
});

// ============================================================================
// LLM Generation
// ============================================================================

interface BlipContent {
  headline: string;  // 5 words
  summary: string;   // 10 words
  context: string;   // 20 words
  primaryEntity?: {
    name: string;
    type: string;
  };
}

async function generateBlipWithLLM(
  title: string,
  content: string,
  claims: any[]
): Promise<BlipContent> {
  try {
    const { generateText } = await import("ai");
    const { getLanguageModelSafe } = await import("../agents/mcp_tools/models/modelResolver");

    const model = await getLanguageModelSafe("qwen3-coder-free");
    if (!model) {
      return generateBlipWithRules(title, content);
    }

    const claimSummary = claims.slice(0, 3).map((c: any) => c.claimText).join("; ");

    const prompt = `Generate concise summaries of this news at exactly 5, 10, and 20 words. Return ONLY valid JSON.

Title: ${title}
Content: ${content.slice(0, 1500)}
Key claims: ${claimSummary || "None extracted"}

Return this exact format:
{
  "headline": "Exactly 5 words capturing the core message",
  "summary": "Exactly 10 words providing slightly more context",
  "context": "Exactly 20 words giving enough detail to understand significance",
  "primaryEntity": {
    "name": "Main company/person/product mentioned",
    "type": "company|person|product|technology"
  }
}

Rules:
- EXACTLY the word counts specified
- No fluff, no hedging
- Focus on "what happened" not "what might happen"
- Include specific names/numbers when relevant
- primaryEntity is optional if none is clear`;

    const { text: response } = await generateText({
      model,
      prompt,
      maxOutputTokens: 400,
      temperature: 0.2,
    });

    if (!response) return generateBlipWithRules(title, content);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return generateBlipWithRules(title, content);

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and fix word counts
    return {
      headline: enforceWordCount(parsed.headline || title, 5),
      summary: enforceWordCount(parsed.summary || title, 10),
      context: enforceWordCount(parsed.context || title, 20),
      primaryEntity: parsed.primaryEntity,
    };
  } catch (error) {
    console.error("[BlipGeneration] LLM error:", error);
    return generateBlipWithRules(title, content);
  }
}

/**
 * Rule-based blip generation (fallback)
 */
function generateBlipWithRules(title: string, content: string): BlipContent {
  const words = title.split(/\s+/);

  // 5-word headline: first 5 words
  const headline = words.slice(0, 5).join(" ");

  // 10-word summary: try to include more context
  const contentWords = (content || title).split(/\s+/);
  const summary = [...words.slice(0, 5), ...contentWords.slice(0, 5)].slice(0, 10).join(" ");

  // 20-word context: combine title and content
  const context = [...words, ...contentWords.slice(0, 15)].slice(0, 20).join(" ");

  // Try to extract primary entity
  const entityMatch = title.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);

  return {
    headline: enforceWordCount(headline, 5),
    summary: enforceWordCount(summary, 10),
    context: enforceWordCount(context, 20),
    primaryEntity: entityMatch
      ? {
          name: entityMatch[1],
          type: "organization",
        }
      : undefined,
  };
}

/**
 * Enforce exact word count
 */
function enforceWordCount(text: string, count: number): string {
  const words = text.split(/\s+/).filter(Boolean);

  if (words.length === count) {
    return text;
  }

  if (words.length > count) {
    // Truncate
    return words.slice(0, count).join(" ");
  }

  // Pad with ellipsis or repeat last word
  while (words.length < count) {
    words.push("...");
  }

  return words.slice(0, count).join(" ");
}

// ============================================================================
// Helpers
// ============================================================================

function inferSourceName(source: string): string {
  const names: Record<string, string> = {
    hacker_news: "Hacker News",
    arxiv: "arXiv",
    reddit: "Reddit",
    rss: "RSS Feed",
    github: "GitHub",
    product_hunt: "Product Hunt",
    dev_to: "Dev.to",
    twitter: "Twitter/X",
    manual: "Manual Entry",
  };
  return names[source] || source;
}

function inferReliability(source: string): SourceReliability {
  const reliable: string[] = ["arxiv", "github"];
  const secondary: string[] = ["hacker_news", "reddit", "dev_to", "product_hunt"];

  if (reliable.includes(source)) return "reliable";
  if (secondary.includes(source)) return "secondary";
  return "inferred";
}
