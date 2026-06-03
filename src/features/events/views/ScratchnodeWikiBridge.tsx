/**
 * ScratchnodeWikiBridge — the REAL ScratchNode -> NodeBench bridge receiving
 * surface for `/events/:slug/wiki`.
 *
 * Why this exists: the ScratchNode wiki reader (scratchnode.live/wiki/<slug>)
 * wants a "Continue in NodeBench" CTA, but an audit found the handoff URL
 * `nodebenchai.com/events/<slug>/wiki` had NO route — it 404'd (the `/events`
 * matcher rejects trailing segments). Shipping a CTA onto a 404 violates the
 * HONEST_STATUS contract, so the CTA is withheld until this route exists.
 *
 * What it does: reads the slug from the path (+ optional `source`/`room` query
 * params), loads the PUBLIC, no-account `events:getPublishedWikiBySlug`, renders
 * the published recap inside the NodeBench shell, and frames it as a conversion
 * moment ("keep this in NodeBench"). No cross-domain session is needed — the
 * slug is in the URL and the query is public.
 *
 * Honesty: unpublished / unknown slug -> a real empty state with a link back to
 * ScratchNode, never a fabricated recap. `bodyHtml` is server-built + public-safe
 * (private notes excluded at publish) and is DOMPurify-sanitized before render.
 *
 * Prior art: pattern mirrors src/features/redesign/surfaces/ScratchnodeEventsSurface.tsx
 * (the existing read-only ScratchNode handoff surface).
 */

import { useMemo } from "react";
import { useQuery } from "convex/react";
import DOMPurify from "dompurify";
import { api } from "../../../../convex/_generated/api";

type PublishedWiki = {
  eventName: string;
  eventSlug: string;
  roomCode: string;
  eventStatus: string;
  title: string;
  bodyHtml: string;
  version: number;
  publishedAt: number | null;
};

const SCRATCHNODE_ORIGIN = "https://scratchnode.live";

function formatDate(ms: number | null): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

interface Props {
  slug: string;
  /** From `?source=scratchnode` — telemetry/attribution only. */
  source?: string | null;
  /** From `?room=<CODE>` — lets "Open in ScratchNode" deep-link the room. */
  roomCode?: string | null;
}

export function ScratchnodeWikiBridge({ slug, roomCode }: Props) {
  const wiki = useQuery(
    // `as any` — getPublishedWikiBySlug may not be in _generated/api.d.ts on this
    // branch yet; codegen runs at deploy (same pattern as ScratchnodeEventsSurface).
    (api as any).events.getPublishedWikiBySlug,
    slug ? { slug } : "skip",
  ) as PublishedWiki | null | undefined;

  const isLoading = wiki === undefined;

  const safeBody = useMemo(
    () => (wiki?.bodyHtml ? DOMPurify.sanitize(wiki.bodyHtml) : ""),
    [wiki?.bodyHtml],
  );

  const publicWikiUrl = `${SCRATCHNODE_ORIGIN}/wiki/${encodeURIComponent(slug)}`;
  // Once the published wiki loads, prefer the server-returned room code over the
  // inbound query param so a stale/tampered `?room=` cannot misdirect the return link.
  const roomJoinTarget = String(wiki?.roomCode || roomCode || slug).toLowerCase();
  const roomUrl = `${SCRATCHNODE_ORIGIN}/e/${encodeURIComponent(roomJoinTarget)}`;

  return (
    <div
      data-testid="scratchnode-wiki-bridge"
      className="rd-stack"
      style={{ padding: "32px 28px 80px", maxWidth: 760, margin: "0 auto", gap: 22 }}
    >
      <header className="rd-stack" style={{ gap: 6 }}>
        <div className="rd-eyebrow">ScratchNode → NodeBench</div>
        <h1 className="rd-h1" style={{ fontSize: 28 }}>
          {wiki?.eventName ? `${wiki.eventName} — recap` : "Event recap"}
        </h1>
        <p className="rd-soft" style={{ fontSize: 14, maxWidth: 640, margin: 0 }}>
          This event’s wiki, brought into NodeBench. The room remembers everything —
          here’s what happened.
        </p>
      </header>

      {isLoading ? (
        <div
          data-testid="scratchnode-wiki-bridge-loading"
          aria-live="polite"
          className="rd-card rd-card__pad rd-faint"
          style={{ textAlign: "center", fontSize: 13 }}
        >
          Loading the event recap…
        </div>
      ) : wiki === null ? (
        <div
          data-testid="scratchnode-wiki-bridge-empty"
          className="rd-card rd-card__pad"
          style={{ textAlign: "center" }}
        >
          <p style={{ fontSize: 14, color: "var(--rd-ink-strong)", margin: "0 0 8px", fontWeight: 500 }}>
            This room hasn’t published its wiki yet.
          </p>
          <p className="rd-soft" style={{ fontSize: 13, margin: "0 0 20px", lineHeight: 1.5 }}>
            When the host publishes the recap, it shows up here. Double-check the link,
            or open the room on ScratchNode.
          </p>
          <a
            href={roomUrl}
            target="_blank"
            rel="noreferrer"
            className="rd-btn rd-btn--primary"
            style={{ display: "inline-flex", padding: "8px 16px", fontSize: 13, fontWeight: 500 }}
          >
            Open in ScratchNode →
          </a>
        </div>
      ) : (
        <>
          <div className="rd-card rd-card__pad rd-stack" style={{ gap: 14 }}>
            <div className="rd-mono" style={{ fontSize: 12, color: "var(--rd-ink-faint)" }}>
              {[
                wiki.title || `${wiki.eventName} Wiki`,
                wiki.roomCode ? `code ${String(wiki.roomCode).toUpperCase()}` : "",
                typeof wiki.version === "number" ? `v${wiki.version}` : "",
                formatDate(wiki.publishedAt) ? `published ${formatDate(wiki.publishedAt)}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {/* bodyHtml is server-built + public-safe (private notes excluded at
                publish) AND DOMPurify-sanitized here — defense in depth. */}
            <div
              data-testid="scratchnode-wiki-bridge-body"
              className="rd-soft"
              style={{ fontSize: 14, lineHeight: 1.62 }}
              dangerouslySetInnerHTML={{ __html: safeBody }}
            />
          </div>

          {/* The conversion moment — keep this recap in NodeBench. */}
          <div
            data-testid="scratchnode-wiki-bridge-upsell"
            className="rd-card rd-card__pad rd-stack"
            style={{ gap: 12, borderColor: "var(--rd-accent)", background: "var(--rd-accent-soft)" }}
          >
            <p style={{ fontSize: 14, color: "var(--rd-ink-strong)", margin: 0, fontWeight: 590 }}>
              Keep this in NodeBench.
            </p>
            <p className="rd-soft" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
              Turn this recap into living operating memory — entities, follow-ups, and a
              workspace that compounds across every event you run.
            </p>
            <div className="rd-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <a
                data-testid="scratchnode-wiki-bridge-cta-nodebench"
                href="/"
                className="rd-btn rd-btn--primary"
                style={{ display: "inline-flex", padding: "8px 16px", fontSize: 13, fontWeight: 500 }}
              >
                Explore NodeBench →
              </a>
              <a
                href={publicWikiUrl}
                target="_blank"
                rel="noreferrer"
                className="rd-btn rd-btn--quiet rd-btn--sm"
              >
                View the public wiki
              </a>
              <a
                href={roomUrl}
                target="_blank"
                rel="noreferrer"
                className="rd-btn rd-btn--quiet rd-btn--sm"
              >
                Open in ScratchNode →
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ScratchnodeWikiBridge;
