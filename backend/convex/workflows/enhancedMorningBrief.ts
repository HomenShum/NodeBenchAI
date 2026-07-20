// convex/workflows/enhancedMorningBrief.ts
// Enhanced Morning Brief with Linkup search and watchlist entities
//
// Extends the daily morning brief to include:
// - linkupSearch (bounded to last 24h)
// - Optional watchlist entities (from user subscriptions)
// - Renders a flowing newsletter view
//
// Uses Convex scheduler pattern for durable orchestration

"use node";

import { v } from "convex/values";
import { internalAction, action } from "../_generated/server";
import { internal, api } from "../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface WatchlistEntity {
  name: string;
  type: "company" | "person" | "topic";
  keywords: string[];
}

interface BriefSection {
  id: string;
  title: string;
  content: string;
  sources: Array<{
    title: string;
    domain: string;
    artifactId?: string;
  }>;
  priority: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_TOPICS = [
  "AI infrastructure and MLOps",
  "Large language model developments",
  "Tech startup funding and acquisitions",
  "Open source AI projects",
];

// ═══════════════════════════════════════════════════════════════════════════
// ACTION: Generate enhanced morning brief for a user
// ═══════════════════════════════════════════════════════════════════════════

export const generateEnhancedBrief = (internalAction as any)({
  args: {
    userId: v.optional(v.string()),
    topics: v.optional(v.array(v.string())),
    watchlistEntities: v.optional(v.any()),
    includeGlobalFeed: v.optional(v.boolean()),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    const startTime = Date.now();
    const topics = args.topics ?? DEFAULT_TOPICS;
    const watchlist = args.watchlistEntities ?? [];
    const includeGlobal = args.includeGlobalFeed ?? true;

    console.log("[enhancedMorningBrief] Starting generation", {
      topicCount: topics.length,
      watchlistCount: watchlist.length,
      includeGlobal,
    });

    const sections: BriefSection[] = [];
    const errors: string[] = [];

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Search news for each topic (last 24 hours)
    // ═══════════════════════════════════════════════════════════════════════

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const fromDate = yesterday.toISOString().split("T")[0];
    const toDate = new Date().toISOString().split("T")[0];

    console.log(`[enhancedMorningBrief] Searching news from ${fromDate} to ${toDate}`);

    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];

      try {
        // Use linkupSearch with date bounds
        const searchResult = await ctx.runAction(internal.workflows.enhancedMorningBrief.searchForTopic, {
          topic,
          fromDate,
          toDate,
        });

        if (searchResult.success && searchResult.content) {
          sections.push({
            id: `topic-${i}`,
            title: topic,
            content: searchResult.content,
            sources: searchResult.sources || [],
            priority: topics.length - i, // Earlier topics = higher priority
          });
        }
      } catch (err: any) {
        console.error(`[enhancedMorningBrief] Search failed for "${topic}":`, err);
        errors.push(`Topic "${topic}": ${err.message}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Search watchlist entities
    // ═══════════════════════════════════════════════════════════════════════

    for (const entity of watchlist) {
      try {
        const query = entity.keywords.length > 0
          ? `${entity.name} ${entity.keywords.join(" OR ")}`
          : entity.name;

        const searchResult = await ctx.runAction(internal.workflows.enhancedMorningBrief.searchForTopic, {
          topic: query,
          fromDate,
          toDate,
        });

        if (searchResult.success && searchResult.content) {
          sections.push({
            id: `watchlist-${entity.name.toLowerCase().replace(/\s+/g, "-")}`,
            title: `📌 ${entity.name}`,
            content: searchResult.content,
            sources: searchResult.sources || [],
            priority: 100, // Watchlist items get high priority
          });
        }
      } catch (err: any) {
        console.error(`[enhancedMorningBrief] Watchlist search failed for "${entity.name}":`, err);
        errors.push(`Watchlist "${entity.name}": ${err.message}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Include global feed highlights (optional)
    // ═══════════════════════════════════════════════════════════════════════

    if (includeGlobal) {
      try {
        const feedItems = await ctx.runQuery(api.feed.get, { limit: 10 });

        if (feedItems && feedItems.length > 0) {
          const feedContent = feedItems
            .map((item: any, idx: number) => `[${idx + 1}] **${item.title}** (${item.source})\n${item.summary}`)
            .join("\n\n");

          sections.push({
            id: "global-feed",
            title: "🌐 Trending Today",
            content: feedContent,
            sources: feedItems.map((item: any) => ({
              title: item.title,
              domain: item.source,
            })),
            priority: 50,
          });
        }
      } catch (err: any) {
        console.error("[enhancedMorningBrief] Global feed fetch failed:", err);
        errors.push(`Global feed: ${err.message}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Sort sections by priority and format
    // ═══════════════════════════════════════════════════════════════════════

    sections.sort((a, b) => b.priority - a.priority);

    // Generate newsletter-style output
    const newsletterContent = formatAsNewsletter(sections, fromDate, toDate);

    const processingTime = Date.now() - startTime;

    console.log("[enhancedMorningBrief] Generation complete", {
      sectionCount: sections.length,
      errorCount: errors.length,
      processingTimeMs: processingTime,
    });

    return {
      success: true,
      briefId: `brief-${Date.now()}`,
      sections,
      newsletterContent,
      metadata: {
        generatedAt: Date.now(),
        dateRange: { from: fromDate, to: toDate },
        topicCount: topics.length,
        watchlistCount: watchlist.length,
        sectionCount: sections.length,
        processingTimeMs: processingTime,
      },
      errors: errors.length > 0 ? errors : undefined,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER ACTION: Search for a single topic
// ═══════════════════════════════════════════════════════════════════════════

export const searchForTopic = (internalAction as any)({
  args: {
    topic: v.string(),
    fromDate: v.string(),
    toDate: v.string(),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    const apiKey = process.env.LINKUP_API_KEY;

    if (!apiKey) {
      console.warn("[searchForTopic] LINKUP_API_KEY not set - returning placeholder");
      return {
        success: true,
        content: `*No search results available for "${args.topic}" (API key not configured)*`,
        sources: [],
      };
    }

    try {
      const response = await fetch("https://api.linkup.so/v1/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: args.topic,
          depth: "standard",
          outputType: "sourcedAnswer",
          includeInlineCitations: true,
          includeSources: true,
          fromDate: args.fromDate,
          toDate: args.toDate,
          maxResults: 5,
        }),
      });

      if (!response.ok) {
        throw new Error(`Linkup API error: ${response.status}`);
      }

      const data: any = await response.json();

      // Extract sources
      const sources = (data.sources || []).slice(0, 5).map((source: any) => ({
        title: source.name,
        domain: extractDomain(source.url),
        url: source.url,
      }));

      return {
        success: true,
        content: data.answer || `No recent news found for "${args.topic}"`,
        sources,
      };
    } catch (err: any) {
      console.error(`[searchForTopic] Error searching "${args.topic}":`, err);
      return {
        success: false,
        content: null,
        sources: [],
        error: err.message,
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Extract domain from URL
// ═══════════════════════════════════════════════════════════════════════════

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Format sections as newsletter
// ═══════════════════════════════════════════════════════════════════════════

function formatAsNewsletter(sections: BriefSection[], fromDate: string, toDate: string): string {
  const lines: string[] = [];

  // Header
  lines.push("# 📰 Your Morning Brief");
  lines.push("");
  lines.push(`*Intelligence digest for ${new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })}*`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Table of contents
  lines.push("## Today's Sections");
  lines.push("");
  for (const section of sections) {
    lines.push(`- [${section.title}](#${section.id})`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Sections
  for (const section of sections) {
    lines.push(`## ${section.title} {#${section.id}}`);
    lines.push("");
    lines.push(section.content);
    lines.push("");

    // Sources footer
    if (section.sources.length > 0) {
      lines.push("**Sources:**");
      for (let i = 0; i < section.sources.length; i++) {
        const source = section.sources[i];
        lines.push(`[${i + 1}] ${source.title} (${source.domain})`);
      }
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  // Footer
  lines.push("*This brief was automatically generated. Sources are stored in the artifact system.*");
  lines.push(`*Coverage period: ${fromDate} to ${toDate}*`);

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC ACTION: Trigger brief generation for current user
// ═══════════════════════════════════════════════════════════════════════════

export const generateMyMorningBrief = (action as any)({
  args: {
    customTopics: v.optional(v.array(v.string())),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    // Get user's tracked topics from preferences if not provided
    // For now, use defaults or custom topics

    const result = await ctx.runAction(internal.workflows.enhancedMorningBrief.generateEnhancedBrief, {
      topics: args.customTopics,
      includeGlobalFeed: true,
    });

    return result;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULED BRIEF: Durably scheduled per-user brief
// ═══════════════════════════════════════════════════════════════════════════

export const scheduleBriefForUser = (internalAction as any)({
  args: {
    userId: v.id("users"),
    topics: v.optional(v.array(v.string())),
  },
  handler: async (ctx: any, args: any): Promise<void> => {
    // Use scheduler pattern for durable execution
    // This ensures the brief is generated even if there's a transient failure

    console.log(`[scheduleBriefForUser] Scheduling brief for user ${args.userId}`);

    // Schedule the actual generation to run immediately (0ms delay)
    // This gives us durable execution guarantees
    await ctx.scheduler.runAfter(0, internal.workflows.enhancedMorningBrief.generateEnhancedBrief, {
      userId: args.userId as unknown as string,
      topics: args.topics,
      includeGlobalFeed: true,
    });
  },
});
