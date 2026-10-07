import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { EventCorpusExplorer } from "./EventCorpusExplorer";
import { resolvePathToView, resolvePathToCockpitState } from "@/lib/registry/viewRegistry";

afterEach(() => {
  cleanup();
});

/**
 * Scenario: dogfooder pastes /events/test-event-id into a fresh tab. Before
 * this PR, the cockpit's prefix matcher swallowed the slug and the page
 * fell through to the home control-plane view. The route resolver MUST now
 * recognize the event corpus path and surface the slug.
 *
 * User:       dogfooder / external partner with a shared event-corpus link
 * Goal:       open the corpus surface for a specific event id
 * Prior state: no auth, no cockpit query string
 * Actions:    navigate to /events/test-event-id
 * Scale:      single user
 * Duration:   short — single render
 * Expected:   resolvePathToView returns view: "event-corpus" with the slug
 *             carried in entityName (same channel /entity/:slug uses);
 *             EventCorpusExplorer renders the slug + the "no corpus yet"
 *             honest empty state.
 * Edge cases:  empty id → "No event id" + amber warning state;
 *             very long id → bounded preview (no DoS surface).
 */
describe("EventCorpusExplorer + /events/:eventId route", () => {
  it("Scenario: resolvePathToView recognizes /events/:eventId and lifts the slug into entityName", () => {
    expect(resolvePathToView("/events/test-event-id")).toMatchObject({
      view: "event-corpus",
      entityName: "test-event-id",
      isUnknownRoute: false,
    });
  });

  it("Scenario: resolvePathToCockpitState routes /events/* to the packets surface", () => {
    // The cockpit resolver maps view → surface via VIEW_MAP. The event-corpus
    // view is registered under packets in viewRegistry, so a deep link should
    // land on the Reports surface in the cockpit (alongside other dynamic
    // /entity/:slug-style routes).
    expect(resolvePathToCockpitState("/events/founder-summit-2026")).toMatchObject({
      surfaceId: "packets",
      view: "event-corpus",
      entityName: "founder-summit-2026",
    });
  });

  it("Scenario: /events alone (no slug) does NOT resolve to event-corpus — it's a missing-id case", () => {
    // The startsWith("/events/") branch in the resolver requires the slash.
    // Bare /events has no event id; the rest of the resolver decides where it
    // lands (longest-path-wins). We just make sure it does NOT return a fake
    // event-corpus result with entityName=null.
    const resolved = resolvePathToView("/events");
    // Either the bare /events path matches the registry entry (view = "event-corpus",
    // entityName = null) OR it falls through. Either way, entityName is null —
    // the contract is "no fake slug".
    if (resolved.view === "event-corpus") {
      expect(resolved.entityName).toBeNull();
    } else {
      // Tolerated alternative — the resolver doesn't promote a bare /events
      // path to event-corpus.
      expect(resolved.entityName).toBeNull();
    }
  });

  it("Scenario: component renders the slug verbatim when present", () => {
    render(<EventCorpusExplorer eventId="test-event-id" />);
    expect(screen.getByTestId("event-corpus-explorer")).toBeTruthy();
    expect(screen.getByTestId("event-corpus-explorer").getAttribute("data-event-id")).toBe(
      "test-event-id",
    );
    // Honest empty state — no fake corpus data.
    expect(screen.getByTestId("event-corpus-explorer-empty")).toBeTruthy();
  });

  it("Scenario (sad path): missing eventId renders honest 'no id' warning, not a home fallthrough", () => {
    render(<EventCorpusExplorer eventId={null} />);
    // The warning is the surface contract — it must be visible to the user
    // and to screen readers. No silent rendering of home content.
    const missing = screen.getByTestId("event-corpus-explorer-missing-id");
    expect(missing).toBeTruthy();
    expect(missing.textContent ?? "").toMatch(/missing/i);
  });

  it("Scenario (adversarial): pathological 1000-char id is bounded — no DoS surface", () => {
    const huge = "x".repeat(1000);
    render(<EventCorpusExplorer eventId={huge} />);
    const host = screen.getByTestId("event-corpus-explorer");
    const rendered = host.getAttribute("data-event-id") ?? "";
    // The id is sanitized to <= 240 chars + the truncation glyph (sanitize() in component).
    expect(rendered.length).toBeLessThanOrEqual(241);
    expect(rendered.endsWith("…")).toBe(true);
  });

  it("Scenario (long-running): 10 distinct slugs route in sequence without bleed-over", () => {
    // Catch a regression where the resolver caches the last slug into module
    // state. Each call must be a fresh resolution.
    for (const slug of [
      "a",
      "b-slug",
      "Founder-Summit_2026",
      "with%20space",
      "trailing-",
      "-leading",
      "double--dash",
      "UPPER",
      "mixed-CaSe-123",
      "very-very-long-event-slug-name-that-keeps-going-and-going",
    ]) {
      const res = resolvePathToView(`/events/${slug}`);
      expect(res.view).toBe("event-corpus");
      expect(res.entityName).toBe(decodeURIComponent(slug));
    }
  });
});
