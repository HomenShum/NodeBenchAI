"use node";

/**
 * PDF Insights Generator
 *
 * AI-powered insights generation for PDF reports.
 * Uses the FREE-FIRST model strategy to generate JPMorgan-style market analysis.
 *
 * Features:
 * - Sector trend analysis
 * - Top investor identification
 * - Market momentum signals
 * - Actionable recommendations
 */

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { generateText } from "ai";
import {
  getLanguageModelSafe,
  executeWithModelFallback,
  type ApprovedModel,
} from "../agents/mcp_tools/models/modelResolver";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface FundingDealInput {
  companyName: string;
  roundType: string;
  amountRaw: string;
  amountUsd?: number;
  leadInvestors: string[];
  sector?: string;
  location?: string;
  announcedAt: number;
}

interface GeneratedInsights {
  summary: string;
  sectorTrends: Array<{
    sector: string;
    trend: "bullish" | "bearish" | "neutral";
    signal: string;
  }>;
  topInvestors: Array<{
    name: string;
    dealCount: number;
    sectors: string[];
  }>;
  marketMomentum: string;
  actionableInsights: string[];
  generatedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

const PDF_INSIGHTS_PROMPT = `You are a senior investment analyst at JPMorgan generating a quarterly funding report.

Analyze the provided funding deals and generate a professional market analysis following this structure:

## EXECUTIVE SUMMARY (2-3 sentences)
Summarize the overall market activity, total capital deployed, and dominant themes.

## SECTOR TRENDS (3-5 bullets)
For each active sector:
- Identify if it's bullish (increasing deal flow/sizes), bearish (declining), or neutral
- Provide ONE specific data-backed signal (e.g., "AI/ML saw 5 deals totaling $450M, up from 3 deals/$200M last quarter")

## TOP INVESTORS (3-5 investors)
List the most active investors with:
- Number of deals
- Primary sectors of focus
- Notable portfolio additions

## MARKET MOMENTUM
One paragraph on overall market sentiment based on:
- Deal sizes (mega-rounds vs seed activity)
- Geographic distribution
- New vs existing investor participation

## ACTIONABLE INSIGHTS (3-5 bullets)
Concrete recommendations for:
- Founders: Which sectors/stages are hot
- Investors: Where to focus due diligence
- Corporates: M&A targets or partnership opportunities

RULES:
1. Use ONLY data from the provided deals - no fabrication
2. Be specific with numbers and percentages
3. Professional tone - no hype words
4. Max 500 words total
5. Format for executive consumption`;

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHTS GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate AI insights for a quarterly funding report.
 * Uses FREE-FIRST model strategy with automatic fallback.
 */
export const generatePDFInsights = action({
  args: {
    deals: v.array(
      v.object({
        companyName: v.string(),
        roundType: v.string(),
        amountRaw: v.string(),
        amountUsd: v.optional(v.number()),
        leadInvestors: v.array(v.string()),
        sector: v.optional(v.string()),
        location: v.optional(v.string()),
        announcedAt: v.number(),
      })
    ),
    quarterLabel: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    insights?: string;
    structured?: GeneratedInsights;
    error?: string;
    modelUsed?: string;
    isFree?: boolean;
  }> => {
    const startTime = Date.now();

    if (!args.deals || args.deals.length === 0) {
      return {
        success: false,
        error: "No deals provided for analysis",
      };
    }

    // Calculate summary statistics
    const totalDeals = args.deals.length;
    const totalAmountUsd = args.deals.reduce((sum: number, d: { amountUsd?: number }) => sum + (d.amountUsd || 0), 0);
    const totalAmountFormatted = formatCurrency(totalAmountUsd);

    // Aggregate by sector
    const sectorMap = new Map<string, { count: number; amount: number; deals: string[] }>();
    for (const deal of args.deals) {
      const sector = deal.sector || "Unknown";
      const existing = sectorMap.get(sector) || { count: 0, amount: 0, deals: [] };
      sectorMap.set(sector, {
        count: existing.count + 1,
        amount: existing.amount + (deal.amountUsd || 0),
        deals: [...existing.deals, deal.companyName],
      });
    }

    // Aggregate by investor
    const investorMap = new Map<string, { count: number; sectors: Set<string>; deals: string[] }>();
    for (const deal of args.deals) {
      for (const investor of deal.leadInvestors || []) {
        const existing = investorMap.get(investor) || { count: 0, sectors: new Set(), deals: [] };
        if (deal.sector) existing.sectors.add(deal.sector);
        investorMap.set(investor, {
          count: existing.count + 1,
          sectors: existing.sectors,
          deals: [...existing.deals, deal.companyName],
        });
      }
    }

    // Type for deal objects
    type Deal = typeof args.deals[0];

    // Prepare deals data for LLM
    const dealsText = args.deals
      .sort((a: Deal, b: Deal) => (b.amountUsd || 0) - (a.amountUsd || 0))
      .slice(0, 20) // Limit to top 20 for context window
      .map((d: Deal, i: number) => {
        const investors = d.leadInvestors?.join(", ") || "Undisclosed";
        return `${i + 1}. ${d.companyName} | ${d.roundType} | ${d.amountRaw} | Sector: ${d.sector || "Unknown"} | Lead: ${investors}`;
      })
      .join("\n");

    // Prepare sector summary
    const sectorSummary = Array.from(sectorMap.entries())
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 5)
      .map(([sector, data]) => `${sector}: ${data.count} deals, ${formatCurrency(data.amount)}`)
      .join("\n");

    // Prepare investor summary
    const investorSummary = Array.from(investorMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([investor, data]) => `${investor}: ${data.count} deals in ${Array.from(data.sectors).join(", ")}`)
      .join("\n");

    const prompt = `${PDF_INSIGHTS_PROMPT}

QUARTER: ${args.quarterLabel}
TOTAL DEALS: ${totalDeals}
TOTAL CAPITAL: ${totalAmountFormatted}

SECTOR BREAKDOWN:
${sectorSummary}

TOP INVESTORS:
${investorSummary}

INDIVIDUAL DEALS:
${dealsText}

Generate the analysis now:`;

    try {
      // Use FREE-FIRST model strategy with fallback
      const { result, modelUsed, isFree } = await executeWithModelFallback(
        async (model, modelId) => {
          const response = await generateText({
            model,
            prompt,
            maxOutputTokens: 1000,
            temperature: 0.3, // Lower temperature for factual analysis
          } as any);
          return response.text;
        },
        {
          startModel: args.model as ApprovedModel | undefined,
          onFallback: (from, to, error) => {
            console.log(`[pdfInsights] Falling back from ${from} to ${to}: ${error.message}`);
          },
        }
      );

      const processingTimeMs = Date.now() - startTime;
      console.log(`[pdfInsights] Generated insights in ${processingTimeMs}ms using ${modelUsed} (free=${isFree})`);

      // Parse the structured output (best effort)
      const structured = parseInsightsText(result, args.deals);

      return {
        success: true,
        insights: result,
        structured,
        modelUsed,
        isFree,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[pdfInsights] Failed to generate insights: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
      };
    }
  },
});

/**
 * Internal action for scheduled PDF generation (no auth required)
 */
export const generatePDFInsightsInternal = internalAction({
  args: {
    deals: v.array(
      v.object({
        companyName: v.string(),
        roundType: v.string(),
        amountRaw: v.string(),
        amountUsd: v.optional(v.number()),
        leadInvestors: v.array(v.string()),
        sector: v.optional(v.string()),
        location: v.optional(v.string()),
        announcedAt: v.number(),
      })
    ),
    quarterLabel: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Re-use the public action handler logic
    // Note: In production, you'd share the core logic
    const startTime = Date.now();

    if (!args.deals || args.deals.length === 0) {
      return {
        success: false,
        error: "No deals provided for analysis",
      };
    }

    // Type for deal objects
    type DealType = typeof args.deals[0];

    const totalDeals = args.deals.length;
    const totalAmountUsd = args.deals.reduce((sum: number, d: DealType) => sum + (d.amountUsd || 0), 0);
    const totalAmountFormatted = formatCurrency(totalAmountUsd);

    // Aggregate by sector
    const sectorMap = new Map<string, { count: number; amount: number }>();
    for (const deal of args.deals) {
      const sector = deal.sector || "Unknown";
      const existing = sectorMap.get(sector) || { count: 0, amount: 0 };
      sectorMap.set(sector, {
        count: existing.count + 1,
        amount: existing.amount + (deal.amountUsd || 0),
      });
    }

    // Aggregate by investor
    const investorMap = new Map<string, { count: number; sectors: Set<string> }>();
    for (const deal of args.deals) {
      for (const investor of deal.leadInvestors || []) {
        const existing = investorMap.get(investor) || { count: 0, sectors: new Set() };
        if (deal.sector) existing.sectors.add(deal.sector);
        investorMap.set(investor, {
          count: existing.count + 1,
          sectors: existing.sectors,
        });
      }
    }

    const dealsText = args.deals
      .sort((a: DealType, b: DealType) => (b.amountUsd || 0) - (a.amountUsd || 0))
      .slice(0, 20)
      .map((d: DealType, i: number) => {
        const investors = d.leadInvestors?.join(", ") || "Undisclosed";
        return `${i + 1}. ${d.companyName} | ${d.roundType} | ${d.amountRaw} | Sector: ${d.sector || "Unknown"} | Lead: ${investors}`;
      })
      .join("\n");

    const sectorSummary = Array.from(sectorMap.entries())
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 5)
      .map(([sector, data]) => `${sector}: ${data.count} deals, ${formatCurrency(data.amount)}`)
      .join("\n");

    const investorSummary = Array.from(investorMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([investor, data]) => `${investor}: ${data.count} deals in ${Array.from(data.sectors).join(", ")}`)
      .join("\n");

    const prompt = `${PDF_INSIGHTS_PROMPT}

QUARTER: ${args.quarterLabel}
TOTAL DEALS: ${totalDeals}
TOTAL CAPITAL: ${totalAmountFormatted}

SECTOR BREAKDOWN:
${sectorSummary}

TOP INVESTORS:
${investorSummary}

INDIVIDUAL DEALS:
${dealsText}

Generate the analysis now:`;

    try {
      const { result, modelUsed, isFree } = await executeWithModelFallback(
        async (model) => {
          const response = await generateText({
            model,
            prompt,
            maxOutputTokens: 1000,
            temperature: 0.3,
          } as any);
          return response.text;
        },
        {
          startModel: args.model as ApprovedModel | undefined,
        }
      );

      console.log(`[pdfInsights] Internal: Generated in ${Date.now() - startTime}ms using ${modelUsed}`);

      return {
        success: true,
        insights: result,
        modelUsed,
        isFree,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  }
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`;
  }
  return `$${amount.toFixed(0)}`;
}

/**
 * Parse insights text into structured format (best effort)
 */
function parseInsightsText(text: string, deals: FundingDealInput[]): GeneratedInsights {
  // Extract executive summary (first paragraph after header)
  const summaryMatch = text.match(/EXECUTIVE SUMMARY[:\s]*\n?(.+?)(?=\n\n|##)/is);
  const summary = summaryMatch?.[1]?.trim() || text.slice(0, 300);

  // Extract sector trends (best effort)
  const sectorTrends: GeneratedInsights["sectorTrends"] = [];
  const sectorSection = text.match(/SECTOR TRENDS[:\s]*\n?([\s\S]+?)(?=##|TOP INVESTORS)/i);
  if (sectorSection) {
    const bullets = sectorSection[1].match(/[-*]\s*([^-*\n]+)/g) || [];
    for (const bullet of bullets.slice(0, 5)) {
      const cleanBullet = bullet.replace(/^[-*]\s*/, "").trim();
      const isBullish = /bullish|increasing|growing|strong|surge/i.test(cleanBullet);
      const isBearish = /bearish|declining|weak|slow/i.test(cleanBullet);
      sectorTrends.push({
        sector: cleanBullet.split(/[:\-–]/)[0]?.trim() || "General",
        trend: isBullish ? "bullish" : isBearish ? "bearish" : "neutral",
        signal: cleanBullet,
      });
    }
  }

  // Extract top investors from the deals data
  const investorMap = new Map<string, { count: number; sectors: Set<string> }>();
  for (const deal of deals) {
    for (const investor of deal.leadInvestors || []) {
      const existing = investorMap.get(investor) || { count: 0, sectors: new Set() };
      if (deal.sector) existing.sectors.add(deal.sector);
      investorMap.set(investor, {
        count: existing.count + 1,
        sectors: existing.sectors,
      });
    }
  }
  const topInvestors = Array.from(investorMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([name, data]) => ({
      name,
      dealCount: data.count,
      sectors: Array.from(data.sectors),
    }));

  // Extract market momentum
  const momentumMatch = text.match(/MARKET MOMENTUM[:\s]*\n?([\s\S]+?)(?=##|ACTIONABLE)/i);
  const marketMomentum = momentumMatch?.[1]?.trim() || "Market activity remains steady.";

  // Extract actionable insights
  const actionableInsights: string[] = [];
  const actionSection = text.match(/ACTIONABLE INSIGHTS[:\s]*\n?([\s\S]+?)$/i);
  if (actionSection) {
    const bullets = actionSection[1].match(/[-*]\s*([^-*\n]+)/g) || [];
    for (const bullet of bullets.slice(0, 5)) {
      actionableInsights.push(bullet.replace(/^[-*]\s*/, "").trim());
    }
  }

  return {
    summary,
    sectorTrends,
    topInvestors,
    marketMomentum,
    actionableInsights,
    generatedAt: Date.now(),
  };
}
