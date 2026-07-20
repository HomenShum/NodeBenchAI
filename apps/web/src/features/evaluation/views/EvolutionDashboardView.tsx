/**
 * Evolution Dashboard View — Layer H eval and evolution
 *
 * Displays canary benchmark trend, routing recommendations,
 * baseline comparisons, telemetry health, and hygiene status.
 *
 * Queries: domains/evaluation/operations:getEvolutionDashboard
 *          domains/operations/postExecutionHygiene:getHygieneReport
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

function VerdictBadge({ verdict }: { verdict: string }) {
  const colors: Record<string, string> = {
    pass: "bg-emerald-500/20 text-emerald-400",
    improvement: "bg-blue-500/20 text-blue-400",
    regression: "bg-red-500/20 text-red-400",
    improved: "bg-emerald-500/20 text-emerald-400",
    regressed: "bg-red-500/20 text-red-400",
    mixed: "bg-amber-500/20 text-amber-400",
    neutral: "bg-zinc-500/20 text-zinc-400",
    pending: "bg-yellow-500/20 text-yellow-400",
    accepted: "bg-emerald-500/20 text-emerald-400",
    rejected: "bg-red-500/20 text-red-400",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[verdict] ?? "bg-zinc-500/20 text-zinc-400"}`}
    >
      {verdict}
    </span>
  );
}

function StatCard({
  label,
  value,
  detail,
  color = "text-zinc-100",
}: {
  label: string;
  value: string | number;
  detail?: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-4">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-zinc-400">{label}</p>
      {detail && <p className="mt-0.5 text-xs text-zinc-500">{detail}</p>}
    </div>
  );
}

function CanaryTrendMini({ trend }: { trend: any[] }) {
  if (trend.length === 0) return null;

  const maxScore = Math.max(...trend.map((t) => t.combined), 1);

  return (
    <div className="flex items-end gap-1" style={{ height: 48 }}>
      {trend
        .slice()
        .reverse()
        .map((run: any, i: number) => {
          const height = Math.max((run.combined / maxScore) * 48, 4);
          const color =
            run.verdict === "regression"
              ? "bg-red-500"
              : run.verdict === "improvement"
                ? "bg-blue-500"
                : "bg-emerald-500";
          return (
            <div
              key={i}
              className={`w-3 rounded-t ${color}`}
              style={{ height }}
              title={`${run.runKey}: ${(run.combined * 100).toFixed(1)}%`}
            />
          );
        })}
    </div>
  );
}

export default function EvolutionDashboardView() {
  const dashboard = useQuery(api.domains.evaluation.operations.getEvolutionDashboard);
  const hygiene = useQuery(api.domains.operations.postExecutionHygiene.getHygieneReport);

  if (!dashboard) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-500 border-t-zinc-200" />
      </div>
    );
  }

  const latestCanary = dashboard.canary.latest;

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Evolution Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Canary benchmarks, model routing, baseline comparisons, and system health
        </p>
      </div>

      {/* Top-level stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Canary Score"
          value={
            latestCanary
              ? `${((latestCanary.throughputScore * 0.6 + latestCanary.qualityScore * 0.4) * 100).toFixed(1)}%`
              : "—"
          }
          detail={latestCanary ? `${latestCanary.verdict}` : "No runs yet"}
          color={
            latestCanary?.verdict === "regression"
              ? "text-red-400"
              : "text-emerald-400"
          }
        />
        <StatCard
          label="Pending Routing"
          value={dashboard.routing.pendingCount}
          detail="recommendations"
          color={dashboard.routing.pendingCount > 0 ? "text-amber-400" : "text-zinc-400"}
        />
        <StatCard
          label="Recent Errors"
          value={dashboard.errors.recentCount}
          detail="inference call errors"
          color={dashboard.errors.recentCount > 5 ? "text-red-400" : "text-zinc-400"}
        />
        <StatCard
          label="System Health"
          value={hygiene?.needsAttention ? "Attention" : "Healthy"}
          detail={
            hygiene
              ? `${hygiene.health.staleMissions} stale, ${hygiene.health.pendingSniffChecks} pending`
              : "Loading..."
          }
          color={hygiene?.needsAttention ? "text-amber-400" : "text-emerald-400"}
        />
      </div>

      {/* Canary trend */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Canary Trend
        </h2>
        {dashboard.canary.trend.length === 0 ? (
          <p className="text-sm text-zinc-500">No canary runs yet</p>
        ) : (
          <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-4">
            <CanaryTrendMini trend={dashboard.canary.trend} />
            <div className="mt-3 space-y-1">
              {dashboard.canary.trend.map((run: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300">{run.runKey}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-400">
                      {(run.combined * 100).toFixed(1)}%
                    </span>
                    <VerdictBadge verdict={run.verdict} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Routing recommendations */}
      {dashboard.routing.pendingCount > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-amber-400/80">
            Pending Routing Recommendations
          </h2>
          <div className="space-y-2">
            {dashboard.routing.pending.map((rec: any) => (
              <div
                key={rec._id}
                className="flex items-center justify-between rounded-md border border-zinc-700/30 bg-zinc-800/30 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200">
                    {rec.taskType}: {rec.currentModel} → {rec.recommendedModel}
                  </p>
                  <p className="truncate text-xs text-zinc-500">{rec.reason}</p>
                </div>
                <div className="flex items-center gap-2">
                  {rec.expectedUplift && (
                    <span className="text-xs text-emerald-400">
                      +{(rec.expectedUplift * 100).toFixed(1)}%
                    </span>
                  )}
                  <VerdictBadge verdict={rec.status} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent comparisons */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Recent Baseline Comparisons
        </h2>
        {dashboard.comparisons.recent.length === 0 ? (
          <p className="text-sm text-zinc-500">No comparisons yet</p>
        ) : (
          <div className="space-y-2">
            {dashboard.comparisons.recent.map((comp: any, i: number) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md border border-zinc-700/30 bg-zinc-800/30 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200">{comp.comparisonKey}</p>
                  <p className="text-xs text-zinc-500">{comp.family}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs ${comp.uplift > 0 ? "text-emerald-400" : comp.uplift < 0 ? "text-red-400" : "text-zinc-400"}`}
                  >
                    {comp.uplift > 0 ? "+" : ""}
                    {(comp.uplift * 100).toFixed(1)}%
                  </span>
                  <VerdictBadge verdict={comp.verdict} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent errors */}
      {dashboard.errors.recent.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-red-400/80">
            Recent Errors
          </h2>
          <div className="space-y-2">
            {dashboard.errors.recent.map((err: any, i: number) => (
              <div
                key={i}
                className="rounded-md border border-red-900/30 bg-red-900/10 px-3 py-2"
              >
                <p className="text-sm text-red-300">{err.model}</p>
                <p className="truncate text-xs text-red-400/70">
                  {err.errorMessage ?? "Unknown error"}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
