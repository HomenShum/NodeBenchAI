/**
 * Fix incorrect CORTI → Ivo AI funding attribution
 *
 * Issue: Ivo AI's $55M Series B funding was incorrectly attributed to CORTI company
 * Source: https://siliconangle.com/2026/01/20/ivo-ai-raises-55m-scale-contract-intelligence-legal-teams/
 *
 * This script:
 * 1. Finds the incorrect CORTI funding record(s)
 * 2. Searches for correct Ivo AI records
 * 3. Deletes or updates the incorrect CORTI record
 * 4. Creates the correct Ivo AI funding record
 */

import { internalMutation, internalQuery } from "../backend/convex/_generated/server";
import { v } from "convex/values";

/**
 * Step 1: Search for the problematic records
 */
export const searchProblemRecords = internalQuery({
  args: {},
  handler: async (ctx) => {
    console.log("Searching for CORTI and Ivo AI funding records...");

    // Search for CORTI records (should NOT have $55M Series B)
    const cortiRecords = await ctx.db
      .query("fundingEvents")
      .withIndex("by_company", (q) => q.eq("companyName", "CORTI"))
      .collect();

    // Search for variations of CORTI
    const cortiVariations = await ctx.db
      .query("fundingEvents")
      .withSearchIndex("search_company", (q) => q.search("companyName", "CORTI"))
      .take(10);

    // Search for Ivo AI records (SHOULD have $55M Series B)
    const ivoAIRecords = await ctx.db
      .query("fundingEvents")
      .withIndex("by_company", (q) => q.eq("companyName", "Ivo AI"))
      .collect();

    // Search for variations
    const ivoAIVariations = await ctx.db
      .query("fundingEvents")
      .withSearchIndex("search_company", (q) => q.search("companyName", "Ivo AI"))
      .take(10);

    // Also check entityContexts table
    const cortiEntity = await ctx.db
      .query("entityContexts")
      .withSearchIndex("search_name", (q) => q.search("name", "CORTI"))
      .take(5);

    const ivoAIEntity = await ctx.db
      .query("entityContexts")
      .withSearchIndex("search_name", (q) => q.search("name", "Ivo AI"))
      .take(5);

    // Check LinkedIn posts that might have been created
    const linkedInPosts = await ctx.db
      .query("linkedinFundingPosts")
      .withIndex("by_company_posted", (q) => q.eq("companyName", "CORTI"))
      .collect();

    const ivoAILinkedInPosts = await ctx.db
      .query("linkedinFundingPosts")
      .withIndex("by_company_posted", (q) => q.eq("companyName", "Ivo AI"))
      .collect();

    return {
      corti: {
        fundingEvents: cortiRecords.map(r => ({
          id: r._id,
          companyName: r.companyName,
          roundType: r.roundType,
          amount: r.amountRaw,
          amountUsd: r.amountUsd,
          announcedAt: new Date(r.announcedAt).toISOString(),
          sources: r.sourceUrls,
          confidence: r.confidence,
          verificationStatus: r.verificationStatus,
        })),
        variations: cortiVariations.map(r => ({
          id: r._id,
          companyName: r.companyName,
          roundType: r.roundType,
          amount: r.amountRaw,
        })),
        entities: cortiEntity.map(e => ({
          id: e._id,
          name: e.name,
          type: e.entityType,
        })),
        linkedInPosts: linkedInPosts.map(p => ({
          id: p._id,
          companyName: p.companyName,
          roundType: p.roundType,
          postUrl: p.postUrl,
          postedAt: new Date(p.postedAt).toISOString(),
        })),
      },
      ivoAI: {
        fundingEvents: ivoAIRecords.map(r => ({
          id: r._id,
          companyName: r.companyName,
          roundType: r.roundType,
          amount: r.amountRaw,
          amountUsd: r.amountUsd,
          announcedAt: new Date(r.announcedAt).toISOString(),
          sources: r.sourceUrls,
          confidence: r.confidence,
          verificationStatus: r.verificationStatus,
        })),
        variations: ivoAIVariations.map(r => ({
          id: r._id,
          companyName: r.companyName,
          roundType: r.roundType,
          amount: r.amountRaw,
        })),
        entities: ivoAIEntity.map(e => ({
          id: e._id,
          name: e.name,
          type: e.entityType,
        })),
        linkedInPosts: ivoAILinkedInPosts.map(p => ({
          id: p._id,
          companyName: p.companyName,
          roundType: p.roundType,
          postUrl: p.postUrl,
          postedAt: new Date(p.postedAt).toISOString(),
        })),
      },
    };
  },
});

/**
 * Step 2: Delete incorrect CORTI funding record
 */
export const deleteIncorrectCortiRecord = internalMutation({
  args: {
    fundingEventId: v.id("fundingEvents"),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.fundingEventId);
    if (!record) {
      throw new Error(`Funding event not found: ${args.fundingEventId}`);
    }

    console.log(`Deleting incorrect CORTI funding record: ${args.fundingEventId}`);
    console.log(`  Company: ${record.companyName}`);
    console.log(`  Round: ${record.roundType}`);
    console.log(`  Amount: ${record.amountRaw}`);

    await ctx.db.delete(args.fundingEventId);

    return { success: true, deleted: record };
  },
});

/**
 * Step 3: Update incorrect CORTI record to correct Ivo AI data
 */
export const updateCortiToIvoAI = internalMutation({
  args: {
    fundingEventId: v.id("fundingEvents"),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.fundingEventId);
    if (!record) {
      throw new Error(`Funding event not found: ${args.fundingEventId}`);
    }

    console.log(`Updating CORTI record to Ivo AI: ${args.fundingEventId}`);

    // Correct data from the source article
    await ctx.db.patch(args.fundingEventId, {
      companyName: "Ivo AI",
      roundType: "series-b",
      amountRaw: "$55M",
      amountUsd: 55_000_000,
      announcedAt: new Date("2026-01-20").getTime(),
      leadInvestors: ["Blackbird"],
      coInvestors: ["Costanoa Ventures", "Fika Ventures", "Uncork Capital", "GD1", "Icehouse Ventures"],
      sector: "Legal Tech",
      description: "Contract intelligence software for legal teams",
      sourceUrls: ["https://siliconangle.com/2026/01/20/ivo-ai-raises-55m-scale-contract-intelligence-legal-teams/"],
      sourceNames: ["SiliconANGLE"],
      confidence: 0.95,
      verificationStatus: "verified",
      updatedAt: Date.now(),
    });

    console.log(`Successfully updated record to Ivo AI`);

    return { success: true, updatedId: args.fundingEventId };
  },
});

/**
 * Step 4: Create correct Ivo AI funding record
 */
export const createIvoAIRecord = internalMutation({
  args: {},
  handler: async (ctx) => {
    console.log("Creating correct Ivo AI funding record...");

    // Check if already exists
    const existing = await ctx.db
      .query("fundingEvents")
      .withIndex("by_company", (q) =>
        q.eq("companyName", "Ivo AI").eq("roundType", "series-b")
      )
      .first();

    if (existing) {
      console.log(`Ivo AI Series B record already exists: ${existing._id}`);
      return { success: true, alreadyExists: true, recordId: existing._id };
    }

    // Create new record with correct data
    const eventId = await ctx.db.insert("fundingEvents", {
      companyName: "Ivo AI",
      roundType: "series-b",
      amountRaw: "$55M",
      amountUsd: 55_000_000,
      announcedAt: new Date("2026-01-20").getTime(),
      leadInvestors: ["Blackbird"],
      coInvestors: ["Costanoa Ventures", "Fika Ventures", "Uncork Capital", "GD1", "Icehouse Ventures"],
      sourceUrls: ["https://siliconangle.com/2026/01/20/ivo-ai-raises-55m-scale-contract-intelligence-legal-teams/"],
      sourceNames: ["SiliconANGLE"],
      confidence: 0.95,
      verificationStatus: "verified",
      sector: "Legal Tech",
      location: "Australia",
      description: "Contract intelligence software for legal teams. Platform automates contract reviews and analysis, helping companies accelerate this process while reducing manual labor.",
      valuation: "$355M",
      ttlDays: 90,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    console.log(`Created correct Ivo AI funding record: ${eventId}`);

    return { success: true, recordId: eventId };
  },
});

/**
 * Step 5: Delete incorrect LinkedIn posts
 */
export const deleteIncorrectLinkedInPost = internalMutation({
  args: {
    postId: v.id("linkedinFundingPosts"),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) {
      throw new Error(`LinkedIn post not found: ${args.postId}`);
    }

    console.log(`Deleting incorrect LinkedIn post: ${args.postId}`);
    console.log(`  Company: ${post.companyName}`);
    console.log(`  Post URL: ${post.postUrl}`);

    await ctx.db.delete(args.postId);

    return { success: true, deleted: post };
  },
});

/**
 * Step 6: Review recent funding posts for similar errors
 */
export const reviewRecentPosts = internalQuery({
  args: {
    hoursBack: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const hoursBack = args.hoursBack ?? 168; // Default 7 days
    const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;

    console.log(`Reviewing funding posts from the last ${hoursBack} hours...`);

    // Get all recent funding events
    const recentEvents = await ctx.db
      .query("fundingEvents")
      .withIndex("by_created", (q) => q.gt("createdAt", cutoff))
      .collect();

    // Look for suspicious patterns:
    // 1. Companies with very short names (might be misextracted)
    // 2. Companies with uppercase names (might be acronyms)
    // 3. Large amounts (>$20M) with low confidence
    // 4. Series B+ rounds with single source

    const suspicious = recentEvents.filter(event => {
      const shortName = event.companyName.length < 4;
      const allCaps = event.companyName === event.companyName.toUpperCase();
      const largeAmountLowConfidence =
        event.amountUsd && event.amountUsd > 20_000_000 && event.confidence < 0.7;
      const lateStageSingleSource =
        ["series-b", "series-c", "series-d-plus", "growth"].includes(event.roundType) &&
        event.verificationStatus === "single-source";

      return shortName || allCaps || largeAmountLowConfidence || lateStageSingleSource;
    });

    return {
      totalReviewed: recentEvents.length,
      suspiciousCount: suspicious.length,
      suspicious: suspicious.map(event => ({
        id: event._id,
        companyName: event.companyName,
        roundType: event.roundType,
        amount: event.amountRaw,
        amountUsd: event.amountUsd,
        confidence: event.confidence,
        verificationStatus: event.verificationStatus,
        sources: event.sourceUrls,
        reasons: [
          event.companyName.length < 4 && "Short name (< 4 chars)",
          event.companyName === event.companyName.toUpperCase() && "All caps (acronym?)",
          event.amountUsd && event.amountUsd > 20_000_000 && event.confidence < 0.7 && "Large amount + low confidence",
          ["series-b", "series-c", "series-d-plus", "growth"].includes(event.roundType) &&
            event.verificationStatus === "single-source" && "Late stage + single source",
        ].filter(Boolean),
      })),
    };
  },
});
