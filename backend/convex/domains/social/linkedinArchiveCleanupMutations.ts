/**
 * LinkedIn Archive Cleanup Mutations
 *
 * Non-Node.js mutation to delete duplicate rows in linkedinPostArchive.
 *
 * Dedupe key:
 *   dateString + persona + postType + metadata.part + content
 *
 * Keeps the newest row (highest postedAt due to by_postedAt desc ordering).
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

type ArchiveRow = {
  _id: any;
  dateString: string;
  persona: string;
  postType: string;
  content: string;
  metadata?: any;
  postId?: string;
  postUrl?: string;
  postedAt: number;
};

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

function isBetterKeepCandidate(candidate: ArchiveRow, current: ArchiveRow): boolean {
  const candidateHasPostId = typeof candidate.postId === "string" && candidate.postId.length > 0;
  const currentHasPostId = typeof current.postId === "string" && current.postId.length > 0;
  if (candidateHasPostId !== currentHasPostId) return candidateHasPostId;

  const candidateHasPostUrl = typeof candidate.postUrl === "string" && candidate.postUrl.length > 0;
  const currentHasPostUrl = typeof current.postUrl === "string" && current.postUrl.length > 0;
  if (candidateHasPostUrl !== currentHasPostUrl) return candidateHasPostUrl;

  // Fall back to newest.
  return candidate.postedAt > current.postedAt;
}

export const cleanupArchiveDuplicates = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    maxScan: v.optional(v.number()),
    maxDeletes: v.optional(v.number()),
    sinceDateString: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const maxScan = Math.min(Math.max(args.maxScan ?? 5000, 1), 20000);
    const maxDeletes = Math.min(Math.max(args.maxDeletes ?? 5000, 1), 20000);
    const since = typeof args.sinceDateString === "string" ? args.sinceDateString : undefined;

    const posts: ArchiveRow[] = (await ctx.db
      .query("linkedinPostArchive")
      .withIndex("by_postedAt")
      .order("desc")
      .take(maxScan)) as any;

    const filtered: ArchiveRow[] = [];
    for (const p of posts) {
      if (since && p.dateString < since) continue;
      filtered.push(p);
    }

    // Choose the best row to keep per dedupe key.
    const keepByKey = new Map<string, ArchiveRow>();
    for (const p of filtered) {
      const key = getDedupeKey(p as any);
      const current = keepByKey.get(key);
      if (!current || isBetterKeepCandidate(p, current)) {
        keepByKey.set(key, p);
      }
    }

    const groupByKey = new Map<
      string,
      { key: string; keep: ArchiveRow; deletes: ArchiveRow[] }
    >();
    for (const [key, keep] of keepByKey.entries()) {
      groupByKey.set(key, { key, keep, deletes: [] });
    }

    // Build postUrn references to avoid deleting a URN that is still referenced by any kept row,
    // or referenced across multiple keys due to historical logging bugs.
    const postUrnToRowIds = new Map<string, Set<any>>();
    const postUrnToKeys = new Map<string, Set<string>>();
    for (const p of filtered) {
      const postUrn = typeof p.postId === "string" ? p.postId : "";
      if (!postUrn) continue;
      const key = getDedupeKey(p as any);
      const ids = postUrnToRowIds.get(postUrn) ?? new Set<any>();
      ids.add(p._id);
      postUrnToRowIds.set(postUrn, ids);
      const keys = postUrnToKeys.get(postUrn) ?? new Set<string>();
      keys.add(key);
      postUrnToKeys.set(postUrn, keys);
    }

    const kept: Array<{ id: any; dateString: string; persona: string; postType: string; postId?: string }> = [];
    const toDeleteAll: ArchiveRow[] = [];
    for (const p of filtered) {
      const key = getDedupeKey(p as any);
      const keep = keepByKey.get(key)!;
      if (keep._id === p._id) {
        kept.push({ id: p._id, dateString: p.dateString, persona: p.persona, postType: p.postType, postId: p.postId });
      } else {
        toDeleteAll.push(p);
        const grp = groupByKey.get(key);
        if (grp) grp.deletes.push(p);
      }
    }

    // Delete oldest duplicates first to reduce historical clutter without risking the newest row.
    const toDeleteSorted = [...toDeleteAll].sort((a, b) => a.postedAt - b.postedAt);
    const toDelete = toDeleteSorted.slice(0, maxDeletes);
    const deletions = toDelete.map((d) => d._id);
    const deletionIdSet = new Set<any>(deletions);

    // Only propose LinkedIn deletes that correspond to archive deletes in this run.
    const linkedInPostUrnsToDelete: string[] = [];
    const deletesByKey = new Map<string, string[]>();
    const unsafeByUrn = new Map<
      string,
      { postUrn: string; reason: string; keys: string[]; referencedRowCount: number }
    >();
    for (const p of toDelete) {
      const postId = typeof p.postId === "string" ? p.postId : "";
      if (!postId) continue;
      const key = getDedupeKey(p as any);
      const keep = keepByKey.get(key);
      const keepPostId = typeof keep?.postId === "string" ? keep.postId : "";
      if (keepPostId && postId === keepPostId) continue;

      const keys = postUrnToKeys.get(postId) ?? new Set<string>();
      const referencedIds = postUrnToRowIds.get(postId) ?? new Set<any>();
      const referencedRowCount = referencedIds.size;
      const referencedOnlyByDeletes = Array.from(referencedIds).every((id) => deletionIdSet.has(id));
      const singleKey = keys.size === 1 && keys.has(key);

      if (!singleKey) {
        if (!unsafeByUrn.has(postId)) {
          unsafeByUrn.set(postId, {
            postUrn: postId,
            reason: "postUrn referenced by multiple dedupe keys",
            keys: Array.from(keys),
            referencedRowCount,
          });
        }
        continue;
      }

      if (!referencedOnlyByDeletes) {
        if (!unsafeByUrn.has(postId)) {
          unsafeByUrn.set(postId, {
            postUrn: postId,
            reason: "postUrn still referenced by a kept row or by rows not deleted in this run",
            keys: Array.from(keys),
            referencedRowCount,
          });
        }
        continue;
      }

      linkedInPostUrnsToDelete.push(postId);
      const arr = deletesByKey.get(key) ?? [];
      arr.push(postId);
      deletesByKey.set(key, arr);
    }

    const uniqueLinkedInPostUrnsToDelete = [...new Set(linkedInPostUrnsToDelete)];
    const linkedInDeletionCandidates: Array<{ key: string; keepPostUrn: string; deletePostUrns: string[] }> = [];
    for (const [key, deletePostUrns] of deletesByKey.entries()) {
      const keep = keepByKey.get(key);
      const keepPostUrn = typeof keep?.postId === "string" ? keep.postId : "";
      if (!keepPostUrn) continue;
      linkedInDeletionCandidates.push({ key, keepPostUrn, deletePostUrns: [...new Set(deletePostUrns)] });
    }

    const duplicateGroups: Array<{
      key: string;
      keep: { id: any; postedAt: number; postUrn?: string; postUrl?: string };
      deletes: Array<{ id: any; postedAt: number; postUrn?: string; postUrl?: string }>;
    }> = [];
    for (const grp of groupByKey.values()) {
      if (grp.deletes.length === 0) continue;
      duplicateGroups.push({
        key: grp.key,
        keep: {
          id: grp.keep._id,
          postedAt: grp.keep.postedAt,
          postUrn: grp.keep.postId,
          postUrl: grp.keep.postUrl,
        },
        deletes: grp.deletes
          .sort((a, b) => a.postedAt - b.postedAt)
          .map((d) => ({ id: d._id, postedAt: d.postedAt, postUrn: d.postId, postUrl: d.postUrl })),
      });
    }

    if (!dryRun) {
      for (const id of deletions) await ctx.db.delete(id);
    }

    return {
      dryRun,
      scanned: posts.length,
      sinceDateString: since ?? null,
      duplicatesFound: deletions.length,
      duplicatesFoundTotal: toDeleteAll.length,
      deleted: dryRun ? 0 : deletions.length,
      kept: kept.length,
      deletedIds: dryRun ? [] : deletions,
      linkedInPostUrnsToDelete: uniqueLinkedInPostUrnsToDelete,
      linkedInDeletionCandidates,
      unsafeLinkedInPostUrns: Array.from(unsafeByUrn.values()),
      duplicateGroups,
    };
  },
});

/**
 * Cleanup archive rows that represent the same LinkedIn post URN with multiple
 * archive entries (often due to edits or historical logging bugs).
 *
 * Safety:
 * - Only mutates Convex `linkedinPostArchive` rows (no LinkedIn API calls).
 * - Keeps the best row per postId (prefers rows with postUrl, then newest postedAt).
 * - Optionally deletes "orphan" rows missing both postId and postUrl.
 */
export const cleanupArchivePostUrnReuse = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    maxScan: v.optional(v.number()),
    maxDeletes: v.optional(v.number()),
    sinceDateString: v.optional(v.string()),
    deleteOrphansMissingIds: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const maxScan = Math.min(Math.max(args.maxScan ?? 5000, 1), 50000);
    const maxDeletes = Math.min(Math.max(args.maxDeletes ?? 5000, 1), 50000);
    const since = typeof args.sinceDateString === "string" ? args.sinceDateString : undefined;
    const deleteOrphans = args.deleteOrphansMissingIds ?? true;

    const posts: ArchiveRow[] = (await ctx.db
      .query("linkedinPostArchive")
      .withIndex("by_postedAt")
      .order("desc")
      .take(maxScan)) as any;

    const filtered: ArchiveRow[] = [];
    for (const p of posts) {
      if (since && p.dateString < since) continue;
      filtered.push(p);
    }

    const rowsByUrn = new Map<string, ArchiveRow[]>();
    const orphans: ArchiveRow[] = [];
    for (const p of filtered) {
      const postId = typeof p.postId === "string" ? p.postId.trim() : "";
      const postUrl = typeof p.postUrl === "string" ? p.postUrl.trim() : "";
      if (!postId) {
        if (deleteOrphans && !postUrl) orphans.push(p);
        continue;
      }
      const arr = rowsByUrn.get(postId) ?? [];
      arr.push(p);
      rowsByUrn.set(postId, arr);
    }

    const deletes: ArchiveRow[] = [];
    const keepByUrn: Array<{ postId: string; keepId: any; keepPostedAt: number; deleteCount: number }> = [];
    for (const [postId, rows] of rowsByUrn.entries()) {
      if (rows.length <= 1) continue;
      let keep = rows[0];
      for (const r of rows.slice(1)) {
        if (isBetterKeepCandidate(r, keep)) keep = r;
      }
      for (const r of rows) {
        if (r._id === keep._id) continue;
        deletes.push(r);
      }
      keepByUrn.push({ postId, keepId: keep._id, keepPostedAt: keep.postedAt, deleteCount: rows.length - 1 });
    }

    // Add orphans after URN reuse deletes, oldest first.
    const deleteCandidates = [
      ...deletes.sort((a, b) => a.postedAt - b.postedAt),
      ...orphans.sort((a, b) => a.postedAt - b.postedAt),
    ].slice(0, maxDeletes);

    if (!dryRun) {
      for (const r of deleteCandidates) await ctx.db.delete(r._id);
    }

    const deletedUrnReuse = deleteCandidates.filter((r) => typeof r.postId === "string" && r.postId.trim().length > 0).length;
    const deletedOrphans = deleteCandidates.filter((r) => !(typeof r.postId === "string" && r.postId.trim().length > 0)).length;

    return {
      dryRun,
      scanned: posts.length,
      sinceDateString: since ?? null,
      postUrnsWithReuse: keepByUrn.length,
      urnReuseRowsDeleted: deletedUrnReuse,
      orphanRowsDeleted: deletedOrphans,
      deletesProposed: deleteCandidates.length,
      examples: {
        keepByUrn: keepByUrn.slice(0, 10),
        orphanIds: orphans.slice(0, 10).map((o) => o._id),
      },
    };
  },
});
