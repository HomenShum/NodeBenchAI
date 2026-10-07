/**
 * ValueManifestPanel — Shows what NodeBench contributed and what would have been missed.
 *
 * Reads from the value-manifest.json (local) or Convex (remote) to display:
 * - Total nudges delivered across sessions
 * - Nudges acted on vs ignored
 * - Diligence runs triggered by nudges
 * - Remediation items completed
 * - Counterfactual: "Without NodeBench, you would have missed..."
 */

import { memo, useCallback, useEffect, useState } from "react";

interface ValueSession {
  timestamp: string;
  sessionId: string;
  nudgesDelivered: number;
  toolCallsMonitored: number;
}

interface ValueManifest {
  sessions: ValueSession[];
  totalNudges: number;
  nudgesActedOn: number;
  diligenceRuns: number;
  remediationsCompleted: number;
}

const DEMO_MANIFEST: ValueManifest = {
  sessions: [
    { timestamp: new Date().toISOString(), sessionId: "demo-1", nudgesDelivered: 3, toolCallsMonitored: 47 },
    { timestamp: new Date(Date.now() - 86400000).toISOString(), sessionId: "demo-2", nudgesDelivered: 5, toolCallsMonitored: 82 },
  ],
  totalNudges: 8,
  nudgesActedOn: 5,
  diligenceRuns: 3,
  remediationsCompleted: 2,
};

export const ValueManifestPanel = memo(function ValueManifestPanel() {
  const [manifest, setManifest] = useState<ValueManifest | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchManifest = useCallback(async () => {
    setLoading(true);
    try {
      // Try local API first
      const resp = await fetch("/api/subconscious/summary");
      if (resp.ok) {
        const data = await resp.json();
        // Build manifest from subconscious data
        setManifest({
          sessions: [],
          totalNudges: data.populatedBlocks ?? 0,
          nudgesActedOn: 0,
          diligenceRuns: 0,
          remediationsCompleted: 0,
        });
      } else {
        setManifest(DEMO_MANIFEST);
      }
    } catch {
      setManifest(DEMO_MANIFEST);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchManifest(); }, [fetchManifest]);

  if (loading) {
    return <div className="h-32 animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.02]" />;
  }

  const m = manifest ?? DEMO_MANIFEST;
  const isDemo = manifest === DEMO_MANIFEST;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
          NodeBench Value Manifest
        </div>
        {isDemo && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
            demo data
          </span>
        )}
      </div>

      {/* Stats grid */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Nudges Delivered" value={String(m.totalNudges)} sublabel="across all sessions" />
        <StatCard label="Nudges Acted On" value={String(m.nudgesActedOn)} sublabel={m.totalNudges > 0 ? `${Math.round((m.nudgesActedOn / m.totalNudges) * 100)}% adoption` : "—"} />
        <StatCard label="Diligence Runs" value={String(m.diligenceRuns)} sublabel="triggered by nudges" />
        <StatCard label="Gaps Remediated" value={String(m.remediationsCompleted)} sublabel="issues closed" />
      </div>

      {/* Counterfactual */}
      <div className="mt-4 rounded-lg border border-[#d97757]/20 bg-[#d97757]/5 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#d97757]">
          Without NodeBench, you would have missed:
        </div>
        <ul className="mt-2 space-y-1.5 text-xs text-content-secondary">
          {m.totalNudges > 0 && (
            <li className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d97757]" />
              {m.totalNudges} intelligence opportunities during active coding sessions
            </li>
          )}
          {m.diligenceRuns > 0 && (
            <li className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d97757]" />
              {m.diligenceRuns} company diligence checks that caught gaps before shipping
            </li>
          )}
          {m.remediationsCompleted > 0 && (
            <li className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d97757]" />
              {m.remediationsCompleted} concrete remediation items that improved your company profile
            </li>
          )}
          {m.totalNudges === 0 && (
            <li className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-500" />
              Connect NodeBench MCP to start tracking value. Run:{" "}
              <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[10px]">
                claude mcp add nodebench -- npx -y nodebench-mcp --preset founder
              </code>
            </li>
          )}
        </ul>
      </div>

      {/* Recent sessions */}
      {m.sessions.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-content-muted">
            Recent Sessions
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {m.sessions.slice(0, 5).map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-content-muted">
                <span className="tabular-nums">{new Date(s.timestamp).toLocaleDateString()}</span>
                <span className="text-content-secondary">{s.nudgesDelivered} nudges</span>
                <span className="ml-auto tabular-nums">{s.toolCallsMonitored} tools monitored</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

function StatCard({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-content-muted">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-content">{value}</div>
      <div className="mt-0.5 text-[10px] text-content-muted">{sublabel}</div>
    </div>
  );
}

export default ValueManifestPanel;
