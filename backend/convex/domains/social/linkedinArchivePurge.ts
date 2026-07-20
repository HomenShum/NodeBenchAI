"use node";

/**
 * LinkedIn Archive Purge
 *
 * Deletes obvious test-only archive rows.
 * Strict rules: only deletes rows that match high-confidence test markers.
 * Default dryRun=true.
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

type ArchiveRow = {
  _id: Id<"linkedinPostArchive">;
  dateString: string;
  persona: string;
  postType: string;
  content: string;
  postId?: string;
  postUrl?: string;
  metadata?: any;
  postedAt: number;
};

function isObviouslyTestRow(row: ArchiveRow): { isTest: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (row.persona === "TEST") reasons.push("persona=TEST");
  if (row.dateString >= "2090-01-01") reasons.push("future_date");
  if ((row.postUrl ?? "").includes("example.com")) reasons.push("example.com");
  if (/^\s*TEST POST\s*$/i.test(row.content.trim())) reasons.push("content=TEST POST");
  if (/^\s*t\d+\s*$/i.test(String(row.postId ?? "").trim())) reasons.push("postId=tN");

  // Strict: require persona=TEST OR at least 2 other signals.
  const strict = reasons.includes("persona=TEST") || reasons.length >= 2;
  return { isTest: strict, reasons };
}

export const scanAndPurgeObviousTestRows = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    maxScan: v.optional(v.number()),
    maxDeletes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const maxScan = Math.min(Math.max(args.maxScan ?? 10000, 1), 200000);
    const maxDeletes = Math.min(Math.max(args.maxDeletes ?? 200, 1), 5000);

    const rows = await ctx.runQuery(internal.domains.social.linkedinArchiveQueries.getArchivedPosts, {
      limit: Math.min(maxScan, 500),
      dedupe: false,
    });

    // For large archives, page in until maxScan.
    const candidates: Array<{ id: Id<"linkedinPostArchive">; postId?: string; dateString: string; persona: string; postType: string; reasons: string[] }> = [];
    let scanned = 0;

    let cursor: string | undefined = undefined;
    while (scanned < maxScan) {
      const pageRes = scanned === 0 ? rows : await ctx.runQuery(internal.domains.social.linkedinArchiveQueries.getArchivedPosts, {
        limit: 500,
        cursor,
        dedupe: false,
      });

      const page = pageRes.posts as any as ArchiveRow[];
      if (page.length === 0) break;

      for (const row of page) {
        scanned++;
        const decision = isObviouslyTestRow(row);
        if (!decision.isTest) continue;
        candidates.push({
          id: row._id,
          postId: row.postId,
          dateString: row.dateString,
          persona: row.persona,
          postType: row.postType,
          reasons: decision.reasons,
        });
        if (candidates.length >= maxDeletes) break;
      }

      if (candidates.length >= maxDeletes) break;
      if (!pageRes.hasMore) break;
      cursor = typeof pageRes.nextCursor === "string" ? pageRes.nextCursor : undefined;
      if (!cursor) break;
    }

    const ids = candidates.map((c) => c.id);
    const wouldDelete = ids.length;

    if (!dryRun && wouldDelete > 0) {
      const result = await ctx.runMutation(internal.domains.social.linkedinArchivePurgeMutations.deleteArchiveRowsByIds, { ids });
      return { dryRun, scanned, wouldDelete, deleted: result.deleted, candidates };
    }

    return { dryRun, scanned, wouldDelete, deleted: 0, candidates };
  },
});

