// convex/domains/knowledge/sourceRegistry.ts
// Source Registry for authoritative source curation with trust metadata
// Part of the Knowledge Product Layer (Phase 1)

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "../../_generated/dataModel";

// ============================================================================
// Types
// ============================================================================

export type SourceCategory =
  | "official_docs"
  | "prompt_library"
  | "changelog"
  | "github_repo"
  | "pricing"
  | "api_reference"
  | "newsletter"
  | "observability"
  | "framework_docs";

export type ReliabilityTier = "authoritative" | "reliable" | "secondary";

export type RefreshCadence = "hourly" | "daily" | "weekly" | "manual";

export type UsageConstraint =
  | "internal_only"
  | "shareable_with_attribution"
  | "public_domain";

export interface SourceRegistryEntry {
  registryId: string;
  domain: string;
  canonicalUrl: string;
  name: string;
  category: SourceCategory;
  trustRationale: string;
  reliabilityTier: ReliabilityTier;
  refreshCadence: RefreshCadence;
  lastFetchedAt?: number;
  lastChangedAt?: number;
  currentContentHash?: string;
  usageConstraints: UsageConstraint;
  isActive: boolean;
  isPinned: boolean;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a deterministic registry ID from domain and slug
 */
export function generateRegistryId(domain: string, slug: string): string {
  const cleanDomain = domain.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9]/g, "_");
  return `sr_${cleanDomain}_${cleanSlug}`;
}

/**
 * Extract domain from URL
 */
function extractDomainFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Register a new authoritative source
 */
export const registerSource = mutation({
  args: {
    domain: v.string(),
    canonicalUrl: v.string(),
    name: v.string(),
    category: v.union(
      v.literal("official_docs"),
      v.literal("prompt_library"),
      v.literal("changelog"),
      v.literal("github_repo"),
      v.literal("pricing"),
      v.literal("api_reference"),
      v.literal("newsletter"),
      v.literal("observability"),
      v.literal("framework_docs")
    ),
    trustRationale: v.string(),
    reliabilityTier: v.union(
      v.literal("authoritative"),
      v.literal("reliable"),
      v.literal("secondary")
    ),
    refreshCadence: v.union(
      v.literal("hourly"),
      v.literal("daily"),
      v.literal("weekly"),
      v.literal("manual")
    ),
    usageConstraints: v.union(
      v.literal("internal_only"),
      v.literal("shareable_with_attribution"),
      v.literal("public_domain")
    ),
    isPinned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Generate slug from name
    const slug = args.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 50);
    const registryId = generateRegistryId(args.domain, slug);
    const now = Date.now();

    // Check for existing entry
    const existing = await ctx.db
      .query("sourceRegistry")
      .withIndex("by_registryId", (q) => q.eq("registryId", registryId))
      .first();

    if (existing) {
      // Update existing entry
      await ctx.db.patch(existing._id, {
        canonicalUrl: args.canonicalUrl,
        name: args.name,
        category: args.category,
        trustRationale: args.trustRationale,
        reliabilityTier: args.reliabilityTier,
        refreshCadence: args.refreshCadence,
        usageConstraints: args.usageConstraints,
        isPinned: args.isPinned ?? existing.isPinned,
        isActive: true,
        updatedAt: now,
      });

      console.log(`[sourceRegistry] Updated source: ${args.name} (${registryId})`);
      return existing._id;
    }

    // Create new entry
    const id = await ctx.db.insert("sourceRegistry", {
      registryId,
      domain: args.domain,
      canonicalUrl: args.canonicalUrl,
      name: args.name,
      category: args.category,
      trustRationale: args.trustRationale,
      reliabilityTier: args.reliabilityTier,
      refreshCadence: args.refreshCadence,
      usageConstraints: args.usageConstraints,
      isActive: true,
      isPinned: args.isPinned ?? false,
      createdAt: now,
      updatedAt: now,
    });

    console.log(`[sourceRegistry] Registered new source: ${args.name} (${registryId})`);
    return id;
  },
});

/**
 * Bulk register multiple sources (for initial seeding)
 */
export const bulkRegisterSources = mutation({
  args: {
    sources: v.array(v.object({
      domain: v.string(),
      canonicalUrl: v.string(),
      name: v.string(),
      category: v.union(
        v.literal("official_docs"),
        v.literal("prompt_library"),
        v.literal("changelog"),
        v.literal("github_repo"),
        v.literal("pricing"),
        v.literal("api_reference"),
        v.literal("newsletter"),
        v.literal("observability"),
        v.literal("framework_docs")
      ),
      trustRationale: v.string(),
      reliabilityTier: v.union(
        v.literal("authoritative"),
        v.literal("reliable"),
        v.literal("secondary")
      ),
      refreshCadence: v.union(
        v.literal("hourly"),
        v.literal("daily"),
        v.literal("weekly"),
        v.literal("manual")
      ),
      usageConstraints: v.union(
        v.literal("internal_only"),
        v.literal("shareable_with_attribution"),
        v.literal("public_domain")
      ),
      isPinned: v.optional(v.boolean()),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const results: { registryId: string; status: "created" | "updated" }[] = [];

    for (const source of args.sources) {
      const slug = source.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 50);
      const registryId = generateRegistryId(source.domain, slug);

      const existing = await ctx.db
        .query("sourceRegistry")
        .withIndex("by_registryId", (q) => q.eq("registryId", registryId))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          canonicalUrl: source.canonicalUrl,
          name: source.name,
          category: source.category,
          trustRationale: source.trustRationale,
          reliabilityTier: source.reliabilityTier,
          refreshCadence: source.refreshCadence,
          usageConstraints: source.usageConstraints,
          isPinned: source.isPinned ?? existing.isPinned,
          isActive: true,
          updatedAt: now,
        });
        results.push({ registryId, status: "updated" });
      } else {
        await ctx.db.insert("sourceRegistry", {
          registryId,
          domain: source.domain,
          canonicalUrl: source.canonicalUrl,
          name: source.name,
          category: source.category,
          trustRationale: source.trustRationale,
          reliabilityTier: source.reliabilityTier,
          refreshCadence: source.refreshCadence,
          usageConstraints: source.usageConstraints,
          isActive: true,
          isPinned: source.isPinned ?? false,
          createdAt: now,
          updatedAt: now,
        });
        results.push({ registryId, status: "created" });
      }
    }

    console.log(`[sourceRegistry] Bulk registered ${results.length} sources`);
    return results;
  },
});

/**
 * Update source freshness after fetching
 */
export const updateSourceFreshness = internalMutation({
  args: {
    registryId: v.string(),
    contentHash: v.string(),
    changed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const source = await ctx.db
      .query("sourceRegistry")
      .withIndex("by_registryId", (q) => q.eq("registryId", args.registryId))
      .first();

    if (!source) {
      console.warn(`[sourceRegistry] Source not found: ${args.registryId}`);
      return null;
    }

    await ctx.db.patch(source._id, {
      lastFetchedAt: now,
      currentContentHash: args.contentHash,
      ...(args.changed ? { lastChangedAt: now } : {}),
      updatedAt: now,
    });

    return source._id;
  },
});

/**
 * Toggle source pinned status
 */
export const togglePinned = mutation({
  args: {
    registryId: v.string(),
    isPinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db
      .query("sourceRegistry")
      .withIndex("by_registryId", (q) => q.eq("registryId", args.registryId))
      .first();

    if (!source) {
      throw new Error(`Source not found: ${args.registryId}`);
    }

    await ctx.db.patch(source._id, {
      isPinned: args.isPinned,
      updatedAt: Date.now(),
    });

    return source._id;
  },
});

/**
 * Deactivate a source (soft delete)
 */
export const deactivateSource = mutation({
  args: {
    registryId: v.string(),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db
      .query("sourceRegistry")
      .withIndex("by_registryId", (q) => q.eq("registryId", args.registryId))
      .first();

    if (!source) {
      throw new Error(`Source not found: ${args.registryId}`);
    }

    await ctx.db.patch(source._id, {
      isActive: false,
      updatedAt: Date.now(),
    });

    return source._id;
  },
});

// ============================================================================
// Queries
// ============================================================================

/**
 * Get a source by registry ID
 */
export const getSource = query({
  args: {
    registryId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sourceRegistry")
      .withIndex("by_registryId", (q) => q.eq("registryId", args.registryId))
      .first();
  },
});

/**
 * Get all sources for a domain
 */
export const getRegistryForDomain = query({
  args: {
    domain: v.string(),
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("sourceRegistry")
      .withIndex("by_domain", (q) => q.eq("domain", args.domain));

    const sources = await query.collect();

    if (args.activeOnly !== false) {
      return sources.filter((s) => s.isActive);
    }

    return sources;
  },
});

/**
 * Get all pinned sources (optionally filtered by domain)
 */
export const getPinnedSources = query({
  args: {
    domain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.domain) {
      return await ctx.db
        .query("sourceRegistry")
        .withIndex("by_pinned", (q) => q.eq("isPinned", true).eq("domain", args.domain))
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect();
    }

    // All pinned sources across all domains
    const allSources = await ctx.db
      .query("sourceRegistry")
      .filter((q) =>
        q.and(
          q.eq(q.field("isPinned"), true),
          q.eq(q.field("isActive"), true)
        )
      )
      .collect();

    return allSources;
  },
});

/**
 * Get all active sources
 */
export const getAllActiveSources = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("sourceRegistry")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

/**
 * Get sources by category
 */
export const getSourcesByCategory = query({
  args: {
    category: v.union(
      v.literal("official_docs"),
      v.literal("prompt_library"),
      v.literal("changelog"),
      v.literal("github_repo"),
      v.literal("pricing"),
      v.literal("api_reference"),
      v.literal("newsletter"),
      v.literal("observability"),
      v.literal("framework_docs")
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sourceRegistry")
      .withIndex("by_category", (q) => q.eq("category", args.category))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

/**
 * Check source freshness - returns sources that need refresh
 */
export const checkSourceFreshness = query({
  args: {
    domain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    const WEEK = 7 * DAY;

    let sources;
    if (args.domain) {
      sources = await ctx.db
        .query("sourceRegistry")
        .withIndex("by_domain", (q) => q.eq("domain", args.domain))
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect();
    } else {
      sources = await ctx.db
        .query("sourceRegistry")
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect();
    }

    const stale: Array<{
      registryId: string;
      name: string;
      refreshCadence: RefreshCadence;
      lastFetchedAt?: number;
      staleDuration: number;
    }> = [];

    for (const source of sources) {
      const lastFetched = source.lastFetchedAt ?? 0;
      const age = now - lastFetched;

      let isStale = false;
      let staleDuration = 0;

      switch (source.refreshCadence) {
        case "hourly":
          if (age > HOUR) {
            isStale = true;
            staleDuration = age - HOUR;
          }
          break;
        case "daily":
          if (age > DAY) {
            isStale = true;
            staleDuration = age - DAY;
          }
          break;
        case "weekly":
          if (age > WEEK) {
            isStale = true;
            staleDuration = age - WEEK;
          }
          break;
        case "manual":
          // Manual sources are never considered stale automatically
          break;
      }

      if (isStale) {
        stale.push({
          registryId: source.registryId,
          name: source.name,
          refreshCadence: source.refreshCadence,
          lastFetchedAt: source.lastFetchedAt,
          staleDuration,
        });
      }
    }

    // Sort by staleness (most stale first)
    return stale.sort((a, b) => b.staleDuration - a.staleDuration);
  },
});

/**
 * Get sources due for refresh (internal query for cron)
 */
export const getSourcesDueForRefresh = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    const WEEK = 7 * DAY;

    const sources = await ctx.db
      .query("sourceRegistry")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    const due: Doc<"sourceRegistry">[] = [];

    for (const source of sources) {
      const lastFetched = source.lastFetchedAt ?? 0;
      const age = now - lastFetched;

      let isDue = false;

      switch (source.refreshCadence) {
        case "hourly":
          isDue = age > HOUR;
          break;
        case "daily":
          isDue = age > DAY;
          break;
        case "weekly":
          isDue = age > WEEK;
          break;
        case "manual":
          isDue = false;
          break;
      }

      if (isDue) {
        due.push(source);
      }
    }

    return due;
  },
});

/**
 * Get registry statistics
 */
export const getRegistryStats = query({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db
      .query("sourceRegistry")
      .collect();

    const active = sources.filter((s) => s.isActive);
    const pinned = sources.filter((s) => s.isPinned && s.isActive);

    // Group by domain
    const byDomain: Record<string, number> = {};
    for (const s of active) {
      byDomain[s.domain] = (byDomain[s.domain] || 0) + 1;
    }

    // Group by category
    const byCategory: Record<string, number> = {};
    for (const s of active) {
      byCategory[s.category] = (byCategory[s.category] || 0) + 1;
    }

    // Group by reliability
    const byReliability: Record<string, number> = {};
    for (const s of active) {
      byReliability[s.reliabilityTier] = (byReliability[s.reliabilityTier] || 0) + 1;
    }

    return {
      total: sources.length,
      active: active.length,
      inactive: sources.length - active.length,
      pinned: pinned.length,
      byDomain,
      byCategory,
      byReliability,
    };
  },
});

// ============================================================================
// Initial Source Seeding Data
// ============================================================================

/**
 * Full Stack source registry data for initial seeding
 * Includes: Core AI Labs + Frameworks + Newsletters + Observability
 */
export const INITIAL_SOURCES: Array<{
  domain: string;
  canonicalUrl: string;
  name: string;
  category: SourceCategory;
  trustRationale: string;
  reliabilityTier: ReliabilityTier;
  refreshCadence: RefreshCadence;
  usageConstraints: UsageConstraint;
  isPinned?: boolean;
}> = [
  // ==================== ANTHROPIC ====================
  {
    domain: "anthropic",
    canonicalUrl: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-library",
    name: "Claude Prompt Library",
    category: "prompt_library",
    trustRationale: "Official Anthropic documentation - primary source for Claude prompting patterns",
    reliabilityTier: "authoritative",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
    isPinned: true,
  },
  {
    domain: "anthropic",
    canonicalUrl: "https://docs.anthropic.com/en/docs/build-with-claude/tool-use",
    name: "Claude Tool Use Guide",
    category: "official_docs",
    trustRationale: "Official Anthropic documentation for tool/function calling",
    reliabilityTier: "authoritative",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
    isPinned: true,
  },
  {
    domain: "anthropic",
    canonicalUrl: "https://docs.anthropic.com/en/api/getting-started",
    name: "Claude API Reference",
    category: "api_reference",
    trustRationale: "Official Anthropic API documentation",
    reliabilityTier: "authoritative",
    refreshCadence: "daily",
    usageConstraints: "shareable_with_attribution",
  },
  {
    domain: "anthropic",
    canonicalUrl: "https://www.anthropic.com/news",
    name: "Anthropic News & Changelog",
    category: "changelog",
    trustRationale: "Official Anthropic announcements and updates",
    reliabilityTier: "authoritative",
    refreshCadence: "daily",
    usageConstraints: "shareable_with_attribution",
    isPinned: true,
  },
  {
    domain: "anthropic",
    canonicalUrl: "https://www.anthropic.com/pricing",
    name: "Anthropic Pricing",
    category: "pricing",
    trustRationale: "Official pricing page",
    reliabilityTier: "authoritative",
    refreshCadence: "daily",
    usageConstraints: "shareable_with_attribution",
  },

  // ==================== OPENAI ====================
  {
    domain: "openai",
    canonicalUrl: "https://platform.openai.com/docs/guides/function-calling",
    name: "OpenAI Function Calling",
    category: "official_docs",
    trustRationale: "Official OpenAI documentation for function calling",
    reliabilityTier: "authoritative",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
    isPinned: true,
  },
  {
    domain: "openai",
    canonicalUrl: "https://platform.openai.com/docs/guides/reasoning",
    name: "OpenAI Reasoning Models",
    category: "official_docs",
    trustRationale: "Official OpenAI documentation for o1/reasoning models",
    reliabilityTier: "authoritative",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
    isPinned: true,
  },
  {
    domain: "openai",
    canonicalUrl: "https://cookbook.openai.com/",
    name: "OpenAI Cookbook",
    category: "prompt_library",
    trustRationale: "Official OpenAI example repository",
    reliabilityTier: "authoritative",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
  },
  {
    domain: "openai",
    canonicalUrl: "https://platform.openai.com/docs/changelog",
    name: "OpenAI Changelog",
    category: "changelog",
    trustRationale: "Official OpenAI platform changelog",
    reliabilityTier: "authoritative",
    refreshCadence: "daily",
    usageConstraints: "shareable_with_attribution",
    isPinned: true,
  },
  {
    domain: "openai",
    canonicalUrl: "https://openai.com/api/pricing/",
    name: "OpenAI Pricing",
    category: "pricing",
    trustRationale: "Official pricing page",
    reliabilityTier: "authoritative",
    refreshCadence: "daily",
    usageConstraints: "shareable_with_attribution",
  },

  // ==================== GOOGLE / GEMINI ====================
  {
    domain: "gemini",
    canonicalUrl: "https://ai.google.dev/gemini-api/docs",
    name: "Gemini API Documentation",
    category: "official_docs",
    trustRationale: "Official Google AI documentation",
    reliabilityTier: "authoritative",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
    isPinned: true,
  },
  {
    domain: "gemini",
    canonicalUrl: "https://cloud.google.com/vertex-ai/docs",
    name: "Vertex AI Documentation",
    category: "official_docs",
    trustRationale: "Official Google Cloud Vertex AI documentation",
    reliabilityTier: "authoritative",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
  },
  {
    domain: "gemini",
    canonicalUrl: "https://ai.google.dev/gemini-api/docs/caching",
    name: "Gemini Context Caching",
    category: "official_docs",
    trustRationale: "Official documentation for Gemini context caching",
    reliabilityTier: "authoritative",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
  },
  {
    domain: "gemini",
    canonicalUrl: "https://ai.google.dev/pricing",
    name: "Gemini Pricing",
    category: "pricing",
    trustRationale: "Official Google AI pricing",
    reliabilityTier: "authoritative",
    refreshCadence: "daily",
    usageConstraints: "shareable_with_attribution",
  },

  // ==================== LANGCHAIN ====================
  {
    domain: "langchain",
    canonicalUrl: "https://python.langchain.com/docs/concepts/lcel/",
    name: "LangChain LCEL Documentation",
    category: "framework_docs",
    trustRationale: "Official LangChain Expression Language documentation",
    reliabilityTier: "authoritative",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
    isPinned: true,
  },
  {
    domain: "langchain",
    canonicalUrl: "https://docs.smith.langchain.com/",
    name: "LangSmith Documentation",
    category: "observability",
    trustRationale: "Official LangSmith evaluation and tracing documentation",
    reliabilityTier: "authoritative",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
    isPinned: true,
  },
  {
    domain: "langchain",
    canonicalUrl: "https://python.langchain.com/docs/how_to/#agents",
    name: "LangChain Agents Guide",
    category: "framework_docs",
    trustRationale: "Official LangChain agent patterns documentation",
    reliabilityTier: "authoritative",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
  },
  {
    domain: "langchain",
    canonicalUrl: "https://github.com/langchain-ai/langchain",
    name: "LangChain GitHub",
    category: "github_repo",
    trustRationale: "Official LangChain source repository",
    reliabilityTier: "authoritative",
    refreshCadence: "daily",
    usageConstraints: "shareable_with_attribution",
  },

  // ==================== LLAMAINDEX ====================
  {
    domain: "llamaindex",
    canonicalUrl: "https://docs.llamaindex.ai/en/stable/module_guides/workflow/",
    name: "LlamaIndex Workflows",
    category: "framework_docs",
    trustRationale: "Official LlamaIndex workflow documentation",
    reliabilityTier: "authoritative",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
    isPinned: true,
  },
  {
    domain: "llamaindex",
    canonicalUrl: "https://docs.llamaindex.ai/en/stable/module_guides/observability/",
    name: "LlamaIndex Observability",
    category: "observability",
    trustRationale: "Official LlamaIndex observability documentation",
    reliabilityTier: "authoritative",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
  },
  {
    domain: "llamaindex",
    canonicalUrl: "https://github.com/run-llama/llama_index",
    name: "LlamaIndex GitHub",
    category: "github_repo",
    trustRationale: "Official LlamaIndex source repository",
    reliabilityTier: "authoritative",
    refreshCadence: "daily",
    usageConstraints: "shareable_with_attribution",
  },

  // ==================== CREWAI ====================
  {
    domain: "crewai",
    canonicalUrl: "https://docs.crewai.com/",
    name: "CrewAI Documentation",
    category: "framework_docs",
    trustRationale: "Official CrewAI multi-agent framework documentation",
    reliabilityTier: "authoritative",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
    isPinned: true,
  },
  {
    domain: "crewai",
    canonicalUrl: "https://github.com/crewAIInc/crewAI",
    name: "CrewAI GitHub",
    category: "github_repo",
    trustRationale: "Official CrewAI source repository",
    reliabilityTier: "authoritative",
    refreshCadence: "daily",
    usageConstraints: "shareable_with_attribution",
  },

  // ==================== MCP (Model Context Protocol) ====================
  {
    domain: "mcp",
    canonicalUrl: "https://spec.modelcontextprotocol.io/",
    name: "MCP Specification",
    category: "official_docs",
    trustRationale: "Official Model Context Protocol specification",
    reliabilityTier: "authoritative",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
    isPinned: true,
  },
  {
    domain: "mcp",
    canonicalUrl: "https://github.com/modelcontextprotocol",
    name: "MCP GitHub Organization",
    category: "github_repo",
    trustRationale: "Official MCP repositories",
    reliabilityTier: "authoritative",
    refreshCadence: "daily",
    usageConstraints: "shareable_with_attribution",
  },

  // ==================== NEWSLETTERS ====================
  {
    domain: "deeplearning_ai",
    canonicalUrl: "https://www.deeplearning.ai/the-batch/",
    name: "The Batch Newsletter",
    category: "newsletter",
    trustRationale: "DeepLearning.AI weekly AI newsletter by Andrew Ng",
    reliabilityTier: "reliable",
    refreshCadence: "weekly",
    usageConstraints: "shareable_with_attribution",
    isPinned: true,
  },
];

// ============================================================================
// Internal seeding (for dev/admin use)
// ============================================================================

/**
 * Idempotently seed the registry with `INITIAL_SOURCES`.
 * Intended for demos, local dev, and admin scripts.
 */
export const seedInitialSourcesInternal = internalMutation({
  args: {
    forceUpdate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const forceUpdate = args.forceUpdate ?? false;
    let created = 0;
    let updated = 0;

    for (const source of INITIAL_SOURCES) {
      const slug = source.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 50);
      const registryId = generateRegistryId(source.domain, slug);

      const existing = await ctx.db
        .query("sourceRegistry")
        .withIndex("by_registryId", (q) => q.eq("registryId", registryId))
        .first();

      if (existing) {
        if (forceUpdate) {
          await ctx.db.patch(existing._id, {
            canonicalUrl: source.canonicalUrl,
            name: source.name,
            category: source.category,
            trustRationale: source.trustRationale,
            reliabilityTier: source.reliabilityTier,
            refreshCadence: source.refreshCadence,
            usageConstraints: source.usageConstraints,
            isPinned: source.isPinned ?? existing.isPinned,
            isActive: true,
            updatedAt: now,
          });
          updated++;
        }
        continue;
      }

      await ctx.db.insert("sourceRegistry", {
        registryId,
        domain: source.domain,
        canonicalUrl: source.canonicalUrl,
        name: source.name,
        category: source.category,
        trustRationale: source.trustRationale,
        reliabilityTier: source.reliabilityTier,
        refreshCadence: source.refreshCadence,
        usageConstraints: source.usageConstraints,
        isActive: true,
        isPinned: source.isPinned ?? false,
        createdAt: now,
        updatedAt: now,
      });
      created++;
    }

    return {
      created,
      updated,
      totalSeeded: created + updated,
      forceUpdate,
    };
  },
});
