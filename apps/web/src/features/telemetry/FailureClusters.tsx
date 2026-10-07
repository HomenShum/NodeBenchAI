/**
 * FailureClusters — Visual grouping of eval failures by root cause.
 *
 * Groups failures into actionable clusters:
 * - Data quality (web_search empty/generic)
 * - Entity resolution (wrong entity extracted)
 * - Multi-entity (comparison treated as single)
 * - Lens shaping (same output regardless of role)
 * - Latency (timeout causing empty results)
 * - Judge rubric (judge criteria too strict/lenient)
 *
 * Each cluster shows: count, affected scenarios, severity, suggested fix.
 * This is the diagnostic layer that drives the flywheel.
 */

import { memo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Target,
  Zap,
  Database,
  Users,
  Clock,
  Shield,
} from "lucide-react";

/* ─── Types ────────────────────────────────────────────────────────────────── */

export interface FailureCluster {
  id: string;
  label: string;
  rootCause: string;
  severity: "P0" | "P1" | "P2";
  count: number;
  affectedScenarios: string[];
  affectedCriteria: string[];
  suggestedFix: string;
  fixType: "data" | "entity" | "multi_entity" | "lens" | "latency" | "judge";
  lastSeen: string;
}

export interface FailureClustersProps {
  clusters: FailureCluster[];
  className?: string;
}

/* ─── Fix type icons ───────────────────────────────────────────────────────── */

const FIX_ICONS: Record<string, React.ElementType> = {
  data: Database,
  entity: Target,
  multi_entity: Users,
  lens: Zap,
  latency: Clock,
  judge: Shield,
};

const SEVERITY_COLORS: Record<string, string> = {
  P0: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  P1: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  P2: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

/* ─── Cluster row ──────────────────────────────────────────────────────────── */

const ClusterRow = memo(function ClusterRow({ cluster }: { cluster: FailureCluster }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = FIX_ICONS[cluster.fixType] ?? AlertCircle;

  return (
    <div className="border-b border-white/[0.04] last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-white/30 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-white/30 shrink-0" />
        )}
        <Icon className="h-3.5 w-3.5 text-white/40 shrink-0" />
        <span className="text-xs text-white/70 flex-1 truncate">{cluster.label}</span>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold ${SEVERITY_COLORS[cluster.severity]}`}>
          {cluster.severity}
        </span>
        <span className="text-[10px] font-mono tabular-nums text-white/40 w-8 text-right">
          {cluster.count}×
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 pl-12 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="text-[11px] text-white/40">
            <span className="text-white/25 font-semibold uppercase tracking-wider text-[9px]">Root cause: </span>
            {cluster.rootCause}
          </div>
          <div className="text-[11px] text-white/40">
            <span className="text-white/25 font-semibold uppercase tracking-wider text-[9px]">Fix: </span>
            <span className="text-[#d97757]/80">{cluster.suggestedFix}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {cluster.affectedScenarios.map((s) => (
              <span key={s} className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-white/30">
                {s.replace(/_/g, " ")}
              </span>
            ))}
          </div>
          <div className="text-[9px] text-white/15">
            Last seen: {new Date(cluster.lastSeen).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
});

/* ─── Main component ───────────────────────────────────────────────────────── */

export const FailureClusters = memo(function FailureClusters({
  clusters,
  className = "",
}: FailureClustersProps) {
  const sorted = [...clusters].sort((a, b) => {
    const sevOrder = { P0: 0, P1: 1, P2: 2 };
    if (sevOrder[a.severity] !== sevOrder[b.severity]) {
      return sevOrder[a.severity] - sevOrder[b.severity];
    }
    return b.count - a.count;
  });

  const p0Count = sorted.filter((c) => c.severity === "P0").length;
  const p1Count = sorted.filter((c) => c.severity === "P1").length;
  const totalFailures = sorted.reduce((s, c) => s + c.count, 0);

  return (
    <div className={`rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden ${className}`}>
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-white/[0.04]">
        <AlertCircle className="h-4 w-4 text-[#d97757]" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40 flex-1">
          Failure Clusters
        </span>
        <div className="flex items-center gap-2 text-[10px]">
          {p0Count > 0 && (
            <span className="text-rose-400 font-semibold">{p0Count} P0</span>
          )}
          {p1Count > 0 && (
            <span className="text-amber-400">{p1Count} P1</span>
          )}
          <span className="text-white/30">{totalFailures} total</span>
        </div>
      </div>

      <div>
        {sorted.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <span className="text-emerald-400 text-sm font-semibold">All clear</span>
            <p className="text-[11px] text-white/30 mt-1">No failure clusters detected</p>
          </div>
        ) : (
          sorted.map((cluster) => <ClusterRow key={cluster.id} cluster={cluster} />)
        )}
      </div>
    </div>
  );
});

/* ─── Demo data ────────────────────────────────────────────────────────────── */

export function createDemoFailureClusters(): FailureCluster[] {
  return [
    {
      id: "fc-1",
      label: "Web search returns generic results for niche entities",
      rootCause: "Linkup/Brave returning SEO spam instead of authoritative sources for small companies",
      severity: "P0",
      count: 8,
      affectedScenarios: ["company_search", "competitor"],
      affectedCriteria: ["USEFUL_ANSWER", "ACTIONABLE_SIGNALS"],
      suggestedFix: "Add entity-specific search query templates; prefer LinkedIn/Crunchbase/PitchBook over generic web",
      fixType: "data",
      lastSeen: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: "fc-2",
      label: "Multi-entity comparison treated as single entity",
      rootCause: "classify_query returns 'company_search' instead of 'multi_entity' when query contains 'vs' or 'compare'",
      severity: "P0",
      count: 5,
      affectedScenarios: ["multi_entity", "competitor"],
      affectedCriteria: ["RELEVANT_ENTITY", "USEFUL_ANSWER"],
      suggestedFix: "Add regex check for 'vs', 'compare', 'versus', 'against' in classification step",
      fixType: "multi_entity",
      lastSeen: new Date(Date.now() - 7200000).toISOString(),
    },
    {
      id: "fc-3",
      label: "Role-specific responses identical across lenses",
      rootCause: "Gemini extraction prompt doesn't include lens/role context, producing same output for founder vs banker",
      severity: "P1",
      count: 6,
      affectedScenarios: ["role_specific", "company_search"],
      affectedCriteria: ["ROLE_APPROPRIATE"],
      suggestedFix: "Add role-specific extraction prompt templates with lens-aware signal priorities",
      fixType: "lens",
      lastSeen: new Date(Date.now() - 10800000).toISOString(),
    },
    {
      id: "fc-4",
      label: "Risk awareness missing for non-controversial topics",
      rootCause: "Risk/contradiction section empty when entity has no negative news; should surface market risks, competition threats",
      severity: "P1",
      count: 4,
      affectedScenarios: ["company_search", "pre_delegation"],
      affectedCriteria: ["RISK_AWARENESS"],
      suggestedFix: "Always generate structural risks (market, competition, execution) even when news sentiment is positive",
      fixType: "data",
      lastSeen: new Date(Date.now() - 14400000).toISOString(),
    },
    {
      id: "fc-5",
      label: "Edge case queries timeout without graceful degradation",
      rootCause: "Empty/special-char queries hit web_search which times out; no short-circuit for known-bad inputs",
      severity: "P2",
      count: 3,
      affectedScenarios: ["edge_case"],
      affectedCriteria: ["USEFUL_ANSWER", "NO_HALLUCINATION"],
      suggestedFix: "Add input validation: empty/short/special-char queries return structured 'invalid query' response immediately",
      fixType: "latency",
      lastSeen: new Date(Date.now() - 21600000).toISOString(),
    },
  ];
}

export default FailureClusters;
