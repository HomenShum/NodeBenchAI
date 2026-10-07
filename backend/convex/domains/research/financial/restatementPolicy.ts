// convex/domains/financial/restatementPolicy.ts
// Restatement Policy Governance
//
// Handles deterministic selection when multiple filings exist for the same period.
// Critical for reproducibility: ensures same inputs always produce same outputs.
//
// ============================================================================
// WHY RESTATEMENT POLICY MATTERS
// ============================================================================
//
// 1. COMPANIES RESTATE: 10-K/A, 10-Q/A filings amend prior submissions
//    - Corrections of errors
//    - Reclassifications
//    - Material misstatements
//    - Change in accounting principle
//
// 2. MULTIPLE FILINGS: Same period can have multiple filings
//    - Original 10-K filed 2024-02-15
//    - Amended 10-K/A filed 2024-03-20
//    - Which one to use?
//
// 3. DETERMINISTIC BEHAVIOR: Same inputs must produce same outputs
//    - "Latest wins" as default policy
//    - But need override capability for edge cases
//
// 4. AUDIT TRAIL: Must track which filing was used and why
//    - For reproducibility packs
//    - For regulatory compliance
//    - For debugging discrepancies
//
// ============================================================================
// POLICY: "LATEST WINS" WITH OVERRIDES
// ============================================================================
//
// Default behavior: For any ticker/period combination, use the filing with
// the most recent filedDate. This handles:
// - 10-K/A superseding 10-K
// - Corrected filings superseding original
// - Re-filed statements superseding prior versions
//
// Override mechanism: Allow explicit pinning to a specific accession number
// for cases where:
// - Latest filing has known errors
// - Analyst prefers original methodology
// - Research requires specific point-in-time data
//
// ============================================================================

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

export interface FilingInfo {
  /** SEC accession number (unique identifier) */
  accessionNumber: string;

  /** Form type (10-K, 10-K/A, 10-Q, 10-Q/A, etc.) */
  formType: string;

  /** Date filed with SEC */
  filedDate: string;

  /** Fiscal year covered */
  fiscalYear: number;

  /** Fiscal quarter (null for annual) */
  fiscalQuarter?: number;

  /** Whether this is an amendment */
  isAmendment: boolean;

  /** CIK of filer */
  cik: string;
}

export interface RestatementDecision {
  /** Ticker symbol */
  ticker: string;

  /** Period being selected for */
  fiscalYear: number;
  fiscalQuarter?: number;

  /** All available filings for this period */
  availableFilings: FilingInfo[];

  /** Selected filing accession number */
  selectedAccession: string;

  /** Selection method */
  selectionMethod: "latest_wins" | "manual_override" | "pinned";

  /** Reason for selection */
  reason: string;

  /** Whether an override is active */
  hasOverride: boolean;

  /** Override details if applicable */
  overrideInfo?: {
    pinnedAccession: string;
    reason: string;
    createdBy: string;
    createdAt: number;
    expiresAt?: number;
  };

  /** Decision timestamp */
  decidedAt: number;
}

export interface RestatementPolicyConfig {
  /** Global policy mode */
  mode: "latest_wins" | "earliest_original" | "manual_required";

  /** Whether to automatically include amendments */
  includeAmendments: boolean;

  /** Maximum age of filing to consider (days) */
  maxFilingAgeDays?: number;

  /** Form types to consider */
  allowedFormTypes: string[];
}

/* ------------------------------------------------------------------ */
/* DEFAULT POLICY CONFIGURATION                                        */
/* ------------------------------------------------------------------ */

/**
 * Default restatement policy
 * Can be overridden per-entity or globally
 */
export const DEFAULT_RESTATEMENT_POLICY: RestatementPolicyConfig = {
  mode: "latest_wins",
  includeAmendments: true,
  allowedFormTypes: ["10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A"],
};

/* ------------------------------------------------------------------ */
/* FILING DETECTION                                                    */
/* ------------------------------------------------------------------ */

/**
 * Detect if a form type is an amendment
 */
export function isAmendmentForm(formType: string): boolean {
  return formType.endsWith("/A");
}

/**
 * Get the base form type (without /A suffix)
 */
export function getBaseFormType(formType: string): string {
  return formType.replace(/\/A$/, "");
}

/**
 * Compare two filings by date (for sorting)
 */
export function compareFilingsByDate(a: FilingInfo, b: FilingInfo): number {
  return new Date(b.filedDate).getTime() - new Date(a.filedDate).getTime();
}

/**
 * Group filings by period (fiscal year + quarter)
 */
export function groupFilingsByPeriod(
  filings: FilingInfo[]
): Map<string, FilingInfo[]> {
  const groups = new Map<string, FilingInfo[]>();

  for (const filing of filings) {
    const key = `${filing.fiscalYear}-Q${filing.fiscalQuarter ?? "A"}`;
    const existing = groups.get(key) ?? [];
    existing.push(filing);
    groups.set(key, existing);
  }

  return groups;
}

/* ------------------------------------------------------------------ */
/* SELECTION LOGIC                                                     */
/* ------------------------------------------------------------------ */

/**
 * Select the best filing for a period using the configured policy
 *
 * Returns the selected filing with full decision audit trail.
 */
export function selectFiling(
  filings: FilingInfo[],
  policy: RestatementPolicyConfig = DEFAULT_RESTATEMENT_POLICY,
  override?: { pinnedAccession: string; reason: string }
): RestatementDecision & { filing: FilingInfo | null } {
  // Filter by allowed form types
  const allowedFilings = filings.filter((f) =>
    policy.allowedFormTypes.includes(f.formType) ||
    policy.allowedFormTypes.includes(getBaseFormType(f.formType))
  );

  // Filter amendments if not included
  const filteredFilings = policy.includeAmendments
    ? allowedFilings
    : allowedFilings.filter((f) => !f.isAmendment);

  // Handle empty case
  if (filteredFilings.length === 0) {
    return {
      ticker: filings[0]?.cik ?? "UNKNOWN",
      fiscalYear: filings[0]?.fiscalYear ?? 0,
      fiscalQuarter: filings[0]?.fiscalQuarter,
      availableFilings: filings,
      selectedAccession: "",
      selectionMethod: "latest_wins",
      reason: "No filings match policy criteria",
      hasOverride: false,
      decidedAt: Date.now(),
      filing: null,
    };
  }

  // Check for override
  if (override) {
    const pinnedFiling = filteredFilings.find(
      (f) => f.accessionNumber === override.pinnedAccession
    );

    if (pinnedFiling) {
      return {
        ticker: pinnedFiling.cik,
        fiscalYear: pinnedFiling.fiscalYear,
        fiscalQuarter: pinnedFiling.fiscalQuarter,
        availableFilings: filings,
        selectedAccession: pinnedFiling.accessionNumber,
        selectionMethod: "manual_override",
        reason: override.reason,
        hasOverride: true,
        overrideInfo: {
          pinnedAccession: override.pinnedAccession,
          reason: override.reason,
          createdBy: "system",
          createdAt: Date.now(),
        },
        decidedAt: Date.now(),
        filing: pinnedFiling,
      };
    }
    // Override specified but filing not found - fall through to default
  }

  // Sort by date
  const sorted = [...filteredFilings].sort(compareFilingsByDate);

  // Select based on policy mode
  let selected: FilingInfo;
  let reason: string;

  switch (policy.mode) {
    case "latest_wins":
      selected = sorted[0]; // Most recent
      reason = `Selected most recent filing (${selected.formType} filed ${selected.filedDate})`;
      break;

    case "earliest_original":
      // Find earliest non-amendment
      const originals = sorted.filter((f) => !f.isAmendment);
      selected = originals[originals.length - 1] ?? sorted[sorted.length - 1];
      reason = `Selected earliest original filing (${selected.formType} filed ${selected.filedDate})`;
      break;

    case "manual_required":
      // Return null - manual selection required
      return {
        ticker: sorted[0].cik,
        fiscalYear: sorted[0].fiscalYear,
        fiscalQuarter: sorted[0].fiscalQuarter,
        availableFilings: filings,
        selectedAccession: "",
        selectionMethod: "manual_required" as any,
        reason: "Manual selection required - multiple filings available",
        hasOverride: false,
        decidedAt: Date.now(),
        filing: null,
      };

    default:
      selected = sorted[0];
      reason = `Default selection (${selected.formType} filed ${selected.filedDate})`;
  }

  return {
    ticker: selected.cik,
    fiscalYear: selected.fiscalYear,
    fiscalQuarter: selected.fiscalQuarter,
    availableFilings: filings,
    selectedAccession: selected.accessionNumber,
    selectionMethod: "latest_wins",
    reason,
    hasOverride: false,
    decidedAt: Date.now(),
    filing: selected,
  };
}

/**
 * Detect if a restatement occurred (multiple filings for same period)
 */
export function detectRestatement(filings: FilingInfo[]): {
  hasRestatement: boolean;
  originalFiling?: FilingInfo;
  amendments: FilingInfo[];
  restatementType?: "amendment" | "correction" | "reclassification";
} {
  if (filings.length <= 1) {
    return {
      hasRestatement: false,
      amendments: [],
    };
  }

  const sorted = [...filings].sort(compareFilingsByDate);
  const amendments = sorted.filter((f) => isAmendmentForm(f.formType));
  const originals = sorted.filter((f) => !isAmendmentForm(f.formType));

  if (amendments.length === 0) {
    return {
      hasRestatement: false,
      originalFiling: originals[originals.length - 1],
      amendments: [],
    };
  }

  return {
    hasRestatement: true,
    originalFiling: originals[originals.length - 1],
    amendments,
    restatementType: "amendment",
  };
}

/* ------------------------------------------------------------------ */
/* AUDIT TRAIL                                                         */
/* ------------------------------------------------------------------ */

/**
 * Build audit trail entry for a selection decision
 */
export function buildSelectionAuditEntry(
  decision: RestatementDecision,
  context: {
    runId?: string;
    userId?: string;
    extractionJobId?: string;
  }
): {
  decisionId: string;
  timestamp: number;
  ticker: string;
  period: string;
  selectedAccession: string;
  selectionMethod: string;
  reason: string;
  availableFilingsCount: number;
  hasOverride: boolean;
  context: typeof context;
} {
  return {
    decisionId: `sel_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: Date.now(),
    ticker: decision.ticker,
    period: `FY${decision.fiscalYear}${decision.fiscalQuarter ? `Q${decision.fiscalQuarter}` : ""}`,
    selectedAccession: decision.selectedAccession,
    selectionMethod: decision.selectionMethod,
    reason: decision.reason,
    availableFilingsCount: decision.availableFilings.length,
    hasOverride: decision.hasOverride,
    context,
  };
}

/* ------------------------------------------------------------------ */
/* CONVEX QUERIES                                                      */
/* ------------------------------------------------------------------ */

/**
 * Get active overrides for a ticker
 */
export const getActiveOverrides = query({
  args: {
    ticker: v.string(),
  },
  returns: v.array(
    v.object({
      ticker: v.string(),
      fiscalYear: v.number(),
      fiscalQuarter: v.optional(v.number()),
      pinnedAccession: v.string(),
      reason: v.string(),
      createdBy: v.string(),
      createdAt: v.number(),
      expiresAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const tickerUpper = args.ticker.toUpperCase();
    const now = Date.now();

    // Query restatement overrides for this ticker
    const overrides = await ctx.db
      .query("restatementOverrides")
      .withIndex("by_ticker", (q) => q.eq("ticker", tickerUpper))
      .filter((q) =>
        q.or(
          q.eq(q.field("expiresAt"), undefined),
          q.gt(q.field("expiresAt"), now)
        )
      )
      .collect();

    return overrides.map((o) => ({
      ticker: o.ticker,
      fiscalYear: o.fiscalYear,
      fiscalQuarter: o.fiscalQuarter,
      pinnedAccession: o.pinnedAccession,
      reason: o.reason,
      createdBy: o.createdBy,
      createdAt: o.createdAt,
      expiresAt: o.expiresAt,
    }));
  },
});

/**
 * Get restatement history for a period
 */
export const getRestatementHistory = query({
  args: {
    ticker: v.string(),
    fiscalYear: v.number(),
    fiscalQuarter: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      accessionNumber: v.string(),
      formType: v.string(),
      filedDate: v.string(),
      isAmendment: v.boolean(),
      wasSelected: v.boolean(),
      selectionReason: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const tickerUpper = args.ticker.toUpperCase();

    // Get all fundamentals for this period
    const fundamentals = await ctx.db
      .query("financialFundamentals")
      .withIndex("by_ticker_period", (q) =>
        q
          .eq("ticker", tickerUpper)
          .eq("fiscalYear", args.fiscalYear)
          .eq("fiscalQuarter", args.fiscalQuarter)
      )
      .collect();

    // Get selection decisions log
    const decisions = await ctx.db
      .query("restatementDecisionLog")
      .withIndex("by_ticker_period", (q) =>
        q
          .eq("ticker", tickerUpper)
          .eq("fiscalYear", args.fiscalYear)
      )
      .filter((q) =>
        args.fiscalQuarter
          ? q.eq(q.field("fiscalQuarter"), args.fiscalQuarter)
          : q.eq(q.field("fiscalQuarter"), undefined)
      )
      .collect();

    // Build history from available data
    const history: Array<{
      accessionNumber: string;
      formType: string;
      filedDate: string;
      isAmendment: boolean;
      wasSelected: boolean;
      selectionReason?: string;
    }> = [];

    for (const f of fundamentals) {
      // Extract provenance info
      const provenance = f.fieldProvenance?.[0];
      if (provenance) {
        const decision = decisions.find(
          (d) => d.selectedAccession === provenance.accessionNumber
        );
        history.push({
          accessionNumber: provenance.accessionNumber,
          formType: provenance.formType,
          filedDate: provenance.filedDate,
          isAmendment: isAmendmentForm(provenance.formType),
          wasSelected: true,
          selectionReason: decision?.reason,
        });
      }
    }

    return history;
  },
});

/* ------------------------------------------------------------------ */
/* CONVEX MUTATIONS                                                    */
/* ------------------------------------------------------------------ */

/**
 * Create a restatement override
 */
export const createOverride = mutation({
  args: {
    ticker: v.string(),
    fiscalYear: v.number(),
    fiscalQuarter: v.optional(v.number()),
    pinnedAccession: v.string(),
    reason: v.string(),
    expiresInDays: v.optional(v.number()),
  },
  returns: v.object({
    ok: v.boolean(),
    overrideId: v.optional(v.id("restatementOverrides")),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const tickerUpper = args.ticker.toUpperCase();

    // Check for existing override
    const existing = await ctx.db
      .query("restatementOverrides")
      .withIndex("by_ticker_period", (q) =>
        q
          .eq("ticker", tickerUpper)
          .eq("fiscalYear", args.fiscalYear)
          .eq("fiscalQuarter", args.fiscalQuarter)
      )
      .first();

    if (existing) {
      // Update existing
      await ctx.db.patch(existing._id, {
        pinnedAccession: args.pinnedAccession,
        reason: args.reason,
        updatedAt: Date.now(),
        expiresAt: args.expiresInDays
          ? Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000
          : undefined,
      });
      return { ok: true, overrideId: existing._id };
    }

    // Create new override
    const id = await ctx.db.insert("restatementOverrides", {
      ticker: tickerUpper,
      fiscalYear: args.fiscalYear,
      fiscalQuarter: args.fiscalQuarter,
      pinnedAccession: args.pinnedAccession,
      reason: args.reason,
      createdBy: "system", // TODO: Get from auth context
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: args.expiresInDays
        ? Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000
        : undefined,
    });

    return { ok: true, overrideId: id };
  },
});

/**
 * Remove a restatement override
 */
export const removeOverride = mutation({
  args: {
    ticker: v.string(),
    fiscalYear: v.number(),
    fiscalQuarter: v.optional(v.number()),
  },
  returns: v.object({
    ok: v.boolean(),
    removed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const tickerUpper = args.ticker.toUpperCase();

    const existing = await ctx.db
      .query("restatementOverrides")
      .withIndex("by_ticker_period", (q) =>
        q
          .eq("ticker", tickerUpper)
          .eq("fiscalYear", args.fiscalYear)
          .eq("fiscalQuarter", args.fiscalQuarter)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { ok: true, removed: true };
    }

    return { ok: true, removed: false };
  },
});

/**
 * Log a restatement selection decision (internal)
 */
export const logSelectionDecision = internalMutation({
  args: {
    ticker: v.string(),
    fiscalYear: v.number(),
    fiscalQuarter: v.optional(v.number()),
    selectedAccession: v.string(),
    selectionMethod: v.string(),
    reason: v.string(),
    availableAccessions: v.array(v.string()),
    hasOverride: v.boolean(),
    runId: v.optional(v.string()),
  },
  returns: v.id("restatementDecisionLog"),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("restatementDecisionLog", {
      ticker: args.ticker.toUpperCase(),
      fiscalYear: args.fiscalYear,
      fiscalQuarter: args.fiscalQuarter,
      selectedAccession: args.selectedAccession,
      selectionMethod: args.selectionMethod,
      reason: args.reason,
      availableAccessions: args.availableAccessions,
      hasOverride: args.hasOverride,
      runId: args.runId,
      decidedAt: Date.now(),
    });

    return id;
  },
});

/* ------------------------------------------------------------------ */
/* INTERNAL QUERIES                                                    */
/* ------------------------------------------------------------------ */

/**
 * Get override for a specific period (internal)
 */
export const getOverrideForPeriod = internalQuery({
  args: {
    ticker: v.string(),
    fiscalYear: v.number(),
    fiscalQuarter: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      pinnedAccession: v.string(),
      reason: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const tickerUpper = args.ticker.toUpperCase();
    const now = Date.now();

    const override = await ctx.db
      .query("restatementOverrides")
      .withIndex("by_ticker_period", (q) =>
        q
          .eq("ticker", tickerUpper)
          .eq("fiscalYear", args.fiscalYear)
          .eq("fiscalQuarter", args.fiscalQuarter)
      )
      .filter((q) =>
        q.or(
          q.eq(q.field("expiresAt"), undefined),
          q.gt(q.field("expiresAt"), now)
        )
      )
      .first();

    if (!override) return null;

    return {
      pinnedAccession: override.pinnedAccession,
      reason: override.reason,
    };
  },
});

/* ------------------------------------------------------------------ */
/* POLICY VALIDATION                                                   */
/* ------------------------------------------------------------------ */

/**
 * Validate restatement policy configuration
 */
export function validatePolicyConfig(
  config: Partial<RestatementPolicyConfig>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.mode && !["latest_wins", "earliest_original", "manual_required"].includes(config.mode)) {
    errors.push(`Invalid mode: ${config.mode}`);
  }

  if (config.allowedFormTypes && config.allowedFormTypes.length === 0) {
    errors.push("allowedFormTypes cannot be empty");
  }

  if (config.maxFilingAgeDays !== undefined && config.maxFilingAgeDays < 0) {
    errors.push("maxFilingAgeDays must be non-negative");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Merge policy config with defaults
 */
export function mergeWithDefaultPolicy(
  overrides: Partial<RestatementPolicyConfig>
): RestatementPolicyConfig {
  return {
    ...DEFAULT_RESTATEMENT_POLICY,
    ...overrides,
  };
}
