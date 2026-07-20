/**
 * SyncBridgeServer tests cover the outbound local -> web pairing and sync flow.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";

import { SyncBridgeServer } from "./syncBridge.js";
import type { SyncBridgeEnvelope } from "../packages/mcp-local/src/sync/protocol.js";

class MockWebSocket extends EventEmitter {
  static OPEN = WebSocket.OPEN;
  static CLOSED = WebSocket.CLOSED;
  readyState = WebSocket.OPEN;
  sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit("close", 1000, Buffer.from(""));
  }

  ping(): void {
    // noop for tests
  }

  getMessages(): SyncBridgeEnvelope[] {
    return this.sent.map((item) => JSON.parse(item) as SyncBridgeEnvelope);
  }
}

describe("SyncBridgeServer", () => {
  it("pairs a device with a grant and accepts a sync batch", () => {
    const bridge = new SyncBridgeServer();
    (bridge as any).wss = { handleUpgrade() {}, close() {} };

    const ws = new MockWebSocket();
    (bridge as any).handleNewConnection(ws as any);

    const grant = bridge.createPairingGrant({
      userId: "user_alice",
      workspaceId: "ws_alpha",
      scopes: ["metadata_only", "receipts_and_traces"],
    });

    ws.emit("message", JSON.stringify({
      type: "pair_device",
      id: "msg_pair",
      timestamp: new Date().toISOString(),
      payload: {
        pairingCode: grant.pairingCode,
        deviceId: "device_local_1",
        deviceName: "Alice laptop",
        platform: "win32",
        appVersion: "0.1.0",
      },
    }));

    const paired = ws.getMessages().find((message) => message.type === "paired");
    expect(paired).toBeTruthy();
    const deviceToken = (paired?.payload as { deviceToken: string }).deviceToken;
    expect(deviceToken).toContain("devtok_");

    ws.emit("message", JSON.stringify({
      type: "sync_batch",
      id: "msg_sync",
      timestamp: new Date().toISOString(),
      payload: {
        deviceId: "device_local_1",
        operations: [
          {
            id: "sync_1",
            objectId: "run:auto_1",
            objectKind: "run",
            opType: "record_receipt",
            payload: { summary: "receipt" },
            payloadHash: "hash_1",
            createdAt: new Date().toISOString(),
          },
        ],
      },
    }));

    const ack = ws.getMessages().find((message) => message.type === "sync_ack");
    expect(ack).toBeTruthy();
    expect((ack?.payload as { acceptedIds: string[] }).acceptedIds).toEqual(["sync_1"]);

    const snapshot = bridge.getAccountSnapshot("user_alice");
    expect(snapshot.connectedDevices).toHaveLength(1);
    expect(snapshot.recentOperations[0]?.id).toBe("sync_1");
    bridge.shutdown();
  });

  it("allows reconnect with a stored device token", () => {
    const bridge = new SyncBridgeServer();
    (bridge as any).wss = { handleUpgrade() {}, close() {} };

    const firstSocket = new MockWebSocket();
    (bridge as any).handleNewConnection(firstSocket as any);
    const grant = bridge.createPairingGrant({
      userId: "user_bob",
      scopes: ["metadata_only"],
    });

    firstSocket.emit("message", JSON.stringify({
      type: "pair_device",
      id: "msg_pair",
      timestamp: new Date().toISOString(),
      payload: {
        pairingCode: grant.pairingCode,
        deviceId: "device_local_2",
        deviceName: "Bob workstation",
      },
    }));
    const paired = firstSocket.getMessages().find((message) => message.type === "paired");
    const deviceToken = (paired?.payload as { deviceToken: string }).deviceToken;
    expect(deviceToken).toBeTruthy();

    const secondSocket = new MockWebSocket();
    (bridge as any).handleNewConnection(secondSocket as any);
    secondSocket.emit("message", JSON.stringify({
      type: "pair_device",
      id: "msg_resume",
      timestamp: new Date().toISOString(),
      payload: {
        deviceToken,
        deviceId: "device_local_2",
        deviceName: "Bob workstation",
      },
    }));

    const resumed = secondSocket.getMessages().find((message) => message.type === "paired");
    expect(resumed).toBeTruthy();
    expect((resumed?.payload as { deviceId: string }).deviceId).toBe("device_local_2");
    bridge.shutdown();
  });
});
