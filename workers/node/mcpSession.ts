/**
 * MCP Gateway — Per-Connection Session Management
 *
 * Each WebSocket connection gets an isolated McpSession that:
 * - Tracks tool call count, total latency, session duration
 * - Injects user identity into every tool call
 * - Auto-disconnects after 30 minutes idle
 * - Emits session telemetry on close
 */

import { randomUUID } from "node:crypto";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface SessionToolCall {
  toolName: string;
  durationMs: number;
  success: boolean;
  timestamp: number;
}

export interface SessionTelemetry {
  sessionId: string;
  userId: string;
  connectedAt: number;
  disconnectedAt: number;
  durationMs: number;
  toolCallCount: number;
  totalToolLatencyMs: number;
  errorCount: number;
  lastActivityAt: number;
  disconnectReason: string;
}

export type TelemetryEmitFn = (telemetry: SessionTelemetry) => Promise<void>;

// ═══════════════════════════════════════════════════════════════════════════
// McpSession
// ═══════════════════════════════════════════════════════════════════════════

// BOUND: max 10,000 tool call records per session to cap memory
const MAX_CALL_LOG = 10_000;

// TIMEOUT: 30 minute idle disconnect
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// TIMEOUT: 30 second per tool call
export const TOOL_CALL_TIMEOUT_MS = 30_000;

export class McpSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly connectedAt: number;
  readonly permissions: string[];

  private _lastActivityAt: number;
  private _toolCalls: SessionToolCall[] = [];
  private _errorCount = 0;
  private _totalToolLatencyMs = 0;
  private _closed = false;
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;
  private _onIdle: (() => void) | null = null;
  private _telemetryEmitter: TelemetryEmitFn | null = null;

  constructor(opts: {
    userId: string;
    permissions: string[];
    onIdle?: () => void;
    telemetryEmitter?: TelemetryEmitFn;
  }) {
    this.sessionId = randomUUID();
    this.userId = opts.userId;
    this.connectedAt = Date.now();
    this.permissions = opts.permissions;
    this._lastActivityAt = this.connectedAt;
    this._onIdle = opts.onIdle ?? null;
    this._telemetryEmitter = opts.telemetryEmitter ?? null;

    this._resetIdleTimer();
  }

  // ── Idle timer ──────────────────────────────────────────────────────────

  private _resetIdleTimer(): void {
    if (this._idleTimer) clearTimeout(this._idleTimer);
    if (this._closed) return;

    this._idleTimer = setTimeout(() => {
      if (!this._closed && this._onIdle) {
        this._onIdle();
      }
    }, IDLE_TIMEOUT_MS);
  }

  /** Call on every inbound message to reset the idle timer */
  touch(): void {
    this._lastActivityAt = Date.now();
    this._resetIdleTimer();
  }

  // ── Tool call tracking ─────────────────────────────────────────────────

  recordToolCall(toolName: string, durationMs: number, success: boolean): void {
    this.touch();

    // BOUND: evict oldest entries when at capacity
    if (this._toolCalls.length >= MAX_CALL_LOG) {
      this._toolCalls.splice(0, 1000); // drop oldest 1000
    }

    this._toolCalls.push({
      toolName,
      durationMs,
      success,
      timestamp: Date.now(),
    });

    this._totalToolLatencyMs += durationMs;
    if (!success) this._errorCount++;
  }

  // ── Accessors ──────────────────────────────────────────────────────────

  get toolCallCount(): number {
    return this._toolCalls.length;
  }

  get errorCount(): number {
    return this._errorCount;
  }

  get totalToolLatencyMs(): number {
    return this._totalToolLatencyMs;
  }

  get lastActivityAt(): number {
    return this._lastActivityAt;
  }

  get isClosed(): boolean {
    return this._closed;
  }

  get durationMs(): number {
    return Date.now() - this.connectedAt;
  }

  /** Average tool call latency in ms (0 if no calls). */
  get avgLatencyMs(): number {
    return this._toolCalls.length > 0
      ? this._totalToolLatencyMs / this._toolCalls.length
      : 0;
  }

  /**
   * Compute p50 and p99 latency from recorded tool calls.
   * Returns { p50: number, p99: number } in ms. Both 0 if no calls.
   */
  getLatencyPercentiles(): { p50: number; p99: number } {
    if (this._toolCalls.length === 0) return { p50: 0, p99: 0 };
    const sorted = this._toolCalls.map((c) => c.durationMs).sort((a, b) => a - b);
    const p50Idx = Math.min(Math.floor(sorted.length * 0.5), sorted.length - 1);
    const p99Idx = Math.min(Math.floor(sorted.length * 0.99), sorted.length - 1);
    return { p50: sorted[p50Idx], p99: sorted[p99Idx] };
  }

  // ── Close & telemetry ──────────────────────────────────────────────────

  async close(reason: string): Promise<SessionTelemetry> {
    if (this._closed) {
      // Return a snapshot even if already closed
      return this._buildTelemetry(reason);
    }

    this._closed = true;
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }

    const telemetry = this._buildTelemetry(reason);

    // Emit telemetry (fire-and-forget with error swallow)
    if (this._telemetryEmitter) {
      try {
        await this._telemetryEmitter(telemetry);
      } catch {
        // Never let telemetry failures propagate
      }
    }

    return telemetry;
  }

  private _buildTelemetry(reason: string): SessionTelemetry {
    return {
      sessionId: this.sessionId,
      userId: this.userId,
      connectedAt: this.connectedAt,
      disconnectedAt: Date.now(),
      durationMs: this.durationMs,
      toolCallCount: this.toolCallCount,
      totalToolLatencyMs: this._totalToolLatencyMs,
      errorCount: this._errorCount,
      lastActivityAt: this._lastActivityAt,
      disconnectReason: reason,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Session Registry — BOUND: max 100 concurrent sessions
// ═══════════════════════════════════════════════════════════════════════════

const MAX_CONCURRENT_SESSIONS = 100;
const sessions = new Map<string, McpSession>();

export function getSessionCount(): number {
  return sessions.size;
}

export function canAcceptSession(): boolean {
  return sessions.size < MAX_CONCURRENT_SESSIONS;
}

export function registerSession(session: McpSession): boolean {
  if (sessions.size >= MAX_CONCURRENT_SESSIONS) return false;
  sessions.set(session.sessionId, session);
  return true;
}

export function unregisterSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function getSession(sessionId: string): McpSession | undefined {
  return sessions.get(sessionId);
}

export function getAllSessions(): McpSession[] {
  return [...sessions.values()];
}
