/**
 * LinkedIn Archive Edits - Mutations
 *
 * Keeps Convex archive rows consistent with LinkedIn edits.
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

export const patchArchiveRowContent = internalMutation({
  args: {
    archiveRowId: v.id("linkedinPostArchive"),
    content: v.string(),
    metadataPatch: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.archiveRowId);
    if (!existing) return { ok: false, error: "Archive row not found" };

    const nextMeta = args.metadataPatch
      ? { ...(existing as any).metadata, ...(args.metadataPatch as any) }
      : (existing as any).metadata;

    await ctx.db.patch(args.archiveRowId, {
      content: args.content,
      metadata: nextMeta,
    });

    return { ok: true };
  },
});

