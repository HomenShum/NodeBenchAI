export type ReportTopologyViewMode = "density" | "pca" | "centroid";
export type ReportTopologyScaleMode = "focus" | "clustered" | "expanded";

export type ReportTopologyArchivePost = {
  _id: string;
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

export type ReportTopologyDailyBriefMemory = {
  _id: string;
  dateString: string;
  generatedAt: number;
  goal: string;
  features?: Array<{
    id: string;
    type: string;
    name: string;
    status: "pending" | "failing" | "passing";
    priority?: number;
    testCriteria: string;
    sourceRefs?: any;
    notes?: string;
    updatedAt: number;
  }>;
  context?: any;
};

export type ReportTopologyGraphNode = {
  id: string;
  label: string;
  type: string;
  graphType: "company" | "person" | "investor" | "brief" | "monitoring" | "report" | "artifact" | "portfolio" | "cluster";
  provenance: "universe" | "entity" | "report" | "artifact" | "source" | "portfolio" | "cluster";
  stage: "drafting" | "review" | "verified" | "stale" | "monitoring" | "universe";
  weight: number;
  sources: string;
  freshness: string;
  staleHours: number;
  verified: string;
  coverage: string[];
  signals: string[];
  attentionScore: number;
  reasonSelected: string;
  attentionTier: "promoted" | "shelf" | "searchable" | "agent_only";
};

export type ReportTopologyGraphLink = {
  source: string;
  target: string;
  type: string;
  label: string;
  basis?: string;
  strength?: number;
  confidence?: number;
  sourceRefs?: number;
  claimRefs?: number;
};

export type ReportTopologyNodeProjection = {
  id: string;
  densityScore: number;
  attentionScore: number;
  degree: number;
  pc1: number;
  pc2: number;
  centroidDistance: number;
  outlierScore: number;
  mapperClusterIds: string[];
  x: number;
  y: number;
};

export type ReportTopologyMapperCluster = {
  id: string;
  label: string;
  memberIds: string[];
  x: number;
  y: number;
  densityScore: number;
  attentionScore: number;
};

export type ReportTopologySnapshot = {
  snapshotKey: string;
  graphHash: string;
  view: ReportTopologyViewMode;
  mode: ReportTopologyScaleMode;
  generatedAt: number;
  expiresAt: number;
  persisted: boolean;
  persistedAt?: number;
  source: "convex-computed" | "convex-persisted";
  nodes: ReportTopologyNodeProjection[];
  nodesById: Record<string, ReportTopologyNodeProjection>;
  mapperClusters: ReportTopologyMapperCluster[];
  mapperEdges: Array<{ source: string; target: string; sharedMembers: number }>;
  summary: {
    nodeCount: number;
    edgeCount: number;
    hotNodeId: string | null;
    centroidNodeId: string | null;
    outlierNodeId: string | null;
    clusterCount: number;
    viewRationale: string;
  };
  pcaAxes: {
    pc1: Array<{ label: string; weight: number }>;
    pc2: Array<{ label: string; weight: number }>;
  };
  graph: {
    sourceLabel: string;
    sourceRows: number;
    totalReportCount: number;
    visibleReportCount: number;
    hiddenReportCount: number;
    nodes: ReportTopologyGraphNode[];
    links: ReportTopologyGraphLink[];
  };
};

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

const SCALE_CONFIG: Record<ReportTopologyScaleMode, { neighborReports: number; rootArtifacts: number; relatedArtifacts: number; sourceRows: number; coveredEntities: number; relationEdges: number }> = {
  focus: { neighborReports: 8, rootArtifacts: 4, relatedArtifacts: 1, sourceRows: 3, coveredEntities: 4, relationEdges: 3 },
  clustered: { neighborReports: 12, rootArtifacts: 4, relatedArtifacts: 1, sourceRows: 3, coveredEntities: 5, relationEdges: 5 },
  expanded: { neighborReports: 18, rootArtifacts: 5, relatedArtifacts: 2, sourceRows: 4, coveredEntities: 6, relationEdges: 8 },
};

const FEATURE_LABELS = ["attention", "degree", "weight", "sources", "verified", "freshness", "signals", "causal"] as const;

type ReportRow = {
  id: string;
  entity: string;
  kind: string;
  status: "verified" | "review" | "watching";
  description: string;
  sources: number;
  claims: number;
  followUps: number;
  updatedAt: string;
  updatedAtMs: number;
  tags: string[];
  detailNodes: Array<{ id: string; title: string; subtitle: string; tone: string; artifactType?: string }>;
  detailEdges: Array<{ from: string; to: string; type?: string; label?: string; basis?: string; strength?: number }>;
  sourceRows: Array<{ id: string; type: string; title: string; confidence?: number; href?: string }>;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clamp100(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeGraphKey(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function firstMeaningfulLine(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .map((line) => normalizeSpace(line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "")))
    .find((line) => line && !/^={3,}$/.test(line)) ?? "Published intelligence artifact";
}

function excerpt(markdown: string, max = 190): string {
  const text = markdown
    .split(/\r?\n/)
    .map((line) => normalizeSpace(line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "")))
    .filter(Boolean)
    .join(" ");
  return text.length > max ? `${text.slice(0, max - 1).trim()}...` : text;
}

function timeAgoFrom(now: number, at: number): string {
  const delta = Math.max(0, now - at);
  const m = Math.floor(delta / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

function freshnessHours(value: string): number {
  const text = value.toLowerCase();
  if (/now|today|recently/.test(text)) return 0;
  const number = Number(text.match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (/\bmin|m ago/.test(text)) return number / 60;
  if (/\bh|hour/.test(text)) return number;
  if (/\bd|day/.test(text)) return number * 24;
  if (/\bw|week/.test(text)) return number * 24 * 7;
  return number;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function sourceRefCount(value: unknown): number {
  if (!value) return 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + Math.max(1, sourceRefCount(item)), 0);
  if (typeof value === "string") return value ? 1 : 0;
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).reduce<number>((sum, item) => sum + sourceRefCount(item), 0);
  return 0;
}

function sourceRefLabels(value: unknown, limit = 8): string[] {
  const out: string[] = [];
  const visit = (item: unknown) => {
    if (out.length >= limit || !item) return;
    if (typeof item === "string") {
      if (item.trim()) out.push(item.trim());
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (typeof item === "object") {
      const record = item as Record<string, unknown>;
      const label = record.url ?? record.title ?? record.source ?? record.name;
      if (typeof label === "string" && label.trim()) out.push(label.trim());
      else Object.values(record).forEach(visit);
    }
  };
  visit(value);
  return Array.from(new Set(out)).slice(0, limit);
}

function postTypeLabel(postType: string): string {
  return POST_TYPE_LABELS[postType] ?? postType.replace(/_/g, " ");
}

function stageFromReport(report: ReportRow): ReportTopologyGraphNode["stage"] {
  if (report.status === "review") return "review";
  if (report.status === "watching") return "monitoring";
  if (/stale|expired|refresh|old|3d|5d|week/i.test(`${report.description} ${report.updatedAt}`)) return "stale";
  if (report.sources <= 2 || /draft|gathering|queued|generating/i.test(report.description)) return "drafting";
  return "verified";
}

function entityLabelForReport(report: ReportRow): string {
  const fundingMatch = report.entity.match(/^(.+?)\s+(?:just\s+)?raised\b/i);
  if (fundingMatch?.[1]) return fundingMatch[1].trim();
  if (/daily|brief|edition|digest/i.test(report.kind)) return "Daily Brief";
  return report.entity.split(/\s+[|-]\s+/)[0]?.trim() || report.entity;
}

function entityNodeKey(report: ReportRow): string {
  return `entity:${normalizeGraphKey(entityLabelForReport(report) || report.id) || report.id}`;
}

function liveNodeKey(report: ReportRow, nodeId: string): string {
  return `artifact:${report.id}:${nodeId}`;
}

function liveSourceKey(report: ReportRow, sourceId: string): string {
  return `source:${report.id}:${sourceId}`;
}

function reportGraphType(report: ReportRow, stage: ReportTopologyGraphNode["stage"]): ReportTopologyGraphNode["graphType"] {
  const text = `${report.kind} ${report.entity} ${report.description}`.toLowerCase();
  if (/daily|brief|edition|digest/.test(text)) return "brief";
  if (/sequoia|capital|ventures|fund|investor|partner/.test(text)) return "investor";
  if (/person|founder|ceo|partner|investor|amodei|altman|lin/.test(text)) return "person";
  if (stage === "monitoring" || /watch|monitor/.test(text)) return "monitoring";
  return "company";
}

function graphEdgeType(report: ReportRow, stage: ReportTopologyGraphNode["stage"]): string {
  const text = `${report.kind} ${report.entity} ${report.description}`.toLowerCase();
  if (text.includes("funding") || text.includes("raise") || text.includes("series ")) return "funding";
  if (text.includes("pricing") || text.includes("compet")) return "competition";
  if (text.includes("source") || text.includes("api") || text.includes("workflow")) return "integration";
  if (stage === "review" || stage === "stale") return "review";
  if (stage === "drafting") return "drafting";
  return "coverage";
}

function defaultGraphAttention(node: Omit<ReportTopologyGraphNode, "attentionScore" | "reasonSelected" | "attentionTier">): Pick<ReportTopologyGraphNode, "attentionScore" | "reasonSelected" | "attentionTier"> {
  const sourceCount = Number(node.sources.match(/\d+/)?.[0] ?? 0);
  const evidenceScore = Math.min(38, sourceCount * 3);
  const stageScore = node.stage === "verified" ? 24 : node.stage === "review" || node.stage === "stale" ? 18 : node.stage === "drafting" ? 12 : 14;
  const provenanceScore = node.provenance === "artifact" ? 20 : node.provenance === "report" ? 18 : node.provenance === "portfolio" ? 16 : node.provenance === "entity" ? 14 : node.provenance === "cluster" ? 10 : 8;
  const actionScore = node.signals.length > 0 ? 12 : 4;
  const attentionScore = Math.max(0, Math.min(100, Math.round(18 + evidenceScore + stageScore + provenanceScore + actionScore - Math.min(16, node.staleHours / 12))));
  const attentionTier = attentionScore >= 78 ? "promoted" : attentionScore >= 62 ? "shelf" : attentionScore >= 42 ? "searchable" : "agent_only";
  const reasonSelected =
    node.provenance === "artifact" ? "Generated artifact can become report work, evidence review, or chat context." :
    node.provenance === "report" ? "Report notebook is the durable artifact for this graph node." :
    node.provenance === "portfolio" ? "Portfolio node summarizes cross-entity movement and review order." :
    node.stage === "review" || node.stage === "stale" ? "Needs review or freshness work before the agent can safely patch outputs." :
    "Promoted from source, claim, freshness, and graph-context signals.";
  return { attentionScore, reasonSelected, attentionTier };
}

function cleanTextHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildReportTopologyKey(args: {
  rootId?: string | null;
  query?: string | null;
  stage?: string | null;
  kind?: string | null;
  mode?: ReportTopologyScaleMode | null;
  view?: ReportTopologyViewMode | null;
  limit?: number | null;
}): string {
  const parts = [
    args.view ?? "density",
    args.mode ?? "clustered",
    args.rootId ?? "auto",
    normalizeSpace(args.query ?? "").toLowerCase(),
    args.stage ?? "all",
    args.kind ?? "all",
    String(args.limit ?? 0),
  ];
  return `report-topology:${cleanTextHash(parts.join("|"))}`;
}

function archiveToReport(post: ReportTopologyArchivePost, now: number): ReportRow {
  const metadata = asRecord(post.metadata);
  const sourceLabels = sourceRefLabels(metadata.sourcesUsed ?? metadata.sourceRefs ?? metadata.sources, 8);
  const label = postTypeLabel(post.postType);
  const sources = Math.max(1, post.factCheckCount ?? sourceLabels.length);
  return {
    id: `li_${post._id}`,
    entity: firstMeaningfulLine(post.content).slice(0, 72),
    kind: label,
    status: post.postUrl || sources > 1 ? "verified" : "watching",
    description: excerpt(post.content, 220),
    sources,
    claims: Math.max(1, post.factCheckCount ?? 1),
    followUps: 0,
    updatedAt: timeAgoFrom(now, post.postedAt),
    updatedAtMs: post.postedAt,
    tags: [label, post.persona, post.dateString].filter(Boolean),
    detailNodes: [
      { id: "archive", title: "Archive post", subtitle: `${sources} sources`, tone: "blue", artifactType: "EVIDENCE" },
      { id: "persona", title: post.persona, subtitle: "persona", tone: "default", artifactType: "PACKET" },
    ],
    detailEdges: [
      { from: "archive", to: "persona", type: "correlates_with", label: "correlates", basis: "Archive artifact and persona context are part of the same published packet.", strength: 0.58 },
    ],
    sourceRows: sourceLabels.length
      ? sourceLabels.map((label, index) => ({ id: `source-${index}`, type: "source", title: label, confidence: post.postUrl ? 0.84 : 0.72, href: /^https?:\/\//.test(label) ? label : undefined }))
      : [{ id: "archive-row", type: label, title: post.postUrl ? "LinkedIn archive post" : "NodeBench archive row", confidence: post.postUrl ? 0.84 : 0.72, href: post.postUrl }],
  };
}

function dailyBriefToReport(memory: ReportTopologyDailyBriefMemory, now: number): ReportRow {
  const features = memory.features ?? [];
  const passing = features.filter((feature) => feature.status === "passing").length;
  const failing = features.filter((feature) => feature.status === "failing").length;
  const sources = Math.max(1, sourceRefCount(features.map((feature) => feature.sourceRefs)));
  const claims = Math.max(1, passing || features.length);
  return {
    id: `daily_${memory._id}`,
    entity: `Daily Brief - ${memory.dateString}`,
    kind: "Daily Brief",
    status: failing > 0 ? "review" : "verified",
    description: normalizeSpace(memory.goal || "Daily brief memory generated by NodeBench.").slice(0, 220),
    sources,
    claims,
    followUps: features.filter((feature) => feature.status !== "passing").length,
    updatedAt: timeAgoFrom(now, memory.generatedAt),
    updatedAtMs: memory.generatedAt,
    tags: ["Daily Brief", memory.dateString, ...features.slice(0, 3).map((feature) => feature.type)],
    detailNodes: features.slice(0, 8).map((feature) => ({
      id: feature.id,
      title: feature.name.slice(0, 28),
      subtitle: `${feature.type} - ${feature.status}`,
      tone: feature.status === "passing" ? "green" : feature.status === "pending" ? "blue" : "amber",
      artifactType: feature.status === "passing" ? "EVIDENCE" : "DASHBOARD",
    })),
    detailEdges: features.length >= 2 ? [
      { from: features[0].id, to: features[1].id, type: "causes", label: "causes", basis: "The first ranked signal changes the next artifact's review order.", strength: 0.74 },
      ...(features.length >= 3 ? [{ from: features[1].id, to: features[2].id, type: "correlates_with", label: "correlates", basis: "Adjacent daily brief artifacts share source timing or topic overlap.", strength: 0.66 }] : []),
    ] : [],
    sourceRows: features.slice(0, 8).map((feature, index) => ({
      id: feature.id || `feature-${index}`,
      type: feature.type,
      title: feature.name,
      confidence: feature.status === "passing" ? 0.86 : feature.status === "pending" ? 0.62 : 0.44,
    })),
  };
}

function addAttention(node: Omit<ReportTopologyGraphNode, "attentionScore" | "reasonSelected" | "attentionTier">): ReportTopologyGraphNode {
  return { ...node, ...defaultGraphAttention(node) };
}

export function buildRuntimeReportGraph(args: {
  posts: ReportTopologyArchivePost[];
  latestMemory?: ReportTopologyDailyBriefMemory | null;
  rootId?: string | null;
  mode: ReportTopologyScaleMode;
  now: number;
}): ReportTopologySnapshot["graph"] {
  const config = SCALE_CONFIG[args.mode];
  const reports = [
    ...(args.latestMemory ? [dailyBriefToReport(args.latestMemory, args.now)] : []),
    ...args.posts.map((post) => archiveToReport(post, args.now)),
  ];
  const rootReport = reports.find((report) => report.id === args.rootId) ?? reports[0] ?? null;
  if (!rootReport) {
    return { sourceLabel: "No live graph", sourceRows: 0, totalReportCount: 0, visibleReportCount: 0, hiddenReportCount: 0, nodes: [], links: [] };
  }
  const related = reports.filter((report) => report.id !== rootReport.id).slice(0, config.neighborReports);
  const visible = [rootReport, ...related];
  const hiddenReportCount = Math.max(0, reports.length - visible.length);
  const nodes: ReportTopologyGraphNode[] = [];
  const links: ReportTopologyGraphLink[] = [];
  const seenNodes = new Set<string>();
  const seenLinks = new Set<string>();
  const totalSources = visible.reduce((sum, report) => sum + report.sourceRows.length, 0);

  const addNode = (node: Omit<ReportTopologyGraphNode, "attentionScore" | "reasonSelected" | "attentionTier">) => {
    if (seenNodes.has(node.id)) return;
    seenNodes.add(node.id);
    nodes.push(addAttention(node));
  };
  const addLink = (link: ReportTopologyGraphLink) => {
    if (link.source === link.target) return;
    const key = `${link.source}->${link.target}:${link.type}:${link.label}`;
    if (seenLinks.has(key)) return;
    seenLinks.add(key);
    const sourceNode = nodes.find((node) => node.id === link.source);
    const targetNode = nodes.find((node) => node.id === link.target);
    const sourceRefs = link.sourceRefs ?? Number(sourceNode?.sources.match(/\d+/)?.[0] ?? targetNode?.sources.match(/\d+/)?.[0] ?? 0);
    const claimRefs = link.claimRefs ?? Number(sourceNode?.verified.match(/\d+/)?.[0] ?? targetNode?.verified.match(/\d+/)?.[0] ?? 0);
    const strength = link.strength ?? (link.type === "causes" ? 0.72 : link.type === "correlates_with" ? 0.64 : link.type === "has_report" || link.type === "has_artifact" ? 0.82 : 0.55);
    links.push({
      sourceRefs,
      claimRefs,
      strength,
      confidence: link.confidence ?? Math.max(0.35, Math.min(0.96, strength + Math.min(0.14, sourceRefs * 0.015) + Math.min(0.08, claimRefs * 0.01))),
      ...link,
    });
  };

  visible.forEach((report) => {
    const stage = stageFromReport(report);
    const entityGraphType = reportGraphType(report, stage);
    const entityId = entityNodeKey(report);
    const freshness = `Updated ${report.updatedAt}`;
    addNode({
      id: entityId,
      label: entityLabelForReport(report),
      type: entityGraphType === "brief" ? "Brief" : entityGraphType === "investor" ? "Investor" : entityGraphType === "person" ? "Person" : "Entity",
      graphType: entityGraphType,
      provenance: "entity",
      stage,
      weight: Math.max(1, report.sourceRows.length || report.sources),
      sources: `${Math.max(1, report.sourceRows.length || report.sources)} source rows`,
      freshness,
      staleHours: stage === "stale" ? Math.max(48, freshnessHours(freshness)) : freshnessHours(freshness),
      verified: `${report.claims} claims - ${stage}`,
      coverage: report.tags.slice(0, 4),
      signals: [report.description, `${report.followUps} follow-ups queued`].filter(Boolean),
    });
    addNode({
      id: report.id,
      label: report.entity,
      type: report.kind,
      graphType: "report",
      provenance: "report",
      stage,
      weight: Math.max(1, report.sourceRows.length || report.sources),
      sources: `${Math.max(1, report.sourceRows.length || report.sources)} source rows`,
      freshness,
      staleHours: stage === "stale" ? Math.max(48, freshnessHours(freshness)) : freshnessHours(freshness),
      verified: `${report.claims} claims - ${stage}`,
      coverage: report.tags.slice(0, 4),
      signals: [report.description, `${report.followUps} follow-ups queued`].filter(Boolean),
    });
    addLink({ source: entityId, target: report.id, type: "has_report", label: report.kind, basis: "Reports are durable child artifacts of the resolved entity." });
  });

  visible.forEach((report, reportIndex) => {
    const stage = stageFromReport(report);
    const artifactLimit = report.id === rootReport.id ? config.rootArtifacts : config.relatedArtifacts;
    report.detailNodes.slice(0, artifactLimit).forEach((item) => {
      const artifactId = liveNodeKey(report, item.id);
      addNode({
        id: artifactId,
        label: item.title,
        type: item.artifactType ?? "PACKET",
        graphType: "artifact",
        provenance: "artifact",
        stage: item.tone === "green" ? "verified" : item.tone === "amber" ? "review" : stage,
        weight: Math.max(1, report.sourceRows.length),
        sources: item.subtitle,
        freshness: `From ${report.entity}`,
        staleHours: freshnessHours(report.updatedAt),
        verified: `${report.claims} claims - ${report.sourceRows.length} sources`,
        coverage: [report.kind, item.artifactType ?? "PACKET", ...report.tags].slice(0, 4),
        signals: [item.title, item.subtitle, report.description].filter(Boolean).slice(0, 4),
      });
      addLink({ source: report.id, target: artifactId, type: "has_artifact", label: item.artifactType ?? "PACKET", basis: "Artifact is generated from this report packet." });
    });
    report.detailEdges.slice(0, 4).forEach((edge) => {
      const source = edge.from === "root" ? report.id : liveNodeKey(report, edge.from);
      const target = edge.to === "root" ? report.id : liveNodeKey(report, edge.to);
      addLink({ source, target, type: edge.type ?? "coverage", label: edge.label ?? "artifact edge", basis: edge.basis, strength: edge.strength });
    });
    if (reportIndex === 0) {
      report.sourceRows.slice(0, config.sourceRows).forEach((sourceRow) => {
        const sourceId = liveSourceKey(report, sourceRow.id);
        addNode({
          id: sourceId,
          label: sourceRow.title.slice(0, 38),
          type: sourceRow.type || "Source",
          graphType: "monitoring",
          provenance: "source",
          stage: (sourceRow.confidence ?? 0.72) >= 0.8 ? "verified" : "review",
          weight: 2,
          sources: sourceRow.href ? "Linked source row" : "Stored source row",
          freshness: `Refreshed ${report.updatedAt}`,
          staleHours: freshnessHours(report.updatedAt),
          verified: sourceRow.confidence ? `${Math.round(sourceRow.confidence * 100)}% source confidence` : "Source available",
          coverage: [sourceRow.type, "source", report.kind].filter(Boolean),
          signals: [sourceRow.title, sourceRow.href ?? "Convex source row"].filter(Boolean).slice(0, 3),
        });
        addLink({ source: report.id, target: sourceId, type: "evidence", label: sourceRow.type.slice(0, 24) || "source row" });
      });
    }
  });

  if (visible.length > 1) {
    addNode({
      id: "__portfolio_ai_infrastructure__",
      label: "AI Infrastructure",
      type: "Portfolio",
      graphType: "portfolio",
      provenance: "portfolio",
      stage: "monitoring",
      weight: Math.max(2, Math.min(10, visible.length)),
      sources: `${totalSources} source rows`,
      freshness: `${visible.length} covered reports`,
      staleHours: 0,
      verified: "Coverage graph ready",
      coverage: ["portfolio", "watchlist", "coverage"],
      signals: ["Cross-entity universe built from the visible Convex-backed report set.", "Portfolio artifacts show which reports move together."],
    });
    visible.slice(0, config.coveredEntities).forEach((report, index) => {
      addLink({ source: "__portfolio_ai_infrastructure__", target: entityNodeKey(report), type: "covers", label: index === 0 ? "strategic" : index === 1 ? "watch" : "coverage", strength: index === 0 ? 0.86 : 0.62 });
    });
  }

  const artifactIds = nodes.filter((node) => node.provenance === "artifact").map((node) => node.id);
  if (artifactIds.length >= 2 && config.relationEdges >= 1) addLink({ source: artifactIds[0], target: artifactIds[1], type: "causes", label: "causes", basis: "The lead artifact changes downstream review order.", strength: 0.74 });
  if (artifactIds.length >= 3 && config.relationEdges >= 2) addLink({ source: artifactIds[1], target: artifactIds[2], type: "correlates_with", label: "correlates", basis: "Artifacts share report context, source timing, or entity overlap.", strength: 0.66 });
  if (artifactIds.length >= 4 && config.relationEdges >= 3) addLink({ source: artifactIds[0], target: artifactIds[3], type: "causes", label: "causes", basis: "One artifact can influence multiple downstream artifacts.", strength: 0.61 });

  addNode({
    id: "__universe__",
    label: "AI Infra universe",
    type: "Universe",
    graphType: "monitoring",
    provenance: "universe",
    stage: "universe",
    weight: Math.max(1, Math.min(12, totalSources)),
    sources: `${totalSources} source rows`,
    freshness: `${reports.length} live reports`,
    staleHours: 0,
    verified: "All visible reports have a next step",
    coverage: ["reports", "sources", "claims"],
    signals: ["This graph is derived from live report artifacts.", "Open a node to jump into the durable notebook."],
  });
  addLink({ source: "__universe__", target: rootReport.id, type: "coverage", label: "active root" });
  related.slice(0, 4).forEach((report) => addLink({ source: "__universe__", target: entityNodeKey(report), type: graphEdgeType(report, stageFromReport(report)), label: "coverage" }));

  return {
    sourceLabel: "Convex persisted topology graph",
    sourceRows: totalSources,
    totalReportCount: reports.length,
    visibleReportCount: visible.length,
    hiddenReportCount,
    nodes,
    links,
  };
}

function edgeEndpoint(value: string | { id?: string } | undefined): string {
  if (typeof value === "object" && value?.id) return value.id;
  return String(value ?? "");
}

function sourceCount(value?: string): number {
  return Number(value?.match(/\d+(?:\.\d+)?/)?.[0] ?? 0);
}

function verifiedScore(value?: string): number {
  const text = (value ?? "").toLowerCase();
  const pct = Number(text.match(/(\d+(?:\.\d+)?)%/)?.[1] ?? NaN);
  if (Number.isFinite(pct)) return pct / 100;
  if (/verified|passed|ready/.test(text)) return 0.86;
  if (/review|pending|unknown/.test(text)) return 0.46;
  if (/failing|blocked|stale/.test(text)) return 0.22;
  return 0.58;
}

function normalizeColumns(rows: number[][]): number[][] {
  if (rows.length === 0) return [];
  const width = rows[0]?.length ?? 0;
  const mins = Array.from({ length: width }, (_, column) => Math.min(...rows.map((row) => row[column] ?? 0)));
  const maxs = Array.from({ length: width }, (_, column) => Math.max(...rows.map((row) => row[column] ?? 0)));
  return rows.map((row) => row.map((value, column) => {
    const range = maxs[column] - mins[column];
    if (range <= 1e-9) return 0.5;
    return (value - mins[column]) / range;
  }));
}

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(dot(vector, vector));
  if (magnitude <= 1e-9) return vector.map(() => 0);
  return vector.map((value) => value / magnitude);
}

function covarianceMatrix(rows: number[][]): number[][] {
  const width = rows[0]?.length ?? 0;
  const means = Array.from({ length: width }, (_, column) => rows.reduce((sum, row) => sum + (row[column] ?? 0), 0) / Math.max(1, rows.length));
  return Array.from({ length: width }, (_, rowIndex) =>
    Array.from({ length: width }, (_, columnIndex) => rows.reduce((sum, row) => sum + ((row[rowIndex] ?? 0) - means[rowIndex]) * ((row[columnIndex] ?? 0) - means[columnIndex]), 0) / Math.max(1, rows.length - 1)),
  );
}

function matVec(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => dot(row, vector));
}

function powerIteration(matrix: number[][], seedShift = 0): { vector: number[]; value: number } {
  const width = matrix.length;
  let vector = normalizeVector(Array.from({ length: width }, (_, index) => 1 + ((index + seedShift) % 3) * 0.17));
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const next = normalizeVector(matVec(matrix, vector));
    if (next.every((value) => Math.abs(value) < 1e-9)) break;
    vector = next;
  }
  return { vector, value: dot(vector, matVec(matrix, vector)) };
}

function deflate(matrix: number[][], eigen: { vector: number[]; value: number }): number[][] {
  return matrix.map((row, rowIndex) => row.map((value, columnIndex) => value - eigen.value * eigen.vector[rowIndex] * eigen.vector[columnIndex]));
}

function scaled(values: number[]): number[] {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min;
  if (range <= 1e-9) return values.map(() => 0.5);
  return values.map((value) => (value - min) / range);
}

function buildFeatureRows(nodes: ReportTopologyGraphNode[], links: ReportTopologyGraphLink[]) {
  const degree = new Map<string, number>();
  const causal = new Map<string, number>();
  links.forEach((link) => {
    const source = edgeEndpoint(link.source);
    const target = edgeEndpoint(link.target);
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
    if (link.type === "causes" || link.type === "correlates_with") {
      const score = (link.strength ?? 0.5) + (link.confidence ?? 0.5);
      causal.set(source, (causal.get(source) ?? 0) + score);
      causal.set(target, (causal.get(target) ?? 0) + score);
    }
  });
  const rawRows = nodes.map((node) => [
    clamp01((node.attentionScore ?? 0) / 100),
    degree.get(node.id) ?? 0,
    Math.max(1, node.weight ?? 1),
    sourceCount(node.sources),
    verifiedScore(node.verified),
    1 / (1 + Math.max(0, node.staleHours ?? 0) / 24),
    (node.signals?.length ?? 0) + (node.coverage?.length ?? 0) * 0.5,
    causal.get(node.id) ?? 0,
  ]);
  const normalized = normalizeColumns(rawRows);
  return nodes.map((node, index) => ({ node, raw: rawRows[index] ?? [], vector: normalized[index] ?? [] }));
}

function topLoadings(loadings: number[]) {
  return loadings
    .map((weight, index) => ({ label: FEATURE_LABELS[index] ?? `feature-${index}`, weight }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 3);
}

function buildMapperClusters(projections: Omit<ReportTopologyNodeProjection, "mapperClusterIds">[], links: ReportTopologyGraphLink[]) {
  const bins = 4;
  const overlap = 0.12;
  const adjacency = new Map<string, Set<string>>();
  links.forEach((link) => {
    const source = edgeEndpoint(link.source);
    const target = edgeEndpoint(link.target);
    if (!adjacency.has(source)) adjacency.set(source, new Set());
    if (!adjacency.has(target)) adjacency.set(target, new Set());
    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
  });
  const clusters: ReportTopologyMapperCluster[] = [];
  const nodeClusters: Record<string, string[]> = {};
  const binSize = 1 / bins;
  for (let bx = 0; bx < bins; bx += 1) {
    for (let by = 0; by < bins; by += 1) {
      const minX = bx * binSize - overlap;
      const maxX = (bx + 1) * binSize + overlap;
      const minY = by * binSize - overlap;
      const maxY = (by + 1) * binSize + overlap;
      const members = projections.filter((node) => node.x >= minX && node.x <= maxX && node.y >= minY && node.y <= maxY);
      const unvisited = new Set(members.map((node) => node.id));
      while (unvisited.size > 0) {
        const [start] = unvisited;
        if (!start) break;
        const queue = [start];
        const component = new Set<string>();
        unvisited.delete(start);
        while (queue.length > 0) {
          const current = queue.shift();
          if (!current) continue;
          component.add(current);
          adjacency.get(current)?.forEach((next) => {
            if (unvisited.has(next)) {
              unvisited.delete(next);
              queue.push(next);
            }
          });
        }
        const memberIds = [...component];
        const memberNodes = memberIds.map((id) => projections.find((node) => node.id === id)).filter((node): node is Omit<ReportTopologyNodeProjection, "mapperClusterIds"> => Boolean(node));
        if (memberNodes.length === 0) continue;
        const cluster = {
          id: `mapper:${bx}:${by}:${clusters.length}`,
          label: `Mapper ${bx + 1}.${by + 1}`,
          memberIds,
          x: memberNodes.reduce((sum, node) => sum + node.x, 0) / memberNodes.length,
          y: memberNodes.reduce((sum, node) => sum + node.y, 0) / memberNodes.length,
          densityScore: clamp100(memberNodes.reduce((sum, node) => sum + node.densityScore, 0) / memberNodes.length),
          attentionScore: clamp100(memberNodes.reduce((sum, node) => sum + node.attentionScore, 0) / memberNodes.length),
        };
        clusters.push(cluster);
        memberIds.forEach((id) => {
          nodeClusters[id] = [...(nodeClusters[id] ?? []), cluster.id];
        });
      }
    }
  }
  const edges: Array<{ source: string; target: string; sharedMembers: number }> = [];
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) {
      const a = clusters[i];
      const b = clusters[j];
      if (!a || !b) continue;
      const sharedMembers = a.memberIds.filter((id) => new Set(b.memberIds).has(id)).length;
      if (sharedMembers > 0) edges.push({ source: a.id, target: b.id, sharedMembers });
    }
  }
  return { clusters, edges, nodeClusters };
}

function buildTopology(nodes: ReportTopologyGraphNode[], links: ReportTopologyGraphLink[], view: ReportTopologyViewMode) {
  const rows = buildFeatureRows(nodes, links);
  const matrix = rows.length > 1 ? covarianceMatrix(rows.map((row) => row.vector)) : [];
  const first = matrix.length ? powerIteration(matrix, 0) : { vector: FEATURE_LABELS.map((_, index) => index === 0 ? 1 : 0), value: 0 };
  const second = matrix.length ? powerIteration(deflate(matrix, first), 1) : { vector: FEATURE_LABELS.map((_, index) => index === 1 ? 1 : 0), value: 0 };
  const pc1 = scaled(rows.map((row) => dot(row.vector, first.vector)));
  const pc2 = scaled(rows.map((row) => dot(row.vector, second.vector)));
  const centroid = rows[0]?.vector.map((_, column) => rows.reduce((sum, row) => sum + (row.vector[column] ?? 0), 0) / Math.max(1, rows.length)) ?? [];
  const distances = rows.map((row) => Math.sqrt(row.vector.reduce((sum, value, column) => sum + Math.pow(value - (centroid[column] ?? 0), 2), 0)));
  const distanceScaled = scaled(distances);
  const densityScaled = scaled(rows.map((row) => {
    const attention = row.vector[0] ?? 0;
    const degree = row.vector[1] ?? 0;
    const sources = row.vector[3] ?? 0;
    const verified = row.vector[4] ?? 0;
    const freshness = row.vector[5] ?? 0;
    const causalSignal = row.vector[7] ?? 0;
    return clamp01(attention * 0.34 + degree * 0.22 + sources * 0.16 + verified * 0.1 + freshness * 0.08 + causalSignal * 0.1);
  }));
  const withoutClusters = rows.map((row, index): Omit<ReportTopologyNodeProjection, "mapperClusterIds"> => {
    const density = densityScaled[index] ?? 0.5;
    const distance = distanceScaled[index] ?? 0;
    const angle = Math.atan2((pc2[index] ?? 0.5) - 0.5, (pc1[index] ?? 0.5) - 0.5);
    const radius = 0.08 + distance * 0.42;
    const centroidX = 0.5 + Math.cos(angle) * radius;
    const centroidY = 0.5 + Math.sin(angle) * radius;
    const coordinates = view === "density"
      ? { x: pc1[index] ?? 0.5, y: 1 - density }
      : view === "pca"
        ? { x: pc1[index] ?? 0.5, y: pc2[index] ?? 0.5 }
        : { x: clamp01(centroidX), y: clamp01(centroidY) };
    return {
      id: row.node.id,
      densityScore: clamp100(density * 100),
      attentionScore: clamp100(row.raw[0] * 100),
      degree: Math.round(row.raw[1] ?? 0),
      pc1: Number((pc1[index] ?? 0.5).toFixed(4)),
      pc2: Number((pc2[index] ?? 0.5).toFixed(4)),
      centroidDistance: Number(distance.toFixed(4)),
      outlierScore: clamp100(distance * 100),
      x: Number(coordinates.x.toFixed(4)),
      y: Number(coordinates.y.toFixed(4)),
    };
  });
  const mapper = buildMapperClusters(withoutClusters, links);
  const projected = withoutClusters.map((node) => ({ ...node, mapperClusterIds: mapper.nodeClusters[node.id] ?? [] }));
  const hotNode = [...projected].sort((a, b) => b.densityScore - a.densityScore)[0] ?? null;
  const centroidNode = [...projected].sort((a, b) => a.centroidDistance - b.centroidDistance)[0] ?? null;
  const outlierNode = [...projected].sort((a, b) => b.centroidDistance - a.centroidDistance)[0] ?? null;
  return {
    nodes: projected,
    nodesById: Object.fromEntries(projected.map((node) => [node.id, node])),
    mapperClusters: mapper.clusters,
    mapperEdges: mapper.edges,
    summary: {
      nodeCount: nodes.length,
      edgeCount: links.length,
      hotNodeId: hotNode?.id ?? null,
      centroidNodeId: centroidNode?.id ?? null,
      outlierNodeId: outlierNode?.id ?? null,
      clusterCount: mapper.clusters.length,
      viewRationale: view === "density"
        ? "Density ranks where human and agent attention repeatedly accumulates."
        : view === "pca"
          ? "PCA exposes the dominant axes separating reports, entities, sources, and artifacts."
          : "Centroid distance separates typical coverage-book nodes from edge-case outliers.",
    },
    pcaAxes: {
      pc1: topLoadings(first.vector),
      pc2: topLoadings(second.vector),
    },
  };
}

export function buildReportTopologySnapshot(args: {
  posts: ReportTopologyArchivePost[];
  latestMemory?: ReportTopologyDailyBriefMemory | null;
  rootId?: string | null;
  query?: string | null;
  stage?: string | null;
  kind?: string | null;
  mode: ReportTopologyScaleMode;
  view: ReportTopologyViewMode;
  limit?: number | null;
  now: number;
  ttlMs?: number;
}): ReportTopologySnapshot {
  const graph = buildRuntimeReportGraph({
    posts: args.posts,
    latestMemory: args.latestMemory,
    rootId: args.rootId,
    mode: args.mode,
    now: args.now,
  });
  const topology = buildTopology(graph.nodes, graph.links, args.view);
  const graphHash = cleanTextHash(JSON.stringify({
    nodes: graph.nodes.map((node) => [node.id, node.attentionScore, node.sources, node.verified, node.staleHours]),
    links: graph.links.map((link) => [link.source, link.target, link.type, link.strength, link.confidence]),
  }));
  return {
    snapshotKey: buildReportTopologyKey(args),
    graphHash,
    view: args.view,
    mode: args.mode,
    generatedAt: args.now,
    expiresAt: args.now + (args.ttlMs ?? 5 * 60 * 1000),
    persisted: false,
    source: "convex-computed",
    ...topology,
    graph,
  };
}
