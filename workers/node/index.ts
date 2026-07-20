/**
 * NodeBench Server — Express + WebSocket MCP Gateway + Voice Server
 *
 * Hosts:
 *   - MCP Gateway WebSocket at /mcp (remote tool access for Claude Code, Cursor, OpenClaw)
 *   - Voice session routes at /voice (OpenAI Realtime API WebRTC sessions)
 *   - Health check at /mcp/health
 *   - Root health at /health
 *
 * The MCP gateway dynamically loads all tools from the MCP local package
 * and serves them over WebSocket using JSON-RPC 2.0 (MCP wire protocol).
 *
 * Usage:
 *   npx tsx workers/node/index.ts [--port 3100] [--preset full]
 */

import { config as dotenvConfig } from "dotenv";
// Load .env.local so server-side code gets ELEVENLABS_API_KEY, CONVEX_URL, etc.
dotenvConfig({ path: ".env.local" });
// Map VITE_CONVEX_URL to CONVEX_URL for server-side modules that expect it
if (!process.env.CONVEX_URL && process.env.VITE_CONVEX_URL) {
  process.env.CONVEX_URL = process.env.VITE_CONVEX_URL;
}

import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { createMcpGateway, type McpGatewayConfig } from "./mcpGateway.js";
import { getMemoryStore, generateApiKey, hashPrefix, type ApiKeyRecord } from "./mcpAuth.js";
import { CommandBridge } from "./commandBridge.js";
import { mountProviderBus } from "./providerBus.js";
import { SyncBridgeServer } from "./syncBridge.js";
import type { McpTool } from "../../packages/mcp-local/src/types.js";
import { createSessionRouter } from "./routes/session.js";
import { createVoiceCaptureRouter } from "./routes/voiceCapture.js";
import { createTtsRouter } from "./routes/tts.js";
import { mountNemoClaw } from "./nemoclaw/index.js";
import { createSearchRouter } from "./routes/search.js";
import { createPipelineRouter } from "./routes/pipelineRoute.js";
import { createToolGraphRouter } from "./routes/toolGraph.js";
import { createSharedContextRouter } from "./routes/sharedContext.js";
import { createShareRouter } from "./routes/share.js";
import { createWatchlistRouter } from "./routes/watchlist.js";
import { createRetentionBridgeRouter } from "./routes/retentionBridge.js";
import { createImprovementRouter } from "./routes/improvementRoute.js";
import { createStreamingSearchRouter } from "./routes/streamingSearch.js";
import { createProductRouter } from "./routes/productRoutes.js";
import { createHarnessRouter } from "./routes/harness.js";
import { createWorkspaceSyncRouter } from "./routes/workspaceSync.js";
import { createExecuteRouter } from "./routes/execute.js";
import { createSubconsciousRouter } from "./routes/subconscious.js";
import { createHyperloopRouter } from "./routes/hyperloop.js";

// ── CLI argument parsing ──────────────────────────────────────────────────

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const PORT = portIdx >= 0 && args[portIdx + 1] ? parseInt(args[portIdx + 1], 10) : 3100;

// ── Tool loading ──────────────────────────────────────────────────────────

async function loadTools(): Promise<McpTool[]> {
  try {
    // loadAllToolsets() must be called first — TOOLSET_MAP starts empty with lazy-loading
    const { TOOLSET_MAP, loadAllToolsets } = await import("../../packages/mcp-local/src/toolsetRegistry.js");
    await loadAllToolsets();
    const allTools: McpTool[] = [];
    // TOOLSET_MAP is a Map — use .values() if Map, or Object.values() if plain object
    const entries = typeof TOOLSET_MAP.values === "function"
      ? Array.from(TOOLSET_MAP.values())
      : Object.values(TOOLSET_MAP);
    for (const tools of entries) {
      allTools.push(...(tools as McpTool[]));
    }
    const domainCount = typeof TOOLSET_MAP.size === "number" ? TOOLSET_MAP.size : Object.keys(TOOLSET_MAP).length;
    console.log(`[mcp-gateway] Loaded ${allTools.length} tools from ${domainCount} toolsets`);
    return allTools;
  } catch (err) {
    console.error("[mcp-gateway] Failed to load tools:", err);
    return [];
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const app = express();

  // CORS for HTTP endpoints
  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
    }),
  );

  app.use(express.json());

  // Load MCP tools
  const tools = await loadTools();

  if (tools.length === 0) {
    console.warn("[mcp-gateway] WARNING: No tools loaded — gateway will serve empty tool list");
  }

  // ── Seed a dev key if NODEBENCH_DEV_KEY is set ──────────────────────

  if (process.env.NODEBENCH_DEV_KEY) {
    console.log("[mcp-gateway] Dev mode: seeding in-memory API key from NODEBENCH_DEV_KEY");
    // The dev key is used as-is; we store its hash in the memory store
    const { createHash } = await import("node:crypto");
    const kHash = createHash("sha256").update(process.env.NODEBENCH_DEV_KEY).digest("hex");
    const prefix = hashPrefix(kHash);
    const store = getMemoryStore();
    store.set(prefix, {
      keyHash: kHash,
      keyHashPrefix: prefix,
      userId: "dev-user",
      permissions: ["tools:read", "tools:execute"],
      rateLimits: { perMinute: 100, perDay: 10_000 },
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      revokedAt: null,
    });
  }

  // ── Create MCP Gateway ──────────────────────────────────────────────

  const gatewayConfig: McpGatewayConfig = {
    tools,
    // In production, wire keyLookup to Convex:
    // keyLookup: async (prefix) => { /* call Convex internalQuery */ },
    // telemetryEmitter: async (telemetry) => { /* call Convex internalMutation */ },
    corsOrigins: ["*"],
  };

  const gateway = createMcpGateway(gatewayConfig);

  // ── Create Command Bridge (outbound agent dispatch) ─────────────────

  const commandBridge = new CommandBridge({
    maxConnections: 50,
    taskTimeoutMs: 300_000,
    heartbeatIntervalMs: 30_000,
    maxMessageSize: 1_048_576,
    // In production, wire keyLookup to Convex (same as gateway)
  });

  const syncBridge = new SyncBridgeServer({
    maxConnections: 100,
    heartbeatIntervalMs: 30_000,
    maxBatchSize: 200,
  });

  // Log bridge events server-side
  commandBridge.on("agent:connected", (agentId: string, reg: { agentName: string; agentType: string }) => {
    console.log(`[command-bridge] Agent connected: ${reg.agentName} (${reg.agentType}) — ${agentId}`);
  });
  commandBridge.on("agent:disconnected", (agentId: string, code: number, reason: string) => {
    console.log(`[command-bridge] Agent disconnected: ${agentId} — code=${code}, reason=${reason}`);
  });
  commandBridge.on("task:result", (result: { packetId: string; status: string }, agentId: string) => {
    console.log(`[command-bridge] Task result: ${result.packetId} — status=${result.status}, agent=${agentId}`);
  });

  // ── HTTP routes ─────────────────────────────────────────────────────

  // Root health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "nodebench-server",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // MCP gateway health check
  app.get("/mcp/health", (req, res) => {
    gateway.healthHandler(req, res);
  });

  // Command Bridge health check
  app.get("/bridge/health", (_req, res) => {
    res.json(commandBridge.getHealthSnapshot());
  });

  app.get("/sync-bridge/health", (_req, res) => {
    res.json(syncBridge.getHealthSnapshot());
  });
  app.get("/api/sync-bridge/health", (_req, res) => {
    res.json(syncBridge.getHealthSnapshot());
  });

  app.get("/sync-bridge/accounts/:userId", (req, res) => {
    res.json(syncBridge.getAccountSnapshot(req.params.userId));
  });
  app.get("/api/sync-bridge/accounts/:userId", (req, res) => {
    res.json(syncBridge.getAccountSnapshot(req.params.userId));
  });

  // MCP gateway info
  app.get("/mcp/info", (_req, res) => {
    res.json({
      name: "nodebench-mcp-gateway",
      version: "1.0.0",
      protocol: "MCP over WebSocket (JSON-RPC 2.0)",
      tools: gateway.getToolCount(),
      connections: gateway.getSessionCount(),
      endpoint: "wss://api.nodebenchai.com/mcp",
      auth: "Bearer nb_key_... (in Authorization header or ?token= query param)",
      docs: "https://docs.nodebenchai.com/mcp-gateway",
    });
  });

  // Dev-only: generate a temporary API key (disable in production)
  if (process.env.NODE_ENV !== "production") {
    app.post("/mcp/dev/generate-key", (req, res) => {
      const userId = (req.body as { userId?: string })?.userId ?? "dev-user";
      const { rawKey, keyHash, keyHashPrefix } = generateApiKey();
      const store = getMemoryStore();
      const record: ApiKeyRecord = {
        keyHash,
        keyHashPrefix,
        userId,
        permissions: ["tools:read", "tools:execute"],
        rateLimits: { perMinute: 100, perDay: 10_000 },
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        revokedAt: null,
      };
      store.set(keyHashPrefix, record);
      res.json({
        key: rawKey,
        message: "Store this key securely — it will not be shown again.",
        usage: `claude mcp add nodebench --transport websocket ws://localhost:${PORT}/mcp --header "Authorization: Bearer ${rawKey}"`,
      });
    });

    app.post("/sync-bridge/dev/pairings", (req, res) => {
      const body = (req.body as {
        userId?: string;
        workspaceId?: string;
        scopes?: Array<"metadata_only" | "receipts_and_traces" | "memory_and_artifacts" | "full_account_sync">;
        ttlMs?: number;
      }) ?? {};
      res.json(syncBridge.createPairingGrant({
        userId: body.userId ?? "dev-user",
        workspaceId: body.workspaceId,
        scopes: body.scopes ?? ["metadata_only"],
        ttlMs: body.ttlMs,
      }));
    });
    app.post("/api/sync-bridge/dev/pairings", (req, res) => {
      const body = (req.body as {
        userId?: string;
        workspaceId?: string;
        scopes?: Array<"metadata_only" | "receipts_and_traces" | "memory_and_artifacts" | "full_account_sync">;
        ttlMs?: number;
      }) ?? {};
      res.json(syncBridge.createPairingGrant({
        userId: body.userId ?? "dev-user",
        workspaceId: body.workspaceId,
        scopes: body.scopes ?? ["metadata_only"],
        ttlMs: body.ttlMs,
      }));
    });
  }

  // ── Voice session routes ───────────────────────────────────────────

  app.use("/voice", createSessionRouter());
  // Realtime Adapter contract endpoints (POST /voice/capture, /voice/link).
  // Provider-agnostic; mounted alongside the Gemini Live session router.
  // See: docs/architecture/REALTIME_VOICE_INTEGRATION.md
  app.use("/voice", createVoiceCaptureRouter());

  // ── TTS proxy (ElevenLabs) ────────────────────────────────────────

  app.use("/tts", createTtsRouter());

  // ── Search API (NodeBench AI App live intelligence dispatch) ─────────

  app.use("/search", createSearchRouter(tools));
  app.use("/api/search", createSearchRouter(tools));
  app.use("/pipeline", createPipelineRouter());
  app.use("/api/pipeline", createPipelineRouter());
  app.use("/shared-context", createSharedContextRouter());
  app.use("/api/shared-context", createSharedContextRouter());
  app.use(createToolGraphRouter());

  // ── Agent Harness Runtime ─────────────────────────────────────────
  app.use("/harness", createHarnessRouter(tools));
  app.use("/api/harness", createHarnessRouter(tools));
  app.use("/subconscious", createSubconsciousRouter());
  app.use("/api/subconscious", createSubconsciousRouter());
  app.use("/hyperloop", createHyperloopRouter());
  app.use("/api/hyperloop", createHyperloopRouter());

  // ── Delta routes (share, watchlist, retention bridge) ──────────────
  app.use("/share", createShareRouter());
  app.use("/api/share", createShareRouter());
  app.use("/watchlist", createWatchlistRouter());
  app.use("/api/watchlist", createWatchlistRouter());
  app.use("/retention", createRetentionBridgeRouter());
  app.use("/api/retention", createRetentionBridgeRouter());
  app.use("/improvements", createImprovementRouter());
  app.use("/api/improvements", createImprovementRouter());
  app.use("/search", createStreamingSearchRouter());
  app.use("/api/search", createStreamingSearchRouter());
  app.use("/product", createProductRouter());
  app.use("/api/product", createProductRouter());
  app.use("/workspace", createWorkspaceSyncRouter());
  app.use("/api/workspace", createWorkspaceSyncRouter());
  app.use("/execute", createExecuteRouter());
  app.use("/api/execute", createExecuteRouter());

  // ── Create HTTP server & wire WebSocket upgrade ─────────────────────

  const httpServer = createServer(app);

  // ── NemoClaw — local autonomous agent (desktop control from phone) ──

  const workspacePath = process.cwd();
  // mountNemoClaw adds: GET /nemoclaw (chat UI), /nemoclaw/* API, WS /nemoclaw/ws
  mountNemoClaw(app, httpServer, workspacePath);

  // Attach command bridge to server (initializes internal WSS)
  commandBridge.attachToServer(httpServer, "/bridge");
  syncBridge.attachToServer(httpServer, "/sync-bridge");

  // ── Create Provider Bus (ambient intelligence event bus) ────────────

  const { bus: providerBus, handleUpgrade: handleBusUpgrade } = mountProviderBus(
    app,
    httpServer,
    {
      maxConnections: 100,
      heartbeatIntervalMs: 30_000,
      idleTimeoutMs: 30 * 60 * 1000,
      // In production, wire keyLookup to Convex (same as gateway)
    },
  );

  // Log bus events server-side
  providerBus.on("provider:connected", (providerId: string, userId: string) => {
    console.log(`[provider-bus] Provider connected: ${providerId} (user=${userId})`);
  });
  providerBus.on("provider:registered", (providerId: string, reg: { providerName: string; providerType: string }) => {
    console.log(`[provider-bus] Provider registered: ${reg.providerName} (${reg.providerType}) — ${providerId}`);
  });
  providerBus.on("provider:disconnected", (providerId: string, code: number, reason: string) => {
    console.log(`[provider-bus] Provider disconnected: ${providerId} — code=${code}, reason=${reason}`);
  });

  httpServer.on("upgrade", (req, socket, head) => {
    const pathname = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    ).pathname;

    if (pathname === "/mcp") {
      gateway.handleUpgrade(req, socket, head);
    } else if (pathname === "/bridge") {
      commandBridge.handleUpgrade(req, socket, head);
    } else if (pathname === "/sync-bridge") {
      syncBridge.handleUpgrade(req, socket, head);
    } else if (pathname === "/bus") {
      handleBusUpgrade(req, socket, head);
    } else if (pathname === "/nemoclaw/ws") {
      // NemoClaw WebSocket is handled by its own WSS (mounted via mountNemoClaw)
      // Let it pass through — the WSS attached to httpServer handles it
    } else {
      // Reject unknown upgrade requests
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
    }
  });

  // ── Start server ────────────────────────────────────────────────────

  httpServer.listen(PORT, () => {
    console.log(`[nodebench-server] Listening on port ${PORT}`);
    console.log(`[nodebench-server] MCP Gateway WebSocket: ws://localhost:${PORT}/mcp`);
    console.log(`[nodebench-server] Health: http://localhost:${PORT}/mcp/health`);
    console.log(`[nodebench-server] Command Bridge WebSocket: ws://localhost:${PORT}/bridge`);
    console.log(`[nodebench-server] Bridge Health: http://localhost:${PORT}/bridge/health`);
    console.log(`[nodebench-server] Sync Bridge WebSocket: ws://localhost:${PORT}/sync-bridge`);
    console.log(`[nodebench-server] Sync Bridge Health: http://localhost:${PORT}/sync-bridge/health`);
    console.log(`[nodebench-server] Voice API: http://localhost:${PORT}/voice/session`);
    console.log(`[nodebench-server] NemoClaw Chat: http://localhost:${PORT}/nemoclaw`);
    console.log(`[nodebench-server] NemoClaw WS: ws://localhost:${PORT}/nemoclaw/ws`);
    console.log(`[nodebench-server] Provider Bus WebSocket: ws://localhost:${PORT}/bus`);
    console.log(`[nodebench-server] Provider Bus Health: http://localhost:${PORT}/bus/health`);
    console.log(`[nodebench-server] Agent Harness: http://localhost:${PORT}/api/harness/health`);
    console.log(`[nodebench-server] Tools available: ${gateway.getToolCount()}`);
    if (process.env.NODE_ENV !== "production") {
      console.log(`[nodebench-server] Dev key gen: POST http://localhost:${PORT}/mcp/dev/generate-key`);
    }
  });

  // ── Graceful shutdown ───────────────────────────────────────────────

  const shutdown = () => {
    console.log("\n[nodebench-server] Shutting down...");
    providerBus.shutdown();
    commandBridge.shutdown();
    syncBridge.shutdown();
    httpServer.close(() => {
      console.log("[nodebench-server] HTTP server closed");
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[nodebench-server] Fatal error:", err);
  process.exit(1);
});
