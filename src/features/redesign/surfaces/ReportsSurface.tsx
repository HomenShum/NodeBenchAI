/**
 * Reports — the reusable memory library.
 *
 * Compact card pattern with three-action footer (Brief · Explore · Chat) per spec.
 * Default density: compact. Sticky filter row.
 */

import { useMemo, useState, useEffect, useRef, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { memoStyles, type ReportCardData, type Density, type Universe } from "../fixtures";
import { Pill } from "../components/Pill";
import { useReportsLive } from "../hooks/useReportsLive";
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

const REPORT_VIEW_MODES: Array<{ id: ReportViewMode; label: string }> = [
  { id: "gallery", label: "Gallery" },
  { id: "board", label: "Board" },
  { id: "table", label: "Table" },
  { id: "graph", label: "Graph" },
];

const REPORT_STAGE_COLUMNS: Array<{ id: ReportStage; label: string; hint: string }> = [
  { id: "drafting", label: "Drafting", hint: "Gathering sources" },
  { id: "review", label: "Needs review", hint: "Claims need analyst review" },
  { id: "verified", label: "Verified", hint: "Notebook ready" },
  { id: "stale", label: "Stale", hint: "Refresh evidence" },
  { id: "monitoring", label: "Monitoring", hint: "Watchlist active" },
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
  const [viewMode, setViewMode] = useState<ReportViewMode>("gallery");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortOpen, setSortOpen] = useState(false);
  const [stageOverrides, setStageOverrides] = useState<Record<string, ReportStage>>({});
  const [graphSelectedReportId, setGraphSelectedReportId] = useState<string | null>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  // Click-outside dismiss for sort dropdown
  useEffect(() => {
    if (!sortOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!sortRef.current?.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [sortOpen]);

  // Live data wiring: authenticated and anonymous workspaces show Convex-backed
  // runs/artifacts. Empty states remain explicit so production never masks a
  // broken live path with fixture reports.
  const { reports, isLive, isLoading, sourceLabel, liveCount } = useReportsLive();

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
  const runBatchPrompt = () => {
    const prompt = "Run a coverage batch for my active report universe. Generate notebook-first reports, gather sources, extract claims, verify evidence, and create the review queue.";
    if (onRunBatch) onRunBatch(prompt);
    else onOpen("new", "chat");
  };
  const handleDragStart = (event: DragEvent<HTMLElement>, reportId: string) => {
    event.dataTransfer.setData("text/plain", reportId);
    event.dataTransfer.effectAllowed = "move";
  };
  const handleStageDrop = (event: DragEvent<HTMLElement>, stage: ReportStage) => {
    event.preventDefault();
    const reportId = event.dataTransfer.getData("text/plain");
    if (!reportId) return;
    setStageOverrides((prev) => ({ ...prev, [reportId]: stage }));
    showToast({ tone: "success", message: `Moved report to ${stageLabel(stage)}. This is a local review-board preview until a write is approved.` });
  };

  return (
    <div className="rd-v3-reports" data-view={viewMode}>
      <header className="rd-v3-universe-header">
        <div>
          <div className="rd-v3-kicker">Reports</div>
          <h1>AI Infrastructure Coverage</h1>
          <p>
            {isLoading && reports.length === 0
              ? "Checking Convex-backed report artifacts."
              : `${reports.length} reports, ${totalSources} sources, ${reviewCount} need review.`}
          </p>
        </div>
        <div className="rd-v3-universe-actions">
          <button type="button" onClick={() => setViewMode("board")}>Review queue</button>
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
      <div className="rd-v3-view-bar">
        <div className="rd-v3-tabs" role="tablist" aria-label="Report views">
          {REPORT_VIEW_MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={viewMode === item.id}
              className={viewMode === item.id ? "is-active" : ""}
              onClick={() => setViewMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      <div className="rd-v3-filter-pills" role="tablist" aria-label="Filter reports by status">
        {STATUS_FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={filter === item.id ? "is-active" : ""}
            aria-selected={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label} {counts[item.id] ?? 0}
          </button>
        ))}
        <button type="button" className={kindFilter !== "all" ? "is-active" : ""} onClick={() => setKindFilter(kindFilter === "all" ? "Diligence" : "all")}>
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
          onOpen={onOpen}
          onSelect={handleSelectReport}
        />
      ) : viewMode === "table" ? (
        <ReportTable reports={visibleReports} stageOverrides={stageOverrides} onOpen={onOpen} onSelect={handleSelectReport} />
      ) : viewMode === "graph" ? (
        <ReportGraphPreview
          reports={visibleReports}
          selectedReport={selectedReport}
          stageOverrides={stageOverrides}
          onOpen={onOpen}
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
              onOpen={onOpen}
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

function getReportStage(report: ReportCardData, override?: ReportStage): ReportStage {
  if (override) return override;
  if (report.status === "review") return "review";
  if (report.status === "watching") return "monitoring";
  const staleSignals = /stale|expired|refresh|old|3d|5d|week/i.test(`${report.description} ${report.updatedAt}`);
  if (staleSignals) return "stale";
  if (report.sources <= 2 || /draft|gathering|queued|generating/i.test(report.description)) return "drafting";
  return "verified";
}

function stageLabel(stage: ReportStage): string {
  return REPORT_STAGE_COLUMNS.find((item) => item.id === stage)?.label ?? stage;
}

function stageTone(stage: ReportStage): "green" | "amber" | "blue" | undefined {
  if (stage === "verified") return "green";
  if (stage === "review" || stage === "stale" || stage === "drafting") return "amber";
  if (stage === "monitoring") return "blue";
  return undefined;
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

function notebookState(stage: ReportStage): string {
  if (stage === "verified" || stage === "monitoring") return "Notebook ready";
  if (stage === "review") return "Review patch";
  if (stage === "stale") return "Refresh needed";
  return "Drafting";
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

type ReportGraphNode = {
  id: string;
  label: string;
  type: string;
  report?: ReportCardData;
  stage: ReportStage | "universe";
  x: number;
  y: number;
  radius: number;
  sources: string;
  freshness: string;
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

function buildReportGraph(
  reports: ReportCardData[],
  selectedReport: ReportCardData | null,
  stageOverrides: Record<string, ReportStage>,
): { nodes: ReportGraphNode[]; links: ReportGraphLink[]; root: ReportGraphNode | null } {
  const rootReport = selectedReport && reports.some((report) => report.id === selectedReport.id)
    ? selectedReport
    : reports[0] ?? null;
  if (!rootReport) return { nodes: [], links: [], root: null };

  const related = reports.filter((report) => report.id !== rootReport.id).slice(0, 11);
  const visible = [rootReport, ...related];
  const totalSources = reports.reduce((sum, report) => sum + report.sources, 0);
  const reviewCount = reports.filter((report) => {
    const stage = getReportStage(report, stageOverrides[report.id]);
    return stage === "review" || stage === "stale" || stage === "drafting";
  }).length;

  const nodes: ReportGraphNode[] = visible.map((report, index) => {
    const stage = getReportStage(report, stageOverrides[report.id]);
    const isRoot = report.id === rootReport.id;
    const angle = related.length <= 1 ? -Math.PI / 2 : ((index - 1) / related.length) * Math.PI * 2 - Math.PI / 2;
    return {
      id: report.id,
      label: report.entity,
      type: report.kind,
      report,
      stage,
      x: isRoot ? 460 : 460 + Math.cos(angle) * 270,
      y: isRoot ? 250 : 250 + Math.sin(angle) * 170,
      radius: isRoot ? 24 : 13 + Math.min(10, Math.max(2, report.sources)) * 0.75,
      sources: `${report.sources} source row${report.sources === 1 ? "" : "s"}`,
      freshness: freshnessText(report, stage),
      verified: evidenceText(report, stage),
      coverage: reportSignals(report),
      signals: [
        displayReportDescription(report.description),
        `${report.followUps} follow-up${report.followUps === 1 ? "" : "s"} queued`,
      ].filter(Boolean),
    };
  });

  nodes.push({
    id: "__universe__",
    label: "AI Infra universe",
    type: "Universe",
    stage: "universe",
    x: 460,
    y: 470,
    radius: 18,
    sources: `${totalSources} source rows`,
    freshness: `${reports.length} live reports`,
    verified: reviewCount ? `${reviewCount} reports need work` : "All visible reports have a next step",
    coverage: ["reports", "sources", "claims"],
    signals: [
      "This graph is derived from live report artifacts.",
      "Open a node to jump into the durable notebook.",
    ],
  });

  const links: ReportGraphLink[] = related.map((report) => {
    const stage = getReportStage(report, stageOverrides[report.id]);
    const sameKind = report.kind === rootReport.kind;
    return {
      source: rootReport.id,
      target: report.id,
      type: sameKind ? "cluster" : graphEdgeType(report, stage),
      label: sameKind ? report.kind : stageLabel(stage),
    };
  });

  links.push({ source: "__universe__", target: rootReport.id, type: "coverage", label: "active root" });
  related.slice(0, 4).forEach((report) => {
    links.push({
      source: "__universe__",
      target: report.id,
      type: graphEdgeType(report, getReportStage(report, stageOverrides[report.id])),
      label: "coverage",
    });
  });

  return { nodes, links, root: nodes.find((node) => node.id === rootReport.id) ?? null };
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
  return (
    <article
      className="rd-v3-card"
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
      <div className="rd-v3-card__head">
        <span className="rd-v3-icon">{report.entity.slice(0, 1).toUpperCase()}</span>
        <strong>{report.entity}</strong>
        <Pill tone={stageTone(stage)}>{stageLabel(stage)}</Pill>
        <button type="button" aria-label={`More actions for ${report.entity}`} onClick={(event) => event.stopPropagation()}>⋯</button>
      </div>
      <p className="rd-v3-card__kind">{report.kind}</p>
      <p className="rd-v3-card__thesis">{displayReportDescription(report.description)}</p>
      <div className="rd-v3-signals">
        {signals.map((signal) => <span key={signal}>{signal}</span>)}
      </div>
      <div className="rd-v3-sources">
        <span>{evidenceText(report, stage)}</span>
        <span>{report.sources} source rows</span>
        <span>{report.followUps} follow-ups</span>
      </div>
      {backlinks.length > 0 && (
        <div className="rd-v3-backlinks">
          {backlinks.map((item) => <span key={item}>→ {item}</span>)}
        </div>
      )}
      <div className="rd-v3-card__foot">
        <span>{sourceLabel} · {freshnessText(report, stage)}</span>
        <span>{notebookState(stage)}</span>
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
  onStageDrop: (event: DragEvent<HTMLElement>, stage: ReportStage) => void;
  onOpen: ReportsSurfaceProps["onOpen"];
  onSelect?: (report: ReportCardData) => void;
}) {
  return (
    <section className="rd-v3-board" aria-label="Draggable report review board">
      {REPORT_STAGE_COLUMNS.map((column) => {
        const columnReports = reports.filter((report) => getReportStage(report, stageOverrides[report.id]) === column.id);
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
  selectedReport,
  stageOverrides,
  onOpen,
  onSelect,
}: {
  reports: ReportCardData[];
  selectedReport: ReportCardData | null;
  stageOverrides: Record<string, ReportStage>;
  onOpen: ReportsSurfaceProps["onOpen"];
  onSelect?: (report: ReportCardData) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const movedDuringPointerRef = useRef(false);
  const graph = useMemo(() => buildReportGraph(reports, selectedReport, stageOverrides), [reports, selectedReport, stageOverrides]);
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
  const linkedReportCount = Math.max(0, graph.nodes.filter((node) => node.report).length - 1);
  const totalSources = reports.reduce((sum, report) => sum + report.sources, 0);
  const normalizedGraphQuery = graphQuery.trim().toLowerCase();
  const matchedNodeIds = useMemo(() => {
    if (!normalizedGraphQuery) return new Set<string>();
    return new Set(graph.nodes.filter((node) => {
      const haystack = [
        node.label,
        node.type,
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
    <section className="rd-v3-graph" aria-label="Report relationship graph">
      <div className="rd-v3-graph__controls">
        <div>
          <span className="rd-eyebrow">Relationship map</span>
          <strong>{graph.root?.label ?? "Select a report"}</strong>
          <small>{linkedReportCount} neighboring reports · {totalSources} source rows</small>
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
            <span><i data-edge="competition" />Competition</span>
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
            return (
              <button
                key={node.id}
                type="button"
                style={{
                  left: `${(pos.x / 920) * 100}%`,
                  top: `${(pos.y / 540) * 100}%`,
                  width: node.id === "__universe__" ? 170 : Math.max(150, size * 3.4),
                }}
                aria-label={`${node.label}, ${node.type}, ${node.verified}`}
                aria-pressed={activeNodeId === node.id}
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
                <small>{node.stage === "universe" ? "coverage universe" : stageLabel(node.stage)}</small>
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
            <span>{tooltipNode.type} · {stageLabel(tooltipNode.stage === "universe" ? "monitoring" : tooltipNode.stage)}</span>
            <span>{connectedIds.size > 0 ? connectedIds.size - 1 : 0} connections</span>
          </div>
        )}

        {pinnedNode && (
        <aside className="rd-v3-graph-peek" role="dialog" aria-label="Entity details" style={peekStyle}>
          <div className="rd-v3-graph-peek__head">
            <span>{activeNode?.label.slice(0, 1).toUpperCase() ?? "G"}</span>
            <div>
              <strong>{activeNode?.label ?? "No node selected"}</strong>
              <small>{activeNode?.type ?? "Graph"} · {activeStage ? stageLabel(activeStage) : "relationship map"}</small>
            </div>
          </div>
          <dl>
            <div><dt>Sources</dt><dd>{activeNode?.sources ?? "Open a report node"}</dd></div>
            <div><dt>Freshness</dt><dd>{activeNode?.freshness ?? "No freshness state"}</dd></div>
            <div><dt>Verified</dt><dd>{activeNode?.verified ?? "No evidence state"}</dd></div>
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
