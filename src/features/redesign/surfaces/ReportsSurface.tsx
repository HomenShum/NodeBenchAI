/**
 * Reports — the reusable memory library.
 *
 * Compact card pattern with three-action footer (Brief · Explore · Chat) per spec.
 * Default density: compact. Sticky filter row.
 */

import { useMemo, useState, useEffect, useRef, type DragEvent } from "react";
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
  return sanitizeDecisionText(description);
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

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "verified", label: "Verified" },
  { id: "watching", label: "Watching" },
  { id: "review", label: "Needs review" },
] as const;

const KIND_FILTERS = [
  { id: "all", label: "All types" },
  { id: "Diligence", label: "Diligence" },
  { id: "Event", label: "Events" },
  { id: "Theme", label: "Themes" },
  { id: "Coverage", label: "Coverage" },
] as const;

export function ReportsSurface({ onOpen, onRunBatch, onSelectReport, inspectedReportId }: ReportsSurfaceProps) {
  const [filter, setFilter] = useState<typeof STATUS_FILTERS[number]["id"]>("all");
  const [kindFilter, setKindFilter] = useState<typeof KIND_FILTERS[number]["id"]>("all");
  const [density, setDensity] = useState<Density>("compact");
  const [viewMode, setViewMode] = useState<ReportViewMode>("gallery");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortOpen, setSortOpen] = useState(false);
  const [stageOverrides, setStageOverrides] = useState<Record<string, ReportStage>>({});
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

  // Status facet counts (Crunchbase-style with N badge per chip)
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: reports.length, verified: 0, watching: 0, review: 0 };
    for (const r of reports) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [reports]);

  const filtered = useMemo(() => {
    const base = reports.filter((r) => {
      if (filter === "verified" && r.status !== "verified") return false;
      if (filter === "watching" && r.status !== "watching") return false;
      if (filter === "review" && r.status !== "review") return false;
      if (kindFilter !== "all" && r.kind !== kindFilter) return false;
      if (query && !`${r.entity} ${r.description}`.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
    const statusRank: Record<ReportCardData["status"], number> = { review: 0, watching: 1, verified: 2 };
    return [...base].sort((a, b) => {
      switch (sortKey) {
        case "entity":  return a.entity.localeCompare(b.entity);
        case "sources": return b.sources - a.sources;
        case "claims":  return b.claims - a.claims;
        case "status":  return statusRank[a.status] - statusRank[b.status];
        case "updated":
        default: return 0; // live query order is already recency-ranked
      }
    });
  }, [reports, filter, kindFilter, query, sortKey]);

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
  const confidenceScore = Math.max(0, Math.min(100, Math.round((verifiedShare * 0.62) + Math.min(totalSources, 120) * 0.18)));
  const selectedReport = filtered.find((report) => report.id === inspectedReportId) ?? visibleReports[0] ?? null;
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
              : `${reports.length} reports, ${totalSources} sources, ${reviewCount} need review, confidence ${confidenceScore}/100.`}
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
          onSelect={onSelectReport}
        />
      ) : viewMode === "table" ? (
        <ReportTable reports={visibleReports} stageOverrides={stageOverrides} onOpen={onOpen} onSelect={onSelectReport} />
      ) : viewMode === "graph" ? (
        <ReportGraphPreview reports={visibleReports} selectedReport={selectedReport} onOpen={onOpen} onSelect={onSelectReport} />
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
              onSelect={onSelectReport}
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
              onClick={() => showToast({ tone: "info", message: `Local rubric preview queued for ${selected.size} selected report${selected.size === 1 ? "" : "s"}. Run Chat to persist a scored artifact.` })}
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
      onClick={() => onSelect?.(report)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect?.(report);
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
        <span>{report.sources} sources</span>
        <span>{report.claims} claims</span>
        <span>{report.followUps} follow-ups</span>
      </div>
      {backlinks.length > 0 && (
        <div className="rd-v3-backlinks">
          {backlinks.map((item) => <span key={item}>→ {item}</span>)}
        </div>
      )}
      <div className="rd-v3-card__foot">
        <span>{sourceLabel} · {report.updatedAt}</span>
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
                onClick={() => onSelect?.(report)}
                onDoubleClick={() => onOpen(report.id, "brief")}
              >
                <span>{report.entity.slice(0, 1).toUpperCase()}</span>
                <strong>{report.entity}</strong>
                <small>{report.sources} sources · {report.claims} claims</small>
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
        <thead><tr><th>Report</th><th>Status</th><th>Type</th><th>Sources</th><th>Claims</th><th>Notebook</th><th>Action</th></tr></thead>
        <tbody>
          {reports.map((report) => {
            const stage = getReportStage(report, stageOverrides[report.id]);
            return (
              <tr key={report.id} onClick={() => onSelect?.(report)}>
                <td><strong>{report.entity}</strong><span>{displayReportDescription(report.description)}</span></td>
                <td>{stageLabel(stage)}</td>
                <td>{report.kind}</td>
                <td>{report.sources}</td>
                <td>{report.claims}</td>
                <td>{notebookState(stage)}</td>
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
  onOpen,
  onSelect,
}: {
  reports: ReportCardData[];
  selectedReport: ReportCardData | null;
  onOpen: ReportsSurfaceProps["onOpen"];
  onSelect?: (report: ReportCardData) => void;
}) {
  const root = selectedReport ?? reports[0];
  return (
    <section className="rd-v3-graph" aria-label="Report relationship graph preview">
      <div className="rd-v3-graph__root">
        <span>{root?.entity.slice(0, 1).toUpperCase() ?? "R"}</span>
        <strong>{root?.entity ?? "Select a report"}</strong>
        <button type="button" onClick={() => root && onOpen(root.id, "brief")}>Open notebook</button>
      </div>
      <div className="rd-v3-graph__nodes">
        {reports.slice(0, 10).map((report) => (
          <button key={report.id} type="button" onClick={() => onSelect?.(report)} aria-pressed={root?.id === report.id}>
            <span>{report.entity.slice(0, 1).toUpperCase()}</span>
            {report.entity}
          </button>
        ))}
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
