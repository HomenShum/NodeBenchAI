/**
 * Comment Harvester Mutations
 *
 * Separated from main index.ts because mutations cannot run in Node.js environment.
 * These are called via ctx.runMutation from actions in index.ts.
 */

import { v } from "convex/values";
import { internalMutation } from "../../../../../_generated/server";

/**
 * Store sentiment signals as narrative posts
 */
export const storeSentimentEvidence = internalMutation({
  args: {
    threadId: v.id("narrativeThreads"),
    harvestResult: v.object({
      sentimentSignals: v.array(v.object({
        quote: v.string(),
        stance: v.string(),
        source: v.string(),
        sourceUrl: v.optional(v.string()),
        platform: v.string(),
        authorHandle: v.optional(v.string()),
        authorCredibility: v.string(),
        timestamp: v.number(),
        upvotes: v.optional(v.number()),
        replies: v.optional(v.number()),
      })),
      consensusTopics: v.array(v.string()),
      openQuestions: v.array(v.string()),
      dissensusPoints: v.array(v.string()),
      summary: v.string(),
    }),
    sourceUrl: v.string(),
    platform: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Create a narrative post with the harvested sentiment
    const content = `## Sentiment Analysis: ${args.platform}

**Source:** ${args.sourceUrl}
**Harvested:** ${new Date(now).toISOString()}

### Summary
${args.harvestResult.summary}

### Consensus Points
${args.harvestResult.consensusTopics.map(t => `- ${t}`).join("\n") || "None identified"}

### Open Questions
${args.harvestResult.openQuestions.map(q => `- ${q}`).join("\n") || "None identified"}

### Dissensus Points
${args.harvestResult.dissensusPoints.map(d => `- ${d}`).join("\n") || "None identified"}

### Notable Quotes
${args.harvestResult.sentimentSignals.slice(0, 5).map(s =>
      `> "${s.quote}"\n> — ${s.authorCredibility} (${s.stance})`
    ).join("\n\n")}

---
*Note: These are public sentiment signals, not factual claims.*`;

    // FNV-1a hash for post ID
    function fnv1a32Hex(str: string): string {
      let hash = 2166136261;
      for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    }

    const postId = `np_${fnv1a32Hex(content + now)}`;

    await ctx.db.insert("narrativePosts", {
      postId,
      threadId: args.threadId,
      parentPostId: undefined,
      postType: "evidence_addition",
      title: `Sentiment: ${args.platform} Discussion`,
      content,
      changeSummary: [
        `Harvested ${args.harvestResult.sentimentSignals.length} sentiment signals`,
        `Found ${args.harvestResult.consensusTopics.length} consensus topics`,
        `Identified ${args.harvestResult.openQuestions.length} open questions`,
      ],
      citations: [],
      supersedes: undefined,
      supersededBy: undefined,
      authorType: "agent",
      authorId: "CommentHarvester",
      authorConfidence: 0.8,
      isVerified: false,
      hasContradictions: false,
      requiresAdjudication: false,
      createdAt: now,
      updatedAt: now,
    });

    return {
      success: true,
      signalsStored: args.harvestResult.sentimentSignals.length,
    };
  },
});
