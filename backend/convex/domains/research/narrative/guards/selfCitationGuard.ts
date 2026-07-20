/**
 * Self-Citation Guard
 *
 * Prevents feedback loops where agents cite their own generated content.
 * Validates that citations point to genuine external sources, not
 * agent-generated artifacts.
 *
 * Rules:
 * 1. Agent cannot cite artifacts it created
 * 2. Agent cannot cite posts it authored
 * 3. Citations must be to external sources (not internal content)
 *
 * @module domains/narrative/guards/selfCitationGuard
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../../../_generated/server";
import { Id, Doc } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean;
  invalidCitations: InvalidCitation[];
  error?: string;
}

export interface InvalidCitation {
  citationKey: string;
  artifactId: string;
  reason: "self_citation" | "internal_content" | "missing_source";
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if an artifact was created by the given author
 */
export const checkArtifactAuthor = internalQuery({
  args: {
    artifactId: v.id("sourceArtifacts"),
    authorId: v.string(),
  },
  handler: async (ctx, args) => {
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact) {
      return { exists: false, isOwnContent: false };
    }

    // Check if artifact was created by an agent with this ID
    const createdBy = (artifact as any).createdBy || (artifact as any).discoveredBy;
    const isAgentGenerated = (artifact as any).sourceType === "agent_generated" ||
                             (artifact as any).sourceType === "synthetic";

    return {
      exists: true,
      isOwnContent: createdBy === args.authorId && isAgentGenerated,
      sourceType: (artifact as any).sourceType,
      createdBy,
    };
  },
});

/**
 * Check if a post was authored by the given author
 */
export const checkPostAuthor = internalQuery({
  args: {
    postId: v.id("narrativePosts"),
    authorId: v.string(),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) {
      return { exists: false, isOwnContent: false };
    }

    return {
      exists: true,
      isOwnContent: post.authorId === args.authorId,
      authorType: post.authorType,
    };
  },
});

/**
 * Validate all citations in a post content
 */
export const validateCitations = internalQuery({
  args: {
    citations: v.array(v.object({
      citationKey: v.string(),
      artifactId: v.id("sourceArtifacts"),
      chunkId: v.optional(v.id("artifactChunks")),
      quote: v.optional(v.string()),
      pageIndex: v.optional(v.number()),
      publishedAt: v.optional(v.number()),
    })),
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
  },
  handler: async (ctx, args): Promise<ValidationResult> => {
    const invalidCitations: InvalidCitation[] = [];

    for (const citation of args.citations) {
      const artifact = await ctx.db.get(citation.artifactId);

      if (!artifact) {
        invalidCitations.push({
          citationKey: citation.citationKey,
          artifactId: citation.artifactId,
          reason: "missing_source",
        });
        continue;
      }

      // Check for self-citation (agent citing its own generated content)
      if (args.authorType === "agent") {
        const sourceType = (artifact as any).sourceType as string | undefined;
        const extractedKind = (artifact as any).extractedData?.kind as string | undefined;
        const createdByAgent = (artifact as any).extractedData?.createdByAgent as string | undefined;

        // Reject citations to derived/internal content in agent outputs.
        // In this codebase, internal/derived artifacts are represented as `sourceType: "extracted_text"`.
        if (sourceType === "extracted_text") {
          invalidCitations.push({
            citationKey: citation.citationKey,
            artifactId: citation.artifactId,
            reason: "internal_content",
          });
          continue;
        }

        // Best-effort self-citation guard: if an artifact explicitly records its creating agent.
        if (createdByAgent && createdByAgent === args.authorId && extractedKind !== "news_snippet") {
          invalidCitations.push({
            citationKey: citation.citationKey,
            artifactId: citation.artifactId,
            reason: "self_citation",
          });
          continue;
        }

        // Disallow citations to artifacts that have no external URL unless they're explicit API responses.
        // This prevents agents from citing opaque internal blobs as sources.
        if (!artifact.sourceUrl && sourceType !== "api_response") {
          invalidCitations.push({
            citationKey: citation.citationKey,
            artifactId: citation.artifactId,
            reason: "internal_content",
          });
          continue;
        }
      }
    }

    return {
      valid: invalidCitations.length === 0,
      invalidCitations,
      error: invalidCitations.length > 0
        ? `Found ${invalidCitations.length} invalid citation(s): ${invalidCitations.map(c => c.reason).join(", ")}`
        : undefined,
    };
  },
});

/**
 * Get valid source types for citations
 */
export const getValidSourceTypes = internalQuery({
  args: {},
  handler: async () => {
    return {
      allowed: [
        "web_article",
        "news",
        "research_paper",
        "official_announcement",
        "regulatory_filing",
        "press_release",
        "social_media", // Allowed but lower credibility
        "blog",
        "external",
      ],
      disallowed: [
        "agent_generated",
        "synthetic",
        "internal",
        "narrative_post",
        "narrative_event",
      ],
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// GUARD ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pre-creation guard: Validate citations before creating a post
 * Returns filtered citations (invalid ones removed) or throws if critical
 */
export const guardCitations = internalQuery({
  args: {
    citations: v.array(v.object({
      citationKey: v.string(),
      artifactId: v.id("sourceArtifacts"),
      chunkId: v.optional(v.id("artifactChunks")),
      quote: v.optional(v.string()),
      pageIndex: v.optional(v.number()),
      publishedAt: v.optional(v.number()),
    })),
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
    strict: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const validation = await validateCitations.handler(ctx, {
      citations: args.citations,
      authorId: args.authorId,
      authorType: args.authorType,
    });

    if (validation.valid) {
      return {
        allowed: true,
        citations: args.citations,
        warnings: [],
      };
    }

    // In strict mode, reject all citations if any are invalid
    if (args.strict) {
      return {
        allowed: false,
        citations: [],
        warnings: validation.invalidCitations.map(c =>
          `Citation ${c.citationKey} rejected: ${c.reason}`
        ),
        error: validation.error,
      };
    }

    // In non-strict mode, filter out invalid citations
    const invalidIds = new Set(
      validation.invalidCitations.map(c => c.artifactId)
    );

    const filteredCitations = args.citations.filter(
      c => !invalidIds.has(c.artifactId)
    );

    return {
      allowed: true,
      citations: filteredCitations,
      warnings: validation.invalidCitations.map(c =>
        `Citation ${c.citationKey} removed: ${c.reason}`
      ),
      removedCount: validation.invalidCitations.length,
    };
  },
});

/**
 * Log self-citation attempts for monitoring
 */
export const logSelfCitationAttempt = internalMutation({
  args: {
    authorId: v.string(),
    authorType: v.union(v.literal("agent"), v.literal("human")),
    artifactId: v.string(),
    reason: v.string(),
    threadId: v.optional(v.id("narrativeThreads")),
  },
  handler: async (ctx, args) => {
    // Log to a monitoring table (if exists) or just console
    console.warn(
      `[SelfCitationGuard] Blocked self-citation attempt:`,
      {
        authorId: args.authorId,
        authorType: args.authorType,
        artifactId: args.artifactId,
        reason: args.reason,
        threadId: args.threadId,
        timestamp: new Date().toISOString(),
      }
    );

    // Could also insert into an audit log table
    // await ctx.db.insert("auditLogs", { ... });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if content looks like it might contain self-references
 * (heuristic pre-check before citation validation)
 */
export const preCheckContent = internalQuery({
  args: {
    content: v.string(),
    authorId: v.string(),
  },
  handler: async (ctx, args) => {
    // Look for patterns that suggest self-reference
    const warnings: string[] = [];

    // Check for phrases that suggest synthetic content
    const selfReferencePatterns = [
      /as I mentioned/i,
      /my previous analysis/i,
      /I previously noted/i,
      /in my earlier/i,
      /based on my research/i,
    ];

    for (const pattern of selfReferencePatterns) {
      if (pattern.test(args.content)) {
        warnings.push(`Content contains potential self-reference: ${pattern.source}`);
      }
    }

    // Check for citation patterns that might be internal
    const internalCitationPatterns = [
      /\[agent:/i,
      /\[internal:/i,
      /\[generated:/i,
    ];

    for (const pattern of internalCitationPatterns) {
      if (pattern.test(args.content)) {
        warnings.push(`Content contains potential internal citation: ${pattern.source}`);
      }
    }

    return {
      hasPotentialIssues: warnings.length > 0,
      warnings,
    };
  },
});
