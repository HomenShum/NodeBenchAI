/**
 * Context Enhancement Actions (Node.js Runtime)
 *
 * Contains actions that require Node.js runtime (AI model calls).
 * Queries and mutations are in contextEnhancement.ts
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { generateText } from "ai";
import { getLanguageModelSafe } from "../../domains/agents/mcp_tools/models";

/**
 * Enhance prompt with codebase context
 * Follows Augment Code pattern of automatic context injection
 */
export const enhanceWithCodebaseContext = internalAction({
  args: {
    userMessage: v.string(),
    userId: v.optional(v.id("users")),
    projectId: v.optional(v.string()),
  },
  returns: v.object({
    contextSummary: v.string(),
    recentPatterns: v.array(v.string()),
    techStack: v.array(v.string()),
    hasContext: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (!args.userId) {
      return {
        contextSummary: "",
        recentPatterns: [],
        techStack: [],
        hasContext: false,
      };
    }

    const project = await ctx.runQuery(
      internal.tools.meta.contextEnhancement.getProjectContext,
      {
        userId: args.userId,
        projectId: args.projectId,
      }
    );

    if (!project) {
      return {
        contextSummary: "",
        recentPatterns: [],
        techStack: [],
        hasContext: false,
      };
    }

    // Build concise context summary
    const recentCommitSummary = project.recentCommits.slice(0, 3)
      .map(c => `- ${c.message} (${c.filesChanged.length} files)`)
      .join('\n');

    const contextSummary = `# Codebase Context

**Project:** ${project.name}
**Tech Stack:** ${project.techStack.join(", ")}
**Branch:** ${project.currentBranch ?? "unknown"}

**Recent Changes:**
${recentCommitSummary || "None"}

**Common Patterns:**
${project.commonPatterns.slice(0, 5).map(p => `- ${p}`).join('\n')}

${project.styleGuide ? `**Style Guide:** ${project.styleGuide.summary}` : ""}

${project.fileStructure ? `**Project Structure:** ${project.fileStructure.keyDirectories.join(", ")} (${project.fileStructure.totalFiles} files)` : ""}

${project.activeFiles?.length ? `**Active Files:** ${project.activeFiles.slice(0, 3).join(", ")}` : ""}
`;

    return {
      contextSummary,
      recentPatterns: project.commonPatterns,
      techStack: project.techStack,
      hasContext: true,
    };
  },
});

/**
 * Detect project-specific conventions from user message
 * Uses AI to infer what patterns/conventions are relevant
 */
export const detectRelevantConventions = internalAction({
  args: {
    userMessage: v.string(),
    availablePatterns: v.array(v.string()),
    techStack: v.array(v.string()),
  },
  returns: v.object({
    relevantPatterns: v.array(v.object({
      pattern: v.string(),
      relevance: v.string(),
    })),
  }),
  handler: async (ctx, args) => {
    if (args.availablePatterns.length === 0) {
      return { relevantPatterns: [] };
    }

    const metaModel = getLanguageModelSafe("gemini-3-flash-preview");

    const prompt = `User request: "${args.userMessage}"

Tech Stack: ${args.techStack.join(", ")}

Available Patterns/Conventions:
${args.availablePatterns.map((p, idx) => `${idx + 1}. ${p}`).join('\n')}

Which of these patterns are relevant to the user's request?

Return JSON:
{
  "relevantPatterns": [
    {
      "pattern": "exact pattern text",
      "relevance": "why this pattern matters for this request"
    }
  ]
}

Only include patterns that directly apply to the user's request.`;

    try {
      const result = await generateText({
        model: metaModel,
        prompt,
        temperature: 0.2,
        maxRetries: 2,
      });

      const parsed = JSON.parse(result.text.trim());
      return {
        relevantPatterns: parsed.relevantPatterns || [],
      };
    } catch (error) {
      console.error("[contextEnhancement] Convention detection failed:", error);
      return { relevantPatterns: [] };
    }
  },
});
