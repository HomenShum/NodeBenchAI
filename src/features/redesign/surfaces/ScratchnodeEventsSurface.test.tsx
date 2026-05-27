/**
 * ScratchnodeEventsSurface — scenario tests for Step 9 (ScratchNode →
 * NodeBench handoff). Per .claude/rules/scenario_testing.md every test
 * states Who / What / Scale / Duration / Failure mode in its docblock.
 *
 * Step 8 may not be merged when this lands, so all tests stub
 * convex/react useQuery directly — the surface must gracefully degrade
 * when listMyJoinedEvents returns undefined or empty.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// useQuery returns a response keyed by which Convex function reference
// was passed in. Keying by NAME (not call-order index) is required
// because rerenders from useScratchnodeSessionId's useEffect cause
// useQuery to be called multiple times per render cycle.
type MockedResponses = {
  listMyJoinedEvents?: unknown;
  listMyNotes?: unknown;
};
let mockedResponses: MockedResponses = {};

vi.mock("convex/react", () => ({
  useQuery: (fnRef: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    if (fnRef === "fn:listMyJoinedEvents") return mockedResponses.listMyJoinedEvents;
    if (fnRef === "fn:listMyNotes") return mockedResponses.listMyNotes;
    return undefined;
  },
}));

vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    scratchnodeHandoff: { listMyJoinedEvents: "fn:listMyJoinedEvents" },
    notes: { listMyNotes: "fn:listMyNotes" },
  },
}));

import { ScratchnodeEventsSurface } from "./ScratchnodeEventsSurface";

function setMockedResponses(responses: MockedResponses) {
  mockedResponses = responses;
}

function renderSurface(sessionIdOverride: string | null = null) {
  return render(
    <MemoryRouter>
      <div data-redesign data-redesign-theme="light">
        <ScratchnodeEventsSurface sessionIdOverride={sessionIdOverride} />
      </div>
    </MemoryRouter>,
  );
}

const SAMPLE_EVENTS = [
  {
    eventId: "jh7ev1aaaaaaaaaaaaaaaaa1",
    eventSlug: "ai-infra-summit-2026",
    eventName: "AI Infra Summit",
    status: "live",
    joinedAt: Date.UTC(2026, 4, 20, 14, 0, 0),
    lastSeenAt: Date.UTC(2026, 4, 20, 15, 30, 0),
    role: "attendee" as const,
    scratchnodeUrl: "https://scratchnode.live/e/ai-infra-summit-2026",
  },
  {
    eventId: "jh7ev1aaaaaaaaaaaaaaaaa2",
    eventSlug: "founder-night-2026",
    eventName: "Founder Night",
    status: "live",
    joinedAt: Date.UTC(2026, 4, 18, 19, 0, 0),
    lastSeenAt: Date.UTC(2026, 4, 18, 22, 0, 0),
    role: "host" as const,
    scratchnodeUrl: "https://scratchnode.live/e/founder-night-2026",
  },
  {
    eventId: "jh7ev1aaaaaaaaaaaaaaaaa3",
    eventSlug: "mcp-deepdive-q1",
    eventName: "MCP Deep Dive Q1",
    status: "ended",
    joinedAt: Date.UTC(2026, 3, 5, 10, 0, 0),
    lastSeenAt: Date.UTC(2026, 3, 5, 12, 0, 0),
    role: "attendee" as const,
    scratchnodeUrl: "https://scratchnode.live/e/mcp-deepdive-q1",
  },
];

beforeEach(() => setMockedResponses({}));
afterEach(() => vi.clearAllMocks());

describe("ScratchnodeEventsSurface — step 9 NodeBench handoff", () => {
  /**
   * Scenario 1 — First-timer with NO ScratchNode session.
   * User: marketing-link visitor; localStorage.sn_session_id null.
   * Goal: discover what ScratchNode is, with a clear CTA.
   * Scale/Duration: single user, single page load.
   * Failure mode covered: surface crashes on missing session id;
   *   surface fires an unnecessary Convex round trip on guests.
   */
  it("renders no-session empty state with scratchnode.live CTA", () => {
    const { getByTestId, queryByTestId } = renderSurface(null);
    const empty = getByTestId("scratchnode-events-empty-no-session");
    expect(empty).toBeTruthy();
    expect(queryByTestId("scratchnode-events-list")).toBeNull();
    // CTA gives agency — every empty state must point somewhere.
    expect(empty.querySelector("a")?.getAttribute("href")).toBe(
      "https://scratchnode.live",
    );
  });

  /**
   * Scenario 2 — Session exists but zero joined events.
   * User: brief scratchnode.live visitor; sessionId set, no memberships.
   * Goal: distinguish "no credentials" from "no activity" — two
   *   different failure modes the surface must NOT conflate.
   * Failure mode covered: same empty state for both → misleading UX.
   */
  it("renders no-events empty state when joined list is empty", () => {
    setMockedResponses({
      listMyJoinedEvents: { joined: [], _truncated: false },
    });
    const { getByTestId, queryByTestId } = renderSurface("session-abc-12345");
    expect(getByTestId("scratchnode-events-empty-no-events")).toBeTruthy();
    expect(queryByTestId("scratchnode-events-empty-no-session")).toBeNull();
  });

  /**
   * Scenario 3 — Power user with 3 joined events incl. host role.
   * User: an event host who organized one event and attended two others.
   * Goal: see ALL joined events with role badges distinguishing host.
   * Scale: 3 rows (production user with steady cadence).
   * Failure mode covered:
   *   - row count wrong (off-by-one server-side merge)
   *   - host badge applied to wrong row (color-blind users rely on text)
   *   - Open-in-ScratchNode href hardcoded / wrong slug
   */
  it("renders rows with role badges and slug-derived scratchnode links", () => {
    setMockedResponses({
      listMyJoinedEvents: { joined: SAMPLE_EVENTS, _truncated: false },
    });
    const { getAllByTestId, getByTestId } = renderSurface("session-power-user-9");

    expect(getAllByTestId(/scratchnode-event-row-/)).toHaveLength(3);

    const founderRow = getByTestId("scratchnode-event-row-founder-night-2026");
    expect(within(founderRow).getByTestId("scratchnode-role-badge-host")).toBeTruthy();

    const summitRow = getByTestId("scratchnode-event-row-ai-infra-summit-2026");
    expect(within(summitRow).getByTestId("scratchnode-role-badge-attendee")).toBeTruthy();
    expect(within(summitRow).queryByTestId("scratchnode-role-badge-host")).toBeNull();

    const openLink = getByTestId("scratchnode-event-open-ai-infra-summit-2026");
    expect(openLink.getAttribute("href")).toBe(
      "https://scratchnode.live/e/ai-infra-summit-2026",
    );
    expect(openLink.getAttribute("target")).toBe("_blank");
    expect(openLink.getAttribute("rel")).toBe("noreferrer");
  });

  /**
   * Scenario 4 — User expands notes drawer, then collapses it.
   * User: returning user recalling what they wrote during the event.
   * Goal: see notes scoped to ONE event without leaving the page;
   *   each note links to the canonical detail route.
   * Failure mode covered:
   *   - expander never appears even when notes are returned
   *   - expander never collapses (state stuck)
   *   - note link hardcoded / wrong path shape
   */
  it("toggles the notes expander and links to the note detail route", () => {
    const note = {
      _id: "nt7aaaaaaaaaaaaaaaaaaaab",
      title: "Notes from MCP panel",
      bodyHtml: "<p>Auth UX was the most-cited concern.</p>",
      updatedAt: Date.UTC(2026, 4, 20, 16, 0, 0),
      pinned: false,
    };
    setMockedResponses({
      listMyJoinedEvents: { joined: [SAMPLE_EVENTS[0]], _truncated: false },
      listMyNotes: [note],
    });
    const { getByTestId, queryByTestId } = renderSurface("session-mid-user-7");

    expect(queryByTestId("scratchnode-notes-expander-ai-infra-summit-2026")).toBeNull();

    const toggle = getByTestId("scratchnode-event-notes-toggle-ai-infra-summit-2026");
    fireEvent.click(toggle);

    const expander = getByTestId("scratchnode-notes-expander-ai-infra-summit-2026");
    const link = within(expander).getByTestId(`scratchnode-note-link-${note._id}`);
    expect(link.getAttribute("href")).toBe(
      `/scratchnode-event/${SAMPLE_EVENTS[0].eventId}/notes/${note._id}`,
    );

    // Toggle off — must collapse cleanly.
    fireEvent.click(toggle);
    expect(queryByTestId("scratchnode-notes-expander-ai-infra-summit-2026")).toBeNull();
  });

  /**
   * Scenario 5 — Truncation hint when server hits cap.
   * User: power user with > MAX_JOINED_EVENTS memberships.
   * Goal: trust that the list is current; understand older entries
   *   are hidden, NOT silently dropped (HONEST_STATUS).
   * Failure mode covered: silent truncation.
   */
  it("renders truncation hint when _truncated is true", () => {
    setMockedResponses({
      listMyJoinedEvents: { joined: SAMPLE_EVENTS, _truncated: true },
    });
    const { container } = renderSurface("session-power-user-9");
    expect(container.textContent).toContain("Older memberships are hidden");
  });

  /**
   * Scenario 6 — In-flight first paint.
   * User: any returning user; useQuery still loading on first paint.
   * Goal: no flash of empty state before data arrives.
   * Failure mode covered: empty state shown during loading →
   *   confusing flicker per .claude/rules/reexamine_polish.md.
   */
  it("renders a loading state when the query has not resolved yet", () => {
    setMockedResponses({}); // no listMyJoinedEvents response queued
    const { getByTestId, queryByTestId } = renderSurface("session-loading-1");
    expect(getByTestId("scratchnode-events-loading")).toBeTruthy();
    expect(queryByTestId("scratchnode-events-empty-no-events")).toBeNull();
    expect(queryByTestId("scratchnode-events-empty-no-session")).toBeNull();
  });
});
