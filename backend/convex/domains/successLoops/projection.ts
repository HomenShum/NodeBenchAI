import type { Doc, Id } from "../../_generated/dataModel";
import {
  buildCurrentState,
  buildLoopId,
  buildMetricValue,
  clampLoopScore,
  computeLoopHealth,
  defaultNextRecommendedAction,
  formatCount,
  formatDurationMinutes,
  formatPercent,
  getLoopDefinition,
  mean,
  type SuccessLoopCard,
  type SuccessLoopDefinition,
  type SuccessLoopHealth,
  type SuccessLoopMetricValue,
} from "./lib";

type CtxLike = {
  db: any;
};

type ScopedSourceData = {
  sessions: Doc<"agentTaskSessions">[];
  traces: Doc<"agentTaskTraces">[];
  agentResponseReviews: Doc<"agentResponseReviews">[];
  dogfoodRuns: Doc<"dogfoodQaRuns">[];
  benchmarkRuns: Doc<"benchmarkRuns">[];
  workbenchRuns: Doc<"workbenchRuns">[];
  publishingTasks: Doc<"publishingTasks">[];
  engagementEvents: Doc<"engagementEvents">[];
  distributionDriftSnapshots: Doc<"distributionDriftSnapshots">[];
  successLoopEvents: Doc<"successLoopEvents">[];
  successLoopExperiments: Doc<"successLoopExperiments">[];
  frozenDecisions: Doc<"frozenDecisions">[];
  successOutcomeLinks: Doc<"successOutcomeLinks">[];
  registryRows: Doc<"successLoopRegistry">[];
  trajectoryScore: Doc<"trajectoryCompoundingScores"> | null;
};

const DAY_MS = 86_400_000;
const PRODUCT_ENTITY_KEY = "product:nodebench-ai";
const PRODUCT_ENTITY_TYPE = "product";

function countDistinct(values: Array<string | undefined | null>) {
  return new Set(values.filter((value): value is string => Boolean(value))).size;
}

function safeRatio(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function dedupeLatestReviewsByMessage(rows: Doc<"agentResponseReviews">[]) {
  const seen = new Set<string>();
  return rows
    .slice()
    .sort((a, b) => b.reviewedAt - a.reviewedAt)
    .filter((row) => {
      const key = String(row.messageId);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function buildResponseReviewStats(rows: Doc<"agentResponseReviews">[], last30d: number) {
  const latestRows = dedupeLatestReviewsByMessage(rows);
  const latest30d = latestRows.filter((row) => row.reviewedAt >= last30d);
  const passCount = latest30d.filter((row) => row.status === "pass").length;
  const watchCount = latest30d.filter((row) => row.status === "watch").length;
  const failCount = latest30d.filter((row) => row.status === "fail").length;
  const weakCount = watchCount + failCount;

  const passThreads = latest30d
    .filter((row) => row.status === "pass")
    .reduce((map, row) => {
      const key = String(row.threadId);
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>());
  const repeatPassThreadCount = (Array.from(passThreads.values()) as number[]).filter((count) => count >= 2).length;

  const earliestReview = rows.slice().sort((a, b) => a.reviewedAt - b.reviewedAt)[0];
  const earliestPassingReview = rows
    .filter((row) => row.status === "pass")
    .slice()
    .sort((a, b) => a.reviewedAt - b.reviewedAt)[0];
  const timeToFirstValueMinutes =
    earliestReview && earliestPassingReview
      ? Math.max(0, (earliestPassingReview.reviewedAt - earliestReview.reviewedAt) / 60_000)
      : undefined;

  let rejudgedCount = 0;
  let improvedRejudges = 0;
  let regressedRejudges = 0;
  const positiveDeltas: number[] = [];
  const improvementTimesHours: number[] = [];

  const rowsByMessage = rows.reduce((map, row) => {
    const key = String(row.messageId);
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      map.set(key, [row]);
    }
    return map;
  }, new Map<string, Doc<"agentResponseReviews">[]>());

  for (const messageRows of rowsByMessage.values()) {
    const sorted = messageRows.slice().sort((a, b) => a.reviewedAt - b.reviewedAt);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (current.reviewMode !== "rejudge") {
        continue;
      }

      rejudgedCount += 1;
      const delta = current.overallScore - previous.overallScore;
      if (delta >= 0.05) {
        improvedRejudges += 1;
        positiveDeltas.push(delta);
      } else if (delta <= -0.05) {
        regressedRejudges += 1;
      }

      if (previous.status !== "pass" && current.status === "pass") {
        improvementTimesHours.push(Math.max(0, (current.reviewedAt - previous.reviewedAt) / 3_600_000));
      }
    }
  }

  return {
    totalLatestReviews: latest30d.length,
    passCount,
    watchCount,
    failCount,
    weakCount,
    passRate: safeRatio(passCount, Math.max(1, latest30d.length)),
    repeatPassThreadCount,
    timeToFirstValueMinutes,
    rejudgedCount,
    improvedRejudges,
    regressedRejudges,
    improvedRejudgeRate: safeRatio(improvedRejudges, Math.max(1, rejudgedCount)),
    regressedRejudgeRate: safeRatio(regressedRejudges, Math.max(1, rejudgedCount)),
    averagePositiveDelta: mean(positiveDeltas),
    averageTimeToFixHours: mean(improvementTimesHours),
  };
}

function cadenceToMs(cadence: string) {
  if (cadence === "daily") return DAY_MS;
  if (cadence === "weekly") return 7 * DAY_MS;
  if (cadence === "monthly") return 30 * DAY_MS;
  return 7 * DAY_MS;
}

async function loadRecentAgentResponseReviews(ctx: CtxLike, userId: Id<"users"> | null) {
  if (userId) {
    return ctx.db
      .query("agentResponseReviews")
      .withIndex("by_user_reviewed", (q: any) => q.eq("userId", userId))
      .order("desc")
      .take(180);
  }

  const [passRows, watchRows, failRows] = await Promise.all([
    ctx.db
      .query("agentResponseReviews")
      .withIndex("by_status_reviewed", (q: any) => q.eq("status", "pass"))
      .order("desc")
      .take(70),
    ctx.db
      .query("agentResponseReviews")
      .withIndex("by_status_reviewed", (q: any) => q.eq("status", "watch"))
      .order("desc")
      .take(70),
    ctx.db
      .query("agentResponseReviews")
      .withIndex("by_status_reviewed", (q: any) => q.eq("status", "fail"))
      .order("desc")
      .take(70),
  ]);

  return [...passRows, ...watchRows, ...failRows]
    .sort((a, b) => b.reviewedAt - a.reviewedAt)
    .slice(0, 180);
}

function scoreHigher(value: number, target: number) {
  return clampLoopScore(target <= 0 ? 0 : value / target);
}

function scoreLower(value: number, maxAcceptable: number) {
  return clampLoopScore(1 - Math.min(1, maxAcceptable <= 0 ? 1 : value / maxAcceptable));
}

function findEventCount(events: Doc<"successLoopEvents">[], eventType: string) {
  return events.filter((event) => event.eventType === eventType).length;
}

function findLatestOutcomeVerdict(
  links: Doc<"successOutcomeLinks">[],
  decisionKey: string,
) {
  return links
    .filter((link) => link.decisionKey === decisionKey)
    .sort((a, b) => b.observedAt - a.observedAt)[0]?.comparisonVerdict;
}

function buildLoopCard(input: {
  definition: SuccessLoopDefinition;
  leadingMetrics: SuccessLoopMetricValue[];
  laggingMetrics: SuccessLoopMetricValue[];
  gaps: string[];
  registryRow?: Doc<"successLoopRegistry">;
  now: number;
}): SuccessLoopCard {
  const health = computeLoopHealth({
    leadingMetrics: input.leadingMetrics,
    laggingMetrics: input.laggingMetrics,
    gaps: input.gaps,
  });
  const registryRow = input.registryRow;
  return {
    loopId:
      registryRow?.loopId ??
      buildLoopId(input.definition.loopType, PRODUCT_ENTITY_TYPE, PRODUCT_ENTITY_KEY),
    loopType: input.definition.loopType,
    title: input.definition.title,
    goal: registryRow?.goal ?? input.definition.goal,
    owner: registryRow?.owner ?? input.definition.owner,
    reviewCadence: registryRow?.reviewCadence ?? input.definition.reviewCadence,
    currentState:
      registryRow?.currentState ??
      buildCurrentState({
        title: input.definition.title,
        leadingMetrics: input.leadingMetrics,
        laggingMetrics: input.laggingMetrics,
        gaps: input.gaps,
        status: health.status,
      }),
    status: registryRow?.status ?? health.status,
    score: registryRow?.score ?? health.score,
    leadingMetrics: input.leadingMetrics,
    laggingMetrics: input.laggingMetrics,
    interventionTypes: registryRow?.interventionTypes ?? input.definition.interventionTypes,
    lastReviewAt: registryRow?.lastReviewAt,
    nextReviewAt:
      registryRow?.nextReviewAt ?? input.now + cadenceToMs(input.definition.reviewCadence),
    gaps: input.gaps,
  };
}

async function loadRecentTraces(ctx: CtxLike, sessions: Doc<"agentTaskSessions">[]) {
  return (
    await Promise.all(
      sessions.slice(0, 40).map((session) =>
        ctx.db
          .query("agentTaskTraces")
          .withIndex("by_session", (q: any) => q.eq("sessionId", session._id))
          .order("desc")
          .take(6),
      ),
    )
  ).flat();
}

async function loadIntegrationCount(ctx: CtxLike, userId: Id<"users"> | null) {
  if (!userId) return 0;
  const [google, slack, github, notion, linkedin] = await Promise.all([
    ctx.db
      .query("googleAccounts")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .take(1),
    ctx.db
      .query("slackAccounts")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .take(1),
    ctx.db
      .query("githubAccounts")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .take(1),
    ctx.db
      .query("notionAccounts")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .take(1),
    ctx.db
      .query("linkedinAccounts")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .take(1),
  ]);

  return [google, slack, github, notion, linkedin].filter((rows) => rows.length > 0).length;
}

async function loadScopedSourceData(ctx: CtxLike, userId: Id<"users"> | null): Promise<ScopedSourceData> {
  const sessions = userId
    ? await ctx.db
        .query("agentTaskSessions")
        .withIndex("by_user_date", (q: any) => q.eq("userId", userId))
        .order("desc")
        .take(80)
    : await ctx.db
        .query("agentTaskSessions")
        .withIndex("by_visibility_date", (q: any) => q.eq("visibility", "public"))
        .order("desc")
        .take(80);

  const [traces, agentResponseReviews, dogfoodRuns, benchmarkRuns, workbenchRuns, publishingTasks, engagementEvents, driftSnapshots, loopEvents, experiments, frozenDecisions, outcomeLinks, registryRows, trajectoryScore] =
    await Promise.all([
      loadRecentTraces(ctx, sessions),
      loadRecentAgentResponseReviews(ctx, userId),
      userId
        ? ctx.db
            .query("dogfoodQaRuns")
            .withIndex("by_user_createdAt", (q: any) => q.eq("userId", userId))
            .order("desc")
            .take(24)
        : ctx.db.query("dogfoodQaRuns").withIndex("by_createdAt").order("desc").take(24),
      ctx.db.query("benchmarkRuns").withIndex("by_started").order("desc").take(30),
      ctx.db.query("workbenchRuns").withIndex("by_started").order("desc").take(30),
      ctx.db.query("publishingTasks").withIndex("by_created").order("desc").take(40),
      userId
        ? ctx.db
            .query("engagementEvents")
            .withIndex("by_user_time", (q: any) => q.eq("userId", userId))
            .order("desc")
            .take(160)
        : ctx.db.query("engagementEvents").order("desc").take(160),
      ctx.db.query("distributionDriftSnapshots").order("desc").take(40),
      ctx.db
        .query("successLoopEvents")
        .withIndex("by_entity_observed", (q: any) => q.eq("entityType", PRODUCT_ENTITY_TYPE).eq("entityKey", PRODUCT_ENTITY_KEY))
        .order("desc")
        .take(160),
      ctx.db
        .query("successLoopExperiments")
        .withIndex("by_entity_created", (q: any) => q.eq("entityType", PRODUCT_ENTITY_TYPE).eq("entityKey", PRODUCT_ENTITY_KEY))
        .order("desc")
        .take(40),
      ctx.db
        .query("frozenDecisions")
        .withIndex("by_entity_created", (q: any) => q.eq("entityType", PRODUCT_ENTITY_TYPE).eq("entityKey", PRODUCT_ENTITY_KEY))
        .order("desc")
        .take(40),
      ctx.db
        .query("successOutcomeLinks")
        .withIndex("by_entity_observed", (q: any) => q.eq("entityType", PRODUCT_ENTITY_TYPE).eq("entityKey", PRODUCT_ENTITY_KEY))
        .order("desc")
        .take(40),
      ctx.db.query("successLoopRegistry").collect(),
      ctx.db
        .query("trajectoryCompoundingScores")
        .withIndex("by_entity_window", (q: any) =>
          q.eq("entityType", PRODUCT_ENTITY_TYPE).eq("entityKey", PRODUCT_ENTITY_KEY).eq("windowDays", 90),
        )
        .first(),
    ]);

  return {
    sessions,
    traces,
    agentResponseReviews,
    dogfoodRuns,
    benchmarkRuns,
    workbenchRuns,
    publishingTasks,
    engagementEvents,
    distributionDriftSnapshots: driftSnapshots,
    successLoopEvents: loopEvents,
    successLoopExperiments: experiments,
    frozenDecisions,
    successOutcomeLinks: outcomeLinks,
    registryRows,
    trajectoryScore,
  };
}

export async function buildSuccessLoopsDashboardSnapshot(ctx: CtxLike, userId: Id<"users"> | null) {
  const now = Date.now();
  const last7d = now - 7 * DAY_MS;
  const last30d = now - 30 * DAY_MS;
  const prev7d = now - 14 * DAY_MS;
  const scoped = await loadScopedSourceData(ctx, userId);
  const integrationsConnected = await loadIntegrationCount(ctx, userId);
  const registryByType = new Map(scoped.registryRows.map((row) => [row.loopType, row]));

  const sessions7d = scoped.sessions.filter((session) => session.startedAt >= last7d);
  const sessions30d = scoped.sessions.filter((session) => session.startedAt >= last30d);
  const sessionsPrev7d = scoped.sessions.filter(
    (session) => session.startedAt >= prev7d && session.startedAt < last7d,
  );
  const completed30d = sessions30d.filter((session) => session.status === "completed");
  const failed30d = sessions30d.filter((session) => session.status === "failed");
  const alignedCompleted30d = completed30d.filter(
    (session) => session.crossCheckStatus === "aligned" || !session.crossCheckStatus,
  );
  const workflowNames30d = scoped.traces
    .filter((trace) => trace.startedAt >= last30d)
    .map((trace) => trace.workflowName);
  const distinctWorkflowCount30d = countDistinct(workflowNames30d);
  const distinctWorkflowCount7d = countDistinct(
    scoped.traces.filter((trace) => trace.startedAt >= last7d).map((trace) => trace.workflowName),
  );
  const repeatedWorkflowCount30d = Array.from<[string, number]>(
    workflowNames30d.reduce((map, workflowName) => {
      map.set(workflowName, (map.get(workflowName) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  ).filter(([, count]) => count >= 2).length;

  const dogfood30d = scoped.dogfoodRuns.filter((run) => run.createdAt >= last30d);
  const dogfoodIssuePressure = dogfood30d.reduce((sum, run) => {
    return (
      sum +
      run.issues.filter((issue) => issue.severity === "p0").length * 2 +
      run.issues.filter((issue) => issue.severity === "p1").length
    );
  }, 0);
  const benchmark30d = scoped.benchmarkRuns.filter((run) => run.startedAt >= last30d);
  const benchmarkPassRate = safeRatio(
    benchmark30d.reduce((sum, run) => sum + run.passedTasks, 0),
    benchmark30d.reduce((sum, run) => sum + run.totalTasks, 0),
  );
  const workbench30d = scoped.workbenchRuns.filter((run) => run.startedAt >= last30d);
  const publishing30d = scoped.publishingTasks.filter((task) => task.createdAt >= last30d);
  const completedPublishing30d = publishing30d.filter(
    (task) => task.status === "completed" || task.status === "partial",
  );
  const engagement30d = scoped.engagementEvents.filter((event) => event.timestamp >= last30d);
  const clickRate30d = safeRatio(
    engagement30d.filter((event) => event.eventType === "clicked").length,
    engagement30d.length,
  );
  const shareRate30d = safeRatio(
    engagement30d.filter((event) => event.eventType === "shared").length,
    engagement30d.length,
  );
  const dismissRate30d = safeRatio(
    engagement30d.filter((event) => event.eventType === "dismissed").length,
    engagement30d.length,
  );
  const drift30d = scoped.distributionDriftSnapshots.filter((snapshot) => snapshot.snapshotDate >= last30d);
  const avgDriftScore = mean(
    drift30d
      .map((snapshot) => (typeof snapshot.driftScore === "number" ? snapshot.driftScore / 100 : 0))
      .filter((value) => Number.isFinite(value)),
  );
  const significantDriftCount = drift30d.filter((snapshot) => snapshot.significantDrift).length;
  const responseReviewStats = buildResponseReviewStats(scoped.agentResponseReviews, last30d);

  const acceptedOutputCount = findEventCount(scoped.successLoopEvents, "accepted_output");
  const artifactReuseCount = findEventCount(scoped.successLoopEvents, "artifact_reuse");
  const qualifiedInboundCount = findEventCount(scoped.successLoopEvents, "qualified_inbound");
  const pipelineCreatedCount = findEventCount(scoped.successLoopEvents, "pipeline_created");
  const pilotStartedCount = findEventCount(scoped.successLoopEvents, "pilot_started");
  const expansionSignalCount = findEventCount(scoped.successLoopEvents, "expansion_signal");
  const lostDealCount = findEventCount(scoped.successLoopEvents, "lost_deal");
  const proofTouchCount = findEventCount(scoped.successLoopEvents, "proof_touch");
  const teamInviteCount = findEventCount(scoped.successLoopEvents, "team_invite");
  const editRequestedCount = findEventCount(scoped.successLoopEvents, "edit_requested");
  const reopenCount = findEventCount(scoped.successLoopEvents, "reopen");
  const escalationCount = findEventCount(scoped.successLoopEvents, "escalated");
  const marketSignalCount = findEventCount(scoped.successLoopEvents, "market_signal");

  const firstSession = scoped.sessions.slice().sort((a, b) => a.startedAt - b.startedAt)[0];
  const firstValueSession = scoped.sessions
    .filter(
      (session) =>
        session.status === "completed" &&
        (session.crossCheckStatus === "aligned" ||
          Boolean(session.dogfoodRunId) ||
          (session.sourceRefs?.length ?? 0) > 0),
    )
    .slice()
    .sort((a, b) => a.startedAt - b.startedAt)[0];

  const timeToFirstRunMinutes = firstSession ? 0 : 0;
  const timeToFirstValueMinutes =
    firstSession && firstValueSession
      ? Math.max(0, (firstValueSession.startedAt - firstSession.startedAt) / 60_000)
      : undefined;
  const derivedTimeToFirstValueMinutes =
    typeof timeToFirstValueMinutes === "number" && typeof responseReviewStats.timeToFirstValueMinutes === "number"
      ? Math.min(timeToFirstValueMinutes, responseReviewStats.timeToFirstValueMinutes)
      : timeToFirstValueMinutes ?? responseReviewStats.timeToFirstValueMinutes;
  const firstWeekDogfoodCompletion =
    firstSession && dogfood30d.some((run) => run.createdAt <= firstSession.startedAt + 7 * DAY_MS)
      ? 1
      : 0;
  const setupFriction = safeRatio(
    scoped.sessions
      .slice()
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(0, 3)
      .filter((session) => session.status === "failed" || session.crossCheckStatus === "violated").length,
    3,
  );

  const distinctSessionUsers = countDistinct(scoped.sessions.map((session) => String(session.userId ?? "")));
  const activatedAccounts = userId ? (completed30d.length > 0 ? 1 : 0) : Math.max(1, distinctSessionUsers);
  const secondSessionRate = userId
    ? scoped.sessions.length >= 2
      ? 1
      : 0
    : safeRatio(
        countDistinct(
          Array.from<[string, number]>(
            scoped.sessions.reduce((map, session) => {
              const key = String(session.userId ?? "public");
              map.set(key, (map.get(key) ?? 0) + 1);
              return map;
            }, new Map<string, number>()),
          )
            .filter(([, count]) => count >= 2)
            .map(([key]) => key),
        ),
        Math.max(1, distinctSessionUsers),
      );

  const churnRisk = clampLoopScore(
    sessionsPrev7d.length === 0
      ? 0.25
      : Math.max(0, (sessionsPrev7d.length - sessions7d.length) / Math.max(1, sessionsPrev7d.length)),
  );
  const fourWeekRetention = safeRatio(sessions7d.length, Math.max(1, Math.round(sessions30d.length / 4)));

  const validatedOutcomeRatio = safeRatio(
    scoped.successOutcomeLinks.filter(
      (link) =>
        link.comparisonVerdict === "validated" ||
        link.comparisonVerdict === "partially_validated",
    ).length,
    scoped.successOutcomeLinks.length,
  );
  const avgOutcomeSignal = mean(
    scoped.successOutcomeLinks.flatMap((link) => (link.outcomeMetrics ?? []).map((metric) => metric.score)),
  );
  const avgExperimentDelta = mean(
    scoped.successLoopExperiments
      .map((experiment) => experiment.observedDelta ?? 0)
      .filter((delta) => Number.isFinite(delta)),
  );
  const validatedExperiments = scoped.successLoopExperiments.filter(
    (experiment) => experiment.status === "validated",
  );

  const loops: SuccessLoopCard[] = [];

  loops.push(
    buildLoopCard({
      definition: getLoopDefinition("problem_selection")!,
      registryRow: registryByType.get("problem_selection"),
      now,
      leadingMetrics: [
        buildMetricValue({
          key: "repeated_task_frequency",
          label: "Repeated task frequency",
          value: repeatedWorkflowCount30d,
          displayValue: formatCount(repeatedWorkflowCount30d),
          score: scoreHigher(repeatedWorkflowCount30d, 4),
          targetDirection: "higher",
          source: "proxy",
          note: "Derived from repeated workflow traces in the last 30 days.",
        }),
        buildMetricValue({
          key: "manual_hours_burn",
          label: "Manual-hours burn",
          value: completed30d.reduce((sum, session) => sum + (session.totalDurationMs ?? 0), 0) / 3_600_000,
          displayValue: `${(
            completed30d.reduce((sum, session) => sum + (session.totalDurationMs ?? 0), 0) / 3_600_000
          ).toFixed(1)}h`,
          score: scoreHigher(
            completed30d.reduce((sum, session) => sum + (session.totalDurationMs ?? 0), 0) / 3_600_000,
            8,
          ),
          unit: "hours",
          targetDirection: "higher",
          source: "proxy",
          note: "Uses observed runtime as a proxy for workflow pain and operator time burn.",
        }),
        buildMetricValue({
          key: "failure_cost_signal",
          label: "Failure cost signal",
          value: failed30d.length + dogfoodIssuePressure,
          displayValue: formatCount(failed30d.length + dogfoodIssuePressure),
          score: scoreHigher(failed30d.length + dogfoodIssuePressure, 10),
          targetDirection: "higher",
          source: "proxy",
        }),
        buildMetricValue({
          key: "inbound_workflow_asks",
          label: "Inbound asks by workflow",
          value: sessions30d.filter((session) => session.type === "agent" || session.type === "manual").length,
          displayValue: formatCount(
            sessions30d.filter((session) => session.type === "agent" || session.type === "manual").length,
          ),
          score: scoreHigher(
            sessions30d.filter((session) => session.type === "agent" || session.type === "manual").length,
            12,
          ),
          targetDirection: "higher",
          source: "proxy",
        }),
      ],
      laggingMetrics: [
        buildMetricValue({
          key: "pilots_started",
          label: "Pilots started",
          value: pilotStartedCount,
          displayValue: formatCount(pilotStartedCount),
          score: scoreHigher(pilotStartedCount, 2),
          targetDirection: "higher",
          source: pilotStartedCount > 0 ? "manual" : "missing",
          note: "Requires explicit pilot-start instrumentation.",
        }),
        buildMetricValue({
          key: "workflows_adopted",
          label: "Workflows adopted",
          value: distinctWorkflowCount30d,
          displayValue: formatCount(distinctWorkflowCount30d),
          score: scoreHigher(distinctWorkflowCount30d, 6),
          targetDirection: "higher",
          source: "observed",
        }),
        buildMetricValue({
          key: "willingness_to_pay_signal",
          label: "Willingness to pay signal",
          value: pipelineCreatedCount,
          displayValue: formatCount(pipelineCreatedCount),
          score: scoreHigher(pipelineCreatedCount, 3),
          targetDirection: "higher",
          source: pipelineCreatedCount > 0 ? "manual" : "missing",
          note: "Needs pipeline and revenue event linkage.",
        }),
      ],
      gaps: [
        ...(pilotStartedCount === 0 ? ["pilot_started"] : []),
        ...(pipelineCreatedCount === 0 ? ["pipeline_created"] : []),
      ],
    }),
  );

  loops.push(
    buildLoopCard({
      definition: getLoopDefinition("activation")!,
      registryRow: registryByType.get("activation"),
      now,
      leadingMetrics: [
        buildMetricValue({
          key: "time_to_first_run",
          label: "Time to first run",
          value: timeToFirstRunMinutes,
          displayValue: formatDurationMinutes(timeToFirstRunMinutes),
          score: scoreLower(timeToFirstRunMinutes, 30),
          unit: "minutes",
          targetDirection: "lower",
          source: "proxy",
          note: "Current implementation uses first recorded session as the run start baseline.",
        }),
        buildMetricValue({
          key: "time_to_first_value",
          label: "Time to first value",
          value: derivedTimeToFirstValueMinutes ?? 0,
          displayValue:
            typeof derivedTimeToFirstValueMinutes === "number"
              ? formatDurationMinutes(derivedTimeToFirstValueMinutes)
              : "missing",
          score:
            typeof derivedTimeToFirstValueMinutes === "number"
              ? scoreLower(derivedTimeToFirstValueMinutes, 120)
              : 0,
          unit: "minutes",
          targetDirection: "lower",
          source:
            typeof derivedTimeToFirstValueMinutes === "number"
              ? "proxy"
              : "missing",
        }),
        buildMetricValue({
          key: "first_week_dogfood_completion",
          label: "First-week dogfood completion",
          value: firstWeekDogfoodCompletion,
          displayValue: formatPercent(firstWeekDogfoodCompletion),
          score: firstWeekDogfoodCompletion,
          targetDirection: "higher",
          source: dogfood30d.length > 0 ? "proxy" : "missing",
        }),
        buildMetricValue({
          key: "setup_friction",
          label: "Setup friction",
          value: setupFriction,
          displayValue: formatPercent(setupFriction),
          score: scoreLower(setupFriction, 0.5),
          targetDirection: "lower",
          source: "proxy",
        }),
      ],
      laggingMetrics: [
        buildMetricValue({
          key: "activated_accounts",
          label: "Activated accounts",
          value: activatedAccounts,
          displayValue: formatCount(activatedAccounts),
          score: scoreHigher(activatedAccounts, 3),
          targetDirection: "higher",
          source: userId ? "proxy" : "observed",
        }),
        buildMetricValue({
          key: "second_session_rate",
          label: "Second-session rate",
          value: secondSessionRate,
          displayValue: formatPercent(secondSessionRate),
          score: secondSessionRate,
          unit: "%",
          targetDirection: "higher",
          source: "proxy",
        }),
        buildMetricValue({
          key: "team_invite_signal",
          label: "Team invite signal",
          value: teamInviteCount,
          displayValue: formatCount(teamInviteCount),
          score: scoreHigher(teamInviteCount, 2),
          targetDirection: "higher",
          source: teamInviteCount > 0 ? "manual" : "missing",
        }),
      ],
      gaps: [
        ...(typeof derivedTimeToFirstValueMinutes !== "number" ? ["time_to_first_value"] : []),
        ...(teamInviteCount === 0 ? ["team_invite"] : []),
      ],
    }),
  );

  const acceptedOutputRate =
    acceptedOutputCount > 0 || editRequestedCount > 0
      ? safeRatio(acceptedOutputCount, acceptedOutputCount + editRequestedCount)
      : responseReviewStats.totalLatestReviews > 0
        ? responseReviewStats.passRate
        : safeRatio(alignedCompleted30d.length, Math.max(1, completed30d.length));
  const reuseExportRate =
    artifactReuseCount > 0
      ? safeRatio(artifactReuseCount, Math.max(1, acceptedOutputCount))
      : responseReviewStats.passCount > 0
        ? safeRatio(responseReviewStats.repeatPassThreadCount, Math.max(1, responseReviewStats.passCount))
        : safeRatio(completedPublishing30d.length, Math.max(1, completed30d.length));

  loops.push(
    buildLoopCard({
      definition: getLoopDefinition("retained_value")!,
      registryRow: registryByType.get("retained_value"),
      now,
      leadingMetrics: [
        buildMetricValue({
          key: "weekly_active_workflows",
          label: "Weekly active workflows",
          value: distinctWorkflowCount7d,
          displayValue: formatCount(distinctWorkflowCount7d),
          score: scoreHigher(distinctWorkflowCount7d, 4),
          targetDirection: "higher",
          source: "observed",
        }),
        buildMetricValue({
          key: "repeated_benchmark_runs",
          label: "Repeated benchmark runs",
          value: benchmark30d.length + workbench30d.length,
          displayValue: formatCount(benchmark30d.length + workbench30d.length),
          score: scoreHigher(benchmark30d.length + workbench30d.length, 8),
          targetDirection: "higher",
          source: benchmark30d.length + workbench30d.length > 0 ? "observed" : "missing",
        }),
        buildMetricValue({
          key: "accepted_output_rate",
          label: "Accepted output rate",
          value: acceptedOutputRate,
          displayValue: formatPercent(acceptedOutputRate),
          score: acceptedOutputRate,
          targetDirection: "higher",
          source:
            acceptedOutputCount > 0
              ? "observed"
              : responseReviewStats.totalLatestReviews > 0
                ? "proxy"
                : "missing",
          note:
            acceptedOutputCount > 0
              ? undefined
              : responseReviewStats.totalLatestReviews > 0
                ? "Falls back to latest reviewed assistant replies when explicit acceptance events are missing."
                : undefined,
        }),
        buildMetricValue({
          key: "reuse_export_rate",
          label: "Reuse / export rate",
          value: reuseExportRate,
          displayValue: formatPercent(reuseExportRate),
          score: reuseExportRate,
          targetDirection: "higher",
          source:
            artifactReuseCount > 0
              ? "observed"
              : responseReviewStats.passCount > 0
                ? "proxy"
                : "missing",
          note:
            artifactReuseCount > 0
              ? undefined
              : responseReviewStats.passCount > 0
                ? "Uses repeated passing reply threads as a retention proxy until explicit reuse/export events are recorded."
                : undefined,
        }),
      ],
      laggingMetrics: [
        buildMetricValue({
          key: "four_week_retention",
          label: "4-week retention",
          value: fourWeekRetention,
          displayValue: formatPercent(fourWeekRetention),
          score: clampLoopScore(fourWeekRetention),
          targetDirection: "higher",
          source: "proxy",
        }),
        buildMetricValue({
          key: "expansion_signal",
          label: "Expansion signal",
          value: expansionSignalCount,
          displayValue: formatCount(expansionSignalCount),
          score: scoreHigher(expansionSignalCount, 2),
          targetDirection: "higher",
          source: expansionSignalCount > 0 ? "manual" : "missing",
        }),
        buildMetricValue({
          key: "churn_risk",
          label: "Churn risk",
          value: churnRisk,
          displayValue: formatPercent(churnRisk),
          score: scoreLower(churnRisk, 0.45),
          targetDirection: "lower",
          source: "proxy",
        }),
      ],
      gaps: [
        ...(artifactReuseCount === 0 && responseReviewStats.passCount === 0 ? ["artifact_reuse"] : []),
        ...(expansionSignalCount === 0 ? ["expansion_signal"] : []),
      ],
    }),
  );

  loops.push(
    buildLoopCard({
      definition: getLoopDefinition("outcome_attribution")!,
      registryRow: registryByType.get("outcome_attribution"),
      now,
      leadingMetrics: [
        buildMetricValue({
          key: "operator_acceptance",
          label: "Operator acceptance",
          value: acceptedOutputRate,
          displayValue: formatPercent(acceptedOutputRate),
          score: acceptedOutputRate,
          targetDirection: "higher",
          source:
            acceptedOutputCount > 0
              ? "observed"
              : responseReviewStats.totalLatestReviews > 0
                ? "proxy"
                : "missing",
        }),
        buildMetricValue({
          key: "edit_distance_proxy",
          label: "Edit distance proxy",
          value: editRequestedCount > 0 ? editRequestedCount : responseReviewStats.weakCount,
          displayValue: formatCount(editRequestedCount > 0 ? editRequestedCount : responseReviewStats.weakCount),
          score: scoreLower(editRequestedCount > 0 ? editRequestedCount : responseReviewStats.weakCount, 6),
          targetDirection: "lower",
          source:
            editRequestedCount > 0
              ? "observed"
              : responseReviewStats.totalLatestReviews > 0
                ? "proxy"
                : "missing",
          note:
            editRequestedCount > 0
              ? undefined
              : responseReviewStats.totalLatestReviews > 0
                ? "Uses watch/fail reviewed replies as an edit-pressure proxy."
                : undefined,
        }),
        buildMetricValue({
          key: "reopen_rate",
          label: "Reopen rate",
          value:
            reopenCount > 0
              ? safeRatio(reopenCount, Math.max(1, acceptedOutputCount + reopenCount))
              : responseReviewStats.regressedRejudgeRate,
          displayValue: formatPercent(
            reopenCount > 0
              ? safeRatio(reopenCount, Math.max(1, acceptedOutputCount + reopenCount))
              : responseReviewStats.regressedRejudgeRate,
          ),
          score: scoreLower(
            reopenCount > 0
              ? safeRatio(reopenCount, Math.max(1, acceptedOutputCount + reopenCount))
              : responseReviewStats.regressedRejudgeRate,
            0.2,
          ),
          targetDirection: "lower",
          source:
            reopenCount > 0
              ? "observed"
              : responseReviewStats.rejudgedCount > 0
                ? "proxy"
                : "missing",
        }),
        buildMetricValue({
          key: "escalation_rate",
          label: "Escalation rate",
          value: safeRatio(escalationCount, Math.max(1, completed30d.length)),
          displayValue: formatPercent(safeRatio(escalationCount, Math.max(1, completed30d.length))),
          score: scoreLower(safeRatio(escalationCount, Math.max(1, completed30d.length)), 0.15),
          targetDirection: "lower",
          source: escalationCount > 0 ? "observed" : "missing",
        }),
      ],
      laggingMetrics: [
        buildMetricValue({
          key: "validated_outcomes",
          label: "Validated outcomes",
          value:
            scoped.successOutcomeLinks.length > 0
              ? validatedOutcomeRatio
              : responseReviewStats.improvedRejudgeRate,
          displayValue: formatPercent(
            scoped.successOutcomeLinks.length > 0
              ? validatedOutcomeRatio
              : responseReviewStats.improvedRejudgeRate,
          ),
          score:
            scoped.successOutcomeLinks.length > 0
              ? validatedOutcomeRatio
              : responseReviewStats.improvedRejudgeRate,
          targetDirection: "higher",
          source:
            scoped.successOutcomeLinks.length > 0
              ? "observed"
              : responseReviewStats.rejudgedCount > 0
                ? "proxy"
                : "missing",
          note:
            scoped.successOutcomeLinks.length > 0
              ? undefined
              : responseReviewStats.rejudgedCount > 0
                ? "Falls back to improved re-judge rate until explicit downstream outcome links are recorded."
                : undefined,
        }),
        buildMetricValue({
          key: "kpi_uplift",
          label: "KPI uplift",
          value: avgOutcomeSignal,
          displayValue: formatPercent(avgOutcomeSignal),
          score: clampLoopScore(avgOutcomeSignal),
          targetDirection: "higher",
          source: scoped.successOutcomeLinks.length > 0 ? "manual" : "missing",
        }),
        buildMetricValue({
          key: "throughput_gain",
          label: "Throughput gain",
          value:
            scoped.successLoopExperiments.length > 0
              ? Math.max(0, avgExperimentDelta)
              : Math.max(0, responseReviewStats.averagePositiveDelta),
          displayValue: formatPercent(
            scoped.successLoopExperiments.length > 0
              ? Math.max(0, avgExperimentDelta)
              : Math.max(0, responseReviewStats.averagePositiveDelta),
          ),
          score: clampLoopScore(
            scoped.successLoopExperiments.length > 0
              ? Math.max(0, avgExperimentDelta)
              : Math.max(0, responseReviewStats.averagePositiveDelta),
          ),
          targetDirection: "higher",
          source:
            scoped.successLoopExperiments.length > 0
              ? "observed"
              : responseReviewStats.rejudgedCount > 0
                ? "proxy"
                : "missing",
        }),
      ],
      gaps: [
        ...(scoped.frozenDecisions.length === 0 ? ["frozen_decisions"] : []),
        ...(scoped.successOutcomeLinks.length === 0 && responseReviewStats.rejudgedCount === 0
          ? ["outcome_links"]
          : []),
      ],
    }),
  );

  const benchmarkViewCount = engagement30d.filter(
    (event) => event.contentType === "research" || event.contentType === "digest",
  ).length;
  const caseStudyReadCount = engagement30d.filter((event) => event.eventType === "opened").length;
  const proofToPilotConversion = safeRatio(
    pilotStartedCount,
    Math.max(1, proofTouchCount || completedPublishing30d.length),
  );

  loops.push(
    buildLoopCard({
      definition: getLoopDefinition("distribution_proof")!,
      registryRow: registryByType.get("distribution_proof"),
      now,
      leadingMetrics: [
        buildMetricValue({
          key: "benchmark_views",
          label: "Benchmark views",
          value: benchmarkViewCount,
          displayValue: formatCount(benchmarkViewCount),
          score: scoreHigher(benchmarkViewCount, 10),
          targetDirection: "higher",
          source: benchmarkViewCount > 0 ? "observed" : "missing",
        }),
        buildMetricValue({
          key: "dogfood_artifacts",
          label: "Dogfood artifacts",
          value: dogfood30d.length,
          displayValue: formatCount(dogfood30d.length),
          score: scoreHigher(dogfood30d.length, 4),
          targetDirection: "higher",
          source: dogfood30d.length > 0 ? "observed" : "missing",
        }),
        buildMetricValue({
          key: "case_study_reads",
          label: "Case-study reads",
          value: caseStudyReadCount,
          displayValue: formatCount(caseStudyReadCount),
          score: scoreHigher(caseStudyReadCount, 10),
          targetDirection: "higher",
          source: caseStudyReadCount > 0 ? "observed" : "missing",
        }),
        buildMetricValue({
          key: "qualified_inbound",
          label: "Qualified inbound",
          value: qualifiedInboundCount,
          displayValue: formatCount(qualifiedInboundCount),
          score: scoreHigher(qualifiedInboundCount, 2),
          targetDirection: "higher",
          source: qualifiedInboundCount > 0 ? "manual" : "missing",
        }),
      ],
      laggingMetrics: [
        buildMetricValue({
          key: "pipeline_created",
          label: "Pipeline created",
          value: pipelineCreatedCount,
          displayValue: formatCount(pipelineCreatedCount),
          score: scoreHigher(pipelineCreatedCount, 2),
          targetDirection: "higher",
          source: pipelineCreatedCount > 0 ? "manual" : "missing",
        }),
        buildMetricValue({
          key: "referral_rate",
          label: "Referral rate",
          value: shareRate30d,
          displayValue: formatPercent(shareRate30d),
          score: shareRate30d,
          targetDirection: "higher",
          source: engagement30d.length > 0 ? "observed" : "missing",
        }),
        buildMetricValue({
          key: "proof_to_pilot_conversion",
          label: "Proof to pilot conversion",
          value: proofToPilotConversion,
          displayValue: formatPercent(proofToPilotConversion),
          score: proofToPilotConversion,
          targetDirection: "higher",
          source: proofTouchCount > 0 || pilotStartedCount > 0 ? "manual" : "missing",
        }),
      ],
      gaps: [
        ...(qualifiedInboundCount === 0 ? ["qualified_inbound"] : []),
        ...(pipelineCreatedCount === 0 ? ["pipeline_created"] : []),
      ],
    }),
  );

  const workflowsPerAccount = safeRatio(completed30d.length, Math.max(1, activatedAccounts));

  loops.push(
    buildLoopCard({
      definition: getLoopDefinition("revenue_expansion")!,
      registryRow: registryByType.get("revenue_expansion"),
      now,
      leadingMetrics: [
        buildMetricValue({
          key: "workflows_per_account",
          label: "Workflows per account",
          value: workflowsPerAccount,
          displayValue: workflowsPerAccount.toFixed(1),
          score: scoreHigher(workflowsPerAccount, 3),
          targetDirection: "higher",
          source: "proxy",
        }),
        buildMetricValue({
          key: "departments_touched",
          label: "Departments touched",
          value: Math.max(0, Math.min(4, integrationsConnected)),
          displayValue: formatCount(Math.max(0, Math.min(4, integrationsConnected))),
          score: scoreHigher(Math.max(0, Math.min(4, integrationsConnected)), 3),
          targetDirection: "higher",
          source: integrationsConnected > 0 ? "observed" : "missing",
        }),
        buildMetricValue({
          key: "integrations_connected",
          label: "Integrations connected",
          value: integrationsConnected,
          displayValue: formatCount(integrationsConnected),
          score: scoreHigher(integrationsConnected, 3),
          targetDirection: "higher",
          source: integrationsConnected > 0 ? "observed" : "missing",
        }),
      ],
      laggingMetrics: [
        buildMetricValue({
          key: "expansion_signal",
          label: "Expansion signal",
          value: expansionSignalCount,
          displayValue: formatCount(expansionSignalCount),
          score: scoreHigher(expansionSignalCount, 2),
          targetDirection: "higher",
          source: expansionSignalCount > 0 ? "manual" : "missing",
        }),
        buildMetricValue({
          key: "multi_team_adoption",
          label: "Multi-team adoption",
          value: teamInviteCount,
          displayValue: formatCount(teamInviteCount),
          score: scoreHigher(teamInviteCount, 2),
          targetDirection: "higher",
          source: teamInviteCount > 0 ? "manual" : "missing",
        }),
        buildMetricValue({
          key: "renewal_signal",
          label: "Renewal signal",
          value: clampLoopScore((1 - churnRisk) * fourWeekRetention),
          displayValue: formatPercent(clampLoopScore((1 - churnRisk) * fourWeekRetention)),
          score: clampLoopScore((1 - churnRisk) * fourWeekRetention),
          targetDirection: "higher",
          source: "proxy",
        }),
      ],
      gaps: [
        ...(integrationsConnected === 0 ? ["integrations_connected"] : []),
        ...(expansionSignalCount === 0 ? ["expansion_signal"] : []),
      ],
    }),
  );

  loops.push(
    buildLoopCard({
      definition: getLoopDefinition("market_sensing")!,
      registryRow: registryByType.get("market_sensing"),
      now,
      leadingMetrics: [
        buildMetricValue({
          key: "competitor_release_cadence",
          label: "Competitor release cadence",
          value: marketSignalCount + drift30d.length,
          displayValue: formatCount(marketSignalCount + drift30d.length),
          score: scoreHigher(marketSignalCount + drift30d.length, 6),
          targetDirection: "higher",
          source: marketSignalCount + drift30d.length > 0 ? "manual" : "missing",
        }),
        buildMetricValue({
          key: "feature_parity_drift",
          label: "Feature parity drift",
          value: avgDriftScore,
          displayValue: formatPercent(avgDriftScore),
          score: scoreLower(avgDriftScore, 0.45),
          targetDirection: "lower",
          source: drift30d.length > 0 ? "observed" : "missing",
        }),
        buildMetricValue({
          key: "buyer_language_changes",
          label: "Buyer-language changes",
          value: marketSignalCount,
          displayValue: formatCount(marketSignalCount),
          score: scoreHigher(marketSignalCount, 3),
          targetDirection: "higher",
          source: marketSignalCount > 0 ? "manual" : "missing",
        }),
        buildMetricValue({
          key: "channel_saturation",
          label: "Channel saturation",
          value: dismissRate30d,
          displayValue: formatPercent(dismissRate30d),
          score: scoreLower(dismissRate30d, 0.35),
          targetDirection: "lower",
          source: engagement30d.length > 0 ? "observed" : "missing",
        }),
      ],
      laggingMetrics: [
        buildMetricValue({
          key: "lost_deal_signal",
          label: "Lost-deal signal",
          value: lostDealCount,
          displayValue: formatCount(lostDealCount),
          score: scoreLower(lostDealCount, 3),
          targetDirection: "lower",
          source: lostDealCount > 0 ? "manual" : "missing",
        }),
        buildMetricValue({
          key: "category_compression",
          label: "Category compression",
          value: significantDriftCount,
          displayValue: formatCount(significantDriftCount),
          score: scoreLower(significantDriftCount, 4),
          targetDirection: "lower",
          source: significantDriftCount > 0 ? "observed" : "missing",
        }),
        buildMetricValue({
          key: "market_response_quality",
          label: "Market response quality",
          value: clickRate30d,
          displayValue: formatPercent(clickRate30d),
          score: clickRate30d,
          targetDirection: "higher",
          source: engagement30d.length > 0 ? "observed" : "missing",
        }),
      ],
      gaps: [
        ...(marketSignalCount === 0 ? ["market_signal"] : []),
        ...(drift30d.length === 0 ? ["distribution_drift_snapshots"] : []),
      ],
    }),
  );

  const avgTimeFromIssueToFixHours =
    validatedExperiments.length > 0
      ? mean(
          validatedExperiments.map((experiment) =>
            Math.max(0, ((experiment.endedAt ?? experiment.createdAt) - experiment.createdAt) / 3_600_000),
          ),
        )
      : responseReviewStats.averageTimeToFixHours > 0
        ? responseReviewStats.averageTimeToFixHours
        : mean(
            failed30d
              .map((session) => (session.totalDurationMs ?? 0) / 3_600_000)
              .filter((hours) => Number.isFinite(hours)),
          );
  const benchmarkToPolicyUpdateHours =
    benchmark30d[0] && scoped.successLoopExperiments[0]
      ? Math.max(0, (scoped.successLoopExperiments[0].createdAt - benchmark30d[0].startedAt) / 3_600_000)
      : responseReviewStats.averageTimeToFixHours > 0
        ? responseReviewStats.averageTimeToFixHours
        : undefined;

  loops.push(
    buildLoopCard({
      definition: getLoopDefinition("organization_learning")!,
      registryRow: registryByType.get("organization_learning"),
      now,
      leadingMetrics: [
        buildMetricValue({
          key: "time_from_issue_to_fix",
          label: "Time from issue to fix",
          value: avgTimeFromIssueToFixHours,
          displayValue: `${avgTimeFromIssueToFixHours.toFixed(1)}h`,
          score: scoreLower(avgTimeFromIssueToFixHours, 48),
          unit: "hours",
          targetDirection: "lower",
          source:
            validatedExperiments.length > 0
              ? "observed"
              : responseReviewStats.averageTimeToFixHours > 0 || failed30d.length > 0
                ? "proxy"
                : "missing",
        }),
        buildMetricValue({
          key: "benchmark_to_policy_update",
          label: "Benchmark to policy update",
          value: benchmarkToPolicyUpdateHours ?? 0,
          displayValue:
            typeof benchmarkToPolicyUpdateHours === "number"
              ? `${benchmarkToPolicyUpdateHours.toFixed(1)}h`
              : "missing",
          score:
            typeof benchmarkToPolicyUpdateHours === "number"
              ? scoreLower(benchmarkToPolicyUpdateHours, 72)
              : 0,
          unit: "hours",
          targetDirection: "lower",
          source:
            typeof benchmarkToPolicyUpdateHours === "number"
              ? scoped.successLoopExperiments.length > 0 && benchmark30d[0]
                ? "observed"
                : "proxy"
              : "missing",
        }),
        buildMetricValue({
          key: "experiment_throughput",
          label: "Experiment throughput",
          value:
            scoped.successLoopExperiments.filter((experiment) => experiment.createdAt >= last30d).length ||
            responseReviewStats.rejudgedCount,
          displayValue: formatCount(
            scoped.successLoopExperiments.filter((experiment) => experiment.createdAt >= last30d).length ||
              responseReviewStats.rejudgedCount,
          ),
          score: scoreHigher(
            scoped.successLoopExperiments.filter((experiment) => experiment.createdAt >= last30d).length ||
              responseReviewStats.rejudgedCount,
            4,
          ),
          targetDirection: "higher",
          source:
            scoped.successLoopExperiments.length > 0
              ? "observed"
              : responseReviewStats.rejudgedCount > 0
                ? "proxy"
                : "missing",
          note:
            scoped.successLoopExperiments.length > 0
              ? undefined
              : responseReviewStats.rejudgedCount > 0
                ? "Uses response re-judges as a learning-loop throughput proxy until explicit experiments are logged."
                : undefined,
        }),
      ],
      laggingMetrics: [
        buildMetricValue({
          key: "product_trajectory",
          label: "Product trajectory",
          value: scoped.trajectoryScore?.trustAdjustedScore ?? 0,
          displayValue: formatPercent(scoped.trajectoryScore?.trustAdjustedScore ?? 0),
          score: clampLoopScore(scoped.trajectoryScore?.trustAdjustedScore ?? 0),
          targetDirection: "higher",
          source: scoped.trajectoryScore ? "observed" : "missing",
        }),
        buildMetricValue({
          key: "workflow_trajectory",
          label: "Workflow trajectory",
          value: safeRatio(distinctWorkflowCount7d, Math.max(1, distinctWorkflowCount30d)),
          displayValue: formatPercent(safeRatio(distinctWorkflowCount7d, Math.max(1, distinctWorkflowCount30d))),
          score: clampLoopScore(safeRatio(distinctWorkflowCount7d, Math.max(1, distinctWorkflowCount30d))),
          targetDirection: "higher",
          source: distinctWorkflowCount30d > 0 ? "observed" : "missing",
        }),
        buildMetricValue({
          key: "decision_calibration",
          label: "Decision calibration",
          value:
            scoped.successOutcomeLinks.length > 0
              ? validatedOutcomeRatio
              : responseReviewStats.improvedRejudgeRate,
          displayValue: formatPercent(
            scoped.successOutcomeLinks.length > 0
              ? validatedOutcomeRatio
              : responseReviewStats.improvedRejudgeRate,
          ),
          score:
            scoped.successOutcomeLinks.length > 0
              ? validatedOutcomeRatio
              : responseReviewStats.improvedRejudgeRate,
          targetDirection: "higher",
          source:
            scoped.successOutcomeLinks.length > 0
              ? "observed"
              : responseReviewStats.rejudgedCount > 0
                ? "proxy"
                : "missing",
        }),
      ],
      gaps: [
        ...(scoped.successLoopExperiments.length === 0 && responseReviewStats.rejudgedCount === 0
          ? ["success_loop_experiments"]
          : []),
        ...(scoped.successOutcomeLinks.length === 0 && responseReviewStats.rejudgedCount === 0
          ? ["decision_calibration"]
          : []),
      ],
    }),
  );

  const strongestLoop = loops.slice().sort((a, b) => b.score - a.score)[0] ?? null;
  const weakestLoop = loops.slice().sort((a, b) => a.score - b.score)[0] ?? null;
  const summary = {
    totalLoops: loops.length,
    strengtheningCount: loops.filter((loop) => loop.status === "strengthening").length,
    mixedCount: loops.filter((loop) => loop.status === "mixed").length,
    weakeningCount: loops.filter((loop) => loop.status === "weakening").length,
    missingCount: loops.filter((loop) => loop.status === "missing").length,
    strongestLoop: strongestLoop
      ? { loopType: strongestLoop.loopType, title: strongestLoop.title, score: strongestLoop.score }
      : null,
    weakestLoop: weakestLoop
      ? { loopType: weakestLoop.loopType, title: weakestLoop.title, score: weakestLoop.score }
      : null,
  };

  const topExperiments = scoped.successLoopExperiments
    .slice()
    .sort((a, b) => (b.observedDelta ?? 0) - (a.observedDelta ?? 0))
    .slice(0, 5)
    .map((experiment) => ({
      experimentKey: experiment.experimentKey,
      loopType: experiment.loopType,
      title: experiment.title,
      status: experiment.status,
      owner: experiment.owner,
      observedDelta: experiment.observedDelta ?? 0,
      expectedEffect: experiment.expectedEffect,
      outcomeSummary: experiment.outcomeSummary,
      observationWindowDays: experiment.observationWindowDays,
    }));

  const frozenDecisions = scoped.frozenDecisions.slice(0, 5).map((decision) => ({
    decisionKey: decision.decisionKey,
    decisionType: decision.decisionType,
    title: decision.title,
    owner: decision.owner,
    confidence: decision.confidence,
    status: decision.status,
    latestOutcomeVerdict: findLatestOutcomeVerdict(scoped.successOutcomeLinks, decision.decisionKey) ?? "pending",
    expectedOutcomeSummary: decision.expectedOutcomeSummary,
    createdAt: decision.createdAt,
    observationWindowDays: decision.observationWindowDays,
  }));

  const proofGraph = {
    nodes: [
      {
        nodeKey: "proof:benchmarks",
        label: "Benchmarks",
        kind: "benchmark" as const,
        score: benchmarkPassRate,
        value: `${benchmark30d.length} runs`,
        detail: `Pass rate ${formatPercent(benchmarkPassRate)}`,
      },
      {
        nodeKey: "proof:dogfood",
        label: "Dogfood",
        kind: "dogfood" as const,
        score: scoreLower(dogfoodIssuePressure, 12),
        value: `${dogfood30d.length} QA runs`,
        detail: `${dogfoodIssuePressure} weighted issues`,
      },
      {
        nodeKey: "proof:case-studies",
        label: "Case studies",
        kind: "case_study" as const,
        score: scoreHigher(completedPublishing30d.length, 6),
        value: `${completedPublishing30d.length} publishes`,
        detail: `${caseStudyReadCount} reads`,
      },
      {
        nodeKey: "proof:social",
        label: "Social proof",
        kind: "social_post" as const,
        score: clickRate30d,
        value: formatPercent(clickRate30d),
        detail: `${engagement30d.length} engagement events`,
      },
      {
        nodeKey: "proof:pipeline",
        label: "Pipeline",
        kind: "pipeline" as const,
        score: scoreHigher(pipelineCreatedCount, 3),
        value: `${pipelineCreatedCount} created`,
        detail: `${qualifiedInboundCount} qualified inbound`,
      },
    ],
    edges: [
      {
        source: "proof:benchmarks",
        target: "proof:pipeline",
        strength: clampLoopScore(safeRatio(benchmark30d.length, Math.max(1, pipelineCreatedCount + 1))),
        label: "Benchmark credibility",
      },
      {
        source: "proof:dogfood",
        target: "proof:pipeline",
        strength: clampLoopScore(safeRatio(dogfood30d.length, Math.max(1, qualifiedInboundCount + 1))),
        label: "Internal proof to outbound confidence",
      },
      {
        source: "proof:case-studies",
        target: "proof:pipeline",
        strength: clampLoopScore(safeRatio(completedPublishing30d.length, Math.max(1, pipelineCreatedCount + 1))),
        label: "Case study to pipeline",
      },
      {
        source: "proof:social",
        target: "proof:pipeline",
        strength: clampLoopScore(Math.max(shareRate30d, proofToPilotConversion)),
        label: "Social reach to pipeline",
      },
    ],
  };

  const accountValueGraph = {
    nodes: [
      {
        accountKey: userId ? `user:${userId}` : "public:builder",
        label: userId ? "Current workspace" : "Public builder surface",
        activationState: loops.find((loop) => loop.loopType === "activation")?.status ?? "missing",
        retentionState: loops.find((loop) => loop.loopType === "retained_value")?.status ?? "missing",
        expansionState: loops.find((loop) => loop.loopType === "revenue_expansion")?.status ?? "missing",
        workflowRuns30d: completed30d.length,
        timeToFirstValueMinutes,
        integrationsConnected,
      },
    ],
  };

  return {
    generatedAt: now,
    entityKey: PRODUCT_ENTITY_KEY,
    entityType: PRODUCT_ENTITY_TYPE,
    summary,
    loops,
    topExperiments,
    frozenDecisions,
    proofGraph,
    accountValueGraph,
    nextRecommendedAction: defaultNextRecommendedAction({ loops, summary }),
  };
}
