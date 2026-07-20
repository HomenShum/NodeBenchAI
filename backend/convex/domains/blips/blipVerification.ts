/**
 * blipVerification.ts - LLM-as-judge claim verification
 *
 * Verifies extracted claims against sources.
 * Updates claim spans and blip verification summaries.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Verdict, EvidenceAlignment, SupportingEvidence } from "./types";

// ============================================================================
// Verification Actions
// ============================================================================

/**
 * Verify a single claim
 */
export const verifyClaim = internalAction({
  args: {
    claimSpanId: v.id("claimSpans"),
  },
  handler: async (ctx, args) => {
    // Get unverified claims to find this one
    const unverifiedClaims = await ctx.runQuery(
      internal.domains.blips.blipQueries.getUnverifiedClaims,
      { limit: 100 }
    );

    const claim = unverifiedClaims.find((c: any) => c._id === args.claimSpanId);
    if (!claim) {
      console.error("[BlipVerification] Claim not found:", args.claimSpanId);
      return { error: "Claim not found" };
    }

    // Verify using LLM
    const verificationResult = await verifyWithLLM(claim.claimText, claim.entities);

    // Insert verification result
    const verificationId = await ctx.runMutation(
      internal.domains.blips.blipMutations.insertClaimVerification,
      {
        claimSpanId: args.claimSpanId,
        verdict: verificationResult.verdict,
        confidence: verificationResult.confidence,
        supportingEvidence: verificationResult.evidence,
        contradictions: verificationResult.contradictions,
        judgeModel: "qwen3-coder-free",
        judgeReasoning: verificationResult.reasoning,
      }
    );

    return {
      claimSpanId: args.claimSpanId,
      verdict: verificationResult.verdict,
      confidence: verificationResult.confidence,
      verificationId,
    };
  },
});

/**
 * Verify batch of unverified claims
 */
export const verifyClaimsBatch = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    const unverifiedClaims = await ctx.runQuery(
      internal.domains.blips.blipQueries.getUnverifiedClaims,
      { limit }
    );

    const results: any[] = [];

    for (const claim of unverifiedClaims) {
      try {
        const result = await ctx.runAction(
          internal.domains.blips.blipVerification.verifyClaim,
          { claimSpanId: claim._id }
        );
        results.push(result);
      } catch (error) {
        console.error(`[BlipVerification] Error for ${claim._id}:`, error);
        results.push({ claimSpanId: claim._id, error: String(error) });
      }
    }

    // Update blip verification summaries
    const newsItemIds = [...new Set(unverifiedClaims.map((c: any) => c.newsItemId))];

    for (const newsItemId of newsItemIds) {
      await updateBlipVerificationSummary(ctx, newsItemId);
    }

    return {
      processed: results.length,
      verified: results.filter((r) => r.verdict === "verified").length,
      contradicted: results.filter((r) => r.verdict === "contradicted").length,
    };
  },
});

/**
 * Update blip's verification summary based on its claims
 */
async function updateBlipVerificationSummary(ctx: any, newsItemId: any) {
  try {
    // Get blip for this news item
    const blip = await ctx.runQuery(
      internal.domains.blips.blipQueries.getBlipForNewsItem,
      { newsItemId }
    );

    if (!blip) return;

    // Get all claims for this news item
    const claims = await ctx.runQuery(
      internal.domains.blips.blipQueries.getClaimsForNewsItem,
      { newsItemId }
    );

    // Count by verification status
    const totalClaims = claims.length;
    const verifiedClaims = claims.filter(
      (c: any) => c.verificationStatus === "verified" || c.verificationStatus === "partially_verified"
    ).length;
    const contradictedClaims = claims.filter(
      (c: any) => c.verificationStatus === "contradicted"
    ).length;

    // Calculate overall confidence
    let overallConfidence = 0.5;
    if (totalClaims > 0) {
      overallConfidence = verifiedClaims / totalClaims;
      if (contradictedClaims > 0) {
        overallConfidence -= 0.2 * (contradictedClaims / totalClaims);
      }
      overallConfidence = Math.max(0, Math.min(1, overallConfidence));
    }

    // Update blip
    await ctx.runMutation(
      internal.domains.blips.blipMutations.updateBlipVerificationSummary,
      {
        blipId: blip._id,
        verificationSummary: {
          totalClaims,
          verifiedClaims,
          contradictedClaims,
          overallConfidence,
        },
      }
    );
  } catch (error) {
    console.error("[BlipVerification] Error updating summary:", error);
  }
}

// ============================================================================
// LLM Verification
// ============================================================================

interface VerificationResult {
  verdict: Verdict;
  confidence: number;
  evidence: SupportingEvidence[];
  contradictions?: Array<{
    contradictingClaim: string;
    sourceUrl?: string;
    sourceName: string;
  }>;
  reasoning: string;
}

async function verifyWithLLM(
  claimText: string,
  entities: any[]
): Promise<VerificationResult> {
  try {
    const { generateText } = await import("ai");
    const { getLanguageModelSafe } = await import("../agents/mcp_tools/models/modelResolver");

    const model = await getLanguageModelSafe("qwen3-coder-free");
    if (!model) {
      return verifyWithHeuristics(claimText, entities);
    }

    const entityNames = entities.map((e: any) => e.name).join(", ");

    const prompt = `You are a fact-checker. Evaluate this claim and determine if it's verifiable.

Claim: "${claimText}"
Entities mentioned: ${entityNames || "None"}

Respond with ONLY valid JSON:
{
  "verdict": "verified|partially_verified|contradicted|unverifiable|insufficient_evidence",
  "confidence": 0.7,
  "reasoning": "Brief explanation of your assessment",
  "evidence": [
    {
      "sourceName": "Common knowledge/reasoning",
      "snippet": "Evidence or explanation",
      "alignment": "supports|contradicts|neutral"
    }
  ]
}

Guidelines:
- "verified" = claim is clearly true based on common knowledge
- "partially_verified" = claim is mostly true with some uncertainty
- "contradicted" = claim conflicts with known facts
- "unverifiable" = cannot be verified without external sources
- "insufficient_evidence" = not enough context to judge
- Confidence should be 0.3-1.0`;

    const { text: response } = await generateText({
      model,
      prompt,
      maxOutputTokens: 500,
      temperature: 0.1,
    });

    if (!response) return verifyWithHeuristics(claimText, entities);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return verifyWithHeuristics(claimText, entities);

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      verdict: validateVerdict(parsed.verdict),
      confidence: Math.min(1, Math.max(0.3, parsed.confidence || 0.5)),
      evidence: (parsed.evidence || []).map((e: any) => ({
        sourceName: e.sourceName || "LLM Analysis",
        snippet: e.snippet || "",
        alignment: validateAlignment(e.alignment),
      })),
      contradictions: parsed.contradictions,
      reasoning: parsed.reasoning || "Automated verification",
    };
  } catch (error) {
    console.error("[BlipVerification] LLM error:", error);
    return verifyWithHeuristics(claimText, entities);
  }
}

/**
 * Heuristic-based verification (fallback)
 */
function verifyWithHeuristics(claimText: string, entities: any[]): VerificationResult {
  const lower = claimText.toLowerCase();

  // Check for quantitative claims
  const hasNumbers = /\d+(?:\.\d+)?/.test(claimText);
  const hasPercentage = /%|percent/i.test(claimText);

  // Check for hedging language
  const hasHedging = /may|might|could|possibly|potentially|reportedly/i.test(lower);

  // Check for attribution
  const hasAttribution = /said|stated|announced|according to|reported/i.test(lower);

  let verdict: Verdict = "unverifiable";
  let confidence = 0.5;

  if (hasNumbers && hasAttribution) {
    // Quantitative claim with attribution - harder to verify without source
    verdict = "insufficient_evidence";
    confidence = 0.4;
  } else if (hasAttribution) {
    // Attribution claim - partially verifiable
    verdict = "partially_verified";
    confidence = 0.6;
  } else if (hasHedging) {
    // Hedged claim - lower confidence
    verdict = "unverifiable";
    confidence = 0.3;
  }

  return {
    verdict,
    confidence,
    evidence: [
      {
        sourceName: "Heuristic Analysis",
        snippet: `Claim analyzed using pattern matching. ${hasNumbers ? "Contains numbers. " : ""}${hasAttribution ? "Has attribution. " : ""}${hasHedging ? "Contains hedging language." : ""}`,
        alignment: "neutral",
        publishedAt: Date.now(),
      },
    ],
    reasoning: "Verified using heuristic rules (LLM unavailable)",
  };
}

// ============================================================================
// Validators
// ============================================================================

function validateVerdict(verdict: string): Verdict {
  const valid: Verdict[] = [
    "verified",
    "partially_verified",
    "contradicted",
    "unverifiable",
    "insufficient_evidence",
  ];
  return valid.includes(verdict as Verdict) ? (verdict as Verdict) : "unverifiable";
}

function validateAlignment(alignment: string): EvidenceAlignment {
  const valid: EvidenceAlignment[] = ["supports", "contradicts", "neutral"];
  return valid.includes(alignment as EvidenceAlignment)
    ? (alignment as EvidenceAlignment)
    : "neutral";
}
