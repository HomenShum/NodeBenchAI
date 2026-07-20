/**
 * harness.ts — REST API for the NodeBench Agent Harness Runtime
 *
 * Endpoints:
 *   POST   /sessions                — Create a new harness session
 *   GET    /sessions                — List active sessions
 *   GET    /sessions/:id            — Get session detail
 *   POST   /sessions/:id/run        — Execute a query in the session (multi-turn)
 *   POST   /sessions/:id/stream     — Execute with SSE streaming
 *   GET    /sessions/:id/trace      — Get execution trace
 *   GET    /sessions/:id/cost       — Get cost breakdown
 *   POST   /sessions/:id/compact    — Compact session context
 *   POST   /sessions/:id/command    — Execute a slash command
 *   DELETE /sessions/:id            — End session
 *   GET    /health                  — Harness health
 *   GET    /commands                — List available slash commands
 */

import { Router, type Request, type Response } from "express";
import { HarnessRuntime, type TraceEvent } from "../harnessRuntime.js";
import { getPricingSnapshot, getPricingSummary } from "../pricingScraper.js";
import type { McpTool } from "../../packages/mcp-local/src/types.js";

export function createHarnessRouter(tools: McpTool[]): Router {
  const router = Router();
  const runtime = new HarnessRuntime(tools);

  // ── Health ────────────────────────────────────────────────────

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, ...runtime.getHealth() });
  });

  // ── Commands ──────────────────────────────────────────────────

  router.get("/commands", (_req: Request, res: Response) => {
    res.json({ ok: true, commands: runtime.getSlashCommands() });
  });

  // ── Pricing (live scraped from all providers) ─────────────────

  router.get("/pricing", async (_req: Request, res: Response) => {
    try {
      const snapshot = await getPricingSnapshot();
      res.json({ ok: true, ...snapshot });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.get("/pricing/summary", async (_req: Request, res: Response) => {
    try {
      const snapshot = await getPricingSnapshot();
      res.json({ ok: true, ...getPricingSummary(snapshot) });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ── Create Session ────────────────────────────────────────────

  router.post("/sessions", (req: Request, res: Response) => {
    const { preset, lens, permissionPolicy, entityContext } = req.body as {
      preset?: string;
      lens?: string;
      permissionPolicy?: { default?: string; toolOverrides?: Record<string, string> };
      entityContext?: Record<string, unknown>;
    };

    const session = runtime.createSession({
      preset,
      lens,
      permissionPolicy: permissionPolicy as any,
      entityContext,
    });

    res.status(201).json({
      ok: true,
      sessionId: session.id,
      preset: session.preset,
      lens: session.lens,
      status: session.status,
      messageCount: session.messages.length,
      createdAt: session.createdAt,
    });
  });

  // ── List Sessions ─────────────────────────────────────────────

  router.get("/sessions", (_req: Request, res: Response) => {
    res.json({ ok: true, sessions: runtime.listSessions() });
  });

  // ── Session Detail ────────────────────────────────────────────

  router.get("/sessions/:id", (req: Request, res: Response) => {
    const session = runtime.getSession(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: "Session not found" });

    res.json({
      ok: true,
      id: session.id,
      preset: session.preset,
      lens: session.lens,
      status: session.status,
      turnCount: session.turns.length,
      messageCount: session.messages.length,
      totalCostUsd: session.totalCostUsd,
      adaptationCount: session.adaptationCount,
      pendingSteeringCount: session.pendingSteering.length,
      compactions: session.compactions.length,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      turns: session.turns.map(t => ({
        index: t.index,
        query: t.query,
        classification: t.classification,
        entities: t.entities,
        planSteps: t.plan?.steps.length ?? 0,
        successfulSteps: t.stepResults.filter(s => s.success).length,
        failedSteps: t.stepResults.filter(s => !s.success).length,
        durationMs: t.durationMs,
        costUsd: t.costUsd,
        adaptations: t.adaptations,
      })),
    });
  });

  // ── Run Query (non-streaming) ─────────────────────────────────

  router.post("/sessions/:id/run", async (req: Request, res: Response) => {
    const { query, maxAdaptations, timeoutMs } = req.body as {
      query?: string;
      maxAdaptations?: number;
      timeoutMs?: number;
    };

    if (!query?.trim()) {
      return res.status(400).json({ ok: false, error: "query is required" });
    }

    // Handle slash commands
    if (query.startsWith("/")) {
      const cmdResult = await runtime.handleSlashCommand(req.params.id, query);
      return res.json({ ok: true, type: "command", ...cmdResult });
    }

    try {
      const result = await runtime.run(req.params.id, query.trim(), {
        maxAdaptations,
        timeoutMs,
      });

      res.json({ ok: true, ...result });
    } catch (err: any) {
      const status = err.message?.includes("not found") ? 404 : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  // ── Run Query (SSE streaming) ─────────────────────────────────

  router.post("/sessions/:id/stream", async (req: Request, res: Response) => {
    const { query, maxAdaptations, timeoutMs } = req.body as {
      query?: string;
      maxAdaptations?: number;
      timeoutMs?: number;
    };

    if (!query?.trim()) {
      return res.status(400).json({ ok: false, error: "query is required" });
    }

    // SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send("start", { sessionId: req.params.id, query });

    try {
      const result = await runtime.run(req.params.id, query.trim(), {
        maxAdaptations,
        timeoutMs,
        onPlan: (plan) => {
          send("plan", { sessionId: req.params.id, plan });
        },
        onTrace: (event: TraceEvent) => {
          if (event.type === "step_start") send("step_start", event);
          if (event.type === "step_done") send("step_done", event);
          send("trace", event);
        },
      });

      send("result", result);
      send("complete", {
        sessionId: result.sessionId,
        turnIndex: result.turnIndex,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
        classification: result.classification,
      });
    } catch (err: any) {
      send("error", { error: err.message });
    }

    res.end();
  });

  // ── Session Debug (raw step results) ───────────────────────────

  router.get("/sessions/:id/debug", (req: Request, res: Response) => {
    const session = runtime.getSession(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: "Session not found" });

    const lastTurn = session.turns[session.turns.length - 1];
    if (!lastTurn) return res.json({ ok: true, message: "No turns yet" });

    res.json({
      ok: true,
      turnIndex: lastTurn.index,
      classification: lastTurn.classification,
      entities: lastTurn.entities,
      planSteps: lastTurn.plan?.steps.map(s => ({ id: s.id, tool: s.toolName, purpose: s.purpose })),
      stepResults: lastTurn.stepResults.map(sr => ({
        tool: sr.toolName,
        success: sr.success,
        durationMs: sr.durationMs,
        error: sr.error,
        resultType: typeof sr.result,
        resultKeys: sr.result && typeof sr.result === "object" ? Object.keys(sr.result as Record<string, unknown>).slice(0, 20) : undefined,
        resultPreview: JSON.stringify(sr.result).slice(0, 500),
      })),
    });
  });

  // ── Session Trace ─────────────────────────────────────────────

  router.get("/sessions/:id/trace", (req: Request, res: Response) => {
    const trace = runtime.getSessionTrace(req.params.id);
    if (!trace) return res.status(404).json({ ok: false, error: "Session not found" });
    res.json({ ok: true, events: trace });
  });

  // ── Session Cost ──────────────────────────────────────────────

  router.get("/sessions/:id/cost", (req: Request, res: Response) => {
    const cost = runtime.getSessionCost(req.params.id);
    if (!cost) return res.status(404).json({ ok: false, error: "Session not found" });
    res.json({ ok: true, ...cost });
  });

  router.post("/sessions/:id/steering", (req: Request, res: Response) => {
    const { input, source } = req.body as {
      input?: Record<string, unknown> | string;
      source?: string;
    };

    if (
      input == null
      || (typeof input !== "string" && (typeof input !== "object" || Array.isArray(input)))
    ) {
      return res.status(400).json({ ok: false, error: "input must be a string or object" });
    }

    const queued = runtime.queueSteering(req.params.id, input, source);
    if (!queued) return res.status(404).json({ ok: false, error: "Session not found" });

    return res.status(202).json({
      ok: true,
      queued,
      pendingSteeringCount: runtime.getPendingSteeringCount(req.params.id) ?? 0,
    });
  });

  // ── Compact Session ───────────────────────────────────────────

  router.post("/sessions/:id/compact", (req: Request, res: Response) => {
    const summary = runtime.compactSession(req.params.id);
    if (!summary) return res.status(404).json({ ok: false, error: "Session not found" });
    res.json({ ok: true, ...summary });
  });

  // ── Slash Command ─────────────────────────────────────────────

  router.post("/sessions/:id/command", async (req: Request, res: Response) => {
    const { command } = req.body as { command?: string };
    if (!command) return res.status(400).json({ ok: false, error: "command is required" });

    const result = await runtime.handleSlashCommand(req.params.id, command);
    res.json({ ok: true, ...result });
  });

  // ── End Session ───────────────────────────────────────────────

  router.delete("/sessions/:id", (req: Request, res: Response) => {
    const deleted = runtime.endSession(req.params.id);
    if (!deleted) return res.status(404).json({ ok: false, error: "Session not found" });
    res.json({ ok: true, deleted: true });
  });

  return router;
}
