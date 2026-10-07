/**
 * Comprehensive Funding Data Cleanup Script
 *
 * Fixes all known data quality issues:
 * 1. "Unknown Company" entries - Extract correct names from source URLs
 * 2. Descriptive prefix contamination - Clean up company names
 * 3. Misattributions - Verify and correct company names
 * 4. Low confidence entries - Re-extract with LLM
 *
 * Usage:
 * npx convex run scripts/fixAllFundingData:scanAndFixAll
 */

import { internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// STEP 1: SCAN FOR ISSUES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scan all funding events for data quality issues.
 */
export const scanForIssues = internalQuery({
  args: {
    lookbackHours: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const lookbackMs = (args.lookbackHours ?? 720) * 60 * 60 * 1000; // Default 30 days
    const cutoff = Date.now() - lookbackMs;
    const limit = args.limit ?? 500;

    console.log(`[scan] Scanning funding events from last ${args.lookbackHours ?? 720} hours`);

    const events = await ctx.db
      .query("fundingEvents")
      .withIndex("by_createdAt")
      .order("desc")
      .filter((q) => q.gte(q.field("createdAt"), cutoff))
      .take(limit);

    const issues = {
      unknownCompany: [] as any[],
      descriptivePrefix: [] as any[],
      shortName: [] as any[],
      lowConfidence: [] as any[],
      singleSourceLargeRound: [] as any[],
      suspiciousPattern: [] as any[],
    };

    for (const event of events) {
      const companyName = event.companyName;
      const isLargeRound = event.amountUsd && event.amountUsd >= 50_000_000;
      const isLateSeries = ["series-b", "series-c", "series-d-plus", "growth"].includes(event.roundType);

      // Issue 1: "Unknown Company" entries
      if (/^unknown company/i.test(companyName)) {
        issues.unknownCompany.push({
          id: event._id,
          companyName,
          amount: event.amountRaw,
          round: event.roundType,
          sources: event.sourceUrls,
          confidence: event.confidence,
        });
      }

      // Issue 2: Descriptive prefix contamination
      const descriptivePrefixes = [
        "AI startup", "Software company", "Tech startup", "Startup",
        "Accounting software", "Robot software", "Defense tech", "unicorn",
        "AI chip startup", "firm",
      ];

      for (const prefix of descriptivePrefixes) {
        if (new RegExp(prefix, "i").test(companyName)) {
          issues.descriptivePrefix.push({
            id: event._id,
            companyName,
            prefix,
            amount: event.amountRaw,
            round: event.roundType,
            suggested: companyName.replace(new RegExp(prefix, "gi"), "").trim(),
          });
          break; // Only flag once per company
        }
      }

      // Issue 3: Very short names (< 4 chars, excluding well-known ones)
      const knownShortNames = ["IBM", "SAP", "AWS"];
      if (companyName.length < 4 && !knownShortNames.includes(companyName)) {
        issues.shortName.push({
          id: event._id,
          companyName,
          amount: event.amountRaw,
          round: event.roundType,
          sources: event.sourceUrls,
        });
      }

      // Issue 4: Low confidence (< 0.7) for significant rounds
      if (event.confidence < 0.7 && (isLargeRound || isLateSeries)) {
        issues.lowConfidence.push({
          id: event._id,
          companyName,
          confidence: event.confidence,
          amount: event.amountRaw,
          amountUsd: event.amountUsd,
          round: event.roundType,
          sources: event.sourceUrls,
        });
      }

      // Issue 5: Single source for large rounds ($50M+)
      if (
        isLargeRound &&
        event.verificationStatus === "single-source" &&
        event.sourceUrls.length === 1
      ) {
        issues.singleSourceLargeRound.push({
          id: event._id,
          companyName,
          amount: event.amountRaw,
          amountUsd: event.amountUsd,
          round: event.roundType,
          source: event.sourceUrls[0],
        });
      }

      // Issue 6: Suspicious patterns
      const suspiciousPatterns = [
        { regex: /\$\d+[MB]/i, desc: "Contains dollar amount in name" },
        { regex: /^\d/, desc: "Starts with number" },
        { regex: /\(.*\)$/, desc: "Ends with parenthetical" },
      ];

      for (const { regex, desc } of suspiciousPatterns) {
        if (regex.test(companyName)) {
          issues.suspiciousPattern.push({
            id: event._id,
            companyName,
            pattern: desc,
            amount: event.amountRaw,
            round: event.roundType,
          });
          break;
        }
      }
    }

    const totalIssues =
      issues.unknownCompany.length +
      issues.descriptivePrefix.length +
      issues.shortName.length +
      issues.lowConfidence.length +
      issues.singleSourceLargeRound.length +
      issues.suspiciousPattern.length;

    console.log(`[scan] Found ${totalIssues} issues:`);
    console.log(`  - Unknown Company: ${issues.unknownCompany.length}`);
    console.log(`  - Descriptive Prefix: ${issues.descriptivePrefix.length}`);
    console.log(`  - Short Name: ${issues.shortName.length}`);
    console.log(`  - Low Confidence: ${issues.lowConfidence.length}`);
    console.log(`  - Single Source Large: ${issues.singleSourceLargeRound.length}`);
    console.log(`  - Suspicious Pattern: ${issues.suspiciousPattern.length}`);

    return {
      totalScanned: events.length,
      totalIssues,
      issues,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STEP 2: FIX INDIVIDUAL ISSUES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fix a single funding event by re-extracting company name with LLM.
 */
export const fixSingleEvent = internalAction({
  args: {
    fundingEventId: v.id("fundingEvents"),
    forceReExtract: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    oldName: v.string(),
    newName: v.optional(v.string()),
    confidence: v.optional(v.number()),
    method: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Get the event
    const event = await ctx.runQuery(internal.domains.enrichment.dataCleanup.getEventById, {
      eventId: args.fundingEventId,
    });

    if (!event) {
      return {
        success: false,
        oldName: "",
        error: "Event not found",
      };
    }

    console.log(`[fix] Processing: ${event.companyName}`);

    // Get source article for context
    const sourceUrl = event.sourceUrls?.[0];
    if (!sourceUrl) {
      return {
        success: false,
        oldName: event.companyName,
        error: "No source URL available",
      };
    }

    // Fetch article content if possible (optional enhancement)
    // For now, use title/summary from feedItem if available

    // Extract company name using LLM
    try {
      const extraction = await ctx.runAction(
        internal.domains.enrichment.llmCompanyExtraction.extractCompanyNameWithLLM,
        {
          title: event.description || `${event.companyName} raises ${event.amountRaw}`,
          summary: event.description,
          sourceUrl,
          amount: event.amountRaw,
          roundType: event.roundType,
        }
      );

      // Validate the extraction
      if (extraction.confidence < 0.5) {
        return {
          success: false,
          oldName: event.companyName,
          error: `Low confidence extraction (${extraction.confidence}): ${extraction.reasoning}`,
        };
      }

      // Update the event
      if (extraction.companyName !== event.companyName) {
        await ctx.runMutation(internal.domains.enrichment.dataCleanup.updateEventCompanyName, {
          eventId: args.fundingEventId,
          newCompanyName: extraction.companyName,
          confidence: extraction.confidence,
          extractionMethod: extraction.method,
        });

        console.log(`[fix] ✓ Updated: "${event.companyName}" → "${extraction.companyName}"`);

        return {
          success: true,
          oldName: event.companyName,
          newName: extraction.companyName,
          confidence: extraction.confidence,
          method: extraction.method,
        };
      } else {
        console.log(`[fix] ○ No change needed: "${event.companyName}"`);
        return {
          success: true,
          oldName: event.companyName,
          newName: event.companyName,
          confidence: extraction.confidence,
          method: extraction.method,
        };
      }
    } catch (error: any) {
      console.error(`[fix] ✗ Failed to fix ${event.companyName}:`, error.message);
      return {
        success: false,
        oldName: event.companyName,
        error: error.message,
      };
    }
  },
});

/**
 * Helper query to get event by ID.
 */
export const getEventById = internalQuery({
  args: {
    eventId: v.id("fundingEvents"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.eventId);
  },
});

/**
 * Helper mutation to update event company name.
 */
export const updateEventCompanyName = internalMutation({
  args: {
    eventId: v.id("fundingEvents"),
    newCompanyName: v.string(),
    confidence: v.number(),
    extractionMethod: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      companyName: args.newCompanyName,
      confidence: args.confidence,
      updatedAt: Date.now(),
      // Store metadata about the fix
      metadata: {
        fixedAt: Date.now(),
        extractionMethod: args.extractionMethod,
        fixedBy: "automated-llm-extraction",
      } as any,
    });

    console.log(`[update] Updated ${args.eventId} to "${args.newCompanyName}"`);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STEP 3: BATCH FIX ALL ISSUES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scan and fix all issues automatically.
 * Processes in batches to avoid timeouts.
 */
export const scanAndFixAll = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    lookbackHours: v.optional(v.number()),
    maxFixes: v.optional(v.number()),
    categories: v.optional(v.array(v.string())), // Which issue types to fix
  },
  returns: v.object({
    scanned: v.number(),
    totalIssues: v.number(),
    fixed: v.number(),
    failed: v.number(),
    skipped: v.number(),
    details: v.array(v.object({
      id: v.string(),
      oldName: v.string(),
      newName: v.optional(v.string()),
      status: v.string(),
      error: v.optional(v.string()),
    })),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const maxFixes = args.maxFixes ?? 50; // Default limit to avoid huge operations
    const categories = args.categories ?? [
      "unknownCompany",
      "descriptivePrefix",
      "lowConfidence",
    ];

    console.log(`[scanAndFix] Starting${dryRun ? " (DRY RUN)" : ""}...`);
    console.log(`  - Max fixes: ${maxFixes}`);
    console.log(`  - Categories: ${categories.join(", ")}`);

    // Step 1: Scan for issues
    const scanResult = await ctx.runQuery(internal.domains.enrichment.dataCleanup.scanForIssues, {
      lookbackHours: args.lookbackHours,
    });

    console.log(`[scanAndFix] Scan complete: ${scanResult.totalIssues} issues found`);

    // Step 2: Build fix list
    const toFix: Array<{ id: string; oldName: string; category: string }> = [];

    if (categories.includes("unknownCompany")) {
      for (const issue of scanResult.issues.unknownCompany.slice(0, maxFixes - toFix.length)) {
        toFix.push({ id: issue.id, oldName: issue.companyName, category: "unknownCompany" });
      }
    }

    if (categories.includes("descriptivePrefix")) {
      for (const issue of scanResult.issues.descriptivePrefix.slice(0, maxFixes - toFix.length)) {
        toFix.push({ id: issue.id, oldName: issue.companyName, category: "descriptivePrefix" });
      }
    }

    if (categories.includes("lowConfidence")) {
      for (const issue of scanResult.issues.lowConfidence.slice(0, maxFixes - toFix.length)) {
        toFix.push({ id: issue.id, oldName: issue.companyName, category: "lowConfidence" });
      }
    }

    console.log(`[scanAndFix] Will fix ${toFix.length} issues`);

    if (dryRun) {
      console.log(`[scanAndFix] DRY RUN - Would fix:`);
      for (const item of toFix) {
        console.log(`  - [${item.category}] ${item.oldName}`);
      }

      return {
        scanned: scanResult.totalScanned,
        totalIssues: scanResult.totalIssues,
        fixed: 0,
        failed: 0,
        skipped: toFix.length,
        details: toFix.map(item => ({
          id: item.id,
          oldName: item.oldName,
          status: "skipped-dry-run",
        })),
      };
    }

    // Step 3: Fix each issue
    const results: Array<{
      id: string;
      oldName: string;
      newName?: string;
      status: string;
      error?: string;
    }> = [];

    let fixed = 0;
    let failed = 0;

    for (let i = 0; i < toFix.length; i++) {
      const item = toFix[i];

      console.log(`[scanAndFix] Fixing ${i + 1}/${toFix.length}: ${item.oldName}`);

      try {
        const result = await ctx.runAction(internal.domains.enrichment.dataCleanup.fixSingleEvent, {
          fundingEventId: item.id as any,
        });

        if (result.success) {
          fixed++;
          results.push({
            id: item.id,
            oldName: result.oldName,
            newName: result.newName,
            status: "fixed",
          });
        } else {
          failed++;
          results.push({
            id: item.id,
            oldName: result.oldName,
            status: "failed",
            error: result.error,
          });
        }
      } catch (error: any) {
        failed++;
        results.push({
          id: item.id,
          oldName: item.oldName,
          status: "failed",
          error: error.message,
        });
      }

      // Rate limiting: Add delay between fixes
      if (i < toFix.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`[scanAndFix] Complete: ${fixed} fixed, ${failed} failed`);

    return {
      scanned: scanResult.totalScanned,
      totalIssues: scanResult.totalIssues,
      fixed,
      failed,
      skipped: 0,
      details: results,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STEP 4: MANUAL FIXES FOR SPECIFIC CASES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Manually fix a specific company name (for edge cases).
 */
export const manualFixCompanyName = internalMutation({
  args: {
    fundingEventId: v.id("fundingEvents"),
    correctCompanyName: v.string(),
    reasoning: v.string(),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.fundingEventId);

    if (!event) {
      throw new Error(`Event not found: ${args.fundingEventId}`);
    }

    const oldName = event.companyName;

    // Store fix reasoning in description field (metadata not in schema)
    const fixNote = `[Manual Fix from "${oldName}"] ${args.reasoning}`;
    const updatedDescription = event.description
      ? `${event.description}\n\n${fixNote}`
      : fixNote;

    await ctx.db.patch(args.fundingEventId, {
      companyName: args.correctCompanyName,
      confidence: 1.0, // Manual fix = high confidence
      description: updatedDescription,
      updatedAt: Date.now(),
    });

    console.log(`[manualFix] Updated "${oldName}" → "${args.correctCompanyName}"`);
    console.log(`  Reasoning: ${args.reasoning}`);

    return {
      success: true,
      oldName,
      newName: args.correctCompanyName,
    };
  },
});

/**
 * Generate a detailed fix report.
 */
export const generateFixReport = internalQuery({
  args: {
    lookbackHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const scanResult = await ctx.runQuery(internal.domains.enrichment.dataCleanup.scanForIssues, {
      lookbackHours: args.lookbackHours,
    });

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalScanned: scanResult.totalScanned,
        totalIssues: scanResult.totalIssues,
        issueBreakdown: {
          unknownCompany: scanResult.issues.unknownCompany.length,
          descriptivePrefix: scanResult.issues.descriptivePrefix.length,
          shortName: scanResult.issues.shortName.length,
          lowConfidence: scanResult.issues.lowConfidence.length,
          singleSourceLarge: scanResult.issues.singleSourceLargeRound.length,
          suspiciousPattern: scanResult.issues.suspiciousPattern.length,
        },
      },
      criticalIssues: {
        unknownCompany: scanResult.issues.unknownCompany.slice(0, 10),
        singleSourceLarge: scanResult.issues.singleSourceLargeRound.slice(0, 10),
      },
      recommendations: generateRecommendations(scanResult),
    };

    return report;
  },
});

function generateRecommendations(scanResult: any): string[] {
  const recs: string[] = [];

  if (scanResult.issues.unknownCompany.length > 0) {
    recs.push(
      `🔴 CRITICAL: ${scanResult.issues.unknownCompany.length} "Unknown Company" entries need immediate extraction`
    );
  }

  if (scanResult.issues.singleSourceLargeRound.length > 0) {
    recs.push(
      `🟠 HIGH: ${scanResult.issues.singleSourceLargeRound.length} large rounds ($50M+) have single source - need verification`
    );
  }

  if (scanResult.issues.descriptivePrefix.length > 5) {
    recs.push(
      `🟡 MEDIUM: ${scanResult.issues.descriptivePrefix.length} entries have descriptive prefixes - automated cleanup recommended`
    );
  }

  if (scanResult.issues.lowConfidence.length > 0) {
    recs.push(
      `🟡 MEDIUM: ${scanResult.issues.lowConfidence.length} entries have low confidence - re-extraction recommended`
    );
  }

  if (scanResult.totalIssues > 20) {
    recs.push(
      `⚠️ Consider implementing LLM-based extraction as default to prevent future issues`
    );
  }

  return recs;
}
