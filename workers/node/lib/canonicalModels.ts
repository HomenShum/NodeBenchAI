/**
 * Canonical Backend Object Model for NodeBench product surfaces.
 *
 * These are the 5 core objects that power the remade platform:
 * Report, Nudge, ChatSession, EvidenceItem, MeContext.
 *
 * Storage: SQLite (~/.nodebench/nodebench.db) via the canonical getDb().
 * Bounded: each collection has MAX with LRU eviction.
 */

import { getDb as getCanonicalDb } from "../../packages/mcp-local/src/db.js";

// ── DB setup ─────────────────────────────────────────────────────────

let _tablesReady = false;

function getDb() {
  const db = getCanonicalDb();
  if (!_tablesReady) {
    ensureTables(db);
    _tablesReady = true;
  }
  return db;
}

function ensureTables(db: ReturnType<typeof getCanonicalDb>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      report_id       TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      entity_name     TEXT,
      type            TEXT NOT NULL DEFAULT 'company',
      summary         TEXT NOT NULL DEFAULT '',
      confidence      REAL DEFAULT 0,
      lens            TEXT DEFAULT 'founder',
      query           TEXT NOT NULL,
      packet_json     TEXT NOT NULL DEFAULT '{}',
      envelope_id     TEXT,
      source_count    INTEGER DEFAULT 0,
      contradiction_count INTEGER DEFAULT 0,
      pinned          INTEGER DEFAULT 0,
      status          TEXT DEFAULT 'saved',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_report_entity ON reports(entity_name, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_report_pinned ON reports(pinned DESC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS nudges (
      nudge_id        TEXT PRIMARY KEY,
      type            TEXT NOT NULL,
      title           TEXT NOT NULL,
      summary         TEXT NOT NULL DEFAULT '',
      priority        TEXT DEFAULT 'normal',
      status          TEXT DEFAULT 'active',
      linked_report_id TEXT,
      linked_chat_id  TEXT,
      linked_connector TEXT,
      action_label    TEXT,
      action_target   TEXT,
      due_at          TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_nudge_status ON nudges(status, due_at);

    CREATE TABLE IF NOT EXISTS chat_sessions (
      chat_id         TEXT PRIMARY KEY,
      query           TEXT NOT NULL,
      lens            TEXT DEFAULT 'founder',
      status          TEXT DEFAULT 'active',
      linked_report_id TEXT,
      event_count     INTEGER DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_updated ON chat_sessions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS me_context (
      context_id      TEXT PRIMARY KEY,
      user_id         TEXT DEFAULT 'local',
      type            TEXT NOT NULL,
      title           TEXT NOT NULL,
      summary         TEXT DEFAULT '',
      entity_ref      TEXT,
      tags            TEXT DEFAULT '[]',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_me_type ON me_context(type, updated_at DESC);
  `);
}

// ── ID generation (shared) ───────────────────────────────────────────

import { genId } from "./idGen.js";

// ── Report CRUD ──────────────────────────────────────────────────────

export interface Report {
  reportId: string;
  title: string;
  entityName?: string;
  type: string;
  summary: string;
  confidence: number;
  lens: string;
  query: string;
  packetJson: string;
  envelopeId?: string;
  sourceCount: number;
  contradictionCount: number;
  pinned: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const MAX_REPORTS = 200;

export function saveReport(input: Omit<Report, "reportId" | "createdAt" | "updatedAt">): string {
  const db = getDb();
  const id = genId("rpt");
  const now = new Date().toISOString();

  // Evict oldest unpinned if at capacity
  const count = (db.prepare("SELECT COUNT(*) as cnt FROM reports").get() as { cnt: number }).cnt;
  if (count >= MAX_REPORTS) {
    db.prepare("DELETE FROM reports WHERE report_id IN (SELECT report_id FROM reports WHERE pinned = 0 ORDER BY updated_at ASC LIMIT 10)").run();
  }

  db.prepare(`INSERT INTO reports (report_id, title, entity_name, type, summary, confidence, lens, query, packet_json, envelope_id, source_count, contradiction_count, pinned, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, input.title, input.entityName ?? null, input.type, input.summary, input.confidence,
    input.lens, input.query, input.packetJson, input.envelopeId ?? null,
    input.sourceCount, input.contradictionCount, input.pinned ? 1 : 0, input.status, now, now,
  );
  return id;
}

export function listReports(limit = 20): Report[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM reports ORDER BY pinned DESC, updated_at DESC LIMIT ?").all(limit) as any[];
  return rows.map(rowToReport);
}

export function getReport(reportId: string): Report | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM reports WHERE report_id = ?").get(reportId) as any;
  return row ? rowToReport(row) : null;
}

export function pinReport(reportId: string, pinned: boolean): void {
  const db = getDb();
  db.prepare("UPDATE reports SET pinned = ?, updated_at = datetime('now') WHERE report_id = ?").run(pinned ? 1 : 0, reportId);
}

function rowToReport(row: any): Report {
  return {
    reportId: row.report_id,
    title: row.title,
    entityName: row.entity_name ?? undefined,
    type: row.type,
    summary: row.summary,
    confidence: row.confidence ?? 0,
    lens: row.lens ?? "founder",
    query: row.query,
    packetJson: row.packet_json ?? "{}",
    envelopeId: row.envelope_id ?? undefined,
    sourceCount: row.source_count ?? 0,
    contradictionCount: row.contradiction_count ?? 0,
    pinned: !!row.pinned,
    status: row.status ?? "saved",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Nudge CRUD ───────────────────────────────────────────────────────

export interface Nudge {
  nudgeId: string;
  type: string;
  title: string;
  summary: string;
  priority: string;
  status: string;
  linkedReportId?: string;
  linkedChatId?: string;
  linkedConnector?: string;
  actionLabel?: string;
  actionTarget?: string;
  dueAt?: string;
  createdAt: string;
}

const MAX_NUDGES = 100;

export function createNudge(input: Omit<Nudge, "nudgeId" | "createdAt">): string {
  const db = getDb();
  const id = genId("ndg");
  const now = new Date().toISOString();

  const count = (db.prepare("SELECT COUNT(*) as cnt FROM nudges").get() as { cnt: number }).cnt;
  if (count >= MAX_NUDGES) {
    db.prepare("DELETE FROM nudges WHERE nudge_id IN (SELECT nudge_id FROM nudges WHERE status = 'done' ORDER BY created_at ASC LIMIT 10)").run();
  }

  db.prepare(`INSERT INTO nudges (nudge_id, type, title, summary, priority, status, linked_report_id, linked_chat_id, linked_connector, action_label, action_target, due_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, input.type, input.title, input.summary, input.priority, input.status,
    input.linkedReportId ?? null, input.linkedChatId ?? null, input.linkedConnector ?? null,
    input.actionLabel ?? null, input.actionTarget ?? null, input.dueAt ?? null, now,
  );
  return id;
}

export function listNudges(status = "active", limit = 20): Nudge[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM nudges WHERE status = ? ORDER BY due_at ASC, created_at DESC LIMIT ?").all(status, limit) as any[];
  return rows.map((r) => ({
    nudgeId: r.nudge_id, type: r.type, title: r.title, summary: r.summary,
    priority: r.priority, status: r.status,
    linkedReportId: r.linked_report_id ?? undefined,
    linkedChatId: r.linked_chat_id ?? undefined,
    linkedConnector: r.linked_connector ?? undefined,
    actionLabel: r.action_label ?? undefined,
    actionTarget: r.action_target ?? undefined,
    dueAt: r.due_at ?? undefined,
    createdAt: r.created_at,
  }));
}

export function dismissNudge(nudgeId: string): void {
  const db = getDb();
  db.prepare("UPDATE nudges SET status = 'done' WHERE nudge_id = ?").run(nudgeId);
}

// ── ChatSession CRUD ─────────────────────────────────────────────────

export interface ChatSession {
  chatId: string;
  query: string;
  lens: string;
  status: string;
  linkedReportId?: string;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
}

const MAX_SESSIONS = 50;

export function createChatSession(query: string, lens: string): string {
  const db = getDb();
  const id = genId("chat");
  const now = new Date().toISOString();

  const count = (db.prepare("SELECT COUNT(*) as cnt FROM chat_sessions").get() as { cnt: number }).cnt;
  if (count >= MAX_SESSIONS) {
    db.prepare("DELETE FROM chat_sessions WHERE chat_id IN (SELECT chat_id FROM chat_sessions ORDER BY updated_at ASC LIMIT 5)").run();
  }

  db.prepare("INSERT INTO chat_sessions (chat_id, query, lens, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run(id, query, lens, now, now);
  return id;
}

export function listChatSessions(limit = 10): ChatSession[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT ?").all(limit) as any[];
  return rows.map((r) => ({
    chatId: r.chat_id, query: r.query, lens: r.lens, status: r.status,
    linkedReportId: r.linked_report_id ?? undefined,
    eventCount: r.event_count ?? 0,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

export function completeChatSession(chatId: string, reportId: string, eventCount: number): void {
  const db = getDb();
  db.prepare("UPDATE chat_sessions SET status = 'complete', linked_report_id = ?, event_count = ?, updated_at = datetime('now') WHERE chat_id = ?").run(reportId, eventCount, chatId);
}

// ── MeContext CRUD ───────────────────────────────────────────────────

export interface MeContextItem {
  contextId: string;
  userId: string;
  type: string;
  title: string;
  summary: string;
  entityRef?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

const MAX_ME_CONTEXT = 200;

export function saveMeContext(input: { type: string; title: string; summary?: string; entityRef?: string; tags?: string[] }): string {
  const db = getDb();
  const id = genId("ctx");
  const now = new Date().toISOString();

  // BOUND: evict oldest if at capacity
  const count = (db.prepare("SELECT COUNT(*) as cnt FROM me_context").get() as { cnt: number }).cnt;
  if (count >= MAX_ME_CONTEXT) {
    db.prepare("DELETE FROM me_context WHERE context_id IN (SELECT context_id FROM me_context ORDER BY updated_at ASC LIMIT 10)").run();
  }

  db.prepare("INSERT INTO me_context (context_id, type, title, summary, entity_ref, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    id, input.type, input.title, input.summary ?? "", input.entityRef ?? null, JSON.stringify(input.tags ?? []), now, now,
  );
  return id;
}

export function listMeContext(type?: string, limit = 20): MeContextItem[] {
  const db = getDb();
  let sql = "SELECT * FROM me_context";
  const params: unknown[] = [];
  if (type) { sql += " WHERE type = ?"; params.push(type); }
  sql += " ORDER BY updated_at DESC LIMIT ?";
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map((r) => ({
    contextId: r.context_id, userId: r.user_id ?? "local", type: r.type,
    title: r.title, summary: r.summary ?? "",
    entityRef: r.entity_ref ?? undefined,
    tags: JSON.parse(r.tags ?? "[]"),
    createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}
