import cors from "cors";
import express from "express";
import Database from "better-sqlite3";
import type { McpTool } from "../../packages/mcp-local/src/types.js";
import { entityEnrichmentTools } from "../../packages/mcp-local/src/tools/entityEnrichmentTools.js";
import { founderLocalPipelineTools } from "../../packages/mcp-local/src/tools/founderLocalPipeline.js";
import { reconTools } from "../../packages/mcp-local/src/tools/reconTools.js";
import { webTools } from "../../packages/mcp-local/src/tools/webTools.js";
import { llmTools } from "../../packages/mcp-local/src/tools/llmTools.js";
import { monteCarloTools } from "../../packages/mcp-local/src/tools/monteCarloTools.js";
import { initSweepTables, runSweep, computeDelta, getLatestSweep, getPreviousSweep, generateRecommendations } from "../../packages/mcp-local/src/sweep/engine.js";
import { createSearchRouter } from "../routes/search.js";
import { createStreamingSearchRouter } from "../routes/streamingSearch.js";
import { createSharedContextRouter } from "../routes/sharedContext.js";
import { createHarnessRouter } from "../routes/harness.js";
import { createSubconsciousRouter } from "../routes/subconscious.js";
import { createHyperloopRouter } from "../routes/hyperloop.js";
import { createSessionRouter } from "../routes/session.js";
import { SyncBridgeServer } from "../syncBridge.js";

if (!process.env.CONVEX_URL && process.env.VITE_CONVEX_URL) {
  process.env.CONVEX_URL = process.env.VITE_CONVEX_URL;
}

// Keep better-sqlite3 in the traced serverless bundle for shared-context storage.
void Database;

const tools: McpTool[] = [
  ...webTools,
  ...reconTools,
  ...founderLocalPipelineTools,
  ...entityEnrichmentTools,
  ...llmTools,
  ...monteCarloTools,
];
const syncBridge = new SyncBridgeServer();

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(createSearchRouter(tools));
app.use(createStreamingSearchRouter());
app.use("/harness", createHarnessRouter(tools));
app.use("/api/harness", createHarnessRouter(tools));
app.use("/shared-context", createSharedContextRouter());
app.use("/api/shared-context", createSharedContextRouter());
app.use("/subconscious", createSubconsciousRouter());
app.use("/api/subconscious", createSubconsciousRouter());
app.use("/hyperloop", createHyperloopRouter());
app.use("/api/hyperloop", createHyperloopRouter());
app.use("/voice", createSessionRouter());
app.use("/api/voice", createSessionRouter());

// Sweep API — live signal intelligence
try { initSweepTables(); } catch { /* tables init */ }

app.get("/api/sweep/latest", async (_req, res) => {
  try {
    const latest = getLatestSweep();
    if (!latest) return res.json({ success: true, signals: [], message: "No sweep data. Run a sweep first." });
    const previous = getPreviousSweep();
    const delta = computeDelta(latest, previous);
    const recs = generateRecommendations(latest.signals);
    res.json({
      success: true,
      sweepId: latest.sweepId,
      timestamp: latest.timestamp,
      topEntity: delta.topEntity,
      topEntityQuery: delta.topEntityQuery,
      topEntitySeverity: delta.topEntitySeverity,
      signalCount: latest.signals.length,
      newSignals: delta.newSignals.length,
      escalations: delta.escalations.length,
      signals: latest.signals.slice(0, 15),
      recommendations: recs.slice(0, 5),
      sources: latest.sources,
    });
  } catch (err: any) {
    res.json({ success: false, error: err?.message });
  }
});

app.post("/api/sweep/run", async (_req, res) => {
  try {
    const result = await runSweep();
    const previous = getPreviousSweep();
    const delta = computeDelta(result, previous);
    const recs = generateRecommendations(result.signals);
    res.json({
      success: true,
      sweepId: result.sweepId,
      signalCount: result.signals.length,
      topEntity: delta.topEntity,
      topEntityQuery: delta.topEntityQuery,
      sources: result.sources,
      durationMs: result.totalDurationMs,
      recommendations: recs.slice(0, 5),
    });
  } catch (err: any) {
    res.json({ success: false, error: err?.message });
  }
});

// OTel trace receiver — agents send traces here
app.post("/v1/traces", (req, res) => {
  try {
    const { processOtelPayload } = require("../../packages/mcp-local/src/profiler/otelReceiver.js");
    const result = processOtelPayload(req.body);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.json({ success: false, error: err?.message });
  }
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

export default app;
