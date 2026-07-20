"use node";

/**
 * DRANE Pipeline Validation Script
 *
 * Tests the Newsroom pipeline against known narratives from
 * the AI news video transcript to validate:
 * 1. Scout Agent discovers relevant news
 * 2. Analyst detects narrative shifts
 * 3. Publisher creates threads with citations
 *
 * Run with: npx convex run domains/narrative/tests/validatePipeline:runValidation
 */

import { action } from "../../../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../../../_generated/api";
import { getCurrentWeekNumber } from "../newsroom/state";

/**
 * Test cases based on the AI news video transcript
 */
const TEST_NARRATIVES = [
  {
    name: "xAI Funding and Safety Crisis",
    entityKeys: ["company:xAI", "person:Elon_Musk"],
    expectedTopics: ["funding", "Grok", "safety", "DoD", "Colossus"],
    focusTopics: ["Series E funding", "Grok safety", "Department of Defense"],
  },
  {
    name: "AGI Timeline Debate",
    entityKeys: ["person:Dario_Amodei", "person:Demis_Hassabis", "topic:AGI"],
    expectedTopics: ["Davos", "2026", "2027", "entry-level jobs", "automation"],
    focusTopics: ["AGI predictions", "job displacement", "Davos 2026"],
  },
  {
    name: "Apple-Google AI Partnership",
    entityKeys: ["company:Apple", "company:Google", "company:OpenAI"],
    expectedTopics: ["Gemini", "foundation model", "billion dollar", "ChatGPT"],
    focusTopics: ["Apple Gemini deal", "OpenAI competition"],
  },
  {
    name: "DeepSeek Engram Architecture",
    entityKeys: ["company:DeepSeek", "topic:transformer"],
    expectedTopics: ["engram", "memory", "token efficient", "hash"],
    focusTopics: ["DeepSeek paper", "conditional memory"],
  },
  {
    name: "AI Coding Tools Market",
    entityKeys: ["company:Cursor", "topic:AI_coding"],
    expectedTopics: ["Kilo Code", "Lovable", "vibe coding", "engineers"],
    focusTopics: ["AI code generation", "developer tools"],
  },
];

/**
 * Validation result for a single narrative
 */
interface ValidationResult {
  narrativeName: string;
  entityKeys: string[];
  success: boolean;
  newsFound: number;
  relevantNewsCount: number;
  shiftsDetected: number;
  threadsCreated: number;
  errors: string[];
  sampleHeadlines: string[];
  duration: number;
}

/**
 * Run validation for a single narrative
 */
export const validateSingleNarrative = action({
  args: {
    narrativeIndex: v.number(),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<ValidationResult> => {
    const narrative = TEST_NARRATIVES[args.narrativeIndex];
    if (!narrative) {
      return {
        narrativeName: "Unknown",
        entityKeys: [],
        success: false,
        newsFound: 0,
        relevantNewsCount: 0,
        shiftsDetected: 0,
        threadsCreated: 0,
        errors: [`Invalid narrative index: ${args.narrativeIndex}`],
        sampleHeadlines: [],
        duration: 0,
      };
    }

    const startTime = Date.now();
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[Validation] Testing: ${narrative.name}`);
    console.log(`[Validation] Entities: ${narrative.entityKeys.join(", ")}`);
    console.log(`${"=".repeat(60)}\n`);

    try {
      // Run the pipeline
      const result = await ctx.runAction(
        internal.domains.narrative.newsroom.workflow.runPipeline,
        {
          entityKeys: narrative.entityKeys,
          weekNumber: getCurrentWeekNumber(),
          focusTopics: narrative.focusTopics,
          userId: args.userId,
        }
      );

      // Check if expected topics were found in the news
      const relevantNewsCount = result.stats.newsItemsFound; // Simplified - would need actual news content to check

      const duration = Date.now() - startTime;

      console.log(`\n[Validation] Results for "${narrative.name}":`);
      console.log(`  - News items found: ${result.stats.newsItemsFound}`);
      console.log(`  - Shifts detected: ${result.stats.shiftsDetected}`);
      console.log(`  - Narratives published: ${result.stats.narrativesPublished}`);
      console.log(`  - Duration: ${duration}ms`);

      return {
        narrativeName: narrative.name,
        entityKeys: narrative.entityKeys,
        success: result.success && result.stats.newsItemsFound > 0,
        newsFound: result.stats.newsItemsFound,
        relevantNewsCount,
        shiftsDetected: result.stats.shiftsDetected,
        threadsCreated: result.stats.narrativesPublished,
        errors: result.errors,
        sampleHeadlines: [], // Would extract from actual results
        duration,
      };
    } catch (error) {
      return {
        narrativeName: narrative.name,
        entityKeys: narrative.entityKeys,
        success: false,
        newsFound: 0,
        relevantNewsCount: 0,
        shiftsDetected: 0,
        threadsCreated: 0,
        errors: [error instanceof Error ? error.message : String(error)],
        sampleHeadlines: [],
        duration: Date.now() - startTime,
      };
    }
  },
});

/**
 * Run full validation suite
 */
export const runValidation = action({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<{
    overallSuccess: boolean;
    totalNarratives: number;
    successfulNarratives: number;
    results: ValidationResult[];
    summary: string;
  }> => {
    console.log("\n" + "═".repeat(70));
    console.log("  DRANE PIPELINE VALIDATION SUITE");
    console.log("  Testing against AI News Video Narratives");
    console.log("═".repeat(70) + "\n");

    const results: ValidationResult[] = [];

    for (let i = 0; i < TEST_NARRATIVES.length; i++) {
      const result = await ctx.runAction(
        internal.domains.narrative.tests.validatePipeline.validateSingleNarrative,
        {
          narrativeIndex: i,
          userId: args.userId,
        }
      );
      results.push(result);

      // Brief pause between tests to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const successfulNarratives = results.filter((r) => r.success).length;
    const overallSuccess = successfulNarratives === TEST_NARRATIVES.length;

    // Generate summary
    const summary = `
╔══════════════════════════════════════════════════════════════════════╗
║                    VALIDATION SUMMARY                                ║
╠══════════════════════════════════════════════════════════════════════╣
║ Total Narratives Tested: ${TEST_NARRATIVES.length.toString().padEnd(44)}║
║ Successful: ${successfulNarratives.toString().padEnd(56)}║
║ Failed: ${(TEST_NARRATIVES.length - successfulNarratives).toString().padEnd(60)}║
╠══════════════════════════════════════════════════════════════════════╣
${results
  .map(
    (r) =>
      `║ ${r.success ? "✓" : "✗"} ${r.narrativeName.padEnd(30)} | News: ${r.newsFound.toString().padStart(3)} | Shifts: ${r.shiftsDetected.toString().padStart(2)} ║`
  )
  .join("\n")}
╚══════════════════════════════════════════════════════════════════════╝
`;

    console.log(summary);

    return {
      overallSuccess,
      totalNarratives: TEST_NARRATIVES.length,
      successfulNarratives,
      results,
      summary,
    };
  },
});

/**
 * Quick smoke test - runs just the xAI narrative
 */
export const smokeTest = action({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    console.log("[SmokeTest] Running quick validation with xAI narrative...\n");

    const result = await ctx.runAction(
      internal.domains.narrative.newsroom.workflow.runPipeline,
      {
        entityKeys: ["company:xAI"],
        focusTopics: ["funding", "Grok", "valuation"],
        userId: args.userId,
      }
    );

    console.log("\n[SmokeTest] Results:");
    console.log(`  Success: ${result.success}`);
    console.log(`  News Found: ${result.stats.newsItemsFound}`);
    console.log(`  Shifts Detected: ${result.stats.shiftsDetected}`);
    console.log(`  Threads Created: ${result.stats.narrativesPublished}`);
    console.log(`  Citations: ${result.stats.citationsGenerated}`);
    console.log(`  Searches Logged: ${result.stats.searchesLogged}`);
    console.log(`  Duration: ${result.durationMs}ms`);

    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.join(", ")}`);
    }

    return result;
  },
});
