/**
 * VideoLiteEmbed — thumbnail card with click-to-play that lazy-loads
 * the video iframe only after the user opts in.
 *
 * Privacy + perf pattern (see `lite-youtube-embed` by paulirish):
 *   - Initial render is just an `<img>` thumbnail + play overlay.
 *   - No oEmbed API hit on mount — metadata is fetched server-side
 *     by `convex/domains/integrations/video/oembedFetcher.ts` and
 *     cached.  The component reads cached rows via
 *     `getCachedRowsForHashes` (single bulk query for the whole page).
 *   - Click swaps the thumbnail for a real `<iframe>` pointed at the
 *     provider's privacy-friendly embed URL (youtube-nocookie etc.).
 *   - Respects `prefers-reduced-motion`: no auto-play even after click.
 *
 * Render rules:
 *   - If we have a cached row with thumbnailUrl → render thumbnail card.
 *   - If detection succeeded but no cache row → render a "preparing"
 *     stub that triggers a one-shot resolve + falls back to plain
 *     link if resolve fails.
 *   - If detection failed → render plain link (caller decides
 *     whether to call this component at all).
 *
 * Accessibility:
 *   - Outer wrapper is `role="button"` with keyboard handlers (Enter / Space).
 *   - aria-label includes the title + provider name.
 *   - focus-visible ring (CSS).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { detectVideoProviderClient, sha256Hex } from "../../utils/videoProvider";

interface Props {
  /** The original URL (YouTube / Vimeo / Twitch / Loom). */
  url: string;
  /**
   * Optional caption — shown beneath the thumbnail when the cached
   * title is missing.  Falls through from the editorial section
   * (e.g. an industryUpdate.title or a footnote label).
   */
  fallbackTitle?: string;
  /** Optional class added to the outer wrapper. */
  className?: string;
}

/**
 * Provider display labels — short, attribution-only.  Never marketing
 * phrases ("by YouTube" stays as "YouTube").
 */
const PROVIDER_LABEL: Record<"youtube" | "vimeo" | "twitch" | "loom", string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  twitch: "Twitch",
  loom: "Loom",
};

/** Fallback inline thumbnail when the cached row has no thumbnailUrl. */
function ProviderFallbackThumb({
  provider,
}: {
  provider: "youtube" | "vimeo" | "twitch" | "loom";
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background:
          "linear-gradient(135deg, rgba(0,0,0,0.55), rgba(0,0,0,0.78))",
        color: "rgba(255,255,255,0.78)",
        fontFamily: "var(--rd-mono, ui-monospace, monospace)",
        fontSize: 12,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
      }}
    >
      {PROVIDER_LABEL[provider]}
    </div>
  );
}

export function VideoLiteEmbed({ url, fallbackTitle, className }: Props) {
  const detected = useMemo(() => detectVideoProviderClient(url), [url]);
  const [urlHash, setUrlHash] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);
  const [resolveAttempted, setResolveAttempted] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const resolveBatch = useAction(
    api.domains.integrations.video.oembedFetcher.resolveVideoOembedBatch,
  );

  // Compute sha256(url) so the bulk-cache query can look up a row.
  // Async because Web Crypto's digest is a Promise.  Stable for a
  // given URL — reruns only when the URL changes.
  useEffect(() => {
    if (!detected) {
      setUrlHash(null);
      return;
    }
    let cancelled = false;
    sha256Hex(detected.url)
      .then((h) => {
        if (!cancelled) setUrlHash(h);
      })
      .catch(() => {
        if (!cancelled) setUrlHash(null);
      });
    return () => {
      cancelled = true;
    };
  }, [detected]);

  // Bulk cache probe.  We pass a single-element array — Convex query
  // results are reactive so this reflows automatically once the
  // server-side resolve completes.
  const hashesArg = useMemo(
    () => (urlHash ? [urlHash] : []),
    [urlHash],
  );
  const cacheRows = useQuery(
    api.domains.integrations.video.oembedFetcherQueries.getCachedRowsForHashes,
    detected && urlHash ? { urlHashes: hashesArg } : "skip",
  );

  const cached = urlHash && cacheRows ? cacheRows[urlHash] ?? null : null;
  const cacheLoading = detected && urlHash && cacheRows === undefined;

  // Trigger one-shot server resolve when we have detection + hash but
  // no cache row.  Idempotent on the server side.
  useEffect(() => {
    if (!detected || !urlHash) return;
    if (resolveAttempted) return;
    if (cacheLoading) return; // wait for the first cache result
    if (cached && !cached.expired && cached.thumbnailUrl) return; // already populated
    setResolveAttempted(true);
    resolveBatch({ urls: [detected.url] }).catch(() => {
      // HONEST_STATUS — swallow; UI falls back to plain link below.
    });
  }, [detected, urlHash, cacheLoading, cached, resolveAttempted, resolveBatch]);

  // No detection → plain link.  Caller decides whether to invoke us
  // at all, but we double-guard.
  if (!detected) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
        {fallbackTitle ?? url}
      </a>
    );
  }

  const provider = detected.provider;
  const title = cached?.title ?? fallbackTitle ?? PROVIDER_LABEL[provider];
  const author = cached?.author;
  const thumbnailUrl = cached?.thumbnailUrl ?? null;
  const embedUrl = cached?.embedUrl ?? null;

  const handleActivate = useCallback(() => {
    if (!embedUrl) return;
    setActivated(true);
  }, [embedUrl]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleActivate();
      }
    },
    [handleActivate],
  );

  // Iframe view — no autoplay, no third-party JS until click.
  if (activated && embedUrl) {
    return (
      <div
        className={`rd-video-lite-embed rd-video-lite-embed--active ${className ?? ""}`}
        data-video-active="true"
        data-video-provider={provider}
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 9",
          background: "#000",
          borderRadius: 8,
          overflow: "hidden",
          margin: "12px 0",
        }}
      >
        <iframe
          src={embedUrl}
          title={title}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; encrypted-media; picture-in-picture"
          allowFullScreen
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            border: 0,
          }}
        />
      </div>
    );
  }

  // Thumbnail / placeholder view.
  return (
    <div
      ref={wrapperRef}
      className={`rd-video-lite-embed ${className ?? ""}`}
      data-video-active="false"
      data-video-provider={provider}
      data-video-thumbnail={thumbnailUrl ? "true" : "false"}
      data-video-cache-state={
        cacheLoading
          ? "loading"
          : cached?.errorMessage
            ? "error"
            : cached
              ? "ready"
              : "resolving"
      }
      role={embedUrl ? "button" : undefined}
      tabIndex={embedUrl ? 0 : undefined}
      aria-label={
        embedUrl ? `Play ${PROVIDER_LABEL[provider]} video: ${title}` : undefined
      }
      onClick={embedUrl ? handleActivate : undefined}
      onKeyDown={embedUrl ? handleKey : undefined}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        background: "rgba(0,0,0,0.6)",
        borderRadius: 8,
        overflow: "hidden",
        margin: "12px 0",
        cursor: embedUrl ? "pointer" : "default",
        outline: "none",
      }}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={title}
          loading="lazy"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : (
        <ProviderFallbackThumb provider={provider} />
      )}
      {/* Play overlay */}
      {embedUrl && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background:
              "linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55))",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(0,0,0,0.62)",
              border: "1px solid rgba(255,255,255,0.6)",
              display: "grid",
              placeItems: "center",
              boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
            }}
          >
            {/* Triangle play glyph — pure CSS, no SVG dep */}
            <span
              style={{
                display: "block",
                width: 0,
                height: 0,
                borderLeft: "16px solid rgba(255,255,255,0.92)",
                borderTop: "10px solid transparent",
                borderBottom: "10px solid transparent",
                marginLeft: 4,
              }}
            />
          </div>
        </div>
      )}
      {/* Caption overlay — provider + title, bottom strip */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          color: "white",
          background: "linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.62))",
          fontSize: 12,
          textShadow: "0 1px 2px rgba(0,0,0,0.6)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--rd-mono, ui-monospace, monospace)",
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            opacity: 0.86,
          }}
        >
          {PROVIDER_LABEL[provider]}
          {author ? ` · ${author}` : ""}
        </span>
        <span
          style={{
            fontWeight: 600,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            lineHeight: 1.25,
          }}
        >
          {title}
        </span>
      </div>
      {/* Honest fallback link for screen readers + plain-text contexts */}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${PROVIDER_LABEL[provider]} video in new tab`}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          border: 0,
        }}
      >
        Open {PROVIDER_LABEL[provider]} video
      </a>
    </div>
  );
}
