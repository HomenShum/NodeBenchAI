import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

export const getArchiveRowById = internalQuery({
  args: {
    id: v.id("linkedinPostArchive"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Finds the latest archive row that represents a cleanup announcement.
 * Used as a gate before destructive cleanup runs.
 */
export const getLatestCleanupAnnouncement = internalQuery({
  args: {
    tag: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("linkedinPostArchive")
      .withIndex("by_postedAt")
      .order("desc")
      .take(5000);

    for (const row of rows) {
      if (row.postType !== "maintenance_notice") continue;
      const meta: any = row.metadata;
      if (meta?.tag !== args.tag) continue;
      return row;
    }

    return null;
  },
});
