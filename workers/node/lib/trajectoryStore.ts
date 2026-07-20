/**
 * TrajectoryStore — SQLite-backed storage for search trajectories.
 *
 * Modeled on attrition.sh's TrajectoryLog/TrajectoryStep pattern but adapted
 * for NodeBench search pipeline trajectories. Enables replay detection and
 * savings measurement.
 */

import type { PipelineState } from "../pipeline/searchPipeline.js";
import { hashContent } from "./workflowEnvelope.js";

// ── Types ────────────────────────────────────────────────────────────

export interface SearchTrajectoryStep {
  stepIndex: number;
  step: string;
  tool?: string;
  status: string;
  detail?: string;
  durationMs: number;
  stateHashBefore?: string;
  stateHashAfter?: string;
  tokensUsed?: number;
}

export interface SearchTrajectory {
  trajectoryId: string;
  entityName: string;
  lens: string;
  query: string;
  classification?: string;
  envelopeId?: string;
  steps: SearchTrajectoryStep[];
  totalSteps: number;
  totalDurationMs: number;
  totalTokens: number;
  stateHashBefore?: string;
  stateHashAfter?: string;
  success: boolean;
  replayCount: number;
  avgTokenSavings: number;
  avgTimeSavings: number;
  driftScore: number;
  lastValidatedAt?: string;
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Constants ────────────────────────────────────────────────────────

const MAX_TRAJECTORIES = 300;
const EVICT_BATCH = 20;
const AVG_TOKENS_PER_PIPELINE_RUN = 31000;
export const TOKEN_COST_USD = 0.000004;

// ── DB (reuse canonical singleton) ───────────────────────────────────

import { getDb as getCanonicalDb } from "../../packages/mcp-local/src/db.js";

let _tableReady = false;

function getDb() {
  const db = getCanonicalDb();
  if (!_tableReady) {
    ensureTable(db);
    _tableReady = true;
  }
  return db;
}

function ensureTable(db: ReturnType<typeof getCanonicalDb>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_trajectories (
      trajectory_id     TEXT PRIMARY KEY,
      entity_name       TEXT NOT NULL,
      lens              TEXT NOT NULL,
      query             TEXT NOT NULL,
      classification    TEXT,
      envelope_id       TEXT,
      steps_json        TEXT NOT NULL DEFAULT '[]',
      total_steps       INTEGER NOT NULL DEFAULT 0,
      total_duration_ms INTEGER NOT NULL DEFAULT 0,
      total_tokens      INTEGER NOT NULL DEFAULT 0,
      state_hash_before TEXT,
      state_hash_after  TEXT,
      success           INTEGER NOT NULL DEFAULT 0,
      replay_count      INTEGER NOT NULL DEFAULT 0,
      avg_token_savings REAL NOT NULL DEFAULT 0.0,
      avg_time_savings  REAL NOT NULL DEFAULT 0.0,
      drift_score       REAL NOT NULL DEFAULT 0.0,
      last_validated_at TEXT,
      workspace_id      TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_traj_entity_lens ON search_trajectories(entity_name, lens, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_traj_query ON search_trajectories(query, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_traj_replay ON search_trajectories(replay_count DESC);
  `);
}

// ── ID generation ────────────────────────────────────────────────────

let _counter = 0;

function createTrajectoryId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  _counter = (_counter + 1) % 10000;
  return `traj_${ts}_${rand}_${_counter.toString(36)}`;
}

// ── State hashing (reuse deterministic hashContent from workflowEnvelope) ──

const hashState = hashContent;

// ── Bounded eviction ─────────────────────────────────────────────────

function evictIfNeeded(db: Database.Database): void {
  const count = (db.prepare("SELECT COUNT(*) as cnt FROM search_trajectories").get() as { cnt: number }).cnt;
  if (count >= MAX_TRAJECTORIES) {
    // Evict oldest with lowest replay_count first
    db.prepare(`
      DELETE FROM search_trajectories WHERE trajectory_id IN (
        SELECT trajectory_id FROM search_trajectories
        ORDER BY replay_count ASC, created_at ASC
        LIMIT ?
      )
    `).run(EVICT_BATCH);
  }
}

// ── Factory: PipelineState → SearchTrajectory ────────────────────────

export function trajectoryFromPipelineState(
  state: PipelineState,
  envelopeId?: string,
): SearchTrajectory {
  const now = new Date().toISOString();
  const steps: SearchTrajectoryStep[] = (state.trace ?? []).map((t, i) => ({
    stepIndex: i,
    step: t.step,
    tool: t.tool,
    status: t.status,
    detail: t.detail,
    durationMs: t.durationMs ?? 0,
  }));

  const totalTokens = steps.reduce((sum, s) => sum + (s.tokensUsed ?? 0), 0);

  // Hash the query+entity+lens as a state fingerprint
  const stateHashBefore = hashState({ query: state.query, entity: state.entity, lens: state.lens });
  const stateHashAfter = hashState({
    entityName: state.entityName,
    confidence: state.confidence,
    signalCount: (state.signals ?? []).length,
    sourceCount: (state.searchSources ?? []).length,
  });

  return {
    trajectoryId: createTrajectoryId(),
    entityName: state.entityName || state.entity || "unknown",
    lens: state.lens,
    query: state.query,
    classification: state.classification,
    envelopeId,
    steps,
    totalSteps: steps.length,
    totalDurationMs: state.totalDurationMs ?? 0,
    totalTokens,
    stateHashBefore,
    stateHashAfter,
    success: !state.error && (state.confidence ?? 0) >= 30,
    replayCount: 0,
    avgTokenSavings: 0,
    avgTimeSavings: 0,
    driftScore: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────

export function saveSearchTrajectory(trajectory: SearchTrajectory): string {
  const db = getDb();
  evictIfNeeded(db);

  db.prepare(`
    INSERT OR REPLACE INTO search_trajectories (
      trajectory_id, entity_name, lens, query, classification, envelope_id,
      steps_json, total_steps, total_duration_ms, total_tokens,
      state_hash_before, state_hash_after, success,
      replay_count, avg_token_savings, avg_time_savings, drift_score,
      last_validated_at, workspace_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    trajectory.trajectoryId,
    trajectory.entityName,
    trajectory.lens,
    trajectory.query,
    trajectory.classification ?? null,
    trajectory.envelopeId ?? null,
    JSON.stringify(trajectory.steps),
    trajectory.totalSteps,
    trajectory.totalDurationMs,
    trajectory.totalTokens,
    trajectory.stateHashBefore ?? null,
    trajectory.stateHashAfter ?? null,
    trajectory.success ? 1 : 0,
    trajectory.replayCount,
    trajectory.avgTokenSavings,
    trajectory.avgTimeSavings,
    trajectory.driftScore,
    trajectory.lastValidatedAt ?? null,
    trajectory.workspaceId ?? null,
    trajectory.createdAt,
    trajectory.updatedAt,
  );

  return trajectory.trajectoryId;
}

export function loadSearchTrajectory(trajectoryId: string): SearchTrajectory | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM search_trajectories WHERE trajectory_id = ?").get(trajectoryId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToTrajectory(row);
}

export function findTrajectoryByEntityLens(entityName: string, lens: string): SearchTrajectory | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM search_trajectories WHERE entity_name = ? AND lens = ? AND success = 1 ORDER BY created_at DESC LIMIT 1",
  ).get(entityName, lens) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToTrajectory(row);
}

export function updateReplayStats(
  trajectoryId: string,
  tokenSavings: number,
  timeSavings: number,
  driftScore: number,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  // Rolling average: new_avg = (old_avg * count + new) / (count + 1)
  db.prepare(`
    UPDATE search_trajectories SET
      replay_count = replay_count + 1,
      avg_token_savings = (avg_token_savings * replay_count + ?) / (replay_count + 1),
      avg_time_savings = (avg_time_savings * replay_count + ?) / (replay_count + 1),
      drift_score = ?,
      last_validated_at = ?,
      updated_at = ?
    WHERE trajectory_id = ?
  `).run(tokenSavings, timeSavings, driftScore, now, now, trajectoryId);
}

export function listTrajectories(filters?: {
  entityName?: string;
  limit?: number;
}): SearchTrajectory[] {
  const db = getDb();
  const limit = filters?.limit ?? 50;

  let sql = "SELECT * FROM search_trajectories";
  const params: unknown[] = [];

  if (filters?.entityName) {
    sql += " WHERE entity_name = ?";
    params.push(filters.entityName);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map(rowToTrajectory);
}

export function getTrajectoryStats(): {
  totalTrajectories: number;
  totalReplays: number;
  avgTokenSavingsPct: number;
  avgTimeSavingsPct: number;
} {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(replay_count), 0) as replays,
      COALESCE(AVG(CASE WHEN replay_count > 0 THEN avg_token_savings ELSE NULL END), 0) as avg_tok,
      COALESCE(AVG(CASE WHEN replay_count > 0 THEN avg_time_savings ELSE NULL END), 0) as avg_time
    FROM search_trajectories
  `).get() as { total: number; replays: number; avg_tok: number; avg_time: number };

  return {
    totalTrajectories: row.total,
    totalReplays: row.replays,
    avgTokenSavingsPct: Math.round(row.avg_tok * 100) / 100,
    avgTimeSavingsPct: Math.round(row.avg_time * 100) / 100,
  };
}

// ── Cost estimation (shared, not duplicated across routes) ───────────

export function estimateCostSaved(stats: { totalReplays: number; avgTokenSavingsPct: number }): number {
  return Math.round(stats.totalReplays * (stats.avgTokenSavingsPct / 100) * AVG_TOKENS_PER_PIPELINE_RUN * TOKEN_COST_USD * 100) / 100;
}

// ── Summary list (skips JSON.parse of steps_json) ────────────────────

export function listTrajectorySummaries(filters?: {
  entityName?: string;
  limit?: number;
}): Omit<SearchTrajectory, "steps">[] {
  const db = getDb();
  const limit = filters?.limit ?? 50;
  let sql = "SELECT trajectory_id, entity_name, lens, query, classification, envelope_id, total_steps, total_duration_ms, total_tokens, state_hash_before, state_hash_after, success, replay_count, avg_token_savings, avg_time_savings, drift_score, last_validated_at, workspace_id, created_at, updated_at FROM search_trajectories";
  const params: unknown[] = [];
  if (filters?.entityName) {
    sql += " WHERE entity_name = ?";
    params.push(filters.entityName);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...rowToTrajectory(row),
    steps: undefined as never,
  }));
}

// ── Row → type conversion ────────────────────────────────────────────

function rowToTrajectory(row: Record<string, unknown>): SearchTrajectory {
  return {
    trajectoryId: row.trajectory_id as string,
    entityName: row.entity_name as string,
    lens: row.lens as string,
    query: row.query as string,
    classification: (row.classification as string) ?? undefined,
    envelopeId: (row.envelope_id as string) ?? undefined,
    steps: JSON.parse((row.steps_json as string) || "[]"),
    totalSteps: (row.total_steps as number) ?? 0,
    totalDurationMs: (row.total_duration_ms as number) ?? 0,
    totalTokens: (row.total_tokens as number) ?? 0,
    stateHashBefore: (row.state_hash_before as string) ?? undefined,
    stateHashAfter: (row.state_hash_after as string) ?? undefined,
    success: !!(row.success as number),
    replayCount: (row.replay_count as number) ?? 0,
    avgTokenSavings: (row.avg_token_savings as number) ?? 0,
    avgTimeSavings: (row.avg_time_savings as number) ?? 0,
    driftScore: (row.drift_score as number) ?? 0,
    lastValidatedAt: (row.last_validated_at as string) ?? undefined,
    workspaceId: (row.workspace_id as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
