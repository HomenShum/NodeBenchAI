"use node";

/**
 * Encounter Parser
 *
 * Extracts entities (people, companies) from encounter text using
 * pattern matching with optional LLM enhancement for complex cases.
 *
 * @module integrations/slack/encounterParser
 */

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ParsedParticipant {
  name: string;
  role?: string;
  company?: string;
}

export interface ParsedEncounter {
  participants: ParsedParticipant[];
  companies: string[];
  context?: string;
  followUpRequested: boolean;
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PARSER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse encounter text to extract entities.
 */
export const parseEncounterText = internalAction({
  args: {
    text: v.string(),
    useLLM: v.optional(v.boolean()),
  },
  returns: v.object({
    participants: v.array(v.object({
      name: v.string(),
      role: v.optional(v.string()),
      company: v.optional(v.string()),
    })),
    companies: v.array(v.string()),
    context: v.optional(v.string()),
    followUpRequested: v.boolean(),
    confidence: v.number(),
  }),
  handler: async (ctx, args): Promise<ParsedEncounter> => {
    const { text } = args;
    console.log(`[EncounterParser] Parsing: "${text.slice(0, 100)}..."`);

    const participants: ParsedParticipant[] = [];
    const companies: string[] = [];
    let context: string | undefined;
    let confidence = 0;

    // ─── Extract Context/Topic ─────────────────────────────────────────────
    // Look for context after a dash or "about" or "regarding"
    const contextPatterns = [
      /[-–—]\s*(.+?)(?:$|\.|!)/i,
      /(?:about|regarding|discussing|re:)\s+(.+?)(?:$|\.|!)/i,
      /(?:topic|subject):\s*(.+?)(?:$|\.|!)/i,
    ];

    for (const pattern of contextPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        context = match[1].trim();
        break;
      }
    }

    // ─── Extract Names with Company ────────────────────────────────────────
    // Pattern: "John Smith from Acme Corp" or "Jane Doe at Google"
    const nameWithCompanyPatterns = [
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:from|at|of|with)\s+([A-Z][A-Za-z0-9]+(?:\s+(?:Corp|Inc|LLC|Ltd|Co|Company|Technologies|Tech|Labs|AI|Health|Capital|Ventures|Partners))?)/gi,
    ];

    for (const pattern of nameWithCompanyPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1].trim();
        const company = match[2].trim();

        if (isValidPersonName(name)) {
          participants.push({ name, company });
          if (!companies.includes(company)) {
            companies.push(company);
          }
          confidence += 0.3;
        }
      }
    }

    // ─── Extract Standalone Names ──────────────────────────────────────────
    // Pattern: "met with John Smith" or "call with Jane Doe"
    const standaloneNamePatterns = [
      /(?:met with|call with|meeting with|spoke to|spoke with|talked to|talked with|coffee with|lunch with|dinner with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi,
      /(?:met|called|spoke|talked)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi,
    ];

    for (const pattern of standaloneNamePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1].trim();

        if (isValidPersonName(name) && !participants.some((p) => p.name === name)) {
          participants.push({ name });
          confidence += 0.2;
        }
      }
    }

    // ─── Extract Roles ─────────────────────────────────────────────────────
    // Pattern: "CEO John Smith" or "John Smith, CEO"
    const rolePatterns = [
      /(?:CEO|CTO|CFO|COO|CMO|VP|Director|Manager|Founder|Co-founder|Partner|Principal|Associate|Analyst)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi,
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+),?\s+(?:the\s+)?(?:CEO|CTO|CFO|COO|CMO|VP|Director|Manager|Founder|Co-founder|Partner|Principal|Associate|Analyst)/gi,
    ];

    for (const pattern of rolePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1].trim();
        const roleMatch = text.match(new RegExp(`(CEO|CTO|CFO|COO|CMO|VP|Director|Manager|Founder|Co-founder|Partner|Principal|Associate|Analyst)\\s*${name}|${name}\\s*,?\\s*(CEO|CTO|CFO|COO|CMO|VP|Director|Manager|Founder|Co-founder|Partner|Principal|Associate|Analyst)`, "i"));
        const role = roleMatch?.[1] || roleMatch?.[2];

        if (isValidPersonName(name)) {
          const existing = participants.find((p) => p.name === name);
          if (existing) {
            existing.role = role;
          } else {
            participants.push({ name, role });
            confidence += 0.2;
          }
        }
      }
    }

    // ─── Extract Standalone Companies ──────────────────────────────────────
    // Pattern: company name with common suffixes
    const companyPatterns = [
      /\b([A-Z][A-Za-z0-9]+(?:\s+(?:Corp|Inc|LLC|Ltd|Co|Company|Technologies|Tech|Labs|AI|Health|Capital|Ventures|Partners)))\b/g,
      /\b((?:Anthropic|OpenAI|Google|Microsoft|Apple|Amazon|Meta|Stripe|Coinbase|Figma|Notion|Slack|Zoom|Databricks|Snowflake|Palantir|SpaceX|Tesla|Nvidia|AMD|Intel|Salesforce|Oracle|SAP|Adobe|Netflix|Spotify|Uber|Lyft|Airbnb|DoorDash|Instacart|Robinhood|Plaid|Affirm))\b/gi,
    ];

    for (const pattern of companyPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const company = match[1].trim();
        if (!companies.includes(company) && company.length > 2) {
          companies.push(company);
          confidence += 0.1;
        }
      }
    }

    // ─── Check for Follow-up Request ───────────────────────────────────────
    const followUpRequested = /follow[\s-]?up|schedule|next\s+steps|action\s+items|to[\s-]?do|reminder|circle[\s-]?back/i.test(text);

    if (followUpRequested) {
      confidence += 0.1;
    }

    // ─── Normalize Confidence ──────────────────────────────────────────────
    confidence = Math.min(confidence, 1);

    console.log(`[EncounterParser] Found ${participants.length} participants, ${companies.length} companies, confidence: ${confidence}`);

    return {
      participants,
      companies,
      context,
      followUpRequested,
      confidence,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate that a string looks like a person's name.
 */
function isValidPersonName(name: string): boolean {
  // Must have at least 2 words
  const words = name.split(/\s+/);
  if (words.length < 2) return false;

  // Each word must be capitalized
  if (!words.every((w) => /^[A-Z][a-z]+$/.test(w))) return false;

  // Exclude common false positives
  const excludePatterns = [
    /^(The|This|That|What|When|Where|Why|How|And|But|For|With|From|About)$/i,
    /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i,
    /^(January|February|March|April|May|June|July|August|September|October|November|December)$/i,
    /^(Meeting|Call|Coffee|Lunch|Dinner|Breakfast|Event|Conference)$/i,
  ];

  if (excludePatterns.some((p) => words.some((w) => p.test(w)))) {
    return false;
  }

  // Exclude if any word is too short (likely abbreviation) or too long
  if (words.some((w) => w.length < 2 || w.length > 20)) {
    return false;
  }

  return true;
}

/**
 * Extract role from text near a name.
 */
function extractRole(text: string, name: string): string | undefined {
  const rolePatterns = [
    new RegExp(`${name},?\\s+(?:the\\s+)?(CEO|CTO|CFO|COO|CMO|VP|Director|Manager|Founder|Co-founder|Partner|Principal|Associate|Analyst)`, "i"),
    new RegExp(`(CEO|CTO|CFO|COO|CMO|VP|Director|Manager|Founder|Co-founder|Partner|Principal|Associate|Analyst)\\s+${name}`, "i"),
    new RegExp(`${name}'s\\s+(CEO|CTO|CFO|COO|CMO|VP|Director|Manager|Founder|Co-founder|Partner|Principal|Associate|Analyst)`, "i"),
  ];

  for (const pattern of rolePatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}
