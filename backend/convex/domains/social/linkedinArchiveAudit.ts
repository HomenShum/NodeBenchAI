"use node";

/**
 * LinkedIn Archive Audit
 *
 * Scans linkedinPostArchive and reports:
 * - duplicate groups (exact key match)
 * - reused post URNs across distinct contents/keys (danger for LinkedIn deletes)
 * - common content anomalies ("Unknown", demo markers, mojibake, oversize)
 *
 * Intended use:
 * - run before any destructive cleanup
 * - attach output to operator review (manual)
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

type ArchiveRow = {
  _id: string;
  dateString: string;
  persona: string;
  postType: string;
  content: string;
  postId?: string;
  postUrl?: string;
  metadata?: any;
  postedAt: number;
};

function getDedupeKey(row: Pick<ArchiveRow, "dateString" | "persona" | "postType" | "content" | "metadata">): string {
  const meta: any = row.metadata;
  const part = typeof meta?.part === "number" ? meta.part : "";
  return `${row.dateString}|${row.persona}|${row.postType}|${part}|${row.content}`;
}

function looksLikeMojibake(text: string): boolean {
  return /Ã.|â.|Â./.test(text);
}

function includesUnknownCompany(text: string): boolean {
  return (
    /\bUnknown Company\b/i.test(text) ||
    /\bCompany:\s*Unknown\b/i.test(text) ||
    /\bFunding:\s*Unknown\b/i.test(text) ||
    /\bUnknown\s*-\s*\$\d/i.test(text) ||
    /\bUNKNOWN COMPANY\b/i.test(text)
  );
}

function includesDemoMarker(text: string): boolean {
  return /\b-demo\b/i.test(text) || /\bdemo\b/i.test(text) || /example\.com/i.test(text);
}

export const runArchiveAudit = internalAction({
  args: {
    pageSize: v.optional(v.number()),
    maxRows: v.optional(v.number()),
    startCursor: v.optional(v.string()),
    includeSamples: v.optional(v.boolean()),
    sampleLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(Math.max(args.pageSize ?? 200, 10), 500);
    const maxRows = Math.min(Math.max(args.maxRows ?? 20000, 1), 200000);
    const includeSamples = args.includeSamples ?? true;
    const sampleLimit = Math.min(Math.max(args.sampleLimit ?? 25, 0), 200);

    let cursor: string | null = typeof args.startCursor === "string" ? args.startCursor : null;
    let scanned = 0;

    const keepByKey = new Map<string, ArchiveRow>();
    const dupCountByKey = new Map<string, number>();

    const postUrnToKeys = new Map<string, Set<string>>();
    const postUrnToContentHashes = new Map<string, Set<string>>();

    const issues = {
      missingPostUrn: 0,
      missingPostUrl: 0,
      overLength: 0,
      mojibake: 0,
      unknownCompany: 0,
      demoMarkers: 0,
    };

    const samples: Record<string, Array<{ id: string; postId?: string; postUrl?: string; dateString: string; persona: string; postType: string; excerpt: string }>> =
      {
        mojibake: [],
        unknownCompany: [],
        demoMarkers: [],
        overLength: [],
        reusedPostUrn: [],
      };

    const pushSample = (bucket: keyof typeof samples, row: ArchiveRow) => {
      if (!includeSamples) return;
      const list = samples[bucket];
      if (list.length >= sampleLimit) return;
      list.push({
        id: row._id,
        postId: row.postId,
        postUrl: row.postUrl,
        dateString: row.dateString,
        persona: row.persona,
        postType: row.postType,
        excerpt: row.content.slice(0, 220),
      });
    };

    while (scanned < maxRows) {
      const res = await ctx.runQuery(internal.domains.social.linkedinArchiveQueries.getArchivedPosts, {
        limit: pageSize,
        cursor: cursor ?? undefined,
        dedupe: false,
      });

      const page: ArchiveRow[] = res.posts as any;
      if (page.length === 0) break;

      for (const row of page) {
        scanned++;
        if (typeof row.postId !== "string" || row.postId.length === 0) issues.missingPostUrn++;
        if (typeof row.postUrl !== "string" || row.postUrl.length === 0) issues.missingPostUrl++;
        if (row.content.length > 3000) {
          issues.overLength++;
          pushSample("overLength", row);
        }
        if (looksLikeMojibake(row.content)) {
          issues.mojibake++;
          pushSample("mojibake", row);
        }
        if (includesUnknownCompany(row.content)) {
          issues.unknownCompany++;
          pushSample("unknownCompany", row);
        }
        if (includesDemoMarker(row.content) || includesDemoMarker(row.postUrl ?? "")) {
          issues.demoMarkers++;
          pushSample("demoMarkers", row);
        }

        const key = getDedupeKey(row);
        dupCountByKey.set(key, (dupCountByKey.get(key) ?? 0) + 1);
        const currentKeep = keepByKey.get(key);
        if (!currentKeep) {
          keepByKey.set(key, row);
        } else {
          // Prefer a row with a post URN, then newer postedAt.
          const rowHasUrn = typeof row.postId === "string" && row.postId.length > 0;
          const keepHasUrn = typeof currentKeep.postId === "string" && currentKeep.postId.length > 0;
          if ((rowHasUrn && !keepHasUrn) || (rowHasUrn === keepHasUrn && row.postedAt > currentKeep.postedAt)) {
            keepByKey.set(key, row);
          }
        }

        const postUrn = typeof row.postId === "string" ? row.postId : "";
        if (postUrn) {
          const keys = postUrnToKeys.get(postUrn) ?? new Set<string>();
          keys.add(key);
          postUrnToKeys.set(postUrn, keys);

          // lightweight content hash to detect "same URN, different contents"
          const contentHash = `${row.content.length}:${row.content.slice(0, 64)}`;
          const hashes = postUrnToContentHashes.get(postUrn) ?? new Set<string>();
          hashes.add(contentHash);
          postUrnToContentHashes.set(postUrn, hashes);
        }
      }

      cursor = typeof res.nextCursor === "string" ? res.nextCursor : null;
      if (!res.hasMore) break;
    }

    let duplicateRows = 0;
    let duplicateGroups = 0;
    for (const count of dupCountByKey.values()) {
      if (count > 1) {
        duplicateGroups++;
        duplicateRows += count - 1;
      }
    }

    let reusedPostUrns = 0;
    let reusedPostUrnsDifferentContent = 0;
    for (const [postUrn, keys] of postUrnToKeys.entries()) {
      if (keys.size > 1) {
        reusedPostUrns++;
        const anyRow = keepByKey.get(Array.from(keys)[0]);
        if (anyRow) pushSample("reusedPostUrn", anyRow);
      }
      const hashes = postUrnToContentHashes.get(postUrn);
      if (hashes && hashes.size > 1) reusedPostUrnsDifferentContent++;
    }

    return {
      scanned,
      cursor,
      isComplete: cursor === null,
      duplicates: {
        duplicateGroups,
        duplicateRows,
      },
      postUrnReuse: {
        distinctPostUrns: postUrnToKeys.size,
        reusedPostUrns,
        reusedPostUrnsDifferentContent,
      },
      issues,
      samples: includeSamples ? samples : {},
    };
  },
});
