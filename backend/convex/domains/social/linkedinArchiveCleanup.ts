"use node";

/**
 * LinkedIn Archive Cleanup
 *
 * One-time cleanup utilities for:
 * - Removing duplicate rows in linkedinPostArchive
 * - Optionally deleting duplicate posts on LinkedIn
 *
 * Safety:
 * - Defaults to dryRun=true
 * - Requires explicit allowLinkedInDeletes=true to call LinkedIn DELETE
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

function getDedupeKey(post: {
  dateString: string;
  persona: string;
  postType: string;
  content: string;
  metadata?: any;
}): string {
  const meta: any = post.metadata;
  const part = typeof meta?.part === "number" ? meta.part : "";
  return `${post.dateString}|${post.persona}|${post.postType}|${part}|${post.content}`;
}

export const cleanupLinkedInArchiveAndLinkedIn = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    maxScan: v.optional(v.number()),
    maxDeletes: v.optional(v.number()),
    sinceDateString: v.optional(v.string()),
    allowLinkedInDeletes: v.optional(v.boolean()),
    requireAnnouncementTag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const allowLinkedInDeletes = args.allowLinkedInDeletes ?? false;
    const requireAnnouncementTag = args.requireAnnouncementTag ?? "linkedin_archive_cleanup_notice_v1";

    if (!dryRun) {
      const announcement = await ctx.runQuery(
        internal.domains.social.linkedinArchiveMaintenanceQueries.getLatestCleanupAnnouncement,
        { tag: requireAnnouncementTag },
      );
      const hasPostUrn = typeof (announcement as any)?.postId === "string" && (announcement as any).postId.length > 0;
      if (!announcement || !hasPostUrn) {
        throw new Error(
          `Refusing destructive cleanup. Missing cleanup announcement in archive (postType=maintenance_notice, metadata.tag=${requireAnnouncementTag}) with a LinkedIn post URN.`,
        );
      }
    }

    // Always run a dry scan first so we can verify deletion candidates before mutating anything.
    const scan = await ctx.runMutation(
      internal.domains.social.linkedinArchiveCleanupMutations.cleanupArchiveDuplicates,
      {
        dryRun: true,
        maxScan: args.maxScan,
        maxDeletes: args.maxDeletes,
        sinceDateString: args.sinceDateString,
      },
    );

    if (!allowLinkedInDeletes) {
      // If caller requested real cleanup, do it after scan.
      if (!dryRun) {
        const applied = await ctx.runMutation(
          internal.domains.social.linkedinArchiveCleanupMutations.cleanupArchiveDuplicates,
          {
            dryRun: false,
            maxScan: args.maxScan,
            maxDeletes: args.maxDeletes,
            sinceDateString: args.sinceDateString,
          },
        );
        return { ...applied, linkedInDeletes: { attempted: 0, succeeded: 0, failed: 0, results: [] } };
      }

      return { ...scan, linkedInDeletes: { attempted: 0, succeeded: 0, failed: 0, results: [] } };
    }

    const postUrns = (scan.linkedInPostUrnsToDelete ?? []).filter((u: any) => typeof u === "string");
    if (postUrns.length === 0) {
      if (!dryRun) {
        const applied = await ctx.runMutation(
          internal.domains.social.linkedinArchiveCleanupMutations.cleanupArchiveDuplicates,
          {
            dryRun: false,
            maxScan: args.maxScan,
            maxDeletes: args.maxDeletes,
            sinceDateString: args.sinceDateString,
          },
        );
        return { ...applied, linkedInDeletes: { attempted: 0, succeeded: 0, failed: 0, results: [] } };
      }
      return { ...scan, linkedInDeletes: { attempted: 0, succeeded: 0, failed: 0, results: [] } };
    }

    const linkedInDeletes = await ctx.runAction(internal.domains.social.linkedinPosting.deletePosts, {
      postUrns,
      dryRun,
      maxDeletes: args.maxDeletes,
    });

    // Apply archive cleanup after LinkedIn deletion attempt, so we can inspect candidates even if deletion fails.
    if (!dryRun) {
      const applied = await ctx.runMutation(
        internal.domains.social.linkedinArchiveCleanupMutations.cleanupArchiveDuplicates,
        {
          dryRun: false,
          maxScan: args.maxScan,
          maxDeletes: args.maxDeletes,
          sinceDateString: args.sinceDateString,
        },
      );
      return { ...applied, linkedInDeletes };
    }

    return { ...scan, linkedInDeletes };
  },
});

/**
 * One-time Convex-only cleanup:
 * - Collapse multiple archive rows for the same LinkedIn post URN
 * - Optionally delete archive rows missing both postId and postUrl
 *
 * No LinkedIn API calls are made.
 */
export const cleanupLinkedInArchivePostUrnReuse = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    maxScan: v.optional(v.number()),
    maxDeletes: v.optional(v.number()),
    sinceDateString: v.optional(v.string()),
    deleteOrphansMissingIds: v.optional(v.boolean()),
    requireAnnouncementTag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const requireAnnouncementTag = args.requireAnnouncementTag ?? "linkedin_archive_cleanup_notice_v1";

    if (!dryRun) {
      const announcement = await ctx.runQuery(
        internal.domains.social.linkedinArchiveMaintenanceQueries.getLatestCleanupAnnouncement,
        { tag: requireAnnouncementTag },
      );
      const hasPostUrn = typeof (announcement as any)?.postId === "string" && (announcement as any).postId.length > 0;
      if (!announcement || !hasPostUrn) {
        throw new Error(
          `Refusing destructive cleanup. Missing cleanup announcement in archive (postType=maintenance_notice, metadata.tag=${requireAnnouncementTag}) with a LinkedIn post URN.`,
        );
      }
    }

    // Always run a dry scan first so we can verify deletion candidates before mutating anything.
    const scan = await ctx.runMutation(
      internal.domains.social.linkedinArchiveCleanupMutations.cleanupArchivePostUrnReuse,
      {
        dryRun: true,
        maxScan: args.maxScan,
        maxDeletes: args.maxDeletes,
        sinceDateString: args.sinceDateString,
        deleteOrphansMissingIds: args.deleteOrphansMissingIds,
      },
    );

    if (dryRun) return scan;

    const applied = await ctx.runMutation(
      internal.domains.social.linkedinArchiveCleanupMutations.cleanupArchivePostUrnReuse,
      {
        dryRun: false,
        maxScan: args.maxScan,
        maxDeletes: args.maxDeletes,
        sinceDateString: args.sinceDateString,
        deleteOrphansMissingIds: args.deleteOrphansMissingIds,
      },
    );
    return applied;
  },
});
