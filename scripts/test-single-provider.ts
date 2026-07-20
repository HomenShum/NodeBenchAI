/**
 * Test Single Provider - Debug API key availability
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://agile-caribou-964.convex.cloud";

async function main() {
  console.log("Testing single provider search...");
  console.log(`Convex URL: ${CONVEX_URL}`);

  const client = new ConvexHttpClient(CONVEX_URL);

  // Test with serper only
  try {
    console.log("\nTesting SERPER...");
    const result = await client.action(api.domains.search.fusion.actions.fusionSearch, {
      query: "OpenAI latest news",
      mode: "fast",
      sources: ["serper"],
      maxTotal: 5,
      skipCache: true,
    });
    console.log(`  Results: ${result.payload.results.length}`);
    console.log(`  Sources queried: ${result.payload.sourcesQueried.join(", ")}`);
    if (result.payload.errors?.length) {
      console.log(`  Errors: ${JSON.stringify(result.payload.errors)}`);
    }
    if (result.payload.results.length > 0) {
      console.log(`  First result: ${result.payload.results[0].title}`);
    }
  } catch (error) {
    console.error("  Error:", error);
  }

  // Test with brave only
  try {
    console.log("\nTesting BRAVE...");
    const result = await client.action(api.domains.search.fusion.actions.fusionSearch, {
      query: "OpenAI latest news",
      mode: "fast",
      sources: ["brave"],
      maxTotal: 5,
      skipCache: true,
    });
    console.log(`  Results: ${result.payload.results.length}`);
    console.log(`  Sources queried: ${result.payload.sourcesQueried.join(", ")}`);
    if (result.payload.errors?.length) {
      console.log(`  Errors: ${JSON.stringify(result.payload.errors)}`);
    }
    if (result.payload.results.length > 0) {
      console.log(`  First result: ${result.payload.results[0].title}`);
    }
  } catch (error) {
    console.error("  Error:", error);
  }

  // Test with tavily only
  try {
    console.log("\nTesting TAVILY...");
    const result = await client.action(api.domains.search.fusion.actions.fusionSearch, {
      query: "OpenAI latest news",
      mode: "fast",
      sources: ["tavily"],
      maxTotal: 5,
      skipCache: true,
    });
    console.log(`  Results: ${result.payload.results.length}`);
    console.log(`  Sources queried: ${result.payload.sourcesQueried.join(", ")}`);
    if (result.payload.errors?.length) {
      console.log(`  Errors: ${JSON.stringify(result.payload.errors)}`);
    }
    if (result.payload.results.length > 0) {
      console.log(`  First result: ${result.payload.results[0].title}`);
    }
  } catch (error) {
    console.error("  Error:", error);
  }

  // Test with linkup only (should work)
  try {
    console.log("\nTesting LINKUP...");
    const result = await client.action(api.domains.search.fusion.actions.fusionSearch, {
      query: "OpenAI latest news",
      mode: "fast",
      sources: ["linkup"],
      maxTotal: 5,
      skipCache: true,
    });
    console.log(`  Results: ${result.payload.results.length}`);
    console.log(`  Sources queried: ${result.payload.sourcesQueried.join(", ")}`);
    if (result.payload.results.length > 0) {
      console.log(`  First result: ${result.payload.results[0].title}`);
    }
  } catch (error) {
    console.error("  Error:", error);
  }
}

main();
