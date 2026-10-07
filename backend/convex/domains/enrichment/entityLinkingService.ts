/**
 * Entity Linking Service - Unified service for linking entities to Wikidata
 *
 * Features:
 * - Caches resolved entities in entityProfiles table
 * - Tracks mentions across content
 * - Uses LLM for disambiguation and alias resolution
 * - Provides canonical entity identification for deduplication
 *
 * @module domains/enrichment/entityLinkingService
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface EntityLinkRequest {
  name: string;
  context?: string;
  expectedType?: "person" | "company" | "organization" | "location" | "other";
  sourceType?: "linkedinFundingPost" | "feedItem" | "narrativeEvent" | "narrativePost" | "document";
  sourceId?: string;
  mentionType?: "primary" | "secondary" | "investor" | "partner" | "competitor";
}

export interface EntityLinkResult {
  found: boolean;
  wikidataId?: string;
  canonicalName?: string;
  description?: string;
  entityType?: "person" | "company" | "organization" | "location" | "other";
  confidence: number;
  method: "cache" | "llm_disambiguation" | "llm_fuzzy" | "single_match" | "not_found";
  profileId?: Id<"entityProfiles">;
  isNewProfile?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE QUERIES
// ═══════════════════════════════════════════════════════════════════════════

// Note: Queries (getProfileByWikidataId, searchProfileByName) moved to entityLinkingQueries.ts
// Note: Mutations (upsertEntityProfile, recordEntityMention) moved to entityLinkingMutations.ts
// (Queries and Mutations cannot be defined in Node.js files)

// ═══════════════════════════════════════════════════════════════════════════
// WIKIDATA API
// ═══════════════════════════════════════════════════════════════════════════

interface WikidataCandidate {
  id: string;
  label: string;
  description?: string;
}

async function searchWikidata(query: string, limit: number = 5): Promise<WikidataCandidate[]> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&format=json&origin=*&limit=${limit}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    return (data.search || []).map((item: any) => ({
      id: item.id,
      label: item.label,
      description: item.description,
    }));
  } catch (error) {
    console.error("[searchWikidata] Error:", error);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LLM-based normalization and disambiguation
 * Returns raw LLM confidence without heuristic adjustments
 */
async function llmNormalizeAndDisambiguate(
  name: string,
  context: string | undefined,
  expectedType: string | undefined,
  candidates: WikidataCandidate[]
): Promise<{
  normalizedQuery: string;
  selectedIndex: number;
  confidence: number;
  reasoning: string;
  matchQuality: "exact" | "strong" | "moderate" | "weak" | "none";
}> {
  const candidateList = candidates
    .map((c, i) => `${i + 1}. ${c.label} (${c.id}): ${c.description || "No description"}`)
    .join("\n");

  const prompt = `You are an entity linking expert. Given a query and context, normalize the name and select the best matching Wikidata entity.

QUERY: "${name}"
${context ? `CONTEXT: "${context}"` : ""}
${expectedType ? `EXPECTED TYPE: ${expectedType}` : ""}

TASKS:
1. First, normalize the query (fix typos, expand aliases like "Diddy" → "Sean Combs")
2. Then select the best matching entity from candidates (or 0 if none match)
3. Rate your confidence based on match quality, NOT heuristics

CONFIDENCE CALIBRATION (be accurate, not overconfident):
- 0.95-1.0: Exact match, unambiguous (e.g., "Apple Inc" → Apple company)
- 0.85-0.94: Strong match with clear context support
- 0.70-0.84: Good match but some ambiguity possible
- 0.50-0.69: Moderate match, significant uncertainty
- 0.30-0.49: Weak match, likely incorrect
- 0.0-0.29: Very uncertain or no match

CANDIDATES:
${candidateList}

Respond with JSON only:
{
  "normalizedQuery": "corrected name or original",
  "selectedIndex": <1-${candidates.length} or 0 for none>,
  "confidence": 0.0-1.0,
  "matchQuality": "exact|strong|moderate|weak|none",
  "reasoning": "Brief explanation"
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
        normalizedQuery: parsed.normalizedQuery || name,
        selectedIndex: parsed.selectedIndex || 0,
        confidence: parsed.confidence || 0.5,
        matchQuality: parsed.matchQuality || "moderate",
        reasoning: parsed.reasoning || "No reasoning provided",
      };
    }
  } catch (error) {
    console.error("[llmNormalizeAndDisambiguate] Error:", error);
  }

  return {
    normalizedQuery: name,
    selectedIndex: candidates.length > 0 ? 1 : 0,
    confidence: 0.4, // Lower default for fallback
    matchQuality: "weak",
    reasoning: "LLM failed, using fallback",
  };
}

/**
 * Get LLM confidence for single-match scenarios (no candidates to compare)
 */
async function llmAssessSingleMatch(
  query: string,
  context: string | undefined,
  candidate: WikidataCandidate,
  expectedType: string | undefined
): Promise<{ confidence: number; matchQuality: string; reasoning: string }> {
  const prompt = `You are an entity linking expert. Assess if this Wikidata entity is the correct match for the query.

QUERY: "${query}"
${context ? `CONTEXT: "${context}"` : ""}
${expectedType ? `EXPECTED TYPE: ${expectedType}` : ""}

CANDIDATE:
- ID: ${candidate.id}
- Name: ${candidate.label}
- Description: ${candidate.description || "No description"}

CONFIDENCE CALIBRATION (be accurate, not overconfident):
- 0.95-1.0: Exact match, unambiguous
- 0.85-0.94: Strong match with clear context support
- 0.70-0.84: Good match but some ambiguity possible
- 0.50-0.69: Moderate match, significant uncertainty
- Below 0.50: Likely incorrect

Respond with JSON only:
{
  "confidence": 0.0-1.0,
  "matchQuality": "exact|strong|moderate|weak|none",
  "reasoning": "Brief explanation"
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
        confidence: parsed.confidence || 0.5,
        matchQuality: parsed.matchQuality || "moderate",
        reasoning: parsed.reasoning || "No reasoning",
      };
    }
  } catch (error) {
    console.error("[llmAssessSingleMatch] Error:", error);
  }

  return { confidence: 0.5, matchQuality: "moderate", reasoning: "LLM assessment failed" };
}

function inferEntityType(
  description: string | undefined,
  expectedType: string | undefined
): "person" | "company" | "organization" | "location" | "other" {
  if (expectedType) return expectedType as any;

  const desc = (description || "").toLowerCase();

  if (desc.includes("person") || desc.includes("human") || desc.includes("executive") ||
      desc.includes("founder") || desc.includes("ceo") || desc.includes("actor") ||
      desc.includes("musician") || desc.includes("athlete") || desc.includes("politician")) {
    return "person";
  }

  if (desc.includes("company") || desc.includes("corporation") || desc.includes("business") ||
      desc.includes("enterprise") || desc.includes("inc.") || desc.includes("ltd")) {
    return "company";
  }

  if (desc.includes("organization") || desc.includes("institution") || desc.includes("agency")) {
    return "organization";
  }

  if (desc.includes("city") || desc.includes("country") || desc.includes("capital") ||
      desc.includes("state") || desc.includes("region")) {
    return "location";
  }

  return "other";
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LINKING ACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Link an entity name to Wikidata with caching
 * This is the main entry point for entity linking
 */
export const linkEntity = internalAction({
  args: {
    name: v.string(),
    context: v.optional(v.string()),
    expectedType: v.optional(v.union(
      v.literal("person"),
      v.literal("company"),
      v.literal("organization"),
      v.literal("location"),
      v.literal("other")
    )),
    sourceType: v.optional(v.union(
      v.literal("linkedinFundingPost"),
      v.literal("feedItem"),
      v.literal("narrativeEvent"),
      v.literal("narrativePost"),
      v.literal("document")
    )),
    sourceId: v.optional(v.string()),
    mentionType: v.optional(v.union(
      v.literal("primary"),
      v.literal("secondary"),
      v.literal("investor"),
      v.literal("partner"),
      v.literal("competitor")
    )),
  },
  returns: v.object({
    found: v.boolean(),
    wikidataId: v.optional(v.string()),
    canonicalName: v.optional(v.string()),
    description: v.optional(v.string()),
    entityType: v.optional(v.string()),
    confidence: v.number(),
    method: v.string(),
    profileId: v.optional(v.id("entityProfiles")),
    isNewProfile: v.optional(v.boolean()),
  }),
  handler: async (ctx, args): Promise<EntityLinkResult> => {
    const { name, context, expectedType, sourceType, sourceId, mentionType } = args;

    // Step 1: Search Wikidata for candidates
    const candidates = await searchWikidata(name, 5);

    if (candidates.length === 0) {
      // Try with normalized name
      const normalizeResult = await llmNormalizeAndDisambiguate(name, context, expectedType, []);

      if (normalizeResult.normalizedQuery !== name) {
        const retryCandiates = await searchWikidata(normalizeResult.normalizedQuery, 5);
        if (retryCandiates.length === 0) {
          // Use LLM's confidence assessment for not-found (no heuristic override)
          return { found: false, confidence: normalizeResult.confidence * 0.5, method: "not_found" };
        }
        // Continue with retry candidates
        return await processCandiates(ctx, args, retryCandiates, normalizeResult.normalizedQuery);
      }

      // Entity genuinely not in Wikidata - low confidence is appropriate
      return { found: false, confidence: 0.1, method: "not_found" };
    }

    return await processCandiates(ctx, args, candidates, name);
  },
});

async function processCandiates(
  ctx: any,
  args: any,
  candidates: WikidataCandidate[],
  searchQuery: string
): Promise<EntityLinkResult> {
  const { name, context, expectedType, sourceType, sourceId, mentionType } = args;

  // Step 2: Check cache for top candidate
  const topCandidate = candidates[0];
  const cachedProfile = await ctx.runQuery(
    internal.domains.enrichment.entityLinkingQueries.getProfileByWikidataId,
    { wikidataId: topCandidate.id }
  );

  // Step 3: If single result or cached, use LLM to assess confidence
  if (candidates.length === 1 || cachedProfile) {
    const selectedCandidate = cachedProfile || topCandidate;
    const wikidataId = cachedProfile?.wikidataId || topCandidate.id;

    // Get LLM-assessed confidence (not heuristic)
    let confidence: number;
    let method: EntityLinkResult["method"];

    if (cachedProfile) {
      // For cached profiles, use LLM to verify the match is still appropriate
      const assessment = await llmAssessSingleMatch(
        name,
        context,
        { id: cachedProfile.wikidataId, label: cachedProfile.canonicalName, description: cachedProfile.description },
        expectedType
      );
      confidence = assessment.confidence;
      method = "cache";
    } else {
      // Single Wikidata result - use LLM to assess match quality
      const assessment = await llmAssessSingleMatch(name, context, topCandidate, expectedType);
      confidence = assessment.confidence;
      method = "single_match";
    }

    // Upsert profile if not cached
    let profileId: Id<"entityProfiles">;
    let isNewProfile = false;

    if (!cachedProfile) {
      const entityType = inferEntityType(topCandidate.description, expectedType);
      profileId = await ctx.runMutation(
        internal.domains.enrichment.entityLinkingMutations.upsertEntityProfile,
        {
          wikidataId: topCandidate.id,
          entityType,
          canonicalName: topCandidate.label,
          description: topCandidate.description,
        }
      );
      isNewProfile = true;
    } else {
      profileId = cachedProfile._id;
    }

    // Record mention if source provided
    if (sourceType && sourceId) {
      await ctx.runMutation(
        internal.domains.enrichment.entityLinkingMutations.recordEntityMention,
        {
          entityId: profileId,
          wikidataId,
          sourceType,
          sourceId,
          mentionType: mentionType || "secondary",
          extractedName: name,
          context: context?.slice(0, 200),
          confidence,
        }
      );
    }

    return {
      found: true,
      wikidataId,
      canonicalName: cachedProfile?.canonicalName || topCandidate.label,
      description: cachedProfile?.description || topCandidate.description,
      entityType: cachedProfile?.entityType || inferEntityType(topCandidate.description, expectedType),
      confidence,
      method,
      profileId,
      isNewProfile,
    };
  }

  // Step 4: Multiple candidates - use LLM to disambiguate
  const disambiguation = await llmNormalizeAndDisambiguate(name, context, expectedType, candidates);
  const selectedIdx = (disambiguation.selectedIndex || 1) - 1;

  if (selectedIdx < 0 || selectedIdx >= candidates.length) {
    return { found: false, confidence: disambiguation.confidence, method: "not_found" };
  }

  const selected = candidates[selectedIdx];
  const entityType = inferEntityType(selected.description, expectedType);

  // Upsert profile
  const profileId = await ctx.runMutation(
    internal.domains.enrichment.entityLinkingMutations.upsertEntityProfile,
    {
      wikidataId: selected.id,
      entityType,
      canonicalName: selected.label,
      description: selected.description,
    }
  );

  // Record mention if source provided
  if (sourceType && sourceId) {
    await ctx.runMutation(
      internal.domains.enrichment.entityLinkingMutations.recordEntityMention,
      {
        entityId: profileId,
        wikidataId: selected.id,
        sourceType,
        sourceId,
        mentionType: mentionType || "secondary",
        extractedName: name,
        context: context?.slice(0, 200),
        confidence: disambiguation.confidence,
      }
    );
  }

  return {
    found: true,
    wikidataId: selected.id,
    canonicalName: selected.label,
    description: selected.description,
    entityType,
    confidence: disambiguation.confidence,
    method: "llm_disambiguation",
    profileId,
    isNewProfile: true,
  };
}

/**
 * Batch link multiple entities
 */
export const batchLinkEntities = internalAction({
  args: {
    entities: v.array(v.object({
      name: v.string(),
      context: v.optional(v.string()),
      expectedType: v.optional(v.string()),
    })),
    sourceType: v.optional(v.string()),
    sourceId: v.optional(v.string()),
  },
  returns: v.array(v.object({
    name: v.string(),
    found: v.boolean(),
    wikidataId: v.optional(v.string()),
    canonicalName: v.optional(v.string()),
    entityType: v.optional(v.string()),
    confidence: v.number(),
  })),
  handler: async (ctx, args) => {
    const results: Array<{
      name: string;
      found: boolean;
      wikidataId?: string;
      canonicalName?: string;
      entityType?: string;
      confidence: number;
    }> = [];

    for (const entity of args.entities) {
      const result = await ctx.runAction(
        internal.domains.enrichment.entityLinkingService.linkEntity,
        {
          name: entity.name,
          context: entity.context,
          expectedType: entity.expectedType as any,
          sourceType: args.sourceType as any,
          sourceId: args.sourceId,
        }
      );

      results.push({
        name: entity.name,
        found: result.found,
        wikidataId: result.wikidataId,
        canonicalName: result.canonicalName,
        entityType: result.entityType,
        confidence: result.confidence,
      });
    }

    return results;
  },
});
