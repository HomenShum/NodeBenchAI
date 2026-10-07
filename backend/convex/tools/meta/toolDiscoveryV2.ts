/**
 * Meta-Tool Discovery System
 *
 * Uses Convex-native hybrid search (BM25 + vector) for tool discovery.
 *
 * Features:
 * - BM25 keyword search for exact matches
 * - Semantic vector search for conceptual similarity
 * - Query result caching for repeated searches
 * - Usage tracking for popularity-based ranking
 *
 * Progressive Disclosure Pattern:
 * 1. searchAvailableTools - Hybrid search returning tool names + brief descriptions
 * 2. listToolCategories - Browse tools by category
 * 3. describeTools - Load full schemas for specific tools on-demand
 * 4. invokeTool - Execute a discovered tool by name (with usage tracking)
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { ActionCtx } from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import {
  toolSummaries,
  toolCategories,
  getAllToolNames,
  type ToolCategory,
} from "./toolRegistry";
import type { HybridSearchResult } from "./hybridSearch";
import type { MCPToolSummary, MCPSchemaHydrationResult } from "../../domains/mcp/mcpToolRegistry";

interface CategoryItem {
  categoryKey: string;
  categoryName: string;
  toolCount: number;
  tools: string[];
}

// Track which tools have been described (for validation in invokeTool)
const describedTools = new Set<string>();

// Track which MCP tools have been hydrated
const describedMCPTools = new Set<string>();

/**
 * Helper to search MCP tools and format results
 */
async function searchMCPToolsHelper(
  ctx: ActionCtx,
  query: string,
  category?: string,
  limit: number = 5
): Promise<{
  results: Array<{
    toolName: string;
    toolId: string;
    serverId: string;
    description: string;
    category: string;
    matchScore: number;
    isMCP: true;
  }>;
  count: number;
}> {
  try {
    const mcpResults = await ctx.runQuery(
      api.domains.mcp.mcpToolRegistry.searchMCPTools,
      { query, category, limit }
    );

    return {
      results: mcpResults.map((r: MCPToolSummary & { matchScore: number }) => ({
        toolName: r.name,
        toolId: r.toolId,
        serverId: r.serverId,
        description: r.shortDescription,
        category: r.category,
        matchScore: r.matchScore,
        isMCP: true as const,
      })),
      count: mcpResults.length,
    };
  } catch (error) {
    console.warn("[searchMCPToolsHelper] Failed to search MCP tools:", error);
    return { results: [], count: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// META-TOOL #1: searchAvailableTools (Hybrid Search)
// Uses BM25 + vector semantic search for best results
// ═══════════════════════════════════════════════════════════════════════════

export const searchAvailableTools = createTool({
  description: `Search for available tools using hybrid search (keyword + semantic).

Use this tool FIRST to discover what tools are available for a task.
Returns top 5 matching tools with one-line descriptions.

The search uses:
- BM25 keyword matching for exact terms
- Semantic vector search for conceptual similarity
- Reciprocal Rank Fusion to combine results

Categories available:
- document: Create, read, edit, search documents
- deepEdit: Anchor-based document editing with self-correction
- hashtag: Hashtag search and dossier creation
- media: Search/analyze images, videos, files
- search: Web search, YouTube, news
- sec: SEC filings and regulatory documents
- financial: Funding research, company financial data
- tasks: Task management
- calendar: Calendar events and scheduling
- memory: Agent working memory
- planning: Task planning, orchestration
- knowledge: Knowledge graphs, clustering
- humanInput: Request human clarification

After finding relevant tools, call describeTools to get their full schemas.`,

  args: z.object({
    query: z.string().describe("Search query - can be keywords or natural language describing what you need"),
    category: z.string().optional().describe("Optional: filter to specific category (document, media, search, etc.)"),
    includeDebug: z.boolean().optional().describe("Include debug info about search results"),
  }),

  handler: async (ctx: ActionCtx, args): Promise<string> => {
    const { query, category, includeDebug = false } = args;
    
    try {
      // Use hybrid search
      const searchResult = await ctx.runAction(
        internal.tools.meta.hybridSearch.hybridSearchTools,
        {
          query,
          category,
          limit: 5,
          includeDebug,
        }
      );
      
      if (searchResult.results.length === 0) {
        // No results - provide category summary
        const categories: CategoryItem[] = await ctx.runQuery(
          internal.tools.meta.seedToolRegistryQueries.listCategories,
          {}
        );

        const categoryList = categories
          .map((c: CategoryItem) => `- ${c.categoryKey}: ${c.categoryName} (${c.toolCount} tools)`)
          .join("\n");

        return `No tools found matching "${query}".

Available categories (${getAllToolNames().length} total tools):
${categoryList}

Try a more specific query or browse by category using listToolCategories.`;
      }

      // Also search MCP tools
      const mcpSearchResult = await searchMCPToolsHelper(ctx, query, category, 3);

      // Combine results - built-in first, then MCP
      const builtInList = searchResult.results
        .map((r: HybridSearchResult, i: number) => {
          let matchInfo = "";
          if (includeDebug) {
            matchInfo = ` [${r.matchType}${r.usageCount ? `, used ${r.usageCount}x` : ""}]`;
          }
          return `${i + 1}. **${r.toolName}** [${r.categoryName}]${matchInfo}\n   ${r.description}`;
        })
        .join("\n\n");

      let mcpList = "";
      if (mcpSearchResult.count > 0) {
        mcpList = "\n\n**MCP Tools:**\n" + mcpSearchResult.results
          .map((r, i) => {
            const idx = searchResult.results.length + i + 1;
            return `${idx}. **${r.toolName}** [MCP:${r.category}]\n   ${r.description}`;
          })
          .join("\n\n");
      }

      const totalCount = searchResult.results.length + mcpSearchResult.count;
      const toolList = builtInList + mcpList;

      let response = `Found ${totalCount} tools matching "${query}":

${toolList}

Next: Call describeTools({ toolNames: ["${searchResult.results[0].toolName}"] }) to get the full schema.`;

      if (includeDebug && searchResult.debug) {
        response += `\n\n---\n**Debug Info:**
- Keyword matches: ${searchResult.debug.keywordCount}
- Semantic matches: ${searchResult.debug.semanticCount}
- Fusion method: ${searchResult.debug.fusionMethod}
- Embedding time: ${searchResult.debug.queryEmbeddingTime}ms`;
      }
      
      return response;
      
    } catch (error: any) {
      // Fallback to in-memory search if hybrid search fails
      console.warn("[searchAvailableToolsV2] Hybrid search failed, falling back to keyword search:", error);
      
      const { searchTools } = await import("./toolRegistry");
      const results = searchTools(query, 5, category as ToolCategory | undefined);
      
      if (results.length === 0) {
        return `No tools found matching "${query}". Try a different query or use listToolCategories.`;
      }
      
      const toolList = results
        .map((r, i) => `${i + 1}. **${r.name}** [${r.category}]\n   ${r.description}`)
        .join("\n\n");
      
      return `Found ${results.length} tools (keyword search fallback):

${toolList}

Next: Call describeTools({ toolNames: ["${results[0].name}"] }) to get the full schema.`;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// META-TOOL #2: listToolCategories
// Browse tools by category
// ═══════════════════════════════════════════════════════════════════════════

export const listToolCategories = createTool({
  description: `List all tool categories with their tool counts.

Use this to browse available tools by category when you're not sure what to search for.
Returns category names, descriptions, and tool counts.`,

  args: z.object({
    showTools: z.boolean().optional().describe("If true, also list tool names in each category"),
  }),

  handler: async (ctx: ActionCtx, args): Promise<string> => {
    const { showTools = false } = args;

    try {
      const categories: CategoryItem[] = await ctx.runQuery(
        internal.tools.meta.seedToolRegistryQueries.listCategories,
        {}
      );

      if (categories.length === 0) {
        // Fallback to in-memory categories
        const categoryList = Object.entries(toolCategories)
          .map(([key, info]) => `- **${key}**: ${info.name} - ${info.description}`)
          .join("\n");

        return `Tool categories (from registry):

${categoryList}

Use searchAvailableTools({ query: "...", category: "document" }) to find tools in a category.`;
      }

      const categoryList = categories
        .map((c: CategoryItem) => {
          let entry = `- **${c.categoryKey}**: ${c.categoryName} (${c.toolCount} tools)`;
          if (showTools) {
            entry += `\n  Tools: ${c.tools.slice(0, 5).join(", ")}${c.tools.length > 5 ? `, +${c.tools.length - 5} more` : ""}`;
          }
          return entry;
        })
        .join("\n");

      const totalTools = categories.reduce((sum: number, c: CategoryItem) => sum + c.toolCount, 0);

      return `Available tool categories (${totalTools} total tools):

${categoryList}

Use searchAvailableTools({ query: "...", category: "document" }) to find tools in a category.`;

    } catch (error: any) {
      // Fallback to in-memory
      const categoryList = Object.entries(toolCategories)
        .map(([key, info]) => `- **${key}**: ${info.name} - ${info.description}`)
        .join("\n");

      return `Tool categories:

${categoryList}

Use searchAvailableTools({ query: "...", category: "document" }) to find tools in a category.`;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// META-TOOL #3: describeTools
// Get full schemas for specific tools
// ═══════════════════════════════════════════════════════════════════════════

export const describeTools = createTool({
  description: `Get detailed schemas for specific tools.

Call this AFTER searchAvailableTools to get the full argument schemas
for tools you want to use. Returns complete argument definitions.

IMPORTANT: You must call this before invokeTool to understand the required arguments.`,

  args: z.object({
    toolNames: z.array(z.string()).describe("Array of tool names to describe (max 3 at a time)"),
  }),

  handler: async (ctx: ActionCtx, args): Promise<string> => {
    const { toolNames } = args;

    if (toolNames.length > 3) {
      return "Please request at most 3 tools at a time to conserve context.";
    }

    const descriptions: string[] = [];

    for (const toolName of toolNames) {
      // First check built-in tools
      const summary = toolSummaries[toolName];

      if (summary) {
        // Built-in tool - mark as described and get schema
        describedTools.add(toolName);
        const schemaInfo = await getToolSchema(toolName, summary.module);

        descriptions.push(`✅ **${toolName}**
Category: ${summary.category}
Module: ${summary.module}
Description: ${summary.description}
Keywords: ${summary.keywords.join(", ")}

Schema and key parameters:
${schemaInfo}

Ready to use with invokeTool({ toolName: "${toolName}", arguments: {...} })`);
        continue;
      }

      // Not a built-in tool - try MCP tools
      try {
        const mcpTools = await ctx.runQuery(
          api.domains.mcp.mcpToolRegistry.searchMCPTools,
          { query: toolName, limit: 1 }
        );

        if (mcpTools.length > 0 && mcpTools[0].name === toolName) {
          const mcpTool = mcpTools[0];

          // Hydrate the full schema
          const hydrationResult = await ctx.runAction(
            api.domains.mcp.mcpToolRegistry.hydrateMCPToolSchema,
            { toolId: mcpTool.toolId }
          ) as MCPSchemaHydrationResult;

          // Mark as described
          describedMCPTools.add(toolName);

          const schemaInfo = hydrationResult.schema
            ? JSON.stringify(hydrationResult.schema.fullSchema, null, 2)
            : "No schema available - pass arguments based on description";

          descriptions.push(`✅ **${toolName}** [MCP Tool]
Category: ${mcpTool.category}
Server: ${mcpTool.serverId}
Description: ${mcpTool.shortDescription}
Keywords: ${mcpTool.keywords.join(", ")}
Schema Hash: ${hydrationResult.tool.schemaHash || "N/A"}
Hydration: ${hydrationResult.fromCache ? "from cache" : "fresh"} (${hydrationResult.hydrationLatencyMs}ms)

Schema and key parameters:
${schemaInfo}

Ready to use with invokeTool({ toolName: "${toolName}", arguments: {...} })`);
          continue;
        }
      } catch (error) {
        console.warn(`[describeTools] Failed to search MCP tools for ${toolName}:`, error);
      }

      // Tool not found in either registry
      descriptions.push(`❌ **${toolName}**: Tool not found. Use searchAvailableTools to find valid tools.`);
    }

    return descriptions.join("\n\n---\n\n");
  },
});

/**
 * Get the argument schema for a tool from its module
 */
async function getToolSchema(toolName: string, module: string): Promise<string> {
  // Map module paths to actual tool schemas
  // This is a simplified version - in production, you'd dynamically import
  const schemaMap: Record<string, string> = {
    // Document tools
    findDocument: `{
  query: string (required) - Search query for document title/content
  limit?: number - Max results (default: 5)
}`,
    createDocument: `{
  title: string (required) - Document title
  content?: string - Initial content
  isPublic?: boolean - Whether document is public
}`,
    readDocument: `{
  documentId: string (required) - Document ID to read
  maxLength?: number - Max content length to return
}`,
    updateDocument: `{
  documentId: string (required) - Document ID to update
  title?: string - New title
  content?: string - New content
}`,
    // Deep edit tools
    readDocumentSections: `{
  documentId: string (required) - Document ID to read
  maxPreviewLength?: number - Max preview per section (default: 500)
}`,
    createDocumentEdit: `{
  documentId: string (required) - Document ID to edit
  anchor: string (required) - Unique text anchor near edit location
  search: string (required) - Exact text to find and replace
  replace: string (required) - Replacement text
  sectionHint?: string - Section name hint
  agentThreadId?: string - Thread ID for tracking
}`,
    lookupGroundTruthEntity: `{
  entity: string (required) - Entity ID or canonical name to resolve in the internal ground-truth dataset
}

Best for:
- evaluation/synthetic entities like DISCO, Ambros, QuickJS/MicroQuickJS, OpenAutoGLM
- bounded fact lookup where you need the exact {{fact:ground_truth:...}} anchor

Returns:
- ground-truth anchor
- canonical entity metadata
- verified key facts and forbidden facts`,
    linkupSearch: `{
  query: string (required) - Natural-language web search query
  depth?: "standard" | "deep" - Search depth; standard is faster/cheaper, deep is broader
  fromDate?: string - ISO YYYY-MM-DD lower bound for time-bounded queries
  toDate?: string - ISO YYYY-MM-DD upper bound for time-bounded queries
  outputType?: "sourcedAnswer" | "searchResults" - Natural-language answer vs raw grounded results
  includeInlineCitations?: boolean - Include [1], [2] inline source markers in sourced answers
  maxResults?: number - Limit returned results
  includeSources?: boolean - Include persisted sources for traceability
  includeImages?: boolean - Only true when the user explicitly asks for images
  includeDomains?: string[] - Restrict to specific domains
  excludeDomains?: string[] - Exclude specific domains
}

Best for:
- current web research
- source-grounded answers
- temporal search using fromDate/toDate`,
    // Search tools
    searchWeb: `{
  query: string (required) - Search query
  numResults?: number - Number of results (default: 5)
}`,
    searchYouTube: `{
  query: string (required) - YouTube search query
  maxResults?: number - Max videos to return
}`,
    // Media tools
    analyzeImage: `{
  imageUrl: string (required) - URL of image to analyze
  prompt?: string - Analysis prompt
}`,
    // Default fallback
    _default: `See tool documentation for argument schema.
Use the tool's description and keywords to understand required arguments.`,
  };

  return schemaMap[toolName] || schemaMap._default;
}

// ═══════════════════════════════════════════════════════════════════════════
// META-TOOL #4: invokeTool
// Execute a discovered tool with usage tracking
// ═══════════════════════════════════════════════════════════════════════════

export const invokeTool = createTool({
  description: `Execute a tool by name with the given arguments.

IMPORTANT: You must call describeTools first to understand the required arguments.
This tool will track usage for popularity-based ranking.

Returns the tool's output or an error message.`,

  args: z.object({
    toolName: z.string().describe("Name of the tool to invoke"),
    arguments: z.record(z.any()).describe("Arguments to pass to the tool"),
    queryContext: z.string().optional().describe("Original search query that led to this tool (for analytics)"),
  }),

  handler: async (ctx: ActionCtx, args): Promise<string> => {
    const { toolName, arguments: toolArgs, queryContext = "" } = args;
    const startTime = Date.now();

    // Validate tool exists
    const summary = toolSummaries[toolName];
    if (!summary) {
      return `❌ Tool "${toolName}" not found. Use searchAvailableTools to find valid tools.`;
    }

    // Warn if not described first (but allow execution)
    if (!describedTools.has(toolName)) {
      console.warn(`[invokeToolV2] Tool ${toolName} invoked without prior describe call`);
    }

    try {
      // Execute the tool based on its module
      const result = await executeToolByModule(ctx, toolName, summary.module, toolArgs);

      // Record successful usage
      try {
        await ctx.runMutation(
          internal.tools.meta.hybridSearchQueries.recordToolUsage,
          {
            toolName,
            queryText: queryContext,
            wasSuccessful: true,
            executionTimeMs: Date.now() - startTime,
          }
        );
      } catch (e) {
        // Don't fail if usage tracking fails
        console.warn("[invokeToolV2] Failed to record usage:", e);
      }

      return result;

    } catch (error: any) {
      // Record failed usage
      try {
        await ctx.runMutation(
          internal.tools.meta.hybridSearchQueries.recordToolUsage,
          {
            toolName,
            queryText: queryContext,
            wasSuccessful: false,
            executionTimeMs: Date.now() - startTime,
            errorMessage: error.message,
          }
        );
      } catch (e) {
        console.warn("[invokeToolV2] Failed to record usage:", e);
      }

      return `❌ Error executing ${toolName}: ${error.message}`;
    }
  },
});

/**
 * Execute a tool by dynamically routing to the correct module
 */
async function executeToolByModule(
  ctx: ActionCtx,
  toolName: string,
  module: string,
  args: Record<string, any>
): Promise<string> {
  // Route to the appropriate tool based on module
  // This is a simplified dispatcher - in production, you'd use dynamic imports

  switch (module) {
    case "document/documentTools":
      return await executeDocumentTool(ctx, toolName, args);
    case "document/deepAgentEditTools":
      return await executeDeepEditTool(ctx, toolName, args);
    case "search/searchTools":
      return await executeSearchTool(ctx, toolName, args);
    default:
      return `Tool execution for module "${module}" not yet implemented.
Please use the tool directly from its module.`;
  }
}

async function executeDocumentTool(
  ctx: ActionCtx,
  toolName: string,
  args: Record<string, any>
): Promise<string> {
  // Import and execute document tools
  const { api } = await import("../../_generated/api");

  switch (toolName) {
    case "findDocument":
      // findByTitleAny returns just the document ID, not the full document
      const docId = await ctx.runQuery(api.domains.documents.documents.findByTitleAny, {
        title: args.query,
      });
      if (docId) {
        // Get the full document to access title
        const fullDoc = await ctx.runQuery(api.domains.documents.documents.getById, {
          documentId: docId,
        });
        if (fullDoc) {
          return `Found document: ${fullDoc.title} (${docId})`;
        }
        return `Found document ID: ${docId}`;
      }
      return `No document found matching "${args.query}"`;

    default:
      return `Document tool "${toolName}" execution not implemented.`;
  }
}

async function executeDeepEditTool(
  ctx: ActionCtx,
  toolName: string,
  args: Record<string, any>
): Promise<string> {
  return `Deep edit tool "${toolName}" should be executed through the document agent.`;
}

async function executeSearchTool(
  ctx: ActionCtx,
  toolName: string,
  args: Record<string, any>
): Promise<string> {
  return `Search tool "${toolName}" execution not implemented in meta-tool layer.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Meta-tools for progressive tool discovery
 *
 * Use this object to add all meta-tools to an agent:
 * ```typescript
 * const agent = new Agent({
 *   tools: metaTools,  // Provides searchAvailableTools, listToolCategories, describeTools, invokeTool
 * });
 * ```
 */
export const metaTools = {
  searchAvailableTools,
  listToolCategories,
  describeTools,
  invokeTool,
};
