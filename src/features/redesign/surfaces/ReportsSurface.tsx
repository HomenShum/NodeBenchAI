/**
 * Reports — the reusable memory library.
 *
 * Compact card pattern with three-action footer (Brief · Explore · Chat) per spec.
 * Default density: compact. Sticky filter row.
 */

import { useMemo, useState, useEffect, useRef } from "react";
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
}

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

export function ReportsSurface({ onOpen }: ReportsSurfaceProps) {
  const [filter, setFilter] = useState<typeof STATUS_FILTERS[number]["id"]>("all");
  const [kindFilter, setKindFilter] = useState<typeof KIND_FILTERS[number]["id"]>("all");
  const [density, setDensity] = useState<Density>("compact");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortOpen, setSortOpen] = useState(false);
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

  const reportDecisionQueue = useMemo(
    () => buildReportsDecisionQueue(filtered.length > 0 ? filtered : reports),
    [filtered, reports],
  );
  const openDecisionItem = (item: ProductDecisionItem) => {
    if (item.reportId) onOpen(item.reportId, "brief");
  };

  const hasActiveFilter = filter !== "all" || kindFilter !== "all" || query.length > 0;
  const resetFilters = () => { setFilter("all"); setKindFilter("all"); setQuery(""); };

  const bulkExport = (format: "csv" | "markdown" | "notion" | "hubspot") => {
    showToast({
      tone: "success",
      message: `Exporting ${selected.size} report${selected.size === 1 ? "" : "s"} as ${format.toUpperCase()}…`,
      action: { label: "Open", onClick: () => { /* future: open downloads pane */ } },
    });
    setSelected(new Set());
  };

  const bulkRefresh = () => {
    showToast({
      tone: "info",
      message: `Triggered refresh for ${selected.size} entit${selected.size === 1 ? "y" : "ies"}. Briefs will appear here.`,
    });
    setSelected(new Set());
  };

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
            <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={bulkRefresh}>Refresh sources</button>
            <button
              className="rd-btn rd-btn--quiet rd-btn--sm"
              onClick={() => showToast({ tone: "info", message: `Queued rubric run for ${selected.size} selected report${selected.size === 1 ? "" : "s"}.` })}
            >
              Run rubric
            </button>
            <button
              className="rd-btn rd-btn--quiet rd-btn--sm"
              onClick={() => showToast({ tone: "info", message: `Opening compare view for ${selected.size} selected report${selected.size === 1 ? "" : "s"}.` })}
            >
              Compare
            </button>
            <span style={{ width: 1, height: 16, background: "var(--rd-line)" }} aria-hidden="true" />
            <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => bulkExport("csv")}>Export CSV</button>
            <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => bulkExport("markdown")}>Export Markdown</button>
            <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => bulkExport("notion")}>To Notion</button>
            <button className="rd-btn rd-btn--quiet rd-btn--sm" onClick={() => bulkExport("hubspot")}>To HubSpot</button>
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
      />
    </div>
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
}: {
  reports: ReportCardData[];
  density: Density;
  onOpen: ReportsSurfaceProps["onOpen"];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  hasActiveFilter?: boolean;
  onResetFilters?: () => void;
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
          <div key={r.id} style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) auto",
            alignItems: "center",
            gap: 16,
            padding: "12px 16px",
            borderBottom: i === reports.length - 1 ? "none" : "1px solid var(--rd-line-faint)",
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
          data-selected={selected.has(r.id) || undefined}
          onClick={(e) => {
            // Clicking the card body opens the brief; clicking a button or checkbox is excluded
            const tgt = e.target as HTMLElement;
            if (tgt.closest("button, input")) return;
            onOpen(r.id, "brief");
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
