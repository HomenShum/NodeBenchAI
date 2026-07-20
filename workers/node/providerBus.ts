/**
 * ProviderBus — Multi-provider WebSocket event bus for the Ambient Intelligence Layer.
 *
 * Enables external providers (Claude Code, OpenClaw, Cursor, custom agents) to:
 *   - Register with declared capabilities
 *   - Send events (chat.message, agent.task_completed, tool.called, etc.)
 *   - Receive context requests and respond with context packets
 *   - Participate in the ingestion queue via event routing
 *
 * Protocol: JSON messages over WebSocket (not JSON-RPC — lighter weight than MCP gateway).
 *
 * Endpoints:
 *   ws://host/bus          — WebSocket event bus
 *   GET /bus/health        — Health check (HTTP)
 *
 * Connection flow:
 *   1. Client opens WebSocket to /bus with Authorization: Bearer nb_key_...
 *   2. Server validates API key
 *   3. Client sends { type: "register", ... } with provider metadata + capabilities
 *   4. Bidirectional event flow begins
 *   5. Heartbeat every 30s keeps connection alive
 *
 * Security:
 *   - API key validated on upgrade (reuses mcpAuth.ts)
 *   - Rate limiting: 100 events/min per connection
 *   - Max 100 concurrent providers
 *   - 30min idle disconnect
 *   - Close codes: 4020 (auth), 4021 (rate limit), 4022 (timeout)
 */

import { type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import {
  validateApiKey,
  rateLimit,
  hashApiKey,
  isValidKeyFormat,
  type KeyLookupFn,
  type ValidateResult,
} from "./mcpAuth.js";

// ═══════════════════════════════════════════════════════════════════════════
// Close codes
// ═══════════════════════════════════════════════════════════════════════════

const WS_CLOSE_AUTH_FAILED = 4020;
const WS_CLOSE_RATE_LIMITED = 4021;
const WS_CLOSE_IDLE_TIMEOUT = 4022;
const WS_CLOSE_REGISTRATION_FAILED = 4023;
const WS_CLOSE_CAPACITY_FULL = 4024;

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const MAX_CONNECTIONS = 100;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_MISS_THRESHOLD = 2;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_MESSAGE_BYTES = 1_048_576; // 1MB
const RATE_LIMIT_PER_MINUTE = 100;
const MAX_EVENT_LOG_SIZE = 10_000;

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface ProviderBusConfig {
  /** Max concurrent provider connections (default: 100) */
  maxConnections?: number;
  /** Heartbeat interval in ms (default: 30_000) */
  heartbeatIntervalMs?: number;
  /** Idle timeout in ms (default: 30 * 60 * 1000) */
  idleTimeoutMs?: number;
  /** Max inbound message size in bytes (default: 1MB) */
  maxMessageSize?: number;
  /** Rate limit per minute per connection (default: 100) */
  rateLimitPerMinute?: number;
  /** Optional Convex-backed key lookup */
  keyLookup?: KeyLookupFn;
}

export interface ProviderRegistration {
  /** Human-readable provider name */
  providerName: string;
  /** Provider type (e.g. "claude-code", "openclaw", "cursor", "custom") */
  providerType: string;
  /** Declared capabilities */
  capabilities: string[];
  /** Optional version string */
  version?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface BusEvent {
  /** Event type (e.g. "chat.message", "agent.task_completed", "tool.called") */
  type: string;
  /** Event payload */
  payload: Record<string, unknown>;
  /** Source provider ID (set by server) */
  sourceProviderId?: string;
  /** Optional target provider ID (for directed events) */
  targetProviderId?: string;
  /** ISO 8601 timestamp (set by server) */
  timestamp?: string;
  /** Unique event ID (set by server) */
  eventId?: string;
}

export interface ContextRequest {
  /** Unique request ID for correlation */
  requestId: string;
  /** What context is being requested */
  query: string;
  /** Optional scope filter */
  scope?: string;
  /** Optional source provider */
  sourceProviderId?: string;
}

export interface ContextResponse {
  /** Correlation ID from the request */
  requestId: string;
  /** Context payload */
  context: Record<string, unknown>;
  /** Provider that responded */
  responderId?: string;
}

/** Inbound message envelope */
interface InboundMessage {
  type:
    | "register"
    | "event"
    | "context_request"
    | "context_response"
    | "heartbeat_ack";
  registration?: ProviderRegistration;
  event?: BusEvent;
  contextRequest?: ContextRequest;
  contextResponse?: ContextResponse;
}

/** Outbound message envelope */
interface OutboundMessage {
  type:
    | "registered"
    | "event"
    | "context_request"
    | "context_response"
    | "heartbeat"
    | "error";
  providerId?: string;
  event?: BusEvent;
  contextRequest?: ContextRequest;
  contextResponse?: ContextResponse;
  error?: string;
  timestamp?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Connected provider state
// ═══════════════════════════════════════════════════════════════════════════

interface ConnectedProvider {
  id: string;
  ws: WebSocket;
  userId: string;
  registration: ProviderRegistration | null;
  connectedAt: number;
  lastActivityAt: number;
  lastHeartbeatAt: number;
  missedHeartbeats: number;
  eventCount: number;
  rateLimitKey: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Event log entry (local ingestion queue)
// ═══════════════════════════════════════════════════════════════════════════

interface EventLogEntry {
  eventId: string;
  type: string;
  sourceProviderId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// ProviderBus
// ═══════════════════════════════════════════════════════════════════════════

export class ProviderBus extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private providers = new Map<string, ConnectedProvider>();
  private eventLog: EventLogEntry[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private readonly maxConnections: number;
  private readonly heartbeatIntervalMs: number;
  private readonly idleTimeoutMs: number;
  private readonly maxMessageSize: number;
  private readonly rateLimitPerMinute: number;
  private readonly keyLookup?: KeyLookupFn;

  constructor(config: ProviderBusConfig = {}) {
    super();
    this.maxConnections = config.maxConnections ?? MAX_CONNECTIONS;
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.idleTimeoutMs = config.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.maxMessageSize = config.maxMessageSize ?? MAX_MESSAGE_BYTES;
    this.rateLimitPerMinute = config.rateLimitPerMinute ?? RATE_LIMIT_PER_MINUTE;
    this.keyLookup = config.keyLookup;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Attach to an existing HTTP server. Creates the internal WebSocketServer
   * in noServer mode and starts the heartbeat loop.
   */
  attachToServer(_server: HttpServer, _path: string): void {
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on("connection", (ws: WebSocket, provider: ConnectedProvider) => {
      this.handleConnection(ws, provider);
    });

    // Start heartbeat loop
    this.heartbeatTimer = setInterval(() => {
      this.heartbeatTick();
    }, this.heartbeatIntervalMs);
  }

  /**
   * Handle WebSocket upgrade requests. Called from server/index.ts httpServer.on("upgrade").
   */
  async handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    // 1. Capacity check
    if (this.providers.size >= this.maxConnections) {
      socket.write(
        "HTTP/1.1 503 Service Unavailable\r\n" +
          "Content-Type: text/plain\r\n\r\n" +
          "Provider bus at capacity",
      );
      socket.destroy();
      return;
    }

    // 2. Auth
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

    let validation: ValidateResult;
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

    // 3. Create provider record
    const providerId = `prov_${randomUUID().slice(0, 8)}`;
    const now = Date.now();
    const provider: ConnectedProvider = {
      id: providerId,
      ws: null as unknown as WebSocket, // set in upgrade callback
      userId: validation.userId!,
      registration: null,
      connectedAt: now,
      lastActivityAt: now,
      lastHeartbeatAt: now,
      missedHeartbeats: 0,
      eventCount: 0,
      rateLimitKey: hashApiKey(validation.userId!),
    };

    // 4. Complete WebSocket upgrade
    this.wss!.handleUpgrade(req, socket, head, (ws) => {
      provider.ws = ws;
      this.providers.set(providerId, provider);
      this.wss!.emit("connection", ws, provider);
    });
  }

  // ── Connection handler ─────────────────────────────────────────────────

  private handleConnection(ws: WebSocket, provider: ConnectedProvider): void {
    // Send welcome
    this.send(ws, {
      type: "heartbeat",
      providerId: provider.id,
      timestamp: new Date().toISOString(),
    });

    ws.on("message", (data: Buffer | string) => {
      this.handleMessage(provider, data);
    });

    ws.on("close", (code: number, reason: Buffer) => {
      const reasonStr = reason?.toString("utf-8") || `code=${code}`;
      this.providers.delete(provider.id);
      this.emit("provider:disconnected", provider.id, code, reasonStr);
    });

    ws.on("error", (err: Error) => {
      console.error(`[provider-bus] WebSocket error (${provider.id}):`, err.message);
      this.providers.delete(provider.id);
    });

    this.emit("provider:connected", provider.id, provider.userId);
  }

  // ── Message routing ────────────────────────────────────────────────────

  private handleMessage(provider: ConnectedProvider, data: Buffer | string): void {
    provider.lastActivityAt = Date.now();

    // BOUND_READ: reject oversized messages before parsing
    const rawBytes =
      typeof data === "string" ? Buffer.byteLength(data, "utf-8") : data.length;
    if (rawBytes > this.maxMessageSize) {
      this.send(provider.ws, {
        type: "error",
        error: `Message too large (max ${this.maxMessageSize} bytes)`,
      });
      return;
    }

    // Rate limit check
    const rl = rateLimit(provider.rateLimitKey, {
      perMinute: this.rateLimitPerMinute,
      perDay: 100_000,
    });
    if (!rl.allowed) {
      this.send(provider.ws, {
        type: "error",
        error: `Rate limited — retry after ${rl.retryAfterMs}ms`,
      });
      return;
    }

    let msg: InboundMessage;
    try {
      const raw = typeof data === "string" ? data : data.toString("utf-8");
      msg = JSON.parse(raw) as InboundMessage;
    } catch {
      this.send(provider.ws, { type: "error", error: "Invalid JSON" });
      return;
    }

    if (!msg.type || typeof msg.type !== "string") {
      this.send(provider.ws, { type: "error", error: "Missing message type" });
      return;
    }

    switch (msg.type) {
      case "register":
        this.handleRegister(provider, msg.registration);
        break;
      case "event":
        this.handleEvent(provider, msg.event);
        break;
      case "context_request":
        this.handleContextRequest(provider, msg.contextRequest);
        break;
      case "context_response":
        this.handleContextResponse(provider, msg.contextResponse);
        break;
      case "heartbeat_ack":
        provider.lastHeartbeatAt = Date.now();
        provider.missedHeartbeats = 0;
        break;
      default:
        this.send(provider.ws, {
          type: "error",
          error: `Unknown message type: ${String(msg.type).slice(0, 50)}`,
        });
    }
  }

  // ── Register ───────────────────────────────────────────────────────────

  private handleRegister(
    provider: ConnectedProvider,
    registration?: ProviderRegistration,
  ): void {
    if (
      !registration ||
      !registration.providerName ||
      !registration.providerType
    ) {
      this.send(provider.ws, {
        type: "error",
        error: "Registration requires providerName and providerType",
      });
      return;
    }

    provider.registration = {
      providerName: String(registration.providerName).slice(0, 100),
      providerType: String(registration.providerType).slice(0, 50),
      capabilities: Array.isArray(registration.capabilities)
        ? registration.capabilities.slice(0, 50).map((c) => String(c).slice(0, 100))
        : [],
      version: registration.version
        ? String(registration.version).slice(0, 20)
        : undefined,
      metadata: registration.metadata ?? undefined,
    };

    this.send(provider.ws, {
      type: "registered",
      providerId: provider.id,
      timestamp: new Date().toISOString(),
    });

    this.emit("provider:registered", provider.id, provider.registration);
  }

  // ── Event routing ──────────────────────────────────────────────────────

  private handleEvent(
    provider: ConnectedProvider,
    event?: BusEvent,
  ): void {
    if (!event || !event.type) {
      this.send(provider.ws, {
        type: "error",
        error: "Event requires type and payload",
      });
      return;
    }

    const enrichedEvent: BusEvent = {
      ...event,
      sourceProviderId: provider.id,
      timestamp: new Date().toISOString(),
      eventId: randomUUID(),
      payload: event.payload ?? {},
    };

    provider.eventCount++;

    // Write to local event log (bounded)
    this.appendEventLog({
      eventId: enrichedEvent.eventId!,
      type: enrichedEvent.type,
      sourceProviderId: provider.id,
      timestamp: enrichedEvent.timestamp!,
      payload: enrichedEvent.payload,
    });

    // If directed, route to specific provider
    if (event.targetProviderId) {
      const target = this.providers.get(event.targetProviderId);
      if (target && target.ws.readyState === WebSocket.OPEN) {
        this.send(target.ws, { type: "event", event: enrichedEvent });
      }
    } else {
      // Broadcast to all other connected providers
      for (const [id, p] of this.providers) {
        if (id !== provider.id && p.ws.readyState === WebSocket.OPEN) {
          this.send(p.ws, { type: "event", event: enrichedEvent });
        }
      }
    }

    this.emit("event", enrichedEvent);
  }

  // ── Context request/response ───────────────────────────────────────────

  private handleContextRequest(
    provider: ConnectedProvider,
    request?: ContextRequest,
  ): void {
    if (!request || !request.requestId || !request.query) {
      this.send(provider.ws, {
        type: "error",
        error: "Context request requires requestId and query",
      });
      return;
    }

    const enrichedRequest: ContextRequest = {
      ...request,
      sourceProviderId: provider.id,
    };

    // Broadcast request to all other providers
    for (const [id, p] of this.providers) {
      if (id !== provider.id && p.ws.readyState === WebSocket.OPEN) {
        this.send(p.ws, {
          type: "context_request",
          contextRequest: enrichedRequest,
        });
      }
    }

    this.emit("context_request", enrichedRequest);
  }

  private handleContextResponse(
    provider: ConnectedProvider,
    response?: ContextResponse,
  ): void {
    if (!response || !response.requestId) {
      this.send(provider.ws, {
        type: "error",
        error: "Context response requires requestId",
      });
      return;
    }

    const enrichedResponse: ContextResponse = {
      ...response,
      responderId: provider.id,
    };

    // Route response back to the requester — find by checking who sent the original request.
    // Since we don't track request origins in-memory, broadcast to all.
    // The requester filters by requestId.
    for (const [id, p] of this.providers) {
      if (id !== provider.id && p.ws.readyState === WebSocket.OPEN) {
        this.send(p.ws, {
          type: "context_response",
          contextResponse: enrichedResponse,
        });
      }
    }

    this.emit("context_response", enrichedResponse);
  }

  // ── Event log (bounded ingestion queue) ────────────────────────────────

  private appendEventLog(entry: EventLogEntry): void {
    this.eventLog.push(entry);
    // BOUND: evict oldest when full
    if (this.eventLog.length > MAX_EVENT_LOG_SIZE) {
      this.eventLog = this.eventLog.slice(-Math.floor(MAX_EVENT_LOG_SIZE * 0.8));
    }
  }

  /** Read recent events from the local log. */
  getEventLog(limit: number = 100): EventLogEntry[] {
    return this.eventLog.slice(-limit);
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────

  private heartbeatTick(): void {
    const now = Date.now();

    for (const [id, provider] of this.providers) {
      // Check idle timeout
      if (now - provider.lastActivityAt > this.idleTimeoutMs) {
        if (provider.ws.readyState === WebSocket.OPEN) {
          provider.ws.close(WS_CLOSE_IDLE_TIMEOUT, "Idle timeout (30 minutes)");
        }
        this.providers.delete(id);
        this.emit("provider:timeout", id);
        continue;
      }

      // Check missed heartbeats
      const maxMissMs = this.heartbeatIntervalMs * HEARTBEAT_MISS_THRESHOLD;
      if (now - provider.lastHeartbeatAt > maxMissMs) {
        provider.missedHeartbeats++;
        if (provider.missedHeartbeats >= HEARTBEAT_MISS_THRESHOLD) {
          if (provider.ws.readyState === WebSocket.OPEN) {
            provider.ws.close(WS_CLOSE_IDLE_TIMEOUT, "Heartbeat timeout");
          }
          this.providers.delete(id);
          this.emit("provider:timeout", id);
          continue;
        }
      }

      // Send heartbeat ping
      if (provider.ws.readyState === WebSocket.OPEN) {
        this.send(provider.ws, {
          type: "heartbeat",
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // ── Send helper ────────────────────────────────────────────────────────

  private send(ws: WebSocket, msg: OutboundMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }

  // ── Bearer token extraction (same pattern as mcpGateway) ───────────────

  private extractBearerToken(req: IncomingMessage): string | null {
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7).trim();
    }

    try {
      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "localhost"}`,
      );
      const token = url.searchParams.get("token");
      if (token && isValidKeyFormat(token)) return token;
    } catch {
      // Invalid URL — ignore
    }

    return null;
  }

  // ── Health snapshot ────────────────────────────────────────────────────

  getHealthSnapshot(): {
    status: string;
    timestamp: string;
    providers: {
      connected: number;
      max: number;
      registered: number;
    };
    eventLog: {
      size: number;
      max: number;
    };
    uptime: number;
  } {
    const registered = [...this.providers.values()].filter(
      (p) => p.registration !== null,
    ).length;

    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      providers: {
        connected: this.providers.size,
        max: this.maxConnections,
        registered,
      },
      eventLog: {
        size: this.eventLog.length,
        max: MAX_EVENT_LOG_SIZE,
      },
      uptime: process.uptime(),
    };
  }

  /** List connected providers (for admin/debug). */
  getConnectedProviders(): Array<{
    id: string;
    userId: string;
    providerName: string | null;
    providerType: string | null;
    capabilities: string[];
    connectedAt: string;
    eventCount: number;
  }> {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      userId: p.userId,
      providerName: p.registration?.providerName ?? null,
      providerType: p.registration?.providerType ?? null,
      capabilities: p.registration?.capabilities ?? [],
      connectedAt: new Date(p.connectedAt).toISOString(),
      eventCount: p.eventCount,
    }));
  }

  // ── Shutdown ───────────────────────────────────────────────────────────

  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const [id, provider] of this.providers) {
      try {
        if (provider.ws.readyState === WebSocket.OPEN) {
          provider.ws.close(1001, "Server shutting down");
        }
      } catch {
        // Ignore close errors during shutdown
      }
      this.providers.delete(id);
    }

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// mountProviderBus — factory for Express integration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a ProviderBus, attach it to the HTTP server, and register
 * the /bus/health Express route. Returns the bus instance and the
 * handleUpgrade function for wiring into httpServer.on("upgrade").
 */
export function mountProviderBus(
  app: {
    get: (
      path: string,
      handler: (
        req: unknown,
        res: { json: (body: unknown) => void },
      ) => void,
    ) => void;
  },
  httpServer: HttpServer,
  config?: ProviderBusConfig,
): { bus: ProviderBus; handleUpgrade: typeof ProviderBus.prototype.handleUpgrade } {
  const bus = new ProviderBus(config);
  bus.attachToServer(httpServer, "/bus");

  // Health endpoint
  app.get("/bus/health", (_req, res) => {
    res.json(bus.getHealthSnapshot());
  });

  return {
    bus,
    handleUpgrade: bus.handleUpgrade.bind(bus),
  };
}
