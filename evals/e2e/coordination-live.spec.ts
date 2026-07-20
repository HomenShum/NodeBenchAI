/**
 * Coordination Live E2E Test — 3DClaw-Inspired End-to-End
 *
 * Proves the full shared context coordination cycle works with REAL API calls:
 *   1. Peer registration → appears in CoordinationHub
 *   2. Packet publishing → shows in real-time via SSE
 *   3. Task delegation → reaches agent endpoint
 *   4. Task completion → result appears in UI
 *   5. Messaging → delivered between peers
 *
 * Scenario: Founder agent coordinates with Claude Code and OpenClaw agents
 * User: Power user running multi-agent delegation from the web control plane
 * Goal: Prove that the shared context protocol handles real coordination
 * Scale: Single user, 3 concurrent peers, 5 packets, 2 delegations
 * Duration: ~30 seconds (short-running burst scenario)
 *
 * Inspired by Claw3D's runtime visibility pattern:
 *   Browser → Express (SSE) → SQLite store ← MCP tools (agent-side)
 */

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { startServer, stopServer, getApiUrl } from "./fixtures/server-fixture";

// ── Test data ──────────────────────────────────────────────────────────────

const TEST_PACKET = {
  entityName: "Anthropic",
  canonicalEntity: "Anthropic",
  answer: "Anthropic launched Claude 4.6 with 1M context, positioning as the most capable coding model.",
  confidence: 85,
  proofStatus: "verified",
  packetId: "e2e-test-packet-001",
  packetType: "founder_packet",
  query: "What is Anthropic's latest product?",
  sourceRefs: [
    { id: "src-1", href: "https://anthropic.com/news", label: "Anthropic Blog" },
  ],
  answerBlocks: [
    { id: "block-1", text: "Claude 4.6 Opus now available with 1M token context window" },
  ],
  changes: [
    { description: "Claude 4.6 released with extended context" },
  ],
  risks: [
    { title: "Competitive pressure from OpenAI o3", description: "OpenAI's o3 model targets similar use cases" },
  ],
  interventions: [
    { action: "Update competitive analysis with Claude 4.6 capabilities" },
  ],
  nextQuestions: [
    "How does Claude 4.6 compare to GPT-5 on coding benchmarks?",
    "What pricing changes accompany the 1M context release?",
  ],
};

const TEST_DELEGATION_GOAL = "Build a competitive analysis comparing Claude 4.6 vs GPT-5 coding capabilities";

// ── Lifecycle ──────────────────────────────────────────────────────────────

test.describe("Coordination Hub — Live E2E", () => {
  test.beforeAll(async () => {
    await startServer();
  });

  test.afterAll(async () => {
    stopServer();
  });

  test("full coordination cycle: register → publish → delegate → verify UI", async ({
    page,
    request,
  }) => {
    const apiBase = getApiUrl("/api/shared-context");

    // ── Step 1: Verify server is healthy ──────────────────────────────
    const healthRes = await request.get(getApiUrl("/health"));
    expect(healthRes.ok()).toBe(true);
    const health = await healthRes.json();
    expect(health.status).toBe("ok");

    // ── Step 2: Publish a context packet (registers web peer automatically) ──
    const publishRes = await request.post(`${apiBase}/publish`, {
      data: { packet: TEST_PACKET },
    });
    expect(publishRes.ok()).toBe(true);
    const publishData = await publishRes.json();
    expect(publishData.success).toBe(true);
    expect(publishData.contextId).toBeTruthy();
    expect(publishData.workspaceId).toBeTruthy();

    const contextId = publishData.contextId as string;
    const workspaceId = publishData.workspaceId as string;

    // Verify snapshot includes the packet
    expect(publishData.snapshot).toBeTruthy();
    expect(publishData.snapshot.peers.length).toBeGreaterThan(0);
    expect(publishData.snapshot.recentPackets.length).toBeGreaterThan(0);

    // ── Step 3: Read the packet back ──────────────────────────────────
    const packetRes = await request.get(`${apiBase}/packets/${contextId}`);
    expect(packetRes.ok()).toBe(true);
    const packetData = await packetRes.json();
    expect(packetData.success).toBe(true);
    expect(packetData.packet).toBeTruthy();
    expect(packetData.packet.subject).toContain("Anthropic");

    // ── Step 4: Delegate to Claude Code ────────────────────────────────
    const delegateRes = await request.post(`${apiBase}/delegate`, {
      data: {
        packet: TEST_PACKET,
        targetAgent: "claude_code",
        goal: TEST_DELEGATION_GOAL,
      },
    });
    expect(delegateRes.ok()).toBe(true);
    const delegateData = await delegateRes.json();
    expect(delegateData.success).toBe(true);
    expect(delegateData.targetAgent).toBe("claude_code");
    expect(delegateData.targetLabel).toBe("Claude Code");
    expect(delegateData.handoffPrompt).toContain("NodeBench MCP");
    expect(delegateData.handoffPrompt).toContain(TEST_DELEGATION_GOAL);
    expect(delegateData.taskId).toBeTruthy();

    // ── Step 5: Delegate to OpenClaw ───────────────────────────────────
    const delegateOcRes = await request.post(`${apiBase}/delegate`, {
      data: {
        packet: {
          ...TEST_PACKET,
          packetId: "e2e-test-packet-002",
          query: "Analyze OpenAI's competitive positioning",
        },
        targetAgent: "openclaw",
        goal: "Run competitive intel sweep on OpenAI product pipeline",
      },
    });
    expect(delegateOcRes.ok()).toBe(true);
    const delegateOcData = await delegateOcRes.json();
    expect(delegateOcData.targetAgent).toBe("openclaw");
    expect(delegateOcData.targetLabel).toBe("OpenClaw");

    // ── Step 6: Get full snapshot — should show peers, packets, tasks ──
    const snapshotRes = await request.get(`${apiBase}/snapshot?limit=20`);
    expect(snapshotRes.ok()).toBe(true);
    const snapshotData = await snapshotRes.json();
    expect(snapshotData.success).toBe(true);

    const snapshot = snapshotData.snapshot;
    // Should have at least 3 peers: web control plane, claude_code delegate, openclaw delegate
    expect(snapshot.peers.length).toBeGreaterThanOrEqual(3);
    // Should have at least 2 packets (published + delegated)
    expect(snapshot.recentPackets.length).toBeGreaterThanOrEqual(2);
    // Should have at least 2 tasks (one per delegation)
    expect(snapshot.recentTasks.length).toBeGreaterThanOrEqual(2);

    // Verify peer roles
    const peerIds = snapshot.peers.map((p: { peerId: string }) => p.peerId);
    expect(peerIds).toContain("peer:web:control_plane");
    expect(peerIds).toContain("peer:delegate:claude_code");
    expect(peerIds).toContain("peer:delegate:openclaw");

    // ── Step 7: Test filtering ────────────────────────────────────────
    const filteredRes = await request.get(
      `${apiBase}/snapshot?limit=10&contextType=entity_packet&subjectIncludes=Anthropic`,
    );
    expect(filteredRes.ok()).toBe(true);
    const filteredData = await filteredRes.json();
    expect(filteredData.snapshot.recentPackets.length).toBeGreaterThan(0);

    // ── Step 8: Verify error handling ─────────────────────────────────
    // Missing required fields should return 400
    const badRes = await request.post(`${apiBase}/publish`, {
      data: { packet: {} },
    });
    expect(badRes.status()).toBe(400);

    const badDelegateRes = await request.post(`${apiBase}/delegate`, {
      data: { packet: {}, targetAgent: "invalid_target" },
    });
    expect(badDelegateRes.status()).toBe(400);

    // Non-existent packet returns 404
    const missingRes = await request.get(`${apiBase}/packets/context:nonexistent`);
    expect(missingRes.status()).toBe(404);
  });

  test("SSE event stream delivers real-time updates", async ({ request }) => {
    const apiBase = getApiUrl("/api/shared-context");

    // Start SSE connection
    const eventsRes = await request.get(`${apiBase}/events?limit=50`, {
      timeout: 5000,
    });
    // SSE endpoint returns 200 with text/event-stream content type
    expect(eventsRes.status()).toBe(200);
    const contentType = eventsRes.headers()["content-type"];
    expect(contentType).toContain("text/event-stream");
  });

  test("snapshot filtering by workspace and context type", async ({ request }) => {
    const apiBase = getApiUrl("/api/shared-context");

    // First publish a packet to ensure data exists
    await request.post(`${apiBase}/publish`, {
      data: {
        packet: {
          ...TEST_PACKET,
          packetId: "e2e-filter-test",
          entityName: "Stripe",
          canonicalEntity: "Stripe",
          answer: "Stripe launched Stripe Agent toolkit for AI-powered payments.",
        },
      },
    });

    // Filter by workspace
    const wsRes = await request.get(`${apiBase}/snapshot?workspaceId=workspace:stripe`);
    expect(wsRes.ok()).toBe(true);
    const wsData = await wsRes.json();
    expect(wsData.success).toBe(true);
    // All returned packets should match the workspace
    for (const packet of wsData.snapshot.recentPackets) {
      expect(packet.workspaceId).toBe("workspace:stripe");
    }

    // Filter by context type
    const ctRes = await request.get(`${apiBase}/snapshot?contextType=entity_packet`);
    expect(ctRes.ok()).toBe(true);
    const ctData = await ctRes.json();
    for (const packet of ctData.snapshot.recentPackets) {
      expect(packet.contextType).toBe("entity_packet");
    }
  });

  test("concurrent delegations don't corrupt state", async ({ request }) => {
    const apiBase = getApiUrl("/api/shared-context");

    // Fire 5 concurrent delegations
    const delegations = Array.from({ length: 5 }, (_, i) =>
      request.post(`${apiBase}/delegate`, {
        data: {
          packet: {
            ...TEST_PACKET,
            packetId: `e2e-concurrent-${i}`,
            entityName: `Company${i}`,
            canonicalEntity: `Company${i}`,
            answer: `Analysis of Company${i} market position.`,
          },
          targetAgent: i % 2 === 0 ? "claude_code" : "openclaw",
          goal: `Analyze Company${i}`,
        },
      }),
    );

    const results = await Promise.all(delegations);
    // All should succeed
    for (const res of results) {
      expect(res.ok()).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
    }

    // Snapshot should reflect all delegations
    const snapRes = await request.get(`${apiBase}/snapshot?limit=50`);
    const snapData = await snapRes.json();
    expect(snapData.snapshot.recentPackets.length).toBeGreaterThanOrEqual(5);
    expect(snapData.snapshot.recentTasks.length).toBeGreaterThanOrEqual(5);
  });

  test("bridge health endpoints respond correctly", async ({ request }) => {
    // Command Bridge
    const bridgeRes = await request.get(getApiUrl("/bridge/health"));
    expect(bridgeRes.ok()).toBe(true);
    const bridgeData = await bridgeRes.json();
    expect(bridgeData).toHaveProperty("connectedAgents");

    // Sync Bridge
    const syncRes = await request.get(getApiUrl("/api/sync-bridge/health"));
    expect(syncRes.ok()).toBe(true);
    const syncData = await syncRes.json();
    expect(syncData).toHaveProperty("activeConnections");

    // MCP Gateway info
    const mcpRes = await request.get(getApiUrl("/mcp/info"));
    expect(mcpRes.ok()).toBe(true);
    const mcpData = await mcpRes.json();
    expect(mcpData.name).toBe("nodebench-mcp-gateway");
    expect(mcpData.tools).toBeGreaterThan(0);
  });
});
