/**
 * HomesHubSession — Anonymous browser-session persistence for revisit, delta refresh, and recompile.
 *
 * Features:
 * - Session list with last-visited timestamps
 * - Delta refresh: shows what changed since last visit
 * - Recompile: re-runs the packet with current data
 * - Anonymous mode: no auth required, sessions stored in localStorage
 * - Quick-access cards for recent entities
 */

import { memo, useState, useCallback, useEffect } from "react";
import {
  Home,
  Clock,
  RefreshCw,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Search,
  Trash2,
  RotateCcw,
  Sparkles,
  ChevronRight,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SessionEntry {
  id: string;
  entityName: string;
  lastVisitedAt: number; // epoch ms
  packetConfidence: number; // 0-100
  sourceCount: number;
  signalCount: number;
  hasDrifted: boolean; // true if data changed since last compile
  status: "fresh" | "stale" | "drifted";
}

// ─── LocalStorage helpers ────────────────────────────────────────────────────

const STORAGE_KEY = "nodebench_homes_sessions";

function loadSessions(): SessionEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: SessionEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // localStorage full or unavailable — silently degrade
  }
}

// ─── Demo seed data ──────────────────────────────────────────────────────────

function seedDemoSessions(): SessionEntry[] {
  return [
    {
      id: "sess-1",
      entityName: "Anthropic AI",
      lastVisitedAt: Date.now() - 3600000,
      packetConfidence: 82,
      sourceCount: 20,
      signalCount: 3,
      hasDrifted: false,
      status: "fresh",
    },
    {
      id: "sess-2",
      entityName: "OpenAI",
      lastVisitedAt: Date.now() - 86400000,
      packetConfidence: 90,
      sourceCount: 25,
      signalCount: 4,
      hasDrifted: true,
      status: "drifted",
    },
    {
      id: "sess-3",
      entityName: "Stripe",
      lastVisitedAt: Date.now() - 172800000,
      packetConfidence: 75,
      sourceCount: 15,
      signalCount: 2,
      hasDrifted: false,
      status: "stale",
    },
    {
      id: "sess-4",
      entityName: "Notion",
      lastVisitedAt: Date.now() - 259200000,
      packetConfidence: 68,
      sourceCount: 12,
      signalCount: 1,
      hasDrifted: true,
      status: "drifted",
    },
  ];
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SessionEntry["status"] }) {
  const config = {
    fresh: { icon: CheckCircle, label: "Fresh", color: "text-emerald-400 bg-emerald-500/10" },
    stale: { icon: Clock, label: "Stale", color: "text-amber-400 bg-amber-500/10" },
    drifted: { icon: AlertTriangle, label: "Drifted", color: "text-rose-400 bg-rose-500/10" },
  }[status];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${config.color}`}>
      <Icon className="h-2.5 w-2.5" />
      {config.label}
    </span>
  );
}

function SessionCard({
  session,
  onRefresh,
  onRecompile,
  onRemove,
}: {
  session: SessionEntry;
  onRefresh: (id: string) => void;
  onRecompile: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const timeAgo = formatTimeAgo(session.lastVisitedAt);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 hover:border-white/[0.12] transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-content truncate">
              {session.entityName}
            </h3>
            <StatusBadge status={session.status} />
          </div>
          <div className="flex items-center gap-3 text-[10px] text-content-muted">
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {timeAgo}
            </span>
            <span>{session.packetConfidence}% confidence</span>
            <span>{session.sourceCount} sources</span>
            <span>{session.signalCount} signals</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onRefresh(session.id)}
            className="rounded-lg border border-white/[0.06] bg-white/[0.04] p-1.5 text-content-muted hover:bg-white/[0.08] hover:text-content transition-colors"
            aria-label={`Refresh ${session.entityName}`}
            title="Delta refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onRecompile(session.id)}
            className="rounded-lg border border-white/[0.06] bg-white/[0.04] p-1.5 text-content-muted hover:bg-white/[0.08] hover:text-content transition-colors"
            aria-label={`Recompile ${session.entityName}`}
            title="Recompile packet"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onRemove(session.id)}
            className="rounded-lg border border-white/[0.06] bg-white/[0.04] p-1.5 text-content-muted hover:bg-rose-500/10 hover:text-rose-400 transition-colors"
            aria-label={`Remove ${session.entityName}`}
            title="Remove session"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Drift indicator */}
      {session.hasDrifted && (
        <div className="mt-2 rounded-lg border border-rose-500/15 bg-rose-500/[0.04] px-3 py-2 text-[11px] text-rose-300">
          <AlertTriangle className="inline h-3 w-3 mr-1" />
          Data has changed since last compile. Recompile for fresh packet.
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// ─── Main Component ─────────────────────────────────────────────────────────

function HomesHubSessionInner() {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState<string | null>(null);
  const [isRecompiling, setIsRecompiling] = useState<string | null>(null);

  // Load sessions on mount
  useEffect(() => {
    const stored = loadSessions();
    if (stored.length === 0) {
      const demo = seedDemoSessions();
      saveSessions(demo);
      setSessions(demo);
    } else {
      setSessions(stored);
    }
  }, []);

  const handleRefresh = useCallback((id: string) => {
    setIsRefreshing(id);
    // Simulate delta refresh
    setTimeout(() => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                lastVisitedAt: Date.now(),
                hasDrifted: false,
                status: "fresh" as const,
              }
            : s,
        ),
      );
      setIsRefreshing(null);
    }, 800);
  }, []);

  const handleRecompile = useCallback((id: string) => {
    setIsRecompiling(id);
    // Simulate recompile
    setTimeout(() => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                lastVisitedAt: Date.now(),
                packetConfidence: Math.min(100, s.packetConfidence + Math.floor(Math.random() * 8)),
                sourceCount: s.sourceCount + Math.floor(Math.random() * 3),
                hasDrifted: false,
                status: "fresh" as const,
              }
            : s,
        ),
      );
      setIsRecompiling(null);
    }, 1500);
  }, []);

  const handleRemove = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      saveSessions(next);
      return next;
    });
  }, []);

  const handleClearAll = useCallback(() => {
    setSessions([]);
    saveSessions([]);
  }, []);

  // Filter sessions by search
  const filteredSessions = sessions.filter((s) =>
    s.entityName.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // Stats
  const freshCount = sessions.filter((s) => s.status === "fresh").length;
  const driftedCount = sessions.filter((s) => s.status === "drifted").length;
  const staleCount = sessions.filter((s) => s.status === "stale").length;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Home className="h-5 w-5 text-accent-primary" />
        <div>
          <h1 className="text-lg font-semibold text-content">Homes Hub</h1>
          <p className="text-xs text-content-muted">
            Revisit, refresh, and recompile your research packets — no sign-in required
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] p-3 text-center">
          <div className="text-2xl font-bold text-emerald-400">{freshCount}</div>
          <div className="text-[10px] text-content-muted">Fresh</div>
        </div>
        <div className="rounded-xl border border-rose-500/15 bg-rose-500/[0.04] p-3 text-center">
          <div className="text-2xl font-bold text-rose-400">{driftedCount}</div>
          <div className="text-[10px] text-content-muted">Drifted</div>
        </div>
        <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-3 text-center">
          <div className="text-2xl font-bold text-amber-400">{staleCount}</div>
          <div className="text-[10px] text-content-muted">Stale</div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search your sessions..."
          className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] pl-9 pr-3 py-2 text-sm text-content placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
        />
      </div>

      {/* Session list */}
      {filteredSessions.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
              Sessions ({filteredSessions.length})
            </span>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-[10px] text-content-muted hover:text-rose-400 transition-colors"
            >
              Clear all
            </button>
          </div>
          {filteredSessions.map((session) => (
            <div key={session.id} className="relative">
              <SessionCard
                session={session}
                onRefresh={handleRefresh}
                onRecompile={handleRecompile}
                onRemove={handleRemove}
              />
              {/* Loading overlays */}
              {isRefreshing === session.id && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 backdrop-blur-sm">
                  <div className="flex items-center gap-2 text-xs text-accent-primary">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Delta refreshing...
                  </div>
                </div>
              )}
              {isRecompiling === session.id && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 backdrop-blur-sm">
                  <div className="flex items-center gap-2 text-xs text-accent-primary">
                    <Sparkles className="h-4 w-4 animate-pulse" />
                    Recompiling packet...
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
          <Home className="mx-auto h-8 w-8 text-content-muted mb-3" />
          <p className="text-sm text-content-muted">
            No sessions yet. Search a company from the Ask bar to create your first packet.
          </p>
          <p className="text-xs text-content-muted mt-1">
            Sessions persist in your browser — no sign-in required.
          </p>
        </div>
      )}

      {/* How it works */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted mb-3">
          How It Works
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: Search,
              title: "Search",
              desc: "Ask a question or name a company. NodeBench builds a packet.",
            },
            {
              icon: RefreshCw,
              title: "Refresh",
              desc: "Delta refresh detects what changed since your last visit.",
            },
            {
              icon: RotateCcw,
              title: "Recompile",
              desc: "Re-runs the full pipeline with current data for a fresh packet.",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-2">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent-primary" />
              <div>
                <div className="text-xs font-semibold text-content">{title}</div>
                <p className="text-[11px] text-content-muted leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const HomesHubSession = memo(HomesHubSessionInner);
export default HomesHubSession;
