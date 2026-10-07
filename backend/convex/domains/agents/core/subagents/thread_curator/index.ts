/**
 * Thread Curator Agent
 *
 * Maintains narrative coherence by deciding how to handle new evidence:
 * 1. APPEND - Add as a delta_update post to existing thread
 * 2. REVISE - The thesis needs adjustment (create thesis_revision post)
 * 3. SPAWN - Evidence starts a fundamentally new storyline
 * 4. REJECT - Duplicate or not material
 *
 * Enforces:
 * - Every claim backed by cited evidence
 * - Diff-first writing (always show what changed)
 * - No self-citations (agent-generated content cannot be cited)
 * - Rate limiting (max N updates/day per thread unless breaking news)
 *
 * @module domains/agents/core/subagents/thread_curator
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../../../../_generated/server";
import { internal } from "../../../../../_generated/api";
import type { Doc } from "../../../../../_generated/dataModel";

// Note: getThreadState query is in queries.ts (queries cannot be in "use node" files)
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type CurationAction = "append" | "revise" | "spawn" | "reject";

export interface CurationDecision {
  action: CurationAction;
  reason: string;
  postContent?: string;
  changeSummary?: string[];
  citations?: Array<{
    artifactId: string;
    quote: string;
  }>;
  newThreadProposal?: {
    name: string;
    thesis: string;
    entityKeys: string[];
    topicTags: string[];
  };
  confidence: number;
}

export interface ThreadContext {
  thread: Doc<"narrativeThreads">;
  recentPosts: Array<{
    postType: string;
    title?: string;
    content: string;
    createdAt: number;
  }>;
  thesis: string;
  counterThesis?: string;
  openDisputes: number;
  todayPostCount: number;
}

export interface NewEvidence {
  content: string;
  sourceUrl?: string;
  sourceTitle?: string;
  artifactId?: string;
  entityKeys: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export interface ThreadCuratorConfig {
  model?: string;
  maxDailyUpdatesPerThread?: number;
  minConfidenceForRevision?: number;
  enableRateLimiting?: boolean;
}

const DEFAULT_CONFIG: Required<ThreadCuratorConfig> = {
  model: "gpt-5.4",
  maxDailyUpdatesPerThread: 5,
  minConfidenceForRevision: 0.8,
  enableRateLimiting: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// CURATION DECISION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the curation prompt for LLM
 */
function buildCurationPrompt(
  context: ThreadContext,
  evidence: NewEvidence,
  config: Required<ThreadCuratorConfig>
): string {
  const recentPostsSummary = context.recentPosts
    .slice(0, 5)
    .map(p => `- [${p.postType}] ${p.title || p.content.slice(0, 100)}`)
    .join("\n");

  return `You are the Thread Curator Agent. Your job is to maintain narrative coherence.

## CURRENT THREAD STATE
**Name:** ${context.thread.name}
**Thesis:** ${context.thesis}
${context.counterThesis ? `**Counter-thesis:** ${context.counterThesis}` : ""}
**Phase:** ${context.thread.currentPhase}
**Recent activity:** ${context.recentPosts.length} posts, ${context.openDisputes} open disputes
**Today's posts:** ${context.todayPostCount}/${config.maxDailyUpdatesPerThread} (rate limit)

## RECENT POSTS
${recentPostsSummary || "No recent posts"}

## NEW EVIDENCE
**Content:** ${evidence.content}
${evidence.sourceTitle ? `**Source:** ${evidence.sourceTitle}` : ""}
${evidence.sourceUrl ? `**URL:** ${evidence.sourceUrl}` : ""}
**Related entities:** ${evidence.entityKeys.join(", ")}

## YOUR DECISION
Decide how to handle this new evidence:

1. **APPEND** - Add as a delta_update post if this is routine news confirming the thesis
2. **REVISE** - If this evidence fundamentally changes the thesis, create a thesis_revision post
3. **SPAWN** - If this starts a completely new storyline not related to current thread
4. **REJECT** - If this is a duplicate, not material, or not relevant

Rules:
- Every claim must be backed by cited evidence
- Use diff-first writing: always show what changed
- No more than ${config.maxDailyUpdatesPerThread} updates/day unless breaking news
- Thesis revisions require confidence >= ${config.minConfidenceForRevision}

Return JSON:
{
  "action": "append" | "revise" | "spawn" | "reject",
  "reason": "Brief explanation of decision",
  "postContent": "Markdown content for the post (for append/revise)",
  "changeSummary": ["bullet1", "bullet2"],
  "citations": [{"artifactId": "...", "quote": "relevant quote"}],
  "newThreadProposal": {
    "name": "...",
    "thesis": "...",
    "entityKeys": ["..."],
    "topicTags": ["..."]
  },
  "confidence": 0.0-1.0
}`;
}

/**
 * Make curation decision using LLM
 */
export const decideCuration = internalAction({
  args: {
    threadId: v.id("narrativeThreads"),
    evidence: v.object({
      content: v.string(),
      sourceUrl: v.optional(v.string()),
      sourceTitle: v.optional(v.string()),
      artifactId: v.optional(v.string()),
      entityKeys: v.array(v.string()),
    }),
    config: v.optional(v.object({
      model: v.optional(v.string()),
      maxDailyUpdatesPerThread: v.optional(v.number()),
      minConfidenceForRevision: v.optional(v.number()),
      enableRateLimiting: v.optional(v.boolean()),
    })),
  },
  returns: v.object({
    action: v.union(
      v.literal("append"),
      v.literal("revise"),
      v.literal("spawn"),
      v.literal("reject")
    ),
    reason: v.string(),
    postContent: v.optional(v.string()),
    changeSummary: v.optional(v.array(v.string())),
    citations: v.optional(v.array(v.object({
      artifactId: v.string(),
      quote: v.string(),
    }))),
    newThreadProposal: v.optional(v.object({
      name: v.string(),
      thesis: v.string(),
      entityKeys: v.array(v.string()),
      topicTags: v.array(v.string()),
    })),
    confidence: v.number(),
  }),
  handler: async (ctx, args): Promise<CurationDecision> => {
    const config = { ...DEFAULT_CONFIG, ...args.config };

    // Get thread context
    const context = await ctx.runQuery(
      internal.domains.agents.core.subagents.thread_curator.queries.getThreadState,
      { threadId: args.threadId }
    );

    if (!context) {
      return {
        action: "reject",
        reason: "Thread not found",
        confidence: 1.0,
      };
    }

    // Rate limiting check
    if (config.enableRateLimiting &&
        context.todayPostCount >= config.maxDailyUpdatesPerThread) {
      // Check if this is breaking news (high urgency)
      const isBreakingNews = args.evidence.content.toLowerCase().includes("breaking") ||
                            args.evidence.entityKeys.some(k => k.includes(":urgent"));

      if (!isBreakingNews) {
        return {
          action: "reject",
          reason: `Rate limit reached (${context.todayPostCount}/${config.maxDailyUpdatesPerThread} today)`,
          confidence: 0.95,
        };
      }
    }

    // First, run semantic dedup check
    const dedupResult = await ctx.runAction(
      internal.domains.research.semanticDeduplicator.classifyCandidate,
      {
        threadId: args.threadId,
        content: args.evidence.content,
        title: args.evidence.sourceTitle,
        postType: "delta_update",
      }
    );

    if (dedupResult.type === "duplicate") {
      return {
        action: "reject",
        reason: `Duplicate of existing content (similarity: ${dedupResult.similarity?.toFixed(2)})`,
        confidence: dedupResult.confidence,
      };
    }

    // Build prompt and get LLM decision
    const prompt = buildCurationPrompt(context, args.evidence, config);

    try {
      const result = await generateText({
        model: openai.chat(config.model),
        prompt,
        temperature: 0.2,
      });

      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          action: "append",
          reason: "Failed to parse LLM response, defaulting to append",
          postContent: args.evidence.content,
          changeSummary: ["New evidence added"],
          confidence: 0.5,
        };
      }

      const decision = JSON.parse(jsonMatch[0]);

      // Enforce minimum confidence for revisions
      if (decision.action === "revise" &&
          decision.confidence < config.minConfidenceForRevision) {
        decision.action = "append";
        decision.reason = `Confidence (${decision.confidence}) below threshold for revision, appending instead`;
      }

      return decision;
    } catch (error) {
      console.error("[ThreadCurator] LLM error:", error);
      return {
        action: "append",
        reason: "LLM error, defaulting to append",
        postContent: args.evidence.content,
        confidence: 0.5,
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTION EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute the curation decision
 */
export const executeCuration = internalAction({
  args: {
    threadId: v.id("narrativeThreads"),
    decision: v.object({
      action: v.union(
        v.literal("append"),
        v.literal("revise"),
        v.literal("spawn"),
        v.literal("reject")
      ),
      reason: v.string(),
      postContent: v.optional(v.string()),
      changeSummary: v.optional(v.array(v.string())),
      citations: v.optional(v.array(v.object({
        artifactId: v.string(),
        quote: v.string(),
      }))),
      newThreadProposal: v.optional(v.object({
        name: v.string(),
        thesis: v.string(),
        entityKeys: v.array(v.string()),
        topicTags: v.array(v.string()),
      })),
      confidence: v.number(),
    }),
    agentName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const agentName = args.agentName || "ThreadCurator";

    switch (args.decision.action) {
      case "reject":
        return {
          success: true,
          action: "reject",
          reason: args.decision.reason,
        };

      case "append":
        if (!args.decision.postContent) {
          return { success: false, error: "No content for append" };
        }

        const appendPostId = await ctx.runMutation(
          internal.domains.narrative.mutations.posts.createPostInternal,
          {
            threadId: args.threadId,
            postType: "delta_update",
            content: args.decision.postContent,
            changeSummary: args.decision.changeSummary,
            citations: [], // Would need to convert to proper format
            agentName,
            confidence: args.decision.confidence,
          }
        );

        // Run contradiction detection
        await ctx.runAction(
          internal.domains.verification.contradictionDetector.detectContradictions,
          {
            threadId: args.threadId,
            postId: appendPostId,
            content: args.decision.postContent,
          }
        );

        return {
          success: true,
          action: "append",
          postId: appendPostId,
        };

      case "revise":
        if (!args.decision.postContent) {
          return { success: false, error: "No content for revision" };
        }

        const thread = await ctx.runQuery(
          internal.domains.agents.core.subagents.thread_curator.queries.getThreadState,
          { threadId: args.threadId }
        );

        if (!thread) {
          return { success: false, error: "Thread not found" };
        }

        const revisionPostId = await ctx.runMutation(
          internal.domains.narrative.mutations.posts.createThesisRevision,
          {
            threadId: args.threadId,
            newThesis: args.decision.postContent,
            previousThesis: thread.thesis,
            changeSummary: args.decision.changeSummary || [],
            citations: [],
            agentName,
            confidence: args.decision.confidence,
          }
        );

        return {
          success: true,
          action: "revise",
          postId: revisionPostId,
        };

      case "spawn":
        if (!args.decision.newThreadProposal) {
          return { success: false, error: "No thread proposal for spawn" };
        }

        const proposal = args.decision.newThreadProposal;

        // Get a user ID from the original thread
        const originalThread = await ctx.runQuery(
          internal.domains.agents.core.subagents.thread_curator.queries.getThreadState,
          { threadId: args.threadId }
        );

        const newThreadId = await ctx.runMutation(
          internal.domains.narrative.mutations.threads.createThreadInternal,
          {
            name: proposal.name,
            thesis: proposal.thesis,
            entityKeys: proposal.entityKeys,
            topicTags: proposal.topicTags,
            userId: originalThread?.thread.userId || args.threadId, // Fallback
          }
        );

        return {
          success: true,
          action: "spawn",
          newThreadId,
        };

      default:
        return { success: false, error: "Unknown action" };
    }
  },
});

/**
 * Full curation pipeline: decide + execute
 */
export const curateEvidence = internalAction({
  args: {
    threadId: v.id("narrativeThreads"),
    evidence: v.object({
      content: v.string(),
      sourceUrl: v.optional(v.string()),
      sourceTitle: v.optional(v.string()),
      artifactId: v.optional(v.string()),
      entityKeys: v.array(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    // Decide
    const decision = await ctx.runAction(
      internal.domains.agents.core.subagents.thread_curator.decideCuration,
      {
        threadId: args.threadId,
        evidence: args.evidence,
      }
    );

    // Execute
    const result = await ctx.runAction(
      internal.domains.agents.core.subagents.thread_curator.executeCuration,
      {
        threadId: args.threadId,
        decision,
      }
    );

    return {
      decision,
      result,
    };
  },
});
