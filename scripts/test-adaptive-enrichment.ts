/**
 * Test Adaptive Entity Enrichment Pipeline
 *
 * Tests the LLM-powered adaptive entity enrichment system that:
 * 1. Dynamically discovers what's important about an entity
 * 2. Builds a timeline of key events
 * 3. Maps relationships and circles of influence
 * 4. Creates flexible sections based on entity type
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://agile-caribou-964.convex.cloud";

interface TestResult {
  entityName: string;
  success: boolean;
  elapsedMs: number;
  profile?: any;
  error?: string;
}

async function testAdaptiveEnrichment(
  client: ConvexHttpClient,
  entityName: string,
  entityType?: string,
  depth: "quick" | "standard" | "deep" = "standard"
): Promise<TestResult> {
  const startTime = Date.now();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${entityName} (${entityType || "auto-detect"}) [${depth}]`);
  console.log("=".repeat(60));

  try {
    const profile = await client.action(
      api.domains.knowledge.adaptiveEntityEnrichment.enrichEntityAdaptively,
      {
        entityName,
        knownEntityType: entityType,
        depth,
      }
    );

    const elapsedMs = Date.now() - startTime;

    console.log(`\n✅ Success in ${elapsedMs}ms`);
    console.log(`\n📋 Profile Summary:`);
    console.log(`   Entity Type: ${profile.entityType}`);
    console.log(`   Sub-types: ${profile.subTypes?.join(", ") || "none"}`);
    console.log(`   Headline: ${profile.headline}`);

    console.log(`\n📝 Executive Summary:`);
    console.log(`   Known For: ${profile.executiveSummary?.whatTheyreKnownFor?.slice(0, 100)}...`);
    console.log(`   Key Insight: ${profile.executiveSummary?.keyInsight?.slice(0, 100)}...`);

    console.log(`\n⏱️ Timeline Events: ${profile.timeline?.length || 0}`);
    if (profile.timeline?.length > 0) {
      const topEvents = profile.timeline.slice(0, 3);
      for (const event of topEvents) {
        console.log(`   - ${event.date}: ${event.title} (${event.significance})`);
      }
    }

    console.log(`\n🔗 Relationships: ${profile.relationships?.length || 0}`);
    if (profile.relationships?.length > 0) {
      const topRels = profile.relationships.slice(0, 3);
      for (const rel of topRels) {
        console.log(`   - ${rel.entityName} (${rel.relationshipType}, ${rel.strength})`);
      }
    }

    console.log(`\n🎯 Circle of Influence:`);
    console.log(`   Tier 1: ${profile.circleOfInfluence?.tier1?.slice(0, 5).join(", ") || "none"}`);
    console.log(`   Tier 2: ${profile.circleOfInfluence?.tier2?.slice(0, 5).join(", ") || "none"}`);

    console.log(`\n📊 Sections: ${profile.sections?.length || 0}`);
    if (profile.sections?.length > 0) {
      for (const section of profile.sections) {
        console.log(`   - ${section.title} (priority: ${section.priority})`);
      }
    }

    console.log(`\n📈 Quality:`);
    console.log(`   Completeness: ${profile.enrichmentQuality?.completeness || 0}%`);
    console.log(`   Confidence: ${profile.enrichmentQuality?.confidence || 0}%`);
    if (profile.enrichmentQuality?.gaps?.length > 0) {
      console.log(`   Gaps: ${profile.enrichmentQuality.gaps.join(", ")}`);
    }

    return {
      entityName,
      success: true,
      elapsedMs,
      profile,
    };
  } catch (error: any) {
    const elapsedMs = Date.now() - startTime;
    console.log(`\n❌ Error after ${elapsedMs}ms: ${error.message || error}`);
    return {
      entityName,
      success: false,
      elapsedMs,
      error: error.message || String(error),
    };
  }
}

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║  Adaptive Entity Enrichment Test Suite                    ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  const client = new ConvexHttpClient(CONVEX_URL);
  const results: TestResult[] = [];

  // Test cases with different entity types
  const testCases = [
    { name: "Sam Altman", type: "person", depth: "standard" as const },
    { name: "Dario Amodei", type: "person", depth: "quick" as const },
    { name: "Anthropic", type: "company", depth: "standard" as const },
    // { name: "GPT-4", type: "technology", depth: "quick" as const },
  ];

  // Check if we should run a specific test
  const specificEntity = process.argv[2];
  const specificDepth = (process.argv[3] as "quick" | "standard" | "deep") || "standard";

  if (specificEntity) {
    // Run single test
    const result = await testAdaptiveEnrichment(client, specificEntity, undefined, specificDepth);
    results.push(result);
  } else {
    // Run all test cases
    for (const testCase of testCases) {
      const result = await testAdaptiveEnrichment(
        client,
        testCase.name,
        testCase.type,
        testCase.depth
      );
      results.push(result);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`\n✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);

  if (successful.length > 0) {
    const avgTime = successful.reduce((sum, r) => sum + r.elapsedMs, 0) / successful.length;
    console.log(`⏱️ Average time: ${Math.round(avgTime)}ms`);
  }

  if (failed.length > 0) {
    console.log("\n❌ Failed entities:");
    for (const f of failed) {
      console.log(`   - ${f.entityName}: ${f.error}`);
    }
  }

  console.log("\n✅ Test complete!");
}

main().catch(console.error);
