/**
 * Claim-to-Source Entailment Checker
 *
 * Verifies whether a claim is actually supported by the cited source content.
 * Uses LLM-as-judge with structured prompts to determine:
 * - ENTAILED: Source explicitly supports the claim
 * - NEUTRAL: Source doesn't mention the claim
 * - CONTRADICTED: Source explicitly contradicts the claim
 *
 * Audit-ready: Every verification is logged with rationale.
 *
 * @module domains/verification/entailmentChecker
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type EntailmentVerdict = "entailed" | "neutral" | "contradicted";

export interface EntailmentResult {
  verdict: EntailmentVerdict;
  confidence: number;           // 0-1
  extractedEvidence?: string;   // Quote from source supporting verdict
  reasoning: string;            // LLM's explanation
  claimComponents: {
    subject?: string;
    predicate?: string;
    object?: string;
    temporalMarker?: string;
    quantitativeValue?: string;
  };
  sourceMetadata: {
    domain: string;
    tier: string;
    fetchedAt: number;
  };
}

export interface BatchEntailmentResult {
  claimId: string;
  claim: string;
  results: Array<{
    sourceUrl: string;
    result: EntailmentResult;
  }>;
  aggregateVerdict: EntailmentVerdict;
  supportingSourceCount: number;
  contradictingSourceCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTAILMENT PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

const ENTAILMENT_SYSTEM_PROMPT = `You are a rigorous fact-checker. Your job is to determine whether a SOURCE TEXT entails, is neutral about, or contradicts a CLAIM.

DEFINITIONS:
- ENTAILED: The source explicitly states or strongly implies the claim is true. The evidence must be direct, not inferential.
- NEUTRAL: The source does not mention the claim or provides insufficient information to verify it.
- CONTRADICTED: The source explicitly states or strongly implies the claim is false.

RULES:
1. Be conservative. If unsure, verdict is NEUTRAL.
2. Numbers must match exactly or within 1% to be ENTAILED.
3. Dates must match exactly.
4. Entity names must be clearly the same entity.
5. Temporal markers matter: "will announce" ≠ "announced"
6. Quote the exact evidence from the source.

OUTPUT FORMAT (JSON):
{
  "verdict": "entailed" | "neutral" | "contradicted",
  "confidence": 0.0-1.0,
  "extractedEvidence": "Exact quote from source or null if neutral",
  "reasoning": "Step-by-step explanation",
  "claimComponents": {
    "subject": "Main entity",
    "predicate": "Action/relation",
    "object": "Target/value",
    "temporalMarker": "Date/time reference if any",
    "quantitativeValue": "Number if any"
  }
}`;

function buildEntailmentPrompt(claim: string, sourceContent: string): string {
  return `CLAIM: ${claim}

SOURCE TEXT (first 4000 chars):
${sourceContent.slice(0, 4000)}

Analyze whether the source text ENTAILS, is NEUTRAL about, or CONTRADICTS the claim.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTAILMENT CHECKER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a claim is entailed by source content
 */
export const checkEntailment = internalAction({
  args: {
    claim: v.string(),
    sourceContent: v.string(),
    sourceUrl: v.string(),
    sourceTier: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<EntailmentResult> => {
    const domain = new URL(args.sourceUrl).hostname;
    const tier = args.sourceTier ?? "unknown";

    try {
      const result = await generateText({
        model: openai.chat("gpt-5.4-nano"),
        system: ENTAILMENT_SYSTEM_PROMPT,
        prompt: buildEntailmentPrompt(args.claim, args.sourceContent),
        temperature: 0.1,
      });

      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          verdict: "neutral",
          confidence: 0,
          reasoning: "Failed to parse LLM response",
          claimComponents: {},
          sourceMetadata: { domain, tier, fetchedAt: Date.now() },
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        verdict: parsed.verdict as EntailmentVerdict,
        confidence: parsed.confidence,
        extractedEvidence: parsed.extractedEvidence,
        reasoning: parsed.reasoning,
        claimComponents: parsed.claimComponents ?? {},
        sourceMetadata: { domain, tier, fetchedAt: Date.now() },
      };
    } catch (error) {
      console.error("[checkEntailment] Error:", error);
      return {
        verdict: "neutral",
        confidence: 0,
        reasoning: `Error: ${error}`,
        claimComponents: {},
        sourceMetadata: { domain, tier, fetchedAt: Date.now() },
      };
    }
  },
});

/**
 * Check entailment against multiple sources
 */
export const checkEntailmentMultiSource = internalAction({
  args: {
    claim: v.string(),
    sources: v.array(
      v.object({
        url: v.string(),
        content: v.string(),
        tier: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<BatchEntailmentResult> => {
    const results: Array<{ sourceUrl: string; result: EntailmentResult }> = [];

    for (const source of args.sources) {
      const result = await ctx.runAction(
        internal.domains.verification.entailmentChecker.checkEntailment,
        {
          claim: args.claim,
          sourceContent: source.content,
          sourceUrl: source.url,
          sourceTier: source.tier,
        }
      );
      results.push({ sourceUrl: source.url, result });
    }

    const entailedCount = results.filter((r) => r.result.verdict === "entailed").length;
    const contradictedCount = results.filter((r) => r.result.verdict === "contradicted").length;

    let aggregateVerdict: EntailmentVerdict;
    if (contradictedCount > 0) {
      aggregateVerdict = "contradicted";
    } else if (entailedCount > 0) {
      aggregateVerdict = "entailed";
    } else {
      aggregateVerdict = "neutral";
    }

    return {
      claimId: `claim_${Date.now()}`,
      claim: args.claim,
      results,
      aggregateVerdict,
      supportingSourceCount: entailedCount,
      contradictingSourceCount: contradictedCount,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// FACT EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

const FACT_EXTRACTION_PROMPT = `Extract verifiable facts from the following text. Focus on:
1. Funding amounts and dates
2. Executive appointments
3. Product launches and dates
4. Regulatory approvals (FDA, SEC filings)
5. Acquisitions/mergers
6. Financial metrics (revenue, growth, valuations)

For each fact, provide:
- The exact claim text
- The subject entity
- The type of claim (funding, appointment, launch, regulatory, acquisition, financial)
- Any numbers or dates involved
- Confidence in extraction (0-1)

OUTPUT FORMAT (JSON array):
[
  {
    "claimText": "OpenAI raised $6.6B at a $157B valuation",
    "subject": "OpenAI",
    "claimType": "funding",
    "numbers": ["6.6B", "157B"],
    "dates": [],
    "extractionConfidence": 0.95
  }
]`;

/**
 * Extract verifiable facts from source content
 */
export const extractVerifiableFacts = internalAction({
  args: {
    content: v.string(),
    sourceUrl: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const result = await generateText({
        model: openai.chat("gpt-5.4-nano"),
        system: FACT_EXTRACTION_PROMPT,
        prompt: `SOURCE URL: ${args.sourceUrl}\n\nCONTENT:\n${args.content.slice(0, 6000)}`,
        temperature: 0.1,
      });

      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return { facts: [], error: "Failed to parse extraction response" };
      }

      const facts = JSON.parse(jsonMatch[0]);
      return {
        facts,
        sourceUrl: args.sourceUrl,
        extractedAt: Date.now(),
      };
    } catch (error) {
      console.error("[extractVerifiableFacts] Error:", error);
      return { facts: [], error: String(error) };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-REFERENCE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cross-reference a claim against authoritative sources
 */
export const crossReferenceWithAuthoritativeSources = internalAction({
  args: {
    claim: v.string(),
    subject: v.string(),
    claimType: v.string(),
    existingSources: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Determine which authoritative sources to check based on claim type
    const suggestedSources: Array<{ name: string; url: string; reason: string }> = [];

    switch (args.claimType) {
      case "funding":
      case "acquisition":
      case "financial":
        suggestedSources.push({
          name: "SEC EDGAR",
          url: `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(args.subject)}&type=&dateb=&owner=include&count=40&action=getcompany`,
          reason: "Official SEC filings for public companies",
        });
        suggestedSources.push({
          name: "Crunchbase",
          url: `https://www.crunchbase.com/textsearch?q=${encodeURIComponent(args.subject)}`,
          reason: "Funding round database (verify against primary sources)",
        });
        break;

      case "regulatory":
      case "fda_approval":
        suggestedSources.push({
          name: "FDA Drug Approvals",
          url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm`,
          reason: "Official FDA approval database",
        });
        suggestedSources.push({
          name: "ClinicalTrials.gov",
          url: `https://clinicaltrials.gov/search?term=${encodeURIComponent(args.subject)}`,
          reason: "Official clinical trial registry",
        });
        break;

      case "research":
      case "publication":
        suggestedSources.push({
          name: "arXiv",
          url: `https://arxiv.org/search/?query=${encodeURIComponent(args.subject)}&searchtype=all`,
          reason: "Preprint server for academic papers",
        });
        suggestedSources.push({
          name: "PubMed",
          url: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(args.subject)}`,
          reason: "Medical/scientific literature database",
        });
        break;

      case "patent":
        suggestedSources.push({
          name: "USPTO",
          url: `https://patft.uspto.gov/netacgi/nph-Parser?Sect1=PTO2&Sect2=HITOFF&u=%2Fnetahtml%2FPTO%2Fsearch-adv.htm&r=0&p=1&f=S&l=50&Query=${encodeURIComponent(args.subject)}&d=PTXT`,
          reason: "Official US patent database",
        });
        break;

      default:
        // General news verification
        suggestedSources.push({
          name: "Reuters",
          url: `https://www.reuters.com/search/news?blob=${encodeURIComponent(args.subject)}`,
          reason: "Wire service with editorial standards",
        });
    }

    // Check which sources are already in the existing sources
    const existingDomains = new Set(
      args.existingSources.map((url) => {
        try {
          return new URL(url).hostname;
        } catch {
          return "";
        }
      })
    );

    const missingSources = suggestedSources.filter(
      (s) => !existingDomains.has(new URL(s.url).hostname)
    );

    return {
      claim: args.claim,
      subject: args.subject,
      claimType: args.claimType,
      existingSourceCount: args.existingSources.length,
      suggestedSources,
      missingSources,
      verificationComplete: missingSources.length === 0,
      recommendation:
        missingSources.length > 0
          ? `Verify against: ${missingSources.map((s) => s.name).join(", ")}`
          : "Claim has authoritative source coverage",
    };
  },
});
