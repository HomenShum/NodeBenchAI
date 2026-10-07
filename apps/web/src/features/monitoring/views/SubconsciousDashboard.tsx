/**
 * SubconsciousDashboard — shows memory blocks, graph summary, whisper history.
 * Lives inside the Telemetry surface as a tab.
 */

import { lazy, memo, Suspense, useCallback, useEffect, useState } from "react";

const ValueManifestPanel = lazy(() => import("./ValueManifestPanel"));

interface MemoryBlock {
  id: string;
  label: string;
  value: string;
  version: number;
  confidence: "high" | "medium" | "low";
  updatedAt: string;
}

interface GraphSummary {
  totalEntities: number;
  totalEdges: number;
  entitiesByType: Record<string, number>;
  edgesByType: Record<string, number>;
  recentEntities: Array<{ label: string; kind: string; updatedAt: string }>;
}

interface SummaryData {
  totalBlocks: number;
  populatedBlocks: number;
  staleCount: number;
  staleBlocks: Array<{ id: string; label: string; updatedAt: string }>;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-emerald-500/15 text-emerald-400",
  medium: "bg-amber-500/15 text-amber-400",
  low: "bg-zinc-500/15 text-zinc-400",
};

export const SubconsciousDashboard = memo(function SubconsciousDashboard() {
  const [blocks, setBlocks] = useState<MemoryBlock[]>([]);
  const [graph, setGraph] = useState<GraphSummary | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedBlock, setExpandedBlock] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [blocksRes, graphRes, summaryRes] = await Promise.all([
        fetch("/api/subconscious/blocks"),
        fetch("/api/subconscious/graph/summary"),
        fetch("/api/subconscious/summary"),
      ]);

      if (blocksRes.ok) {
        const data = await blocksRes.json();
        setBlocks(data.blocks ?? []);
      }
      if (graphRes.ok) {
        const data = await graphRes.json();
        setGraph(data);
      }
      if (summaryRes.ok) {
        const data = await summaryRes.json();
        setSummary(data);
      }
    } catch (err: any) {
      setError(err.message ?? "Failed to fetch subconscious data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.02]"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-400">
          Subconscious Unavailable
        </div>
        <p className="mt-2 text-sm text-content-secondary">{error}</p>
        <p className="mt-1 text-xs text-content-muted">
          Start the NodeBench server: <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px]">npx tsx server/index.ts</code>
        </p>
        <button
          type="button"
          onClick={fetchData}
          className="mt-3 rounded-md border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:bg-white/[0.08]"
        >
          Retry
        </button>
      </div>
    );
  }

  const populatedBlocks = blocks.filter((b) => b.value.length > 0);
  const emptyBlocks = blocks.filter((b) => b.value.length === 0);

  return (
    <div className="flex flex-col gap-5">
      {/* ── Hero Stats ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Memory Blocks"
          value={`${summary?.populatedBlocks ?? populatedBlocks.length}/${summary?.totalBlocks ?? blocks.length}`}
        />
        <StatCard
          label="Graph Entities"
          value={String(graph?.totalEntities ?? 0)}
        />
        <StatCard
          label="Graph Edges"
          value={String(graph?.totalEdges ?? 0)}
        />
        <StatCard
          label="Stale Blocks"
          value={String(summary?.staleCount ?? 0)}
          alert={!!summary?.staleCount}
        />
      </div>

      {/* ── Graph Breakdown ────────────────────────────────────── */}
      {graph && (graph.totalEntities > 0 || graph.totalEdges > 0) && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
            Knowledge Graph
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            {/* Entity types */}
            <div className="flex-1 min-w-[200px]">
              <div className="text-xs font-medium text-content-secondary mb-2">Entities by Type</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(graph.entitiesByType).map(([type, count]) => (
                  <span
                    key={type}
                    className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-xs text-content-secondary"
                  >
                    {type}: <span className="ml-1 font-semibold tabular-nums">{count}</span>
                  </span>
                ))}
              </div>
            </div>
            {/* Edge types */}
            <div className="flex-1 min-w-[200px]">
              <div className="text-xs font-medium text-content-secondary mb-2">Edges by Relation</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(graph.edgesByType).map(([type, count]) => (
                  <span
                    key={type}
                    className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-xs text-content-secondary"
                  >
                    {type}: <span className="ml-1 font-semibold tabular-nums">{count}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
          {/* Recent entities */}
          {graph.recentEntities.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-medium text-content-secondary mb-2">Recent Entities</div>
              <div className="flex flex-col gap-1">
                {graph.recentEntities.slice(0, 5).map((e, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs text-content-muted"
                  >
                    <span className="inline-flex items-center rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px]">
                      {e.kind}
                    </span>
                    <span className="text-content-secondary">{e.label}</span>
                    <span className="ml-auto tabular-nums">{formatAge(e.updatedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Populated Memory Blocks ────────────────────────────── */}
      {populatedBlocks.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
            Company Truth Blocks ({populatedBlocks.length})
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {populatedBlocks.map((block) => (
              <button
                key={block.id}
                type="button"
                onClick={() =>
                  setExpandedBlock(expandedBlock === block.id ? null : block.id)
                }
                className="w-full text-left rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.04]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-content">
                    {block.label}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${CONFIDENCE_COLORS[block.confidence]}`}
                  >
                    {block.confidence}
                  </span>
                  <span className="ml-auto text-[10px] tabular-nums text-content-muted">
                    v{block.version} · {formatAge(block.updatedAt)}
                  </span>
                </div>
                {expandedBlock === block.id ? (
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2 font-mono text-xs text-content-secondary">
                    {block.value}
                  </pre>
                ) : (
                  <div className="mt-1 truncate text-xs text-content-muted">
                    {block.value.split("\n")[0].slice(0, 100)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty Blocks (collapsed) ───────────────────────────── */}
      {emptyBlocks.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
            Unpopulated Blocks ({emptyBlocks.length})
          </div>
          <p className="mt-2 text-xs text-content-muted">
            These blocks will be populated as you work. Use the MCP tool{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[10px]">
              update_company_truth
            </code>{" "}
            or the{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[10px]">
              /api/subconscious/blocks/:id
            </code>{" "}
            REST endpoint.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {emptyBlocks.map((b) => (
              <span
                key={b.id}
                className="inline-flex rounded-full border border-white/[0.06] bg-white/[0.02] px-2.5 py-0.5 text-[10px] text-content-muted"
              >
                {b.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Stale Warnings ─────────────────────────────────────── */}
      {summary && summary.staleCount > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-400">
            Stale Blocks ({summary.staleCount})
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {summary.staleBlocks.map((b) => (
              <div key={b.id} className="flex items-center gap-2 text-xs text-amber-300/80">
                <span>{b.label}</span>
                <span className="ml-auto tabular-nums text-amber-400/60">
                  last updated {formatAge(b.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Value Manifest (what NodeBench contributed) ─────────── */}
      <Suspense fallback={<div className="h-32 animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.02]" />}>
        <ValueManifestPanel />
      </Suspense>
    </div>
  );
});

// ── Small components ─────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        alert
          ? "border-amber-500/20 bg-amber-500/5"
          : "border-white/[0.06] bg-white/[0.02]"
      }`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-content-muted">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-bold tabular-nums ${
          alert ? "text-amber-400" : "text-content"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function formatAge(dateStr: string): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default SubconsciousDashboard;
