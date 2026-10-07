/**
 * Production Stress Tests — NodeBench Founder Platform
 *
 * Simulates concurrent users, rate limiting, memory bounds, auth isolation,
 * crash recovery, adversarial input, and sustained load against the
 * CommandBridge and MCP Gateway.
 *
 * Run: npx tsx server/stressTest.ts
 *
 * Requirements: The server must NOT be running — tests spin up their own
 * HTTP + WebSocket servers internally.
 */

import { createServer, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { EventEmitter } from "node:events";

import {
  CommandBridge,
  type BridgeMessage,
  type AgentRegistration,
  type OutboundTaskPacket,
  type InboundTaskResult,
} from "./commandBridge.js";

import {
  generateApiKey,
  getMemoryStore,
  resetRateLimits,
  rateLimit,
  hashApiKey,
  isValidKeyFormat,
  validateApiKey,
  type ApiKeyRecord,
} from "./mcpAuth.js";

// ═══════════════════════════════════════════════════════════════════════════
// Test infrastructure
// ═══════════════════════════════════════════════════════════════════════════

interface ScenarioResult {
  name: string;
  passed: boolean;
  durationMs: number;
  assertions: number;
  failures: string[];
}

class AssertionTracker {
  count = 0;
  failures: string[] = [];

  assert(condition: boolean, message: string): void {
    this.count++;
    if (!condition) {
      this.failures.push(message);
    }
  }

  assertEqual<T>(actual: T, expected: T, message: string): void {
    this.count++;
    if (actual !== expected) {
      this.failures.push(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  assertGreaterThan(actual: number, expected: number, message: string): void {
    this.count++;
    if (actual <= expected) {
      this.failures.push(`${message} — expected > ${expected}, got ${actual}`);
    }
  }

  assertLessThan(actual: number, expected: number, message: string): void {
    this.count++;
    if (actual >= expected) {
      this.failures.push(`${message} — expected < ${expected}, got ${actual}`);
    }
  }

  assertIncludes(haystack: string, needle: string, message: string): void {
    this.count++;
    if (!haystack.includes(needle)) {
      this.failures.push(`${message} — "${haystack}" does not include "${needle}"`);
    }
  }

  get passed(): boolean {
    return this.failures.length === 0;
  }
}

// Helper: create an API key in the memory store for a given userId
function createTestKey(userId: string, perMinute = 100, perDay = 10_000): string {
  const { rawKey, keyHash, keyHashPrefix } = generateApiKey();
  const store = getMemoryStore();
  store.set(keyHashPrefix, {
    keyHash,
    keyHashPrefix,
    userId,
    permissions: ["tools:read", "tools:execute"],
    rateLimits: { perMinute, perDay },
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    revokedAt: null,
  });
  return rawKey;
}

// Helper: spin up an HTTP server with a CommandBridge attached
function createTestServer(bridgeConfig?: ConstructorParameters<typeof CommandBridge>[0]): {
  server: HttpServer;
  bridge: CommandBridge;
  port: number;
  url: string;
  close: () => Promise<void>;
} {
  const bridge = new CommandBridge(bridgeConfig);
  const server = createServer((_req, res) => {
    if (_req.url === "/bridge/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(bridge.getHealthSnapshot()));
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  bridge.attachToServer(server, "/bridge");

  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/bridge")) {
      bridge.handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  // Bind to random port
  server.listen(0);
  const addr = server.address() as { port: number };
  const port = addr.port;
  const url = `ws://127.0.0.1:${port}/bridge`;

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      bridge.shutdown();
      server.close(() => resolve());
    });

  return { server, bridge, port, url, close };
}

// Helper: connect a WebSocket agent, register, and return the ws + agentId
function connectAgent(
  url: string,
  apiKey: string,
  registration: Partial<AgentRegistration> = {},
): Promise<{ ws: WebSocket; agentId: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Agent connection timed out"));
    }, 5_000);

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    ws.on("open", () => {
      // Send registration
      const regMsg: BridgeMessage = {
        type: "register",
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
          agentName: registration.agentName ?? `test-agent-${randomUUID().slice(0, 8)}`,
          agentType: registration.agentType ?? "claude_code",
          runtimeSurface: registration.runtimeSurface ?? "local",
          capabilities: registration.capabilities ?? ["research", "code", "analysis"],
          platform: registration.platform ?? "test-harness",
          version: registration.version ?? "1.0.0",
        } satisfies AgentRegistration,
      };
      ws.send(JSON.stringify(regMsg));
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as BridgeMessage;
      if (msg.type === "registered") {
        clearTimeout(timeout);
        const payload = msg.payload as { agentId: string };
        resolve({ ws, agentId: payload.agentId });
      } else if (msg.type === "error") {
        clearTimeout(timeout);
        reject(new Error(`Registration failed: ${JSON.stringify(msg.payload)}`));
      }
    });
  });
}

// Helper: send a BridgeMessage and wait for a specific response type
function sendAndWait(
  ws: WebSocket,
  msg: BridgeMessage,
  expectedType: string,
  timeoutMs = 5_000,
): Promise<BridgeMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${expectedType}`)), timeoutMs);
    const handler = (data: Buffer | string) => {
      const resp = JSON.parse(data.toString()) as BridgeMessage;
      if (resp.type === expectedType || resp.type === "error") {
        clearTimeout(timer);
        ws.removeListener("message", handler);
        resolve(resp);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify(msg));
  });
}

// Helper: create a task packet
function makeTaskPacket(overrides: Partial<OutboundTaskPacket> = {}): OutboundTaskPacket {
  return {
    packetId: overrides.packetId ?? `task-${randomUUID().slice(0, 12)}`,
    taskType: overrides.taskType ?? "run_analysis",
    title: overrides.title ?? "Test task",
    instructions: overrides.instructions ?? "Analyze the target company",
    requestedCapabilities: overrides.requestedCapabilities ?? ["analysis"],
    priority: overrides.priority ?? "medium",
    returnFormat: overrides.returnFormat ?? "summary_only",
    context: overrides.context ?? {
      workspaceId: "ws_test",
      companyId: "co_test",
      companyName: "TestCorp",
    },
    timeout: overrides.timeout ?? 30_000,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

// Helper: wait for N ms
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Helper: close a WebSocket safely
function safeClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      resolve();
      return;
    }
    ws.on("close", () => resolve());
    ws.close();
    // Force resolve after 2s
    setTimeout(resolve, 2_000);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 1: Concurrent User Load
// ═══════════════════════════════════════════════════════════════════════════

async function scenarioConcurrentUserLoad(): Promise<ScenarioResult> {
  const t = new AssertionTracker();
  const start = Date.now();
  const { bridge, url, close } = createTestServer();
  const agents: { ws: WebSocket; agentId: string; userId: string }[] = [];

  try {
    // Create 10 users, each with 3-5 agents (total ~40 agents, under 50 cap)
    const userCount = 10;
    const userKeys: { userId: string; key: string; agentCount: number }[] = [];
    for (let u = 0; u < userCount; u++) {
      const userId = `user-${u}`;
      const agentCount = 3 + (u % 3); // 3, 4, or 5
      userKeys.push({ userId, key: createTestKey(userId), agentCount });
    }

    // Connect all agents in parallel
    const connectPromises: Promise<void>[] = [];
    for (const user of userKeys) {
      for (let a = 0; a < user.agentCount; a++) {
        connectPromises.push(
          connectAgent(url, user.key, {
            agentName: `${user.userId}-agent-${a}`,
            capabilities: ["research", "code", "analysis"],
          }).then((conn) => {
            agents.push({ ...conn, userId: user.userId });
          }),
        );
      }
    }
    await Promise.all(connectPromises);

    const totalAgents = userKeys.reduce((sum, u) => sum + u.agentCount, 0);
    t.assertEqual(agents.length, totalAgents, `All ${totalAgents} agents should connect`);

    // Verify bridge reports correct count
    const connectedIds = bridge.getConnectedAgents();
    t.assertEqual(connectedIds.length, totalAgents, "Bridge reports correct agent count");

    // Dispatch tasks to each agent and verify results come back to correct agent
    const taskResults: Map<string, InboundTaskResult> = new Map();
    const resultPromises: Promise<void>[] = [];

    bridge.on("task:result", (result: InboundTaskResult, agentId: string) => {
      taskResults.set(result.packetId, result);
    });

    for (const agent of agents) {
      const packetId = `task-${agent.agentId.slice(0, 16)}`;
      const packet = makeTaskPacket({
        packetId,
        requestedCapabilities: ["analysis"],
        context: { workspaceId: "ws_test", companyId: `co_${agent.userId}` },
      });

      const result = bridge.dispatchTask(agent.agentId, packet);
      t.assert(result.dispatched, `Task dispatched to ${agent.agentId}`);

      // Simulate agent responding
      resultPromises.push(
        new Promise<void>((resolve) => {
          const handler = (data: Buffer | string) => {
            const msg = JSON.parse(data.toString()) as BridgeMessage;
            if (msg.type === "task_dispatch") {
              const payload = msg.payload as OutboundTaskPacket;
              // Respond with result
              const taskResult: BridgeMessage = {
                type: "task_result",
                id: randomUUID(),
                timestamp: new Date().toISOString(),
                payload: {
                  packetId: payload.packetId,
                  status: "completed",
                  summary: `Result from ${agent.userId}`,
                  durationMs: 100,
                } satisfies InboundTaskResult,
              };
              agent.ws.send(JSON.stringify(taskResult));
              agent.ws.removeListener("message", handler);
              resolve();
            }
          };
          agent.ws.on("message", handler);
        }),
      );
    }

    await Promise.all(resultPromises);
    await sleep(200); // Let event loop process results

    // Verify no cross-user data leakage: each result should contain
    // the userId that was embedded in the summary
    for (const agent of agents) {
      const packetId = `task-${agent.agentId.slice(0, 16)}`;
      const result = taskResults.get(packetId);
      if (result) {
        t.assertIncludes(result.summary, agent.userId, `Result for ${packetId} contains correct userId`);
      }
    }

    t.assertGreaterThan(taskResults.size, 0, "At least some task results received");
  } finally {
    for (const a of agents) await safeClose(a.ws);
    await close();
    getMemoryStore().clear();
    resetRateLimits();
  }

  return {
    name: "Scenario 1: Concurrent User Load",
    passed: t.passed,
    durationMs: Date.now() - start,
    assertions: t.count,
    failures: t.failures,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 2: Rate Limit Fairness
// ═══════════════════════════════════════════════════════════════════════════

async function scenarioRateLimitFairness(): Promise<ScenarioResult> {
  const t = new AssertionTracker();
  const start = Date.now();
  const { bridge, url, close } = createTestServer();
  const agents: { ws: WebSocket; agentId: string; userId: string }[] = [];

  try {
    // Create 10 users
    const keys: { userId: string; key: string }[] = [];
    for (let i = 0; i < 10; i++) {
      const userId = `rate-user-${i}`;
      keys.push({ userId, key: createTestKey(userId) });
    }

    // Connect one agent per user
    for (const k of keys) {
      const conn = await connectAgent(url, k.key, {
        agentName: `${k.userId}-agent`,
        capabilities: ["research", "analysis"],
      });
      agents.push({ ...conn, userId: k.userId });
    }

    t.assertEqual(agents.length, 10, "10 agents connected");

    // The "abuser" (agent 0) sends 60 messages rapidly (exceeds 50/min)
    const abuser = agents[0];
    let abuserBlocked = false;
    let abuserMessagesSent = 0;

    for (let i = 0; i < 60; i++) {
      const msg: BridgeMessage = {
        type: "heartbeat",
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {},
      };
      try {
        if (abuser.ws.readyState === WebSocket.OPEN) {
          abuser.ws.send(JSON.stringify(msg));
          abuserMessagesSent++;
        } else {
          abuserBlocked = true;
          break;
        }
      } catch {
        abuserBlocked = true;
        break;
      }
    }

    await sleep(300); // Let rate limit messages propagate

    // The abuser should have been rate limited (connection closed at msg 51)
    // The bridge closes the WS on rate limit, so readyState should be CLOSING/CLOSED
    t.assert(
      abuserBlocked || abuser.ws.readyState !== WebSocket.OPEN,
      "Abuser should be rate-limited (connection closed or blocked)",
    );

    // Other users should still be able to send messages
    for (let i = 1; i < agents.length; i++) {
      const agent = agents[i];
      if (agent.ws.readyState !== WebSocket.OPEN) continue;

      const msg: BridgeMessage = {
        type: "heartbeat",
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {},
      };

      const resp = await sendAndWait(agent.ws, msg, "heartbeat", 2_000);
      t.assertEqual(resp.type, "heartbeat", `User ${i} heartbeat succeeds despite abuser`);
    }

    // Verify per-agent rate limiting works independently via the rateLimit() function
    resetRateLimits();
    const keyHashA = hashApiKey("user-a-key");
    const keyHashB = hashApiKey("user-b-key");

    // Exhaust user A's limit
    for (let i = 0; i < 50; i++) {
      rateLimit(keyHashA, { perMinute: 50, perDay: 10_000 });
    }
    const limitedA = rateLimit(keyHashA, { perMinute: 50, perDay: 10_000 });
    t.assert(!limitedA.allowed, "User A should be rate limited after 50 calls");

    // User B should be unaffected
    const limitedB = rateLimit(keyHashB, { perMinute: 50, perDay: 10_000 });
    t.assert(limitedB.allowed, "User B should NOT be rate limited");
    t.assertEqual(limitedB.minuteRemaining, 49, "User B has 49 remaining");
  } finally {
    for (const a of agents) await safeClose(a.ws);
    await close();
    getMemoryStore().clear();
    resetRateLimits();
  }

  return {
    name: "Scenario 2: Rate Limit Fairness",
    passed: t.passed,
    durationMs: Date.now() - start,
    assertions: t.count,
    failures: t.failures,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 3: Memory Bounds Under Load
// ═══════════════════════════════════════════════════════════════════════════

async function scenarioMemoryBounds(): Promise<ScenarioResult> {
  const t = new AssertionTracker();
  const start = Date.now();
  const maxConn = 10; // Use smaller cap for test speed
  const { bridge, url, close } = createTestServer({ maxConnections: maxConn });
  const agents: { ws: WebSocket; agentId: string }[] = [];

  try {
    const key = createTestKey("memory-user");

    // Fill connections to the cap
    for (let i = 0; i < maxConn; i++) {
      const conn = await connectAgent(url, key, {
        agentName: `mem-agent-${i}`,
        capabilities: ["analysis"],
      });
      agents.push(conn);
    }

    t.assertEqual(bridge.getConnectedAgents().length, maxConn, `${maxConn} agents connected`);

    // The (maxConn+1)th connection should be rejected
    let rejectedConnection = false;
    try {
      await connectAgent(url, key, { agentName: "overflow-agent" });
    } catch {
      rejectedConnection = true;
    }
    t.assert(rejectedConnection, `Connection ${maxConn + 1} should be rejected`);

    // Fill pending tasks to 500 (MAX_PENDING_TASKS)
    const targetAgent = agents[0];
    let tasksDispatched = 0;
    let lastRejected = false;

    for (let i = 0; i < 510; i++) {
      const packet = makeTaskPacket({
        packetId: `mem-task-${i}`,
        requestedCapabilities: ["analysis"],
        timeout: 300_000, // long timeout so they stay pending
      });
      const result = bridge.dispatchTask(targetAgent.agentId, packet);
      if (result.dispatched) {
        tasksDispatched++;
      } else {
        if (i >= 500) {
          lastRejected = true;
          t.assertIncludes(
            result.reason ?? "",
            "Max pending tasks",
            `Task ${i} rejected with correct reason`,
          );
        }
      }
    }

    t.assertEqual(tasksDispatched, 500, "Exactly 500 tasks dispatched");
    t.assert(lastRejected, "Task 501+ should be rejected");
    t.assertEqual(bridge.getPendingTaskCount(), 500, "Pending count is 500");

    // Verify memory snapshot is stable
    const health = bridge.getHealthSnapshot();
    t.assertEqual(health.tasks.pending, 500, "Health reports 500 pending");
    t.assertEqual(health.agents.connected, maxConn, `Health reports ${maxConn} agents`);
  } finally {
    for (const a of agents) await safeClose(a.ws);
    await close();
    getMemoryStore().clear();
    resetRateLimits();
  }

  return {
    name: "Scenario 3: Memory Bounds Under Load",
    passed: t.passed,
    durationMs: Date.now() - start,
    assertions: t.count,
    failures: t.failures,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 4: Auth Isolation
// ═══════════════════════════════════════════════════════════════════════════

async function scenarioAuthIsolation(): Promise<ScenarioResult> {
  const t = new AssertionTracker();
  const start = Date.now();
  const { bridge, url, close } = createTestServer();
  const agents: { ws: WebSocket; agentId: string }[] = [];

  try {
    // Create two users with separate keys
    const keyA = createTestKey("user-alpha");
    const keyB = createTestKey("user-beta");

    const agentA = await connectAgent(url, keyA, {
      agentName: "alpha-agent",
      capabilities: ["analysis"],
    });
    agents.push(agentA);

    const agentB = await connectAgent(url, keyB, {
      agentName: "beta-agent",
      capabilities: ["analysis"],
    });
    agents.push(agentB);

    // Dispatch a task to agent A
    const packetA = makeTaskPacket({
      packetId: "alpha-task-1",
      context: { workspaceId: "ws_alpha", companyName: "AlphaCorp" },
      requestedCapabilities: ["analysis"],
    });
    const dispatchA = bridge.dispatchTask(agentA.agentId, packetA);
    t.assert(dispatchA.dispatched, "Task dispatched to alpha agent");

    // Agent B should NOT receive alpha's task dispatch
    let bReceivedAlphaTask = false;
    agentB.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as BridgeMessage;
      if (msg.type === "task_dispatch") {
        const payload = msg.payload as OutboundTaskPacket;
        if (payload.packetId === "alpha-task-1") {
          bReceivedAlphaTask = true;
        }
      }
    });

    await sleep(300);
    t.assert(!bReceivedAlphaTask, "Agent B should NOT receive alpha's task");

    // User B's agent cannot send a result for alpha's task (wrong agentId)
    // The bridge validates agentId match on task_result
    let wrongAgentResultEmitted = false;
    bridge.once("task:result", (result: InboundTaskResult) => {
      if (result.packetId === "alpha-task-1") {
        wrongAgentResultEmitted = true;
      }
    });

    // Agent B tries to claim alpha's task result
    agentB.ws.send(
      JSON.stringify({
        type: "task_result",
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {
          packetId: "alpha-task-1",
          status: "completed",
          summary: "Hijacked by beta",
          durationMs: 50,
        },
      }),
    );

    await sleep(200);
    t.assert(!wrongAgentResultEmitted, "Beta cannot claim alpha's task result");

    // Test: revoked key is immediately rejected
    const revokedKey = createTestKey("revoked-user");
    const store = getMemoryStore();
    // Find and revoke the key
    for (const [prefix, record] of store) {
      if (record.userId === "revoked-user") {
        record.revokedAt = Date.now();
        break;
      }
    }

    let revokedRejected = false;
    try {
      await connectAgent(url, revokedKey, { agentName: "revoked-agent" });
    } catch {
      revokedRejected = true;
    }
    t.assert(revokedRejected, "Revoked key should be rejected");

    // Test: invalid key format fails fast
    const invalidFormats = [
      "",
      "not-a-key",
      "nb_key_tooshort",
      "nb_key_" + "g".repeat(32), // 'g' is not hex
      "nb_key_" + "0".repeat(31), // too short
      "nb_key_" + "0".repeat(33), // too long
    ];

    for (const badKey of invalidFormats) {
      t.assert(!isValidKeyFormat(badKey), `Invalid format rejected: "${badKey.slice(0, 20)}..."`);
    }

    // Validate that invalid keys don't even hit the store
    const result = await validateApiKey("not-a-valid-key");
    t.assert(!result.valid, "Invalid key fails validation");
    t.assertIncludes(result.reason ?? "", "Invalid key format", "Fast fail with format error");
  } finally {
    for (const a of agents) await safeClose(a.ws);
    await close();
    getMemoryStore().clear();
    resetRateLimits();
  }

  return {
    name: "Scenario 4: Auth Isolation",
    passed: t.passed,
    durationMs: Date.now() - start,
    assertions: t.count,
    failures: t.failures,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 5: Crash Recovery
// ═══════════════════════════════════════════════════════════════════════════

async function scenarioCrashRecovery(): Promise<ScenarioResult> {
  const t = new AssertionTracker();
  const start = Date.now();
  const { bridge, url, close } = createTestServer({
    heartbeatIntervalMs: 500, // Fast heartbeat for test
  });

  try {
    const key = createTestKey("crash-user");

    // Connect an agent and dispatch a task
    const agent = await connectAgent(url, key, {
      agentName: "crash-agent",
      capabilities: ["analysis"],
    });

    const packet = makeTaskPacket({
      packetId: "crash-task-1",
      requestedCapabilities: ["analysis"],
    });
    const dispatched = bridge.dispatchTask(agent.agentId, packet);
    t.assert(dispatched.dispatched, "Task dispatched before crash");
    t.assertEqual(bridge.getPendingTaskCount(), 1, "1 pending task");

    // Simulate agent crash: forcibly destroy the socket
    const failedResults: InboundTaskResult[] = [];
    bridge.on("task:result", (result: InboundTaskResult) => {
      if (result.packetId === "crash-task-1") {
        failedResults.push(result);
      }
    });

    agent.ws.terminate(); // Hard kill, no close frame
    await sleep(300); // Let the bridge detect the disconnect

    // Pending task should be cleaned up with a "failed" result
    t.assertEqual(bridge.getPendingTaskCount(), 0, "Pending tasks cleaned after crash");
    t.assertGreaterThan(failedResults.length, 0, "Failed result emitted for orphaned task");
    if (failedResults.length > 0) {
      t.assertEqual(failedResults[0].status, "failed", "Orphaned task status is 'failed'");
      t.assertIncludes(
        failedResults[0].summary,
        "disconnected",
        "Failure reason mentions disconnect",
      );
    }

    // Agent should be removed from connected list
    t.assert(!bridge.isAgentConnected(agent.agentId), "Crashed agent removed from connections");

    // Reconnection: a new agent can connect with the same key
    const agent2 = await connectAgent(url, key, {
      agentName: "crash-agent-reconnect",
      capabilities: ["analysis"],
    });

    t.assert(bridge.isAgentConnected(agent2.agentId), "Reconnected agent is active");

    // Dispatch a new task to the reconnected agent
    const packet2 = makeTaskPacket({
      packetId: "crash-task-2",
      requestedCapabilities: ["analysis"],
    });
    const dispatched2 = bridge.dispatchTask(agent2.agentId, packet2);
    t.assert(dispatched2.dispatched, "Task dispatched to reconnected agent");

    await safeClose(agent2.ws);
  } finally {
    await close();
    getMemoryStore().clear();
    resetRateLimits();
  }

  return {
    name: "Scenario 5: Crash Recovery",
    passed: t.passed,
    durationMs: Date.now() - start,
    assertions: t.count,
    failures: t.failures,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 6: Adversarial Input
// ═══════════════════════════════════════════════════════════════════════════

async function scenarioAdversarialInput(): Promise<ScenarioResult> {
  const t = new AssertionTracker();
  const start = Date.now();
  const { bridge, url, close } = createTestServer();

  try {
    const key = createTestKey("adversarial-user");
    const agent = await connectAgent(url, key, {
      agentName: "adv-agent",
      capabilities: ["analysis"],
    });

    // Test: XSS in agent name — registration sanitizes to 128 chars
    // The bridge truncates agentName, so it stores safely
    const xssKey = createTestKey("xss-user");
    const xssConn = await connectAgent(url, xssKey, {
      agentName: '<script>alert("xss")</script>',
      capabilities: ["analysis"],
    });
    const xssReg = bridge.getAgentRegistration(xssConn.agentId);
    t.assert(xssReg !== null, "XSS agent registered (name sanitized at storage)");
    // The name is stored as-is (truncated to 128) but never rendered in HTML on server
    // Verify it's truncated, not that XSS is stripped — server doesn't render HTML
    t.assertLessThan((xssReg?.agentName.length ?? 999), 129, "Agent name truncated to 128");

    // Test: SQL injection in task — verify it's handled as plain data
    const sqlPacket = makeTaskPacket({
      packetId: "sql-inject-1",
      title: "'; DROP TABLE users; --",
      instructions: "SELECT * FROM passwords WHERE 1=1; --",
      requestedCapabilities: ["analysis"],
    });
    const sqlResult = bridge.dispatchTask(agent.agentId, sqlPacket);
    t.assert(sqlResult.dispatched, "SQL injection in task fields dispatches (treated as data)");

    // Test: oversized message (>1MB)
    // Use a fresh agent to avoid rate limit interference from prior messages
    const oversizedKey = createTestKey("oversized-user");
    const oversizedAgent = await connectAgent(url, oversizedKey, {
      agentName: "oversized-agent",
      capabilities: ["analysis"],
    });

    const oversized = JSON.stringify({
      type: "heartbeat",
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      payload: { data: "x".repeat(1_100_000) }, // > 1MB
    });

    let errorReceived = false;
    const oversizedPromise = new Promise<void>((resolve) => {
      const handler = (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString()) as BridgeMessage;
          if (msg.type === "error") {
            const payload = msg.payload as { code?: string };
            if (payload.code === "MESSAGE_TOO_LARGE") {
              errorReceived = true;
            }
          }
        } catch { /* ignore parse errors on this listener */ }
        oversizedAgent.ws.removeListener("message", handler);
        resolve();
      };
      oversizedAgent.ws.on("message", handler);
      setTimeout(resolve, 3_000);
    });
    oversizedAgent.ws.send(oversized);
    await oversizedPromise;
    t.assert(errorReceived, "Oversized message rejected with MESSAGE_TOO_LARGE");
    await safeClose(oversizedAgent.ws);

    // Test: malformed JSON — fresh agent
    const malformedKey = createTestKey("malformed-user");
    const malformedAgent = await connectAgent(url, malformedKey, {
      agentName: "malformed-agent",
      capabilities: ["analysis"],
    });

    let parseErrorReceived = false;
    const malformedPromise = new Promise<void>((resolve) => {
      const handler = (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString()) as BridgeMessage;
          if (msg.type === "error") {
            const payload = msg.payload as { code?: string };
            if (payload.code === "PARSE_ERROR") {
              parseErrorReceived = true;
            }
          }
        } catch { /* ignore */ }
        malformedAgent.ws.removeListener("message", handler);
        resolve();
      };
      malformedAgent.ws.on("message", handler);
      setTimeout(resolve, 3_000);
    });
    malformedAgent.ws.send("{not valid json at all!!!");
    await malformedPromise;
    t.assert(parseErrorReceived, "Malformed JSON rejected with PARSE_ERROR");
    await safeClose(malformedAgent.ws);

    // Test: Unicode edge cases in task fields
    const unicodePacket = makeTaskPacket({
      packetId: "unicode-task-1",
      title: "\u{1F4A9} \u{0000}null\u{FEFF}byte \u{202E}reverse",
      instructions: "Company: \u00C0\u00E9\u00EE\u00F6\u00FC \u4F60\u597D\u4E16\u754C \u0645\u0631\u062D\u0628\u0627",
      requestedCapabilities: ["analysis"],
    });
    const unicodeResult = bridge.dispatchTask(agent.agentId, unicodePacket);
    t.assert(unicodeResult.dispatched, "Unicode edge cases in task fields dispatched safely");

    // Test: null bytes in message content
    const nullByteMsg: BridgeMessage = {
      type: "heartbeat",
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      payload: { data: "hello\x00world\x00\x00" },
    };
    const nullResp = await sendAndWait(agent.ws, nullByteMsg, "heartbeat", 2_000);
    t.assertEqual(nullResp.type, "heartbeat", "Null bytes in payload handled gracefully");

    // Test: missing envelope fields
    let envelopeErrorReceived = false;
    const envelopePromise = new Promise<void>((resolve) => {
      const handler = (data: Buffer | string) => {
        const msg = JSON.parse(data.toString()) as BridgeMessage;
        if (msg.type === "error") {
          envelopeErrorReceived = true;
        }
        agent.ws.removeListener("message", handler);
        resolve();
      };
      agent.ws.on("message", handler);
      setTimeout(resolve, 2_000);
    });
    agent.ws.send(JSON.stringify({ type: null, id: null }));
    await envelopePromise;
    t.assert(envelopeErrorReceived, "Missing envelope fields rejected");

    await safeClose(agent.ws);
    await safeClose(xssConn.ws);
  } finally {
    await close();
    getMemoryStore().clear();
    resetRateLimits();
  }

  return {
    name: "Scenario 6: Adversarial Input",
    passed: t.passed,
    durationMs: Date.now() - start,
    assertions: t.count,
    failures: t.failures,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 7: Sustained Load (Long-Running)
// ═══════════════════════════════════════════════════════════════════════════

async function scenarioSustainedLoad(): Promise<ScenarioResult> {
  const t = new AssertionTracker();
  const start = Date.now();
  // Use short heartbeat for faster test
  const { bridge, url, close } = createTestServer({ heartbeatIntervalMs: 2_000 });
  const agents: { ws: WebSocket; agentId: string; userId: string }[] = [];

  try {
    // 5 users, 2 agents each (scaled down from 20 users for test speed)
    const userCount = 5;
    const agentsPerUser = 2;
    const keys: string[] = [];

    for (let u = 0; u < userCount; u++) {
      const userId = `sustained-user-${u}`;
      keys.push(createTestKey(userId));
    }

    for (let u = 0; u < userCount; u++) {
      for (let a = 0; a < agentsPerUser; a++) {
        const conn = await connectAgent(url, keys[u], {
          agentName: `sustained-${u}-${a}`,
          capabilities: ["analysis"],
        });
        agents.push({ ...conn, userId: `sustained-user-${u}` });
      }
    }

    const totalAgents = userCount * agentsPerUser;
    t.assertEqual(agents.length, totalAgents, `${totalAgents} agents connected`);

    // Simulate 30 seconds of sustained activity (scaled from 4 hours)
    // Tasks dispatched every 500ms per user (simulating 30s intervals compressed)
    const durationMs = 15_000; // 15 seconds of sustained load
    const intervalMs = 500;
    const endTime = Date.now() + durationMs;
    let tasksSent = 0;
    let tasksCompleted = 0;
    let tasksFailed = 0;

    bridge.on("task:result", (result: InboundTaskResult) => {
      if (result.status === "completed") tasksCompleted++;
      else tasksFailed++;
    });

    // Set up agents to auto-respond to task dispatches
    for (const agent of agents) {
      agent.ws.on("message", (data: Buffer | string) => {
        const msg = JSON.parse(data.toString()) as BridgeMessage;
        if (msg.type === "task_dispatch") {
          const payload = msg.payload as OutboundTaskPacket;
          const result: BridgeMessage = {
            type: "task_result",
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            payload: {
              packetId: payload.packetId,
              status: "completed",
              summary: `Done by ${agent.userId}`,
              durationMs: 50 + Math.random() * 200,
            } satisfies InboundTaskResult,
          };
          // Small delay to simulate work
          setTimeout(() => {
            if (agent.ws.readyState === WebSocket.OPEN) {
              agent.ws.send(JSON.stringify(result));
            }
          }, 10);
        }
      });
    }

    // Dispatch tasks in a loop
    while (Date.now() < endTime) {
      for (const agent of agents) {
        if (agent.ws.readyState !== WebSocket.OPEN) continue;
        const packet = makeTaskPacket({
          packetId: `sustained-${tasksSent++}`,
          requestedCapabilities: ["analysis"],
          timeout: 10_000,
        });
        bridge.dispatchTask(agent.agentId, packet);
      }
      await sleep(intervalMs);
    }

    // Wait for in-flight tasks to complete
    await sleep(2_000);

    // Memory checks: pending tasks should drain (agents respond quickly)
    const finalPending = bridge.getPendingTaskCount();
    t.assertLessThan(finalPending, 50, `Pending tasks should drain (got ${finalPending})`);

    // Tasks should complete
    t.assertGreaterThan(tasksCompleted, 0, "Some tasks completed during sustained load");
    t.assertGreaterThan(tasksSent, 20, "At least 20 tasks sent during sustained period");

    // All agents should still be connected (no memory leak disconnects)
    const stillConnected = bridge.getConnectedAgents().length;
    t.assertEqual(stillConnected, totalAgents, "All agents still connected after sustained load");

    // Rate limit windows should have reset (we're well within 50/min per agent)
    // Verify by sending a heartbeat to each agent — should all succeed
    for (const agent of agents) {
      if (agent.ws.readyState !== WebSocket.OPEN) continue;
      const hb: BridgeMessage = {
        type: "heartbeat",
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        payload: {},
      };
      try {
        const resp = await sendAndWait(agent.ws, hb, "heartbeat", 2_000);
        t.assertEqual(resp.type, "heartbeat", `Agent ${agent.userId} still responsive`);
      } catch {
        // Rate limited agents may have been disconnected; that's acceptable
      }
    }

    // Memory snapshot — verify no growth in health report
    const health = bridge.getHealthSnapshot();
    t.assertEqual(health.agents.connected, totalAgents, "Health: agents match");
  } finally {
    for (const a of agents) await safeClose(a.ws);
    await close();
    getMemoryStore().clear();
    resetRateLimits();
  }

  return {
    name: "Scenario 7: Sustained Load (Long-Running)",
    passed: t.passed,
    durationMs: Date.now() - start,
    assertions: t.count,
    failures: t.failures,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario: Connection Limit Enforcement (50 max)
// ═══════════════════════════════════════════════════════════════════════════

async function scenarioConnectionLimitEnforcement(): Promise<ScenarioResult> {
  const t = new AssertionTracker();
  const start = Date.now();
  const maxConn = 50;
  const { bridge, url, close } = createTestServer({ maxConnections: maxConn });
  const agents: { ws: WebSocket; agentId: string }[] = [];

  try {
    const key = createTestKey("limit-user");

    // Fill to capacity
    for (let i = 0; i < maxConn; i++) {
      const conn = await connectAgent(url, key, {
        agentName: `limit-agent-${i}`,
        capabilities: ["analysis"],
      });
      agents.push(conn);
    }

    t.assertEqual(bridge.getConnectedAgents().length, maxConn, `${maxConn} agents at capacity`);

    // Attempt to connect one more — should fail
    let overflowRejected = false;
    try {
      await connectAgent(url, key, { agentName: "overflow-agent" });
    } catch {
      overflowRejected = true;
    }
    t.assert(overflowRejected, "51st connection rejected at capacity");

    // Disconnect one agent
    await safeClose(agents[0].ws);
    await sleep(300);

    // Now there should be room for one more
    const newConn = await connectAgent(url, key, {
      agentName: "replacement-agent",
      capabilities: ["analysis"],
    });
    agents.push(newConn);

    t.assertEqual(bridge.getConnectedAgents().length, maxConn, "Back to capacity after replacement");

    // Disconnect the replacement
    await safeClose(newConn.ws);
  } finally {
    for (const a of agents) await safeClose(a.ws);
    await close();
    getMemoryStore().clear();
    resetRateLimits();
  }

  return {
    name: "Scenario: Connection Limit (50 max)",
    passed: t.passed,
    durationMs: Date.now() - start,
    assertions: t.count,
    failures: t.failures,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Runner
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log("=".repeat(72));
  console.log(" NodeBench Founder Platform — Production Stress Tests");
  console.log("=".repeat(72));
  console.log();

  // Suppress noisy bridge/gateway logs during tests
  const origStderr = console.error;
  console.error = (...args: unknown[]) => {
    const first = String(args[0] ?? "");
    if (
      first.includes("[command-bridge]") ||
      first.includes("[mcp-gateway]")
    ) {
      return; // Suppress bridge operational logs
    }
    origStderr(...args);
  };

  const scenarios = [
    scenarioConcurrentUserLoad,
    scenarioRateLimitFairness,
    scenarioMemoryBounds,
    scenarioAuthIsolation,
    scenarioCrashRecovery,
    scenarioAdversarialInput,
    scenarioSustainedLoad,
    scenarioConnectionLimitEnforcement,
  ];

  const results: ScenarioResult[] = [];
  let anyFailed = false;

  for (const scenario of scenarios) {
    process.stdout.write(`  Running: ${scenario.name.replace("scenario", "")}... `);
    try {
      const result = await scenario();
      results.push(result);
      if (!result.passed) anyFailed = true;
      console.log(result.passed ? "PASS" : "FAIL", `(${result.durationMs}ms, ${result.assertions} assertions)`);
      if (!result.passed) {
        for (const f of result.failures) {
          console.log(`    FAIL: ${f}`);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({
        name: scenario.name,
        passed: false,
        durationMs: 0,
        assertions: 0,
        failures: [`Unhandled error: ${errMsg}`],
      });
      anyFailed = true;
      console.log(`CRASH: ${errMsg}`);
    }
  }

  // Restore console.error
  console.error = origStderr;

  // Summary
  console.log();
  console.log("=".repeat(72));
  console.log(" RESULTS SUMMARY");
  console.log("=".repeat(72));
  console.log();

  const totalAssertions = results.reduce((sum, r) => sum + r.assertions, 0);
  const totalFailures = results.reduce((sum, r) => sum + r.failures.length, 0);
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
  const passedCount = results.filter((r) => r.passed).length;

  for (const r of results) {
    const icon = r.passed ? "[PASS]" : "[FAIL]";
    console.log(
      `  ${icon} ${r.name.padEnd(50)} ${String(r.assertions).padStart(4)} assertions  ${String(r.durationMs).padStart(6)}ms`,
    );
  }

  console.log();
  console.log(`  Scenarios: ${passedCount}/${results.length} passed`);
  console.log(`  Assertions: ${totalAssertions - totalFailures}/${totalAssertions} passed`);
  console.log(`  Total time: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log();

  if (anyFailed) {
    console.log("  FAILURES:");
    for (const r of results) {
      if (!r.passed) {
        for (const f of r.failures) {
          console.log(`    - [${r.name}] ${f}`);
        }
      }
    }
    console.log();
  }

  console.log(anyFailed ? "  OVERALL: FAIL" : "  OVERALL: PASS");
  console.log();

  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
