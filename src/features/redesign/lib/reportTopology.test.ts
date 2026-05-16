import { describe, expect, it } from "vitest";
import { buildTopologySnapshot, type TopologyInputLink, type TopologyInputNode } from "./reportTopology";

const nodes: TopologyInputNode[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    graphType: "company",
    weight: 12,
    attentionScore: 92,
    staleHours: 2,
    sources: "14 sources",
    verified: "91%",
    signals: ["pricing changed", "enterprise tier"],
  },
  {
    id: "openai",
    label: "OpenAI",
    graphType: "company",
    weight: 11,
    attentionScore: 88,
    staleHours: 3,
    sources: "12 sources",
    verified: "87%",
    signals: ["voice models"],
  },
  {
    id: "brief",
    label: "Daily Brief",
    graphType: "brief",
    weight: 8,
    attentionScore: 76,
    staleHours: 1,
    sources: "8 sources",
    verified: "ready",
    signals: ["brief touched reports"],
  },
  {
    id: "edge",
    label: "Tiny Unknown Signal",
    graphType: "artifact",
    weight: 1,
    attentionScore: 18,
    staleHours: 240,
    sources: "0 sources",
    verified: "pending",
    signals: [],
  },
];

const links: TopologyInputLink[] = [
  { source: "anthropic", target: "brief", type: "has_report", strength: 0.8, confidence: 0.9, sourceRefs: 4, claimRefs: 3 },
  { source: "openai", target: "brief", type: "correlates_with", strength: 0.7, confidence: 0.74, sourceRefs: 3, claimRefs: 2 },
  { source: "edge", target: "brief", type: "has_artifact", strength: 0.2, confidence: 0.3, sourceRefs: 0, claimRefs: 0 },
];

describe("buildTopologySnapshot", () => {
  it("builds density topology with hot attention node and mapper clusters", () => {
    const snapshot = buildTopologySnapshot(nodes, links, "density");

    expect(snapshot.view).toBe("density");
    expect(snapshot.summary.hotNodeId).not.toBe("edge");
    expect(snapshot.nodesById.anthropic?.densityScore).toBeGreaterThan(snapshot.nodesById.edge?.densityScore ?? 0);
    expect(snapshot.mapperClusters.length).toBeGreaterThan(0);
    expect(snapshot.summary.viewRationale).toContain("attention");
  });

  it("builds PCA topology with named axes and bounded coordinates", () => {
    const snapshot = buildTopologySnapshot(nodes, links, "pca");

    expect(snapshot.pcaAxes.pc1.length).toBeGreaterThan(0);
    expect(snapshot.pcaAxes.pc2.length).toBeGreaterThan(0);
    snapshot.nodes.forEach((node) => {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(1);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(1);
    });
  });

  it("builds centroid topology that separates typical center from outlier edge", () => {
    const snapshot = buildTopologySnapshot(nodes, links, "centroid");

    expect(snapshot.summary.outlierNodeId).toBe("edge");
    expect(snapshot.nodesById.edge?.outlierScore).toBeGreaterThan(snapshot.nodesById.brief?.outlierScore ?? 0);
    expect(snapshot.summary.centroidNodeId).toBeTruthy();
  });
});
