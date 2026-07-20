/**
 * ScratchnodeNoteDetailPage — read-only view of a single ScratchNode private
 * note inside NodeBench. Route: /scratchnode-event/:eventId/notes/:noteId
 *
 * Read-only by design (Step 9 scope). Writer-side handoff is a P1 follow-up.
 *
 * Security: notes:getNote validates ownerKey === note.ownerKey server-side
 * and returns null when not found OR not owned (deliberately
 * indistinguishable to prevent existence enumeration). bodyHtml is rendered
 * via dangerouslySetInnerHTML ONLY because it's the user's own content,
 * gated by ownerKey on read, sanitized by ScratchNode at write time.
 */

import { useQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import { useScratchnodeSessionId } from "../hooks/useScratchnodeSessionId";

type NoteDetail = {
  _id: string;
  title: string;
  bodyHtml: string;
  eventId?: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
};

const formatDate = (ms: number): string => {
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

export function ScratchnodeNoteDetailPage() {
  const { eventId, noteId } = useParams<{ eventId: string; noteId: string }>();
  const sessionState = useScratchnodeSessionId();
  const sessionId =
    sessionState.status === "ready" ? sessionState.sessionId : null;

  const note = useQuery(
    (api as any).notes.getNote,
    sessionId && noteId ? { ownerKey: sessionId, noteId } : "skip",
  ) as NoteDetail | null | undefined;

  return (
    <div
      data-testid="scratchnode-note-detail-page"
      data-redesign
      style={{
        minHeight: "100dvh",
        background: "var(--rd-paper)",
        padding: "48px 24px 80px",
      }}
    >
      <div className="rd-stack" style={{ maxWidth: 720, margin: "0 auto", gap: 24 }}>
        <nav
          aria-label="Breadcrumb"
          className="rd-row rd-mono"
          style={{ gap: 8, fontSize: 12, color: "var(--rd-ink-faint)" }}
        >
          <Link
            to="/scratchnode-events"
            data-testid="scratchnode-note-back-link"
            style={{ color: "var(--rd-accent-strong)", textDecoration: "none" }}
          >
            ← Your ScratchNode events
          </Link>
          {eventId ? (
            <>
              <span>/</span>
              <span>private note</span>
            </>
          ) : null}
        </nav>

        {sessionState.status === "loading" ? (
          <p className="rd-faint" style={{ fontSize: 14 }} aria-live="polite">
            Loading your session…
          </p>
        ) : sessionId === null ? (
          <NoSessionCard />
        ) : note === undefined ? (
          <p className="rd-faint" style={{ fontSize: 14 }} aria-live="polite">
            Loading note…
          </p>
        ) : note === null ? (
          <NotFoundCard />
        ) : (
          <NoteArticle note={note} />
        )}
      </div>
    </div>
  );
}

function NoSessionCard() {
  return (
    <div
      data-testid="scratchnode-note-no-session"
      className="rd-card rd-card__pad"
      style={{ textAlign: "center" }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 590, color: "var(--rd-ink-strong)", margin: "0 0 8px" }}>
        Sign in to ScratchNode first
      </h1>
      <p className="rd-soft" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
        Your browser has no ScratchNode session, so private notes can't be loaded. Visit{" "}
        <a href="https://scratchnode.live" target="_blank" rel="noreferrer" style={{ color: "var(--rd-accent-strong)" }}>
          scratchnode.live
        </a>{" "}
        to start a session.
      </p>
    </div>
  );
}

function NotFoundCard() {
  return (
    <div
      data-testid="scratchnode-note-not-found"
      className="rd-card rd-card__pad"
      style={{ textAlign: "center" }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 590, color: "var(--rd-ink-strong)", margin: "0 0 8px" }}>
        Note not found
      </h1>
      <p className="rd-soft" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
        This note doesn't exist, or it isn't owned by the ScratchNode session in this browser.
        (We deliberately don't distinguish between the two, to prevent enumeration.)
      </p>
    </div>
  );
}

function NoteArticle({ note }: { note: NoteDetail }) {
  return (
    <article data-testid="scratchnode-note-body" className="rd-stack" style={{ gap: 20 }}>
      <header className="rd-stack" style={{ gap: 6 }}>
        <p className="rd-mono" style={{ fontSize: 11, color: "var(--rd-ink-faint)", margin: 0, letterSpacing: "0.04em" }}>
          Private note · created {formatDate(note.createdAt)} · updated {formatDate(note.updatedAt)}
        </p>
        <h1 style={{ fontSize: 26, fontWeight: 600, color: "var(--rd-ink-strong)", margin: 0, letterSpacing: "-0.01em" }}>
          {note.title || "Untitled"}
        </h1>
        {note.tags && note.tags.length > 0 ? (
          <ul
            data-testid="scratchnode-note-tags"
            className="rd-row"
            style={{ flexWrap: "wrap", gap: 6, listStyle: "none", padding: 0, margin: "4px 0 0" }}
          >
            {note.tags.map((tag) => (
              <li
                key={tag}
                className="rd-mono"
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "var(--rd-muted)",
                  color: "var(--rd-ink-soft)",
                }}
              >
                #{tag}
              </li>
            ))}
          </ul>
        ) : null}
      </header>
      {/* Read-only render. bodyHtml is owner-gated on every read and
          sanitized at write time by ScratchNode. Editing is P1. */}
      <div
        data-testid="scratchnode-note-html"
        style={{ fontSize: 14, lineHeight: 1.7, color: "var(--rd-ink-strong)" }}
        dangerouslySetInnerHTML={{ __html: note.bodyHtml || "" }}
      />
    </article>
  );
}
