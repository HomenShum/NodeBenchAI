// convex/domains/mcp/mcpToolRegistry.ts
// MCP Tool Registry - Thin descriptors + on-demand schema hydration
// Implements progressive disclosure pattern for MCP tools (like built-in tools)

import { v } from "convex/values";
import { internalMutation, internalQuery, query, action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Doc, Id } from "../../_generated/dataModel";

// Simple hash function using Web Crypto (works in both runtimes)
async function sha256HexAsync(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ */
/* TYPES - Thin Descriptor + Schema interfaces                        */
/* ------------------------------------------------------------------ */

/**
 * Thin descriptor for MCP tools (~50 tokens each)
 * Used for tool discovery and search
 */
export interface MCPToolSummary {
  toolId: Id<"mcpTools">;
  serverId: Id<"mcpServers">;
  name: string;
  shortDescription: string;    // ≤100 chars for search context
  category: string;            // e.g., "filesystem", "database", "api"
  keywords: string[];          // Search keywords
  schemaHash: string | null;   // FK to mcpToolSchemas
  accessTier: "public" | "user" | "restricted";
  usageCount: number;
  lastUsed: number | null;
  isAvailable: boolean;
}

/**
 * Full schema for MCP tools (hydrated on-demand)
 */
export interface MCPToolSchema {
  toolId: Id<"mcpTools">;
  toolName: string;
  schemaHash: string;
  fullSchema: Record<string, unknown>;
  parametersCount: number;
  requiredParams: string[];
  cachedAt: number;
}

/**
 * Result of schema hydration
 */
export interface MCPSchemaHydrationResult {
  tool: MCPToolSummary;
  schema: MCPToolSchema | null;
  fromCache: boolean;
  hydrationLatencyMs: number;
}

/* ------------------------------------------------------------------ */
/* HELPERS - Schema processing utilities                              */
/* ------------------------------------------------------------------ */

/**
 * Generate short description from full description (≤100 chars)
 */
function generateShortDescription(description: string | undefined): string {
  if (!description) return "MCP tool";
  if (description.length <= 100) return description;
  return description.substring(0, 97) + "...";
}

/**
 * Infer category from tool name and description
 */
function inferCategory(name: string, description?: string): string {
  const combined = `${name} ${description || ""}`.toLowerCase();

  if (/file|read|write|directory|path|fs/.test(combined)) return "filesystem";
  if (/database|sql|query|table|db/.test(combined)) return "database";
  if (/http|api|fetch|request|url|web/.test(combined)) return "api";
  if (/search|find|lookup|query/.test(combined)) return "search";
  if (/git|github|commit|branch/.test(combined)) return "vcs";
  if (/slack|discord|email|message|notify/.test(combined)) return "communication";
  if (/docker|container|kubernetes|k8s/.test(combined)) return "devops";
  if (/llm|ai|model|embed|generate/.test(combined)) return "ai";
  if (/browser|chromium|puppeteer|playwright/.test(combined)) return "browser";

  return "general";
}

/**
 * Extract keywords from tool name and description
 */
function extractKeywords(name: string, description?: string): string[] {
  const combined = `${name} ${description || ""}`.toLowerCase();

  // Split on non-alphanumeric, filter short words
  const words = combined
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 2)
    .filter(w => !["the", "and", "for", "with", "from", "this", "that"].includes(w));

  // Deduplicate and limit
  return [...new Set(words)].slice(0, 10);
}

/**
 * Count parameters in JSON schema
 */
function countSchemaParameters(schema: Record<string, unknown>): number {
  const props = schema?.properties;
  if (typeof props !== "object" || props === null) return 0;
  return Object.keys(props).length;
}

/**
 * Extract required parameters from JSON schema
 */
function extractRequiredParams(schema: Record<string, unknown>): string[] {
  const required = schema?.required;
  if (!Array.isArray(required)) return [];
  return required.filter((r): r is string => typeof r === "string");
}

/* ------------------------------------------------------------------ */
/* QUERIES - Thin descriptor retrieval                                */
/* ------------------------------------------------------------------ */

/**
 * Get ALL available tools (for hybrid search)
 * Internal use only - used by hybrid search to get full dataset
 */
export const getAllAvailableTools = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("mcpTools")
      .filter(q => q.eq(q.field("isAvailable"), true))
      .collect();
  },
});

/**
 * Get thin descriptors for all available MCP tools
 * Returns ~50 tokens per tool for context-efficient search
 */
export const getMCPToolSummaries = query({
  args: {
    serverId: v.optional(v.id("mcpServers")),
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    toolId: v.id("mcpTools"),
    serverId: v.id("mcpServers"),
    name: v.string(),
    shortDescription: v.string(),
    category: v.string(),
    keywords: v.array(v.string()),
    schemaHash: v.union(v.string(), v.null()),
    accessTier: v.union(v.literal("public"), v.literal("user"), v.literal("restricted")),
    usageCount: v.number(),
    lastUsed: v.union(v.number(), v.null()),
    isAvailable: v.boolean(),
  })),
  handler: async (ctx, args): Promise<MCPToolSummary[]> => {
    const limit = args.limit ?? 50;

    let toolsQuery = ctx.db.query("mcpTools");

    if (args.serverId) {
      toolsQuery = toolsQuery.withIndex("by_server_available", q =>
        q.eq("serverId", args.serverId).eq("isAvailable", true)
      );
    } else if (args.category) {
      toolsQuery = toolsQuery.withIndex("by_category", q =>
        q.eq("category", args.category).eq("isAvailable", true)
      );
    }

    const tools = await toolsQuery.take(limit);

    return tools.map((tool): MCPToolSummary => ({
      toolId: tool._id,
      serverId: tool.serverId,
      name: tool.name,
      shortDescription: tool.shortDescription || generateShortDescription(tool.description),
      category: tool.category || inferCategory(tool.name, tool.description),
      keywords: tool.keywords || extractKeywords(tool.name, tool.description),
      schemaHash: tool.schemaHash || null,
      accessTier: tool.accessTier || "public",
      usageCount: tool.usageCount || 0,
      lastUsed: tool.lastUsed || null,
      isAvailable: tool.isAvailable,
    }));
  },
});

/**
 * Search MCP tools by query string
 * Uses keyword matching against name, shortDescription, and keywords
 */
export const searchMCPTools = query({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    toolId: v.id("mcpTools"),
    serverId: v.id("mcpServers"),
    name: v.string(),
    shortDescription: v.string(),
    category: v.string(),
    keywords: v.array(v.string()),
    schemaHash: v.union(v.string(), v.null()),
    accessTier: v.union(v.literal("public"), v.literal("user"), v.literal("restricted")),
    usageCount: v.number(),
    lastUsed: v.union(v.number(), v.null()),
    isAvailable: v.boolean(),
    matchScore: v.number(),
  })),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const queryLower = args.query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1);

    // Get all available tools
    const tools = await ctx.db
      .query("mcpTools")
      .filter(q => q.eq(q.field("isAvailable"), true))
      .collect();

    // Score each tool
    const scored = tools.map(tool => {
      let score = 0;
      const name = tool.name.toLowerCase();
      const desc = (tool.shortDescription || tool.description || "").toLowerCase();
      const keywords = (tool.keywords || []).map(k => k.toLowerCase());
      const category = (tool.category || "").toLowerCase();

      // Exact name match
      if (name === queryLower) score += 100;
      // Name contains query
      else if (name.includes(queryLower)) score += 50;

      // Term matching
      for (const term of queryTerms) {
        if (name.includes(term)) score += 20;
        if (desc.includes(term)) score += 10;
        if (keywords.includes(term)) score += 15;
        if (category === term) score += 25;
      }

      // Category filter
      if (args.category && category !== args.category.toLowerCase()) {
        return null; // Filter out
      }

      // Popularity boost
      score += Math.min((tool.usageCount || 0) * 0.1, 10);

      return {
        toolId: tool._id,
        serverId: tool.serverId,
        name: tool.name,
        shortDescription: tool.shortDescription || generateShortDescription(tool.description),
        category: tool.category || inferCategory(tool.name, tool.description),
        keywords: tool.keywords || extractKeywords(tool.name, tool.description),
        schemaHash: tool.schemaHash || null,
        accessTier: (tool.accessTier || "public") as "public" | "user" | "restricted",
        usageCount: tool.usageCount || 0,
        lastUsed: tool.lastUsed || null,
        isAvailable: tool.isAvailable,
        matchScore: score,
      };
    }).filter((t): t is NonNullable<typeof t> => t !== null && t.matchScore > 0);

    // Sort by score descending
    scored.sort((a, b) => b.matchScore - a.matchScore);

    return scored.slice(0, limit);
  },
});

/* ------------------------------------------------------------------ */
/* SCHEMA HYDRATION - On-demand full schema retrieval                 */
/* ------------------------------------------------------------------ */

/**
 * Get cached schema by hash
 */
export const getSchemaByHash = internalQuery({
  args: {
    schemaHash: v.string(),
  },
  returns: v.union(
    v.object({
      toolId: v.id("mcpTools"),
      toolName: v.string(),
      schemaHash: v.string(),
      fullSchema: v.any(),
      parametersCount: v.number(),
      requiredParams: v.array(v.string()),
      cachedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args): Promise<MCPToolSchema | null> => {
    const cached = await ctx.db
      .query("mcpToolSchemas")
      .withIndex("by_hash", q => q.eq("schemaHash", args.schemaHash))
      .first();

    if (!cached) return null;

    return {
      toolId: cached.toolId,
      toolName: cached.toolName,
      schemaHash: cached.schemaHash,
      fullSchema: cached.fullSchema as Record<string, unknown>,
      parametersCount: cached.parametersCount,
      requiredParams: cached.requiredParams,
      cachedAt: cached.cachedAt,
    };
  },
});

/**
 * Hydrate full schema for a tool (with caching)
 */
export const hydrateMCPToolSchema = action({
  args: {
    toolId: v.id("mcpTools"),
  },
  returns: v.object({
    tool: v.object({
      toolId: v.id("mcpTools"),
      serverId: v.id("mcpServers"),
      name: v.string(),
      shortDescription: v.string(),
      category: v.string(),
      keywords: v.array(v.string()),
      schemaHash: v.union(v.string(), v.null()),
      accessTier: v.union(v.literal("public"), v.literal("user"), v.literal("restricted")),
      usageCount: v.number(),
      lastUsed: v.union(v.number(), v.null()),
      isAvailable: v.boolean(),
    }),
    schema: v.union(
      v.object({
        toolId: v.id("mcpTools"),
        toolName: v.string(),
        schemaHash: v.string(),
        fullSchema: v.any(),
        parametersCount: v.number(),
        requiredParams: v.array(v.string()),
        cachedAt: v.number(),
      }),
      v.null()
    ),
    fromCache: v.boolean(),
    hydrationLatencyMs: v.number(),
  }),
  handler: async (ctx, args): Promise<MCPSchemaHydrationResult> => {
    const startTime = Date.now();

    // Get the tool
    const tool = await ctx.runQuery(internal.domains.mcp.mcpToolRegistry.getToolById, {
      toolId: args.toolId,
    });

    if (!tool) {
      throw new Error(`Tool not found: ${args.toolId}`);
    }

    const toolSummary: MCPToolSummary = {
      toolId: tool._id,
      serverId: tool.serverId,
      name: tool.name,
      shortDescription: tool.shortDescription || generateShortDescription(tool.description),
      category: tool.category || inferCategory(tool.name, tool.description),
      keywords: tool.keywords || extractKeywords(tool.name, tool.description),
      schemaHash: tool.schemaHash || null,
      accessTier: (tool.accessTier || "public") as "public" | "user" | "restricted",
      usageCount: tool.usageCount || 0,
      lastUsed: tool.lastUsed || null,
      isAvailable: tool.isAvailable,
    };

    // Check cache first
    if (tool.schemaHash) {
      const cached = await ctx.runQuery(internal.domains.mcp.mcpToolRegistry.getSchemaByHash, {
        schemaHash: tool.schemaHash,
      });

      if (cached) {
        return {
          tool: toolSummary,
          schema: cached,
          fromCache: true,
          hydrationLatencyMs: Date.now() - startTime,
        };
      }
    }

    // Fallback to legacy schema field
    if (tool.schema) {
      const schema = tool.schema as Record<string, unknown>;
      const schemaHash = await sha256HexAsync(JSON.stringify(schema));

      // Cache for future use
      await ctx.runMutation(internal.domains.mcp.mcpToolRegistry.cacheSchema, {
        toolId: args.toolId,
        serverId: tool.serverId,
        toolName: tool.name,
        schema,
        schemaHash,
      });

      const cachedSchema: MCPToolSchema = {
        toolId: args.toolId,
        toolName: tool.name,
        schemaHash,
        fullSchema: schema,
        parametersCount: countSchemaParameters(schema),
        requiredParams: extractRequiredParams(schema),
        cachedAt: Date.now(),
      };

      return {
        tool: toolSummary,
        schema: cachedSchema,
        fromCache: false,
        hydrationLatencyMs: Date.now() - startTime,
      };
    }

    // No schema available
    return {
      tool: toolSummary,
      schema: null,
      fromCache: false,
      hydrationLatencyMs: Date.now() - startTime,
    };
  },
});

/* ------------------------------------------------------------------ */
/* INTERNAL QUERIES AND MUTATIONS                                     */
/* ------------------------------------------------------------------ */

/**
 * Get tool by ID (internal)
 */
export const getToolById = internalQuery({
  args: {
    toolId: v.id("mcpTools"),
  },
  returns: v.union(
    v.object({
      _id: v.id("mcpTools"),
      serverId: v.id("mcpServers"),
      name: v.string(),
      description: v.optional(v.string()),
      schema: v.optional(v.any()),
      shortDescription: v.optional(v.string()),
      category: v.optional(v.string()),
      keywords: v.optional(v.array(v.string())),
      schemaHash: v.optional(v.string()),
      accessTier: v.optional(v.union(v.literal("public"), v.literal("user"), v.literal("restricted"))),
      usageCount: v.optional(v.number()),
      lastUsed: v.optional(v.number()),
      isAvailable: v.boolean(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const tool = await ctx.db.get(args.toolId);
    if (!tool) return null;

    return {
      _id: tool._id,
      serverId: tool.serverId,
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
      shortDescription: tool.shortDescription,
      category: tool.category,
      keywords: tool.keywords,
      schemaHash: tool.schemaHash,
      accessTier: tool.accessTier,
      usageCount: tool.usageCount,
      lastUsed: tool.lastUsed,
      isAvailable: tool.isAvailable,
    };
  },
});

/**
 * Cache schema (internal)
 */
export const cacheSchema = internalMutation({
  args: {
    toolId: v.id("mcpTools"),
    serverId: v.id("mcpServers"),
    toolName: v.string(),
    schema: v.any(),
    schemaHash: v.string(),
  },
  returns: v.id("mcpToolSchemas"),
  handler: async (ctx, args) => {
    const schema = args.schema as Record<string, unknown>;
    const now = Date.now();

    // Check if already cached
    const existing = await ctx.db
      .query("mcpToolSchemas")
      .withIndex("by_hash", q => q.eq("schemaHash", args.schemaHash))
      .first();

    if (existing) {
      return existing._id;
    }

    // Cache new schema
    const id = await ctx.db.insert("mcpToolSchemas", {
      toolId: args.toolId,
      serverId: args.serverId,
      toolName: args.toolName,
      schemaHash: args.schemaHash,
      fullSchema: schema,
      parametersCount: countSchemaParameters(schema),
      requiredParams: extractRequiredParams(schema),
      cachedAt: now,
    });

    // Update tool with schemaHash
    await ctx.db.patch(args.toolId, {
      schemaHash: args.schemaHash,
    });

    return id;
  },
});

/**
 * Update tool with thin descriptor fields (called during tool discovery)
 */
export const updateToolDescriptor = internalMutation({
  args: {
    toolId: v.id("mcpTools"),
    shortDescription: v.optional(v.string()),
    category: v.optional(v.string()),
    keywords: v.optional(v.array(v.string())),
    accessTier: v.optional(v.union(v.literal("public"), v.literal("user"), v.literal("restricted"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { toolId, ...updates } = args;

    // Filter out undefined values
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    if (Object.keys(filteredUpdates).length > 0) {
      await ctx.db.patch(toolId, {
        ...filteredUpdates,
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

/**
 * Invalidate cached schema (called on server reconnect or version bump)
 */
export const invalidateSchema = internalMutation({
  args: {
    toolId: v.id("mcpTools"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Find and delete cached schema
    const tool = await ctx.db.get(args.toolId);
    if (!tool?.schemaHash) return null;

    const cached = await ctx.db
      .query("mcpToolSchemas")
      .withIndex("by_hash", q => q.eq("schemaHash", tool.schemaHash!))
      .first();

    if (cached) {
      await ctx.db.delete(cached._id);
    }

    // Clear schemaHash on tool
    await ctx.db.patch(args.toolId, {
      schemaHash: undefined,
    });

    return null;
  },
});
