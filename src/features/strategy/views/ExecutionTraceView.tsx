import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  ClipboardCheck,
  DatabaseZap,
  FileJson2,
  FileSpreadsheet,
  Files,
  GitCompareArrows,
  SearchCheck,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import { useConvexAuth, useQuery } from "convex/react";

import { LazyCodeBlock } from "@/shared/components/LazyCodeBlock";
import { cn } from "@/lib/utils";
import { SourceChip } from "@/shared/ui";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type {
  TaskSession,
  TaskSpan,
  TaskTrace,
} from "@/features/agents/components/TaskManager/types";
import { TrajectorySummaryBand } from "@/features/trajectory/components/TrajectorySummaryBand";
import { TrajectoryTimelinePanel } from "@/features/trajectory/components/TrajectoryTimelinePanel";
import type { TrajectorySummaryData, TrajectoryTimelineItem } from "@/features/trajectory/types";

import { SPREADSHEET_EXECUTION_TRACE } from "../data/spreadsheetExecutionTrace";
import { buildExecutionTraceFromLiveRun } from "../lib/executionTraceAdapter";
import { EXECUTION_TRACE_JSON_SCHEMA } from "../types/executionTrace";

type TraceTab = "overview" | "timeline" | "evidence" | "diffs" | "verification" | "json";
type DisclosureLevel = "outcome" | "why" | "full";

const TABS: Array<{ id: TraceTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Timeline" },
  { id: "evidence", label: "Evidence" },
  { id: "diffs", label: "Diffs" },
  { id: "verification", label: "Verification" },
  { id: "json", label: "JSON Contract" },
];

const DISCLOSURE_LEVELS: Array<{
  id: DisclosureLevel;
  label: string;
  description: string;
}> = [
  {
    id: "outcome",
    label: "Outcome",
    description: "Best for buyers and operators who need the result, key evidence, and limitations fast.",
  },
  {
    id: "why",
    label: "Why",
    description: "Adds the reasoning boundary: decisions, evidence basis, and verification context.",
  },
  {
    id: "full",
    label: "Full Trace",
    description: "Shows the complete audit path: timeline, diffs, raw contract, and full evidence payloads.",
  },
];

const DISCLOSURE_TABS: Record<DisclosureLevel, TraceTab[]> = {
  outcome: ["overview"],
  why: ["overview", "timeline", "evidence", "verification"],
  full: ["overview", "timeline", "evidence", "diffs", "verification", "json"],
};

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-edge bg-surface-secondary p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-content">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-content-secondary">
          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({ value }: { value: "passed" | "warning" | "failed" | "fixed" }) {
  const tone =
    value === "passed"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
      : value === "fixed"
        ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300"
        : value === "warning"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300"
          : "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300";
  return (
    <span className={cn("rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide", tone)}>
      {value}
    </span>
  );
}

function SourceChips({ sourceRefs }: { sourceRefs?: Array<{ label: string; url?: string }> }) {
  if (!sourceRefs?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {sourceRefs.map((source) => (
        <SourceChip
          key={`${source.label}-${source.url ?? "local"}`}
          label={source.label}
          href={source.url}
        />
      ))}
    </div>
  );
}

export function ExecutionTraceView() {
  const [activeTab, setActiveTab] = useState<TraceTab>("overview");
  const [disclosureLevel, setDisclosureLevel] = useState<DisclosureLevel>("outcome");
  const [selectedSessionId, setSelectedSessionId] = useState<Id<"agentTaskSessions"> | null>(null);
  const { isAuthenticated } = useConvexAuth();
  const effectiveIsPublic = !isAuthenticated;
  const requestedSessionId = useMemo(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const session = params.get("session");
    // Validate: Convex IDs are non-empty alphanumeric strings (no slashes, no spaces)
    if (!session || !/^[a-zA-Z0-9_-]+$/.test(session)) return null;
    return session as Id<"agentTaskSessions">;
  }, []);
  const allowSeededDemo = useMemo(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("demo") === "1";
  }, []);

  const publicSessionsData = useQuery(
    api.domains.taskManager.queries.getPublicTaskSessions,
    effectiveIsPublic ? { limit: 8 } : "skip",
  );
  const userSessionsData = useQuery(
    api.domains.taskManager.queries.getUserTaskSessions,
    !effectiveIsPublic ? { limit: 8 } : "skip",
  );

  const sessions = useMemo(
    () => ((effectiveIsPublic ? publicSessionsData?.sessions : userSessionsData?.sessions) ?? []) as TaskSession[],
    [effectiveIsPublic, publicSessionsData?.sessions, userSessionsData?.sessions],
  );

  useEffect(() => {
    if (!sessions.length) {
      setSelectedSessionId(null);
      return;
    }
    if (
      requestedSessionId &&
      sessions.some((session) => String(session._id) === String(requestedSessionId))
    ) {
      if (String(selectedSessionId) !== String(requestedSessionId)) {
        setSelectedSessionId(requestedSessionId);
      }
      return;
    }
    if (!selectedSessionId || !sessions.some((session) => session._id === selectedSessionId)) {
      setSelectedSessionId(sessions[0]._id);
    }
  }, [requestedSessionId, selectedSessionId, sessions]);

  const sessionDetail = useQuery(
    api.domains.taskManager.queries.getTaskSessionDetail,
    selectedSessionId ? { sessionId: selectedSessionId } : "skip",
  );

  const primaryTraceId = useMemo(
    () => ((sessionDetail?.traces?.[0]?._id ?? null) as Id<"agentTaskTraces"> | null),
    [sessionDetail?.traces],
  );

  const primaryTraceSpans = useQuery(
    api.domains.taskManager.queries.getTraceSpans,
    primaryTraceId ? { traceId: primaryTraceId } : "skip",
  );

  const liveTrace = useMemo(() => {
    if (!sessionDetail?.session) return null;
    return buildExecutionTraceFromLiveRun({
      session: sessionDetail.session as TaskSession & { metadata?: unknown; errorStack?: string },
      traces: (sessionDetail.traces ?? []) as Array<TaskTrace & { metadata?: unknown }>,
      spans: ((primaryTraceSpans?.spans ?? []) as TaskSpan[]) || [],
    });
  }, [primaryTraceSpans?.spans, sessionDetail]);

  const trace: any = liveTrace ?? SPREADSHEET_EXECUTION_TRACE;
  const usingLiveRun = Boolean(liveTrace);
  const showingSeededDemo = !usingLiveRun && allowSeededDemo;
  const hasVisibleTrace = usingLiveRun || showingSeededDemo;
  const activeWorkflowName = useMemo(
    () => {
      if (!hasVisibleTrace) return null;
      return (
      sessionDetail?.traces?.[0]?.workflowName ??
      trace.meta.workflow_name ??
      trace.run.workflow_type ??
      trace.meta.workflow_template ??
        null
      );
    },
    [hasVisibleTrace, sessionDetail?.traces, trace.meta.workflow_name, trace.meta.workflow_template, trace.run.workflow_type],
  );
  const trajectorySummary = useQuery(
    api.domains.trajectory.queries.getTrajectorySummary,
    activeWorkflowName
      ? {
          entityKey: activeWorkflowName,
          entityType: "workflow",
          windowDays: 90,
        }
      : "skip",
  ) as TrajectorySummaryData | undefined;
  const trajectoryTimeline = useQuery(
    api.domains.trajectory.queries.getTrajectoryTimeline,
    activeWorkflowName
      ? {
          entityKey: activeWorkflowName,
          entityType: "workflow",
          windowDays: 90,
        }
      : "skip",
  ) as { items: TrajectoryTimelineItem[] } | undefined;
  const activeSession = sessionDetail?.session as TaskSession | undefined;
  const isLoadingSessions = (effectiveIsPublic ? publicSessionsData : userSessionsData) === undefined;
  const isLoadingDetail = Boolean(selectedSessionId) && sessionDetail === undefined;

  const formattedJson = useMemo(() => JSON.stringify(trace, null, 2), [trace]);
  const schemaJson = useMemo(() => JSON.stringify(EXECUTION_TRACE_JSON_SCHEMA, null, 2), []);
  const visibleTabs = useMemo(() => {
    const allowed = new Set(DISCLOSURE_TABS[disclosureLevel]);
    return TABS.filter((tab) => allowed.has(tab.id));
  }, [disclosureLevel]);
  const headline = usingLiveRun
    ? activeSession?.title ?? "Live execution workflow"
    : "Spreadsheet workflow: inspect, research, edit, verify, export";
  const truthBoundary =
    trace.limitations[0] ??
    "This surface stores action receipts, evidence, diffs, decisions, verification checks, and final artifacts.";
  const primaryDecision = trace.decisions[0];
  const primaryOutput = trace.outputs[0];
  const verificationCounts = useMemo(
    () =>
      trace.verification_checks.reduce(
        (acc: Record<"passed" | "warning" | "failed" | "fixed", number>, check: any) => {
          acc[check.status] += 1;
          return acc;
        },
        { passed: 0, warning: 0, failed: 0, fixed: 0 } as Record<"passed" | "warning" | "failed" | "fixed", number>,
      ),
    [trace.verification_checks],
  );
  const deepLinkContext = useMemo(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const entity = params.get("entity");
    const edge = params.get("edge");
    const event = params.get("event");
    const evidence = params.get("evidence");
    if (!entity && !edge && !event && !evidence) return null;
    return { entity, edge, event, evidence };
  }, []);

  useEffect(() => {
    if (!DISCLOSURE_TABS[disclosureLevel].includes(activeTab)) {
      setActiveTab(DISCLOSURE_TABS[disclosureLevel][0]);
    }
  }, [activeTab, disclosureLevel]);

  if (!hasVisibleTrace) {
    return (
      <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-6 px-6 py-8" data-testid="execution-trace-view">
        <header className="rounded-[28px] border border-edge bg-surface-secondary p-6">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-edge bg-surface-secondary/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
              Execution Trace
            </span>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-200">
              No saved run selected
            </span>
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-content">
                No live execution trace is available yet.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-content-secondary">
                This operator surface only shows saved agent runs, tool receipts, evidence, decisions, verification checks,
                and exported artifacts. It does not substitute a fixture trace when production has no matching run.
              </p>
            </div>
            <div className="rounded-2xl border border-edge bg-surface-secondary p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Run source</div>
              <p className="mt-2 text-sm leading-relaxed text-content-secondary">
                {isLoadingSessions || isLoadingDetail
                  ? "Loading saved execution runs..."
                  : "Start or select a saved agent run to populate this audit trail."}
              </p>
              <a
                className="mt-4 inline-flex rounded-full border border-edge bg-surface px-3 py-1.5 text-sm text-content transition hover:border-primary/40"
                href="/execution-trace?demo=1"
              >
                View explicit demo trace
              </a>
            </div>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-6 px-6 py-8" data-testid="execution-trace-view">
      <header className="rounded-[28px] border border-edge bg-surface-secondary dark:bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.14),transparent_36%),rgba(5,5,5,0.92)] p-6">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-edge bg-surface-secondary/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
            Execution Trace
          </span>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
            {trace.meta.status}
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide",
              usingLiveRun
                ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200"
                : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200",
            )}
          >
            {usingLiveRun ? "Live saved run" : "Explicit demo trace"}
          </span>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-content">{headline}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-content-secondary">{trace.run.user_goal}</p>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-content-secondary/70">
              This surface stores action receipts, evidence, diffs, decisions, verification checks, and final artifacts.
              It does not depend on hidden chain-of-thought to make the workflow auditable.
            </p>
          </div>
          <div className="rounded-2xl border border-edge bg-surface-secondary dark:bg-black/20 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Run source</div>
            {sessions.length ? (
              <div className="mt-2">
                <label className="sr-only" htmlFor="execution-trace-run-select">
                  Select live execution run
                </label>
                <select
                  id="execution-trace-run-select"
                  aria-label="Select live execution run"
                  value={selectedSessionId ?? ""}
                  onChange={(event) =>
                    setSelectedSessionId(event.target.value as Id<"agentTaskSessions">)
                  }
                  className="w-full rounded-xl border border-edge bg-surface px-3 py-2 text-sm text-content outline-none transition focus:border-primary/40"
                >
                  {sessions.map((session) => (
                    <option key={session._id} value={session._id}>
                      {session.title}
                    </option>
                  ))}
                </select>
                <div className="mt-2 flex items-center gap-2 text-xs text-content-muted">
                  <DatabaseZap className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-300" />
                  {usingLiveRun
                    ? `${sessionDetail?.traceCount ?? 0} trace${sessionDetail?.traceCount === 1 ? "" : "s"} reconstructed from saved runs`
                    : "No compatible saved runs found. Showing the explicit demo trace."}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-content-secondary">
                No saved task runs are available yet. This explicit demo trace is visible because the URL includes demo=1.
              </p>
            )}

            <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Run summary</div>
            <div className="mt-2 space-y-2 text-sm text-content-secondary">
              <div>{trace.steps.length} recorded steps</div>
              <div>{trace.evidence_catalog.length} evidence bundles</div>
              <div>{trace.verification_checks.length} verification checks</div>
              <div>{trace.outputs.length} exported artifacts</div>
            </div>
            <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Truth boundary</div>
            <p className="mt-2 text-sm leading-relaxed text-content-secondary">{truthBoundary}</p>
            {deepLinkContext ? (
              <>
                <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
                  Linked intelligence context
                </div>
                <div className="mt-2 rounded-xl border border-edge bg-surface px-3 py-3 text-sm text-content-secondary">
                  {deepLinkContext.entity ? <div>Entity: {deepLinkContext.entity}</div> : null}
                  {deepLinkContext.edge ? <div>Edge: {deepLinkContext.edge}</div> : null}
                  {deepLinkContext.event ? <div>Event: {deepLinkContext.event}</div> : null}
                  {deepLinkContext.evidence ? <div>Evidence: {deepLinkContext.evidence}</div> : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <TrajectorySummaryBand
        summary={trajectorySummary ?? null}
        loading={trajectorySummary === undefined}
        emptyLabel="No workflow-level trajectory cache exists yet for this trace. Rebuild the trajectory entity after the next saved run if you want persisted slope attribution."
      />

      {(isLoadingSessions || isLoadingDetail) && !usingLiveRun ? (
        <div className="rounded-2xl border border-edge bg-surface/50 px-4 py-3 text-sm text-content-muted">
          Loading saved execution runs…
        </div>
      ) : null}

      <section className="rounded-2xl border border-edge bg-surface/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
              Progressive disclosure
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-content-secondary">
              Start with the level of detail you actually need, then drill down only when the workflow outcome needs explanation or a full audit trail.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Execution trace disclosure levels">
            {DISCLOSURE_LEVELS.map((level) => (
              <button
                key={level.id}
                type="button"
                role="tab"
                aria-selected={disclosureLevel === level.id}
                onClick={() => setDisclosureLevel(level.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition",
                  disclosureLevel === level.id
                    ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-100"
                    : "border-edge bg-surface/50 text-content-muted hover:border-primary/30 hover:text-content",
                )}
              >
                {level.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 text-sm text-content-muted">
          {DISCLOSURE_LEVELS.find((level) => level.id === disclosureLevel)?.description}
        </div>
      </section>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Execution trace sections">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition",
              activeTab === tab.id
                ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-100"
                : "border-edge bg-surface/50 text-content-muted hover:border-primary/30 hover:text-content",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <>
          {disclosureLevel === "outcome" ? (
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <SectionCard title="Outcome" icon={<BadgeCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />}>
                <div className="space-y-4">
                  <div className="rounded-xl border border-edge bg-surface/50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">Primary result</div>
                    <div className="mt-2 text-sm font-medium text-content">
                      {primaryDecision?.statement ?? "This run completed with a traceable outcome."}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-content-secondary">{trace.run.user_goal}</p>
                  </div>
                  {primaryOutput ? (
                    <div className="rounded-xl border border-edge bg-surface/50 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">Primary artifact</div>
                      <div className="mt-2 text-sm font-medium text-content">{primaryOutput.label}</div>
                      <div className="mt-1 text-xs uppercase tracking-wide text-content-muted">{primaryOutput.kind}</div>
                      <div className="mt-2 break-all text-xs text-content-muted">{primaryOutput.path}</div>
                      <p className="mt-2 text-sm leading-relaxed text-content-secondary">{primaryOutput.summary}</p>
                    </div>
                  ) : null}
                </div>
              </SectionCard>

              <div className="space-y-6">
                <SectionCard title="Trust Boundary" icon={<SearchCheck className="h-4 w-4 text-amber-600 dark:text-amber-300" />}>
                  <BulletList items={trace.limitations} />
                </SectionCard>

                <SectionCard title="Verification Snapshot" icon={<ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-edge bg-surface/50 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">Passed</div>
                      <div className="mt-2 text-2xl font-semibold text-content">{verificationCounts.passed}</div>
                    </div>
                    <div className="rounded-xl border border-edge bg-surface/50 p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">Warnings / fixes</div>
                      <div className="mt-2 text-2xl font-semibold text-content">
                        {verificationCounts.warning + verificationCounts.fixed}
                      </div>

                    </div>
                  </div>
                </SectionCard>
              </div>
            </div>
          ) : null}

          {disclosureLevel === "why" ? (
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <SectionCard title="Why this outcome" icon={<BadgeCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />}>
                <div className="space-y-4">
                  {trace.decisions.map((decision: any) => (
                    <div key={decision.decision_id} className="rounded-xl border border-edge bg-surface/50 p-4">
                      <div className="text-sm font-medium text-content">{decision.statement}</div>
                      <div className="mt-2">
                        <BulletList items={decision.basis} />
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <div className="space-y-6">
                <SectionCard title="Evidence boundary" icon={<Files className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />}>
                  <div className="space-y-4">
                    {trace.evidence_catalog.slice(0, 3).map((evidence: any) => (
                      <div key={evidence.evidence_id} className="rounded-xl border border-edge bg-surface/50 p-4">
                        <div className="text-sm font-medium text-content">{evidence.title}</div>
                        <p className="mt-2 text-sm leading-relaxed text-content-secondary">{evidence.summary}</p>
                        <SourceChips sourceRefs={evidence.source_refs} />
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Verification Snapshot" icon={<ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />}>
                  <BulletList
                    items={[
                      `${verificationCounts.passed} checks passed`,
                      `${verificationCounts.warning} warnings recorded`,
                      `${verificationCounts.fixed} issues fixed during the run`,
                      truthBoundary,
                    ]}
                  />
                </SectionCard>
              </div>
            </div>
          ) : null}

          {disclosureLevel === "full" ? (
            <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <SectionCard title="Workflow Template" icon={<Waypoints className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />}>
                <div className="space-y-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">Inputs</div>
                    <div className="mt-2">
                      <BulletList items={trace.inputs.uploaded_files} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">Instructions</div>
                    <div className="mt-2">
                      <BulletList items={trace.inputs.instructions} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">Stored as receipts</div>
                    <div className="mt-2">
                      <BulletList
                        items={[
                          "intent and uploaded inputs",
                          "tool actions and artifacts out",
                          "evidence and unsupported-claim boundaries",
                          "decision records and ranking basis",
                          "verification passes and cleanup fixes",
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </SectionCard>

              <div className="space-y-6">
                <SectionCard title="Structured Decisions" icon={<BadgeCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />}>
                  <div className="space-y-4">
                    {trace.decisions.map((decision: any) => (
                      <div key={decision.decision_id} className="rounded-xl border border-edge bg-surface/50 p-4">
                        <div className="text-sm font-medium text-content">{decision.statement}</div>
                        <div className="mt-2">
                          <BulletList items={decision.basis} />
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Outputs" icon={<FileSpreadsheet className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />}>
                  <div className="space-y-3">
                    {trace.outputs.map((output: any) => (
                      <div key={output.output_id} className="rounded-xl border border-edge bg-surface/50 p-4">
                        <div className="text-sm font-medium text-content">{output.label}</div>
                        <div className="mt-1 text-xs uppercase tracking-wide text-content-muted">{output.kind}</div>
                        <div className="mt-2 break-all text-xs text-content-muted">{output.path}</div>
                        <p className="mt-2 text-sm leading-relaxed text-content-secondary">{output.summary}</p>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {activeTab === "timeline" ? (
        <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
          <SectionCard title="Step Timeline" icon={<Waypoints className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />}>
            <div className="space-y-4">
              {trace.steps.map((step: any, index: number) => (
                <div key={step.step_id} className="grid gap-3 rounded-2xl border border-edge bg-surface/50 p-4 lg:grid-cols-[120px_1fr]">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">{step.stage}</div>
                    <div className="mt-1 text-xs text-content-muted">Step {index + 1}</div>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium text-content">{step.title}</div>
                      <span className="rounded-full border border-edge bg-surface-secondary/50 px-2 py-1 text-[10px] uppercase tracking-wide text-content-muted">
                        {step.tool}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-content-secondary">{step.result_summary}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-content-muted">
                      <span>action: {step.action}</span>
                      <span>target: {step.target}</span>
                      {typeof step.confidence === "number" ? (
                        <span>confidence {(step.confidence * 100).toFixed(0)}%</span>
                      ) : null}
                    </div>
                    {step.verification.length ? (
                      <div className="mt-3 rounded-xl border border-edge bg-surface-secondary p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                          Verification notes
                        </div>
                        <div className="mt-2">
                          <BulletList items={step.verification} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <TrajectoryTimelinePanel
            items={trajectoryTimeline?.items ?? []}
            emptyLabel="No span-level trajectory overlays are available for this workflow yet."
          />
        </div>
      ) : null}

      {activeTab === "evidence" ? (
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <SectionCard title="Evidence Catalog" icon={<Files className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />}>
            <div className="space-y-4">
              {trace.evidence_catalog.map((evidence: any) => (
                <div key={evidence.evidence_id} className="rounded-xl border border-edge bg-surface/50 p-4">
                  <div className="text-sm font-medium text-content">{evidence.title}</div>
                  <p className="mt-2 text-sm leading-relaxed text-content-secondary">{evidence.summary}</p>
                  <SourceChips sourceRefs={evidence.source_refs} />
                  {evidence.supported_claims.length ? (
                    <div className="mt-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                        Supported claims
                      </div>
                      <div className="mt-2">
                        <BulletList items={evidence.supported_claims} />
                      </div>
                    </div>
                  ) : null}
                  {evidence.unsupported_claims.length ? (
                    <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-300">
                        Not established
                      </div>
                      <div className="mt-2">
                        <BulletList items={evidence.unsupported_claims} />
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Limitations" icon={<SearchCheck className="h-4 w-4 text-amber-600 dark:text-amber-300" />}>
            <BulletList items={trace.limitations} />
          </SectionCard>
        </div>
      ) : null}

      {activeTab === "diffs" ? (
        <div className="space-y-6">
          {trace.diffs.map((diff: any) => (
            <SectionCard key={diff.diff_id} title={diff.target} icon={<GitCompareArrows className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />}>
              <p className="text-sm leading-relaxed text-content-secondary">{diff.summary}</p>
              {diff.cell_changes.length ? (
                <div className="mt-4 overflow-hidden rounded-xl border border-edge">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="bg-surface-secondary text-content-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">Cell</th>
                        <th className="px-3 py-2 font-medium">Before</th>
                        <th className="px-3 py-2 font-medium">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.cell_changes.map((change: any) => (
                        <tr key={`${diff.diff_id}-${change.cell}`} className="border-t border-edge align-top">
                          <td className="px-3 py-2 font-mono text-xs text-content-muted">{change.cell}</td>
                          <td className="px-3 py-2 text-content-muted">{change.before ?? "blank"}</td>
                          <td className="px-3 py-2 text-content">{change.after ?? "blank"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {diff.structural_changes.length ? (
                <div className="mt-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                    Structural changes
                  </div>
                  <div className="mt-2">
                    <BulletList items={diff.structural_changes} />
                  </div>
                </div>
              ) : null}
            </SectionCard>
          ))}
        </div>
      ) : null}

      {activeTab === "verification" ? (
        <SectionCard title="Verification Loop" icon={<ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />}>
          <div className="space-y-4">
            {trace.verification_checks.map((check: any) => (
              <div key={check.check_id} className="rounded-xl border border-edge bg-surface/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-medium text-content">{check.label}</div>
                  <StatusBadge value={check.status} />
                </div>
                <p className="mt-2 text-sm leading-relaxed text-content-secondary">{check.details}</p>
                {check.related_artifact_ids.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {check.related_artifact_ids.map((artifactId: string) => (
                      <span
                        key={artifactId}
                        className="rounded-full border border-edge bg-surface-secondary/50 px-2 py-1 text-[11px] text-content-muted"
                      >
                        {artifactId}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {activeTab === "json" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard title="Typed Output" icon={<FileJson2 className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />}>
            <LazyCodeBlock code={formattedJson} language="json" />
          </SectionCard>
          <SectionCard title="Schema Contract" icon={<ClipboardCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />}>
            <LazyCodeBlock code={schemaJson} language="json" />
          </SectionCard>
        </div>
      ) : null}
    </div>
  );
}

export default ExecutionTraceView;
