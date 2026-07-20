import fs from "node:fs";
import path from "node:path";

import { genId, getDb } from "../../packages/mcp-local/src/db.js";
import type { HarnessPlan, HarnessStepResult } from "../agentHarness.js";

export interface ExtractedSkillTemplateRecord {
  extractedSkillId: string;
  signature: string;
  classification: string;
  lens: string;
  source: string;
  sessionId?: string;
  turnIndex?: number;
  createdAt: string;
}

const FALLBACK_DIR = path.join(process.cwd(), ".tmp", "harness-v2");
const FALLBACK_FILE = path.join(FALLBACK_DIR, "extracted_skill_templates.json");

function readFallbackRecords(): ExtractedSkillTemplateRecord[] {
  try {
    const raw = fs.readFileSync(FALLBACK_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ExtractedSkillTemplateRecord[]) : [];
  } catch {
    return [];
  }
}

function writeFallbackRecords(records: ExtractedSkillTemplateRecord[]): void {
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  fs.writeFileSync(FALLBACK_FILE, JSON.stringify(records, null, 2));
}

function ensureTable() {
  try {
    const db = getDb();
    db.exec(`
    CREATE TABLE IF NOT EXISTS extracted_skill_templates (
      extracted_skill_id TEXT PRIMARY KEY,
      signature TEXT NOT NULL UNIQUE,
      classification TEXT NOT NULL,
      lens TEXT NOT NULL,
      source TEXT NOT NULL,
      session_id TEXT,
      turn_index INTEGER,
      query TEXT NOT NULL,
      entities_json TEXT NOT NULL,
      tool_chain_json TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      quality_json TEXT NOT NULL,
      synthesized_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
    return db;
  } catch {
    return null;
  }
}

function buildSignature(plan: HarnessPlan, lens: string): string {
  const toolChain = plan.steps.map((step) => step.toolName).join(">");
  return `${plan.classification}:${lens}:${toolChain}`;
}

export function shouldExtractSkillTemplate(args: {
  plan: HarnessPlan;
  stepResults: HarnessStepResult[];
  synthesizedResult: unknown;
}): boolean {
  if (args.plan.steps.length < 2) return false;
  if (args.stepResults.length < args.plan.steps.length) return false;
  if (args.stepResults.some((step) => !step.success)) return false;
  if (!args.synthesizedResult || typeof args.synthesizedResult !== "object") return false;
  return true;
}

export function saveExtractedSkillTemplate(args: {
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
}): ExtractedSkillTemplateRecord {
  const db = ensureTable();
  const now = new Date().toISOString();
  const signature = buildSignature(args.plan, args.lens);
  const toolChain = args.plan.steps.map((step) => ({
    id: step.id,
    toolName: step.toolName,
    stepIndex: step.stepIndex ?? 0,
    groupId: step.groupId ?? null,
    dependsOn: step.dependsOn ?? [],
    injectPriorResults: step.injectPriorResults ?? [],
    acceptsSteering: Boolean(step.acceptsSteering),
  }));
  const quality = {
    totalSteps: args.plan.steps.length,
    totalSuccessfulSteps: args.stepResults.filter((step) => step.success).length,
    totalCostUsd: args.stepResults.reduce((sum, step) => sum + (step.costUsd ?? 0), 0),
    totalDurationMs: args.stepResults.reduce((sum, step) => sum + step.durationMs, 0),
  };

  if (!db) {
    const records = readFallbackRecords();
    const existing = records.find((record) => record.signature === signature);
    const record: ExtractedSkillTemplateRecord = {
      extractedSkillId: existing?.extractedSkillId ?? genId("xskill"),
      signature,
      classification: args.classification,
      lens: args.lens,
      source: args.source,
      sessionId: args.sessionId,
      turnIndex: args.turnIndex,
      createdAt: existing?.createdAt ?? now,
    };
    const next = [record, ...records.filter((entry) => entry.signature !== signature)].slice(0, 200);
    writeFallbackRecords(next);
    return record;
  }

  const existing = db.prepare(
    "SELECT extracted_skill_id FROM extracted_skill_templates WHERE signature = ?",
  ).get(signature) as { extracted_skill_id?: string } | undefined;
  const extractedSkillId = existing?.extracted_skill_id ?? genId("xskill");

  db.prepare(`
    INSERT INTO extracted_skill_templates (
      extracted_skill_id, signature, classification, lens, source, session_id, turn_index,
      query, entities_json, tool_chain_json, plan_json, quality_json, synthesized_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(signature) DO UPDATE SET
      classification = excluded.classification,
      lens = excluded.lens,
      source = excluded.source,
      session_id = excluded.session_id,
      turn_index = excluded.turn_index,
      query = excluded.query,
      entities_json = excluded.entities_json,
      tool_chain_json = excluded.tool_chain_json,
      plan_json = excluded.plan_json,
      quality_json = excluded.quality_json,
      synthesized_json = excluded.synthesized_json,
      updated_at = excluded.updated_at
  `).run(
    extractedSkillId,
    signature,
    args.classification,
    args.lens,
    args.source,
    args.sessionId ?? null,
    args.turnIndex ?? null,
    args.query,
    JSON.stringify(args.entities),
    JSON.stringify(toolChain),
    JSON.stringify(args.plan),
    JSON.stringify(quality),
    JSON.stringify(args.synthesizedResult),
    now,
    now,
  );

  return {
    extractedSkillId,
    signature,
    classification: args.classification,
    lens: args.lens,
    source: args.source,
    sessionId: args.sessionId,
    turnIndex: args.turnIndex,
    createdAt: now,
  };
}

export function listExtractedSkillTemplates(limit = 20): ExtractedSkillTemplateRecord[] {
  const db = ensureTable();
  if (!db) {
    return readFallbackRecords().slice(0, Math.max(1, Math.min(limit, 100)));
  }
  return (db.prepare(`
    SELECT extracted_skill_id, signature, classification, lens, source, session_id, turn_index, created_at
    FROM extracted_skill_templates
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(limit, 100))) as Array<Record<string, unknown>>).map((row) => ({
    extractedSkillId: String(row.extracted_skill_id),
    signature: String(row.signature),
    classification: String(row.classification),
    lens: String(row.lens),
    source: String(row.source),
    sessionId: typeof row.session_id === "string" ? row.session_id : undefined,
    turnIndex: typeof row.turn_index === "number" ? row.turn_index : undefined,
    createdAt: String(row.created_at),
  }));
}
