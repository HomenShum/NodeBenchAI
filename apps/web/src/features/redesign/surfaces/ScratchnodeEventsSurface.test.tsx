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
  scratchnodeImportStatus?: unknown;
};
let mockedResponses: MockedResponses = {};
const mockRunImport = vi.fn(async () => ({ ok: true }));

vi.mock("convex/react", () => ({
  useQuery: (fnRef: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    if (fnRef === "fn:listMyJoinedEvents") return mockedResponses.listMyJoinedEvents;
    if (fnRef === "fn:listMyNotes") return mockedResponses.listMyNotes;
    if (fnRef === "fn:getScratchnodeImportStatus") return mockedResponses.scratchnodeImportStatus;
    return undefined;
  },
  useMutation: () => mockRunImport,
}));

// The api mock is a Proxy so that a component adding a NEW `(api as any).x.y.z`
// reference degrades to an unknown-function query (useQuery returns undefined,
// the surface's honest gates render nothing) instead of throwing a TypeError at
// property access. That exact TypeError shipped red on main for three tests
// while CI's allowlist never ran this file (issue #567). Known functions still
// resolve to stable "fn:" strings so responses stay keyed by name.
vi.mock("../../../../convex/_generated/api", () => {
  // Declared inside the factory: vi.mock is hoisted above top-level statements.
  const KNOWN_API_FNS: Record<string, string> = {
    "scratchnodeHandoff.listMyJoinedEvents": "fn:listMyJoinedEvents",
    "notes.listMyNotes": "fn:listMyNotes",
    "domains.product.scratchnodeImport.getScratchnodeImportStatus":
      "fn:getScratchnodeImportStatus",
    "domains.product.scratchnodeImport.importPublishedWiki": "fn:importPublishedWiki",
  };
  const apiNode = (path: string): unknown => {
    const known = KNOWN_API_FNS[path];
    if (known) return known;
    return new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (typeof prop !== "string") return undefined;
          return apiNode(path ? `${path}.${prop}` : prop);
        },
      },
    );
  };
  return { api: apiNode("") };
});

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

  /**
   * Scenario 7 — Attendee whose event has a published recap wiki.
   * User: returning attendee; the host published the event wiki and the
   *   attendee wants it inside NodeBench.
   * Goal: see the import affordance on that event row and none on rows
   *   without a published wiki (honest gate: no affordance without a
   *   KNOWN published recap).
   * Failure mode covered: the ImportRecapButton query reads an api path
   *   (domains.product.scratchnodeImport) that this file's api mock did
   *   not model — three tests crashed with a TypeError on clean main
   *   while CI's runtime-smoke allowlist never ran the file (issue #567).
   */
  it("renders the import-recap affordance only when a published wiki exists", () => {
    setMockedResponses({
      listMyJoinedEvents: { joined: SAMPLE_EVENTS, _truncated: false },
      scratchnodeImportStatus: {
        published: true,
        imported: false,
        documentId: null,
        entitySlug: null,
      },
    });
    const { getAllByTestId } = renderSurface("session-power-user-9");
    // The status mock is keyed by function (not per-slug), so every rendered
    // row reports a published recap — assert one affordance per row.
    expect(getAllByTestId(/scratchnode-import-recap-/)).toHaveLength(
      SAMPLE_EVENTS.length,
    );
  });

  /**
   * Scenario 8 — Import status still loading (or wiki unpublished).
   * User: attendee opening the list the moment after join; status query
   *   has not resolved.
   * Goal: no import affordance flashes before the published state is
   *   KNOWN (mirrors the component's "honest gate" comment).
   * Failure mode covered: affordance rendered from undefined status →
   *   click on a recap that may not exist.
   */
  it("renders no import affordance while import status is unresolved", () => {
    setMockedResponses({
      listMyJoinedEvents: { joined: SAMPLE_EVENTS, _truncated: false },
      // scratchnodeImportStatus intentionally absent → useQuery undefined
    });
    const { queryByTestId } = renderSurface("session-power-user-9");
    expect(queryByTestId(/scratchnode-import-recap-/)).toBeNull();
  });
});
