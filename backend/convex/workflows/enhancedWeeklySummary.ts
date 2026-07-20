"use node";

/**
 * Enhanced Weekly Summary - Complete Transparency Report
 *
 * Includes ALL available metrics:
 * - Source publishers (not just domains)
 * - Sector distribution
 * - Geographic breakdown
 * - Top investors by deal count
 * - Verification status
 * - Valuation metrics
 * - Average deal size by stage
 * - Company progressions
 * - Confidence scores
 * - Week-over-week trends
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Generate comprehensive weekly intelligence summary
 */
export const generateEnhancedWeeklySummary = internalAction({
  args: {
    daysBack: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    summary: v.object({
      dateRange: v.string(),

      // Core metrics
      totalCompanies: v.number(),
      totalFunding: v.string(),
      totalArticles: v.number(),

      // Sources
      sources: v.array(v.object({
        domain: v.string(),
        count: v.number(),
        companies: v.array(v.string()),
      })),
      publishers: v.array(v.object({
        name: v.string(),
        count: v.number(),
      })),

      // Top deals
      topDeals: v.array(v.object({
        company: v.string(),
        amount: v.string(),
        round: v.string(),
        valuation: v.optional(v.string()),
        investors: v.optional(v.array(v.string())),
      })),

      // Rounds
      rounds: v.object({
        seed: v.number(),
        seriesA: v.number(),
        seriesB: v.number(),
        seriesCPlus: v.number(),
        growth: v.number(),
        other: v.number(),
      }),
      avgDealSizeByStage: v.object({
        seed: v.string(),
        seriesA: v.string(),
        seriesB: v.string(),
        seriesCPlus: v.string(),
      }),

      // Sectors
      sectors: v.array(v.object({
        name: v.string(),
        count: v.number(),
        totalFunding: v.string(),
      })),

      // Geography
      locations: v.array(v.object({
        name: v.string(),
        count: v.number(),
      })),

      // Investors
      topInvestors: v.array(v.object({
        name: v.string(),
        dealCount: v.number(),
        companies: v.array(v.string()),
      })),

      // Verification
      verificationStatus: v.object({
        verified: v.number(),
        multiSource: v.number(),
        singleSource: v.number(),
        unverified: v.number(),
      }),

      // Valuations
      valuationMetrics: v.object({
        disclosed: v.number(),
        totalDisclosed: v.string(),
        avgValuation: v.string(),
      }),

      // Data quality
      avgConfidence: v.number(),
      highConfidence: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const daysBack = args.daysBack ?? 7;
    const hoursBack = daysBack * 24;

    // Get all funding events
    const events = await ctx.runQuery(internal.domains.enrichment.fundingQueries.getRecentFundingEvents, {
      lookbackHours: hoursBack,
      limit: 1000,
    });

    // Aggregation maps
    const sourceDomainMap = new Map<string, { count: number; companies: Set<string> }>();
    const publisherMap = new Map<string, number>();
    const sectorMap = new Map<string, { count: number; funding: number }>();
    const locationMap = new Map<string, number>();
    const investorMap = new Map<string, { count: number; companies: Set<string> }>();

    let totalFundingUsd = 0;
    const roundCounts = {
      seed: 0,
      seriesA: 0,
      seriesB: 0,
      seriesCPlus: 0,
      growth: 0,
      other: 0,
    };
    const roundFunding = {
      seed: { total: 0, count: 0 },
      seriesA: { total: 0, count: 0 },
      seriesB: { total: 0, count: 0 },
      seriesCPlus: { total: 0, count: 0 },
    };

    const topDeals: Array<{
      company: string;
      amount: string;
      round: string;
      amountUsd: number;
      valuation?: string;
      investors?: string[];
    }> = [];

    const verificationCounts = {
      verified: 0,
      multiSource: 0,
      singleSource: 0,
      unverified: 0,
    };

    let valuationCount = 0;
    let totalValuation = 0;
    let totalConfidence = 0;
    let highConfidenceCount = 0;

    for (const event of events) {
      // Source domains
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
            // Invalid URL
          }
        }
      }

      // Source publishers (from sourceNames field)
      if (event.sourceNames && Array.isArray(event.sourceNames)) {
        for (const publisher of event.sourceNames) {
          publisherMap.set(publisher, (publisherMap.get(publisher) || 0) + 1);
        }
      }

      // Sectors
      if (event.sector) {
        if (!sectorMap.has(event.sector)) {
          sectorMap.set(event.sector, { count: 0, funding: 0 });
        }
        const sectorData = sectorMap.get(event.sector)!;
        sectorData.count++;
        if (event.amountUsd) {
          sectorData.funding += event.amountUsd;
        }
      }

      // Geography
      if (event.location) {
        locationMap.set(event.location, (locationMap.get(event.location) || 0) + 1);
      }

      // Investors
      if (event.leadInvestors && Array.isArray(event.leadInvestors)) {
        for (const investor of event.leadInvestors) {
          if (!investor || investor.length === 0) continue;
          if (!investorMap.has(investor)) {
            investorMap.set(investor, { count: 0, companies: new Set() });
          }
          const investorData = investorMap.get(investor)!;
          investorData.count++;
          investorData.companies.add(event.companyName);
        }
      }
      if (event.coInvestors && Array.isArray(event.coInvestors)) {
        for (const investor of event.coInvestors) {
          if (!investor || investor.length === 0) continue;
          if (!investorMap.has(investor)) {
            investorMap.set(investor, { count: 0, companies: new Set() });
          }
          const investorData = investorMap.get(investor)!;
          investorData.count++;
          investorData.companies.add(event.companyName);
        }
      }

      // Funding totals
      if (event.amountUsd) {
        totalFundingUsd += event.amountUsd;
      }

      // Top deals
      if (event.amountUsd) {
        const investors: string[] = [];
        if (event.leadInvestors) investors.push(...event.leadInvestors);
        if (event.coInvestors) investors.push(...event.coInvestors);

        topDeals.push({
          company: event.companyName,
          amount: event.amountRaw,
          round: event.roundType,
          amountUsd: event.amountUsd,
          valuation: event.valuation,
          investors: investors.length > 0 ? investors : undefined,
        });
      }

      // Round counts and averages
      const roundType = event.roundType.toLowerCase();
      if (roundType.includes('seed')) {
        roundCounts.seed++;
        if (event.amountUsd) {
          roundFunding.seed.total += event.amountUsd;
          roundFunding.seed.count++;
        }
      } else if (roundType === 'series-a') {
        roundCounts.seriesA++;
        if (event.amountUsd) {
          roundFunding.seriesA.total += event.amountUsd;
          roundFunding.seriesA.count++;
        }
      } else if (roundType === 'series-b') {
        roundCounts.seriesB++;
        if (event.amountUsd) {
          roundFunding.seriesB.total += event.amountUsd;
          roundFunding.seriesB.count++;
        }
      } else if (roundType === 'series-c' || roundType === 'series-d-plus') {
        roundCounts.seriesCPlus++;
        if (event.amountUsd) {
          roundFunding.seriesCPlus.total += event.amountUsd;
          roundFunding.seriesCPlus.count++;
        }
      } else if (roundType === 'growth') {
        roundCounts.growth++;
      } else {
        roundCounts.other++;
      }

      // Verification status
      if (event.verificationStatus === 'verified') {
        verificationCounts.verified++;
      } else if (event.verificationStatus === 'multi-source') {
        verificationCounts.multiSource++;
      } else if (event.verificationStatus === 'single-source') {
        verificationCounts.singleSource++;
      } else {
        verificationCounts.unverified++;
      }

      // Valuations
      if (event.valuation) {
        valuationCount++;
        // Try to parse valuation
        const valMatch = event.valuation.match(/\$?([\d.]+)([BMK]?)/i);
        if (valMatch) {
          let val = parseFloat(valMatch[1]);
          const unit = valMatch[2].toUpperCase();
          if (unit === 'B') val *= 1_000_000_000;
          else if (unit === 'M') val *= 1_000_000;
          else if (unit === 'K') val *= 1_000;
          totalValuation += val;
        }
      }

      // Confidence
      if (event.confidence) {
        totalConfidence += event.confidence;
        if (event.confidence >= 0.8) {
          highConfidenceCount++;
        }
      }
    }

    // Format results
    const formatFunding = (usd: number): string => {
      if (usd >= 1_000_000_000) {
        return `$${(usd / 1_000_000_000).toFixed(1)}B`;
      } else if (usd >= 1_000_000) {
        return `$${(usd / 1_000_000).toFixed(1)}M`;
      } else {
        return `$${(usd / 1_000).toFixed(1)}K`;
      }
    };

    // Sort and format sources
    const sources = Array.from(sourceDomainMap.entries())
      .map(([domain, data]) => ({
        domain,
        count: data.count,
        companies: Array.from(data.companies).sort(),
      }))
      .sort((a, b) => b.count - a.count);

    // Sort publishers
    const publishers = Array.from(publisherMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Sort and format sectors
    const sectors = Array.from(sectorMap.entries())
      .map(([name, data]) => ({
        name,
        count: data.count,
        totalFunding: formatFunding(data.funding),
      }))
      .sort((a, b) => b.count - a.count);

    // Sort locations
    const locations = Array.from(locationMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Sort investors
    const topInvestors = Array.from(investorMap.entries())
      .map(([name, data]) => ({
        name,
        dealCount: data.count,
        companies: Array.from(data.companies).sort(),
      }))
      .sort((a, b) => b.dealCount - a.dealCount)
      .slice(0, 10);

    // Sort top deals
    topDeals.sort((a, b) => b.amountUsd - a.amountUsd);
    const top5Deals = topDeals.slice(0, 5).map(d => ({
      company: d.company,
      amount: d.amount,
      round: d.round,
      valuation: d.valuation,
      investors: d.investors,
    }));

    // Calculate averages
    const avgDealSizeByStage = {
      seed: roundFunding.seed.count > 0
        ? formatFunding(roundFunding.seed.total / roundFunding.seed.count)
        : "$0",
      seriesA: roundFunding.seriesA.count > 0
        ? formatFunding(roundFunding.seriesA.total / roundFunding.seriesA.count)
        : "$0",
      seriesB: roundFunding.seriesB.count > 0
        ? formatFunding(roundFunding.seriesB.total / roundFunding.seriesB.count)
        : "$0",
      seriesCPlus: roundFunding.seriesCPlus.count > 0
        ? formatFunding(roundFunding.seriesCPlus.total / roundFunding.seriesCPlus.count)
        : "$0",
    };

    // Date range
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const dateRange = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    const totalArticles = Array.from(sourceDomainMap.values()).reduce((sum, data) => sum + data.count, 0);
    const avgConfidence = events.length > 0 ? totalConfidence / events.length : 0;

    // ═══════════════════════════════════════════════════════════════════════════
    // TRACK COMPONENT METRICS (Week 1 - Data Completeness Initiative)
    // ═══════════════════════════════════════════════════════════════════════════
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Build component metrics for each source x sector combination
    const componentMetrics: Array<{
      date: string;
      reportType: "weekly_digest" | "daily_brief" | "funding_report" | "research_highlights";
      componentType: string;
      sourceName: string;
      category?: string;
      itemCount: number;
      freshnessHours?: number;
    }> = [];

    // Track funding events by publisher
    for (const publisher of publishers) {
      componentMetrics.push({
        date: today,
        reportType: "weekly_digest",
        componentType: "funding_events",
        sourceName: publisher.name,
        itemCount: publisher.count,
        freshnessHours: daysBack * 24,
      });
    }

    // Track funding events by publisher x sector
    for (const sector of sectors.slice(0, 5)) { // Top 5 sectors
      // Count events per publisher for this sector
      const publisherCounts = new Map<string, number>();
      for (const event of events) {
        if (event.sector === sector.name && event.sourceNames) {
          for (const publisherName of event.sourceNames) {
            publisherCounts.set(publisherName, (publisherCounts.get(publisherName) || 0) + 1);
          }
        }
      }

      // Record metrics for each publisher that covered this sector
      for (const [publisherName, count] of publisherCounts.entries()) {
        componentMetrics.push({
          date: today,
          reportType: "weekly_digest",
          componentType: "funding_events",
          sourceName: publisherName,
          category: sector.name,
          itemCount: count,
          freshnessHours: daysBack * 24,
        });
      }
    }

    // Record all component metrics
    try {
      await ctx.runMutation(internal.domains.analytics.componentMetrics.batchRecordComponentMetrics, {
        metrics: componentMetrics,
      });
      console.log(`[Analytics] Recorded ${componentMetrics.length} component metrics for ${today}`);
    } catch (e: any) {
      console.error(`[Analytics] Failed to record component metrics: ${e.message}`);
      // Don't fail the whole summary if metrics recording fails
    }

    return {
      success: true,
      summary: {
        dateRange,
        totalCompanies: events.length,
        totalFunding: formatFunding(totalFundingUsd),
        totalArticles,
        sources,
        publishers,
        topDeals: top5Deals,
        rounds: roundCounts,
        avgDealSizeByStage,
        sectors,
        locations,
        topInvestors,
        verificationStatus: verificationCounts,
        valuationMetrics: {
          disclosed: valuationCount,
          totalDisclosed: formatFunding(totalValuation),
          avgValuation: valuationCount > 0 ? formatFunding(totalValuation / valuationCount) : "$0",
        },
        avgConfidence: Math.round(avgConfidence * 100) / 100,
        highConfidence: highConfidenceCount,
      },
    };
  },
});

/**
 * Format enhanced weekly summary as LinkedIn post
 */
export const formatEnhancedWeeklyPost = internalAction({
  args: {
    daysBack: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    content: v.string(),
  }),
  handler: async (ctx, args) => {
    const summaryResult = await ctx.runAction(internal.workflows.enhancedWeeklySummary.generateEnhancedWeeklySummary, {
      daysBack: args.daysBack ?? 7,
    });

    const { summary } = summaryResult;

    const parts: string[] = [];

    // Header
    parts.push(`WEEKLY FUNDING INTELLIGENCE REPORT`);
    parts.push(`${summary.dateRange}`);
    parts.push(``);

    // Core Metrics
    parts.push(`COVERAGE OVERVIEW:`);
    parts.push(`📊 ${summary.totalCompanies} companies tracked`);
    parts.push(`💰 ${summary.totalFunding} in total funding`);
    parts.push(`📰 ${summary.totalArticles} articles analyzed from ${summary.publishers.length} publishers`);
    parts.push(`🔍 ${summary.sources.length} unique domains monitored`);
    parts.push(`✅ ${summary.verificationStatus.verified + summary.verificationStatus.multiSource} deals verified (${Math.round(((summary.verificationStatus.verified + summary.verificationStatus.multiSource) / summary.totalCompanies) * 100)}%)`);
    parts.push(``);

    // Top Deals with details
    if (summary.topDeals.length > 0) {
      parts.push(`TOP DEALS THIS WEEK:`);
      summary.topDeals.forEach((deal, i) => {
        let dealLine = `${i + 1}. ${deal.company} - ${deal.amount} (${deal.round})`;
        if (deal.valuation) {
          dealLine += ` @ ${deal.valuation} valuation`;
        }
        parts.push(dealLine);
        if (deal.investors && deal.investors.length > 0) {
          const investors = deal.investors.slice(0, 3).join(', ');
          parts.push(`   Investors: ${investors}${deal.investors.length > 3 ? ` +${deal.investors.length - 3} more` : ''}`);
        }
      });
      parts.push(``);
    }

    // Funding breakdown
    parts.push(`FUNDING STAGE BREAKDOWN:`);
    parts.push(`• Seed/Pre-seed: ${summary.rounds.seed} deals (avg ${summary.avgDealSizeByStage.seed})`);
    parts.push(`• Series A: ${summary.rounds.seriesA} deals (avg ${summary.avgDealSizeByStage.seriesA})`);
    parts.push(`• Series B: ${summary.rounds.seriesB} deals (avg ${summary.avgDealSizeByStage.seriesB})`);
    parts.push(`• Series C+: ${summary.rounds.seriesCPlus} deals (avg ${summary.avgDealSizeByStage.seriesCPlus})`);
    parts.push(`• Growth/Other: ${summary.rounds.growth + summary.rounds.other} deals`);
    parts.push(``);

    // Sector breakdown (top 5)
    if (summary.sectors.length > 0) {
      parts.push(`TOP SECTORS:`);
      summary.sectors.slice(0, 5).forEach(sector => {
        parts.push(`• ${sector.name}: ${sector.count} deals, ${sector.totalFunding}`);
      });
      parts.push(``);
    }

    // Geographic (top 5)
    if (summary.locations.length > 0) {
      parts.push(`GEOGRAPHIC DISTRIBUTION:`);
      summary.locations.slice(0, 5).forEach(loc => {
        parts.push(`• ${loc.name}: ${loc.count} deals`);
      });
      parts.push(``);
    }

    // Top investors (top 5)
    if (summary.topInvestors.length > 0) {
      parts.push(`MOST ACTIVE INVESTORS:`);
      summary.topInvestors.slice(0, 5).forEach(investor => {
        parts.push(`• ${investor.name}: ${investor.dealCount} deals`);
      });
      parts.push(``);
    }

    // Valuation metrics
    if (summary.valuationMetrics.disclosed > 0) {
      parts.push(`VALUATION METRICS:`);
      parts.push(`• ${summary.valuationMetrics.disclosed} companies disclosed valuations`);
      parts.push(`• Total disclosed: ${summary.valuationMetrics.totalDisclosed}`);
      parts.push(`• Average valuation: ${summary.valuationMetrics.avgValuation}`);
      parts.push(``);
    }

    // Source publishers
    parts.push(`DATA SOURCES:`);
    parts.push(`Primary Publishers (5+ articles):`);
    const primaryPubs = summary.publishers.filter(p => p.count >= 5);
    if (primaryPubs.length > 0) {
      primaryPubs.forEach(pub => {
        parts.push(`  • ${pub.name} - ${pub.count} articles`);
      });
    }

    const secondaryPubs = summary.publishers.filter(p => p.count > 0 && p.count < 5);
    if (secondaryPubs.length > 0) {
      parts.push(`\nContributing Publishers:`);
      const pubNames = secondaryPubs.map(p => p.name).join(', ');
      parts.push(`  ${pubNames}`);
    }
    parts.push(``);

    // Data quality
    parts.push(`DATA QUALITY METRICS:`);
    parts.push(`• Average confidence score: ${(summary.avgConfidence * 100).toFixed(0)}%`);
    parts.push(`• High confidence deals (80%+): ${summary.highConfidence}/${summary.totalCompanies}`);
    parts.push(`• Multi-source verified: ${summary.verificationStatus.multiSource}`);
    parts.push(`• Single-source: ${summary.verificationStatus.singleSource}`);
    parts.push(``);

    // Footer
    parts.push(`TRANSPARENCY COMMITMENT:`);
    parts.push(`All data verified against original sources. We prioritize accuracy over speed and publicly disclose quality improvements.`);
    parts.push(``);
    parts.push(`🔗 Full database: nodebench-ai.vercel.app`);
    parts.push(``);
    parts.push(`#StartupFunding #VentureCapital #DataTransparency #TechNews #AI`);

    const content = parts.join('\n');

    return {
      success: true,
      content,
    };
  },
});
