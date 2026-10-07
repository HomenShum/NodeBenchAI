/**
 * Generate a live digest with real feed data and entity extraction
 * This populates the digestCache table for the EntityProfilePage to use
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://agile-caribou-964.convex.cloud";

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║  Generate Live Digest with Entity Extraction              ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  const client = new ConvexHttpClient(CONVEX_URL);

  // Step 1: Check existing feed data
  console.log("Step 1: Checking feed data availability...");
  const digestData = await client.query(api.domains.ai.morningDigestQueries.getDigestData, {});
  const itemCount = (digestData?.marketMovers?.length || 0) +
    (digestData?.watchlistRelevant?.length || 0) +
    (digestData?.riskAlerts?.length || 0);
  console.log(`  Found ${itemCount} feed items available\n`);

  // Step 2: Trigger digest generation
  console.log("Step 2: Triggering digest generation...");
  console.log("  Persona: GENERAL");
  console.log("  This may take 15-45 seconds...\n");

  const startTime = Date.now();

  try {
    // Try claude-haiku-4.5 as a reliable fallback if Gemini has issues
    const model = process.env.DIGEST_MODEL || "claude-haiku-4.5";
    console.log(`  Using model: ${model}`);

    const result = await client.action(api.domains.agents.digestAgent.triggerDigestGeneration, {
      persona: "GENERAL",
      model,
      forceRefresh: true, // Force fresh generation
    });

    const elapsed = Date.now() - startTime;

    if (!result.success) {
      console.log(`\n❌ Digest generation failed: ${result.error}`);
      return;
    }

    console.log(`\n✅ Digest ${result.cached ? "retrieved from cache" : "generated"} in ${elapsed}ms\n`);

    // Step 3: Display results
    console.log("═══════════════════════════════════════════════════════════");
    console.log("DIGEST RESULTS");
    console.log("═══════════════════════════════════════════════════════════\n");

    const digest = result.digest as any;
    if (digest) {
      console.log("Narrative Thesis:");
      console.log(`  "${digest.narrativeThesis?.slice(0, 200)}..."\n`);

      console.log(`Signals: ${digest.signals?.length || 0}`);
      console.log(`Action Items: ${digest.actionItems?.length || 0}`);
      console.log(`Entity Count: ${result.entityCount}`);

      if (digest.entitySpotlight && digest.entitySpotlight.length > 0) {
        console.log(`\nEntity Spotlight (${digest.entitySpotlight.length} entities):`);
        for (const entity of digest.entitySpotlight) {
          console.log(`  - ${entity.name} (${entity.type})`);
          console.log(`    Insight: ${entity.keyInsight?.slice(0, 80)}...`);
          if (entity.fundingStage) {
            console.log(`    Funding: ${entity.fundingStage}`);
          }
        }
      } else {
        console.log("\n⚠️  No entity spotlight in digest");
      }
    }

    // Step 4: Test the getLatestDigestWithEntities query
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("TESTING getLatestDigestWithEntities QUERY");
    console.log("═══════════════════════════════════════════════════════════\n");

    const latestDigest = await client.query(
      api.domains.agents.digestAgent.getLatestDigestWithEntities,
      {}
    );

    if (latestDigest) {
      console.log("✅ Query returned data:");
      console.log(`  Date: ${latestDigest.dateString}`);
      console.log(`  Persona: ${latestDigest.persona}`);
      console.log(`  Entity Count: ${latestDigest.entityCount}`);
      console.log(`  Story Count: ${latestDigest.storyCount}`);

      if (latestDigest.entityEnrichment) {
        console.log("\n  Entity Enrichment Keys:");
        const keys = Object.keys(latestDigest.entityEnrichment);
        for (const key of keys.slice(0, 10)) {
          const entity = latestDigest.entityEnrichment[key];
          console.log(`    - ${key}: ${entity.type} - "${entity.summary?.slice(0, 50)}..."`);
        }
      }
    } else {
      console.log("❌ getLatestDigestWithEntities returned null");
    }

    console.log("\n✅ Digest generation complete! Entity profile pages should now show real data.");

  } catch (error) {
    console.error("\n❌ Error generating digest:");
    console.error(error);
  }
}

main().catch(console.error);
