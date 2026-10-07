"use node";

/**
 * Instagram Claim Verification
 *
 * Verifies claims extracted from Instagram posts using free OpenRouter models.
 * Uses Linkup API for source retrieval + LLM-as-Judge for verification.
 *
 * Cost: $0.00 (uses qwen3-coder-free)
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { generateText } from "ai";
import { getLanguageModel, getLanguageModelSafe } from "../agents/mcp_tools/models/modelResolver";
import { Doc, Id } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type Verdict = "verified" | "partially_verified" | "unverified" | "false";

interface ClaimVerificationResult {
  claim: string;
  status: Verdict;
  explanation: string;
  sources: Array<{
    name: string;
    url?: string;
    credibility: "high" | "medium" | "low";
  }>;
  confidence: number;
}

interface InstagramClaim {
  claim: string;
  confidence: number;
  sourceTimestamp?: number;
  category?: string;
}

// Free model priority - all $0.00 pricing
const FREE_MODEL_PRIORITY = [
  "qwen3-coder-free",         // Free default
  "deepseek-r1-free",        // Strong reasoning
  "kat-coder-pro-free",      // Good structured output
] as const;

// ═══════════════════════════════════════════════════════════════════════════
// LLM JUDGE PROMPT
// ═══════════════════════════════════════════════════════════════════════════

const FACT_CHECK_SYSTEM_PROMPT = `You are a professional fact-checker. Verify claims against the provided source content.

You MUST respond with strict JSON only:
{
  "status": "verified" | "partially_verified" | "unverified" | "false",
  "explanation": "concise explanation (max 100 words)",
  "sources": [
    { "name": "source name", "url": "url if available", "credibility": "high" | "medium" | "low" }
  ],
  "confidence": 0.0 to 1.0
}

Rules:
- "verified": Source explicitly confirms the claim with evidence
- "partially_verified": Some aspects confirmed, others unclear
- "unverified": Cannot confirm or deny - insufficient evidence
- "false": Source directly contradicts the claim

Be rigorous but fair. Cite credible sources when available.`;

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

async function fetchSourceContent(
  claimText: string,
  category?: string
): Promise<{ content: string; sources: Array<{ name: string; url?: string; snippet?: string }> } | null> {
  const apiKey = process.env.LINKUP_API_KEY;
  if (!apiKey) {
    console.warn("[instagramClaimVerification] LINKUP_API_KEY not configured");
    return null;
  }

  try {
    // Build search query based on claim and category
    const searchQuery = category
      ? `${claimText} ${category} fact check`
      : `${claimText} fact check`;

    const response = await fetch("https://api.linkup.so/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: searchQuery,
        depth: "standard",
        outputType: "sourcedAnswer",
        maxResults: 5,
      }),
    });

    if (!response.ok) {
      console.error(`[instagramClaimVerification] Linkup error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    let content = data.answer || "";
    const sources: Array<{ name: string; url?: string; snippet?: string }> = [];

    if (data.sources && data.sources.length > 0) {
      for (const src of data.sources) {
        sources.push({
          name: src.name || extractDomain(src.url) || "Unknown",
          url: src.url,
          snippet: src.snippet,
        });
        if (src.snippet) {
          content += `\n\n[Source: ${src.name}]\n${src.snippet}`;
        }
      }
    }

    return content ? { content, sources } : null;
  } catch (error) {
    console.error("[instagramClaimVerification] Fetch error:", error);
    return null;
  }
}

async function getFreeModel() {
  // Try each free model in priority order
  for (const modelAlias of FREE_MODEL_PRIORITY) {
    try {
      const model = getLanguageModelSafe(modelAlias);
      return { model, alias: modelAlias };
    } catch (e) {
      console.warn(`[instagramClaimVerification] Model ${modelAlias} unavailable, trying next`);
    }
  }
  // Fallback to default (may have cost)
  console.warn("[instagramClaimVerification] No free models available, using default");
  return { model: getLanguageModelSafe("gemini-3-flash-preview"), alias: "gemini-3-flash-preview" };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN VERIFICATION ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify claims extracted from an Instagram post
 * Uses free OpenRouter models to minimize cost
 */
export const verifyInstagramClaims = internalAction({
  args: {
    postId: v.id("instagramPosts"),
    claims: v.array(
      v.object({
        claim: v.string(),
        confidence: v.number(),
        sourceTimestamp: v.optional(v.number()),
        category: v.optional(v.string()),
      })
    ),
  },
  returns: v.object({
    verified: v.number(),
    results: v.array(
      v.object({
        claim: v.string(),
        status: v.string(),
        explanation: v.string(),
        sources: v.array(
          v.object({
            name: v.string(),
            url: v.optional(v.string()),
            credibility: v.string(),
          })
        ),
        confidence: v.number(),
      })
    ),
    model: v.string(),
    cost: v.number(),
  }),
  handler: async (ctx, args) => {
    console.log(`[instagramClaimVerification] Verifying ${args.claims.length} claims for post ${args.postId}`);

    const { model, alias } = await getFreeModel();
    const results: ClaimVerificationResult[] = [];

    for (const claim of args.claims.slice(0, 5)) {
      // Limit to 5 claims per post
      try {
        // 1. Fetch source content via Linkup
        const sourceData = await fetchSourceContent(claim.claim, claim.category);

        if (!sourceData || !sourceData.content) {
          results.push({
            claim: claim.claim,
            status: "unverified",
            explanation: "Could not find relevant sources to verify this claim.",
            sources: [],
            confidence: 0.3,
          });
          continue;
        }

        // 2. Build prompt
        const userPrompt = `CLAIM TO VERIFY:
"${claim.claim}"

CATEGORY: ${claim.category || "general"}

SOURCE CONTENT:
${sourceData.content.slice(0, 4000)}

Available sources:
${sourceData.sources.map((s) => `- ${s.name}: ${s.url || "no URL"}`).join("\n")}`;

        // 3. Call LLM judge with free model
        const response = await generateText({
          model,
          system: FACT_CHECK_SYSTEM_PROMPT,
          prompt: userPrompt,
          maxTokens: 500,
        } as Parameters<typeof generateText>[0]);

        // 4. Parse response
        const text = response.text || "";
        let parsed: ClaimVerificationResult;

        try {
          // Extract JSON from response
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const raw = JSON.parse(jsonMatch[0]);
            parsed = {
              claim: claim.claim,
              status: raw.status || "unverified",
              explanation: raw.explanation || "No explanation provided",
              sources: (raw.sources || []).map((s: any) => ({
                name: s.name || "Unknown",
                url: s.url,
                credibility: s.credibility || "medium",
              })),
              confidence: Math.max(0, Math.min(1, raw.confidence || 0.5)),
            };
          } else {
            throw new Error("No JSON found in response");
          }
        } catch (parseError) {
          console.warn(`[instagramClaimVerification] Parse error:`, parseError);
          parsed = {
            claim: claim.claim,
            status: "unverified",
            explanation: "Could not parse verification result",
            sources: sourceData.sources.map((s) => ({
              name: s.name,
              url: s.url,
              credibility: "medium" as const,
            })),
            confidence: 0.4,
          };
        }

        results.push(parsed);

        // Rate limit between verifications
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (error) {
        console.error(`[instagramClaimVerification] Error verifying claim:`, error);
        results.push({
          claim: claim.claim,
          status: "unverified",
          explanation: `Verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          sources: [],
          confidence: 0.2,
        });
      }
    }

    // Store verification results (mutation is in separate file - no "use node")
    await ctx.runMutation(internal.domains.verification.instagramClaimVerificationMutations.storeVerificationResults, {
      postId: args.postId,
      results: results.map((r) => ({
        claim: r.claim,
        status: r.status,
        explanation: r.explanation,
        sources: r.sources,
        confidence: r.confidence,
      })),
    });

    console.log(`[instagramClaimVerification] Completed: ${results.length} claims verified using ${alias}`);

    return {
      verified: results.length,
      results: results.map((r) => ({
        claim: r.claim,
        status: r.status,
        explanation: r.explanation,
        sources: r.sources.map((s) => ({
          name: s.name,
          url: s.url,
          credibility: s.credibility,
        })),
        confidence: r.confidence,
      })),
      model: alias,
      cost: 0.0, // Free model
    };
  },
});

// NOTE: storeVerificationResults mutation moved to instagramClaimVerificationMutations.ts
// (mutations cannot be in "use node" files)

/**
 * Get today's verified claims for the daily digest
 * Returns only high-confidence verified/false claims
 */
export const getTodaysVerifiedClaims = internalAction({
  args: {},
  returns: v.array(
    v.object({
      claim: v.string(),
      status: v.string(),
      explanation: v.string(),
      source: v.optional(v.string()),
      sourceUrl: v.optional(v.string()),
      confidence: v.number(),
      postUrl: v.optional(v.string()),
    })
  ),
  handler: async (ctx) => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    // Get posts verified in the last 24 hours
    const posts = await ctx.runQuery(internal.domains.verification.instagramClaimVerification.getRecentlyVerifiedPosts, {
      since: oneDayAgo,
    });

    const digestClaims: Array<{
      claim: string;
      status: string;
      explanation: string;
      source?: string;
      sourceUrl?: string;
      confidence: number;
      postUrl?: string;
    }> = [];

    for (const post of posts) {
      if (!post.verificationResults) continue;

      for (const result of post.verificationResults) {
        // Only include high-confidence verified or false claims
        if (
          result.confidence >= 0.7 &&
          (result.status === "verified" || result.status === "false")
        ) {
          const topSource = result.sources?.[0];
          digestClaims.push({
            claim: result.claim,
            status: result.status,
            explanation: result.explanation,
            source: topSource?.name,
            sourceUrl: topSource?.url,
            confidence: result.confidence,
            postUrl: post.postUrl,
          });
        }
      }
    }

    // Sort by confidence descending, take top 5
    return digestClaims
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  },
});

export const getRecentlyVerifiedPosts = internalAction({
  args: { since: v.number() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    // Query posts verified after the given timestamp
    // This is a simplified query - in production, add proper index
    const allPosts = await ctx.runQuery(internal.domains.social.instagramIngestion.listAllPosts, {});
    return allPosts.filter(
      (p: any) => p.verifiedAt && p.verifiedAt >= args.since && p.verificationResults
    );
  },
});
