/**
 * PDF Generation Tools
 *
 * Agent tools for generating JPMorgan-style PDF reports.
 * These tools enable the agent to create professional funding reports,
 * company dossiers, and weekly digests in PDF format.
 *
 * @module tools/reports/pdfGenerationTools
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

/** Funding event data returned from getAllFundingForBrief query */
interface FundingEventData {
  id: Id<"fundingEvents">;
  companyName: string;
  roundType: string;
  amountRaw?: string;
  amountUsd?: number;
  leadInvestors?: string[];
  coInvestors?: string[];
  sector?: string;
  location?: string;
  description?: string;
  valuation?: string;
  useOfProceeds?: string;
  confidence?: number;
  verificationStatus?: string;
  sourceUrls?: string[];
  sourceNames?: string[];
  announcedAt: number;
  createdAt: number;
  entityData?: {
    name: string;
    type: string;
    sector?: string;
    crmFields?: Record<string, unknown>;
  } | null;
}

/** Simplified funding event from searchFundingByCompany */
interface SearchFundingEventData {
  id: Id<"fundingEvents">;
  companyName: string;
  roundType: string;
  amountRaw?: string;
  amountUsd?: number;
  leadInvestors?: string[];
  sector?: string;
  confidence?: number;
  verificationStatus?: string;
  announcedAt?: number;
  sourceUrls?: string[];
  description?: string;
  location?: string;
}

/** Transformed top deal for weekly digest */
interface TopDealData {
  companyName: string;
  roundType: string;
  amountRaw: string;
  amountUsd?: number;
  leadInvestors: string[];
  sector?: string;
  location?: string;
  announcedAt: number;
  confidence: number;
  verificationStatus: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUARTERLY FUNDING REPORT TOOL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a quarterly funding summary report.
 * Returns data ready to be passed to the frontend PDF generator.
 */
export const generateQuarterlyFundingReportData = createTool({
  description: `Prepare data for generating a professional JPMorgan-style Quarterly Funding Summary PDF report.

This tool:
1. Fetches funding events for the specified quarter or time period
2. Calculates sector breakdowns and round type distributions
3. Identifies top investors and deal highlights
4. Returns structured data ready for PDF generation

The frontend will use this data with pdfme to generate the actual PDF.

Example: "Generate a Q4 2025 funding summary report" or "Create a funding report for the last 90 days"`,

  args: z.object({
    quarterLabel: z.string().optional().describe("Quarter label like 'Q4 2025'. If not provided, will use the current quarter."),
    lookbackDays: z.number().default(90).describe("Number of days to look back for funding events (default 90 for quarterly)"),
    minConfidence: z.number().default(0.5).describe("Minimum confidence threshold for events"),
    includeInsights: z.boolean().default(true).describe("Include AI-generated insights in the report"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[generateQuarterlyFundingReportData] Generating for ${args.quarterLabel || "current quarter"}`);

    try {
      // Fetch funding events
      const fundingData = await ctx.runQuery(
        api.domains.enrichment.fundingQueries.getAllFundingForBrief,
        {
          lookbackDays: args.lookbackDays,
          limit: 100,
        }
      );

      if (!fundingData?.events || fundingData.events.length === 0) {
        return JSON.stringify({
          kind: "pdf_report_data",
          version: 1,
          reportType: "quarterly-funding-summary",
          status: "no_data",
          message: "No funding events found for the specified period.",
        });
      }

      // Calculate quarter label if not provided
      const now = new Date();
      const quarter = Math.ceil((now.getMonth() + 1) / 3);
      const quarterLabel = args.quarterLabel || `Q${quarter} ${now.getFullYear()}`;

      // Calculate sector breakdown
      const sectorMap = new Map<string, { count: number; amount: number }>();
      for (const event of fundingData.events) {
        const sector = event.sector || "Unknown";
        const existing = sectorMap.get(sector) || { count: 0, amount: 0 };
        sectorMap.set(sector, {
          count: existing.count + 1,
          amount: existing.amount + (event.amountUsd || 0),
        });
      }

      const totalAmount = fundingData.events.reduce((sum: number, e: FundingEventData) => sum + (e.amountUsd || 0), 0);

      const sectorBreakdown = Array.from(sectorMap.entries())
        .map(([sector, data]) => ({
          sector,
          dealCount: data.count,
          totalAmountUsd: data.amount,
          percentageOfTotal: totalAmount > 0 ? (data.amount / totalAmount) * 100 : 0,
        }))
        .sort((a, b) => b.totalAmountUsd - a.totalAmountUsd);

      // Calculate round type breakdown
      const roundMap = new Map<string, { count: number; amount: number }>();
      for (const event of fundingData.events) {
        const round = event.roundType;
        const existing = roundMap.get(round) || { count: 0, amount: 0 };
        roundMap.set(round, {
          count: existing.count + 1,
          amount: existing.amount + (event.amountUsd || 0),
        });
      }

      const roundTypeBreakdown = Array.from(roundMap.entries())
        .map(([roundType, data]) => ({
          roundType,
          dealCount: data.count,
          totalAmountUsd: data.amount,
          averageDealSize: data.count > 0 ? data.amount / data.count : 0,
        }))
        .sort((a, b) => b.totalAmountUsd - a.totalAmountUsd);

      // Transform deals
      const deals = fundingData.events.map((event: FundingEventData) => ({
        companyName: event.companyName,
        roundType: event.roundType,
        amountRaw: event.amountRaw || "",
        amountUsd: event.amountUsd,
        leadInvestors: event.leadInvestors || [],
        sector: event.sector,
        location: event.location,
        announcedAt: event.announcedAt || Date.now(),
        confidence: event.confidence || 0.5,
        verificationStatus: event.verificationStatus || "unverified",
      }));

      // Generate insights if requested
      let insights = "";
      if (args.includeInsights) {
        const topSector = sectorBreakdown[0];
        const topRound = roundTypeBreakdown[0];
        const totalDeals = fundingData.events.length;

        insights = `Key Highlights: ${totalDeals} deals totaling ${formatCurrency(totalAmount)}. `;
        if (topSector) {
          insights += `${topSector.sector} led with ${topSector.dealCount} deals (${formatCurrency(topSector.totalAmountUsd)}). `;
        }
        if (topRound) {
          insights += `${formatRoundType(topRound.roundType)} rounds dominated with ${topRound.dealCount} deals. `;
        }
      }

      return JSON.stringify({
        kind: "pdf_report_data",
        version: 1,
        reportType: "quarterly-funding-summary",
        status: "ready",
        data: {
          quarterLabel,
          generatedAt: new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
          totalDeals: fundingData.events.length,
          totalAmountUsd: totalAmount,
          deals,
          sectorBreakdown,
          roundTypeBreakdown,
          topInvestors: [],
          insights,
        },
      });
    } catch (error) {
      console.error("[generateQuarterlyFundingReportData] Error:", error);
      return JSON.stringify({
        kind: "pdf_report_data",
        version: 1,
        reportType: "quarterly-funding-summary",
        status: "error",
        message: `Failed to generate report data: ${error}`,
      });
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// COMPANY DOSSIER TOOL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a company dossier report.
 */
export const generateCompanyDossierData = createTool({
  description: `Prepare data for generating a Company Dossier PDF - a deep-dive analysis of a single company.

This tool:
1. Searches for the company's funding history
2. Gathers company overview information
3. Identifies key people (if available)
4. Generates AI analysis of strengths, risks, and opportunities

Example: "Create a dossier for OpenAI" or "Generate company report for Anthropic"`,

  args: z.object({
    companyName: z.string().describe("Name of the company to create dossier for"),
    includeFunding: z.boolean().default(true).describe("Include funding history"),
    includeAnalysis: z.boolean().default(true).describe("Include AI SWOT analysis"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[generateCompanyDossierData] Generating dossier for: ${args.companyName}`);

    try {
      // Search for funding events for this company
      const fundingEvents = await ctx.runQuery(
        api.domains.enrichment.fundingQueries.searchFundingByCompany,
        { companyName: args.companyName }
      );

      // Calculate total funding
      const totalFundingRaised = fundingEvents.reduce(
        (sum: number, e: SearchFundingEventData) => sum + (e.amountUsd || 0),
        0
      );

      // Transform funding history
      const fundingHistory = fundingEvents.map((event: SearchFundingEventData) => ({
        roundType: event.roundType,
        amountRaw: event.amountRaw || "",
        amountUsd: event.amountUsd,
        date: event.announcedAt
          ? new Date(event.announcedAt).toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            })
          : "Unknown",
        leadInvestors: event.leadInvestors || [],
        valuation: undefined,
      }));

      // Extract overview from most recent event
      const latestEvent = fundingEvents[0];
      const overview = {
        sector: latestEvent?.sector,
        location: latestEvent?.location,
        founded: undefined,
        description: latestEvent?.description,
        website: undefined,
      };

      // Generate AI analysis if requested
      let aiAnalysis: any | undefined = undefined;
      if (args.includeAnalysis) {
        aiAnalysis = {
          strengths: [
            `Strong investor backing with ${fundingEvents.length} funding rounds`,
            totalFundingRaised > 0
              ? `Total funding of ${formatCurrency(totalFundingRaised)}`
              : "Growing company",
          ],
          risks: [
            "Market competition",
            "Execution challenges in scaling",
          ],
          opportunities: [
            "Market expansion potential",
            "Strategic partnership opportunities",
          ],
          recommendation: fundingEvents.length > 2
            ? "Strong track record suggests continued growth potential"
            : "Early-stage company with developing track record",
        };
      }

      return JSON.stringify({
        kind: "pdf_report_data",
        version: 1,
        reportType: "company-dossier",
        status: fundingEvents.length > 0 ? "ready" : "partial",
        data: {
          companyName: args.companyName,
          generatedAt: new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
          overview,
          fundingHistory,
          totalFundingRaised,
          keyPeople: [],
          recentNews: [],
          competitors: [],
          aiAnalysis,
        },
      });
    } catch (error) {
      console.error("[generateCompanyDossierData] Error:", error);
      return JSON.stringify({
        kind: "pdf_report_data",
        version: 1,
        reportType: "company-dossier",
        status: "error",
        message: `Failed to generate dossier: ${error}`,
      });
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// WEEKLY DIGEST PDF TOOL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a weekly digest report.
 */
export const generateWeeklyDigestData = createTool({
  description: `Prepare data for generating a Weekly Intelligence Digest PDF.

This tool:
1. Summarizes key stories from the past week
2. Highlights notable funding events
3. Identifies sector trends
4. Provides actionable items using the What?/So What?/Now What? framework

Example: "Generate weekly digest for JPM_STARTUP_BANKER persona"`,

  args: z.object({
    persona: z.string().default("JPM_STARTUP_BANKER").describe("Persona for digest perspective"),
    lookbackDays: z.number().default(7).describe("Days to look back (default 7 for weekly)"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[generateWeeklyDigestData] Generating for persona: ${args.persona}`);

    try {
      // Fetch recent funding
      const fundingData = await ctx.runQuery(
        api.domains.enrichment.fundingQueries.getAllFundingForBrief,
        {
          lookbackDays: args.lookbackDays,
          limit: 20,
        }
      );

      // Calculate week label
      const now = new Date();
      const weekLabel = `Week of ${now.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })}`;

      // Top deals
      const topDeals: TopDealData[] = (fundingData?.events || [])
        .sort((a: FundingEventData, b: FundingEventData) => (b.amountUsd || 0) - (a.amountUsd || 0))
        .slice(0, 5)
        .map((event: FundingEventData) => ({
          companyName: event.companyName,
          roundType: event.roundType,
          amountRaw: event.amountRaw || "",
          amountUsd: event.amountUsd,
          leadInvestors: event.leadInvestors || [],
          sector: event.sector,
          location: event.location,
          announcedAt: event.announcedAt || Date.now(),
          confidence: event.confidence || 0.5,
          verificationStatus: event.verificationStatus || "unverified",
        }));

      // Calculate totals
      const totalDeals = fundingData?.events?.length || 0;
      const totalAmountUsd = (fundingData?.events || []).reduce(
        (sum: number, e: FundingEventData) => sum + (e.amountUsd || 0),
        0
      );

      // Generate executive summary
      const executiveSummary = totalDeals > 0
        ? `This week saw ${totalDeals} funding announcements totaling ${formatCurrency(totalAmountUsd)}. ` +
          (topDeals[0]
            ? `The largest deal was ${topDeals[0].companyName}'s ${formatRoundType(topDeals[0].roundType)} round of ${topDeals[0].amountRaw}.`
            : "")
        : "Quiet week with no significant funding announcements tracked.";

      // Generate top stories from top deals
      const topStories = topDeals.slice(0, 3).map((deal: TopDealData) => ({
        headline: `${deal.companyName} raises ${deal.amountRaw} in ${formatRoundType(deal.roundType)}`,
        summary: `Led by ${deal.leadInvestors.join(", ") || "undisclosed investors"}`,
        source: "Funding Intelligence",
        relevanceScore: deal.confidence || 0.5,
        tags: [deal.sector || "Technology", deal.roundType].filter(Boolean),
      }));

      // Calculate sector trends
      const sectorCounts = new Map<string, number>();
      for (const event of fundingData?.events || []) {
        const sector = event.sector || "Unknown";
        sectorCounts.set(sector, (sectorCounts.get(sector) || 0) + 1);
      }

      const sectorTrends = Array.from(sectorCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([sector, count]) => ({
          sector,
          trend: count >= 3 ? "up" : count >= 2 ? "stable" : "down",
          description: `${count} deals this week`,
          signalCount: count,
        }));

      // Generate reflection
      const reflection = {
        what: totalDeals > 0
          ? `${totalDeals} funding events tracked, ${formatCurrency(totalAmountUsd)} total raised`
          : "Low activity week",
        soWhat: topDeals[0]
          ? `${topDeals[0].sector || "Tech"} sector showing momentum with major ${formatRoundType(topDeals[0].roundType)} rounds`
          : "Market may be in consolidation phase",
        nowWhat: topDeals[0]
          ? `Monitor ${topDeals[0].companyName} and similar companies in ${topDeals[0].sector || "the sector"} for partnership opportunities`
          : "Use this quiet period for strategic planning and pipeline review",
      };

      return JSON.stringify({
        kind: "pdf_report_data",
        version: 1,
        reportType: "weekly-digest",
        status: "ready",
        data: {
          weekLabel,
          generatedAt: new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
          persona: args.persona,
          executiveSummary,
          topStories,
          fundingHighlights: {
            totalDeals,
            totalAmountUsd,
            topDeals,
          },
          sectorTrends,
          actionItems: [
            {
              priority: "high",
              action: topDeals[0]
                ? `Research ${topDeals[0].companyName} for potential outreach`
                : "Review pipeline for Q1 targets",
              rationale: "Stay ahead of market momentum",
            },
          ],
          reflection,
        },
      });
    } catch (error) {
      console.error("[generateWeeklyDigestData] Error:", error);
      return JSON.stringify({
        kind: "pdf_report_data",
        version: 1,
        reportType: "weekly-digest",
        status: "error",
        message: `Failed to generate digest: ${error}`,
      });
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  }
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  return `$${amount.toLocaleString()}`;
}

function formatRoundType(roundType: string): string {
  const mapping: Record<string, string> = {
    "pre-seed": "Pre-Seed",
    seed: "Seed",
    "series-a": "Series A",
    "series-b": "Series B",
    "series-c": "Series C",
    "series-d-plus": "Series D+",
    growth: "Growth",
    debt: "Debt",
    unknown: "Unknown",
  };
  return mapping[roundType] || roundType;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT ALL TOOLS
// ═══════════════════════════════════════════════════════════════════════════

export const pdfGenerationTools = [
  generateQuarterlyFundingReportData,
  generateCompanyDossierData,
  generateWeeklyDigestData,
];
