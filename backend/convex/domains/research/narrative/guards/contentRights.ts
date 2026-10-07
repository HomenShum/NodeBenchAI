/**
 * Content Rights Policy Enforcement Layer
 *
 * P0 ship blocker for legal/ToS compliance.
 * Enforces per-source storage, rendering, and AI usage constraints.
 *
 * Industry standard patterns:
 * - GDPR Article 6 (lawful basis) + Article 17 (right to erasure)
 * - CCPA Section 1798.105 (right to deletion)
 * - Platform ToS compliance (X, Reddit, HN)
 *
 * @module domains/narrative/guards/contentRights
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  internalAction,
} from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import type { Id, Doc } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Storage modes - how content can be persisted
 */
export type StorageMode =
  | "full_text"      // Store complete content (only for permissive sources)
  | "excerpt_only"   // Store limited excerpts only
  | "hash_metadata"  // Store hash + metadata only (no content)
  | "link_only";     // Store URL reference only

/**
 * Rendering modes - how content can be displayed
 */
export type RenderingMode =
  | "direct_quote"   // Can show exact quotes
  | "paraphrase"     // Must paraphrase, no direct quotes
  | "summary_only"   // High-level summary only
  | "link_only";     // Just show link, no content preview

/**
 * AI usage modes - how content can be used by agents
 */
export type AIUsageMode =
  | "full"           // Can use for training, inference, everything
  | "inference_only" // Can use for inference, not training
  | "citation_only"  // Can only cite, not analyze content
  | "prohibited";    // Cannot use at all

/**
 * Policy enforcement result
 */
export interface PolicyEnforcementResult {
  allowed: boolean;
  violations: PolicyViolation[];
  sanitizedContent?: SanitizedContent;
  requiredActions: RequiredAction[];
}

export interface PolicyViolation {
  code: string;
  message: string;
  severity: "error" | "warning";
  remediation?: string;
}

export interface SanitizedContent {
  text?: string;
  excerptChars: number;
  truncated: boolean;
  hashOnly: boolean;
}

export interface RequiredAction {
  action: "truncate" | "hash" | "delete" | "attribute" | "linkback";
  reason: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT POLICIES (Industry Standard)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Default policies for known platforms.
 * Based on current ToS as of 2024 (should be reviewed quarterly).
 *
 * Sources:
 * - X/Twitter: https://twitter.com/en/tos (Section 3)
 * - Reddit: https://www.redditinc.com/policies/user-agreement
 * - HN: https://news.ycombinator.com/newsguidelines.html
 */
export const DEFAULT_POLICIES: Record<string, Omit<Doc<"contentRightsPolicies">, "_id" | "_creationTime">> = {
  // X/Twitter - Restrictive after 2023 changes
  "twitter.com": {
    domain: "twitter.com",
    sourceId: "x_twitter",
    displayName: "X (Twitter)",
    storageMode: "hash_metadata",
    maxExcerptChars: 0,
    ttlDays: 30,
    requireAttribution: true,
    renderingMode: "link_only",
    maxQuoteChars: 0,
    requireLinkback: true,
    aiUsageMode: "citation_only",
    allowDerivativeWorks: false,
    allowSentimentExtraction: true, // Sentiment is transformative
    tosUrl: "https://twitter.com/en/tos",
    lastReviewedAt: Date.now(),
    notes: "X ToS prohibits content scraping/reproduction. Only metadata + sentiment allowed.",
  },
  "x.com": {
    domain: "x.com",
    sourceId: "x_twitter",
    displayName: "X (Twitter)",
    storageMode: "hash_metadata",
    maxExcerptChars: 0,
    ttlDays: 30,
    requireAttribution: true,
    renderingMode: "link_only",
    maxQuoteChars: 0,
    requireLinkback: true,
    aiUsageMode: "citation_only",
    allowDerivativeWorks: false,
    allowSentimentExtraction: true,
    tosUrl: "https://twitter.com/en/tos",
    lastReviewedAt: Date.now(),
    notes: "X ToS prohibits content scraping/reproduction. Only metadata + sentiment allowed.",
  },

  // Reddit - Moderate restrictions
  "reddit.com": {
    domain: "reddit.com",
    sourceId: "reddit",
    displayName: "Reddit",
    storageMode: "excerpt_only",
    maxExcerptChars: 500,
    ttlDays: 90,
    requireAttribution: true,
    renderingMode: "paraphrase",
    maxQuoteChars: 280,
    requireLinkback: true,
    aiUsageMode: "inference_only",
    allowDerivativeWorks: false,
    allowSentimentExtraction: true,
    tosUrl: "https://www.redditinc.com/policies/user-agreement",
    lastReviewedAt: Date.now(),
    notes: "Reddit API ToS allows limited excerpts with attribution. No bulk reproduction.",
  },

  // Hacker News - Permissive for non-commercial
  "news.ycombinator.com": {
    domain: "news.ycombinator.com",
    sourceId: "hackernews",
    displayName: "Hacker News",
    storageMode: "excerpt_only",
    maxExcerptChars: 1000,
    ttlDays: 365,
    requireAttribution: true,
    renderingMode: "direct_quote",
    maxQuoteChars: 500,
    requireLinkback: true,
    aiUsageMode: "inference_only",
    allowDerivativeWorks: true,
    allowSentimentExtraction: true,
    tosUrl: "https://news.ycombinator.com/newsguidelines.html",
    lastReviewedAt: Date.now(),
    notes: "HN content is user-generated. Attribution required. API has rate limits.",
  },

  // Wire services - Restrictive (copyright)
  "reuters.com": {
    domain: "reuters.com",
    sourceId: "reuters",
    displayName: "Reuters",
    storageMode: "hash_metadata",
    maxExcerptChars: 0,
    ttlDays: 7,
    requireAttribution: true,
    renderingMode: "link_only",
    maxQuoteChars: 0,
    requireLinkback: true,
    aiUsageMode: "citation_only",
    allowDerivativeWorks: false,
    allowSentimentExtraction: false,
    tosUrl: "https://www.reuters.com/info-pages/terms-of-use/",
    lastReviewedAt: Date.now(),
    notes: "Reuters content is copyrighted. Link-only with citation.",
  },

  // Bloomberg - Very restrictive (paywall + copyright)
  "bloomberg.com": {
    domain: "bloomberg.com",
    sourceId: "bloomberg",
    displayName: "Bloomberg",
    storageMode: "hash_metadata",
    maxExcerptChars: 0,
    ttlDays: 7,
    requireAttribution: true,
    renderingMode: "link_only",
    maxQuoteChars: 0,
    requireLinkback: true,
    aiUsageMode: "citation_only",
    allowDerivativeWorks: false,
    allowSentimentExtraction: false,
    tosUrl: "https://www.bloomberg.com/notices/tos/",
    lastReviewedAt: Date.now(),
    notes: "Bloomberg content is copyrighted and paywalled. Link-only.",
  },

  // Government sources - Public domain (permissive)
  "sec.gov": {
    domain: "sec.gov",
    sourceId: "sec_gov",
    displayName: "SEC EDGAR",
    storageMode: "full_text",
    maxExcerptChars: 10000,
    ttlDays: 3650, // 10 years
    requireAttribution: true,
    renderingMode: "direct_quote",
    maxQuoteChars: 5000,
    requireLinkback: true,
    aiUsageMode: "full",
    allowDerivativeWorks: true,
    allowSentimentExtraction: true,
    tosUrl: "https://www.sec.gov/privacy.htm",
    lastReviewedAt: Date.now(),
    notes: "US Government content is public domain. Full usage allowed.",
  },

  // Default fallback - Conservative
  "_default": {
    domain: "_default",
    sourceId: "_default",
    displayName: "Unknown Source",
    storageMode: "hash_metadata",
    maxExcerptChars: 0,
    ttlDays: 30,
    requireAttribution: true,
    renderingMode: "link_only",
    maxQuoteChars: 0,
    requireLinkback: true,
    aiUsageMode: "citation_only",
    allowDerivativeWorks: false,
    allowSentimentExtraction: true,
    tosUrl: "",
    lastReviewedAt: Date.now(),
    notes: "Unknown source - apply most restrictive policy by default.",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// POLICY QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get policy for a domain.
 * Falls back to default if no specific policy exists.
 */
export const getPolicyForDomain = internalQuery({
  args: {
    domain: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      domain: v.string(),
      sourceId: v.string(),
      displayName: v.string(),
      storageMode: v.string(),
      maxExcerptChars: v.number(),
      ttlDays: v.number(),
      requireAttribution: v.boolean(),
      renderingMode: v.string(),
      maxQuoteChars: v.number(),
      requireLinkback: v.boolean(),
      aiUsageMode: v.string(),
      allowDerivativeWorks: v.boolean(),
      allowSentimentExtraction: v.boolean(),
      tosUrl: v.string(),
      lastReviewedAt: v.number(),
      notes: v.string(),
      isDefault: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    // Normalize domain
    const normalizedDomain = args.domain.toLowerCase().replace(/^www\./, "");

    // Try to find specific policy in database
    const dbPolicy = await ctx.db
      .query("contentRightsPolicies")
      .withIndex("by_domain", (q) => q.eq("domain", normalizedDomain))
      .first();

    if (dbPolicy) {
      return { ...dbPolicy, isDefault: false };
    }

    // Fall back to hardcoded defaults
    const defaultPolicy = DEFAULT_POLICIES[normalizedDomain] || DEFAULT_POLICIES["_default"];
    return { ...defaultPolicy, isDefault: true };
  },
});

/**
 * Get policy for a URL.
 */
export const getPolicyForUrl = internalQuery({
  args: {
    url: v.string(),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    try {
      const parsed = new URL(args.url);
      const domain = parsed.hostname.replace(/^www\./, "");
      return await ctx.runQuery(
        internal.domains.narrative.guards.contentRights.getPolicyForDomain,
        { domain }
      );
    } catch {
      // Invalid URL - return default policy
      return { ...DEFAULT_POLICIES["_default"], isDefault: true };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// POLICY ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract domain from URL safely.
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "_unknown";
  }
}

/**
 * Truncate text to max chars at word boundary.
 */
function truncateAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const truncated = text.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > maxChars * 0.8) {
    return truncated.slice(0, lastSpace) + "...";
  }
  return truncated + "...";
}

/**
 * Hash content for storage (when full text not allowed).
 */
function hashContent(content: string): string {
  // FNV-1a 32-bit hash
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Enforce storage policy on content.
 */
export const enforceStoragePolicy = internalAction({
  args: {
    url: v.string(),
    content: v.string(),
    metadata: v.optional(
      v.object({
        author: v.optional(v.string()),
        publishedAt: v.optional(v.number()),
        title: v.optional(v.string()),
      })
    ),
  },
  returns: v.object({
    allowed: v.boolean(),
    violations: v.array(
      v.object({
        code: v.string(),
        message: v.string(),
        severity: v.union(v.literal("error"), v.literal("warning")),
        remediation: v.optional(v.string()),
      })
    ),
    sanitizedContent: v.optional(
      v.object({
        text: v.optional(v.string()),
        excerptChars: v.number(),
        truncated: v.boolean(),
        hashOnly: v.boolean(),
      })
    ),
    requiredActions: v.array(
      v.object({
        action: v.union(
          v.literal("truncate"),
          v.literal("hash"),
          v.literal("delete"),
          v.literal("attribute"),
          v.literal("linkback")
        ),
        reason: v.string(),
      })
    ),
  }),
  handler: async (ctx, args): Promise<PolicyEnforcementResult> => {
    const domain = extractDomain(args.url);
    const policy = await ctx.runQuery(
      internal.domains.narrative.guards.contentRights.getPolicyForDomain,
      { domain }
    );

    if (!policy) {
      // No policy found - block by default
      return {
        allowed: false,
        violations: [
          {
            code: "NO_POLICY",
            message: `No content policy found for domain: ${domain}`,
            severity: "error",
            remediation: "Add a content rights policy for this domain.",
          },
        ],
        requiredActions: [],
      };
    }

    const violations: PolicyViolation[] = [];
    const requiredActions: RequiredAction[] = [];
    let sanitizedContent: SanitizedContent | undefined;

    // Check storage mode
    switch (policy.storageMode) {
      case "full_text":
        // Full text allowed
        sanitizedContent = {
          text: args.content,
          excerptChars: args.content.length,
          truncated: false,
          hashOnly: false,
        };
        break;

      case "excerpt_only":
        // Truncate to max excerpt chars
        if (args.content.length > policy.maxExcerptChars) {
          requiredActions.push({
            action: "truncate",
            reason: `Content exceeds max excerpt length (${policy.maxExcerptChars} chars)`,
          });
        }
        sanitizedContent = {
          text: truncateAtWordBoundary(args.content, policy.maxExcerptChars),
          excerptChars: Math.min(args.content.length, policy.maxExcerptChars),
          truncated: args.content.length > policy.maxExcerptChars,
          hashOnly: false,
        };
        break;

      case "hash_metadata":
        // Hash only - no text storage
        requiredActions.push({
          action: "hash",
          reason: `Source policy prohibits content storage for ${domain}`,
        });
        sanitizedContent = {
          text: undefined,
          excerptChars: 0,
          truncated: true,
          hashOnly: true,
        };
        // Store hash for dedup purposes
        break;

      case "link_only":
        // No content at all
        requiredActions.push({
          action: "hash",
          reason: `Source policy allows link-only storage for ${domain}`,
        });
        sanitizedContent = {
          text: undefined,
          excerptChars: 0,
          truncated: true,
          hashOnly: true,
        };
        break;

      default:
        violations.push({
          code: "UNKNOWN_STORAGE_MODE",
          message: `Unknown storage mode: ${policy.storageMode}`,
          severity: "error",
        });
    }

    // Check attribution requirements
    if (policy.requireAttribution) {
      requiredActions.push({
        action: "attribute",
        reason: `Attribution required for ${domain}`,
      });
    }

    // Check linkback requirements
    if (policy.requireLinkback) {
      requiredActions.push({
        action: "linkback",
        reason: `Linkback required for ${domain}`,
      });
    }

    // Check TTL
    if (policy.ttlDays < 30) {
      violations.push({
        code: "SHORT_TTL",
        message: `Content from ${domain} expires in ${policy.ttlDays} days`,
        severity: "warning",
        remediation: "Schedule content expiry job.",
      });
    }

    return {
      allowed: violations.filter((v) => v.severity === "error").length === 0,
      violations,
      sanitizedContent,
      requiredActions,
    };
  },
});

/**
 * Enforce rendering policy (for display).
 */
export const enforceRenderingPolicy = internalQuery({
  args: {
    url: v.string(),
    content: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    renderedContent: v.optional(v.string()),
    renderMode: v.string(),
    requiresLinkback: v.boolean(),
    requiresAttribution: v.boolean(),
    maxQuoteChars: v.number(),
  }),
  handler: async (ctx, args) => {
    const domain = extractDomain(args.url);
    const policy = await ctx.runQuery(
      internal.domains.narrative.guards.contentRights.getPolicyForDomain,
      { domain }
    );

    if (!policy) {
      return {
        allowed: false,
        renderedContent: undefined,
        renderMode: "link_only",
        requiresLinkback: true,
        requiresAttribution: true,
        maxQuoteChars: 0,
      };
    }

    let renderedContent: string | undefined;

    switch (policy.renderingMode) {
      case "direct_quote":
        renderedContent = truncateAtWordBoundary(args.content, policy.maxQuoteChars);
        break;
      case "paraphrase":
        // In production, would call LLM to paraphrase
        // For now, truncate and add indicator
        renderedContent = `[Paraphrased] ${truncateAtWordBoundary(args.content, policy.maxQuoteChars)}`;
        break;
      case "summary_only":
        renderedContent = `[Summary available - click to view source]`;
        break;
      case "link_only":
        renderedContent = undefined;
        break;
    }

    return {
      allowed: true,
      renderedContent,
      renderMode: policy.renderingMode,
      requiresLinkback: policy.requireLinkback,
      requiresAttribution: policy.requireAttribution,
      maxQuoteChars: policy.maxQuoteChars,
    };
  },
});

/**
 * Check if AI usage is allowed for a source.
 */
export const checkAIUsageAllowed = internalQuery({
  args: {
    url: v.string(),
    usageType: v.union(
      v.literal("training"),
      v.literal("inference"),
      v.literal("citation"),
      v.literal("sentiment"),
      v.literal("derivative")
    ),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.string(),
    aiUsageMode: v.string(),
  }),
  handler: async (ctx, args) => {
    const domain = extractDomain(args.url);
    const policy = await ctx.runQuery(
      internal.domains.narrative.guards.contentRights.getPolicyForDomain,
      { domain }
    );

    if (!policy) {
      return {
        allowed: false,
        reason: `No policy found for ${domain}`,
        aiUsageMode: "prohibited",
      };
    }

    // Check based on usage type
    switch (args.usageType) {
      case "training":
        return {
          allowed: policy.aiUsageMode === "full",
          reason:
            policy.aiUsageMode === "full"
              ? "Training allowed"
              : `Training prohibited for ${domain}`,
          aiUsageMode: policy.aiUsageMode,
        };

      case "inference":
        return {
          allowed:
            policy.aiUsageMode === "full" ||
            policy.aiUsageMode === "inference_only",
          reason:
            policy.aiUsageMode === "full" ||
            policy.aiUsageMode === "inference_only"
              ? "Inference allowed"
              : `Inference prohibited for ${domain}`,
          aiUsageMode: policy.aiUsageMode,
        };

      case "citation":
        return {
          allowed: policy.aiUsageMode !== "prohibited",
          reason:
            policy.aiUsageMode !== "prohibited"
              ? "Citation allowed"
              : `All AI usage prohibited for ${domain}`,
          aiUsageMode: policy.aiUsageMode,
        };

      case "sentiment":
        return {
          allowed: policy.allowSentimentExtraction,
          reason: policy.allowSentimentExtraction
            ? "Sentiment extraction allowed"
            : `Sentiment extraction prohibited for ${domain}`,
          aiUsageMode: policy.aiUsageMode,
        };

      case "derivative":
        return {
          allowed: policy.allowDerivativeWorks,
          reason: policy.allowDerivativeWorks
            ? "Derivative works allowed"
            : `Derivative works prohibited for ${domain}`,
          aiUsageMode: policy.aiUsageMode,
        };

      default:
        return {
          allowed: false,
          reason: `Unknown usage type: ${args.usageType}`,
          aiUsageMode: policy.aiUsageMode,
        };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// POLICY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Seed default policies into database.
 */
export const seedDefaultPolicies = internalMutation({
  args: {},
  returns: v.object({
    created: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx) => {
    let created = 0;
    let skipped = 0;

    for (const [domain, policy] of Object.entries(DEFAULT_POLICIES)) {
      if (domain === "_default") continue;

      const existing = await ctx.db
        .query("contentRightsPolicies")
        .withIndex("by_domain", (q) => q.eq("domain", domain))
        .first();

      if (existing) {
        skipped++;
        continue;
      }

      await ctx.db.insert("contentRightsPolicies", policy);
      created++;
    }

    return { created, skipped };
  },
});

/**
 * Update policy for a domain.
 */
export const updatePolicy = internalMutation({
  args: {
    domain: v.string(),
    updates: v.object({
      storageMode: v.optional(v.string()),
      maxExcerptChars: v.optional(v.number()),
      ttlDays: v.optional(v.number()),
      renderingMode: v.optional(v.string()),
      maxQuoteChars: v.optional(v.number()),
      aiUsageMode: v.optional(v.string()),
      allowDerivativeWorks: v.optional(v.boolean()),
      allowSentimentExtraction: v.optional(v.boolean()),
      notes: v.optional(v.string()),
    }),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("contentRightsPolicies")
      .withIndex("by_domain", (q) => q.eq("domain", args.domain))
      .first();

    if (!existing) {
      return false;
    }

    await ctx.db.patch(existing._id, {
      ...args.updates,
      lastReviewedAt: Date.now(),
    });

    return true;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTENT EXPIRY (TTL ENFORCEMENT)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find expired content that needs deletion.
 */
export const findExpiredContent = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      artifactId: v.id("evidenceArtifacts"),
      domain: v.string(),
      ttlDays: v.number(),
      ageInDays: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const limit = args.limit || 100;
    const now = Date.now();

    // Get all evidence artifacts
    const artifacts = await ctx.db
      .query("evidenceArtifacts")
      .order("asc")
      .take(limit * 10); // Fetch more to filter

    const expired: Array<{
      artifactId: Id<"evidenceArtifacts">;
      domain: string;
      ttlDays: number;
      ageInDays: number;
    }> = [];

    for (const artifact of artifacts) {
      const domain = artifact.publisher.toLowerCase();
      const policy = await ctx.runQuery(
        internal.domains.narrative.guards.contentRights.getPolicyForDomain,
        { domain }
      );

      if (!policy) continue;

      const ageInMs = now - artifact.fetchedAt;
      const ageInDays = ageInMs / (1000 * 60 * 60 * 24);

      if (ageInDays > policy.ttlDays) {
        expired.push({
          artifactId: artifact._id,
          domain,
          ttlDays: policy.ttlDays,
          ageInDays: Math.floor(ageInDays),
        });

        if (expired.length >= limit) break;
      }
    }

    return expired;
  },
});

/**
 * Delete expired content (GDPR Article 17 compliance).
 */
export const deleteExpiredContent = internalMutation({
  args: {
    artifactIds: v.array(v.id("evidenceArtifacts")),
    reason: v.string(),
  },
  returns: v.object({
    deleted: v.number(),
    failed: v.number(),
  }),
  handler: async (ctx, args) => {
    let deleted = 0;
    let failed = 0;

    for (const id of args.artifactIds) {
      try {
        await ctx.db.delete(id);
        deleted++;
      } catch {
        failed++;
      }
    }

    console.log(
      `[ContentRights] Deleted ${deleted} expired artifacts. Reason: ${args.reason}`
    );

    return { deleted, failed };
  },
});
