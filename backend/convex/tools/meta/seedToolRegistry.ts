"use node";

/**
 * Seed Tool Registry Actions (Node.js Runtime)
 *
 * Contains actions that require Node.js (OpenAI embeddings).
 * Queries and mutations are in seedToolRegistryQueries.ts
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { toolSummaries, toolCategories, type ToolCategory } from "./toolRegistry";

// ═══════════════════════════════════════════════════════════════════════════
// SEED ALL TOOLS (Main Entry Point)
// ═══════════════════════════════════════════════════════════════════════════

export const seedAllTools = internalAction({
  args: {
    generateEmbeddings: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    inserted: number;
    updated: number;
    errors: string[];
    totalTools: number;
  }> => {
    const { generateEmbeddings = false } = args;
    let inserted = 0;
    let updated = 0;
    const errors: string[] = [];
    const toolEntries = Object.entries(toolSummaries);

    for (const [toolName, summary] of toolEntries) {
      try {
        let embedding: number[] | undefined;
        if (generateEmbeddings) {
          embedding = await ctx.runAction(
            internal.tools.meta.hybridSearch.generateToolEmbedding,
            { toolName, description: summary.description, keywords: summary.keywords }
          );
        }
        const categoryInfo = toolCategories[summary.category];
        const result = await ctx.runMutation(
          internal.tools.meta.seedToolRegistryQueries.upsertTool,
          {
            toolName,
            description: summary.description,
            keywords: summary.keywords,
            category: summary.category,
            categoryName: categoryInfo?.name || summary.category,
            module: summary.module,
            embedding,
          }
        );
        if (result.action === "inserted") inserted++;
        else updated++;
      } catch (error: any) {
        errors.push(`${toolName}: ${error.message}`);
      }
    }
    return { inserted, updated, errors, totalTools: toolEntries.length };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// GENERATE ALL EMBEDDINGS (Batch Processing)
// ═══════════════════════════════════════════════════════════════════════════

export const generateAllToolEmbeddings = internalAction({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    total: number;
    completed: number;
    failed: string[];
  }> => {
    const { batchSize = 10 } = args;
    const validation = await ctx.runQuery(
      internal.tools.meta.seedToolRegistryQueries.validateToolsHaveEmbeddings,
      {}
    );
    const toolsNeedingEmbeddings = validation.withoutEmbeddings;
    const failed: string[] = [];
    let completed = 0;

    for (let i = 0; i < toolsNeedingEmbeddings.length; i += batchSize) {
      const batch = toolsNeedingEmbeddings.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (toolName: string) => {
          const summary = toolSummaries[toolName];
          if (!summary) throw new Error(`Tool ${toolName} not found in summaries`);
          const embedding = await ctx.runAction(
            internal.tools.meta.hybridSearch.generateToolEmbedding,
            { toolName, description: summary.description, keywords: summary.keywords }
          );
          await ctx.runMutation(
            internal.tools.meta.seedToolRegistryQueries.updateToolEmbedding,
            { toolName, embedding }
          );
          return toolName;
        })
      );
      for (const result of results) {
        if (result.status === "fulfilled") completed++;
        else failed.push(result.reason?.message || "Unknown error");
      }
      if (i + batchSize < toolsNeedingEmbeddings.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    return { total: toolsNeedingEmbeddings.length, completed, failed };
  },
});

