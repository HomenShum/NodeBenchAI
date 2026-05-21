/**
 * Reports — the reusable memory library.
 *
 * Compact card pattern with three-action footer (Brief · Explore · Chat) per spec.
 * Default density: compact. Sticky filter row.
 */

import { useMemo, useState, useEffect, useRef, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import * as d3 from "d3";
import { memoStyles, reports as fixtureReports, type ReportCardData, type Density, type Universe } from "../fixtures";
import { Pill } from "../components/Pill";
import { ReportNotebookView } from "../components/ReportNotebookView";
import { useReportsLive } from "../hooks/useReportsLive";
import {
  useReportGraphNeighborhood,
  useReportTopologySnapshot,
  type LiveArtifactDetail,
  type LiveArtifactMapNode,
  type ReportGraphNeighborhoodScope,
  type ReportTopologySnapshotPacket,
} from "../hooks/useLiveArtifacts";
import { showToast } from "../components/Toast";
import {
  buildReportsDecisionQueue,
  ProductDecisionQueue,
  type ProductDecisionItem,
  sanitizeDecisionText,
} from "./ProductDecisionQueue";
import { buildGraphContextBridgePacket } from "../lib/graphContextBridge";
import {
  buildTopologySnapshot,
  type TopologyNodeProjection,
  type TopologySnapshot,
  type TopologyViewMode,
} from "../lib/reportTopology";

type SortKey = "updated" | "entity" | "sources" | "claims" | "status";
const SORT_OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: "updated", label: "Most recently updated" },
  { id: "entity",  label: "Entity name (A → Z)" },
  { id: "sources", label: "Most sources" },
  { id: "claims",  label: "Most claims" },
  { id: "status",  label: "Status (review first)" },
];

const STYLE_BY_REPORT: Record<string, string> = {
  default: "Founder / banker lens · v3",
};

function StyleChip({ reportId }: { reportId: string }) {
  const styleName = STYLE_BY_REPORT[reportId] ?? STYLE_BY_REPORT.default ?? memoStyles[0].name;
  const displayName = styleName
    .replace("Founder / banker lens", "Banker lens")
    .replace("Goldman banker brief", "Banker brief")
    .replace("Stratechery analysis", "Strategy analysis")
    .replace("Bessemer scorecard", "Cloud scorecard");
  return (
    <span className="rd-style-chip" title={`Style: ${styleName} — click to swap`}>
      {displayName}
    </span>
  );
}

function displayReportDescription(description: string): string {
  return sanitizeDecisionText(description)
    .replace(/\s*\|\s*confidence\s+\d+%/gi, "")
    .replace(/\bconfidence\s+\d+%/gi, "source review recorded")
    .replace(/\bexecutive confidence\s+\d+%\.?/gi, "executive review recorded.");
}

function graphScaleQaModeEnabled(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("qa") === "graph-scale-controls";
}

function buildGraphScaleQaReports(): ReportCardData[] {
  const seeds = fixtureReports.length > 0 ? fixtureReports : [{
    id: "qa_report",
    entity: "AI Infrastructure",
    kind: "Coverage",
    status: "review" as const,
    description: "Graph scale smoke dataset.",
    sources: 8,
    claims: 4,
    followUps: 1,
    updatedAt: "just now",
  }];
  return Array.from({ length: 72 }, (_, index) => {
    const base = seeds[index % seeds.length];
    const statusCycle: ReportCardData["status"][] = ["verified", "review", "watching"];
    return {
      ...base,
      id: `qa-scale-${index + 1}-${base.id}`,
      entity: index < seeds.length ? base.entity : `${base.entity} ${index + 1}`,
      status: statusCycle[index % statusCycle.length],
      sources: base.sources + (index % 9),
      claims: base.claims + (index % 5),
      followUps: (base.followUps + index) % 6,
      updatedAt: index % 4 === 0 ? "2h ago" : index % 4 === 1 ? "Yesterday" : index % 4 === 2 ? "4d ago" : "2w ago",
    };
  });
}

function buildGraphScaleQaDetails(reports: ReportCardData[]): LiveArtifactDetail[] {
  const now = Date.now();
  return reports.slice(0, 36).map((report, index) => ({
    id: report.id,
    title: report.entity,
    kind: report.kind,
    status: report.status,
    summary: displayReportDescription(report.description),
    updatedAt: report.updatedAt,
    updatedAtMs: now - index * 3_600_000,
    sourceCount: report.sources,
    claimCount: report.claims,
    followUps: report.followUps,
    tags: [report.kind.toLowerCase(), report.status, index % 2 === 0 ? "ai-infra" : "coverage"],
    sections: [
      { title: "Executive read", body: displayReportDescription(report.description) },
      { title: "Next action", body: report.followUps > 0 ? "Review follow-ups before exporting." : "Keep monitoring for new source rows." },
    ],
    sourceRows: Array.from({ length: Math.min(4, Math.max(1, report.sources)) }, (_, sourceIndex) => ({
      id: `src-${index + 1}-${sourceIndex + 1}`,
      type: sourceIndex === 0 ? "Primary" : "Evidence",
      title: `${report.entity} source row ${sourceIndex + 1}`,
      refreshed: sourceIndex === 0 ? "today" : "this week",
      reused: sourceIndex + 1,
      excerpt: `Reusable evidence row for ${report.entity}.`,
      status: sourceIndex === 0 ? "verified" : "review",
      confidence: sourceIndex === 0 ? 0.9 : 0.74,
    })),
    nodes: [
      { id: "summary", title: `${report.entity} summary`, subtitle: "Notebook artifact", tone: "blue", kind: "artifact", artifactType: "PACKET" },
      { id: "evidence", title: `${report.entity} evidence`, subtitle: `${report.sources} sources`, tone: "green", kind: "artifact", artifactType: "EVIDENCE" },
      { id: "action", title: `${report.entity} action queue`, subtitle: `${report.followUps} follow-ups`, tone: report.followUps > 0 ? "amber" : "green", kind: "artifact", artifactType: "DASHBOARD" },
    ],
    edges: [
      { from: "root", to: "summary", type: "has_artifact", label: "PACKET", basis: "Report produces a notebook packet." },
      { from: "summary", to: "evidence", type: index % 2 === 0 ? "causes" : "correlates_with", label: index % 2 === 0 ? "causes" : "correlates", basis: "Scale QA keeps multiple relation types visible.", strength: 0.7 },
      { from: "evidence", to: "action", type: "causes", label: "routes", basis: "Evidence quality drives follow-up routing.", strength: 0.64 },
    ],
    notebookHtml: `<h2>${report.entity}</h2><p>${displayReportDescription(report.description)}</p>`,
    primaryAction: report.followUps > 0 ? "Review follow-ups" : "Monitor",
  }));
}

interface ReportsSurfaceProps {
  onOpen: (id: string, tab: "brief" | "cards" | "chat") => void;
  onRunBatch?: (prompt: string, context?: { reportId?: string; artifactKey?: string }) => void;
  onSelectReport?: (report: ReportCardData) => void;
  inspectedReportId?: string | null;
}

type ReportViewMode = "gallery" | "board" | "table" | "graph";
type ReportStage = "drafting" | "review" | "verified" | "stale" | "monitoring";
type ReportBoardColumnId = ReportStage | "archived";
type ReportGraphScaleMode = "focus" | "clustered" | "expanded";
type ReportGraphLensMode = "force" | TopologyViewMode;
type ReportGraphTopologyLayer = "bridges" | "cycles";

const REPORT_VIEW_MODES: Array<{ id: ReportViewMode; label: string }> = [
  { id: "gallery", label: "Gallery" },
  { id: "board", label: "Board" },
  { id: "table", label: "Table" },
  { id: "graph", label: "Graph" },
];

const REPORT_GRAPH_SCALE_MODES: Array<{ id: ReportGraphScaleMode; label: string; hint: string }> = [
  { id: "focus", label: "Focus", hint: "Root report, closest neighbors, and core evidence only" },
  { id: "clustered", label: "Cluster", hint: "Bounded neighborhood plus overflow groups" },
  { id: "expanded", label: "Expand", hint: "Wider neighborhood, still capped for browser performance" },
];

const REPORT_GRAPH_LENS_MODES: Array<{ id: ReportGraphLensMode; label: string; hint: string }> = [
  { id: "force", label: "Force", hint: "Natural report, artifact, and entity relationship layout" },
  { id: "density", label: "Attention", hint: "Where human and agent attention keeps gravitating" },
  { id: "pca", label: "Variation", hint: "Dominant axes of variation across report graph features" },
  { id: "centroid", label: "Typicality", hint: "Typical center versus outlier edge cases" },
];

const REPORT_GRAPH_TOPOLOGY_LAYERS: Array<{ id: ReportGraphTopologyLayer; label: string; hint: string }> = [
  { id: "bridges", label: "Bridges", hint: "Bottleneck edges and nodes whose removal disconnects neighborhoods" },
  { id: "cycles", label: "Cycles", hint: "Circular relationship loops in the report and artifact graph" },
];

function topologyViewForLens(lens: ReportGraphLensMode): TopologyViewMode {
  return lens === "force" ? "density" : lens;
}

function reportViewFromUrl(): ReportViewMode {
  if (typeof window === "undefined") return "gallery";
  const view = new URLSearchParams(window.location.search).get("view");
  return REPORT_VIEW_MODES.some((item) => item.id === view) ? view as ReportViewMode : "gallery";
}

const REPORT_STAGE_COLUMNS: Array<{ id: ReportBoardColumnId; label: string; hint: string }> = [
  { id: "drafting", label: "Drafting", hint: "Gathering sources" },
  { id: "review", label: "Needs review", hint: "Claims need analyst review" },
  { id: "verified", label: "Verified", hint: "Notebook ready" },
  { id: "archived", label: "Archived", hint: "Stale or monitoring backlog" },
];

const STATUS_FILTERS: Array<{ id: "all" | ReportStage; label: string }> = [
  { id: "all", label: "All" },
  { id: "verified", label: "Verified" },
  { id: "review", label: "Review" },
  { id: "stale", label: "Stale" },
  { id: "drafting", label: "Drafting" },
];

const KIND_FILTERS = [
  { id: "all", label: "All types" },
  { id: "Diligence", label: "Diligence" },
  { id: "Event", label: "Events" },
  { id: "Theme", label: "Themes" },
  { id: "Coverage", label: "Coverage" },
] as const;

export function ReportsSurface({ onOpen, onRunBatch, onSelectReport, inspectedReportId }: ReportsSurfaceProps) {
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]["id"]>("all");
  const [kindFilter, setKindFilter] = useState<typeof KIND_FILTERS[number]["id"]>("all");
  const [density, setDensity] = useState<Density>("compact");
  const [viewMode, setViewMode] = useState<ReportViewMode>(() => reportViewFromUrl());
  const [query, setQuery] = useState("");
  const [inlineFilterOpen, setInlineFilterOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortOpen, setSortOpen] = useState(false);
  const [stageOverrides, setStageOverrides] = useState<Record<string, ReportStage>>({});
  const [graphSelectedReportId, setGraphSelectedReportId] = useState<string | null>(null);
  const [graphScaleMode, setGraphScaleMode] = useState<ReportGraphScaleMode>("clustered");
  const [notebookReportId, setNotebookReportId] = useState<string | null>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const inlineFilterRef = useRef<HTMLInputElement>(null);

  // Click-outside dismiss for sort dropdown
  useEffect(() => {
    if (!sortOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!sortRef.current?.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [sortOpen]);

  useEffect(() => {
    if (!inlineFilterOpen) return;
    inlineFilterRef.current?.focus();
  }, [inlineFilterOpen]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        setInlineFilterOpen(true);
      }
      if (event.key === "Escape") {
        setInlineFilterOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Live data wiring: authenticated and anonymous workspaces show source-backed
  // runs/artifacts. Empty states remain explicit so production never masks a
  // broken live path with fixture reports.
  const {
    reports: liveReports,
    details: liveDetails,
    isLive: liveIsLive,
    isLoading: liveIsLoading,
    sourceLabel: liveSourceLabel,
    liveCount: liveArtifactCount,
  } = useReportsLive();
  const graphScaleQaEnabled = graphScaleQaModeEnabled();
  const qaReports = useMemo(() => graphScaleQaEnabled ? buildGraphScaleQaReports() : [], [graphScaleQaEnabled]);
  const qaDetails = useMemo(() => graphScaleQaEnabled ? buildGraphScaleQaDetails(qaReports) : [], [graphScaleQaEnabled, qaReports]);
  const useGraphScaleQaData = graphScaleQaEnabled && liveReports.length === 0;
  const reports = useGraphScaleQaData ? qaReports : liveReports;
  const details = useGraphScaleQaData ? qaDetails : liveDetails;
  const isLive = useGraphScaleQaData ? true : liveIsLive;
  const isLoading = useGraphScaleQaData ? false : liveIsLoading;
  const sourceLabel = useGraphScaleQaData ? "Graph scale QA fixture (dev only)" : liveSourceLabel;
  const liveCount = useGraphScaleQaData ? reports.length : liveArtifactCount;

  const toggleSelect = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const clearSelection = () => setSelected(new Set());

  // Status facet counts use workflow state, not arbitrary score bands.
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: reports.length, verified: 0, review: 0, stale: 0, drafting: 0 };
    for (const r of reports) {
      const stage = getReportStage(r, stageOverrides[r.id]);
      c[stage] = (c[stage] ?? 0) + 1;
    }
    return c;
  }, [reports, stageOverrides]);

  const filtered = useMemo(() => {
    const base = reports.filter((r) => {
      const stage = getReportStage(r, stageOverrides[r.id]);
      if (filter !== "all" && stage !== filter) return false;
      if (kindFilter !== "all" && r.kind !== kindFilter) return false;
      if (query && !`${r.entity} ${r.description}`.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
    const statusRank: Record<ReportStage, number> = { review: 0, stale: 1, drafting: 2, monitoring: 3, verified: 4 };
    return [...base].sort((a, b) => {
      switch (sortKey) {
        case "entity":  return a.entity.localeCompare(b.entity);
        case "sources": return b.sources - a.sources;
        case "claims":  return b.claims - a.claims;
        case "status":  return statusRank[getReportStage(a, stageOverrides[a.id])] - statusRank[getReportStage(b, stageOverrides[b.id])];
        case "updated":
        default: return 0; // live query order is already recency-ranked
      }
    });
  }, [reports, filter, kindFilter, query, sortKey, stageOverrides]);

  useEffect(() => {
    if (!onSelectReport || filtered.length === 0) return;
    if (inspectedReportId) return;
    onSelectReport(filtered[0]);
  }, [filtered, inspectedReportId, onSelectReport]);

  const hasActiveFilter = filter !== "all" || kindFilter !== "all" || query.length > 0;
  const resetFilters = () => { setFilter("all"); setKindFilter("all"); setQuery(""); };
  const setReportViewMode = (nextViewMode: ReportViewMode) => {
    setNotebookReportId(null);
    setViewMode(nextViewMode);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (nextViewMode === "gallery") url.searchParams.delete("view");
    else url.searchParams.set("view", nextViewMode);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const reportDecisionQueue = useMemo(
    () => buildReportsDecisionQueue(filtered.length > 0 ? filtered : reports),
    [filtered, reports],
  );
  const openDecisionItem = (item: ProductDecisionItem) => {
    if (item.reportId) onOpen(item.reportId, "brief");
  };
  const bulkExport = (format: "csv" | "markdown" | "notion" | "hubspot") => {
    showToast({
      tone: "success",
      message: `Prepared a local ${format.toUpperCase()} preview for ${selected.size} report${selected.size === 1 ? "" : "s"}. Connector writes still require approval.`,
      action: { label: "Preview", onClick: () => { /* future: open downloads pane */ } },
    });
    setSelected(new Set());
  };
  const bulkRefresh = () => {
    showToast({
      tone: "info",
      message: `Refresh preview queued locally for ${selected.size} entit${selected.size === 1 ? "y" : "ies"}. Live source refresh runs from Chat or scheduled agents.`,
    });
    setSelected(new Set());
  };

  const visibleReports = filtered.slice(0, 24);
  const verifiedShare = reports.length > 0 ? Math.round(((counts.verified ?? 0) / reports.length) * 100) : 0;
  const totalSources = filtered.reduce((sum, report) => sum + report.sources, 0);
  const reviewCount = filtered.filter((report) => getReportStage(report, stageOverrides[report.id]) === "review").length;
  const staleCount = filtered.filter((report) => getReportStage(report, stageOverrides[report.id]) === "stale").length;
  const draftingCount = filtered.filter((report) => getReportStage(report, stageOverrides[report.id]) === "drafting").length;
  const selectedReport = filtered.find((report) => report.id === (graphSelectedReportId ?? inspectedReportId)) ?? visibleReports[0] ?? null;
  const graphNeighborhood = useReportGraphNeighborhood(
    {
      rootId: selectedReport?.id ?? inspectedReportId ?? undefined,
      query,
      stage: filter === "all" ? undefined : filter,
      kind: kindFilter === "all" ? undefined : kindFilter,
      mode: graphScaleMode,
    },
    { enabled: viewMode === "graph" && !useGraphScaleQaData },
  );
  const graphReports = !useGraphScaleQaData && graphNeighborhood.isLive ? graphNeighborhood.reports : filtered;
  const graphDetails = !useGraphScaleQaData && graphNeighborhood.isLive ? graphNeighborhood.details : details;
  const graphSelectedReport = graphReports.find((report) => report.id === (graphSelectedReportId ?? inspectedReportId ?? selectedReport?.id)) ?? graphReports[0] ?? selectedReport;
  const handleSelectReport = (report: ReportCardData) => {
    setGraphSelectedReportId(report.id);
    onSelectReport?.(report);
  };
  const openNotebook = (reportId: string) => {
    const report = reports.find((item) => item.id === reportId) ?? filtered.find((item) => item.id === reportId) ?? null;
    if (report) handleSelectReport(report);
    setNotebookReportId(reportId);
  };
  const openReportAction: ReportsSurfaceProps["onOpen"] = (id, tab) => {
    if (tab === "brief") {
      openNotebook(id);
      return;
    }
    onOpen(id, tab);
  };
  const runBatchPrompt = () => {
    const prompt = "Run a coverage batch for my active report universe. Generate notebook-first reports, gather sources, extract claims, verify evidence, and create the review queue.";
    if (onRunBatch) onRunBatch(prompt);
    else onOpen("new", "chat");
  };
  const handleDragStart = (event: DragEvent<HTMLElement>, reportId: string) => {
    event.dataTransfer.setData("text/plain", reportId);
    event.dataTransfer.effectAllowed = "move";
  };
  const handleStageDrop = (event: DragEvent<HTMLElement>, stage: ReportBoardColumnId) => {
    event.preventDefault();
    const reportId = event.dataTransfer.getData("text/plain");
    if (!reportId) return;
    const nextStage: ReportStage = stage === "archived" ? "stale" : stage;
    setStageOverrides((prev) => ({ ...prev, [reportId]: nextStage }));
    showToast({ tone: "success", message: `Moved report to ${stageLabel(stage)}. This is a local review-board preview until a write is approved.` });
  };
  const notebookDetail = notebookReportId ? details.find((detail) => detail.id === notebookReportId) : undefined;

  return (
    <div className="rd-v3-reports center-content" data-view={viewMode}>
      <header className="rd-v3-universe-header universe-header">
        <div>
          <div className="rd-v3-kicker">Reports</div>
          <h1 className="universe-title">AI Infrastructure Coverage</h1>
          <p className="universe-meta">
            <span className="universe-meta__dot" aria-hidden="true" />
            {isLoading && reports.length === 0
              ? "Checking saved report artifacts."
              : `${reports.length} reports, ${totalSources} sources, ${reviewCount} need review.`}
          </p>
        </div>
        <div className="rd-v3-universe-actions">
          <button type="button" onClick={() => setReportViewMode("board")}>Review queue</button>
          <button type="button" className="rd-v3-primary" onClick={runBatchPrompt}>+ New batch</button>
        </div>
      </header>
      <section className="rd-v3-metrics" aria-label="Coverage metrics">
        <span><strong>{reports.length}</strong> reports</span>
        <span><strong>{verifiedShare}%</strong> verified</span>
        <span><strong>{reviewCount}</strong> need review</span>
        <span><strong>{staleCount}</strong> stale</span>
        <span><strong>{draftingCount}</strong> drafting</span>
      </section>
      {notebookReportId ? (
        <ReportInlineNotebook
          reportId={notebookReportId}
          liveDetail={notebookDetail}
          onBack={() => setNotebookReportId(null)}
          onOpenWorkspace={() => onOpen(notebookReportId, "brief")}
        />
      ) : (
      <>
      <div className="rd-v3-view-bar view-bar">
        <div className="rd-v3-tabs view-tabs" role="tablist" aria-label="Report views">
          {REPORT_VIEW_MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={viewMode === item.id}
              className={`view-tab ${viewMode === item.id ? "is-active active" : ""}`}
              onClick={() => setReportViewMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      <div className="rd-v3-filter-pills status-pills" role="tablist" aria-label="Filter reports by status">
        {STATUS_FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`status-pill ${filter === item.id ? "is-active active" : ""}`}
            aria-selected={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label} <span className="pill-count">{counts[item.id] ?? 0}</span>
          </button>
        ))}
        <button type="button" className={`status-pill ${kindFilter !== "all" ? "is-active active" : ""}`} onClick={() => setKindFilter(kindFilter === "all" ? "Diligence" : "all")}>
          {kindFilter === "all" ? "Type" : kindFilter}
        </button>
      </div>
      <div className="rd-v3-sort" style={{ position: "relative" }}>
        <button type="button" onClick={() => setSortOpen((v) => !v)}>
          {SORT_OPTIONS.find((s) => s.id === sortKey)?.label.split(" (")[0] ?? "Updated"} ▾
        </button>
        {sortOpen && (
          <div className="rd-sort__menu" role="menu" style={{ left: 0, top: 36 }}>
            {SORT_OPTIONS.map((s) => (
              <button
                key={s.id}
                role="menuitemradio"
                aria-selected={sortKey === s.id}
                className="rd-sort__option"
                onClick={() => { setSortKey(s.id); setSortOpen(false); }}
              >
                <span aria-hidden="true">{sortKey === s.id ? "✓" : ""}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="view-filter-wrap" data-open={inlineFilterOpen || query ? "true" : "false"}>
        {!inlineFilterOpen && !query ? (
          <button
            className="view-filter-trigger"
            type="button"
            aria-label="Filter current view"
            onClick={() => setInlineFilterOpen(true)}
          >
            ⌕ Filter <span className="kbd">/</span>
          </button>
        ) : (
          <>
            <span className="view-filter-icon" aria-hidden="true">⌕</span>
            <input
              ref={inlineFilterRef}
              className="view-filter-input"
              type="text"
              placeholder="Filter reports..."
              aria-label="Filter reports in current view"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setInlineFilterOpen(false);
              }}
            />
            <span className="view-filter-count">{query ? filtered.length : ""}</span>
          </>
        )}
      </div>
      </div>
      <div className="rd-v3-search-row" aria-label="Search reports">
        <label className="rd-sr-only" htmlFor="reports-v3-search">Search reports</label>
        <input
          id="reports-v3-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={isLive ? `Search ${reports.length} reports, sources, claims...` : "Search reports, sources, claims..."}
        />
        <button type="button" onClick={() => showToast({ tone: isLive ? "success" : "info", message: isLive ? `${sourceLabel}. Reports are live.` : "No reports returned yet. Start in Chat to create the first report." })}>
          {isLive ? "Live memory" : "Create first report"}
        </button>
        {query && <button type="button" onClick={resetFilters}>Clear</button>}
      </div>
      {isLoading && visibleReports.length === 0 ? (
        /* Skeleton loading — prevent flash of "No live coverage" before Convex resolves */
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 0" }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rd-v3-card"
              style={{
                height: 88,
                background: "var(--rd-surface-raised, rgba(255,255,255,0.03))",
                borderRadius: 12,
                opacity: 0.55,
                animation: "rd-skeleton-pulse 1.4s ease-in-out infinite",
                animationDelay: `${i * 120}ms`,
              }}
            />
          ))}
        </div>
      ) : visibleReports.length === 0 ? (
        <article className="rd-v3-card rd-v3-card--empty">
          <h2>{hasActiveFilter ? "No matching live reports" : "No live coverage returned"}</h2>
          <p>
            {hasActiveFilter
              ? "Clear the filters to return to the live report set."
              : "No reports yet. Run research from Chat to create the first report."}
          </p>
          <button type="button" onClick={hasActiveFilter ? resetFilters : () => onOpen("new", "chat")}>
            {hasActiveFilter ? "Clear filters" : "+ Start in Chat"}
          </button>
        </article>
      ) : viewMode === "board" ? (
        <ReportBoard
          reports={visibleReports}
          stageOverrides={stageOverrides}
          onDragStart={handleDragStart}
          onStageDrop={handleStageDrop}
          onOpen={openReportAction}
          onSelect={handleSelectReport}
        />
      ) : viewMode === "table" ? (
        <ReportTable reports={visibleReports} stageOverrides={stageOverrides} onOpen={openReportAction} onSelect={handleSelectReport} />
      ) : viewMode === "graph" ? (
        <ReportGraphPreviewD3
          reports={graphReports}
          details={graphDetails}
          selectedReport={graphSelectedReport}
          serverScope={!useGraphScaleQaData ? graphNeighborhood.scope : null}
          topologyScope={!useGraphScaleQaData ? {
            query,
            stage: filter === "all" ? undefined : filter,
            kind: kindFilter === "all" ? undefined : kindFilter,
          } : null}
          scaleMode={graphScaleMode}
          onScaleModeChange={setGraphScaleMode}
          stageOverrides={stageOverrides}
          onOpen={openReportAction}
          onSelect={handleSelectReport}
          onRunBatch={onRunBatch}
        />
      ) : (
        <div className="rd-v3-grid" data-density={density}>
          {visibleReports.map((report) => (
            <ReportCardV3
              key={report.id}
              report={report}
              detail={detailForReport(details, report)}
              active={inspectedReportId === report.id}
              stage={getReportStage(report, stageOverrides[report.id])}
              sourceLabel={sourceLabel}
              onOpen={openReportAction}
              onSelect={handleSelectReport}
            />
          ))}
          <article className="rd-v3-card rd-v3-card--add">
            <h2>Run a batch</h2>
            <p>Import companies, people, or topics and let the agent generate notebooks, claims, sources, and review tasks.</p>
            <button type="button" onClick={runBatchPrompt}>+ New batch</button>
          </article>
        </div>
      )}
      {filtered.length > visibleReports.length && (
        <button className="rd-v3-show-more" type="button" onClick={() => showToast({ tone: "info", message: `${filtered.length - visibleReports.length} more live reports are available through search and filters.` })}>
          Show {filtered.length - visibleReports.length} more reports
        </button>
      )}
      </>
      )}
    </div>
  );

  return (
    <div className="rd-stack" style={{ padding: "32px 40px 40px", gap: 20, maxWidth: 1440 }}>
      <header className="rd-stack" style={{ gap: 12 }}>
        <div className="rd-row" style={{ gap: 8, alignItems: "center" }}>
          <div className="rd-eyebrow">Reports</div>
          {isLive ? (
            <Pill tone="green" title="Showing saved live artifacts from batch runs, daily briefs, or the LinkedIn archive">
              <span className="rd-dot rd-dot--live" />{sourceLabel}
            </Pill>
          ) : isLoading && reports.length === 0 ? (
            <Pill tone="amber">Loading live coverage…</Pill>
          ) : isLoading ? (
            <Pill title="Checking for saved public and private artifacts.">
              Checking live data
            </Pill>
          ) : (
            <Pill title="No live report artifacts were returned for this session.">
              No live reports yet
            </Pill>
          )}
        </div>
        <h1 className="rd-h1">Reusable memory library</h1>
        <p className="rd-faint" style={{ maxWidth: 640 }}>
          A report is not a saved answer — it's a living entity workspace. Notebook, prior chats, claims, sources,
          follow-ups, and graph relationships, all in one place.
        </p>
      </header>

      <ProductDecisionQueue
        compact
        eyebrow="Review queue"
        title="Open the report that needs a decision first."
        subtitle="The library stays searchable, but the first useful move is ranked by review state, follow-ups, and source depth."
        items={reportDecisionQueue}
        emptyLabel="No report review queue yet. Run research from Chat to create the first live artifact."
        onOpenItem={openDecisionItem}
      />

      {/* Crunchbase / Pitchbook style filter bar — search + facets + density */}
      <div className="rd-reports-filterbar">
        <div className="rd-reports-filterbar__search">
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isLive
              ? `Search ${reports.length.toLocaleString()} live reports by entity, claim, source, or tag...`
              : "Search live reports by entity, claim, source, or tag..."
            }
            aria-label="Search reports"
          />
          {query && (
            <button
              type="button"
              className="rd-reports-filterbar__clear"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >×</button>
          )}
          <span className="rd-mono rd-reports-filterbar__kbd">⌘K</span>
        </div>

        <div className="rd-reports-filterbar__facets">
          <div className="rd-facet">
            <span className="rd-facet__label">Status</span>
            <div className="rd-facet__chips" role="tablist" aria-label="Filter by status">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={filter === f.id}
                  className="rd-facet__chip"
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                  <span className="rd-facet__count">{counts[f.id] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rd-facet">
            <span className="rd-facet__label">Type</span>
            <div className="rd-facet__chips" role="tablist" aria-label="Filter by type">
              {KIND_FILTERS.map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={kindFilter === f.id}
                  className="rd-facet__chip"
                  onClick={() => setKindFilter(f.id)}
                >{f.label}</button>
              ))}
            </div>
          </div>

          <div className="rd-facet rd-facet--right">
            <div className="rd-sort" ref={sortRef}>
              <button
                type="button"
                className="rd-sort__btn"
                onClick={() => setSortOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={sortOpen}
              >
                Sort: {SORT_OPTIONS.find((s) => s.id === sortKey)?.label.split(" (")[0]}
                <span aria-hidden="true">▾</span>
              </button>
              {sortOpen && (
                <div className="rd-sort__menu" role="menu">
                  {SORT_OPTIONS.map((s) => (
                    <button
                      key={s.id}
                      role="menuitemradio"
                      aria-selected={sortKey === s.id}
                      className="rd-sort__option"
                      onClick={() => { setSortKey(s.id); setSortOpen(false); }}
                    >
                      <span aria-hidden="true">{sortKey === s.id ? "✓" : ""}</span>
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="rd-facet__label">View</span>
            <div className="rd-facet__chips" role="radiogroup" aria-label="Density">
              {(["compact", "grid", "list"] as Density[]).map((d) => (
                <button
                  key={d}
                  role="radio"
                  aria-checked={density === d}
                  aria-selected={density === d}
                  className="rd-facet__chip"
                  onClick={() => setDensity(d)}
                  style={{ textTransform: "capitalize" }}
                >{d}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Universe sections group reports by coverage area. When live artifacts exist,
          use a real artifact header instead of presenting starter universes as live. */}
      {isLive ? (
        <LiveArtifactSection reportCount={liveCount} reviewCount={counts.review ?? 0} sourceLabel={sourceLabel} />
      ) : isLoading ? (
        <LiveArtifactSection reportCount={0} reviewCount={0} sourceLabel="Checking live artifacts" />
      ) : (
        <ReportsLiveEmptyState />
      )}

      {/* Bulk action bar — appears when ≥1 selected */}
      {selected.size > 0 && (
        <div className="rd-bulk-bar">
          <span className="rd-bulk-bar__count">{selected.size} selected</span>
          <div className="rd-row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={bulkRefresh}>Refresh preview</button>
            <button
              className="rd-btn rd-btn--quiet rd-btn--sm"
              onClick={() => showToast({ tone: "info", message: `Local review rubric queued for ${selected.size} selected report${selected.size === 1 ? "" : "s"}. Run Chat to persist a source-backed artifact.` })}
            >
              Rubric preview
            </button>
            <button
              className="rd-btn rd-btn--quiet rd-btn--sm"
              onClick={() => showToast({ tone: "info", message: `Compare preview prepared for ${selected.size} selected report${selected.size === 1 ? "" : "s"}.` })}
            >
              Compare preview
            </button>
            <span style={{ width: 1, height: 16, background: "var(--rd-line)" }} aria-hidden="true" />
            <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => bulkExport("csv")}>CSV preview</button>
            <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => bulkExport("markdown")}>Markdown preview</button>
            <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => bulkExport("notion")}>Notion preview</button>
            <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => bulkExport("hubspot")}>HubSpot preview</button>
            <span style={{ width: 1, height: 16, background: "var(--rd-line)" }} aria-hidden="true" />
            <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={clearSelection}>Cancel</button>
          </div>
        </div>
      )}

      <ReportGrid
        reports={filtered}
        density={density}
        onOpen={onOpen}
        selected={selected}
        onToggleSelect={toggleSelect}
        hasActiveFilter={hasActiveFilter}
        onResetFilters={resetFilters}
        inspectedReportId={inspectedReportId}
        onSelectReport={onSelectReport}
      />
    </div>
  );
}

function ReportInlineNotebook({
  reportId,
  liveDetail,
  onBack,
  onOpenWorkspace,
}: {
  reportId: string;
  liveDetail?: LiveArtifactDetail;
  onBack: () => void;
  onOpenWorkspace: () => void;
}) {
  return (
    <section className="rd-v3-notebook-shell" aria-label="Report notebook">
      <div className="rd-v3-notebook-topbar">
        <button type="button" onClick={onBack}>Back to reports</button>
        <div>
          <strong>{liveDetail?.title ?? "Report notebook"}</strong>
          <span>
            {liveDetail
              ? `${liveDetail.sourceRows.length} sources - ${liveDetail.nodes.length} graph nodes - Style: Banking Coverage Memo`
              : "Style: Banking Coverage Memo"}
          </span>
        </div>
        <button type="button" onClick={onOpenWorkspace}>Open workspace</button>
      </div>
      <ReportNotebookView reportId={reportId} liveDetail={liveDetail} showSidebar />
    </section>
  );
}

function getReportStage(report: ReportCardData, override?: ReportStage): ReportStage {
  if (override) return override;
  if (report.status === "review") return "review";
  if (report.status === "watching") return "monitoring";
  const staleSignals = /stale|expired|refresh|old|3d|5d|week/i.test(`${report.description} ${report.updatedAt}`);
  if (staleSignals) return "stale";
  if (report.sources <= 2 || /draft|gathering|queued|generating/i.test(report.description)) return "drafting";
  return "verified";
}

function stageLabel(stage: ReportBoardColumnId): string {
  if (stage === "archived") return "Archived";
  return REPORT_STAGE_COLUMNS.find((item) => item.id === stage)?.label ?? stage;
}

function stageTone(stage: ReportStage): "green" | "amber" | "blue" | undefined {
  if (stage === "verified") return "green";
  if (stage === "review" || stage === "stale" || stage === "drafting") return "amber";
  if (stage === "monitoring") return "blue";
  return undefined;
}

function boardColumnMatches(stage: ReportStage, column: ReportBoardColumnId): boolean {
  if (column === "archived") return stage === "stale" || stage === "monitoring";
  return stage === column;
}

function reportSignals(report: ReportCardData): string[] {
  const kind = report.kind || "Coverage";
  const signals = [kind, report.sources > 5 ? "source-rich" : "needs sources", report.followUps > 0 ? "actionable" : "monitor"];
  return Array.from(new Set(signals)).slice(0, 3);
}

function reportBacklinks(report: ReportCardData): string[] {
  const words = report.description
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .filter((word) => word.length > 4 && /^[A-Z]/.test(word));
  return Array.from(new Set(words)).slice(0, 3);
}

function reportIconType(report: ReportCardData): "company" | "funding" | "brief" | "person" {
  const text = `${report.kind} ${report.entity} ${report.description}`.toLowerCase();
  if (/daily|brief|edition|digest/.test(text)) return "brief";
  if (/funding|series|raise|capital|investor|term sheet/.test(text)) return "funding";
  if (/person|founder|ceo|partner|amodei|altman/.test(text)) return "person";
  return "company";
}

function signalColor(index: number): "blue" | "purple" | "green" | "amber" | "red" {
  return ["blue", "purple", "green", "amber", "red"][index % 5] as "blue" | "purple" | "green" | "amber" | "red";
}

function notebookState(stage: ReportStage): string {
  if (stage === "verified" || stage === "monitoring") return "Notebook ready";
  if (stage === "review") return "Review patch";
  if (stage === "stale") return "Refresh needed";
  return "Drafting";
}

function notebookStateToken(stage: ReportStage): "ready" | "draft" | "stale" {
  if (stage === "verified" || stage === "monitoring") return "ready";
  if (stage === "stale") return "stale";
  return "draft";
}

function evidenceText(report: ReportCardData, stage: ReportStage): string {
  if (stage === "drafting") return "Gathering sources...";
  if (stage === "stale") return `${Math.max(1, Math.min(report.claims, Math.ceil(report.claims / 2)))} of ${Math.max(1, report.claims)} claims need refresh`;
  if (stage === "review") return `${Math.max(1, report.followUps || 1)} claim${(report.followUps || 1) === 1 ? "" : "s"} need review`;
  return `${Math.max(1, report.claims)} of ${Math.max(1, report.claims)} claims verified`;
}

function freshnessText(report: ReportCardData, stage: ReportStage): string {
  if (stage === "stale") return `Last checked ${report.updatedAt}`;
  if (stage === "drafting") return "Started recently";
  return `Updated ${report.updatedAt}`;
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
  if (/\bmo|month/.test(text)) return number * 24 * 30;
  return number;
}

function reportGraphType(report: ReportCardData, stage: ReportStage): ReportGraphNode["graphType"] {
  const text = `${report.kind} ${report.entity} ${report.description}`.toLowerCase();
  if (/daily|brief|edition|digest/.test(text)) return "brief";
  if (/sequoia|capital|ventures|fund|investor|partner/.test(text)) return "investor";
  if (/person|founder|ceo|partner|investor|amodei|altman|lin/.test(text)) return "person";
  if (stage === "monitoring" || /watch|monitor/.test(text)) return "monitoring";
  return "company";
}

type ReportGraphNode = {
  id: string;
  label: string;
  type: string;
  graphType: "company" | "person" | "investor" | "brief" | "monitoring" | "report" | "artifact" | "portfolio" | "cluster";
  weight: number;
  report?: ReportCardData;
  detail?: LiveArtifactDetail;
  provenance: "universe" | "entity" | "report" | "artifact" | "source" | "portfolio" | "cluster";
  liveNodeId?: string;
  artifactKey?: string;
  artifactType?: string;
  stage: ReportStage | "universe";
  x: number;
  y: number;
  radius: number;
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

type ReportGraphLink = {
  source: string;
  target: string;
  type:
    | "coverage"
    | "evidence"
    | "review"
    | "drafting"
    | "cluster"
    | "funding"
    | "competition"
    | "integration"
    | "leadership"
    | "history"
    | "has_report"
    | "has_artifact"
    | "covers"
    | "causes"
    | "correlates_with";
  label: string;
  basis?: string;
  strength?: number;
  confidence?: number;
  sourceRefs?: number;
  claimRefs?: number;
  timeWindow?: string;
  directionNote?: string;
};

type ReportGraphData = {
  nodes: ReportGraphNode[];
  links: ReportGraphLink[];
  root: ReportGraphNode | null;
  sourceLabel: string;
  sourceRows: number;
  artifactNodeCount: number;
  artifactEdgeCount: number;
  totalReportCount: number;
  visibleReportCount: number;
  hiddenReportCount: number;
  clusteredReportCount: number;
  nodeBudget: number;
  edgeBudget: number;
  rawEdgeCount: number;
  scaleMode: ReportGraphScaleMode;
};

type ReportGraphBuildOptions = {
  scaleMode: ReportGraphScaleMode;
};

type ReportGraphScaleConfig = {
  neighborReports: number;
  rootArtifacts: number;
  relatedArtifacts: number;
  sourceRows: number;
  coveredEntities: number;
  relationEdges: number;
  nodeBudget: number;
  edgeBudget: number;
  clusterOverflow: boolean;
};

type ReportGraphTopologyLayerSummary = {
  bridgeNodeIds: Set<string>;
  bridgeEdgeKeys: Set<string>;
  cycleNodeIds: Set<string>;
  cycleEdgeKeys: Set<string>;
  bridgeCount: number;
  cycleCount: number;
};

function graphTopologyEdgeKey(source: string, target: string): string {
  return [source, target].sort().join("::");
}

function analyzeGraphTopologyLayers(nodes: ReportGraphNode[], links: ReportGraphLink[]): ReportGraphTopologyLayerSummary {
  const validNodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, Array<{ to: string; key: string }>>();
  links.forEach((link) => {
    if (!validNodeIds.has(link.source) || !validNodeIds.has(link.target) || link.source === link.target) return;
    const key = graphTopologyEdgeKey(link.source, link.target);
    if (!adjacency.has(link.source)) adjacency.set(link.source, []);
    if (!adjacency.has(link.target)) adjacency.set(link.target, []);
    adjacency.get(link.source)?.push({ to: link.target, key });
    adjacency.get(link.target)?.push({ to: link.source, key });
  });

  const discovery = new Map<string, number>();
  const low = new Map<string, number>();
  const bridgeEdgeKeys = new Set<string>();
  let clock = 0;

  const visit = (nodeId: string, parentEdgeKey: string | null) => {
    clock += 1;
    discovery.set(nodeId, clock);
    low.set(nodeId, clock);
    adjacency.get(nodeId)?.forEach((edge) => {
      if (edge.key === parentEdgeKey) return;
      if (!discovery.has(edge.to)) {
        visit(edge.to, edge.key);
        low.set(nodeId, Math.min(low.get(nodeId) ?? clock, low.get(edge.to) ?? clock));
        if ((low.get(edge.to) ?? 0) > (discovery.get(nodeId) ?? 0)) bridgeEdgeKeys.add(edge.key);
      } else {
        low.set(nodeId, Math.min(low.get(nodeId) ?? clock, discovery.get(edge.to) ?? clock));
      }
    });
  };

  nodes.forEach((node) => {
    if (!discovery.has(node.id)) visit(node.id, null);
  });

  const bridgeNodeIds = new Set<string>();
  const cycleNodeIds = new Set<string>();
  const cycleEdgeKeys = new Set<string>();

  links.forEach((link) => {
    if (!validNodeIds.has(link.source) || !validNodeIds.has(link.target) || link.source === link.target) return;
    const key = graphTopologyEdgeKey(link.source, link.target);
    if (bridgeEdgeKeys.has(key)) {
      bridgeNodeIds.add(link.source);
      bridgeNodeIds.add(link.target);
      return;
    }
    cycleEdgeKeys.add(key);
    cycleNodeIds.add(link.source);
    cycleNodeIds.add(link.target);
  });

  return {
    bridgeNodeIds,
    bridgeEdgeKeys,
    cycleNodeIds,
    cycleEdgeKeys,
    bridgeCount: bridgeEdgeKeys.size,
    cycleCount: cycleEdgeKeys.size === 0 ? 0 : Math.max(1, Math.round(cycleEdgeKeys.size / 3)),
  };
}

const REPORT_GRAPH_SCALE_CONFIG: Record<ReportGraphScaleMode, ReportGraphScaleConfig> = {
  focus: {
    neighborReports: 8,
    rootArtifacts: 4,
    relatedArtifacts: 1,
    sourceRows: 3,
    coveredEntities: 4,
    relationEdges: 3,
    nodeBudget: 72,
    edgeBudget: 108,
    clusterOverflow: true,
  },
  clustered: {
    neighborReports: 12,
    rootArtifacts: 4,
    relatedArtifacts: 1,
    sourceRows: 3,
    coveredEntities: 5,
    relationEdges: 5,
    nodeBudget: 88,
    edgeBudget: 132,
    clusterOverflow: true,
  },
  expanded: {
    neighborReports: 18,
    rootArtifacts: 5,
    relatedArtifacts: 2,
    sourceRows: 4,
    coveredEntities: 6,
    relationEdges: 8,
    nodeBudget: 120,
    edgeBudget: 180,
    clusterOverflow: true,
  },
};

const REPORT_GRAPH_NEIGHBOR_POSITIONS = [
  { x: 460, y: 78 },
  { x: 680, y: 116 },
  { x: 780, y: 260 },
  { x: 680, y: 398 },
  { x: 460, y: 426 },
  { x: 240, y: 398 },
  { x: 140, y: 260 },
  { x: 240, y: 116 },
] as const;

const ARTIFACT_GRAPH_POSITIONS = [
  { x: 460, y: 144 },
  { x: 590, y: 190 },
  { x: 590, y: 314 },
  { x: 460, y: 358 },
  { x: 330, y: 314 },
  { x: 330, y: 190 },
  { x: 545, y: 250 },
  { x: 375, y: 250 },
] as const;

const SOURCE_GRAPH_POSITIONS = [
  { x: 330, y: 500 },
  { x: 450, y: 500 },
  { x: 570, y: 500 },
  { x: 690, y: 500 },
] as const;

function reportGraphNeighborPosition(index: number, total: number): { x: number; y: number } {
  if (total <= REPORT_GRAPH_NEIGHBOR_POSITIONS.length) {
    return REPORT_GRAPH_NEIGHBOR_POSITIONS[index % REPORT_GRAPH_NEIGHBOR_POSITIONS.length];
  }
  const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / total);
  return {
    x: 460 + Math.cos(angle) * 330,
    y: 258 + Math.sin(angle) * 218,
  };
}

function graphEdgeType(report: ReportCardData, stage: ReportStage): ReportGraphLink["type"] {
  const text = `${report.kind} ${report.entity} ${report.description}`.toLowerCase();
  if (text.includes("funding") || text.includes("raise") || text.includes("series ")) return "funding";
  if (text.includes("pricing") || text.includes("compet")) return "competition";
  if (text.includes("source") || text.includes("api") || text.includes("workflow")) return "integration";
  if (stage === "review" || stage === "stale") return "review";
  if (stage === "drafting") return "drafting";
  if (stage === "verified") return "evidence";
  return "coverage";
}

function normalizeGraphKey(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function detailForReport(details: LiveArtifactDetail[], report: ReportCardData): LiveArtifactDetail | undefined {
  const reportId = normalizeGraphKey(report.id);
  const entity = normalizeGraphKey(report.entity);
  return details.find((detail) => {
    const detailId = normalizeGraphKey(detail.id);
    const title = normalizeGraphKey(detail.title);
    return detail.id === report.id || detailId === reportId || title === entity || title === reportId;
  });
}

function liveNodeKey(detail: LiveArtifactDetail, nodeId: string): string {
  return `artifact:${detail.id}:${nodeId}`;
}

function entityNodeKey(report: ReportCardData): string {
  return `entity:${normalizeGraphKey(report.entity || report.id) || report.id}`;
}

function portfolioNodeKey(): string {
  return "__portfolio_ai_infrastructure__";
}

function portfolioArtifactNodeKey(): string {
  return "__artifact_portfolio_tiering__";
}

function graphSlug(value: string | undefined): string {
  return (value ?? "artifact")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "artifact";
}

function artifactTypeForText(value: string): string {
  const text = value.toLowerCase();
  if (/pricing|compet|matrix/.test(text)) return "COMPARISON";
  if (/decay|stale|freshness|timeline|brief|signal/.test(text)) return "DASHBOARD";
  if (/portfolio|tier|universe|watchlist/.test(text)) return "STRATEGY";
  if (/source|evidence|archive/.test(text)) return "EVIDENCE";
  return "PACKET";
}

function artifactLabelForLiveNode(node: LiveArtifactMapNode, detail: LiveArtifactDetail, index: number): string {
  const text = `${detail.kind} ${detail.title} ${node.title} ${node.subtitle}`;
  const lower = text.toLowerCase();
  if (/pricing|compet/.test(lower)) return "pricing-comparison.html";
  if (/matrix|feature/.test(lower)) return "feature-matrix.html";
  if (/decay|stale|freshness/.test(lower)) return "signal-decay.html";
  if (/timeline|daily brief|signal/.test(lower)) return "signal-timeline.html";
  if (/portfolio|tier|universe/.test(lower)) return "portfolio-tiering.html";
  return `${graphSlug(node.title || `${detail.kind}-${index + 1}`)}.html`;
}

function entityLabelForReport(report: ReportCardData): string {
  const entity = report.entity.trim();
  const fundingMatch = entity.match(/^(.+?)\s+(?:just\s+)?raised\b/i);
  if (fundingMatch?.[1]) return fundingMatch[1].trim();
  if (/daily|brief|edition|digest/i.test(report.kind)) return "Daily Brief";
  return entity.split(/\s+[|-]\s+/)[0]?.trim() || entity;
}

function liveSourceKey(detail: LiveArtifactDetail, sourceId: string): string {
  return `source:${detail.id}:${sourceId}`;
}

function stageFromLiveNode(node: LiveArtifactMapNode, fallback: ReportStage): ReportStage {
  const text = `${node.subtitle} ${node.title}`.toLowerCase();
  if (node.tone === "green" || /verified|passing|evidence refs/.test(text)) return "verified";
  if (node.tone === "amber" || /review|failing|pending/.test(text)) return "review";
  if (node.tone === "blue") return "drafting";
  return fallback;
}

function edgeTypeForLiveNode(node: LiveArtifactMapNode, detail: LiveArtifactDetail): ReportGraphLink["type"] {
  const text = `${node.title} ${node.subtitle} ${detail.kind}`.toLowerCase();
  if (/funding|series|round|raised|\$/.test(text)) return "funding";
  if (/compet|pricing|market/.test(text)) return "competition";
  if (/source|evidence|refs|archive/.test(text)) return "evidence";
  if (/person|persona|founder|leader|team|ceo|cto|cfo/.test(text)) return "leadership";
  if (/api|integration|workflow|tool|notebook/.test(text)) return "integration";
  if (/review|pending|failing|stale/.test(text)) return "review";
  return "coverage";
}

function edgeTypeFromLiveEdge(
  edge: LiveArtifactDetail["edges"][number],
  node: LiveArtifactMapNode | undefined,
  detail: LiveArtifactDetail,
): ReportGraphLink["type"] {
  if (
    edge.type === "has_report" ||
    edge.type === "has_artifact" ||
    edge.type === "covers" ||
    edge.type === "causes" ||
    edge.type === "correlates_with" ||
    edge.type === "evidence" ||
    edge.type === "coverage" ||
    edge.type === "funding" ||
    edge.type === "competition" ||
    edge.type === "integration" ||
    edge.type === "review"
  ) return edge.type;
  return node ? edgeTypeForLiveNode(node, detail) : "coverage";
}

function detailSignals(detail: LiveArtifactDetail): string[] {
  const fromSections = detail.sections
    .flatMap((section) => section.items?.map((item) => `${item.label}: ${item.body}`) ?? [section.body])
    .filter(Boolean)
    .slice(0, 3);
  return [detail.summary, detail.primaryAction, ...fromSections].filter(Boolean).slice(0, 4);
}

function sharedGraphTags(a?: LiveArtifactDetail, b?: LiveArtifactDetail): string[] {
  if (!a || !b) return [];
  const bTags = new Set(b.tags.map(normalizeGraphKey));
  return a.tags.filter((tag) => bTags.has(normalizeGraphKey(tag))).slice(0, 3);
}

function sharedSourceRows(a?: LiveArtifactDetail, b?: LiveArtifactDetail): string[] {
  if (!a || !b) return [];
  const bRows = new Set(b.sourceRows.map((row) => normalizeGraphKey(row.title)));
  return a.sourceRows
    .map((row) => row.title)
    .filter((title) => bRows.has(normalizeGraphKey(title)))
    .slice(0, 2);
}

function defaultGraphAttention(node: Omit<ReportGraphNode, "attentionScore" | "reasonSelected" | "attentionTier">): Pick<ReportGraphNode, "attentionScore" | "reasonSelected" | "attentionTier"> {
  const sourceCount = Number(node.sources.match(/\d+/)?.[0] ?? 0);
  const evidenceScore = Math.min(38, sourceCount * 3);
  const stageScore =
    node.stage === "verified" ? 24 :
    node.stage === "review" || node.stage === "stale" ? 18 :
    node.stage === "drafting" ? 12 :
    14;
  const provenanceScore =
    node.provenance === "artifact" ? 20 :
    node.provenance === "report" ? 18 :
    node.provenance === "portfolio" ? 16 :
    node.provenance === "entity" ? 14 :
    node.provenance === "cluster" ? 10 :
    8;
  const actionScore = node.signals.length > 0 ? 12 : 4;
  const attentionScore = Math.max(0, Math.min(100, Math.round(18 + evidenceScore + stageScore + provenanceScore + actionScore - Math.min(16, node.staleHours / 12))));
  const attentionTier =
    attentionScore >= 78 ? "promoted" :
    attentionScore >= 62 ? "shelf" :
    attentionScore >= 42 ? "searchable" :
    "agent_only";
  const reasonSelected =
    node.provenance === "artifact" ? "Generated artifact can become report work, evidence review, or chat context." :
    node.provenance === "report" ? "Report notebook is the durable artifact for this graph node." :
    node.provenance === "portfolio" ? "Portfolio node summarizes cross-entity movement and review order." :
    node.provenance === "cluster" ? "Cluster keeps low-priority report volume searchable without creating a node cloud." :
    node.stage === "review" || node.stage === "stale" ? "Needs review or freshness work before the agent can safely patch outputs." :
    "Promoted from source, claim, freshness, and graph-context signals.";
  return { attentionScore, reasonSelected, attentionTier };
}

function buildReportGraph(
  reports: ReportCardData[],
  details: LiveArtifactDetail[],
  selectedReport: ReportCardData | null,
  stageOverrides: Record<string, ReportStage>,
  options: ReportGraphBuildOptions,
): ReportGraphData {
  const config = REPORT_GRAPH_SCALE_CONFIG[options.scaleMode];
  const rootReport = selectedReport && reports.some((report) => report.id === selectedReport.id)
    ? selectedReport
    : reports[0] ?? null;
  if (!rootReport) {
    return {
      nodes: [],
      links: [],
      root: null,
      sourceLabel: "No live graph",
      sourceRows: 0,
      artifactNodeCount: 0,
      artifactEdgeCount: 0,
      totalReportCount: 0,
      visibleReportCount: 0,
      hiddenReportCount: 0,
      clusteredReportCount: 0,
      nodeBudget: config.nodeBudget,
      edgeBudget: config.edgeBudget,
      rawEdgeCount: 0,
      scaleMode: options.scaleMode,
    };
  }

  const rootDetail = detailForReport(details, rootReport);
  const related = reports.filter((report) => report.id !== rootReport.id).slice(0, config.neighborReports);
  const hiddenReports = reports.filter((report) => report.id !== rootReport.id).slice(config.neighborReports);
  const visible = [rootReport, ...related];
  const visibleDetails = visible.map((report) => detailForReport(details, report)).filter((detail): detail is LiveArtifactDetail => Boolean(detail));
  const totalSources = visibleDetails.length
    ? visibleDetails.reduce((sum, detail) => sum + detail.sourceRows.length, 0)
    : reports.reduce((sum, report) => sum + report.sources, 0);
  const reviewCount = reports.filter((report) => {
    const stage = getReportStage(report, stageOverrides[report.id]);
    return stage === "review" || stage === "stale" || stage === "drafting";
  }).length;

  const nodes: ReportGraphNode[] = [];
  const nodeIds = new Set<string>();
  const artifactNodeIds: string[] = [];
  const liveArtifactNodeIds = new Map<string, string>();
  const addNode = (node: Omit<ReportGraphNode, "attentionScore" | "reasonSelected" | "attentionTier"> & Partial<Pick<ReportGraphNode, "attentionScore" | "reasonSelected" | "attentionTier">>) => {
    if (nodeIds.has(node.id)) return;
    const attention = defaultGraphAttention(node);
    nodeIds.add(node.id);
    nodes.push({
      ...node,
      attentionScore: node.attentionScore ?? attention.attentionScore,
      reasonSelected: node.reasonSelected ?? attention.reasonSelected,
      attentionTier: node.attentionTier ?? attention.attentionTier,
    });
  };

  visible.forEach((report, index) => {
    const stage = getReportStage(report, stageOverrides[report.id]);
    const detail = detailForReport(details, report);
    const isRoot = report.id === rootReport.id;
    const relatedPosition = isRoot
      ? { x: 460, y: 250 }
      : reportGraphNeighborPosition(index - 1, related.length);
    const freshness = detail ? `Updated ${detail.updatedAt}` : freshnessText(report, stage);
    const sourceWeight = Math.max(1, detail?.sourceRows.length ?? report.sources);
    const entityLabel = entityLabelForReport(report);
    const entityGraphType = reportGraphType(report, stage);
    const entityId = entityNodeKey(report);
    addNode({
      id: entityId,
      label: entityLabel,
      type: entityGraphType === "brief" ? "Brief" : entityGraphType === "investor" ? "Investor" : entityGraphType === "person" ? "Person" : "Entity",
      graphType: entityGraphType,
      weight: sourceWeight,
      report,
      detail,
      provenance: "entity",
      stage,
      x: Math.max(90, relatedPosition.x - (isRoot ? 150 : 68)),
      y: Math.max(74, relatedPosition.y - (isRoot ? 18 : 58)),
      radius: isRoot ? 19 : 13,
      sources: detail ? `${detail.sourceRows.length} source row${detail.sourceRows.length === 1 ? "" : "s"}` : `${report.sources} source row${report.sources === 1 ? "" : "s"}`,
      freshness,
      staleHours: stage === "stale" ? Math.max(48, freshnessHours(freshness)) : freshnessHours(freshness),
      verified: detail ? `${detail.claimCount} claim${detail.claimCount === 1 ? "" : "s"} - ${stageLabel(stage)}` : evidenceText(report, stage),
      coverage: detail?.tags.slice(0, 4) ?? reportSignals(report),
      signals: detail ? detailSignals(detail) : [
        displayReportDescription(report.description),
        `${report.followUps} follow-up${report.followUps === 1 ? "" : "s"} queued`,
      ].filter(Boolean),
    });
    addNode({
      id: report.id,
      label: report.entity,
      type: report.kind,
      graphType: "report",
      weight: sourceWeight,
      report,
      detail,
      provenance: "report",
      stage,
      x: relatedPosition.x,
      y: relatedPosition.y,
      radius: isRoot ? 22 : 13 + Math.min(8, Math.max(2, detail?.sourceRows.length ?? report.sources)) * 0.6,
      sources: detail ? `${detail.sourceRows.length} source row${detail.sourceRows.length === 1 ? "" : "s"}` : `${report.sources} source row${report.sources === 1 ? "" : "s"}`,
      freshness,
      staleHours: stage === "stale" ? Math.max(48, freshnessHours(freshness)) : freshnessHours(freshness),
      verified: detail ? `${detail.claimCount} claim${detail.claimCount === 1 ? "" : "s"} - ${stageLabel(stage)}` : evidenceText(report, stage),
      coverage: detail?.tags.slice(0, 4) ?? reportSignals(report),
      signals: detail ? detailSignals(detail) : [
        displayReportDescription(report.description),
        `${report.followUps} follow-up${report.followUps === 1 ? "" : "s"} queued`,
      ].filter(Boolean),
    });
  });

  visible.forEach((report, reportIndex) => {
    const detail = detailForReport(details, report);
    if (!detail) return;
    const reportPosition = nodes.find((node) => node.id === report.id) ?? { x: 460, y: 250 };
    const liveNodes = detail.nodes
      .filter((node) => node.id !== "root")
      .slice(0, report.id === rootReport.id ? config.rootArtifacts : config.relatedArtifacts);
    liveNodes.forEach((node, index) => {
      const artifactPosition = ARTIFACT_GRAPH_POSITIONS[(reportIndex + index) % ARTIFACT_GRAPH_POSITIONS.length];
      const stage = stageFromLiveNode(node, getReportStage(report, stageOverrides[report.id]));
      const artifactId = liveNodeKey(detail, node.id);
      const label = artifactLabelForLiveNode(node, detail, index);
      const artifactType = node.artifactType ?? artifactTypeForText(`${label} ${node.title} ${node.subtitle} ${detail.kind}`);
      addNode({
        id: artifactId,
        label,
        type: artifactType,
        graphType: "artifact",
        weight: Math.max(1, detail.sourceRows.length),
        report,
        detail,
        provenance: "artifact",
        liveNodeId: node.id,
        artifactKey: node.id,
        artifactType,
        stage,
        x: reportPosition.x + (artifactPosition.x - 460) * 0.55,
        y: reportPosition.y + (artifactPosition.y - 250) * 0.55 + 70,
        radius: 10,
        sources: node.subtitle,
        freshness: `From ${detail.title}`,
        staleHours: freshnessHours(detail.updatedAt),
        verified: `${detail.claimCount} claims - ${detail.sourceRows.length} sources`,
        coverage: [detail.kind, artifactType, ...detail.tags].slice(0, 4),
        signals: [node.title, node.subtitle, ...detailSignals(detail)].filter(Boolean).slice(0, 4),
      });
      artifactNodeIds.push(artifactId);
      liveArtifactNodeIds.set(`${detail.id}:${node.id}`, artifactId);
    });
  });

  const sourceNodes = (rootDetail?.sourceRows ?? []).slice(0, config.sourceRows);
  sourceNodes.forEach((row, index) => {
    if (!rootDetail) return;
    const freshness = `Refreshed ${row.refreshed}`;
    addNode({
      id: liveSourceKey(rootDetail, row.id),
      label: row.title.slice(0, 38),
      type: row.type || "Source",
      graphType: "monitoring",
      weight: Math.max(1, row.reused + 1),
      report: rootReport,
      detail: rootDetail,
      provenance: "source",
      liveNodeId: row.id,
      stage: (row.confidence ?? 0.7) >= 0.8 ? "verified" : "review",
      x: SOURCE_GRAPH_POSITIONS[index % SOURCE_GRAPH_POSITIONS.length].x,
      y: SOURCE_GRAPH_POSITIONS[index % SOURCE_GRAPH_POSITIONS.length].y,
      radius: 10,
      sources: row.href ? "Linked source row" : "Stored source row",
      freshness,
      staleHours: freshnessHours(freshness),
      verified: row.confidence ? `${Math.round(row.confidence * 100)}% source confidence` : "Source available",
      coverage: [row.type, row.status, `${row.reused} reuse${row.reused === 1 ? "" : "s"}`].filter(Boolean),
      signals: [row.excerpt, row.href ?? "Saved source row"].filter(Boolean).slice(0, 3),
    });
  });

  if (visible.length > 1) {
    addNode({
      id: portfolioNodeKey(),
      label: "AI Infrastructure",
      type: "Portfolio",
      graphType: "portfolio",
      weight: Math.max(2, Math.min(10, visible.length)),
      report: rootReport,
      detail: rootDetail,
      provenance: "portfolio",
      stage: "monitoring",
      x: 770,
      y: 500,
      radius: 20,
      sources: `${totalSources} source rows`,
      freshness: `${visible.length} covered reports`,
      staleHours: 0,
      verified: reviewCount ? `${reviewCount} reports need work` : "Coverage graph ready",
      coverage: ["portfolio", "watchlist", "coverage"],
      signals: [
        "Cross-entity universe built from the visible saved report set.",
        "Portfolio artifacts show which reports move together.",
      ],
    });
    addNode({
      id: portfolioArtifactNodeKey(),
      label: "portfolio-tiering.html",
      type: "STRATEGY",
      graphType: "artifact",
      weight: Math.max(2, Math.min(8, visible.length)),
      report: rootReport,
      detail: rootDetail,
      provenance: "artifact",
      artifactKey: "portfolio-tiering",
      artifactType: "STRATEGY",
      stage: "monitoring",
      x: 690,
      y: 560,
      radius: 10,
      sources: `${visible.length} covered reports`,
      freshness: "Derived from current graph",
      staleHours: 0,
      verified: "Portfolio tiers need analyst review",
      coverage: ["portfolio", "tiering", "watchlist"],
      signals: [
        "Ranks visible reports into strategic, watch, and review tiers.",
        "Uses report freshness, evidence volume, and open follow-ups.",
      ],
    });
    artifactNodeIds.push(portfolioArtifactNodeKey());
  }

  let clusteredReportCount = 0;
  if (config.clusterOverflow && hiddenReports.length > 0) {
    const grouped: Record<ReportStage, ReportCardData[]> = {
      drafting: [],
      review: [],
      verified: [],
      stale: [],
      monitoring: [],
    };
    hiddenReports.forEach((report) => {
      grouped[getReportStage(report, stageOverrides[report.id])].push(report);
    });
    const clusterPositions = [
      { x: 78, y: 116 },
      { x: 78, y: 220 },
      { x: 78, y: 324 },
      { x: 78, y: 428 },
      { x: 808, y: 116 },
    ] as const;
    (Object.entries(grouped) as Array<[ReportStage, ReportCardData[]]>)
      .filter(([, group]) => group.length > 0)
      .slice(0, clusterPositions.length)
      .forEach(([stage, group], index) => {
        const position = clusterPositions[index];
        const sourceTotal = group.reduce((sum, report) => sum + report.sources, 0);
        const claimTotal = group.reduce((sum, report) => sum + report.claims, 0);
        clusteredReportCount += group.length;
        addNode({
          id: `cluster:${stage}`,
          label: `${group.length} ${stageLabel(stage).toLowerCase()}`,
          type: "Overflow cluster",
          graphType: "cluster",
          weight: Math.max(2, Math.min(14, group.length)),
          provenance: "cluster",
          stage,
          x: position.x,
          y: position.y,
          radius: 13 + Math.min(9, Math.log2(group.length + 1) * 2),
          sources: `${sourceTotal} source row${sourceTotal === 1 ? "" : "s"}`,
          freshness: `${group.length} reports hidden by ${options.scaleMode} budget`,
          staleHours: stage === "stale" ? 72 : 0,
          verified: `${claimTotal} claim${claimTotal === 1 ? "" : "s"} in cluster`,
          coverage: ["cluster", stage, `${group.length} reports`],
          signals: [
            "The graph is intentionally clustered here instead of rendering every report node.",
            `Use search or filters to focus into ${stageLabel(stage).toLowerCase()} reports without creating a node cloud.`,
          ],
        });
      });
  }

  addNode({
    id: "__universe__",
    label: "AI Infra universe",
    type: "Universe",
    graphType: "monitoring",
    weight: Math.max(1, Math.min(12, totalSources)),
    provenance: "universe",
    stage: "universe",
    x: 150,
    y: 500,
    radius: 18,
    sources: `${totalSources} source rows`,
    freshness: `${reports.length} live reports`,
    staleHours: 0,
    verified: reviewCount ? `${reviewCount} reports need work` : "All visible reports have a next step",
    coverage: ["reports", "sources", "claims"],
    signals: [
      "This graph is derived from live report artifacts.",
      "Open a node to jump into the durable notebook.",
    ],
  });

  const links: ReportGraphLink[] = [];
  const linkKeys = new Set<string>();
  const pushLink = (link: ReportGraphLink) => {
    const key = `${link.source}->${link.target}:${link.type}:${link.label}`;
    if (link.source === link.target || linkKeys.has(key)) return;
    const sourceNode = nodes.find((node) => node.id === link.source);
    const targetNode = nodes.find((node) => node.id === link.target);
    const sourceRefs =
      link.sourceRefs ??
      sourceNode?.detail?.sourceRows.length ??
      targetNode?.detail?.sourceRows.length ??
      Number(sourceNode?.sources.match(/\d+/)?.[0] ?? targetNode?.sources.match(/\d+/)?.[0] ?? 0);
    const claimRefs =
      link.claimRefs ??
      sourceNode?.detail?.claimCount ??
      targetNode?.detail?.claimCount ??
      Number(sourceNode?.verified.match(/\d+/)?.[0] ?? targetNode?.verified.match(/\d+/)?.[0] ?? 0);
    const relationStrength =
      link.strength ??
      (link.type === "causes" ? 0.72 :
        link.type === "correlates_with" ? 0.64 :
        link.type === "has_report" || link.type === "has_artifact" ? 0.82 :
        link.type === "covers" ? 0.68 :
        0.55);
    const confidence =
      link.confidence ??
      Math.max(0.35, Math.min(0.96, relationStrength + Math.min(0.14, sourceRefs * 0.015) + Math.min(0.08, claimRefs * 0.01)));
    linkKeys.add(key);
    links.push({
      sourceRefs,
      claimRefs,
      strength: relationStrength,
      confidence,
      timeWindow: link.timeWindow ?? sourceNode?.freshness ?? targetNode?.freshness,
      directionNote: link.directionNote ?? (
        link.type === "causes" ? "Directional relation: source artifact changes downstream action order." :
        link.type === "correlates_with" ? "Associative relation: shared timing, entities, or source overlap." :
        undefined
      ),
      ...link,
    });
  };

  visible.forEach((report) => {
    pushLink({
      source: entityNodeKey(report),
      target: report.id,
      type: "has_report",
      label: report.kind,
      basis: "Reports are durable child artifacts of the resolved entity.",
    });
  });

  related.forEach((report) => {
    const stage = getReportStage(report, stageOverrides[report.id]);
    const targetDetail = detailForReport(details, report);
    const sharedSources = sharedSourceRows(rootDetail, targetDetail);
    const sharedTags = sharedGraphTags(rootDetail, targetDetail);
    const sameKind = report.kind === rootReport.kind;
    const type = sharedSources.length > 0 ? "evidence" : sharedTags.length > 0 ? "coverage" : sameKind ? "cluster" : graphEdgeType(report, stage);
    pushLink({
      source: rootReport.id,
      target: report.id,
      type,
      label: sharedSources[0]?.slice(0, 24) ?? sharedTags[0] ?? (sameKind ? report.kind : stageLabel(stage)),
    });
  });

  visible.forEach((report) => {
    const detail = detailForReport(details, report);
    if (!detail) return;
    detail.nodes.filter((node) => node.id !== "root").forEach((node) => {
      const artifactId = liveArtifactNodeIds.get(`${detail.id}:${node.id}`);
      if (!artifactId) return;
      pushLink({
        source: report.id,
        target: artifactId,
        type: "has_artifact",
        label: node.artifactType ?? artifactTypeForText(`${node.title} ${node.subtitle} ${detail.kind}`),
        basis: "Artifact is generated from this report packet.",
      });
    });
    detail.edges.forEach((edge) => {
      const sourceId = edge.from === "root" ? report.id : liveArtifactNodeIds.get(`${detail.id}:${edge.from}`);
      const targetId = edge.to === "root" ? report.id : liveArtifactNodeIds.get(`${detail.id}:${edge.to}`);
      const targetLiveNode = detail.nodes.find((node) => node.id === edge.to) ?? detail.nodes.find((node) => node.id === edge.from);
      if (!sourceId || !targetId || !nodes.some((node) => node.id === sourceId) || !nodes.some((node) => node.id === targetId)) return;
      pushLink({
        source: sourceId,
        target: targetId,
        type: edgeTypeFromLiveEdge(edge, targetLiveNode, detail),
        label: edge.label ?? targetLiveNode?.subtitle.slice(0, 24) ?? "artifact edge",
        basis: edge.basis,
        strength: edge.strength,
      });
    });
  });

  sourceNodes.forEach((row) => {
    if (!rootDetail) return;
    pushLink({
      source: rootReport.id,
      target: liveSourceKey(rootDetail, row.id),
      type: "evidence",
      label: row.type.slice(0, 24) || "source row",
    });
  });

  if (visible.length > 1) {
    visible.slice(0, config.coveredEntities).forEach((report, index) => {
      pushLink({
        source: portfolioNodeKey(),
        target: entityNodeKey(report),
        type: "covers",
        label: index === 0 ? "strategic" : index === 1 ? "watch" : "coverage",
        basis: "The portfolio node covers this visible entity in the active universe.",
        strength: index === 0 ? 0.86 : 0.62,
      });
    });
    pushLink({
      source: portfolioNodeKey(),
      target: portfolioArtifactNodeKey(),
      type: "has_artifact",
      label: "STRATEGY",
      basis: "Portfolio tiering is the cross-entity artifact for this universe.",
    });
  }

  const relationArtifactNodeIds = artifactNodeIds.slice(0, Math.max(0, config.relationEdges + 1));
  if (relationArtifactNodeIds.length >= 2 && config.relationEdges >= 1) {
    pushLink({
      source: relationArtifactNodeIds[0],
      target: relationArtifactNodeIds[1],
      type: "causes",
      label: "causes",
      basis: "The lead artifact changes the downstream review order for the next artifact.",
      strength: 0.74,
    });
  }
  if (relationArtifactNodeIds.length >= 3 && config.relationEdges >= 2) {
    pushLink({
      source: relationArtifactNodeIds[1],
      target: relationArtifactNodeIds[2],
      type: "correlates_with",
      label: "correlates",
      basis: "Artifacts share report context, source timing, or entity overlap.",
      strength: 0.66,
    });
  }
  if (relationArtifactNodeIds.length >= 4 && config.relationEdges >= 3) {
    pushLink({
      source: relationArtifactNodeIds[0],
      target: relationArtifactNodeIds[3],
      type: "causes",
      label: "causes",
      basis: "One artifact can influence multiple downstream artifacts; this edge keeps that multiplicity visible.",
      strength: 0.61,
    });
  }

  pushLink({ source: "__universe__", target: rootReport.id, type: "coverage", label: "active root" });
  related.slice(0, 4).forEach((report) => {
    pushLink({
      source: "__universe__",
      target: entityNodeKey(report),
      type: graphEdgeType(report, getReportStage(report, stageOverrides[report.id])),
      label: "coverage",
    });
  });
  nodes.filter((node) => node.provenance === "cluster").forEach((node) => {
    pushLink({
      source: "__universe__",
      target: node.id,
      type: "cluster",
      label: node.coverage[1] ?? "cluster",
      basis: "Overflow reports are grouped so the browser renders a bounded working graph.",
      strength: 0.5,
    });
  });

  const edgePriority = (link: ReportGraphLink): number => {
    if (link.type === "has_report" || link.type === "has_artifact") return 0;
    if (link.type === "coverage" && (link.source === "__universe__" || link.target === rootReport.id)) return 1;
    if (link.type === "causes" || link.type === "correlates_with") return 2;
    if (link.type === "covers") return 3;
    if (link.type === "evidence") return 4;
    if (link.type === "cluster") return 5;
    return 6;
  };
  const rawEdgeCount = links.length;
  const budgetedLinks = rawEdgeCount <= config.edgeBudget
    ? links
    : [...links]
      .sort((a, b) => edgePriority(a) - edgePriority(b))
      .slice(0, config.edgeBudget);

  return {
    nodes,
    links: budgetedLinks,
    root: nodes.find((node) => node.id === rootReport.id) ?? null,
    sourceLabel: visibleDetails.length ? "Saved artifact graph" : "Report metadata graph",
    sourceRows: totalSources,
    artifactNodeCount: nodes.filter((node) => node.provenance === "artifact").length,
    artifactEdgeCount: budgetedLinks.filter((link) => link.type === "has_artifact" || link.type === "causes" || link.type === "correlates_with").length,
    totalReportCount: reports.length,
    visibleReportCount: visible.length,
    hiddenReportCount: hiddenReports.length,
    clusteredReportCount,
    nodeBudget: config.nodeBudget,
    edgeBudget: config.edgeBudget,
    rawEdgeCount,
    scaleMode: options.scaleMode,
  };
}

type ReportArtifactPreview = {
  name: string;
  type: string;
  variant: "bars" | "heatmap" | "sparkline" | "timeline";
  values: number[];
  tone: "green" | "amber" | "red" | "blue";
};

function fallbackArtifactName(report: ReportCardData, stage: ReportStage): string {
  const text = `${report.kind} ${report.entity} ${report.description} ${stage}`.toLowerCase();
  if (/pricing|compet|matrix/.test(text)) return "pricing-comparison.html";
  if (/feature|compare/.test(text)) return "feature-matrix.html";
  if (/stale|freshness|decay/.test(text)) return "signal-decay.html";
  if (/daily|brief|timeline|signal/.test(text)) return "signal-timeline.html";
  if (/portfolio|universe|watchlist/.test(text)) return "portfolio-tiering.html";
  return `${graphSlug(report.entity || report.kind || "report")}-packet.html`;
}

function artifactVariantForName(name: string): ReportArtifactPreview["variant"] {
  const text = name.toLowerCase();
  if (/matrix|feature/.test(text)) return "heatmap";
  if (/timeline/.test(text)) return "timeline";
  if (/decay|stale|freshness/.test(text)) return "sparkline";
  return "bars";
}

function reportArtifactPreview(detail: LiveArtifactDetail | undefined, report: ReportCardData, stage: ReportStage): ReportArtifactPreview {
  const artifactNode = detail?.nodes.find((node) => node.kind === "artifact") ?? detail?.nodes[0];
  const name = artifactNode && detail ? artifactLabelForLiveNode(artifactNode, detail, 0) : fallbackArtifactName(report, stage);
  const type = artifactTypeForText(`${name} ${artifactNode?.artifactType ?? ""} ${report.kind}`);
  const maxMetric = Math.max(1, report.sources, report.claims, report.followUps + 1);
  const seedValues = [
    report.sources / maxMetric,
    report.claims / maxMetric,
    (report.followUps + 1) / maxMetric,
    stage === "verified" ? 0.9 : stage === "review" ? 0.62 : stage === "stale" ? 0.28 : 0.54,
    Math.min(1, (detail?.sourceRows.length ?? report.sources) / Math.max(1, report.sources + 2)),
    Math.min(1, (detail?.sections.length ?? 2) / 5),
  ];
  return {
    name,
    type,
    variant: artifactVariantForName(name),
    values: seedValues.map((value) => Math.max(0.16, Math.min(1, value))),
    tone: stage === "verified" ? "green" : stage === "stale" ? "red" : stage === "review" ? "amber" : "blue",
  };
}

function ReportArtifactStrip({
  preview,
  onOpen,
}: {
  preview: ReportArtifactPreview;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="v3-artifact-strip"
      data-artifact-card
      data-variant={preview.variant}
      data-tone={preview.tone}
      title={`Open ${preview.name}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      <span className={`v3-artifact-strip-vis v3-artifact-strip-vis--${preview.variant}`}>
        {preview.variant === "timeline" ? (
          preview.values.slice(0, 5).map((value, index) => (
            <i key={index} className="v3-artifact-point" style={{ left: `${8 + index * 21}%`, opacity: 0.45 + value * 0.5 }} />
          ))
        ) : preview.variant === "heatmap" ? (
          preview.values.concat(preview.values).slice(0, 12).map((value, index) => (
            <i key={index} className="v3-artifact-cell" style={{ opacity: 0.18 + value * 0.72 }} />
          ))
        ) : preview.variant === "sparkline" ? (
          preview.values.map((value, index) => (
            <i key={index} className="v3-artifact-spark" style={{ height: `${8 + value * 24}px` }} />
          ))
        ) : (
          preview.values.slice(0, 4).map((value, index) => (
            <i key={index} className="v3-artifact-bar" style={{ width: `${22 + value * 68}%` }} />
          ))
        )}
      </span>
      <span className="v3-artifact-strip-foot">
        <span className="v3-artifact-strip-dot" />
        <span className="v3-artifact-strip-name">{preview.name}</span>
        <span className="v3-artifact-strip-type">{preview.type.toLowerCase()}</span>
      </span>
    </button>
  );
}

function ReportCardV3({
  report,
  detail,
  active,
  stage,
  sourceLabel,
  onOpen,
  onSelect,
}: {
  report: ReportCardData;
  detail?: LiveArtifactDetail;
  active: boolean;
  stage: ReportStage;
  sourceLabel: string;
  onOpen: ReportsSurfaceProps["onOpen"];
  onSelect?: (report: ReportCardData) => void;
}) {
  const signals = reportSignals(report);
  const backlinks = reportBacklinks(report);
  const artifactPreview = reportArtifactPreview(detail, report, stage);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAction = (label: string) => {
    setMenuOpen(false);
    if (label === "Open notebook") {
      onOpen(report.id, "brief");
      return;
    }
    showToast({ tone: "info", message: `${label} is queued as a report action preview for ${report.entity}.` });
  };
  return (
    <article
      className="rd-v3-card v3-card"
      data-status={stage}
      aria-selected={active}
      role="button"
      tabIndex={0}
      onClick={() => {
        onSelect?.(report);
        onOpen(report.id, "brief");
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect?.(report);
        onOpen(report.id, "brief");
      }}
    >
      <div className="rd-v3-card__head v3-head">
        <span className="rd-v3-icon v3-icon" data-type={reportIconType(report)}>{report.entity.slice(0, 1).toUpperCase()}</span>
        <strong className="v3-title">{report.entity}</strong>
        <Pill tone={stageTone(stage)}>{stageLabel(stage)}</Pill>
        <div className="card-dd-wrap">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Open action menu for ${report.entity}`}
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((value) => !value);
            }}
          >
            ...
          </button>
          {menuOpen && (
            <div className="card-dd" role="menu" onClick={(event) => event.stopPropagation()}>
              {["Open notebook", "Export PDF", "Export Notion", "Copy link", "Refresh sources", "Archive"].map((label) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  className={label === "Archive" ? "card-dd-item card-dd-item--danger" : "card-dd-item"}
                  onClick={() => menuAction(label)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="v3-body">
      <p className="rd-v3-card__kind">{report.kind}</p>
      <p className="rd-v3-card__thesis v3-thesis">{displayReportDescription(report.description)}</p>
      <div className="rd-v3-signals v3-signals">
        {signals.slice(0, 3).map((signal, index) => <span className="v3-signal" data-color={signalColor(index)} key={`${signal}-${index}`}>{signal}</span>)}
        {signals.length > 3 && <span className="v3-signal" data-color="mute">+{signals.length - 3}</span>}
      </div>
      <div className="rd-v3-sources v3-sources">
        <span className="v3-src">{evidenceText(report, stage)}</span>
        <span className="v3-src">{report.sources} source{report.sources === 1 ? "" : "s"}</span>
      </div>
      <ReportArtifactStrip
        preview={artifactPreview}
        onOpen={() => onOpen(report.id, "cards")}
      />
      </div>
      <div className="rd-v3-card__foot v3-foot">
        <span>{sourceLabel} · {freshnessText(report, stage)}</span>
        <span className="v3-notebook-state" data-state={notebookStateToken(stage)}>{notebookState(stage)}</span>
      </div>
      <div className="rd-v3-card__actions">
        <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(report.id, "brief"); }}>Open notebook</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(report.id, "cards"); }}>Review evidence</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(report.id, "chat"); }}>Ask agent</button>
      </div>
    </article>
  );
}

function ReportBoard({
  reports,
  stageOverrides,
  onDragStart,
  onStageDrop,
  onOpen,
  onSelect,
}: {
  reports: ReportCardData[];
  stageOverrides: Record<string, ReportStage>;
  onDragStart: (event: DragEvent<HTMLElement>, reportId: string) => void;
  onStageDrop: (event: DragEvent<HTMLElement>, stage: ReportBoardColumnId) => void;
  onOpen: ReportsSurfaceProps["onOpen"];
  onSelect?: (report: ReportCardData) => void;
}) {
  return (
    <section className="rd-v3-board" aria-label="Draggable report review board">
      {REPORT_STAGE_COLUMNS.map((column) => {
        const columnReports = reports.filter((report) => boardColumnMatches(getReportStage(report, stageOverrides[report.id]), column.id));
        return (
          <div
            key={column.id}
            className="rd-v3-board-column"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onStageDrop(event, column.id)}
          >
            <header><strong>{column.label}</strong><span>{columnReports.length}</span><small>{column.hint}</small></header>
            {columnReports.map((report) => (
              <button
                key={report.id}
                type="button"
                className="rd-v3-mini"
                draggable
                onDragStart={(event) => onDragStart(event, report.id)}
                onClick={() => {
                  onSelect?.(report);
                  onOpen(report.id, "brief");
                }}
              >
                <span>{report.entity.slice(0, 1).toUpperCase()}</span>
                <strong>{report.entity}</strong>
                <small>{evidenceText(report, getReportStage(report, stageOverrides[report.id]))} · {report.sources} sources</small>
              </button>
            ))}
          </div>
        );
      })}
    </section>
  );
}

function ReportTable({
  reports,
  stageOverrides,
  onOpen,
  onSelect,
}: {
  reports: ReportCardData[];
  stageOverrides: Record<string, ReportStage>;
  onOpen: ReportsSurfaceProps["onOpen"];
  onSelect?: (report: ReportCardData) => void;
}) {
  return (
    <div className="rd-v3-table-wrap" role="region" aria-label="Analyst report table">
      <table className="rd-v3-table">
        <thead><tr><th>Report</th><th>Type</th><th>Status</th><th>Evidence</th><th>Sources</th><th>Updated</th><th>Action</th></tr></thead>
        <tbody>
          {reports.map((report) => {
            const stage = getReportStage(report, stageOverrides[report.id]);
            return (
              <tr key={report.id} onClick={() => {
                onSelect?.(report);
                onOpen(report.id, "brief");
              }}>
                <td><strong>{report.entity}</strong><span>{displayReportDescription(report.description)}</span></td>
                <td>{report.kind}</td>
                <td>{stageLabel(stage)}</td>
                <td>{evidenceText(report, stage)}</td>
                <td>{report.sources} source rows</td>
                <td>{freshnessText(report, stage)}</td>
                <td><button type="button" onClick={(event) => { event.stopPropagation(); onOpen(report.id, "brief"); }}>Open notebook</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReportGraphPreview({
  reports,
  details,
  selectedReport,
  stageOverrides,
  onOpen,
  onSelect,
}: {
  reports: ReportCardData[];
  details: LiveArtifactDetail[];
  selectedReport: ReportCardData | null;
  stageOverrides: Record<string, ReportStage>;
  onOpen: ReportsSurfaceProps["onOpen"];
  onSelect?: (report: ReportCardData) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const movedDuringPointerRef = useRef(false);
  const graph = useMemo(
    () => buildReportGraph(reports, details, selectedReport, stageOverrides, { scaleMode: "focus" }),
    [reports, details, selectedReport, stageOverrides],
  );
  const [pinnedNodeId, setPinnedNodeId] = useState<string | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [graphQuery, setGraphQuery] = useState("");
  const [tooltip, setTooltip] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const activeNodeId = pinnedNodeId ?? hoverNodeId ?? null;
  const activeNode = graph.nodes.find((node) => node.id === activeNodeId) ?? null;
  const pinnedNode = graph.nodes.find((node) => node.id === pinnedNodeId) ?? null;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const connectedIds = useMemo(() => {
    if (!activeNodeId) return new Set<string>();
    const connected = new Set<string>([activeNodeId]);
    graph.links.forEach((link) => {
      if (link.source === activeNodeId) connected.add(link.target);
      if (link.target === activeNodeId) connected.add(link.source);
    });
    return connected;
  }, [activeNodeId, graph.links]);
  const positionFor = (node: ReportGraphNode) => nodePositions[node.id] ?? { x: node.x, y: node.y };
  const linkedReportCount = Math.max(0, graph.nodes.filter((node) => node.provenance === "report").length - 1);
  const normalizedGraphQuery = graphQuery.trim().toLowerCase();
  const matchedNodeIds = useMemo(() => {
    if (!normalizedGraphQuery) return new Set<string>();
    return new Set(graph.nodes.filter((node) => {
      const haystack = [
        node.label,
        node.type,
        node.provenance,
        node.stage,
        node.sources,
        node.freshness,
        node.verified,
        ...node.coverage,
        ...node.signals,
      ].join(" ").toLowerCase();
      return haystack.includes(normalizedGraphQuery);
    }).map((node) => node.id));
  }, [graph.nodes, normalizedGraphQuery]);

  useEffect(() => {
    if (!pinnedNodeId || graph.nodes.some((node) => node.id === pinnedNodeId)) return;
    setPinnedNodeId(null);
  }, [graph.nodes, graph.root?.id, pinnedNodeId]);

  useEffect(() => {
    if (pinnedNodeId && pinnedNodeId !== graph.root?.id) setPinnedNodeId(null);
    setHoverNodeId(null);
    setTooltip(null);
    // Only react to root changes here. If a node click selected the new root,
    // keep that node pinned so the prototype-style peek card remains visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.root?.id]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPinnedNodeId(null);
      setHoverNodeId(null);
      setTooltip(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const openNodeNotebook = (node: ReportGraphNode | null) => {
    const report = node?.report ?? graph.root?.report;
    if (report) onOpen(report.id, "brief");
  };

  const selectNode = (node: ReportGraphNode, event?: PointerEvent<Element> | MouseEvent<Element>) => {
    if (pinnedNodeId === node.id) {
      setPinnedNodeId(null);
      setHoverNodeId(null);
      setTooltip(null);
      return;
    }
    setPinnedNodeId(node.id);
    setHoverNodeId(null);
    if (event) setTooltip({ nodeId: node.id, x: event.clientX, y: event.clientY });
    if (node.report) onSelect?.(node.report);
  };

  const onNodeKeyDown = (event: KeyboardEvent<Element>, node: ReportGraphNode) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectNode(node);
    }
    if (event.key === "Escape") {
      setPinnedNodeId(null);
      setHoverNodeId(null);
    }
  };

  const onNodePointerDown = (event: PointerEvent<Element>, node: ReportGraphNode) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingNodeId(node.id);
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    movedDuringPointerRef.current = false;
  };

  const onGraphPointerMove = (event: PointerEvent<Element>) => {
    if (!draggingNodeId || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 920;
    const y = ((event.clientY - rect.top) / rect.height) * 540;
    setNodePositions((prev) => ({
      ...prev,
      [draggingNodeId]: {
        x: Math.max(38, Math.min(882, x)),
        y: Math.max(38, Math.min(502, y)),
      },
    }));
    if (pointerStartRef.current) {
      const dx = Math.abs(event.clientX - pointerStartRef.current.x);
      const dy = Math.abs(event.clientY - pointerStartRef.current.y);
      if (dx + dy > 6) movedDuringPointerRef.current = true;
    }
  };

  const resetGraph = () => {
    setNodePositions({});
    setHoverNodeId(null);
    setPinnedNodeId(null);
    setTooltip(null);
    showToast({ tone: "info", message: "Graph fit reset to the current report neighborhood." });
  };

  const activeStage = activeNode?.stage === "universe" ? "monitoring" : activeNode?.stage;
  const shouldDimForActive = Boolean(activeNodeId && connectedIds.size > 1);
  const shouldDimForSearch = normalizedGraphQuery.length > 0;
  const tooltipNode = tooltip ? graph.nodes.find((node) => node.id === tooltip.nodeId) : null;
  const pinnedPosition = pinnedNode ? positionFor(pinnedNode) : null;
  const peekStyle = pinnedPosition
    ? ({
        left: `${Math.min(72, Math.max(2, (pinnedPosition.x / 920) * 100 + 2))}%`,
        top: `${Math.min(62, Math.max(2, (pinnedPosition.y / 540) * 100 - 8))}%`,
      } as const)
    : undefined;

  return (
    <section
      className="rd-v3-graph"
      aria-label="Report relationship graph"
      data-graph-source={graph.sourceLabel}
      data-node-count={graph.nodes.length}
      data-edge-count={graph.links.length}
      data-artifact-node-count={graph.artifactNodeCount}
      data-artifact-edge-count={graph.artifactEdgeCount}
      data-total-report-count={graph.totalReportCount}
      data-visible-report-count={graph.visibleReportCount}
      data-hidden-report-count={graph.hiddenReportCount}
      data-clustered-report-count={graph.clusteredReportCount}
      data-visible-node-budget={graph.nodeBudget}
      data-visible-edge-budget={graph.edgeBudget}
      data-raw-edge-count={graph.rawEdgeCount}
      data-scale-mode={graph.scaleMode}
    >
      <div className="rd-v3-graph__controls">
        <div>
          <span className="rd-eyebrow">Relationship map</span>
          <strong>{graph.root?.label ?? "Select a report"}</strong>
          <small>{graph.sourceLabel} - {graph.nodes.length} nodes - {graph.links.length} edges - {graph.sourceRows} source rows - {linkedReportCount} neighboring reports</small>
        </div>
        <div className="rd-v3-graph__control-actions">
          <button type="button" onClick={resetGraph}>Fit</button>
          <label className="rd-v3-graph__search">
            <span aria-hidden="true">⌕</span>
            <input
              value={graphQuery}
              onChange={(event) => setGraphQuery(event.target.value)}
              placeholder="Search graph..."
              aria-label="Search graph nodes"
            />
          </label>
          <span className="rd-v3-graph__legend" aria-label="Relationship legend">
            <span><i data-edge="funding" />Funding</span>
            <span><i data-edge="evidence" />Evidence</span>
            <span><i data-edge="integration" />Integration</span>
            <span><i data-edge="review" />Review</span>
          </span>
        </div>
      </div>

      <div className="rd-v3-graph__canvas">
        <svg
          ref={svgRef}
          viewBox="0 0 920 540"
          role="img"
          aria-label="Draggable graph of report, entity, source, and review relationships"
          onPointerMove={onGraphPointerMove}
          onPointerUp={() => setDraggingNodeId(null)}
          onPointerCancel={() => setDraggingNodeId(null)}
          onClick={() => {
            setPinnedNodeId(null);
            setHoverNodeId(null);
            setTooltip(null);
          }}
        >
          <defs>
            <radialGradient id="rd-v3-graph-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--rd-accent-soft)" />
              <stop offset="100%" stopColor="var(--rd-paper)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <g className="rd-v3-graph__links">
            {graph.links.map((link) => {
              const source = byId.get(link.source);
              const target = byId.get(link.target);
              if (!source || !target) return null;
              const sourcePos = positionFor(source);
              const targetPos = positionFor(target);
              const isActive = !activeNodeId || link.source === activeNodeId || link.target === activeNodeId;
              const isSearchMatch = !normalizedGraphQuery || matchedNodeIds.has(link.source) || matchedNodeIds.has(link.target);
              const midX = (sourcePos.x + targetPos.x) / 2;
              const midY = (sourcePos.y + targetPos.y) / 2;
              return (
                <g key={`${link.source}-${link.target}`} data-edge={link.type} data-active={isActive} data-search-match={isSearchMatch}>
                  <path d={`M ${sourcePos.x} ${sourcePos.y} L ${targetPos.x} ${targetPos.y}`} />
                  <text x={midX} y={midY - 5}>{link.label}</text>
                </g>
              );
            })}
          </g>
          <g className="rd-v3-graph__nodes" onPointerLeave={() => setHoverNodeId(null)}>
            {graph.nodes.map((node) => {
              const pos = positionFor(node);
              const active = activeNodeId === node.id;
              const dimmed = (shouldDimForActive && !connectedIds.has(node.id)) || (shouldDimForSearch && !matchedNodeIds.has(node.id));
              return (
                <g
                  key={node.id}
                  className="rd-v3-graph-node"
                  data-stage={node.stage}
                  data-active={active}
                  data-dimmed={dimmed}
                  data-node-provenance={node.provenance}
                  aria-hidden="true"
                  transform={`translate(${pos.x} ${pos.y})`}
                >
                  <circle className="rd-v3-graph-node__halo" r={node.radius + 14} />
                  <circle className="rd-v3-graph-node__ring" r={node.radius + 4} />
                  <circle className="rd-v3-graph-node__dot" r={node.radius} />
                </g>
              );
            })}
          </g>
        </svg>

        <div className="rd-v3-graph__hit-targets" aria-label="Interactive graph nodes">
          {graph.nodes.map((node) => {
            const pos = positionFor(node);
            const size = Math.max(44, (node.radius + 18) * 2);
            const minWidth =
              node.id === "__universe__" ? 140 :
              node.provenance === "report" ? 156 :
              node.provenance === "source" ? 108 :
              112;
            const maxWidth =
              node.id === graph.root?.id ? 190 :
              node.provenance === "report" ? 176 :
              node.provenance === "source" ? 118 :
              124;
            return (
              <button
                key={node.id}
                type="button"
                style={{
                  left: `${(pos.x / 920) * 100}%`,
                  top: `${(pos.y / 540) * 100}%`,
                  width: Math.min(maxWidth, Math.max(minWidth, size * (node.provenance === "report" ? 3.2 : 2.75))),
                }}
                aria-label={`${node.label}, ${node.type}, ${node.verified}`}
                aria-pressed={activeNodeId === node.id}
                data-node-id={node.id}
                data-node-provenance={node.provenance}
                data-live-node-id={node.liveNodeId}
                onMouseEnter={(event) => {
                  if (!pinnedNodeId) setHoverNodeId(node.id);
                  setTooltip({ nodeId: node.id, x: event.clientX, y: event.clientY });
                }}
                onMouseMove={(event) => {
                  if (!pinnedNodeId) setTooltip({ nodeId: node.id, x: event.clientX, y: event.clientY });
                }}
                onMouseLeave={() => {
                  if (!pinnedNodeId) {
                    setHoverNodeId(null);
                    setTooltip(null);
                  }
                }}
                onFocus={() => {
                  if (!pinnedNodeId) setHoverNodeId(node.id);
                }}
                onBlur={() => {
                  if (!pinnedNodeId) setHoverNodeId(null);
                }}
                onPointerDown={(event) => onNodePointerDown(event, node)}
                onPointerMove={onGraphPointerMove}
                onPointerUp={() => setDraggingNodeId(null)}
                onPointerCancel={() => setDraggingNodeId(null)}
                onKeyDown={(event) => onNodeKeyDown(event, node)}
                onClick={(event) => {
                  event.stopPropagation();
                  if (movedDuringPointerRef.current) {
                    movedDuringPointerRef.current = false;
                    return;
                  }
                  selectNode(node, event);
                }}
              >
                <span>{node.label.slice(0, 1).toUpperCase()}</span>
                <strong>{node.label}</strong>
                <small>{node.stage === "universe" ? "coverage universe" : `${node.provenance} - ${stageLabel(node.stage)}`}</small>
              </button>
            );
          })}
        </div>

        {tooltipNode && !pinnedNode && (
          <div
            className="rd-v3-graph-tip"
            data-visible="true"
            style={{ left: tooltip.x + 14, top: tooltip.y - 12 }}
            role="tooltip"
          >
            <strong>{tooltipNode.label}</strong>
            <span>{tooltipNode.type} - {tooltipNode.provenance} - {stageLabel(tooltipNode.stage === "universe" ? "monitoring" : tooltipNode.stage)}</span>
            <span>{connectedIds.size > 0 ? connectedIds.size - 1 : 0} connections</span>
          </div>
        )}

        {pinnedNode && (
        <aside className="rd-v3-graph-peek" role="dialog" aria-label="Entity details" style={peekStyle}>
          <div className="rd-v3-graph-peek__head">
            <span>{activeNode?.label.slice(0, 1).toUpperCase() ?? "G"}</span>
            <div>
              <strong>{activeNode?.label ?? "No node selected"}</strong>
              <small>{activeNode?.type ?? "Graph"} - {activeNode?.provenance ?? "map"} - {activeStage ? stageLabel(activeStage) : "relationship map"}</small>
            </div>
          </div>
          <dl>
            <div><dt>Sources</dt><dd>{activeNode?.sources ?? "Open a report node"}</dd></div>
            <div><dt>Freshness</dt><dd>{activeNode?.freshness ?? "No freshness state"}</dd></div>
            <div><dt>Verified</dt><dd>{activeNode?.verified ?? "No evidence state"}</dd></div>
            <div><dt>Provenance</dt><dd>{activeNode?.provenance ?? "graph"} from {graph.sourceLabel}</dd></div>
            <div>
              <dt>Coverage</dt>
              <dd className="rd-v3-graph-peek__tags">
                {(activeNode?.coverage ?? ["reports"]).map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}
              </dd>
            </div>
          </dl>
          <ul>
            {(activeNode?.signals ?? ["Select a report node to inspect the relationship context."]).slice(0, 3).map((signal, index) => (
              <li key={`${signal}-${index}`}>{signal}</li>
            ))}
          </ul>
          <div className="rd-v3-graph-peek__actions">
            <button type="button" onClick={() => openNodeNotebook(activeNode)}>Open notebook</button>
            <button
              type="button"
              onClick={() => showToast({ tone: "info", message: `Comparison packet queued for ${activeNode?.label ?? "this graph neighborhood"}.` })}
            >
              Compare
            </button>
            <button
              type="button"
              className={activeNode?.stage === "stale" ? "rd-v3-delta-refresh" : undefined}
              onClick={() => showToast({ tone: "info", message: `Delta refresh preview queued for ${activeNode?.label ?? "this neighborhood"}. New sources only; unchanged content skips extraction.` })}
            >
              Refresh delta
            </button>
          </div>
        </aside>
        )}
      </div>
    </section>
  );
}

function ReportGraphPreviewD3({
  reports,
  details,
  selectedReport,
  serverScope,
  topologyScope,
  scaleMode,
  onScaleModeChange,
  stageOverrides,
  onOpen,
  onSelect,
  onRunBatch,
}: {
  reports: ReportCardData[];
  details: LiveArtifactDetail[];
  selectedReport: ReportCardData | null;
  serverScope?: ReportGraphNeighborhoodScope | null;
  topologyScope?: { query?: string; stage?: string; kind?: string } | null;
  scaleMode: ReportGraphScaleMode;
  onScaleModeChange: (mode: ReportGraphScaleMode) => void;
  stageOverrides: Record<string, ReportStage>;
  onOpen: ReportsSurfaceProps["onOpen"];
  onSelect?: (report: ReportCardData) => void;
  onRunBatch?: ReportsSurfaceProps["onRunBatch"];
}) {
  type D3GraphNode = ReportGraphNode & d3.SimulationNodeDatum & { topologyProjection?: TopologyNodeProjection };
  type D3GraphLink = Omit<ReportGraphLink, "source" | "target"> & {
    source: string | D3GraphNode;
    target: string | D3GraphNode;
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const pinnedNodeIdRef = useRef<string | null>(null);
  const graph = useMemo(
    () => buildReportGraph(reports, details, selectedReport, stageOverrides, { scaleMode }),
    [reports, details, selectedReport, stageOverrides, scaleMode],
  );
  const [graphQuery, setGraphQuery] = useState("");
  const [graphLens, setGraphLens] = useState<ReportGraphLensMode>("force");
  const topologyView = topologyViewForLens(graphLens);
  const [topologyLayers, setTopologyLayers] = useState<Record<ReportGraphTopologyLayer, boolean>>({ bridges: false, cycles: false });
  const localTopology = useMemo(
    () => buildTopologySnapshot(graph.nodes, graph.links, topologyView),
    [graph.nodes, graph.links, topologyView],
  );
  const topologyLayerSummary = useMemo(
    () => analyzeGraphTopologyLayers(graph.nodes, graph.links),
    [graph.nodes, graph.links],
  );
  const serverTopology = useReportTopologySnapshot(
    {
      rootId: selectedReport?.id ?? graph.root?.id ?? undefined,
      query: topologyScope?.query,
      stage: topologyScope?.stage,
      kind: topologyScope?.kind,
      mode: scaleMode,
      view: topologyView,
      limit: graph.nodeBudget,
    },
    { enabled: Boolean(serverScope?.isServerBounded && graph.nodes.length > 0) },
  );
  const topology = useMemo(
    () => mergeServerTopologySnapshot(localTopology, serverTopology.snapshot, graph.nodes),
    [graph.nodes, localTopology, serverTopology.snapshot],
  );
  const topologySource = serverTopology.snapshot
    ? serverTopology.snapshot.persisted
      ? "convex-persisted"
      : "convex-computed"
    : "client-fallback";
  const [pinnedNodeId, setPinnedNodeId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [peekPosition, setPeekPosition] = useState<{ x: number; y: number } | null>(null);
  const activeNode = graph.nodes.find((node) => node.id === pinnedNodeId) ?? null;
  const tooltipNode = tooltip ? graph.nodes.find((node) => node.id === tooltip.nodeId) : null;
  const normalizedGraphQuery = graphQuery.trim().toLowerCase();
  const linkedReportCount = Math.max(0, graph.nodes.filter((node) => node.provenance === "report").length - 1);
  const graphNodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);

  useEffect(() => {
    pinnedNodeIdRef.current = pinnedNodeId;
  }, [pinnedNodeId]);

  useEffect(() => {
    if (!pinnedNodeId || graph.nodes.some((node) => node.id === pinnedNodeId)) return;
    pinnedNodeIdRef.current = null;
    setPinnedNodeId(null);
    setPeekPosition(null);
  }, [graph.nodes, pinnedNodeId]);

  useEffect(() => {
    const currentPinned = pinnedNodeIdRef.current;
    if (currentPinned && graph.nodes.some((node) => node.id === currentPinned)) return;
    pinnedNodeIdRef.current = null;
    setPinnedNodeId(null);
    setTooltip(null);
    setPeekPosition(null);
  }, [graph.nodes, graph.root?.id]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      pinnedNodeIdRef.current = null;
      setPinnedNodeId(null);
      setTooltip(null);
      setPeekPosition(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const connectionCount = (nodeId: string) => graph.links.filter((link) => link.source === nodeId || link.target === nodeId).length;
  const focusGraphNode = (nodeId: string) => {
    const node = graphNodeById.get(nodeId);
    if (!node) return;
    pinnedNodeIdRef.current = nodeId;
    setPinnedNodeId(nodeId);
    setTooltip(null);
    setPeekPosition((current) => current ?? { x: 18, y: 18 });
    if (node.report) onSelect?.(node.report);
  };
  const hierarchyChainFor = (node: ReportGraphNode) => {
    const chain: ReportGraphNode[] = [node];
    let current = node;
    const seen = new Set<string>([node.id]);
    for (let depth = 0; depth < 4; depth += 1) {
      const parentLink = graph.links.find((link) =>
        link.target === current.id &&
        (link.type === "has_report" || link.type === "has_artifact" || link.type === "covers")
      );
      if (!parentLink || seen.has(parentLink.source)) break;
      const parent = graphNodeById.get(parentLink.source);
      if (!parent) break;
      chain.unshift(parent);
      seen.add(parent.id);
      current = parent;
    }
    return chain;
  };
  const childrenFor = (node: ReportGraphNode, type: ReportGraphLink["type"]) =>
    graph.links
      .filter((link) => link.source === node.id && link.type === type)
      .map((link) => ({ link, node: graphNodeById.get(link.target) }))
      .filter((item): item is { link: ReportGraphLink; node: ReportGraphNode } => Boolean(item.node));
  const relationRowsFor = (node: ReportGraphNode, type: "causes" | "correlates_with") =>
    graph.links
      .filter((link) => link.type === type && (link.source === node.id || link.target === node.id))
      .map((link) => {
        const outgoing = link.source === node.id;
        const other = graphNodeById.get(outgoing ? link.target : link.source);
        if (!other) return null;
        return {
          link,
          node: other,
          verb: type === "correlates_with" ? "correlates" : outgoing ? "causes" : "caused by",
        };
      })
      .filter((item): item is { link: ReportGraphLink; node: ReportGraphNode; verb: string } => Boolean(item));
  const openArtifactPreview = (node: ReportGraphNode | null) => {
    if (!node) return;
    const report = node.report ?? graph.root?.report;
    const prompt = [
      `Open the artifact preview for ${node.label}.`,
      report ? `Use report context: ${report.entity} (${report.kind}).` : "Use the active report graph context.",
      "Show hierarchy, source rows, causal/correlation relations, and recommended next agent action.",
    ].join(" ");
    if (onRunBatch) onRunBatch(prompt, { reportId: report?.id, artifactKey: node.artifactKey ?? node.id });
    else if (report) onOpen(report.id, "chat");
    showToast({ tone: "info", message: `Artifact preview handed to Chat: ${node.label}.` });
  };

  useEffect(() => {
    const svgElement = svgRef.current;
    const containerElement = containerRef.current;
    if (!svgElement || !containerElement) return;

    const rect = containerElement.getBoundingClientRect();
    const width = Math.max(560, Math.round(rect.width || 720));
    const visibleHeight = Math.max(420, Math.min(620, Math.round(window.innerHeight - rect.top - 24)));
    const height = Math.max(420, visibleHeight);
    const projectX = (x: number) => 70 + x * Math.max(220, width - 140);
    const projectY = (y: number) => 58 + y * Math.max(260, visibleHeight - 116);
    const useTopologyProjection = graphLens !== "force";
    const nodes: D3GraphNode[] = graph.nodes.map((node) => {
      const topologyProjection = useTopologyProjection ? topology.nodesById[node.id] : undefined;
      return {
        ...node,
        topologyProjection,
        x: topologyProjection ? projectX(topologyProjection.x) : node.x,
        y: topologyProjection ? projectY(topologyProjection.y) : node.y,
      };
    });
    const nodeIds = new Set(nodes.map((node) => node.id));
    const links: D3GraphLink[] = graph.links
      .filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target))
      .map((link) => ({ ...link }));
    const weights = nodes.map((node) => Math.max(1, node.weight));
    const minWeight = Math.min(...weights, 1);
    const maxWeight = Math.max(...weights, 1);
    const radiusFor = (node: D3GraphNode) => {
      if (node.graphType === "artifact") return 10;
      if (node.graphType === "report") return node.radius || 15;
      if (node.graphType === "portfolio") return node.radius || 20;
      if (maxWeight === minWeight) return 12;
      return Math.max(node.radius || 0, 7 + ((Math.max(1, node.weight) - minWeight) / (maxWeight - minWeight)) * 11);
    };
    const graphTypeColor: Record<ReportGraphNode["graphType"], string> = {
      company: "#d97757",
      person: "#60a5fa",
      investor: "#f59e0b",
      brief: "#a78bfa",
      monitoring: "#34d399",
      report: "#3b82f6",
      artifact: "#c96f52",
      portfolio: "#8b5cf6",
      cluster: "#64748b",
    };
    const edgeStyle: Record<string, { stroke: string; dash?: string; width: number }> = {
      funding: { stroke: "var(--rd-green)", width: 1.2 },
      competition: { stroke: "var(--rd-ink-faint)", dash: "7 5", width: 0.9 },
      integration: { stroke: "var(--rd-blue)", dash: "2 2", width: 0.9 },
      leadership: { stroke: "var(--rd-ink-soft)", width: 1.2 },
      history: { stroke: "var(--rd-ink-faint)", dash: "3 3", width: 0.7 },
      coverage: { stroke: "var(--rd-ink-faint)", dash: "6 4", width: 0.7 },
      evidence: { stroke: "var(--rd-green)", width: 1 },
      review: { stroke: "var(--rd-amber)", dash: "7 5", width: 1 },
      drafting: { stroke: "var(--rd-blue)", dash: "2 5", width: 1 },
      cluster: { stroke: "#64748b", dash: "8 5", width: 1 },
      has_report: { stroke: "var(--rd-accent)", width: 1.15 },
      has_artifact: { stroke: "#c96f52", dash: "7 4", width: 1.05 },
      covers: { stroke: "#8b5cf6", dash: "2 4", width: 0.9 },
      causes: { stroke: "#f472b6", width: 1.25 },
      correlates_with: { stroke: "#f59e0b", dash: "5 4", width: 1 },
    };
    const nodeGlyph = (node: D3GraphNode) => {
      if (node.graphType === "artifact") return "V";
      if (node.graphType === "report") return "R";
      if (node.graphType === "portfolio") return "P";
      if (node.graphType === "brief") return "B";
      if (node.graphType === "cluster") return "C";
      return node.label.slice(0, 1).toUpperCase();
    };
    const middleEllipsis = (value: string, maxLength: number) => {
      const clean = value.replace(/\s+/g, " ").trim();
      if (clean.length <= maxLength) return clean;
      const head = Math.max(4, Math.ceil((maxLength - 1) * 0.58));
      const tail = Math.max(3, maxLength - head - 1);
      return `${clean.slice(0, head).trim()}…${clean.slice(-tail).trim()}`;
    };
    const compactReportLabel = (value: string) => {
      const clean = value
        .replace(/\s+/g, " ")
        .replace(/\s+[-|]\s+Funding tracker$/i, "")
        .replace(/,\s*and today'?s\s+top.*$/i, "")
        .replace(/\s+and today'?s\s+top.*$/i, "")
        .replace(/\s+in\s+(?:a|an)\s+(?:Series|Seed|Pre Seed|undisclosed).*$/i, "")
        .replace(/\s+just\s+raised.*$/i, "")
        .replace(/\s+raised\s+\$[\d.,]+[BMK]?\b.*$/i, "")
        .replace(/\s+--\s+\$[\d.,]+[BMK]?\b.*$/i, "")
        .trim();
      if (/^daily brief\b/i.test(clean)) return clean.replace(/\s+-\s+20\d{2}-\d{2}-\d{2}$/i, "");
      const words = clean.split(" ").filter(Boolean);
      const compact = words.length > 4 ? words.slice(0, 4).join(" ") : clean;
      return middleEllipsis(compact || value, 26);
    };
    const canvasLabelFor = (node: D3GraphNode) => {
      if (node.graphType === "artifact") {
        const artifactName = node.artifactKey ?? node.label;
        const basename = artifactName.split(/[\\/]/).pop() ?? artifactName;
        return middleEllipsis(basename, 20);
      }
      if (node.graphType === "report") return compactReportLabel(node.label);
      if (node.graphType === "portfolio") return middleEllipsis(node.label, 22);
      if (node.graphType === "cluster") return middleEllipsis(node.label.replace(/^Cluster:\s*/i, ""), 18);
      if (node.graphType === "brief") return middleEllipsis(node.label.replace(/\s+-\s+20\d{2}-\d{2}-\d{2}$/i, ""), 18);
      return middleEllipsis(node.label, 20);
    };
    const metaLabelFor = (node: D3GraphNode) => {
      if (node.graphType === "artifact") return node.artifactType ?? "artifact";
      if (node.graphType === "report") return "report";
      if (node.graphType === "portfolio") return "portfolio";
      if (node.graphType === "cluster") return `${connectionCount(node.id)} nodes`;
      return node.stage === "universe" ? "monitoring" : node.stage;
    };
    const shouldPromoteLabel = (node: D3GraphNode) => (
      node.id === graph.root?.id ||
      node.id === "__universe__" ||
      node.graphType === "portfolio" ||
      node.graphType === "cluster" ||
      node.attentionTier === "promoted" ||
      (node.topologyProjection?.densityScore ?? 0) >= 82 ||
      (node.topologyProjection?.outlierScore ?? 0) >= 86
    );
    const defaultLabelOpacity = (node: D3GraphNode) => {
      if (graph.scaleMode === "focus") {
        if (node.graphType === "artifact" || node.provenance === "source") return 0;
        return shouldPromoteLabel(node) ? 1 : 0;
      }
      if (graph.scaleMode === "clustered") {
        if (node.graphType === "artifact" || node.provenance === "source") return 0;
        if (node.graphType === "report") return shouldPromoteLabel(node) ? 1 : 0;
        return shouldPromoteLabel(node) ? 1 : 0.72;
      }
      if (node.provenance === "source") return 0;
      if (node.graphType === "artifact") return shouldPromoteLabel(node) ? 0.76 : 0;
      return 1;
    };
    const defaultMetaOpacity = (node: D3GraphNode) => {
      if (defaultLabelOpacity(node) <= 0) return 0;
      if (graph.scaleMode !== "expanded" && node.graphType !== "portfolio" && node.graphType !== "cluster") return 0;
      return 0.5;
    };
    const endpointId = (endpoint: string | D3GraphNode | undefined) => (typeof endpoint === "object" && endpoint ? endpoint.id : String(endpoint ?? ""));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const searchMatch = (node: D3GraphNode) => {
      if (!normalizedGraphQuery) return true;
      return [
        node.label,
        node.type,
        node.graphType,
        node.stage,
        node.sources,
        node.freshness,
        node.verified,
        node.artifactType,
        ...node.coverage,
        ...node.signals,
      ].join(" ").toLowerCase().includes(normalizedGraphQuery);
    };
    const connectedSet = (nodeId: string) => {
      const set = new Set<string>([nodeId]);
      links.forEach((link) => {
        const source = endpointId(link.source);
        const target = endpointId(link.target);
        if (source === nodeId) set.add(target);
        if (target === nodeId) set.add(source);
      });
      return set;
    };
    const isLinked = (link: D3GraphLink, nodeId: string) => endpointId(link.source) === nodeId || endpointId(link.target) === nodeId;

    const svg = d3.select(svgElement);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
    const g = svg.append("g");
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => g.attr("transform", event.transform.toString()));
    zoomBehaviorRef.current = zoom;
    svg.call(zoom).on("dblclick.zoom", null);

    const simulation = d3.forceSimulation<D3GraphNode>(nodes)
      .force("link", d3.forceLink<D3GraphNode, D3GraphLink>(links).id((node) => node.id).distance((link) => {
        if (link.type === "has_artifact") return 55;
        if (link.type === "has_report") return 70;
        if (link.type === "covers") return 110;
        if (link.type === "causes") return 95;
        if (link.type === "correlates_with") return 105;
        return 130;
      }))
      .force("charge", d3.forceManyBody<D3GraphNode>().strength((node) => {
        if (node.graphType === "artifact") return -55;
        if (node.provenance === "source") return -45;
        if (node.graphType === "report") return -150;
        if (node.graphType === "portfolio" || node.graphType === "cluster") return -240;
        return -320;
      }))
      .force("center", d3.forceCenter(width / 2, visibleHeight * 0.45))
      .force("x", d3.forceX<D3GraphNode>((node) => node.topologyProjection ? projectX(node.topologyProjection.x) : width / 2).strength(0.16))
      .force("y", d3.forceY<D3GraphNode>((node) => node.topologyProjection ? projectY(node.topologyProjection.y) : visibleHeight * 0.45).strength(0.18))
      .force("collide", d3.forceCollide<D3GraphNode>().radius((node) => radiusFor(node) + (defaultLabelOpacity(node) > 0 ? 30 : 16)))
      .alphaDecay(0.018);

    const clusterEl = g.append("g")
      .attr("class", "rd-v3-graph-mapper-layer")
      .selectAll<SVGCircleElement, TopologySnapshot["mapperClusters"][number]>("circle")
      .data(topology.mapperClusters.filter((cluster) => cluster.memberIds.length > 1).slice(0, 32))
      .join("circle")
      .attr("class", "rd-v3-graph-mapper-cluster")
      .attr("cx", (cluster) => projectX(cluster.x))
      .attr("cy", (cluster) => projectY(cluster.y))
      .attr("r", (cluster) => 22 + Math.min(34, cluster.memberIds.length * 4))
      .attr("data-density-score", (cluster) => cluster.densityScore)
      .attr("data-attention-score", (cluster) => cluster.attentionScore)
      .attr("opacity", topology.view === "density" ? 0.2 : 0.12);

    const linkEl = g.append("g").selectAll<SVGLineElement, D3GraphLink>("line").data(links).join("line")
      .attr("class", (link) => [
        "rd-v3-graph-link",
        topologyLayerSummary.bridgeEdgeKeys.has(graphTopologyEdgeKey(endpointId(link.source), endpointId(link.target))) ? "rd-v3-graph-link--bridge" : "",
        topologyLayerSummary.cycleEdgeKeys.has(graphTopologyEdgeKey(endpointId(link.source), endpointId(link.target))) ? "rd-v3-graph-link--cycle" : "",
      ].filter(Boolean).join(" "))
      .attr("data-topology-bridge", (link) => topologyLayerSummary.bridgeEdgeKeys.has(graphTopologyEdgeKey(endpointId(link.source), endpointId(link.target))) ? "true" : "false")
      .attr("data-topology-cycle", (link) => topologyLayerSummary.cycleEdgeKeys.has(graphTopologyEdgeKey(endpointId(link.source), endpointId(link.target))) ? "true" : "false")
      .attr("stroke", (link) => edgeStyle[link.type]?.stroke ?? "var(--rd-ink-faint)")
      .attr("stroke-width", (link) => edgeStyle[link.type]?.width ?? 0.7)
      .attr("stroke-dasharray", (link) => edgeStyle[link.type]?.dash ?? "")
      .attr("opacity", (link) => {
        const key = graphTopologyEdgeKey(endpointId(link.source), endpointId(link.target));
        if (topologyLayers.bridges && topologyLayerSummary.bridgeEdgeKeys.has(key)) return 0.92;
        if (topologyLayers.cycles && topologyLayerSummary.cycleEdgeKeys.has(key)) return 0.82;
        return 0.5;
      });

    const edgeLabelEl = g.append("g").selectAll<SVGTextElement, D3GraphLink>("text")
      .data(links.filter((link) => Boolean(link.label)))
      .join("text")
      .text((link) => link.label)
      .attr("class", "rd-v3-graph-edge-label")
      .attr("text-anchor", "middle")
      .attr("dy", "-3")
      .attr("opacity", 0);

    const nodeEl = g.append("g").selectAll<SVGGElement, D3GraphNode>("g").data(nodes).join("g")
      .attr("class", "rd-v3-graph-node")
      .attr("data-graph-type", (node) => node.graphType)
      .attr("data-stage", (node) => node.stage)
      .attr("data-attention-tier", (node) => node.attentionTier)
      .attr("data-attention-score", (node) => node.attentionScore)
      .attr("data-topology-density", (node) => node.topologyProjection?.densityScore ?? "")
      .attr("data-topology-outlier", (node) => node.topologyProjection?.outlierScore ?? "")
      .attr("data-topology-clusters", (node) => node.topologyProjection?.mapperClusterIds.join(" ") ?? "")
      .attr("data-topology-bridge", (node) => topologyLayerSummary.bridgeNodeIds.has(node.id) ? "true" : "false")
      .attr("data-topology-cycle", (node) => topologyLayerSummary.cycleNodeIds.has(node.id) ? "true" : "false")
      .classed("rd-v3-graph-node--bridge", (node) => topologyLayers.bridges && topologyLayerSummary.bridgeNodeIds.has(node.id))
      .classed("rd-v3-graph-node--cycle", (node) => topologyLayers.cycles && topologyLayerSummary.cycleNodeIds.has(node.id))
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (node) => `${node.label}, ${node.type}, ${node.verified}, attention ${node.attentionScore}, ${node.reasonSelected}`)
      .style("cursor", "pointer");

    nodeEl.append("circle")
      .attr("r", (node) => radiusFor(node) + 14)
      .attr("fill", "transparent")
      .attr("stroke", "none");

    nodeEl.append("circle")
      .attr("class", "rd-v3-graph-node__ring")
      .attr("r", (node) => radiusFor(node) + 4);

    nodeEl.append("circle")
      .attr("class", "rd-v3-graph-node__dot")
      .attr("r", (node) => radiusFor(node))
      .attr("fill", (node) => `color-mix(in srgb, ${graphTypeColor[node.graphType]} 18%, var(--rd-paper))`)
      .attr("stroke", (node) => graphTypeColor[node.graphType]);

    nodeEl.append("text")
      .attr("class", "rd-v3-graph-node__icon")
      .text(nodeGlyph)
      .attr("text-anchor", "middle")
      .attr("dy", "0.33em");

    nodeEl.append("title")
      .text((node) => `${node.label} - ${node.type} - ${node.verified}`);

    const labelEl = nodeEl.append("text")
      .attr("class", "rd-v3-graph-node__label")
      .text((node) => canvasLabelFor(node))
      .attr("dx", (node) => radiusFor(node) + 6)
      .attr("dy", "0.35em")
      .attr("data-full-label", (node) => node.label)
      .attr("data-canvas-label", (node) => canvasLabelFor(node))
      .attr("opacity", defaultLabelOpacity);

    const metaEl = nodeEl.append("text")
      .attr("class", "rd-v3-graph-node__meta")
      .text((node) => metaLabelFor(node))
      .attr("dx", (node) => radiusFor(node) + 6)
      .attr("dy", "1.5em")
      .attr("opacity", defaultMetaOpacity);

    const applySearch = () => {
      nodeEl.attr("opacity", (node) => (!normalizedGraphQuery || searchMatch(node)) ? 1 : 0.12);
      labelEl.attr("opacity", (node) => {
        if (!normalizedGraphQuery) return defaultLabelOpacity(node);
        return searchMatch(node) ? 1 : 0.04;
      });
      metaEl.attr("opacity", (node) => {
        if (!normalizedGraphQuery) return defaultMetaOpacity(node);
        return searchMatch(node) ? 0.55 : 0;
      });
      linkEl.attr("opacity", (link) => {
        const key = graphTopologyEdgeKey(endpointId(link.source), endpointId(link.target));
        const overlayOpacity =
          topologyLayers.bridges && topologyLayerSummary.bridgeEdgeKeys.has(key) ? 0.92 :
          topologyLayers.cycles && topologyLayerSummary.cycleEdgeKeys.has(key) ? 0.82 :
          0.5;
        if (!normalizedGraphQuery) return overlayOpacity;
        const source = typeof link.source === "object" ? link.source : nodeById.get(String(link.source));
        const target = typeof link.target === "object" ? link.target : nodeById.get(String(link.target));
        return (source && searchMatch(source)) || (target && searchMatch(target)) ? 0.6 : 0.04;
      });
    };
    const highlight = (nodeId: string) => {
      const connected = connectedSet(nodeId);
      nodeEl.attr("opacity", (node) => connected.has(node.id) ? 1 : 0.08);
      labelEl.attr("opacity", (node) => connected.has(node.id) ? 1 : Math.min(0.12, defaultLabelOpacity(node)));
      metaEl.attr("opacity", (node) => connected.has(node.id) ? 0.58 : 0);
      nodeEl.selectAll<SVGCircleElement, D3GraphNode>(".rd-v3-graph-node__ring")
        .attr("opacity", (node) => node.id === nodeId ? 0.7 : 0);
      linkEl
        .attr("opacity", (link) => isLinked(link, nodeId) ? 0.8 : 0.03)
        .attr("stroke-width", (link) => {
          const widthValue = edgeStyle[link.type]?.width ?? 0.7;
          return isLinked(link, nodeId) ? widthValue * 1.8 : widthValue;
        });
      edgeLabelEl.attr("opacity", (link) => isLinked(link, nodeId) ? 1 : 0);
    };
    const resetHighlight = () => {
      nodeEl.selectAll<SVGCircleElement, D3GraphNode>(".rd-v3-graph-node__ring").attr("opacity", 0);
      labelEl.attr("opacity", defaultLabelOpacity);
      metaEl.attr("opacity", defaultMetaOpacity);
      linkEl
        .attr("opacity", (link) => {
          const key = graphTopologyEdgeKey(endpointId(link.source), endpointId(link.target));
          if (topologyLayers.bridges && topologyLayerSummary.bridgeEdgeKeys.has(key)) return 0.92;
          if (topologyLayers.cycles && topologyLayerSummary.cycleEdgeKeys.has(key)) return 0.82;
          return 0.5;
        })
        .attr("stroke-width", (link) => edgeStyle[link.type]?.width ?? 0.7);
      edgeLabelEl.attr("opacity", 0);
      applySearch();
    };
    const showPeekFor = (node: D3GraphNode, event?: globalThis.MouseEvent | globalThis.KeyboardEvent) => {
      const containerRect = containerElement.getBoundingClientRect();
      const visibleHeightClamped = Math.min(containerRect.height, window.innerHeight - containerRect.top);
      let x = event instanceof globalThis.MouseEvent ? event.clientX - containerRect.left + 18 : (node.x ?? width / 2) + 18;
      let y = event instanceof globalThis.MouseEvent ? event.clientY - containerRect.top - 40 : (node.y ?? visibleHeight / 2) - 40;
      if (x + 320 > containerRect.width) x -= 336;
      if (y < 0) y = 10;
      if (y + 300 > visibleHeightClamped) y = Math.max(10, visibleHeightClamped - 310);
      pinnedNodeIdRef.current = node.id;
      setPinnedNodeId(node.id);
      setPeekPosition({ x, y });
      setTooltip(null);
      if (node.report) onSelect?.(node.report);
    };

    nodeEl.call(d3.drag<SVGGElement, D3GraphNode>()
      .on("start", (event, node) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        node.fx = node.x;
        node.fy = node.y;
      })
      .on("drag", (event, node) => {
        node.fx = event.x;
        node.fy = event.y;
      })
      .on("end", (event, node) => {
        if (!event.active) simulation.alphaTarget(0);
        node.fx = null;
        node.fy = null;
      }));

    nodeEl
      .on("mouseover", (event: globalThis.MouseEvent, node) => {
        if (pinnedNodeIdRef.current) return;
        highlight(node.id);
        setTooltip({ nodeId: node.id, x: event.clientX + 14, y: event.clientY - 12 });
      })
      .on("mousemove", (event: globalThis.MouseEvent, node) => {
        if (pinnedNodeIdRef.current) return;
        setTooltip({ nodeId: node.id, x: event.clientX + 14, y: event.clientY - 12 });
      })
      .on("mouseout", () => {
        if (pinnedNodeIdRef.current) return;
        resetHighlight();
        setTooltip(null);
      })
      .on("click", (event: globalThis.MouseEvent, node) => {
        event.stopPropagation();
        setTooltip(null);
        if (pinnedNodeIdRef.current === node.id) {
          pinnedNodeIdRef.current = null;
          setPinnedNodeId(null);
          setPeekPosition(null);
          resetHighlight();
          return;
        }
        highlight(node.id);
        showPeekFor(node, event);
      })
      .on("keydown", (event: globalThis.KeyboardEvent, node) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        highlight(node.id);
        showPeekFor(node, event);
      });

    svg.on("click", () => {
      pinnedNodeIdRef.current = null;
      setPinnedNodeId(null);
      setPeekPosition(null);
      setTooltip(null);
      resetHighlight();
    });

    simulation.on("tick", () => {
      linkEl
        .attr("x1", (link) => (link.source as D3GraphNode).x ?? 0)
        .attr("y1", (link) => (link.source as D3GraphNode).y ?? 0)
        .attr("x2", (link) => (link.target as D3GraphNode).x ?? 0)
        .attr("y2", (link) => (link.target as D3GraphNode).y ?? 0);
      edgeLabelEl
        .attr("x", (link) => (((link.source as D3GraphNode).x ?? 0) + ((link.target as D3GraphNode).x ?? 0)) / 2)
        .attr("y", (link) => (((link.source as D3GraphNode).y ?? 0) + ((link.target as D3GraphNode).y ?? 0)) / 2);
      clusterEl
        .attr("cx", (cluster) => {
          const memberNodes = cluster.memberIds.map((id) => nodeById.get(id)).filter((node): node is D3GraphNode => Boolean(node));
          return memberNodes.length ? memberNodes.reduce((sum, node) => sum + (node.x ?? 0), 0) / memberNodes.length : projectX(cluster.x);
        })
        .attr("cy", (cluster) => {
          const memberNodes = cluster.memberIds.map((id) => nodeById.get(id)).filter((node): node is D3GraphNode => Boolean(node));
          return memberNodes.length ? memberNodes.reduce((sum, node) => sum + (node.y ?? 0), 0) / memberNodes.length : projectY(cluster.y);
        });
      nodeEl.attr("transform", (node) => `translate(${node.x ?? 0},${node.y ?? 0})`);
    });

    applySearch();

    return () => {
      simulation.stop();
      svg.on(".zoom", null);
      svg.on("click", null);
    };
  }, [graph, graphLens, normalizedGraphQuery, onSelect, topology, topologyLayerSummary, topologyLayers]);

  const resetGraph = () => {
    pinnedNodeIdRef.current = null;
    setPinnedNodeId(null);
    setTooltip(null);
    setPeekPosition(null);
    if (svgRef.current && zoomBehaviorRef.current) {
      d3.select(svgRef.current).transition().duration(400).call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
    }
  };

  const openNodeNotebook = (node: ReportGraphNode | null) => {
    const report = node?.report ?? graph.root?.report;
    if (report) onOpen(report.id, "brief");
  };
  const activeStage = activeNode?.stage === "universe" ? "monitoring" : activeNode?.stage;
  const peekStyle = peekPosition ? ({ left: peekPosition.x, top: peekPosition.y } as const) : undefined;
  const activeHierarchy = activeNode ? hierarchyChainFor(activeNode) : [];
  const activeReportChildren = activeNode ? childrenFor(activeNode, "has_report") : [];
  const activeArtifactChildren = activeNode ? childrenFor(activeNode, "has_artifact") : [];
  const activeCoveredChildren = activeNode ? childrenFor(activeNode, "covers") : [];
  const activeCausationRows = activeNode ? relationRowsFor(activeNode, "causes") : [];
  const activeCorrelationRows = activeNode ? relationRowsFor(activeNode, "correlates_with") : [];
  const activeTopology = activeNode ? topology.nodesById[activeNode.id] : null;
  const activeMapperClusters = activeTopology
    ? activeTopology.mapperClusterIds
      .map((clusterId) => topology.mapperClusters.find((cluster) => cluster.id === clusterId))
      .filter((cluster): cluster is TopologySnapshot["mapperClusters"][number] => Boolean(cluster))
    : [];
  const activeContextPacket = activeNode
    ? buildGraphContextBridgePacket({
        report: activeNode.report ?? graph.root?.report ?? null,
        detail: activeNode.detail ?? graph.root?.detail ?? null,
        scope: serverScope,
        mode: "agent",
        topology: activeTopology
          ? {
              view: topology.view,
              mapperClusterIds: activeTopology.mapperClusterIds,
              densityScore: activeTopology.densityScore,
              pc1: activeTopology.pc1,
              pc2: activeTopology.pc2,
              centroidDistance: activeTopology.centroidDistance,
              outlierScore: activeTopology.outlierScore,
              summary: topologySummaryForNode(activeNode, activeTopology, topology),
            }
          : null,
      })
    : null;

  return (
    <section
      className="rd-v3-graph"
      aria-label="Report relationship graph"
      data-graph-source={graph.sourceLabel}
      data-node-count={graph.nodes.length}
      data-edge-count={graph.links.length}
      data-graph-lens={graphLens}
      data-topology-view={topology.view}
      data-topology-cluster-count={topology.summary.clusterCount}
      data-topology-bridges={topologyLayerSummary.bridgeCount}
      data-topology-cycles={topologyLayerSummary.cycleCount}
      data-topology-bridges-active={topologyLayers.bridges ? "true" : "false"}
      data-topology-cycles-active={topologyLayers.cycles ? "true" : "false"}
      data-topology-hot-node={topology.summary.hotNodeId ?? ""}
      data-topology-centroid-node={topology.summary.centroidNodeId ?? ""}
      data-topology-outlier-node={topology.summary.outlierNodeId ?? ""}
      data-topology-source={topologySource}
      data-topology-persisted={serverTopology.snapshot?.persisted ? "true" : "false"}
      data-artifact-node-count={graph.artifactNodeCount}
      data-artifact-edge-count={graph.artifactEdgeCount}
      data-total-report-count={graph.totalReportCount}
      data-visible-report-count={graph.visibleReportCount}
      data-hidden-report-count={graph.hiddenReportCount}
      data-clustered-report-count={graph.clusteredReportCount}
      data-visible-node-budget={graph.nodeBudget}
      data-visible-edge-budget={graph.edgeBudget}
      data-raw-edge-count={graph.rawEdgeCount}
      data-scale-mode={graph.scaleMode}
      data-server-bounded={serverScope?.isServerBounded ? "true" : "false"}
      data-server-report-limit={serverScope?.reportLimit ?? ""}
      data-server-scan-limit={serverScope?.scanLimit ?? ""}
      data-server-scanned-archive-posts={serverScope?.scannedArchivePosts ?? ""}
      data-server-total-candidate-reports={serverScope?.totalCandidateReports ?? ""}
      data-server-returned-report-count={serverScope?.returnedReportCount ?? ""}
      data-server-hidden-report-count={serverScope?.hiddenReportCount ?? ""}
      data-active-context-ref={activeContextPacket?.contextRef ?? ""}
      data-active-context-attention-score={activeContextPacket?.attentionScore ?? ""}
      data-active-context-agent-rank={activeContextPacket?.agentRank ?? ""}
    >
      <div className="rd-v3-graph__controls">
        <button type="button" className="rd-v3-graph__fit" onClick={resetGraph}>Fit</button>
        <span className="rd-v3-graph__scale" role="group" aria-label="Graph density">
          {REPORT_GRAPH_SCALE_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              aria-pressed={scaleMode === mode.id}
              title={mode.hint}
              onClick={() => {
                onScaleModeChange(mode.id);
                pinnedNodeIdRef.current = null;
                setPinnedNodeId(null);
                setTooltip(null);
                setPeekPosition(null);
              }}
            >
              {mode.label}
            </button>
          ))}
        </span>
        <span className="rd-v3-graph__topology" role="group" aria-label="Graph lens">
          {REPORT_GRAPH_LENS_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              aria-pressed={graphLens === mode.id}
              title={mode.hint}
              onClick={() => {
                setGraphLens(mode.id);
                pinnedNodeIdRef.current = null;
                setPinnedNodeId(null);
                setTooltip(null);
                setPeekPosition(null);
              }}
            >
              {mode.label}
            </button>
          ))}
        </span>
        <span className="rd-v3-graph__topology-layers" role="group" aria-label="Topology overlays">
          {REPORT_GRAPH_TOPOLOGY_LAYERS.map((layer) => (
            <button
              key={layer.id}
              type="button"
              aria-pressed={topologyLayers[layer.id]}
              title={layer.hint}
              onClick={() => setTopologyLayers((current) => ({ ...current, [layer.id]: !current[layer.id] }))}
            >
              {layer.label}
            </button>
          ))}
        </span>
        <label className="rd-v3-graph__search">
          <span aria-hidden="true">⌕</span>
          <input value={graphQuery} onChange={(event) => setGraphQuery(event.target.value)} placeholder="Search graph..." aria-label="Search graph nodes" />
        </label>
        <span className="rd-v3-graph__budget" title="Visible graph budget">
          {graph.visibleReportCount}/{graph.totalReportCount} reports
          {graph.hiddenReportCount > 0 ? ` - ${graph.clusteredReportCount} clustered` : ""}
        </span>
        <span className="rd-v3-graph__legend" aria-label="Relationship legend">
          <span><i data-edge="funding" />Funding</span>
          <span><i data-edge="competition" />Competition</span>
          <span><i data-edge="integration" />Integration</span>
          <span><i data-edge="has_report" />Report</span>
          <span><i data-edge="has_artifact" />Artifact</span>
          <span><i data-edge="causes" />Causes</span>
          <span><i data-edge="correlates_with" />Correlates</span>
          <span><i data-edge="cluster" />Cluster</span>
        </span>
      </div>
      <div className="rd-v3-graph__topology-summary" data-view={topology.view}>
        <strong>{graphLens === "force" ? "Force layout" : topology.view === "density" ? "Attention density" : topology.view === "pca" ? "Variation axes" : "Typicality"}</strong>
        <span>{graphLens === "force" ? "Natural force layout keeps report, artifact, source, and entity relationships readable before analytical lenses are applied." : topology.summary.viewRationale}</span>
        <span>{topology.summary.clusterCount} mapper clusters</span>
        <span>{topologyLayerSummary.bridgeCount} bridges</span>
        <span>{topologyLayerSummary.cycleCount} cycles</span>
        <span>{serverTopology.sourceLabel}</span>
        <span>PC1: {topology.pcaAxes.pc1.map((axis) => axis.label).join(" / ")}</span>
        <span>PC2: {topology.pcaAxes.pc2.map((axis) => axis.label).join(" / ")}</span>
      </div>
      <div className="rd-v3-graph__canvas" ref={containerRef}>
        <svg ref={svgRef} className="rd-v3-graph-svg" role="img" aria-label={`Force-directed report graph for ${graph.root?.label ?? "the active universe"}`} />
        {tooltipNode && !activeNode && (
          <div className="rd-v3-graph-tip" data-visible="true" style={{ left: tooltip.x, top: tooltip.y }} role="tooltip">
            <strong>{tooltipNode.label}</strong>
            <span>{tooltipNode.type} - {tooltipNode.stage === "universe" ? "monitoring" : tooltipNode.stage}</span>
            <span>{connectionCount(tooltipNode.id)} connections</span>
          </div>
        )}
        {activeNode && (
          <aside className="rd-v3-graph-peek visible" role="dialog" aria-label="Entity details" style={peekStyle}>
            <div className="rd-v3-graph-peek__head">
              <span>{activeNode.label.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{activeNode.label}</strong>
                <small>{activeNode.type} - {activeStage ?? "tracking"}</small>
              </div>
              <b data-status={activeStage ?? "tracking"}>{activeStage ?? "tracking"}</b>
            </div>
            <dl>
              <div><dt>Sources</dt><dd>{activeNode.sources}</dd></div>
              <div>
                <dt>Freshness</dt>
                <dd>
                  {activeNode.staleHours > 24 ? (
                    <button
                      type="button"
                      className="rd-v3-graph-peek__stale"
                      title="Click to run a delta refresh - only fetches what changed"
                      onClick={() => showToast({ tone: "info", message: `Delta refresh preview queued for ${activeNode.label}. New sources only; unchanged content skips extraction.` })}
                    >
                      {activeNode.freshness}
                      <span>Refresh delta</span>
                    </button>
                  ) : activeNode.freshness}
                </dd>
              </div>
              <div><dt>Verified</dt><dd>{activeNode.verified}</dd></div>
              <div>
                <dt>Coverage</dt>
                <dd className="rd-v3-graph-peek__tags">
                  {(activeNode.coverage.length > 0 ? activeNode.coverage : ["reports"]).map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}
                </dd>
              </div>
            </dl>
            <div className="rd-v3-graph-peek__signals">
              {(activeNode.signals.length > 0 ? activeNode.signals : ["Select a report node to inspect the relationship context."]).slice(0, 3).map((signal, index) => (
                <p key={`${signal}-${index}`}>{signal}</p>
              ))}
            </div>
            <div className="rd-v3-graph-peek__attention" data-attention-tier={activeNode.attentionTier}>
              <div>
                <span className="rd-v3-graph-peek__section-label">Attention</span>
                <p>{activeNode.reasonSelected}</p>
              </div>
              <b>{activeNode.attentionScore}</b>
              <small>{activeNode.attentionTier.replace("_", " ")}</small>
            </div>
            {activeTopology && (
              <div className="rd-v3-graph-peek__topology" data-topology-view={topology.view}>
                <div className="rd-v3-graph-peek__context-head">
                  <span className="rd-v3-graph-peek__section-label">
                    {topology.view === "density" ? "Density" : topology.view === "pca" ? "PCA" : "Centroid"}
                  </span>
                  <b>{topology.view === "centroid" ? activeTopology.outlierScore : activeTopology.densityScore}</b>
                </div>
                <p>{topologySummaryForNode(activeNode, activeTopology, topology)}</p>
                <div className="rd-v3-graph-peek__context-grid" aria-label="Topology metrics">
                  <span><strong>{activeTopology.densityScore}</strong> density</span>
                  <span><strong>{activeTopology.pc1.toFixed(2)}</strong> PC1</span>
                  <span><strong>{activeTopology.pc2.toFixed(2)}</strong> PC2</span>
                  <span><strong>{activeTopology.outlierScore}</strong> edge</span>
                </div>
                {activeMapperClusters.length > 0 && (
                  <small>
                    Mapper: {activeMapperClusters.slice(0, 2).map((cluster) => `${cluster.label} (${cluster.memberIds.length})`).join(", ")}
                  </small>
                )}
              </div>
            )}
            {activeContextPacket && (
              <div className="rd-v3-graph-peek__context" data-context-ref={activeContextPacket.contextRef}>
                <div className="rd-v3-graph-peek__context-head">
                  <span className="rd-v3-graph-peek__section-label">Agent context packet</span>
                  <b>{activeContextPacket.attentionScore}</b>
                </div>
                <p>{activeContextPacket.humanSummary}</p>
                <div className="rd-v3-graph-peek__context-grid" aria-label="Agent context budget">
                  <span><strong>{activeContextPacket.packedNodes}</strong> packed</span>
                  <span><strong>{activeContextPacket.sourceRefs}</strong> sources</span>
                  <span><strong>{activeContextPacket.claimRefs}</strong> claims</span>
                  <span><strong>{activeContextPacket.estimatedTokens}</strong> tok</span>
                </div>
                <details className="rd-v3-graph-peek__why">
                  <summary>Why this entered context</summary>
                  <ol>
                    {activeContextPacket.whySelected.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
                  </ol>
                </details>
              </div>
            )}
            <div className="rd-v3-graph-peek__hierarchy">
              <span className="rd-v3-graph-peek__section-label">Hierarchy</span>
              <div className="rd-v3-graph-peek__crumbs">
                {(activeHierarchy.length > 0 ? activeHierarchy : [activeNode]).map((node, index) => (
                  <button key={node.id} type="button" onClick={() => focusGraphNode(node.id)}>
                    {index > 0 && <span aria-hidden="true">/</span>}
                    {node.label}
                  </button>
                ))}
              </div>
            </div>
            {(activeReportChildren.length > 0 || activeArtifactChildren.length > 0 || activeCoveredChildren.length > 0) && (
              <div className="rd-v3-graph-peek__children">
                {activeReportChildren.length > 0 && (
                  <div>
                    <span className="rd-v3-graph-peek__section-label">Reports</span>
                    {activeReportChildren.slice(0, 4).map(({ node, link }) => (
                      <button key={`${link.source}-${link.target}`} type="button" onClick={() => focusGraphNode(node.id)}>
                        <strong>{node.label}</strong>
                        <small>{link.label}</small>
                      </button>
                    ))}
                  </div>
                )}
                {activeArtifactChildren.length > 0 && (
                  <div>
                    <span className="rd-v3-graph-peek__section-label">Artifacts</span>
                    {activeArtifactChildren.slice(0, 4).map(({ node, link }) => (
                      <button key={`${link.source}-${link.target}`} type="button" onClick={() => focusGraphNode(node.id)}>
                        <strong>{node.label}</strong>
                        <small>{link.label}</small>
                      </button>
                    ))}
                  </div>
                )}
                {activeCoveredChildren.length > 0 && (
                  <div>
                    <span className="rd-v3-graph-peek__section-label">Covers ({activeCoveredChildren.length} entities)</span>
                    {activeCoveredChildren.slice(0, 4).map(({ node, link }) => (
                      <button key={`${link.source}-${link.target}`} type="button" onClick={() => focusGraphNode(node.id)}>
                        <strong>{node.label}</strong>
                        <small>{link.label}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {(activeCausationRows.length > 0 || activeCorrelationRows.length > 0) && (
              <div className="rd-v3-graph-peek__relations">
                {activeCausationRows.length > 0 && (
                  <div>
                    <span className="rd-v3-graph-peek__section-label rd-v3-graph-peek__section-label--causes">Causation</span>
                    {activeCausationRows.slice(0, 4).map(({ node, link, verb }) => (
                      <button key={`${link.source}-${link.target}-${verb}`} type="button" onClick={() => focusGraphNode(node.id)}>
                        <strong>{verb}</strong>
                        <span>{node.label}</span>
                        {link.basis && <small>{link.basis}</small>}
                        <em className="rd-v3-graph-peek__relation-meta">
                          {Math.round((link.confidence ?? 0) * 100)}% confidence
                          {" - "}
                          {Math.round((link.strength ?? 0) * 100)} strength
                          {" - "}
                          {link.sourceRefs ?? 0} sources / {link.claimRefs ?? 0} claims
                          {link.timeWindow ? ` - ${link.timeWindow}` : ""}
                        </em>
                      </button>
                    ))}
                  </div>
                )}
                {activeCorrelationRows.length > 0 && (
                  <div>
                    <span className="rd-v3-graph-peek__section-label rd-v3-graph-peek__section-label--correlates">Correlation</span>
                    {activeCorrelationRows.slice(0, 4).map(({ node, link, verb }) => (
                      <button key={`${link.source}-${link.target}-${verb}`} type="button" onClick={() => focusGraphNode(node.id)}>
                        <strong>{verb}</strong>
                        <span>{node.label}</span>
                        {link.basis && <small>{link.basis}</small>}
                        <em className="rd-v3-graph-peek__relation-meta">
                          {Math.round((link.confidence ?? 0) * 100)}% confidence
                          {" - "}
                          {Math.round((link.strength ?? 0) * 100)} strength
                          {" - "}
                          {link.sourceRefs ?? 0} sources / {link.claimRefs ?? 0} claims
                          {link.timeWindow ? ` - ${link.timeWindow}` : ""}
                        </em>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="rd-v3-graph-peek__actions">
              {activeNode.provenance === "artifact" ? (
                <>
                  <button type="button" onClick={() => openArtifactPreview(activeNode)}>Open preview</button>
                  <button type="button" onClick={() => showToast({ tone: "info", message: `Artifact edit preview queued for ${activeNode.label}.` })}>Edit</button>
                  <button type="button" onClick={() => showToast({ tone: "info", message: `Share packet copied for ${activeNode.label}.` })}>Share</button>
                </>
              ) : activeNode.provenance === "portfolio" ? (
                <>
                  <button type="button" onClick={() => showToast({ tone: "info", message: `Portfolio workbench preview queued for ${activeNode.label}.` })}>Open workbench</button>
                  <button type="button" onClick={() => showToast({ tone: "info", message: `Re-classification preview queued for ${activeNode.label}.` })}>Re-classify</button>
                </>
              ) : activeNode.provenance === "cluster" ? (
                <>
                  <button type="button" onClick={() => showToast({ tone: "info", message: `Use the Reports filters or graph search to drill into ${activeNode.label}.` })}>Narrow filters</button>
                  <button type="button" onClick={() => showToast({ tone: "info", message: `Batch review preview queued for ${activeNode.label}.` })}>Review cluster</button>
                </>
              ) : activeNode.provenance === "report" ? (
                <>
                  <button type="button" onClick={() => openNodeNotebook(activeNode)}>Open report</button>
                  <button type="button" onClick={() => showToast({ tone: "info", message: `Regeneration preview queued for ${activeNode.label}.` })}>Regenerate</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => openNodeNotebook(activeNode)}>Open notebook</button>
                  <button type="button" onClick={() => showToast({ tone: "info", message: `Comparison packet queued for ${activeNode.label}.` })}>Compare</button>
                  <button type="button" onClick={() => showToast({ tone: "info", message: `Delta refresh preview queued for ${activeNode.label}. New sources only; unchanged content skips extraction.` })}>Refresh</button>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
      <p className="rd-v3-graph__provenance">
        {graph.sourceLabel} - {graph.nodes.length}/{graph.nodeBudget} visible nodes - {graph.links.length}/{graph.rawEdgeCount} edges - {graph.sourceRows} source rows - {linkedReportCount} neighboring reports{graph.hiddenReportCount > 0 ? ` - ${graph.hiddenReportCount} reports hidden behind clusters` : ""}
        {serverScope?.isServerBounded
          ? ` - server query returned ${serverScope.returnedReportCount}/${serverScope.totalCandidateReports} candidate reports from ${serverScope.scannedArchivePosts}/${serverScope.scanLimit} scanned archive rows`
          : ""}
        {` - topology ${topologySource}`}
      </p>
    </section>
  );
}

function topologySummaryForNode(
  node: ReportGraphNode,
  projection: TopologyNodeProjection,
  topology: TopologySnapshot,
): string {
  if (topology.view === "density") {
    return `${node.label} sits in density score ${projection.densityScore}, showing where attention keeps gravitating.`;
  }
  if (topology.view === "pca") {
    return `${node.label} projects to PC1 ${projection.pc1.toFixed(2)} / PC2 ${projection.pc2.toFixed(2)} along the dominant feature axes.`;
  }
  return `${node.label} is ${projection.outlierScore >= 70 ? "an edge/outlier node" : "nearer the typical center"} with centroid distance ${projection.centroidDistance.toFixed(2)}.`;
}

function mergeServerTopologySnapshot(
  localTopology: TopologySnapshot,
  serverSnapshot: ReportTopologySnapshotPacket | null,
  graphNodes: ReportGraphNode[],
): TopologySnapshot {
  if (!serverSnapshot || graphNodes.length === 0) return localTopology;
  const serverCoverage = graphNodes.filter((node) => serverSnapshot.nodesById[node.id]).length;
  if (serverCoverage < Math.max(1, Math.ceil(graphNodes.length * 0.35))) return localTopology;
  const nodesById: TopologySnapshot["nodesById"] = { ...localTopology.nodesById };
  for (const node of serverSnapshot.nodes) {
    if (!nodesById[node.id]) continue;
    nodesById[node.id] = node;
  }
  const nodes = graphNodes
    .map((node) => nodesById[node.id])
    .filter((node): node is TopologyNodeProjection => Boolean(node));
  return {
    view: serverSnapshot.view,
    nodes,
    nodesById,
    mapperClusters: serverSnapshot.mapperClusters,
    mapperEdges: serverSnapshot.mapperEdges,
    summary: {
      ...serverSnapshot.summary,
      nodeCount: localTopology.summary.nodeCount,
      edgeCount: localTopology.summary.edgeCount,
    },
    pcaAxes: serverSnapshot.pcaAxes,
  };
}

function ReportsLiveEmptyState() {
  return (
    <section className="rd-universe">
      <div className="rd-universe__header">
        <button type="button" className="rd-universe__toggle" aria-expanded="true">
          <span className="rd-caret" aria-hidden="true">▾</span>
          <span>No live coverage returned</span>
        </button>
        <span className="rd-universe__meta">
          No reports found for this session.
        </span>
        <div className="rd-universe__actions">
          <Pill tone="amber">Live wiring required</Pill>
          <button
            className="rd-btn rd-btn--quiet rd-btn--sm"
            onClick={() => showToast({ tone: "info", message: "Run a daily brief, batch run, or LinkedIn archive import to populate Reports." })}
          >
            How to populate
          </button>
        </div>
      </div>
    </section>
  );
}

function UniverseSection({ universe: u, open, onToggle }: { universe: Universe; open: boolean; onToggle: () => void }) {
  const styleName = memoStyles.find((s) => s.id === u.styleId)?.name ?? u.styleId;
  return (
    <div className="rd-universe-head" data-open={open} onClick={onToggle} role="button" aria-expanded={open}>
      <span className="rd-universe-head__chev" aria-hidden="true">
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
      <div>
        <div className="rd-universe-head__title">{u.name}</div>
        <div className="rd-universe-head__meta">
          <span>{u.entityCount} entities</span>
          <span>·</span>
          <span style={{ color: u.needsReview > 0 ? "var(--rd-amber)" : "var(--rd-ink-soft)", fontWeight: 700 }}>
            {u.needsReview} needs review
          </span>
          <span>·</span>
          <span>refreshed {u.refreshedAgo}</span>
          <span>·</span>
          <span>{u.rubric}</span>
        </div>
      </div>
      <div className="rd-row" style={{ gap: 6 }}>
        <span className="rd-style-chip">{styleName}</span>
        {u.monitoring && <Pill tone="green"><span className="rd-dot rd-dot--live" />Monitoring</Pill>}
        <button
          className="rd-btn rd-btn--quiet rd-btn--sm"
          onClick={(e) => {
            e.stopPropagation();
            showToast({ tone: "info", message: `Queued batch run for ${u.name}.` });
          }}
        >
          Run batch →
        </button>
      </div>
    </div>
  );
}

function LiveArtifactSection({
  reportCount,
  reviewCount,
  sourceLabel,
}: {
  reportCount: number;
  reviewCount: number;
  sourceLabel: string;
}) {
  return (
    <div className="rd-universe-head" data-open={true} role="group" aria-label="Live production artifact feed">
      <span className="rd-universe-head__chev" aria-hidden="true">
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <div>
        <div className="rd-universe-head__title">Live production artifacts</div>
        <div className="rd-universe-head__meta">
          <span>{reportCount} reports</span>
          <span>·</span>
          <span style={{ color: reviewCount > 0 ? "var(--rd-amber)" : "var(--rd-ink-soft)", fontWeight: 700 }}>
            {reviewCount} needs review
          </span>
          <span>·</span>
          <span>LinkedIn archive + daily brief memory + batch runs</span>
        </div>
      </div>
      <div className="rd-row" style={{ gap: 6 }}>
        <Pill tone="green"><span className="rd-dot rd-dot--live" />Live memory</Pill>
        <button
          className="rd-btn rd-btn--quiet rd-btn--sm"
          onClick={() => showToast({
            tone: "info",
            message: `${sourceLabel}. Rows are built from existing archive, daily brief, and batch-run artifacts.`,
          })}
        >
          View provenance
        </button>
        <button
          className="rd-btn rd-btn--quiet rd-btn--sm"
          onClick={() => showToast({ tone: "info", message: "Use Chat to multiply any artifact across a universe." })}
        >
          Run batch →
        </button>
      </div>
    </div>
  );
}

function ReportGrid({
  reports,
  density,
  onOpen,
  selected,
  onToggleSelect,
  hasActiveFilter,
  onResetFilters,
  inspectedReportId,
  onSelectReport,
}: {
  reports: ReportCardData[];
  density: Density;
  onOpen: ReportsSurfaceProps["onOpen"];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  hasActiveFilter?: boolean;
  onResetFilters?: () => void;
  inspectedReportId?: string | null;
  onSelectReport?: (report: ReportCardData) => void;
}) {
  if (reports.length === 0) {
    return (
      <div className="rd-card rd-card__hero" style={{ textAlign: "center", padding: "48px 32px" }}>
        <div className="rd-eyebrow" style={{ marginBottom: 8 }}>{hasActiveFilter ? "No matches" : "Empty"}</div>
        <h2 className="rd-h2">{hasActiveFilter ? "Nothing matches that filter." : "No reports yet."}</h2>
        <p className="rd-faint" style={{ marginTop: 4, fontSize: 13 }}>
          {hasActiveFilter ? "Try clearing the search or status filter." : "Run research from the chat surface to start building your library."}
        </p>
        {hasActiveFilter && onResetFilters && (
          <div className="rd-row" style={{ gap: 8, marginTop: 14, justifyContent: "center" }}>
            <button className="rd-btn rd-btn--primary rd-btn--sm" onClick={onResetFilters}>Reset filters</button>
            <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => window.dispatchEvent(new CustomEvent("rd:shortcuts:open"))}>See all shortcuts</button>
          </div>
        )}
      </div>
    );
  }

  if (density === "list") {
    return (
      <div className="rd-card" style={{ padding: 0 }}>
        {reports.map((r, i) => (
          <div
            key={r.id}
            role={onSelectReport ? "button" : undefined}
            tabIndex={onSelectReport ? 0 : undefined}
            aria-selected={inspectedReportId === r.id || undefined}
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest("button, input")) return;
              onSelectReport?.(r);
            }}
            onKeyDown={(event) => {
              if (!onSelectReport) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onSelectReport(r);
            }}
            style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) auto",
            alignItems: "center",
            gap: 16,
            padding: "12px 16px",
            borderBottom: i === reports.length - 1 ? "none" : "1px solid var(--rd-line-faint)",
            background: inspectedReportId === r.id ? "var(--rd-accent-soft)" : undefined,
            cursor: onSelectReport ? "pointer" : undefined,
          }}>
            <div className="rd-stack" style={{ gap: 4 }}>
              <div className="rd-row" style={{ gap: 6 }}>
                <StatusDot status={r.status} />
                <span className="rd-h3">{r.entity}</span>
                <span className="rd-mono" style={{ fontSize: 10.5, color: "var(--rd-ink-soft)" }}>{r.kind}</span>
              </div>
              <p className="rd-faint" style={{ fontSize: 12.5 }}>{displayReportDescription(r.description)}</p>
            </div>
            <div className="rd-mono" style={{ fontSize: 11, color: "var(--rd-ink-soft)" }}>
              {r.sources} sources · {r.claims} claims · {r.followUps} follow-ups · {r.updatedAt}
            </div>
            <div className="rd-row" style={{ gap: 4 }}>
              <button className="rd-btn rd-btn--primary rd-btn--sm" onClick={() => onOpen(r.id, "brief")}>Brief</button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => onOpen(r.id, "cards")}>Explore</button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => onOpen(r.id, "chat")}>Chat</button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Compact: 4 cols at 1280, 3 cols at 1000, 2 cols at 720, 1 col under
  // Grid: 3 cols at 1280, 2 cols at 900, 1 col under
  const cols = density === "compact"
    ? "repeat(auto-fit, minmax(280px, 1fr))"
    : "repeat(auto-fit, minmax(380px, 1fr))";

  return (
    <div className="rd-reports-grid" style={{ gridTemplateColumns: cols }} data-density={density}>
      {reports.map((r) => (
        <article
          key={r.id}
          className="rd-report-card"
          data-status={r.status}
          data-selected={selected.has(r.id) || inspectedReportId === r.id || undefined}
          aria-selected={inspectedReportId === r.id || undefined}
          onClick={(e) => {
            // Clicking the card body inspects the report; footer buttons open the full workspace.
            const tgt = e.target as HTMLElement;
            if (tgt.closest("button, input")) return;
            onSelectReport?.(r);
          }}
        >
          {/* Row 1: checkbox + entity + kind + status pill (Crunchbase row pattern) */}
          <header className="rd-report-card__head">
            <input
              type="checkbox"
              className="rd-report-card__check"
              checked={selected.has(r.id)}
              onChange={() => onToggleSelect(r.id)}
              aria-label={`Select ${r.entity}`}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="rd-report-card__title">
              <StatusDot status={r.status} />
              <span className="rd-report-card__entity">{r.entity}</span>
              <span className="rd-report-card__kind">{r.kind}</span>
            </span>
            <Pill tone={r.status === "verified" ? "green" : r.status === "watching" ? "blue" : "amber"}>
              {r.status === "review" ? "Needs review" : r.status === "watching" ? "Watching" : "Verified"}
            </Pill>
          </header>

          {/* Row 2: 1-line description with ellipsis */}
          <p className="rd-report-card__desc">{displayReportDescription(r.description)}</p>

          {/* Row 3: metrics + style chip + updated */}
          <div className="rd-report-card__metrics">
            <span><strong>{r.sources}</strong> sources</span>
            <span><strong>{r.claims}</strong> claims</span>
            <span><strong>{r.followUps}</strong> follow-ups</span>
            <span className="rd-report-card__updated">{r.updatedAt}</span>
          </div>

          <div className="rd-report-card__foot">
            <StyleChip reportId={r.id} />
            {/* Action buttons reveal on hover (Crunchbase / Pitchbook quick-action pattern) */}
            <div className="rd-report-card__actions">
              <button className="rd-btn rd-btn--primary rd-btn--sm" onClick={(e) => { e.stopPropagation(); onOpen(r.id, "brief"); }}>Brief</button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={(e) => { e.stopPropagation(); onOpen(r.id, "cards"); }}>Explore</button>
              <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={(e) => { e.stopPropagation(); onOpen(r.id, "chat"); }}>Chat</button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <strong style={{ color: "var(--rd-ink)", fontWeight: 590 }}>{value}</strong>{" "}
      <span style={{ color: "var(--rd-ink-soft)" }}>{label}</span>
    </span>
  );
}

function StatusDot({ status }: { status: ReportCardData["status"] }) {
  const cls = status === "verified" ? "rd-dot rd-dot--live"
    : status === "watching" ? "rd-dot rd-dot--watch"
    : "rd-dot rd-dot--review";
  return <span className={cls} aria-label={`Status: ${status}`} />;
}

function SearchIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--rd-ink-soft)" }}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}
