/**
 * Phase 9a — Editorial-edition TTS (Listen button).
 * Phase 11 polish — OpenAI TTS fallback when ElevenLabs not configured.
 *
 * Generates a single-edition audio file from the ~300-500 word
 * script produced by `getEditionAudioScript` and caches it in
 * Convex `_storage` keyed by `dateKey`.  Same-day clicks return the
 * cached storageId (NEVER regenerate — bound on TTS cost).
 *
 * Provider selection (in order):
 *   1. ElevenLabs    if ELEVENLABS_API_KEY is set
 *   2. OpenAI TTS    if OPENAI_API_KEY is set
 *   3. honest error  { ok:false, error, providersTried }
 *
 * OpenAI fallback was added because Convex prod has OPENAI_API_KEY
 * but not ELEVENLABS_API_KEY — the Listen button was correctly
 * returning HONEST_STATUS errors but blocking the editorial UX.
 *
 * Why a Convex action and not the existing Express `/tts` route:
 *   The Express server-route TTS proxy (server/routes/tts.ts) only
 *   runs on the local dev gateway (port 3100).  Vercel's deployed
 *   `/redesign` page can't reach it.  This action wraps the chosen
 *   provider server-side via Convex (which IS deployed) and stores
 *   the audio bytes in Convex `_storage` so the editorial home can
 *   play them without a separate audio CDN.
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND          script length capped at MAX_SCRIPT_CHARS;
 *                    audio response capped at MAX_AUDIO_BYTES.
 *   - HONEST_STATUS  per-provider try/catch.  Both-providers-failed
 *                    returns `{ ok:false, error, providersTried }`
 *                    — never a fake success.
 *   - HONEST_SCORES  n/a (binary success/failure path).
 *   - TIMEOUT        AbortController, FETCH_TIMEOUT_MS budget per
 *                    provider attempt.  TTS is inherently slower
 *                    than scoreboard fetches.
 *   - SSRF           hostnames `api.elevenlabs.io` and
 *                    `api.openai.com` allowlisted; everything else
 *                    rejected by URL constructor + exact-match check.
 *   - BOUND_READ     5 MB cap on streamed audio response per provider.
 *   - ERROR_BOUNDARY each provider call wrapped in try/catch; the
 *                    action returns `{ ok:false, error }` shape on
 *                    total failure.
 *   - DETERMINISTIC  cache key = dateKey + voiceId.  Same-day
 *                    re-call collides and returns prior storageId.
 *                    Provider switches voiceId so cache stays clean.
 */

import { action, internalAction, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
const ALLOWED_HOSTS = new Set(["api.elevenlabs.io", "api.openai.com"]);
const FETCH_TIMEOUT_MS = 15_000; // 15s — OpenAI TTS can take ~10s for 2K-char scripts
const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB cap on TTS output
const MAX_SCRIPT_CHARS = 2000; // Bound on TTS cost (~$0.30 per 1K chars on EL, ~$0.03 on OpenAI tts-1)

const DEFAULTS = {
  // ElevenLabs defaults
  elevenLabsModel: "eleven_turbo_v2_5",
  stability: 0.5,
  similarityBoost: 0.75,
  elevenLabsVoiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel — same as Express route
  // OpenAI defaults — gpt-4o-mini-tts is the newest + cheapest +
  // voice-steerable via `instructions`.  `nova` is OpenAI's calm,
  // neutral voice — closest to a news-anchor tone.
  openaiModel: "gpt-4o-mini-tts",
  openaiVoice: "nova",
  openaiInstructions:
    "Read in a calm, professional news-briefing voice. Pause briefly between sections. Do not over-emote.",
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
 * Shared bounded-audio fetch — SSRF allowlist, timeout, body cap.
 *
 * Both ElevenLabs and OpenAI return audio binary on success; this
 * helper handles the streaming + size cap + abort identically for
 * either provider.  Caller supplies the request init.
 * ──────────────────────────────────────────────────────────────── */

interface AudioFetchInit {
  url: string;
  /** label used in error messages, e.g. "elevenlabs" or "openai" */
  label: string;
  /** Full fetch RequestInit (method/headers/body).  signal is added here. */
  init: RequestInit;
}

async function boundedAudioFetch(
  args: AudioFetchInit,
): Promise<ArrayBuffer> {
  const u = new URL(args.url);
  // SSRF: exact hostname match.  ALLOWED_HOSTS contains both providers.
  if (!ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error(`[editionTts/${args.label}] host ${u.hostname} not allowlisted`);
  }
  if (u.protocol !== "https:") {
    throw new Error(`[editionTts/${args.label}] non-https rejected`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(args.url, { ...args.init, signal: controller.signal });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `[editionTts/${args.label}] HTTP ${res.status}: ${errText.slice(0, 200)}`,
      );
    }
    if (!res.body) {
      throw new Error(`[editionTts/${args.label}] no response body`);
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
          `[editionTts/${args.label}] audio exceeded ${MAX_AUDIO_BYTES} bytes`,
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

/** ElevenLabs voiceId is path-segment; OpenAI voice is body field. */
async function callElevenLabs(
  apiKey: string,
  text: string,
  voiceId: string,
): Promise<ArrayBuffer> {
  const url = `${ELEVENLABS_API_BASE}/${encodeURIComponent(voiceId)}`;
  return boundedAudioFetch({
    url,
    label: "elevenlabs",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: DEFAULTS.elevenLabsModel,
        voice_settings: {
          stability: DEFAULTS.stability,
          similarity_boost: DEFAULTS.similarityBoost,
        },
      }),
    },
  });
}

/**
 * OpenAI TTS fallback.  Endpoint: POST /v1/audio/speech.
 *
 * Body shape:
 *   { model, input, voice, response_format, instructions? }
 *
 * `gpt-4o-mini-tts` is the newest model, ~10x cheaper than ElevenLabs
 * Turbo and supports voice steering via the `instructions` field
 * (older `tts-1` / `tts-1-hd` ignore it).  Response is binary mp3 by
 * default — frontends play it natively via `<audio>`.
 *
 * Doc reference: https://platform.openai.com/docs/guides/text-to-speech
 *                https://platform.openai.com/docs/api-reference/audio/createSpeech
 */
async function callOpenAI(
  apiKey: string,
  text: string,
  voice: string,
): Promise<ArrayBuffer> {
  return boundedAudioFetch({
    url: OPENAI_TTS_URL,
    label: "openai",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEFAULTS.openaiModel,
        input: text,
        voice,
        response_format: "mp3",
        // `instructions` is honored by gpt-4o-mini-tts only; older
        // tts-1 / tts-1-hd silently ignore it — safe to send always.
        instructions: DEFAULTS.openaiInstructions,
      }),
    },
  });
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

type TtsProvider = "elevenlabs" | "openai";

/**
 * Pick the provider + the voiceId to use for this call.
 *
 * Caller can hint via args.voiceId.  If they pass an ElevenLabs voiceId
 * pattern (20-char alphanumeric), we route to EL when configured.
 * Otherwise we let env presence drive selection: EL first if its key is
 * set, then OpenAI.
 *
 * Returns the resolved provider + voiceId we'll actually use, OR null
 * when no provider is configured at all (HONEST_STATUS — surfaced).
 */
function pickProvider(
  argsVoiceId: string | undefined,
): { provider: TtsProvider; voiceId: string } | null {
  const elKey = process.env.ELEVENLABS_API_KEY;
  const oaKey = process.env.OPENAI_API_KEY;
  const elAvailable = typeof elKey === "string" && elKey.trim().length > 0;
  const oaAvailable = typeof oaKey === "string" && oaKey.trim().length > 0;

  if (elAvailable) {
    const voiceId =
      argsVoiceId && argsVoiceId.length > 0
        ? argsVoiceId
        : DEFAULTS.elevenLabsVoiceId;
    return { provider: "elevenlabs", voiceId };
  }
  if (oaAvailable) {
    // OpenAI voice catalog is fixed.  If caller passed an EL voiceId we
    // ignore it (would 400 from OpenAI) and use the default.
    const allowedOpenAI = new Set([
      "alloy", "ash", "ballad", "coral", "echo", "fable",
      "onyx", "nova", "sage", "shimmer", "verse",
    ]);
    const voiceId =
      argsVoiceId && allowedOpenAI.has(argsVoiceId)
        ? argsVoiceId
        : DEFAULTS.openaiVoice;
    return { provider: "openai", voiceId };
  }
  return null;
}

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
    provider?: TtsProvider;
    providersTried?: TtsProvider[];
    error?: string;
  }> => {
    const picked = pickProvider(args.voiceId);
    if (!picked) {
      // HONEST_STATUS — neither provider configured.
      return {
        ok: false,
        error:
          "No TTS provider configured: set ELEVENLABS_API_KEY or OPENAI_API_KEY in Convex env",
        providersTried: [],
      };
    }

    // Cache key embeds the provider so an EL run and an OpenAI run for
    // the same dateKey don't collide (different audio characteristics).
    const cacheKey = `${args.dateKey}|${picked.provider}|${picked.voiceId}`;

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
        provider: picked.provider,
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
        providersTried: [],
      };
    }
    const truncated = script.slice(0, MAX_SCRIPT_CHARS);

    // 3. Call the chosen provider.  We do NOT attempt cross-provider
    //    fallback inside a single request — if EL is configured but its
    //    call fails (rate limit, transient 5xx) we surface that error
    //    rather than silently switching voice mid-request.  The user
    //    can retry; the next call goes through the same provider.
    let audioBuffer: ArrayBuffer;
    const providersTried: TtsProvider[] = [picked.provider];
    try {
      if (picked.provider === "elevenlabs") {
        const apiKey = process.env.ELEVENLABS_API_KEY!;
        audioBuffer = await callElevenLabs(apiKey, truncated, picked.voiceId);
      } else {
        const apiKey = process.env.OPENAI_API_KEY!;
        audioBuffer = await callOpenAI(apiKey, truncated, picked.voiceId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[editionTts] ${picked.provider} call failed: ${msg}`);
      return {
        ok: false,
        error: msg,
        provider: picked.provider,
        providersTried,
      };
    }

    // 4. Store in _storage.
    const blob = new Blob([audioBuffer], { type: "audio/mpeg" });
    const storageId = await ctx.storage.store(blob);

    // 5. Persist cache row.  voiceId column carries `${provider}:${voice}`
    //    so future debug/admin queries can see provenance without
    //    needing to parse cacheKey.
    await ctx.runMutation(
      internal.domains.integrations.voice.editionTts.writeEditionAudio,
      {
        cacheKey,
        dateKey: args.dateKey,
        voiceId: `${picked.provider}:${picked.voiceId}`,
        storageId,
        charCount: truncated.length,
      },
    );

    const url = await ctx.storage.getUrl(storageId);
    console.log(
      `[editionTts] dateKey=${args.dateKey} provider=${picked.provider} ` +
        `voiceId=${picked.voiceId} chars=${truncated.length} ` +
        `storageId=${storageId} cached=false`,
    );
    return {
      ok: true,
      storageId,
      audioUrl: url ?? null,
      cached: false,
      charCount: truncated.length,
      provider: picked.provider,
      providersTried,
    };
  },
});

/**
 * Public-callable wrapper for the editorial-home Listen button.
 *
 * Trades off authentication: this is callable by any visitor since
 * the editorial home is a public surface.  The action is bounded
 * (cache-first, per-provider per-day per-voiceId idempotent) so
 * spam-clicking does NOT regenerate cost.  Underlying provider keys
 * (ELEVENLABS_API_KEY / OPENAI_API_KEY) are server-side only; never
 * bundled into the client.
 *
 * The response includes `provider` so the client can show which voice
 * synthesized the clip and so observability tools can audit cost
 * attribution by provider.
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
    provider?: TtsProvider;
    providersTried?: TtsProvider[];
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
