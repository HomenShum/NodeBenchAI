/**
 * AutonomousOperationsPanel.tsx
 *
 * Displays operator-only runtime health for autonomous systems.
 * Shows measured health, freshness, and the maintenance control.
 */

import React, { memo, useState } from "react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import {
  Activity,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CircleDot,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";

// ============================================================================
// Types
// ============================================================================

interface CronStatus {
  component: string;
  displayName: string;
  measurementIntervalMinutes: number;
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  lastRun: number | null;
  latencyP50: number | null;
  latencyP99: number | null;
  errorRate: number | null;
  queueDepth: number | null;
  isHealthy: boolean;
  isStale: boolean;
}

interface ControlTowerSnapshot {
  generatedAt: number;
  health: {
    overall: "healthy" | "degraded" | "unhealthy" | "unknown";
    latestCheckAt: number | null;
    activeAlertCount: number;
    unhealthyComponents: string[];
    degradedComponents: string[];
    staleComponents: string[];
  };
  healing: {
    attempted24h: number;
    succeeded24h: number;
    failed24h: number;
    escalated24h: number;
    successRate24h: number;
    recentActions: Array<{
      issue: string;
      actionType: string;
      status: string;
      timestamp: number;
      result: string | null;
    }>;
  };
  maintenance: {
    lastRunAt: number | null;
    passed: boolean;
    workflowId: string | null;
    errorCount: number;
    warningCount: number;
    errors: string[];
    warnings: string[];
    hotspotSync: { created?: number; updated?: number; total?: number } | null;
    autoInvestigate: { investigated?: number; sessionIds?: string[] } | null;
  };
  loops: {
    intentHotspots: {
      total: number;
      byColumn: Record<string, number>;
    };
    bugCards: {
      total: number;
      byColumn: Record<string, number>;
    };
  };
  attentionItems: Array<{
    severity: "critical" | "warning" | "info";
    title: string;
    detail: string;
  }>;
}

export function getOperationsSummary(
  cronStatuses: CronStatus[] | undefined,
  controlTower: ControlTowerSnapshot | undefined,
): { label: string; className: string } {
  if (cronStatuses === undefined || controlTower === undefined) {
    return {
      label: "Loading status",
      className: "text-content-muted border-edge bg-surface-secondary/50",
    };
  }

  const hasUnhealthyJob = cronStatuses.some(
    (job) => job.status === "unhealthy",
  );
  const hasCriticalAttention = controlTower.attentionItems.some(
    (item) => item.severity === "critical",
  );
  const hasDegradedJob = cronStatuses.some(
    (job) => job.status === "degraded" || job.isStale,
  );
  const hasUnknownJob =
    cronStatuses.length === 0 ||
    cronStatuses.some(
      (job) => job.status === "unknown" || job.lastRun === null,
    );

  if (controlTower.health.overall === "unhealthy" || hasUnhealthyJob) {
    return {
      label: "Unhealthy",
      className: "text-red-700 border-red-500/20 bg-red-500/10 dark:text-red-300",
    };
  }

  if (hasCriticalAttention) {
    return {
      label: "Needs review",
      className: "text-red-700 border-red-500/20 bg-red-500/10 dark:text-red-300",
    };
  }

  if (controlTower.health.overall === "degraded" || hasDegradedJob) {
    return {
      label: "Degraded",
      className: "text-amber-700 border-amber-500/20 bg-amber-500/10 dark:text-amber-300",
    };
  }

  if (controlTower.attentionItems.length > 0) {
    return {
      label: "Attention needed",
      className: "text-amber-700 border-amber-500/20 bg-amber-500/10 dark:text-amber-300",
    };
  }

  if (controlTower.health.overall === "unknown" || hasUnknownJob) {
    return {
      label: cronStatuses.some((job) => job.lastRun !== null)
        ? "Status unknown"
        : "Not measured",
      className: "text-content-muted border-edge bg-surface-secondary/50",
    };
  }

  if (controlTower.health.overall === "healthy") {
    return {
      label: "Healthy",
      className: "text-green-700 border-green-500/20 bg-green-500/10 dark:text-green-300",
    };
  }

  return {
    label: "Status unknown",
    className: "text-content-muted border-edge bg-surface-secondary/50",
  };
}

// ============================================================================
// Status Indicator
// ============================================================================

const StatusIcon = memo(function StatusIcon({
  status,
  isStale,
}: {
  status: CronStatus["status"];
  isStale: boolean;
}) {
  if (isStale) {
    return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />;
  }

  switch (status) {
    case "healthy":
      return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" aria-hidden="true" />;
    case "degraded":
      return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />;
    case "unhealthy":
      return <XCircle className="w-3.5 h-3.5 text-red-500" aria-hidden="true" />;
    default:
      return <CircleDot className="w-3.5 h-3.5 text-content-muted" aria-hidden="true" />;
  }
});

// ============================================================================
// Cron Job Card
// ============================================================================

const CronJobCard = memo(function CronJobCard({ job }: { job: CronStatus }) {
  const formatTimeAgo = (timestamp: number | null): string => {
    if (!timestamp) return "No recorded run";
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const statusColor = job.isStale
    ? "border-amber-500/30 bg-amber-500/5"
    : job.status === "healthy"
      ? "border-green-500/30 bg-green-500/5"
      : job.status === "degraded"
        ? "border-amber-500/30 bg-amber-500/5"
        : job.status === "unhealthy"
          ? "border-red-500/30 bg-red-500/5"
          : "border-edge";
  const statusLabel = job.isStale
    ? "Stale"
    : job.status === "healthy"
      ? "Healthy"
      : job.status === "degraded"
        ? "Degraded"
        : job.status === "unhealthy"
          ? "Unhealthy"
          : "Unknown";

  return (
    <div
      className={cn(
        "p-3 rounded-lg border transition-colors",
        statusColor
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <StatusIcon status={job.status} isStale={job.isStale} />
            <span className="text-sm font-medium text-content truncate">
              {job.displayName}
            </span>
            <span className="text-[11px] font-medium text-content-muted">
              {statusLabel}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-content-muted">
            <span className="flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />
              Measured every {job.measurementIntervalMinutes} min
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTimeAgo(job.lastRun)}
            </span>
          </div>
        </div>
        {job.latencyP50 !== null && (
          <div className="text-right text-xs">
            <div className="text-content-muted">P50</div>
            <div className="font-mono text-content-secondary">
              {job.latencyP50 < 1000
                ? `${job.latencyP50}ms`
                : `${(job.latencyP50 / 1000).toFixed(1)}s`}
            </div>
          </div>
        )}
      </div>
      {job.queueDepth !== null && job.queueDepth > 0 && (
        <div className="mt-2 pt-2 border-t border-edge">
          <span className="text-xs text-content-muted">
            Queue depth: <span className="font-mono">{job.queueDepth}</span>
          </span>
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export const AutonomousOperationsPanel = memo(function AutonomousOperationsPanel() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runOutcome, setRunOutcome] = useState<"passed" | "needs-review" | "failed" | null>(null);
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();

  const adminAccess = useQuery(
    api.domains.proactive.adminQueries.checkAdminAccess,
    isAuthenticated ? {} : "skip",
  ) as
    | {
        hasAccess: boolean;
        role?: "owner" | "admin" | "viewer";
      }
    | undefined;
  const canReadOperations = adminAccess?.hasAccess === true;
  const canRunMaintenance =
    canReadOperations &&
    (adminAccess?.role === "owner" || adminAccess?.role === "admin");

  const cronStatuses = useQuery(
    api.domains.agents.agentHubQueries.getAutonomousCronStatus,
    canReadOperations ? {} : "skip",
  ) as CronStatus[] | undefined;
  const controlTower = useQuery(
    api.domains.operations.autonomousControlTower.getAutonomousControlTowerSnapshot,
    canReadOperations ? {} : "skip",
  ) as ControlTowerSnapshot | undefined;
  const runAutonomousMaintenanceNow = useAction(
    api.domains.operations.autonomousControlTower.runAutonomousMaintenanceNow,
  );

  const summary = getOperationsSummary(cronStatuses, controlTower);

  if (
    isAuthLoading ||
    !isAuthenticated ||
    adminAccess === undefined ||
    !canReadOperations
  ) {
    return null;
  }

  const formatTimeAgo = (timestamp: number | null): string => {
    if (!timestamp) return "No recorded run";
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="bg-surface rounded-lg border border-edge">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 p-4">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md text-left transition-colors hover:bg-surface-hover"
          aria-expanded={isExpanded}
          aria-controls="autonomous-operations-panel"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-sm font-semibold text-content">
              Autonomous Operations
            </h3>
            <span
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-xs font-medium",
                summary.className,
              )}
            >
              {summary.label}
            </span>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-content-muted shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-content-muted shrink-0" />
          )}
        </button>

      </div>

      {/* Content */}
      {isExpanded && (
        <div id="autonomous-operations-panel" className="px-4 pb-4 border-t border-edge pt-4">
          {cronStatuses === undefined || controlTower === undefined ? (
            <div
              className="flex items-center justify-center gap-2 py-8 text-sm text-content-muted"
              role="status"
            >
              <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" />
              Loading system status...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col justify-between gap-3 rounded-lg border border-edge bg-surface-secondary/50 p-3 sm:flex-row sm:items-start">
                <div className="space-y-1 text-xs text-content-secondary">
                  <p>
                    Health check: {formatTimeAgo(controlTower.health.latestCheckAt)}.
                  </p>
                  <p>
                    {controlTower.maintenance.lastRunAt === null
                      ? "Maintenance has no recorded run."
                      : `Maintenance ${controlTower.maintenance.passed ? "passed" : "needs review"} ${formatTimeAgo(controlTower.maintenance.lastRunAt)}.`}
                  </p>
                  <p>
                    {controlTower.healing.attempted24h > 0
                      ? `Self-healing: ${controlTower.healing.succeeded24h}/${controlTower.healing.attempted24h} successful in 24h.`
                      : "Self-healing: no attempts in 24h."}
                  </p>
                </div>

                {canRunMaintenance ? (
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={async () => {
                      try {
                        setIsRunning(true);
                        setRunOutcome(null);
                        const result = await runAutonomousMaintenanceNow({
                          includeLlmExplanation: false,
                        }) as {
                          maintenance?: { passed?: boolean };
                        };
                        setRunOutcome(
                          result?.maintenance?.passed === true
                            ? "passed"
                            : "needs-review",
                        );
                      } catch {
                        setRunOutcome("failed");
                      } finally {
                        setIsRunning(false);
                      }
                    }}
                    className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-edge px-2.5 py-1.5 text-xs text-content-secondary transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRunning ? (
                      <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    )}
                    {isRunning ? "Running maintenance..." : "Run maintenance"}
                  </button>
                ) : null}
              </div>

              {runOutcome === "passed" ? (
                <p className="text-xs text-green-700 dark:text-green-300" role="status">
                  Maintenance completed and all maintenance gates passed.
                </p>
              ) : runOutcome === "needs-review" ? (
                <p className="text-xs text-amber-700 dark:text-amber-300" role="alert">
                  Maintenance ran, but one or more gates need review. Live status will refresh from the backend.
                </p>
              ) : runOutcome === "failed" ? (
                <p className="text-xs text-red-700 dark:text-red-300" role="alert">
                  Maintenance could not run. Try again or inspect the operation trace.
                </p>
              ) : null}

              {controlTower.attentionItems.length > 0 ? (
                <div className="rounded-lg border border-edge bg-surface-secondary/50 p-3">
                  <div className="text-sm font-semibold text-content mb-3">Attention Queue</div>
                  <div className="space-y-2">
                    {controlTower.attentionItems.map((item, index) => (
                      <div key={`${item.title}-${index}`} className="rounded-md border border-edge bg-surface px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                              item.severity === "critical"
                                ? "bg-red-500/10 text-red-600"
                                : item.severity === "warning"
                                  ? "bg-amber-500/10 text-amber-600"
                                  : "bg-blue-500/10 text-blue-600"
                            )}
                          >
                            {item.severity}
                          </span>
                          <span className="text-sm font-medium text-content">{item.title}</span>
                        </div>
                        <div className="mt-1 text-xs text-content-secondary">{item.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-edge px-3 py-2 text-sm text-content-muted">
                  No current attention items.
                </p>
              )}

              <div>
                <h4 className="mb-3 text-sm font-semibold text-content">System health</h4>
                {cronStatuses.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {cronStatuses.map((job) => (
                      <CronJobCard key={job.component} job={job} />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg border border-edge px-3 py-4 text-sm text-content-muted">
                    No system-health measurements are available.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default AutonomousOperationsPanel;
