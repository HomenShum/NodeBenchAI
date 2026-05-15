/**
 * Reports — the reusable memory library.
 *
 * Compact card pattern with three-action footer (Brief · Explore · Chat) per spec.
 * Default density: compact. Sticky filter row.
 */

import { useMemo, useState, useEffect, useRef, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import * as d3 from "d3";
import { memoStyles, type ReportCardData, type Density, type Universe } from "../fixtures";
import { Pill } from "../components/Pill";
import { ReportNotebookView } from "../components/ReportNotebookView";
import { useReportsLive } from "../hooks/useReportsLive";
import type { LiveArtifactDetail, LiveArtifactMapNode } from "../hooks/useLiveArtifacts";
import { showToast } from "../components/Toast";
import {
  buildReportsDecisionQueue,
  ProductDecisionQueue,
  type ProductDecisionItem,
  sanitizeDecisionText,
} from "./ProductDecisionQueue";

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

interface ReportsSurfaceProps {
  onOpen: (id: string, tab: "brief" | "cards" | "chat") => void;
  onRunBatch?: (prompt: string) => void;
  onSelectReport?: (report: ReportCardData) => void;
  inspectedReportId?: string | null;
}

type ReportViewMode = "gallery" | "board" | "table" | "graph";
type ReportStage = "drafting" | "review" | "verified" | "stale" | "monitoring";
type ReportBoardColumnId = ReportStage | "archived";

const REPORT_VIEW_MODES: Array<{ id: ReportViewMode; label: string }> = [
  { id: "gallery", label: "Gallery" },
  { id: "board", label: "Board" },
  { id: "table", label: "Table" },
  { id: "graph", label: "Graph" },
];

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
  { id: "drafting", label: "Draft" },
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

  // Live data wiring: authenticated and anonymous workspaces show Convex-backed
  // runs/artifacts. Empty states remain explicit so production never masks a
  // broken live path with fixture reports.
  const { reports, details, isLive, isLoading, sourceLabel, liveCount } = useReportsLive();

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
              ? "Checking Convex-backed report artifacts."
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
        <button type="button" onClick={() => showToast({ tone: isLive ? "success" : "info", message: isLive ? `${sourceLabel}. Reports are live.` : "No live reports yet. This view does not silently substitute fixtures." })}>
          {isLive ? "Live memory" : "No fixture fallback"}
        </button>
        {query && <button type="button" onClick={resetFilters}>Clear</button>}
      </div>
      {visibleReports.length === 0 ? (
        <article className="rd-v3-card rd-v3-card--empty">
          <h2>{hasActiveFilter ? "No matching live reports" : "No live coverage returned"}</h2>
          <p>
            {hasActiveFilter
              ? "Clear the filters to return to the live report set."
              : "Convex returned zero report artifacts for this session. Run research from Chat to create the first report."}
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
          reports={visibleReports}
          details={details}
          selectedReport={selectedReport}
          stageOverrides={stageOverrides}
          onOpen={openReportAction}
          onSelect={handleSelectReport}
        />
      ) : (
        <div className="rd-v3-grid" data-density={density}>
          {visibleReports.map((report) => (
            <ReportCardV3
              key={report.id}
              report={report}
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
            <Pill tone="green" title="Showing live Convex artifacts from batch runs, daily briefs, or the LinkedIn archive">
              <span className="rd-dot rd-dot--live" />{sourceLabel}
            </Pill>
          ) : isLoading && reports.length === 0 ? (
            <Pill tone="amber">Loading live coverage…</Pill>
          ) : isLoading ? (
            <Pill title="Checking for Convex-backed public and private artifacts.">
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
  if (/person|founder|ceo|partner|investor|amodei|altman|lin/.test(text)) return "person";
  if (stage === "monitoring" || /watch|monitor/.test(text)) return "monitoring";
  return "company";
}

type ReportGraphNode = {
  id: string;
  label: string;
  type: string;
  graphType: "company" | "person" | "brief" | "monitoring";
  weight: number;
  report?: ReportCardData;
  detail?: LiveArtifactDetail;
  provenance: "universe" | "report" | "artifact" | "source";
  liveNodeId?: string;
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
    | "history";
  label: string;
};

type ReportGraphData = {
  nodes: ReportGraphNode[];
  links: ReportGraphLink[];
  root: ReportGraphNode | null;
  sourceLabel: string;
  sourceRows: number;
  artifactNodeCount: number;
  artifactEdgeCount: number;
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

function buildReportGraph(
  reports: ReportCardData[],
  details: LiveArtifactDetail[],
  selectedReport: ReportCardData | null,
  stageOverrides: Record<string, ReportStage>,
): ReportGraphData {
  const rootReport = selectedReport && reports.some((report) => report.id === selectedReport.id)
    ? selectedReport
    : reports[0] ?? null;
  if (!rootReport) return { nodes: [], links: [], root: null, sourceLabel: "No live graph", sourceRows: 0, artifactNodeCount: 0, artifactEdgeCount: 0 };

  const rootDetail = detailForReport(details, rootReport);
  const related = reports.filter((report) => report.id !== rootReport.id).slice(0, REPORT_GRAPH_NEIGHBOR_POSITIONS.length);
  const visible = [rootReport, ...related];
  const visibleDetails = visible.map((report) => detailForReport(details, report)).filter((detail): detail is LiveArtifactDetail => Boolean(detail));
  const totalSources = visibleDetails.length
    ? visibleDetails.reduce((sum, detail) => sum + detail.sourceRows.length, 0)
    : reports.reduce((sum, report) => sum + report.sources, 0);
  const reviewCount = reports.filter((report) => {
    const stage = getReportStage(report, stageOverrides[report.id]);
    return stage === "review" || stage === "stale" || stage === "drafting";
  }).length;

  const nodes: ReportGraphNode[] = visible.map((report, index) => {
    const stage = getReportStage(report, stageOverrides[report.id]);
    const detail = detailForReport(details, report);
    const isRoot = report.id === rootReport.id;
    const relatedPosition = isRoot
      ? { x: 460, y: 250 }
      : REPORT_GRAPH_NEIGHBOR_POSITIONS[(index - 1) % REPORT_GRAPH_NEIGHBOR_POSITIONS.length];
    const freshness = detail ? `Updated ${detail.updatedAt}` : freshnessText(report, stage);
    const sourceWeight = Math.max(1, detail?.sourceRows.length ?? report.sources);
    return {
      id: report.id,
      label: report.entity,
      type: report.kind,
      graphType: reportGraphType(report, stage),
      weight: sourceWeight,
      report,
      detail,
      provenance: "report",
      stage,
      x: relatedPosition.x,
      y: relatedPosition.y,
      radius: isRoot ? 25 : 13 + Math.min(10, Math.max(2, detail?.sourceRows.length ?? report.sources)) * 0.75,
      sources: detail ? `${detail.sourceRows.length} source row${detail.sourceRows.length === 1 ? "" : "s"}` : `${report.sources} source row${report.sources === 1 ? "" : "s"}`,
      freshness,
      staleHours: stage === "stale" ? Math.max(48, freshnessHours(freshness)) : freshnessHours(freshness),
      verified: detail ? `${detail.claimCount} claim${detail.claimCount === 1 ? "" : "s"} - ${stageLabel(stage)}` : evidenceText(report, stage),
      coverage: detail?.tags.slice(0, 4) ?? reportSignals(report),
      signals: detail ? detailSignals(detail) : [
        displayReportDescription(report.description),
        `${report.followUps} follow-up${report.followUps === 1 ? "" : "s"} queued`,
      ].filter(Boolean),
    };
  });

  const artifactNodes = (rootDetail?.nodes ?? [])
    .filter((node) => node.id !== "root")
    .slice(0, 0);
  artifactNodes.forEach((node, index) => {
    if (!rootDetail) return;
    const artifactPosition = ARTIFACT_GRAPH_POSITIONS[index % ARTIFACT_GRAPH_POSITIONS.length];
    const stage = stageFromLiveNode(node, getReportStage(rootReport, stageOverrides[rootReport.id]));
    nodes.push({
      id: liveNodeKey(rootDetail, node.id),
      label: node.title,
      type: node.subtitle.split(/\s+-\s+|\s+\u00b7\s+/)[0] || rootDetail.kind,
      graphType: node.tone === "blue" ? "person" : node.tone === "green" ? "monitoring" : "brief",
      weight: Math.max(1, rootDetail.sourceRows.length),
      report: rootReport,
      detail: rootDetail,
      provenance: "artifact",
      liveNodeId: node.id,
      stage,
      x: artifactPosition.x,
      y: artifactPosition.y,
      radius: node.tone === "accent" ? 17 : 10 + Math.min(7, rootDetail.sourceRows.length) * 0.45,
      sources: node.subtitle,
      freshness: `From ${rootDetail.title}`,
      staleHours: freshnessHours(rootDetail.updatedAt),
      verified: `${rootDetail.claimCount} claims - ${rootDetail.sourceRows.length} sources`,
      coverage: [rootDetail.kind, ...rootDetail.tags].slice(0, 4),
      signals: detailSignals(rootDetail),
    });
  });

  const sourceNodes = (rootDetail?.sourceRows ?? []).slice(0, 0);
  sourceNodes.forEach((row, index) => {
    if (!rootDetail) return;
    const freshness = `Refreshed ${row.refreshed}`;
    nodes.push({
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
      signals: [row.excerpt, row.href ?? "Convex source row"].filter(Boolean).slice(0, 3),
    });
  });

  nodes.push({
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
    linkKeys.add(key);
    links.push(link);
  };

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

  if (rootDetail) rootDetail.edges.forEach((edge) => {
    const sourceId = edge.from === "root" ? rootReport.id : liveNodeKey(rootDetail, edge.from);
    const targetId = edge.to === "root" ? rootReport.id : liveNodeKey(rootDetail, edge.to);
    const targetLiveNode = rootDetail.nodes.find((node) => node.id === edge.to) ?? rootDetail.nodes.find((node) => node.id === edge.from);
    if (!nodes.some((node) => node.id === sourceId) || !nodes.some((node) => node.id === targetId)) return;
    pushLink({
      source: sourceId,
      target: targetId,
      type: targetLiveNode ? edgeTypeForLiveNode(targetLiveNode, rootDetail) : "coverage",
      label: targetLiveNode?.subtitle.slice(0, 24) ?? "artifact edge",
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

  pushLink({ source: "__universe__", target: rootReport.id, type: "coverage", label: "active root" });
  related.slice(0, 4).forEach((report) => {
    pushLink({
      source: "__universe__",
      target: report.id,
      type: graphEdgeType(report, getReportStage(report, stageOverrides[report.id])),
      label: "coverage",
    });
  });

  return {
    nodes,
    links,
    root: nodes.find((node) => node.id === rootReport.id) ?? null,
    sourceLabel: visibleDetails.length ? "Convex artifact graph" : "Report metadata graph",
    sourceRows: totalSources,
    artifactNodeCount: visibleDetails.reduce((sum, detail) => sum + detail.nodes.length, 0),
    artifactEdgeCount: visibleDetails.reduce((sum, detail) => sum + detail.edges.length, 0),
  };
}

function ReportCardV3({
  report,
  active,
  stage,
  sourceLabel,
  onOpen,
  onSelect,
}: {
  report: ReportCardData;
  active: boolean;
  stage: ReportStage;
  sourceLabel: string;
  onOpen: ReportsSurfaceProps["onOpen"];
  onSelect?: (report: ReportCardData) => void;
}) {
  const signals = reportSignals(report);
  const backlinks = reportBacklinks(report);
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
        {signals.map((signal, index) => <span className="v3-signal" data-color={signalColor(index)} key={signal}>{signal}</span>)}
      </div>
      <div className="rd-v3-sources v3-sources">
        <span className="v3-src">{evidenceText(report, stage)}</span>
        <span className="v3-src">{report.sources} source rows</span>
        <span className="v3-src-more">{report.followUps} follow-ups</span>
      </div>
      {backlinks.length > 0 && (
        <div className="rd-v3-backlinks v3-backlinks">
          {backlinks.map((item) => <span key={item}>→ {item}</span>)}
        </div>
      )}
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
  const graph = useMemo(() => buildReportGraph(reports, details, selectedReport, stageOverrides), [reports, details, selectedReport, stageOverrides]);
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
                {(activeNode?.coverage ?? ["reports"]).map((tag) => <span key={tag}>{tag}</span>)}
              </dd>
            </div>
          </dl>
          <ul>
            {(activeNode?.signals ?? ["Select a report node to inspect the relationship context."]).slice(0, 3).map((signal) => (
              <li key={signal}>{signal}</li>
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
  type D3GraphNode = ReportGraphNode & d3.SimulationNodeDatum;
  type D3GraphLink = Omit<ReportGraphLink, "source" | "target"> & {
    source: string | D3GraphNode;
    target: string | D3GraphNode;
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const pinnedNodeIdRef = useRef<string | null>(null);
  const graph = useMemo(() => buildReportGraph(reports, details, selectedReport, stageOverrides), [reports, details, selectedReport, stageOverrides]);
  const [graphQuery, setGraphQuery] = useState("");
  const [pinnedNodeId, setPinnedNodeId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [peekPosition, setPeekPosition] = useState<{ x: number; y: number } | null>(null);
  const activeNode = graph.nodes.find((node) => node.id === pinnedNodeId) ?? null;
  const tooltipNode = tooltip ? graph.nodes.find((node) => node.id === tooltip.nodeId) : null;
  const normalizedGraphQuery = graphQuery.trim().toLowerCase();
  const linkedReportCount = Math.max(0, graph.nodes.filter((node) => node.provenance === "report").length - 1);

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
    pinnedNodeIdRef.current = null;
    setPinnedNodeId(null);
    setTooltip(null);
    setPeekPosition(null);
  }, [graph.root?.id]);

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

  useEffect(() => {
    const svgElement = svgRef.current;
    const containerElement = containerRef.current;
    if (!svgElement || !containerElement) return;

    const rect = containerElement.getBoundingClientRect();
    const width = Math.max(560, Math.round(rect.width || 720));
    const visibleHeight = Math.max(420, Math.min(620, Math.round(window.innerHeight - rect.top - 24)));
    const height = Math.max(420, visibleHeight);
    const nodes: D3GraphNode[] = graph.nodes.map((node) => ({ ...node, x: node.x, y: node.y }));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const links: D3GraphLink[] = graph.links
      .filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target))
      .map((link) => ({ ...link }));
    const weights = nodes.map((node) => Math.max(1, node.weight));
    const minWeight = Math.min(...weights, 1);
    const maxWeight = Math.max(...weights, 1);
    const radiusFor = (node: D3GraphNode) => {
      if (maxWeight === minWeight) return 12;
      return 7 + ((Math.max(1, node.weight) - minWeight) / (maxWeight - minWeight)) * 11;
    };
    const graphTypeColor: Record<ReportGraphNode["graphType"], string> = {
      company: "#d97757",
      person: "#60a5fa",
      brief: "#a78bfa",
      monitoring: "#34d399",
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
      cluster: { stroke: "var(--rd-accent)", dash: "8 5", width: 1 },
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
      .force("link", d3.forceLink<D3GraphNode, D3GraphLink>(links).id((node) => node.id).distance(130))
      .force("charge", d3.forceManyBody<D3GraphNode>().strength(-420))
      .force("center", d3.forceCenter(width / 2, visibleHeight * 0.45))
      .force("x", d3.forceX<D3GraphNode>(width / 2).strength(0.04))
      .force("y", d3.forceY<D3GraphNode>(visibleHeight * 0.45).strength(0.06))
      .force("collide", d3.forceCollide<D3GraphNode>().radius((node) => radiusFor(node) + 20))
      .alphaDecay(0.018);

    const linkEl = g.append("g").selectAll<SVGLineElement, D3GraphLink>("line").data(links).join("line")
      .attr("stroke", (link) => edgeStyle[link.type]?.stroke ?? "var(--rd-ink-faint)")
      .attr("stroke-width", (link) => edgeStyle[link.type]?.width ?? 0.7)
      .attr("stroke-dasharray", (link) => edgeStyle[link.type]?.dash ?? "")
      .attr("opacity", 0.5);

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
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (node) => `${node.label}, ${node.type}, ${node.verified}`)
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
      .attr("class", "rd-v3-graph-node__label")
      .text((node) => node.label)
      .attr("dx", (node) => radiusFor(node) + 6)
      .attr("dy", "0.35em");

    nodeEl.append("text")
      .attr("class", "rd-v3-graph-node__meta")
      .text((node) => node.stage === "universe" ? "monitoring" : node.stage)
      .attr("dx", (node) => radiusFor(node) + 6)
      .attr("dy", "1.5em");

    const applySearch = () => {
      nodeEl.attr("opacity", (node) => (!normalizedGraphQuery || searchMatch(node)) ? 1 : 0.12);
      linkEl.attr("opacity", (link) => {
        if (!normalizedGraphQuery) return 0.5;
        const source = typeof link.source === "object" ? link.source : nodeById.get(String(link.source));
        const target = typeof link.target === "object" ? link.target : nodeById.get(String(link.target));
        return (source && searchMatch(source)) || (target && searchMatch(target)) ? 0.6 : 0.04;
      });
    };
    const highlight = (nodeId: string) => {
      const connected = connectedSet(nodeId);
      nodeEl.attr("opacity", (node) => connected.has(node.id) ? 1 : 0.08);
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
      linkEl.attr("opacity", 0.5).attr("stroke-width", (link) => edgeStyle[link.type]?.width ?? 0.7);
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
      nodeEl.attr("transform", (node) => `translate(${node.x ?? 0},${node.y ?? 0})`);
    });

    applySearch();

    return () => {
      simulation.stop();
      svg.on(".zoom", null);
      svg.on("click", null);
    };
  }, [graph, normalizedGraphQuery, onSelect]);

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

  return (
    <section
      className="rd-v3-graph"
      aria-label="Report relationship graph"
      data-graph-source={graph.sourceLabel}
      data-node-count={graph.nodes.length}
      data-edge-count={graph.links.length}
      data-artifact-node-count={graph.artifactNodeCount}
      data-artifact-edge-count={graph.artifactEdgeCount}
    >
      <div className="rd-v3-graph__controls">
        <button type="button" className="rd-v3-graph__fit" onClick={resetGraph}>Fit</button>
        <label className="rd-v3-graph__search">
          <span aria-hidden="true">⌕</span>
          <input value={graphQuery} onChange={(event) => setGraphQuery(event.target.value)} placeholder="Search graph..." aria-label="Search graph nodes" />
        </label>
        <span className="rd-v3-graph__legend" aria-label="Relationship legend">
          <span><i data-edge="funding" />Funding</span>
          <span><i data-edge="competition" />Competition</span>
          <span><i data-edge="integration" />Integration</span>
        </span>
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
                  {(activeNode.coverage.length > 0 ? activeNode.coverage : ["reports"]).map((tag) => <span key={tag}>{tag}</span>)}
                </dd>
              </div>
            </dl>
            <div className="rd-v3-graph-peek__signals">
              {(activeNode.signals.length > 0 ? activeNode.signals : ["Select a report node to inspect the relationship context."]).slice(0, 3).map((signal) => (
                <p key={signal}>{signal}</p>
              ))}
            </div>
            <div className="rd-v3-graph-peek__actions">
              <button type="button" onClick={() => openNodeNotebook(activeNode)}>Open notebook</button>
              <button type="button" onClick={() => showToast({ tone: "info", message: `Comparison packet queued for ${activeNode.label}.` })}>Compare</button>
              <button type="button" onClick={() => showToast({ tone: "info", message: `Delta refresh preview queued for ${activeNode.label}. New sources only; unchanged content skips extraction.` })}>Refresh</button>
            </div>
          </aside>
        )}
      </div>
      <p className="rd-v3-graph__provenance">
        {graph.sourceLabel} - {graph.nodes.length} nodes - {graph.links.length} edges - {graph.sourceRows} source rows - {linkedReportCount} neighboring reports
      </p>
    </section>
  );
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
          Convex returned zero report artifacts for this session.
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
        <Pill tone="green"><span className="rd-dot rd-dot--live" />Convex-backed</Pill>
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
              <button className="rd-btn rd-btn--ghost rd-btn--sm" onClick={() => onOpen(r.id, "brief")}>Brief</button>
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
              <button className="rd-btn rd-btn--ghost rd-btn--sm" onClick={(e) => { e.stopPropagation(); onOpen(r.id, "brief"); }}>Brief</button>
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
