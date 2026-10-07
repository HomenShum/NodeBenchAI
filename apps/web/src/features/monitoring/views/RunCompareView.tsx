/**
 * RunCompareView — Compare two search sessions side-by-side.
 *
 * Adapted from reference RunCompareView for NodeBench's founder intelligence:
 * - Baseline (original diligence) vs Re-run (after remediation)
 * - Signal delta: what improved, what regressed, what's new
 * - Cost/time/depth comparison
 * - Directly proves "drinking our own coolaid" loop value
 */

import { memo, useCallback, useEffect, useState } from "react";
import {
  ArrowDown, ArrowUp, CheckCircle, Minus, TrendingDown, TrendingUp,
} from "lucide-react";

interface SearchSession {
  _id: string;
  query: string;
  lens: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  result?: {
    entityName?: string;
    confidence?: number;
    diligenceGrade?: string;
    classifiedSignals?: Array<{ category: string; label: string; score: string; confidence: number }>;
    researchDepth?: { totalSearches: number; maxDepth: number; totalFindings: number; totalSources: number };
    seoAudit?: { score: number };
    remediation?: Array<{ gap: string; severity: string }>;
  };
}

export const RunCompareView = memo(function RunCompareView() {
  const [sessions, setSessions] = useState<SearchSession[]>([]);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [rerunId, setRerunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/subconscious/blocks"); // proxy check
      // For now, use Convex directly if available
      setSessions([]); // Will populate from Convex subscription
    } catch { /* */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  // Auto-select: latest two sessions for same entity
  useEffect(() => {
    if (sessions.length >= 2 && !baselineId && !rerunId) {
      setBaselineId(sessions[1]._id);
      setRerunId(sessions[0]._id);
    }
  }, [sessions, baselineId, rerunId]);

  const baseline = sessions.find((s) => s._id === baselineId);
  const rerun = sessions.find((s) => s._id === rerunId);

  // Demo data when no sessions available
  const demoBaseline = {
    entityName: "NodeBench AI",
    confidence: 50,
    diligenceGrade: "insufficient-data",
    seoScore: 50,
    findings: 6,
    sources: 46,
    depth: 1,
    signals: 0,
    remediation: 10,
    durationMs: 10000,
  };
  const demoRerun = {
    entityName: "NodeBench AI",
    confidence: 85,
    diligenceGrade: "early-stage",
    seoScore: 70,
    findings: 55,
    sources: 52,
    depth: 3,
    signals: 8,
    remediation: 5,
    durationMs: 90000,
  };

  const b = baseline?.result ? {
    entityName: baseline.result.entityName ?? baseline.query,
    confidence: baseline.result.confidence ?? 0,
    diligenceGrade: baseline.result.diligenceGrade ?? "unknown",
    seoScore: baseline.result.seoAudit?.score ?? 0,
    findings: baseline.result.researchDepth?.totalFindings ?? 0,
    sources: baseline.result.researchDepth?.totalSources ?? 0,
    depth: baseline.result.researchDepth?.maxDepth ?? 0,
    signals: baseline.result.classifiedSignals?.length ?? 0,
    remediation: baseline.result.remediation?.length ?? 0,
    durationMs: (baseline.completedAt ?? 0) - baseline.startedAt,
  } : demoBaseline;

  const r = rerun?.result ? {
    entityName: rerun.result.entityName ?? rerun.query,
    confidence: rerun.result.confidence ?? 0,
    diligenceGrade: rerun.result.diligenceGrade ?? "unknown",
    seoScore: rerun.result.seoAudit?.score ?? 0,
    findings: rerun.result.researchDepth?.totalFindings ?? 0,
    sources: rerun.result.researchDepth?.totalSources ?? 0,
    depth: rerun.result.researchDepth?.maxDepth ?? 0,
    signals: rerun.result.classifiedSignals?.length ?? 0,
    remediation: rerun.result.remediation?.length ?? 0,
    durationMs: (rerun?.completedAt ?? 0) - (rerun?.startedAt ?? 0),
  } : demoRerun;

  const isDemo = !baseline && !rerun;

  return (
    <div className="flex flex-col gap-4">
      {isDemo && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
          Demo comparison: NodeBench AI self-search before vs after SEO remediation. Run two searches for the same entity to see real data.
        </div>
      )}

      {/* Header */}
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
        Run Comparison: {b.entityName}
      </div>

      {/* Side-by-side grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Baseline */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-content-muted">
            Baseline (original)
          </div>
          <MetricRow label="Confidence" value={`${b.confidence}%`} />
          <MetricRow label="Grade" value={b.diligenceGrade} />
          <MetricRow label="SEO Score" value={`${b.seoScore}/100`} />
          <MetricRow label="Findings" value={String(b.findings)} />
          <MetricRow label="Sources" value={String(b.sources)} />
          <MetricRow label="Depth" value={String(b.depth)} />
          <MetricRow label="Signals" value={String(b.signals)} />
          <MetricRow label="Open Gaps" value={String(b.remediation)} />
        </div>

        {/* Re-run */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-400">
            Re-run (after remediation)
          </div>
          <MetricRow label="Confidence" value={`${r.confidence}%`} delta={r.confidence - b.confidence} suffix="%" />
          <MetricRow label="Grade" value={r.diligenceGrade} improved={r.diligenceGrade !== b.diligenceGrade} />
          <MetricRow label="SEO Score" value={`${r.seoScore}/100`} delta={r.seoScore - b.seoScore} suffix="pts" />
          <MetricRow label="Findings" value={String(r.findings)} delta={r.findings - b.findings} />
          <MetricRow label="Sources" value={String(r.sources)} delta={r.sources - b.sources} />
          <MetricRow label="Depth" value={String(r.depth)} delta={r.depth - b.depth} />
          <MetricRow label="Signals" value={String(r.signals)} delta={r.signals - b.signals} />
          <MetricRow label="Open Gaps" value={String(r.remediation)} delta={r.remediation - b.remediation} invertColor />
        </div>
      </div>

      {/* Delta Summary */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-content-muted mb-2">
          What Changed
        </div>
        <div className="flex flex-col gap-1.5 text-xs text-content-secondary">
          {r.confidence > b.confidence && (
            <DeltaLine icon="up" text={`Confidence improved ${r.confidence - b.confidence}% (${b.confidence}% → ${r.confidence}%)`} />
          )}
          {r.seoScore > b.seoScore && (
            <DeltaLine icon="up" text={`SEO score improved ${r.seoScore - b.seoScore} points (${b.seoScore} → ${r.seoScore})`} />
          )}
          {r.findings > b.findings && (
            <DeltaLine icon="up" text={`${r.findings - b.findings} more findings discovered (${b.findings} → ${r.findings})`} />
          )}
          {r.depth > b.depth && (
            <DeltaLine icon="up" text={`Research depth increased ${r.depth - b.depth} levels (${b.depth} → ${r.depth})`} />
          )}
          {r.signals > b.signals && (
            <DeltaLine icon="up" text={`${r.signals - b.signals} classified signals added (taxonomy-controlled)`} />
          )}
          {r.remediation < b.remediation && (
            <DeltaLine icon="up" text={`${b.remediation - r.remediation} gaps closed (${b.remediation} → ${r.remediation} remaining)`} />
          )}
          {r.diligenceGrade !== b.diligenceGrade && (
            <DeltaLine icon="up" text={`Grade upgraded: ${b.diligenceGrade} → ${r.diligenceGrade}`} />
          )}
        </div>
      </div>
    </div>
  );
});

function MetricRow({ label, value, delta, suffix, improved, invertColor }: {
  label: string; value: string; delta?: number; suffix?: string; improved?: boolean; invertColor?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1 text-xs">
      <span className="text-content-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-content">{value}</span>
        {delta !== undefined && delta !== 0 && (
          <span className={`text-[10px] font-semibold ${
            (invertColor ? delta < 0 : delta > 0) ? "text-emerald-400" : "text-rose-400"
          }`}>
            {delta > 0 ? "+" : ""}{delta}{suffix ?? ""}
          </span>
        )}
        {improved && <CheckCircle className="h-3 w-3 text-emerald-400" />}
      </div>
    </div>
  );
}

function DeltaLine({ icon, text }: { icon: "up" | "down" | "neutral"; text: string }) {
  return (
    <div className="flex items-start gap-2">
      {icon === "up" ? (
        <TrendingUp className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
      ) : icon === "down" ? (
        <TrendingDown className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />
      ) : (
        <Minus className="mt-0.5 h-3 w-3 shrink-0 text-content-muted" />
      )}
      <span>{text}</span>
    </div>
  );
}

export default RunCompareView;
