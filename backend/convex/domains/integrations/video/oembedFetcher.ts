/**
 * Phase 10b — Video oEmbed metadata fetcher.
 *
 * Resolves the "video lite-embed" Phase 9 deferred item from
 * `docs/architecture/EDITION_INGESTION_FLYWHEEL.md`.
 *
 * Detects YouTube / Vimeo / Twitch / Loom URLs that appear inside
 * editorial-section data (industryUpdates.url, evidenceArtifacts.url,
 * etc.) and fetches privacy-friendly oEmbed metadata so the editorial
 * home can render a thumbnail card with click-to-play instead of a
 * bare text link.  No video summarization, no transcript extraction —
 * this is purely about replacing `<a>` with a thumbnail + lazy iframe.
 *
 * The action is idempotent: results are cached in `videoOembedCache`
 * keyed by sha256(url) with a 7-day TTL.  Re-runs within the TTL
 * return cached metadata without an outbound fetch.
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND          One row per distinct URL.  Provider hostnames
 *                    enumerated in ALLOWED_HOSTS — never grows from
 *                    user input.  Bulk action capped at MAX_BULK_RESOLVE.
 *   - HONEST_STATUS  A failed oEmbed fetch persists `errorMessage` and
 *                    leaves thumbnail/title null.  Read paths surface
 *                    the failure as a fallback to plain link, NOT as
 *                    fabricated metadata.
 *   - HONEST_SCORES  N/A (no scoring).
 *   - TIMEOUT        AbortController, 5s budget per oEmbed fetch.
 *   - SSRF           Provider hostnames hardcoded.  URL constructor +
 *                    exact hostname check rejects anything else.
 *                    https only.  Provider-specific URL builders
 *                    re-construct the oEmbed-API URL from the parsed
 *                    video id, so a malicious raw URL cannot leak past
 *                    the provider routing.
 *   - BOUND_READ     Streaming reader cancels on overflow above
 *                    MAX_RESPONSE_BYTES (256 KB).
 *   - ERROR_BOUNDARY Per-URL try/catch.  Bad provider responses are
 *                    persisted as `errorMessage` rows so we don't loop
 *                    forever on a permanently-broken video.
 *   - DETERMINISTIC  Cache key = sha256(url).  Same URL always hits
 *                    the same cache row.
 *
 * Prior art:
 *   - convex/domains/integrations/macro/fredSeed.ts  parallel
 *     bounded-fetch with timeout + size cap (Phase 10a).
 *   - convex/domains/research/mcpServerCountSeed.ts  bounded fetch
 *     helper + idempotent upsert pattern (Phase 9a).
 *   - lite-youtube-embed (paulirish/lite-youtube-embed) — the
 *     thumbnail-first, click-to-load privacy pattern this enables.
 */

"use node";

import { action, internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";
import { createHash } from "node:crypto";

/** Provider whitelist.  SSRF defense — every fetch must hit one of these hostnames. */
const ALLOWED_HOSTS = new Set<string>([
  "www.youtube.com",
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "www.vimeo.com",
  "clips.twitch.tv",
  "www.twitch.tv",
  "twitch.tv",
  "www.loom.com",
  "loom.com",
]);

const FETCH_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_BULK_RESOLVE = 8;

export type VideoProvider = "youtube" | "vimeo" | "twitch" | "loom";

/* ──────────────────────────────────────────────────────────────────
 * Provider detection — pure helpers, exported for tests + the
 * VideoLiteEmbed component (which reuses `detectVideoProvider` to
 * decide whether to render a thumbnail or a plain link).
 * ──────────────────────────────────────────────────────────────── */

export interface DetectedVideo {
  provider: VideoProvider;
  /** Canonical share URL — what the user clicked. */
  url: string;
  /** Provider-specific video id (e.g. dQw4w9WgXcQ for YouTube). */
  videoId: string;
}

/**
 * Detect whether a URL points to a supported video provider.
 *
 * Returns null for non-video URLs (the caller falls back to a plain
 * `<a>`).  Returns `{provider, url, videoId}` for the four supported
 * providers; the caller passes the URL to the Convex action which
 * does the oEmbed lookup.
 *
 * Patterns supported (case-insensitive on hostname):
 *   - YouTube  https://www.youtube.com/watch?v={id}
 *   - YouTube  https://youtu.be/{id}
 *   - Vimeo    https://vimeo.com/{id}
 *   - Twitch   https://clips.twitch.tv/{id}
 *   - Twitch   https://www.twitch.tv/{user}/clip/{id}
 *   - Loom     https://www.loom.com/share/{id}
 */
export function detectVideoProvider(rawUrl: string): DetectedVideo | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;

  const host = parsed.hostname.toLowerCase();

  if (host === "www.youtube.com" || host === "youtube.com") {
    const v = parsed.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{6,20}$/.test(v)) {
      return { provider: "youtube", url: rawUrl, videoId: v };
    }
  }
  if (host === "youtu.be") {
    const id = parsed.pathname.replace(/^\//, "").split("/")[0] ?? "";
    if (/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      return { provider: "youtube", url: rawUrl, videoId: id };
    }
  }

  if (host === "vimeo.com" || host === "www.vimeo.com") {
    const segs = parsed.pathname.split("/").filter(Boolean);
    const id = segs[0] ?? "";
    if (/^\d{6,12}$/.test(id)) {
      return { provider: "vimeo", url: rawUrl, videoId: id };
    }
  }

  if (host === "clips.twitch.tv") {
    const id = parsed.pathname.replace(/^\//, "").split("/")[0] ?? "";
    if (id && /^[A-Za-z0-9_-]+$/.test(id)) {
      return { provider: "twitch", url: rawUrl, videoId: id };
    }
  }
  if (host === "www.twitch.tv" || host === "twitch.tv") {
    const segs = parsed.pathname.split("/").filter(Boolean);
    if (segs.length >= 3 && segs[1] === "clip") {
      const id = segs[2] ?? "";
      if (id && /^[A-Za-z0-9_-]+$/.test(id)) {
        return { provider: "twitch", url: rawUrl, videoId: id };
      }
    }
  }

  if (host === "www.loom.com" || host === "loom.com") {
    const segs = parsed.pathname.split("/").filter(Boolean);
    if (segs.length >= 2 && segs[0] === "share") {
      const id = segs[1] ?? "";
      if (id && /^[A-Za-z0-9_-]+$/.test(id)) {
        return { provider: "loom", url: rawUrl, videoId: id };
      }
    }
  }

  return null;
}

/**
 * Build the privacy-friendly embed URL the iframe will load when the
 * user clicks the thumbnail.  Provider-specific because each provider
 * has different "no-cookie / no-tracking" embed flavors.
 *
 * Notes:
 *   - YouTube uses `youtube-nocookie.com` (the privacy-enhanced mode).
 *   - Vimeo's player URL has no cookie variant; the `dnt=1` flag asks
 *     the player to honor Do-Not-Track signals.
 *   - Twitch requires a `parent` URL; we pass the canonical prod
 *     hostnames + localhost so the iframe loads in dev too.
 *   - Loom uses the standard /embed/ URL.
 */
function buildEmbedUrl(provider: VideoProvider, videoId: string): string {
  switch (provider) {
    case "youtube":
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0`;
    case "vimeo":
      return `https://player.vimeo.com/video/${encodeURIComponent(videoId)}?dnt=1`;
    case "twitch":
      return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(videoId)}&parent=nodebenchai.com&parent=www.nodebenchai.com&parent=localhost`;
    case "loom":
      return `https://www.loom.com/embed/${encodeURIComponent(videoId)}`;
  }
}

/**
 * Build the oEmbed-API URL for a provider.  Re-constructed from the
 * detected `videoId` (rather than the raw user URL) — that way any
 * weirdness in the source URL can't escape the provider routing.
 *
 * Returns "" for Twitch (no public oEmbed endpoint); caller treats
 * that as "use the local fallback metadata path."
 */
function buildOembedUrl(provider: VideoProvider, _videoId: string, originalUrl: string): string {
  const target = encodeURIComponent(originalUrl);
  switch (provider) {
    case "youtube":
      return `https://www.youtube.com/oembed?url=${target}&format=json`;
    case "vimeo":
      return `https://vimeo.com/api/oembed.json?url=${target}`;
    case "twitch":
      return "";
    case "loom":
      return `https://www.loom.com/v1/oembed?url=${target}&format=json`;
  }
}

/* ──────────────────────────────────────────────────────────────────
 * Bounded fetch helper (mirrors fredSeed.ts).
 * ──────────────────────────────────────────────────────────────── */

async function boundedFetch(url: string, label: string): Promise<string> {
  const u = new URL(url);
  if (!ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error(`[oembedFetcher] ${label}: host ${u.hostname} not allowlisted`);
  }
  if (u.protocol !== "https:") {
    throw new Error(`[oembedFetcher] ${label}: non-https rejected`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "nodebench-video-oembed/1.0 (mailto:editorial@nodebenchai.com)",
        accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`[oembedFetcher] ${label}: HTTP ${res.status}`);
    }
    if (!res.body) {
      throw new Error(`[oembedFetcher] ${label}: no response body`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error(
          `[oembedFetcher] ${label}: response exceeded ${MAX_RESPONSE_BYTES} bytes`,
        );
      }
      buf += decoder.decode(value, { stream: true });
    }
    buf += decoder.decode();
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

/* The upsert mutation lives in `oembedFetcherQueries.ts` because
 * Convex restricts mutations to non-`"use node"` modules.  The action
 * below calls it via `runMutation`. */

/* ──────────────────────────────────────────────────────────────────
 * Provider-specific oEmbed parsers.  Each returns the fields the
 * cache row needs (or partial fields when the provider doesn't
 * supply them).
 * ──────────────────────────────────────────────────────────────── */

interface OembedFields {
  thumbnailUrl?: string;
  title?: string;
  author?: string;
  durationSec?: number;
}

function parseYouTubeOembed(json: unknown): OembedFields {
  if (!json || typeof json !== "object") return {};
  const obj = json as Record<string, unknown>;
  const out: OembedFields = {};
  if (typeof obj.thumbnail_url === "string") out.thumbnailUrl = obj.thumbnail_url;
  if (typeof obj.title === "string") out.title = obj.title;
  if (typeof obj.author_name === "string") out.author = obj.author_name;
  return out;
}

function parseVimeoOembed(json: unknown): OembedFields {
  if (!json || typeof json !== "object") return {};
  const obj = json as Record<string, unknown>;
  const out: OembedFields = {};
  if (typeof obj.thumbnail_url === "string") out.thumbnailUrl = obj.thumbnail_url;
  if (typeof obj.title === "string") out.title = obj.title;
  if (typeof obj.author_name === "string") out.author = obj.author_name;
  if (typeof obj.duration === "number" && Number.isFinite(obj.duration)) {
    out.durationSec = obj.duration;
  }
  return out;
}

function parseLoomOembed(json: unknown): OembedFields {
  if (!json || typeof json !== "object") return {};
  const obj = json as Record<string, unknown>;
  const out: OembedFields = {};
  if (typeof obj.thumbnail_url === "string") out.thumbnailUrl = obj.thumbnail_url;
  if (typeof obj.title === "string") out.title = obj.title;
  if (typeof obj.author_name === "string") out.author = obj.author_name;
  if (typeof obj.duration === "number" && Number.isFinite(obj.duration)) {
    out.durationSec = obj.duration;
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────────
 * Public action — resolve a URL into a cached row.
 *
 * Contract:
 *   args   { url: string }
 *   return { ok, cached, row?: OembedCacheRow, reason?: string }
 *
 * Always returns synchronously — never throws past the action
 * boundary.  On failure, persists an `errorMessage` row and returns
 * `ok=false` so callers can fall back to the plain link.
 * ──────────────────────────────────────────────────────────────── */

interface OembedCacheRow {
  urlHash: string;
  url: string;
  provider: VideoProvider;
  thumbnailUrl?: string | null;
  title?: string | null;
  author?: string | null;
  durationSec?: number | null;
  embedUrl: string;
  fetchedAt: number;
  ttlExpiresAt: number;
  errorMessage?: string | null;
}

export const resolveVideoOembed = internalAction({
  args: {
    url: v.string(),
  },
  handler: async (ctx, args): Promise<{
    ok: boolean;
    cached: boolean;
    row?: OembedCacheRow;
    reason?: string;
  }> => {
    const detected = detectVideoProvider(args.url);
    if (!detected) {
      return { ok: false, cached: false, reason: "url not a supported video provider" };
    }

    const urlHash = createHash("sha256").update(detected.url).digest("hex");

    const existing = await ctx.runQuery(
      internal.domains.integrations.video.oembedFetcherQueries.getCachedRow,
      { urlHash },
    );

    const now = Date.now();
    if (existing && existing.ttlExpiresAt > now && !existing.errorMessage) {
      return {
        ok: true,
        cached: true,
        row: {
          urlHash: existing.urlHash,
          url: existing.url,
          provider: existing.provider,
          thumbnailUrl: existing.thumbnailUrl ?? null,
          title: existing.title ?? null,
          author: existing.author ?? null,
          durationSec: existing.durationSec ?? null,
          embedUrl: existing.embedUrl,
          fetchedAt: existing.fetchedAt,
          ttlExpiresAt: existing.ttlExpiresAt,
          errorMessage: existing.errorMessage ?? null,
        },
      };
    }

    const embedUrl = buildEmbedUrl(detected.provider, detected.videoId);

    let fields: OembedFields = {};
    let errorMessage: string | undefined;

    const oembedUrl = buildOembedUrl(detected.provider, detected.videoId, detected.url);
    if (oembedUrl === "") {
      // Twitch fallback path — no public oEmbed.
      errorMessage = "twitch: no public oEmbed endpoint";
    } else {
      try {
        const body = await boundedFetch(oembedUrl, `oembed:${detected.provider}`);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch (err) {
          throw new Error(
            `oembed JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        switch (detected.provider) {
          case "youtube":
            fields = parseYouTubeOembed(parsed);
            break;
          case "vimeo":
            fields = parseVimeoOembed(parsed);
            break;
          case "loom":
            fields = parseLoomOembed(parsed);
            break;
          default:
            fields = {};
        }
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    }

    await ctx.runMutation(
      internal.domains.integrations.video.oembedFetcherQueries.upsertOembedCacheRow,
      {
        urlHash,
        url: detected.url,
        provider: detected.provider,
        thumbnailUrl: fields.thumbnailUrl,
        title: fields.title,
        author: fields.author,
        durationSec: fields.durationSec,
        embedUrl,
        fetchedAt: now,
        ttlExpiresAt: now + TTL_MS,
        errorMessage,
      },
    );

    return {
      ok: !errorMessage,
      cached: false,
      reason: errorMessage,
      row: {
        urlHash,
        url: detected.url,
        provider: detected.provider,
        thumbnailUrl: fields.thumbnailUrl ?? null,
        title: fields.title ?? null,
        author: fields.author ?? null,
        durationSec: fields.durationSec ?? null,
        embedUrl,
        fetchedAt: now,
        ttlExpiresAt: now + TTL_MS,
        errorMessage: errorMessage ?? null,
      },
    };
  },
});

/* ──────────────────────────────────────────────────────────────────
 * Public action — bulk-warm a list of URLs.
 *
 * Called by the frontend (EditorialHomeSurface) when it discovers
 * video URLs that don't yet have a cache row.  Bounded at
 * MAX_BULK_RESOLVE URLs per call to keep the editorial-page render
 * fast and to limit outbound oEmbed traffic.
 *
 * The action returns the resolved rows so the caller can immediately
 * render the thumbnails, but a follow-up cached query
 * (getCachedRowsForHashes) is what reactively populates the UI on
 * subsequent renders.
 * ──────────────────────────────────────────────────────────────── */

export const resolveVideoOembedBatch = action({
  args: {
    urls: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{
    ok: boolean;
    resolved: number;
    skipped: number;
    rows: Array<{
      url: string;
      ok: boolean;
      cached: boolean;
      reason?: string;
      provider?: VideoProvider;
      urlHash?: string;
    }>;
  }> => {
    const urls: string[] = Array.from(new Set<string>(args.urls)).slice(
      0,
      MAX_BULK_RESOLVE,
    );
    let resolved = 0;
    let skipped = 0;
    const rows: Array<{
      url: string;
      ok: boolean;
      cached: boolean;
      reason?: string;
      provider?: VideoProvider;
      urlHash?: string;
    }> = [];
    for (const url of urls) {
      const detected = detectVideoProvider(url);
      if (!detected) {
        skipped += 1;
        rows.push({ url, ok: false, cached: false, reason: "not a video url" });
        continue;
      }
      const result = await ctx.runAction(
        internal.domains.integrations.video.oembedFetcher.resolveVideoOembed,
        { url },
      );
      if (result.ok) resolved += 1;
      else skipped += 1;
      rows.push({
        url,
        ok: result.ok,
        cached: result.cached,
        reason: result.reason,
        provider: result.row?.provider,
        urlHash: result.row?.urlHash,
      });
    }
    return { ok: true, resolved, skipped, rows };
  },
});
