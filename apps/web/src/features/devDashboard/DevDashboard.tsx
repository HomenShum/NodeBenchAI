/**
 * DevDashboard — Cinematic dev evolution timeline
 *
 * Surfaces the full nodebench repo history as an animated,
 * scrollable tree with domain branches, weekly epochs, and milestones.
 */

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMotionConfig } from '@/lib/motion';
import {
  GitBranch,
  GitCommit,
  ChevronDown,
  ChevronRight,
  Calendar,
  Code2,
  Layers,
  TrendingUp,
  Search,
  Filter,
  X,
} from "lucide-react";
import timelineData from "./data/timeline.json";

// ── Types ──────────────────────────────────────────────────────────────

interface Commit {
  hash: string;
  date: string;
  subject: string;
  type: string;
  scope: string | null;
  message: string;
  domain: string;
  insertions: number;
  deletions: number;
  fileCount: number;
}

interface Epoch {
  weekOf: string;
  commits: Commit[];
  stats: {
    total: number;
    feats: number;
    fixes: number;
    refactors: number;
    insertions: number;
    deletions: number;
  };
  domains: Record<string, number>;
}

interface Milestone {
  type: string;
  label: string;
  date: string;
  hash?: string;
  scope?: string;
  domain?: string;
  linesAdded?: number;
}

interface TimelineData {
  generatedAt: string;
  totalCommits: number;
  dateRange: { start: string; end: string };
  epochs: Epoch[];
  milestones: Milestone[];
  domainStats: Record<
    string,
    {
      commits: number;
      insertions: number;
      deletions: number;
      firstSeen: string;
      lastSeen: string;
    }
  >;
  commits: Commit[];
}

// ── Constants ──────────────────────────────────────────────────────────

const DOMAIN_COLORS: Record<string, string> = {
  mcp: "bg-blue-500",
  ui: "bg-violet-500",
  eval: "bg-amber-500",
  agents: "bg-emerald-500",
  oracle: "bg-cyan-500",
  narrative: "bg-pink-500",
  financial: "bg-orange-500",
  dogfood: "bg-lime-500",
  workspace: "bg-indigo-500",
  security: "bg-red-500",
  ops: "bg-teal-500",
  onboarding: "bg-fuchsia-500",
  backend: "bg-slate-500",
  frontend: "bg-sky-500",
  other: "bg-neutral-500",
};

const DOMAIN_TEXT: Record<string, string> = {
  mcp: "text-blue-400",
  ui: "text-violet-400",
  eval: "text-amber-400",
  agents: "text-emerald-400",
  oracle: "text-cyan-400",
  narrative: "text-pink-400",
  financial: "text-orange-400",
  dogfood: "text-lime-400",
  workspace: "text-indigo-400",
  security: "text-red-400",
  ops: "text-teal-400",
  onboarding: "text-fuchsia-400",
  backend: "text-slate-400",
  frontend: "text-sky-400",
  other: "text-neutral-400",
};

const TYPE_BADGES: Record<string, { label: string; cls: string }> = {
  feat: { label: "FEAT", cls: "bg-emerald-500/20 text-emerald-400" },
  fix: { label: "FIX", cls: "bg-amber-500/20 text-amber-400" },
  refactor: { label: "REFACTOR", cls: "bg-blue-500/20 text-blue-400" },
  chore: { label: "CHORE", cls: "bg-neutral-500/20 text-neutral-400" },
  docs: { label: "DOCS", cls: "bg-purple-500/20 text-purple-400" },
  perf: { label: "PERF", cls: "bg-cyan-500/20 text-cyan-400" },
  test: { label: "TEST", cls: "bg-pink-500/20 text-pink-400" },
  other: { label: "OTHER", cls: "bg-neutral-500/20 text-neutral-400" },
};

// ── Helpers ─────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatWeek(weekOf: string) {
  const d = new Date(weekOf + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function kFormat(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── Sub-components ──────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  accent: string;
}) {
  const { instant, transition } = useMotionConfig();
  return (
    <motion.div
      initial={{ opacity: 0, y: instant ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-edge bg-white/[0.02] p-4"
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className={accent} />
        <span className="text-[11px] uppercase tracking-wider text-white/40">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-white/90 tabular-nums">{value}</div>
    </motion.div>
  );
}

function DomainBranch({
  domain,
  stats,
  isActive,
  onClick,
}: {
  domain: string;
  stats: { commits: number; insertions: number; deletions: number; firstSeen: string; lastSeen: string };
  isActive: boolean;
  onClick: () => void;
}) {
  const { instant } = useMotionConfig();
  const color = DOMAIN_COLORS[domain] || DOMAIN_COLORS.other;
  const textColor = DOMAIN_TEXT[domain] || DOMAIN_TEXT.other;

  return (
    <motion.button
      onClick={onClick}
      whileHover={!instant ? { x: 2 } : undefined}
      whileTap={!instant ? { scale: 0.98 } : undefined}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
        isActive ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
      }`}
    >
      <span className={`w-2.5 h-2.5 rounded-full ${color} shrink-0`} />
      <span className={`text-sm font-medium ${isActive ? textColor : "text-white/60"} capitalize`}>
        {domain}
      </span>
      <span className="ml-auto text-[11px] text-white/50 tabular-nums">{stats.commits}</span>
    </motion.button>
  );
}

function EpochRow({
  epoch,
  index,
  isExpanded,
  onToggle,
  domainFilter,
}: {
  epoch: Epoch;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  domainFilter: string | null;
}) {
  const { instant, transition } = useMotionConfig();
  const filteredCommits = domainFilter
    ? epoch.commits.filter((c) => c.domain === domainFilter)
    : epoch.commits;

  if (filteredCommits.length === 0) return null;

  const topDomains = Object.entries(epoch.domains)
    .filter(([d]) => !domainFilter || d === domainFilter)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4);

  // Intensity bar width (proportional to total changes)
  const intensity = Math.min(
    100,
    Math.round(((epoch.stats.insertions + epoch.stats.deletions) / 2000) * 100)
  );

  return (
    <motion.div
      initial={{ opacity: instant ? 1 : 0 }}
      animate={{ opacity: 1 }}
      transition={transition({ delay: Math.min(index * 0.03, 0.6) })}
      className="group"
    >
      {/* Week header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] rounded-lg transition-colors"
      >
        {/* Timeline dot + line */}
        <div className="relative flex flex-col items-center shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-white/20 group-hover:bg-white/40 transition-colors" />
        </div>

        {/* Date */}
        <span className="text-sm text-white/50 w-20 shrink-0 font-mono">
          {formatWeek(epoch.weekOf)}
        </span>

        {/* Intensity bar */}
        <div className="flex-1 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
            <motion.div
              initial={{ width: instant ? `${intensity}%` : 0 }}
              animate={{ width: `${intensity}%` }}
              transition={transition({ duration: 0.6, delay: index * 0.02 })}
              className="h-full rounded-full bg-gradient-to-r from-emerald-500/60 to-blue-500/60"
            />
          </div>
        </div>

        {/* Domain dots */}
        <div className="flex items-center gap-1">
          {topDomains.map(([d]) => (
            <span
              key={d}
              className={`w-1.5 h-1.5 rounded-full ${DOMAIN_COLORS[d] || DOMAIN_COLORS.other}`}
            />
          ))}
        </div>

        {/* Stats */}
        <span className="text-[11px] text-white/50 tabular-nums w-8 text-right">
          {filteredCommits.length}
        </span>
        <span className="text-[11px] text-emerald-400/50 tabular-nums w-10 text-right">
          +{kFormat(epoch.stats.insertions)}
        </span>

        {/* Chevron */}
        {isExpanded ? (
          <ChevronDown size={14} className="text-white/50" />
        ) : (
          <ChevronRight size={14} className="text-white/50" />
        )}
      </button>

      {/* Expanded commits */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: instant ? "auto" : 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transition({ duration: 0.2 })}
            className="overflow-hidden"
          >
            <div className="ml-[34px] border-l border-edge pl-4 pb-3 space-y-1">
              {filteredCommits.map((c) => (
                <CommitRow key={c.hash} commit={c} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CommitRow({ commit }: { commit: Commit }) {
  const badge = TYPE_BADGES[commit.type] || TYPE_BADGES.other;
  const domainColor = DOMAIN_TEXT[commit.domain] || DOMAIN_TEXT.other;

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.02] transition-colors">
      <GitCommit size={12} className="text-white/40 mt-1 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded ${badge.cls}`}>
            {badge.label}
          </span>
          {commit.scope && (
            <span className={`text-[10px] font-mono ${domainColor}`}>({commit.scope})</span>
          )}
          <span className="text-xs text-white/60 truncate">{commit.message}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-[10px] text-white/40 font-mono">{commit.hash}</span>
          <span className="text-[10px] text-emerald-400/50">+{commit.insertions}</span>
          <span className="text-[10px] text-red-400/50">-{commit.deletions}</span>
          <span className="text-[10px] text-white/40">{commit.fileCount} files</span>
        </div>
      </div>
    </div>
  );
}

function MilestoneMarker({ milestone }: { milestone: Milestone }) {
  const { instant } = useMotionConfig();
  const isRelease = milestone.type === "release";

  return (
    <motion.div
      initial={{ opacity: 0, x: instant ? 0 : -8 }}
      animate={{ opacity: 1, x: 0 }}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
        isRelease
          ? "border-amber-500/20 bg-amber-500/[0.04]"
          : "border-emerald-500/10 bg-emerald-500/[0.02]"
      }`}
    >
      {isRelease ? (
        <Layers size={12} className="text-amber-400 shrink-0" />
      ) : (
        <TrendingUp size={12} className="text-emerald-400 shrink-0" />
      )}
      <span className="text-xs text-white/70 truncate">{milestone.label}</span>
      <span className="ml-auto text-[10px] text-white/50 shrink-0">
        {formatDate(milestone.date)}
      </span>
      {milestone.linesAdded && (
        <span className="text-[10px] text-emerald-400/40">+{kFormat(milestone.linesAdded)}</span>
      )}
    </motion.div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────

export default function DevDashboard() {
  const { instant, transition } = useMotionConfig();
  const data = timelineData as unknown as TimelineData;
  const scrollRef = useRef<HTMLDivElement>(null);

  const [expandedEpochs, setExpandedEpochs] = useState<Set<string>>(new Set());
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showMilestones, setShowMilestones] = useState(true);

  // Sorted domains by commit count
  const sortedDomains = useMemo(
    () =>
      Object.entries(data.domainStats)
        .sort(([, a], [, b]) => b.commits - a.commits),
    [data.domainStats]
  );

  // Filter epochs by search
  const filteredEpochs = useMemo(() => {
    if (!searchQuery) return data.epochs;
    const q = searchQuery.toLowerCase();
    return data.epochs
      .map((ep) => ({
        ...ep,
        commits: ep.commits.filter(
          (c) =>
            c.subject.toLowerCase().includes(q) ||
            c.hash.includes(q) ||
            c.domain.includes(q) ||
            (c.scope && c.scope.toLowerCase().includes(q))
        ),
      }))
      .filter((ep) => ep.commits.length > 0);
  }, [data.epochs, searchQuery]);

  // Filter milestones
  const filteredMilestones = useMemo(() => {
    if (!showMilestones) return [];
    if (!domainFilter) return data.milestones;
    return data.milestones.filter(
      (m) => m.domain === domainFilter || m.type === "release"
    );
  }, [data.milestones, domainFilter, showMilestones]);

  const toggleEpoch = useCallback((weekOf: string) => {
    setExpandedEpochs((prev) => {
      const next = new Set(prev);
      if (next.has(weekOf)) next.delete(weekOf);
      else next.add(weekOf);
      return next;
    });
  }, []);

  // Auto-expand latest 3 epochs on mount
  useEffect(() => {
    if (data.epochs.length > 0) {
      const latest = data.epochs.slice(-3).map((e) => e.weekOf);
      setExpandedEpochs(new Set(latest));
    }
  }, [data.epochs]);

  // Aggregate stats
  const totalInsertions = Object.values(data.domainStats).reduce((s, d) => s + d.insertions, 0);
  const totalDeletions = Object.values(data.domainStats).reduce((s, d) => s + d.deletions, 0);
  const totalDomains = Object.keys(data.domainStats).length;

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)] text-white/90 overflow-hidden">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: instant ? 0 : -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transition({ duration: 0.4 })}
        className="shrink-0 px-6 pt-6 pb-4 border-b border-edge"
      >
        <div className="flex items-center gap-3 mb-4">
          <GitBranch size={20} className="text-blue-400" />
          <h1 className="text-xl font-semibold tracking-tight">Dev Dashboard</h1>
          <span className="text-xs text-white/50 font-mono ml-2">
            {formatDate(data.dateRange.start)} — {formatDate(data.dateRange.end)}
          </span>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Commits" value={data.totalCommits} icon={GitCommit} accent="text-blue-400" />
          <StatCard
            label="Lines Added"
            value={kFormat(totalInsertions)}
            icon={TrendingUp}
            accent="text-emerald-400"
          />
          <StatCard
            label="Lines Removed"
            value={kFormat(totalDeletions)}
            icon={Code2}
            accent="text-red-400"
          />
          <StatCard label="Domains" value={totalDomains} icon={Layers} accent="text-violet-400" />
        </div>
      </motion.header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar — Domain branches */}
        <motion.aside
          initial={{ opacity: 0, x: instant ? 0 : -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={transition({ delay: 0.15 })}
          className="w-52 shrink-0 border-r border-edge overflow-y-auto p-3 space-y-0.5 hidden md:block"
        >
          <div className="type-label px-3 py-2 text-white/50">
            Branches
          </div>
          <button
            onClick={() => setDomainFilter(null)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
              !domainFilter ? "bg-white/[0.06] text-white/80" : "text-white/50 hover:bg-white/[0.03]"
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-blue-500 to-violet-500 shrink-0" />
            All
            <span className="ml-auto text-[11px] text-white/50 tabular-nums">
              {data.totalCommits}
            </span>
          </button>

          {sortedDomains.map(([domain, stats]) => (
            <DomainBranch
              key={domain}
              domain={domain}
              stats={stats}
              isActive={domainFilter === domain}
              onClick={() => setDomainFilter(domainFilter === domain ? null : domain)}
            />
          ))}

          <div className="pt-3 border-t border-edge mt-3">
            <button
              onClick={() => setShowMilestones(!showMilestones)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                showMilestones ? "text-amber-400" : "text-white/40"
              } hover:bg-white/[0.03]`}
            >
              <Layers size={14} />
              Milestones
              <span className="ml-auto text-[11px] text-white/50">
                {filteredMilestones.length}
              </span>
            </button>
          </div>
        </motion.aside>

        {/* Main timeline */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Search + filter bar */}
          <div className="px-4 py-3 border-b border-edge flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search commits, scopes, domains..."
                className="w-full pl-8 pr-8 py-1.5 rounded-lg bg-white/[0.04] border border-edge text-sm text-white/80 placeholder:text-white/40 focus:outline-none focus:border-blue-500/30"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/50 hover:text-white/60"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Mobile domain filter */}
            <div className="md:hidden">
              <select
                value={domainFilter || ""}
                onChange={(e) => setDomainFilter(e.target.value || null)}
                className="px-2 py-1.5 rounded-lg bg-white/[0.04] border border-edge text-sm text-white/70"
              >
                <option value="">All domains</option>
                {sortedDomains.map(([d]) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            {domainFilter && (
              <motion.button
                initial={{ opacity: 0, scale: instant ? 1 : 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => setDomainFilter(null)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] text-xs text-white/60 hover:bg-white/[0.1]"
              >
                <Filter size={10} />
                <span className="capitalize">{domainFilter}</span>
                <X size={10} />
              </motion.button>
            )}

            <span className="text-[11px] text-white/50 tabular-nums">
              {filteredEpochs.reduce((s, e) => s + e.commits.length, 0)} commits
            </span>
          </div>

          {/* Scrollable timeline */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5">
            {/* Milestones section */}
            {filteredMilestones.length > 0 && (
              <motion.div
                initial={{ opacity: instant ? 1 : 0 }}
                animate={{ opacity: 1 }}
                className="mb-4 space-y-1.5"
              >
                <div className="type-label px-1 py-1 text-white/50">
                  Key milestones ({filteredMilestones.length})
                </div>
                <div className="grid gap-1.5 max-h-48 overflow-y-auto">
                  {filteredMilestones.slice(-12).map((m, i) => (
                    <MilestoneMarker key={`${m.date}-${i}`} milestone={m} />
                  ))}
                </div>
              </motion.div>
            )}

            {/* Epoch rows (newest first) */}
            <div className="type-label sticky top-0 z-10 bg-[var(--bg-primary)] px-1 py-2 text-white/50">
              <Calendar size={10} className="inline mr-1.5" />
              Weekly epochs ({filteredEpochs.length} weeks)
            </div>

            {[...filteredEpochs].reverse().map((epoch, i) => (
              <EpochRow
                key={epoch.weekOf}
                epoch={epoch}
                index={i}
                isExpanded={expandedEpochs.has(epoch.weekOf)}
                onToggle={() => toggleEpoch(epoch.weekOf)}
                domainFilter={domainFilter}
              />
            ))}

            {filteredEpochs.length === 0 && (
              <div className="text-center py-16 text-white/50 text-sm">
                No commits match your search.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
