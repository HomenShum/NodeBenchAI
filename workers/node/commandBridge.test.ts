/**
 * CommandBridge — Scenario-based tests for the outbound WebSocket protocol.
 *
 * Each describe block maps to a real founder lifecycle phase.
 * Tests use a mock WebSocket that implements the ws interface via EventEmitter
 * so we can test CommandBridge logic without a real HTTP server.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";

import {
  CommandBridge,
  type OutboundTaskPacket,
  type BridgeMessage,
  type AgentRegistration,
  type InboundTaskResult,
  type TaskProgress,
  type ApprovalRequest,
} from "./commandBridge.js";
import {
  generateApiKey,
  hashApiKey,
  hashPrefix,
  getMemoryStore,
  type ApiKeyRecord,
} from "./mcpAuth.js";

// ═══════════════════════════════════════════════════════════════════════════
// Mock WebSocket — EventEmitter-based mock implementing the ws interface
// ═══════════════════════════════════════════════════════════════════════════

class MockWebSocket extends EventEmitter {
  static OPEN = WebSocket.OPEN;
  static CLOSED = WebSocket.CLOSED;
  static CLOSING = WebSocket.CLOSING;
  static CONNECTING = WebSocket.CONNECTING;

  readyState: number = WebSocket.OPEN;
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;

  send(data: string): void {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = WebSocket.CLOSING;
    this.closed = { code, reason };
    // Simulate async close event
    queueMicrotask(() => {
      this.readyState = WebSocket.CLOSED;
      this.emit("close", code ?? 1000, Buffer.from(reason ?? ""));
    });
  }

  ping(): void {
    // Simulate pong response after a tick (for healthy agents)
  }

  /** Helper: get parsed messages sent by bridge */
  getSentMessages(): BridgeMessage[] {
    return this.sent.map((s) => JSON.parse(s) as BridgeMessage);
  }

  /** Helper: get last sent message */
  getLastSent(): BridgeMessage | undefined {
    if (this.sent.length === 0) return undefined;
    return JSON.parse(this.sent[this.sent.length - 1]) as BridgeMessage;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Test helpers — register agents, create tasks, seed API keys
// ═══════════════════════════════════════════════════════════════════════════

/** Seed a valid API key into the in-memory store and return raw key + userId */
function seedApiKey(userId: string): { rawKey: string; record: ApiKeyRecord } {
  const gen = generateApiKey();
  const record: ApiKeyRecord = {
    keyHash: gen.keyHash,
    keyHashPrefix: gen.keyHashPrefix,
    userId,
    permissions: ["tools:read", "tools:execute"],
    rateLimits: { perMinute: 100, perDay: 10_000 },
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    revokedAt: null,
  };
  getMemoryStore().set(gen.keyHashPrefix, record);
  return { rawKey: gen.rawKey, record };
}

/**
 * Register a mock agent directly on the bridge by simulating the
 * WebSocket message flow (bypasses HTTP upgrade, tests the protocol logic).
 *
 * Returns the agentId assigned by the bridge and the mock WebSocket.
 */
function registerAgent(
  bridge: CommandBridge,
  registration: AgentRegistration,
  userId = "user_founder_jane",
): { agentId: string; ws: MockWebSocket } {
  const ws = new MockWebSocket();

  // We need access to the private handleNewConnection method.
  // Instead, we'll use the bridge's internal event flow by simulating
  // what handleUpgrade does after authentication succeeds.
  // Cast to any to access private method for testing.
  const agentId = `agent_test_${Math.random().toString(36).slice(2, 10)}`;
  (bridge as any).handleNewConnection(ws as any, agentId, userId);

  // Send register message
  const regMsg: BridgeMessage = {
    type: "register",
    id: `reg_${agentId}`,
    timestamp: new Date().toISOString(),
    payload: registration,
  };
  ws.emit("message", JSON.stringify(regMsg));

  return { agentId, ws };
}

/** Create a realistic task packet for founder scenarios */
function createTaskPacket(
  overrides: Partial<OutboundTaskPacket> = {},
): OutboundTaskPacket {
  return {
    packetId: `task_${Math.random().toString(36).slice(2, 10)}`,
    taskType: "run_analysis",
    title: "Scan repo for existing projects",
    instructions: "Recursively scan the monorepo and identify all package.json files with project metadata",
    requestedCapabilities: ["code_analysis"],
    priority: "medium",
    returnFormat: "summary_plus_evidence",
    context: {
      workspaceId: "ws_acme_001",
      companyId: "comp_acme_corp",
      companyName: "Acme Corp",
      initiativeId: "init_q1_launch",
      initiativeName: "Q1 Product Launch",
    },
    timeout: 60_000,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Standard Claude Code agent registration */
const CLAUDE_CODE_REG: AgentRegistration = {
  agentName: "Claude Code Primary",
  agentType: "claude_code",
  runtimeSurface: "local",
  capabilities: ["code_analysis", "file_operations", "git_operations", "testing"],
  platform: "win32",
  version: "2.1.19",
};

/** OpenClaw agent registration */
const OPENCLAW_REG: AgentRegistration = {
  agentName: "OpenClaw Orchestrator",
  agentType: "openclaw",
  runtimeSurface: "remote",
  capabilities: ["web_research", "api_calls", "scheduling", "notifications"],
  platform: "linux",
  version: "0.9.2",
};

/** Background monitoring agent */
const BACKGROUND_REG: AgentRegistration = {
  agentName: "Background Monitor",
  agentType: "other",
  runtimeSurface: "local",
  capabilities: ["monitoring", "alerting", "log_analysis"],
  platform: "win32",
};

// ═══════════════════════════════════════════════════════════════════════════
// Test suites — organized by founder lifecycle phase
// ═══════════════════════════════════════════════════════════════════════════

describe("CommandBridge", () => {
  let bridge: CommandBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    bridge = new CommandBridge({
      maxConnections: 50,
      taskTimeoutMs: 60_000,
      heartbeatIntervalMs: 30_000,
      maxMessageSize: 1_048_576,
    });
    // Initialize WSS so internal methods work
    (bridge as any).wss = { handleUpgrade: vi.fn(), close: vi.fn() };
    getMemoryStore().clear();
  });

  afterEach(() => {
    bridge.shutdown();
    vi.useRealTimers();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Day 1 — New Founder Setup
  // Persona: Jane, technical founder, connecting Claude Code for the first
  // time to scan her monorepo and bootstrap her workspace.
  // ═══════════════════════════════════════════════════════════════════════

  describe("Day 1 — New Founder Setup", () => {
    it("registers a Claude Code agent and receives workspace context ack", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      // Verify registration ack was sent
      const ack = ws.getSentMessages().find((m) => m.type === "registered");
      expect(ack).toBeDefined();
      expect(ack!.payload).toMatchObject({
        agentId,
        heartbeatIntervalMs: 30_000,
        maxMessageSize: 1_048_576,
        taskTimeoutMs: 60_000,
      });

      // Agent should be in connected list
      expect(bridge.getConnectedAgents()).toContain(agentId);
      expect(bridge.isAgentConnected(agentId)).toBe(true);

      // Registration metadata preserved
      const reg = bridge.getAgentRegistration(agentId);
      expect(reg).toMatchObject({
        agentName: "Claude Code Primary",
        agentType: "claude_code",
        capabilities: expect.arrayContaining(["code_analysis", "file_operations"]),
      });
    });

    it("dispatches first task 'scan my repo' and agent returns artifacts", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      const packet = createTaskPacket({
        packetId: "task_day1_scan",
        taskType: "retrieve_items",
        title: "Scan monorepo for existing projects",
        instructions: "Find all package.json, pyproject.toml, go.mod files. Return project names and paths.",
        requestedCapabilities: ["code_analysis"],
        context: {
          workspaceId: "ws_acme_001",
          companyId: "comp_acme_corp",
          companyName: "Acme Corp",
        },
      });

      const result = bridge.dispatchTask(agentId, packet);
      expect(result.dispatched).toBe(true);
      expect(bridge.getPendingTaskCount()).toBe(1);

      // Verify task_dispatch message was sent to the agent
      const dispatchMsg = ws.getSentMessages().find((m) => m.type === "task_dispatch");
      expect(dispatchMsg).toBeDefined();
      expect((dispatchMsg!.payload as OutboundTaskPacket).packetId).toBe("task_day1_scan");

      // Simulate agent returning scan results with artifacts
      const taskResult: BridgeMessage = {
        type: "task_result",
        id: "result_001",
        timestamp: new Date().toISOString(),
        payload: {
          packetId: "task_day1_scan",
          status: "completed",
          summary: "Found 3 projects in monorepo: frontend (React), backend (Express), mcp-server (Node)",
          artifacts: [
            {
              type: "json",
              name: "project-manifest.json",
              content: JSON.stringify({
                projects: [
                  { name: "frontend", path: "packages/frontend", type: "react" },
                  { name: "backend", path: "packages/backend", type: "express" },
                  { name: "mcp-server", path: "packages/mcp-local", type: "node" },
                ],
              }),
            },
            {
              type: "text",
              name: "scan-log.txt",
              content: "Scanned 247 directories, 1,203 files in 2.3s",
            },
          ],
          evidence: [
            { type: "file_listing", content: "packages/frontend/package.json" },
            { type: "file_listing", content: "packages/backend/package.json" },
            { type: "file_listing", content: "packages/mcp-local/package.json" },
          ],
          durationMs: 2300,
        } satisfies InboundTaskResult,
      };

      // Listen for the result event
      const resultHandler = vi.fn();
      bridge.on("task:result", resultHandler);

      ws.emit("message", JSON.stringify(taskResult));

      expect(resultHandler).toHaveBeenCalledOnce();
      const [emittedResult, emittedAgentId] = resultHandler.mock.calls[0];
      expect(emittedAgentId).toBe(agentId);
      expect(emittedResult.status).toBe("completed");
      expect(emittedResult.artifacts).toHaveLength(2);
      expect(emittedResult.evidence).toHaveLength(3);

      // Task should be cleared from pending
      expect(bridge.getPendingTaskCount()).toBe(0);
    });

    it("rejects registration with missing required fields", () => {
      const ws = new MockWebSocket();
      const agentId = "agent_bad_reg";
      (bridge as any).handleNewConnection(ws as any, agentId, "user_jane");

      // Send incomplete registration (missing capabilities array)
      const regMsg: BridgeMessage = {
        type: "register",
        id: "reg_bad",
        timestamp: new Date().toISOString(),
        payload: {
          agentName: "Broken Agent",
          agentType: "claude_code",
          runtimeSurface: "local",
          // capabilities missing
          platform: "win32",
        },
      };
      ws.emit("message", JSON.stringify(regMsg));

      // Should get error + close
      const errMsg = ws.getSentMessages().find((m) => m.type === "error");
      expect(errMsg).toBeDefined();
      expect((errMsg!.payload as any).code).toBe("INVALID_REGISTRATION");
      expect(ws.closed).toBeTruthy();
      expect(ws.closed!.code).toBe(4010);

      // Should NOT be in connected agents
      expect(bridge.getConnectedAgents()).not.toContain(agentId);
    });

    it("emits agent:connected event with registration on successful register", () => {
      const connHandler = vi.fn();
      bridge.on("agent:connected", connHandler);

      const { agentId } = registerAgent(bridge, CLAUDE_CODE_REG);

      expect(connHandler).toHaveBeenCalledOnce();
      expect(connHandler).toHaveBeenCalledWith(agentId, expect.objectContaining({
        agentName: "Claude Code Primary",
        agentType: "claude_code",
      }));
    });

    it("enforces registration timeout — agent connects but never registers", () => {
      const ws = new MockWebSocket();
      const agentId = "agent_lazy";
      (bridge as any).handleNewConnection(ws as any, agentId, "user_jane");

      // Don't send register message. Advance past 10s timeout.
      vi.advanceTimersByTime(10_001);

      expect(ws.closed).toBeTruthy();
      expect(ws.closed!.code).toBe(4010);
      expect(ws.closed!.reason).toContain("Registration timeout");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Day 10 — Daily Operations
  // Persona: Jane has 3 agents running — Claude Code for dev, OpenClaw for
  // research, Background for monitoring. She dispatches tasks by capability.
  // ═══════════════════════════════════════════════════════════════════════

  describe("Day 10 — Daily Operations", () => {
    let claudeAgent: { agentId: string; ws: MockWebSocket };
    let openclawAgent: { agentId: string; ws: MockWebSocket };
    let bgAgent: { agentId: string; ws: MockWebSocket };

    beforeEach(() => {
      claudeAgent = registerAgent(bridge, CLAUDE_CODE_REG);
      openclawAgent = registerAgent(bridge, OPENCLAW_REG);
      bgAgent = registerAgent(bridge, BACKGROUND_REG);
    });

    it("finds agents by capability and dispatches to the right one", () => {
      // Find who can do web research
      const researchAgents = bridge.findAgentsByCapability("web_research");
      expect(researchAgents).toContain(openclawAgent.agentId);
      expect(researchAgents).not.toContain(claudeAgent.agentId);

      // Find who can do code analysis
      const codeAgents = bridge.findAgentsByCapability("code_analysis");
      expect(codeAgents).toContain(claudeAgent.agentId);
      expect(codeAgents).not.toContain(openclawAgent.agentId);

      // Dispatch research task to OpenClaw
      const researchTask = createTaskPacket({
        packetId: "task_competitor_scan",
        taskType: "run_analysis",
        title: "Competitive landscape scan for Acme Corp Series A",
        requestedCapabilities: ["web_research", "api_calls"],
        context: {
          workspaceId: "ws_acme_001",
          companyName: "Acme Corp",
          initiativeName: "Series A Due Diligence",
        },
      });

      const result = bridge.dispatchTask(openclawAgent.agentId, researchTask);
      expect(result.dispatched).toBe(true);

      // Verify it went to OpenClaw, not Claude Code
      const openclawDispatched = openclawAgent.ws
        .getSentMessages()
        .filter((m) => m.type === "task_dispatch");
      expect(openclawDispatched).toHaveLength(1);

      const claudeDispatched = claudeAgent.ws
        .getSentMessages()
        .filter((m) => m.type === "task_dispatch");
      expect(claudeDispatched).toHaveLength(0);
    });

    it("streams progress updates during long-running analysis", () => {
      const packet = createTaskPacket({
        packetId: "task_full_audit",
        taskType: "run_analysis",
        title: "Full codebase security audit for Acme Corp",
        requestedCapabilities: ["code_analysis"],
        timeout: 120_000,
      });

      bridge.dispatchTask(claudeAgent.agentId, packet);

      const progressHandler = vi.fn();
      bridge.on("task:progress", progressHandler);

      // Agent sends progress updates as it scans
      const progressSteps = [
        { percentComplete: 10, currentStep: "Scanning dependencies", stepsCompleted: 1, stepsTotal: 5 },
        { percentComplete: 30, currentStep: "Running SAST analysis", stepsCompleted: 2, stepsTotal: 5 },
        { percentComplete: 60, currentStep: "Checking for known CVEs", stepsCompleted: 3, stepsTotal: 5 },
        { percentComplete: 80, currentStep: "Validating secrets detection", stepsCompleted: 4, stepsTotal: 5 },
        { percentComplete: 100, currentStep: "Generating report", stepsCompleted: 5, stepsTotal: 5 },
      ];

      for (const step of progressSteps) {
        const progressMsg: BridgeMessage = {
          type: "task_progress",
          id: `progress_${step.stepsCompleted}`,
          timestamp: new Date().toISOString(),
          payload: {
            packetId: "task_full_audit",
            ...step,
          } satisfies TaskProgress,
        };
        claudeAgent.ws.emit("message", JSON.stringify(progressMsg));
      }

      expect(progressHandler).toHaveBeenCalledTimes(5);

      // Verify progress is sanitized (clamped 0-100)
      const [firstProgress] = progressHandler.mock.calls[0];
      expect(firstProgress.percentComplete).toBe(10);
      expect(firstProgress.currentStep).toBe("Scanning dependencies");
    });

    it("handles approval request for destructive action — founder approves", () => {
      const packet = createTaskPacket({
        packetId: "task_cleanup_old_files",
        taskType: "execute_action",
        title: "Clean up deprecated config files in Acme Corp repo",
        requestedCapabilities: ["file_operations"],
      });

      bridge.dispatchTask(claudeAgent.agentId, packet);

      const approvalHandler = vi.fn();
      bridge.on("task:approval_request", approvalHandler);

      // Agent requests approval to delete 47 deprecated config files
      const approvalReq: BridgeMessage = {
        type: "approval_request",
        id: "approval_001",
        timestamp: new Date().toISOString(),
        payload: {
          packetId: "task_cleanup_old_files",
          action: "delete_files",
          description: "Delete 47 deprecated .eslintrc, .babelrc, and webpack.config.js files from legacy directories",
          risk: "high",
        } satisfies ApprovalRequest,
      };
      claudeAgent.ws.emit("message", JSON.stringify(approvalReq));

      expect(approvalHandler).toHaveBeenCalledOnce();
      const [sanitizedReq, reqAgentId] = approvalHandler.mock.calls[0];
      expect(reqAgentId).toBe(claudeAgent.agentId);
      expect(sanitizedReq.risk).toBe("high");
      expect(sanitizedReq.action).toBe("delete_files");

      // Founder approves via UI
      const sent = bridge.sendApprovalResponse(
        claudeAgent.agentId,
        "task_cleanup_old_files",
        true,
        "Approved — backup exists in S3",
      );
      expect(sent).toBe(true);

      // Verify approval response was sent to agent
      const responseMsgs = claudeAgent.ws
        .getSentMessages()
        .filter((m) => m.type === "approval_response");
      expect(responseMsgs).toHaveLength(1);
      expect((responseMsgs[0].payload as any).approved).toBe(true);
      expect((responseMsgs[0].payload as any).reason).toBe("Approved — backup exists in S3");
    });

    it("handles approval denial for risky action", () => {
      const packet = createTaskPacket({
        packetId: "task_drop_tables",
        taskType: "execute_action",
        title: "Database migration for Acme Corp",
        requestedCapabilities: ["code_analysis"],
      });
      bridge.dispatchTask(claudeAgent.agentId, packet);

      // Agent asks to drop tables
      const approvalReq: BridgeMessage = {
        type: "approval_request",
        id: "approval_002",
        timestamp: new Date().toISOString(),
        payload: {
          packetId: "task_drop_tables",
          action: "drop_database_tables",
          description: "Drop 3 legacy tables: user_sessions_v1, auth_tokens_old, migration_history",
          risk: "high",
        } satisfies ApprovalRequest,
      };
      claudeAgent.ws.emit("message", JSON.stringify(approvalReq));

      // Founder denies
      bridge.sendApprovalResponse(
        claudeAgent.agentId,
        "task_drop_tables",
        false,
        "Not approved — need to verify no downstream dependencies first",
      );

      const responseMsgs = claudeAgent.ws
        .getSentMessages()
        .filter((m) => m.type === "approval_response");
      expect((responseMsgs[0].payload as any).approved).toBe(false);
    });

    it("three agents connected simultaneously — health snapshot reflects all", () => {
      const health = bridge.getHealthSnapshot();
      expect(health.agents.connected).toBe(3);
      expect(health.agents.max).toBe(50);
      expect(health.agents.types).toMatchObject({
        claude_code: 1,
        openclaw: 1,
        other: 1,
      });
      expect(health.tasks.pending).toBe(0);
      expect(health.tasks.max).toBe(500);
    });

    it("rejects task dispatch when agent lacks required capability", () => {
      // Try to dispatch code analysis to OpenClaw (which has web_research, not code_analysis)
      const packet = createTaskPacket({
        packetId: "task_wrong_agent",
        requestedCapabilities: ["code_analysis", "git_operations"],
      });

      const result = bridge.dispatchTask(openclawAgent.agentId, packet);
      expect(result.dispatched).toBe(false);
      expect(result.reason).toContain("missing capabilities");
      expect(result.reason).toContain("code_analysis");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Day 30 — Established Workflow
  // Persona: Jane's agents are running daily. She needs heartbeat
  // monitoring, broadcast, and timeout handling.
  // ═══════════════════════════════════════════════════════════════════════

  describe("Day 30 — Established Workflow", () => {
    it("detects stale agent via missed heartbeats and disconnects it", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      const disconnectHandler = vi.fn();
      bridge.on("agent:disconnected", disconnectHandler);

      // Simulate time passing beyond 2 heartbeat intervals (60s)
      // without the agent responding to pings
      vi.advanceTimersByTime(61_000);

      // Run heartbeat check manually (interval would have fired)
      (bridge as any).runHeartbeat();

      expect(disconnectHandler).toHaveBeenCalled();
      expect(bridge.isAgentConnected(agentId)).toBe(false);
    });

    it("healthy agent stays connected when it responds to pongs", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      // Simulate pong response — update lastPongAt
      const conn = (bridge as any).connections.get(agentId);
      expect(conn).toBeDefined();

      // Advance 25s, simulate pong
      vi.advanceTimersByTime(25_000);
      conn.lastPongAt = Date.now();

      // Advance another 25s, simulate pong
      vi.advanceTimersByTime(25_000);
      conn.lastPongAt = Date.now();

      // Run heartbeat — agent should still be connected
      (bridge as any).runHeartbeat();
      expect(bridge.isAgentConnected(agentId)).toBe(true);
    });

    it("broadcasts message to all connected agents", () => {
      const agent1 = registerAgent(bridge, CLAUDE_CODE_REG);
      const agent2 = registerAgent(bridge, OPENCLAW_REG);
      const agent3 = registerAgent(bridge, BACKGROUND_REG);

      const broadcastMsg: BridgeMessage = {
        type: "heartbeat",
        id: "broadcast_001",
        timestamp: new Date().toISOString(),
        payload: { status: "system_update", message: "Entering maintenance window at 02:00 UTC" },
      };

      bridge.broadcast(broadcastMsg);

      // All three agents should have received it (on top of their registration ack)
      for (const agent of [agent1, agent2, agent3]) {
        const received = agent.ws.getSentMessages().filter((m) => m.id === "broadcast_001");
        expect(received).toHaveLength(1);
      }
    });

    it("handles task timeout — agent goes unresponsive mid-task", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      const packet = createTaskPacket({
        packetId: "task_timeout_test",
        taskType: "run_analysis",
        title: "Deep codebase analysis for Meridian Labs",
        requestedCapabilities: ["code_analysis"],
        timeout: 5_000, // 5s timeout for this test
        context: {
          workspaceId: "ws_meridian_001",
          companyName: "Meridian Labs",
          initiativeName: "Technical Due Diligence",
        },
      });

      const resultHandler = vi.fn();
      bridge.on("task:result", resultHandler);

      bridge.dispatchTask(agentId, packet);
      expect(bridge.getPendingTaskCount()).toBe(1);

      // Agent never responds. Advance past timeout.
      vi.advanceTimersByTime(5_001);

      // Should emit a failed result
      expect(resultHandler).toHaveBeenCalledOnce();
      const [timeoutResult] = resultHandler.mock.calls[0];
      expect(timeoutResult.status).toBe("failed");
      expect(timeoutResult.summary).toBe("Task timed out");
      expect(timeoutResult.packetId).toBe("task_timeout_test");

      // Pending task should be cleared
      expect(bridge.getPendingTaskCount()).toBe(0);

      // Agent should have received a TASK_TIMEOUT error
      const errorMsgs = ws.getSentMessages().filter(
        (m) => m.type === "error" && (m.payload as any).code === "TASK_TIMEOUT",
      );
      expect(errorMsgs).toHaveLength(1);
    });

    it("rate limiting kicks in on rapid message burst from agent", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      // Dispatch a task so the agent has something to send progress for
      const packet = createTaskPacket({
        packetId: "task_rate_test",
        requestedCapabilities: ["code_analysis"],
      });
      bridge.dispatchTask(agentId, packet);

      // Blast 51 heartbeat messages (limit is 50/min)
      for (let i = 0; i < 51; i++) {
        const msg: BridgeMessage = {
          type: "heartbeat",
          id: `hb_${i}`,
          timestamp: new Date().toISOString(),
          payload: {},
        };
        ws.emit("message", JSON.stringify(msg));
      }

      // The 51st message should trigger rate limit
      const errorMsgs = ws.getSentMessages().filter(
        (m) => m.type === "error" && (m.payload as any).code === "RATE_LIMITED",
      );
      expect(errorMsgs.length).toBeGreaterThanOrEqual(1);
      expect(ws.closed).toBeTruthy();
      expect(ws.closed!.code).toBe(4013);
    });

    it("rate limit window resets after 1 minute", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      // Send 45 messages (under limit)
      for (let i = 0; i < 45; i++) {
        const msg: BridgeMessage = {
          type: "heartbeat",
          id: `hb_batch1_${i}`,
          timestamp: new Date().toISOString(),
          payload: {},
        };
        ws.emit("message", JSON.stringify(msg));
      }

      // Advance past rate limit window
      vi.advanceTimersByTime(61_000);

      // Update lastPongAt so heartbeat doesn't kill the connection
      const conn = (bridge as any).connections.get(agentId);
      if (conn) conn.lastPongAt = Date.now();

      // Should be able to send more messages
      const msg: BridgeMessage = {
        type: "heartbeat",
        id: "hb_after_reset",
        timestamp: new Date().toISOString(),
        payload: {},
      };
      ws.emit("message", JSON.stringify(msg));

      // No rate limit error for this message
      const errorAfterReset = ws.getSentMessages().filter(
        (m) => m.type === "error" && (m.payload as any).code === "RATE_LIMITED",
      );
      expect(errorAfterReset).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Q1 — Scaling
  // Persona: Jane's company is growing. Multiple teams, multiple agents,
  // concurrent operations. Testing capacity enforcement.
  // ═══════════════════════════════════════════════════════════════════════

  describe("Q1 — Scaling", () => {
    it("enforces connection limit of 50 agents", () => {
      const smallBridge = new CommandBridge({ maxConnections: 5, heartbeatIntervalMs: 30_000 });
      (smallBridge as any).wss = { handleUpgrade: vi.fn(), close: vi.fn() };

      // Register 5 agents successfully
      for (let i = 0; i < 5; i++) {
        registerAgent(smallBridge, {
          ...CLAUDE_CODE_REG,
          agentName: `Agent ${i}`,
        });
      }
      expect(smallBridge.getConnectedAgents()).toHaveLength(5);

      // 6th registration should fail at the capacity check inside handleRegistration
      const ws6 = new MockWebSocket();
      (smallBridge as any).handleNewConnection(ws6 as any, "agent_overflow", "user_jane");
      const regMsg: BridgeMessage = {
        type: "register",
        id: "reg_overflow",
        timestamp: new Date().toISOString(),
        payload: { ...CLAUDE_CODE_REG, agentName: "Agent Overflow" },
      };
      ws6.emit("message", JSON.stringify(regMsg));

      const errMsg = ws6.getSentMessages().find(
        (m) => m.type === "error" && (m.payload as any).code === "CAPACITY_FULL",
      );
      expect(errMsg).toBeDefined();
      expect(smallBridge.getConnectedAgents()).toHaveLength(5);

      smallBridge.shutdown();
    });

    it("dispatches concurrent tasks to 5 agents by capability", () => {
      const agents = [];
      const capabilities = [
        ["code_analysis", "testing"],
        ["web_research", "api_calls"],
        ["monitoring", "alerting"],
        ["code_analysis", "git_operations"],
        ["scheduling", "notifications"],
      ];

      for (let i = 0; i < 5; i++) {
        agents.push(
          registerAgent(bridge, {
            agentName: `Team Agent ${i}`,
            agentType: "claude_code",
            runtimeSurface: "local",
            capabilities: capabilities[i],
            platform: "linux",
          }),
        );
      }

      // Dispatch 5 tasks, each targeting a different capability
      const tasks = [
        createTaskPacket({ packetId: "concurrent_1", requestedCapabilities: ["code_analysis"] }),
        createTaskPacket({ packetId: "concurrent_2", requestedCapabilities: ["web_research"] }),
        createTaskPacket({ packetId: "concurrent_3", requestedCapabilities: ["monitoring"] }),
        createTaskPacket({ packetId: "concurrent_4", requestedCapabilities: ["git_operations"] }),
        createTaskPacket({ packetId: "concurrent_5", requestedCapabilities: ["scheduling"] }),
      ];

      const results = tasks.map((task, i) => bridge.dispatchTask(agents[i].agentId, task));

      // All should succeed
      expect(results.every((r) => r.dispatched)).toBe(true);
      expect(bridge.getPendingTaskCount()).toBe(5);
    });

    it("handles task cancellation via agent disconnect mid-flight", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      // Dispatch 3 tasks
      for (let i = 0; i < 3; i++) {
        bridge.dispatchTask(agentId, createTaskPacket({
          packetId: `inflight_${i}`,
          requestedCapabilities: ["code_analysis"],
        }));
      }
      expect(bridge.getPendingTaskCount()).toBe(3);

      const resultHandler = vi.fn();
      bridge.on("task:result", resultHandler);

      // Agent disconnects unexpectedly
      ws.emit("close", 1006, Buffer.from("Connection reset"));

      // All 3 pending tasks should emit failed results
      expect(resultHandler).toHaveBeenCalledTimes(3);
      for (const call of resultHandler.mock.calls) {
        expect(call[0].status).toBe("failed");
        expect(call[0].errorMessage).toContain("Agent disconnected");
      }

      // All tasks cleared
      expect(bridge.getPendingTaskCount()).toBe(0);
      expect(bridge.isAgentConnected(agentId)).toBe(false);
    });

    it("agent reconnects after disconnect and gets new agentId", () => {
      const first = registerAgent(bridge, CLAUDE_CODE_REG);
      const firstId = first.agentId;

      // Disconnect
      first.ws.emit("close", 1001, Buffer.from("Going away"));

      expect(bridge.isAgentConnected(firstId)).toBe(false);

      // Reconnect — gets a new agentId
      const second = registerAgent(bridge, CLAUDE_CODE_REG);
      expect(second.agentId).not.toBe(firstId);
      expect(bridge.isAgentConnected(second.agentId)).toBe(true);
      expect(bridge.getConnectedAgents()).toHaveLength(1);
    });

    it("rejects duplicate packetId on task dispatch", () => {
      const { agentId } = registerAgent(bridge, CLAUDE_CODE_REG);

      const packet = createTaskPacket({
        packetId: "task_unique_123",
        requestedCapabilities: ["code_analysis"],
      });

      const first = bridge.dispatchTask(agentId, packet);
      expect(first.dispatched).toBe(true);

      const duplicate = bridge.dispatchTask(agentId, packet);
      expect(duplicate.dispatched).toBe(false);
      expect(duplicate.reason).toContain("Duplicate packetId");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Q2 — Reliability
  // Adversarial inputs, malformed messages, security boundary tests.
  // ═══════════════════════════════════════════════════════════════════════

  describe("Q2 — Reliability", () => {
    it("rejects malformed JSON messages with PARSE_ERROR", () => {
      const { ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      // Send garbage
      ws.emit("message", "this is not json {{{");

      const errMsg = ws.getSentMessages().find(
        (m) => m.type === "error" && (m.payload as any).code === "PARSE_ERROR",
      );
      expect(errMsg).toBeDefined();
    });

    it("rejects oversized messages before JSON.parse (BOUND_READ)", () => {
      const { ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      // Create a message larger than 1MB
      const oversized = "x".repeat(1_048_577);
      ws.emit("message", oversized);

      const errMsg = ws.getSentMessages().find(
        (m) => m.type === "error" && (m.payload as any).code === "MESSAGE_TOO_LARGE",
      );
      expect(errMsg).toBeDefined();
    });

    it("rejects messages with missing envelope fields (no type or id)", () => {
      const { ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      // Valid JSON but missing required fields
      ws.emit("message", JSON.stringify({ foo: "bar" }));

      const errMsg = ws.getSentMessages().find(
        (m) => m.type === "error" && (m.payload as any).code === "INVALID_ENVELOPE",
      );
      expect(errMsg).toBeDefined();
    });

    it("rejects messages from unregistered agent with NOT_REGISTERED", () => {
      const ws = new MockWebSocket();
      const agentId = "agent_unregistered";
      (bridge as any).handleNewConnection(ws as any, agentId, "user_jane");

      // Send a heartbeat without registering first
      const msg: BridgeMessage = {
        type: "heartbeat",
        id: "hb_unregistered",
        timestamp: new Date().toISOString(),
        payload: {},
      };
      ws.emit("message", JSON.stringify(msg));

      const errMsg = ws.getSentMessages().find(
        (m) => m.type === "error" && (m.payload as any).code === "NOT_REGISTERED",
      );
      expect(errMsg).toBeDefined();
    });

    it("rejects task dispatch with invalid packetId format (SSRF/injection vector)", () => {
      const { agentId } = registerAgent(bridge, CLAUDE_CODE_REG);

      // Attempt SQL injection via packetId
      const malicious = createTaskPacket({
        packetId: "'; DROP TABLE tasks; --",
        requestedCapabilities: ["code_analysis"],
      });
      const result = bridge.dispatchTask(agentId, malicious);
      expect(result.dispatched).toBe(false);
      expect(result.reason).toContain("Invalid packetId format");

      // Attempt path traversal
      const pathTraversal = createTaskPacket({
        packetId: "../../etc/passwd",
        requestedCapabilities: ["code_analysis"],
      });
      const result2 = bridge.dispatchTask(agentId, pathTraversal);
      expect(result2.dispatched).toBe(false);

      // Attempt oversized packetId (>128 chars)
      const longId = createTaskPacket({
        packetId: "a".repeat(129),
        requestedCapabilities: ["code_analysis"],
      });
      const result3 = bridge.dispatchTask(agentId, longId);
      expect(result3.dispatched).toBe(false);
    });

    it("rejects invalid agentType in registration", () => {
      const ws = new MockWebSocket();
      (bridge as any).handleNewConnection(ws as any, "agent_bad_type", "user_jane");

      const regMsg: BridgeMessage = {
        type: "register",
        id: "reg_bad_type",
        timestamp: new Date().toISOString(),
        payload: {
          agentName: "Evil Agent",
          agentType: "malicious_type", // invalid
          runtimeSurface: "local",
          capabilities: ["hacking"],
          platform: "evil-os",
        },
      };
      ws.emit("message", JSON.stringify(regMsg));

      const errMsg = ws.getSentMessages().find(
        (m) => m.type === "error" && (m.payload as any).code === "INVALID_REGISTRATION",
      );
      expect(errMsg).toBeDefined();
    });

    it("sanitizes agent capabilities — strips special chars, limits count", () => {
      const { agentId } = registerAgent(bridge, {
        agentName: "Sanitize Test Agent",
        agentType: "claude_code",
        runtimeSurface: "local",
        capabilities: [
          "valid_capability",
          "also.valid:v2",
          "<script>alert('xss')</script>", // should be sanitized
          "normal",
        ],
        platform: "linux",
      });

      const reg = bridge.getAgentRegistration(agentId);
      expect(reg).toBeDefined();
      // XSS payload should be stripped of < > ( ) ' chars
      const sanitizedCap = reg!.capabilities.find((c) => c.includes("script"));
      if (sanitizedCap) {
        expect(sanitizedCap).not.toContain("<");
        expect(sanitizedCap).not.toContain(">");
        expect(sanitizedCap).not.toContain("(");
      }
    });

    it("handles task result from wrong agent — rejects spoofed results", () => {
      const agent1 = registerAgent(bridge, CLAUDE_CODE_REG);
      const agent2 = registerAgent(bridge, OPENCLAW_REG);

      // Dispatch task to agent1
      const packet = createTaskPacket({
        packetId: "task_spoof_test",
        requestedCapabilities: ["code_analysis"],
      });
      bridge.dispatchTask(agent1.agentId, packet);

      const resultHandler = vi.fn();
      bridge.on("task:result", resultHandler);

      // Agent2 tries to claim the result (spoofing)
      const spoofedResult: BridgeMessage = {
        type: "task_result",
        id: "spoof_result",
        timestamp: new Date().toISOString(),
        payload: {
          packetId: "task_spoof_test",
          status: "completed",
          summary: "Spoofed result from wrong agent",
          durationMs: 100,
        } satisfies InboundTaskResult,
      };
      agent2.ws.emit("message", JSON.stringify(spoofedResult));

      // Result should be silently rejected (wrong agent)
      expect(resultHandler).not.toHaveBeenCalled();
      expect(bridge.getPendingTaskCount()).toBe(1); // still pending
    });

    it("handles unknown message type gracefully", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      const weirdMsg: BridgeMessage = {
        type: "nonexistent_type" as any,
        id: "weird_001",
        timestamp: new Date().toISOString(),
        payload: { data: "something" },
      };
      ws.emit("message", JSON.stringify(weirdMsg));

      const errMsg = ws.getSentMessages().find(
        (m) => m.type === "error" && (m.payload as any).code === "UNKNOWN_TYPE",
      );
      expect(errMsg).toBeDefined();
    });

    it("sanitizes task result — caps artifacts at 50, evidence at 100, summary at 10KB", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      const packet = createTaskPacket({
        packetId: "task_sanitize_result",
        requestedCapabilities: ["code_analysis"],
      });
      bridge.dispatchTask(agentId, packet);

      const resultHandler = vi.fn();
      bridge.on("task:result", resultHandler);

      // Send result with 60 artifacts (should be capped at 50)
      const hugeResult: BridgeMessage = {
        type: "task_result",
        id: "result_huge",
        timestamp: new Date().toISOString(),
        payload: {
          packetId: "task_sanitize_result",
          status: "completed",
          summary: "x".repeat(20_000), // Should be capped at 10,000
          artifacts: Array.from({ length: 60 }, (_, i) => ({
            type: "text",
            name: `artifact_${i}.txt`,
            content: `Content for artifact ${i}`,
          })),
          evidence: Array.from({ length: 120 }, (_, i) => ({
            type: "evidence_item",
            content: `Evidence ${i}`,
          })),
          durationMs: 5000,
        },
      };
      ws.emit("message", JSON.stringify(hugeResult));

      expect(resultHandler).toHaveBeenCalledOnce();
      const [sanitized] = resultHandler.mock.calls[0];
      expect(sanitized.summary.length).toBeLessThanOrEqual(10_000);
      expect(sanitized.artifacts.length).toBeLessThanOrEqual(50);
      expect(sanitized.evidence.length).toBeLessThanOrEqual(100);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Year 1 — Maturity
  // Persona: Jane's company has been using NodeBench for a year.
  // Testing agent presence, health, and graceful shutdown.
  // ═══════════════════════════════════════════════════════════════════════

  describe("Year 1 — Maturity", () => {
    it("agent presence tracking is accurate through connect/disconnect cycles", () => {
      expect(bridge.getConnectedAgents()).toHaveLength(0);

      const a1 = registerAgent(bridge, CLAUDE_CODE_REG);
      expect(bridge.getConnectedAgents()).toHaveLength(1);

      const a2 = registerAgent(bridge, OPENCLAW_REG);
      expect(bridge.getConnectedAgents()).toHaveLength(2);

      // Disconnect a1
      a1.ws.emit("close", 1000, Buffer.from("Normal closure"));
      expect(bridge.getConnectedAgents()).toHaveLength(1);
      expect(bridge.isAgentConnected(a1.agentId)).toBe(false);
      expect(bridge.isAgentConnected(a2.agentId)).toBe(true);

      // Reconnect a1 with new ID
      const a1b = registerAgent(bridge, CLAUDE_CODE_REG);
      expect(bridge.getConnectedAgents()).toHaveLength(2);

      // Disconnect both
      a2.ws.emit("close", 1000, Buffer.from("Normal closure"));
      a1b.ws.emit("close", 1000, Buffer.from("Normal closure"));
      expect(bridge.getConnectedAgents()).toHaveLength(0);
    });

    it("health snapshot includes accurate type counts and pending tasks", () => {
      const claude1 = registerAgent(bridge, { ...CLAUDE_CODE_REG, agentName: "CC1" });
      const claude2 = registerAgent(bridge, { ...CLAUDE_CODE_REG, agentName: "CC2" });
      const oc = registerAgent(bridge, OPENCLAW_REG);

      bridge.dispatchTask(
        claude1.agentId,
        createTaskPacket({ packetId: "health_task_1", requestedCapabilities: ["code_analysis"] }),
      );
      bridge.dispatchTask(
        oc.agentId,
        createTaskPacket({ packetId: "health_task_2", requestedCapabilities: ["web_research"] }),
      );

      const health = bridge.getHealthSnapshot();
      expect(health.status).toBe("healthy");
      expect(health.agents.connected).toBe(3);
      expect(health.agents.types.claude_code).toBe(2);
      expect(health.agents.types.openclaw).toBe(1);
      expect(health.tasks.pending).toBe(2);
    });

    it("graceful shutdown closes all agents and clears all pending tasks", () => {
      const agents = [
        registerAgent(bridge, CLAUDE_CODE_REG),
        registerAgent(bridge, OPENCLAW_REG),
        registerAgent(bridge, BACKGROUND_REG),
      ];

      // Dispatch tasks to each
      agents.forEach((a, i) => {
        bridge.dispatchTask(
          a.agentId,
          createTaskPacket({
            packetId: `shutdown_task_${i}`,
            requestedCapabilities: [a.agentId.includes("test") ? "code_analysis" : "code_analysis"],
          }),
        );
      });
      // Only claude_code agent's task should succeed (others lack code_analysis)
      // Dispatch tasks matching their real capabilities
      bridge.dispatchTask(
        agents[1].agentId,
        createTaskPacket({
          packetId: "shutdown_task_oc",
          requestedCapabilities: ["web_research"],
        }),
      );

      expect(bridge.getPendingTaskCount()).toBeGreaterThan(0);

      bridge.shutdown();

      expect(bridge.getConnectedAgents()).toHaveLength(0);
      expect(bridge.getPendingTaskCount()).toBe(0);

      // Agents should have received close frames
      for (const a of agents) {
        expect(a.ws.closed).toBeTruthy();
      }
    });

    it("findAgentsByCapability returns only agents with OPEN connections", () => {
      const a1 = registerAgent(bridge, CLAUDE_CODE_REG);
      const a2 = registerAgent(bridge, {
        ...CLAUDE_CODE_REG,
        agentName: "CC Backup",
      });

      expect(bridge.findAgentsByCapability("code_analysis")).toHaveLength(2);

      // Simulate a1's ws going to CLOSING state
      a1.ws.readyState = WebSocket.CLOSING;

      const result = bridge.findAgentsByCapability("code_analysis");
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(a2.agentId);
    });

    it("sendApprovalResponse returns false for disconnected agent", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      // Disconnect
      ws.emit("close", 1000, Buffer.from("Normal closure"));

      const sent = bridge.sendApprovalResponse(agentId, "some_packet", true);
      expect(sent).toBe(false);
    });

    it("dispatching to disconnected agent returns failure", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      ws.emit("close", 1000, Buffer.from("Normal closure"));

      const result = bridge.dispatchTask(
        agentId,
        createTaskPacket({ requestedCapabilities: ["code_analysis"] }),
      );
      expect(result.dispatched).toBe(false);
      expect(result.reason).toContain("not connected");
    });

    it("dispatching to agent with closed websocket returns failure", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      // Simulate WS going to CLOSED without close event processed yet
      ws.readyState = WebSocket.CLOSED;

      const result = bridge.dispatchTask(
        agentId,
        createTaskPacket({ requestedCapabilities: ["code_analysis"] }),
      );
      expect(result.dispatched).toBe(false);
      expect(result.reason).toContain("not open");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Year 5 — Scale
  // Sustained load, memory bounds, edge cases at scale.
  // ═══════════════════════════════════════════════════════════════════════

  describe("Year 5 — Scale", () => {
    it("pendingTasks cap at 500 — rejects task 501", () => {
      // Register enough agents to hold tasks
      const agents: { agentId: string; ws: MockWebSocket }[] = [];
      for (let i = 0; i < 10; i++) {
        agents.push(
          registerAgent(bridge, {
            ...CLAUDE_CODE_REG,
            agentName: `Scale Agent ${i}`,
            capabilities: ["code_analysis", "scale_test"],
          }),
        );
      }

      // Dispatch 500 tasks (50 per agent)
      let dispatched = 0;
      for (let i = 0; i < 500; i++) {
        const agentIdx = i % agents.length;
        const result = bridge.dispatchTask(
          agents[agentIdx].agentId,
          createTaskPacket({
            packetId: `scale_task_${i}`,
            requestedCapabilities: ["code_analysis"],
          }),
        );
        if (result.dispatched) dispatched++;
      }
      expect(dispatched).toBe(500);
      expect(bridge.getPendingTaskCount()).toBe(500);

      // Task 501 should be rejected
      const overflow = bridge.dispatchTask(
        agents[0].agentId,
        createTaskPacket({
          packetId: "scale_task_overflow",
          requestedCapabilities: ["code_analysis"],
        }),
      );
      expect(overflow.dispatched).toBe(false);
      expect(overflow.reason).toContain("Max pending tasks");
    });

    it("sustained message processing — 200 task results processed without leak", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      const resultHandler = vi.fn();
      bridge.on("task:result", resultHandler);

      // Dispatch and complete 200 tasks in batches of 40 (under the 50/min rate limit).
      // Advance time between batches to reset the rate window.
      const BATCH_SIZE = 40;
      const TOTAL = 200;
      for (let i = 0; i < TOTAL; i++) {
        // Reset rate window every batch by advancing time past the 1-min window
        if (i > 0 && i % BATCH_SIZE === 0) {
          vi.advanceTimersByTime(61_000);
          // Keep agent alive — update lastPongAt so heartbeat doesn't kill it
          const conn = (bridge as any).connections.get(agentId);
          if (conn) conn.lastPongAt = Date.now();
        }

        const packetId = `sustained_${i}`;
        bridge.dispatchTask(
          agentId,
          createTaskPacket({
            packetId,
            requestedCapabilities: ["code_analysis"],
          }),
        );

        // Immediately complete it
        const resultMsg: BridgeMessage = {
          type: "task_result",
          id: `result_${i}`,
          timestamp: new Date().toISOString(),
          payload: {
            packetId,
            status: "completed",
            summary: `Analysis ${i} of Vertex Capital portfolio company complete`,
            artifacts: [
              { type: "json", name: "result.json", content: `{"score": ${Math.random()}}` },
            ],
            durationMs: 150 + Math.random() * 500,
          } satisfies InboundTaskResult,
        };
        ws.emit("message", JSON.stringify(resultMsg));
      }

      expect(resultHandler).toHaveBeenCalledTimes(TOTAL);
      // No task leaks — all completed tasks removed from pending
      expect(bridge.getPendingTaskCount()).toBe(0);
    });

    it("progress updates with out-of-range values are clamped", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      bridge.dispatchTask(
        agentId,
        createTaskPacket({
          packetId: "task_clamp_test",
          requestedCapabilities: ["code_analysis"],
        }),
      );

      const progressHandler = vi.fn();
      bridge.on("task:progress", progressHandler);

      // Send progress with percentComplete > 100 and negative steps
      const badProgress: BridgeMessage = {
        type: "task_progress",
        id: "progress_bad",
        timestamp: new Date().toISOString(),
        payload: {
          packetId: "task_clamp_test",
          percentComplete: 250, // should clamp to 100
          currentStep: "Overflowing",
          stepsCompleted: -5, // should clamp to 0
          stepsTotal: -1, // should clamp to 0
        },
      };
      ws.emit("message", JSON.stringify(badProgress));

      expect(progressHandler).toHaveBeenCalledOnce();
      const [clamped] = progressHandler.mock.calls[0];
      expect(clamped.percentComplete).toBe(100);
      expect(clamped.stepsCompleted).toBe(0);
      expect(clamped.stepsTotal).toBe(0);
    });

    it("task result with invalid status is coerced to 'failed'", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      bridge.dispatchTask(
        agentId,
        createTaskPacket({
          packetId: "task_bad_status",
          requestedCapabilities: ["code_analysis"],
        }),
      );

      const resultHandler = vi.fn();
      bridge.on("task:result", resultHandler);

      const badResult: BridgeMessage = {
        type: "task_result",
        id: "result_bad",
        timestamp: new Date().toISOString(),
        payload: {
          packetId: "task_bad_status",
          status: "super_completed_everything_great" as any,
          summary: "Invalid status test",
          durationMs: 100,
        },
      };
      ws.emit("message", JSON.stringify(badResult));

      expect(resultHandler).toHaveBeenCalledOnce();
      const [sanitized] = resultHandler.mock.calls[0];
      expect(sanitized.status).toBe("failed"); // coerced
    });

    it("negative durationMs is clamped to 0", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      bridge.dispatchTask(
        agentId,
        createTaskPacket({
          packetId: "task_neg_duration",
          requestedCapabilities: ["code_analysis"],
        }),
      );

      const resultHandler = vi.fn();
      bridge.on("task:result", resultHandler);

      const badResult: BridgeMessage = {
        type: "task_result",
        id: "result_neg",
        timestamp: new Date().toISOString(),
        payload: {
          packetId: "task_neg_duration",
          status: "completed",
          summary: "Done",
          durationMs: -500,
        },
      };
      ws.emit("message", JSON.stringify(badResult));

      const [sanitized] = resultHandler.mock.calls[0];
      expect(sanitized.durationMs).toBe(0);
    });

    it("task result for unknown packetId is silently dropped", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      const resultHandler = vi.fn();
      bridge.on("task:result", resultHandler);

      const orphanResult: BridgeMessage = {
        type: "task_result",
        id: "result_orphan",
        timestamp: new Date().toISOString(),
        payload: {
          packetId: "task_never_dispatched",
          status: "completed",
          summary: "Orphan result",
          durationMs: 100,
        },
      };
      ws.emit("message", JSON.stringify(orphanResult));

      expect(resultHandler).not.toHaveBeenCalled();
    });

    it("stale connection cleanup removes CLOSED websockets", () => {
      const a1 = registerAgent(bridge, CLAUDE_CODE_REG);
      const a2 = registerAgent(bridge, OPENCLAW_REG);

      expect(bridge.getConnectedAgents()).toHaveLength(2);

      // Simulate a1's WS going to CLOSED state (e.g., network drop)
      a1.ws.readyState = WebSocket.CLOSED;

      // Run cleanup
      (bridge as any).cleanupStaleConnections();

      expect(bridge.getConnectedAgents()).toHaveLength(1);
      expect(bridge.isAgentConnected(a2.agentId)).toBe(true);
    });

    it("agent-initiated heartbeat receives ack", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      const hbMsg: BridgeMessage = {
        type: "heartbeat",
        id: "hb_agent_init",
        timestamp: new Date().toISOString(),
        payload: {},
      };
      ws.emit("message", JSON.stringify(hbMsg));

      const acks = ws.getSentMessages().filter(
        (m) => m.type === "heartbeat" && m.id === "hb_agent_init",
      );
      expect(acks).toHaveLength(1);
      expect((acks[0].payload as any).status).toBe("ok");
    });

    it("config caps maxConnections to MAX_CONNECTIONS constant (50)", () => {
      // Try to set maxConnections above 50
      const bigBridge = new CommandBridge({ maxConnections: 999 });
      // The constructor caps at MAX_CONNECTIONS (50)
      expect((bigBridge as any).maxConnections).toBe(50);
      bigBridge.shutdown();
    });

    it("config caps maxMessageSize to MAX_MESSAGE_BYTES constant (1MB)", () => {
      const bigBridge = new CommandBridge({ maxMessageSize: 100_000_000 });
      expect((bigBridge as any).maxMessageSize).toBe(1_048_576);
      bigBridge.shutdown();
    });

    it("sendToAgent fails gracefully when ws.send throws", () => {
      const { agentId, ws } = registerAgent(bridge, CLAUDE_CODE_REG);

      // Make send throw
      ws.send = () => {
        throw new Error("Connection reset by peer");
      };

      const packet = createTaskPacket({
        packetId: "task_send_fail",
        requestedCapabilities: ["code_analysis"],
      });

      const result = bridge.dispatchTask(agentId, packet);
      // Should detect send failure and clean up
      expect(result.dispatched).toBe(false);
      expect(result.reason).toContain("Failed to send");
      expect(bridge.getPendingTaskCount()).toBe(0);
    });
  });
});
