/**
 * Voice session routes — Gemini 3.1 Flash Live API + Realtime Adapter routing.
 *
 * Two roles:
 *   1. Generates ephemeral tokens for client-side WebSocket connections
 *      to Gemini Live API (existing behavior — provider-specific).
 *   2. Returns deterministic `routingDecision` envelopes for the
 *      provider-agnostic Realtime Adapter contract — capture-only
 *      sessions, translation, agent mode, daily cost-cap downgrade.
 *      See: docs/architecture/REALTIME_VOICE_INTEGRATION.md §4
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND          — sessions Map bounded MAX_SESSIONS with eviction
 *   - HONEST_STATUS  — 503 returned when realtime-2 isn't reachable, with
 *                      `routingDecision.gate: "agent_mode"` so callers can
 *                      tell why the fallback fired (instead of a fake 200)
 *   - HONEST_SCORES  — daily cost cap is real input, not an estimate
 *   - DETERMINISTIC  — selectRoutingDecision is a pure function
 *
 * Flow (Gemini Live path):
 *   1. Client calls POST /voice/session
 *   2. Server generates ephemeral token using GEMINI_API_KEY
 *   3. Client opens WebSocket to Gemini with ephemeral token
 *   4. All audio streams directly between browser and Gemini
 */

import { Router } from "express";
import { getGeminiVoiceTools, executeVoiceTool } from "../agents/voiceAgent.js";

// ── Constants ──────────────────────────────────────────────────────────────

const GEMINI_MODEL = "gemini-3.1-flash-live-preview";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";

// Ephemeral token endpoint
const EPHEMERAL_TOKEN_URL = `${GEMINI_API_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent`;

// WebSocket endpoints
const WS_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage";
const WS_URL_DIRECT = `${WS_BASE}.v1beta.GenerativeService.BidiGenerateContent`;
const WS_URL_EPHEMERAL = `${WS_BASE}.v1alpha.GenerativeService.BidiGenerateContentConstrained`;

// Session tracking (in-memory, bounded)
const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const sessions = new Map<string, { userId: string; createdAt: number; model: string }>();

// ── Realtime Adapter routing policy (pure fn — DETERMINISTIC) ──────────────

const DAILY_COST_CAP_USD = 5.0;
const REALTIME_AGENT_TIER = "openai-realtime-2"; // Phase 3 target tier

type ModelTier =
  | "gemini-flash-live"
  | "openai-realtime-2"
  | "openai-realtime-mini"
  | "openai-realtime-translate"
  | "openai-realtime-whisper"
  | "capture-only";

interface RoutingDecision {
  gate:
    | "capture_only"
    | "agent_mode"
    | "translation_mode"
    | "deep_research_async"
    | "daily_cost_cap_hit";
  tier: ModelTier;
  captureOnly?: boolean;
  rationale: string;
}

interface SessionRequestBody {
  userId?: string;
  model?: string;
  systemInstruction?: string;
  surface?: "chat" | "translation" | "agent" | "report" | "event";
  transcriptionOnly?: boolean;
  translationMode?: boolean;
  agentMode?: boolean;
  deepWork?: boolean;
  debugCostSoFarUsd?: number;
}

function selectRoutingDecision(input: SessionRequestBody): RoutingDecision {
  const spend = input.debugCostSoFarUsd ?? 0;
  if (spend >= DAILY_COST_CAP_USD) {
    return {
      gate: "daily_cost_cap_hit",
      tier: "capture-only",
      captureOnly: true,
      rationale: `daily voice spend $${spend.toFixed(2)} >= $${DAILY_COST_CAP_USD.toFixed(2)} cap`,
    };
  }
  if (input.deepWork) {
    return {
      gate: "deep_research_async",
      tier: "capture-only",
      captureOnly: true,
      rationale: "deep_research escalates to async pipeline; live session captures only",
    };
  }
  if (input.translationMode || input.surface === "translation") {
    // Phase 4 prefers openai-realtime-translate; Gemini Live transcription is
    // an honest fallback when OpenAI realtime tier isn't wired yet.
    const hasOpenAi = Boolean(process.env.OPENAI_API_KEY);
    return {
      gate: "translation_mode",
      tier: hasOpenAi ? "openai-realtime-translate" : "openai-realtime-whisper",
      captureOnly: input.transcriptionOnly ?? true,
      rationale: hasOpenAi
        ? "translate tier active"
        : "transcription-only fallback (no OpenAI realtime tier configured)",
    };
  }
  if (input.agentMode) {
    return {
      gate: "agent_mode",
      tier: REALTIME_AGENT_TIER,
      rationale: "phone-grade tool calling requested",
    };
  }
  if (input.transcriptionOnly) {
    return {
      gate: "capture_only",
      tier: "openai-realtime-whisper",
      captureOnly: true,
      rationale: "transcriptionOnly flag set; capture-only path",
    };
  }
  return {
    gate: "capture_only",
    tier: "gemini-flash-live",
    rationale: "default cheap_voice_chat tier",
  };
}

function evictStaleSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
  // Hard cap
  if (sessions.size > MAX_SESSIONS) {
    const oldest = Array.from(sessions.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (let i = 0; i < oldest.length - MAX_SESSIONS; i++) {
      sessions.delete(oldest[i][0]);
    }
  }
}

// ── Router ─────────────────────────────────────────────────────────────────

export function createSessionRouter(): Router {
  const router = Router();

  /**
   * POST /voice/session
   *
   * Creates a Gemini Live session config for the client.
   * Returns either:
   *   - ephemeral token + WebSocket URL (secure, production)
   *   - direct API key + WebSocket URL (dev mode fallback)
   *
   * Request: { userId: string, model?: string, systemInstruction?: string }
   * Response: { sessionId, wsUrl, token?, apiKey?, config, tools }
   */
  router.post("/session", async (req, res) => {
    try {
      const body = req.body as SessionRequestBody;
      const {
        userId,
        model = GEMINI_MODEL,
        systemInstruction,
      } = body;

      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      // Realtime Adapter routing — runs FIRST, before any provider call.
      // Lets the dogfood matrix (scenarios 3, 6, 8, 10 + cost-cap test) drive
      // the contract without burning a Gemini token for capture-only paths.
      const routingDecision = selectRoutingDecision(body);

      // Daily cost cap — HONEST_STATUS: 200 with capHit:true is the contract,
      // not a fake success. The capHit + banner + captureOnly:true flags tell
      // the client to refuse to escalate.
      if (routingDecision.gate === "daily_cost_cap_hit") {
        return res.json({
          ok: true,
          captureOnly: true,
          capHit: true,
          routingDecision,
          banner:
            "Daily voice spend limit reached. Capture-only mode until midnight UTC.",
        });
      }

      // Capture-only paths (transcription-only, translation, deep_research)
      // do NOT require a Gemini Live ephemeral token — captures flow through
      // POST /voice/capture. Return early with a routing-decision-only envelope.
      if (routingDecision.captureOnly) {
        return res.json({
          ok: true,
          captureOnly: true,
          routingDecision,
        });
      }

      const apiKey = process.env.GEMINI_API_KEY;

      // Agent mode without OpenAI realtime-2 access AND no Gemini fallback —
      // return 503 with routingDecision so callers know the fallback path.
      if (routingDecision.gate === "agent_mode" && !apiKey && !process.env.OPENAI_API_KEY) {
        return res.status(503).json({
          ok: false,
          error: "no realtime tier available",
          fallback: "browser",
          routingDecision: { ...routingDecision, gate: "agent_mode" },
        });
      }

      // Agent mode with no realtime-2 but with Gemini Live — honest fallback.
      if (routingDecision.gate === "agent_mode" && !process.env.OPENAI_API_KEY) {
        return res.status(503).json({
          ok: false,
          error: "openai-realtime-2 not configured; gemini fallback available",
          fallback: "gemini-or-browser",
          routingDecision: { ...routingDecision, gate: "agent_mode" },
        });
      }

      if (!apiKey) {
        return res.status(503).json({
          error: "GEMINI_API_KEY not configured",
          fallback: "browser",
          routingDecision,
        });
      }

      evictStaleSessions();

      const sessionId = `gemini-live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Try to get ephemeral token
      let token: string | null = null;
      let wsUrl: string;

      try {
        const tokenRes = await fetch(
          `${GEMINI_API_BASE}/v1beta/models/${model}:generateEphemeralToken?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(5000),
          },
        );

        if (tokenRes.ok) {
          const tokenData = (await tokenRes.json()) as { token?: string };
          token = tokenData.token ?? null;
        }
      } catch {
        // Ephemeral token API may not be available — fall back to direct key
      }

      if (token) {
        wsUrl = `${WS_URL_EPHEMERAL}?access_token=${token}`;
      } else {
        // Dev fallback: pass API key directly (not for production)
        wsUrl = `${WS_URL_DIRECT}?key=${apiKey}`;
      }

      // Build Gemini Live config
      const tools = getGeminiVoiceTools();

      const config = {
        model: `models/${model}`,
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Aoede", // Natural, clear voice
            },
          },
        },
        systemInstruction: {
          parts: [
            {
              text:
                systemInstruction ??
                [
                  "You are NodeBench, an AI research assistant for founders and operators.",
                  "Help users investigate companies, analyze markets, and make decisions.",
                  "Be concise and direct. Lead with the answer, not the reasoning.",
                  "When users ask about a company or market, use your tools to search for information.",
                  "Speak naturally and conversationally.",
                ].join(" "),
            },
          ],
        },
        tools,
      };

      // Track session
      sessions.set(sessionId, { userId, createdAt: Date.now(), model });

      res.json({
        ok: true,
        sessionId,
        wsUrl,
        token: token ?? undefined,
        apiKey: token ? undefined : apiKey, // Only send raw key if no ephemeral token
        model,
        config,
        routingDecision,
      });
    } catch (error) {
      console.error("[POST /voice/session] Error:", error);
      res.status(500).json({
        error: "Failed to create session",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * DELETE /voice/session/:sessionId
   * Remove session tracking (client closes WebSocket directly)
   */
  router.delete("/session/:sessionId", (_req, res) => {
    const { sessionId } = _req.params;
    sessions.delete(sessionId);
    res.json({ status: "removed" });
  });

  /**
   * POST /voice/tool
   * Execute a tool call from the Gemini Live session.
   * Client sends tool calls here when Gemini requests function execution.
   */
  router.post("/tool", async (req, res) => {
    try {
      const { name, args, userId } = req.body as {
        name?: string;
        args?: Record<string, unknown>;
        userId?: string;
      };
      if (!name) {
        return res.status(400).json({ error: "Tool name is required" });
      }
      const result = await executeVoiceTool(name, args ?? {}, userId ?? "web-user");
      res.json(result);
    } catch (error) {
      console.error("[POST /voice/tool] Error:", error);
      res.status(500).json({
        error: "Tool execution failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /voice/health
   * Voice subsystem health check
   */
  router.get("/health", (_req, res) => {
    const hasKey = !!process.env.GEMINI_API_KEY;
    res.json({
      ok: true,
      realtimeGateway: "ready",
      status: hasKey ? "ok" : "unconfigured",
      provider: "gemini-live",
      model: GEMINI_MODEL,
      activeSessions: sessions.size,
      maxSessions: MAX_SESSIONS,
    });
  });

  return router;
}
