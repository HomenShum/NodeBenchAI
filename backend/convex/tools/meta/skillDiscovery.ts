"use node";

/**
 * Skill Discovery System
 *
 * Uses Convex-native hybrid search (BM25 + vector) for skill discovery.
 * Based on Anthropic's Skills specification (v1.0, October 2025).
 *
 * Skills are multi-step workflows that combine tools for common tasks.
 * Progressive Disclosure Pattern:
 * 1. searchAvailableSkills - Hybrid search returning skill names + brief descriptions
 * 2. listSkillCategories - Browse skills by category
 * 3. describeSkill - Load full markdown instructions on-demand
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { v } from "convex/values";
import { ActionCtx, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import OpenAI from "openai";
import type { CachedSkillResult, SkillCategoryInfo } from "./skillDiscoveryQueries";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface HybridSkillResult {
  skillName: string;
  description: string;
  category: string;
  categoryName: string;
  score: number;
  matchType: "keyword" | "semantic" | "hybrid";
  keywordScore?: number;
  semanticScore?: number;
  usageCount?: number;
}

interface KeywordSearchItem {
  skillName: string;
  description: string;
  category: string;
  categoryName: string;
  usageCount: number;
  rank: number;
}

interface SemanticSearchItem {
  skillName: string;
  description: string;
  category: string;
  categoryName: string;
  usageCount: number;
  score: number;
}

interface RankedItem {
  skillName: string;
  score: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// RECIPROCAL RANK FUSION (RRF)
// ═══════════════════════════════════════════════════════════════════════════

function reciprocalRankFusion(
  rankedLists: Array<Array<RankedItem>>,
  k: number = 60
): RankedItem[] {
  const scoreMap = new Map<string, number>();
  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const rrfScore = 1 / (k + rank + 1);
      const current = scoreMap.get(item.skillName) || 0;
      scoreMap.set(item.skillName, current + rrfScore);
    }
  }
  return Array.from(scoreMap.entries())
    .map(([skillName, score]) => ({ skillName, score }))
    .sort((a, b) => b.score - a.score);
}

// ═══════════════════════════════════════════════════════════════════════════
// HYBRID SEARCH ACTION
// ═══════════════════════════════════════════════════════════════════════════

export const hybridSearchSkills = internalAction({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
    skipCache: v.optional(v.boolean()),
    includeDebug: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    results: HybridSkillResult[];
    cached?: boolean;
    debug?: {
      keywordCount: number;
      semanticCount: number;
      queryEmbeddingTime?: number;
    };
  }> => {
    const { query, category, limit = 5, skipCache = false, includeDebug = false } = args;

    // Check cache first
    if (!skipCache) {
      try {
        const cached = await ctx.runQuery(
          internal.tools.meta.skillDiscoveryQueries.getCachedSkillResults,
          { query, category }
        );
        if (cached.hit && cached.results) {
          const cachedResults: HybridSkillResult[] = cached.results.slice(0, limit).map((r: CachedSkillResult) => ({
            skillName: r.skillName,
            description: "",
            category: "",
            categoryName: "",
            score: r.score,
            matchType: r.matchType,
          }));
          return { results: cachedResults, cached: true };
        }
      } catch (error) {
        console.warn("[hybridSearchSkills] Cache lookup failed:", error);
      }
    }

    // Generate query embedding
    const embeddingStartTime = Date.now();
    let queryEmbedding: number[] = [];

    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: query,
      });
      queryEmbedding = embeddingResponse.data[0].embedding;
    } catch (error) {
      console.warn("[hybridSearchSkills] Embedding generation failed:", error);
    }

    const embeddingTime = Date.now() - embeddingStartTime;

    // Run keyword search
    const keywordResults: KeywordSearchItem[] = await ctx.runQuery(
      internal.tools.meta.skillDiscoveryQueries.keywordSearchSkills,
      { query, category, limit: 20 }
    );

    // Run semantic search (if embedding was generated)
    let semanticResults: SemanticSearchItem[] = [];

    if (queryEmbedding.length > 0) {
      try {
        const vectorResults = await ctx.vectorSearch("skills", "by_embedding", {
          vector: queryEmbedding,
          limit: 20,
          filter: category
            ? (q: any) => q.eq("category", category)
            : undefined,
        });

        // Fetch full documents for results
        const skillsWithDetails = await Promise.all(
          vectorResults.map(async (result: any) => {
            const doc = await ctx.runQuery(
              internal.tools.meta.skillDiscoveryQueries.getSkillByIdInternal,
              { skillId: result._id }
            );
            return doc ? {
              skillName: doc.skillName,
              description: doc.description,
              category: doc.category,
              categoryName: doc.categoryName,
              usageCount: doc.usageCount,
              score: result._score,
            } : null;
          })
        );

        semanticResults = skillsWithDetails.filter((t): t is NonNullable<typeof t> => t !== null);
      } catch (error) {
        console.warn("[hybridSearchSkills] Vector search failed:", error);
      }
    }

    // Apply RRF fusion
    const keywordRanked = keywordResults.map((r: KeywordSearchItem, idx: number) => ({
      skillName: r.skillName,
      score: keywordResults.length - idx,
    }));
    const semanticRanked = semanticResults.map((r: SemanticSearchItem) => ({
      skillName: r.skillName,
      score: r.score,
    }));
    const fusedResults = reciprocalRankFusion([keywordRanked, semanticRanked]);

    // Build result details map
    const detailsMap = new Map<string, {
      description: string;
      category: string;
      categoryName: string;
      usageCount: number;
      keywordRank?: number;
      semanticScore?: number;
    }>();

    keywordResults.forEach((r: KeywordSearchItem, idx: number) => {
      detailsMap.set(r.skillName, {
        description: r.description,
        category: r.category,
        categoryName: r.categoryName,
        usageCount: r.usageCount,
        keywordRank: idx + 1,
      });
    });

    semanticResults.forEach((r: SemanticSearchItem) => {
      const existing = detailsMap.get(r.skillName);
      if (existing) {
        existing.semanticScore = r.score;
      } else {
        detailsMap.set(r.skillName, {
          description: r.description,
          category: r.category,
          categoryName: r.categoryName,
          usageCount: r.usageCount,
          semanticScore: r.score,
        });
      }
    });

    // Build final results with popularity boost
    const results: HybridSkillResult[] = [];

    for (const fused of fusedResults.slice(0, limit)) {
      const details = detailsMap.get(fused.skillName);
      if (!details) continue;

      let finalScore = fused.score;
      if (details.usageCount > 0) {
        finalScore *= 1 + Math.log(1 + details.usageCount) * 0.05;
      }

      const hasKeyword = details.keywordRank !== undefined;
      const hasSemantic = details.semanticScore !== undefined;
      const matchType: "keyword" | "semantic" | "hybrid" =
        hasKeyword && hasSemantic ? "hybrid" :
        hasKeyword ? "keyword" : "semantic";

      results.push({
        skillName: fused.skillName,
        description: details.description,
        category: details.category,
        categoryName: details.categoryName,
        score: finalScore,
        matchType,
        keywordScore: details.keywordRank ? 1 / details.keywordRank : undefined,
        semanticScore: details.semanticScore,
        usageCount: details.usageCount,
      });
    }

    results.sort((a, b) => b.score - a.score);

    // Store results in cache
    if (!skipCache && results.length > 0) {
      try {
        await ctx.runMutation(
          internal.tools.meta.skillDiscoveryQueries.setCachedSkillResults,
          {
            query,
            category,
            results: results.map((r) => ({
              skillName: r.skillName,
              score: r.score,
              matchType: r.matchType,
            })),
          }
        );
      } catch (error) {
        console.warn("[hybridSearchSkills] Cache storage failed:", error);
      }
    }

    return {
      results,
      cached: false,
      ...(includeDebug && {
        debug: {
          keywordCount: keywordResults.length,
          semanticCount: semanticResults.length,
          queryEmbeddingTime: embeddingTime,
        },
      }),
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// META-TOOL #1: searchAvailableSkills
// ═══════════════════════════════════════════════════════════════════════════

export const searchAvailableSkills = createTool({
  description: `Search for available skills using hybrid search (keyword + semantic).

Skills are multi-step workflows that combine tools for common tasks.
Use this to find pre-defined procedures for complex tasks like:
- Company research and dossier creation
- Media discovery workflows
- Financial analysis procedures
- Document creation templates

Returns top matching skills with brief descriptions.
After finding a relevant skill, call describeSkill to get the full workflow instructions.

Categories available:
- research: Entity/company research workflows
- document: Document creation and management
- media: Media discovery and analysis
- financial: Financial data and SEC analysis
- workflow: General multi-step procedures`,

  args: z.object({
    query: z.string().describe("Search query - can be keywords or natural language describing what workflow you need"),
    category: z.string().optional().describe("Optional: filter to specific category"),
    includeDebug: z.boolean().optional().describe("Include debug info about search results"),
  }),

  handler: async (ctx: ActionCtx, args): Promise<string> => {
    const { query, category, includeDebug = false } = args;

    // Progressive disclosure: allow eval harness to track that skill search was used first.
    // This is a soft side-effect (in-memory on ctx) and has no persistence impact.
    try {
      const disclosureState = (ctx as any)?.__progressiveDisclosureState;
      if (disclosureState && typeof disclosureState === "object") {
        disclosureState.skillSearchCalled = true;
      }
    } catch {
      // Never fail the tool due to disclosure bookkeeping.
    }

    try {
      const isEvalHarness = (ctx as any)?.__progressiveDisclosureState?.evaluationMode === true;

      const searchResult = isEvalHarness
        ? {
            results: (await ctx.runQuery(
              internal.tools.meta.skillDiscoveryQueries.keywordSearchSkills,
              { query, category, limit: 5 },
            )).map((r: any) => ({
              skillName: String(r.skillName),
              description: String(r.description ?? ""),
              category: String(r.category ?? ""),
              categoryName: String(r.categoryName ?? r.category ?? ""),
              score: 1,
              matchType: "keyword" as const,
              usageCount: Number(r.usageCount ?? 0) || undefined,
            })),
            cached: false,
            debug: includeDebug
              ? { keywordCount: 0, semanticCount: 0, queryEmbeddingTime: 0 }
              : undefined,
          }
        : await ctx.runAction(
            internal.tools.meta.skillDiscovery.hybridSearchSkills,
            { query, category, limit: 5, includeDebug },
          );

      if (searchResult.results.length === 0) {
        const categories: SkillCategoryInfo[] = await ctx.runQuery(
          internal.tools.meta.skillDiscoveryQueries.listSkillCategories,
          {}
        );

        if (categories.length === 0) {
          return `No skills found matching "${query}". The skills system may not be seeded yet.

Use tools and delegation directly, or ask the administrator to seed skills.`;
        }

        const categoryList = categories
          .map((c: SkillCategoryInfo) => `- ${c.categoryKey}: ${c.categoryName} (${c.skillCount} skills)`)
          .join("\n");

        return `No skills found matching "${query}".

Available skill categories:
${categoryList}

Try a more specific query or browse by category using listSkillCategories.`;
      }

      const skillList = searchResult.results
        .map((r: HybridSkillResult, i: number) => {
          let matchInfo = "";
          if (includeDebug) {
            matchInfo = ` [${r.matchType}${r.usageCount ? `, used ${r.usageCount}x` : ""}]`;
          }
          return `${i + 1}. **${r.skillName}** [${r.categoryName}]${matchInfo}\n   ${r.description}`;
        })
        .join("\n\n");

      let response = `Found ${searchResult.results.length} skills matching "${query}":

${skillList}

Next: Call describeSkill({ skillName: "${searchResult.results[0].skillName}" }) to get the full workflow instructions.`;

      if (includeDebug && searchResult.debug) {
        response += `\n\n---\n**Debug Info:**
- Keyword matches: ${searchResult.debug.keywordCount}
- Semantic matches: ${searchResult.debug.semanticCount}
- Embedding time: ${searchResult.debug.queryEmbeddingTime}ms`;
      }

      return response;

    } catch (error: any) {
      return `❌ Error searching skills: ${error.message}`;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// META-TOOL #2: listSkillCategories
// ═══════════════════════════════════════════════════════════════════════════

export const listSkillCategories = createTool({
  description: `List all skill categories with their skill counts.

Use this to browse available skills by category when you're not sure what to search for.
Returns category names, descriptions, and skill counts.`,

  args: z.object({
    showSkills: z.boolean().optional().describe("If true, also list skill names in each category"),
  }),

  handler: async (ctx: ActionCtx, args): Promise<string> => {
    const { showSkills = false } = args;

    try {
      const categories: SkillCategoryInfo[] = await ctx.runQuery(
        internal.tools.meta.skillDiscoveryQueries.listSkillCategories,
        {}
      );

      if (categories.length === 0) {
        return `No skill categories found. The skills system may not be seeded yet.

Skills are multi-step workflows for common tasks like:
- Company research and dossier creation
- Media discovery workflows  
- Financial analysis procedures

Ask the administrator to seed skills, or use tools and delegation directly.`;
      }

      const totalSkills = categories.reduce((sum: number, c: SkillCategoryInfo) => sum + c.skillCount, 0);

      const categoryList = categories
        .map((c: SkillCategoryInfo) => {
          let entry = `- **${c.categoryKey}**: ${c.categoryName} (${c.skillCount} skills)`;
          if (showSkills) {
            entry += `\n  Skills: ${c.skills.slice(0, 5).join(", ")}${c.skills.length > 5 ? `, +${c.skills.length - 5} more` : ""}`;
          }
          return entry;
        })
        .join("\n");

      return `Available skill categories (${totalSkills} total skills):

${categoryList}

Use searchAvailableSkills({ query: "...", category: "research" }) to find skills in a category.`;

    } catch (error: any) {
      return `❌ Error listing skill categories: ${error.message}`;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// META-TOOL #3: describeSkill
// ═══════════════════════════════════════════════════════════════════════════

export const describeSkill = createTool({
  description: `Get the full workflow instructions for a skill.

Call this AFTER searchAvailableSkills to load the complete skill instructions.
Skills contain step-by-step workflow procedures that you should follow.

IMPORTANT: After reading the skill instructions, execute the workflow steps as described.`,

  args: z.object({
    skillName: z.string().describe("Name of the skill to describe"),
  }),

  handler: async (ctx: ActionCtx, args): Promise<string> => {
    const { skillName } = args;

    try {
      const skill = await ctx.runQuery(
        internal.tools.meta.skillDiscoveryQueries.getSkillByNameInternal,
        { name: skillName }
      );

      if (!skill) {
        return `❌ Skill "${skillName}" not found. Use searchAvailableSkills to find valid skills.`;
      }

      // Record that this skill was loaded (for analytics)
      try {
        await ctx.runMutation(
          internal.tools.meta.skillDiscoveryQueries.recordSkillUsage,
          {
            skillName,
            queryText: "describe",
            wasSuccessful: true,
          }
        );
      } catch (e) {
        // Don't fail if usage tracking fails
        console.warn("[describeSkill] Failed to record usage:", e);
      }

      let response = `# ${skill.name}

**Category:** ${skill.categoryName}
**Description:** ${skill.description}
**Keywords:** ${skill.keywords.join(", ")}`;

      if (skill.allowedTools && skill.allowedTools.length > 0) {
        response += `\n**Allowed Tools:** ${skill.allowedTools.join(", ")}`;
      }

      response += `

---

${skill.fullInstructions}

---

**Usage:** ${skill.usageCount} times${skill.lastUsedAt ? ` (last used: ${new Date(skill.lastUsedAt).toISOString()})` : ""}

Now follow the workflow steps above to complete the task.`;

      return response;

    } catch (error: any) {
      return `❌ Error describing skill: ${error.message}`;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// EMBEDDING GENERATION
// ═══════════════════════════════════════════════════════════════════════════

export const generateSkillEmbedding = internalAction({
  args: {
    skillName: v.string(),
    description: v.string(),
    keywords: v.array(v.string()),
    fullInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<number[]> => {
    const { description, keywords, fullInstructions = "" } = args;
    
    // Combine description, keywords, and first 500 chars of instructions for embedding
    const textParts = [
      description,
      ...keywords,
      fullInstructions.slice(0, 500),
    ];
    const combinedText = textParts.join(" ");

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: combinedText,
    });

    return response.data[0].embedding;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// META-TOOL #4: classifyPersona (Retrieval-First Persona Enforcement)
// Classifies user queries to enforce skill retrieval for low-confidence cases
// ═══════════════════════════════════════════════════════════════════════════

/**
 * classifyPersona - Determines if skill retrieval is required
 *
 * Used to enforce the retrieval-first persona pattern:
 * - High confidence (>0.8): Can proceed directly if agent knows the tools
 * - Low confidence (≤0.8): MUST call searchAvailableSkills first
 *
 * This tool helps ensure agents don't skip the progressive disclosure flow
 * by requiring explicit classification of query understanding.
 */
export const classifyPersona = createTool({
  description: `Classify a user query to determine if skill retrieval is required.

IMPORTANT: Call this BEFORE attempting to use any non-meta tools.

This enforces the retrieval-first persona pattern:
- If confidence ≤ 0.8, you MUST call searchAvailableSkills before proceeding
- If confidence > 0.8, you may proceed with tools you know about

Returns:
- confidence: 0-1 score of how well you understand the required tools
- requiresRetrieval: boolean indicating if searchAvailableSkills is mandatory
- reasoning: brief explanation of the classification
- suggestedQuery: if retrieval required, a suggested search query`,

  args: z.object({
    userQuery: z.string().describe("The user's original query or request"),
    knownTools: z.array(z.string()).optional().describe("Tools the agent already knows are relevant (from prior context)"),
    taskDomain: z.string().optional().describe("Identified domain of the task (e.g., 'document editing', 'search', 'financial analysis')"),
  }),

  handler: async (_ctx: ActionCtx, args): Promise<string> => {
    const { userQuery, knownTools = [], taskDomain } = args;

    // Keywords that indicate specific, well-known operations
    const highConfidencePatterns = [
      /create\s+(a\s+)?document/i,
      /search\s+(for|the)\s+web/i,
      /read\s+(the\s+)?file/i,
      /list\s+(my\s+)?tasks/i,
      /what\s+time/i,
      /schedule\s+/i,
      /edit\s+(the\s+)?document/i,
      /delete\s+/i,
      /update\s+/i,
    ];

    // Keywords that indicate complex, multi-step, or ambiguous operations
    const lowConfidencePatterns = [
      /research\s+/i,
      /analyze\s+/i,
      /find\s+information\s+about/i,
      /help\s+me\s+/i,
      /investigate\s+/i,
      /what\s+do\s+you\s+know\s+about/i,
      /can\s+you\s+/i,
      /how\s+do\s+I\s+/i,
      /dossier/i,
      /deep\s+dive/i,
      /comprehensive/i,
      /funding/i,
      /investor/i,
      /sec\s+filing/i,
    ];

    // Calculate base confidence
    let confidence = 0.5; // Start neutral
    const reasoning: string[] = [];

    // Check high-confidence patterns
    for (const pattern of highConfidencePatterns) {
      if (pattern.test(userQuery)) {
        confidence += 0.2;
        reasoning.push(`Matched high-confidence pattern: ${pattern.source}`);
        break;
      }
    }

    // Check low-confidence patterns
    for (const pattern of lowConfidencePatterns) {
      if (pattern.test(userQuery)) {
        confidence -= 0.3;
        reasoning.push(`Matched low-confidence pattern: ${pattern.source}`);
        break;
      }
    }

    // Boost confidence if agent already knows relevant tools
    if (knownTools.length > 0) {
      confidence += Math.min(0.2, knownTools.length * 0.05);
      reasoning.push(`Agent knows ${knownTools.length} relevant tools`);
    }

    // Reduce confidence for unknown domains
    if (!taskDomain) {
      confidence -= 0.1;
      reasoning.push(`No task domain identified`);
    }

    // Clamp confidence to [0, 1]
    confidence = Math.max(0, Math.min(1, confidence));

    // Determine if retrieval is required
    const requiresRetrieval = confidence <= 0.8;

    // Generate suggested query if retrieval is needed
    let suggestedQuery = "";
    if (requiresRetrieval) {
      // Extract key nouns/verbs from the query
      const words = userQuery.toLowerCase()
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter(w => w.length > 3 && !["what", "that", "this", "with", "from", "about", "would", "could", "should"].includes(w));

      suggestedQuery = words.slice(0, 4).join(" ");
      if (taskDomain) {
        suggestedQuery = `${taskDomain} ${suggestedQuery}`;
      }
    }

    const result = {
      confidence: Math.round(confidence * 100) / 100,
      requiresRetrieval,
      reasoning: reasoning.join("; ") || "Default classification",
      suggestedQuery: suggestedQuery || undefined,
      knownToolsCount: knownTools.length,
    };

    return JSON.stringify(result, null, 2);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Skill meta-tools for progressive skill discovery
 *
 * Use this object to add all skill meta-tools to an agent:
 * ```typescript
 * const agent = new Agent({
 *   tools: { ...metaTools, ...skillMetaTools },
 * });
 * ```
 */
export const skillMetaTools = {
  searchAvailableSkills,
  listSkillCategories,
  describeSkill,
  classifyPersona,
};
