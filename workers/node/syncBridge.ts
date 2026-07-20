import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";

import type {
  AccountSyncSnapshot,
  PairingGrant,
  SyncBridgeEnvelope,
  SyncBridgePairDevicePayload,
  SyncBridgePairedPayload,
  SyncBridgeSyncBatchPayload,
  SyncBridgeSyncAckPayload,
  SyncQueueOperation,
  SyncScope,
} from "../packages/mcp-local/src/sync/protocol.js";
import { createSyncEnvelope } from "../packages/mcp-local/src/sync/protocol.js";

interface ConnectedDevice {
  ws: WebSocket;
  deviceId: string;
  deviceName: string;
  deviceToken: string;
  userId: string;
  workspaceId?: string;
  scopesGranted: SyncScope[];
  pairedAt: string;
  lastSeenAt: string;
  platform?: string;
  appVersion?: string;
}

interface StoredDeviceSession {
  deviceId: string;
  deviceName: string;
  deviceToken: string;
  userId: string;
  workspaceId?: string;
  scopesGranted: SyncScope[];
  pairedAt: string;
  lastSeenAt: string;
  platform?: string;
  appVersion?: string;
}

export interface SyncBridgeConfig {
  maxConnections?: number;
  heartbeatIntervalMs?: number;
  maxBatchSize?: number;
}

const MAX_CONNECTIONS = 100;
const MAX_BATCH_SIZE = 200;
const HEARTBEAT_INTERVAL_MS = 30_000;

export class SyncBridgeServer extends EventEmitter {
  private readonly maxConnections: number;
  private readonly heartbeatIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly pairingGrants = new Map<string, PairingGrant>();
  private readonly deviceSessions = new Map<string, StoredDeviceSession>();
  private readonly activeConnections = new Map<string, ConnectedDevice>();
  private readonly accountOperations = new Map<string, AccountSyncSnapshot["recentOperations"]>();
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SyncBridgeConfig = {}) {
    super();
    this.maxConnections = Math.min(config.maxConnections ?? MAX_CONNECTIONS, MAX_CONNECTIONS);
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.maxBatchSize = Math.min(config.maxBatchSize ?? MAX_BATCH_SIZE, MAX_BATCH_SIZE);
  }

  attachToServer(_server: HttpServer, _path: string): void {
    this.wss = new WebSocketServer({ noServer: true });
    this.heartbeatTimer = setInterval(() => {
      for (const conn of this.activeConnections.values()) {
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.ping();
        }
      }
    }, this.heartbeatIntervalMs);
  }

  createPairingGrant(input: {
    userId: string;
    workspaceId?: string;
    scopes: SyncScope[];
    ttlMs?: number;
    metadata?: Record<string, unknown>;
  }): PairingGrant {
    const pairingCode = `pair_${randomUUID().slice(0, 8)}`;
    const grant: PairingGrant = {
      pairingCode,
      userId: input.userId,
      workspaceId: input.workspaceId,
      scopes: input.scopes,
      expiresAt: new Date(Date.now() + (input.ttlMs ?? 10 * 60_000)).toISOString(),
      metadata: input.metadata,
    };
    this.pairingGrants.set(pairingCode, grant);
    return grant;
  }

  getHealthSnapshot() {
    return {
      status: "ok",
      service: "sync-bridge",
      pairingGrantCount: this.pairingGrants.size,
      pairedDeviceCount: this.deviceSessions.size,
      activeConnectionCount: this.activeConnections.size,
      accountCount: new Set(Array.from(this.deviceSessions.values()).map((session) => session.userId)).size,
    };
  }

  getAccountSnapshot(userId: string): AccountSyncSnapshot {
    const sessions = Array.from(this.deviceSessions.values()).filter((session) => session.userId === userId);
    const connectedDevices = sessions
      .map((session) => ({
        deviceId: session.deviceId,
        deviceName: session.deviceName,
        platform: session.platform,
        pairedAt: session.pairedAt,
        lastSeenAt: session.lastSeenAt,
        scopesGranted: session.scopesGranted,
      }));

    const recentOperations = this.accountOperations.get(userId) ?? [];
    return {
      userId,
      workspaceId: sessions[0]?.workspaceId,
      connectedDevices,
      recentOperations,
    };
  }

  async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (!this.wss) {
      socket.destroy();
      return;
    }

    if (this.activeConnections.size >= this.maxConnections) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.handleNewConnection(ws);
    });
  }

  private handleNewConnection(ws: WebSocket): void {
    ws.on("message", (raw) => this.handleMessage(ws, raw));
    ws.on("close", () => {
      for (const [deviceId, connection] of this.activeConnections.entries()) {
        if (connection.ws === ws) {
          this.activeConnections.delete(deviceId);
          break;
        }
      }
    });
  }

  private handleMessage(ws: WebSocket, raw: WebSocket.RawData): void {
    let message: SyncBridgeEnvelope;
    try {
      message = JSON.parse(String(raw)) as SyncBridgeEnvelope;
    } catch {
      this.send(ws, createSyncEnvelope("error", {
        code: "invalid_json",
        message: "Sync bridge messages must be valid JSON",
        retryable: false,
      }));
      return;
    }

    if (message.type === "pair_device") {
      this.handlePairDevice(ws, message.payload as SyncBridgePairDevicePayload);
      return;
    }

    if (message.type === "sync_batch") {
      this.handleSyncBatch(ws, message.payload as SyncBridgeSyncBatchPayload);
      return;
    }

    if (message.type === "ping") {
      this.send(ws, createSyncEnvelope("pong", {}));
    }
  }

  private handlePairDevice(ws: WebSocket, payload: SyncBridgePairDevicePayload): void {
    let stored: StoredDeviceSession | undefined;

    if (payload.deviceToken) {
      stored = this.deviceSessions.get(payload.deviceId);
      if (!stored || stored.deviceToken !== payload.deviceToken) {
        this.send(ws, createSyncEnvelope("error", {
          code: "device_token_invalid",
          message: "Device token is invalid or no longer matches this device",
          retryable: true,
        }));
        return;
      }
    } else if (payload.pairingCode) {
      const grant = this.pairingGrants.get(payload.pairingCode);
      if (!grant) {
        this.send(ws, createSyncEnvelope("error", {
          code: "pairing_code_invalid",
          message: "Pairing code was not found",
          retryable: false,
        }));
        return;
      }
      if (Date.parse(grant.expiresAt) < Date.now()) {
        this.pairingGrants.delete(payload.pairingCode);
        this.send(ws, createSyncEnvelope("error", {
          code: "pairing_code_expired",
          message: "Pairing code has expired",
          retryable: false,
        }));
        return;
      }
      stored = {
        deviceId: payload.deviceId,
        deviceName: payload.deviceName,
        deviceToken: `devtok_${randomUUID()}`,
        userId: grant.userId,
        workspaceId: payload.workspaceId ?? grant.workspaceId,
        scopesGranted: grant.scopes,
        pairedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        platform: payload.platform,
        appVersion: payload.appVersion,
      };
      this.deviceSessions.set(payload.deviceId, stored);
      this.pairingGrants.delete(payload.pairingCode);
    }

    if (!stored) {
      this.send(ws, createSyncEnvelope("error", {
        code: "pairing_required",
        message: "Provide either a valid pairingCode or a deviceToken",
        retryable: false,
      }));
      return;
    }

    stored.lastSeenAt = new Date().toISOString();
    this.deviceSessions.set(stored.deviceId, stored);
    this.activeConnections.set(stored.deviceId, {
      ws,
      deviceId: stored.deviceId,
      deviceName: stored.deviceName,
      deviceToken: stored.deviceToken,
      userId: stored.userId,
      workspaceId: stored.workspaceId,
      scopesGranted: stored.scopesGranted,
      pairedAt: stored.pairedAt,
      lastSeenAt: stored.lastSeenAt,
      platform: stored.platform,
      appVersion: stored.appVersion,
    });

    const pairedPayload: SyncBridgePairedPayload = {
      deviceToken: stored.deviceToken,
      deviceId: stored.deviceId,
      userId: stored.userId,
      workspaceId: stored.workspaceId,
      scopesGranted: stored.scopesGranted,
      pairedAt: stored.pairedAt,
      syncEnabled: true,
    };
    this.send(ws, createSyncEnvelope("paired", pairedPayload));
  }

  private handleSyncBatch(ws: WebSocket, payload: SyncBridgeSyncBatchPayload): void {
    const connection = this.activeConnections.get(payload.deviceId);
    if (!connection || connection.ws !== ws) {
      this.send(ws, createSyncEnvelope("error", {
        code: "not_paired",
        message: "Device must pair before syncing",
        retryable: true,
      }));
      return;
    }

    const operations = Array.isArray(payload.operations)
      ? payload.operations.slice(0, this.maxBatchSize)
      : [];

    const acceptedIds: string[] = [];
    const rejected: Array<{ id: string; reason: string }> = [];

    for (const operation of operations) {
      const validation = this.validateOperation(operation);
      if (validation === true) {
        acceptedIds.push(operation.id);
        const existing = this.accountOperations.get(connection.userId) ?? [];
        existing.unshift({
          id: operation.id,
          deviceId: connection.deviceId,
          objectId: operation.objectId,
          objectKind: String(operation.objectKind),
          opType: String(operation.opType),
          acceptedAt: new Date().toISOString(),
        });
        this.accountOperations.set(connection.userId, existing.slice(0, 200));
      } else {
        rejected.push({ id: operation.id, reason: validation });
      }
    }

    const ackPayload: SyncBridgeSyncAckPayload = {
      acceptedIds,
      rejected,
      serverWatermark: `sync_${Date.now()}`,
    };
    this.send(ws, createSyncEnvelope("sync_ack", ackPayload));
  }

  private validateOperation(operation: SyncQueueOperation): true | string {
    if (!operation?.id) return "missing operation id";
    if (!operation?.objectKind) return "missing object kind";
    if (!operation?.opType) return "missing operation type";
    if (typeof operation.payload !== "object" || operation.payload === null) return "payload must be an object";
    return true;
  }

  private send(ws: WebSocket, message: SyncBridgeEnvelope): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }

  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const connection of this.activeConnections.values()) {
      connection.ws.close(1001, "Server shutting down");
    }
    this.activeConnections.clear();
    this.wss?.close();
    this.wss = null;
  }
}
