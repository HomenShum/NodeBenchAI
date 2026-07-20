/**
 * Daily LinkedIn Post - Mutations
 *
 * Non-Node.js mutations for logging LinkedIn posts.
 * Called by the Node.js actions in dailyLinkedInPost.ts.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const findArchiveMatchForDatePersonaType = internalQuery({
  args: {
    dateString: v.string(),
    persona: v.string(),
    postType: v.string(),
    content: v.optional(v.string()),
    part: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    anyForType: boolean;
    exactMatchId: Id<"linkedinPostArchive"> | null;
  }> => {
    const posts = await ctx.db
      .query("linkedinPostArchive")
      .withIndex("by_date_persona", (q) =>
        q.eq("dateString", args.dateString).eq("persona", args.persona),
      )
      .collect();

    const sameType = posts.filter((p) => p.postType === args.postType);
    const anyForType = sameType.length > 0;

    let exactMatchId: Id<"linkedinPostArchive"> | null = null;
    if (typeof args.content === "string" && args.content.length > 0) {
      const exact = sameType.find((p) => {
        if (p.content !== args.content) return false;
        if (typeof args.part === "number") {
          const meta: any = p.metadata;
          return typeof meta?.part === "number" && meta.part === args.part;
        }
        return true;
      });
      exactMatchId = exact ? (exact._id as Id<"linkedinPostArchive">) : null;
    }

    return { anyForType, exactMatchId };
  },
});

/**
 * Log a successful LinkedIn post to the archive table
 */
export const logLinkedInPost = internalMutation({
  args: {
    dateString: v.string(),
    persona: v.string(),
    postId: v.optional(v.string()),
    postUrl: v.optional(v.string()),
    content: v.string(),
    factCheckCount: v.number(),
    postType: v.optional(v.string()),
    metadata: v.optional(v.any()),
    target: v.optional(v.union(v.literal("personal"), v.literal("organization"))),
  },
  handler: async (ctx, args) => {
    console.log(`[dailyLinkedInPost] Post logged: ${args.dateString}, persona=${args.persona}, postId=${args.postId}, facts=${args.factCheckCount}`);

    const postType = args.postType || "daily_digest";
    const metaPart = typeof (args.metadata as any)?.part === "number" ? (args.metadata as any).part : undefined;

    const existing = await ctx.db
      .query("linkedinPostArchive")
      .withIndex("by_date_persona", (q) =>
        q.eq("dateString", args.dateString).eq("persona", args.persona),
      )
      .collect();

    const dup = existing.find((p) => {
      if (p.postType !== postType) return false;
      if (p.content !== args.content) return false;
      if (typeof metaPart === "number") {
        const meta: any = p.metadata;
        return typeof meta?.part === "number" && meta.part === metaPart;
      }
      return true;
    });

    if (dup) {
      await ctx.db.patch(dup._id, {
        postId: args.postId ?? dup.postId,
        postUrl: args.postUrl ?? dup.postUrl,
        factCheckCount: args.factCheckCount ?? dup.factCheckCount,
        metadata: args.metadata ?? dup.metadata,
      });
      return { deduped: true, id: dup._id };
    }

    // Persist to linkedinPostArchive table
    const id = await ctx.db.insert("linkedinPostArchive", {
      dateString: args.dateString,
      persona: args.persona,
      postType,
      content: args.content,
      postId: args.postId,
      postUrl: args.postUrl,
      factCheckCount: args.factCheckCount,
      metadata: args.metadata,
      postedAt: Date.now(),
      target: args.target ?? "organization",
    });

    // Optionally update the digestCache to mark as sent to LinkedIn
    const cached = await ctx.db
      .query("digestCache")
      .withIndex("by_date_persona", (q) =>
        q.eq("dateString", args.dateString).eq("persona", args.persona)
      )
      .first();

    if (cached) {
      // We could add sentToLinkedIn field if needed in the future
    }

    return { deduped: false, id };
  },
});

/**
 * Clear all linkedinPostArchive data (for re-backfill).
 * Run via: npx convex run workflows/dailyLinkedInPostMutations:clearArchive "{confirm:\"DELETE_ALL_LINKEDIN_POST_ARCHIVE\"}"
 */
export const clearArchive = internalMutation({
  args: {
    confirm: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.confirm !== "DELETE_ALL_LINKEDIN_POST_ARCHIVE") {
      throw new Error("Refusing clearArchive without confirm=DELETE_ALL_LINKEDIN_POST_ARCHIVE");
    }
    const all = await ctx.db
      .query("linkedinPostArchive")
      .collect();
    for (const doc of all) {
      await ctx.db.delete(doc._id);
    }
    console.log(`[clearArchive] Deleted ${all.length} archive entries`);
    return { deleted: all.length };
  },
});

/**
 * Backfill linkedinPostArchive from existing data sources.
 * Uses FULL rawText from digestCache and full metadata from specialized tables.
 *
 * Run via: npx convex run workflows/dailyLinkedInPostMutations:backfillArchive
 */
export const backfillArchive = internalMutation({
  args: {},
  handler: async (ctx) => {
    let inserted = 0;

    // 1. Backfill from digestCache - use rawText (full LLM output, 4-5K chars)
    const digests = await ctx.db
      .query("digestCache")
      .order("desc")
      .take(500);

    for (const digest of digests) {
      // Use rawText which is the full LLM response
      const content = digest.rawText || "";
      if (!content || content.length < 50) continue;

      const existing = await ctx.db
        .query("linkedinPostArchive")
        .withIndex("by_date_persona", (q) =>
          q.eq("dateString", digest.dateString).eq("persona", digest.persona),
        )
        .collect();
      const dup = existing.find((p) => p.postType === "daily_digest" && p.content === content);
      if (dup) continue;

      await ctx.db.insert("linkedinPostArchive", {
        dateString: digest.dateString,
        persona: digest.persona,
        postType: "daily_digest",
        content,
        postedAt: digest.createdAt,
        factCheckCount: digest.digest?.factCheckFindings?.length,
        metadata: {
          source: "backfill_digestCache",
          model: digest.model,
          storyCount: digest.digest?.storyCount,
          topSources: digest.digest?.topSources,
          topCategories: digest.digest?.topCategories,
          leadStoryTitle: digest.digest?.leadStory?.title,
          signalCount: digest.digest?.signals?.length,
          entityCount: digest.digest?.entitySpotlight?.length,
        },
      });
      inserted++;
    }

    // 2. Backfill from linkedinFundingPosts - reconstruct from all available fields
    const fundingPosts = await ctx.db
      .query("linkedinFundingPosts")
      .order("desc")
      .take(500);

    for (const fp of fundingPosts) {
      const parts: string[] = [];
      parts.push(`Funding: ${fp.companyName} -- ${fp.roundType}`);
      if (fp.amountRaw) parts.push(`Amount: ${fp.amountRaw}`);
      if (fp.sector) parts.push(`Sector: ${fp.sector}`);
      if (fp.sectorCategory) parts.push(`Category: ${fp.sectorCategory}`);
      if (fp.contentSummary) parts.push(`\n${fp.contentSummary}`);
      // Include claims if available (these contain the actual post content detail)
      const claims = (fp as Record<string, unknown>).claims;
      if (Array.isArray(claims) && claims.length > 0) {
        parts.push("\nKey Claims:");
        for (const c of claims) {
          if (typeof c === "object" && c && "text" in c) {
            parts.push(`- ${(c as { text: string }).text}`);
          }
        }
      }

      const dateString = new Date(fp.postedAt).toISOString().split("T")[0];
      const content = parts.join("\n");
      const existing = await ctx.db
        .query("linkedinPostArchive")
        .withIndex("by_date_persona", (q) =>
          q.eq("dateString", dateString).eq("persona", "FUNDING"),
        )
        .collect();
      const dup = existing.find((p) => p.postType === "funding_brief" && p.content === content);
      if (dup) continue;

      await ctx.db.insert("linkedinPostArchive", {
        dateString,
        persona: "FUNDING",
        postType: "funding_brief",
        content,
        postId: fp.postUrn,
        postUrl: fp.postUrl,
        postedAt: fp.postedAt,
        metadata: {
          source: "backfill_fundingPosts",
          companyName: fp.companyName,
          roundType: fp.roundType,
          sector: fp.sector,
          amountRaw: fp.amountRaw,
        },
      });
      inserted++;
    }

    // 3. Backfill from linkedinFdaPosts
    const fdaPosts = await ctx.db
      .query("linkedinFdaPosts")
      .order("desc")
      .take(500);

    for (const fp of fdaPosts) {
      const parts: string[] = [];
      parts.push(`FDA ${fp.eventType}: ${fp.productName || fp.companyName}`);
      if (fp.companyName && fp.productName) parts.push(`Company: ${fp.companyName}`);
      if (fp.description) parts.push(`\n${fp.description}`);
      if (fp.referenceNumber) parts.push(`Reference: ${fp.referenceNumber}`);
      if (fp.decisionDate) parts.push(`Decision Date: ${fp.decisionDate}`);
      if (fp.sourceUrl) parts.push(`Source: ${fp.sourceUrl}`);

      const dateString = new Date(fp.postedAt).toISOString().split("T")[0];
      const content = parts.join("\n");
      const existing = await ctx.db
        .query("linkedinPostArchive")
        .withIndex("by_date_persona", (q) => q.eq("dateString", dateString).eq("persona", "FDA"))
        .collect();
      const dup = existing.find((p) => p.postType === "fda" && p.content === content);
      if (dup) continue;

      await ctx.db.insert("linkedinPostArchive", {
        dateString,
        persona: "FDA",
        postType: "fda",
        content,
        postId: fp.postUrn,
        postUrl: fp.postUrl,
        postedAt: fp.postedAt,
        metadata: {
          source: "backfill_fdaPosts",
          companyName: fp.companyName,
          productName: fp.productName,
          eventType: fp.eventType,
        },
      });
      inserted++;
    }

    // 4. Backfill from linkedinClinicalPosts
    const clinicalPosts = await ctx.db
      .query("linkedinClinicalPosts")
      .order("desc")
      .take(500);

    for (const cp of clinicalPosts) {
      const parts: string[] = [];
      parts.push(`Clinical Trial: ${cp.drugName} [${cp.companyName}]`);
      parts.push(`Phase: ${cp.trialPhase}`);
      if (cp.indication) parts.push(`Indication: ${cp.indication}`);
      if (cp.milestone) parts.push(`Milestone: ${cp.milestone}`);
      if (cp.nctId) parts.push(`NCT ID: ${cp.nctId}`);
      if (cp.milestoneDate) parts.push(`Date: ${cp.milestoneDate}`);
      if (cp.sourceUrl) parts.push(`Source: ${cp.sourceUrl}`);

      const dateString = new Date(cp.postedAt).toISOString().split("T")[0];
      const content = parts.join("\n");
      const existing = await ctx.db
        .query("linkedinPostArchive")
        .withIndex("by_date_persona", (q) =>
          q.eq("dateString", dateString).eq("persona", "CLINICAL"),
        )
        .collect();
      const dup = existing.find((p) => p.postType === "clinical" && p.content === content);
      if (dup) continue;

      await ctx.db.insert("linkedinPostArchive", {
        dateString,
        persona: "CLINICAL",
        postType: "clinical",
        content,
        postId: cp.postUrn,
        postUrl: cp.postUrl,
        postedAt: cp.postedAt,
        metadata: {
          source: "backfill_clinicalPosts",
          companyName: cp.companyName,
          drugName: cp.drugName,
          trialPhase: cp.trialPhase,
        },
      });
      inserted++;
    }

    // 5. Backfill from linkedinResearchPosts
    const researchPosts = await ctx.db
      .query("linkedinResearchPosts")
      .order("desc")
      .take(500);

    for (const rp of researchPosts) {
      const parts: string[] = [];
      parts.push(`Research: ${rp.paperTitle}`);
      if (rp.authors) parts.push(`Authors: ${rp.authors}`);
      if (rp.journal) parts.push(`Journal: ${rp.journal}`);
      if (rp.publishDate) parts.push(`Published: ${rp.publishDate}`);
      if (rp.abstract) parts.push(`\n${rp.abstract}`);
      if (rp.doi) parts.push(`DOI: ${rp.doi}`);
      if (rp.sourceUrl) parts.push(`Source: ${rp.sourceUrl}`);
      if (rp.citationCount) parts.push(`Citations: ${rp.citationCount}`);

      const dateString = new Date(rp.postedAt).toISOString().split("T")[0];
      const content = parts.join("\n");
      const existing = await ctx.db
        .query("linkedinPostArchive")
        .withIndex("by_date_persona", (q) =>
          q.eq("dateString", dateString).eq("persona", "RESEARCH"),
        )
        .collect();
      const dup = existing.find((p) => p.postType === "research" && p.content === content);
      if (dup) continue;

      await ctx.db.insert("linkedinPostArchive", {
        dateString,
        persona: "RESEARCH",
        postType: "research",
        content,
        postId: rp.postUrn,
        postUrl: rp.postUrl,
        postedAt: rp.postedAt,
        metadata: {
          source: "backfill_researchPosts",
          entityName: rp.entityName,
          paperTitle: rp.paperTitle,
          journal: rp.journal,
        },
      });
      inserted++;
    }

    // 6. Backfill from linkedinMaPosts
    const maPosts = await ctx.db
      .query("linkedinMaPosts")
      .order("desc")
      .take(500);

    for (const mp of maPosts) {
      const parts: string[] = [];
      parts.push(`M&A: ${mp.acquirerName} acquires ${mp.targetName}`);
      parts.push(`Deal Type: ${mp.dealType}`);
      if (mp.dealValue) parts.push(`Value: ${mp.dealValue}`);
      if (mp.sector) parts.push(`Sector: ${mp.sector}`);
      if (mp.sectorCategory) parts.push(`Category: ${mp.sectorCategory}`);
      parts.push(`Status: ${mp.status}`);
      if (mp.announcedDate) parts.push(`Announced: ${mp.announcedDate}`);
      if (mp.closedDate) parts.push(`Closed: ${mp.closedDate}`);
      if (mp.sourceUrl) parts.push(`Source: ${mp.sourceUrl}`);

      const dateString = new Date(mp.postedAt).toISOString().split("T")[0];
      const content = parts.join("\n");
      const existing = await ctx.db
        .query("linkedinPostArchive")
        .withIndex("by_date_persona", (q) =>
          q.eq("dateString", dateString).eq("persona", "MA"),
        )
        .collect();
      const dup = existing.find((p) => p.postType === "ma" && p.content === content);
      if (dup) continue;

      await ctx.db.insert("linkedinPostArchive", {
        dateString,
        persona: "MA",
        postType: "ma",
        content,
        postId: mp.postUrn,
        postUrl: mp.postUrl,
        postedAt: mp.postedAt,
        metadata: {
          source: "backfill_maPosts",
          acquirerName: mp.acquirerName,
          targetName: mp.targetName,
          dealType: mp.dealType,
        },
      });
      inserted++;
    }

    console.log(`[backfill] Inserted ${inserted} archive entries`);
    return { inserted, message: `Backfilled ${inserted} posts` };
  },
});

/**
 * Backfill target field on existing archive records.
 * Sets target="personal" on all rows where target is undefined.
 */
export const backfillTargetField = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db
      .query("linkedinPostArchive")
      .collect();
    let patched = 0;
    for (const doc of all) {
      if (!doc.target) {
        await ctx.db.patch(doc._id, { target: "personal" });
        patched++;
      }
    }
    console.log(`[backfillTargetField] Patched ${patched}/${all.length} archive entries with target="personal"`);
    return { patched, total: all.length };
  },
});

/**
 * Log a post that was held by the engagement quality gate.
 */
export const logHeldPost = internalMutation({
  args: {
    dateString: v.string(),
    persona: v.string(),
    postType: v.string(),
    content: v.string(),
    target: v.string(),
    failures: v.array(v.string()),
    softWarnings: v.array(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("linkedinHeldPosts", {
      dateString: args.dateString,
      persona: args.persona,
      postType: args.postType,
      content: args.content,
      target: args.target,
      failures: args.failures,
      softWarnings: args.softWarnings,
      heldAt: Date.now(),
      status: "held",
      metadata: args.metadata,
    });
    console.log(`[logHeldPost] Held post ${id}: ${args.failures.length} failures, ${args.softWarnings.length} warnings`);
    return { id, failures: args.failures.length };
  },
});

/**
 * List held posts (for review).
 */
export const listHeldPosts = internalQuery({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    let query = ctx.db
      .query("linkedinHeldPosts")
      .withIndex("by_status")
      .order("desc");

    const all = await query.take(limit);
    if (args.status) {
      return all.filter(p => p.status === args.status);
    }
    return all;
  },
});

/**
 * Get all personal archive posts for backfill into content queue.
 * Returns posts where target is undefined (pre-migration) or "personal".
 */
export const getPersonalArchivePosts = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 500;

    // Fetch all archive posts and filter for personal ones
    // Pre-migration posts have target=undefined, post-migration personal have target="personal"
    const allPosts = await ctx.db
      .query("linkedinPostArchive")
      .withIndex("by_postedAt")
      .order("desc")
      .take(limit);

    return allPosts.filter(
      (p) => p.target === undefined || p.target === "personal",
    );
  },
});
