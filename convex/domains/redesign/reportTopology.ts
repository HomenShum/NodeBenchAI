import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "../../_generated/server";
import { internal } from "../../_generated/api";
import {
  buildReportTopologySnapshot,
  type ReportTopologyArchivePost,
  type ReportTopologyDailyBriefMemory,
  type ReportTopologyScaleMode,
  type ReportTopologySnapshot,
  type ReportTopologyViewMode,
} from "./reportTopologyRuntime";

const TOPOLOGY_TTL_MS = 5 * 60 * 1000;

const topologyArgs = {
  rootId: v.optional(v.string()),
  query: v.optional(v.string()),
  stage: v.optional(v.string()),
  kind: v.optional(v.string()),
  mode: v.optional(v.union(v.literal("focus"), v.literal("clustered"), v.literal("expanded"))),
  view: v.optional(v.union(v.literal("density"), v.literal("pca"), v.literal("centroid"))),
  limit: v.optional(v.number()),
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function postTypeLabel(postType: string): string {
  const labels: Record<string, string> = {
    clinical: "Clinical signal",
    daily_digest: "Daily brief",
    did_you_know: "Did You Know",
    fda: "FDA signal",
    funding_brief: "Funding brief",
    funding_tracker: "Funding tracker",
    ma: "M&A signal",
    research: "Research memo",
  };
  return labels[postType] ?? postType.replace(/_/g, " ");
}

function firstMeaningfulLine(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").replace(/\s+/g, " ").trim())
    .find((line) => line && !/^={3,}$/.test(line)) ?? "Published intelligence artifact";
}

function archivePostStage(post: ReportTopologyArchivePost): "verified" | "review" | "stale" | "drafting" | "monitoring" {
  const sources = Math.max(1, post.factCheckCount ?? 1);
  if (post.postUrl || sources > 1) return "verified";
  return "monitoring";
}

function matchesArchivePost(
  post: ReportTopologyArchivePost,
  args: { query?: string; stage?: string; kind?: string },
): boolean {
  const q = normalizeText(args.query);
  if (args.stage && args.stage !== "all" && archivePostStage(post) !== args.stage) return false;
  if (args.kind && args.kind !== "all" && postTypeLabel(post.postType) !== args.kind) return false;
  if (!q) return true;
  return `${post.content} ${post.postType} ${post.dateString}`.toLowerCase().includes(q);
}

function matchesDailyBriefMemory(
  memory: ReportTopologyDailyBriefMemory,
  args: { query?: string; stage?: string; kind?: string },
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

function getDedupeKey(post: ReportTopologyArchivePost): string {
  const postId = typeof post.postId === "string" ? post.postId.trim() : "";
  if (postId) return `postId|${postId}`;
  const part = typeof post.metadata?.part === "number" ? post.metadata.part : "";
  return `${post.dateString}|${post.persona}|${post.postType}|${part}|${post.content}`;
}

function dedupeArchivePosts(posts: ReportTopologyArchivePost[]): ReportTopologyArchivePost[] {
  const seen = new Set<string>();
  const out: ReportTopologyArchivePost[] = [];
  for (const post of posts) {
    const key = getDedupeKey(post);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(post);
  }
  return out;
}

function snapshotArgs(args: {
  rootId?: string;
  query?: string;
  stage?: string;
  kind?: string;
  mode?: "focus" | "clustered" | "expanded";
  view?: "density" | "pca" | "centroid";
  limit?: number;
}) {
  return {
    rootId: args.rootId,
    query: args.query,
    stage: args.stage,
    kind: args.kind,
    mode: (args.mode ?? "clustered") as ReportTopologyScaleMode,
    view: (args.view ?? "density") as ReportTopologyViewMode,
    limit: Math.max(1, Math.min(args.limit ?? 96, 120)),
  };
}

async function buildSnapshotFromDb(ctx: any, rawArgs: {
  rootId?: string;
  query?: string;
  stage?: string;
  kind?: string;
  mode?: "focus" | "clustered" | "expanded";
  view?: "density" | "pca" | "centroid";
  limit?: number;
}): Promise<ReportTopologySnapshot> {
  const args = snapshotArgs(rawArgs);
  const reportLimit = args.limit;
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
  const dedupedPosts = dedupeArchivePosts(archivePage.page as ReportTopologyArchivePost[]);

  let rootPost: ReportTopologyArchivePost | null = null;
  const rootArchiveId = args.rootId?.startsWith("li_") ? args.rootId.slice(3) : null;
  if (rootArchiveId) {
    const normalizedRootArchiveId = (ctx.db as any).normalizeId("linkedinPostArchive", rootArchiveId);
    rootPost = normalizedRootArchiveId ? await ctx.db.get(normalizedRootArchiveId) : null;
  }

  const selectedPosts: ReportTopologyArchivePost[] = [];
  const selectedPostIds = new Set<string>();
  const addPost = (post: ReportTopologyArchivePost | null) => {
    if (!post || selectedPosts.length >= reportLimit) return;
    const id = String(post._id);
    if (selectedPostIds.has(id)) return;
    if (!matchesArchivePost(post, args)) return;
    selectedPostIds.add(id);
    selectedPosts.push({ ...post, _id: id });
  };
  addPost(rootPost);
  for (const post of dedupedPosts) addPost({ ...post, _id: String(post._id) });

  const includeMemory = latestMemory ? matchesDailyBriefMemory({ ...latestMemory, _id: String(latestMemory._id) }, args) : false;
  const latestMemoryForSnapshot = includeMemory && latestMemory
    ? { ...latestMemory, _id: String(latestMemory._id) } as ReportTopologyDailyBriefMemory
    : null;

  const postBudget = Math.max(0, reportLimit - (latestMemoryForSnapshot ? 1 : 0));
  return buildReportTopologySnapshot({
    posts: selectedPosts.slice(0, postBudget),
    latestMemory: latestMemoryForSnapshot,
    rootId: args.rootId,
    query: args.query,
    stage: args.stage,
    kind: args.kind,
    mode: args.mode,
    view: args.view,
    limit: args.limit,
    now: Date.now(),
    ttlMs: TOPOLOGY_TTL_MS,
  });
}

function withPersistence(snapshot: ReportTopologySnapshot, stored: any | null): ReportTopologySnapshot {
  if (!stored || stored.graphHash !== snapshot.graphHash || stored.expiresAt <= Date.now()) {
    return snapshot;
  }
  return {
    ...(stored.snapshot as ReportTopologySnapshot),
    persisted: true,
    persistedAt: stored.generatedAt,
    source: "convex-persisted",
  };
}

export const computeReportTopologySnapshot = internalQuery({
  args: topologyArgs,
  returns: v.any(),
  handler: async (ctx, args) => buildSnapshotFromDb(ctx, args),
});

export const upsertReportTopologySnapshot = internalMutation({
  args: {
    snapshot: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const snapshot = args.snapshot as ReportTopologySnapshot;
    const existing = await ctx.db
      .query("reportTopologySnapshots")
      .withIndex("by_snapshot_key", (q) => q.eq("snapshotKey", snapshot.snapshotKey))
      .order("desc")
      .first();
    const doc = {
      snapshotKey: snapshot.snapshotKey,
      rootKey: snapshot.graph.nodes[0]?.id ?? "auto",
      view: snapshot.view,
      mode: snapshot.mode,
      graphHash: snapshot.graphHash,
      generatedAt: snapshot.generatedAt,
      expiresAt: snapshot.expiresAt,
      nodeCount: snapshot.summary.nodeCount,
      edgeCount: snapshot.summary.edgeCount,
      clusterCount: snapshot.summary.clusterCount,
      snapshot: {
        ...snapshot,
        persisted: true,
        persistedAt: snapshot.generatedAt,
        source: "convex-persisted",
      },
    };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return { snapshotId: existing._id, inserted: false, snapshotKey: snapshot.snapshotKey };
    }
    const snapshotId = await ctx.db.insert("reportTopologySnapshots", doc);
    return { snapshotId, inserted: true, snapshotKey: snapshot.snapshotKey };
  },
});

export const getReportTopologySnapshot = query({
  args: topologyArgs,
  returns: v.any(),
  handler: async (ctx, args) => {
    const computed = await buildSnapshotFromDb(ctx, args);
    const stored = await ctx.db
      .query("reportTopologySnapshots")
      .withIndex("by_snapshot_key", (q) => q.eq("snapshotKey", computed.snapshotKey))
      .order("desc")
      .first();
    return withPersistence(computed, stored);
  },
});

export const refreshReportTopologySnapshot = action({
  args: topologyArgs,
  returns: v.any(),
  handler: async (ctx, args) => {
    const snapshot = await ctx.runQuery(internal.domains.redesign.reportTopology.computeReportTopologySnapshot, args);
    const write = await ctx.runMutation(internal.domains.redesign.reportTopology.upsertReportTopologySnapshot, { snapshot });
    return {
      ...(snapshot as ReportTopologySnapshot),
      persisted: true,
      persistedAt: (snapshot as ReportTopologySnapshot).generatedAt,
      source: "convex-persisted",
      write,
    };
  },
});

export const inspectReportTopologyShape = query({
  args: {
    ...topologyArgs,
    nodeId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const computed = await buildSnapshotFromDb(ctx, args);
    const stored = await ctx.db
      .query("reportTopologySnapshots")
      .withIndex("by_snapshot_key", (q) => q.eq("snapshotKey", computed.snapshotKey))
      .order("desc")
      .first();
    const snapshot = withPersistence(computed, stored);
    const selectedId = args.nodeId ?? snapshot.summary.hotNodeId ?? snapshot.nodes[0]?.id ?? null;
    const node = selectedId ? snapshot.nodesById[selectedId] : null;
    const graphNode = selectedId ? snapshot.graph.nodes.find((item) => item.id === selectedId) ?? null : null;
    const clusters = selectedId
      ? snapshot.mapperClusters.filter((cluster) => cluster.memberIds.includes(selectedId)).slice(0, 6)
      : [];
    const neighborEdges = selectedId
      ? snapshot.graph.links.filter((link) => link.source === selectedId || link.target === selectedId).slice(0, 12)
      : [];
    const neighborIds = new Set(neighborEdges.flatMap((edge) => [edge.source, edge.target]).filter((id) => id !== selectedId));
    const neighbors = [...neighborIds]
      .map((id) => snapshot.graph.nodes.find((item) => item.id === id))
      .filter(Boolean)
      .slice(0, 10);
    return {
      success: Boolean(node),
      snapshotKey: snapshot.snapshotKey,
      graphHash: snapshot.graphHash,
      source: snapshot.source,
      persisted: snapshot.persisted,
      view: snapshot.view,
      selectedId,
      node,
      graphNode,
      clusters,
      neighborEdges,
      neighbors,
      summary: snapshot.summary,
      pcaAxes: snapshot.pcaAxes,
      retrievalPlan: {
        human: graphNode
          ? `Open ${graphNode.label} as a ${graphNode.provenance} node, then scan ${clusters.length} Mapper clusters and ${neighbors.length} first-ring neighbors.`
          : "Select a graph node before opening the topology shape.",
        agent: node
          ? `Use topology=${snapshot.view}, density=${node.densityScore}, outlier=${node.outlierScore}, clusters=${node.mapperClusterIds.length}; retrieve first-ring neighbors before live search.`
          : "No node projection available.",
      },
      recommendedActions: node
        ? [
            node.densityScore >= 70 ? "prioritize_dense_context" : "keep_searchable",
            node.outlierScore >= 70 ? "inspect_outlier_before_patch" : "reuse_neighborhood_context",
            clusters.length > 0 ? "expand_mapper_cluster" : "search_memory",
          ]
        : ["search_memory"],
    };
  },
});
