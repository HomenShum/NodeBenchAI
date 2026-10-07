/**
 * OpenBB Equity Tools
 * 
 * Tools for stock market data and company fundamentals
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../../../../../../_generated/api";

export const getStockPrice = createTool({
  description: "Get current or historical stock price data for a company",
  args: z.object({
    symbol: z.string().describe("Stock ticker symbol (e.g., 'AAPL', 'TSLA')"),
    startDate: z.string().optional().describe("Start date for historical data (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("End date for historical data (YYYY-MM-DD)"),
  }),
  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(internal.actions.openbbActions.callOpenBBMCP, {
        endpoint: "/equity/price/historical",
        method: "GET",
        params: {
          symbol: args.symbol,
          start_date: args.startDate,
          end_date: args.endDate,
        },
      });
      
      if (result.success && result.data) {
        return `Stock price data for ${args.symbol}:\n${JSON.stringify(result.data, null, 2)}`;
      }
      
      return `Failed to get stock price for ${args.symbol}: ${result.error}`;
    } catch (error: any) {
      return `Error getting stock price: ${error.message}`;
    }
  },
});

export const getStockFundamentals = createTool({
  description: "Get fundamental data for a company (P/E ratio, market cap, revenue, etc.)",
  args: z.object({
    symbol: z.string().describe("Stock ticker symbol (e.g., 'AAPL', 'TSLA')"),
  }),
  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(internal.actions.openbbActions.callOpenBBMCP, {
        endpoint: "/equity/fundamental/ratios",
        method: "GET",
        params: {
          symbol: args.symbol,
        },
      });
      
      if (result.success && result.data) {
        return `Fundamental data for ${args.symbol}:\n${JSON.stringify(result.data, null, 2)}`;
      }
      
      return `Failed to get fundamentals for ${args.symbol}: ${result.error}`;
    } catch (error: any) {
      return `Error getting fundamentals: ${error.message}`;
    }
  },
});

export const compareStocks = createTool({
  description: "Compare multiple stocks side-by-side",
  args: z.object({
    symbols: z.array(z.string()).describe("List of stock ticker symbols to compare (e.g., ['AAPL', 'MSFT', 'GOOGL'])"),
    metrics: z.array(z.string()).optional().describe("Specific metrics to compare (e.g., ['price', 'marketCap', 'pe'])"),
  }),
  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(internal.actions.openbbActions.callOpenBBMCP, {
        endpoint: "/equity/compare/peers",
        method: "GET",
        params: {
          symbols: args.symbols.join(","),
          metrics: args.metrics?.join(","),
        },
      });
      
      if (result.success && result.data) {
        return `Comparison of ${args.symbols.join(", ")}:\n${JSON.stringify(result.data, null, 2)}`;
      }
      
      return `Failed to compare stocks: ${result.error}`;
    } catch (error: any) {
      return `Error comparing stocks: ${error.message}`;
    }
  },
});

