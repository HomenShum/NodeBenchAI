/**
 * auditLog.ts — Security audit trail for tool execution.
 *
 * Logs all security-relevant events (path checks, command execution,
 * URL validation, credential redactions) to SQLite.
 */

import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { getSecurityConfig } from "./config.js";
import { openOptionalSqliteDatabase } from "../db.js";

export interface AuditEntry {
  id: string;
  timestamp: string;
  category: "path" | "exec" | "url" | "secret" | "tool_call";
  toolName: string;
  argsPreview: string;
  allowed: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
}

// In-memory buffer for batch writes
const MAX_BUFFER_ENTRIES = 256;
let _buffer: AuditEntry[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _db: any = null;
let _initialized = false;

function getAuditDbPath(): string {
  const configured = process.env.NODEBENCH_DATA_DIR?.trim();
  const baseDir = configured || (process.env.VERCEL ? "/tmp/.nodebench" : path.join(os.homedir(), ".nodebench"));
  return path.join(baseDir, "security_audit.db");
}

function genId(): string {
  return `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getDb(): any {
  if (_db) return _db;

  try {
    const dbPath = getAuditDbPath();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    _db = openOptionalSqliteDatabase(dbPath);
    if (!_db) {
      _initialized = false;
      return null;
    }
    _db.pragma("journal_mode = WAL");

    _db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id         TEXT PRIMARY KEY,
        timestamp  TEXT NOT NULL,
        category   TEXT NOT NULL,
        tool_name  TEXT NOT NULL,
        args_preview TEXT NOT NULL DEFAULT '',
        allowed    INTEGER NOT NULL DEFAULT 1,
        reason     TEXT,
        metadata   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_log(category);
      CREATE INDEX IF NOT EXISTS idx_audit_tool ON audit_log(tool_name);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
    `);

    // Auto-prune entries older than 30 days
    _db
      .prepare(
        "DELETE FROM audit_log WHERE timestamp < datetime('now', '-30 days')",
      )
      .run();

    _initialized = true;
    return _db;
  } catch {
    // SQLite unavailable — use in-memory only
    _initialized = false;
    return null;
  }
}

function flushBuffer(): void {
  if (_buffer.length === 0) return;

  // Detach the bounded batch even if storage is unavailable or a write fails.
  const batch = _buffer;
  _buffer = [];

  const db = getDb();
  if (!db) {
    // No SQLite — just discard (entries were already returned from auditLog)
    return;
  }

  try {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO audit_log (id, timestamp, category, tool_name, args_preview, allowed, reason, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((entries: AuditEntry[]) => {
      for (const e of entries) {
        insert.run(
          e.id,
          e.timestamp,
          e.category,
          e.toolName,
          e.argsPreview,
          e.allowed ? 1 : 0,
          e.reason ?? null,
          e.metadata ? JSON.stringify(e.metadata) : null,
        );
      }
    });

    insertMany(batch);
  } catch {
    // SQLite write failed — discard silently
  }
}

/**
 * Log a security audit event.
 *
 * Non-blocking — buffers writes and flushes every 100ms.
 */
export function auditLog(
  category: AuditEntry["category"],
  toolName: string,
  argsPreview: string,
  allowed: boolean,
  reason?: string,
  metadata?: Record<string, unknown>,
): void {
  const config = getSecurityConfig();
  if (!config.auditEnabled) return;

  const entry: AuditEntry = {
    id: genId(),
    timestamp: new Date().toISOString(),
    category,
    toolName,
    argsPreview: argsPreview.substring(0, 200),
    allowed,
    reason,
    metadata,
  };

  if (_buffer.length >= MAX_BUFFER_ENTRIES) flushBuffer();
  _buffer.push(entry);

  // Batch flush every 100ms
  if (!_flushTimer) {
    _flushTimer = setTimeout(() => {
      flushBuffer();
      _flushTimer = null;
    }, 100);
  }
}

/**
 * Query the audit log.
 */
export function getAuditLog(opts?: {
  category?: AuditEntry["category"];
  toolName?: string;
  since?: string;
  limit?: number;
  onlyBlocked?: boolean;
}): AuditEntry[] {
  // Flush pending writes first
  flushBuffer();

  const db = getDb();
  if (!db) return [];

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.category) {
    conditions.push("category = ?");
    params.push(opts.category);
  }
  if (opts?.toolName) {
    conditions.push("tool_name = ?");
    params.push(opts.toolName);
  }
  if (opts?.since) {
    conditions.push("timestamp >= ?");
    params.push(opts.since);
  }
  if (opts?.onlyBlocked) {
    conditions.push("allowed = 0");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts?.limit ?? 100;

  try {
    const rows = db
      .prepare(
        `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(...params, limit);

    return rows.map((r: any) => ({
      id: r.id,
      timestamp: r.timestamp,
      category: r.category,
      toolName: r.tool_name,
      argsPreview: r.args_preview,
      allowed: r.allowed === 1,
      reason: r.reason,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  } catch {
    return [];
  }
}

/** Force flush — use before process exit */
export function flushAuditLog(): void {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  flushBuffer();
}

/** Test helper */
export function _resetAuditForTesting(): void {
  _buffer = [];
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  _db = null;
  _initialized = false;
}
