/**
 * Engine Session Manager
 *
 * In-memory session store for the headless API engine.
 * Each session gets a preset-scoped toolMap and tracks call history.
 */

import { getToolErrorMessage, type McpTool } from "../types.js";
import type { SessionContext } from "./contextBridge.js";

export interface ToolCallRecord {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  status: "success" | "error";
  durationMs: number;
  timestamp: number;
}

export interface DisclosureEvent {
  kind: string;
  toolName?: string;
  stepIndex?: number;
  status: "running" | "complete" | "error";
  data?: unknown;
  timestamp: number;
}

export interface EngineSession {
  id: string;
  createdAt: number;
  lastActivity: number;
  preset: string;
  toolMap: Map<string, McpTool>;
  callHistory: ToolCallRecord[];
  disclosureEvents: DisclosureEvent[];
  totalCallCount: number;
  successfulCallCount: number;
  failedCallCount: number;
  totalCallDurationMs: number;
  totalDisclosureCount: number;
  successfulToolNames: Set<string>;
  status: "active" | "completed" | "error";
  contextSnapshot?: SessionContext;
}

const sessions = new Map<string, EngineSession>();
const MAX_SESSIONS = 100;
// Match the collector's 10,000-event ceiling; streams emit two disclosures per call.
const MAX_CALL_HISTORY = 10_000;
const MAX_DISCLOSURE_EVENTS = MAX_CALL_HISTORY * 2;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function genSessionId(): string {
  return `eng_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function genCallId(): string {
  return `tcl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Build a scoped toolMap for a preset.
 * Falls back to full toolMap if preset is unknown.
 */
export function createSession(
  preset: string,
  presets: Record<string, string[]>,
  toolsetMap: Record<string, McpTool[]>,
  fallbackToolMap: Map<string, McpTool>,
): EngineSession {
  cleanExpired();

  if (sessions.size >= MAX_SESSIONS) {
    // Evict oldest idle session
    let oldest: EngineSession | null = null;
    for (const s of sessions.values()) {
      if (!oldest || s.lastActivity < oldest.lastActivity) oldest = s;
    }
    if (oldest) sessions.delete(oldest.id);
  }

  const toolMap = new Map<string, McpTool>();
  const domains = presets[preset] ?? presets["full"] ?? Object.keys(toolsetMap);
  for (const domain of domains) {
    const tools = toolsetMap[domain];
    if (tools) {
      for (const tool of tools) {
        toolMap.set(tool.name, tool);
      }
    }
  }

  // Always include meta/discovery tools from the fallback
  for (const [name, tool] of fallbackToolMap) {
    if (name.startsWith("find") || name === "getMethodology" || name === "check_mcp_setup"
        || name === "discover_tools" || name === "get_tool_quick_ref" || name === "get_workflow_chain") {
      toolMap.set(name, tool);
    }
  }

  const session: EngineSession = {
    id: genSessionId(),
    createdAt: Date.now(),
    lastActivity: Date.now(),
    preset,
    toolMap,
    callHistory: [],
    disclosureEvents: [],
    totalCallCount: 0,
    successfulCallCount: 0,
    failedCallCount: 0,
    totalCallDurationMs: 0,
    totalDisclosureCount: 0,
    successfulToolNames: new Set(),
    status: "active",
  };

  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): EngineSession | undefined {
  const s = sessions.get(id);
  if (s) s.lastActivity = Date.now();
  return s;
}

export function endSession(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  s.status = "completed";
  sessions.delete(id);
  return true;
}

export function listSessions(): Array<{
  id: string;
  preset: string;
  status: string;
  toolCount: number;
  callCount: number;
  createdAt: number;
  lastActivity: number;
}> {
  return Array.from(sessions.values()).map((s) => ({
    id: s.id,
    preset: s.preset,
    status: s.status,
    toolCount: s.toolMap.size,
    callCount: s.totalCallCount,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
  }));
}

export async function executeToolInSession(
  session: EngineSession,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolCallRecord> {
  const tool = session.toolMap.get(toolName);
  if (!tool) {
    const record: ToolCallRecord = {
      id: genCallId(),
      toolName,
      args,
      result: { error: `Tool "${toolName}" not available in preset "${session.preset}"` },
      status: "error",
      durationMs: 0,
      timestamp: Date.now(),
    };
    recordCall(session, record);
    return record;
  }

  const start = Date.now();
  let result: unknown;
  let status: "success" | "error" = "success";

  try {
    result = await tool.handler(args);
    // Both HTTP and SSE must serialize the result before reporting a successful call.
    JSON.stringify(result);
    status = getToolErrorMessage(result) !== null ? "error" : "success";
  } catch (err: any) {
    result = { error: err?.message ?? String(err) };
    status = "error";
  }

  const record: ToolCallRecord = {
    id: genCallId(),
    toolName,
    args,
    result,
    status,
    durationMs: Date.now() - start,
    timestamp: Date.now(),
  };

  recordCall(session, record);
  session.lastActivity = Date.now();
  return record;
}

function recordCall(session: EngineSession, record: ToolCallRecord): void {
  session.totalCallCount++;
  session.totalCallDurationMs += record.durationMs;
  if (record.status === "success") {
    session.successfulCallCount++;
    // Only registered tools can succeed: membership is bounded by session.toolMap.
    session.successfulToolNames.add(record.toolName);
  } else {
    session.failedCallCount++;
  }
  if (session.callHistory.length >= MAX_CALL_HISTORY) session.callHistory.shift();
  session.callHistory.push(record);
}

export function recordDisclosureEvent(session: EngineSession, event: DisclosureEvent): void {
  session.totalDisclosureCount++;
  if (session.disclosureEvents.length >= MAX_DISCLOSURE_EVENTS) session.disclosureEvents.shift();
  session.disclosureEvents.push(event);
}

export function cleanExpired(): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, s] of sessions) {
    if (now - s.lastActivity > IDLE_TIMEOUT_MS) {
      sessions.delete(id);
      cleaned++;
    }
  }
  return cleaned;
}

export function getSessionCount(): number {
  return sessions.size;
}
