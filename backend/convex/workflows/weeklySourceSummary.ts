"use node";

/**
 * Weekly Source Summary - Transparency Post
 *
 * Generates a weekly summary of all domain sources used in funding posts
 * to demonstrate the breadth of media monitoring and data aggregation.
 *
 * Runs weekly to compile:
 * - All companies covered
 * - Total funding tracked
 * - Domain sources used with article counts
 * - Sector breakdown
 * - Round type distribution
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Generate weekly source summary showing all media domains monitored
 */
export const generateWeeklySourceSummary = internalAction({
  args: {
    daysBack: v.optional(v.number()), // Default 7 days
  },
  returns: v.object({
    success: v.boolean(),
    summary: v.object({
      dateRange: v.string(),
      totalCompanies: v.number(),
      totalFunding: v.string(),
      totalArticles: v.number(),
      sources: v.array(v.object({
        domain: v.string(),
        count: v.number(),
        companies: v.array(v.string()),
      })),
      sectors: v.object({
        ai_ml: v.number(),
        healthcare: v.number(),
        fintech: v.number(),
        enterprise: v.number(),
        deeptech: v.number(),
        consumer: v.number(),
        climate: v.number(),
        other: v.number(),
      }),
      rounds: v.object({
        seed: v.number(),
        seriesA: v.number(),
        seriesB: v.number(),
        seriesCPlus: v.number(),
        growth: v.number(),
        other: v.number(),
      }),
      topDeals: v.array(v.object({
        company: v.string(),
        amount: v.string(),
        round: v.string(),
      })),
    }),
  }),
  handler: async (ctx, args) => {
    const daysBack = args.daysBack ?? 7;
    const hoursBack = daysBack * 24;

    // Get all funding events from the past week
    const events = await ctx.runQuery(internal.domains.enrichment.fundingQueries.getRecentFundingEvents, {
      lookbackHours: hoursBack,
      limit: 1000,
    });

    // Aggregate sources
    const sourceDomainMap = new Map<string, { count: number; companies: Set<string> }>();
    let totalFundingUsd = 0;
    const sectorCounts = {
      ai_ml: 0,
      healthcare: 0,
      fintech: 0,
      enterprise: 0,
      deeptech: 0,
      consumer: 0,
      climate: 0,
      other: 0,
    };
    const roundCounts = {
      seed: 0,
      seriesA: 0,
      seriesB: 0,
      seriesCPlus: 0,
      growth: 0,
      other: 0,
    };

    const topDeals: Array<{ company: string; amount: string; round: string; amountUsd: number }> = [];

    for (const event of events) {
      // Extract domains from source URLs
      if (event.sourceUrls && Array.isArray(event.sourceUrls)) {
        for (const url of event.sourceUrls) {
          try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname.replace(/^www\./, '');

            if (!sourceDomainMap.has(domain)) {
              sourceDomainMap.set(domain, { count: 0, companies: new Set() });
            }
            const sourceData = sourceDomainMap.get(domain)!;
            sourceData.count++;
            sourceData.companies.add(event.companyName);
          } catch (e) {
            console.log(`[weeklySourceSummary] Invalid URL: ${url}`);
          }
        }
      }

      // Aggregate funding
      if (event.amountUsd) {
        totalFundingUsd += event.amountUsd;
      }

      // Track top deals
      if (event.amountUsd) {
        topDeals.push({
          company: event.companyName,
          amount: event.amountRaw,
          round: event.roundType,
          amountUsd: event.amountUsd,
        });
      }

      // Sector counts (would need to add sector to fundingEvents query)
      // For now, skip sector aggregation

      // Round counts
      const roundType = event.roundType.toLowerCase();
      if (roundType.includes('seed')) {
        roundCounts.seed++;
      } else if (roundType === 'series-a') {
        roundCounts.seriesA++;
      } else if (roundType === 'series-b') {
        roundCounts.seriesB++;
      } else if (roundType === 'series-c' || roundType === 'series-d-plus') {
        roundCounts.seriesCPlus++;
      } else if (roundType === 'growth') {
        roundCounts.growth++;
      } else {
        roundCounts.other++;
      }
    }

    // Sort sources by article count
    const sources = Array.from(sourceDomainMap.entries())
      .map(([domain, data]) => ({
        domain,
        count: data.count,
        companies: Array.from(data.companies).sort(),
      }))
      .sort((a, b) => b.count - a.count);

    // Sort top deals
    topDeals.sort((a, b) => b.amountUsd - a.amountUsd);
    const top5Deals = topDeals.slice(0, 5).map(d => ({
      company: d.company,
      amount: d.amount,
      round: d.round,
    }));

    // Format funding total
    const formatFunding = (usd: number): string => {
      if (usd >= 1_000_000_000) {
        return `$${(usd / 1_000_000_000).toFixed(1)}B`;
      } else if (usd >= 1_000_000) {
        return `$${(usd / 1_000_000).toFixed(1)}M`;
      } else {
        return `$${(usd / 1_000).toFixed(1)}K`;
      }
    };

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const dateRange = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    const totalArticles = Array.from(sourceDomainMap.values()).reduce((sum, data) => sum + data.count, 0);

    return {
      success: true,
      summary: {
        dateRange,
        totalCompanies: events.length,
        totalFunding: formatFunding(totalFundingUsd),
        totalArticles,
        sources,
        sectors: sectorCounts, // Would need additional data
        rounds: roundCounts,
        topDeals: top5Deals,
      },
    };
  },
});

/**
 * Format weekly source summary as LinkedIn post
 */
export const formatWeeklySourcePost = internalAction({
  args: {
    daysBack: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    content: v.string(),
  }),
  handler: async (ctx, args) => {
    const summaryResult = await ctx.runAction(internal.workflows.weeklySourceSummary.generateWeeklySourceSummary, {
      daysBack: args.daysBack ?? 7,
    });

    const { summary } = summaryResult;

    const parts: string[] = [];

    // Header
    parts.push(`WEEKLY FUNDING INTELLIGENCE REPORT`);
    parts.push(`${summary.dateRange}`);
    parts.push(``);

    // Overview
    parts.push(`COVERAGE OVERVIEW:`);
    parts.push(`📊 ${summary.totalCompanies} companies tracked`);
    parts.push(`💰 ${summary.totalFunding} in total funding`);
    parts.push(`📰 ${summary.totalArticles} articles analyzed`);
    parts.push(`🔍 ${summary.sources.length} unique media sources monitored`);
    parts.push(``);

    // Top Deals
    if (summary.topDeals.length > 0) {
      parts.push(`TOP DEALS THIS WEEK:`);
      summary.topDeals.forEach((deal, i) => {
        parts.push(`${i + 1}. ${deal.company} - ${deal.amount} (${deal.round})`);
      });
      parts.push(``);
    }

    // Round Distribution
    parts.push(`FUNDING STAGE BREAKDOWN:`);
    parts.push(`• Seed/Pre-seed: ${summary.rounds.seed}`);
    parts.push(`• Series A: ${summary.rounds.seriesA}`);
    parts.push(`• Series B: ${summary.rounds.seriesB}`);
    parts.push(`• Series C+: ${summary.rounds.seriesCPlus}`);
    parts.push(`• Growth/Other: ${summary.rounds.growth + summary.rounds.other}`);
    parts.push(``);

    // Source Attribution
    parts.push(`MEDIA SOURCES MONITORED:`);
    parts.push(`Our intelligence aggregates data from ${summary.sources.length} trusted sources:`);
    parts.push(``);

    // Group sources by count for better formatting
    const tierSources = {
      primary: summary.sources.filter(s => s.count >= 10),
      secondary: summary.sources.filter(s => s.count >= 5 && s.count < 10),
      tertiary: summary.sources.filter(s => s.count < 5),
    };

    if (tierSources.primary.length > 0) {
      parts.push(`Primary Sources (10+ articles):`);
      tierSources.primary.forEach(source => {
        parts.push(`  • ${source.domain} - ${source.count} articles`);
      });
      parts.push(``);
    }

    if (tierSources.secondary.length > 0) {
      parts.push(`Secondary Sources (5-9 articles):`);
      tierSources.secondary.forEach(source => {
        parts.push(`  • ${source.domain} - ${source.count} articles`);
      });
      parts.push(``);
    }

    if (tierSources.tertiary.length > 0) {
      parts.push(`Contributing Sources (1-4 articles):`);
      const tertiaryList = tierSources.tertiary.map(s => s.domain).join(', ');
      parts.push(`  ${tertiaryList}`);
      parts.push(``);
    }

    // Footer
    parts.push(`DATA QUALITY COMMITMENT:`);
    parts.push(`All funding data is verified against original sources. We prioritize accuracy over speed and publicly disclose data quality improvements.`);
    parts.push(``);
    parts.push(`🔗 View full database: nodebench-ai.vercel.app`);
    parts.push(``);
    parts.push(`#StartupFunding #VentureCapital #DataTransparency #TechNews #AI`);

    const content = parts.join('\n');

    return {
      success: true,
      content,
    };
  },
});
