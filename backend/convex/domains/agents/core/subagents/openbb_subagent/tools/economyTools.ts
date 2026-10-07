/**
 * OpenBB Economy Tools
 * 
 * Tools for economic indicators and data
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../../../../../../_generated/api";

export const getGDP = createTool({
  description: "Get GDP (Gross Domestic Product) data",
  args: z.object({
    country: z.string().optional().default("US").describe("Country code (e.g., 'US', 'CN', 'UK')"),
    startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("End date (YYYY-MM-DD)"),
  }),
  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(internal.actions.openbbActions.callOpenBBMCP, {
        endpoint: "/economy/gdp",
        method: "GET",
        params: {
          country: args.country,
          start_date: args.startDate,
          end_date: args.endDate,
        },
      });
      
      if (result.success && result.data) {
        return `GDP data for ${args.country}:\n${JSON.stringify(result.data, null, 2)}`;
      }
      
      return `Failed to get GDP data: ${result.error}`;
    } catch (error: any) {
      return `Error getting GDP data: ${error.message}`;
    }
  },
});

export const getEmploymentData = createTool({
  description: "Get employment and unemployment data",
  args: z.object({
    country: z.string().optional().default("US").describe("Country code (e.g., 'US', 'CN', 'UK')"),
    startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("End date (YYYY-MM-DD)"),
  }),
  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(internal.actions.openbbActions.callOpenBBMCP, {
        endpoint: "/economy/employment",
        method: "GET",
        params: {
          country: args.country,
          start_date: args.startDate,
          end_date: args.endDate,
        },
      });
      
      if (result.success && result.data) {
        return `Employment data for ${args.country}:\n${JSON.stringify(result.data, null, 2)}`;
      }
      
      return `Failed to get employment data: ${result.error}`;
    } catch (error: any) {
      return `Error getting employment data: ${error.message}`;
    }
  },
});

export const getInflationData = createTool({
  description: "Get inflation data (CPI, PPI)",
  args: z.object({
    country: z.string().optional().default("US").describe("Country code (e.g., 'US', 'CN', 'UK')"),
    type: z.enum(["CPI", "PPI"]).optional().default("CPI").describe("Inflation type (CPI or PPI)"),
    startDate: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("End date (YYYY-MM-DD)"),
  }),
  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(internal.actions.openbbActions.callOpenBBMCP, {
        endpoint: "/economy/inflation",
        method: "GET",
        params: {
          country: args.country,
          type: args.type,
          start_date: args.startDate,
          end_date: args.endDate,
        },
      });
      
      if (result.success && result.data) {
        return `${args.type} data for ${args.country}:\n${JSON.stringify(result.data, null, 2)}`;
      }
      
      return `Failed to get inflation data: ${result.error}`;
    } catch (error: any) {
      return `Error getting inflation data: ${error.message}`;
    }
  },
});

