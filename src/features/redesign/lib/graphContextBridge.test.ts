import { describe, expect, it } from "vitest";
import type { ReportCardData } from "../fixtures";
import type { LiveArtifactDetail } from "../hooks/useLiveArtifacts";
import { buildGraphContextBridgePacket } from "./graphContextBridge";

const report: ReportCardData = {
  id: "rep_anthropic",
  entity: "Anthropic",
  kind: "Company Report",
  status: "verified",
  description: "Enterprise agent momentum with source-backed claims.",
  sources: 8,
  claims: 5,
  followUps: 0,
  updatedAt: "2h ago",
};

const detail: LiveArtifactDetail = {
  id: "rep_anthropic",
  title: "Anthropic Company Report",
  kind: "Company Report",
  status: "verified",
  summary: "Enterprise adoption signals are attached to evidence rows.",
  updatedAt: "2h ago",
  updatedAtMs: Date.now(),
  sourceCount: 8,
  claimCount: 5,
  followUps: 0,
  tags: ["ai-infra", "enterprise"],
  sections: [],
  sourceRows: Array.from({ length: 8 }, (_, index) => ({
    id: `src-${index}`,
    type: "Evidence",
    title: `Source ${index}`,
    refreshed: "today",
    reused: 1,
    excerpt: "Evidence row",
    status: "verified",
    confidence: 0.82,
  })),
  nodes: [
    { id: "root", title: "Anthropic", subtitle: "Company", tone: "green", kind: "entity" },
    { id: "artifact", title: "Pricing comparison", subtitle: "Artifact", tone: "blue", kind: "artifact" },
  ],
  edges: [{ from: "root", to: "artifact", type: "has_artifact", label: "artifact" }],
  notebookHtml: "<p>Notebook</p>",
  primaryAction: "Open notebook",
};

describe("buildGraphContextBridgePacket", () => {
  it("creates a compact agent context packet from report and graph detail", () => {
    const packet = buildGraphContextBridgePacket({ report, detail });

    expect(packet.contextRef).toBe("graphctx:rep_anthropic");
    expect(packet.rootUri).toBe("nodebench://report/rep_anthropic");
    expect(packet.sourceRefs).toBe(8);
    expect(packet.claimRefs).toBe(5);
    expect(packet.packedNodes).toBeLessThanOrEqual(packet.visibleNodes);
    expect(packet.allowedActions).toContain("resolve_report_graph_context");
    expect(packet.allowedActions).toContain("patch_notebook");
    expect(packet.blockedActions).toContain("entity_merge_without_approval");
    expect(packet.whySelected.join(" ")).toContain("active report/entity context");
  });

  it("approval-gates review or sparse packets", () => {
    const packet = buildGraphContextBridgePacket({
      report: { ...report, status: "review", sources: 0, claims: 0, followUps: 2 },
      detail: null,
    });

    expect(packet.approvalRequired).toBe(true);
    expect(packet.allowedActions).not.toContain("patch_notebook");
    expect(packet.blockedActions).toContain("blind_notebook_overwrite");
    expect(packet.humanSummary).toContain("Needs review");
  });

  it("describes server-bounded neighborhoods when scope is present", () => {
    const packet = buildGraphContextBridgePacket({
      report,
      detail,
      scope: {
        isServerBounded: true,
        mode: "clustered",
        reportLimit: 64,
        scanLimit: 320,
        scannedArchivePosts: 240,
        totalCandidateReports: 180,
        returnedReportCount: 64,
        hiddenReportCount: 116,
        hasMoreArchive: true,
      },
    });

    expect(packet.whySelected.join(" ")).toContain("64/180 candidate reports");
  });
});
