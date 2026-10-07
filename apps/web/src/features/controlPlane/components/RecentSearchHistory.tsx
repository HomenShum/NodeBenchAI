import { useEffect, useMemo, useState } from "react";
import { Clock3, History, Layers3, RefreshCw, ShieldCheck, Waypoints } from "lucide-react";

import { PUBLIC_SEARCH_HISTORY_API_ENDPOINT } from "@/lib/searchApi";
import { cn } from "@/lib/utils";
import type { ResultPacket } from "./searchTypes";
import type { TraceStep } from "./SearchTrace";

export interface RecentSearchHistoryItem {
  runId: string;
  traceId: string;
  packetId: string;
  outcomeId: string;
  query: string;
  lens: string;
  persona: string;
  classification: string;
  entityName: string;
  packet: ResultPacket;
  trace: TraceStep[];
  latencyMs: number;
  proofStatus: string;
  sourceCount: number;
  updatedAt: string;
}

type SearchHistoryResponse = {
  success: boolean;
  sync?: {
    mode?: "offline" | "connected";
    pendingCount?: number;
  };
  items: RecentSearchHistoryItem[];
};

function formatTime(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function ProofChip({ status }: { status: string }) {
  const tone =
    status === "verified"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : status === "drifting"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
        : status === "incomplete"
          ? "border-rose-500/20 bg-rose-500/10 text-rose-200"
          : "border-white/[0.08] bg-white/[0.04] text-content-muted";

  return (
    <span className={cn("rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]", tone)}>
      {status}
    </span>
  );
}

export function RecentSearchHistory({
  onOpen,
}: {
  onOpen: (item: RecentSearchHistoryItem) => void;
}) {
  const [items, setItems] = useState<RecentSearchHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState<"offline" | "connected">("offline");
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${PUBLIC_SEARCH_HISTORY_API_ENDPOINT}?limit=6`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = (await response.json()) as SearchHistoryResponse;
        if (cancelled) return;
        setItems(Array.isArray(payload.items) ? payload.items : []);
        setSyncMode(payload.sync?.mode === "connected" ? "connected" : "offline");
        setPendingCount(Number(payload.sync?.pendingCount ?? 0));
      } catch (fetchError) {
        if (cancelled) return;
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const syncLabel = useMemo(() => {
    if (syncMode === "connected") {
      return pendingCount > 0 ? `Connected • ${pendingCount} pending sync` : "Connected • sync bridge warm";
    }
    return "Local only";
  }, [pendingCount, syncMode]);

  if (!loading && !error && items.length === 0) {
    return null;
  }

  return (
    <section className="mt-8 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-[#d97757]" />
            <h2 className="text-sm font-semibold text-content">Recent Founder Runs</h2>
          </div>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-content-secondary">
            Reopen the latest founder-first packets with their trace, proof status, and sync-ready lineage intact.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-content-muted">
          <ShieldCheck className="h-3.5 w-3.5" />
          {syncLabel}
        </div>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-content-muted">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading recent search history
        </div>
      ) : error ? (
        <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-3 text-sm text-rose-200">
          Search history unavailable: {error}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <button
              key={item.runId}
              type="button"
              onClick={() => onOpen(item)}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 text-left transition hover:border-[#d97757]/20 hover:bg-[#d97757]/[0.03]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-content-muted">
                    {item.lens} • {item.persona}
                  </div>
                  <div className="mt-2 truncate text-base font-semibold text-content">
                    {item.entityName}
                  </div>
                </div>
                <div className="shrink-0">
                  <ProofChip status={item.proofStatus} />
                </div>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-content-secondary">
                {item.query}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-content-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Layers3 className="h-3.5 w-3.5" />
                  {item.sourceCount} sources
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Waypoints className="h-3.5 w-3.5" />
                  {item.trace.length} steps
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5" />
                  {item.latencyMs}ms
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  {formatTime(item.updatedAt)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
