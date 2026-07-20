/**
 * Server-side ElevenLabs TTS proxy
 *
 * Keeps the ElevenLabs API key server-side (never bundled in client JS).
 * Streams audio bytes back to the client for low-latency playback.
 *
 * POST /tts
 *   Body: { text, voiceId?, model?, stability?, similarityBoost? }
 *   Response: audio/mpeg stream
 *
 * Requires ELEVENLABS_API_KEY env var.
 */

import { Router } from "express";

const API_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const MAX_CHARS = 5000;
const MAX_BODY_SIZE = 8000; // bytes — prevent abuse

const DEFAULTS = {
  model: "eleven_turbo_v2_5",
  stability: 0.5,
  similarityBoost: 0.75,
  voiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel
} as const;

export function createTtsRouter(): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "TTS not configured — ELEVENLABS_API_KEY missing" });
    }

    // ── Validate input ──────────────────────────────────────────────
    const { text, voiceId, model, stability, similarityBoost } = req.body ?? {};

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }

    const trimmed = text.slice(0, MAX_CHARS);
    if (!trimmed.trim()) {
      return res.status(400).json({ error: "text is empty after trimming" });
    }

    // BOUND: reject oversized payloads
    const bodySize = JSON.stringify(req.body).length;
    if (bodySize > MAX_BODY_SIZE) {
      return res.status(413).json({ error: "Request body too large" });
    }

    // ── Proxy to ElevenLabs ─────────────────────────────────────────
    const resolvedVoiceId = (typeof voiceId === "string" && voiceId) || DEFAULTS.voiceId;
    const url = `${API_BASE}/${encodeURIComponent(resolvedVoiceId)}/stream`;

    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text: trimmed,
          model_id: (typeof model === "string" && model) || DEFAULTS.model,
          voice_settings: {
            stability: typeof stability === "number" ? Math.max(0, Math.min(1, stability)) : DEFAULTS.stability,
            similarity_boost: typeof similarityBoost === "number" ? Math.max(0, Math.min(1, similarityBoost)) : DEFAULTS.similarityBoost,
          },
        }),
      });

      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "unknown");
        console.error(`[tts] ElevenLabs ${upstream.status}: ${errText.slice(0, 200)}`);
        return res.status(upstream.status >= 500 ? 502 : upstream.status).json({
          error: "TTS upstream error",
          // Never leak the raw error to client — just status
          status: upstream.status,
        });
      }

      if (!upstream.body) {
        return res.status(502).json({ error: "No stream from upstream" });
      }

      // Stream audio back
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Cache-Control", "no-cache");

      // Pipe the ReadableStream to Express response
      const reader = upstream.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); return; }
          if (!res.write(value)) {
            // Backpressure — wait for drain
            await new Promise<void>((resolve) => res.once("drain", resolve));
          }
        }
      };

      await pump();
    } catch (err) {
      console.error("[tts] Proxy error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "TTS proxy error" });
      } else {
        res.end();
      }
    }
  });

  // Health check
  router.get("/health", (_req, res) => {
    res.json({
      configured: !!process.env.ELEVENLABS_API_KEY,
      model: DEFAULTS.model,
      voiceId: DEFAULTS.voiceId,
    });
  });

  return router;
}
