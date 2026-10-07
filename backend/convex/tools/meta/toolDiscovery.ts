/**
 * Tool Discovery — Bridge module for dynamic prompt enhancer
 *
 * Provides `discoverRelevantTools` internalAction that wraps the existing
 * toolDiscoveryV2 search logic into the shape expected by
 * dynamicPromptEnhancer.ts (line 98-115).
 *
 * Expected call shape:
 *   args: { userMessage, category?, maxTools?, conversationHistory? }
 *   returns: { relevantTools: [{name, description, category, reasonForSelection, relevanceScore}],
 *              tokensUsed: { totalSavings } }
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { toolSummaries } from "./toolRegistry";

/**
 * Lightweight keyword match scoring for tool discovery.
 * Runs entirely in-process — no LLM call needed.
 */
function scoreToolRelevance(
  toolName: string,
  toolDescription: string,
  toolCategory: string,
  query: string,
  targetCategory?: string,
): number {
  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter((t) => t.length > 2);

  let score = 0;

  // Category match
  if (targetCategory && toolCategory === targetCategory) score += 0.3;

  // Name contains query terms
  const nameLower = toolName.toLowerCase();
  for (const term of terms) {
    if (nameLower.includes(term)) score += 0.25;
  }

  // Description contains query terms
  const descLower = toolDescription.toLowerCase();
  for (const term of terms) {
    if (descLower.includes(term)) score += 0.1;
  }

  // Category name contains query terms
  const catLower = toolCategory.toLowerCase();
  for (const term of terms) {
    if (catLower.includes(term)) score += 0.15;
  }

  return Math.min(score, 1.0);
}

/**
 * Discover tools relevant to a user message.
 * Called by dynamicPromptEnhancer.ts for progressive disclosure.
 */
export const discoverRelevantTools = internalAction({
  args: {
    userMessage: v.string(),
    category: v.optional(v.string()),
    maxTools: v.optional(v.number()),
    conversationHistory: v.optional(
      v.array(
        v.object({
          role: v.string(),
          content: v.string(),
        }),
      ),
    ),
  },
  returns: v.object({
    relevantTools: v.array(
      v.object({
        name: v.string(),
        description: v.string(),
        category: v.string(),
        reasonForSelection: v.string(),
        relevanceScore: v.number(),
      }),
    ),
    tokensUsed: v.object({
      totalSavings: v.string(),
    }),
  }),
  handler: async (_ctx, args) => {
    const max = args.maxTools ?? 5;
    const allTools = Object.entries(toolSummaries);

    // Build search context from message + conversation
    let searchQuery = args.userMessage;
    if (args.conversationHistory?.length) {
      const recentContext = args.conversationHistory
        .slice(-2)
        .map((m) => m.content)
        .join(" ");
      searchQuery = `${searchQuery} ${recentContext}`;
    }

    // Score each tool
    const scored = allTools
      .map(([name, info]) => ({
        name,
        description: (info as any).description || "",
        category: (info as any).category || "general",
        score: scoreToolRelevance(
          name,
          (info as any).description || "",
          (info as any).category || "general",
          searchQuery,
          args.category,
        ),
      }))
      .filter((t) => t.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, max);

    // Calculate token savings vs sending all tools
    const allToolCount = allTools.length;
    const selectedCount = scored.length;
    const estimatedSaving = Math.round(
      ((allToolCount - selectedCount) / allToolCount) * 100,
    );

    return {
      relevantTools: scored.map((t) => ({
        name: t.name,
        description: t.description,
        category: t.category,
        reasonForSelection: `Matched query terms (score: ${(t.score * 100).toFixed(0)}%)`,
        relevanceScore: t.score,
      })),
      tokensUsed: {
        totalSavings: `~${estimatedSaving}% fewer tokens (${selectedCount}/${allToolCount} tools)`,
      },
    };
  },
});
