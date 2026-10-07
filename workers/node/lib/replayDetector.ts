/**
 * ReplayDetector — Determines whether a search query can be served from
 * a cached trajectory (cheap) vs requiring a full pipeline run (expensive).
 *
 * Modeled on attrition.sh's exploration memory pattern:
 * - driftScore < 0.3 AND staleness < 7d → replay
 * - driftScore < 0.6 AND staleness < 14d → replay_with_fallback
 * - Otherwise → full_pipeline
 *
 * Also provides savings measurement following attrition's ta.savings.compare
 * A/B pattern (honest comparison: same test, different modes).
 */

import { findTrajectoryByEntityLens, type SearchTrajectory } from "./trajectoryStore.js";
import type { PipelineState } from "../pipeline/searchPipeline.js";

// ── Types ────────────────────────────────────────────────────────────

export type ReplayVerdict = "replay" | "replay_with_fallback" | "full_pipeline";

export interface ReplayCandidate {
  trajectoryId: string;
  entityName: string;
  lens: string;
  stalenessDays: number;
  replayCount: number;
  avgTokenSavings: number;
  driftScore: number;
  verdict: ReplayVerdict;
  reason: string;
}

export interface SavingsMeasurement {
  fullPipelineMs: number;
  fullPipelineTokens: number;
  replayMs: number;
  replayTokens: number;
  timeSavedMs: number;
  timeSavedPct: number;
  tokensSaved: number;
  tokensSavedPct: number;
  trajectoryId: string;
  replayCount: number;
}

// ── Constants ────────────────────────────────────────────────────────

const REPLAY_DRIFT_THRESHOLD = 0.3;
const FALLBACK_DRIFT_THRESHOLD = 0.6;
const REPLAY_STALENESS_DAYS = 7;
const FALLBACK_STALENESS_DAYS = 14;

// ── Replay detection ─────────────────────────────────────────────────

export function detectReplayCandidate(
  entityName: string,
  lens: string,
  _query: string,
): ReplayCandidate | null {
  const trajectory = findTrajectoryByEntityLens(entityName, lens);
  if (!trajectory) return null;

  const stalenessDays = computeStalenessDays(trajectory.createdAt);
  const { driftScore, replayCount, avgTokenSavings } = trajectory;

  let verdict: ReplayVerdict;
  let reason: string;

  if (driftScore < REPLAY_DRIFT_THRESHOLD && stalenessDays < REPLAY_STALENESS_DAYS) {
    verdict = "replay";
    reason = `Low drift (${driftScore.toFixed(2)}) and fresh (${stalenessDays.toFixed(1)}d). Safe to replay.`;
  } else if (driftScore < FALLBACK_DRIFT_THRESHOLD && stalenessDays < FALLBACK_STALENESS_DAYS) {
    verdict = "replay_with_fallback";
    reason = `Moderate drift (${driftScore.toFixed(2)}) or aging (${stalenessDays.toFixed(1)}d). Try replay, fall back on divergence.`;
  } else {
    verdict = "full_pipeline";
    reason = driftScore >= FALLBACK_DRIFT_THRESHOLD
      ? `High drift (${driftScore.toFixed(2)}). Full pipeline needed.`
      : `Stale trajectory (${stalenessDays.toFixed(1)}d). Full pipeline needed.`;
  }

  return {
    trajectoryId: trajectory.trajectoryId,
    entityName: trajectory.entityName,
    lens: trajectory.lens,
    stalenessDays,
    replayCount,
    avgTokenSavings,
    driftScore,
    verdict,
    reason,
  };
}

// ── Savings measurement ──────────────────────────────────────────────

/**
 * Honest A/B savings measurement: same entity, full pipeline vs replay.
 * Mirrors attrition's ta.savings.compare pattern.
 */
export function computeSavings(
  fullState: PipelineState,
  replayDurationMs: number,
  replayTokens: number,
  trajectoryId: string,
  replayCount: number,
): SavingsMeasurement {
  const fullMs = fullState.totalDurationMs ?? 0;
  const fullTokens = estimateTokens(fullState);

  const timeSavedMs = Math.max(0, fullMs - replayDurationMs);
  const tokensSaved = Math.max(0, fullTokens - replayTokens);

  return {
    fullPipelineMs: fullMs,
    fullPipelineTokens: fullTokens,
    replayMs: replayDurationMs,
    replayTokens,
    timeSavedMs,
    timeSavedPct: fullMs > 0 ? Math.round((timeSavedMs / fullMs) * 100 * 10) / 10 : 0,
    tokensSaved,
    tokensSavedPct: fullTokens > 0 ? Math.round((tokensSaved / fullTokens) * 100 * 10) / 10 : 0,
    trajectoryId,
    replayCount,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function computeStalenessDays(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  return (now - created) / (1000 * 60 * 60 * 24);
}

/**
 * Rough token estimate based on pipeline state content.
 * Uses the approximation: 1 token ≈ 4 chars for English text.
 */
function estimateTokens(state: PipelineState): number {
  let chars = 0;
  chars += (state.query ?? "").length;
  chars += (state.answer ?? "").length;
  chars += (state.searchAnswer ?? "").length;
  for (const src of state.searchSources ?? []) {
    chars += (src.content ?? "").length;
  }
  for (const sig of state.signals ?? []) {
    chars += (sig.name ?? "").length;
  }
  return Math.ceil(chars / 4);
}
