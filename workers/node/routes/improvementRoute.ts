/**
 * Improvement Timeline API — Aggregates trajectory, eval, and archive data
 * into a unified improvement story.
 *
 * GET /stats — Returns summary, timeline events, quality/savings curves,
 *              replay adoption, and promotion funnel.
 */

import { Router, type Request, type Response } from "express";
import { getTrajectoryStats, listTrajectorySummaries, estimateCostSaved } from "../lib/trajectoryStore.js";
import { getArchiveStats, listTopEntries } from "../../packages/mcp-local/src/sync/hyperloopArchive.js";
import { listRecentEvaluations } from "../../packages/mcp-local/src/sync/hyperloopEval.js";

// Cost constant moved to trajectoryStore.ts — use estimateCostSaved()

interface TimelineEvent {
  id: string;
  timestamp: string;
  type: "trajectory_recorded" | "replay_success" | "eval_improvement" | "eval_regression" | "archive_promotion";
  entityName: string | null;
  classification: string | null;
  before: { qualityScore?: number; durationMs?: number; tokenCount?: number };
  after: { qualityScore?: number; durationMs?: number; tokenCount?: number };
  delta: { qualityDelta?: number; timeSavedMs?: number; tokensSavedPct?: number };
  details: {
    toolsCalled?: string[];
    sourcesCited?: number;
    claims?: number;
    suggestions?: string[];
    lens?: string;
    query?: string;
    driftScore?: number;
    scoreComponents?: Array<{ key: string; label: string; weightedContribution: number }>;
  };
}

export function createImprovementRouter(): Router {
  const router = Router();

  router.get("/stats", (_req: Request, res: Response) => {
    try {
      // ── Gather data from all three stores ──────────────────────────
      const trajStats = getTrajectoryStats();
      const trajectories = listTrajectorySummaries({ limit: 50 });
      const archiveStats = getArchiveStats();
      const archiveEntries = listTopEntries(undefined, 50);
      const recentEvals = listRecentEvaluations(50);

      // ── Build unified timeline ─────────────────────────────────────
      const timeline: TimelineEvent[] = [];

      // Trajectory events
      for (const t of trajectories) {
        timeline.push({
          id: `traj_${t.trajectoryId}`,
          timestamp: t.createdAt,
          type: "trajectory_recorded",
          entityName: t.entityName,
          classification: t.classification ?? null,
          before: {},
          after: { durationMs: t.totalDurationMs, tokenCount: t.totalTokens },
          delta: {},
          details: {
            lens: t.lens,
            query: t.query,
            driftScore: t.driftScore,
          },
        });

        if (t.replayCount > 0) {
          timeline.push({
            id: `replay_${t.trajectoryId}`,
            timestamp: t.lastValidatedAt ?? t.updatedAt,
            type: "replay_success",
            entityName: t.entityName,
            classification: t.classification ?? null,
            before: { durationMs: t.totalDurationMs },
            after: { durationMs: Math.round(t.totalDurationMs * (1 - t.avgTimeSavings / 100)) },
            delta: { timeSavedMs: Math.round(t.totalDurationMs * t.avgTimeSavings / 100), tokensSavedPct: t.avgTokenSavings },
            details: {
              lens: t.lens,
              query: t.query,
              driftScore: t.driftScore,
            },
          });
        }
      }

      // Eval events
      for (const ev of recentEvals) {
        const isImprovement = (ev.improvementDelta ?? 0) > 0;
        timeline.push({
          id: `eval_${ev.evalId}`,
          timestamp: ev.timestamp,
          type: isImprovement ? "eval_improvement" : "eval_regression",
          entityName: ev.entity ?? null,
          classification: ev.classification ?? null,
          before: { qualityScore: Math.max(0, (ev.qualityScore ?? 0) - (ev.improvementDelta ?? 0)) },
          after: { qualityScore: ev.qualityScore },
          delta: { qualityDelta: ev.improvementDelta },
          details: {
            query: ev.query,
            sourcesCited: ev.toolCallCount,
            scoreComponents: ev.scoreComponents?.map((sc: any) => ({
              key: sc.key,
              label: sc.label,
              weightedContribution: sc.weightedContribution,
            })),
            suggestions: ev.llmJudge?.fixSuggestions,
          },
        });
      }

      // Archive promotion events
      for (const entry of archiveEntries) {
        if (entry.status === "promoted" || entry.status === "validated") {
          timeline.push({
            id: `archive_${entry.id}`,
            timestamp: entry.updatedAt,
            type: "archive_promotion",
            entityName: entry.sourceEntity ?? null,
            classification: null,
            before: {},
            after: { qualityScore: entry.qualityScore },
            delta: { qualityDelta: entry.improvementDelta },
            details: {
              query: entry.sourceQuery,
              lens: entry.sourceLens,
              claims: entry.contradictionsCaught,
              sourcesCited: Math.round(entry.evidenceCoverage * 10),
            },
          });
        }
      }

      // Sort by timestamp descending, cap at 200
      timeline.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const boundedTimeline = timeline.slice(0, 200);

      // ── Quality curve (rolling avg from evals) ─────────────────────
      // O(n) rolling window — no array allocation per iteration
      const sortedEvals = [...recentEvals].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const qualityCurve: Array<{ timestamp: string; avgQuality: number; sampleSize: number }> = [];
      const w = 5;
      let runningSum = 0;
      for (let i = 0; i < sortedEvals.length; i++) {
        runningSum += sortedEvals[i]!.qualityScore ?? 0;
        if (i >= w) runningSum -= sortedEvals[i - w]!.qualityScore ?? 0;
        const count = Math.min(i + 1, w);
        qualityCurve.push({
          timestamp: sortedEvals[i]!.timestamp,
          avgQuality: Math.round((runningSum / count) * 1000) / 1000,
          sampleSize: count,
        });
      }

      // ── Savings curve (cumulative from trajectories) ───────────────
      const sortedTrajs = [...trajectories].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      let cumReplays = 0;
      let cumTokenPct = 0;
      let cumTimePct = 0;
      const savingsCurve: Array<{ timestamp: string; cumulativeTokensSavedPct: number; cumulativeTimeSavedPct: number; cumulativeReplays: number }> = [];
      for (const t of sortedTrajs) {
        cumReplays += t.replayCount;
        if (t.replayCount > 0) {
          cumTokenPct += t.avgTokenSavings * t.replayCount;
          cumTimePct += t.avgTimeSavings * t.replayCount;
        }
        savingsCurve.push({
          timestamp: t.createdAt,
          cumulativeTokensSavedPct: cumReplays > 0 ? Math.round(cumTokenPct / cumReplays * 10) / 10 : 0,
          cumulativeTimeSavedPct: cumReplays > 0 ? Math.round(cumTimePct / cumReplays * 10) / 10 : 0,
          cumulativeReplays: cumReplays,
        });
      }

      // ── Replay adoption ────────────────────────────────────────────
      const replayed = trajectories.filter((t) => t.replayCount > 0).length;
      const total = trajectories.length;

      // ── Promotion funnel ───────────────────────────────────────────
      const byStatus = archiveStats.byStatus as Record<string, number>;

      // ── Average quality ────────────────────────────────────────────
      const avgQuality = recentEvals.length > 0
        ? recentEvals.reduce((sum, e) => sum + (e.qualityScore ?? 0), 0) / recentEvals.length
        : 0;

      res.json({
        summary: {
          totalTrajectories: trajStats.totalTrajectories,
          totalReplays: trajStats.totalReplays,
          avgTokenSavingsPct: trajStats.avgTokenSavingsPct,
          avgTimeSavingsPct: trajStats.avgTimeSavingsPct,
          estimatedCostSavedUsd: estimateCostSaved(trajStats),
          avgQualityScore: Math.round(avgQuality * 100) / 100,
          archiveTotal: archiveStats.total,
          promotedCount: byStatus.promoted ?? 0,
          validatedCount: byStatus.validated ?? 0,
          candidateCount: byStatus.candidate ?? 0,
          totalEvaluations: recentEvals.length,
        },
        timeline: boundedTimeline,
        qualityCurve,
        savingsCurve,
        replayAdoption: {
          total,
          replayed,
          fullPipeline: total - replayed,
          replayPct: total > 0 ? Math.round((replayed / total) * 1000) / 10 : 0,
        },
        promotionFunnel: {
          candidates: byStatus.candidate ?? 0,
          validated: byStatus.validated ?? 0,
          promoted: byStatus.promoted ?? 0,
          retired: byStatus.retired ?? 0,
        },
      });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: "Improvement stats failed", detail: String(err) });
      }
    }
  });

  return router;
}
