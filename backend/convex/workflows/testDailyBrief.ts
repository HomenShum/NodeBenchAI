/**
 * Test wrapper to manually trigger the daily morning brief
 * This is a public action that calls the internal workflow
 */

import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";

export const runDailyBriefTest = action({
  args: {},
  handler: async (ctx) => {
    console.log("[testDailyBrief] Manually triggering daily morning brief...");

    const result = await ctx.runAction(
      internal.workflows.dailyMorningBrief.runDailyMorningBrief,
      {}
    );

    console.log("[testDailyBrief] Daily morning brief completed:", result);

    return result;
  },
});

/**
 * Force send FULL ntfy digest with live data and banker-grade enrichment
 * Uses the same buildNtfyDigestPayload logic as production
 */
export const forceSendFullDigest = action({
  args: {},
  handler: async (ctx) => {
    console.log("[testDailyBrief] Building FULL banker-grade digest with live data...");

    // Get today's dashboard snapshot
    const latestSnapshot: any = await ctx.runQuery(
      api.domains.research.dashboardQueries.getLatestDashboardSnapshot,
      {}
    );

    if (!latestSnapshot) {
      throw new Error("No dashboard snapshot found - run ingestAll first");
    }

    const dateString = new Date().toISOString().slice(0, 10);
    console.log(`[testDailyBrief] Snapshot ${latestSnapshot._id}: ${latestSnapshot.sourceSummary?.totalItems} items`);

    // Get feed items for content
    const feedItems = await ctx.runQuery(
      internal.domains.research.dashboardQueries.getFeedItemsForMetrics,
      {}
    );

    // Get daily brief memory (may not exist yet)
    const memories: any[] = await ctx.runQuery(
      internal.domains.research.dailyBriefMemoryQueries.listMemoriesByDateStringInternal,
      { dateString, limit: 1 }
    );

    const memory = memories[0];

    // Extract enriched entities from memory if available
    const enrichedEntities = memory?.context?.enrichedEntities || [];
    const entityGraph = memory?.context?.entityGraph || null;
    const executiveBrief = memory?.context?.executiveBriefRecord?.brief || memory?.context?.executiveBrief || null;

    console.log(`[testDailyBrief] Memory context: ${enrichedEntities.length} entities, ${entityGraph ? 'graph ✓' : 'no graph'}, ${executiveBrief ? 'brief ✓' : 'no brief'}`);

    // Build the digest using inline logic (simplified from dailyMorningBrief.ts)
    const topStories = feedItems
      .filter((item: any) => item.score && item.score > 0)
      .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
      .slice(0, 10);

    const bySource = latestSnapshot.sourceSummary?.bySource || {};
    const topSourcesLine = Object.entries(bySource)
      .sort((a: any, b: any) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, count]) => `${name} ${count}`)
      .join(" | ");

    const thesis = executiveBrief?.actII?.synthesis ||
      `${latestSnapshot.sourceSummary?.topTrending?.[0] || "Tech"} signals dominate today's feed with ${latestSnapshot.sourceSummary?.totalItems || 0} tracked items.`;

    // Build compact message body
    const lines = [
      `**🧬 Morning Dossier** ${dateString}`,
      `${thesis.slice(0, 150)} [Dashboard](https://nodebench-ai.vercel.app/)`,
      "",
      "**⚡ Market Pulse**",
      `Signal ${latestSnapshot.dashboardMetrics?.keyStats?.[0]?.value || "N/A"} | ${topSourcesLine}`,
      "",
      "**🔥 Top Signals**",
    ];

    // Add top 3 stories with rich detail
    topStories.slice(0, 3).forEach((story: any, idx: number) => {
      const icon = story.category === "ai_ml" ? "🤖" : story.category === "opensource" ? "💻" : "📰";
      const title = story.title?.slice(0, 65) || "Untitled";
      const summary = story.summary?.slice(0, 100) || "";
      lines.push(`${idx + 1}. ${icon} **${title}**`);
      if (summary) {
        lines.push(`   ${summary}`);
      }
      if (story.url) {
        lines.push(`   [Source](${story.url})`);
      }
    });

    // Add entity spotlight if available
    if (enrichedEntities.length > 0) {
      lines.push("");
      lines.push("**🏦 Entity Watchlist (Banker-Grade)**");
      enrichedEntities.slice(0, 3).forEach((entity: any) => {
        const funding = entity.funding?.stage ? `${entity.funding.stage} (${entity.funding.totalRaised?.currency}${entity.funding.totalRaised?.amount}${entity.funding.totalRaised?.unit})` : "";
        const freshTag = entity.freshness?.withinBankerWindow ? "✓ Fresh" : "";
        const personasReady = entity.personaReadiness?.ready?.length || 0;
        lines.push(`*   **${entity.name}**: ${funding} ${freshTag} | ${personasReady}/10 personas`);
        if (entity.summary) {
          lines.push(`    ${entity.summary.slice(0, 100)}`);
        }
      });
    }

    // Add strategic moves
    lines.push("");
    lines.push("**🎯 Strategic Moves**");
    const topCategories = Object.entries(latestSnapshot.sourceSummary?.byCategory || {})
      .sort((a: any, b: any) => b[1] - a[1])
      .slice(0, 2)
      .map(([cat]) => cat);

    if (topCategories.includes("ai_ml")) {
      lines.push("*   **For CTOs**: Monitor ${topCategories[0]} trends; adjust tech roadmap");
    }
    if (topCategories.includes("opensource")) {
      lines.push("*   **For Founders**: Study OSS velocity; identify moat opportunities");
    }
    lines.push("*   **For VCs**: Re-rank deal pipeline based on today's signal concentration");

    lines.push("");
    lines.push("[Open Live Dossier](https://nodebench-ai.vercel.app/)");

    const body = lines.join("\n");

    // Truncate if needed
    const maxLen = 3700;
    const finalBody = body.length > maxLen
      ? `${body.slice(0, maxLen - 100)}...\n\n[Open Live Dossier](https://nodebench-ai.vercel.app/)`
      : body;

    console.log(`[testDailyBrief] Body length: ${finalBody.length} chars`);

    // Send to ntfy
    await ctx.runAction(api.domains.integrations.ntfy.sendNotification, {
      title: `🧬 Morning Dossier - ${dateString}`,
      body: finalBody,
      priority: 4,
      tags: ["dna", "chart_with_upwards_trend", "briefcase"],
      click: "https://nodebench-ai.vercel.app/",
      eventType: "morning_digest_full",
    });

    console.log("[testDailyBrief] ✅ FULL digest sent!");

    return {
      success: true,
      dateString,
      totalItems: latestSnapshot.sourceSummary?.totalItems,
      enrichedEntities: enrichedEntities.length,
      topStories: topStories.length,
      bodyLength: finalBody.length,
    };
  },
});
