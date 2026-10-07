/**
 * Investor Playbook Mutations
 *
 * Database operations for storing and retrieving playbook results.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../../../_generated/server";
import { Doc } from "../../../../_generated/dataModel";

// ============================================================================
// INTERNAL MUTATIONS
// ============================================================================

/**
 * Store playbook result in database
 */
export const storePlaybookResult = internalMutation({
  args: {
    entityName: v.string(),
    entityType: v.union(v.literal("company"), v.literal("fund"), v.literal("person")),
    synthesis: v.any(),
    userId: v.id("users"),
    ddJobId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const synthesis = args.synthesis;

    const resultId = await ctx.db.insert("investorPlaybookResults", {
      jobId: args.ddJobId,
      entityName: args.entityName,
      entityType: args.entityType,
      overallRisk: synthesis.overallRisk,
      recommendation: synthesis.recommendation,
      shouldDisengage: synthesis.shouldDisengage,
      verificationScores: synthesis.verificationScores,
      discrepancyCount: synthesis.discrepancies.length,
      criticalDiscrepancies: synthesis.discrepancies.filter(
        (d: any) => d.severity === "critical"
      ).length,
      stopRulesTriggered: synthesis.stopRules
        .filter((r: any) => r.triggered)
        .map((r: any) => r.rule),
      conditions: synthesis.conditions,
      requiredResolutions: synthesis.requiredResolutions,
      branchesExecuted: synthesis.branchesExecuted,
      executionTimeMs: synthesis.executionTimeMs,
      fullSynthesis: synthesis,
      createdAt: Date.now(),
      userId: args.userId,
    });

    return resultId;
  },
});

/**
 * Cache entity verification result
 */
export const cacheEntityVerification = internalMutation({
  args: {
    entityName: v.string(),
    state: v.string(),
    record: v.any(),
  },
  handler: async (ctx, args) => {
    // Check if we already have a cached record
    const existing = await ctx.db
      .query("investorPlaybookEntityCache")
      .withIndex("by_entity_state", (q) =>
        q.eq("entityName", args.entityName).eq("state", args.state)
      )
      .first() as Doc<"investorPlaybookEntityCache"> | null;

    if (existing) {
      // Update existing
      await ctx.db.patch(existing._id, {
        ...args.record,
        verifiedAt: Date.now(),
      });
      return existing._id;
    }

    // Create new
    return await ctx.db.insert("investorPlaybookEntityCache", {
      entityName: args.entityName,
      state: args.state,
      ...args.record,
      verifiedAt: Date.now(),
    });
  },
});

/**
 * Cache SEC filing
 */
export const cacheSecFiling = internalMutation({
  args: {
    entityName: v.string(),
    filing: v.any(),
  },
  handler: async (ctx, args) => {
    // Check for existing by accession number
    const existing = await ctx.db
      .query("investorPlaybookSecCache")
      .filter((q) => q.eq(q.field("accessionNumber"), args.filing.accessionNumber))
      .first() as Doc<"investorPlaybookSecCache"> | null;

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("investorPlaybookSecCache", {
      entityName: args.entityName,
      cik: args.filing.cik,
      formType: args.filing.formType,
      accessionNumber: args.filing.accessionNumber,
      filingDate: args.filing.filingDate,
      filingUrl: args.filing.filingUrl,
      offeringAmount: args.filing.offeringAmount,
      intermediaryName: args.filing.intermediaryName,
      cachedAt: Date.now(),
    });
  },
});

/**
 * Cache FDA verification
 */
export const cacheFdaVerification = internalMutation({
  args: {
    entityName: v.string(),
    verification: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("investorPlaybookFdaCache")
      .filter((q) => q.eq(q.field("referenceNumber"), args.verification.referenceNumber))
      .first() as Doc<"investorPlaybookFdaCache"> | null;

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("investorPlaybookFdaCache", {
      entityName: args.entityName,
      deviceName: args.verification.deviceName,
      verificationType: args.verification.verificationType,
      referenceNumber: args.verification.referenceNumber,
      status: args.verification.status,
      decisionDate: args.verification.decisionDate,
      productCode: args.verification.productCode,
      sourceUrl: args.verification.sourceUrl,
      cachedAt: Date.now(),
    });
  },
});

/**
 * Cache patent verification
 */
export const cachePatent = internalMutation({
  args: {
    entityName: v.string(),
    patent: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("investorPlaybookPatentCache")
      .withIndex("by_patent", (q) => q.eq("patentNumber", args.patent.patentNumber))
      .first() as Doc<"investorPlaybookPatentCache"> | null;

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("investorPlaybookPatentCache", {
      entityName: args.entityName,
      patentNumber: args.patent.patentNumber,
      title: args.patent.title,
      inventors: args.patent.inventors || [],
      assignee: args.patent.assignee,
      currentAssignee: args.patent.currentAssignee,
      filingDate: args.patent.filingDate,
      issueDate: args.patent.issueDate,
      expirationDate: args.patent.expirationDate,
      patentType: args.patent.patentType,
      status: args.patent.status || "Active",
      usptoUrl: args.patent.usptoUrl,
      cachedAt: Date.now(),
    });
  },
});

/**
 * Cache FINRA portal verification
 */
export const cacheFinraPortal = internalMutation({
  args: {
    portal: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("investorPlaybookFinraCache")
      .withIndex("by_crd", (q) => q.eq("crd", args.portal.crd))
      .first() as Doc<"investorPlaybookFinraCache"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args.portal,
        verifiedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("investorPlaybookFinraCache", {
      portalName: args.portal.name,
      crd: args.portal.crd,
      secFileNumber: args.portal.secFileNumber,
      status: args.portal.status || "Active",
      registrationDate: args.portal.registrationDate,
      website: args.portal.website,
      disclosureCount: args.portal.disclosureCount,
      verifiedAt: Date.now(),
    });
  },
});

/**
 * Get cached entity verification
 */
export const getCachedEntityVerification = internalQuery({
  args: {
    entityName: v.string(),
    state: v.string(),
  },
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("investorPlaybookEntityCache")
      .withIndex("by_entity_state", (q) =>
        q.eq("entityName", args.entityName).eq("state", args.state)
      )
      .first() as Doc<"investorPlaybookEntityCache"> | null;

    // Check if cache is stale (> 30 days old)
    if (cached) {
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      if (Date.now() - cached.verifiedAt > thirtyDaysMs) {
        return null; // Cache is stale
      }
    }

    return cached;
  },
});
