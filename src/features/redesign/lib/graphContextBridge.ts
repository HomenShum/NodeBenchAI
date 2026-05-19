import type { ReportCardData } from "../fixtures";
import type { LiveArtifactDetail, ReportGraphNeighborhoodScope } from "../hooks/useLiveArtifacts";
import type { TopologyViewMode } from "./reportTopology";

export type GraphContextMode = "human" | "agent";
export type GraphContextPromotionClass = "visible" | "shelf" | "searchable" | "on_demand";

export interface GraphContextBridgePacket {
  contextRef: string;
  rootUri: string;
  title: string;
  mode: GraphContextMode;
  promotionClass: GraphContextPromotionClass;
  attentionScore: number;
  humanRank: number;
  agentRank: number;
  visibleNodes: number;
  packedNodes: number;
  edges: number;
  sourceRefs: number;
  claimRefs: number;
  estimatedTokens: number;
  approvalRequired: boolean;
  allowedActions: string[];
  blockedActions: string[];
  whySelected: string[];
  humanSummary: string;
  agentSummary: string;
  topology?: GraphContextTopologyHint;
}

export interface GraphContextTopologyHint {
  view: TopologyViewMode;
  mapperClusterIds: string[];
  densityScore: number;
  pc1: number;
  pc2: number;
  centroidDistance: number;
  outlierScore: number;
  summary: string;
}

interface GraphContextBridgeInput {
  report?: ReportCardData | null;
  detail?: LiveArtifactDetail | null;
  scope?: ReportGraphNeighborhoodScope | null;
  mode?: GraphContextMode;
  topology?: GraphContextTopologyHint | null;
}

const DEFAULT_ACTIONS = [
  "search_memory",
  "resolve_report_graph_context",
  "search_report_context",
  "verify_sources",
  "suggest_related",
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function freshnessScore(report?: ReportCardData | null, detail?: LiveArtifactDetail | null): number {
  const text = `${detail?.updatedAt ?? ""} ${report?.updatedAt ?? ""}`.toLowerCase();
  if (/just now|today|minute|hour|\bm ago|\bh ago/.test(text)) return 88;
  if (/yesterday|1d|2d|day/.test(text)) return 72;
  if (/week|w ago|stale|refresh/.test(text)) return 48;
  return detail || report ? 62 : 30;
}

function promotionClass(score: number): GraphContextPromotionClass {
  if (score >= 76) return "visible";
  if (score >= 60) return "shelf";
  if (score >= 42) return "searchable";
  return "on_demand";
}

function reportStatus(report?: ReportCardData | null, detail?: LiveArtifactDetail | null): ReportCardData["status"] | undefined {
  return detail?.status ?? report?.status;
}

export function buildGraphContextBridgePacket({
  report,
  detail,
  scope,
  mode = "agent",
  topology,
}: GraphContextBridgeInput): GraphContextBridgePacket {
  const title = detail?.title ?? report?.entity ?? "Current graph context";
  const rootId = detail?.id ?? report?.id ?? "current";
  const sourceRefs = Math.max(detail?.sourceRows.length ?? 0, detail?.sourceCount ?? 0, report?.sources ?? 0);
  const claimRefs = Math.max(detail?.claimCount ?? 0, report?.claims ?? 0);
  const followUps = detail?.followUps ?? report?.followUps ?? 0;
  const visibleNodes = Math.max(1, 1 + (detail?.nodes.length ?? 0) + Math.min(sourceRefs, 4));
  const packedNodes = Math.min(visibleNodes, mode === "agent" ? 32 : 12);
  const edges = detail?.edges.length ?? Math.max(0, visibleNodes - 1);
  const evidenceScore = clamp(42 + sourceRefs * 5 + claimRefs * 2, 0, 100);
  const freshScore = freshnessScore(report, detail);
  const actionScore = clamp(45 + followUps * 8 + (reportStatus(report, detail) === "review" ? 12 : 0), 0, 100);
  const graphScore = clamp(48 + visibleNodes * 3 + edges * 2, 0, 100);
  const attentionScore = clamp((evidenceScore + freshScore + actionScore + graphScore) / 4, 0, 100);
  const humanRank = clamp(attentionScore + (followUps > 0 ? 8 : 0) - (scope?.hiddenReportCount ? 3 : 0), 0, 100);
  const agentRank = clamp(attentionScore + sourceRefs * 2 + claimRefs - Math.max(0, visibleNodes - 40), 0, 100);
  const needsReview = reportStatus(report, detail) === "review" || followUps > 0 || sourceRefs === 0;
  const approvalRequired = needsReview || claimRefs === 0;
  const estimatedTokens = 220 + sourceRefs * 72 + claimRefs * 46 + packedNodes * 28 + edges * 12;
  const boundedReason = scope?.isServerBounded
    ? `Server-bounded neighborhood returned ${scope.returnedReportCount}/${scope.totalCandidateReports} candidate reports.`
    : "Client packet is bounded to the selected report and first-ring artifact context.";

  const whySelected = [
    `${title} is the active report/entity context.`,
    `${sourceRefs} source refs, ${claimRefs} claims, and ${followUps} follow-ups are attached.`,
    boundedReason,
    topology
      ? `Topology ${topology.view}: density ${topology.densityScore}, outlier ${topology.outlierScore}, mapper clusters ${topology.mapperClusterIds.length}.`
      : "Topology shape is not attached to this packet yet.",
    needsReview
      ? "Review pressure is present, so notebook/export writes stay approval-gated."
      : "Evidence is strong enough for memory-first reuse before live search.",
  ];

  return {
    contextRef: `graphctx:${rootId}`,
    rootUri: `nodebench://report/${rootId}`,
    title,
    mode,
    promotionClass: promotionClass(attentionScore),
    attentionScore,
    humanRank,
    agentRank,
    visibleNodes,
    packedNodes,
    edges,
    sourceRefs,
    claimRefs,
    estimatedTokens,
    approvalRequired,
    allowedActions: approvalRequired
      ? topology ? [...DEFAULT_ACTIONS, "inspect_topology_shape"] : DEFAULT_ACTIONS
      : topology ? [...DEFAULT_ACTIONS, "inspect_topology_shape", "patch_notebook", "create_followup"] : [...DEFAULT_ACTIONS, "patch_notebook", "create_followup"],
    blockedActions: approvalRequired
      ? ["blind_notebook_overwrite", "auto_export_without_review", "entity_merge_without_approval"]
      : ["entity_merge_without_approval"],
    whySelected,
    humanSummary: `${title}: ${sourceRefs} sources, ${claimRefs} claims, ${visibleNodes} visible graph nodes. ${topology ? `${topology.summary} ` : ""}${needsReview ? "Needs review before writes." : "Ready for memory-first reuse."}`,
    agentSummary: `Pack ${packedNodes} nodes, ${sourceRefs} source refs, ${claimRefs} claim refs${topology ? `; topology=${topology.view}/density:${topology.densityScore}/outlier:${topology.outlierScore}` : ""}; estimated ${estimatedTokens} tokens; approvalRequired=${approvalRequired}.`,
    topology: topology ?? undefined,
  };
}
