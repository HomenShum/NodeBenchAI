/**
 * Mission Control View — Layer A command center
 *
 * Displays active missions, task execution status, judge queue,
 * sniff check queue, and recent completions.
 *
 * Queries: domains/missions/missionOrchestrator:getMissionDashboard
 */

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    executing: "bg-blue-500/20 text-blue-400",
    judging: "bg-amber-500/20 text-amber-400",
    sniff_check: "bg-purple-500/20 text-purple-400",
    completed: "bg-emerald-500/20 text-emerald-400",
    failed: "bg-red-500/20 text-red-400",
    draft: "bg-zinc-500/20 text-zinc-400",
    planned: "bg-cyan-500/20 text-cyan-400",
    cancelled: "bg-zinc-600/20 text-zinc-500",
    pending: "bg-yellow-500/20 text-yellow-400",
    in_progress: "bg-blue-500/20 text-blue-400",
    blocked: "bg-orange-500/20 text-orange-400",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-zinc-500/20 text-zinc-400"}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function MissionCard({ mission }: { mission: any }) {
  const tasks = useQuery(api.domains.missions.missionOrchestrator.getTasksForMission, {
    missionId: mission._id,
  });

  const completed = tasks?.filter((t: any) => t.status === "completed").length ?? 0;
  const total = tasks?.length ?? 0;

  return (
    <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-zinc-100">
            {mission.title}
          </h3>
          <p className="mt-0.5 truncate text-xs text-zinc-400">
            {mission.missionType} · {mission.missionKey}
          </p>
        </div>
        <StatusBadge status={mission.status} />
      </div>

      {tasks && total > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>
              {completed}/{total} tasks
            </span>
            <span>{Math.round((completed / total) * 100)}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-700">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${(completed / total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <p className="mt-2 line-clamp-2 text-xs text-zinc-500">
        {mission.description}
      </p>
    </div>
  );
}

function SniffCheckRow({ check }: { check: any }) {
  const hoursOld = Math.round((Date.now() - check.createdAt) / 3600000);

  return (
    <div className="flex items-center justify-between rounded-md border border-zinc-700/30 bg-zinc-800/30 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm text-zinc-200">{check.reviewType}</p>
        <p className="truncate text-xs text-zinc-500">
          {check.outputSummary?.substring(0, 100)}
        </p>
      </div>
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <span>{hoursOld}h ago</span>
        <StatusBadge status={check.status} />
      </div>
    </div>
  );
}

export default function MissionControlView() {
  const dashboard = useQuery(api.domains.missions.missionOrchestrator.getMissionDashboard);

  if (!dashboard) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-500 border-t-zinc-200" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Mission Control</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Active missions, task execution, judge reviews, and human-in-the-loop queue
        </p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Executing", count: dashboard.active.length, color: "text-blue-400" },
          { label: "Judging", count: dashboard.judging.length, color: "text-amber-400" },
          { label: "Sniff Check", count: dashboard.sniffCheck.length, color: "text-purple-400" },
          { label: "Completed", count: dashboard.recentCompleted.length, color: "text-emerald-400" },
        ].map(({ label, count, color }) => (
          <div key={label} className="rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{count}</p>
            <p className="mt-1 text-xs text-zinc-400">{label}</p>
          </div>
        ))}
      </div>

      {/* Active missions */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Active Missions
        </h2>
        {dashboard.active.length === 0 ? (
          <p className="text-sm text-zinc-500">No active missions</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dashboard.active.map((m: any) => (
              <MissionCard key={m._id} mission={m} />
            ))}
          </div>
        )}
      </section>

      {/* Judging queue */}
      {dashboard.judging.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-amber-400/80">
            Judging Queue
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dashboard.judging.map((m: any) => (
              <MissionCard key={m._id} mission={m} />
            ))}
          </div>
        </section>
      )}

      {/* Pending sniff checks */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-purple-400/80">
          Pending Validation Checks ({dashboard.pendingSniffChecks.length})
        </h2>
        {dashboard.pendingSniffChecks.length === 0 ? (
          <p className="text-sm text-zinc-500">No pending reviews</p>
        ) : (
          <div className="space-y-2">
            {dashboard.pendingSniffChecks.map((sc: any) => (
              <SniffCheckRow key={sc._id} check={sc} />
            ))}
          </div>
        )}
      </section>

      {/* Recent completions */}
      {dashboard.recentCompleted.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-emerald-400/80">
            Recent Completions
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dashboard.recentCompleted.map((m: any) => (
              <MissionCard key={m._id} mission={m} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
