"use node";

/**
 * Founder Post Generator - Auto-generate personal LinkedIn posts in founder voice
 *
 * Uses daily intelligence (digest signals, funding, fact-checks) already collected
 * by existing systems. Generates 3 posts/week in the founder's casual writing style.
 *
 * Weekly cadence:
 *   Monday    → funding_take    (VCs, founders)
 *   Wednesday → build_log       (builders, CTOs)
 *   Friday    → industry_signal (general audience)
 *
 * Posts route through existing content queue → judge → schedule → post pipeline.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText } from "ai";
import { getLanguageModelSafe } from "../domains/agents/mcp_tools/models/modelResolver";
import type { AgentDigestOutput } from "../domains/agents/digestAgent";

// ═══════════════════════════════════════════════════════════════════════════
// FOUNDER VOICE SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════

const FOUNDER_VOICE_SYSTEM = `You are writing a LinkedIn post for a technical founder's personal profile. Follow these rules exactly:

- Lowercase everything. No title case, no all-caps.
- Open conversationally: "hey so", "hey did you know", "so we just", "apparently"
- No arrow bullets (→), no numbered lists with bold headers, no formatted frameworks
- Write like you're texting one smart friend, not presenting to an audience
- Run-on sentences are fine. Use periods between thoughts, not semicolons.
- First person casual: "we built", "i think", "we call it" — never "One should consider"
- Include specific numbers from the data provided (dollar amounts, percentages, counts)
- End with a casual question, not a polished CTA. Never end with "Thoughts?" or "Agree?"
- No hashtags, no emoji
- 800-1200 characters. Not a word more.
- NEVER use: "leverage", "paradigm", "synergy", "at scale", "game-changer", "disrupt"
- NEVER open with a dramatic one-liner followed by a line break (the "LinkedIn hook" pattern)
- Do NOT start with "Most teams..." or "Here's what..." or any listicle opener`;

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY-SPECIFIC PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

const CATEGORY_PROMPTS: Record<string, string> = {
  funding_take: `Write a short personal take on this funding round. What caught your eye about the deal, the sector, or what it signals about where money is moving. Be specific about the numbers. Your audience is VCs and startup founders — they know the space, don't explain basics.`,

  build_log: `Write a short post about this technology/tool/repo. Either relate it to something you've built recently, or share what makes it interesting from a builder's perspective. Your audience is engineers and CTOs — be technical but conversational. If there are hard numbers (stars, benchmarks, adoption), use them.`,

  industry_signal: `Write a short post connecting this signal to a broader trend you're seeing. Include a prediction if the data supports one — but flag uncertainty honestly ("not sure yet", "could go either way"). Your audience is general tech/startup folks. Make it feel like an observation you'd share over coffee, not a forecast report.`,
};

// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL SELECTION
// ═══════════════════════════════════════════════════════════════════════════

function selectSignalForCategory(
  digest: AgentDigestOutput,
  category: string,
): string {
  if (category === "funding_take") {
    const rounds = digest.fundingRounds ?? [];
    if (rounds.length > 0) {
      const top = rounds[0];
      return [
        `Company: ${top.companyName}`,
        `Round: ${top.roundType}`,
        `Amount: ${top.amountRaw}${top.amountUsd ? ` ($${(top.amountUsd / 1e6).toFixed(0)}M)` : ""}`,
        top.leadInvestors.length > 0
          ? `Lead investors: ${top.leadInvestors.join(", ")}`
          : null,
        top.sector ? `Sector: ${top.sector}` : null,
        top.productDescription
          ? `Product: ${top.productDescription}`
          : null,
        top.founderBackground
          ? `Founder: ${top.founderBackground}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
    }
    // Fallback to lead story if no funding data
    if (digest.leadStory) {
      return `Story: ${digest.leadStory.title}\nWhy it matters: ${digest.leadStory.whyItMatters}`;
    }
  }

  if (category === "build_log") {
    // Look for technology/product entities in spotlight
    const techEntities = (digest.entitySpotlight ?? []).filter(
      (e) => e.type === "technology" || e.type === "product",
    );
    if (techEntities.length > 0) {
      const e = techEntities[0];
      return [
        `Technology: ${e.name}`,
        `Key insight: ${e.keyInsight}`,
        e.keyFacts ? `Facts: ${e.keyFacts.join("; ")}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    }
    // Fallback to strongest signal with hard numbers
    const sigWithNumbers = digest.signals.find((s) => s.hardNumbers);
    if (sigWithNumbers) {
      return [
        `Signal: ${sigWithNumbers.title}`,
        `Summary: ${sigWithNumbers.summary}`,
        sigWithNumbers.hardNumbers
          ? `Numbers: ${sigWithNumbers.hardNumbers}`
          : null,
        sigWithNumbers.reflection
          ? `So what: ${sigWithNumbers.reflection.soWhat}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
    }
  }

  if (category === "industry_signal") {
    // Lead story + fact-check finding
    const parts: string[] = [];
    if (digest.leadStory) {
      parts.push(`Lead story: ${digest.leadStory.title}`);
      parts.push(`Why it matters: ${digest.leadStory.whyItMatters}`);
      if (digest.leadStory.reflection) {
        parts.push(`What: ${digest.leadStory.reflection.what}`);
        parts.push(`So what: ${digest.leadStory.reflection.soWhat}`);
        parts.push(`Now what: ${digest.leadStory.reflection.nowWhat}`);
      }
    }
    const verifiedClaim = (digest.factCheckFindings ?? []).find(
      (f) => f.status === "verified" && f.confidence > 0.7,
    );
    if (verifiedClaim) {
      parts.push(`\nVerified claim: ${verifiedClaim.claim}`);
      parts.push(`Explanation: ${verifiedClaim.explanation}`);
    }
    if (parts.length > 0) return parts.join("\n");
  }

  // Ultimate fallback: narrative thesis + first signal
  const fallback = [`Thesis: ${digest.narrativeThesis}`];
  if (digest.signals.length > 0) {
    fallback.push(`Top signal: ${digest.signals[0].title}`);
    fallback.push(`Summary: ${digest.signals[0].summary}`);
  }
  return fallback.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a single founder-voice personal post from today's intelligence.
 */
export const generateFounderPost = internalAction({
  args: {
    postCategory: v.union(
      v.literal("funding_take"),
      v.literal("build_log"),
      v.literal("industry_signal"),
    ),
    dryRun: v.optional(v.boolean()),
    hoursBack: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const category = args.postCategory;
    const hoursBack = args.hoursBack ?? 24;

    console.log(`[founderPost] Generating ${category} post (dryRun=${dryRun}, hoursBack=${hoursBack})`);

    // 1. Pull today's digest
    const digestResult = await ctx.runAction(
      internal.domains.agents.digestAgent.generateDigestWithFactChecks,
      { persona: "GENERAL", model: "qwen3-coder-free", hoursBack },
    );

    if (!digestResult.success || !digestResult.digest) {
      console.log(`[founderPost] No digest available: ${digestResult.error}`);
      return {
        success: false,
        error: digestResult.error || "No digest available",
        content: null,
      };
    }

    const digest = digestResult.digest as AgentDigestOutput;

    // 2. Select strongest signal for this category
    const signalData = selectSignalForCategory(digest, category);

    // 3. Generate post in founder voice
    const modelId = "qwen3-coder-free";
    const model = getLanguageModelSafe(modelId);

    const userPrompt = `${CATEGORY_PROMPTS[category]}\n\nDATA:\n${signalData}`;

    const { text } = await generateText({
      model,
      system: FOUNDER_VOICE_SYSTEM,
      prompt: userPrompt,
      maxOutputTokens: 500,
      temperature: 0.8,
    });

    const content = text.trim();
    console.log(`[founderPost] Generated ${content.length} chars for ${category}`);

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        content,
        category,
        signalData,
        charCount: content.length,
      };
    }

    // 4. Enqueue to content pipeline
    const result = await ctx.runMutation(
      internal.domains.social.linkedinContentQueue.enqueueContent,
      {
        content,
        postType: category,
        persona: "FOUNDER",
        target: "personal" as const,
        source: "fresh" as const,
        metadata: {
          generatedBy: "founderPostGenerator",
          category,
          digestDate: digest.dateString,
        },
      },
    );

    if ("queued" in result && result.queued) {
      console.log(`[founderPost] Enqueued ${category} post: ${result.queueId}`);
      return {
        success: true,
        content,
        category,
        queueId: result.queueId,
        charCount: content.length,
      };
    }

    console.log(`[founderPost] Dedup blocked: ${"reason" in result ? result.reason : "unknown"}`);
    return {
      success: false,
      error: "reason" in result ? result.reason : "duplicate_content",
      content,
    };
  },
});

/**
 * Generate all 3 personal posts for the upcoming week.
 * Runs Sunday evening, enqueues Mon/Wed/Fri posts.
 * Judge + scheduler handle them from there.
 */
export const weeklyFounderBatch = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[founderPost] Starting weekly batch generation");

    const categories = ["funding_take", "build_log", "industry_signal"] as const;
    const results: Array<{ category: string; success: boolean; error?: string }> = [];

    for (const category of categories) {
      try {
        const result = await ctx.runAction(
          internal.workflows.founderPostGenerator.generateFounderPost,
          { postCategory: category, dryRun: false },
        );

        results.push({
          category,
          success: result.success,
          error: result.error,
        });

        // Small delay between generations to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error(`[founderPost] Failed to generate ${category}: ${errorMsg}`);
        results.push({ category, success: false, error: errorMsg });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    console.log(
      `[founderPost] Weekly batch complete: ${successCount}/${categories.length} generated`,
    );

    return { results, successCount, total: categories.length };
  },
});

/**
 * Regenerate personal posts that failed pre-post verification.
 * Picks up items with status "needs_rewrite", generates fresh replacement,
 * marks old one as rejected.
 */
export const regenerateFailedPersonalPosts = internalAction({
  args: {},
  handler: async (ctx) => {
    const failedItems = await ctx.runQuery(
      internal.domains.social.linkedinContentQueue.getNeedsRewriteItems,
      { persona: "FOUNDER", limit: 5 },
    );

    if (failedItems.length === 0) {
      console.log("[founderPost] No FOUNDER posts need rewriting");
      return { regenerated: 0, total: 0 };
    }

    console.log(`[founderPost] Found ${failedItems.length} posts to regenerate`);
    let regenerated = 0;

    for (const item of failedItems) {
      try {
        // Map postType back to category for generation
        const category = item.postType as "funding_take" | "build_log" | "industry_signal";
        const validCategories = ["funding_take", "build_log", "industry_signal"];

        if (!validCategories.includes(category)) {
          console.log(`[founderPost] Skipping non-personal postType: ${item.postType}`);
          // Mark as rejected since we can't regenerate it
          await ctx.runMutation(
            internal.domains.social.linkedinContentQueue.updateQueueStatus,
            { queueId: item._id, status: "rejected" },
          );
          continue;
        }

        // Mark old item as rejected
        await ctx.runMutation(
          internal.domains.social.linkedinContentQueue.updateQueueStatus,
          { queueId: item._id, status: "rejected" },
        );

        // Generate fresh replacement
        const result = await ctx.runAction(
          internal.workflows.founderPostGenerator.generateFounderPost,
          { postCategory: category, dryRun: false },
        );

        if (result.success) {
          regenerated++;
          console.log(`[founderPost] Regenerated ${category}: ${result.queueId}`);
        } else {
          console.log(`[founderPost] Regeneration failed for ${category}: ${result.error}`);
        }

        // Rate limit between generations
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error(`[founderPost] Regeneration error for ${item._id}: ${errorMsg}`);
      }
    }

    console.log(`[founderPost] Regeneration complete: ${regenerated}/${failedItems.length}`);
    return { regenerated, total: failedItems.length };
  },
});
