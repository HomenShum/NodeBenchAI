/**
 * OpenBB Crypto Tools
 * 
 * Tools for cryptocurrency market data
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../../../../../../_generated/api";

export const getCryptoPrice = createTool({
  description: "Get current or historical cryptocurrency price data",
  args: z.object({
    symbol: z.string().describe("Crypto symbol (e.g., 'BTC', 'ETH', 'SOL')"),
    startDate: z.string().optional().describe("Start date for historical data (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("End date for historical data (YYYY-MM-DD)"),
  }),
  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(internal.actions.openbbActions.callOpenBBMCP, {
        endpoint: "/crypto/price/historical",
        method: "GET",
        params: {
          symbol: args.symbol,
          start_date: args.startDate,
          end_date: args.endDate,
        },
      });
      
      if (result.success && result.data) {
        return `Crypto price data for ${args.symbol}:\n${JSON.stringify(result.data, null, 2)}`;
      }
      
      return `Failed to get crypto price for ${args.symbol}: ${result.error}`;
    } catch (error: any) {
      return `Error getting crypto price: ${error.message}`;
    }
  },
});

export const getCryptoMarketData = createTool({
  description: "Get cryptocurrency market data (market cap, volume, etc.)",
  args: z.object({
    symbol: z.string().describe("Crypto symbol (e.g., 'BTC', 'ETH', 'SOL')"),
  }),
  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(internal.actions.openbbActions.callOpenBBMCP, {
        endpoint: "/crypto/market_data",
        method: "GET",
        params: {
          symbol: args.symbol,
        },
      });
      
      if (result.success && result.data) {
        return `Market data for ${args.symbol}:\n${JSON.stringify(result.data, null, 2)}`;
      }
      
      return `Failed to get market data for ${args.symbol}: ${result.error}`;
    } catch (error: any) {
      return `Error getting market data: ${error.message}`;
    }
  },
});

