import { describe, expect, it } from "vitest";

import {
  buildReportTopologyKey,
  buildReportTopologySnapshot,
  buildRuntimeReportGraph,
  type ReportTopologyArchivePost,
  type ReportTopologyDailyBriefMemory,
} from "./reportTopologyRuntime";

const now = Date.UTC(2026, 4, 15);

const memory: ReportTopologyDailyBriefMemory = {
  _id: "mem_1",
  dateString: "2026-05-15",
  generatedAt: now - 60_000,
  goal: "Daily brief memory with source-backed signals.",
  features: [
    { id: "signal-a", type: "funding", name: "Funding signal", status: "passing", testCriteria: "Has source", sourceRefs: ["https://example.com/a"], updatedAt: now },
    { id: "signal-b", type: "voice", name: "Voice AI signal", status: "pending", testCriteria: "Needs review", sourceRefs: ["https://example.com/b"], updatedAt: now },
    { id: "signal-c", type: "infra", name: "Infrastructure signal", status: "passing", testCriteria: "Has evidence", sourceRefs: ["https://example.com/c"], updatedAt: now },
  ],
};

const posts: ReportTopologyArchivePost[] = [
  {
    _id: "post_1",
    dateString: "2026-05-15",
    persona: "GENERAL",
    postType: "funding_tracker",
    content: "Anthropic raised a new round\n\nEvidence-backed funding tracker.",
    postUrl: "https://linkedin.com/feed/update/1",
    factCheckCount: 4,
    metadata: { sourcesUsed: ["https://example.com/anthropic"] },
    postedAt: now - 90_000,
  },
  {
    _id: "post_2",
    dateString: "2026-05-15",
    persona: "GENERAL",
    postType: "research",
    content: "OpenAI voice workflow note\n\nRealtime workflow implications.",
    factCheckCount: 1,
    metadata: { sourcesUsed: ["https://example.com/openai"] },
    postedAt: now - 120_000,
  },
];

describe("report topology runtime", () => {
  it("builds a bounded graph with ids that match the Reports UI contract", () => {
    const graph = buildRuntimeReportGraph({ posts, latestMemory: memory, rootId: "daily_mem_1", mode: "clustered", now });
    expect(graph.nodes.some((node) => node.id === "daily_mem_1")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "entity:dailybrief")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "artifact:daily_mem_1:signal-a")).toBe(true);
    expect(graph.links.some((link) => link.type === "has_report")).toBe(true);
    expect(graph.links.some((link) => link.type === "causes")).toBe(true);
  });

  it("computes persisted-ready density topology with mapper clusters", () => {
    const snapshot = buildReportTopologySnapshot({
      posts,
      latestMemory: memory,
      rootId: "daily_mem_1",
      mode: "clustered",
      view: "density",
      now,
    });
    expect(snapshot.snapshotKey).toMatch(/^report-topology:/);
    expect(snapshot.graphHash.length).toBeGreaterThan(0);
    expect(snapshot.summary.nodeCount).toBeGreaterThan(4);
    expect(snapshot.summary.hotNodeId).toBeTruthy();
    expect(snapshot.mapperClusters.length).toBeGreaterThan(0);
    expect(snapshot.nodesById["daily_mem_1"]?.densityScore).toBeGreaterThanOrEqual(0);
  });

  it("separates PCA and centroid views while keeping deterministic keys", () => {
    const pca = buildReportTopologySnapshot({ posts, latestMemory: memory, rootId: "daily_mem_1", mode: "expanded", view: "pca", now });
    const centroid = buildReportTopologySnapshot({ posts, latestMemory: memory, rootId: "daily_mem_1", mode: "expanded", view: "centroid", now });
    expect(pca.view).toBe("pca");
    expect(centroid.view).toBe("centroid");
    expect(pca.pcaAxes.pc1.length).toBeGreaterThan(0);
    expect(centroid.summary.outlierNodeId).toBeTruthy();
    expect(buildReportTopologyKey({ rootId: "daily_mem_1", mode: "expanded", view: "pca" }))
      .toBe(buildReportTopologyKey({ rootId: "daily_mem_1", mode: "expanded", view: "pca" }));
  });
});
