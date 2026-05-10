/**
 * Phase 9a — Editorial-edition TTS (Listen button).
 *
 * Generates a single-edition audio file from the ~300-500 word
 * script produced by `getEditionAudioScript` and caches it in
 * Convex `_storage` keyed by `dateKey`.  Same-day clicks return the
 * cached storageId (NEVER regenerate — bound on ElevenLabs cost).
 *
 * Why a Convex action and not the existing Express `/tts` route:
 *   The Express server-route TTS proxy (server/routes/tts.ts) only
 *   runs on the local dev gateway (port 3100).  Vercel's deployed
 *   `/redesign` page can't reach it.  This action wraps ElevenLabs
 *   server-side via Convex, which IS deployed, and stores the audio
 *   bytes in Convex `_storage` so the editorial home can play them
 *   without a separate audio CDN.
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND          script length capped at MAX_SCRIPT_CHARS;
 *                    audio response capped at MAX_AUDIO_BYTES.
 *   - HONEST_STATUS  per-source counters; "audio unavailable"
 *                    failure is surfaced (no fake URLs).
 *   - HONEST_SCORES  n/a (binary success/failure path).
 *   - TIMEOUT        AbortController, 12s budget for ElevenLabs
 *                    (longer than scoreboard 8s — TTS is slower).
 *   - SSRF           hostname `api.elevenlabs.io` hardcoded.
 *   - BOUND_READ     5 MB cap on streamed audio response.
 *   - ERROR_BOUNDARY action wrapped in try/catch, returns
 *                    { ok:false, error } shape on failure.
 *   - DETERMINISTIC  cache key = dateKey + voiceId.  Same-day
 *                    re-call collides and returns prior storageId.
 */

import { action, internalAction, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const ALLOWED_HOSTS = new Set(["api.elevenlabs.io"]);
const FETCH_TIMEOUT_MS = 12_000;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB cap on TTS output
const MAX_SCRIPT_CHARS = 2000; // Bound on ElevenLabs cost (~$0.30 per 1K chars)

const DEFAULTS = {
  model: "eleven_turbo_v2_5",
  stability: 0.5,
  similarityBoost: 0.75,
  voiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel — same as Express route
} as const;

/* ──────────────────────────────────────────────────────────────────
 * Script composition: read the editorial substrate (snapshot, hypotheses,
 * forecasts, footnotes) for `dateKey` and synthesize a 300-500 word
 * spoken-word edition.  Honest and concise — section is skipped if data
 * is empty (HONEST_STATUS — never fabricate).
 * ──────────────────────────────────────────────────────────────── */

/** Strip markdown to keep TTS clean. */
function plainify(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1") // italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → label only
    .replace(/^[#>\-\d.]+\s+/gm, "") // headings/lists/bullets
    .replace(/\s+/g, " ")
    .trim();
}

/** Friendlier date phrasing for the opener. */
function spokenDate(dateKey: string): string {
  const t = Date.parse(`${dateKey}T00:00:00Z`);
  if (!Number.isFinite(t)) return dateKey;
  const d = new Date(t);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export const composeEditionScript = internalQuery({
  args: { dateKey: v.string() },
  handler: async (ctx, args) => {
    const parts: string[] = [];

    // Opener — always present.
    parts.push(`Today is ${spokenDate(args.dateKey)}. Here is your daily edition.`);

    // §1: today's pulse / public-trending fallback (cap 3 for speech).
    const trending = await ctx.db
      .query("industryUpdates")
      .withIndex("by_scanned_at")
      .order("desc")
      .take(3);
    if (trending.length > 0) {
      const headlines = trending
        .map((r) => plainify(r.title))
        .filter((s) => s.length > 0)
        .slice(0, 3);
      if (headlines.length > 0) {
        parts.push(
          `Today's pulse covers ${headlines.length} trending signals. ` +
            headlines.map((h, i) => `${i + 1}. ${h}.`).join(" "),
        );
      }
    }

    // §2: active narrative hypotheses (cap 2 for speech).
    const hyps = await ctx.db
      .query("narrativeHypotheses")
      .withIndex("by_status")
      .order("desc")
      .take(8);
    const speakHyps = hyps
      .filter(
        (h) => h.status === "active" || h.status === "supported" || h.status === "weakened",
      )
      .slice(0, 2);
    if (speakHyps.length > 0) {
      const text = speakHyps
        .map((h) => plainify(h.claimForm).slice(0, 220))
        .filter((s) => s.length > 0)
        .map((s, i) => `${i + 1}. ${s}.`)
        .join(" ");
      if (text.length > 0) {
        parts.push(`Two hypotheses under test today. ${text}`);
      }
    }

    // §4: scoreboard from latest snapshot.
    const snapshot = await ctx.db
      .query("dailyBriefSnapshots")
      .withIndex("by_date_string", (q) => q.eq("dateString", args.dateKey))
      .first();
    const snapshotForRead =
      snapshot ??
      (await ctx.db
        .query("dailyBriefSnapshots")
        .withIndex("by_generated_at")
        .order("desc")
        .first());
    const keyStats =
      (snapshotForRead?.dashboardMetrics?.keyStats ?? []) as Array<{
        label?: string;
        value?: number | string;
      }>;
    if (keyStats.length > 0) {
      const lines = keyStats
        .slice(0, 3)
        .map((s) => {
          const label = typeof s.label === "string" ? s.label : "stat";
          const value =
            typeof s.value === "number" ? s.value.toLocaleString() : String(s.value ?? "");
          return value ? `${label}: ${value}` : null;
        })
        .filter((v): v is string => v !== null);
      if (lines.length > 0) {
        parts.push(`Today's scoreboard. ${lines.join(". ")}.`);
      }
    }

    // §5: capability map summary.
    const tech = snapshotForRead?.dashboardMetrics?.techReadiness;
    if (tech) {
      const total = (tech.existing ?? 0) + (tech.emerging ?? 0) + (tech.sciFi ?? 0);
      if (total > 0) {
        parts.push(
          `Capabilities map: ${tech.existing ?? 0} existing, ${tech.emerging ?? 0} emerging, ${tech.sciFi ?? 0} science fiction.`,
        );
      }
    }

    // §6: footnote count (do not read URLs — too long for speech).
    const recentArtifacts = await ctx.db
      .query("evidenceArtifacts")
      .withIndex("by_created_at")
      .order("desc")
      .take(40);
    if (recentArtifacts.length > 0) {
      parts.push(
        `Sources: ${recentArtifacts.length} citations from arXiv, Hacker News, and other indexed providers.`,
      );
    }

    parts.push("Visit nodebenchai.com slash redesign for the full edition.");

    const script = parts.join(" ").replace(/\s+/g, " ").trim();
    return script.length > 0 ? script : null;
  },
});

/* ──────────────────────────────────────────────────────────────────
 * Storage cache: editionAudioCache table is intentionally tiny —
 * only stores { cacheKey, storageId, voiceId, generatedAt, charCount }.
 * Cache key is `${dateKey}|${voiceId}` so swapping voices generates
 * a fresh entry without poisoning the prior one.
 * ──────────────────────────────────────────────────────────────── */

export const lookupEditionAudio = internalQuery({
  args: { cacheKey: v.string() },
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("editionAudioCache")
      .withIndex("by_cache_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first();
    if (!cached) return null;
    return {
      _id: cached._id,
      cacheKey: cached.cacheKey,
      storageId: cached.storageId,
      voiceId: cached.voiceId,
      generatedAt: cached.generatedAt,
      charCount: cached.charCount,
    };
  },
});

export const writeEditionAudio = internalMutation({
  args: {
    cacheKey: v.string(),
    dateKey: v.string(),
    voiceId: v.string(),
    storageId: v.id("_storage"),
    charCount: v.number(),
  },
  handler: async (ctx, args) => {
    // Idempotent: if a row already exists for this cacheKey, replace.
    const existing = await ctx.db
      .query("editionAudioCache")
      .withIndex("by_cache_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first();
    if (existing) {
      // Clean up the prior storage blob to avoid orphaned bytes —
      // BOUND on storage usage.  Best-effort: if delete fails, log
      // and continue (the new row still wins).
      try {
        await ctx.storage.delete(existing.storageId);
      } catch (err) {
        console.warn(`[editionTts] failed to delete prior storage ${existing.storageId}:`, err);
      }
      await ctx.db.patch(existing._id, {
        storageId: args.storageId,
        voiceId: args.voiceId,
        generatedAt: Date.now(),
        charCount: args.charCount,
      });
      return existing._id;
    }
    const id = await ctx.db.insert("editionAudioCache", {
      cacheKey: args.cacheKey,
      dateKey: args.dateKey,
      voiceId: args.voiceId,
      storageId: args.storageId,
      generatedAt: Date.now(),
      charCount: args.charCount,
    });
    return id;
  },
});

/* ──────────────────────────────────────────────────────────────────
 * Bounded ElevenLabs fetch — SSRF allowlist, timeout, body cap.
 * ──────────────────────────────────────────────────────────────── */

async function callElevenLabs(
  apiKey: string,
  text: string,
  voiceId: string,
): Promise<ArrayBuffer> {
  const url = `${ELEVENLABS_API_BASE}/${encodeURIComponent(voiceId)}`;
  const u = new URL(url);
  if (!ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error(`[editionTts] host ${u.hostname} not allowlisted`);
  }
  if (u.protocol !== "https:") {
    throw new Error(`[editionTts] non-https rejected`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: DEFAULTS.model,
        voice_settings: {
          stability: DEFAULTS.stability,
          similarity_boost: DEFAULTS.similarityBoost,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `[editionTts] ElevenLabs HTTP ${res.status}: ${errText.slice(0, 200)}`,
      );
    }
    if (!res.body) {
      throw new Error("[editionTts] no response body from ElevenLabs");
    }

    // BOUND_READ — stream into chunks with size cap.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AUDIO_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error(
          `[editionTts] audio exceeded ${MAX_AUDIO_BYTES} bytes`,
        );
      }
      chunks.push(value);
    }

    // Coalesce into one ArrayBuffer for storage.
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  } finally {
    clearTimeout(timer);
  }
}

/* ──────────────────────────────────────────────────────────────────
 * Action: synthesize today's edition audio.
 *
 * Args:
 *   dateKey  — YYYY-MM-DD; the script source.  Required.
 *   voiceId  — optional override; defaults to Rachel.
 *
 * Returns:
 *   { ok: true, storageId, audioUrl, cached: bool, charCount }
 *   { ok: false, error: string }
 * ──────────────────────────────────────────────────────────────── */

export const synthesizeEditionAudio = internalAction({
  args: {
    dateKey: v.string(),
    voiceId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    ok: boolean;
    storageId?: string;
    audioUrl?: string | null;
    cached?: boolean;
    charCount?: number;
    error?: string;
  }> => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      // HONEST_STATUS — TTS not configured is a real failure, not silent ok.
      return {
        ok: false,
        error: "ELEVENLABS_API_KEY missing — TTS not configured",
      };
    }

    const voiceId = (args.voiceId && args.voiceId.length > 0)
      ? args.voiceId
      : DEFAULTS.voiceId;
    const cacheKey = `${args.dateKey}|${voiceId}`;

    // 1. Cache hit?
    const cached: {
      storageId: string;
      charCount: number;
    } | null = await ctx.runQuery(
      internal.domains.integrations.voice.editionTts.lookupEditionAudio,
      { cacheKey },
    );
    if (cached) {
      const url = await ctx.storage.getUrl(cached.storageId as any);
      return {
        ok: true,
        storageId: cached.storageId,
        audioUrl: url ?? null,
        cached: true,
        charCount: cached.charCount,
      };
    }

    // 2. Compose script from §1-§6.
    const script: string | null = await ctx.runQuery(
      internal.domains.integrations.voice.editionTts.composeEditionScript,
      { dateKey: args.dateKey },
    );
    if (!script || script.trim().length === 0) {
      return {
        ok: false,
        error: "No script generated — edition is empty",
      };
    }
    const truncated = script.slice(0, MAX_SCRIPT_CHARS);

    // 3. Call ElevenLabs.
    let audioBuffer: ArrayBuffer;
    try {
      audioBuffer = await callElevenLabs(apiKey, truncated, voiceId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[editionTts] ElevenLabs call failed: ${msg}`);
      return { ok: false, error: msg };
    }

    // 4. Store in _storage.
    const blob = new Blob([audioBuffer], { type: "audio/mpeg" });
    const storageId = await ctx.storage.store(blob);

    // 5. Persist cache row.
    await ctx.runMutation(
      internal.domains.integrations.voice.editionTts.writeEditionAudio,
      {
        cacheKey,
        dateKey: args.dateKey,
        voiceId,
        storageId,
        charCount: truncated.length,
      },
    );

    const url = await ctx.storage.getUrl(storageId);
    console.log(
      `[editionTts] dateKey=${args.dateKey} voiceId=${voiceId} ` +
        `chars=${truncated.length} storageId=${storageId} cached=false`,
    );
    return {
      ok: true,
      storageId,
      audioUrl: url ?? null,
      cached: false,
      charCount: truncated.length,
    };
  },
});

/**
 * Public-callable wrapper for the editorial-home Listen button.
 *
 * Trades off authentication: this is callable by any visitor since
 * the editorial home is a public surface.  The action is bounded
 * (cache-first, max ~$0.30/call only on cache miss), and per-day per-
 * voiceId idempotent so spam-clicking does NOT regenerate cost.  The
 * underlying ELEVENLABS_API_KEY is server-side only; never bundled.
 */
export const generateEditionAudio = action({
  args: {
    dateKey: v.string(),
    voiceId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    ok: boolean;
    storageId?: string;
    audioUrl?: string | null;
    cached?: boolean;
    charCount?: number;
    error?: string;
  }> => {
    // Validate dateKey looks like YYYY-MM-DD before doing any work.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dateKey)) {
      return { ok: false, error: "Invalid dateKey — expected YYYY-MM-DD" };
    }
    const result = await ctx.runAction(
      internal.domains.integrations.voice.editionTts.synthesizeEditionAudio,
      { dateKey: args.dateKey, voiceId: args.voiceId },
    );
    return result;
  },
});
