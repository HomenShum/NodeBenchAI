"use node";

/**
 * Policy-Enforced Operations
 *
 * Production-grade wrappers that enforce Phase 8 guards before executing
 * narrative mutations. All guard checks run before data is written.
 *
 * Guards enforced:
 * 1. Content Rights - GDPR/ToS compliance
 * 2. Trust Scoring - Author rate limits
 * 3. Injection Containment - Sanitization
 * 4. Claim Classification - Editorial integrity
 * 5. Quarantine - Quality gates
 *
 * @module domains/narrative/mutations/policyEnforcedOps
 */

import { v } from "convex/values";
import { internalAction } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import type { Id } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface GuardCheckResult {
  passed: boolean;
  violations: Violation[];
  sanitizedContent?: string;
  quarantineReason?: string;
}

interface Violation {
  guard: string;
  code: string;
  message: string;
  severity: "critical" | "high" | "medium" | "low";
}

interface PolicyEnforcedResult<T> {
  success: boolean;
  result?: T;
  violations: Violation[];
  quarantined: boolean;
  quarantineId?: Id<"contentQuarantine">;
}

// ═══════════════════════════════════════════════════════════════════════════
// GUARD CHECK UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run all pre-publication guards
 */
async function runPrePublicationGuards(
  ctx: any,
  content: string,
  authorId: string,
  authorType: "human" | "agent",
  sourceDomains: string[]
): Promise<GuardCheckResult> {
  const violations: Violation[] = [];
  let sanitizedContent = content;

  // 1. Injection Containment
  try {
    const injectionResult = await ctx.runAction(
      internal.domains.narrative.guards.injectionContainment.checkForInjections,
      { content }
    );

    if (injectionResult.threatLevel === "critical") {
      violations.push({
        guard: "injectionContainment",
        code: "INJ001",
        message: "Critical prompt injection detected",
        severity: "critical",
      });
    } else if (injectionResult.threatLevel === "high") {
      violations.push({
        guard: "injectionContainment",
        code: "INJ002",
        message: "High-risk injection pattern detected",
        severity: "high",
      });
    }

    // Sanitize content if any threats detected
    if (injectionResult.threatLevel !== "none") {
      const sanitizeResult = await ctx.runAction(
        internal.domains.narrative.guards.injectionContainment.sanitizeForAgent,
        { content }
      );
      sanitizedContent = sanitizeResult.sanitizedContent;
    }
  } catch (error) {
    console.warn("[PolicyEnforced] Injection check failed:", error);
  }

  // 2. Trust Scoring (for human authors)
  if (authorType === "human") {
    try {
      const trustResult = await ctx.runAction(
        internal.domains.narrative.guards.trustScoring.canAuthorPost,
        { authorId }
      );

      if (!trustResult.allowed) {
        violations.push({
          guard: "trustScoring",
          code: trustResult.reason === "banned" ? "TS003" : "TS001",
          message: trustResult.message || "Author not allowed to post",
          severity: trustResult.reason === "banned" ? "critical" : "high",
        });
      }
    } catch (error) {
      console.warn("[PolicyEnforced] Trust check failed:", error);
    }
  }

  // 3. Content Rights (for each source domain)
  for (const domain of sourceDomains) {
    try {
      const policyResult = await ctx.runQuery(
        internal.domains.narrative.guards.contentRights.getPolicyForDomain,
        { domain }
      );

      if (policyResult && policyResult.aiUsageMode === "prohibited") {
        violations.push({
          guard: "contentRights",
          code: "CR003",
          message: `AI usage prohibited for content from ${domain}`,
          severity: "high",
        });
      }
    } catch (error) {
      console.warn(`[PolicyEnforced] Content rights check failed for ${domain}:`, error);
    }
  }

  // Determine quarantine reason
  let quarantineReason: string | undefined;
  const criticalViolations = violations.filter(v => v.severity === "critical");
  const highViolations = violations.filter(v => v.severity === "high");

  if (criticalViolations.length > 0) {
    quarantineReason = criticalViolations[0].code;
  } else if (highViolations.length > 0) {
    quarantineReason = highViolations[0].code;
  }

  return {
    passed: violations.filter(v => v.severity === "critical" || v.severity === "high").length === 0,
    violations,
    sanitizedContent,
    quarantineReason,
  };
}

/**
 * Extract domains from citation URLs
 */
function extractDomainsFromCitations(
  citations: Array<{ citationKey: string; artifactId?: string; url?: string }>
): string[] {
  const domains: string[] = [];
  for (const citation of citations) {
    if (citation.url) {
      try {
        const url = new URL(citation.url);
        domains.push(url.hostname.replace(/^www\./, ""));
      } catch {
        // Invalid URL, skip
      }
    }
  }
  return [...new Set(domains)];
}

// ═══════════════════════════════════════════════════════════════════════════
// POLICY-ENFORCED POST CREATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a post with full policy enforcement
 */
export const createPostEnforced = internalAction({
  args: {
    threadId: v.id("narrativeThreads"),
    parentPostId: v.optional(v.id("narrativePosts")),
    postType: v.union(
      v.literal("delta_update"),
      v.literal("thesis_revision"),
      v.literal("evidence_addition"),
      v.literal("counterpoint"),
      v.literal("question"),
      v.literal("correction")
    ),
    title: v.optional(v.string()),
    content: v.string(),
    changeSummary: v.optional(v.array(v.string())),
    citations: v.array(v.object({
      citationKey: v.string(),
      artifactId: v.id("sourceArtifacts"),
      chunkId: v.optional(v.id("artifactChunks")),
      quote: v.optional(v.string()),
      pageIndex: v.optional(v.number()),
      publishedAt: v.optional(v.number()),
    })),
    supersedes: v.optional(v.id("narrativePosts")),
    authorId: v.string(),
    authorType: v.union(v.literal("human"), v.literal("agent")),
    agentConfidence: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    postId: v.optional(v.id("narrativePosts")),
    violations: v.array(v.object({
      guard: v.string(),
      code: v.string(),
      message: v.string(),
      severity: v.string(),
    })),
    quarantined: v.boolean(),
    quarantineId: v.optional(v.id("contentQuarantine")),
  }),
  handler: async (ctx, args): Promise<PolicyEnforcedResult<Id<"narrativePosts">>> => {
    console.log(`[PolicyEnforced] Creating post for thread ${args.threadId}`);

    // Extract domains from citations for content rights check
    const sourceDomains = extractDomainsFromCitations(args.citations);

    // Run all guards
    const guardResult = await runPrePublicationGuards(
      ctx,
      args.content,
      args.authorId,
      args.authorType,
      sourceDomains
    );

    // If critical violations, block entirely
    const criticalViolations = guardResult.violations.filter(v => v.severity === "critical");
    if (criticalViolations.length > 0) {
      console.warn(`[PolicyEnforced] Blocked post creation: ${criticalViolations.map(v => v.code).join(", ")}`);
      return {
        success: false,
        violations: guardResult.violations,
        quarantined: false,
      };
    }

    // If high-severity violations, quarantine
    const highViolations = guardResult.violations.filter(v => v.severity === "high");
    if (highViolations.length > 0) {
      console.log(`[PolicyEnforced] Quarantining post: ${highViolations.map(v => v.code).join(", ")}`);

      // Create quarantine entry (pre-persist since content doesn't exist yet)
      const quarantineId = await ctx.runMutation(
        internal.domains.narrative.guards.quarantine.quarantineContentPrePersist,
        {
          contentType: "post",
          content: guardResult.sanitizedContent || args.content,
          authorId: args.authorId,
          authorType: args.authorType,
          reason: (guardResult.quarantineReason === "policy_violation" || !guardResult.quarantineReason)
            ? "policy_violation"
            : guardResult.quarantineReason as any,
          metadata: {
            threadId: args.threadId,
            postType: args.postType,
            violations: highViolations.map(v => v.code),
          },
        }
      );

      return {
        success: false,
        violations: guardResult.violations,
        quarantined: true,
        quarantineId,
      };
    }

    // All guards passed - create the post
    try {
      const postId = await ctx.runMutation(
        internal.domains.narrative.mutations.posts.createPostInternal,
        {
          threadId: args.threadId,
          parentPostId: args.parentPostId,
          postType: args.postType,
          title: args.title,
          content: guardResult.sanitizedContent || args.content,
          changeSummary: args.changeSummary,
          citations: args.citations,
          supersedes: args.supersedes,
          agentName: args.authorType === "agent" ? args.authorId : "human",
          confidence: args.agentConfidence,
        }
      );

      // Record successful post for trust scoring
      if (args.authorType === "human") {
        try {
          await ctx.runMutation(
            internal.domains.narrative.guards.trustScoring.recordPost,
            { authorId: args.authorId, postId }
          );
        } catch (error) {
          console.warn("[PolicyEnforced] Failed to record post for trust:", error);
        }
      }

      // Run claim classification in background (don't block)
      ctx.runAction(
        internal.domains.narrative.guards.claimClassificationGate.classifyPostContent,
        { postId, content: guardResult.sanitizedContent || args.content }
      ).catch(error => {
        console.warn("[PolicyEnforced] Claim classification failed:", error);
      });

      return {
        success: true,
        result: postId,
        violations: guardResult.violations,
        quarantined: false,
      };
    } catch (error) {
      console.error("[PolicyEnforced] Post creation failed:", error);
      return {
        success: false,
        violations: [{
          guard: "system",
          code: "SYS001",
          message: error instanceof Error ? error.message : "Unknown error",
          severity: "high",
        }],
        quarantined: false,
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// POLICY-ENFORCED EVIDENCE CREATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create evidence artifact with content rights enforcement
 */
export const createEvidenceEnforced = internalAction({
  args: {
    url: v.string(),
    contentHash: v.string(),
    publishedAt: v.optional(v.number()),
    extractedQuotes: v.array(v.object({
      text: v.string(),
      context: v.optional(v.string()),
    })),
    entities: v.array(v.string()),
    topics: v.array(v.string()),
    retrievalTrace: v.object({
      searchQuery: v.optional(v.string()),
      agentName: v.string(),
      toolName: v.string(),
    }),
    publisher: v.optional(v.string()),
    credibilityTier: v.optional(v.union(
      v.literal("tier1_primary"),
      v.literal("tier2_established"),
      v.literal("tier3_community"),
      v.literal("tier4_unverified")
    )),
  },
  returns: v.object({
    success: v.boolean(),
    artifactId: v.optional(v.string()),
    _id: v.optional(v.id("evidenceArtifacts")),
    isNew: v.optional(v.boolean()),
    violations: v.array(v.object({
      guard: v.string(),
      code: v.string(),
      message: v.string(),
      severity: v.string(),
    })),
    sanitizedQuotes: v.optional(v.array(v.object({
      text: v.string(),
      context: v.optional(v.string()),
    }))),
  }),
  handler: async (ctx, args) => {
    const violations: Violation[] = [];

    // Extract domain for content rights check
    let domain: string;
    try {
      const url = new URL(args.url);
      domain = url.hostname.replace(/^www\./, "");
    } catch {
      domain = "unknown";
    }

    // 1. Check content rights policy
    const policy = await ctx.runQuery(
      internal.domains.narrative.guards.contentRights.getPolicyForDomain,
      { domain }
    );

    if (policy) {
      // Check storage mode
      if (policy.storageMode === "link_only") {
        violations.push({
          guard: "contentRights",
          code: "CR001",
          message: `Storage prohibited for ${domain}, link-only allowed`,
          severity: "high",
        });
      }

      // Check AI usage
      if (policy.aiUsageMode === "prohibited") {
        violations.push({
          guard: "contentRights",
          code: "CR003",
          message: `AI usage prohibited for content from ${domain}`,
          severity: "high",
        });
      }
    }

    // 2. Sanitize extracted quotes for injection patterns
    let sanitizedQuotes = args.extractedQuotes;
    for (let i = 0; i < args.extractedQuotes.length; i++) {
      const quote = args.extractedQuotes[i];
      try {
        const injectionCheck = await ctx.runAction(
          internal.domains.narrative.guards.injectionContainment.checkForInjections,
          { content: quote.text }
        );

        if (injectionCheck.threatLevel !== "none") {
          const sanitizeResult = await ctx.runAction(
            internal.domains.narrative.guards.injectionContainment.sanitizeForAgent,
            { content: quote.text }
          );
          sanitizedQuotes[i] = {
            ...quote,
            text: sanitizeResult.sanitizedContent,
          };

          if (injectionCheck.threatLevel === "critical" || injectionCheck.threatLevel === "high") {
            violations.push({
              guard: "injectionContainment",
              code: "INJ002",
              message: `Injection detected in quote ${i + 1}, sanitized`,
              severity: "medium",
            });
          }
        }
      } catch (error) {
        console.warn(`[PolicyEnforced] Quote sanitization failed for quote ${i}:`, error);
      }
    }

    // If critical violations, block
    const criticalViolations = violations.filter(v => v.severity === "critical");
    if (criticalViolations.length > 0) {
      return {
        success: false,
        violations,
      };
    }

    // Enforce storage policy - truncate quotes if needed
    if (policy?.storageMode === "excerpt_only" && policy.maxExcerptChars) {
      sanitizedQuotes = sanitizedQuotes.map(q => ({
        ...q,
        text: q.text.slice(0, policy.maxExcerptChars),
      }));
    }

    // Create the evidence artifact
    try {
      const result = await ctx.runMutation(
        internal.domains.narrative.mutations.evidence.createEvidenceArtifact,
        {
          url: args.url,
          contentHash: args.contentHash,
          publishedAt: args.publishedAt,
          extractedQuotes: sanitizedQuotes,
          entities: args.entities,
          topics: args.topics,
          retrievalTrace: args.retrievalTrace,
          publisher: args.publisher,
          credibilityTier: args.credibilityTier,
        }
      );

      return {
        success: true,
        artifactId: result.artifactId,
        _id: result._id,
        isNew: result.isNew,
        violations,
        sanitizedQuotes,
      };
    } catch (error) {
      console.error("[PolicyEnforced] Evidence creation failed:", error);
      return {
        success: false,
        violations: [{
          guard: "system",
          code: "SYS001",
          message: error instanceof Error ? error.message : "Unknown error",
          severity: "high",
        }, ...violations],
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// POLICY-ENFORCED TEMPORAL FACT UPDATE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create/update temporal fact with quarantine rules
 * Tier3 sources cannot update facts without tier1/2 corroboration
 */
export const updateTemporalFactEnforced = internalAction({
  args: {
    threadId: v.id("narrativeThreads"),
    claimText: v.string(),
    subject: v.string(),
    predicate: v.string(),
    object: v.string(),
    validFrom: v.number(),
    validTo: v.optional(v.number()),
    confidence: v.number(),
    sourceEventIds: v.array(v.id("narrativeEvents")),
    sourceCredibility: v.union(
      v.literal("tier1_primary"),
      v.literal("tier2_established"),
      v.literal("tier3_community"),
      v.literal("tier4_unverified")
    ),
    agentName: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    factId: v.optional(v.string()),
    quarantined: v.boolean(),
    quarantineId: v.optional(v.id("contentQuarantine")),
    violations: v.array(v.object({
      guard: v.string(),
      code: v.string(),
      message: v.string(),
      severity: v.string(),
    })),
  }),
  handler: async (ctx, args) => {
    const violations: Violation[] = [];

    // Tier3/4 sources cannot directly update temporalFacts
    if (args.sourceCredibility === "tier3_community" || args.sourceCredibility === "tier4_unverified") {
      console.log(`[PolicyEnforced] Tier3/4 fact update requires quarantine: ${args.claimText.slice(0, 50)}`);

      // Check for corroboration from tier1/2 sources
      const corroborationCheck = await ctx.runAction(
        internal.domains.narrative.guards.quarantine.checkPromotionEligibility,
        {
          contentType: "fact",
          content: args.claimText,
          sourceCredibility: args.sourceCredibility,
        }
      );

      if (!corroborationCheck.eligible) {
        violations.push({
          guard: "quarantine",
          code: "QR001",
          message: `Tier3/4 fact requires ${corroborationCheck.requiredCorroboration} tier1/2 sources, found ${corroborationCheck.currentCorroboration}`,
          severity: "high",
        });

        // Quarantine the fact (pre-persist since fact doesn't exist yet)
        const quarantineId = await ctx.runMutation(
          internal.domains.narrative.guards.quarantine.quarantineContentPrePersist,
          {
            contentType: "fact",
            content: args.claimText,
            authorId: args.agentName,
            authorType: "agent",
            reason: "tier3_fact_update",
            metadata: {
              threadId: args.threadId,
              subject: args.subject,
              predicate: args.predicate,
              object: args.object,
              sourceCredibility: args.sourceCredibility,
            },
          }
        );

        return {
          success: false,
          quarantined: true,
          quarantineId,
          violations,
        };
      }
    }

    // Injection check on claim text
    try {
      const injectionResult = await ctx.runAction(
        internal.domains.narrative.guards.injectionContainment.checkForInjections,
        { content: args.claimText }
      );

      if (injectionResult.threatLevel === "critical" || injectionResult.threatLevel === "high") {
        violations.push({
          guard: "injectionContainment",
          code: "INJ002",
          message: "Injection detected in claim text",
          severity: "critical",
        });

        return {
          success: false,
          quarantined: false,
          violations,
        };
      }
    } catch (error) {
      console.warn("[PolicyEnforced] Injection check failed:", error);
    }

    // Create the temporal fact
    try {
      const result = await ctx.runMutation(
        internal.domains.narrative.mutations.temporalFacts.createTemporalFact,
        {
          threadId: args.threadId,
          claimText: args.claimText,
          subject: args.subject,
          predicate: args.predicate,
          object: args.object,
          validFrom: args.validFrom,
          validTo: args.validTo,
          confidence: args.confidence,
          sourceEventIds: args.sourceEventIds,
        }
      );

      // Initialize truth state as canonical
      await ctx.runMutation(
        internal.domains.narrative.guards.truthMaintenance.initializeTruthState,
        {
          factId: result._id,
          initialStatus: "canonical",
          evidence: args.sourceEventIds.map(id => id.toString()),
        }
      );

      return {
        success: true,
        factId: result.factId,
        quarantined: false,
        violations,
      };
    } catch (error) {
      console.error("[PolicyEnforced] Fact creation failed:", error);
      return {
        success: false,
        quarantined: false,
        violations: [{
          guard: "system",
          code: "SYS001",
          message: error instanceof Error ? error.message : "Unknown error",
          severity: "high",
        }],
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// POLICY-ENFORCED REPLY CREATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a reply with full policy enforcement
 */
export const createReplyEnforced = internalAction({
  args: {
    postId: v.id("narrativePosts"),
    parentReplyId: v.optional(v.id("narrativeReplies")),
    replyType: v.union(
      v.literal("evidence"),
      v.literal("question"),
      v.literal("correction"),
      v.literal("support")
    ),
    content: v.string(),
    evidenceArtifactIds: v.optional(v.array(v.string())),
    authorId: v.string(),
    authorType: v.union(v.literal("human"), v.literal("agent")),
  },
  returns: v.object({
    success: v.boolean(),
    replyId: v.optional(v.id("narrativeReplies")),
    violations: v.array(v.object({
      guard: v.string(),
      code: v.string(),
      message: v.string(),
      severity: v.string(),
    })),
    quarantined: v.boolean(),
    quarantineId: v.optional(v.id("contentQuarantine")),
  }),
  handler: async (ctx, args): Promise<PolicyEnforcedResult<Id<"narrativeReplies">>> => {
    const violations: Violation[] = [];
    let sanitizedContent = args.content;

    // 1. Injection check
    try {
      const injectionResult = await ctx.runAction(
        internal.domains.narrative.guards.injectionContainment.checkForInjections,
        { content: args.content }
      );

      if (injectionResult.threatLevel === "critical") {
        violations.push({
          guard: "injectionContainment",
          code: "INJ001",
          message: "Critical prompt injection detected",
          severity: "critical",
        });
      } else if (injectionResult.threatLevel !== "none") {
        const sanitizeResult = await ctx.runAction(
          internal.domains.narrative.guards.injectionContainment.sanitizeForAgent,
          { content: args.content }
        );
        sanitizedContent = sanitizeResult.sanitizedContent;
      }
    } catch (error) {
      console.warn("[PolicyEnforced] Reply injection check failed:", error);
    }

    // 2. Trust check for human authors
    if (args.authorType === "human") {
      try {
        const trustResult = await ctx.runAction(
          internal.domains.narrative.guards.trustScoring.canAuthorPost,
          { authorId: args.authorId }
        );

        if (!trustResult.allowed) {
          violations.push({
            guard: "trustScoring",
            code: "TS001",
            message: trustResult.message || "Author rate limited",
            severity: "high",
          });
        }
      } catch (error) {
        console.warn("[PolicyEnforced] Reply trust check failed:", error);
      }
    }

    // Block if critical violations
    if (violations.some(v => v.severity === "critical")) {
      return {
        success: false,
        violations,
        quarantined: false,
      };
    }

    // Quarantine if high violations
    if (violations.some(v => v.severity === "high")) {
      const quarantineId = await ctx.runMutation(
        internal.domains.narrative.guards.quarantine.quarantineContentPrePersist,
        {
          contentType: "reply",
          content: sanitizedContent,
          authorId: args.authorId,
          authorType: args.authorType,
          reason: "policy_violation",
          metadata: {
            postId: args.postId,
            replyType: args.replyType,
            violations: violations.map(v => v.code),
          },
        }
      );

      return {
        success: false,
        violations,
        quarantined: true,
        quarantineId,
      };
    }

    // Create the reply
    try {
      const replyId = await ctx.runMutation(
        internal.domains.narrative.mutations.posts.createReplyInternal,
        {
          postId: args.postId,
          parentReplyId: args.parentReplyId,
          replyType: args.replyType,
          content: sanitizedContent,
          evidenceArtifactIds: args.evidenceArtifactIds,
          agentName: args.authorType === "agent" ? args.authorId : "human",
        }
      );

      return {
        success: true,
        result: replyId,
        violations,
        quarantined: false,
      };
    } catch (error) {
      return {
        success: false,
        violations: [{
          guard: "system",
          code: "SYS001",
          message: error instanceof Error ? error.message : "Unknown error",
          severity: "high",
        }],
        quarantined: false,
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// BATCH OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Batch sanitize content for agent consumption
 */
export const batchSanitizeForAgent = internalAction({
  args: {
    contents: v.array(v.object({
      id: v.string(),
      content: v.string(),
    })),
  },
  returns: v.array(v.object({
    id: v.string(),
    sanitizedContent: v.string(),
    hadThreats: v.boolean(),
    threatLevel: v.string(),
  })),
  handler: async (ctx, args) => {
    const results: Array<{
      id: string;
      sanitizedContent: string;
      hadThreats: boolean;
      threatLevel: string;
    }> = [];

    for (const item of args.contents) {
      try {
        const checkResult = await ctx.runAction(
          internal.domains.narrative.guards.injectionContainment.checkForInjections,
          { content: item.content }
        );

        if (checkResult.threatLevel !== "none") {
          const sanitizeResult = await ctx.runAction(
            internal.domains.narrative.guards.injectionContainment.sanitizeForAgent,
            { content: item.content }
          );
          results.push({
            id: item.id,
            sanitizedContent: sanitizeResult.sanitizedContent,
            hadThreats: true,
            threatLevel: checkResult.threatLevel,
          });
        } else {
          results.push({
            id: item.id,
            sanitizedContent: item.content,
            hadThreats: false,
            threatLevel: "none",
          });
        }
      } catch (error) {
        // On error, return original content with warning
        results.push({
          id: item.id,
          sanitizedContent: item.content,
          hadThreats: false,
          threatLevel: "error",
        });
      }
    }

    return results;
  },
});

/**
 * Enforce content rights TTL - delete expired content
 */
export const enforceContentTTL = internalAction({
  args: {},
  returns: v.object({
    deletedCount: v.number(),
    errors: v.array(v.string()),
  }),
  handler: async (ctx) => {
    let deletedCount = 0;
    const errors: string[] = [];

    try {
      // Find expired content
      const expired = await ctx.runQuery(
        internal.domains.narrative.guards.contentRights.findExpiredContent,
        { limit: 100 }
      );

      // Delete each expired artifact
      for (const item of expired) {
        try {
          await ctx.runMutation(
            internal.domains.narrative.guards.contentRights.deleteExpiredContent,
            { artifactId: item._id }
          );
          deletedCount++;
        } catch (error) {
          errors.push(`Failed to delete ${item._id}: ${error}`);
        }
      }
    } catch (error) {
      errors.push(`TTL enforcement failed: ${error}`);
    }

    return { deletedCount, errors };
  },
});
