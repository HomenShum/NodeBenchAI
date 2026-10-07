/**
 * Industry Updates Monitoring System
 *
 * Automatically scans for updates from leading AI companies and frameworks:
 * - Anthropic (Claude, prompt caching, extended thinking)
 * - OpenAI (GPT, batch API, structured outputs)
 * - Google DeepMind (Gemini, multimodal)
 * - LangChain/LangGraph (orchestration patterns)
 * - Vercel AI SDK (UI patterns, streaming)
 *
 * Runs daily via cron job and stores findings in database.
 */

import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

const INDUSTRY_SOURCES = [
  {
    provider: "anthropic",
    name: "Anthropic",
    sources: [
      "https://docs.anthropic.com/en/docs/welcome",
      "https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching",
      "https://www.anthropic.com/news",
    ],
    keywords: ["prompt caching", "extended thinking", "claude", "batch api", "tool use"],
  },
  {
    provider: "openai",
    name: "OpenAI",
    sources: [
      "https://platform.openai.com/docs/guides/batch",
      "https://platform.openai.com/docs/guides/structured-outputs",
      "https://openai.com/index/introducing-chatgpt-and-whisper-apis/",
    ],
    keywords: ["batch api", "structured outputs", "gpt-4", "reasoning", "function calling"],
  },
  {
    provider: "google",
    name: "Google DeepMind",
    sources: [
      "https://ai.google.dev/gemini-api/docs",
      "https://deepmind.google/technologies/gemini/",
    ],
    keywords: ["gemini", "multimodal", "thinking", "grounding", "context caching"],
  },
  {
    provider: "langchain",
    name: "LangChain/LangGraph",
    sources: [
      "https://langchain-ai.github.io/langgraph/",
      "https://blog.langchain.dev/",
    ],
    keywords: ["checkpointing", "state management", "human-in-the-loop", "langgraph", "memory"],
  },
  {
    provider: "vercel",
    name: "Vercel AI SDK",
    sources: [
      "https://sdk.vercel.ai/docs",
      "https://vercel.com/blog/ai-sdk-3-generative-ui",
    ],
    keywords: ["streaming", "generative ui", "rsc", "ai sdk", "tool calling"],
  },
  {
    provider: "xai",
    name: "xAI",
    sources: [
      "https://docs.x.ai/docs",
      "https://github.com/xai-org/x-algorithm",
      "https://x.ai/blog",
    ],
    keywords: ["grok", "x algorithm", "for you", "ranking", "recommendation", "real-time web", "x search"],
  },
];

/**
 * Scan industry sources for new updates
 */
export const scanIndustryUpdates = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[IndustryMonitor] Starting daily scan...");

    const findings: any[] = [];

    for (const source of INDUSTRY_SOURCES) {
      try {
        console.log(`[IndustryMonitor] Scanning ${source.name}...`);

        // Fetch each source URL
        for (const url of source.sources) {
          try {
            const response = await fetch(url);
            const html = await response.text();

            // Check for keywords
            const foundKeywords = source.keywords.filter((keyword) =>
              html.toLowerCase().includes(keyword.toLowerCase())
            );

            if (foundKeywords.length > 0) {
              // Use LLM to extract relevant updates
              const analysis = await ctx.runAction(
                internal.domains.monitoring.industryUpdates.analyzeUpdate,
                {
                  provider: source.provider,
                  providerName: source.name,
                  url,
                  keywords: foundKeywords,
                  htmlSnippet: html.slice(0, 10000), // First 10k chars
                }
              );

              if (analysis.isRelevant) {
                findings.push({
                  provider: source.provider,
                  providerName: source.name,
                  url,
                  title: analysis.title,
                  summary: analysis.summary,
                  relevance: analysis.relevance,
                  actionableInsights: analysis.actionableInsights,
                  implementationSuggestions: analysis.implementationSuggestions,
                  scannedAt: Date.now(),
                });
              }
            }
          } catch (error: any) {
            console.error(`[IndustryMonitor] Error fetching ${url}:`, error.message);
          }
        }
      } catch (error: any) {
        console.error(`[IndustryMonitor] Error scanning ${source.name}:`, error.message);
      }
    }

    // Save findings to database
    if (findings.length > 0) {
      await ctx.runMutation(internal.domains.monitoring.industryUpdates.saveFindings, {
        findings,
      });

      console.log(`[IndustryMonitor] ✅ Saved ${findings.length} findings`);
    } else {
      console.log("[IndustryMonitor] No new findings");
    }

    return { findingsCount: findings.length, findings };
  },
});

/**
 * Analyze a potential update using LLM
 */
export const analyzeUpdate = internalAction({
  args: {
    provider: v.string(),
    providerName: v.string(),
    url: v.string(),
    keywords: v.array(v.string()),
    htmlSnippet: v.string(),
  },
  handler: async (ctx, args) => {
    // Use reasoning tool to analyze relevance
    const analysis = await ctx.runAction(
      internal.domains.agents.mcp_tools.reasoningTool.getReasoning,
      {
        prompt: `You are an AI engineering expert analyzing industry updates for a production AI agent system.

Provider: ${args.providerName}
URL: ${args.url}
Keywords found: ${args.keywords.join(", ")}

HTML snippet (first 10k chars):
${args.htmlSnippet}

Analyze this content and determine:
1. Is this a relevant update for a production AI agent system? (yes/no)
2. What is the title/headline of the update?
3. Provide a 2-3 sentence summary
4. What is the relevance score? (0-100)
5. What are 3 actionable insights?
6. What are 2-3 implementation suggestions for integrating this into our system?

Respond in JSON format:
{
  "isRelevant": true/false,
  "title": "...",
  "summary": "...",
  "relevance": 85,
  "actionableInsights": ["...", "...", "..."],
  "implementationSuggestions": ["...", "..."]
}`,
        systemPrompt: "You are an expert at analyzing AI/ML industry updates and identifying relevant patterns for production systems. Focus on cost optimization, reliability, observability, and developer experience.",
        maxTokens: 1000,
        extractStructured: true,
      }
    );

    try {
      const parsed = JSON.parse(analysis.structuredResponse || analysis.response);
      return parsed;
    } catch {
      return {
        isRelevant: false,
        title: "Parse error",
        summary: "",
        relevance: 0,
        actionableInsights: [],
        implementationSuggestions: [],
      };
    }
  },
});

/**
 * Save findings to database
 */
export const saveFindings = internalMutation({
  args: {
    findings: v.array(
      v.object({
        provider: v.string(),
        providerName: v.string(),
        url: v.string(),
        title: v.string(),
        summary: v.string(),
        relevance: v.number(),
        actionableInsights: v.array(v.string()),
        implementationSuggestions: v.array(v.string()),
        scannedAt: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const finding of args.findings) {
      await ctx.db.insert("industryUpdates", {
        ...finding,
        status: "new",
        reviewedAt: undefined,
        implementedAt: undefined,
      });
    }
  },
});

/**
 * Get recent findings
 */
export const getRecentFindings = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(v.union(v.literal("new"), v.literal("reviewed"), v.literal("implemented"))),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    let query = ctx.db.query("industryUpdates").order("desc");

    if (args.status) {
      query = query.filter((q) => q.eq(q.field("status"), args.status));
    }

    const findings = await query.take(limit);

    return findings;
  },
});

/**
 * Mark finding as reviewed
 */
export const markAsReviewed = mutation({
  args: {
    findingId: v.id("industryUpdates"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.findingId, {
      status: "reviewed",
      reviewedAt: Date.now(),
    });
  },
});

/**
 * Mark finding as implemented
 */
export const markAsImplemented = mutation({
  args: {
    findingId: v.id("industryUpdates"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.findingId, {
      status: "implemented",
      implementedAt: Date.now(),
    });
  },
});

/**
 * Get implementation suggestions based on findings
 */
export const getImplementationSuggestions = query({
  args: {},
  handler: async (ctx) => {
    // Get all new findings
    const findings = await ctx.db
      .query("industryUpdates")
      .filter((q) => q.eq(q.field("status"), "new"))
      .order("desc")
      .take(20);

    // Group by provider
    const byProvider: Record<string, any[]> = {};
    for (const finding of findings) {
      if (!byProvider[finding.providerName]) {
        byProvider[finding.providerName] = [];
      }
      byProvider[finding.providerName].push(finding);
    }

    // Sort by relevance
    const suggestions = findings
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10)
      .map((f) => ({
        id: f._id,
        provider: f.providerName,
        title: f.title,
        summary: f.summary,
        relevance: f.relevance,
        actionableInsights: f.actionableInsights,
        implementationSuggestions: f.implementationSuggestions,
        url: f.url,
        scannedAt: f.scannedAt,
      }));

    return {
      totalNew: findings.length,
      byProvider,
      topSuggestions: suggestions,
    };
  },
});

/**
 * Get update by ID (for internal use)
 */
export const getUpdateById = internalQuery({
  args: {
    id: v.id("industryUpdates"),
  },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

/**
 * Get high-priority updates (for PR generation)
 */
export const getHighPriorityUpdates = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("industryUpdates")
      .withIndex("by_relevance")
      .order("desc")
      .filter((q) => q.gte(q.field("relevance"), 85))
      .take(10);
  },
});
