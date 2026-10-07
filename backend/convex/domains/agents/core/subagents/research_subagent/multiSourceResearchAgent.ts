/**
 * Multi-Source Research Agent
 *
 * Orchestrates comprehensive research across multiple data sources
 * and generates AI-2027.com-style citations with provenance tracking.
 *
 * @module domains/agents/core/subagents/research_subagent/multiSourceResearchAgent
 */

import { Agent, createTool } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { components } from "../../../../../_generated/api";
import { api } from "../../../../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// CITATION GENERATION TOOL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tool to generate a citation from a search result
 */
export const generateCitation = createTool({
  description: `Generate a structured citation from a search result.
Use this after finding relevant information to create a proper citation.

Returns a citation object with:
- id: Unique citation identifier
- type: source | data | quote | analysis | internal
- label: Short label for inline display
- fullText: Full citation text
- url: Source URL
- author: Author/source name
- publishedAt: Publication date`,

  args: z.object({
    sourceTitle: z.string().describe("Title of the source"),
    sourceUrl: z.string().optional().describe("URL of the source"),
    sourceType: z.enum(["news", "paper", "blog", "sec_filing", "video", "document", "other"])
      .describe("Type of source"),
    relevantQuote: z.string().optional().describe("Relevant quote or excerpt"),
    author: z.string().optional().describe("Author name"),
    publishedAt: z.string().optional().describe("Publication date (ISO format)"),
    citationType: z.enum(["source", "data", "quote", "analysis", "internal"])
      .default("source")
      .describe("Type of citation"),
  }),

  handler: async (_ctx, args): Promise<string> => {
    const citationId = `cite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const citation = {
      id: citationId,
      type: args.citationType,
      label: args.sourceTitle.slice(0, 50),
      fullText: args.relevantQuote || args.sourceTitle,
      url: args.sourceUrl,
      author: args.author,
      publishedAt: args.publishedAt,
      accessedAt: new Date().toISOString(),
    };

    return JSON.stringify({
      kind: "citation",
      version: 1,
      payload: citation,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-SOURCE RESEARCH TOOL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tool to perform comprehensive multi-source research
 */
export const comprehensiveResearch = createTool({
  description: `Perform comprehensive research across multiple sources.
Searches LinkUp, SEC filings, internal documents, and more.

Use this for deep research that requires multiple perspectives.
Returns structured results with citation-ready metadata.`,

  args: z.object({
    topic: z.string().describe("Research topic or query"),
    focusAreas: z.array(z.string()).optional()
      .describe("Specific areas to focus on (e.g., 'funding', 'leadership', 'products')"),
    includeSEC: z.boolean().default(false)
      .describe("Include SEC filings in search"),
    includeNews: z.boolean().default(true)
      .describe("Include news sources"),
    includeInternal: z.boolean().default(true)
      .describe("Include internal documents"),
    maxResultsPerSource: z.number().default(5)
      .describe("Maximum results per source"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[comprehensiveResearch] Topic: "${args.topic}"`);

    const results: Array<{
      source: string;
      title: string;
      url?: string;
      snippet: string;
      publishedAt?: string;
      citationId: string;
    }> = [];

    try {
      // 1. Fusion search for news and general sources
      if (args.includeNews) {
        const fusionPayload = await ctx.runAction(
          api.domains.search.fusion.actions.fusionSearch,
          {
            query: args.topic,
            mode: "comprehensive",
            maxTotal: args.maxResultsPerSource,
          }
        );

        const fusionResults = fusionPayload.payload.results || [];
        for (const r of fusionResults) {
          results.push({
            source: r.source || "web",
            title: r.title,
            url: r.url,
            snippet: r.snippet || "",
            publishedAt: r.publishedAt,
            citationId: `cite-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          });
        }
      }

      // Format results for agent consumption
      if (results.length === 0) {
        return `No results found for "${args.topic}". Try refining your query.`;
      }

      const formatted = results.map((r, i) => [
        `### ${i + 1}. ${r.title}`,
        `- **Source**: ${r.source}`,
        r.url ? `- **URL**: ${r.url}` : "",
        r.publishedAt ? `- **Published**: ${r.publishedAt}` : "",
        `- **Citation ID**: ${r.citationId}`,
        `- **Excerpt**: ${r.snippet.slice(0, 300)}...`,
        "",
      ].filter(Boolean).join("\n"));

      return [
        `## Research Results: "${args.topic}"`,
        `Found ${results.length} sources across ${new Set(results.map(r => r.source)).size} providers.`,
        "",
        ...formatted,
        "",
        "Use the citation IDs above when referencing these sources in your response.",
      ].join("\n");
    } catch (error) {
      console.error("[comprehensiveResearch] Error:", error);
      return `Research failed: ${error}. Please try again.`;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-SOURCE RESEARCH AGENT
// ═══════════════════════════════════════════════════════════════════════════

const RESEARCH_AGENT_PROMPT = `You are a Multi-Source Research Agent specialized in comprehensive research with proper citation.

# CORE RESPONSIBILITIES
1. Conduct thorough research across multiple sources
2. Generate proper citations for all claims
3. Synthesize information into coherent narratives
4. Track provenance for reproducibility

# CITATION PROTOCOL (MANDATORY)
Every factual claim MUST be backed by a citation. Use this format in your responses:
- {{cite:citation-id}} for inline citations
- Include a "Sources" section at the end with full citation details

# RESEARCH WORKFLOW
1. Use comprehensiveResearch tool to gather information
2. Use generateCitation tool to create citations for key sources
3. Synthesize findings with inline citations
4. Provide a structured response with:
   - Executive Summary
   - Key Findings (with citations)
   - Sources & References

# OUTPUT FORMAT
Always structure your response as:

## Executive Summary
[1-2 sentence overview]

## Key Findings
1. [Finding with {{cite:id}}]
2. [Finding with {{cite:id}}]
...

## Sources & References
[List all citations with full details]

# QUALITY STANDARDS
- Prefer primary sources over secondary
- Note any conflicting information
- Indicate confidence levels
- Flag gaps in available information`;

/**
 * Multi-Source Research Agent
 *
 * Orchestrates comprehensive research with citation generation.
 */
export const multiSourceResearchAgent = new Agent(components.agent, {
  name: "Multi-Source Research Agent",
  languageModel: openai.chat("gpt-5.4-mini"),
  instructions: RESEARCH_AGENT_PROMPT,
  tools: {
    comprehensiveResearch,
    generateCitation,
  },
});

// Export tools for use by other agents
export const researchTools = {
  comprehensiveResearch,
  generateCitation,
};
