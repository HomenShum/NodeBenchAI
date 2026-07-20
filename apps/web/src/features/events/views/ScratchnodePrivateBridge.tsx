/**
 * ScratchnodePrivateBridge — the NodeBench receiving surface for
 * `/events/:slug/private?token=…`, the cross-domain private-notes handoff (#4).
 *
 * A ScratchNode member mints an opaque token on scratchnode.live (after a
 * membership check) that carries a READ-ONLY snapshot of their private notes for
 * that event. Only the opaque token travels in the URL. This surface consumes it
 * fail-closed and renders the notes read-only, with a "sign in to keep these"
 * affordance. It NEVER displays or logs the token, and the raw session id never
 * existed on this side.
 *
 * Honesty: invalid / expired / used-up token → a real, specific empty state,
 * never a fabricated note. bodyHtml is DOMPurify-sanitized before render.
 *
 * Prior art: mirrors src/features/events/views/ScratchnodeWikiBridge.tsx.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import DOMPurify from "dompurify";
import { api } from "@convex/_generated/api";

type NoteSnapshot = { title: string; bodyHtml: string; pinned: boolean; updatedAt: number };
type ConsumeResult =
  | { ok: true; eventName: string; eventSlug: string; noteCount: number; notes: NoteSnapshot[] }
  | { ok: false; reason: "invalid" | "expired" | "used_up" };

const SCRATCHNODE_ORIGIN = "https://scratchnode.live";

const REASON_COPY: Record<string, { head: string; sub: string }> = {
  invalid: { head: "This handoff link isn’t valid.", sub: "It may be incomplete or already replaced. Open the room on ScratchNode and continue again." },
  expired: { head: "This handoff link has expired.", sub: "Private-notes links are short-lived for your security. Re-open the handoff from the room." },
  used_up: { head: "This handoff link has been used up.", sub: "For your security each link is single-use-ish. Re-open the handoff from the room." },
};

function fmtDate(ms: number): string {
  try { return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return ""; }
}

interface Props {
  slug: string;
  token: string | null;
}

export function ScratchnodePrivateBridge({ slug, token }: Props) {
  const consume = useMutation((api as any).eventHandoff.consumeEventHandoffToken);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [result, setResult] = useState<ConsumeResult | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setResult({ ok: false, reason: "invalid" });
      setState("error");
      return;
    }
    consume({ token })
      .then((r: ConsumeResult) => {
        setResult(r);
        setState(r && r.ok ? "ok" : "error");
      })
      .catch(() => {
        setResult({ ok: false, reason: "invalid" });
        setState("error");
      });
  }, [token, consume]);

  const roomUrl = `${SCRATCHNODE_ORIGIN}/e/${encodeURIComponent(String(slug || "").toLowerCase())}`;
  const notes = result && result.ok ? result.notes : [];
  const safeNotes = useMemo(
    () => notes.map((n) => ({ ...n, safeBody: n.bodyHtml ? DOMPurify.sanitize(n.bodyHtml) : "" })),
    [notes],
  );

  return (
    <div
      data-testid="scratchnode-private-bridge"
      className="rd-stack"
      style={{ padding: "32px 28px 80px", maxWidth: 760, margin: "0 auto", gap: 22 }}
    >
      <header className="rd-stack" style={{ gap: 6 }}>
        <div className="rd-eyebrow">ScratchNode → NodeBench · private</div>
        <h1 className="rd-h1" style={{ fontSize: 28 }}>
          {state === "ok" && result && result.ok ? `${result.eventName} — your notes` : "Your private notes"}
        </h1>
        <p className="rd-soft" style={{ fontSize: 14, maxWidth: 640, margin: 0 }}>
          Your private notes from this event, brought into NodeBench. Only you, with this
          link, can see them — they’re read-only here.
        </p>
      </header>

      {state === "loading" ? (
        <div data-testid="scratchnode-private-loading" aria-live="polite" className="rd-card rd-card__pad rd-faint" style={{ textAlign: "center", fontSize: 13 }}>
          Unlocking your private notes…
        </div>
      ) : state === "error" && result && !result.ok ? (
        <div data-testid="scratchnode-private-error" className="rd-card rd-card__pad" style={{ textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "var(--rd-ink-strong)", margin: "0 0 8px", fontWeight: 500 }}>
            {(REASON_COPY[result.reason] || REASON_COPY.invalid).head}
          </p>
          <p className="rd-soft" style={{ fontSize: 13, margin: "0 0 20px", lineHeight: 1.5 }}>
            {(REASON_COPY[result.reason] || REASON_COPY.invalid).sub}
          </p>
          <a href={roomUrl} target="_blank" rel="noreferrer" className="rd-btn rd-btn--primary" style={{ display: "inline-flex", padding: "8px 16px", fontSize: 13, fontWeight: 500 }}>
            Open the room on ScratchNode →
          </a>
        </div>
      ) : safeNotes.length === 0 ? (
        <div data-testid="scratchnode-private-empty" className="rd-card rd-card__pad" style={{ textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "var(--rd-ink-strong)", margin: "0 0 8px", fontWeight: 500 }}>
            No private notes for this event yet.
          </p>
          <p className="rd-soft" style={{ fontSize: 13, margin: "0 0 20px", lineHeight: 1.5 }}>
            Lock the composer in the room to jot a private note — it’ll be here next time.
          </p>
          <a href={roomUrl} target="_blank" rel="noreferrer" className="rd-btn rd-btn--quiet rd-btn--sm">Open in ScratchNode →</a>
        </div>
      ) : (
        <>
          <ul data-testid="scratchnode-private-list" className="rd-stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 12 }}>
            {safeNotes.map((n, i) => (
              <li key={i} className="rd-card rd-card__pad">
                <div className="rd-row" style={{ alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 590, color: "var(--rd-ink-strong)" }}>{n.title || "Untitled note"}</span>
                  {n.pinned ? (
                    <span style={{ fontSize: 9, color: "var(--rd-accent-strong)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Pinned</span>
                  ) : null}
                  <span className="rd-mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--rd-ink-faint)" }}>{fmtDate(n.updatedAt)}</span>
                </div>
                <div className="rd-soft" style={{ fontSize: 13, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: n.safeBody }} />
              </li>
            ))}
          </ul>
          <div data-testid="scratchnode-private-upsell" className="rd-card rd-card__pad rd-stack" style={{ gap: 12, borderColor: "var(--rd-accent)", background: "var(--rd-accent-soft)" }}>
            <p style={{ fontSize: 14, color: "var(--rd-ink-strong)", margin: 0, fontWeight: 590 }}>Keep these in NodeBench.</p>
            <p className="rd-soft" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
              Sign in to save this event’s notes to your workspace — they become editable, searchable operating memory instead of a one-time read.
            </p>
            <div className="rd-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <a data-testid="scratchnode-private-cta" href="/" className="rd-btn rd-btn--primary" style={{ display: "inline-flex", padding: "8px 16px", fontSize: 13, fontWeight: 500 }}>
                Sign in to keep these →
              </a>
              <a href={roomUrl} target="_blank" rel="noreferrer" className="rd-btn rd-btn--quiet rd-btn--sm">Open in ScratchNode →</a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ScratchnodePrivateBridge;
