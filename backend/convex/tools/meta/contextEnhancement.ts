/**
 * Context Enhancement for Prompt Improvement
 *
 * Implements Augment Code pattern of injecting relevant codebase context:
 * - Project structure and tech stack
 * - Recent changes and commit history
 * - Common patterns and style guide
 * - Session state (active files, current branch)
 *
 * This context helps the meta-AI generate better, more specific instructions
 * that align with the user's actual development environment.
 */

import { v } from "convex/values";
import { internalAction, internalQuery, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";

/**
 * Get project context for a user
 */
export const getProjectContext = internalQuery({
  args: {
    userId: v.id("users"),
    projectId: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      projectId: v.string(),
      name: v.string(),
      techStack: v.array(v.string()),
      fileStructure: v.optional(v.object({
        rootPath: v.string(),
        keyDirectories: v.array(v.string()),
        totalFiles: v.number(),
      })),
      recentCommits: v.array(v.object({
        sha: v.string(),
        message: v.string(),
        author: v.string(),
        timestamp: v.number(),
        filesChanged: v.array(v.string()),
      })),
      commonPatterns: v.array(v.string()),
      styleGuide: v.optional(v.object({
        summary: v.string(),
        rules: v.array(v.string()),
      })),
      currentBranch: v.optional(v.string()),
      activeFiles: v.optional(v.array(v.string())),
      lastSyncedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    let query = ctx.db.query("projectContext").withIndex("by_user", q => q.eq("userId", args.userId));

    if (args.projectId) {
      const specificProject = await ctx.db
        .query("projectContext")
        .withIndex("by_project_id", q => q.eq("projectId", args.projectId))
        .first();

      if (specificProject && specificProject.userId === args.userId) {
        return specificProject;
      }
    }

    // Get most recently updated project
    const projects = await query.order("desc").take(1);
    return projects[0] ?? null;
  },
});

/**
 * Update project context (called by workspace sync)
 */
export const updateProjectContext = internalMutation({
  args: {
    userId: v.id("users"),
    projectId: v.string(),
    name: v.string(),
    techStack: v.array(v.string()),
    fileStructure: v.optional(v.object({
      rootPath: v.string(),
      keyDirectories: v.array(v.string()),
      totalFiles: v.number(),
    })),
    recentCommits: v.array(v.object({
      sha: v.string(),
      message: v.string(),
      author: v.string(),
      timestamp: v.number(),
      filesChanged: v.array(v.string()),
    })),
    commonPatterns: v.array(v.string()),
    styleGuide: v.optional(v.object({
      summary: v.string(),
      rules: v.array(v.string()),
    })),
    currentBranch: v.optional(v.string()),
    activeFiles: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projectContext")
      .withIndex("by_project_id", q => q.eq("projectId", args.projectId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        techStack: args.techStack,
        fileStructure: args.fileStructure,
        recentCommits: args.recentCommits,
        commonPatterns: args.commonPatterns,
        styleGuide: args.styleGuide,
        currentBranch: args.currentBranch,
        activeFiles: args.activeFiles,
        lastSyncedAt: now,
        updatedAt: now,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("projectContext", {
        userId: args.userId,
        projectId: args.projectId,
        name: args.name,
        techStack: args.techStack,
        fileStructure: args.fileStructure,
        recentCommits: args.recentCommits,
        commonPatterns: args.commonPatterns,
        styleGuide: args.styleGuide,
        currentBranch: args.currentBranch,
        activeFiles: args.activeFiles,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

//  NOTE: The following actions have been moved to contextEnhancementActions.ts
// because they require Node.js runtime:
// - enhanceWithCodebaseContext
// - detectRelevantConventions
