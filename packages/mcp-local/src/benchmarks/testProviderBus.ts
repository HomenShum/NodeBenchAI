/**
 * testProviderBus.ts — Integration test for ProviderBus WebSocket event bus.
 *
 * Tests: auth, registration, event routing, disconnect cleanup.
 * Run: npx tsx src/benchmarks/testProviderBus.ts
 */

import { createServer, type Server as HttpServer } from "node:http";
import { WebSocket } from "ws";
import {
  ProviderBus,
  type ProviderBusConfig,
} from "../../../../workers/node/providerBus.js";
import {
  generateApiKey,
  getMemoryStore,
  hashApiKey,
  hashPrefix,
  type ApiKeyRecord,
} from "../../../../workers/node/mcpAuth.js";

// ═══════════════════════════════════════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════════════════════════════════════

const results: Array<{ name: string; pass: boolean; detail?: string }> = [];

function record(name: string, pass: boolean, detail?: string): void {
  results.push({ name, pass, detail });
  const icon = pass ? "PASS" : "FAIL";
  console.log(`  [${icon}] ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Wait for a WS message matching a predicate, with timeout. */
function waitForMessage(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener("message", handler);
      reject(new Error(`Timed out waiting for message (${timeoutMs}ms)`));
    }, timeoutMs);

    function handler(data: Buffer | string) {
      try {
        const parsed = JSON.parse(
          typeof data === "string" ? data : data.toString("utf-8"),
        ) as Record<string, unknown>;
        if (predicate(parsed)) {
          clearTimeout(timer);
          ws.removeListener("message", handler);
          resolve(parsed);
        }
      } catch {
        // ignore parse errors, keep waiting
      }
    }
    ws.on("message", handler);
  });
}

/** Connect a WS client to the bus with Bearer auth. Returns the ws + first message. */
function connectClient(
  port: number,
  apiKey: string,
): Promise<{ ws: WebSocket; firstMessage: Record<string, unknown> | null }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bus`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    let firstMessage: Record<string, unknown> | null = null;
    let resolved = false;

    ws.on("message", (data: Buffer | string) => {
      if (!firstMessage) {
        try {
          firstMessage = JSON.parse(
            typeof data === "string" ? data : data.toString("utf-8"),
          ) as Record<string, unknown>;
        } catch { /* ignore */ }
        if (!resolved) {
          resolved = true;
          resolve({ ws, firstMessage });
        }
      }
    });

    ws.on("open", () => {
      // Give a brief window for the welcome message to arrive
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ ws, firstMessage });
        }
      }, 500);
    });

    ws.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Setup: HTTP server + ProviderBus + seed an API key
// ═══════════════════════════════════════════════════════════════════════════

async function run(): Promise<void> {
  console.log("\n=== ProviderBus Integration Tests ===\n");

  // 1. Generate a valid API key and seed it into the in-memory store
  const generated = generateApiKey();
  const rawKey = generated.rawKey;
  const store = getMemoryStore();

  const keyRecord: ApiKeyRecord = {
    keyHash: generated.keyHash,
    keyHashPrefix: generated.keyHashPrefix,
    userId: "test-user-1",
    permissions: ["tools:read", "tools:execute"],
    rateLimits: { perMinute: 100, perDay: 10_000 },
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    revokedAt: null,
  };
  store.set(generated.keyHashPrefix, keyRecord);

  // 2. Create HTTP server
  const httpServer: HttpServer = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });

  // 3. Create ProviderBus with short timeouts for testing
  const busConfig: ProviderBusConfig = {
    maxConnections: 10,
    heartbeatIntervalMs: 60_000, // long — we don't need heartbeats during test
    idleTimeoutMs: 60_000,
    rateLimitPerMinute: 100,
  };
  const bus = new ProviderBus(busConfig);
  bus.attachToServer(httpServer, "/bus");

  // Wire upgrade handling
  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1`);
    if (url.pathname === "/bus") {
      bus.handleUpgrade(req, socket, head).catch((err) => {
        console.error(`  [ERROR] handleUpgrade error:`, err);
      });
    } else {
      socket.destroy();
    }
  });

  // 4. Start listening
  const port = await new Promise<number>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address();
      if (typeof addr === "object" && addr !== null) {
        resolve(addr.port);
      }
    });
  });

  console.log(`  Server listening on 127.0.0.1:${port}`);

  console.log("");

  try {
    // ── Test 1: Connect with valid API key ──────────────────────────────
    let ws: WebSocket;
    try {
      const conn = await connectClient(port, rawKey);
      ws = conn.ws;
      const welcome = conn.firstMessage;
      record(
        "Connect with valid API key",
        welcome !== null && welcome.type === "heartbeat" && typeof welcome.providerId === "string",
        welcome ? `providerId=${welcome.providerId}` : "no welcome message received",
      );
    } catch (err) {
      record("Connect with valid API key", false, String(err));
      // Can't continue without a connection
      return;
    }

    // ── Test 2: Connect with invalid API key ─────────────────────────────
    try {
      const badConn = await connectClient(port, "nb_key_00000000000000000000000000000000");
      // If we get here the connection opened — wait briefly for a close
      await new Promise<void>((resolve, reject) => {
        badConn.ws.on("close", () => resolve());
        badConn.ws.on("error", () => resolve());
        setTimeout(() => {
          badConn.ws.close();
          reject(new Error("Bad key connection was not rejected"));
        }, 2000);
      });
      record("Reject invalid API key", true);
    } catch (err) {
      // Connection refused or error is also acceptable (socket destroyed before upgrade completes)
      const msg = String(err);
      if (msg.includes("not rejected")) {
        record("Reject invalid API key", false, msg);
      } else {
        record("Reject invalid API key", true, "Connection rejected/errored as expected");
      }
    }

    // ── Test 3: Register as a provider ───────────────────────────────────
    try {
      ws.send(
        JSON.stringify({
          type: "register",
          registration: {
            providerName: "test-agent",
            providerType: "custom",
            capabilities: ["chat", "tool_execution"],
            version: "1.0.0",
          },
        }),
      );

      const registered = await waitForMessage(ws, (m) => m.type === "registered", 3000);
      record(
        "Register as provider",
        registered.type === "registered" && typeof registered.providerId === "string",
        `providerId=${registered.providerId}`,
      );
    } catch (err) {
      record("Register as provider", false, String(err));
    }

    // ── Test 4: Send an event ────────────────────────────────────────────
    try {
      const eventPromise = new Promise<boolean>((resolve) => {
        bus.once("event", (evt) => {
          resolve(evt.type === "chat.message" && evt.payload?.text === "hello");
        });
        setTimeout(() => resolve(false), 3000);
      });

      ws.send(
        JSON.stringify({
          type: "event",
          event: {
            type: "chat.message",
            payload: { text: "hello" },
          },
        }),
      );

      const eventReceived = await eventPromise;
      record("Send event and bus emits it", eventReceived);

      // Verify event log
      const log = bus.getEventLog(10);
      const found = log.some((e) => e.type === "chat.message");
      record("Event logged in event log", found, `log size=${log.length}`);
    } catch (err) {
      record("Send event and bus emits it", false, String(err));
    }

    // ── Test 5: Health snapshot ──────────────────────────────────────────
    try {
      const health = bus.getHealthSnapshot();
      record(
        "Health snapshot returns data",
        health.status === "healthy" && health.providers.connected >= 1,
        `connected=${health.providers.connected}, registered=${health.providers.registered}`,
      );
    } catch (err) {
      record("Health snapshot returns data", false, String(err));
    }

    // ── Test 6: Connected providers list ─────────────────────────────────
    try {
      const providers = bus.getConnectedProviders();
      const testProvider = providers.find((p) => p.providerName === "test-agent");
      record(
        "Connected providers list includes test-agent",
        !!testProvider && testProvider.providerType === "custom",
        testProvider
          ? `capabilities=${testProvider.capabilities.join(",")}`
          : "not found",
      );
    } catch (err) {
      record("Connected providers list includes test-agent", false, String(err));
    }

    // ── Test 7: Disconnect and cleanup ──────────────────────────────────
    try {
      const disconnectPromise = new Promise<boolean>((resolve) => {
        bus.once("provider:disconnected", () => resolve(true));
        setTimeout(() => resolve(false), 3000);
      });

      ws.close();
      const disconnected = await disconnectPromise;
      record("Disconnect fires provider:disconnected", disconnected);

      // Verify cleanup
      const afterProviders = bus.getConnectedProviders();
      record(
        "Provider removed from connected list after disconnect",
        afterProviders.length === 0,
        `remaining=${afterProviders.length}`,
      );
    } catch (err) {
      record("Disconnect and cleanup", false, String(err));
    }
  } finally {
    // Cleanup
    bus.shutdown();
    store.delete(generated.keyHashPrefix);
    httpServer.close();

    // Summary
    console.log("\n=== Summary ===");
    const passed = results.filter((r) => r.pass).length;
    const total = results.length;
    console.log(`  ${passed}/${total} tests passed\n`);

    if (passed < total) {
      process.exit(1);
    }
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
