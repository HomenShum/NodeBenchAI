/**
 * OpenBB Admin Tools
 * 
 * Tools for discovering and activating OpenBB data categories and tools
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../../../../../../_generated/api";

export const availableCategories = createTool({
  description: "Get list of available OpenBB data categories (equity, crypto, economy, news, etc.)",
  args: z.object({}),
  handler: async (ctx): Promise<string> => {
    try {
      const result = await ctx.runAction(internal.actions.openbbActions.getOpenBBCategories, {});
      
      if (Array.isArray(result)) {
        return `Available OpenBB categories:\n${result.map((cat: string) => `- ${cat}`).join("\n")}`;
      }
      
      return JSON.stringify(result, null, 2);
    } catch (error: any) {
      return `Error getting OpenBB categories: ${error.message}`;
    }
  },
});

export const availableTools = createTool({
  description: "Get list of available OpenBB tools, optionally filtered by category",
  args: z.object({
    category: z.string().optional().describe("Filter tools by category (e.g., 'equity', 'crypto')"),
  }),
  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(internal.actions.openbbActions.getOpenBBTools, {
        category: args.category,
      });
      
      if (Array.isArray(result)) {
        const categoryText = args.category ? ` in category '${args.category}'` : "";
        return `Available OpenBB tools${categoryText}:\n${result.map((tool: string) => `- ${tool}`).join("\n")}`;
      }
      
      return JSON.stringify(result, null, 2);
    } catch (error: any) {
      return `Error getting OpenBB tools: ${error.message}`;
    }
  },
});

export const activateTools = createTool({
  description: "Activate specific OpenBB tools or categories for use",
  args: z.object({
    tools: z.array(z.string()).optional().describe("List of tool names to activate"),
    categories: z.array(z.string()).optional().describe("List of categories to activate"),
  }),
  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(internal.actions.openbbActions.callOpenBBMCP, {
        endpoint: "/admin/activate_tools",
        method: "POST",
        body: {
          tools: args.tools,
          categories: args.categories,
        },
       });
       
       if (result.success) {
        const activated: string[] = [];
        if (args.tools) activated.push(`${args.tools.length} tools`);
        if (args.categories) activated.push(`${args.categories.length} categories`);
        return `Successfully activated ${activated.join(" and ")}`;
       }
      
      return `Failed to activate tools: ${result.error}`;
    } catch (error: any) {
      return `Error activating tools: ${error.message}`;
    }
  },
});
