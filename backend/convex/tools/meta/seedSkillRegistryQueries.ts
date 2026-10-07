/**
 * Skill Registry Seeding - Convex Runtime Mutations
 *
 * Contains mutations that run in the Convex runtime (not Node.js).
 * The main seeding action is in seedSkillRegistry.ts (Node.js runtime).
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// SEEDING MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert a skill (create or update)
 */
export const upsertSkill = internalMutation({
  args: {
    name: v.string(),
    description: v.string(),
    fullInstructions: v.string(),
    category: v.string(),
    categoryName: v.string(),
    keywords: v.array(v.string()),
    keywordsText: v.string(),
    embedding: v.optional(v.array(v.float64())),
    allowedTools: v.optional(v.array(v.string())),
    license: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const existing = await ctx.db
      .query("skills")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first() as Doc<"skills"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        description: args.description,
        fullInstructions: args.fullInstructions,
        category: args.category,
        categoryName: args.categoryName,
        keywords: args.keywords,
        keywordsText: args.keywordsText,
        embedding: args.embedding,
        allowedTools: args.allowedTools,
        license: args.license,
        updatedAt: now,
      });
      return { skillId: existing._id, action: "updated" as const };
    }

    const skillId = await ctx.db.insert("skills", {
      name: args.name,
      description: args.description,
      fullInstructions: args.fullInstructions,
      category: args.category,
      categoryName: args.categoryName,
      keywords: args.keywords,
      keywordsText: args.keywordsText,
      embedding: args.embedding,
      allowedTools: args.allowedTools,
      license: args.license,
      usageCount: 0,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    });

    return { skillId, action: "created" as const };
  },
});

