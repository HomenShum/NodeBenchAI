/**
 * Content Rights Policy Layer
 *
 * Enforces per-source storage modes, excerpt limits, TTLs, and rendering constraints.
 * This is a P0 ship blocker for legal/ToS compliance.
 *
 * Each source platform has explicit rules for:
 * - What can be stored (full text, excerpt, hash-only, metadata-only)
 * - How long it can be stored (TTL)
 * - How it can be rendered (direct quote, paraphrase, link-only)
 * - Whether AI can process/derive from it
 *
 * @module domains/narrative/policies/contentRights
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../../../_generated/server";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES & POLICY DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export type StorageMode =
  | "full_text"      // Can store complete content
  | "excerpt_only"   // Can store up to maxExcerptChars
  | "hash_metadata"  // Content hash + metadata only, no text
  | "link_only";     // Only URL reference allowed

export type RenderingMode =
  | "direct_quote"   // Can show verbatim text
  | "paraphrase"     // Must paraphrase, no direct quotes
  | "summary_only"   // Only summaries, no specific claims
  | "link_only";     // Only clickable link to original

export type AIUsageMode =
  | "full"           // Can use for training, inference, derivatives
  | "inference_only" // Can process but not train/store derivatives
  | "citation_only"  // Can cite but not process content
  | "prohibited";    // Cannot use for AI at all

export interface SourcePolicy {
  sourceId: string;
  displayName: string;
  domain: string;

  // Storage constraints
  storageMode: StorageMode;
  maxExcerptChars: number;        // 0 = unlimited (for full_text)
  ttlDays: number;                // 0 = indefinite
  requireAttribution: boolean;

  // Rendering constraints
  renderingMode: RenderingMode;
  maxQuoteChars: number;          // Max chars for any single quote
  requireLinkback: boolean;

  // AI usage constraints
  aiUsageMode: AIUsageMode;
  allowDerivativeWorks: boolean;  // Can agents create "summaries" etc?
  allowSentimentExtraction: boolean;

  // Legal/compliance
  tosUrl: string;
  lastReviewedAt: number;         // When was this policy last verified?
  notes: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT POLICIES (conservative interpretation of current ToS as of 2025)
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_POLICIES: Record<string, SourcePolicy> = {
  // X/Twitter - restrictive after 2023 ToS changes
  "twitter.com": {
    sourceId: "twitter",
    displayName: "X (Twitter)",
    domain: "twitter.com",
    storageMode: "hash_metadata",
    maxExcerptChars: 0,
    ttlDays: 30,
    requireAttribution: true,
    renderingMode: "link_only",
    maxQuoteChars: 0,
    requireLinkback: true,
    aiUsageMode: "citation_only",
    allowDerivativeWorks: false,
    allowSentimentExtraction: false,
    tosUrl: "https://twitter.com/tos",
    lastReviewedAt: Date.now(),
    notes: "X ToS restricts scraping/AI use. Link-only is safest.",
  },
  "x.com": {
    sourceId: "twitter",
    displayName: "X (Twitter)",
    domain: "x.com",
    storageMode: "hash_metadata",
    maxExcerptChars: 0,
    ttlDays: 30,
    requireAttribution: true,
    renderingMode: "link_only",
    maxQuoteChars: 0,
    requireLinkback: true,
    aiUsageMode: "citation_only",
    allowDerivativeWorks: false,
    allowSentimentExtraction: false,
    tosUrl: "https://x.com/tos",
    lastReviewedAt: Date.now(),
    notes: "X ToS restricts scraping/AI use. Link-only is safest.",
  },

  // Reddit - API changes in 2023, now restrictive
  "reddit.com": {
    sourceId: "reddit",
    displayName: "Reddit",
    domain: "reddit.com",
    storageMode: "excerpt_only",
    maxExcerptChars: 280,
    ttlDays: 90,
    requireAttribution: true,
    renderingMode: "paraphrase",
    maxQuoteChars: 140,
    requireLinkback: true,
    aiUsageMode: "inference_only",
    allowDerivativeWorks: false,
    allowSentimentExtraction: true,
    tosUrl: "https://www.redditinc.com/policies/user-agreement",
    lastReviewedAt: Date.now(),
    notes: "Reddit API changes restrict bulk access. Short excerpts OK for commentary.",
  },

  // Hacker News - relatively permissive for non-commercial
  "news.ycombinator.com": {
    sourceId: "hackernews",
    displayName: "Hacker News",
    domain: "news.ycombinator.com",
    storageMode: "excerpt_only",
    maxExcerptChars: 500,
    ttlDays: 365,
    requireAttribution: true,
    renderingMode: "direct_quote",
    maxQuoteChars: 280,
    requireLinkback: true,
    aiUsageMode: "inference_only",
    allowDerivativeWorks: true,
    allowSentimentExtraction: true,
    tosUrl: "https://news.ycombinator.com/newsguidelines.html",
    lastReviewedAt: Date.now(),
    notes: "HN is relatively permissive for analysis. Attribution required.",
  },

  // LinkedIn - very restrictive
  "linkedin.com": {
    sourceId: "linkedin",
    displayName: "LinkedIn",
    domain: "linkedin.com",
    storageMode: "hash_metadata",
    maxExcerptChars: 0,
    ttlDays: 7,
    requireAttribution: true,
    renderingMode: "link_only",
    maxQuoteChars: 0,
    requireLinkback: true,
    aiUsageMode: "prohibited",
    allowDerivativeWorks: false,
    allowSentimentExtraction: false,
    tosUrl: "https://www.linkedin.com/legal/user-agreement",
    lastReviewedAt: Date.now(),
    notes: "LinkedIn aggressively enforces anti-scraping. Metadata only.",
  },

  // News sites - generally fair use for commentary
  "reuters.com": {
    sourceId: "reuters",
    displayName: "Reuters",
    domain: "reuters.com",
    storageMode: "excerpt_only",
    maxExcerptChars: 300,
    ttlDays: 180,
    requireAttribution: true,
    renderingMode: "direct_quote",
    maxQuoteChars: 200,
    requireLinkback: true,
    aiUsageMode: "inference_only",
    allowDerivativeWorks: true,
    allowSentimentExtraction: true,
    tosUrl: "https://www.reuters.com/terms-of-use/",
    lastReviewedAt: Date.now(),
    notes: "Fair use for commentary. Short quotes OK.",
  },

  // Academic sources - generally permissive
  "arxiv.org": {
    sourceId: "arxiv",
    displayName: "arXiv",
    domain: "arxiv.org",
    storageMode: "full_text",
    maxExcerptChars: 0,
    ttlDays: 0,
    requireAttribution: true,
    renderingMode: "direct_quote",
    maxQuoteChars: 1000,
    requireLinkback: true,
    aiUsageMode: "full",
    allowDerivativeWorks: true,
    allowSentimentExtraction: true,
    tosUrl: "https://arxiv.org/help/policies",
    lastReviewedAt: Date.now(),
    notes: "Open access. Full use with attribution.",
  },

  // SEC filings - public domain
  "sec.gov": {
    sourceId: "sec",
    displayName: "SEC EDGAR",
    domain: "sec.gov",
    storageMode: "full_text",
    maxExcerptChars: 0,
    ttlDays: 0,
    requireAttribution: true,
    renderingMode: "direct_quote",
    maxQuoteChars: 0,
    requireLinkback: false,
    aiUsageMode: "full",
    allowDerivativeWorks: true,
    allowSentimentExtraction: true,
    tosUrl: "https://www.sec.gov/privacy",
    lastReviewedAt: Date.now(),
    notes: "Public domain government data. Full use allowed.",
  },

  // Default fallback - conservative
  "_default": {
    sourceId: "_default",
    displayName: "Unknown Source",
    domain: "_default",
    storageMode: "hash_metadata",
    maxExcerptChars: 0,
    ttlDays: 30,
    requireAttribution: true,
    renderingMode: "link_only",
    maxQuoteChars: 0,
    requireLinkback: true,
    aiUsageMode: "citation_only",
    allowDerivativeWorks: false,
    allowSentimentExtraction: false,
    tosUrl: "",
    lastReviewedAt: Date.now(),
    notes: "Unknown source - using most conservative policy.",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// POLICY LOOKUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "_default";
  }
}

/**
 * Get policy for a source URL
 */
export const getPolicyForUrl = internalQuery({
  args: {
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const domain = extractDomain(args.url);

    // Check for custom policy in DB first
    const customPolicy = await ctx.db
      .query("contentRightsPolicies")
      .withIndex("by_domain", q => q.eq("domain", domain))
      .first();

    if (customPolicy) {
      return customPolicy;
    }

    // Fall back to built-in defaults
    return DEFAULT_POLICIES[domain] || DEFAULT_POLICIES["_default"];
  },
});

/**
 * Get all policies for a list of URLs
 */
export const getPoliciesForUrls = internalQuery({
  args: {
    urls: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const policies: Record<string, SourcePolicy> = {};

    for (const url of args.urls) {
      const domain = extractDomain(url);
      if (!policies[domain]) {
        const customPolicy = await ctx.db
          .query("contentRightsPolicies")
          .withIndex("by_domain", q => q.eq("domain", domain))
          .first();

        policies[domain] = customPolicy || DEFAULT_POLICIES[domain] || DEFAULT_POLICIES["_default"];
      }
    }

    return policies;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// POLICY ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════

export interface ContentValidation {
  isValid: boolean;
  violations: string[];
  adjustedContent?: string;
  adjustedExcerpts?: string[];
}

/**
 * Validate content against source policy
 */
export const validateContent = internalQuery({
  args: {
    sourceUrl: v.string(),
    content: v.string(),
    excerpts: v.optional(v.array(v.string())),
    intendedUse: v.union(
      v.literal("storage"),
      v.literal("rendering"),
      v.literal("ai_processing")
    ),
  },
  handler: async (ctx, args): Promise<ContentValidation> => {
    const domain = extractDomain(args.sourceUrl);
    const customPolicy = await ctx.db
      .query("contentRightsPolicies")
      .withIndex("by_domain", q => q.eq("domain", domain))
      .first();

    const policy = customPolicy || DEFAULT_POLICIES[domain] || DEFAULT_POLICIES["_default"];
    const violations: string[] = [];
    let adjustedContent = args.content;
    const adjustedExcerpts: string[] = [];

    // Storage validation
    if (args.intendedUse === "storage") {
      if (policy.storageMode === "link_only") {
        violations.push(`${policy.displayName}: Only URL storage allowed, no content`);
        adjustedContent = "";
      } else if (policy.storageMode === "hash_metadata") {
        violations.push(`${policy.displayName}: Only hash+metadata allowed, content will be hashed`);
        adjustedContent = "";
      } else if (policy.storageMode === "excerpt_only") {
        if (args.content.length > policy.maxExcerptChars) {
          violations.push(`${policy.displayName}: Content exceeds ${policy.maxExcerptChars} char limit`);
          adjustedContent = args.content.slice(0, policy.maxExcerptChars) + "...";
        }
      }
    }

    // Rendering validation
    if (args.intendedUse === "rendering") {
      if (policy.renderingMode === "link_only") {
        violations.push(`${policy.displayName}: Only link rendering allowed`);
        adjustedContent = "";
      } else if (policy.renderingMode === "summary_only") {
        violations.push(`${policy.displayName}: Only summaries allowed, no specific claims`);
      }

      // Check quote lengths
      if (args.excerpts) {
        for (const excerpt of args.excerpts) {
          if (excerpt.length > policy.maxQuoteChars && policy.maxQuoteChars > 0) {
            violations.push(`${policy.displayName}: Quote exceeds ${policy.maxQuoteChars} char limit`);
            adjustedExcerpts.push(excerpt.slice(0, policy.maxQuoteChars) + "...");
          } else {
            adjustedExcerpts.push(excerpt);
          }
        }
      }
    }

    // AI processing validation
    if (args.intendedUse === "ai_processing") {
      if (policy.aiUsageMode === "prohibited") {
        violations.push(`${policy.displayName}: AI processing prohibited`);
      } else if (policy.aiUsageMode === "citation_only") {
        violations.push(`${policy.displayName}: AI can only cite, not process content`);
      }

      if (!policy.allowDerivativeWorks && args.intendedUse === "ai_processing") {
        violations.push(`${policy.displayName}: Derivative works (summaries, analysis) not allowed`);
      }
    }

    return {
      isValid: violations.length === 0,
      violations,
      adjustedContent: adjustedContent !== args.content ? adjustedContent : undefined,
      adjustedExcerpts: adjustedExcerpts.length > 0 ? adjustedExcerpts : undefined,
    };
  },
});

/**
 * Check if content should be purged (TTL expired)
 */
export const checkTTLExpiry = internalQuery({
  args: {
    sourceUrl: v.string(),
    storedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const domain = extractDomain(args.sourceUrl);
    const customPolicy = await ctx.db
      .query("contentRightsPolicies")
      .withIndex("by_domain", q => q.eq("domain", domain))
      .first();

    const policy = customPolicy || DEFAULT_POLICIES[domain] || DEFAULT_POLICIES["_default"];

    if (policy.ttlDays === 0) {
      return { expired: false, ttlDays: 0 };
    }

    const expiryTime = args.storedAt + (policy.ttlDays * 24 * 60 * 60 * 1000);
    const expired = Date.now() > expiryTime;

    return {
      expired,
      ttlDays: policy.ttlDays,
      expiresAt: expiryTime,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// POLICY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add or update a custom policy
 */
export const upsertPolicy = internalMutation({
  args: {
    domain: v.string(),
    policy: v.object({
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
      notes: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("contentRightsPolicies")
      .withIndex("by_domain", q => q.eq("domain", args.domain))
      .first();

    const policyData = {
      ...args.policy,
      domain: args.domain,
      lastReviewedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, policyData);
      return existing._id;
    } else {
      return await ctx.db.insert("contentRightsPolicies", policyData);
    }
  },
});

/**
 * Get default policies (for admin UI)
 */
export const getDefaultPolicies = internalQuery({
  args: {},
  handler: async () => {
    return DEFAULT_POLICIES;
  },
});
