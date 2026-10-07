// convex/domains/financial/fundamentals.ts
// Financial Fundamentals upsert pipeline
//
// Orchestrates SEC data fetching, XBRL parsing, and database storage
// with deduplication and data quality validation.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Doc, Id } from "../../../_generated/dataModel";
import {
  extractFundamentals,
  listAvailableFiscalYears,
  listAvailableQuarters,
  type NormalizedFundamentals,
} from "./xbrlParser";

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

export interface IngestionResult {
  ok: boolean;
  ticker: string;
  cik?: string;
  fundamentalsId?: Id<"financialFundamentals">;
  fiscalYear: number;
  fiscalQuarter?: number;
  action?: "created" | "updated" | "skipped";
  error?: string;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* QUERIES                                                             */
/* ------------------------------------------------------------------ */

/**
 * Get fundamentals for a ticker and period
 */
export const getFundamentals = query({
  args: {
    ticker: v.string(),
    fiscalYear: v.number(),
    fiscalQuarter: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("financialFundamentals"),
      ticker: v.string(),
      cik: v.string(),
      fiscalYear: v.number(),
      fiscalQuarter: v.optional(v.number()),
      filingDate: v.string(),
      incomeStatement: v.any(),
      balanceSheet: v.any(),
      cashFlow: v.any(),
      metrics: v.optional(v.any()),
      extractionConfidence: v.number(),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const tickerUpper = args.ticker.toUpperCase();
    const fundamentals = await ctx.db
      .query("financialFundamentals")
      .withIndex("by_ticker_period", (q) =>
        q
          .eq("ticker", tickerUpper)
          .eq("fiscalYear", args.fiscalYear)
          .eq("fiscalQuarter", args.fiscalQuarter)
      )
      .first();

    if (!fundamentals) return null;

    return {
      _id: fundamentals._id,
      ticker: fundamentals.ticker,
      cik: fundamentals.cik,
      fiscalYear: fundamentals.fiscalYear,
      fiscalQuarter: fundamentals.fiscalQuarter,
      filingDate: fundamentals.filingDate,
      incomeStatement: fundamentals.incomeStatement,
      balanceSheet: fundamentals.balanceSheet,
      cashFlow: fundamentals.cashFlow,
      metrics: fundamentals.metrics,
      extractionConfidence: fundamentals.extractionConfidence,
      createdAt: fundamentals.createdAt,
    };
  },
});

/**
 * Get all fundamentals for a ticker (historical)
 */
export const getFundamentalsHistory = query({
  args: {
    ticker: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("financialFundamentals"),
      fiscalYear: v.number(),
      fiscalQuarter: v.optional(v.number()),
      filingDate: v.string(),
      revenue: v.number(),
      netIncome: v.number(),
      extractionConfidence: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const tickerUpper = args.ticker.toUpperCase();
    const limit = args.limit ?? 20;

    const fundamentals = await ctx.db
      .query("financialFundamentals")
      .withIndex("by_ticker_period", (q) => q.eq("ticker", tickerUpper))
      .order("desc")
      .take(limit);

    return fundamentals.map((f) => ({
      _id: f._id,
      fiscalYear: f.fiscalYear,
      fiscalQuarter: f.fiscalQuarter,
      filingDate: f.filingDate,
      revenue: f.incomeStatement.revenue,
      netIncome: f.incomeStatement.netIncome,
      extractionConfidence: f.extractionConfidence,
    }));
  },
});

/* ------------------------------------------------------------------ */
/* INTERNAL QUERIES                                                    */
/* ------------------------------------------------------------------ */

/**
 * Check if fundamentals already exist for a period
 */
export const checkFundamentalsExist = internalQuery({
  args: {
    ticker: v.string(),
    fiscalYear: v.number(),
    fiscalQuarter: v.optional(v.number()),
  },
  returns: v.union(v.null(), v.id("financialFundamentals")),
  handler: async (ctx, args) => {
    const tickerUpper = args.ticker.toUpperCase();
    const existing = await ctx.db
      .query("financialFundamentals")
      .withIndex("by_ticker_period", (q) =>
        q
          .eq("ticker", tickerUpper)
          .eq("fiscalYear", args.fiscalYear)
          .eq("fiscalQuarter", args.fiscalQuarter)
      )
      .first();

    return existing?._id ?? null;
  },
});

/* ------------------------------------------------------------------ */
/* INTERNAL MUTATIONS                                                  */
/* ------------------------------------------------------------------ */

/**
 * Upsert financial fundamentals
 */
export const upsertFundamentals = internalMutation({
  args: {
    ticker: v.string(),
    cik: v.string(),
    fiscalYear: v.number(),
    fiscalQuarter: v.optional(v.number()),
    sourceArtifactId: v.id("sourceArtifacts"),
    xbrlUrl: v.string(),
    filingDate: v.string(),
    incomeStatement: v.object({
      revenue: v.number(),
      costOfRevenue: v.optional(v.number()),
      grossProfit: v.optional(v.number()),
      operatingExpenses: v.optional(v.number()),
      operatingIncome: v.optional(v.number()),
      netIncome: v.number(),
      eps: v.optional(v.number()),
      sharesOutstanding: v.optional(v.number()),
    }),
    balanceSheet: v.object({
      totalAssets: v.number(),
      totalLiabilities: v.number(),
      totalEquity: v.number(),
      cash: v.optional(v.number()),
      totalDebt: v.optional(v.number()),
      currentAssets: v.optional(v.number()),
      currentLiabilities: v.optional(v.number()),
    }),
    cashFlow: v.object({
      operatingCashFlow: v.number(),
      capex: v.optional(v.number()),
      freeCashFlow: v.optional(v.number()),
      dividendsPaid: v.optional(v.number()),
      shareRepurchases: v.optional(v.number()),
    }),
    metrics: v.optional(
      v.object({
        grossMargin: v.optional(v.number()),
        operatingMargin: v.optional(v.number()),
        netMargin: v.optional(v.number()),
        roic: v.optional(v.number()),
        roe: v.optional(v.number()),
        debtToEquity: v.optional(v.number()),
      })
    ),
    extractionConfidence: v.number(),
    manualOverrides: v.optional(v.array(v.string())),
    // Provenance tracking
    fieldProvenance: v.optional(v.array(v.object({
      fieldPath: v.string(),
      tag: v.string(),
      namespace: v.string(),
      units: v.string(),
      periodStart: v.optional(v.string()),
      periodEnd: v.string(),
      fiscalPeriod: v.string(),
      formType: v.string(),
      accessionNumber: v.string(),
      filedDate: v.string(),
      dimensions: v.optional(v.array(v.object({
        axis: v.string(),
        member: v.string(),
      }))),
      selectionRationale: v.string(),
      isCustomTag: v.boolean(),
      alternativeTags: v.optional(v.array(v.string())),
      isComputed: v.optional(v.boolean()),
      computedFrom: v.optional(v.array(v.string())),
    }))),
    hasCustomTags: v.optional(v.boolean()),
    customTagCount: v.optional(v.number()),
    needsReview: v.optional(v.boolean()),
    // Dimensional data strategy tracking
    dimensionalStrategy: v.optional(v.union(
      v.literal("CONSOLIDATED_ONLY"),
      v.literal("SEGMENT_AWARE"),
      v.literal("FULL_DIMENSIONAL"),
    )),
    dimensionalFactsEncountered: v.optional(v.number()),
    dimensionalFactsSkipped: v.optional(v.number()),
    hasSegmentData: v.optional(v.boolean()),
    // Taxonomy version provenance
    taxonomyProvenance: v.optional(v.object({
      primaryTaxonomy: v.object({
        family: v.string(),
        releaseYear: v.number(),
        versionId: v.string(),
        effectiveDate: v.string(),
        taxonomyUrl: v.optional(v.string()),
        changeNotes: v.optional(v.array(v.string())),
      }),
      detectedNamespaces: v.array(v.string()),
      resolvedVersions: v.array(v.object({
        family: v.string(),
        releaseYear: v.number(),
        versionId: v.string(),
        effectiveDate: v.string(),
        taxonomyUrl: v.optional(v.string()),
        changeNotes: v.optional(v.array(v.string())),
      })),
      tagNormalizations: v.array(v.object({
        originalTag: v.string(),
        normalizedTag: v.string(),
        reason: v.string(),
      })),
      extractionEngineVersion: v.string(),
      tagMappingRevision: v.string(),
      extractedAt: v.number(),
    })),
  },
  returns: v.object({
    id: v.id("financialFundamentals"),
    action: v.union(v.literal("created"), v.literal("updated")),
  }),
  handler: async (ctx, args) => {
    const tickerUpper = args.ticker.toUpperCase();

    // Check for existing record
    const existing = await ctx.db
      .query("financialFundamentals")
      .withIndex("by_ticker_period", (q) =>
        q
          .eq("ticker", tickerUpper)
          .eq("fiscalYear", args.fiscalYear)
          .eq("fiscalQuarter", args.fiscalQuarter)
      )
      .first();

    if (existing) {
      // Update existing record
      await ctx.db.patch(existing._id, {
        sourceArtifactId: args.sourceArtifactId,
        xbrlUrl: args.xbrlUrl,
        filingDate: args.filingDate,
        incomeStatement: args.incomeStatement,
        balanceSheet: args.balanceSheet,
        cashFlow: args.cashFlow,
        metrics: args.metrics,
        extractionConfidence: args.extractionConfidence,
        manualOverrides: args.manualOverrides,
        // Provenance tracking
        fieldProvenance: args.fieldProvenance,
        hasCustomTags: args.hasCustomTags,
        customTagCount: args.customTagCount,
        needsReview: args.needsReview,
        // Dimensional data strategy tracking
        dimensionalStrategy: args.dimensionalStrategy,
        dimensionalFactsEncountered: args.dimensionalFactsEncountered,
        dimensionalFactsSkipped: args.dimensionalFactsSkipped,
        hasSegmentData: args.hasSegmentData,
        // Taxonomy version provenance
        taxonomyProvenance: args.taxonomyProvenance,
      });
      return { id: existing._id, action: "updated" };
    }

    // Create new record
    const id = await ctx.db.insert("financialFundamentals", {
      ticker: tickerUpper,
      cik: args.cik,
      fiscalYear: args.fiscalYear,
      fiscalQuarter: args.fiscalQuarter,
      sourceArtifactId: args.sourceArtifactId,
      xbrlUrl: args.xbrlUrl,
      filingDate: args.filingDate,
      incomeStatement: args.incomeStatement,
      balanceSheet: args.balanceSheet,
      cashFlow: args.cashFlow,
      metrics: args.metrics,
      extractionConfidence: args.extractionConfidence,
      manualOverrides: args.manualOverrides,
      // Provenance tracking
      fieldProvenance: args.fieldProvenance,
      hasCustomTags: args.hasCustomTags,
      customTagCount: args.customTagCount,
      needsReview: args.needsReview,
      // Dimensional data strategy tracking
      dimensionalStrategy: args.dimensionalStrategy,
      dimensionalFactsEncountered: args.dimensionalFactsEncountered,
      dimensionalFactsSkipped: args.dimensionalFactsSkipped,
      hasSegmentData: args.hasSegmentData,
      // Taxonomy version provenance
      taxonomyProvenance: args.taxonomyProvenance,
      createdAt: Date.now(),
    });

    return { id, action: "created" };
  },
});

/* ------------------------------------------------------------------ */
/* INGESTION ACTIONS                                                   */
/* ------------------------------------------------------------------ */

/**
 * Ingest financial fundamentals from SEC EDGAR for a specific period
 */
export const ingestFundamentals = internalAction({
  args: {
    ticker: v.string(),
    fiscalYear: v.number(),
    fiscalQuarter: v.optional(v.number()),
    forceRefresh: v.optional(v.boolean()),
  },
  returns: v.object({
    ok: v.boolean(),
    ticker: v.string(),
    cik: v.optional(v.string()),
    fundamentalsId: v.optional(v.id("financialFundamentals")),
    fiscalYear: v.number(),
    fiscalQuarter: v.optional(v.number()),
    action: v.optional(v.union(v.literal("created"), v.literal("updated"), v.literal("skipped"))),
    error: v.optional(v.string()),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx, args): Promise<IngestionResult> => {
    const tickerUpper = args.ticker.toUpperCase();
    const warnings: string[] = [];

    // Check if already exists (unless force refresh)
    if (!args.forceRefresh) {
      const existingId = await ctx.runQuery(
        internal.domains.financial.fundamentals.checkFundamentalsExist,
        {
          ticker: tickerUpper,
          fiscalYear: args.fiscalYear,
          fiscalQuarter: args.fiscalQuarter,
        }
      );

      if (existingId) {
        return {
          ok: true,
          ticker: tickerUpper,
          fundamentalsId: existingId,
          fiscalYear: args.fiscalYear,
          fiscalQuarter: args.fiscalQuarter,
          action: "skipped",
          warnings: ["Record already exists, use forceRefresh to update"],
        };
      }
    }

    // Fetch company facts from SEC
    const factsResult = await ctx.runAction(
      internal.domains.financial.secEdgarClient.fetchCompanyFacts,
      { ticker: tickerUpper }
    );

    if (!factsResult.ok) {
      return {
        ok: false,
        ticker: tickerUpper,
        fiscalYear: args.fiscalYear,
        fiscalQuarter: args.fiscalQuarter,
        error: factsResult.error,
        warnings,
      };
    }

    // Parse XBRL data
    const extractionResult = extractFundamentals(
      factsResult.facts,
      tickerUpper,
      factsResult.cik!,
      args.fiscalYear,
      args.fiscalQuarter
    );

    if (!extractionResult.ok) {
      return {
        ok: false,
        ticker: tickerUpper,
        cik: factsResult.cik,
        fiscalYear: args.fiscalYear,
        fiscalQuarter: args.fiscalQuarter,
        error: extractionResult.error,
        warnings: extractionResult.warnings,
      };
    }

    const fundamentals = extractionResult.fundamentals!;
    warnings.push(...extractionResult.warnings);

    // Build XBRL URL
    const xbrlUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${factsResult.cik!.padStart(10, "0")}.json`;

    // Upsert to database
    const upsertResult = await ctx.runMutation(
      internal.domains.financial.fundamentals.upsertFundamentals,
      {
        ticker: fundamentals.ticker,
        cik: fundamentals.cik,
        fiscalYear: fundamentals.fiscalYear,
        fiscalQuarter: fundamentals.fiscalQuarter,
        sourceArtifactId: factsResult.artifactId!,
        xbrlUrl,
        filingDate: fundamentals.filingDate,
        incomeStatement: fundamentals.incomeStatement,
        balanceSheet: fundamentals.balanceSheet,
        cashFlow: fundamentals.cashFlow,
        metrics: fundamentals.metrics,
        extractionConfidence: fundamentals.extractionConfidence,
        // Provenance tracking
        fieldProvenance: fundamentals.fieldProvenance,
        hasCustomTags: fundamentals.hasCustomTags,
        customTagCount: fundamentals.customTagCount,
        needsReview: fundamentals.needsReview,
        // Dimensional data strategy tracking
        dimensionalStrategy: fundamentals.dimensionalStrategy,
        dimensionalFactsEncountered: fundamentals.dimensionalFactsEncountered,
        dimensionalFactsSkipped: fundamentals.dimensionalFactsSkipped,
        hasSegmentData: fundamentals.hasSegmentData,
      }
    );

    return {
      ok: true,
      ticker: tickerUpper,
      cik: factsResult.cik,
      fundamentalsId: upsertResult.id,
      fiscalYear: args.fiscalYear,
      fiscalQuarter: args.fiscalQuarter,
      action: upsertResult.action,
      warnings,
    };
  },
});

/**
 * Batch ingest historical fundamentals for a ticker
 */
export const ingestHistoricalFundamentals = internalAction({
  args: {
    ticker: v.string(),
    yearsBack: v.optional(v.number()),  // Default: 5 years
    includeQuarterly: v.optional(v.boolean()),  // Default: false
  },
  returns: v.object({
    ok: v.boolean(),
    ticker: v.string(),
    results: v.array(
      v.object({
        fiscalYear: v.number(),
        fiscalQuarter: v.optional(v.number()),
        action: v.optional(v.string()),
        error: v.optional(v.string()),
      })
    ),
    summary: v.object({
      total: v.number(),
      created: v.number(),
      updated: v.number(),
      skipped: v.number(),
      failed: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const tickerUpper = args.ticker.toUpperCase();
    const yearsBack = args.yearsBack ?? 5;
    const includeQuarterly = args.includeQuarterly ?? false;

    // Fetch company facts to get available years
    const factsResult = await ctx.runAction(
      internal.domains.financial.secEdgarClient.fetchCompanyFacts,
      { ticker: tickerUpper }
    );

    if (!factsResult.ok) {
      return {
        ok: false,
        ticker: tickerUpper,
        results: [],
        summary: { total: 0, created: 0, updated: 0, skipped: 0, failed: 1 },
      };
    }

    // Get available fiscal years
    const availableYears = listAvailableFiscalYears(factsResult.facts);
    const currentYear = new Date().getFullYear();
    const targetYears = availableYears.filter(
      (y) => y >= currentYear - yearsBack && y <= currentYear
    );

    const results: Array<{
      fiscalYear: number;
      fiscalQuarter?: number;
      action?: string;
      error?: string;
    }> = [];
    const summary = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0 };

    // Process each year
    for (const fiscalYear of targetYears) {
      // Annual data
      summary.total++;
      const annualResult = await ctx.runAction(
        internal.domains.financial.fundamentals.ingestFundamentals,
        { ticker: tickerUpper, fiscalYear }
      );

      results.push({
        fiscalYear,
        action: annualResult.action,
        error: annualResult.error,
      });

      if (annualResult.ok) {
        if (annualResult.action === "created") summary.created++;
        else if (annualResult.action === "updated") summary.updated++;
        else summary.skipped++;
      } else {
        summary.failed++;
      }

      // Quarterly data if requested
      if (includeQuarterly) {
        const availableQuarters = listAvailableQuarters(factsResult.facts, fiscalYear);

        for (const quarter of availableQuarters) {
          summary.total++;
          const quarterlyResult = await ctx.runAction(
            internal.domains.financial.fundamentals.ingestFundamentals,
            { ticker: tickerUpper, fiscalYear, fiscalQuarter: quarter }
          );

          results.push({
            fiscalYear,
            fiscalQuarter: quarter,
            action: quarterlyResult.action,
            error: quarterlyResult.error,
          });

          if (quarterlyResult.ok) {
            if (quarterlyResult.action === "created") summary.created++;
            else if (quarterlyResult.action === "updated") summary.updated++;
            else summary.skipped++;
          } else {
            summary.failed++;
          }
        }
      }
    }

    return {
      ok: summary.failed === 0,
      ticker: tickerUpper,
      results,
      summary,
    };
  },
});

/**
 * Get available fiscal periods for a ticker from SEC data
 */
export const getAvailablePeriods = internalAction({
  args: {
    ticker: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    ticker: v.string(),
    cik: v.optional(v.string()),
    entityName: v.optional(v.string()),
    availableYears: v.array(v.number()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const tickerUpper = args.ticker.toUpperCase();

    // Fetch company facts
    const factsResult = await ctx.runAction(
      internal.domains.financial.secEdgarClient.fetchCompanyFacts,
      { ticker: tickerUpper }
    );

    if (!factsResult.ok) {
      return {
        ok: false,
        ticker: tickerUpper,
        availableYears: [],
        error: factsResult.error,
      };
    }

    const availableYears = listAvailableFiscalYears(factsResult.facts);

    return {
      ok: true,
      ticker: tickerUpper,
      cik: factsResult.cik,
      entityName: factsResult.entityName,
      availableYears,
    };
  },
});
