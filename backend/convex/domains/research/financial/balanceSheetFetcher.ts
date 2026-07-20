/**
 * Balance Sheet Data Fetcher
 *
 * Fetches real balance sheet data from SEC EDGAR:
 * - Shares outstanding
 * - Total debt
 * - Cash & equivalents
 * - Net debt calculation
 */

import { action, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";

const SEC_EDGAR_BASE = "https://data.sec.gov";

/**
 * Fetch balance sheet data from SEC EDGAR Company Facts API
 */
export const fetchBalanceSheetData = action({
  args: {
    ticker: v.string(),
    fiscalYear: v.optional(v.number()),
  },
  returns: v.object({
    ticker: v.string(),
    fiscalYear: v.number(),
    sharesOutstanding: v.optional(v.number()),
    totalDebt: v.optional(v.number()),
    cash: v.optional(v.number()),
    netDebt: v.optional(v.number()),
    totalAssets: v.optional(v.number()),
    totalEquity: v.optional(v.number()),
    source: v.string(),
    sourceUrl: v.string(),
  }),
  handler: async (ctx, args) => {
    try {
      // Get CIK from ticker
      const cikResponse = await fetch(
        `${SEC_EDGAR_BASE}/submissions/CIK${args.ticker}.json`,
        {
          headers: {
            "User-Agent": "NodeBench AI Research Platform contact@nodebench.ai",
          },
        }
      );

      if (!cikResponse.ok) {
        throw new Error(`Failed to fetch CIK for ${args.ticker}`);
      }

      const cikData = await cikResponse.json();
      const cik = cikData.cik.toString().padStart(10, "0");

      // Fetch company facts
      const factsUrl = `${SEC_EDGAR_BASE}/api/xbrl/companyfacts/CIK${cik}.json`;
      const factsResponse = await fetch(factsUrl, {
        headers: {
          "User-Agent": "NodeBench AI Research Platform contact@nodebench.ai",
        },
      });

      if (!factsResponse.ok) {
        throw new Error(`Failed to fetch company facts for ${args.ticker}`);
      }

      const facts = await factsResponse.json();
      const usGaap = facts.facts["us-gaap"] || {};

      // Determine fiscal year (most recent if not specified)
      const targetYear = args.fiscalYear || new Date().getFullYear() - 1;

      // Extract balance sheet items
      const result = {
        ticker: args.ticker.toUpperCase(),
        fiscalYear: targetYear,
        sharesOutstanding: extractMostRecent(usGaap["CommonStockSharesOutstanding"], targetYear),
        totalDebt: extractMostRecent(usGaap["LongTermDebt"], targetYear) || 0,
        cash: extractMostRecent(usGaap["CashAndCashEquivalentsAtCarryingValue"], targetYear) || 0,
        netDebt: 0,
        totalAssets: extractMostRecent(usGaap["Assets"], targetYear),
        totalEquity: extractMostRecent(usGaap["StockholdersEquity"], targetYear),
        source: "sec_edgar",
        sourceUrl: factsUrl,
      };

      // Calculate net debt
      if (result.totalDebt !== undefined && result.cash !== undefined) {
        result.netDebt = result.totalDebt - result.cash;
      }

      console.log(`[Balance Sheet] Fetched data for ${args.ticker} FY${targetYear}:`, {
        shares: result.sharesOutstanding,
        debt: result.totalDebt,
        cash: result.cash,
        netDebt: result.netDebt,
      });

      // Store in database
      await ctx.runMutation(internal.domains.financial.balanceSheetFetcher.storeBalanceSheetData, result);

      return result;
    } catch (error: any) {
      console.error(`[Balance Sheet] Error fetching for ${args.ticker}:`, error.message);

      // Fallback to cached data
      const cached = await ctx.runQuery(
        internal.domains.financial.balanceSheetFetcher.getCachedBalanceSheet,
        { ticker: args.ticker }
      );

      if (cached) {
        console.log(`[Balance Sheet] Using cached data for ${args.ticker}`);
        return cached as any;
      }

      // Fallback to manual seed data
      const manual = getManualSeedData(args.ticker);
      if (manual) {
        console.log(`[Balance Sheet] Using manual seed for ${args.ticker}`);
        return manual;
      }

      throw new Error(`Failed to fetch balance sheet for ${args.ticker}: ${error.message}`);
    }
  },
});

/**
 * Extract most recent value for a fiscal year
 */
function extractMostRecent(concept: any, fiscalYear: number): number | undefined {
  if (!concept || !concept.units) return undefined;

  // Try different unit types
  const unitTypes = ["shares", "USD", "pure"];

  for (const unitType of unitTypes) {
    const units = concept.units[unitType];
    if (!units) continue;

    // Find entries for the target fiscal year (annual filings only)
    const annualEntries = units.filter((entry: any) => {
      const entryYear = new Date(entry.end).getFullYear();
      return entryYear === fiscalYear && entry.form === "10-K";
    });

    if (annualEntries.length > 0) {
      // Return most recent entry
      const sorted = annualEntries.sort((a: any, b: any) =>
        new Date(b.filed).getTime() - new Date(a.filed).getTime()
      );
      return sorted[0].val;
    }
  }

  return undefined;
}

/**
 * Manual seed data for common companies (fallback)
 */
function getManualSeedData(ticker: string): any {
  const seedData: Record<string, any> = {
    NVDA: {
      ticker: "NVDA",
      fiscalYear: 2024,
      sharesOutstanding: 24500000000, // 24.5B shares
      totalDebt: 11000000000, // $11B debt
      cash: 34800000000, // $34.8B cash
      netDebt: -23800000000, // Net cash position
      totalAssets: 65728000000,
      totalEquity: 42985000000,
      source: "manual",
      sourceUrl: "manual_seed_data",
    },
    AAPL: {
      ticker: "AAPL",
      fiscalYear: 2023,
      sharesOutstanding: 15550000000, // 15.55B shares
      totalDebt: 111088000000, // $111B debt
      cash: 29965000000, // $30B cash
      netDebt: 81123000000, // Net debt
      totalAssets: 352755000000,
      totalEquity: 62146000000,
      source: "manual",
      sourceUrl: "manual_seed_data",
    },
  };

  return seedData[ticker.toUpperCase()];
}

/**
 * Store balance sheet data mutation
 */
export const storeBalanceSheetData = internalMutation({
  args: {
    ticker: v.string(),
    fiscalYear: v.number(),
    sharesOutstanding: v.optional(v.number()),
    totalDebt: v.optional(v.number()),
    cash: v.optional(v.number()),
    netDebt: v.optional(v.number()),
    totalAssets: v.optional(v.number()),
    totalEquity: v.optional(v.number()),
    source: v.string(),
    sourceUrl: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if already exists
    const existing = await ctx.db
      .query("balanceSheetData")
      .withIndex("by_ticker_year", (q) =>
        q.eq("ticker", args.ticker).eq("fiscalYear", args.fiscalYear)
      )
      .first();

    if (existing) {
      // Update existing record
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: Date.now(),
      });
      return { id: existing._id, created: false };
    } else {
      // Insert new record
      const id = await ctx.db.insert("balanceSheetData", {
        ...args,
        fetchedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { id, created: true };
    }
  },
});

/**
 * Get cached balance sheet data
 */
export const getCachedBalanceSheet = internalQuery({
  args: {
    ticker: v.string(),
    fiscalYear: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const query = ctx.db
      .query("balanceSheetData")
      .withIndex("by_ticker", (q) => q.eq("ticker", args.ticker));

    const records = await query.collect();

    if (records.length === 0) return null;

    // If fiscal year specified, find exact match
    if (args.fiscalYear) {
      const match = records.find((r) => r.fiscalYear === args.fiscalYear);
      return match || null;
    }

    // Otherwise return most recent
    const sorted = records.sort((a, b) => b.fiscalYear - a.fiscalYear);
    return sorted[0];
  },
});

/**
 * Test balance sheet fetcher
 */
export const testBalanceSheetFetcher = action({
  args: {
    ticker: v.string(),
  },
  handler: async (ctx, args) => {
    console.log(`\n[Test] Fetching balance sheet for ${args.ticker}...`);

    const result = await ctx.runAction(
      internal.domains.financial.balanceSheetFetcher.fetchBalanceSheetData,
      { ticker: args.ticker }
    );

    console.log("\n✅ Balance Sheet Data:");
    console.log(`Shares Outstanding: ${result.sharesOutstanding?.toLocaleString() || 'N/A'}`);
    console.log(`Total Debt: $${(result.totalDebt || 0) / 1000}M`);
    console.log(`Cash: $${(result.cash || 0) / 1000}M`);
    console.log(`Net Debt: $${(result.netDebt || 0) / 1000}M`);
    console.log(`Total Assets: $${(result.totalAssets || 0) / 1000}M`);
    console.log(`Source: ${result.source}`);

    return result;
  },
});
