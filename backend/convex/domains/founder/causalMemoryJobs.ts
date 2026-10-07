/**
 * Phase 10 — Causal Memory Background Jobs
 *
 * Time rollup generation, important change detection, and trajectory scoring.
 * All jobs are internal mutations/queries — called by Convex crons or triggers.
 */

import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";

// ── Constants ────────────────────────────────────────────────────────
const MAX_EVENTS_PER_QUERY = 500;
const MAX_DIFFS_PER_QUERY = 200;

// ===========================================================================
// Daily Rollup Generator
// Cadence: daily at midnight (or on-demand)
// Collects metrics from the last 24 hours and writes a founderTimeRollups row.
// ===========================================================================

export const computeDailyRollup = internalMutation({
  args: {
    companyId: v.id("founderCompanies"),
    date: v.string(), // YYYY-MM-DD
  },
  handler: async (ctx, { companyId, date }) => {
    const company = await ctx.db.get(companyId);
    if (!company) return null;

    // Compute the time window for this day
    const dayStart = new Date(date + "T00:00:00Z").getTime();
    const dayEnd = dayStart + 86_400_000;

    // Gather initiative stats
    const initiatives = await ctx.db
      .query("founderInitiatives")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(100);

    const initiativeCount = initiatives.length;
    const initiativesActive = initiatives.filter((i) => i.status === "active").length;
    const initiativesBlocked = initiatives.filter((i) => i.status === "blocked").length;
    const initiativesCompleted = initiatives.filter((i) => i.status === "completed").length;
    const avgInitiativePriority =
      initiatives.length > 0
        ? initiatives.reduce((sum, i) => sum + i.priorityScore, 0) / initiatives.length
        : 0;

    // Gather intervention stats (all time, filtered by updatedAt in range)
    const interventions = await ctx.db
      .query("founderInterventions")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(200);

    const dayInterventions = interventions.filter(
      (i) => i.updatedAt >= dayStart && i.updatedAt < dayEnd,
    );
    const interventionsSuggested = dayInterventions.filter((i) => i.status === "suggested").length;
    const interventionsStarted = dayInterventions.filter((i) => i.status === "in_progress").length;
    const interventionsCompleted = dayInterventions.filter((i) => i.status === "done").length;

    // Gather signal stats
    const signals = await ctx.db
      .query("founderSignals")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(500);

    const daySignals = signals.filter(
      (s) => s.createdAt >= dayStart && s.createdAt < dayEnd,
    );
    const signalsIngested = daySignals.length;
    const avgSignalImportance =
      daySignals.length > 0
        ? daySignals.reduce((sum, s) => sum + s.importanceScore, 0) / daySignals.length
        : 0;

    // Gather event stats from the ledger
    const events = await ctx.db
      .query("founderEventLedger")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(MAX_EVENTS_PER_QUERY);

    const dayEvents = events.filter(
      (e) => e.createdAt >= dayStart && e.createdAt < dayEnd,
    );

    // Path steps
    const pathSteps = await ctx.db
      .query("founderPathSteps")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", company.workspaceId))
      .order("desc")
      .take(MAX_EVENTS_PER_QUERY);

    const dayPathSteps = pathSteps.filter(
      (p) => p.enteredAt >= dayStart && p.enteredAt < dayEnd,
    );

    // State diffs
    const diffs = await ctx.db
      .query("founderStateDiffs")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(MAX_DIFFS_PER_QUERY);

    const dayDiffs = diffs.filter(
      (d) => d.createdAt >= dayStart && d.createdAt < dayEnd,
    );

    // Packet versions
    const packets = await ctx.db
      .query("founderPacketVersions")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(50);

    const dayPackets = packets.filter(
      (p) => p.createdAt >= dayStart && p.createdAt < dayEnd,
    );

    // Memo versions
    const memos = await ctx.db
      .query("founderMemoVersions")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(50);

    const dayMemos = memos.filter(
      (m) => m.createdAt >= dayStart && m.createdAt < dayEnd,
    );

    // Agent health
    const agents = await ctx.db
      .query("founderAgents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", company.workspaceId))
      .take(50);

    const agentsHealthy = agents.filter((a) => a.status === "healthy").length;
    const agentsDrifting = agents.filter((a) => a.status === "drifting").length;

    // Important changes
    const changes = await ctx.db
      .query("founderImportantChanges")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(100);

    const dayChanges = changes.filter(
      (c) => c.createdAt >= dayStart && c.createdAt < dayEnd,
    );
    const importantChangesDetected = dayChanges.length;
    const importantChangesResolved = dayChanges.filter(
      (c) => c.status === "resolved" || c.status === "dismissed",
    ).length;

    const metrics = {
      initiativeCount,
      initiativesActive,
      initiativesBlocked,
      initiativesCompleted,
      interventionsSuggested,
      interventionsStarted,
      interventionsCompleted,
      signalsIngested,
      avgSignalImportance: Math.round(avgSignalImportance * 100) / 100,
      identityConfidence: company.identityConfidence,
      avgInitiativePriority: Math.round(avgInitiativePriority * 100) / 100,
      eventsRecorded: dayEvents.length,
      pathStepsRecorded: dayPathSteps.length,
      diffsRecorded: dayDiffs.length,
      packetsGenerated: dayPackets.length,
      memosGenerated: dayMemos.length,
      agentsHealthy,
      agentsDrifting,
      importantChangesDetected,
      importantChangesResolved,
    };

    // Compute deltas vs prior day
    const priorDate = new Date(dayStart - 86_400_000).toISOString().slice(0, 10);
    const priorRollup = await ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q.eq("companyId", companyId).eq("periodType", "daily").eq("periodKey", priorDate),
      )
      .first();

    let deltas: {
      initiativeCountDelta: number;
      interventionsCompletedDelta: number;
      signalsIngestedDelta: number;
      identityConfidenceDelta: number;
      eventsRecordedDelta: number;
    } | undefined;

    if (priorRollup) {
      const pm = priorRollup.metrics;
      deltas = {
        initiativeCountDelta: metrics.initiativeCount - pm.initiativeCount,
        interventionsCompletedDelta: metrics.interventionsCompleted - pm.interventionsCompleted,
        signalsIngestedDelta: metrics.signalsIngested - pm.signalsIngested,
        identityConfidenceDelta: metrics.identityConfidence - pm.identityConfidence,
        eventsRecordedDelta: metrics.eventsRecorded - pm.eventsRecorded,
      };
    }

    // Upsert: check if rollup already exists for this day
    const existing = await ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q.eq("companyId", companyId).eq("periodType", "daily").eq("periodKey", date),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { metrics, deltas });
      return existing._id;
    }

    return ctx.db.insert("founderTimeRollups", {
      companyId,
      periodType: "daily",
      periodKey: date,
      metrics,
      deltas,
      createdAt: Date.now(),
    });
  },
});

// ===========================================================================
// Trajectory Score Calculator
// Cadence: daily (after rollup)
// Computes a composite 0-1 score across 7 dimensions.
// ===========================================================================

export const computeTrajectoryScore = internalMutation({
  args: {
    companyId: v.id("founderCompanies"),
    date: v.string(), // YYYY-MM-DD
  },
  handler: async (ctx, { companyId, date }) => {
    const company = await ctx.db.get(companyId);
    if (!company) return null;

    // Get today's rollup
    const rollup = await ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q.eq("companyId", companyId).eq("periodType", "daily").eq("periodKey", date),
      )
      .first();

    const m = rollup?.metrics;

    // --- Dimension scoring (0-1 each) ---

    // 1. Identity clarity: direct from company confidence
    const identityClarity = company.identityConfidence;

    // 2. Execution velocity: active / (active + blocked), or 0 if no initiatives
    const totalActive = m ? m.initiativesActive + m.initiativesBlocked : 0;
    const executionVelocity = totalActive > 0 ? (m?.initiativesActive ?? 0) / totalActive : 0.5;

    // 3. Agent alignment: healthy / (healthy + drifting), or 1 if no agents
    const totalAgents = m ? m.agentsHealthy + m.agentsDrifting : 0;
    const agentAlignment = totalAgents > 0 ? (m?.agentsHealthy ?? 0) / totalAgents : 1;

    // 4. Signal strength: clamp avg importance to 0-1
    const signalStrength = Math.min(m?.avgSignalImportance ?? 0, 1);

    // 5. Intervention effectiveness: completed / (completed + suggested + started)
    const totalInterventions = m
      ? m.interventionsCompleted + m.interventionsSuggested + m.interventionsStarted
      : 0;
    const interventionEffectiveness =
      totalInterventions > 0 ? (m?.interventionsCompleted ?? 0) / totalInterventions : 0.5;

    // 6. Contradiction load: inverse of active important changes (fewer = better)
    const activeChanges = await ctx.db
      .query("founderImportantChanges")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(50);

    const unresolvedCount = activeChanges.filter(
      (c) => c.status === "detected" || c.status === "acknowledged" || c.status === "investigating",
    ).length;
    const contradictionLoad = Math.max(0, 1 - unresolvedCount * 0.1); // Each unresolved drops 0.1

    // 7. Confidence trend: compare to 7 days ago
    const priorScores = await ctx.db
      .query("founderTrajectoryScores")
      .withIndex("by_company_date", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(7);

    const sevenDaysAgo = priorScores.length >= 7 ? priorScores[6] : null;
    const oneDayAgo = priorScores.length >= 1 ? priorScores[0] : null;
    const thirtyDaysAgo = priorScores.length >= 30 ? priorScores[29] : null;

    // Confidence trend: 0.5 = stable, >0.5 = improving, <0.5 = declining
    const currentConfidence = company.identityConfidence;
    const priorConfidence = sevenDaysAgo?.dimensions.identityClarity ?? currentConfidence;
    const confidenceDelta = currentConfidence - priorConfidence;
    const confidenceTrend = Math.max(0, Math.min(1, 0.5 + confidenceDelta * 5)); // Scale delta

    const dimensions = {
      identityClarity: Math.round(identityClarity * 1000) / 1000,
      executionVelocity: Math.round(executionVelocity * 1000) / 1000,
      agentAlignment: Math.round(agentAlignment * 1000) / 1000,
      signalStrength: Math.round(signalStrength * 1000) / 1000,
      interventionEffectiveness: Math.round(interventionEffectiveness * 1000) / 1000,
      contradictionLoad: Math.round(contradictionLoad * 1000) / 1000,
      confidenceTrend: Math.round(confidenceTrend * 1000) / 1000,
    };

    // Weighted composite
    const weights = {
      identityClarity: 0.20,
      executionVelocity: 0.20,
      agentAlignment: 0.10,
      signalStrength: 0.10,
      interventionEffectiveness: 0.15,
      contradictionLoad: 0.10,
      confidenceTrend: 0.15,
    };

    const overallScore = Math.round(
      (dimensions.identityClarity * weights.identityClarity +
        dimensions.executionVelocity * weights.executionVelocity +
        dimensions.agentAlignment * weights.agentAlignment +
        dimensions.signalStrength * weights.signalStrength +
        dimensions.interventionEffectiveness * weights.interventionEffectiveness +
        dimensions.contradictionLoad * weights.contradictionLoad +
        dimensions.confidenceTrend * weights.confidenceTrend) *
        1000,
    ) / 1000;

    // Slope calculations
    const slopeVsPriorDay = oneDayAgo ? overallScore - oneDayAgo.overallScore : undefined;
    const slopeVsPriorWeek = sevenDaysAgo ? overallScore - sevenDaysAgo.overallScore : undefined;
    const slopeVsPriorMonth = thirtyDaysAgo ? overallScore - thirtyDaysAgo.overallScore : undefined;

    // Upsert
    const existing = await ctx.db
      .query("founderTrajectoryScores")
      .withIndex("by_company_date", (q) =>
        q.eq("companyId", companyId).eq("date", date),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        overallScore,
        dimensions,
        slopeVsPriorDay,
        slopeVsPriorWeek,
        slopeVsPriorMonth,
        snapshotMetrics: m,
      });
      return existing._id;
    }

    return ctx.db.insert("founderTrajectoryScores", {
      companyId,
      date,
      overallScore,
      dimensions,
      slopeVsPriorDay,
      slopeVsPriorWeek,
      slopeVsPriorMonth,
      snapshotMetrics: m,
      createdAt: Date.now(),
    });
  },
});

// ===========================================================================
// Important Change Detector
// Cadence: every 15 minutes or event-triggered
// Scans recent events and diffs for patterns that warrant attention.
// ===========================================================================

export const detectImportantChanges = internalMutation({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get(companyId);
    if (!company) return [];

    const detected: string[] = [];

    // 1. Check for confidence drops > 10%
    const scores = await ctx.db
      .query("founderTrajectoryScores")
      .withIndex("by_company_date", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(2);

    if (scores.length >= 2) {
      const drop = scores[1].overallScore - scores[0].overallScore;
      if (drop > 0.10) {
        await ctx.db.insert("founderImportantChanges", {
          companyId,
          workspaceId: company.workspaceId,
          changeCategory: "confidence_drop",
          impactScore: Math.min(1, drop * 5),
          impactReason: `Trajectory score dropped ${(drop * 100).toFixed(1)}% in one day`,
          affectedEntities: [
            { entityType: "company", entityId: companyId, entityLabel: company.name },
          ],
          shouldTriggerPacket: drop > 0.2,
          shouldTriggerBrief: true,
          shouldTriggerAlert: drop > 0.15,
          suggestedAction: "Review recent changes and identify root cause of confidence drop",
          status: "detected",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        detected.push("confidence_drop");
      }
    }

    // 2. Check for blocked initiatives
    const initiatives = await ctx.db
      .query("founderInitiatives")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(50);

    const newlyBlocked = initiatives.filter(
      (i) => i.status === "blocked" && Date.now() - i.updatedAt < 900_000, // blocked in last 15 min
    );

    for (const init of newlyBlocked) {
      await ctx.db.insert("founderImportantChanges", {
        companyId,
        workspaceId: company.workspaceId,
        changeCategory: "initiative_blocked",
        impactScore: init.riskLevel === "high" ? 0.8 : init.riskLevel === "medium" ? 0.5 : 0.3,
        impactReason: `Initiative "${init.title}" became blocked`,
        affectedEntities: [
          { entityType: "initiative", entityId: init._id, entityLabel: init.title },
        ],
        shouldTriggerPacket: false,
        shouldTriggerBrief: true,
        shouldTriggerAlert: init.riskLevel === "high",
        suggestedAction: `Investigate what is blocking "${init.title}" and reassign or escalate`,
        status: "detected",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      detected.push(`initiative_blocked:${init.title}`);
    }

    // 3. Check for agent anomalies
    const agents = await ctx.db
      .query("founderAgents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", company.workspaceId))
      .take(50);

    const driftingAgents = agents.filter(
      (a) =>
        (a.status === "drifting" || a.status === "ambiguous") &&
        Date.now() - a.updatedAt < 900_000,
    );

    for (const agent of driftingAgents) {
      await ctx.db.insert("founderImportantChanges", {
        companyId,
        workspaceId: company.workspaceId,
        changeCategory: "agent_anomaly",
        impactScore: 0.6,
        impactReason: `Agent "${agent.name}" is ${agent.status}`,
        affectedEntities: [
          { entityType: "agent", entityId: agent._id, entityLabel: agent.name },
        ],
        shouldTriggerPacket: false,
        shouldTriggerBrief: false,
        shouldTriggerAlert: true,
        suggestedAction: `Check agent "${agent.name}" connectivity and goal alignment`,
        status: "detected",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      detected.push(`agent_anomaly:${agent.name}`);
    }

    // 4. Check for signal spikes (2x normal volume in last 15 min)
    const recentSignals = await ctx.db
      .query("founderSignals")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(200);

    const last15min = recentSignals.filter(
      (s) => Date.now() - s.createdAt < 900_000,
    );
    const prior15min = recentSignals.filter(
      (s) => Date.now() - s.createdAt >= 900_000 && Date.now() - s.createdAt < 1_800_000,
    );

    if (last15min.length > 0 && last15min.length >= prior15min.length * 2 && last15min.length >= 5) {
      const avgImportance =
        last15min.reduce((sum, s) => sum + s.importanceScore, 0) / last15min.length;

      await ctx.db.insert("founderImportantChanges", {
        companyId,
        workspaceId: company.workspaceId,
        changeCategory: "signal_spike",
        impactScore: Math.min(1, avgImportance),
        impactReason: `Signal volume spiked: ${last15min.length} signals in 15 min (${prior15min.length} in prior window)`,
        affectedEntities: [
          { entityType: "company", entityId: companyId, entityLabel: company.name },
        ],
        shouldTriggerPacket: avgImportance > 0.7,
        shouldTriggerBrief: true,
        shouldTriggerAlert: avgImportance > 0.8,
        suggestedAction: "Review incoming signals for emerging pattern or threat",
        status: "detected",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      detected.push("signal_spike");
    }

    return detected;
  },
});

// ===========================================================================
// Weekly Rollup Aggregator
// Cadence: weekly (Monday)
// Aggregates daily rollups into weekly summary.
// ===========================================================================

export const computeWeeklyRollup = internalMutation({
  args: {
    companyId: v.id("founderCompanies"),
    weekKey: v.string(), // YYYY-Wnn
    startDate: v.string(), // YYYY-MM-DD (Monday)
  },
  handler: async (ctx, { companyId, weekKey, startDate }) => {
    // Get all daily rollups for this week
    const dailyRollups = await ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q.eq("companyId", companyId).eq("periodType", "daily"),
      )
      .order("desc")
      .take(7);

    const weekStart = new Date(startDate + "T00:00:00Z").getTime();
    const weekEnd = weekStart + 7 * 86_400_000;

    const weekDays = dailyRollups.filter((r) => {
      const d = new Date(r.periodKey + "T00:00:00Z").getTime();
      return d >= weekStart && d < weekEnd;
    });

    if (weekDays.length === 0) return null;

    // Average the daily metrics
    const avg = (field: keyof typeof weekDays[0]["metrics"]) => {
      const sum = weekDays.reduce((s, d) => s + (d.metrics[field] as number), 0);
      return Math.round((sum / weekDays.length) * 100) / 100;
    };

    const sum = (field: keyof typeof weekDays[0]["metrics"]) => {
      return weekDays.reduce((s, d) => s + (d.metrics[field] as number), 0);
    };

    // Use latest for stock metrics, sum for flow metrics
    const latest = weekDays[0].metrics;
    const metrics = {
      initiativeCount: latest.initiativeCount,
      initiativesActive: latest.initiativesActive,
      initiativesBlocked: latest.initiativesBlocked,
      initiativesCompleted: sum("initiativesCompleted"),
      interventionsSuggested: sum("interventionsSuggested"),
      interventionsStarted: sum("interventionsStarted"),
      interventionsCompleted: sum("interventionsCompleted"),
      signalsIngested: sum("signalsIngested"),
      avgSignalImportance: avg("avgSignalImportance"),
      identityConfidence: latest.identityConfidence,
      avgInitiativePriority: avg("avgInitiativePriority"),
      eventsRecorded: sum("eventsRecorded"),
      pathStepsRecorded: sum("pathStepsRecorded"),
      diffsRecorded: sum("diffsRecorded"),
      packetsGenerated: sum("packetsGenerated"),
      memosGenerated: sum("memosGenerated"),
      agentsHealthy: latest.agentsHealthy,
      agentsDrifting: latest.agentsDrifting,
      importantChangesDetected: sum("importantChangesDetected"),
      importantChangesResolved: sum("importantChangesResolved"),
    };

    // Upsert
    const existing = await ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q.eq("companyId", companyId).eq("periodType", "weekly").eq("periodKey", weekKey),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { metrics });
      return existing._id;
    }

    return ctx.db.insert("founderTimeRollups", {
      companyId,
      periodType: "weekly",
      periodKey: weekKey,
      metrics,
      createdAt: Date.now(),
    });
  },
});

// ===========================================================================
// Monthly Rollup Aggregator
// Cadence: 1st of each month
// Aggregates daily rollups for a given month.
// ===========================================================================

export const computeMonthlyRollup = internalMutation({
  args: {
    companyId: v.id("founderCompanies"),
    monthKey: v.string(), // YYYY-MM
  },
  handler: async (ctx, { companyId, monthKey }) => {
    const [yearStr, monthStr] = monthKey.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const monthStart = new Date(year, month - 1, 1).getTime();
    const monthEnd = new Date(year, month, 1).getTime();

    const dailyRollups = await ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q.eq("companyId", companyId).eq("periodType", "daily"),
      )
      .order("desc")
      .take(31);

    const monthDays = dailyRollups.filter((r) => {
      const d = new Date(r.periodKey + "T00:00:00Z").getTime();
      return d >= monthStart && d < monthEnd;
    });

    if (monthDays.length === 0) return null;

    const avg = (field: keyof typeof monthDays[0]["metrics"]) => {
      const s = monthDays.reduce((acc, d) => acc + (d.metrics[field] as number), 0);
      return Math.round((s / monthDays.length) * 100) / 100;
    };
    const sum = (field: keyof typeof monthDays[0]["metrics"]) =>
      monthDays.reduce((acc, d) => acc + (d.metrics[field] as number), 0);

    const latest = monthDays[0].metrics;
    const metrics = {
      initiativeCount: latest.initiativeCount,
      initiativesActive: latest.initiativesActive,
      initiativesBlocked: latest.initiativesBlocked,
      initiativesCompleted: sum("initiativesCompleted"),
      interventionsSuggested: sum("interventionsSuggested"),
      interventionsStarted: sum("interventionsStarted"),
      interventionsCompleted: sum("interventionsCompleted"),
      signalsIngested: sum("signalsIngested"),
      avgSignalImportance: avg("avgSignalImportance"),
      identityConfidence: latest.identityConfidence,
      avgInitiativePriority: avg("avgInitiativePriority"),
      eventsRecorded: sum("eventsRecorded"),
      pathStepsRecorded: sum("pathStepsRecorded"),
      diffsRecorded: sum("diffsRecorded"),
      packetsGenerated: sum("packetsGenerated"),
      memosGenerated: sum("memosGenerated"),
      agentsHealthy: latest.agentsHealthy,
      agentsDrifting: latest.agentsDrifting,
      importantChangesDetected: sum("importantChangesDetected"),
      importantChangesResolved: sum("importantChangesResolved"),
    };

    // Compare vs prior month
    const priorMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
    const priorRollup = await ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q.eq("companyId", companyId).eq("periodType", "monthly").eq("periodKey", priorMonth),
      )
      .first();

    let deltas: {
      initiativeCountDelta: number;
      interventionsCompletedDelta: number;
      signalsIngestedDelta: number;
      identityConfidenceDelta: number;
      eventsRecordedDelta: number;
    } | undefined;

    if (priorRollup) {
      const pm = priorRollup.metrics;
      deltas = {
        initiativeCountDelta: metrics.initiativeCount - pm.initiativeCount,
        interventionsCompletedDelta: metrics.interventionsCompleted - pm.interventionsCompleted,
        signalsIngestedDelta: metrics.signalsIngested - pm.signalsIngested,
        identityConfidenceDelta: metrics.identityConfidence - pm.identityConfidence,
        eventsRecordedDelta: metrics.eventsRecorded - pm.eventsRecorded,
      };
    }

    const existing = await ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q.eq("companyId", companyId).eq("periodType", "monthly").eq("periodKey", monthKey),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { metrics, deltas });
      return existing._id;
    }

    return ctx.db.insert("founderTimeRollups", {
      companyId,
      periodType: "monthly",
      periodKey: monthKey,
      metrics,
      deltas,
      createdAt: Date.now(),
    });
  },
});

// ===========================================================================
// Quarterly Rollup Aggregator
// Cadence: 1st of each quarter
// Aggregates monthly rollups for a given quarter.
// ===========================================================================

export const computeQuarterlyRollup = internalMutation({
  args: {
    companyId: v.id("founderCompanies"),
    quarterKey: v.string(), // YYYY-Qn
  },
  handler: async (ctx, { companyId, quarterKey }) => {
    const [yearStr, qStr] = quarterKey.split("-Q");
    const year = parseInt(yearStr, 10);
    const quarter = parseInt(qStr, 10);
    const startMonth = (quarter - 1) * 3 + 1;
    const monthKeys = [
      `${year}-${String(startMonth).padStart(2, "0")}`,
      `${year}-${String(startMonth + 1).padStart(2, "0")}`,
      `${year}-${String(startMonth + 2).padStart(2, "0")}`,
    ];

    const monthlyRollups = await ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q.eq("companyId", companyId).eq("periodType", "monthly"),
      )
      .order("desc")
      .take(12);

    const qMonths = monthlyRollups.filter((r) => monthKeys.includes(r.periodKey));

    if (qMonths.length === 0) return null;

    const avg = (field: keyof typeof qMonths[0]["metrics"]) => {
      const s = qMonths.reduce((acc, d) => acc + (d.metrics[field] as number), 0);
      return Math.round((s / qMonths.length) * 100) / 100;
    };
    const sum = (field: keyof typeof qMonths[0]["metrics"]) =>
      qMonths.reduce((acc, d) => acc + (d.metrics[field] as number), 0);

    const latest = qMonths[0].metrics;
    const metrics = {
      initiativeCount: latest.initiativeCount,
      initiativesActive: latest.initiativesActive,
      initiativesBlocked: latest.initiativesBlocked,
      initiativesCompleted: sum("initiativesCompleted"),
      interventionsSuggested: sum("interventionsSuggested"),
      interventionsStarted: sum("interventionsStarted"),
      interventionsCompleted: sum("interventionsCompleted"),
      signalsIngested: sum("signalsIngested"),
      avgSignalImportance: avg("avgSignalImportance"),
      identityConfidence: latest.identityConfidence,
      avgInitiativePriority: avg("avgInitiativePriority"),
      eventsRecorded: sum("eventsRecorded"),
      pathStepsRecorded: sum("pathStepsRecorded"),
      diffsRecorded: sum("diffsRecorded"),
      packetsGenerated: sum("packetsGenerated"),
      memosGenerated: sum("memosGenerated"),
      agentsHealthy: latest.agentsHealthy,
      agentsDrifting: latest.agentsDrifting,
      importantChangesDetected: sum("importantChangesDetected"),
      importantChangesResolved: sum("importantChangesResolved"),
    };

    // Prior quarter
    const priorQ = quarter === 1 ? `${year - 1}-Q4` : `${year}-Q${quarter - 1}`;
    const priorRollup = await ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q.eq("companyId", companyId).eq("periodType", "quarterly").eq("periodKey", priorQ),
      )
      .first();

    let deltas: {
      initiativeCountDelta: number;
      interventionsCompletedDelta: number;
      signalsIngestedDelta: number;
      identityConfidenceDelta: number;
      eventsRecordedDelta: number;
    } | undefined;

    if (priorRollup) {
      const pm = priorRollup.metrics;
      deltas = {
        initiativeCountDelta: metrics.initiativeCount - pm.initiativeCount,
        interventionsCompletedDelta: metrics.interventionsCompleted - pm.interventionsCompleted,
        signalsIngestedDelta: metrics.signalsIngested - pm.signalsIngested,
        identityConfidenceDelta: metrics.identityConfidence - pm.identityConfidence,
        eventsRecordedDelta: metrics.eventsRecorded - pm.eventsRecorded,
      };
    }

    const existing = await ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q.eq("companyId", companyId).eq("periodType", "quarterly").eq("periodKey", quarterKey),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { metrics, deltas });
      return existing._id;
    }

    return ctx.db.insert("founderTimeRollups", {
      companyId,
      periodType: "quarterly",
      periodKey: quarterKey,
      metrics,
      deltas,
      createdAt: Date.now(),
    });
  },
});

// ===========================================================================
// Yearly Rollup Aggregator
// Cadence: Jan 1st
// Aggregates quarterly rollups for a given year.
// ===========================================================================

export const computeYearlyRollup = internalMutation({
  args: {
    companyId: v.id("founderCompanies"),
    yearKey: v.string(), // YYYY
  },
  handler: async (ctx, { companyId, yearKey }) => {
    const quarterKeys = [`${yearKey}-Q1`, `${yearKey}-Q2`, `${yearKey}-Q3`, `${yearKey}-Q4`];

    const quarterlyRollups = await ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q.eq("companyId", companyId).eq("periodType", "quarterly"),
      )
      .order("desc")
      .take(8);

    const yearQuarters = quarterlyRollups.filter((r) => quarterKeys.includes(r.periodKey));

    if (yearQuarters.length === 0) return null;

    const avg = (field: keyof typeof yearQuarters[0]["metrics"]) => {
      const s = yearQuarters.reduce((acc, d) => acc + (d.metrics[field] as number), 0);
      return Math.round((s / yearQuarters.length) * 100) / 100;
    };
    const sum = (field: keyof typeof yearQuarters[0]["metrics"]) =>
      yearQuarters.reduce((acc, d) => acc + (d.metrics[field] as number), 0);

    const latest = yearQuarters[0].metrics;
    const metrics = {
      initiativeCount: latest.initiativeCount,
      initiativesActive: latest.initiativesActive,
      initiativesBlocked: latest.initiativesBlocked,
      initiativesCompleted: sum("initiativesCompleted"),
      interventionsSuggested: sum("interventionsSuggested"),
      interventionsStarted: sum("interventionsStarted"),
      interventionsCompleted: sum("interventionsCompleted"),
      signalsIngested: sum("signalsIngested"),
      avgSignalImportance: avg("avgSignalImportance"),
      identityConfidence: latest.identityConfidence,
      avgInitiativePriority: avg("avgInitiativePriority"),
      eventsRecorded: sum("eventsRecorded"),
      pathStepsRecorded: sum("pathStepsRecorded"),
      diffsRecorded: sum("diffsRecorded"),
      packetsGenerated: sum("packetsGenerated"),
      memosGenerated: sum("memosGenerated"),
      agentsHealthy: latest.agentsHealthy,
      agentsDrifting: latest.agentsDrifting,
      importantChangesDetected: sum("importantChangesDetected"),
      importantChangesResolved: sum("importantChangesResolved"),
    };

    const priorYear = String(parseInt(yearKey, 10) - 1);
    const priorRollup = await ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q.eq("companyId", companyId).eq("periodType", "yearly").eq("periodKey", priorYear),
      )
      .first();

    let deltas: {
      initiativeCountDelta: number;
      interventionsCompletedDelta: number;
      signalsIngestedDelta: number;
      identityConfidenceDelta: number;
      eventsRecordedDelta: number;
    } | undefined;

    if (priorRollup) {
      const pm = priorRollup.metrics;
      deltas = {
        initiativeCountDelta: metrics.initiativeCount - pm.initiativeCount,
        interventionsCompletedDelta: metrics.interventionsCompleted - pm.interventionsCompleted,
        signalsIngestedDelta: metrics.signalsIngested - pm.signalsIngested,
        identityConfidenceDelta: metrics.identityConfidence - pm.identityConfidence,
        eventsRecordedDelta: metrics.eventsRecorded - pm.eventsRecorded,
      };
    }

    const existing = await ctx.db
      .query("founderTimeRollups")
      .withIndex("by_company_period", (q) =>
        q.eq("companyId", companyId).eq("periodType", "yearly").eq("periodKey", yearKey),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { metrics, deltas });
      return existing._id;
    }

    return ctx.db.insert("founderTimeRollups", {
      companyId,
      periodType: "yearly",
      periodKey: yearKey,
      metrics,
      deltas,
      createdAt: Date.now(),
    });
  },
});
