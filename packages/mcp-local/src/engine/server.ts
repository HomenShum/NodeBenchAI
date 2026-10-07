/**
 * NodeBench Engine — Headless API-First Agentic Engine
 *
 * HTTP server exposing MCP tool handlers as a REST API.
 * Supports: tool execution, workflow chains (with SSE streaming),
 * session management, preset gating, and conformance reports.
 *
 * Port: 6276 (follows 6274 dashboard, 6275 brief convention)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { McpTool } from "../types.js";
import type { WorkflowChain } from "../tools/toolRegistry.js";
import {
  createSession,
  getSession,
  endSession,
  listSessions,
  executeToolInSession,
  recordDisclosureEvent,
  getSessionCount,
  type EngineSession,
  type DisclosureEvent,
} from "./session.js";
import { computeConformance, type ConformanceReport } from "./conformance.js";
import {
  loadSessionContext,
  persistSessionOutcome,
  getContextHealth,
  getWorkflowHistory,
  searchLearnings,
} from "./contextBridge.js";

// ── Types ─────────────────────────────────────────────────────────────

export interface EngineServerConfig {
  toolMap: Map<string, McpTool>;
  allTools: McpTool[];
  workflowChains: Record<string, WorkflowChain>;
  presets: Record<string, string[]>;
  toolsetMap: Record<string, McpTool[]>;
  toolToToolset: Map<string, string>;
  secret?: string;
}

// ── State ─────────────────────────────────────────────────────────────

let _server: ReturnType<typeof createServer> | null = null;
let _port = 0;
let _config: EngineServerConfig | null = null;
const _startedAt = Date.now();

// ── Server Lifecycle ──────────────────────────────────────────────────

export function startEngineServer(config: EngineServerConfig, preferredPort = 6276): Promise<number> {
  return new Promise((resolve, reject) => {
    if (_server) { resolve(_port); return; }

    _config = config;
    _server = createServer((req, res) => handleRequest(req, res));

    let attempts = 0;
    const maxRetries = 5;

    function tryListen(port: number) {
      _server!.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && attempts < maxRetries) {
          attempts++;
          tryListen(port + 1);
        } else {
          reject(err);
        }
      });

      _server!.listen(port, "127.0.0.1", () => {
        _port = port;
        resolve(port);
      });
    }

    tryListen(preferredPort);
  });
}

export function stopEngineServer(): void {
  if (_server) { _server.close(); _server = null; _port = 0; }
}

export function getEngineUrl(): string | null {
  return _port ? `http://127.0.0.1:${_port}` : null;
}

// ── Helpers ───────────────────────────────────────────────────────────

function json(res: ServerResponse, data: unknown, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function error(res: ServerResponse, message: string, status = 400) {
  json(res, { ok: false, error: message }, status);
}

const MAX_BODY_BYTES = 1_048_576; // 1 MB

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!body) { resolve({}); return; }
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!_config?.secret) return true;
  const auth = req.headers.authorization;
  if (auth === `Bearer ${_config.secret}`) return true;
  error(res, "Unauthorized", 401);
  return false;
}

function getToolMeta(name: string) {
  const toolset = _config?.toolToToolset.get(name) ?? "unknown";
  return { category: toolset };
}

// ── Request Router ────────────────────────────────────────────────────

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${_port}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    if (!checkAuth(req, res)) return;
    // ── Root ──────────────────────────────────────
    if (path === "/" && method === "GET") {
      return json(res, {
        engine: "nodebench-engine",
        version: "1.0.0",
        toolCount: _config?.allTools.length ?? 0,
        uptimeMs: Date.now() - _startedAt,
        activeSessions: getSessionCount(),
        endpoints: [
          "GET  /api/health",
          "GET  /api/tools",
          "POST /api/tools/:toolName",
          "GET  /api/workflows",
          "POST /api/workflows/:chainName",
          "POST /api/sessions",
          "GET  /api/sessions",
          "GET  /api/sessions/:id",
          "GET  /api/sessions/:id/trace",
          "GET  /api/sessions/:id/report",
          "DELETE /api/sessions/:id",
          "GET  /api/presets",
          "GET  /api/context",
          "GET  /api/context/history",
          "GET  /api/context/learnings",
        ],
      });
    }

    // ── Health ────────────────────────────────────
    if (path === "/api/health" && method === "GET") {
      return json(res, {
        ok: true,
        uptimeMs: Date.now() - _startedAt,
        toolCount: _config?.allTools.length ?? 0,
        activeSessions: getSessionCount(),
        memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      });
    }

    // ── List Tools ───────────────────────────────
    if (path === "/api/tools" && method === "GET") {
      const tools = (_config?.allTools ?? []).map((t) => ({
        name: t.name,
        description: t.description.slice(0, 200),
        inputSchema: t.inputSchema,
        ...getToolMeta(t.name),
      }));
      return json(res, { ok: true, count: tools.length, tools });
    }

    // ── Execute Tool ─────────────────────────────
    const toolExecMatch = path.match(/^\/api\/tools\/([^/]+)$/);
    if (toolExecMatch && method === "POST") {
      const toolName = decodeURIComponent(toolExecMatch[1]);
      const body = await parseBody(req);
      const args = body.args ?? {};
      const presetName = body.preset ?? "full";

      // Use session if provided, else create ephemeral
      let session: EngineSession;
      if (body.sessionId) {
        const existing = getSession(body.sessionId);
        if (!existing) return error(res, `Session "${body.sessionId}" not found`, 404);
        session = existing;
      } else {
        session = createSession(
          presetName,
          _config!.presets,
          _config!.toolsetMap,
          _config!.toolMap,
        );
      }

      const record = await executeToolInSession(session, toolName, args);

      // Clean up ephemeral sessions
      if (!body.sessionId) endSession(session.id);

      return json(res, {
        ok: record.status === "success",
        toolName,
        result: record.result,
        meta: {
          durationMs: record.durationMs,
          sessionId: session.id,
          ...getToolMeta(toolName),
        },
      }, record.status === "success" ? 200 : 500);
    }

    // ── List Workflows ───────────────────────────
    if (path === "/api/workflows" && method === "GET") {
      const chains = _config?.workflowChains ?? {};
      const workflows = Object.entries(chains).map(([key, chain]) => ({
        key,
        name: chain.name,
        description: chain.description,
        stepCount: chain.steps.length,
        steps: chain.steps.map((s, i) => ({ index: i, tool: s.tool, action: s.action })),
      }));
      return json(res, { ok: true, count: workflows.length, workflows });
    }

    // ── Execute Workflow ─────────────────────────
    const workflowExecMatch = path.match(/^\/api\/workflows\/([^/]+)$/);
    if (workflowExecMatch && method === "POST") {
      const chainName = decodeURIComponent(workflowExecMatch[1]);
      const chain = _config?.workflowChains[chainName];
      if (!chain) return error(res, `Workflow "${chainName}" not found`, 404);

      const body = await parseBody(req);
      const stepArgs = body.stepArgs ?? {};
      const presetName = body.preset ?? "full";
      const streaming = body.streaming === true;

      // Create or reuse session
      let session: EngineSession;
      if (body.sessionId) {
        const existing = getSession(body.sessionId);
        if (!existing) return error(res, `Session "${body.sessionId}" not found`, 404);
        session = existing;
      } else {
        session = createSession(
          presetName,
          _config!.presets,
          _config!.toolsetMap,
          _config!.toolMap,
        );
      }

      // Load accumulated context for this workflow
      try {
        session.contextSnapshot = loadSessionContext(chainName, presetName);
      } catch { /* context loading is best-effort */ }

      if (streaming) {
        return await executeWorkflowStreaming(res, session, chain, chainName, stepArgs, !body.sessionId);
      }

      // Non-streaming: execute all steps, return batch result
      const results = [];
      for (let i = 0; i < chain.steps.length; i++) {
        const step = chain.steps[i];
        const args = stepArgs[step.tool] ?? {};
        const record = await executeToolInSession(session, step.tool, args);
        results.push({
          stepIndex: i,
          tool: step.tool,
          action: step.action,
          status: record.status,
          durationMs: record.durationMs,
          result: record.result,
        });
      }

      const report = computeConformance(session, chain.steps.length);

      // Persist outcome for future context
      try {
        persistSessionOutcome(session.id, report, chainName, presetName, session.callHistory);
      } catch { /* best-effort */ }

      if (!body.sessionId) endSession(session.id);

      const ok = results.every((record) => record.status === "success");
      return json(res, {
        ok,
        workflow: chainName,
        totalSteps: chain.steps.length,
        results,
        conformance: report,
        contextLoaded: !!session.contextSnapshot,
      }, ok ? 200 : 500);
    }

    // ── Create Session ───────────────────────────
    if (path === "/api/sessions" && method === "POST") {
      const body = await parseBody(req);
      const presetName = body.preset ?? "default";
      const workflow = body.workflow as string | undefined;
      const session = createSession(
        presetName,
        _config!.presets,
        _config!.toolsetMap,
        _config!.toolMap,
      );
      // Pre-load context if workflow is specified
      if (workflow) {
        try { session.contextSnapshot = loadSessionContext(workflow, presetName); }
        catch { /* best-effort */ }
      }
      return json(res, {
        ok: true,
        sessionId: session.id,
        preset: session.preset,
        toolCount: session.toolMap.size,
        createdAt: session.createdAt,
        contextLoaded: !!session.contextSnapshot,
      }, 201);
    }

    // ── List Sessions ────────────────────────────
    if (path === "/api/sessions" && method === "GET") {
      return json(res, { ok: true, sessions: listSessions() });
    }

    // ── Session Detail ───────────────────────────
    const sessionDetailMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionDetailMatch && method === "GET") {
      const session = getSession(decodeURIComponent(sessionDetailMatch[1]));
      if (!session) return error(res, "Session not found", 404);
      return json(res, {
        ok: true,
        id: session.id,
        preset: session.preset,
        status: session.status,
        toolCount: session.toolMap.size,
        callCount: session.totalCallCount,
        retainedCallCount: session.callHistory.length,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        callHistory: session.callHistory.map((r) => ({
          id: r.id,
          toolName: r.toolName,
          status: r.status,
          durationMs: r.durationMs,
          timestamp: r.timestamp,
        })),
      });
    }

    // ── Session Trace ────────────────────────────
    const sessionTraceMatch = path.match(/^\/api\/sessions\/([^/]+)\/trace$/);
    if (sessionTraceMatch && method === "GET") {
      const session = getSession(decodeURIComponent(sessionTraceMatch[1]));
      if (!session) return error(res, "Session not found", 404);
      return json(res, {
        ok: true,
        sessionId: session.id,
        events: session.disclosureEvents,
        callHistory: session.callHistory,
        totalCallCount: session.totalCallCount,
        retainedCallCount: session.callHistory.length,
        totalDisclosureCount: session.totalDisclosureCount,
        retainedDisclosureCount: session.disclosureEvents.length,
      });
    }

    // ── Session Report ───────────────────────────
    const sessionReportMatch = path.match(/^\/api\/sessions\/([^/]+)\/report$/);
    if (sessionReportMatch && method === "GET") {
      const session = getSession(decodeURIComponent(sessionReportMatch[1]));
      if (!session) return error(res, "Session not found", 404);
      const report = computeConformance(session);
      return json(res, { ok: true, report });
    }

    // ── Delete Session ───────────────────────────
    if (sessionDetailMatch && method === "DELETE") {
      const deleted = endSession(decodeURIComponent(sessionDetailMatch[1]));
      if (!deleted) return error(res, "Session not found", 404);
      return json(res, { ok: true, deleted: true });
    }

    // ── List Presets ─────────────────────────────
    if (path === "/api/presets" && method === "GET") {
      const presets = _config?.presets ?? {};
      const toolsetMap = _config?.toolsetMap ?? {};
      const list = Object.entries(presets).map(([name, domains]) => {
        let toolCount = 0;
        for (const d of domains) {
          toolCount += toolsetMap[d]?.length ?? 0;
        }
        return { name, domains, toolCount };
      });
      return json(res, { ok: true, presets: list });
    }

    // ── Context Health ───────────────────────────
    if (path === "/api/context" && method === "GET") {
      try {
        const health = getContextHealth();
        return json(res, { ok: true, ...health });
      } catch (err: any) {
        return json(res, { ok: false, error: "context_health_unavailable", learningsCount: 0, recentRunScores: [], trendDirection: "insufficient_data", contentArchiveSize: 0, daysSinceLastLearning: null, workflowCoverage: {} }, 500);
      }
    }

    // ── Context History ─────────────────────────
    if (path === "/api/context/history" && method === "GET") {
      const workflow = url.searchParams.get("workflow") ?? "";
      const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
      if (!workflow) return error(res, "workflow query parameter required");
      try {
        const runs = getWorkflowHistory(workflow, limit);
        return json(res, { ok: true, workflow, runs });
      } catch { return json(res, { ok: false, error: "workflow_history_unavailable", workflow, runs: [] }, 500); }
    }

    // ── Context Learnings ───────────────────────
    if (path === "/api/context/learnings" && method === "GET") {
      const query = url.searchParams.get("query") ?? "";
      const limit = parseInt(url.searchParams.get("limit") ?? "10", 10);
      if (!query) return error(res, "query parameter required");
      try {
        const learnings = searchLearnings(query, limit);
        return json(res, { ok: true, query, learnings });
      } catch { return json(res, { ok: false, error: "learnings_search_unavailable", query, learnings: [] }, 500); }
    }

    // ── 404 ──────────────────────────────────────
    error(res, "Not found", 404);
  } catch (err: any) {
    if (!res.headersSent) error(res, err?.message ?? "Internal server error", 500);
    else res.end();
  }
}

// ── SSE Workflow Execution ────────────────────────────────────────────

async function executeWorkflowStreaming(
  res: ServerResponse,
  session: EngineSession,
  chain: WorkflowChain,
  chainName: string,
  stepArgs: Record<string, Record<string, unknown>>,
  ephemeral: boolean,
) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  function send(event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    send("start", { workflow: chainName, totalSteps: chain.steps.length, sessionId: session.id });

    // Emit context summary if available
    if (session.contextSnapshot) {
      send("context", {
        recentRunCount: session.contextSnapshot.recentRuns.length,
        avgScore: session.contextSnapshot.conformanceTrend.avgScore,
        trend: session.contextSnapshot.conformanceTrend.direction,
        learningsAvailable: session.contextSnapshot.relevantLearnings.length,
        openGaps: session.contextSnapshot.openGapCount,
      });
    }

    let ok = true;
    for (let i = 0; i < chain.steps.length; i++) {
      const step = chain.steps[i];
      const args = stepArgs[step.tool] ?? {};

      // Emit running event
      const runningEvent: DisclosureEvent = {
        kind: "tool.invoke",
        toolName: step.tool,
        stepIndex: i,
        status: "running",
        timestamp: Date.now(),
      };
      recordDisclosureEvent(session, runningEvent);
      send("step", { stepIndex: i, tool: step.tool, action: step.action, status: "running" });

      // Execute
      const record = await executeToolInSession(session, step.tool, args);
      if (record.status !== "success") ok = false;

      // Emit complete event
      const completeEvent: DisclosureEvent = {
        kind: "tool.invoke",
        toolName: step.tool,
        stepIndex: i,
        status: record.status === "success" ? "complete" : "error",
        data: record.result,
        timestamp: Date.now(),
      };
      recordDisclosureEvent(session, completeEvent);
      send("step", {
        stepIndex: i,
        tool: step.tool,
        action: step.action,
        status: record.status === "success" ? "complete" : "error",
        durationMs: record.durationMs,
        result: record.result,
      });
    }

    // Final conformance
    const report = computeConformance(session, chain.steps.length);

    // Persist outcome for future context
    try {
      persistSessionOutcome(session.id, report, chainName, session.preset, session.callHistory);
    } catch { /* best-effort */ }

    send("complete", {
      ok,
      workflow: chainName,
      totalSteps: chain.steps.length,
      totalDurationMs: report.totalDurationMs,
      conformanceScore: report.score,
      grade: report.grade,
      sessionId: session.id,
    });

  } catch (err: unknown) {
    session.status = "error";
    send("error", { workflow: chainName, error: err instanceof Error ? err.message : String(err), sessionId: session.id });
  } finally {
    if (ephemeral) endSession(session.id);
    res.end();
  }
}
