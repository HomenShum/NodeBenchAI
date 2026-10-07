/**
 * Frontend mirror of the server-side video-provider detector that
 * lives in `convex/domains/integrations/video/oembedFetcher.ts`.
 *
 * Why a mirror?
 *   - The component needs to know whether a URL is a video BEFORE
 *     deciding to render `<VideoLiteEmbed>` or a plain `<a>`.
 *   - Computing it client-side avoids a round-trip per item on first
 *     render of an editorial page (which can have ~10 footnote URLs).
 *   - The cache lookup itself happens server-side via Convex query —
 *     the client just needs the `urlHash` (sha256 hex) to probe.
 *
 * Keep this file in lockstep with the server detector — same regex,
 * same supported provider hostnames.  If the server adds a provider,
 * add it here.  Both detect functions are pure.
 */

export type VideoProvider = "youtube" | "vimeo" | "twitch" | "loom";

export interface DetectedVideoClient {
  provider: VideoProvider;
  url: string;
  videoId: string;
}

/**
 * Detect a supported video provider URL.  Returns null for non-video
 * URLs (the caller falls back to a plain `<a>`).
 *
 * Mirror of `detectVideoProvider` in
 * `convex/domains/integrations/video/oembedFetcher.ts` — keep identical.
 */
export function detectVideoProviderClient(rawUrl: string): DetectedVideoClient | null {
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
 * Compute sha256(url) → hex string using Web Crypto.  Matches the
 * server-side `createHash("sha256").update(url).digest("hex")` so a
 * cache row written server-side reads correctly client-side.
 *
 * Throws if Web Crypto is unavailable (extremely old browser /
 * non-secure context).  Caller catches and falls back to plain link.
 */
export async function sha256Hex(input: string): Promise<string> {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error("Web Crypto unavailable");
  }
  const enc = new TextEncoder();
  const buf = await globalThis.crypto.subtle.digest("SHA-256", enc.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convenience — detect + tag (for editorial sections that need to
 * know "is this a video, and which provider" without fetching the
 * thumbnail yet).
 */
export function isVideoUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  return detectVideoProviderClient(rawUrl) !== null;
}
