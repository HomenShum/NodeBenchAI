/**
 * encounterCapture.ts - Main capture logic with NER extraction
 *
 * Handles parsing natural language encounter descriptions and
 * extracting participants, companies, and context.
 */

"use node";

import { v } from "convex/values";
import { action, internalAction } from "../../../_generated/server";
import { api, internal } from "../../../_generated/api";
import { Id } from "../../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import type {
  EncounterParticipant,
  EncounterCompany,
  NERExtractionResult,
} from "./types";

// ============================================================================
// Public Actions
// ============================================================================

/**
 * Capture encounter from web UI with NER extraction
 * This is the main entry point for web-based encounter capture.
 */
export const captureFromWeb = action({
  args: {
    rawText: v.string(),
    context: v.optional(v.string()),
    requestFastPass: v.optional(v.boolean()),
    requestDeepDive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();

    // 1. Extract entities using NER
    const nerResult = await extractEntitiesWithNER(args.rawText);

    // 2. Create the encounter record
    const encounterId = await ctx.runMutation(
      api.domains.encounters.encounterMutations.createEncounter,
      {
        rawText: args.rawText,
        title: nerResult.title,
        context: args.context || nerResult.context,
        participants: nerResult.participants,
        companies: nerResult.companies,
        requestFastPass: args.requestFastPass ?? true,
      }
    );

    // 3. If fast pass requested, trigger enrichment
    if (args.requestFastPass !== false) {
      await ctx.scheduler.runAfter(0, internal.domains.encounters.encounterFastPass.runFastPass, {
        encounterId,
      });
    }

    // 4. If deep dive requested immediately, queue it
    if (args.requestDeepDive && nerResult.companies.length > 0) {
      const primaryCompany = nerResult.companies[0];
      await ctx.runMutation(
        api.domains.encounters.encounterMutations.requestDeepDive,
        {
          encounterId,
          entityName: primaryCompany.name,
          entityType: "company",
        }
      );
    }

    const elapsedMs = Date.now() - startTime;

    return {
      encounterId,
      nerResult,
      elapsedMs,
      fastPassQueued: args.requestFastPass !== false,
      deepDiveQueued: !!args.requestDeepDive,
    };
  },
});

/**
 * Trigger deep dive DD job from an encounter
 * This integrates with the DD orchestrator to run full due diligence.
 */
export const triggerDeepDiveFromEncounter = action({
  args: {
    encounterId: v.id("encounterEvents"),
    entityName: v.string(),
    entityType: v.optional(
      v.union(v.literal("company"), v.literal("fund"), v.literal("person"))
    ),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
      throw new Error("Not authenticated");
    }
    const encounterOwnerId = await getUserIdFromEncounter(ctx, args.encounterId);
    if (encounterOwnerId !== authUserId) {
      throw new Error("Not authorized");
    }

    // 1. Update encounter status to deep_dive_queued
    await ctx.runMutation(
      api.domains.encounters.encounterMutations.requestDeepDive,
      {
        encounterId: args.encounterId,
        entityName: args.entityName,
        entityType: args.entityType || "company",
      }
    );

    // 2. Start the DD job with encounter trigger
    const ddResult = await ctx.runAction(
      internal.domains.agents.dueDiligence.ddOrchestrator.startDueDiligenceJobInternal,
      {
        entityName: args.entityName,
        entityType: args.entityType || "company",
        triggerSource: "encounter",
        triggerEncounterId: args.encounterId,
        userId: authUserId,
      }
    );

    // 3. Link the DD job to the encounter
    await ctx.runMutation(
      api.domains.encounters.encounterMutations.linkDDJob,
      {
        encounterId: args.encounterId,
        ddJobId: ddResult.jobId,
      }
    );

    const elapsedMs = Date.now() - startTime;

    return {
      encounterId: args.encounterId,
      ddJobId: ddResult.jobId,
      status: ddResult.status,
      elapsedMs,
    };
  },
});

/**
 * Helper to get userId from encounter
 */
async function getUserIdFromEncounter(
  ctx: any,
  encounterId: Id<"encounterEvents">
): Promise<Id<"users">> {
  const encounter = await ctx.runQuery(
    api.domains.encounters.encounterQueries.getEncounter,
    { encounterId }
  );
  if (!encounter) {
    throw new Error("Encounter not found");
  }
  return encounter.userId;
}

/**
 * Re-extract entities for an existing encounter
 */
export const reExtractEntities = action({
  args: {
    encounterId: v.id("encounterEvents"),
  },
  handler: async (ctx, args) => {
    // Get the encounter
    const encounter = await ctx.runQuery(
      api.domains.encounters.encounterQueries.getEncounter,
      { encounterId: args.encounterId }
    );

    if (!encounter) {
      throw new Error("Encounter not found");
    }

    // Re-extract entities
    const nerResult = await extractEntitiesWithNER(encounter.rawText);

    // Update the encounter
    await ctx.runMutation(
      api.domains.encounters.encounterMutations.updateExtractedEntities,
      {
        encounterId: args.encounterId,
        participants: nerResult.participants,
        companies: nerResult.companies,
        title: nerResult.title,
        context: nerResult.context,
      }
    );

    return nerResult;
  },
});

// ============================================================================
// Internal Actions
// ============================================================================

/**
 * Process encounter from Slack (internal)
 */
export const processSlackEncounter = internalAction({
  args: {
    userId: v.id("users"),
    rawText: v.string(),
    channelId: v.string(),
    messageTs: v.string(),
    requestFastPass: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();

    // 1. Extract entities
    const nerResult = await extractEntitiesWithNER(args.rawText);

    // 2. Create encounter
    const encounterId = await ctx.runMutation(
      internal.domains.encounters.encounterMutations.createFromSlack,
      {
        userId: args.userId,
        rawText: args.rawText,
        title: nerResult.title,
        channelId: args.channelId,
        messageTs: args.messageTs,
        participants: nerResult.participants,
        companies: nerResult.companies,
        requestFastPass: args.requestFastPass ?? true,
      }
    );

    // 3. Trigger fast pass if requested
    if (args.requestFastPass !== false) {
      await ctx.scheduler.runAfter(0, internal.domains.encounters.encounterFastPass.runFastPass, {
        encounterId,
      });
    }

    const elapsedMs = Date.now() - startTime;

    return {
      encounterId,
      nerResult,
      elapsedMs,
    };
  },
});

// ============================================================================
// NER Extraction
// ============================================================================

/**
 * Extract entities from natural language text
 * Uses LLM for intelligent extraction with fallback to regex
 */
async function extractEntitiesWithNER(rawText: string): Promise<NERExtractionResult> {
  const participants: EncounterParticipant[] = [];
  const companies: EncounterCompany[] = [];

  try {
    // Try LLM-based extraction first
    const llmResult = await extractWithLLM(rawText);
    if (llmResult) {
      return llmResult;
    }
  } catch (error) {
    console.error("[EncounterCapture] LLM extraction failed, falling back to regex:", error);
  }

  // Fallback to regex-based extraction
  return extractWithRegex(rawText);
}

/**
 * LLM-based entity extraction
 */
async function extractWithLLM(rawText: string): Promise<NERExtractionResult | null> {
  try {
    const { generateText } = await import("ai");
    const { getLanguageModelSafe } = await import("../../agents/mcp_tools/models/modelResolver");

    const model = await getLanguageModelSafe("qwen3-coder-free");
    if (!model) {
      return null;
    }

    const prompt = `Extract meeting/encounter information from this text. Return ONLY valid JSON.

Text: "${rawText}"

Return this exact format:
{
  "title": "Short descriptive title (e.g., 'Meeting with Sarah Chen at Benchling')",
  "context": "Brief context if mentioned (e.g., 'discussing partnership opportunities')",
  "participants": [
    {
      "name": "Full name",
      "role": "Title/role if mentioned",
      "company": "Company if mentioned"
    }
  ],
  "companies": [
    {
      "name": "Company name"
    }
  ]
}

Rules:
- Extract real names, not placeholders
- Only include clearly mentioned people/companies
- Role and company are optional
- If no participants found, return empty array
- Context should be null if not clear`;

    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: 500,
      temperature: 0.1,
    });

    if (!text) return null;

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    const participants: EncounterParticipant[] = (parsed.participants || []).map(
      (p: { name: string; role?: string; company?: string }) => ({
        name: p.name,
        role: p.role,
        company: p.company,
        confidence: 0.85,  // LLM extraction confidence
      })
    );

    const companies: EncounterCompany[] = (parsed.companies || []).map(
      (c: { name: string }) => ({
        name: c.name,
        confidence: 0.85,
      })
    );

    return {
      participants,
      companies,
      title: parsed.title || generateTitleFromText(rawText),
      context: parsed.context || undefined,
    };
  } catch (error) {
    console.error("[EncounterCapture] LLM extraction error:", error);
    return null;
  }
}

/**
 * Regex-based entity extraction (fallback)
 */
function extractWithRegex(rawText: string): NERExtractionResult {
  const participants: EncounterParticipant[] = [];
  const companies: EncounterCompany[] = [];

  // Pattern: "X @ Y" or "X at Y" or "X from Y"
  const atPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*[@]|(?:at|from)\s+([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*)/g;

  // Pattern: "Met with X" or "Coffee with X"
  const metPattern = /(?:met|meeting|coffee|call|spoke|chat)\s+(?:with\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi;

  // Pattern: capitalized names (simple)
  const namePattern = /([A-Z][a-z]+\s+[A-Z][a-z]+)/g;

  // Pattern: company patterns (ends with Inc, Corp, Labs, etc.)
  const companyPattern = /([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*)\s*(?:Inc|Corp|LLC|Labs?|Bio|Tech|AI|Systems|Health|Therapeutics)?/g;

  // Extract from patterns
  let match;

  // Try met pattern first
  while ((match = metPattern.exec(rawText)) !== null) {
    const name = match[1].trim();
    if (name.length >= 3 && name.length <= 50 && !isCommonWord(name)) {
      participants.push({
        name,
        confidence: 0.6,
      });
    }
  }

  // Try @ pattern
  const atMatch = rawText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*[@]\s*([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)*)/);
  if (atMatch) {
    const personName = atMatch[1].trim();
    const companyName = atMatch[2].trim();

    if (!participants.some((p) => p.name === personName)) {
      participants.push({
        name: personName,
        company: companyName,
        confidence: 0.7,
      });
    }

    if (!companies.some((c) => c.name === companyName)) {
      companies.push({
        name: companyName,
        confidence: 0.7,
      });
    }
  }

  // Look for explicit company mentions
  const companyKeywords = ["at", "from", "with", "@"];
  for (const keyword of companyKeywords) {
    const companyMatch = rawText.match(
      new RegExp(`${keyword}\\s+([A-Z][a-zA-Z0-9]+(?:\\s+[A-Z][a-zA-Z0-9]+)*)`, "i")
    );
    if (companyMatch) {
      const companyName = companyMatch[1].trim();
      if (
        companyName.length >= 2 &&
        !isCommonWord(companyName) &&
        !companies.some((c) => c.name === companyName)
      ) {
        companies.push({
          name: companyName,
          confidence: 0.5,
        });
      }
    }
  }

  return {
    participants,
    companies,
    title: generateTitleFromText(rawText),
    context: extractContext(rawText),
  };
}

/**
 * Generate a title from raw text
 */
function generateTitleFromText(rawText: string): string {
  const cleaned = rawText.trim().slice(0, 100);

  // Try "Met with X" pattern
  const meetingMatch = cleaned.match(
    /(?:met|meeting|coffee|call|spoke|chat)\s+(?:with\s+)?([^,\.\-@]+)/i
  );
  if (meetingMatch) {
    return `Meeting with ${meetingMatch[1].trim()}`;
  }

  // Try "X @ Y" pattern
  const atMatch = cleaned.match(/([^@\-]+)\s*[@\-]\s*([^,\.]+)/);
  if (atMatch) {
    return `${atMatch[1].trim()} at ${atMatch[2].trim()}`;
  }

  // Fall back to first 50 chars
  return cleaned.slice(0, 50) + (rawText.length > 50 ? "..." : "");
}

/**
 * Extract meeting context
 */
function extractContext(rawText: string): string | undefined {
  const contextPatterns = [
    /(?:about|regarding|discussing|re:?)\s+(.+?)(?:\.|$)/i,
    /(?:partnership|investment|product|demo|intro|introduction)\s+(?:opportunity|discussion|call)?/i,
  ];

  for (const pattern of contextPatterns) {
    const match = rawText.match(pattern);
    if (match) {
      return match[1]?.trim() || match[0]?.trim();
    }
  }

  return undefined;
}

/**
 * Check if a word is too common to be a name/company
 */
function isCommonWord(word: string): boolean {
  const commonWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "about",
    "meeting",
    "call",
    "coffee",
    "today",
    "tomorrow",
    "yesterday",
    "week",
    "month",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ]);

  return commonWords.has(word.toLowerCase());
}
