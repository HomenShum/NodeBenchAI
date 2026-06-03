/**
 * ScratchnodePrivateBridge — the REAL cross-domain ScratchNode → NodeBench
 * PRIVATE-NOTES receiving surface for `/events/:slug/private?token=<token>`.
 *
 * THE PROBLEM (roadmap item #4, security-critical capstone)
 *   A guest's private notes on scratchnode.live are owner-keyed by
 *   `sn_session_id` in localStorage, which is ORIGIN-PARTITIONED — so this app
 *   (nodebenchai.com) physically cannot read it. ScratchNode mints a SERVER-ONLY
 *   opaque token bound to {event, session}, and ONLY that token travels in the
 *   URL. This surface redeems it.
 *
 * WHAT IT DOES
 *   Reads `?token=` from the URL, calls the `scratchnodeHandoff:consumeEventHandoffToken`
 *   MUTATION exactly once on mount (it's a mutation, not a query, because consume
 *   burns a use), and renders the bound session's private notes READ-ONLY inside
 *   the NodeBench shell with a "sign in to keep these" conversion affordance.
 *
 * HONESTY / SECURITY (non-negotiable)
 *   - FAIL-CLOSED: unknown / expired / used-up / wrong-scope token → a real,
 *     honest state (never a fabricated note). Each maps to a distinct message.
 *   - The token and the session id are NEVER rendered and NEVER logged. The
 *     token is consumed once, then dropped from component state.
 *   - bodyHtml is DOMPurify-sanitized before render (defense in depth — these
 *     notes are the user's OWN rich text, but the main app must never eval it).
 *   - The `?token=` is stripped from the address bar after redemption (history
 *     hygiene) so a leaked URL is even less useful.
 *
 * Prior art: mirrors src/features/events/views/ScratchnodeWikiBridge.tsx (the
 * public wiki receiving surface) — same rd-* shell, same conversion frame.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import DOMPurify from "dompurify";
import { api } from "../../../../convex/_generated/api";

type HandoffNote = {
  noteId: string;
  title: string;
  bodyHtml: string;
  tags: string[];
  pinned: boolean;
  isAsk: boolean;
  createdAt: number;
  updatedAt: number;
};

type ConsumeResult = {
  eventName: string;
  eventSlug: string;
  roomCode: string;
  scope: "private_notes_read";
  noteCount: number;
  notes: HandoffNote[];
  _truncated: boolean;
};

const SCRATCHNODE_ORIGIN = "https://scratchnode.live";

// Map the backend's fail-closed ConvexError codes to honest, human copy.
// Unknown codes collapse to the generic invalid message — never a fake success.
const ERROR_COPY: Record<string, { title: string; detail: string }> = {
  invalid_token: {
    title: "This continuation link is invalid",
    detail:
      "The link may be incomplete, already used, or from a different room. Re-open it from ScratchNode to try again.",
  },
  token_expired: {
    title: "This continuation link has expired",
    detail:
      "Links are short-lived for your security. Head back to the room on ScratchNode and tap “Continue in NodeBench” again.",
  },
  token_used: {
    title: "This continuation link was already used",
    detail:
      "For your security each link is single-use. Re-open it from ScratchNode to bring your notes over again.",
  },
  invalid_scope: {
    title: "This link doesn’t grant access to private notes",
    detail: "Re-open the handoff from the ScratchNode room to continue your notes.",
  },
  event_not_found: {
    title: "That event no longer exists",
    detail: "The room this link points to is gone. Nothing to bring over.",
  },
};

const GENERIC_ERROR = {
  title: "We couldn’t open your notes",
  detail:
    "Something went wrong redeeming this link. Re-open it from ScratchNode, or sign in to NodeBench to keep your notes.",
};

function readErrorCode(err: unknown): string {
  // Convex serializes ConvexError as `{ data: { code } }`. Be defensive — never
  // surface a raw error string (which could echo input) to the user.
  const data = (err as { data?: { code?: unknown } } | undefined)?.data;
  const code = data && typeof data.code === "string" ? data.code : "";
  return code;
}

function formatDate(ms: number): string {
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
  /** The opaque handoff token from `?token=`. Consumed once, never rendered. */
  token: string | null;
  /** From `?room=<CODE>` — lets "Open in ScratchNode" deep-link the room. */
  roomCode?: string | null;
}

type Phase = "redeeming" | "ready" | "error" | "no_token";

export function ScratchnodePrivateBridge({ slug, token, roomCode }: Props) {
  const consume = useMutation(
    // `as any` — consumeEventHandoffToken may not be in _generated/api.d.ts on
    // this branch yet; codegen runs at deploy (same pattern as the wiki bridge).
    (api as any).scratchnodeHandoff.consumeEventHandoffToken,
  );

  const [phase, setPhase] = useState<Phase>(token ? "redeeming" : "no_token");
  const [result, setResult] = useState<ConsumeResult | null>(null);
  const [errorCode, setErrorCode] = useState<string>("");
  // Guard against React 18 StrictMode double-invoke + re-renders: consume EXACTLY
  // once. A second call would needlessly burn another use of the (low-use) token.
  const redeemedRef = useRef(false);

  useEffect(() => {
    if (!token) {
      setPhase("no_token");
      return;
    }
    if (redeemedRef.current) return;
    redeemedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const res = (await consume({ token })) as ConsumeResult;
        if (cancelled) return;
        setResult(res);
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        setErrorCode(readErrorCode(err));
        setPhase("error");
      } finally {
        // History hygiene: drop the token from the address bar regardless of
        // outcome so it can't be re-shared / re-read from history. Best-effort.
        try {
          const url = new URL(window.location.href);
          if (url.searchParams.has("token")) {
            url.searchParams.delete("token");
            window.history.replaceState({}, "", url.toString());
          }
        } catch {
          /* no-op — replaceState can fail in exotic embeds; not fatal */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // consume identity is stable; token drives the single redemption.
  }, [token, consume]);

  const roomUrl = `${SCRATCHNODE_ORIGIN}/e/${encodeURIComponent(
    String(roomCode || result?.roomCode || slug).toLowerCase(),
  )}`;

  return (
    <div
      data-testid="scratchnode-private-bridge"
      className="rd-stack"
      style={{ padding: "32px 28px 80px", maxWidth: 760, margin: "0 auto", gap: 22 }}
    >
      <header className="rd-stack" style={{ gap: 6 }}>
        <div className="rd-eyebrow">ScratchNode → NodeBench</div>
        <h1 className="rd-h1" style={{ fontSize: 28 }}>
          {result?.eventName ? `${result.eventName} — your notes` : "Your private notes"}
        </h1>
        <p className="rd-soft" style={{ fontSize: 14, maxWidth: 640, margin: 0 }}>
          Private notes you took in the room, brought into NodeBench. Only you can see these.
        </p>
      </header>

      {phase === "redeeming" && (
        <div
          data-testid="scratchnode-private-bridge-loading"
          aria-live="polite"
          className="rd-card rd-card__pad rd-faint"
          style={{ textAlign: "center", fontSize: 13 }}
        >
          Bringing your private notes over…
        </div>
      )}

      {phase === "no_token" && (
        <div
          data-testid="scratchnode-private-bridge-no-token"
          className="rd-card rd-card__pad"
          style={{ textAlign: "center" }}
        >
          <p style={{ fontSize: 14, color: "var(--rd-ink-strong)", margin: "0 0 8px", fontWeight: 500 }}>
            This link is missing its continuation token.
          </p>
          <p className="rd-soft" style={{ fontSize: 13, margin: "0 0 20px", lineHeight: 1.5 }}>
            Open “Continue in NodeBench” from the ScratchNode room to bring your private notes over.
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
      )}

      {phase === "error" && (() => {
        const copy = ERROR_COPY[errorCode] ?? GENERIC_ERROR;
        return (
          <div
            data-testid="scratchnode-private-bridge-error"
            data-error-code={errorCode || "unknown"}
            className="rd-card rd-card__pad"
            style={{ textAlign: "center" }}
          >
            <p style={{ fontSize: 14, color: "var(--rd-ink-strong)", margin: "0 0 8px", fontWeight: 500 }}>
              {copy.title}
            </p>
            <p className="rd-soft" style={{ fontSize: 13, margin: "0 0 20px", lineHeight: 1.5 }}>
              {copy.detail}
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
        );
      })()}

      {phase === "ready" && result && (
        <>
          {result.notes.length === 0 ? (
            <div
              data-testid="scratchnode-private-bridge-empty"
              className="rd-card rd-card__pad"
              style={{ textAlign: "center" }}
            >
              <p style={{ fontSize: 14, color: "var(--rd-ink-strong)", margin: "0 0 8px", fontWeight: 500 }}>
                No private notes from this room yet.
              </p>
              <p className="rd-soft" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                Notes you take in the room show up here. Head back to keep going.
              </p>
            </div>
          ) : (
            <div className="rd-stack" style={{ gap: 14 }}>
              <div className="rd-mono" style={{ fontSize: 12, color: "var(--rd-ink-faint)" }}>
                {[
                  `${result.noteCount} private note${result.noteCount === 1 ? "" : "s"}`,
                  result.roomCode ? `code ${String(result.roomCode).toUpperCase()}` : "",
                  "read-only",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {result._truncated ? " · showing the first 200" : ""}
              </div>
              {result.notes.map((note) => (
                <NoteCard key={note.noteId} note={note} />
              ))}
            </div>
          )}

          {/* The conversion moment — sign in to keep these private notes. */}
          <div
            data-testid="scratchnode-private-bridge-upsell"
            className="rd-card rd-card__pad rd-stack"
            style={{ gap: 12, borderColor: "var(--rd-accent)", background: "var(--rd-accent-soft)" }}
          >
            <p style={{ fontSize: 14, color: "var(--rd-ink-strong)", margin: 0, fontWeight: 590 }}>
              Sign in to keep these.
            </p>
            <p className="rd-soft" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
              Right now these live only on the room’s session. Sign in to save them to your NodeBench
              workspace — searchable, linked to entities, and yours across every event.
            </p>
            <div className="rd-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <a
                data-testid="scratchnode-private-bridge-cta-signin"
                href="/sign-in?intent=save-private-notes"
                className="rd-btn rd-btn--primary"
                style={{ display: "inline-flex", padding: "8px 16px", fontSize: 13, fontWeight: 500 }}
              >
                Sign in to keep these →
              </a>
              <a
                href={roomUrl}
                target="_blank"
                rel="noreferrer"
                className="rd-btn rd-btn--quiet rd-btn--sm"
              >
                Back to ScratchNode →
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function NoteCard({ note }: { note: HandoffNote }) {
  // Sanitize the owner's own rich text before injecting into the main app DOM.
  const safe = DOMPurify.sanitize(note.bodyHtml || "");
  return (
    <article
      data-testid="scratchnode-private-bridge-note"
      className="rd-card rd-card__pad rd-stack"
      style={{ gap: 8 }}
    >
      <div className="rd-row" style={{ justifyContent: "space-between", gap: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "var(--rd-ink-strong)" }}>
          {note.pinned ? "📌 " : ""}
          {note.title || "Untitled"}
        </h2>
        <span className="rd-mono" style={{ fontSize: 11, color: "var(--rd-ink-faint)", whiteSpace: "nowrap" }}>
          {formatDate(note.updatedAt)}
        </span>
      </div>
      {/* bodyHtml is the owner's own note text, DOMPurify-sanitized here. */}
      <div
        data-testid="scratchnode-private-bridge-note-body"
        className="rd-soft"
        style={{ fontSize: 14, lineHeight: 1.6 }}
        dangerouslySetInnerHTML={{ __html: safe }}
      />
      {note.tags.length > 0 && (
        <div className="rd-row" style={{ gap: 6, flexWrap: "wrap" }}>
          {note.tags.map((tag) => (
            <span
              key={tag}
              className="rd-mono"
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                background: "var(--rd-surface-2, rgba(255,255,255,0.04))",
                color: "var(--rd-ink-faint)",
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

export default ScratchnodePrivateBridge;
