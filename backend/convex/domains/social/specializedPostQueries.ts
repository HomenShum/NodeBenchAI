/**
 * Specialized Post Queries - Timeline & History Functions
 *
 * Provides historical data lookups for specialized LinkedIn posts:
 * 1. FDA regulatory history - Previous clearances, approvals, recalls
 * 2. Clinical trial progression - Phase history for drugs/companies
 * 3. Research publication history - Prior papers by company/researcher
 * 4. M&A activity history - Serial acquirer patterns
 *
 * These queries enable rich timeline displays in LinkedIn posts:
 * - "Previously cleared 3 510(k)s, now PMA approved"
 * - "Phase 1 completed Dec 2024, now entering Phase 3"
 * - "Third acquisition this year..."
 */

import { v } from "convex/values";
import {
  query,
  internalQuery,
  internalMutation,
} from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize company/entity name for matching.
 */
function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[,.]$/g, "")
    .replace(/\s+(inc|corp|llc|ltd|co|company|technologies|technology|labs|ai|io)\.?$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Categorize sector into broad categories.
 */
function categorizeSector(sector: string | undefined): string {
  if (!sector) return "other";
  const s = sector.toLowerCase();

  if (s.includes("health") || s.includes("bio") || s.includes("med") || s.includes("pharma") || s.includes("drug") || s.includes("clinical")) {
    return "healthcare";
  }
  if (s.includes("fintech") || s.includes("banking") || s.includes("payment") || s.includes("insur") || s.includes("wealth") || s.includes("lending")) {
    return "fintech";
  }
  if (s.includes("ai") || s.includes("ml") || s.includes("machine learning") || s.includes("nlp") || s.includes("computer vision")) {
    return "ai_ml";
  }
  if (s.includes("enterprise") || s.includes("saas") || s.includes("b2b") || s.includes("devtool") || s.includes("dev tool")) {
    return "enterprise";
  }
  if (s.includes("consumer") || s.includes("commerce") || s.includes("retail") || s.includes("marketplace")) {
    return "consumer";
  }
  if (s.includes("deeptech") || s.includes("robotics") || s.includes("quantum") || s.includes("semiconductor") || s.includes("space") || s.includes("defense")) {
    return "deeptech";
  }
  if (s.includes("climate") || s.includes("energy") || s.includes("cleantech") || s.includes("green")) {
    return "climate";
  }
  return "technology";
}

// ═══════════════════════════════════════════════════════════════════════════
// FDA REGULATORY HISTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get FDA regulatory history for a company from DD cache.
 * Returns all FDA events (510k, PMA, BLA, NDA, recalls) for timeline display.
 */
export const getCompanyFdaHistory = internalQuery({
  args: {
    companyName: v.string(),
    lookbackDays: v.optional(v.number()), // Default: unlimited (full history)
  },
  returns: v.array(
    v.object({
      eventType: v.string(),
      productName: v.optional(v.string()),
      referenceNumber: v.string(),
      decisionDate: v.optional(v.string()),
      status: v.string(),
      sourceUrl: v.optional(v.string()),
      cachedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const normalized = normalizeEntityName(args.companyName);
    const cutoffTime = args.lookbackDays
      ? Date.now() - args.lookbackDays * 24 * 60 * 60 * 1000
      : 0;

    // Query FDA cache from DD playbook
    const fdaEvents = await ctx.db
      .query("investorPlaybookFdaCache")
      .withIndex("by_entity", (q) => q.eq("entityName", args.companyName))
      .filter((q) => q.gte(q.field("cachedAt"), cutoffTime))
      .order("desc")
      .collect();

    // Also try normalized name
    if (fdaEvents.length === 0) {
      const normalizedEvents = await ctx.db
        .query("investorPlaybookFdaCache")
        .filter((q) =>
          q.and(
            q.gte(q.field("cachedAt"), cutoffTime),
            q.eq(q.field("entityName"), normalized)
          )
        )
        .order("desc")
        .collect();
      fdaEvents.push(...normalizedEvents);
    }

    return fdaEvents.map((e) => ({
      eventType: e.verificationType,
      productName: e.deviceName,
      referenceNumber: e.referenceNumber,
      decisionDate: e.decisionDate,
      status: e.status,
      sourceUrl: e.sourceUrl,
      cachedAt: e.cachedAt,
    }));
  },
});

/**
 * Batch get FDA history for multiple companies.
 */
export const batchGetFdaHistory = internalQuery({
  args: {
    companyNames: v.array(v.string()),
    lookbackDays: v.optional(v.number()),
  },
  returns: v.any(), // Map<string, FdaHistoryEntry[]>
  handler: async (ctx, args) => {
    const results: Record<
      string,
      Array<{
        eventType: string;
        productName?: string;
        referenceNumber: string;
        decisionDate?: string;
        status: string;
        sourceUrl?: string;
        cachedAt: number;
      }>
    > = {};

    for (const companyName of args.companyNames) {
      const history = await ctx.runQuery(
        // @ts-ignore - internal reference
        "domains/social/specializedPostQueries:getCompanyFdaHistory",
        { companyName, lookbackDays: args.lookbackDays }
      );
      results[companyName] = history;
    }

    return results;
  },
});

/**
 * Get recent FDA events from DD cache for LinkedIn post discovery.
 * Used by specialized post workflow to find new FDA events to post about.
 */
export const getRecentFdaFromCache = internalQuery({
  args: {
    cutoffTime: v.number(), // Epoch ms
    sectors: v.optional(v.array(v.string())),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    // Query FDA cache for recent events
    const fdaEvents = await ctx.db
      .query("investorPlaybookFdaCache")
      .withIndex("by_cachedAt")
      .filter((q) => q.gte(q.field("cachedAt"), args.cutoffTime))
      .order("desc")
      .collect();

    // Filter by sector if specified (based on entity lookup)
    if (args.sectors && args.sectors.length > 0) {
      // For now, return all events - sector filtering would require entity lookup
      // This can be enhanced later by joining with entityContexts
      console.log(`[getRecentFdaFromCache] Sector filter requested but not yet implemented: ${args.sectors.join(", ")}`);
    }

    return fdaEvents;
  },
});

/**
 * Get previous FDA posts for a company (what we've already posted).
 */
export const getCompanyFdaPostHistory = internalQuery({
  args: {
    companyName: v.string(),
    lookbackDays: v.optional(v.number()), // Default: 365 days
  },
  returns: v.array(
    v.object({
      eventType: v.string(),
      productName: v.string(),
      referenceNumber: v.optional(v.string()),
      decisionDate: v.string(),
      postUrl: v.string(),
      postedAt: v.number(),
      progressionType: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const normalized = normalizeEntityName(args.companyName);
    const lookbackMs = (args.lookbackDays ?? 365) * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - lookbackMs;

    const previousPosts = await ctx.db
      .query("linkedinFdaPosts")
      .withIndex("by_company", (q) => q.eq("companyNameNormalized", normalized))
      .filter((q) => q.gte(q.field("postedAt"), cutoffTime))
      .order("asc")
      .collect();

    return previousPosts.map((p) => ({
      eventType: p.eventType,
      productName: p.productName,
      referenceNumber: p.referenceNumber,
      decisionDate: p.decisionDate,
      postUrl: p.postUrl,
      postedAt: p.postedAt,
      progressionType: p.progressionType,
    }));
  },
});

/**
 * Record an FDA post for dedup tracking.
 */
export const recordFdaPost = internalMutation({
  args: {
    companyName: v.string(),
    eventType: v.union(
      v.literal("510k"),
      v.literal("pma"),
      v.literal("bla"),
      v.literal("nda"),
      v.literal("recall"),
      v.literal("adverse_event")
    ),
    productName: v.string(),
    referenceNumber: v.optional(v.string()),
    decisionDate: v.string(),
    description: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sector: v.optional(v.string()),
    postUrn: v.string(),
    postUrl: v.string(),
    postPart: v.optional(v.number()),
    totalParts: v.optional(v.number()),
    previousPostId: v.optional(v.id("linkedinFdaPosts")),
    progressionType: v.optional(
      v.union(
        v.literal("new"),
        v.literal("additional-clearance"),
        v.literal("major-upgrade"),
        v.literal("recall-follow-up")
      )
    ),
  },
  returns: v.id("linkedinFdaPosts"),
  handler: async (ctx, args) => {
    const normalized = normalizeEntityName(args.companyName);
    const sectorCategory = categorizeSector(args.sector);

    return await ctx.db.insert("linkedinFdaPosts", {
      companyNameNormalized: normalized,
      companyName: args.companyName,
      eventType: args.eventType,
      productName: args.productName,
      referenceNumber: args.referenceNumber,
      decisionDate: args.decisionDate,
      description: args.description,
      sourceUrl: args.sourceUrl,
      sector: args.sector,
      sectorCategory,
      postUrn: args.postUrn,
      postUrl: args.postUrl,
      postPart: args.postPart,
      totalParts: args.totalParts,
      previousPostId: args.previousPostId,
      progressionType: args.progressionType ?? "new",
      postedAt: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CLINICAL TRIAL HISTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get clinical trial history for a company/drug.
 * Returns phase progression timeline.
 */
export const getCompanyClinicalHistory = internalQuery({
  args: {
    companyName: v.string(),
    drugName: v.optional(v.string()),
    lookbackDays: v.optional(v.number()), // Default: 730 days (2 years for trial history)
  },
  returns: v.array(
    v.object({
      drugName: v.optional(v.string()),
      trialPhase: v.string(),
      milestone: v.string(),
      milestoneDate: v.string(),
      nctId: v.optional(v.string()),
      indication: v.optional(v.string()),
      postUrl: v.string(),
      postedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const normalized = normalizeEntityName(args.companyName);
    const lookbackMs = (args.lookbackDays ?? 730) * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - lookbackMs;

    let query = ctx.db
      .query("linkedinClinicalPosts")
      .withIndex("by_company", (q) => q.eq("companyNameNormalized", normalized))
      .filter((q) => q.gte(q.field("postedAt"), cutoffTime));

    const posts = await query.order("asc").collect();

    // Filter by drug name if specified
    const filteredPosts = args.drugName
      ? posts.filter(
          (p) =>
            p.drugName?.toLowerCase() === args.drugName?.toLowerCase()
        )
      : posts;

    return filteredPosts.map((p) => ({
      drugName: p.drugName,
      trialPhase: p.trialPhase,
      milestone: p.milestone,
      milestoneDate: p.milestoneDate,
      nctId: p.nctId,
      indication: p.indication,
      postUrl: p.postUrl,
      postedAt: p.postedAt,
    }));
  },
});

/**
 * Record a clinical trial post for tracking.
 */
export const recordClinicalPost = internalMutation({
  args: {
    companyName: v.string(),
    drugName: v.optional(v.string()),
    trialPhase: v.union(
      v.literal("preclinical"),
      v.literal("phase-1"),
      v.literal("phase-1-2"),
      v.literal("phase-2"),
      v.literal("phase-2-3"),
      v.literal("phase-3"),
      v.literal("nda-submitted"),
      v.literal("approved")
    ),
    nctId: v.optional(v.string()),
    indication: v.optional(v.string()),
    milestone: v.string(),
    milestoneDate: v.string(),
    sourceUrl: v.optional(v.string()),
    sector: v.optional(v.string()),
    postUrn: v.string(),
    postUrl: v.string(),
    postPart: v.optional(v.number()),
    totalParts: v.optional(v.number()),
    previousPostId: v.optional(v.id("linkedinClinicalPosts")),
    previousPhase: v.optional(v.string()),
    progressionType: v.optional(
      v.union(
        v.literal("new"),
        v.literal("phase-advance"),
        v.literal("results-announced"),
        v.literal("regulatory-milestone"),
        v.literal("approval")
      )
    ),
  },
  returns: v.id("linkedinClinicalPosts"),
  handler: async (ctx, args) => {
    const normalized = normalizeEntityName(args.companyName);
    const sectorCategory = categorizeSector(args.sector);

    return await ctx.db.insert("linkedinClinicalPosts", {
      companyNameNormalized: normalized,
      companyName: args.companyName,
      drugName: args.drugName,
      trialPhase: args.trialPhase,
      nctId: args.nctId,
      indication: args.indication,
      milestone: args.milestone,
      milestoneDate: args.milestoneDate,
      sourceUrl: args.sourceUrl,
      sector: args.sector,
      sectorCategory,
      postUrn: args.postUrn,
      postUrl: args.postUrl,
      postPart: args.postPart,
      totalParts: args.totalParts,
      previousPostId: args.previousPostId,
      previousPhase: args.previousPhase,
      progressionType: args.progressionType ?? "new",
      postedAt: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// RESEARCH PUBLICATION HISTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get research publication history for an entity (company/researcher).
 */
export const getEntityResearchHistory = internalQuery({
  args: {
    entityName: v.string(),
    entityType: v.optional(
      v.union(v.literal("company"), v.literal("researcher"), v.literal("institution"))
    ),
    lookbackDays: v.optional(v.number()), // Default: 730 days
  },
  returns: v.array(
    v.object({
      paperTitle: v.string(),
      authors: v.array(v.string()),
      journal: v.optional(v.string()),
      publishDate: v.string(),
      doi: v.optional(v.string()),
      citationCount: v.optional(v.number()),
      postUrl: v.string(),
      postedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const normalized = normalizeEntityName(args.entityName);
    const lookbackMs = (args.lookbackDays ?? 730) * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - lookbackMs;

    let posts = await ctx.db
      .query("linkedinResearchPosts")
      .withIndex("by_entity", (q) => q.eq("entityNameNormalized", normalized))
      .filter((q) => q.gte(q.field("postedAt"), cutoffTime))
      .order("asc")
      .collect();

    // Filter by entity type if specified
    if (args.entityType) {
      posts = posts.filter((p) => p.entityType === args.entityType);
    }

    return posts.map((p) => ({
      paperTitle: p.paperTitle,
      authors: p.authors,
      journal: p.journal,
      publishDate: p.publishDate,
      doi: p.doi,
      citationCount: p.citationCount,
      postUrl: p.postUrl,
      postedAt: p.postedAt,
    }));
  },
});

/**
 * Record a research post for tracking.
 */
export const recordResearchPost = internalMutation({
  args: {
    entityName: v.string(),
    entityType: v.union(v.literal("company"), v.literal("researcher"), v.literal("institution")),
    paperTitle: v.string(),
    authors: v.array(v.string()),
    journal: v.optional(v.string()),
    publishDate: v.string(),
    doi: v.optional(v.string()),
    arxivId: v.optional(v.string()),
    abstract: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    citationCount: v.optional(v.number()),
    impactScore: v.optional(v.number()),
    sector: v.optional(v.string()),
    researchArea: v.optional(v.string()),
    postUrn: v.string(),
    postUrl: v.string(),
    postPart: v.optional(v.number()),
    totalParts: v.optional(v.number()),
    previousPostId: v.optional(v.id("linkedinResearchPosts")),
    progressionType: v.optional(
      v.union(
        v.literal("new"),
        v.literal("follow-up-study"),
        v.literal("breakthrough"),
        v.literal("citation-milestone")
      )
    ),
  },
  returns: v.id("linkedinResearchPosts"),
  handler: async (ctx, args) => {
    const normalized = normalizeEntityName(args.entityName);
    const sectorCategory = categorizeSector(args.sector);

    return await ctx.db.insert("linkedinResearchPosts", {
      entityNameNormalized: normalized,
      entityName: args.entityName,
      entityType: args.entityType,
      paperTitle: args.paperTitle,
      authors: args.authors,
      journal: args.journal,
      publishDate: args.publishDate,
      doi: args.doi,
      arxivId: args.arxivId,
      abstract: args.abstract,
      sourceUrl: args.sourceUrl,
      citationCount: args.citationCount,
      impactScore: args.impactScore,
      sector: args.sector,
      sectorCategory,
      researchArea: args.researchArea,
      postUrn: args.postUrn,
      postUrl: args.postUrl,
      postPart: args.postPart,
      totalParts: args.totalParts,
      previousPostId: args.previousPostId,
      progressionType: args.progressionType ?? "new",
      postedAt: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// M&A ACTIVITY HISTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get recent M&A-related SEC filings from DD cache.
 * Filters for 8-K, SC 13D, S-4 filings that typically indicate M&A activity.
 */
export const getRecentMaFromCache = internalQuery({
  args: {
    cutoffTime: v.number(), // Epoch ms
    sectors: v.optional(v.array(v.string())),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    // M&A-related form types
    const maFormTypes = ["8-K", "SC 13D", "SC 13D/A", "S-4", "S-4/A", "SC TO-T", "SC TO-T/A"];

    // Query SEC cache for recent filings
    const secFilings = await ctx.db
      .query("investorPlaybookSecCache")
      .withIndex("by_cachedAt")
      .filter((q) => q.gte(q.field("cachedAt"), args.cutoffTime))
      .order("desc")
      .collect();

    // Filter for M&A-related form types
    const maFilings = secFilings.filter((f) => maFormTypes.includes(f.formType));

    // For 8-K filings, we need to check if they're M&A related
    // Common 8-K items for M&A: 1.01 (material definitive agreement), 2.01 (acquisition/disposition)
    const filteredFilings = maFilings.filter((f) => {
      if (f.formType !== "8-K") return true; // Non-8K M&A forms are always relevant

      // Check parsedData for M&A keywords
      if (f.parsedData) {
        const dataStr = JSON.stringify(f.parsedData).toLowerCase();
        const maKeywords = [
          "acquisition", "acquire", "merger", "merge",
          "purchase agreement", "asset purchase",
          "stock purchase", "share purchase",
          "definitive agreement", "business combination",
          "tender offer", "takeover",
        ];
        return maKeywords.some((kw) => dataStr.includes(kw));
      }
      return false;
    });

    console.log(`[getRecentMaFromCache] Found ${filteredFilings.length} M&A-related filings from ${secFilings.length} total`);
    return filteredFilings;
  },
});

/**
 * Get M&A history for a company (as acquirer).
 * Returns acquisition pattern for serial acquirers.
 */
export const getAcquirerMaHistory = internalQuery({
  args: {
    acquirerName: v.string(),
    lookbackDays: v.optional(v.number()), // Default: 730 days
  },
  returns: v.array(
    v.object({
      targetName: v.string(),
      dealType: v.string(),
      dealValue: v.optional(v.string()),
      announcedDate: v.string(),
      status: v.string(),
      postUrl: v.string(),
      postedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const normalized = normalizeEntityName(args.acquirerName);
    const lookbackMs = (args.lookbackDays ?? 730) * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - lookbackMs;

    const posts = await ctx.db
      .query("linkedinMaPosts")
      .withIndex("by_acquirer", (q) => q.eq("acquirerNameNormalized", normalized))
      .filter((q) => q.gte(q.field("postedAt"), cutoffTime))
      .order("asc")
      .collect();

    return posts.map((p) => ({
      targetName: p.targetName,
      dealType: p.dealType,
      dealValue: p.dealValue,
      announcedDate: p.announcedDate,
      status: p.status,
      postUrl: p.postUrl,
      postedAt: p.postedAt,
    }));
  },
});

/**
 * Get M&A history for a target company.
 * Returns the target's journey to acquisition.
 */
export const getTargetMaHistory = internalQuery({
  args: {
    targetName: v.string(),
    lookbackDays: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      acquirerName: v.string(),
      dealType: v.string(),
      dealValue: v.optional(v.string()),
      announcedDate: v.string(),
      status: v.string(),
      postUrl: v.string(),
      postedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const normalized = normalizeEntityName(args.targetName);
    const lookbackMs = (args.lookbackDays ?? 730) * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - lookbackMs;

    const posts = await ctx.db
      .query("linkedinMaPosts")
      .withIndex("by_target", (q) => q.eq("targetNameNormalized", normalized))
      .filter((q) => q.gte(q.field("postedAt"), cutoffTime))
      .order("asc")
      .collect();

    return posts.map((p) => ({
      acquirerName: p.acquirerName,
      dealType: p.dealType,
      dealValue: p.dealValue,
      announcedDate: p.announcedDate,
      status: p.status,
      postUrl: p.postUrl,
      postedAt: p.postedAt,
    }));
  },
});

/**
 * Record an M&A post for tracking.
 */
export const recordMaPost = internalMutation({
  args: {
    acquirerName: v.string(),
    targetName: v.string(),
    dealType: v.union(
      v.literal("acquisition"),
      v.literal("merger"),
      v.literal("strategic-investment"),
      v.literal("spin-off"),
      v.literal("divestiture")
    ),
    dealValue: v.optional(v.string()),
    dealValueUsd: v.optional(v.number()),
    announcedDate: v.string(),
    closedDate: v.optional(v.string()),
    status: v.union(
      v.literal("announced"),
      v.literal("pending"),
      v.literal("closed"),
      v.literal("terminated")
    ),
    sourceUrl: v.optional(v.string()),
    sector: v.optional(v.string()),
    postUrn: v.string(),
    postUrl: v.string(),
    postPart: v.optional(v.number()),
    totalParts: v.optional(v.number()),
    previousPostId: v.optional(v.id("linkedinMaPosts")),
    acquirerDealCount: v.optional(v.number()),
    progressionType: v.optional(
      v.union(
        v.literal("new"),
        v.literal("serial-acquirer"),
        v.literal("deal-update"),
        v.literal("target-history")
      )
    ),
  },
  returns: v.id("linkedinMaPosts"),
  handler: async (ctx, args) => {
    const acquirerNormalized = normalizeEntityName(args.acquirerName);
    const targetNormalized = normalizeEntityName(args.targetName);
    const sectorCategory = categorizeSector(args.sector);

    return await ctx.db.insert("linkedinMaPosts", {
      acquirerNameNormalized: acquirerNormalized,
      acquirerName: args.acquirerName,
      targetNameNormalized: targetNormalized,
      targetName: args.targetName,
      dealType: args.dealType,
      dealValue: args.dealValue,
      dealValueUsd: args.dealValueUsd,
      announcedDate: args.announcedDate,
      closedDate: args.closedDate,
      status: args.status,
      sourceUrl: args.sourceUrl,
      sector: args.sector,
      sectorCategory,
      postUrn: args.postUrn,
      postUrl: args.postUrl,
      postPart: args.postPart,
      totalParts: args.totalParts,
      previousPostId: args.previousPostId,
      acquirerDealCount: args.acquirerDealCount,
      progressionType: args.progressionType ?? "new",
      postedAt: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// COMBINED COMPANY TIMELINE - All events for a company
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get complete company timeline across all event types.
 * Combines funding, FDA, clinical, research, and M&A history.
 */
export const getCompanyFullTimeline = internalQuery({
  args: {
    companyName: v.string(),
    lookbackDays: v.optional(v.number()), // Default: 730 days
  },
  returns: v.object({
    funding: v.array(v.any()),
    fda: v.array(v.any()),
    clinical: v.array(v.any()),
    research: v.array(v.any()),
    maAsAcquirer: v.array(v.any()),
    maAsTarget: v.array(v.any()),
  }),
  handler: async (ctx, args) => {
    const normalized = normalizeEntityName(args.companyName);
    const lookbackMs = (args.lookbackDays ?? 730) * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - lookbackMs;

    // Fetch funding history from linkedinFundingPosts
    const fundingPosts = await ctx.db
      .query("linkedinFundingPosts")
      .withIndex("by_company", (q) => q.eq("companyNameNormalized", normalized))
      .filter((q) => q.gte(q.field("postedAt"), cutoffTime))
      .order("asc")
      .collect();

    // Fetch FDA history
    const fdaPosts = await ctx.db
      .query("linkedinFdaPosts")
      .withIndex("by_company", (q) => q.eq("companyNameNormalized", normalized))
      .filter((q) => q.gte(q.field("postedAt"), cutoffTime))
      .order("asc")
      .collect();

    // Fetch clinical history
    const clinicalPosts = await ctx.db
      .query("linkedinClinicalPosts")
      .withIndex("by_company", (q) => q.eq("companyNameNormalized", normalized))
      .filter((q) => q.gte(q.field("postedAt"), cutoffTime))
      .order("asc")
      .collect();

    // Fetch research history
    const researchPosts = await ctx.db
      .query("linkedinResearchPosts")
      .withIndex("by_entity", (q) => q.eq("entityNameNormalized", normalized))
      .filter((q) => q.gte(q.field("postedAt"), cutoffTime))
      .order("asc")
      .collect();

    // Fetch M&A as acquirer
    const maAsAcquirer = await ctx.db
      .query("linkedinMaPosts")
      .withIndex("by_acquirer", (q) => q.eq("acquirerNameNormalized", normalized))
      .filter((q) => q.gte(q.field("postedAt"), cutoffTime))
      .order("asc")
      .collect();

    // Fetch M&A as target
    const maAsTarget = await ctx.db
      .query("linkedinMaPosts")
      .withIndex("by_target", (q) => q.eq("targetNameNormalized", normalized))
      .filter((q) => q.gte(q.field("postedAt"), cutoffTime))
      .order("asc")
      .collect();

    return {
      funding: fundingPosts.map((p) => ({
        type: "funding",
        roundType: p.roundType,
        amount: p.amountRaw,
        postUrl: p.postUrl,
        postedAt: p.postedAt,
      })),
      fda: fdaPosts.map((p) => ({
        type: "fda",
        eventType: p.eventType,
        productName: p.productName,
        decisionDate: p.decisionDate,
        postUrl: p.postUrl,
        postedAt: p.postedAt,
      })),
      clinical: clinicalPosts.map((p) => ({
        type: "clinical",
        drugName: p.drugName,
        trialPhase: p.trialPhase,
        milestone: p.milestone,
        postUrl: p.postUrl,
        postedAt: p.postedAt,
      })),
      research: researchPosts.map((p) => ({
        type: "research",
        paperTitle: p.paperTitle,
        journal: p.journal,
        publishDate: p.publishDate,
        postUrl: p.postUrl,
        postedAt: p.postedAt,
      })),
      maAsAcquirer: maAsAcquirer.map((p) => ({
        type: "ma_acquirer",
        targetName: p.targetName,
        dealType: p.dealType,
        dealValue: p.dealValue,
        postUrl: p.postUrl,
        postedAt: p.postedAt,
      })),
      maAsTarget: maAsTarget.map((p) => ({
        type: "ma_target",
        acquirerName: p.acquirerName,
        dealType: p.dealType,
        dealValue: p.dealValue,
        postUrl: p.postUrl,
        postedAt: p.postedAt,
      })),
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC QUERIES - For UI/debugging
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get recent specialized posts for debugging.
 */
export const getRecentSpecializedPosts = query({
  args: {
    postType: v.union(
      v.literal("fda"),
      v.literal("clinical"),
      v.literal("research"),
      v.literal("ma")
    ),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    switch (args.postType) {
      case "fda":
        return await ctx.db
          .query("linkedinFdaPosts")
          .withIndex("by_postedAt")
          .order("desc")
          .take(limit);
      case "clinical":
        return await ctx.db
          .query("linkedinClinicalPosts")
          .withIndex("by_postedAt")
          .order("desc")
          .take(limit);
      case "research":
        return await ctx.db
          .query("linkedinResearchPosts")
          .withIndex("by_postedAt")
          .order("desc")
          .take(limit);
      case "ma":
        return await ctx.db
          .query("linkedinMaPosts")
          .withIndex("by_postedAt")
          .order("desc")
          .take(limit);
    }
  },
});
