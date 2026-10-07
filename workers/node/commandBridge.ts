/**
 * Command Bridge — Outbound WebSocket server for agent command dispatch.
 *
 * Manages bidirectional connections with local Claude Code / OpenClaw agents.
 * Dispatches structured task packets and receives results/evidence back.
 *
 * Separate from mcpGateway.ts which handles inbound MCP tool calls.
 *
 * Connection flow:
 *   1. Agent opens WebSocket to /bridge with Authorization: Bearer nb_key_...
 *   2. Server validates API key (reuses mcpAuth)
 *   3. Agent sends "register" message with capabilities
 *   4. Bridge acks with "registered" + workspace context
 *   5. Bridge dispatches task packets; agent returns results
 *   6. Heartbeat ping every 30s; 2 missed = disconnect
 *
 * Security:
 *   - API key validated on upgrade (before WebSocket handshake completes)
 *   - Rate limiting: 50 messages/min per agent
 *   - Max 50 concurrent agent connections
 *   - Message size cap: 1MB (validated before JSON.parse)
 *   - Packet IDs validated: alphanumeric + dash + underscore only
 *   - Internal errors never leaked to agents
 *   - All task dispatches and results logged server-side
 *
 * Close codes:
 *   4001 — Auth failure (shared with MCP gateway)
 *   4010 — Registration failed
 *   4011 — Capability mismatch
 *   4012 — Task timeout
 *   4013 — Rate limited
 */

import { type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { EventEmitter } from "node:events";

import {
  validateApiKey,
  rateLimit,
  hashApiKey,
  isValidKeyFormat,
  type KeyLookupFn,
} from "./mcpAuth.js";

// ═══════════════════════════════════════════════════════════════════════════
// Public types — exported for client SDK consumption
// ═══════════════════════════════════════════════════════════════════════════

/** Task types that can be dispatched to agents */
export type TaskType =
  | "retrieve_items"
  | "setup_resource"
  | "run_analysis"
  | "execute_action"
  | "check_status"
  | "generate_artifact"
  | "custom";

/** Priority levels for task dispatch ordering */
export type TaskPriority = "low" | "medium" | "high" | "critical";

/** Specifies what level of detail the agent should return */
export type ReturnFormat =
  | "summary_only"
  | "summary_plus_evidence"
  | "full_artifacts"
  | "structured_data";

/** Task packet sent to an agent for execution */
export interface OutboundTaskPacket {
  packetId: string;
  taskType: TaskType;
  title: string;
  instructions: string;
  requestedCapabilities: string[];
  priority: TaskPriority;
  returnFormat: ReturnFormat;
  context: {
    workspaceId: string;
    companyId?: string;
    initiativeId?: string;
    companyName?: string;
    initiativeName?: string;
  };
  timeout: number; // ms
  createdAt: string; // ISO 8601
}

/** Artifact returned by an agent as part of task completion */
export interface TaskArtifact {
  type: "file" | "text" | "json" | "screenshot" | "log";
  name: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/** Evidence item returned by an agent */
export interface TaskEvidence {
  type: string;
  content: string;
  sourceRef?: string;
}

/** Result received from an agent after task execution */
export interface InboundTaskResult {
  packetId: string;
  status: "completed" | "failed" | "partial";
  summary: string;
  artifacts?: TaskArtifact[];
  evidence?: TaskEvidence[];
  errorMessage?: string;
  durationMs: number;
}

/** Progress update sent by agent during task execution */
export interface TaskProgress {
  packetId: string;
  percentComplete: number; // 0-100
  currentStep: string;
  stepsCompleted: number;
  stepsTotal: number;
}

/** Agent self-description sent during registration */
export interface AgentRegistration {
  agentName: string;
  agentType: "claude_code" | "openclaw" | "other";
  runtimeSurface: "local" | "remote" | "hybrid";
  capabilities: string[];
  platform: string;
  version?: string;
}

/** Approval request from agent (e.g. destructive action needs human OK) */
export interface ApprovalRequest {
  packetId: string;
  action: string;
  description: string;
  risk: "low" | "medium" | "high";
}

/** Message envelope for all bridge WebSocket communication */
export interface BridgeMessage {
  type:
    | "register"
    | "registered"
    | "heartbeat"
    | "task_dispatch"
    | "task_result"
    | "task_progress"
    | "approval_request"
    | "approval_response"
    | "error";
  id: string; // message ID for correlation
  timestamp: string;
  payload: unknown;
}

/** Result of attempting to dispatch a task */
export interface DispatchResult {
  dispatched: boolean;
  reason?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal types
// ═══════════════════════════════════════════════════════════════════════════

interface AgentConnection {
  ws: WebSocket;
  agentId: string;
  userId: string;
  registration: AgentRegistration;
  connectedAt: number;
  lastPongAt: number;
  messageCount: number; // for rate limiting window
  messageWindowStart: number; // epoch ms for rate limit window
}

interface PendingTask {
  packet: OutboundTaskPacket;
  agentId: string;
  dispatchedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants — BOUND all collections and enforce timeouts
// ═══════════════════════════════════════════════════════════════════════════

const MAX_CONNECTIONS = 50;
const MAX_PENDING_TASKS = 500;
const DEFAULT_TASK_TIMEOUT_MS = 300_000; // 5 min
const HEARTBEAT_INTERVAL_MS = 30_000; // 30s
const HEARTBEAT_MISS_THRESHOLD = 2; // 2 missed = disconnect (60s)
const MAX_MESSAGE_BYTES = 1_048_576; // 1MB
const RATE_LIMIT_PER_MINUTE = 50;
const PACKET_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

// Custom close codes
const WS_CLOSE_AUTH_FAILED = 4001;
const WS_CLOSE_REGISTRATION_FAILED = 4010;
const WS_CLOSE_CAPABILITY_MISMATCH = 4011;
const WS_CLOSE_TASK_TIMEOUT = 4012;
const WS_CLOSE_RATE_LIMITED = 4013;

// ═══════════════════════════════════════════════════════════════════════════
// CommandBridge configuration
// ═══════════════════════════════════════════════════════════════════════════

export interface CommandBridgeConfig {
  /** Max concurrent agent connections (default: 50) */
  maxConnections?: number;
  /** Default task timeout in ms (default: 300_000 = 5 min) */
  taskTimeoutMs?: number;
  /** Heartbeat interval in ms (default: 30_000 = 30s) */
  heartbeatIntervalMs?: number;
  /** Max inbound message size in bytes (default: 1MB) */
  maxMessageSize?: number;
  /** Optional Convex-backed key lookup */
  keyLookup?: KeyLookupFn;
}

// ═══════════════════════════════════════════════════════════════════════════
// CommandBridge
// ═══════════════════════════════════════════════════════════════════════════

export class CommandBridge extends EventEmitter {
  private readonly connections: Map<string, AgentConnection> = new Map();
  private readonly pendingTasks: Map<string, PendingTask> = new Map();
  private readonly maxConnections: number;
  private readonly taskTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly maxMessageSize: number;
  private readonly keyLookup?: KeyLookupFn;

  private wss: WebSocketServer | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: CommandBridgeConfig = {}) {
    super();
    this.maxConnections = Math.min(config.maxConnections ?? MAX_CONNECTIONS, MAX_CONNECTIONS);
    this.taskTimeoutMs = config.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.maxMessageSize = Math.min(config.maxMessageSize ?? MAX_MESSAGE_BYTES, MAX_MESSAGE_BYTES);
    this.keyLookup = config.keyLookup;
  }

  // ── Attach to HTTP server ───────────────────────────────────────────────

  /**
   * Wire the bridge's WebSocket upgrade handler onto an HTTP server.
   * Call this once during server bootstrap.
   */
  attachToServer(_server: HttpServer, _path: string): void {
    // Create WebSocket server in noServer mode (we handle upgrade ourselves)
    this.wss = new WebSocketServer({ noServer: true });

    // Start heartbeat loop
    this.heartbeatTimer = setInterval(() => {
      this.runHeartbeat();
    }, this.heartbeatIntervalMs);

    // Periodic stale connection cleanup (every 5 heartbeat intervals)
    setInterval(() => {
      this.cleanupStaleConnections();
    }, this.heartbeatIntervalMs * 5);

    console.error(`[command-bridge] Initialized — max ${this.maxConnections} agents, heartbeat ${this.heartbeatIntervalMs}ms`);
  }

  /**
   * Handle an HTTP upgrade request for the /bridge path.
   * Called from the server's "upgrade" event handler.
   */
  async handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    // 1. Capacity check
    if (this.connections.size >= this.maxConnections) {
      socket.write(
        "HTTP/1.1 503 Service Unavailable\r\n" +
          "Content-Type: text/plain\r\n\r\n" +
          "Max concurrent agent connections reached",
      );
      socket.destroy();
      return;
    }

    // 2. Extract and validate API key
    const rawKey = this.extractBearerToken(req);
    if (!rawKey) {
      socket.write(
        "HTTP/1.1 401 Unauthorized\r\n" +
          "Content-Type: text/plain\r\n\r\n" +
          "Missing API key — use Authorization: Bearer nb_key_...",
      );
      socket.destroy();
      return;
    }

    let validation;
    try {
      validation = await validateApiKey(rawKey, this.keyLookup);
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

    const userId = validation.userId!;
    const agentId = `agent_${randomUUID()}`;

    // 3. Complete WebSocket upgrade
    if (!this.wss) {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\nBridge not initialized");
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.handleNewConnection(ws, agentId, userId);
    });
  }

  // ── Connection lifecycle ────────────────────────────────────────────────

  private handleNewConnection(ws: WebSocket, agentId: string, userId: string): void {
    // Agent must send a "register" message within 10s or get disconnected
    const registrationTimeout = setTimeout(() => {
      if (!this.connections.has(agentId)) {
        console.error(`[command-bridge] Agent ${agentId} failed to register within 10s`);
        ws.close(WS_CLOSE_REGISTRATION_FAILED, "Registration timeout");
      }
    }, 10_000);

    ws.on("message", (data: Buffer | string) => {
      // BOUND_READ: reject messages > maxMessageSize BEFORE JSON.parse
      const rawBytes = typeof data === "string" ? Buffer.byteLength(data, "utf-8") : data.length;
      if (rawBytes > this.maxMessageSize) {
        this.sendBridgeMessage(ws, {
          type: "error",
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          payload: { code: "MESSAGE_TOO_LARGE", message: "Message exceeds 1MB limit" },
        });
        return;
      }

      let message: BridgeMessage;
      try {
        const raw = typeof data === "string" ? data : data.toString("utf-8");
        message = JSON.parse(raw) as BridgeMessage;
      } catch {
        this.sendBridgeMessage(ws, {
          type: "error",
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          payload: { code: "PARSE_ERROR", message: "Invalid JSON" },
        });
        return;
      }

      // Validate envelope structure
      if (!message.type || typeof message.type !== "string" || !message.id) {
        this.sendBridgeMessage(ws, {
          type: "error",
          id: message?.id ?? randomUUID(),
          timestamp: new Date().toISOString(),
          payload: { code: "INVALID_ENVELOPE", message: "Missing type or id" },
        });
        return;
      }

      // Handle registration (before agent is in connections map)
      if (message.type === "register") {
        clearTimeout(registrationTimeout);
        this.handleRegistration(ws, agentId, userId, message);
        return;
      }

      // All other messages require an active connection
      const conn = this.connections.get(agentId);
      if (!conn) {
        this.sendBridgeMessage(ws, {
          type: "error",
          id: message.id,
          timestamp: new Date().toISOString(),
          payload: { code: "NOT_REGISTERED", message: "Send register message first" },
        });
        return;
      }

      // Rate limit check (50/min per agent)
      if (!this.checkAgentRateLimit(conn)) {
        this.sendBridgeMessage(ws, {
          type: "error",
          id: message.id,
          timestamp: new Date().toISOString(),
          payload: { code: "RATE_LIMITED", message: "Rate limit exceeded (50/min)" },
        });
        ws.close(WS_CLOSE_RATE_LIMITED, "Rate limited");
        return;
      }

      this.handleMessage(agentId, message);
    });

    ws.on("close", (code: number, reason: Buffer) => {
      clearTimeout(registrationTimeout);
      const reasonStr = reason?.toString("utf-8") || `code=${code}`;
      this.handleDisconnect(agentId, code, reasonStr);
    });

    ws.on("error", (err: Error) => {
      console.error(`[command-bridge] WebSocket error (agent=${agentId}):`, err.message);
      this.handleDisconnect(agentId, 1006, `error: ${err.message}`);
    });

    // Respond to pong frames (heartbeat)
    ws.on("pong", () => {
      const conn = this.connections.get(agentId);
      if (conn) {
        conn.lastPongAt = Date.now();
      }
    });
  }

  private handleRegistration(
    ws: WebSocket,
    agentId: string,
    userId: string,
    message: BridgeMessage,
  ): void {
    const reg = message.payload as Partial<AgentRegistration> | null;

    // Validate registration payload
    if (
      !reg ||
      typeof reg.agentName !== "string" ||
      !reg.agentName ||
      typeof reg.agentType !== "string" ||
      !["claude_code", "openclaw", "other"].includes(reg.agentType) ||
      typeof reg.runtimeSurface !== "string" ||
      !["local", "remote", "hybrid"].includes(reg.runtimeSurface) ||
      !Array.isArray(reg.capabilities) ||
      typeof reg.platform !== "string"
    ) {
      this.sendBridgeMessage(ws, {
        type: "error",
        id: message.id,
        timestamp: new Date().toISOString(),
        payload: {
          code: "INVALID_REGISTRATION",
          message: "Missing or invalid registration fields: agentName, agentType, runtimeSurface, capabilities, platform",
        },
      });
      ws.close(WS_CLOSE_REGISTRATION_FAILED, "Invalid registration");
      return;
    }

    // BOUND: enforce max connections (double-check after async)
    if (this.connections.size >= this.maxConnections) {
      this.sendBridgeMessage(ws, {
        type: "error",
        id: message.id,
        timestamp: new Date().toISOString(),
        payload: { code: "CAPACITY_FULL", message: "Max agent connections reached" },
      });
      ws.close(WS_CLOSE_REGISTRATION_FAILED, "Capacity full");
      return;
    }

    // Sanitize capabilities: limit count and string length
    const sanitizedCapabilities = reg.capabilities
      .slice(0, 100)
      .map((c) => String(c).slice(0, 128).replace(/[^a-zA-Z0-9_:.-]/g, ""));

    const registration: AgentRegistration = {
      agentName: String(reg.agentName).slice(0, 128),
      agentType: reg.agentType as AgentRegistration["agentType"],
      runtimeSurface: reg.runtimeSurface as AgentRegistration["runtimeSurface"],
      capabilities: sanitizedCapabilities,
      platform: String(reg.platform).slice(0, 128),
      version: reg.version ? String(reg.version).slice(0, 64) : undefined,
    };

    const conn: AgentConnection = {
      ws,
      agentId,
      userId,
      registration,
      connectedAt: Date.now(),
      lastPongAt: Date.now(),
      messageCount: 0,
      messageWindowStart: Date.now(),
    };

    this.connections.set(agentId, conn);

    console.error(
      `[command-bridge] Agent registered: ${registration.agentName} (${agentId}) — ` +
        `type=${registration.agentType}, capabilities=[${sanitizedCapabilities.join(",")}]`,
    );

    // Send registration acknowledgment
    this.sendBridgeMessage(ws, {
      type: "registered",
      id: message.id,
      timestamp: new Date().toISOString(),
      payload: {
        agentId,
        heartbeatIntervalMs: this.heartbeatIntervalMs,
        maxMessageSize: this.maxMessageSize,
        taskTimeoutMs: this.taskTimeoutMs,
      },
    });

    this.emit("agent:connected", agentId, registration);
  }

  // ── Message routing ─────────────────────────────────────────────────────

  private handleMessage(agentId: string, message: BridgeMessage): void {
    switch (message.type) {
      case "heartbeat":
        // Agent-initiated heartbeat; ack it
        this.sendToAgent(agentId, {
          type: "heartbeat",
          id: message.id,
          timestamp: new Date().toISOString(),
          payload: { status: "ok" },
        });
        break;

      case "task_result":
        this.handleTaskResult(agentId, message.payload as InboundTaskResult);
        break;

      case "task_progress":
        this.handleTaskProgress(agentId, message.payload as TaskProgress);
        break;

      case "approval_request":
        this.handleApprovalRequest(agentId, message.payload as ApprovalRequest);
        break;

      default: {
        // SECURITY: sanitize type before logging
        const safeType = String(message.type).slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, "");
        console.error(`[command-bridge] Unknown message type from agent=${agentId}: ${safeType}`);
        this.sendToAgent(agentId, {
          type: "error",
          id: message.id,
          timestamp: new Date().toISOString(),
          payload: { code: "UNKNOWN_TYPE", message: `Unknown message type: ${safeType}` },
        });
      }
    }
  }

  private handleTaskResult(agentId: string, result: InboundTaskResult): void {
    if (!result || typeof result.packetId !== "string") {
      console.error(`[command-bridge] Invalid task result from agent=${agentId}: missing packetId`);
      return;
    }

    // Validate packetId format
    if (!PACKET_ID_REGEX.test(result.packetId)) {
      console.error(`[command-bridge] Invalid packetId format from agent=${agentId}`);
      return;
    }

    const pending = this.pendingTasks.get(result.packetId);
    if (!pending) {
      console.error(`[command-bridge] Task result for unknown packetId=${result.packetId} from agent=${agentId}`);
      return;
    }

    if (pending.agentId !== agentId) {
      console.error(
        `[command-bridge] Task result for packetId=${result.packetId} from wrong agent ` +
          `(expected=${pending.agentId}, got=${agentId})`,
      );
      return;
    }

    // Clear timeout
    clearTimeout(pending.timer);
    this.pendingTasks.delete(result.packetId);

    // Sanitize result status
    const validStatuses = ["completed", "failed", "partial"] as const;
    const status = validStatuses.includes(result.status as typeof validStatuses[number])
      ? result.status
      : "failed";

    // BOUND: cap artifacts and evidence arrays
    const sanitizedResult: InboundTaskResult = {
      packetId: result.packetId,
      status,
      summary: String(result.summary ?? "").slice(0, 10_000),
      artifacts: Array.isArray(result.artifacts)
        ? result.artifacts.slice(0, 50).map((a) => ({
            type: ["file", "text", "json", "screenshot", "log"].includes(a.type) ? a.type : "text",
            name: String(a.name ?? "").slice(0, 256),
            content: String(a.content ?? "").slice(0, 500_000), // 500KB per artifact
            metadata: a.metadata && typeof a.metadata === "object" ? a.metadata : undefined,
          }))
        : undefined,
      evidence: Array.isArray(result.evidence)
        ? result.evidence.slice(0, 100).map((e) => ({
            type: String(e.type ?? "").slice(0, 128),
            content: String(e.content ?? "").slice(0, 50_000),
            sourceRef: e.sourceRef ? String(e.sourceRef).slice(0, 512) : undefined,
          }))
        : undefined,
      errorMessage: result.errorMessage ? String(result.errorMessage).slice(0, 2_000) : undefined,
      durationMs: typeof result.durationMs === "number" ? Math.max(0, result.durationMs) : 0,
    };

    console.error(
      `[command-bridge] Task result: packetId=${result.packetId}, status=${status}, ` +
        `agent=${agentId}, durationMs=${sanitizedResult.durationMs}`,
    );

    this.emit("task:result", sanitizedResult, agentId);
  }

  private handleTaskProgress(agentId: string, progress: TaskProgress): void {
    if (!progress || !PACKET_ID_REGEX.test(progress.packetId ?? "")) return;

    const pending = this.pendingTasks.get(progress.packetId);
    if (!pending || pending.agentId !== agentId) return;

    const sanitizedProgress: TaskProgress = {
      packetId: progress.packetId,
      percentComplete: Math.max(0, Math.min(100, Number(progress.percentComplete) || 0)),
      currentStep: String(progress.currentStep ?? "").slice(0, 512),
      stepsCompleted: Math.max(0, Number(progress.stepsCompleted) || 0),
      stepsTotal: Math.max(0, Number(progress.stepsTotal) || 0),
    };

    this.emit("task:progress", sanitizedProgress, agentId);
  }

  private handleApprovalRequest(agentId: string, request: ApprovalRequest): void {
    if (!request || !PACKET_ID_REGEX.test(request.packetId ?? "")) return;

    const sanitized: ApprovalRequest = {
      packetId: request.packetId,
      action: String(request.action ?? "").slice(0, 256),
      description: String(request.description ?? "").slice(0, 2_000),
      risk: ["low", "medium", "high"].includes(request.risk) ? request.risk : "high",
    };

    this.emit("task:approval_request", sanitized, agentId);
  }

  // ── Task dispatch ───────────────────────────────────────────────────────

  /**
   * Dispatch a task packet to a specific connected agent.
   * Returns immediately after sending (does not wait for completion).
   */
  /**
   * Dispatch a task packet to a specific connected agent.
   * SECURITY: userId is required to verify the caller owns the target agent.
   * Returns immediately after sending (does not wait for completion).
   */
  dispatchTask(userId: string, agentId: string, packet: OutboundTaskPacket): DispatchResult {
    // Validate agent connection
    const conn = this.connections.get(agentId);
    if (!conn) {
      return { dispatched: false, reason: "Agent not connected" };
    }

    // SECURITY: verify the dispatching user owns this agent connection
    if (conn.userId !== userId) {
      return { dispatched: false, reason: "Access denied — agent belongs to different user" };
    }

    if (conn.ws.readyState !== WebSocket.OPEN) {
      return { dispatched: false, reason: "Agent WebSocket not open" };
    }

    // Validate packet ID format
    if (!PACKET_ID_REGEX.test(packet.packetId)) {
      return { dispatched: false, reason: "Invalid packetId format (alphanumeric, dash, underscore only, max 128 chars)" };
    }

    // Check for duplicate packetId
    if (this.pendingTasks.has(packet.packetId)) {
      return { dispatched: false, reason: "Duplicate packetId — task already pending" };
    }

    // BOUND: check pending task capacity
    if (this.pendingTasks.size >= MAX_PENDING_TASKS) {
      return { dispatched: false, reason: "Max pending tasks reached" };
    }

    // Validate requested capabilities against agent's registration
    const missingCapabilities = packet.requestedCapabilities.filter(
      (cap) => !conn.registration.capabilities.includes(cap),
    );
    if (missingCapabilities.length > 0) {
      return {
        dispatched: false,
        reason: `Agent missing capabilities: ${missingCapabilities.join(", ")}`,
      };
    }

    // Set up timeout
    const timeoutMs = Math.min(packet.timeout || this.taskTimeoutMs, this.taskTimeoutMs);
    const timer = setTimeout(() => {
      this.handleTaskTimeout(packet.packetId, agentId);
    }, timeoutMs);

    // Register pending task
    this.pendingTasks.set(packet.packetId, {
      packet,
      agentId,
      dispatchedAt: Date.now(),
      timer,
    });

    // Send task dispatch message
    const dispatched = this.sendToAgent(agentId, {
      type: "task_dispatch",
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      payload: packet,
    });

    if (!dispatched) {
      clearTimeout(timer);
      this.pendingTasks.delete(packet.packetId);
      return { dispatched: false, reason: "Failed to send message to agent" };
    }

    console.error(
      `[command-bridge] Task dispatched: packetId=${packet.packetId}, ` +
        `type=${packet.taskType}, agent=${agentId}, timeout=${timeoutMs}ms`,
    );

    return { dispatched: true };
  }

  /**
   * Send an approval response to an agent for a pending approval request.
   * SECURITY: userId required to verify caller owns the target agent.
   */
  sendApprovalResponse(
    userId: string,
    agentId: string,
    packetId: string,
    approved: boolean,
    reason?: string,
  ): boolean {
    const conn = this.connections.get(agentId);
    if (!conn || conn.userId !== userId) return false;
    return this.sendToAgent(agentId, {
      type: "approval_response",
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      payload: { packetId, approved, reason },
    });
  }

  private handleTaskTimeout(packetId: string, agentId: string): void {
    const pending = this.pendingTasks.get(packetId);
    if (!pending) return;

    this.pendingTasks.delete(packetId);

    console.error(`[command-bridge] Task timeout: packetId=${packetId}, agent=${agentId}`);

    // Notify the agent that the task timed out
    this.sendToAgent(agentId, {
      type: "error",
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      payload: { code: "TASK_TIMEOUT", packetId, message: "Task execution timed out" },
    });

    // Emit timeout as a failed result for upstream consumption
    const timeoutResult: InboundTaskResult = {
      packetId,
      status: "failed",
      summary: "Task timed out",
      errorMessage: `Task exceeded timeout of ${pending.packet.timeout}ms`,
      durationMs: Date.now() - pending.dispatchedAt,
    };

    this.emit("task:result", timeoutResult, agentId);
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────

  private runHeartbeat(): void {
    const now = Date.now();
    const maxMissMs = this.heartbeatIntervalMs * HEARTBEAT_MISS_THRESHOLD;

    for (const [agentId, conn] of this.connections) {
      // Check for missed pongs
      if (now - conn.lastPongAt > maxMissMs) {
        console.error(
          `[command-bridge] Agent ${agentId} missed ${HEARTBEAT_MISS_THRESHOLD} heartbeats — disconnecting`,
        );
        conn.ws.close(1001, "Heartbeat timeout");
        this.handleDisconnect(agentId, 1001, "Heartbeat timeout");
        continue;
      }

      // Send ping
      if (conn.ws.readyState === WebSocket.OPEN) {
        try {
          conn.ws.ping();
        } catch {
          // Ignore ping errors; next heartbeat will catch it
        }
      }
    }
  }

  // ── Disconnect handling ─────────────────────────────────────────────────

  private handleDisconnect(agentId: string, code: number, reason: string): void {
    const conn = this.connections.get(agentId);
    if (!conn) return;

    this.connections.delete(agentId);

    // Fail all pending tasks for this agent
    for (const [packetId, pending] of this.pendingTasks) {
      if (pending.agentId === agentId) {
        clearTimeout(pending.timer);
        this.pendingTasks.delete(packetId);

        const failResult: InboundTaskResult = {
          packetId,
          status: "failed",
          summary: "Agent disconnected before task completion",
          errorMessage: `Agent disconnected: ${reason}`,
          durationMs: Date.now() - pending.dispatchedAt,
        };
        this.emit("task:result", failResult, agentId);
      }
    }

    console.error(
      `[command-bridge] Agent disconnected: ${conn.registration.agentName} (${agentId}) — ` +
        `code=${code}, reason=${reason}`,
    );

    this.emit("agent:disconnected", agentId, code, reason);
  }

  // ── Stale connection cleanup ────────────────────────────────────────────

  private cleanupStaleConnections(): void {
    for (const [agentId, conn] of this.connections) {
      if (conn.ws.readyState === WebSocket.CLOSED || conn.ws.readyState === WebSocket.CLOSING) {
        this.handleDisconnect(agentId, 1006, "Stale connection cleanup");
      }
    }
  }

  // ── Rate limiting (per agent, in-memory sliding window) ─────────────────

  private checkAgentRateLimit(conn: AgentConnection): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;

    // Reset window if it expired
    if (conn.messageWindowStart < oneMinuteAgo) {
      conn.messageCount = 0;
      conn.messageWindowStart = now;
    }

    conn.messageCount++;
    return conn.messageCount <= RATE_LIMIT_PER_MINUTE;
  }

  // ── Query methods ───────────────────────────────────────────────────────

  /** Get all connected agent IDs for a specific user */
  getConnectedAgents(userId: string): string[] {
    const result: string[] = [];
    for (const [agentId, conn] of this.connections) {
      if (conn.userId === userId) result.push(agentId);
    }
    return result;
  }

  /** Check if a specific agent is connected and belongs to the given user */
  isAgentConnected(userId: string, agentId: string): boolean {
    const conn = this.connections.get(agentId);
    return !!conn && conn.userId === userId && conn.ws.readyState === WebSocket.OPEN;
  }

  /** Get registration info for a connected agent (user-scoped) */
  getAgentRegistration(userId: string, agentId: string): AgentRegistration | null {
    const conn = this.connections.get(agentId);
    if (!conn || conn.userId !== userId) return null;
    return conn.registration;
  }

  /** Get count of pending tasks */
  getPendingTaskCount(): number {
    return this.pendingTasks.size;
  }

  /** Find connected agents that have a specific capability (user-scoped) */
  findAgentsByCapability(userId: string, capability: string): string[] {
    const result: string[] = [];
    for (const [agentId, conn] of this.connections) {
      if (
        conn.userId === userId &&
        conn.registration.capabilities.includes(capability) &&
        conn.ws.readyState === WebSocket.OPEN
      ) {
        result.push(agentId);
      }
    }
    return result;
  }

  /**
   * Broadcast a message to all connected agents belonging to a specific user.
   * SECURITY: Never use an unscoped broadcast — agents from different users
   * must never receive each other's messages.
   */
  broadcastToUser(userId: string, message: BridgeMessage): void {
    for (const [agentId, conn] of this.connections) {
      if (conn.userId === userId) {
        this.sendToAgent(agentId, message);
      }
    }
  }

  // ── Health info ─────────────────────────────────────────────────────────

  /** Health snapshot for the /bridge/health endpoint */
  getHealthSnapshot(): {
    status: string;
    timestamp: string;
    agents: {
      connected: number;
      max: number;
      types: Record<string, number>;
    };
    tasks: {
      pending: number;
      max: number;
    };
    uptime: number;
  } {
    const typeCounts: Record<string, number> = {};
    for (const conn of this.connections.values()) {
      const t = conn.registration.agentType;
      typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    }

    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      agents: {
        connected: this.connections.size,
        max: this.maxConnections,
        types: typeCounts,
      },
      tasks: {
        pending: this.pendingTasks.size,
        max: MAX_PENDING_TASKS,
      },
      uptime: process.uptime(),
    };
  }

  // ── Shutdown ────────────────────────────────────────────────────────────

  /** Graceful shutdown — close all agent connections */
  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Clear all pending task timers
    for (const [, pending] of this.pendingTasks) {
      clearTimeout(pending.timer);
    }
    this.pendingTasks.clear();

    // Close all agent connections
    for (const [agentId, conn] of this.connections) {
      try {
        conn.ws.close(1001, "Server shutting down");
      } catch {
        // Ignore close errors during shutdown
      }
      this.connections.delete(agentId);
    }

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    console.error("[command-bridge] Shutdown complete");
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private sendToAgent(agentId: string, message: BridgeMessage): boolean {
    const conn = this.connections.get(agentId);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) return false;

    try {
      conn.ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[command-bridge] Send error to agent=${agentId}:`, errMsg);
      return false;
    }
  }

  private sendBridgeMessage(ws: WebSocket, message: BridgeMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Ignore send errors
    }
  }

  private extractBearerToken(req: IncomingMessage): string | null {
    // Authorization header
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7).trim();
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
}
