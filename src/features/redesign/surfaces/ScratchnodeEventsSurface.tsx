/**
 * ScratchnodeEventsSurface — Step 9: ScratchNode → NodeBench handoff.
 *
 * Audit (2026-05-27, Step 9) lists 6 handoff outputs; this PR ships the
 * first two:
 *   1. ScratchNode event → NodeBench event artifact (this row list)
 *   2. private notes → NodeBench notebook blocks (the per-row expander)
 * The other four (public /ask trace · companies/people/topics · event
 * deltas → daily brief · follow-ups → task layer) are tracked as P1s.
 *
 * Identity model:
 *   - Reads sn_session_id from localStorage (written by scratchnode.live).
 *   - Same id is the convex/notes.ts ownerKey (one Convex deployment).
 *   - No session in this browser → empty state with scratchnode.live CTA.
 *
 * Merge-safe with Step 8 (users table + events:listMyEvents): both PRs
 * share the sessionId/ownerKey path. Order of merge does not matter.
 *
 * Read-only by design. Writer-side handoff is a P1 follow-up.
 */

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { useScratchnodeSessionId } from "../hooks/useScratchnodeSessionId";

type JoinedEvent = {
  eventId: string;
  eventSlug: string;
  eventName: string;
  status: string;
  joinedAt: number;
  lastSeenAt: number;
  role: "attendee" | "host";
  scratchnodeUrl: string;
};

type ListMyJoinedEventsResult = { joined: JoinedEvent[]; _truncated: boolean };

type NoteRow = {
  _id: string;
  title: string;
  bodyHtml: string;
  updatedAt: number;
  pinned: boolean;
};

const formatDate = (ms: number): string => {
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
};

const previewBody = (bodyHtml: string): string => {
  if (!bodyHtml) return "";
  // Strip HTML — preview is text only; full HTML render happens on the
  // detail page where ownerKey was re-validated server-side.
  const text = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
};

interface Props {
  /** Test override; production callers leave undefined. */
  sessionIdOverride?: string | null;
}

export function ScratchnodeEventsSurface({ sessionIdOverride }: Props = {}) {
  const sessionState = useScratchnodeSessionId();
  const effectiveSessionId =
    sessionIdOverride === undefined
      ? sessionState.status === "ready"
        ? sessionState.sessionId
        : null
      : sessionIdOverride;

  const joinedResult = useQuery(
    // `as any` because convex/scratchnodeHandoff.ts may not be in
    // _generated/api.d.ts on this branch yet — codegen runs at deploy.
    (api as any).scratchnodeHandoff.listMyJoinedEvents,
    effectiveSessionId ? { ownerKey: effectiveSessionId } : "skip",
  ) as ListMyJoinedEventsResult | undefined;

  const isLoading = effectiveSessionId !== null && joinedResult === undefined;
  const joined = joinedResult?.joined ?? [];
  const truncated = joinedResult?._truncated ?? false;

  // Header subhead must agree with the body branch — when override is set,
  // "no session" is wrong even before useEffect resolves localStorage.
  const headerState: "loading" | "missing" | "ready" =
    sessionState.status === "loading" && sessionIdOverride === undefined
      ? "loading"
      : effectiveSessionId === null
        ? "missing"
        : "ready";

  return (
    <div
      data-testid="scratchnode-events-surface"
      className="rd-stack"
      style={{ padding: "32px 28px 80px", maxWidth: 920, margin: "0 auto", gap: 24 }}
    >
      <Header state={headerState} eventCount={joined.length} />

      {effectiveSessionId === null && sessionState.status !== "loading" ? (
        <EmptyState
          testid="scratchnode-events-empty-no-session"
          title="No ScratchNode session yet"
          body="Visit scratchnode.live in this browser to join an event. Your private notes will appear here automatically."
          ctaLabel="Open ScratchNode →"
        />
      ) : isLoading ? (
        <Loading />
      ) : joined.length === 0 ? (
        <EmptyState
          testid="scratchnode-events-empty-no-events"
          title="No joined events yet"
          body="Your session is recognized, but you haven't joined any ScratchNode events from this browser. Join one to see it here."
          ctaLabel="Browse events →"
        />
      ) : (
        <>
          <ul
            data-testid="scratchnode-events-list"
            className="rd-stack"
            style={{ listStyle: "none", padding: 0, margin: 0, gap: 12 }}
          >
            {joined.map((event) => (
              <EventRow
                key={event.eventId}
                event={event}
                sessionId={effectiveSessionId ?? ""}
              />
            ))}
          </ul>
          {truncated ? (
            <p className="rd-faint" style={{ textAlign: "center", fontStyle: "italic", fontSize: 12 }}>
              Showing your most recent events. Older memberships are hidden.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function Header({
  state,
  eventCount,
}: {
  state: "loading" | "missing" | "ready";
  eventCount: number;
}) {
  const subhead = useMemo(() => {
    if (state === "loading") return "Loading your ScratchNode session…";
    if (state === "missing") {
      return "No ScratchNode session detected in this browser. Visit scratchnode.live to start one.";
    }
    if (eventCount === 0) {
      return "You haven't joined a ScratchNode event from this browser yet.";
    }
    return `${eventCount} event${eventCount === 1 ? "" : "s"} joined from this browser. Private notes are visible only to you.`;
  }, [state, eventCount]);

  return (
    <header className="rd-stack" style={{ gap: 6 }}>
      <div className="rd-eyebrow">ScratchNode → NodeBench</div>
      <h1 className="rd-h1" style={{ fontSize: 28 }}>Your ScratchNode events</h1>
      <p className="rd-soft" style={{ fontSize: 14, maxWidth: 640, margin: 0 }}>{subhead}</p>
    </header>
  );
}

function EmptyState({
  testid,
  title,
  body,
  ctaLabel,
}: {
  testid: string;
  title: string;
  body: string;
  ctaLabel: string;
}) {
  return (
    <div
      data-testid={testid}
      className="rd-card rd-card__pad"
      style={{ textAlign: "center" }}
    >
      <p style={{ fontSize: 14, color: "var(--rd-ink-strong)", margin: "0 0 12px", fontWeight: 500 }}>
        {title}
      </p>
      <p className="rd-soft" style={{ fontSize: 13, margin: "0 0 20px", lineHeight: 1.5 }}>
        {body}
      </p>
      <a
        href="https://scratchnode.live"
        target="_blank"
        rel="noreferrer"
        className="rd-btn rd-btn--primary"
        style={{ display: "inline-flex", padding: "8px 16px", fontSize: 13, fontWeight: 500 }}
      >
        {ctaLabel}
      </a>
    </div>
  );
}

function Loading() {
  return (
    <div
      data-testid="scratchnode-events-loading"
      aria-live="polite"
      className="rd-card rd-card__pad rd-faint"
      style={{ textAlign: "center", fontSize: 13 }}
    >
      Loading your events…
    </div>
  );
}

function EventRow({
  event,
  sessionId,
}: {
  event: JoinedEvent;
  sessionId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isHost = event.role === "host";

  return (
    <li
      data-testid={`scratchnode-event-row-${event.eventSlug}`}
      className="rd-card rd-card__pad"
    >
      <div className="rd-row--between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div className="rd-stack" style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <div className="rd-row" style={{ gap: 10 }}>
            <h2 style={{ fontSize: 15, fontWeight: 590, color: "var(--rd-ink-strong)", margin: 0, letterSpacing: "-0.005em" }}>
              {event.eventName}
            </h2>
            {/* Role badge: color + text label so color-blind users still
                read role (per .claude/rules/reexamine_a11y.md). */}
            <span
              data-testid={`scratchnode-role-badge-${event.role}`}
              style={{
                display: "inline-flex",
                padding: "2px 8px",
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                borderRadius: 999,
                background: isHost ? "var(--rd-accent-soft)" : "var(--rd-muted)",
                color: isHost ? "var(--rd-accent-strong)" : "var(--rd-ink-soft)",
                border: isHost ? "1px solid var(--rd-accent)" : "1px solid var(--rd-line-faint)",
              }}
            >
              {event.role}
            </span>
            {event.status === "ended" || event.status === "live" ? (
              <span
                style={{
                  display: "inline-flex",
                  padding: "2px 7px",
                  fontSize: 10,
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  borderRadius: 4,
                  background: event.status === "live" ? "var(--rd-accent-soft)" : "var(--rd-muted)",
                  color: event.status === "live" ? "var(--rd-accent-strong)" : "var(--rd-ink-faint)",
                }}
              >
                {event.status}
              </span>
            ) : null}
          </div>
          <p className="rd-mono" style={{ fontSize: 12, color: "var(--rd-ink-faint)", margin: 0 }}>
            Joined {formatDate(event.joinedAt)} · {event.eventSlug}
          </p>
        </div>
        <div className="rd-row" style={{ gap: 8, flexShrink: 0 }}>
          <a
            data-testid={`scratchnode-event-open-${event.eventSlug}`}
            href={event.scratchnodeUrl}
            target="_blank"
            rel="noreferrer"
            className="rd-btn rd-btn--quiet rd-btn--sm"
          >
            Open in ScratchNode →
          </a>
          <button
            type="button"
            data-testid={`scratchnode-event-notes-toggle-${event.eventSlug}`}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="rd-btn rd-btn--quiet rd-btn--sm"
          >
            {expanded ? "Hide notes" : "View private notes"}
          </button>
        </div>
      </div>

      {expanded ? (
        <NotesExpander
          eventId={event.eventId}
          eventSlug={event.eventSlug}
          sessionId={sessionId}
        />
      ) : null}
    </li>
  );
}

function NotesExpander({
  eventId,
  eventSlug,
  sessionId,
}: {
  eventId: string;
  eventSlug: string;
  sessionId: string;
}) {
  // notes:listMyNotes server-validates ownerKey === note.ownerKey; we
  // trust the server filter (NOT a client-side .filter).
  const notes = useQuery((api as any).notes.listMyNotes, {
    ownerKey: sessionId,
    eventId,
  }) as NoteRow[] | undefined;

  return (
    <div
      data-testid={`scratchnode-notes-expander-${eventSlug}`}
      className="rd-stack"
      style={{
        marginTop: 14,
        paddingTop: 14,
        borderTop: "1px dashed var(--rd-line-faint)",
        gap: 8,
      }}
    >
      {notes === undefined ? (
        <p className="rd-faint" style={{ fontSize: 12, margin: 0 }} aria-live="polite">
          Loading your private notes…
        </p>
      ) : notes.length === 0 ? (
        <p
          data-testid={`scratchnode-notes-empty-${eventSlug}`}
          className="rd-faint"
          style={{ fontSize: 12, margin: 0 }}
        >
          No private notes for this event yet.
        </p>
      ) : (
        <ul
          data-testid={`scratchnode-notes-list-${eventSlug}`}
          className="rd-stack"
          style={{ listStyle: "none", padding: 0, margin: 0, gap: 8 }}
        >
          {notes.map((note) => (
            <li key={note._id}>
              <Link
                to={`/scratchnode-event/${encodeURIComponent(eventId)}/notes/${encodeURIComponent(note._id)}`}
                data-testid={`scratchnode-note-link-${note._id}`}
                style={{
                  display: "block",
                  padding: "10px 12px",
                  border: "1px solid var(--rd-line-faint)",
                  borderRadius: 8,
                  background: "var(--rd-panel)",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div className="rd-row" style={{ alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 590, color: "var(--rd-ink-strong)" }}>
                    {note.title || "Untitled"}
                  </span>
                  {note.pinned ? (
                    <span style={{ fontSize: 9, color: "var(--rd-accent-strong)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
                      Pinned
                    </span>
                  ) : null}
                  <span className="rd-mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--rd-ink-faint)" }}>
                    {formatDate(note.updatedAt)}
                  </span>
                </div>
                <p className="rd-soft" style={{ fontSize: 12, margin: 0, lineHeight: 1.45 }}>
                  {previewBody(note.bodyHtml) || (
                    <em className="rd-faint">(No body content)</em>
                  )}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
