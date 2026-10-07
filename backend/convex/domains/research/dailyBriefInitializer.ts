"use node";

/**
 * Daily Brief Initializer (Initializer Agent)
 *
 * Creates a persistent domain memory record for a new dailyBriefSnapshot.
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal, api } from "../../_generated/api";

type FeedItem = {
  _id: any;
  title: string;
  summary?: string;
  url?: string;
  source?: string;
  type?: string;
  category?: string;
  tags?: string[];
  score?: number;
  publishedAt?: string;
};

function toFeature(
  id: string,
  type: string,
  name: string,
  testCriteria: string,
  sourceRefs: any,
  priority: number,
  now: number,
) {
  return {
    id,
    type,
    name,
    status: "pending" as const,
    priority,
    testCriteria,
    sourceRefs,
    updatedAt: now,
  };
}

export const initializeForSnapshot = internalAction({
  args: {
    snapshotId: v.id("dailyBriefSnapshots"),
  },
  handler: async (ctx, args): Promise<{ memoryId: any }> => {
    const snapshot: any = await ctx.runQuery(
      internal.domains.research.dailyBriefMemoryQueries.getSnapshotById,
      { snapshotId: args.snapshotId },
    );
    if (!snapshot) throw new Error("Snapshot not found");

    const existing: any = await ctx.runQuery(
      internal.domains.research.dailyBriefMemoryQueries.getMemoryBySnapshot,
      { snapshotId: args.snapshotId },
    );
    if (existing) {
      return { memoryId: existing._id };
    }

    const dayStart = `${snapshot.dateString}T00:00:00.000Z`;
    const dayEnd = `${snapshot.dateString}T23:59:59.999Z`;

    // Prefer time-bounded data for "Today's Briefing" so we don't pull stale high-score items.
    let feedItems: FeedItem[] = await ctx.runQuery(api.feed.getRecent, {
      limit: 200,
      from: dayStart,
      to: dayEnd,
    });

    // If ingest is sparse for the day, widen the window to the last 4 days.
    if (feedItems.length < 12) {
      const fromMs = new Date(`${snapshot.dateString}T00:00:00.000Z`).getTime() - 3 * 24 * 60 * 60 * 1000;
      const from = new Date(fromMs).toISOString();
      feedItems = await ctx.runQuery(api.feed.getRecent, {
        limit: 200,
        from,
        to: dayEnd,
      });
    }

    // Final fallback: trending-by-score.
    if (feedItems.length === 0) {
      feedItems = await ctx.runQuery(api.feed.get, { limit: 100 });
    }

    const repoItems = feedItems.filter((i) => i.type === "repo").slice(0, 5);
    const paperItems = feedItems
      .filter((i) => i.source === "ArXiv" || i.category === "research")
      .slice(0, 3);
    const topNews = feedItems
      .filter((i) => i.type !== "repo")
      .slice(0, 10);

    // Create story summary tasks for top signals (mix of non-repo + repo).
    const dedupedByScore: FeedItem[] = [];
    const seenStoryUrls = new Set<string>();
    feedItems
      .filter((item) => item.url)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .forEach((item) => {
        const url = (item.url ?? "").trim();
        if (!url || seenStoryUrls.has(url)) return;
        seenStoryUrls.add(url);
        dedupedByScore.push(item);
      });

    const nonRepoStories = dedupedByScore
      .filter((item) => item.type !== "repo")
      .slice(0, 10);
    const repoStories = dedupedByScore
      .filter((item) => item.type === "repo")
      .slice(0, 6);
    const deepStoryItems = nonRepoStories.slice(0, 5);

    const storyItemsMap = new Map<string, FeedItem>();
    [...nonRepoStories, ...repoStories].forEach((item) => {
      const url = (item.url ?? "").trim();
      if (!url || storyItemsMap.has(url)) return;
      storyItemsMap.set(url, item);
    });
    const storyItems = Array.from(storyItemsMap.values()).slice(0, 16);

    const prevSnapshot: any = await ctx.runQuery(
      internal.domains.research.dailyBriefMemoryQueries.getPreviousSnapshotInternal,
      { dateString: snapshot.dateString },
    );

    const now = Date.now();
    const features: any[] = [];

    repoItems.forEach((item, idx) => {
      features.push(
        toFeature(
          `R${idx + 1}`,
          "repo_analysis",
          `Analyze trending GitHub repo: ${item.title}`,
          "Summary includes purpose, key features, recent updates, and relevance to AI development.",
          { feedItem: item },
          1,
          now,
        ),
      );
    });

    paperItems.forEach((item, idx) => {
      features.push(
        toFeature(
          `P${idx + 1}`,
          "paper_summary",
          `Summarize research paper: ${item.title}`,
          "Summary includes main contribution, methodology, results, and implications.",
          { feedItem: item },
          2,
          now,
        ),
      );
    });

    storyItems.forEach((item, idx) => {
      features.push(
        toFeature(
          `S${idx + 1}`,
          "story_summary",
          `Summarize top signal: ${item.title}`,
          "Summary includes what happened, why it matters, and a key implication. 2-3 sentences.",
          { feedItem: item },
          1,
          now,
        ),
      );
    });

    deepStoryItems.forEach((item, idx) => {
      features.push(
        toFeature(
          `I${idx + 1}`,
          "story_intel",
          `Extract intelligence from: ${item.title}`,
          "Return JSON with: summary, hard_numbers, direct_quote, conflict, pivot, lesson. Leave missing fields as null.",
          { feedItem: item },
          1,
          now,
        ),
      );
    });

    if (deepStoryItems.length > 0) {
      features.push(
        toFeature(
          "G1",
          "graph_extraction",
          "Extract entity relationships for top signals",
          "Return JSON: { focusNodeId, nodes, edges }. Nodes include id, label, type, importance. Edges include source, target, relationship, context.",
          { items: deepStoryItems.slice(0, 3) },
          2,
          now,
        ),
      );
    }

    // Add anomaly tasks based on metric deltas vs previous day
    if (prevSnapshot?.dashboardMetrics && snapshot.dashboardMetrics) {
      try {
        const prevTech = prevSnapshot.dashboardMetrics.techReadiness;
        const curTech = snapshot.dashboardMetrics.techReadiness;
        const techDelta =
          Math.abs(curTech.existing - prevTech.existing) +
          Math.abs(curTech.emerging - prevTech.emerging) +
          Math.abs(curTech.sciFi - prevTech.sciFi);
        if (techDelta >= 3) {
          features.push(
            toFeature(
              "M1",
              "metric_anomaly",
              "Investigate tech readiness swings vs yesterday",
              "Explain the drivers behind the readiness bucket changes with supporting evidence.",
              {
                previous: prevTech,
                current: curTech,
              },
              3,
              now,
            ),
          );
        }

        const prevCaps = prevSnapshot.dashboardMetrics.capabilities || [];
        const curCaps = snapshot.dashboardMetrics.capabilities || [];
        const capDrops = curCaps.filter((c: any, i: number) => {
          const prev = prevCaps[i];
          return prev && typeof prev.score === "number" && c.score < prev.score - 0.15;
        });
        if (capDrops.length > 0) {
          features.push(
            toFeature(
              "M2",
              "metric_anomaly",
              "Investigate capability score drops vs yesterday",
              "Identify which signals caused capability scores to fall and whether it is noise or trend.",
              { drops: capDrops, previous: prevCaps, current: curCaps },
              3,
              now,
            ),
          );
        }
      } catch (err) {
        console.warn("[dailyBriefInitializer] delta analysis failed", err);
      }
    }

    // RECORD ANALYTICS: Track component metrics for this brief
    try {
      const metrics: any[] = [];
      const date = snapshot.dateString;

      // Helper to push metrics
      const pushMetric = (componentType: string, items: any[], category?: string) => {
        const bySource = new Map<string, number>();
        items.forEach(item => {
          const source = item.source || "Unknown";
          bySource.set(source, (bySource.get(source) || 0) + 1);
        });

        bySource.forEach((count, source) => {
          metrics.push({
            date,
            reportType: "daily_brief",
            componentType,
            sourceName: source,
            category: category || "general",
            itemCount: count,
            freshnessHours: 24, // Assumed for daily brief
          });
        });
      };

      if (repoItems.length > 0) pushMetric("github_repos", repoItems, "software");
      if (paperItems.length > 0) pushMetric("research_papers", paperItems, "research");
      if (topNews.length > 0) pushMetric("top_stories", topNews, "news");

      // Also track deep diffs if any
      if (deepStoryItems.length > 0) pushMetric("deep_analysis", deepStoryItems, "intelligence");

      if (metrics.length > 0) {
        await ctx.runMutation(internal.domains.analytics.componentMetrics.batchRecordComponentMetrics, {
          metrics,
        });
      }
    } catch (err) {
      console.warn("[dailyBriefInitializer] analytics tracking failed", err);
    }

    const goal = `Daily Morning Brief follow-ups for ${snapshot.dateString}`;

    const progressLog = [
      {
        ts: now,
        status: "info",
        message: "Initializer seeded daily brief backlog",
        meta: {
          snapshotId: args.snapshotId,
          repoTasks: repoItems.length,
          paperTasks: paperItems.length,
        },
      },
    ];

    const context = {
      briefDate: snapshot.dateString,
      snapshotSummary: snapshot.sourceSummary,
      dashboardMetrics: snapshot.dashboardMetrics,
      previousDashboardMetrics: prevSnapshot?.dashboardMetrics ?? null,
      topFeedItems: topNews,
      topRepos: repoItems,
      topPapers: paperItems,
      systemTimeUTC: now,
    };

    const memoryId = await ctx.runMutation(
      internal.domains.research.dailyBriefMemoryMutations.createMemory,
      {
        snapshotId: args.snapshotId,
        dateString: snapshot.dateString,
        generatedAt: snapshot.generatedAt,
        version: snapshot.version,
        goal,
        features,
        context,
        progressLog,
      },
    );

    return { memoryId };
  },
});
