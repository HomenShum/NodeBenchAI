import fs from "node:fs";
import path from "node:path";

import { genId, getDb } from "../../packages/mcp-local/src/db.js";
import type { HarnessPlan, HarnessStepResult } from "../agentHarness.js";

export interface HarnessTraceDistillationRecord {
  distillationId: string;
  source: string;
  sessionId?: string;
  turnIndex?: number;
  createdAt: string;
}

const FALLBACK_DIR = path.join(process.cwd(), ".tmp", "harness-v2");
const FALLBACK_FILE = path.join(FALLBACK_DIR, "harness_trace_distillations.json");

function readFallbackRecords(): HarnessTraceDistillationRecord[] {
  try {
    const raw = fs.readFileSync(FALLBACK_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HarnessTraceDistillationRecord[]) : [];
  } catch {
    return [];
  }
}

function writeFallbackRecords(records: HarnessTraceDistillationRecord[]): void {
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  fs.writeFileSync(FALLBACK_FILE, JSON.stringify(records, null, 2));
}

function ensureTable() {
  try {
    const db = getDb();
    db.exec(`
    CREATE TABLE IF NOT EXISTS harness_trace_distillations (
      distillation_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      session_id TEXT,
      turn_index INTEGER,
      query TEXT NOT NULL,
      classification TEXT NOT NULL,
      lens TEXT NOT NULL,
      entities_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
    return db;
  } catch {
    return null;
  }
}

export function saveHarnessTraceDistillation(args: {
  source: string;
  sessionId?: string;
  turnIndex?: number;
  query: string;
  classification: string;
  lens: string;
  entities: string[];
  plan: HarnessPlan;
  stepResults: HarnessStepResult[];
  synthesizedResult: unknown;
}): HarnessTraceDistillationRecord {
  const db = ensureTable();
  const now = new Date().toISOString();
  const distillationId = genId("distill");
  const payload = {
    format: "nodebench-harness-v2",
    targetFamily: "gemma-4-function-calling",
    objective: args.plan.objective,
    synthesisPrompt: args.plan.synthesisPrompt,
    messages: [
      {
        role: "user",
        content: args.query,
      },
    ],
    toolPlan: args.plan.steps.map((step) => ({
      id: step.id,
      toolName: step.toolName,
      purpose: step.purpose,
      stepIndex: step.stepIndex ?? 0,
      groupId: step.groupId ?? null,
      dependsOn: step.dependsOn ?? [],
      injectPriorResults: step.injectPriorResults ?? [],
      acceptsSteering: Boolean(step.acceptsSteering),
    })),
    toolExecutions: args.stepResults.map((step) => ({
      stepId: step.stepId,
      toolName: step.toolName,
      success: step.success,
      durationMs: step.durationMs,
      model: step.model ?? null,
      tokensIn: step.tokensIn ?? 0,
      tokensOut: step.tokensOut ?? 0,
      costUsd: step.costUsd ?? 0,
      injectedContext: step.injectedContext ?? [],
      steeringApplied: Boolean(step.steeringApplied),
      preview: step.preview ?? null,
      error: step.error ?? null,
    })),
    finalAnswer: args.synthesizedResult,
    qualityGate: {
      allStepsSucceeded: args.stepResults.every((step) => step.success),
      successfulSteps: args.stepResults.filter((step) => step.success).length,
      totalSteps: args.stepResults.length,
    },
  };

  if (!db) {
    const record: HarnessTraceDistillationRecord = {
      distillationId,
      source: args.source,
      sessionId: args.sessionId,
      turnIndex: args.turnIndex,
      createdAt: now,
    };
    const next = [record, ...readFallbackRecords()].slice(0, 500);
    writeFallbackRecords(next);
    return record;
  }

  db.prepare(`
    INSERT INTO harness_trace_distillations (
      distillation_id, source, session_id, turn_index, query, classification, lens,
      entities_json, payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    distillationId,
    args.source,
    args.sessionId ?? null,
    args.turnIndex ?? null,
    args.query,
    args.classification,
    args.lens,
    JSON.stringify(args.entities),
    JSON.stringify(payload),
    now,
    now,
  );

  return {
    distillationId,
    source: args.source,
    sessionId: args.sessionId,
    turnIndex: args.turnIndex,
    createdAt: now,
  };
}
