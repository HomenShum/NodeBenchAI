/**
 * ChatRails — left threads rail + right context/graph rail.
 *
 * Built to mirror the kit's chat-page references:
 *   - LEFT: Threads list (search · filter · all-threads dropdown · thread items
 *     with mini-icon, title, meta · "+ New thread" button at bottom)
 *   - RIGHT: Context | Graph tabs, Notebook card, Top entities (with role
 *     badges: Target / Contact / Peer / Investor), Quick metrics (ARR, Traffic,
 *     Hiring, News with deltas), Recent activity feed, Add to watchlist
 *
 * Rails are demo-data driven for now — wire to live Convex queries in a
 * follow-up PR. The shape (entities + role + metrics + activity) is
 * what the live data layer needs to feed.
 */

import { useState } from "react";
import {
  ChevronDown,
  Filter,
  Plus,
  Search,
  ExternalLink,
  Star,
  Bell,
  Activity,
} from "lucide-react";

/* ============================================================ */
/* LEFT — THREADS RAIL                                          */
/* ============================================================ */

interface ThreadItem {
  id: string;
  initial: string;
  iconColor: string;
  title: string;
  status: "fresh" | "stale" | "active";
  turns: number;
  ageMs: number;
  active?: boolean;
}

const DEMO_THREADS: ThreadItem[] = [
  { id: "orbital",   initial: "O",  iconColor: "var(--accent-primary)", title: "Orbital Labs · should I follow up?", status: "fresh", turns: 8, ageMs: 2 * 60_000, active: true },
  { id: "mercor",    initial: "M",  iconColor: "#5E6AD2",               title: "Mercor — hiring velocity",          status: "fresh", turns: 6, ageMs: 18 * 60_000 },
  { id: "everlaw",   initial: "E",  iconColor: "#0EA5E9",               title: "Everlaw — head-to-head",            status: "fresh", turns: 5, ageMs: 2 * 3600_000 },
  { id: "turing",    initial: "T",  iconColor: "#10B981",               title: "Turing — contract YoY",             status: "fresh", turns: 4, ageMs: 3 * 3600_000 },
  { id: "eu-ai",     initial: "EU", iconColor: "#5E6AD2",               title: "EU AI Act · legal tech",            status: "fresh", turns: 7, ageMs: 4 * 3600_000 },
  { id: "alpha",     initial: "A",  iconColor: "#0EA5E9",               title: "AlphaSense integration",            status: "fresh", turns: 3, ageMs: 1 * 86_400_000 },
  { id: "snowflake", initial: "SI", iconColor: "#10B981",               title: "SIG @ Snowflake Summit",            status: "fresh", turns: 2, ageMs: 1 * 86_400_000 },
  { id: "investor",  initial: "I",  iconColor: "#D97757",               title: "Investor update draft",             status: "fresh", turns: 5, ageMs: 2 * 86_400_000 },
];

function formatAge(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

interface ThreadsRailProps {
  activeId?: string;
  onSelect?: (id: string) => void;
  onNewThread?: () => void;
  open?: boolean;
  onClose?: () => void;
}

export function ChatThreadsRail({ activeId = "orbital", onSelect, onNewThread, open = true, onClose }: ThreadsRailProps) {
  const [search, setSearch] = useState("");
  const filtered = DEMO_THREADS.filter((t) =>
    !search.trim() ? true : t.title.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <aside
      className="nb-chat-threads-rail"
      role="navigation"
      aria-label="Chat threads"
      data-open={open ? "true" : "false"}
      aria-hidden={!open}
    >
      <header className="nb-chat-threads-rail-head">
        <div className="nb-chat-threads-rail-title">Threads</div>
        <button
          type="button"
          className="nb-chat-threads-rail-filter"
          aria-label="Filter threads"
          title="Filter"
        >
          <Filter size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </header>
      <div className="nb-chat-threads-rail-controls">
        <button
          type="button"
          className="nb-chat-threads-rail-select"
          aria-label="Filter scope"
        >
          <span>All threads</span>
          <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <div className="nb-chat-threads-rail-search">
          <Search size={12} strokeWidth={1.8} aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search threads…"
            aria-label="Search threads"
          />
        </div>
      </div>
      <div className="nb-chat-threads-rail-list">
        {filtered.map((t) => (
          <button
            key={t.id}
            type="button"
            className="nb-chat-threads-rail-item"
            data-active={t.id === activeId ? "true" : undefined}
            onClick={() => onSelect?.(t.id)}
          >
            <span
              className="nb-chat-threads-rail-icon"
              style={{ background: t.iconColor }}
              aria-hidden="true"
            >
              {t.initial}
            </span>
            <span className="nb-chat-threads-rail-body">
              <span className="nb-chat-threads-rail-item-title">{t.title}</span>
              <span className="nb-chat-threads-rail-meta">
                <span className="nb-chat-threads-rail-status" data-state={t.status}>● {t.status}</span>
                <span> · {t.turns} turns · {formatAge(t.ageMs)}</span>
              </span>
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="nb-chat-threads-rail-empty">No threads match.</div>
        )}
      </div>
      <footer className="nb-chat-threads-rail-foot">
        <button
          type="button"
          className="nb-chat-threads-rail-new"
          onClick={onNewThread}
        >
          <Plus size={13} strokeWidth={2} aria-hidden="true" />
          New thread
        </button>
      </footer>
    </aside>
  );
}

/* ============================================================ */
/* RIGHT — CONTEXT / GRAPH RAIL                                 */
/* ============================================================ */

type EntityRole = "Target" | "Contact" | "Peer" | "Investor" | "Company" | "Person" | "Event";

interface RailEntity {
  id: string;
  name: string;
  role: EntityRole;
  initial: string;
  iconColor: string;
}

interface QuickMetric {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "up" | "down" | "neutral";
}

interface ActivityItem {
  id: string;
  icon: typeof Bell;
  iconBg: string;
  iconColor: string;
  text: string;
  age: string;
}

const DEMO_ENTITIES: RailEntity[] = [
  { id: "orbital",  name: "Orbital Labs",      role: "Target",   initial: "OL", iconColor: "var(--accent-primary)" },
  { id: "alex",     name: "Alex Park",         role: "Contact",  initial: "AP", iconColor: "#5E6AD2" },
  { id: "braintrust", name: "Braintrust",      role: "Peer",     initial: "B",  iconColor: "#0EA5E9" },
  { id: "greylock", name: "Greyscale Partners", role: "Investor", initial: "G",  iconColor: "#10B981" },
];

const DEMO_METRICS: QuickMetric[] = [
  { label: "ARR (est.)",   value: "$12.4M", delta: "+28%", deltaTone: "up" },
  { label: "Traffic (MoM)", value: "18.7K", delta: "+22%", deltaTone: "up" },
  { label: "Hiring (30d)",  value: "12",    delta: "↑",    deltaTone: "up" },
  { label: "News (7d)",     value: "3",     delta: "•",    deltaTone: "neutral" },
];

const DEMO_ACTIVITY: ActivityItem[] = [
  { id: "1", icon: Star,   iconBg: "color-mix(in oklab, #10B981 12%, transparent)", iconColor: "#047857", text: "Funding signal detected", age: "2h ago" },
  { id: "2", icon: Bell,   iconBg: "color-mix(in oklab, #5E6AD2 12%, transparent)", iconColor: "#5E6AD2", text: "New hiring wave",          age: "4h ago" },
  { id: "3", icon: Activity, iconBg: "color-mix(in oklab, var(--accent-primary) 12%, transparent)", iconColor: "var(--accent-primary)", text: "Product update", age: "1d ago" },
];

export function ChatContextRail({ entityName, open = true, onClose }: { entityName?: string; open?: boolean; onClose?: () => void }) {
  const [tab, setTab] = useState<"context" | "graph">("context");

  return (
    <aside
      className="nb-chat-context-rail"
      role="complementary"
      aria-label="Thread context"
      data-open={open ? "true" : "false"}
      aria-hidden={!open}
    >
      <header className="nb-chat-context-rail-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "context"}
          data-active={tab === "context"}
          onClick={() => setTab("context")}
        >
          Context
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "graph"}
          data-active={tab === "graph"}
          onClick={() => setTab("graph")}
        >
          Graph
        </button>
      </header>
      <div className="nb-chat-context-rail-body">
        {tab === "context" ? (
          <>
            {/* Notebook */}
            <section className="nb-chat-context-rail-section">
              <div className="nb-chat-context-rail-kicker">Notebook</div>
              <div className="nb-chat-context-rail-notebook">
                <div className="nb-chat-context-rail-notebook-title">
                  {entityName ?? "Orbital Labs"} diligence
                </div>
                <div className="nb-chat-context-rail-notebook-meta">Updated just now</div>
                <button
                  type="button"
                  className="nb-chat-context-rail-cta"
                  aria-label="Open notebook"
                >
                  Open notebook
                  <ExternalLink size={11} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
            </section>

            {/* Top entities */}
            <section className="nb-chat-context-rail-section">
              <div className="nb-chat-context-rail-kicker-row">
                <span className="nb-chat-context-rail-kicker">Top entities</span>
                <button type="button" className="nb-chat-context-rail-link" aria-label="View all entities">
                  View all
                </button>
              </div>
              <ul className="nb-chat-context-rail-entities">
                {DEMO_ENTITIES.map((e) => (
                  <li key={e.id}>
                    <button type="button" className="nb-chat-context-rail-entity" aria-label={`${e.name} (${e.role})`}>
                      <span className="nb-chat-context-rail-entity-icon" style={{ background: e.iconColor }} aria-hidden="true">
                        {e.initial}
                      </span>
                      <span className="nb-chat-context-rail-entity-name">{e.name}</span>
                      <span className="nb-chat-context-rail-entity-role" data-role={e.role.toLowerCase()}>{e.role}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {/* Quick metrics */}
            <section className="nb-chat-context-rail-section">
              <div className="nb-chat-context-rail-kicker-row">
                <span className="nb-chat-context-rail-kicker">Quick metrics</span>
                <span className="nb-chat-context-rail-live">
                  <span className="nb-chat-context-rail-live-dot" aria-hidden="true" />
                  Live
                </span>
              </div>
              <div className="nb-chat-context-rail-metrics">
                {DEMO_METRICS.map((m) => (
                  <div key={m.label} className="nb-chat-context-rail-metric">
                    <span className="nb-chat-context-rail-metric-label">{m.label}</span>
                    <span className="nb-chat-context-rail-metric-value">{m.value}</span>
                    {m.delta && (
                      <span className="nb-chat-context-rail-metric-delta" data-tone={m.deltaTone}>
                        {m.delta}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Recent activity */}
            <section className="nb-chat-context-rail-section">
              <div className="nb-chat-context-rail-kicker-row">
                <span className="nb-chat-context-rail-kicker">Recent activity</span>
                <button type="button" className="nb-chat-context-rail-link" aria-label="View all activity">
                  View all
                </button>
              </div>
              <ul className="nb-chat-context-rail-activity">
                {DEMO_ACTIVITY.map((a) => {
                  const Icon = a.icon;
                  return (
                    <li key={a.id}>
                      <span
                        className="nb-chat-context-rail-activity-icon"
                        style={{ background: a.iconBg, color: a.iconColor }}
                        aria-hidden="true"
                      >
                        <Icon size={11} strokeWidth={2} />
                      </span>
                      <span className="nb-chat-context-rail-activity-text">{a.text}</span>
                      <span className="nb-chat-context-rail-activity-age">{a.age}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Add to watchlist CTA */}
            <button
              type="button"
              className="nb-chat-context-rail-watchlist"
              aria-label="Add to watchlist"
            >
              <Star size={13} strokeWidth={1.8} aria-hidden="true" />
              Add to watchlist
            </button>
          </>
        ) : (
          <div className="nb-chat-context-rail-empty">
            Graph view — entity relationships visualization. Open Workspace → Map for the full graph.
          </div>
        )}
      </div>
    </aside>
  );
}
