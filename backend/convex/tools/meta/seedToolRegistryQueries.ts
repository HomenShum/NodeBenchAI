/**
 * Seed Tool Registry Queries/Mutations (Convex Runtime)
 *
 * Contains queries and mutations that run in Convex runtime.
 * Actions that require Node.js are in seedToolRegistry.ts
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION QUERY
// ═══════════════════════════════════════════════════════════════════════════

export const validateToolsHaveEmbeddings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const allTools = await ctx.db.query("toolRegistry").collect() as Doc<"toolRegistry">[];
    const withEmbeddings = allTools.filter(
      (t: Doc<"toolRegistry">) => t.embedding && t.embedding.length === 1536
    );
    const withoutEmbeddings = allTools
      .filter((t: Doc<"toolRegistry">) => !t.embedding || t.embedding.length !== 1536)
      .map((t: Doc<"toolRegistry">) => t.toolName);
    // Build category counts
    const categoryMap = new Map<string, number>();
    for (const t of allTools) {
      categoryMap.set(t.category, (categoryMap.get(t.category) || 0) + 1);
    }

    return {
      total: allTools.length,
      withEmbeddings: withEmbeddings.length,
      withoutEmbeddings,
      categories: Object.fromEntries(categoryMap),
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// UPSERT SINGLE TOOL
// ═══════════════════════════════════════════════════════════════════════════

export const upsertTool = internalMutation({
  args: {
    toolName: v.string(),
    description: v.string(),
    keywords: v.array(v.string()),
    category: v.string(),
    categoryName: v.string(),
    module: v.string(),
    examples: v.optional(v.array(v.string())),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("toolRegistry")
      .withIndex("by_toolName", (q) => q.eq("toolName", args.toolName))
      .first() as Doc<"toolRegistry"> | null;
    const data = {
      toolName: args.toolName,
      description: args.description,
      keywords: args.keywords,
      keywordsText: args.keywords.join(" "),
      category: args.category,
      categoryName: args.categoryName,
      module: args.module,
      examples: args.examples,
      embedding: args.embedding,
      usageCount: existing?.usageCount ?? 0,
      isEnabled: true,
    };
    if (existing) {
      await ctx.db.patch(existing._id, data);
      return { action: "updated" as const, toolName: args.toolName };
    } else {
      await ctx.db.insert("toolRegistry", data);
      return { action: "inserted" as const, toolName: args.toolName };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE TOOL EMBEDDING
// ═══════════════════════════════════════════════════════════════════════════

export const updateToolEmbedding = internalMutation({
  args: {
    toolName: v.string(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    const tool = await ctx.db
      .query("toolRegistry")
      .withIndex("by_toolName", (q) => q.eq("toolName", args.toolName))
      .first() as Doc<"toolRegistry"> | null;
    if (tool) {
      await ctx.db.patch(tool._id, { embedding: args.embedding });
      return true;
    }
    return false;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// GET TOOL DETAILS (for describeTools meta-tool)
// ═══════════════════════════════════════════════════════════════════════════

export const getToolDetails = internalQuery({
  args: {
    toolNames: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const results = await Promise.all(
      args.toolNames.map(async (toolName: string) => {
        const tool = await ctx.db
          .query("toolRegistry")
          .withIndex("by_toolName", (q) => q.eq("toolName", toolName))
          .first() as Doc<"toolRegistry"> | null;
        if (!tool) return null;
        return {
          toolName: tool.toolName,
          description: tool.description,
          keywords: tool.keywords,
          category: tool.category,
          categoryName: tool.categoryName,
          module: tool.module,
          usageCount: tool.usageCount,
        };
      })
    );
    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// LIST CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════

export const listCategories = internalQuery({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("toolRegistry")
      .withIndex("by_enabled", (q) => q.eq("isEnabled", true))
      .collect() as Doc<"toolRegistry">[];
    const categoryMap = new Map<string, { name: string; count: number; tools: string[] }>();
    for (const tool of tools) {
      const existing = categoryMap.get(tool.category);
      if (existing) {
        existing.count++;
        existing.tools.push(tool.toolName);
      } else {
        categoryMap.set(tool.category, { name: tool.categoryName, count: 1, tools: [tool.toolName] });
      }
    }
    return Array.from(categoryMap.entries()).map(([key, value]) => ({
      categoryKey: key,
      categoryName: value.name,
      toolCount: value.count,
      tools: value.tools,
    }));
  },
});
