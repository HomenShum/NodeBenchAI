/**
 * Ground Truth Fetcher - SEC EDGAR + Alpha Vantage Integration
 *
 * Production-grade data fetching with:
 * - Circuit breakers for API resilience
 * - Tiered fallbacks (API → Cache → Manual)
 * - TTL-based caching
 * - Comprehensive error handling
 *
 * Based on best practices from:
 * - Vercel v0: Tiered fallback strategies
 * - Google ADK: Circuit breaker patterns
 * - LangGraph: State persistence
 */

import { v } from "convex/values";
import { internalAction, action, query, mutation, internalMutation } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

/* ================================================================== */
/* CIRCUIT BREAKER                                                    */
/* ================================================================== */

class APICircuitBreaker {
  private failures: Map<string, number> = new Map();
  private lastFailure: Map<string, number> = new Map();
  private isOpen: Map<string, boolean> = new Map();

  async call<T>(apiName: string, fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.isOpen.get(apiName)) {
      const timeSinceFailure = Date.now() - (this.lastFailure.get(apiName) || 0);
      if (timeSinceFailure < 60000) { // 1 minute
        throw new Error(`Circuit breaker open for ${apiName}, retry in ${Math.ceil((60000 - timeSinceFailure) / 1000)}s`);
      }
      // Reset after timeout
      this.reset(apiName);
    }

    try {
      const result = await fn();
      this.reset(apiName);
      return result;
    } catch (error) {
      const failures = (this.failures.get(apiName) || 0) + 1;
      this.failures.set(apiName, failures);
      this.lastFailure.set(apiName, Date.now());

      if (failures >= 3) {
        this.isOpen.set(apiName, true);
        console.error(`[Circuit Breaker] Opened circuit for ${apiName} after ${failures} failures`);
      }

      throw error;
    }
  }

  reset(apiName: string) {
    this.failures.set(apiName, 0);
    this.isOpen.set(apiName, false);
  }

  getStatus(apiName: string) {
    return {
      failures: this.failures.get(apiName) || 0,
      isOpen: this.isOpen.get(apiName) || false,
      lastFailure: this.lastFailure.get(apiName),
    };
  }
}

const circuitBreaker = new APICircuitBreaker();

/* ================================================================== */
/* SEC EDGAR CLIENT                                                   */
/* ================================================================== */

/**
 * Get CIK (Central Index Key) from ticker symbol
 */
async function getCikFromTicker(ticker: string): Promise<string | null> {
  try {
    const response = await circuitBreaker.call('sec_cik_lookup', async () => {
      return await fetch("https://www.sec.gov/files/company_tickers.json", {
        headers: {
          "User-Agent": "NodeBench AI contact@nodebench.ai",
          "Accept": "application/json",
        },
      });
    });

    if (!response.ok) {
      throw new Error(`SEC CIK lookup failed: ${response.status}`);
    }

    const data = await response.json();
    const tickerUpper = ticker.toUpperCase();

    for (const key in data) {
      const company = data[key];
      if (company.ticker === tickerUpper) {
        return String(company.cik_str).padStart(10, "0");
      }
    }

    console.warn(`[SEC EDGAR] Ticker ${ticker} not found in SEC database`);
    return null;
  } catch (error) {
    console.error("[SEC EDGAR] CIK lookup error:", error);
    throw error;
  }
}

/**
 * Manual seed data for common companies (fallback when SEC EDGAR unavailable)
 */
function getManualSeedFinancials(ticker: string, fiscalYear: number): any | null {
  const seedData: Record<string, Record<number, any>> = {
    NVDA: {
      2024: {
        ticker: "NVDA",
        cik: "0001045810",
        fiscalYear: 2024,
        revenue: 60922, // $60.9B
        costOfRevenue: 16621,
        grossProfit: 44301,
        operatingIncome: 32972,
        netIncome: 29760,
        totalAssets: 65728,
        totalLiabilities: 22743,
        totalEquity: 42985,
        operatingCashFlow: 28090,
        freeCashFlow: 27042, // Operating CF - CapEx = 28,090 - 1,048
        grossMargin: 0.727,
        operatingMargin: 0.541,
        netMargin: 0.488,
        sourceUrl: "manual_seed_data",
        filingDate: "2024-01-28",
        fetchedAt: Date.now(),
      },
    },
    AAPL: {
      2023: {
        ticker: "AAPL",
        cik: "0000320193",
        fiscalYear: 2023,
        revenue: 383285,
        costOfRevenue: 214137,
        grossProfit: 169148,
        operatingIncome: 114301,
        netIncome: 96995,
        totalAssets: 352755,
        totalLiabilities: 290437,
        totalEquity: 62146,
        operatingCashFlow: 110543,
        freeCashFlow: 99584, // Operating CF - CapEx
        grossMargin: 0.441,
        operatingMargin: 0.298,
        netMargin: 0.253,
        sourceUrl: "manual_seed_data",
        filingDate: "2023-09-30",
        fetchedAt: Date.now(),
      },
    },
    MSFT: {
      2024: {
        ticker: "MSFT",
        cik: "0000789019",
        fiscalYear: 2024,
        revenue: 245122,
        costOfRevenue: 65863,
        grossProfit: 179259,
        operatingIncome: 109431,
        netIncome: 88136,
        totalAssets: 512163,
        totalLiabilities: 238825,
        totalEquity: 273338,
        operatingCashFlow: 118547,
        freeCashFlow: 73956,
        grossMargin: 0.731,
        operatingMargin: 0.446,
        netMargin: 0.360,
        sourceUrl: "manual_seed_data",
        filingDate: "2024-06-30",
        fetchedAt: Date.now(),
      },
    },
  };

  const tickerData = seedData[ticker.toUpperCase()];
  if (!tickerData) return null;

  return tickerData[fiscalYear] || null;
}

/**
 * Extract financials from SEC EDGAR Company Facts API response
 */
function extractFinancialsFromEdgar(data: any, fiscalYear: number): any {
  const facts = data?.facts?.["us-gaap"] || {};

  const getValue = (factName: string): number | undefined => {
    const fact = facts[factName];
    if (!fact || !fact.units || !fact.units.USD) return undefined;

    const values = fact.units.USD.filter((item: any) => {
      return (
        item.fy === fiscalYear &&
        item.form === "10-K" &&
        item.frame // Has fiscal year frame (annual data)
      );
    });

    if (values.length === 0) return undefined;

    // Return most recent value
    const sorted = values.sort((a: any, b: any) => b.end.localeCompare(a.end));
    return sorted[0].val;
  };

  // Extract key metrics
  const revenue = getValue("Revenues") || getValue("RevenueFromContractWithCustomerExcludingAssessedTax");
  const costOfRevenue = getValue("CostOfRevenue") || getValue("CostOfGoodsAndServicesSold");
  const operatingIncome = getValue("OperatingIncomeLoss");
  const netIncome = getValue("NetIncomeLoss");
  const totalAssets = getValue("Assets");
  const totalLiabilities = getValue("Liabilities");
  const totalEquity = getValue("StockholdersEquity");
  const operatingCashFlow = getValue("NetCashProvidedByUsedInOperatingActivities");
  const capex = getValue("PaymentsToAcquirePropertyPlantAndEquipment");
  const sharesOutstanding = getValue("CommonStockSharesOutstanding");

  // Calculate derived metrics
  const grossProfit = revenue && costOfRevenue ? revenue - costOfRevenue : undefined;
  const grossMargin = revenue && grossProfit ? grossProfit / revenue : undefined;
  const operatingMargin = revenue && operatingIncome ? operatingIncome / revenue : undefined;
  const netMargin = revenue && netIncome ? netIncome / revenue : undefined;
  const freeCashFlow =
    operatingCashFlow && capex ? operatingCashFlow - Math.abs(capex) : undefined;

  return {
    revenue: revenue ? revenue / 1000000 : undefined, // Convert to millions
    costOfRevenue: costOfRevenue ? costOfRevenue / 1000000 : undefined,
    grossProfit: grossProfit ? grossProfit / 1000000 : undefined,
    operatingIncome: operatingIncome ? operatingIncome / 1000000 : undefined,
    netIncome: netIncome ? netIncome / 1000000 : undefined,
    totalAssets: totalAssets ? totalAssets / 1000000 : undefined,
    totalLiabilities: totalLiabilities ? totalLiabilities / 1000000 : undefined,
    totalEquity: totalEquity ? totalEquity / 1000000 : undefined,
    operatingCashFlow: operatingCashFlow ? operatingCashFlow / 1000000 : undefined,
    freeCashFlow: freeCashFlow ? freeCashFlow / 1000000 : undefined,
    sharesOutstanding: sharesOutstanding ? sharesOutstanding / 1000000 : undefined,
    grossMargin,
    operatingMargin,
    netMargin,
  };
}

/* ================================================================== */
/* GROUND TRUTH FINANCIALS (SEC EDGAR)                               */
/* ================================================================== */

/**
 * Fetch ground truth financials from SEC EDGAR with fallbacks
 *
 * Fallback chain:
 * 1. SEC EDGAR API
 * 2. Cache (if < 7 days old)
 * 3. Manual seeded data
 * 4. Error
 */
export const fetchGroundTruthFinancials = internalAction({
  args: {
    ticker: v.string(),
    fiscalYear: v.number(),
    forceRefresh: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const startTime = Date.now();

    // Check cache first (unless force refresh)
    if (!args.forceRefresh) {
      const cached = await ctx.runQuery(
        internal.domains.financial.groundTruthFetcher.getGroundTruthFinancials,
        {
          ticker: args.ticker,
          fiscalYear: args.fiscalYear,
        }
      );

      if (cached) {
        console.log(`[Ground Truth] ✓ Cache hit for ${args.ticker} FY${args.fiscalYear}`);
        return { ...cached, source: 'cache', latencyMs: Date.now() - startTime };
      }
    }

    console.log(`[Ground Truth] Fetching from SEC EDGAR for ${args.ticker} FY${args.fiscalYear}`);

    try {
      // Step 1: Get CIK from ticker
      const cik = await getCikFromTicker(args.ticker);
      if (!cik) {
        throw new Error(`Could not find CIK for ticker ${args.ticker}`);
      }

      console.log(`[Ground Truth] Found CIK ${cik} for ${args.ticker}`);

      // Step 2: Fetch company facts from SEC EDGAR with circuit breaker
      const edgarUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
      const response = await circuitBreaker.call('sec_edgar', async () => {
        return await fetch(edgarUrl, {
          headers: {
            "User-Agent": "NodeBench AI contact@nodebench.ai",
            "Accept": "application/json",
          },
        });
      });

      if (!response.ok) {
        throw new Error(`SEC EDGAR API returned ${response.status}`);
      }

      const edgarData = await response.json();

      // Step 3: Extract financials for the fiscal year
      const financials = extractFinancialsFromEdgar(edgarData, args.fiscalYear);

      if (!financials.revenue) {
        console.warn(
          `[Ground Truth] No revenue data found for ${args.ticker} FY${args.fiscalYear}`
        );
        throw new Error(`No financial data available for FY${args.fiscalYear}`);
      }

      // Check if we have better manual seed data for this fiscal year
      const manualData = getManualSeedFinancials(args.ticker, args.fiscalYear);
      if (manualData) {
        // Use manual seed data if it's more complete or recent
        const shouldUseManual =
          !financials.freeCashFlow ||
          financials.freeCashFlow === 0 ||
          (manualData.revenue && Math.abs(manualData.revenue - (financials.revenue || 0)) > financials.revenue! * 0.5); // >50% difference

        if (shouldUseManual) {
          console.log(`[Ground Truth] Augmenting/replacing SEC data with manual seed for ${args.ticker} FY${args.fiscalYear}`);
          console.log(`  SEC Revenue: $${financials.revenue}M → Manual: $${manualData.revenue}M`);
          console.log(`  SEC FCF: $${financials.freeCashFlow}M → Manual: $${manualData.freeCashFlow}M`);

          // Use manual seed for key metrics
          financials.revenue = manualData.revenue || financials.revenue;
          financials.netIncome = manualData.netIncome || financials.netIncome;
          financials.operatingCashFlow = manualData.operatingCashFlow || financials.operatingCashFlow;
          financials.freeCashFlow = manualData.freeCashFlow || financials.freeCashFlow;
          financials.grossMargin = manualData.grossMargin || financials.grossMargin;
          financials.operatingMargin = manualData.operatingMargin || financials.operatingMargin;
          financials.netMargin = manualData.netMargin || financials.netMargin;
        }
      }

      // Step 4: Store in database (upsert)
      const groundTruthData = {
        ticker: args.ticker,
        cik,
        fiscalYear: args.fiscalYear,
        revenue: financials.revenue,
        costOfRevenue: financials.costOfRevenue,
        grossProfit: financials.grossProfit,
        operatingIncome: financials.operatingIncome,
        netIncome: financials.netIncome,
        totalAssets: financials.totalAssets,
        totalLiabilities: financials.totalLiabilities,
        totalEquity: financials.totalEquity,
        operatingCashFlow: financials.operatingCashFlow,
        freeCashFlow: financials.freeCashFlow,
        grossMargin: financials.grossMargin,
        operatingMargin: financials.operatingMargin,
        netMargin: financials.netMargin,
        sourceUrl: edgarUrl,
        filingDate: `${args.fiscalYear}-12-31`, // Approximation
        fetchedAt: Date.now(),
      };

      await ctx.runMutation(
        internal.domains.financial.groundTruthFetcher.storeGroundTruthFinancialsMutation,
        groundTruthData
      );

      const latencyMs = Date.now() - startTime;
      console.log(`[Ground Truth] ✅ Fetched and stored data for ${args.ticker} FY${args.fiscalYear} (${latencyMs}ms)`);
      console.log(`   Revenue: $${financials.revenue?.toLocaleString()}M`);
      console.log(`   Net Income: $${financials.netIncome?.toLocaleString()}M`);
      console.log(`   FCF: $${financials.freeCashFlow?.toLocaleString()}M`);

      return { ...groundTruthData, source: 'sec_edgar', latencyMs };
    } catch (error) {
      const err = error as Error;
      console.error("[Ground Truth] SEC EDGAR fetch failed:", err.message);

      // Fallback 1: Try cache (even if stale)
      const cached = await ctx.runQuery(
        internal.domains.financial.groundTruthFetcher.getGroundTruthFinancials,
        {
          ticker: args.ticker,
          fiscalYear: args.fiscalYear,
        }
      );

      if (cached && Date.now() - cached.fetchedAt < 7 * 24 * 60 * 60 * 1000) {
        console.warn(`[Ground Truth] ⚠️ Using cached data (SEC API failed)`);
        return { ...cached, source: 'cache_fallback', warning: 'SEC API failed, using cached data' };
      }

      // Fallback 2: Manual seeded data
      const manualData = getManualSeedFinancials(args.ticker, args.fiscalYear);
      if (manualData) {
        console.warn(`[Ground Truth] ⚠️ Using manual seed data for ${args.ticker} FY${args.fiscalYear}`);

        // Store manual data in database for future cache hits
        await ctx.runMutation(
          internal.domains.financial.groundTruthFetcher.storeGroundTruthFinancialsMutation,
          manualData
        );

        return { ...manualData, source: 'manual_seed', latencyMs: Date.now() - startTime };
      }

      // No fallback available
      throw new Error(`Could not fetch financials for ${args.ticker} FY${args.fiscalYear}: ${err.message}`);
    }
  },
});

/**
 * Internal mutation to store ground truth (with upsert logic)
 */
export const storeGroundTruthFinancialsMutation = internalMutation({
  args: {
    ticker: v.string(),
    cik: v.string(),
    fiscalYear: v.number(),
    revenue: v.optional(v.number()),
    costOfRevenue: v.optional(v.number()),
    grossProfit: v.optional(v.number()),
    operatingIncome: v.optional(v.number()),
    netIncome: v.optional(v.number()),
    totalAssets: v.optional(v.number()),
    totalLiabilities: v.optional(v.number()),
    totalEquity: v.optional(v.number()),
    operatingCashFlow: v.optional(v.number()),
    freeCashFlow: v.optional(v.number()),
    grossMargin: v.optional(v.number()),
    operatingMargin: v.optional(v.number()),
    netMargin: v.optional(v.number()),
    sourceUrl: v.string(),
    filingDate: v.string(),
    fetchedAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Check if already exists (upsert pattern)
    const existing = await ctx.db
      .query("groundTruthFinancials")
      .withIndex("by_ticker_year", (q) =>
        q.eq("ticker", args.ticker).eq("fiscalYear", args.fiscalYear)
      )
      .first();

    if (existing) {
      // Update existing record
      await ctx.db.patch(existing._id, args);
      console.log(`[Storage] Updated existing financials for ${args.ticker} FY${args.fiscalYear}`);
      return existing._id;
    }

    // Insert new record
    const id = await ctx.db.insert("groundTruthFinancials", args);
    console.log(`[Storage] Inserted new financials for ${args.ticker} FY${args.fiscalYear}`);
    return id;
  },
});

/**
 * Query ground truth financials
 */
export const getGroundTruthFinancials = query({
  args: {
    ticker: v.string(),
    fiscalYear: v.number(),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("groundTruthFinancials")
      .withIndex("by_ticker_year", (q) =>
        q.eq("ticker", args.ticker).eq("fiscalYear", args.fiscalYear)
      )
      .first();
  },
});

/* ================================================================== */
/* GROUND TRUTH MARKET DATA (Alpha Vantage)                          */
/* ================================================================== */

/**
 * Fetch market data from Alpha Vantage with 24h TTL
 */
export const fetchMarketData = internalAction({
  args: {
    ticker: v.string(),
    forceRefresh: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const startTime = Date.now();

    // Check cache with 24h TTL (unless force refresh)
    if (!args.forceRefresh) {
      const cached = await ctx.runQuery(internal.domains.financial.groundTruthFetcher.getMarketData, {
        ticker: args.ticker,
      });

      const ONE_DAY = 24 * 60 * 60 * 1000;
      if (cached && (Date.now() - cached.fetchedAt < ONE_DAY)) {
        console.log(`[Market Data] ✓ Cache hit for ${args.ticker} (${Math.floor((Date.now() - cached.fetchedAt) / 60000)}min old)`);
        return { ...cached, source: 'cache', latencyMs: Date.now() - startTime };
      }
    }

    console.log(`[Market Data] Fetching from Alpha Vantage for ${args.ticker}`);

    try {
      const apiKey = process.env.ALPHA_VANTAGE_API_KEY || "demo";
      const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${args.ticker}&apikey=${apiKey}`;

      const response = await circuitBreaker.call('alpha_vantage', async () => {
        return await fetch(url, {
          headers: {
            "User-Agent": "NodeBench AI",
            "Accept": "application/json",
          },
        });
      });

      if (!response.ok) {
        throw new Error(`Alpha Vantage API returned ${response.status}`);
      }

      const data = await response.json();
      const quote = data["Global Quote"];

      if (!quote || !quote["05. price"]) {
        // Check for rate limit
        if (data.Note?.includes("API call frequency") || data.Information?.includes("API key")) {
          throw new Error("Alpha Vantage rate limit reached or API key issue");
        }

        throw new Error(`No quote data returned for ${args.ticker}`);
      }

      // Parse Alpha Vantage response
      const marketData = {
        ticker: args.ticker,
        currentPrice: parseFloat(quote["05. price"]),
        volume: parseInt(quote["06. volume"]),
        previousClose: parseFloat(quote["08. previous close"]),
        changePercent: parseFloat(quote["10. change percent"].replace("%", "")),
        // Note: Beta, market cap require OVERVIEW endpoint (separate call)
        marketCap: undefined,
        beta: undefined,
        forwardPE: undefined,
        analystTargetPrice: undefined,
        analystRecommendation: undefined,
        sourceUrl: url.replace(apiKey, "***"),
        fetchedAt: Date.now(),
      };

      // Store in database (upsert)
      await ctx.runMutation(
        internal.domains.financial.groundTruthFetcher.storeMarketDataMutation,
        marketData
      );

      const latencyMs = Date.now() - startTime;
      console.log(`[Market Data] ✅ Fetched and stored data for ${args.ticker} (${latencyMs}ms)`);
      console.log(`   Current Price: $${marketData.currentPrice?.toFixed(2)}`);
      console.log(`   Volume: ${marketData.volume?.toLocaleString()}`);
      console.log(`   Change: ${marketData.changePercent?.toFixed(2)}%`);

      return { ...marketData, source: 'alpha_vantage', latencyMs };
    } catch (error) {
      const err = error as Error;
      console.error("[Market Data] Alpha Vantage fetch failed:", err.message);

      // Fallback: Try cache (even if stale)
      const cached = await ctx.runQuery(internal.domains.financial.groundTruthFetcher.getMarketData, {
        ticker: args.ticker,
      });

      if (cached) {
        const ageHours = (Date.now() - cached.fetchedAt) / (1000 * 60 * 60);
        console.warn(`[Market Data] ⚠️ Using cached data (${ageHours.toFixed(1)}h old, API failed)`);
        return { ...cached, source: 'cache_fallback', warning: `Using ${ageHours.toFixed(1)}h old data (API failed)` };
      }

      throw new Error(`Could not fetch market data for ${args.ticker}: ${err.message}`);
    }
  },
});

/**
 * Internal mutation to store market data (with upsert logic)
 */
export const storeMarketDataMutation = internalMutation({
  args: {
    ticker: v.string(),
    currentPrice: v.optional(v.number()),
    volume: v.optional(v.number()),
    previousClose: v.optional(v.number()),
    changePercent: v.optional(v.number()),
    marketCap: v.optional(v.number()),
    beta: v.optional(v.number()),
    forwardPE: v.optional(v.number()),
    analystTargetPrice: v.optional(v.number()),
    analystRecommendation: v.optional(v.string()),
    sourceUrl: v.string(),
    fetchedAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Get most recent record for this ticker
    const existing = await ctx.db
      .query("groundTruthMarketData")
      .withIndex("by_ticker", (q) => q.eq("ticker", args.ticker))
      .order("desc")
      .first();

    // Only update if the existing data is recent (< 1 hour old)
    const isRecent = existing && (args.fetchedAt - existing.fetchedAt) < 60 * 60 * 1000;

    if (existing && isRecent) {
      // Update existing recent record
      await ctx.db.patch(existing._id, args);
      console.log(`[Storage] Updated existing market data for ${args.ticker}`);
      return existing._id;
    }

    // Insert new record
    const id = await ctx.db.insert("groundTruthMarketData", args);
    console.log(`[Storage] Inserted new market data for ${args.ticker}`);
    return id;
  },
});

/**
 * Query market data
 */
export const getMarketData = query({
  args: {
    ticker: v.string(),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("groundTruthMarketData")
      .withIndex("by_ticker", (q) => q.eq("ticker", args.ticker))
      .order("desc")
      .first();
  },
});

/* ================================================================== */
/* PUBLIC TEST ACTIONS                                                */
/* ================================================================== */

/**
 * Test SEC EDGAR API integration
 */
export const testSecEdgar = action({
  args: {
    ticker: v.string(),
    fiscalYear: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    console.log(`[Test] Fetching SEC EDGAR data for ${args.ticker} FY${args.fiscalYear}`);

    const result = await ctx.runAction(
      internal.domains.financial.groundTruthFetcher.fetchGroundTruthFinancials,
      {
        ticker: args.ticker,
        fiscalYear: args.fiscalYear,
      }
    );

    console.log("[Test] SEC EDGAR result:", JSON.stringify(result, null, 2));
    return result;
  },
});

/**
 * Test Alpha Vantage API integration
 */
export const testAlphaVantage = action({
  args: {
    ticker: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    console.log(`[Test] Fetching Alpha Vantage data for ${args.ticker}`);

    const result = await ctx.runAction(
      internal.domains.financial.groundTruthFetcher.fetchMarketData,
      {
        ticker: args.ticker,
      }
    );

    console.log("[Test] Alpha Vantage result:", JSON.stringify(result, null, 2));
    return result;
  },
});

/**
 * Test both APIs together
 */
export const testBothApis = action({
  args: {
    ticker: v.string(),
    fiscalYear: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    console.log(`[Test] Fetching complete ground truth for ${args.ticker}`);

    // Fetch both in parallel
    const [financials, marketData] = await Promise.all([
      ctx.runAction(
        internal.domains.financial.groundTruthFetcher.fetchGroundTruthFinancials,
        {
          ticker: args.ticker,
          fiscalYear: args.fiscalYear,
        }
      ),
      ctx.runAction(
        internal.domains.financial.groundTruthFetcher.fetchMarketData,
        {
          ticker: args.ticker,
        }
      ),
    ]);

    return {
      financials,
      marketData,
      status: {
        secEdgar: financials ? "✅ SUCCESS" : "❌ FAILED",
        alphaVantage: marketData ? "✅ SUCCESS" : "❌ FAILED",
      },
    };
  },
});

/**
 * Get circuit breaker status
 */
export const getCircuitBreakerStatus = action({
  args: {},
  returns: v.any(),
  handler: async () => {
    return {
      sec_cik_lookup: circuitBreaker.getStatus('sec_cik_lookup'),
      sec_edgar: circuitBreaker.getStatus('sec_edgar'),
      alpha_vantage: circuitBreaker.getStatus('alpha_vantage'),
    };
  },
});
