"use node";
/**
 * Debug Adapters - Test individual search providers with full logging
 */

import { action } from "../../../_generated/server";
import { v } from "convex/values";

export const testSerper = action({
  args: {
    query: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const apiKey = process.env.SERPER_API_KEY;
    console.log(`[debugAdapters] SERPER_API_KEY available: ${!!apiKey}, length: ${apiKey?.length || 0}`);

    if (!apiKey) {
      return { error: "SERPER_API_KEY not configured" };
    }

    try {
      const response = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({
          q: args.query,
          num: 5,
        }),
      });

      const status = response.status;
      const statusText = response.statusText;
      const responseText = await response.text();

      console.log(`[debugAdapters] Serper response: ${status} ${statusText}`);
      console.log(`[debugAdapters] Response body (first 500 chars): ${responseText.substring(0, 500)}`);

      if (!response.ok) {
        return {
          error: `API error: ${status} ${statusText}`,
          body: responseText,
        };
      }

      const data = JSON.parse(responseText);
      return {
        success: true,
        organicCount: data.organic?.length || 0,
        newsCount: data.news?.length || 0,
        credits: data.credits,
        firstResult: data.organic?.[0]?.title,
      };
    } catch (error) {
      console.error(`[debugAdapters] Serper error:`, error);
      return { error: String(error) };
    }
  },
});

export const testBrave = action({
  args: {
    query: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const apiKey = process.env.BRAVE_API_KEY;
    console.log(`[debugAdapters] BRAVE_API_KEY available: ${!!apiKey}, length: ${apiKey?.length || 0}`);

    if (!apiKey) {
      return { error: "BRAVE_API_KEY not configured" };
    }

    try {
      const params = new URLSearchParams({
        q: args.query,
        count: "5",
      });

      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": apiKey,
          },
        }
      );

      const status = response.status;
      const statusText = response.statusText;
      const responseText = await response.text();

      console.log(`[debugAdapters] Brave response: ${status} ${statusText}`);
      console.log(`[debugAdapters] Response body (first 500 chars): ${responseText.substring(0, 500)}`);

      if (!response.ok) {
        return {
          error: `API error: ${status} ${statusText}`,
          body: responseText,
        };
      }

      const data = JSON.parse(responseText);
      return {
        success: true,
        webCount: data.web?.results?.length || 0,
        newsCount: data.news?.results?.length || 0,
        firstResult: data.web?.results?.[0]?.title,
      };
    } catch (error) {
      console.error(`[debugAdapters] Brave error:`, error);
      return { error: String(error) };
    }
  },
});

export const testTavily = action({
  args: {
    query: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const apiKey = process.env.TAVILY_API_KEY;
    console.log(`[debugAdapters] TAVILY_API_KEY available: ${!!apiKey}, length: ${apiKey?.length || 0}`);

    if (!apiKey) {
      return { error: "TAVILY_API_KEY not configured" };
    }

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: args.query,
          api_key: apiKey,
          max_results: 5,
          search_depth: "basic",
        }),
      });

      const status = response.status;
      const statusText = response.statusText;
      const responseText = await response.text();

      console.log(`[debugAdapters] Tavily response: ${status} ${statusText}`);
      console.log(`[debugAdapters] Response body (first 500 chars): ${responseText.substring(0, 500)}`);

      if (!response.ok) {
        return {
          error: `API error: ${status} ${statusText}`,
          body: responseText,
        };
      }

      const data = JSON.parse(responseText);
      return {
        success: true,
        resultCount: data.results?.length || 0,
        hasAnswer: !!data.answer,
        firstResult: data.results?.[0]?.title,
      };
    } catch (error) {
      console.error(`[debugAdapters] Tavily error:`, error);
      return { error: String(error) };
    }
  },
});

export const testAllProviders = action({
  args: {
    query: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const results: Record<string, any> = {};

    // Test Serper
    try {
      results.serper = await ctx.runAction(
        // @ts-ignore
        "domains/search/fusion/debugAdapters:testSerper" as any,
        { query: args.query }
      );
    } catch (e) {
      results.serper = { error: String(e) };
    }

    // Test Brave
    try {
      results.brave = await ctx.runAction(
        // @ts-ignore
        "domains/search/fusion/debugAdapters:testBrave" as any,
        { query: args.query }
      );
    } catch (e) {
      results.brave = { error: String(e) };
    }

    // Test Tavily
    try {
      results.tavily = await ctx.runAction(
        // @ts-ignore
        "domains/search/fusion/debugAdapters:testTavily" as any,
        { query: args.query }
      );
    } catch (e) {
      results.tavily = { error: String(e) };
    }

    return results;
  },
});
