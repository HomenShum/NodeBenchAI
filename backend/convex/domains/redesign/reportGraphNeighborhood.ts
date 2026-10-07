/**
 * Server-bounded report graph neighborhood.
 *
 * The Reports graph should never need the whole report universe in the
 * browser. This query returns a bounded root-plus-neighbors packet from the
 * current Convex-backed artifacts, plus enough hidden-count metadata for the UI
 * to explain clustering and search refinement.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

const POST_TYPE_LABELS: Record<string, string> = {
  clinical: "Clinical signal",
  daily_digest: "Daily brief",
  did_you_know: "Did You Know",
  fda: "FDA signal",
  funding_brief: "Funding brief",
  funding_tracker: "Funding tracker",
  ma: "M&A signal",
  research: "Research memo",
};

const GRAPH_REPORT_LIMIT_BY_MODE = {
  focus: 32,
  clustered: 64,
  expanded: 96,
} as const;

type GraphNeighborhoodMode = keyof typeof GRAPH_REPORT_LIMIT_BY_MODE;

type ArchivePostDoc = {
  _id: Id<"linkedinPostArchive">;
  dateString: string;
  persona: string;
  postType: string;
  content: string;
  postId?: string;
  postUrl?: string;
  factCheckCount?: number;
  metadata?: any;
  postedAt: number;
};

function getDedupeKey(post: {
  dateString: string;
  persona: string;
  postType: string;
  content: string;
  postId?: string;
  metadata?: any;
}): string {
  const postId = typeof post.postId === "string" ? post.postId.trim() : "";
  if (postId) return `postId|${postId}`;
  const part = typeof post.metadata?.part === "number" ? post.metadata.part : "";
  return `${post.dateString}|${post.persona}|${post.postType}|${part}|${post.content}`;
}

function dedupeArchivePosts<T extends ArchivePostDoc>(posts: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const post of posts) {
    const key = getDedupeKey(post);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(post);
  }
  return out;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function postTypeLabel(postType: string): string {
  return POST_TYPE_LABELS[postType] ?? postType.replace(/_/g, " ");
}

function archivePostStage(post: ArchivePostDoc): "verified" | "review" | "stale" | "drafting" {
  const sources = Math.max(1, post.factCheckCount ?? 1);
  if (post.postUrl || sources > 1) return "verified";
  return "drafting";
}

function matchesArchivePost(
  post: ArchivePostDoc,
  args: {
    query?: string;
    stage?: string;
    kind?: string;
  },
): boolean {
  const q = normalizeText(args.query);
  if (args.stage && args.stage !== "all" && archivePostStage(post) !== args.stage) return false;
  if (args.kind && args.kind !== "all" && postTypeLabel(post.postType) !== args.kind) return false;
  if (!q) return true;
  return `${post.content} ${post.postType} ${post.dateString}`.toLowerCase().includes(q);
}

function matchesDailyBriefMemory(
  memory: { dateString: string; goal: string; features?: Array<{ name?: string; notes?: string; type?: string }> },
  args: {
    query?: string;
    stage?: string;
    kind?: string;
  },
): boolean {
  if (args.stage && args.stage !== "all" && args.stage !== "verified" && args.stage !== "review") return false;
  if (args.kind && args.kind !== "all" && args.kind !== "Daily Brief") return false;
  const q = normalizeText(args.query);
  if (!q) return true;
  const featureText = (memory.features ?? [])
    .map((feature) => `${feature.name ?? ""} ${feature.notes ?? ""} ${feature.type ?? ""}`)
    .join(" ");
  return `${memory.dateString} ${memory.goal} ${featureText}`.toLowerCase().includes(q);
}

export const getReportGraphNeighborhood = query({
  args: {
    rootId: v.optional(v.string()),
    query: v.optional(v.string()),
    stage: v.optional(v.string()),
    kind: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("focus"), v.literal("clustered"), v.literal("expanded"))),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    mode: v.string(),
    sourceLabel: v.string(),
    rootId: v.optional(v.string()),
    latestMemory: v.optional(v.any()),
    posts: v.array(v.object({
      _id: v.id("linkedinPostArchive"),
      dateString: v.string(),
      persona: v.string(),
      postType: v.string(),
      content: v.string(),
      postId: v.optional(v.string()),
      postUrl: v.optional(v.string()),
      factCheckCount: v.optional(v.number()),
      metadata: v.optional(v.any()),
      postedAt: v.number(),
    })),
    reportLimit: v.number(),
    scanLimit: v.number(),
    scannedArchivePosts: v.number(),
    totalCandidateReports: v.number(),
    returnedReportCount: v.number(),
    hiddenReportCount: v.number(),
    hasMoreArchive: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const mode: GraphNeighborhoodMode = args.mode ?? "clustered";
    const reportLimit = Math.max(1, Math.min(args.limit ?? GRAPH_REPORT_LIMIT_BY_MODE[mode], 120));
    const scanLimit = Math.min(Math.max(reportLimit * 5, 120), 500);

    const latestMemory = await ctx.db
      .query("dailyBriefMemories")
      .withIndex("by_generated_at")
      .order("desc")
      .first();

    const archivePage = await ctx.db
      .query("linkedinPostArchive")
      .withIndex("by_postedAt")
      .order("desc")
      .paginate({ cursor: null, numItems: scanLimit });

    const dedupedPosts = dedupeArchivePosts(archivePage.page as ArchivePostDoc[]);

    const rootArchiveId = args.rootId?.startsWith("li_") ? args.rootId.slice(3) : null;
    const normalizedRootArchiveId = rootArchiveId
      ? (ctx.db as any).normalizeId("linkedinPostArchive", rootArchiveId)
      : null;
    const rootPost = normalizedRootArchiveId
      ? await ctx.db.get(normalizedRootArchiveId)
      : null;

    const rootDailyMemory = args.rootId?.startsWith("daily_") && latestMemory
      ? latestMemory
      : null;

    const archiveCandidates = dedupedPosts.filter((post) => matchesArchivePost(post, args));
    const rootPostMatchesOutsideScan = rootPost
      && matchesArchivePost(rootPost as ArchivePostDoc, args)
      && !archiveCandidates.some((post) => String(post._id) === String(rootPost._id));
    const includesDailyBrief = latestMemory ? matchesDailyBriefMemory(latestMemory, args) : false;
    const totalCandidateReports = archiveCandidates.length
      + (rootPostMatchesOutsideScan ? 1 : 0)
      + (includesDailyBrief ? 1 : 0);

    const selectedPosts: ArchivePostDoc[] = [];
    const selectedPostIds = new Set<string>();
    const addPost = (post: ArchivePostDoc | null) => {
      if (!post || selectedPosts.length >= reportLimit) return;
      const id = String(post._id);
      if (selectedPostIds.has(id)) return;
      if (!matchesArchivePost(post, args)) return;
      selectedPostIds.add(id);
      selectedPosts.push(post);
    };

    addPost(rootPost as ArchivePostDoc | null);
    for (const post of archiveCandidates) addPost(post);

    const dailyBriefBudgetCost = includesDailyBrief ? 1 : 0;
    const postBudget = Math.max(0, reportLimit - dailyBriefBudgetCost);
    const boundedPosts = selectedPosts.slice(0, postBudget);
    const returnedReportCount = boundedPosts.length + (includesDailyBrief ? 1 : 0);
    const hiddenReportCount = Math.max(0, totalCandidateReports - returnedReportCount);
    const effectiveRootId = rootDailyMemory
      ? `daily_${rootDailyMemory._id}`
      : rootPost
        ? `li_${rootPost._id}`
        : args.rootId;

    return {
      mode,
      sourceLabel: `Convex graph neighborhood - ${returnedReportCount}/${totalCandidateReports} reports`,
      rootId: effectiveRootId,
      latestMemory: includesDailyBrief ? latestMemory : undefined,
      posts: boundedPosts.map((post) => ({
        _id: post._id,
        dateString: post.dateString,
        persona: post.persona,
        postType: post.postType,
        content: post.content,
        postId: post.postId,
        postUrl: post.postUrl,
        factCheckCount: post.factCheckCount,
        metadata: post.metadata,
        postedAt: post.postedAt,
      })),
      reportLimit,
      scanLimit,
      scannedArchivePosts: archivePage.page.length,
      totalCandidateReports,
      returnedReportCount,
      hiddenReportCount,
      hasMoreArchive: !archivePage.isDone,
    };
  },
});
