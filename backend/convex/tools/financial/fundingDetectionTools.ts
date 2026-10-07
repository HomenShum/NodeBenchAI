/**
 * Funding Detection Tools for Agent Integration
 * 
 * These tools expose the funding detection and enrichment pipeline
 * to the Deep Agent system, allowing users to query funding information
 * through natural language in the Fast Agent Panel.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../../_generated/api";
import { internal } from "../../_generated/api";

/**
 * Get today's funding events detected from feed items
 * Returns structured funding data with company names, amounts, investors, etc.
 */
export const getTodaysFundingEvents = createTool({
  description: `Get today's funding events that were automatically detected from news feeds.
  
  Returns structured funding data including:
  - Company name and sector
  - Funding round type (seed, series-a, etc.)
  - Amount raised (raw text and USD value)
  - Lead investors and co-investors
  - Confidence score and verification status
  - Source URLs and attribution
  
  Use this when users ask about recent funding, today's deals, or what companies raised money.`,

  args: z.object({
    lookbackHours: z.number().optional().default(24).describe("How many hours to look back (default: 24)"),
    minConfidence: z.number().optional().default(0.5).describe("Minimum confidence score (0-1, default: 0.5)"),
    limit: z.number().optional().default(20).describe("Maximum number of events to return"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      const events = await ctx.runQuery(api.domains.enrichment.fundingQueries.getRecentFundingEvents, {
        lookbackHours: args.lookbackHours,
        limit: args.limit,
        minConfidence: args.minConfidence,
      });

      if (!events || events.length === 0) {
        return `No funding events found in the last ${args.lookbackHours} hours with confidence >= ${args.minConfidence}.

Try:
- Expanding the lookback period
- Lowering the confidence threshold
- Checking if the feed ingestion is running`;
      }

      // Format response
      const lines: string[] = [];
      lines.push(`# Recent Funding Events (Last ${args.lookbackHours}h)`);
      lines.push(`\nFound ${events.length} funding events:\n`);

      events.forEach((event: any, idx: number) => {
        lines.push(`## ${idx + 1}. ${event.companyName}`);
        lines.push(`- **Round:** ${event.roundType}`);
        if (event.amountUsd) {
          lines.push(`- **Amount:** $${(event.amountUsd / 1_000_000).toFixed(1)}M USD`);
        } else if (event.amountRaw) {
          lines.push(`- **Amount:** ${event.amountRaw}`);
        }
        if (event.leadInvestors && event.leadInvestors.length > 0) {
          lines.push(`- **Lead Investors:** ${event.leadInvestors.join(', ')}`);
        }
        if (event.sector) {
          lines.push(`- **Sector:** ${event.sector}`);
        }
        lines.push(`- **Confidence:** ${(event.confidence * 100).toFixed(0)}%`);
        lines.push(`- **Verification:** ${event.verificationStatus}`);
        if (event.sourceUrls && event.sourceUrls.length > 0) {
          lines.push(`- **Sources:** ${event.sourceUrls.slice(0, 2).join(', ')}`);
        }
        lines.push('');
      });

      return lines.join('\n');
    } catch (error: any) {
      console.error('[getTodaysFundingEvents] Error:', error);
      return `Error fetching funding events: ${error.message}`;
    }
  },
});

/**
 * Search funding events by company name or criteria
 */
export const searchFundingEvents = createTool({
  description: `Search for funding events by company name, round type, or time period.
  
  Use this when users ask about:
  - Specific company funding history
  - Funding rounds of a certain type (seed, series-a, etc.)
  - Historical funding data
  
  Returns detailed funding information with sources.`,

  args: z.object({
    companyName: z.string().optional().describe("Company name to search for"),
    roundTypes: z.array(z.enum(['seed', 'pre-seed', 'series-a', 'series-b', 'series-c', 'series-d', 'series-e', 'bridge', 'convertible', 'unknown'])).optional().describe("Filter by round types"),
    lookbackHours: z.number().optional().default(168).describe("How many hours to look back (default: 168 = 1 week)"),
    minConfidence: z.number().optional().default(0.3).describe("Minimum confidence score"),
    limit: z.number().optional().default(50).describe("Maximum results"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      // If company name provided, use company search
      if (args.companyName) {
        const events = await ctx.runQuery(api.domains.enrichment.fundingQueries.searchFundingByCompany, {
          companyName: args.companyName,
        });

        if (!events || events.length === 0) {
          return `No funding events found for "${args.companyName}".`;
        }

        const lines: string[] = [];
        lines.push(`# Funding History: ${args.companyName}`);
        lines.push(`\nFound ${events.length} funding event(s):\n`);

        events.forEach((event: any, idx: number) => {
          lines.push(`## ${idx + 1}. ${event.roundType} Round`);
          lines.push(`- **Date:** ${new Date(event.announcedAt).toLocaleDateString()}`);
          if (event.amountUsd) {
            lines.push(`- **Amount:** $${(event.amountUsd / 1_000_000).toFixed(1)}M`);
          }
          if (event.leadInvestors?.length > 0) {
            lines.push(`- **Investors:** ${event.leadInvestors.join(', ')}`);
          }
          lines.push('');
        });

        return lines.join('\n');
      }

      // Otherwise use general search with filters
      const events = await ctx.runQuery(api.domains.enrichment.fundingQueries.getRecentFundingEvents, {
        lookbackHours: args.lookbackHours,
        roundTypes: args.roundTypes,
        minConfidence: args.minConfidence,
        limit: args.limit,
      });

      if (!events || events.length === 0) {
        return `No funding events found matching the criteria.`;
      }

      return `Found ${events.length} funding events. Use getTodaysFundingEvents for detailed formatting.`;
    } catch (error: any) {
      console.error('[searchFundingEvents] Error:', error);
      return `Error searching funding events: ${error.message}`;
    }
  },
});

/**
 * Trigger manual funding detection scan
 * Scans recent feed items for funding announcements
 */
export const detectFundingFromFeeds = createTool({
  description: `Manually trigger funding detection from recent feed items.

  This scans recent news feed items for funding announcements and creates
  funding events in the database. Useful when:
  - User wants to refresh funding data
  - Checking for new funding announcements
  - Testing the detection pipeline

  Returns a summary of detected funding candidates.`,

  args: z.object({
    lookbackHours: z.number().optional().default(24).describe("How many hours of feed items to scan"),
    minConfidence: z.number().optional().default(0.5).describe("Minimum confidence threshold"),
    limit: z.number().optional().default(100).describe("Maximum feed items to scan"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(internal.domains.enrichment.fundingDetection.detectFundingCandidates, {
        lookbackHours: args.lookbackHours,
        minConfidence: args.minConfidence,
        limit: args.limit,
      });

      if (!result || result.length === 0) {
        return `No funding candidates detected in the last ${args.lookbackHours} hours with confidence >= ${args.minConfidence}.

This could mean:
- No funding announcements in recent feeds
- Feed ingestion may not be running
- Confidence threshold is too high`;
      }

      const lines: string[] = [];
      lines.push(`# Funding Detection Results`);
      lines.push(`\nScanned last ${args.lookbackHours} hours of feed items`);
      lines.push(`Found ${result.length} funding candidates:\n`);

      result.forEach((candidate: any, idx: number) => {
        lines.push(`## ${idx + 1}. ${candidate.title}`);
        lines.push(`- **Source:** ${candidate.source}`);
        lines.push(`- **Confidence:** ${(candidate.confidence * 100).toFixed(0)}%`);
        if (candidate.extractedData?.companyName) {
          lines.push(`- **Company:** ${candidate.extractedData.companyName}`);
        }
        if (candidate.extractedData?.amountRaw) {
          lines.push(`- **Amount:** ${candidate.extractedData.amountRaw}`);
        }
        if (candidate.extractedData?.roundType) {
          lines.push(`- **Round:** ${candidate.extractedData.roundType}`);
        }
        if (candidate.extractedData?.leadInvestors?.length > 0) {
          lines.push(`- **Investors:** ${candidate.extractedData.leadInvestors.join(', ')}`);
        }
        lines.push(`- **URL:** ${candidate.url}`);
        lines.push('');
      });

      lines.push(`\n💡 **Next Steps:**`);
      lines.push(`- These candidates will be processed by the enrichment pipeline`);
      lines.push(`- Use getTodaysFundingEvents to see verified funding events`);

      return lines.join('\n');
    } catch (error: any) {
      console.error('[detectFundingFromFeeds] Error:', error);
      return `Error detecting funding: ${error.message}`;
    }
  },
});

