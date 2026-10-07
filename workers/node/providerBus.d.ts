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
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type KeyLookupFn } from "./mcpAuth.js";
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
interface EventLogEntry {
    eventId: string;
    type: string;
    sourceProviderId: string;
    timestamp: string;
    payload: Record<string, unknown>;
}
export declare class ProviderBus extends EventEmitter {
    private wss;
    private providers;
    private eventLog;
    private heartbeatTimer;
    private readonly maxConnections;
    private readonly heartbeatIntervalMs;
    private readonly idleTimeoutMs;
    private readonly maxMessageSize;
    private readonly rateLimitPerMinute;
    private readonly keyLookup?;
    constructor(config?: ProviderBusConfig);
    /**
     * Attach to an existing HTTP server. Creates the internal WebSocketServer
     * in noServer mode and starts the heartbeat loop.
     */
    attachToServer(_server: HttpServer, _path: string): void;
    /**
     * Handle WebSocket upgrade requests. Called from server/index.ts httpServer.on("upgrade").
     */
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void>;
    private handleConnection;
    private handleMessage;
    private handleRegister;
    private handleEvent;
    private handleContextRequest;
    private handleContextResponse;
    private appendEventLog;
    /** Read recent events from the local log. */
    getEventLog(limit?: number): EventLogEntry[];
    private heartbeatTick;
    private send;
    private extractBearerToken;
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
    };
    /** List connected providers (for admin/debug). */
    getConnectedProviders(): Array<{
        id: string;
        userId: string;
        providerName: string | null;
        providerType: string | null;
        capabilities: string[];
        connectedAt: string;
        eventCount: number;
    }>;
    shutdown(): void;
}
/**
 * Create a ProviderBus, attach it to the HTTP server, and register
 * the /bus/health Express route. Returns the bus instance and the
 * handleUpgrade function for wiring into httpServer.on("upgrade").
 */
export declare function mountProviderBus(app: {
    get: (path: string, handler: (req: unknown, res: {
        json: (body: unknown) => void;
    }) => void) => void;
}, httpServer: HttpServer, config?: ProviderBusConfig): {
    bus: ProviderBus;
    handleUpgrade: typeof ProviderBus.prototype.handleUpgrade;
};
export {};
