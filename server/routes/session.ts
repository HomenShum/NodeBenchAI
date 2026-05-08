/**
 * Voice session routes — Gemini 3.1 Flash Live API
 *
 * Generates ephemeral tokens for client-side WebSocket connections
 * to Gemini Live API. The browser connects directly to Gemini —
 * no server-side WebRTC proxy needed.
 *
 * Flow:
 *   1. Client calls POST /voice/session
 *   2. Server generates ephemeral token using GEMINI_API_KEY
 *   3. Client opens WebSocket to Gemini with ephemeral token
 *   4. All audio streams directly between browser and Gemini
 */

import { Router } from "express";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { getGeminiVoiceTools, executeVoiceTool } from "../agents/voiceAgent.js";
import {
  DEFAULT_VOICE_DAILY_CAP_USD,
  buildVoiceFollowUps,
  extractVoiceEntities,
  getUtcDay,
  redactPII,
  selectVoiceModelTier,
  type RedactedSpan,
  type VoiceRoutingDecision,
} from "../agents/realtimeVoicePolicy.js";

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
const sessions = new Map<string, { userId: string; createdAt: number; model: string; tier?: string }>();
const memoryCostLedger = new Map<string, { totalUsd: number; updatedAt: number }>();
const memoryCaptures = new Map<string, RealtimeVoiceCaptureResult>();

type RealtimeVoiceCaptureResult = {
  ok: boolean;
  captureId: string;
  auditId?: string;
  idempotent: boolean;
  persisted: boolean;
  gate: string;
  transcript: string;
  translatedTranscript?: string;
  redactedSpans: RedactedSpan[];
  entities: Array<{ label: string; type: "person" | "company" | "topic"; confidence: number }>;
  followUps: string[];
  confidence: "needs_review";
  provenance: "voice";
  inboxRequired: boolean;
  asyncHandoff?: {
    queued: boolean;
    kind: "deep_research" | "source_refresh";
    status: "queued";
  };
};

let _convex: ConvexHttpClient | null = null;
function getConvex(): ConvexHttpClient | null {
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (!convexUrl) return null;
  if (!_convex) _convex = new ConvexHttpClient(convexUrl);
  return _convex;
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
      const {
        userId,
        model = GEMINI_MODEL,
        systemInstruction,
        anonymousSessionId,
        requestedTier,
        surface,
        agentMode,
        translationMode,
        transcriptionOnly,
        deepWork,
        networkQuality,
        debugCostSoFarUsd,
      } = req.body as {
        userId?: string;
        model?: string;
        systemInstruction?: string;
        anonymousSessionId?: string;
        requestedTier?: string;
        surface?: string;
        agentMode?: boolean;
        translationMode?: boolean;
        transcriptionOnly?: boolean;
        deepWork?: boolean;
        networkQuality?: "good" | "poor" | "offline";
        debugCostSoFarUsd?: number;
      };

      const userKey = userId || (anonymousSessionId ? `anon:${anonymousSessionId}` : "anonymous");
      const capUsd = Number(process.env.VOICE_DAILY_CAP_USD ?? DEFAULT_VOICE_DAILY_CAP_USD);
      const ledgerKey = `${userKey}:${getUtcDay()}`;
      const ledger = memoryCostLedger.get(ledgerKey);
      const dailyCostUsd =
        process.env.NODE_ENV === "production"
          ? ledger?.totalUsd ?? 0
          : typeof debugCostSoFarUsd === "number"
            ? debugCostSoFarUsd
            : ledger?.totalUsd ?? 0;
      const routingDecision = selectVoiceModelTier({
        userKey,
        requestedTier,
        surface,
        agentMode,
        translationMode,
        transcriptionOnly,
        deepWork,
        networkQuality,
        dailyCostUsd,
        dailyCapUsd: capUsd,
      });

      void recordRoutingDecision({
        userKey,
        anonymousSessionId,
        surface,
        requestedTier,
        decision: routingDecision,
      });

      if (routingDecision.capHit || routingDecision.captureOnly) {
        const sessionId = `voice-capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        sessions.set(sessionId, {
          userId: userKey,
          createdAt: Date.now(),
          model: routingDecision.model,
          tier: routingDecision.tier,
        });
        return res.json({
          ok: true,
          sessionId,
          provider: routingDecision.provider,
          tier: routingDecision.tier,
          model: routingDecision.model,
          captureOnly: true,
          capHit: routingDecision.capHit,
          banner: routingDecision.banner,
          routingDecision,
          config: {
            mode: "capture-only",
            reason: routingDecision.reason,
          },
        });
      }

      if (routingDecision.provider === "openai") {
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
          return res.status(503).json({
            ok: false,
            error: "OPENAI_API_KEY not configured",
            fallback: "gemini-or-browser",
            routingDecision,
          });
        }

        const sessionId = `openai-realtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const sessionConfig = {
          session: {
            type: "realtime",
            model: routingDecision.model,
            audio: {
              output: {
                voice: "marin",
              },
            },
            instructions:
              systemInstruction ??
              [
                "You are NodeBench, the realtime interaction layer for an entity intelligence workspace.",
                "Use voice for fast capture and interaction. Do not perform deep research in realtime.",
                "When work requires sources, durable reports, exports, or batch analysis, acknowledge it and queue the async NodeBench pipeline.",
                "Before high-impact writes, ask for confirmation.",
              ].join(" "),
          },
        };

        const tokenRes = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(sessionConfig),
          signal: AbortSignal.timeout(10000),
        });

        if (!tokenRes.ok) {
          const detail = await tokenRes.text().catch(() => "");
          return res.status(502).json({
            ok: false,
            error: "OpenAI realtime client secret creation failed",
            status: tokenRes.status,
            detail: detail.slice(0, 500),
            routingDecision,
          });
        }

        const tokenData = (await tokenRes.json()) as {
          value?: string;
          client_secret?: { value?: string };
          [key: string]: unknown;
        };
        const clientSecret = tokenData.value ?? tokenData.client_secret?.value;
        sessions.set(sessionId, {
          userId: userKey,
          createdAt: Date.now(),
          model: routingDecision.model,
          tier: routingDecision.tier,
        });

        return res.json({
          ok: true,
          sessionId,
          provider: "openai",
          transport: "webrtc",
          tier: routingDecision.tier,
          model: routingDecision.model,
          captureOnly: false,
          capHit: false,
          routingDecision,
          clientSecret,
          clientSecretResponse: tokenData,
          callsUrl: "https://api.openai.com/v1/realtime/calls",
          config: sessionConfig.session,
        });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "GEMINI_API_KEY not configured",
          fallback: "browser",
          ok: false,
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
      sessions.set(sessionId, { userId: userKey, createdAt: Date.now(), model, tier: routingDecision.tier });

      res.json({
        ok: true,
        sessionId,
        wsUrl,
        token: token ?? undefined,
        apiKey: token ? undefined : apiKey, // Only send raw key if no ephemeral token
        model,
        provider: routingDecision.provider,
        tier: routingDecision.tier,
        captureOnly: false,
        capHit: false,
        routingDecision,
        config,
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
   * POST /voice/capture
   *
   * Turns a finalized realtime transcript into a durable NodeBench voice
   * capture contract. This endpoint is intentionally provider-agnostic:
   * Gemini Live, OpenAI Realtime, browser speech, or uploaded audio all land
   * here after transcript finalization.
   */
  router.post("/capture", async (req, res) => {
    try {
      const {
        userId,
        anonymousSessionId,
        sessionId,
        transcript,
        translatedTranscript,
        sourceLanguage,
        targetLanguage,
        surface,
        contextLabel,
        idempotencyKey,
        persistPrivateMemory,
        audioQuality,
        deepWork,
      } = req.body as {
        userId?: string;
        anonymousSessionId?: string;
        sessionId?: string;
        transcript?: string;
        translatedTranscript?: string;
        sourceLanguage?: string;
        targetLanguage?: string;
        surface?: string;
        contextLabel?: string;
        idempotencyKey?: string;
        persistPrivateMemory?: boolean;
        audioQuality?: "clean" | "noisy" | "partial";
        deepWork?: boolean;
      };

      const rawTranscript = String(transcript ?? "").trim();
      if (!rawTranscript) {
        return res.status(400).json({ ok: false, error: "transcript is required" });
      }

      const userKey = userId || (anonymousSessionId ? `anon:${anonymousSessionId}` : "anonymous");
      const redacted = redactPII(rawTranscript);
      const translatedRedacted = translatedTranscript ? redactPII(translatedTranscript) : null;
      const entities = extractVoiceEntities(`${redacted.text} ${translatedRedacted?.text ?? ""}`);
      const followUps = buildVoiceFollowUps(redacted.text, entities);
      const gate = userId && persistPrivateMemory
        ? "persisted_voice_capture"
        : "anonymous_no_private_memory";
      const inboxRequired =
        audioQuality === "noisy" ||
        audioQuality === "partial" ||
        redacted.spans.length > 0 ||
        entities.some((entity) => entity.confidence < 0.72);
      const asyncHandoff =
        deepWork || /\b(deep research|diligence|source refresh|refresh sources)\b/i.test(rawTranscript)
          ? { queued: true, kind: "deep_research" as const, status: "queued" as const }
          : undefined;

      const fallbackCaptureId = idempotencyKey
        ? `voicecap_${hashStable(`${userKey}:${idempotencyKey}`)}`
        : `voicecap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      if (idempotencyKey && memoryCaptures.has(`${userKey}:${idempotencyKey}`)) {
        const existing = memoryCaptures.get(`${userKey}:${idempotencyKey}`)!;
        return res.json({ ...existing, idempotent: true });
      }

      let result: RealtimeVoiceCaptureResult = {
        ok: true,
        captureId: fallbackCaptureId,
        idempotent: false,
        persisted: false,
        gate,
        transcript: redacted.text,
        translatedTranscript: translatedRedacted?.text,
        redactedSpans: [...redacted.spans, ...(translatedRedacted?.spans ?? [])],
        entities,
        followUps,
        confidence: "needs_review",
        provenance: "voice",
        inboxRequired,
        asyncHandoff,
      };

      const convex = getConvex();
      if (convex) {
        try {
          const convexResult = await convex.mutation(
            (api as any).domains.integrations.voice.realtimeGateway.ingestRealtimeVoiceCapture,
            {
              userKey,
              userId: userId || undefined,
              anonymousSessionId,
              sessionId,
              transcript: redacted.text,
              originalTranscript: rawTranscript,
              translatedTranscript: translatedRedacted?.text,
              sourceLanguage,
              targetLanguage,
              surface,
              contextLabel,
              idempotencyKey,
              gate,
              redactedSpans: result.redactedSpans,
              entities,
              followUps,
              inboxRequired,
              asyncHandoff,
              metadata: {
                audioQuality,
                persistPrivateMemory: Boolean(persistPrivateMemory),
              },
            },
          ) as { captureId?: string; auditId?: string; idempotent?: boolean };
          result = {
            ...result,
            captureId: convexResult.captureId ?? result.captureId,
            auditId: convexResult.auditId,
            idempotent: Boolean(convexResult.idempotent),
            persisted: true,
          };
        } catch (error) {
          if (process.env.NODE_ENV === "production") {
            throw error;
          }
          result = {
            ...result,
            persisted: false,
            gate: `${gate}:dev_memory_fallback`,
          };
        }
      }

      if (idempotencyKey) memoryCaptures.set(`${userKey}:${idempotencyKey}`, result);

      res.json(result);
    } catch (error) {
      console.error("[POST /voice/capture] Error:", error);
      res.status(500).json({
        ok: false,
        error: "Failed to ingest voice capture",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /voice/link
   *
   * Links anonymous realtime captures to a durable user key after signup.
   * This is the explicit consent boundary for first-run voice users.
   */
  router.post("/link", async (req, res) => {
    try {
      const { anonymousSessionId, userId } = req.body as {
        anonymousSessionId?: string;
        userId?: string;
      };
      if (!anonymousSessionId || !userId) {
        return res.status(400).json({
          ok: false,
          error: "anonymousSessionId and userId are required",
        });
      }

      const convex = getConvex();
      if (!convex) {
        return res.json({
          ok: true,
          linked: 0,
          persisted: false,
          gate: "dev_no_convex_link_ack",
        });
      }

      try {
        const result = await convex.mutation(
          (api as any).domains.integrations.voice.realtimeGateway.linkAnonymousVoiceCaptures,
          {
            anonymousSessionId,
            userKey: userId,
          },
        ) as { linked: number };

        return res.json({
          ok: true,
          persisted: true,
          gate: "linked_after_signup",
          ...result,
        });
      } catch (error) {
        if (process.env.NODE_ENV === "production") throw error;
        return res.json({
          ok: true,
          linked: countMemoryCapturesForUser(`anon:${anonymousSessionId}`),
          persisted: false,
          gate: "dev_convex_link_fallback",
          message: error instanceof Error ? error.message : "Convex link failed in dev",
        });
      }
    } catch (error) {
      console.error("[POST /voice/link] Error:", error);
      res.status(500).json({
        ok: false,
        error: "Failed to link anonymous voice captures",
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
      status: hasKey ? "ok" : "unconfigured",
      provider: "gemini-live",
      model: GEMINI_MODEL,
      realtimeGateway: "ready",
      configured: {
        gemini: hasKey,
        convex: Boolean(process.env.CONVEX_URL || process.env.VITE_CONVEX_URL),
      },
      tiers: [
        "gemini-flash-live",
        "openai-whisper",
        "openai-realtime-mini",
        "openai-realtime-2",
        "openai-realtime-translate",
      ],
      capUsd: Number(process.env.VOICE_DAILY_CAP_USD ?? DEFAULT_VOICE_DAILY_CAP_USD),
      activeSessions: sessions.size,
      maxSessions: MAX_SESSIONS,
    });
  });

  return router;
}

async function recordRoutingDecision(input: {
  userKey: string;
  anonymousSessionId?: string;
  surface?: string;
  requestedTier?: string;
  decision: VoiceRoutingDecision;
}): Promise<void> {
  const convex = getConvex();
  if (!convex) return;
  try {
    await convex.mutation(
      (api as any).domains.integrations.voice.realtimeGateway.recordVoiceRoutingDecision,
      {
        userKey: input.userKey,
        anonymousSessionId: input.anonymousSessionId,
        surface: input.surface,
        requestedTier: input.requestedTier,
        decision: input.decision,
      },
    );
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
  }
}

function hashStable(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function countMemoryCapturesForUser(userKey: string): number {
  let count = 0;
  for (const key of memoryCaptures.keys()) {
    if (key.startsWith(`${userKey}:`)) count += 1;
  }
  return count;
}
