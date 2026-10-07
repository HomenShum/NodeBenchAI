import React, { memo } from "react";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Beaker,
  CheckCircle2,
  ExternalLink,
  FileText,
  Flag,
  Loader2,
  Lightbulb,
  Radio,
  ShieldAlert,
  Swords,
  Timer,
  Waypoints,
  Wrench,
  Zap,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import { cn } from "@/lib/utils";
import { AgentResponseFlywheelPanel } from "./AgentResponseFlywheelPanel";
import {
  formatCompactNumber,
  formatDurationCompact,
  formatGoalReference,
  formatRelativeTime,
  formatUsd,
  getCrossCheckPresentation,
  getDogfoodPresentation,
  getInstitutionalVerdictPresentation,
} from "./oracleControlTowerUtils";

interface OracleControlTowerSnapshot {
  summary: {
    activeSessions: number;
    violatedCount: number;
    driftingCount: number;
    failedSessions: number;
    pendingConfirmations: number;
    totalTokens: number;
    totalCostUsd: number;
    avgLatencyMs: number;
    institutionalVerdict:
      | "unmeasured"
      | "institutional_memory_aligned"
      | "watch"
      | "institutional_hallucination_risk";
  };
  latestDogfood: null | {
    _id: string;
    createdAt: number;
    source: string;
    model: string;
    summary: string;
    verdict: "missing" | "watch" | "fail" | "pass";
    label: string;
    p0: number;
    p1: number;
    p2: number;
    p3: number;
    totalIssues: number;
  };
  pendingConfirmations: Array<{
    _id: string;
    toolName: string;
    riskTier: string;
    actionSummary: string;
    createdAt: number;
    expiresAt: number;
  }>;
  openFailures: Array<{
    kind: string;
    title: string;
    detail: string;
  }>;
  recentSessions: Array<{
    _id: string;
    title: string;
    description?: string;
    status: string;
    type: string;
    startedAt: number;
    completedAt?: number;
    totalDurationMs: number;
    totalTokens: number;
    estimatedCostUsd: number;
    goalId?: string;
    visionSnapshot?: string;
    successCriteria: string[];
    sourceRefs: Array<{ label: string; href?: string; note?: string; kind?: string }>;
    crossCheckStatus?: "aligned" | "drifting" | "violated";
    deltaFromVision?: string;
    dogfoodRunId?: string;
    toolsUsed: string[];
    traceCount: number;
    traceTimeline: Array<{
      _id: string;
      traceId: string;
      workflowName: string;
      status: string;
      startedAt: number;
      totalDurationMs: number;
      totalTokens: number;
      estimatedCostUsd: number;
      crossCheckStatus?: "aligned" | "drifting" | "violated";
      deltaFromVision?: string;
      toolSequence: string[];
    }>;
    topToolSequence: string[];
  }>;
  temporalOs: null;
  successLoops: null;
  responseFlywheel: {
    summary: {
      totalReviews: number;
      passCount: number;
      watchCount: number;
      failCount: number;
      passRate: number;
      averageOverallScore: number;
      weakestDimension: null | {
        key: string;
        label: string;
        averageScore: number;
      };
      strongestDimension: null | {
        key: string;
        label: string;
        averageScore: number;
      };
      hottestQuestionCategory: null | {
        key: string;
        label: string;
        count: number;
      };
      latestReviewedAt: number | null;
    };
    dimensions: Array<{
      key: string;
      label: string;
      averageScore: number;
      status: "strong" | "watch" | "weak";
    }>;
    categories: Array<{
      key: string;
      label: string;
      count: number;
      outputVariables: string[];
    }>;
    recentFindings: Array<{
      reviewKey: string;
      messageId: string;
      promptSummary: string;
      status: "pass" | "watch" | "fail";
      overallScore: number;
      matchedCategoryKeys: string[];
      weaknesses: string[];
      recommendations: string[];
      reviewedAt: number;
    }>;
  };
  nextRecommendedAction: string;
  industryMetrics?: {
    scope: "authenticated_owner";
    toolCalls: {
      last24h: number;
      sampleCount: number;
      successRate24h: number | null;
      failedLast24h: number;
      avgDurationMs: number | null;
      sampledWeek: number;
      topTools: Array<{ name: string; count: number }>;
    };
    evidence: {
      sourceRefCount: number;
      attachmentCount: number;
      traceSampleCount: number;
    };
    sessions: {
      sampleCount: number;
      completed: number;
      failed: number;
    };
  };
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-center gap-2 text-xs text-content-muted">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-content">{value}</div>
      {sub ? <div className="mt-1 text-xs text-content-secondary">{sub}</div> : null}
    </div>
  );
}

// ── Compact metric row ──────────────────────────────────────────────────────
function MetricRow({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <Icon className={cn("h-3.5 w-3.5 shrink-0", accent ?? "text-content-muted")} />
      <span className="text-xs text-content-secondary flex-1 truncate">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-content">{value}</span>
      {sub ? <span className="text-[11px] text-content-muted">{sub}</span> : null}
    </div>
  );
}

// ── Progress bar ────────────────────────────────────────────────────────────
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-background/60 overflow-hidden">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Industry Metrics Panel ──────────────────────────────────────────────────
function IndustryMetricsSection({
  metrics,
}: {
  metrics: NonNullable<OracleControlTowerSnapshot["industryMetrics"]>;
}) {
  const { toolCalls, evidence, sessions } = metrics;

  return (
    <div className="rounded-xl border border-edge bg-surface p-4 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-content">
        <BarChart3 className="h-4 w-4 text-accent" />
        Owner execution telemetry
      </div>

      {/* Tool Calls */}
      <div className="rounded-lg border border-edge bg-background/40 p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-content">Tool Execution</span>
          <span className="text-[11px] text-content-muted">authenticated owner only</span>
        </div>
        <MetricRow
          icon={Wrench}
          label="Calls (24h)"
          value={formatCompactNumber(toolCalls.last24h)}
          accent="text-blue-400"
        />
        <MetricRow
          icon={Zap}
          label="Success rate"
          value={toolCalls.successRate24h === null ? "Unknown" : `${toolCalls.successRate24h}%`}
          sub={`${toolCalls.sampleCount} measured calls`}
          accent={toolCalls.successRate24h === null ? "text-content-muted" : toolCalls.successRate24h >= 95 ? "text-emerald-400" : toolCalls.successRate24h >= 80 ? "text-amber-400" : "text-red-400"}
        />
        {toolCalls.failedLast24h > 0 && (
          <MetricRow
            icon={AlertTriangle}
            label="Failed"
            value={toolCalls.failedLast24h}
            accent="text-red-400"
          />
        )}
        <MetricRow
          icon={Timer}
          label="Avg latency"
          value={toolCalls.avgDurationMs === null ? "Unknown" : formatDurationCompact(toolCalls.avgDurationMs)}
          accent="text-violet-400"
        />
        <MetricRow
          icon={Wrench}
          label="Sampled calls (7d)"
          value={formatCompactNumber(toolCalls.sampledWeek)}
          accent="text-blue-400"
        />

        {toolCalls.topTools.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="type-label">Top tools</div>
            {toolCalls.topTools.slice(0, 5).map((tool) => (
              <div key={tool.name} className="flex items-center gap-2">
                <span className="text-[11px] text-content-secondary truncate flex-1">{tool.name}</span>
                <MiniBar value={tool.count} max={toolCalls.topTools[0].count} color="bg-blue-500/60" />
                <span className="text-[10px] tabular-nums text-content-muted w-6 text-right">{tool.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Evidence recorded on the sampled owned traces */}
      <div className="rounded-lg border border-edge bg-background/40 p-3 space-y-1.5">
        <span className="text-xs font-medium text-content">Recorded evidence</span>
        <MetricRow
          icon={FileText}
          label="Source references"
          value={formatCompactNumber(evidence.sourceRefCount)}
          accent="text-emerald-400"
        />
        <MetricRow
          icon={Swords}
          label="Evidence attachments"
          value={formatCompactNumber(evidence.attachmentCount)}
          accent="text-amber-400"
        />
        <MetricRow
          icon={Waypoints}
          label="Traces sampled"
          value={formatCompactNumber(evidence.traceSampleCount)}
          accent="text-cyan-400"
        />
      </div>

      {/* Owned task-session sample */}
      <div className="rounded-lg border border-edge bg-background/40 p-3 space-y-1.5">
        <span className="text-xs font-medium text-content">Task sessions sampled</span>
        <MetricRow
          icon={Swords}
          label="Sessions"
          value={formatCompactNumber(sessions.sampleCount)}
          accent="text-violet-400"
        />
        <MetricRow
          icon={CheckCircle2}
          label="Completed"
          value={formatCompactNumber(sessions.completed)}
          accent="text-emerald-400"
        />
        {sessions.failed > 0 && (
          <MetricRow
            icon={AlertTriangle}
            label="Failed"
            value={sessions.failed}
            accent="text-red-400"
          />
        )}
      </div>
    </div>
  );
}

export const OracleControlTowerPanel = memo(function OracleControlTowerPanel() {
  const snapshot = useQuery(api.domains.taskManager.queries.getOracleControlTowerSnapshot, {
    limit: 6,
  }) as OracleControlTowerSnapshot | null | undefined;
  const industryMetrics = useQuery(
    api.domains.taskManager.queries.getIndustryMetrics,
    snapshot ? {} : "skip",
  ) as
    | NonNullable<OracleControlTowerSnapshot["industryMetrics"]>
    | null
    | undefined;

  if (snapshot === undefined) {
    return (
      <div className="nb-surface-card p-6">
        <div className="flex items-center gap-2 text-sm text-content-secondary">
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
          Loading Oracle control tower...
        </div>
      </div>
    );
  }

  if (snapshot === null) {
    return (
      <div className="nb-surface-card p-6">
        <div className="text-sm font-medium text-content">Sign in to view execution controls</div>
        <p className="mt-1 text-sm text-content-secondary">
          Operational sessions, traces, approvals, and telemetry are private to their owner.
        </p>
      </div>
    );
  }

  const institutionalTone = getInstitutionalVerdictPresentation(snapshot.summary.institutionalVerdict);
  const dogfoodTone = getDogfoodPresentation(snapshot.latestDogfood?.verdict ?? "missing");

  return (
    <div className="nb-surface-card overflow-hidden">
      <div className="border-b border-white/[0.06] bg-white/[0.03] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-content">
              <Waypoints className="h-4 w-4 text-accent" />
              Oracle Control Tower
            </div>
            <p className="mt-1 max-w-3xl text-sm text-content-secondary">
                  Continuous health monitoring for goal alignment, execution quality, evidence collection, and approval gates.
                </p>
              </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                institutionalTone.className,
              )}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              {institutionalTone.label}
            </span>
            <a
              href="/dogfood"
              className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface px-2.5 py-1 text-xs text-content-secondary transition-colors hover:text-content"
            >
              Review evidence <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active quests"
          value={String(snapshot.summary.activeSessions)}
          sub={`${snapshot.summary.pendingConfirmations} pending confirmations`}
          icon={Swords}
        />
        <StatCard
          label="Drift pressure"
          value={`${snapshot.summary.violatedCount}/${snapshot.summary.driftingCount}`}
          sub="violated / drifting"
          icon={Flag}
        />
        <StatCard
          label="Budget load"
          value={`${formatCompactNumber(snapshot.summary.totalTokens)} tokens`}
          sub={`${formatUsd(snapshot.summary.totalCostUsd)} total cost`}
          icon={Zap}
        />
        <StatCard
          label="Trace latency"
          value={snapshot.summary.avgLatencyMs > 0 ? formatDurationCompact(snapshot.summary.avgLatencyMs) : "No traces"}
          sub={`${snapshot.summary.failedSessions} failed sessions in view`}
          icon={Timer}
        />
      </div>

      <div className="grid gap-5 border-t border-edge p-5 xl:grid-cols-[1.1fr,0.9fr]">
        <div className="space-y-4">
          <div className="rounded-xl border border-edge bg-surface p-4">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-content-muted">
              Next recommended action
            </div>
            <div className="mt-2 flex items-start gap-3">
              <ArrowRight className="mt-0.5 h-4 w-4 text-accent" />
              <p className="text-sm leading-6 text-content">{snapshot.nextRecommendedAction}</p>
            </div>
          </div>

          <div className="rounded-xl border border-edge bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-content">Recent loops</div>
              <div className="text-xs text-content-muted">{snapshot.recentSessions.length} tracked sessions</div>
            </div>
            <div className="mt-4 space-y-3">
              {snapshot.recentSessions.length === 0 ? (
                <div className="text-sm text-content-secondary">No builder sessions have been instrumented yet.</div>
              ) : (
                snapshot.recentSessions.map((session) => {
                  const tone = getCrossCheckPresentation(session.crossCheckStatus);
                  return (
                    <div key={session._id} className="rounded-lg border border-edge bg-background/40 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium text-content">{session.title}</div>
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                tone.className,
                              )}
                            >
                              {tone.questLabel}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-content-muted">
                            {formatRelativeTime(session.startedAt)}
                            {session.goalId ? ` · ${formatGoalReference(session.goalId)}` : ""}
                            {session.traceCount ? ` · ${session.traceCount} traces` : ""}
                          </div>
                        </div>
                        <div className="text-right text-xs text-content-muted">
                          <div>{formatCompactNumber(session.totalTokens)} tokens</div>
                          <div>{formatUsd(session.estimatedCostUsd)}</div>
                        </div>
                      </div>

                      {session.deltaFromVision ? (
                        <p className="mt-2 text-xs leading-5 text-content-secondary">{session.deltaFromVision}</p>
                      ) : null}

                      {session.topToolSequence.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {session.topToolSequence.map((tool) => (
                            <span
                              key={`${session._id}-${tool}`}
                              className="rounded-full border border-edge bg-surface px-2 py-0.5 text-[11px] text-content-secondary"
                            >
                              {tool}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {session.traceTimeline.length > 0 ? (
                        <div className="mt-3 space-y-1.5">
                          {session.traceTimeline.slice(0, 3).map((trace) => (
                            <div
                              key={trace._id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-edge/70 bg-surface px-2.5 py-1.5 text-[11px]"
                            >
                              <div className="flex items-center gap-2 text-content-secondary">
                                <span
                                  className={cn(
                                    "h-2 w-2 rounded-full",
                                    trace.status === "completed"
                                      ? "bg-emerald-500"
                                      : trace.status === "error"
                                        ? "bg-red-500"
                                        : "bg-amber-500",
                                  )}
                                />
                                <span className="font-medium text-content">{trace.workflowName}</span>
                              </div>
                              <div className="flex items-center gap-3 text-content-muted">
                                <span>{formatCompactNumber(trace.totalTokens)} tok</span>
                                <span>{trace.totalDurationMs ? formatDurationCompact(trace.totalDurationMs) : "pending"}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* ── Industry Metrics ─────────────────────────────────────── */}
          {industryMetrics && <IndustryMetricsSection metrics={industryMetrics} />}

          <div className="rounded-xl border border-edge bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-content">Quality review verdict</div>
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  dogfoodTone.className,
                )}
              >
                {dogfoodTone.label}
              </span>
            </div>
            {snapshot.latestDogfood ? (
              <div className="mt-3 space-y-2 text-sm text-content-secondary">
                <div className="text-xs text-content-muted">
                  {formatRelativeTime(snapshot.latestDogfood.createdAt)} · {snapshot.latestDogfood.source} · {snapshot.latestDogfood.model}
                </div>
                <p className="leading-6 text-content">{snapshot.latestDogfood.summary}</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-red-700 dark:text-red-300">
                    P0 {snapshot.latestDogfood.p0}
                  </span>
                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">
                    P1 {snapshot.latestDogfood.p1}
                  </span>
                  <span className="rounded-full border border-edge bg-surface px-2 py-0.5 text-content-secondary">
                    Total {snapshot.latestDogfood.totalIssues}
                  </span>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-content-secondary">
                No quality review is attached yet. Run the builder-facing loop and attach the latest evidence to the session.
              </p>
            )}
          </div>

          <AgentResponseFlywheelPanel snapshot={snapshot.responseFlywheel} />

          <div className="rounded-xl border border-edge bg-surface p-4">
            <div className="text-sm font-semibold text-content">Pending confirmations</div>
            <div className="mt-3 space-y-2">
              {snapshot.pendingConfirmations.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-content-secondary">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  No blocked write operations right now.
                </div>
              ) : (
                snapshot.pendingConfirmations.slice(0, 5).map((draft) => (
                  <div key={draft._id} className="rounded-lg border border-edge bg-background/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-content">{draft.toolName}</div>
                      <span className="rounded-full border border-edge bg-surface px-2 py-0.5 text-[11px] text-content-secondary">
                        {draft.riskTier}
                      </span>
                    </div>
                    <div className="mt-1 text-xs leading-5 text-content-secondary">{draft.actionSummary}</div>
                    <div className="mt-2 text-[11px] text-content-muted">Expires {formatRelativeTime(draft.expiresAt)}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-edge bg-surface p-4">
            <div className="text-sm font-semibold text-content">Attention queue</div>
            <div className="mt-3 space-y-2">
              {snapshot.openFailures.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-content-secondary">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  No open failure cards in the current slice.
                </div>
              ) : (
                snapshot.openFailures.map((failure, idx) => (
                  <div key={`${failure.kind}-${failure.title}-${idx}`} className="rounded-lg border border-edge bg-background/40 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-content">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      {failure.title}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-content-secondary">{failure.detail}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default OracleControlTowerPanel;
