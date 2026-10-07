/**
 * OpenBB News Tools
 * 
 * Tools for financial news discovery
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../../../../../../_generated/api";

export const getCompanyNews = createTool({
  description: "Get news articles for a specific company",
  args: z.object({
    symbol: z.string().describe("Stock ticker symbol (e.g., 'AAPL', 'TSLA')"),
    limit: z.number().optional().default(10).describe("Number of articles to return"),
  }),
  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(internal.actions.openbbActions.callOpenBBMCP, {
        endpoint: "/news/company",
        method: "GET",
        params: {
          symbol: args.symbol,
          limit: args.limit,
        },
      });
      
      if (result.success && result.data) {
        return `News for ${args.symbol}:\n${JSON.stringify(result.data, null, 2)}`;
      }
      
      return `Failed to get news for ${args.symbol}: ${result.error}`;
    } catch (error: any) {
      return `Error getting company news: ${error.message}`;
    }
  },
});

export const getMarketNews = createTool({
  description: "Get general market news and headlines",
  args: z.object({
    category: z.string().optional().describe("News category (e.g., 'technology', 'finance', 'crypto')"),
    limit: z.number().optional().default(10).describe("Number of articles to return"),
  }),
  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(internal.actions.openbbActions.callOpenBBMCP, {
        endpoint: "/news/market",
        method: "GET",
        params: {
          category: args.category,
          limit: args.limit,
        },
      });
      
      if (result.success && result.data) {
        const categoryText = args.category ? ` (${args.category})` : "";
        return `Market news${categoryText}:\n${JSON.stringify(result.data, null, 2)}`;
      }
      
      return `Failed to get market news: ${result.error}`;
    } catch (error: any) {
      return `Error getting market news: ${error.message}`;
    }
  },
});

