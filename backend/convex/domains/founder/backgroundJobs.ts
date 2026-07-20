/**
 * Founder Platform — Background Proactive Insight Jobs
 *
 * These are the scheduled/triggered jobs that make NodeBench proactive.
 * Each job runs on a cadence and writes insights, alerts, or memos
 * back into the founder's workspace without requiring manual prompting.
 *
 * Phase 1 stubs — wired to Convex internal mutations.
 * Phase 2 will connect to LLM inference for real synthesis.
 */

import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";

// ── Constants ────────────────────────────────────────────────────────
const MAX_SIGNALS_PER_CLUSTER = 100;
const MAX_INITIATIVES_PER_COMPANY = 50;
const MAX_AGENTS_PER_WORKSPACE = 50;
const MAX_TIMELINE_EVENTS = 200;

// ── Identity Drift Monitor ──────────────────────────────────────────
// Cadence: event-driven (on initiative/signal changes)
// Detects mismatch between declared company wedge and actual initiative behavior
export const checkIdentityDrift = internalMutation({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get(companyId);
    if (!company) return null;

    const initiatives = await ctx.db
      .query("founderInitiatives")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(MAX_INITIATIVES_PER_COMPANY);

    const activeInitiatives = initiatives.filter((i) => i.status === "active");

    // Phase 1: Simple heuristic — if >50% of active initiatives
    // don't mention keywords from the wedge, flag drift
    const wedgeKeywords = company.wedge
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4);

    let alignedCount = 0;
    for (const init of activeInitiatives) {
      const text = `${init.title} ${init.objective}`.toLowerCase();
      const matches = wedgeKeywords.filter((kw) => text.includes(kw));
      if (matches.length >= 2) alignedCount++;
    }

    const alignmentRatio =
      activeInitiatives.length > 0
        ? alignedCount / activeInitiatives.length
        : 1;

    if (alignmentRatio < 0.5) {
      // Create a drift alert as a timeline event
      await ctx.db.insert("founderTimelineEvents", {
        workspaceId: company.workspaceId,
        companyId,
        entityType: "company",
        entityId: companyId,
        eventType: "identity_drift_detected",
        summary: `Identity drift: only ${Math.round(alignmentRatio * 100)}% of active initiatives align with wedge "${company.wedge}". Consider reviewing company direction.`,
        evidenceRefs: activeInitiatives
          .filter((i) => {
            const text = `${i.title} ${i.objective}`.toLowerCase();
            return wedgeKeywords.filter((kw) => text.includes(kw)).length < 2;
          })
          .map((i) => i._id),
        createdAt: Date.now(),
      });

      // Lower identity confidence
      if (company.identityConfidence > 0.3) {
        await ctx.db.patch(companyId, {
          identityConfidence: Math.max(
            0.2,
            company.identityConfidence - 0.1,
          ),
          updatedAt: Date.now(),
        });
      }
    }

    return { alignmentRatio, driftDetected: alignmentRatio < 0.5 };
  },
});

// ── Initiative Health Monitor ───────────────────────────────────────
// Cadence: every 4 hours
// Classifies initiative state and trend
export const refreshInitiativeHealth = internalMutation({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    const initiatives = await ctx.db
      .query("founderInitiatives")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(MAX_INITIATIVES_PER_COMPANY);

    const results: Array<{
      id: string;
      title: string;
      healthScore: number;
      recommendation: string;
    }> = [];

    for (const init of initiatives) {
      if (init.status === "archived" || init.status === "completed") continue;

      // Phase 1: Heuristic health scoring
      let healthScore = 0.5;

      // Active = base health
      if (init.status === "active") healthScore += 0.2;
      if (init.status === "blocked") healthScore -= 0.3;
      if (init.status === "paused") healthScore -= 0.1;

      // Risk level impact
      if (init.riskLevel === "low") healthScore += 0.1;
      if (init.riskLevel === "high") healthScore -= 0.2;

      // Priority weighting
      healthScore += init.priorityScore * 0.2;

      healthScore = Math.max(0, Math.min(1, healthScore));

      let recommendation = "On track";
      if (healthScore < 0.3) recommendation = "Needs immediate attention";
      else if (healthScore < 0.5) recommendation = "At risk — review blockers";
      else if (healthScore < 0.7) recommendation = "Monitor closely";

      results.push({
        id: init._id,
        title: init.title,
        healthScore,
        recommendation,
      });
    }

    return results;
  },
});

// ── Agent Drift Monitor ─────────────────────────────────────────────
// Cadence: every 15 minutes
// Detects agents producing output disconnected from founder goals
export const checkAgentDrift = internalMutation({
  args: { workspaceId: v.id("founderWorkspaces") },
  handler: async (ctx, { workspaceId }) => {
    const agents = await ctx.db
      .query("founderAgents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(MAX_AGENTS_PER_WORKSPACE);

    const now = Date.now();
    const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

    for (const agent of agents) {
      if (agent.status === "healthy" && agent.lastHeartbeatAt) {
        const timeSinceHeartbeat = now - agent.lastHeartbeatAt;

        if (timeSinceHeartbeat > STALE_THRESHOLD_MS) {
          // Mark as drifting if no heartbeat in 30 min
          await ctx.db.patch(agent._id, {
            status: "ambiguous",
            updatedAt: now,
          });

          await ctx.db.insert("founderTimelineEvents", {
            workspaceId,
            companyId: agent.companyId,
            entityType: "agent",
            entityId: agent._id,
            eventType: "agent_heartbeat_stale",
            summary: `Agent "${agent.name}" has not sent a heartbeat in ${Math.round(timeSinceHeartbeat / 60000)} minutes. Status changed to ambiguous.`,
            evidenceRefs: [],
            createdAt: now,
          });
        }
      }
    }
  },
});

// ── Priority Ranking Refresh ────────────────────────────────────────
// Cadence: every 4 hours
// Re-ranks suggested interventions based on current state
export const refreshInterventionRanking = internalMutation({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    const interventions = await ctx.db
      .query("founderInterventions")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(50);

    const suggested = interventions.filter((i) => i.status === "suggested");

    // Phase 1: Sort by priorityScore * confidence
    const ranked = suggested
      .map((i) => ({
        ...i,
        compositeScore: i.priorityScore * i.confidence,
      }))
      .sort((a, b) => b.compositeScore - a.compositeScore);

    // Update priority scores based on ranking
    for (let idx = 0; idx < ranked.length; idx++) {
      const normalizedScore = 1 - idx / Math.max(ranked.length, 1);
      await ctx.db.patch(ranked[idx]._id, {
        priorityScore: Math.round(normalizedScore * 100) / 100,
        updatedAt: Date.now(),
      });
    }

    return ranked.slice(0, 5).map((r) => ({
      id: r._id,
      title: r.title,
      compositeScore: r.compositeScore,
    }));
  },
});

// ── Daily Founder Memo Generator ────────────────────────────────────
// Cadence: daily (configured by founder)
// Compresses last 24h into an actionable brief
export const generateDailyMemo = internalMutation({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get(companyId);
    if (!company) return null;

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    // Gather recent timeline events
    const recentEvents = await ctx.db
      .query("founderTimelineEvents")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(MAX_TIMELINE_EVENTS);

    const last24h = recentEvents.filter((e) => e.createdAt > oneDayAgo);

    // Gather active initiatives
    const initiatives = await ctx.db
      .query("founderInitiatives")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(MAX_INITIATIVES_PER_COMPANY);

    const activeInitiatives = initiatives.filter((i) => i.status === "active");
    const blockedInitiatives = initiatives.filter(
      (i) => i.status === "blocked",
    );

    // Gather pending actions
    const pendingActions = await ctx.db
      .query("founderPendingActions")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(50);

    const openActions = pendingActions.filter((a) => a.status === "open");

    // Phase 1: Template-based memo (Phase 2 will use LLM synthesis)
    const topPriorities = [
      `${activeInitiatives.length} active initiatives, ${blockedInitiatives.length} blocked`,
      ...(blockedInitiatives.length > 0
        ? [
            `Blocked: ${blockedInitiatives.map((i) => i.title).join(", ")}`,
          ]
        : []),
      `${openActions.length} pending actions awaiting attention`,
      `${last24h.length} events in the last 24 hours`,
    ].slice(0, 5);

    const topRisks = [
      ...(blockedInitiatives.length > 0
        ? ["Blocked initiatives may delay dependent work"]
        : []),
      ...(company.identityConfidence < 0.6
        ? ["Company identity confidence is low — consider clarifying wedge"]
        : []),
      ...(openActions.length > 10
        ? ["Action backlog growing — prioritize or defer"]
        : []),
    ].slice(0, 5);

    const openQuestions = [
      ...(company.companyState === "forming"
        ? ["Is the current wedge sharp enough to differentiate?"]
        : []),
      ...(blockedInitiatives.length > 0
        ? blockedInitiatives.map(
            (i) => `What's blocking "${i.title}"?`,
          )
        : []),
      "Are the current initiatives aligned with the quarterly goal?",
    ].slice(0, 5);

    const summary = `Daily briefing for ${company.name}: ${activeInitiatives.length} active initiatives, ${last24h.length} events today. ${topRisks.length > 0 ? `Top risk: ${topRisks[0]}` : "No critical risks."}`;

    // Create the snapshot
    const snapshotId = await ctx.db.insert("founderContextSnapshots", {
      companyId,
      snapshotType: "daily",
      summary,
      topPriorities,
      topRisks,
      openQuestions,
      createdAt: now,
    });

    // Record timeline event
    await ctx.db.insert("founderTimelineEvents", {
      workspaceId: company.workspaceId,
      companyId,
      entityType: "snapshot",
      entityId: snapshotId,
      eventType: "daily_memo_generated",
      summary: `Daily briefing generated: ${summary}`,
      evidenceRefs: [],
      createdAt: now,
    });

    return { snapshotId, summary, topPriorities, topRisks, openQuestions };
  },
});

// ── Signal Clustering ───────────────────────────────────────────────
// Cadence: every 1 hour
// Groups similar signals and assigns importance
export const clusterSignals = internalQuery({
  args: { companyId: v.id("founderCompanies") },
  handler: async (ctx, { companyId }) => {
    const signals = await ctx.db
      .query("founderSignals")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(MAX_SIGNALS_PER_CLUSTER);

    // Phase 1: Group by sourceType
    const clusters: Record<string, typeof signals> = {};
    for (const signal of signals) {
      const key = signal.sourceType;
      if (!clusters[key]) clusters[key] = [];
      clusters[key].push(signal);
    }

    return Object.entries(clusters).map(([sourceType, sigs]) => ({
      sourceType,
      count: sigs.length,
      avgImportance:
        sigs.reduce((sum, s) => sum + s.importanceScore, 0) / sigs.length,
      latest: sigs[0],
    }));
  },
});
