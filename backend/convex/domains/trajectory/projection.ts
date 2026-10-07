import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  buildBenchmarkImprovementRatio,
  buildTrajectoryEntityKey,
  clampScore,
  computeTrajectoryScores,
  createTrajectoryWindow,
  getDefaultProductEntityKey,
  inferTrajectoryEntityLabel,
  normalizeTrajectoryEntityType,
  slugifyTrajectoryValue,
  summarizeAverageInterventionUplift,
  summarizeAverageVerdictConfidence,
  summarizeChecklistPassRate,
  summarizeDriftPressure,
  summarizeInterventionSuccessRatio,
  summarizePassRatio,
  summarizePositiveFeedbackRatio,
  summarizeTrustAmplification,
  type TrajectoryEntityType,
  type TrajectoryScoreBreakdown,
  type TrajectorySourceRef,
  type TrajectoryWindow,
} from "./lib";

type CtxLike = {
  db: any;
};

type TaskTelemetryBundle = {
  sessions: Doc<"agentTaskSessions">[];
  traces: Doc<"agentTaskTraces">[];
  spans: Doc<"agentTaskSpans">[];
};

type ProjectionEventShape = {
  spans: Array<{
    spanKey: string;
    parentSpanKey?: string;
    traceKey?: string;
    sessionKey?: string;
    spanType: string;
    name: string;
    status: string;
    summary: string;
    score?: number;
    evidenceCompletenessScore?: number;
    sourceRefs?: TrajectorySourceRef[];
    sourceRecordType: string;
    sourceRecordId: string;
    createdAt: number;
    updatedAt: number;
  }>;
  evidenceBundles: Array<{
    bundleKey: string;
    title: string;
    summary: string;
    bundleType: string;
    sourceRefs: TrajectorySourceRef[];
    sourceRecordType: string;
    sourceRecordId: string;
    createdAt: number;
    updatedAt: number;
  }>;
  verdicts: Array<{
    verdictKey: string;
    verdict: string;
    summary: string;
    confidence?: number;
    recommendation?: string;
    criteriaPassed?: number;
    criteriaTotal?: number;
    sourceRecordType: string;
    sourceRecordId: string;
    createdAt: number;
    updatedAt: number;
  }>;
  benchmarkRuns: Array<{
    benchmarkKey: string;
    benchmarkLabel: string;
    benchmarkFamily: string;
    verdict: string;
    summary: string;
    overallUplift?: number;
    deltaFromPrevious?: number;
    sourceRecordType: string;
    sourceRecordId: string;
    createdAt: number;
    updatedAt: number;
  }>;
};

type ProjectionBase = ProjectionEventShape & {
  entityKey: string;
  entityType: TrajectoryEntityType;
  label: string;
  description?: string;
  sourceBacklinks: Array<{
    sourceRecordType: string;
    sourceRecordId: string;
    label?: string;
  }>;
};

export type TrajectoryProjection = {
  entity: {
    entityKey: string;
    entityType: TrajectoryEntityType;
    label: string;
    description?: string;
    activePopulation: boolean;
    sourceBacklinks: Array<{
      sourceRecordType: string;
      sourceRecordId: string;
      label?: string;
    }>;
  };
  spans: ProjectionEventShape["spans"];
  evidenceBundles: ProjectionEventShape["evidenceBundles"];
  verdicts: ProjectionEventShape["verdicts"];
  benchmarkRuns: ProjectionEventShape["benchmarkRuns"];
  feedbackEvents: Doc<"trajectoryFeedbackEvents">[];
  interventionEvents: Doc<"trajectoryInterventionEvents">[];
  trustNodes: Doc<"trajectoryTrustNodes">[];
  trustEdges: Doc<"trajectoryTrustEdges">[];
  scoreBreakdown: TrajectoryScoreBreakdown;
  summary: {
    window: TrajectoryWindow;
    summary: string;
    narrative: string;
    nextReviewAt: number;
    spanCount: number;
    evidenceBundleCount: number;
    verdictCount: number;
    feedbackCount: number;
    interventionCount: number;
    benchmarkCount: number;
    trustNodeCount: number;
    trustEdgeCount: number;
    topInterventions: Array<{
      title: string;
      observedScoreDelta?: number;
      status: string;
    }>;
  };
};

type AuthScope = {
  userId: Id<"users"> | null;
};

function dedupeByKey<T>(items: T[], keyBuilder: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyBuilder(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stringSourceRefs(
  refs?: Array<{ label: string; href?: string; note?: string; kind?: string }> | null,
) {
  if (!refs?.length) return [];
  return refs.map((ref) => ({
    label: ref.label,
    href: ref.href,
    note: ref.note,
    kind: ref.kind,
  }));
}

function summarizeSpan(source: Doc<"agentTaskSpans">) {
  const metadata = source.metadata && typeof source.metadata === "object" ? source.metadata : null;
  const data = source.data && typeof source.data === "object" ? source.data : null;
  const summaryParts = [
    source.name,
    data && "resultSummary" in data && typeof data.resultSummary === "string" ? data.resultSummary : undefined,
    metadata && "summary" in metadata && typeof metadata.summary === "string" ? metadata.summary : undefined,
    source.error?.message,
  ].filter(Boolean) as string[];
  return summaryParts.slice(0, 2).join(" — ");
}

function summarizeRunStep(step: Doc<"runSteps">) {
  return [step.reason, step.resultSummary, step.errorMessage].filter(Boolean).join(" — ");
}

function buildChecklistSummary(pack: Doc<"proofPacks">) {
  const passed = pack.checklist.filter((item) => item.passed).length;
  return `${pack.summary} (${passed}/${pack.checklist.length} checks passed)`;
}

function dogfoodVerdict(run: Doc<"dogfoodQaRuns">) {
  const p0 = run.issues.filter((issue) => issue.severity === "p0").length;
  const p1 = run.issues.filter((issue) => issue.severity === "p1").length;
  if (p0 > 0) return "fail";
  if (p1 > 0 || run.issues.length > 0) return "watch";
  return "pass";
}

function buildDogfoodSummary(run: Doc<"dogfoodQaRuns">) {
  return `${run.summary} (${run.issues.length} issues captured during dogfood verification)`;
}

async function getAuthScope(ctx: CtxLike): Promise<AuthScope> {
  const rawUserId = await getAuthUserId(ctx as any);
  if (!rawUserId) return { userId: null };
  if (typeof rawUserId === "string" && rawUserId.includes("|")) {
    return { userId: rawUserId.split("|")[0] as Id<"users"> };
  }
  return { userId: rawUserId as Id<"users"> };
}

async function listVisibleRecentSessions(ctx: CtxLike, auth: AuthScope, window: TrajectoryWindow) {
  const publicSessions = await ctx.db
    .query("agentTaskSessions")
    .withIndex("by_visibility_date", (q: any) => q.eq("visibility", "public"))
    .order("desc")
    .take(60);

  const privateSessions = auth.userId
    ? await ctx.db
        .query("agentTaskSessions")
        .withIndex("by_user_date", (q: any) => q.eq("userId", auth.userId))
        .order("desc")
        .take(60)
    : [];

  return dedupeByKey<Doc<"agentTaskSessions">>(
    [...publicSessions, ...privateSessions].filter((session) => session.startedAt >= window.windowStart),
    (session) => String(session._id),
  );
}

async function loadTaskTelemetryForSessions(ctx: CtxLike, sessions: Doc<"agentTaskSessions">[]): Promise<TaskTelemetryBundle> {
  const traces = (
    await Promise.all(
      sessions.map((session) =>
        ctx.db
          .query("agentTaskTraces")
          .withIndex("by_session", (q: any) => q.eq("sessionId", session._id))
          .order("desc")
          .take(12),
      ),
    )
  ).flat();

  const spans = (
    await Promise.all(
      traces.map((trace) =>
        ctx.db
          .query("agentTaskSpans")
          .withIndex("by_trace", (q: any) => q.eq("traceId", trace._id))
          .order("asc")
          .take(80),
      ),
    )
  ).flat();

  return { sessions, traces, spans };
}

function buildProductProjection(
  telemetry: TaskTelemetryBundle,
  proofPacks: Doc<"proofPacks">[],
  judgeReviews: Doc<"judgeReviews">[],
  baselineComparisons: Doc<"baselineComparisons">[],
  canaryRuns: Doc<"canaryRuns">[],
  dogfoodRuns: Doc<"dogfoodQaRuns">[],
): ProjectionBase {
  const spans = telemetry.spans.map((span) => ({
    spanKey: `task-span:${String(span._id)}`,
    parentSpanKey: span.parentSpanId ? `task-span:${String(span.parentSpanId)}` : undefined,
    traceKey: `trace:${String(span.traceId)}`,
    spanType: span.spanType,
    name: span.name,
    status: span.status,
    summary: summarizeSpan(span),
    score: clampScore(span.status === "completed" ? 0.75 : span.status === "running" ? 0.5 : 0.2),
    evidenceCompletenessScore: clampScore(
      Array.isArray((span.metadata as any)?.sourceRefs)
        ? ((span.metadata as any).sourceRefs.length as number) / 4
        : 0.35,
    ),
    sourceRefs: stringSourceRefs((span.metadata as any)?.sourceRefs),
    sourceRecordType: "agentTaskSpan",
    sourceRecordId: String(span._id),
    createdAt: span.startedAt,
    updatedAt: span.endedAt ?? span.startedAt,
  }));

  const evidenceBundles = [
    ...telemetry.sessions
      .filter((session) => (session.sourceRefs?.length ?? 0) > 0)
      .map((session) => ({
        bundleKey: `session:${String(session._id)}`,
        title: session.title,
        summary: session.description ?? "Session evidence bundle",
        bundleType: "session_source_refs",
        sourceRefs: stringSourceRefs(session.sourceRefs),
        sourceRecordType: "agentTaskSession",
        sourceRecordId: String(session._id),
        createdAt: session.startedAt,
        updatedAt: session.completedAt ?? session.startedAt,
      })),
    ...telemetry.traces
      .filter((trace) => (trace.sourceRefs?.length ?? 0) > 0)
      .map((trace) => ({
        bundleKey: `trace:${String(trace._id)}`,
        title: trace.workflowName,
        summary: trace.deltaFromVision ?? "Trace evidence bundle",
        bundleType: "trace_source_refs",
        sourceRefs: stringSourceRefs(trace.sourceRefs),
        sourceRecordType: "agentTaskTrace",
        sourceRecordId: String(trace._id),
        createdAt: trace.startedAt,
        updatedAt: trace.endedAt ?? trace.startedAt,
      })),
    ...proofPacks.map((pack) => ({
      bundleKey: `proof-pack:${String(pack._id)}`,
      title: pack.packKey,
      summary: buildChecklistSummary(pack),
      bundleType: "proof_pack",
      sourceRefs: stringSourceRefs(pack.sourceRefs),
      sourceRecordType: "proofPack",
      sourceRecordId: String(pack._id),
      createdAt: pack.createdAt,
      updatedAt: pack.updatedAt,
    })),
  ];

  const verdicts = [
    ...judgeReviews.map((review) => {
      const criteriaValues = Object.values(review.criteria);
      return {
        verdictKey: `judge:${String(review._id)}`,
        verdict: review.verdict,
        summary: review.reasoning,
        confidence: review.compositeConfidence,
        recommendation: review.recommendation,
        criteriaPassed: criteriaValues.filter(Boolean).length,
        criteriaTotal: criteriaValues.length,
        sourceRecordType: "judgeReview",
        sourceRecordId: String(review._id),
        createdAt: review.createdAt,
        updatedAt: review.createdAt,
      };
    }),
    ...proofPacks.map((pack) => ({
      verdictKey: `proof-pack:${String(pack._id)}`,
      verdict: pack.status === "approved" || pack.status === "ready" ? "pass" : "watch",
      summary: buildChecklistSummary(pack),
      confidence: clampScore(pack.checklist.filter((item) => item.passed).length / Math.max(pack.checklist.length, 1)),
      recommendation: pack.status === "approved" ? "promote" : "review",
      criteriaPassed: pack.checklist.filter((item) => item.passed).length,
      criteriaTotal: pack.checklist.length,
      sourceRecordType: "proofPack",
      sourceRecordId: String(pack._id),
      createdAt: pack.createdAt,
      updatedAt: pack.updatedAt,
    })),
    ...dogfoodRuns.map((run) => ({
      verdictKey: `dogfood:${String(run._id)}`,
      verdict: dogfoodVerdict(run),
      summary: buildDogfoodSummary(run),
      confidence: clampScore(run.issues.length === 0 ? 0.95 : Math.max(0.2, 1 - run.issues.length * 0.08)),
      recommendation: run.issues.length === 0 ? "promote" : "retry",
      criteriaPassed: Math.max(0, 4 - run.issues.length),
      criteriaTotal: 4,
      sourceRecordType: "dogfoodQaRun",
      sourceRecordId: String(run._id),
      createdAt: run.createdAt,
      updatedAt: run.createdAt,
    })),
  ];

  const benchmarkRuns = [
    ...baselineComparisons.map((comparison) => ({
      benchmarkKey: `baseline:${String(comparison._id)}`,
      benchmarkLabel: `${comparison.baselineLabel} → ${comparison.enhancedLabel}`,
      benchmarkFamily: comparison.benchmarkFamily,
      verdict: comparison.verdict,
      summary: comparison.notes ?? `Overall uplift ${comparison.overallUplift.toFixed(2)}.`,
      overallUplift: clampScore(comparison.overallUplift),
      deltaFromPrevious: undefined,
      sourceRecordType: "baselineComparison",
      sourceRecordId: String(comparison._id),
      createdAt: comparison.createdAt,
      updatedAt: comparison.createdAt,
    })),
    ...canaryRuns.map((run) => ({
      benchmarkKey: `canary:${String(run._id)}`,
      benchmarkLabel: run.runKey,
      benchmarkFamily: "canary",
      verdict: run.verdict,
      summary: `${run.fixtureCount} fixtures, throughput ${run.throughputScore}, quality ${run.qualityScore}.`,
      overallUplift: typeof run.deltaFromPrevious === "number" ? clampScore((run.deltaFromPrevious + 1) / 2) : undefined,
      deltaFromPrevious: run.deltaFromPrevious,
      sourceRecordType: "canaryRun",
      sourceRecordId: String(run._id),
      createdAt: run.createdAt,
      updatedAt: run.createdAt,
    })),
  ];

  return {
    entityKey: getDefaultProductEntityKey(),
    entityType: "product" as const,
    label: "NodeBench AI",
    description: "Builder-facing trajectory for the whole product loop across Oracle, traces, and benchmarks.",
    spans,
    evidenceBundles,
    verdicts,
    benchmarkRuns,
    sourceBacklinks: dedupeByKey<ProjectionBase["sourceBacklinks"][number]>(
      [
        ...telemetry.sessions.map((session) => ({
          sourceRecordType: "agentTaskSession",
          sourceRecordId: String(session._id),
          label: session.title,
        })),
        ...baselineComparisons.map((comparison) => ({
          sourceRecordType: "baselineComparison",
          sourceRecordId: String(comparison._id),
          label: comparison.comparisonKey,
        })),
        ...canaryRuns.map((run) => ({
          sourceRecordType: "canaryRun",
          sourceRecordId: String(run._id),
          label: run.runKey,
        })),
      ],
      (item) => `${item.sourceRecordType}:${item.sourceRecordId}`,
    ),
  };
}

function buildWorkflowProjection(telemetry: TaskTelemetryBundle, workflowName: string): ProjectionBase {
  const entityType: TrajectoryEntityType = "workflow";
  const entityKey = buildTrajectoryEntityKey(entityType, workflowName);
  const workflowTraces = telemetry.traces.filter(
    (trace) => slugifyTrajectoryValue(trace.workflowName) === slugifyTrajectoryValue(workflowName),
  );
  const workflowTraceIds = new Set(workflowTraces.map((trace) => String(trace._id)));
  const workflowSessions = telemetry.sessions.filter((session) =>
    workflowTraces.some((trace) => String(trace.sessionId) === String(session._id)),
  );
  const spans = telemetry.spans
    .filter((span) => workflowTraceIds.has(String(span.traceId)))
    .map((span) => ({
      spanKey: `task-span:${String(span._id)}`,
      parentSpanKey: span.parentSpanId ? `task-span:${String(span.parentSpanId)}` : undefined,
      traceKey: `trace:${String(span.traceId)}`,
      sessionKey:
        workflowTraces.find((trace) => String(trace._id) === String(span.traceId))
          ? `session:${String(workflowTraces.find((trace) => String(trace._id) === String(span.traceId))!.sessionId)}`
          : undefined,
      spanType: span.spanType,
      name: span.name,
      status: span.status,
      summary: summarizeSpan(span),
      score: clampScore(span.status === "completed" ? 0.8 : span.status === "running" ? 0.5 : 0.15),
      evidenceCompletenessScore: clampScore(
        Array.isArray((span.metadata as any)?.sourceRefs)
          ? ((span.metadata as any).sourceRefs.length as number) / 4
          : 0.25,
      ),
      sourceRefs: stringSourceRefs((span.metadata as any)?.sourceRefs),
      sourceRecordType: "agentTaskSpan",
      sourceRecordId: String(span._id),
      createdAt: span.startedAt,
      updatedAt: span.endedAt ?? span.startedAt,
    }));

  return {
    entityKey,
    entityType,
    label: workflowName,
    description: `Trajectory for ${workflowName}.`,
    spans,
    evidenceBundles: workflowTraces
      .filter((trace) => (trace.sourceRefs?.length ?? 0) > 0)
      .map((trace) => ({
        bundleKey: `trace:${String(trace._id)}`,
        title: trace.workflowName,
        summary: trace.deltaFromVision ?? "Workflow evidence bundle",
        bundleType: "trace_source_refs",
        sourceRefs: stringSourceRefs(trace.sourceRefs),
        sourceRecordType: "agentTaskTrace",
        sourceRecordId: String(trace._id),
        createdAt: trace.startedAt,
        updatedAt: trace.endedAt ?? trace.startedAt,
      })),
    verdicts: workflowSessions.map((session) => ({
      verdictKey: `session:${String(session._id)}`,
      verdict: session.crossCheckStatus === "violated" ? "fail" : session.crossCheckStatus === "drifting" ? "watch" : "pass",
      summary: session.deltaFromVision ?? session.description ?? "Workflow session verdict",
      confidence: clampScore(session.crossCheckStatus === "aligned" ? 0.85 : session.crossCheckStatus === "drifting" ? 0.5 : 0.25),
      recommendation: session.crossCheckStatus === "violated" ? "retry" : "promote",
      sourceRecordType: "agentTaskSession",
      sourceRecordId: String(session._id),
      createdAt: session.startedAt,
      updatedAt: session.completedAt ?? session.startedAt,
    })),
    benchmarkRuns: [] as ProjectionEventShape["benchmarkRuns"],
    sourceBacklinks: dedupeByKey<ProjectionBase["sourceBacklinks"][number]>(
      workflowTraces.map((trace) => ({
        sourceRecordType: "agentTaskTrace",
        sourceRecordId: String(trace._id),
        label: trace.workflowName,
      })),
      (item) => `${item.sourceRecordType}:${item.sourceRecordId}`,
    ),
  };
}

async function buildMissionProjection(ctx: CtxLike, missionKey: string, window: TrajectoryWindow): Promise<ProjectionBase> {
  const missions = await ctx.db
    .query("missions")
    .withIndex("by_mission_key", (q: any) => q.eq("missionKey", missionKey))
    .collect();
  const recentMissions = missions.filter((mission) => mission.updatedAt >= window.windowStart);
  const runSteps = (
    await Promise.all(
      recentMissions.map((mission) =>
        ctx.db
          .query("runSteps")
          .withIndex("by_mission_created", (q: any) => q.eq("missionId", mission._id))
          .collect(),
      ),
    )
  ).flat();
  const reviews = (
    await Promise.all(
      recentMissions.map((mission) =>
        ctx.db
          .query("judgeReviews")
          .withIndex("by_mission_verdict", (q: any) => q.eq("missionId", mission._id))
          .collect(),
      ),
    )
  ).flat();

  return {
    entityKey: buildTrajectoryEntityKey("mission", missionKey),
    entityType: "mission" as const,
    label: recentMissions[0]?.title ?? inferTrajectoryEntityLabel(missionKey, "mission"),
    description: recentMissions[0]?.description,
    spans: runSteps.map((step) => ({
      spanKey: `run-step:${String(step._id)}`,
      spanType: "mission_step",
      name: `${step.stepNumber}. ${step.action}`,
      status: step.status,
      summary: summarizeRunStep(step),
      score: clampScore(step.status === "completed" ? 0.85 : step.status === "running" ? 0.55 : 0.2),
      evidenceCompletenessScore: clampScore((step.evidenceRefs?.length ?? 0) / 4),
      sourceRefs: stringSourceRefs(step.evidenceRefs),
      sourceRecordType: "runStep",
      sourceRecordId: String(step._id),
      createdAt: step.createdAt,
      updatedAt: step.createdAt,
    })),
    evidenceBundles: runSteps
      .filter((step) => (step.evidenceRefs?.length ?? 0) > 0)
      .map((step) => ({
        bundleKey: `run-step:${String(step._id)}`,
        title: `${step.action} evidence`,
        summary: summarizeRunStep(step),
        bundleType: "run_step_evidence",
        sourceRefs: stringSourceRefs(step.evidenceRefs),
        sourceRecordType: "runStep",
        sourceRecordId: String(step._id),
        createdAt: step.createdAt,
        updatedAt: step.createdAt,
      })),
    verdicts: reviews.map((review) => {
      const criteriaValues = Object.values(review.criteria);
      return {
        verdictKey: `judge:${String(review._id)}`,
        verdict: review.verdict,
        summary: review.reasoning,
        confidence: review.compositeConfidence,
        recommendation: review.recommendation,
        criteriaPassed: criteriaValues.filter(Boolean).length,
        criteriaTotal: criteriaValues.length,
        sourceRecordType: "judgeReview",
        sourceRecordId: String(review._id),
        createdAt: review.createdAt,
        updatedAt: review.createdAt,
      };
    }),
    benchmarkRuns: [] as ProjectionEventShape["benchmarkRuns"],
    sourceBacklinks: dedupeByKey<ProjectionBase["sourceBacklinks"][number]>(
      recentMissions.map((mission) => ({
        sourceRecordType: "mission",
        sourceRecordId: String(mission._id),
        label: mission.title,
      })),
      (item) => `${item.sourceRecordType}:${item.sourceRecordId}`,
    ),
  };
}

async function buildEntityProjection(ctx: CtxLike, entityKey: string, entityType: TrajectoryEntityType, window: TrajectoryWindow): Promise<ProjectionBase> {
  const observations = await ctx.db
    .query("timeSeriesObservations")
    .withIndex("by_entity_time", (q: any) => q.eq("entityKey", entityKey))
    .order("desc")
    .take(30);
  const signals = await ctx.db
    .query("timeSeriesSignals")
    .withIndex("by_entity_detected", (q: any) => q.eq("entityKey", entityKey))
    .order("desc")
    .take(20);
  const chains = await ctx.db
    .query("causalChains")
    .withIndex("by_entity_created", (q: any) => q.eq("entityKey", entityKey))
    .order("desc")
    .take(20);

  const recentObservations = observations.filter((observation) => observation.observedAt >= window.windowStart);
  const recentSignals = signals.filter((signal) => signal.detectedAt >= window.windowStart);
  const recentChains = chains.filter((chain) => chain.createdAt >= window.windowStart);

  return {
    entityKey,
    entityType,
    label: inferTrajectoryEntityLabel(entityKey, entityType),
    description: `Trajectory view for ${entityKey}.`,
    spans: recentSignals.map((signal) => ({
      spanKey: `signal:${String(signal._id)}`,
      spanType: signal.signalType,
      name: signal.summary,
      status: signal.status,
      summary: signal.plainEnglish,
      score: clampScore(signal.confidence),
      evidenceCompletenessScore: clampScore((signal.sourceRefs?.length ?? 0) / 4),
      sourceRefs: stringSourceRefs(signal.sourceRefs),
      sourceRecordType: "timeSeriesSignal",
      sourceRecordId: String(signal._id),
      createdAt: signal.detectedAt,
      updatedAt: signal.updatedAt,
    })),
    evidenceBundles: [
      ...recentObservations
        .filter((observation) => (observation.sourceRefs?.length ?? 0) > 0)
        .map((observation) => ({
          bundleKey: `observation:${String(observation._id)}`,
          title: observation.headline ?? observation.streamKey,
          summary: observation.summary ?? observation.sourceExcerpt ?? observation.valueText ?? "Observation evidence",
          bundleType: "observation",
          sourceRefs: stringSourceRefs(observation.sourceRefs),
          sourceRecordType: "timeSeriesObservation",
          sourceRecordId: String(observation._id),
          createdAt: observation.observedAt,
          updatedAt: observation.updatedAt,
        })),
      ...recentChains
        .filter((chain) => (chain.sourceRefs?.length ?? 0) > 0)
        .map((chain) => ({
          bundleKey: `chain:${String(chain._id)}`,
          title: chain.title,
          summary: chain.summary,
          bundleType: "causal_chain",
          sourceRefs: stringSourceRefs(chain.sourceRefs),
          sourceRecordType: "causalChain",
          sourceRecordId: String(chain._id),
          createdAt: chain.createdAt,
          updatedAt: chain.updatedAt,
        })),
    ],
    verdicts: recentChains.map((chain) => ({
      verdictKey: `chain:${String(chain._id)}`,
      verdict: chain.status === "validated" ? "pass" : chain.status === "contested" ? "fail" : "watch",
      summary: chain.plainEnglish,
      confidence: chain.status === "validated" ? 0.8 : chain.status === "contested" ? 0.3 : 0.55,
      recommendation: chain.status === "validated" ? "promote" : "review",
      sourceRecordType: "causalChain",
      sourceRecordId: String(chain._id),
      createdAt: chain.createdAt,
      updatedAt: chain.updatedAt,
    })),
    benchmarkRuns: [] as ProjectionEventShape["benchmarkRuns"],
    sourceBacklinks: dedupeByKey<ProjectionBase["sourceBacklinks"][number]>(
      [
        ...recentSignals.map((signal) => ({
          sourceRecordType: "timeSeriesSignal",
          sourceRecordId: String(signal._id),
          label: signal.summary,
        })),
        ...recentChains.map((chain) => ({
          sourceRecordType: "causalChain",
          sourceRecordId: String(chain._id),
          label: chain.title,
        })),
      ],
      (item) => `${item.sourceRecordType}:${item.sourceRecordId}`,
    ),
  };
}

async function loadTrajectoryEvents(
  ctx: CtxLike,
  entityType: TrajectoryEntityType,
  entityKey: string,
  window: TrajectoryWindow,
) {
  const [feedbackEvents, interventionEvents, trustNodes, trustEdges] = await Promise.all([
    ctx.db
      .query("trajectoryFeedbackEvents")
      .withIndex("by_entity_observed", (q: any) => q.eq("entityType", entityType).eq("entityKey", entityKey))
      .order("desc")
      .take(30),
    ctx.db
      .query("trajectoryInterventionEvents")
      .withIndex("by_entity_created", (q: any) => q.eq("entityType", entityType).eq("entityKey", entityKey))
      .order("desc")
      .take(20),
    ctx.db
      .query("trajectoryTrustNodes")
      .withIndex("by_entity_created", (q: any) => q.eq("entityType", entityType).eq("entityKey", entityKey))
      .order("desc")
      .take(20),
    ctx.db
      .query("trajectoryTrustEdges")
      .withIndex("by_entity_created", (q: any) => q.eq("entityType", entityType).eq("entityKey", entityKey))
      .order("desc")
      .take(20),
  ]);

  return {
    feedbackEvents: feedbackEvents.filter((event) => event.observedAt >= window.windowStart),
    interventionEvents: interventionEvents.filter((event) => event.createdAt >= window.windowStart),
    trustNodes,
    trustEdges,
  };
}

function buildProjectionSummary(input: {
  entityLabel: string;
  scoreBreakdown: TrajectoryScoreBreakdown;
  spans: ProjectionEventShape["spans"];
  evidenceBundles: ProjectionEventShape["evidenceBundles"];
  verdicts: ProjectionEventShape["verdicts"];
  feedbackEvents: Doc<"trajectoryFeedbackEvents">[];
  interventionEvents: Doc<"trajectoryInterventionEvents">[];
  benchmarkRuns: ProjectionEventShape["benchmarkRuns"];
  trustNodes: Doc<"trajectoryTrustNodes">[];
  trustEdges: Doc<"trajectoryTrustEdges">[];
  window: TrajectoryWindow;
}) {
  const topInterventions = [...input.interventionEvents]
    .sort(
      (a, b) =>
        (b.observedScoreDelta ?? b.expectedScoreDelta ?? 0) -
        (a.observedScoreDelta ?? a.expectedScoreDelta ?? 0),
    )
    .slice(0, 3)
    .map((event) => ({
      title: event.title,
      observedScoreDelta: event.observedScoreDelta,
      status: event.status,
    }));

  const summary = `${input.entityLabel} is ${input.scoreBreakdown.trustAdjustedCompounding.label}. ${input.spans.length} spans, ${input.evidenceBundles.length} evidence bundles, and ${input.benchmarkRuns.length} benchmark runs are in the current window.`;
  const narrative =
    input.scoreBreakdown.drift.score >= 0.55
      ? `Drift pressure is elevated. The strongest operator move is to address ${topInterventions[0]?.title ?? "the current bottleneck"} before expanding scope.`
      : `Compounding is driven by ${topInterventions[0]?.title ?? "repeated evidence-backed execution"} with trust-adjusted score ${input.scoreBreakdown.trustAdjustedCompounding.score.toFixed(2)}.`;

  return {
    summary,
    narrative,
    nextReviewAt: input.window.windowEnd + 7 * 24 * 60 * 60 * 1000,
    spanCount: input.spans.length,
    evidenceBundleCount: input.evidenceBundles.length,
    verdictCount: input.verdicts.length,
    feedbackCount: input.feedbackEvents.length,
    interventionCount: input.interventionEvents.length,
    benchmarkCount: input.benchmarkRuns.length,
    trustNodeCount: input.trustNodes.length,
    trustEdgeCount: input.trustEdges.length,
    topInterventions,
  };
}

export async function buildTrajectoryProjection(
  ctx: CtxLike,
  args: {
    entityKey: string;
    entityType: TrajectoryEntityType;
    windowDays?: number | null;
  },
): Promise<TrajectoryProjection> {
  const window = createTrajectoryWindow(args.windowDays);
  const auth = await getAuthScope(ctx);

  const telemetrySessions = await listVisibleRecentSessions(ctx, auth, window);
  const telemetry = await loadTaskTelemetryForSessions(ctx, telemetrySessions);

  const proofPacks = await ctx.db.query("proofPacks").order("desc").take(30);
  const baselineComparisons = await ctx.db
    .query("baselineComparisons")
    .order("desc")
    .take(20);
  const canaryRuns = await ctx.db.query("canaryRuns").order("desc").take(20);
  const dogfoodRuns = await ctx.db.query("dogfoodQaRuns").order("desc").take(12);
  const judgeReviews = await ctx.db.query("judgeReviews").order("desc").take(20);

  let projected: ProjectionBase;

  if (args.entityType === "product" && args.entityKey === getDefaultProductEntityKey()) {
    projected = buildProductProjection(
      telemetry,
      proofPacks.filter((pack) => pack.createdAt >= window.windowStart),
      judgeReviews.filter((review) => review.createdAt >= window.windowStart),
      baselineComparisons.filter((comparison) => comparison.createdAt >= window.windowStart),
      canaryRuns.filter((run) => run.createdAt >= window.windowStart),
      dogfoodRuns.filter((run) => run.createdAt >= window.windowStart),
    );
  } else if (args.entityType === "workflow") {
    projected = buildWorkflowProjection(telemetry, inferTrajectoryEntityLabel(args.entityKey, "workflow"));
  } else if (args.entityType === "mission") {
    projected = await buildMissionProjection(ctx, inferTrajectoryEntityLabel(args.entityKey, "mission"), window);
  } else {
    projected = await buildEntityProjection(ctx, args.entityKey, args.entityType, window);
  }

  const events = await loadTrajectoryEvents(ctx, projected.entityType, projected.entityKey, window);

  const scoreInputs = {
    spanCount: projected.spans.length,
    completedSpanRatio:
      projected.spans.length > 0
        ? projected.spans.filter((span) => span.status === "completed").length / projected.spans.length
        : 0,
    errorSpanRatio:
      projected.spans.length > 0
        ? projected.spans.filter((span) => span.status === "error" || span.status === "failed").length / projected.spans.length
        : 0,
    averageVerdictConfidence: summarizeAverageVerdictConfidence(projected.verdicts),
    verdictPassRatio: summarizePassRatio(projected.verdicts),
    evidenceBundleCount: projected.evidenceBundles.length,
    sourceRefCount: projected.evidenceBundles.reduce((sum, bundle) => sum + bundle.sourceRefs.length, 0),
    checklistPassRatio: summarizeChecklistPassRate(
      proofPacks
        .filter((pack) => pack.createdAt >= window.windowStart)
        .map((pack) => pack.checklist),
    ),
    feedbackPositiveRatio: summarizePositiveFeedbackRatio(events.feedbackEvents),
    benchmarkImprovementRatio: buildBenchmarkImprovementRatio(projected.benchmarkRuns),
    interventionCount: events.interventionEvents.length,
    interventionSuccessRatio: summarizeInterventionSuccessRatio(events.interventionEvents),
    averageInterventionUplift: summarizeAverageInterventionUplift(events.interventionEvents),
    trustAmplification: summarizeTrustAmplification(events.trustEdges),
    driftPressure: summarizeDriftPressure({
      violatedLoops: telemetry.sessions.filter((session) => session.crossCheckStatus === "violated").length,
      driftingLoops: telemetry.sessions.filter((session) => session.crossCheckStatus === "drifting").length,
      totalLoops: Math.max(telemetry.sessions.length, 1),
      failedBenchmarks: projected.benchmarkRuns.filter((run) => run.verdict === "regressed" || run.verdict === "regression").length,
      negativeFeedbackCount: events.feedbackEvents.filter((event) => {
        if (typeof event.scoreDelta === "number") return event.scoreDelta < 0;
        return event.status === "negative" || event.status === "rejected" || event.status === "contradicted";
      }).length,
    }),
  };

  const scoreBreakdown = computeTrajectoryScores(scoreInputs);
  const summary = buildProjectionSummary({
    entityLabel: projected.label,
    scoreBreakdown,
    spans: projected.spans,
    evidenceBundles: projected.evidenceBundles,
    verdicts: projected.verdicts,
    feedbackEvents: events.feedbackEvents,
    interventionEvents: events.interventionEvents,
    benchmarkRuns: projected.benchmarkRuns,
    trustNodes: events.trustNodes,
    trustEdges: events.trustEdges,
    window,
  });

  return {
    entity: {
      entityKey: projected.entityKey,
      entityType: projected.entityType,
      label: projected.label,
      description: projected.description,
      activePopulation:
        projected.entityType === "workflow" ||
        projected.entityType === "agent" ||
        projected.entityType === "mission" ||
        projected.entityType === "product",
      sourceBacklinks: projected.sourceBacklinks,
    },
    spans: projected.spans,
    evidenceBundles: projected.evidenceBundles,
    verdicts: projected.verdicts,
    benchmarkRuns: projected.benchmarkRuns,
    feedbackEvents: events.feedbackEvents,
    interventionEvents: events.interventionEvents,
    trustNodes: events.trustNodes,
    trustEdges: events.trustEdges,
    scoreBreakdown,
    summary: {
      window,
      ...summary,
    },
  };
}

export async function loadPersistedTrajectoryState(
  ctx: CtxLike,
  entityKey: string,
  entityType: TrajectoryEntityType,
  windowDays: number,
) {
  const [entity, summary, score, spans, verdicts, feedbackEvents, interventions, benchmarkRuns] =
    await Promise.all([
      ctx.db
        .query("trajectoryEntities")
        .withIndex("by_entity", (q: any) => q.eq("entityType", entityType).eq("entityKey", entityKey))
        .unique(),
      ctx.db
        .query("trajectorySummaries")
        .withIndex("by_entity_window", (q: any) => q.eq("entityType", entityType).eq("entityKey", entityKey).eq("windowDays", windowDays))
        .unique(),
      ctx.db
        .query("trajectoryCompoundingScores")
        .withIndex("by_entity_window", (q: any) => q.eq("entityType", entityType).eq("entityKey", entityKey).eq("windowDays", windowDays))
        .unique(),
      ctx.db
        .query("trajectorySpans")
        .withIndex("by_entity_created", (q: any) => q.eq("entityType", entityType).eq("entityKey", entityKey))
        .order("desc")
        .take(20),
      ctx.db
        .query("trajectoryJudgeVerdicts")
        .withIndex("by_entity_created", (q: any) => q.eq("entityType", entityType).eq("entityKey", entityKey))
        .order("desc")
        .take(12),
      ctx.db
        .query("trajectoryFeedbackEvents")
        .withIndex("by_entity_observed", (q: any) => q.eq("entityType", entityType).eq("entityKey", entityKey))
        .order("desc")
        .take(12),
      ctx.db
        .query("trajectoryInterventionEvents")
        .withIndex("by_entity_created", (q: any) => q.eq("entityType", entityType).eq("entityKey", entityKey))
        .order("desc")
        .take(8),
      ctx.db
        .query("trajectoryBenchmarkRuns")
        .withIndex("by_entity_created", (q: any) => q.eq("entityType", entityType).eq("entityKey", entityKey))
        .order("desc")
        .take(8),
    ]);

  return { entity, summary, score, spans, verdicts, feedbackEvents, interventions, benchmarkRuns };
}

export function normalizeTrajectoryArgs(args: {
  entityKey: string;
  entityType: string;
  windowDays?: number | null;
}) {
  const entityType = normalizeTrajectoryEntityType(args.entityType);
  const entityKey =
    args.entityKey === "nodebench-ai" && entityType === "product"
      ? getDefaultProductEntityKey()
      : args.entityKey.includes(":")
        ? args.entityKey
        : buildTrajectoryEntityKey(entityType, args.entityKey);
  return {
    entityKey,
    entityType,
    windowDays: createTrajectoryWindow(args.windowDays).windowDays,
  };
}
