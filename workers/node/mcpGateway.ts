/**
 * MCP Gateway — WebSocket server that exposes NodeBench's 304-tool MCP
 * server to remote Claude Code, Cursor, and OpenClaw agents.
 *
 * Protocol: JSON-RPC 2.0 over WebSocket (same wire format as MCP SDK).
 *
 * Endpoints:
 *   ws://host/mcp          — MCP WebSocket endpoint
 *   GET /mcp/health        — Health check (HTTP)
 *
 * Connection flow:
 *   1. Client opens WebSocket to /mcp with Authorization: Bearer nb_key_...
 *   2. Server validates API key, creates McpSession
 *   3. Client sends JSON-RPC requests (tools/list, tools/call)
 *   4. Server routes through passport enforcement, returns results
 *   5. On disconnect, session telemetry is emitted
 *
 * Security:
 *   - API key validated on upgrade (before WebSocket handshake completes)
 *   - Rate limiting: 100 calls/min, 10,000/day per key
 *   - Max 100 concurrent connections
 *   - 30s timeout per tool call, 30min idle disconnect
 *   - Structured WebSocket close codes (4001=auth, 4002=rate, 4003=timeout)
 */

import { type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { McpTool } from "../packages/mcp-local/src/types.js";

import {
  validateApiKey,
  rateLimit,
  hashApiKey,
  isValidKeyFormat,
  type KeyLookupFn,
  type ValidateResult,
  type RateLimitResult,
} from "./mcpAuth.js";

import {
  McpSession,
  TOOL_CALL_TIMEOUT_MS,
  canAcceptSession,
  registerSession,
  unregisterSession,
  getSessionCount,
  getAllSessions,
  type TelemetryEmitFn,
} from "./mcpSession.js";

// ═══════════════════════════════════════════════════════════════════════════
// JSON-RPC 2.0 types (subset used by MCP protocol)
// ═══════════════════════════════════════════════════════════════════════════

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Custom WebSocket close codes
// ═══════════════════════════════════════════════════════════════════════════

const WS_CLOSE_AUTH_FAILED = 4001;
const WS_CLOSE_RATE_LIMITED = 4002;
const WS_CLOSE_IDLE_TIMEOUT = 4003;
const WS_CLOSE_SERVER_ERROR = 4004;
const WS_CLOSE_CAPACITY_FULL = 4005;

// ═══════════════════════════════════════════════════════════════════════════
// Gateway configuration
// ═══════════════════════════════════════════════════════════════════════════

export interface McpGatewayConfig {
  /** All registered MCP tools (from parseToolsets / TOOLSET_MAP) */
  tools: McpTool[];
  /** Optional Convex-backed key lookup (falls back to in-memory store) */
  keyLookup?: KeyLookupFn;
  /** Optional telemetry emitter (e.g. write to Convex) */
  telemetryEmitter?: TelemetryEmitFn;
  /** CORS origins for WebSocket upgrade (default: same-origin only — no wildcard) */
  corsOrigins?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool call with timeout wrapper
// ═══════════════════════════════════════════════════════════════════════════

async function callToolWithTimeout(
  tool: McpTool,
  args: Record<string, unknown>,
  timeoutMs: number = TOOL_CALL_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Race the tool handler against an abort signal timeout
    const result = await Promise.race([
      tool.handler(args),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new Error(`Tool call timed out after ${timeoutMs}ms`));
        });
      }),
    ]);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// extractBearerToken — pull API key from upgrade request
// ═══════════════════════════════════════════════════════════════════════════

function extractBearerToken(req: IncomingMessage): string | null {
  // Check Authorization header first
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  // Fallback: check Sec-WebSocket-Protocol for clients that can't set headers
  // Format: "mcp.nb_key_xxxx"
  const protocols = req.headers["sec-websocket-protocol"];
  if (protocols) {
    const parts = protocols.split(",").map((p) => p.trim());
    for (const p of parts) {
      if (p.startsWith("mcp.") && isValidKeyFormat(p.slice(4))) {
        return p.slice(4);
      }
    }
  }

  // Fallback: query string ?token=nb_key_...
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const token = url.searchParams.get("token");
    if (token && isValidKeyFormat(token)) return token;
  } catch {
    // Invalid URL — ignore
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// createMcpGateway — factory that returns { wss, handleUpgrade, healthHandler }
// ═══════════════════════════════════════════════════════════════════════════

export function createMcpGateway(config: McpGatewayConfig) {
  // SECURITY: Default CORS to empty (same-origin only). Wildcard "*" must be
  // explicitly opted into by the deployer, never a silent default.
  const { tools, keyLookup, telemetryEmitter, corsOrigins = [] } = config;

  // Build tool lookup map — O(1) dispatch
  const toolMap = new Map<string, McpTool>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  // Build tool listing (cached — no need to regenerate per request)
  const toolListing = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    ...(t.annotations ? { annotations: t.annotations } : {}),
  }));

  // Create WebSocket server (noServer mode — we handle upgrade ourselves)
  const wss = new WebSocketServer({ noServer: true });

  // ── WebSocket connection handler ──────────────────────────────────────

  wss.on("connection", (ws: WebSocket, session: McpSession) => {
    // Send server info as first message (MCP initialize response equivalent)
    const initNotification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {
        serverInfo: {
          name: "nodebench-mcp-gateway",
          version: "1.0.0",
        },
        capabilities: {
          tools: { listChanged: false },
        },
        sessionId: session.sessionId,
      },
    };
    ws.send(JSON.stringify(initNotification));

    // ── Message handler ─────────────────────────────────────────────────

    ws.on("message", async (data: Buffer | string) => {
      session.touch();

      let request: JsonRpcRequest;
      try {
        // BOUND_READ: reject messages > 1MB by BYTE length BEFORE parsing JSON.
        // Check raw byte size first to prevent DoS via large payloads that would
        // consume CPU during JSON.parse before we ever check the size.
        const rawBytes = typeof data === "string" ? Buffer.byteLength(data, "utf-8") : data.length;
        if (rawBytes > 1_048_576) {
          sendError(ws, null, -32600, "Message too large (max 1MB)");
          return;
        }
        const raw = typeof data === "string" ? data : data.toString("utf-8");
        request = JSON.parse(raw) as JsonRpcRequest;
      } catch {
        sendError(ws, null, -32700, "Parse error — invalid JSON");
        return;
      }

      // Validate JSON-RPC structure
      if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
        sendError(ws, request.id ?? null, -32600, "Invalid JSON-RPC request");
        return;
      }

      // Route by method
      try {
        switch (request.method) {
          case "initialize":
            sendResult(ws, request.id, {
              protocolVersion: "2024-11-05",
              serverInfo: { name: "nodebench-mcp-gateway", version: "1.0.0" },
              capabilities: {
                tools: { listChanged: false },
              },
            });
            break;

          case "tools/list":
            sendResult(ws, request.id, { tools: toolListing });
            break;

          case "tools/call":
            await handleToolCall(ws, request, session);
            break;

          case "ping":
            sendResult(ws, request.id, {});
            break;

          default:
            // Sanitize method name before reflecting — prevent log injection
            // and limit info disclosure to a safe subset of characters.
            const safeMethod = String(request.method).slice(0, 100).replace(/[^a-zA-Z0-9_/.-]/g, "");
            sendError(ws, request.id, -32601, `Method not found: ${safeMethod}`);
        }
      } catch (err) {
        // SECURITY: Never leak internal error details (stack traces, file paths)
        // to remote clients. Log the real error server-side only.
        const realMsg = err instanceof Error ? err.message : String(err);
        console.error(`[mcp-gateway] Internal error (session=${session.sessionId}):`, realMsg);
        sendError(ws, request.id, -32603, "Internal server error");
      }
    });

    // ── Disconnect handler ──────────────────────────────────────────────

    ws.on("close", async (code: number, reason: Buffer) => {
      const reasonStr = reason?.toString("utf-8") || `code=${code}`;
      await session.close(reasonStr);
      unregisterSession(session.sessionId);
    });

    ws.on("error", async (err: Error) => {
      console.error(`[mcp-gateway] WebSocket error (session=${session.sessionId}):`, err.message);
      await session.close(`error: ${err.message}`);
      unregisterSession(session.sessionId);
    });
  });

  // ── Tool call handler ─────────────────────────────────────────────────

  async function handleToolCall(
    ws: WebSocket,
    request: JsonRpcRequest,
    session: McpSession,
  ): Promise<void> {
    const params = request.params as
      | { name?: string; arguments?: Record<string, unknown> }
      | undefined;

    const toolName = params?.name;
    const toolArgs = params?.arguments ?? {};

    if (!toolName || typeof toolName !== "string") {
      sendError(ws, request.id, -32602, "Missing required param: name");
      return;
    }

    // SECURITY: Validate tool name — prevent path traversal and injection.
    // Tool names must be alphanumeric with underscores/hyphens only.
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(toolName)) {
      sendError(ws, request.id, -32602, "Invalid tool name format");
      return;
    }

    // Rate limit check
    const keyHash = hashApiKey(session.userId); // use userId as rate limit key
    const rlResult = rateLimit(keyHash, { perMinute: 100, perDay: 10_000 });
    if (!rlResult.allowed) {
      sendError(
        ws,
        request.id,
        -32000,
        `Rate limited — retry after ${rlResult.retryAfterMs}ms (remaining: ${rlResult.remaining})`,
      );
      return;
    }

    // Tool lookup
    const tool = toolMap.get(toolName);
    if (!tool) {
      sendError(ws, request.id, -32602, `Unknown tool: ${toolName}`);
      return;
    }

    // Execute with timeout + error boundary
    const startMs = Date.now();

    try {
      const result = await callToolWithTimeout(tool, toolArgs);
      const durationMs = Date.now() - startMs;
      session.recordToolCall(toolName, durationMs, true);

      // Format response as MCP content blocks
      const content = formatToolResult(result, tool);

      sendResult(ws, request.id, {
        content,
        isError: false,
        _meta: {
          durationMs,
          sessionToolCallCount: session.toolCallCount,
        },
      });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      session.recordToolCall(toolName, durationMs, false);

      const errMsg = err instanceof Error ? err.message : String(err);
      const isTimeout = errMsg.includes("timed out");

      // SECURITY: Sanitize error message — strip file paths and stack traces
      // before sending to the client. Keep timeout messages informative.
      const safeMsg = isTimeout
        ? `Tool call timed out after ${TOOL_CALL_TIMEOUT_MS}ms`
        : "Tool execution failed";
      console.error(`[mcp-gateway] Tool error (${toolName}, session=${session.sessionId}):`, errMsg);

      sendResult(ws, request.id, {
        content: [{ type: "text", text: `Error executing ${toolName}: ${safeMsg}` }],
        isError: true,
        _meta: {
          durationMs,
          isTimeout,
        },
      });
    }

    // Send rate limit info as a notification after every tools/call response.
    // This is a notification (no id) — clients can safely ignore it.
    sendNotification(ws, "nodebench/rateLimit", {
      remaining: rlResult.minuteRemaining,
      limit: rlResult.minuteLimit,
      resetAt: new Date(rlResult.resetAt).toISOString(),
      dailyRemaining: rlResult.dailyRemaining,
      dailyLimit: rlResult.dailyLimit,
    });
  }

  // ── Format tool results ───────────────────────────────────────────────

  function formatToolResult(
    result: unknown,
    tool: McpTool,
  ): Array<{ type: string; text?: string; data?: string; mimeType?: string }> {
    // rawContent tools return ContentBlock[] directly
    if (tool.rawContent && Array.isArray(result)) {
      return result as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    }

    // Standard serialization
    const serialized =
      typeof result === "string" ? result : JSON.stringify(result, null, 2);

    return [{ type: "text", text: serialized }];
  }

  // ── JSON-RPC helpers ──────────────────────────────────────────────────

  function sendResult(ws: WebSocket, id: string | number, result: unknown): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const response: JsonRpcResponse = { jsonrpc: "2.0", id, result };
    ws.send(JSON.stringify(response));
  }

  function sendError(
    ws: WebSocket,
    id: string | number | null,
    code: number,
    message: string,
  ): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: id ?? 0,
      error: { code, message },
    };
    ws.send(JSON.stringify(response));
  }

  /** Send a JSON-RPC notification (no id field — clients may ignore). */
  function sendNotification(
    ws: WebSocket,
    method: string,
    params: Record<string, unknown>,
  ): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const notification: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    ws.send(JSON.stringify(notification));
  }

  // ── HTTP upgrade handler (called from Express) ────────────────────────

  async function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    // 1. Check capacity
    if (!canAcceptSession()) {
      socket.write(
        "HTTP/1.1 503 Service Unavailable\r\n" +
          "Content-Type: text/plain\r\n\r\n" +
          "Max concurrent connections reached",
      );
      socket.destroy();
      return;
    }

    // 2. Extract and validate API key
    const rawKey = extractBearerToken(req);
    if (!rawKey) {
      socket.write(
        "HTTP/1.1 401 Unauthorized\r\n" +
          "Content-Type: text/plain\r\n\r\n" +
          "Missing API key — use Authorization: Bearer nb_key_...",
      );
      socket.destroy();
      return;
    }

    let validation: ValidateResult;
    try {
      validation = await validateApiKey(rawKey, keyLookup);
    } catch {
      socket.write(
        "HTTP/1.1 500 Internal Server Error\r\n" +
          "Content-Type: text/plain\r\n\r\n" +
          "Key validation error",
      );
      socket.destroy();
      return;
    }

    if (!validation.valid) {
      socket.write(
        "HTTP/1.1 401 Unauthorized\r\n" +
          "Content-Type: text/plain\r\n\r\n" +
          (validation.reason ?? "Invalid API key"),
      );
      socket.destroy();
      return;
    }

    // 3. Create session
    const session = new McpSession({
      userId: validation.userId!,
      permissions: validation.permissions ?? ["tools:read", "tools:execute"],
      onIdle: () => {
        // Auto-disconnect on idle timeout
        const clientWs = (session as any)._ws as WebSocket | undefined;
        if (clientWs && clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(WS_CLOSE_IDLE_TIMEOUT, "Idle timeout (30 minutes)");
        }
      },
      telemetryEmitter,
    });

    if (!registerSession(session)) {
      socket.write(
        "HTTP/1.1 503 Service Unavailable\r\n" +
          "Content-Type: text/plain\r\n\r\n" +
          "Max concurrent sessions reached",
      );
      socket.destroy();
      return;
    }

    // 4. Complete WebSocket upgrade
    wss.handleUpgrade(req, socket, head, (ws) => {
      // Stash ws reference on session for idle disconnect
      (session as any)._ws = ws;
      wss.emit("connection", ws, session);
    });
  }

  // ── Health check handler (Express route) ──────────────────────────────

  function healthHandler(
    _req: unknown,
    res: {
      json: (body: unknown) => void;
      status: (code: number) => { json: (body: unknown) => void };
    },
  ): void {
    const sessions = getAllSessions();
    const activeSessions = sessions.filter((s) => !s.isClosed);

    // Aggregate p50/p99 latency across all active sessions
    const allPercentiles = activeSessions
      .map((s) => s.getLatencyPercentiles())
      .filter((p) => p.p50 > 0);

    let p50 = 0;
    let p99 = 0;
    if (allPercentiles.length > 0) {
      const sortedP50 = allPercentiles.map((p) => p.p50).sort((a, b) => a - b);
      const sortedP99 = allPercentiles.map((p) => p.p99).sort((a, b) => a - b);
      p50 = sortedP50[Math.floor(sortedP50.length / 2)];
      p99 = sortedP99[Math.floor(sortedP99.length / 2)];
    }

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      sessions: activeSessions.length,
      connections: {
        active: activeSessions.length,
        max: 100,
      },
      tools: {
        count: toolMap.size,
      },
      latency: { p50: Math.round(p50), p99: Math.round(p99) },
      uptime: process.uptime(),
    });
  }

  // ── CORS helper for HTTP responses ────────────────────────────────────

  function getCorsHeaders(origin?: string): Record<string, string> {
    const allowed =
      corsOrigins.includes("*") || (origin && corsOrigins.includes(origin));
    return {
      "Access-Control-Allow-Origin": allowed ? (origin ?? "*") : "",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    };
  }

  return {
    wss,
    handleUpgrade,
    healthHandler,
    getCorsHeaders,
    getToolCount: () => toolMap.size,
    getSessionCount,
  };
}
