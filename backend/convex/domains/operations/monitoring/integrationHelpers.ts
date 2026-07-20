/**
 * Integration Helpers for Industry Monitoring
 *
 * These helpers can be called from anywhere in the codebase to check for
 * relevant industry updates and suggest improvements.
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

/**
 * Check for relevant updates for a specific feature/module
 *
 * Example usage:
 * ```typescript
 * const suggestions = await ctx.runAction(
 *   internal.domains.monitoring.integrationHelpers.checkRelevantUpdates,
 *   {
 *     module: "swarm_orchestrator",
 *     keywords: ["multi-agent", "orchestration", "checkpointing"],
 *   }
 * );
 * ```
 */
export const checkRelevantUpdates = internalAction({
  args: {
    module: v.string(),
    keywords: v.array(v.string()),
    minRelevance: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const minRelevance = args.minRelevance || 70;

    // Get recent findings
    const findings = await ctx.runQuery(
      internal.domains.monitoring.integrationHelpers.getRecentFindingsInternal,
      {
        limit: 50,
        status: "new",
      }
    );

    // Filter by keywords and relevance
    const relevant = findings.filter((finding: any) => {
      // Check relevance threshold
      if (finding.relevance < minRelevance) return false;

      // Check if any keyword matches
      const hasKeywordMatch = args.keywords.some((keyword) => {
        const lowerKeyword = keyword.toLowerCase();
        return (
          finding.title.toLowerCase().includes(lowerKeyword) ||
          finding.summary.toLowerCase().includes(lowerKeyword) ||
          finding.actionableInsights.some((insight: string) =>
            insight.toLowerCase().includes(lowerKeyword)
          )
        );
      });

      return hasKeywordMatch;
    });

    if (relevant.length > 0) {
      console.log(`[IndustryMonitor] Found ${relevant.length} relevant updates for ${args.module}`);
      console.log(
        `[IndustryMonitor] Top suggestion: ${relevant[0].title} (${relevant[0].relevance}% relevance)`
      );
    }

    return {
      module: args.module,
      matchCount: relevant.length,
      suggestions: relevant.slice(0, 5), // Top 5
    };
  },
});

/**
 * Internal query to get recent findings
 */
export const getRecentFindingsInternal = internalQuery({
  args: {
    limit: v.number(),
    status: v.optional(v.union(v.literal("new"), v.literal("reviewed"), v.literal("implemented"))),
  },
  handler: async (ctx, args) => {
    let query = ctx.db.query("industryUpdates").order("desc");

    if (args.status) {
      query = query.filter((q) => q.eq(q.field("status"), args.status));
    }

    const findings = await query.take(args.limit);

    return findings;
  },
});

/**
 * Suggest improvements for a specific code section
 *
 * Example usage in comments:
 * ```typescript
 * // INDUSTRY_MONITOR: swarm_orchestrator, ["multi-agent", "orchestration"]
 * export const executeSwarm = internalAction({
 *   // ... implementation
 * });
 * ```
 */
export const suggestImprovements = internalAction({
  args: {
    codeSection: v.string(),
    context: v.string(),
    currentApproach: v.string(),
  },
  handler: async (ctx, args) => {
    // Get all recent findings
    const findings = await ctx.runQuery(
      internal.domains.monitoring.integrationHelpers.getRecentFindingsInternal,
      {
        limit: 100,
        status: "new",
      }
    );

    if (findings.length === 0) {
      return {
        hasSuggestions: false,
        suggestions: [],
      };
    }

    // Use LLM to analyze relevance and suggest improvements
    const analysis = await ctx.runAction(
      internal.domains.agents.mcp_tools.reasoningTool.getReasoning,
      {
        prompt: `You are an AI engineering expert analyzing industry updates for potential code improvements.

Code Section: ${args.codeSection}
Context: ${args.context}
Current Approach: ${args.currentApproach}

Recent Industry Findings (${findings.length} total):
${findings
  .slice(0, 10)
  .map(
    (f: any, i: number) => `
${i + 1}. [${f.providerName}] ${f.title} (${f.relevance}% relevance)
   Summary: ${f.summary}
   Insights: ${f.actionableInsights.join(", ")}
   Suggestions: ${f.implementationSuggestions.join(", ")}
`
  )
  .join("\n")}

Analyze these findings and determine:
1. Which findings are relevant to this code section?
2. What specific improvements could be made?
3. What is the estimated impact (cost savings, reliability, performance)?
4. What is the implementation complexity (low/medium/high)?

Respond in JSON format:
{
  "hasSuggestions": true/false,
  "relevantFindings": [0, 2, 5], // indices of relevant findings
  "improvements": [
    {
      "title": "...",
      "description": "...",
      "estimatedImpact": "...",
      "complexity": "low|medium|high",
      "priority": "low|medium|high"
    }
  ]
}`,
        systemPrompt:
          "You are an expert at analyzing AI/ML industry updates and suggesting concrete code improvements. Focus on practical, high-impact changes.",
        maxTokens: 1500,
        extractStructured: true,
      }
    );

    try {
      const parsed = JSON.parse(analysis.structuredResponse || analysis.response);
      return parsed;
    } catch {
      return {
        hasSuggestions: false,
        suggestions: [],
      };
    }
  },
});

/**
 * Generate a monitoring report for a specific domain
 *
 * Example: Generate report for "agents" domain
 */
export const generateDomainReport = internalAction({
  args: {
    domain: v.string(), // "agents", "observability", "workflows", etc.
    keywords: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const updates = await ctx.runAction(
      internal.domains.monitoring.integrationHelpers.checkRelevantUpdates,
      {
        module: args.domain,
        keywords: args.keywords,
        minRelevance: 60,
      }
    );

    if (updates.matchCount === 0) {
      return {
        domain: args.domain,
        status: "up-to-date",
        message: `No relevant updates found for ${args.domain}`,
        suggestions: [],
      };
    }

    // Generate summary report
    const report = {
      domain: args.domain,
      status: "updates-available",
      totalUpdates: updates.matchCount,
      highPriority: updates.suggestions.filter((s: any) => s.relevance >= 80).length,
      mediumPriority: updates.suggestions.filter(
        (s: any) => s.relevance >= 60 && s.relevance < 80
      ).length,
      topSuggestions: updates.suggestions.slice(0, 3).map((s: any) => ({
        provider: s.providerName,
        title: s.title,
        relevance: s.relevance,
        summary: s.summary,
      })),
    };

    console.log(`[IndustryMonitor] Report for ${args.domain}:`);
    console.log(`[IndustryMonitor]   Total updates: ${report.totalUpdates}`);
    console.log(`[IndustryMonitor]   High priority: ${report.highPriority}`);
    console.log(`[IndustryMonitor]   Medium priority: ${report.mediumPriority}`);

    return report;
  },
});

/**
 * Check for updates when deploying new code
 *
 * This can be called as part of a deployment workflow to check for
 * relevant industry updates before going live.
 */
export const preDeploymentCheck = internalAction({
  args: {
    modules: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const reports: any[] = [];

    for (const module of args.modules) {
      // Define keywords for each module type
      const keywordMap: Record<string, string[]> = {
        swarm_orchestrator: ["multi-agent", "orchestration", "swarm", "parallel"],
        observability: ["tracing", "monitoring", "observability", "telemetry"],
        checkpointing: ["checkpointing", "state management", "resume", "recovery"],
        batch_api: ["batch api", "batch processing", "async"],
        reasoning: ["reasoning", "thinking", "extended thinking"],
        caching: ["caching", "prompt caching", "cache"],
      };

      const keywords = keywordMap[module] || [module];

      const report = await ctx.runAction(
        internal.domains.monitoring.integrationHelpers.generateDomainReport,
        {
          domain: module,
          keywords,
        }
      );

      reports.push(report);
    }

    const totalUpdates = reports.reduce((sum, r) => sum + (r.totalUpdates || 0), 0);
    const highPriority = reports.reduce((sum, r) => sum + (r.highPriority || 0), 0);

    console.log("[IndustryMonitor] Pre-deployment check complete:");
    console.log(`[IndustryMonitor]   Modules checked: ${args.modules.length}`);
    console.log(`[IndustryMonitor]   Total updates available: ${totalUpdates}`);
    console.log(`[IndustryMonitor]   High priority: ${highPriority}`);

    return {
      modulesChecked: args.modules.length,
      totalUpdates,
      highPriority,
      reports,
      recommendation:
        highPriority > 0
          ? "Review high-priority updates before deployment"
          : "Safe to deploy - no critical updates",
    };
  },
});
