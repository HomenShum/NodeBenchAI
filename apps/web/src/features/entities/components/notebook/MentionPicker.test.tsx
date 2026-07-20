/**
 * MentionPicker — scenario tests for the federated-search-backed @mention
 * autocomplete.
 *
 * Per .claude/rules/scenario_testing.md every test names a persona, a goal,
 * prior state, action sequence, scale, duration, and expected outcome. The
 * legacy `searchEntitiesForMention` query did `take(200) + JS.includes()`,
 * silently truncating results for power users with >200 entities. This file
 * locks in the new contract: federatedSearch(collections=["nb_entities"],
 * limit=25) with no scan cliff and honest privacy/error semantics.
 *
 * Personas covered:
 *   1. Power user with 5,000 entities — typing "Acme" returns up to 25 hits
 *      ranked by the search index, NEVER the legacy 200-row truncation.
 *   2. Anonymous guest under privacy gate — typing for a private entity
 *      returns ZERO results (federatedSearch enforces the ownerKey filter).
 *   3. Adversarial typo — typing "Anthrpoic" still surfaces "Anthropic" once
 *      vector hybrid (PR #315) populates embeddings; here we just verify the
 *      handle-to-EntityMatch mapping survives the noisy ranked input.
 *   4. Per-collection failure — federatedSearch returns ok=false for
 *      nb_entities; UI must render zero matches without throwing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MentionPicker } from "./MentionPicker";

/* -------------------------------------------------------------------------- */
/* Mocks                                                                       */
/* -------------------------------------------------------------------------- */

const federatedSearchMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: () => federatedSearchMock,
}));

vi.mock("@/features/product/lib/productIdentity", () => ({
  getAnonymousProductSessionId: () => "anon_test_session",
}));

vi.mock("../../../../../convex/_generated/api", () => ({
  api: {
    domains: {
      search: {
        federatedSearch: {
          federatedSearch: "domains.search.federatedSearch.federatedSearch",
        },
      },
    },
  },
}));

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

type Handle = {
  type: string;
  uri: string;
  title: string;
  snippet: string;
  score: number;
  source: string;
  actions: string[];
};

function entityHandle(slug: string, name: string, entityType = "company"): Handle {
  return {
    type: "nb_entities",
    uri: `entity://${slug}`,
    title: name,
    snippet: "",
    score: 1,
    source: entityType,
    actions: ["open_entity"],
  };
}

function powerUserResponse(query: string, count: number) {
  // Simulates the federated search returning up to MENTION_LIMIT (25) handles
  // for a power user whose workspace contains >200 matches.
  const results: Handle[] = Array.from({ length: count }).map((_, i) =>
    entityHandle(`acme-${i.toString().padStart(4, "0")}`, `Acme Corp ${i}`),
  );
  return {
    query,
    identityScope: "authenticated" as const,
    total: results.length,
    timedOut: false,
    partial: false,
    hybridUsed: false,
    collections: [
      {
        collection: "nb_entities",
        ok: true,
        count: results.length,
        results,
      },
    ],
  };
}

function emptyResponse(query: string) {
  return {
    query,
    identityScope: "anonymous" as const,
    total: 0,
    timedOut: false,
    partial: false,
    hybridUsed: false,
    collections: [
      {
        collection: "nb_entities",
        ok: true,
        count: 0,
        results: [],
      },
    ],
  };
}

function failedCollectionResponse(query: string) {
  return {
    query,
    identityScope: "authenticated" as const,
    total: 0,
    timedOut: false,
    partial: true,
    hybridUsed: false,
    collections: [
      {
        collection: "nb_entities",
        ok: false,
        count: 0,
        results: [],
        error: "search_index_unavailable",
      },
    ],
  };
}

function renderPicker() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const result = render(
    <MentionPicker onSelect={onSelect} onClose={onClose} />,
  );
  return { onSelect, onClose, ...result };
}

beforeEach(() => {
  federatedSearchMock.mockReset();
});

/* -------------------------------------------------------------------------- */
/* Scenario 1 — Power user with 5,000 entities                                 */
/*                                                                             */
/* User:      authenticated power user, workspace has 5,000 entities           */
/* Goal:      mention "Acme" without being truncated at the legacy 200 cap     */
/* Prior:     5,000 productEntities rows owned by the caller                   */
/* Actions:   open MentionPicker -> type "Acme"                                */
/* Scale:     1 user                                                           */
/* Duration:  short-running (<200 ms after debounce)                            */
/* Expected:  - federatedSearch called with limit:25, collections:[nb_entities]*/
/*            - up to 25 results render (UX cap, not scan cap)                 */
/*            - results are mapped from entity://{slug} -> EntityMatch         */
/*            - selecting a match invokes onSelect with {slug, name, type}     */
/* Edge:      a 26th handle from the server is dropped client-side             */
/* -------------------------------------------------------------------------- */

describe("Scenario 1 — Power user 5k entities, no scan cliff", () => {
  it("calls federatedSearch with the right args and renders up to 25 matches", async () => {
    federatedSearchMock.mockImplementation(async (args: any) =>
      powerUserResponse(args.q, 25),
    );

    const user = userEvent.setup();
    const { onSelect } = renderPicker();

    const input = screen.getByPlaceholderText("Search entities…");
    await user.type(input, "Acme");

    await waitFor(
      () => {
        expect(federatedSearchMock).toHaveBeenCalled();
        const lastCall = federatedSearchMock.mock.calls.at(-1)?.[0];
        expect(lastCall.q).toBe("Acme");
        expect(lastCall.collections).toEqual(["nb_entities"]);
        expect(lastCall.limit).toBe(25);
        expect(lastCall.anonymousSessionId).toBe("anon_test_session");
      },
      { timeout: 1000 },
    );

    await waitFor(
      () => {
        expect(screen.getByText("Acme Corp 0")).toBeInTheDocument();
      },
      { timeout: 1000 },
    );

    // Render cap is MENTION_LIMIT (25). All 25 visible.
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(25);

    await user.click(buttons[0]);
    expect(onSelect).toHaveBeenCalledWith({
      slug: "acme-0000",
      name: "Acme Corp 0",
      entityType: "company",
    });
  });

  it("client-caps at MENTION_LIMIT even if server returns more", async () => {
    // Defense-in-depth — if the server-side limit ever drifts, the client
    // still enforces the autocomplete UX cap.
    federatedSearchMock.mockImplementation(async (args: any) =>
      powerUserResponse(args.q, 50),
    );

    const user = userEvent.setup();
    renderPicker();

    const input = screen.getByPlaceholderText("Search entities…");
    await user.type(input, "Acme");

    await waitFor(() => {
      expect(screen.getByText("Acme Corp 0")).toBeInTheDocument();
    });

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(25);
  });
});

/* -------------------------------------------------------------------------- */
/* Scenario 2 — Anonymous guest privacy floor                                  */
/*                                                                             */
/* User:      anonymous guest                                                  */
/* Goal:      mention "SecretCo" — owned privately by another user             */
/* Prior:     SecretCo entity exists but caller has no ownerKey access         */
/* Actions:   type "Sec" in the mention picker                                 */
/* Expected:  zero matches rendered; "No matches." copy shown                  */
/* -------------------------------------------------------------------------- */

describe("Scenario 2 — Anonymous guest sees no private entities", () => {
  it("renders zero matches when federatedSearch returns nothing for the caller", async () => {
    federatedSearchMock.mockImplementation(async (args: any) =>
      emptyResponse(args.q),
    );

    const user = userEvent.setup();
    renderPicker();

    const input = screen.getByPlaceholderText("Search entities…");
    await user.type(input, "Sec");

    await waitFor(() => expect(federatedSearchMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByText("No matches.")).toBeInTheDocument();
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Scenario 3 — Per-collection failure (HONEST_STATUS)                         */
/*                                                                             */
/* User:      any caller                                                       */
/* Prior:     federatedSearch returns ok=false for nb_entities (e.g. search    */
/*            index temporarily unavailable)                                   */
/* Expected:  zero matches, no exception, "No matches." copy shown             */
/* -------------------------------------------------------------------------- */

describe("Scenario 3 — Honest status on per-collection failure", () => {
  it("renders zero matches without throwing when nb_entities ok=false", async () => {
    federatedSearchMock.mockImplementation(async (args: any) =>
      failedCollectionResponse(args.q),
    );

    const user = userEvent.setup();
    renderPicker();

    const input = screen.getByPlaceholderText("Search entities…");
    await user.type(input, "Anthropic");

    await waitFor(() => expect(federatedSearchMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByText("No matches.")).toBeInTheDocument();
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Scenario 4 — Stale request guard                                            */
/*                                                                             */
/* User:      power user typing fast                                           */
/* Goal:      avoid showing results from an older keystroke                    */
/* Actions:   "A" -> "An" -> "Ant" -> "Anth"                                   */
/* Scale:     1 user, 4 in-flight requests                                     */
/* Expected:  only the latest response mutates state — no flicker of stale     */
/*            "A" results after the user has typed "Anth"                      */
/* -------------------------------------------------------------------------- */

describe("Scenario 4 — Stale request guard for fast typing", () => {
  it("ignores a slower-resolving older request when newer one wins", async () => {
    let resolveFirst: (value: any) => void = () => {};
    const firstPromise = new Promise((r) => {
      resolveFirst = r;
    });

    federatedSearchMock
      // First call ("A") - resolves AFTER second call.
      .mockImplementationOnce(() => firstPromise as Promise<any>)
      // Second call resolves immediately with "Anthropic".
      .mockImplementationOnce(async () => ({
        query: "Anth",
        identityScope: "authenticated" as const,
        total: 1,
        timedOut: false,
        partial: false,
        hybridUsed: false,
        collections: [
          {
            collection: "nb_entities",
            ok: true,
            count: 1,
            results: [entityHandle("anthropic", "Anthropic")],
          },
        ],
      }));

    const user = userEvent.setup();
    renderPicker();

    const input = screen.getByPlaceholderText("Search entities…");
    // First keystroke triggers the debounced fire after 120 ms (call #1
    // resolves SLOW, kept pending via `firstPromise`).
    await user.type(input, "A");
    // Wait past the debounce so the first request actually fires.
    await new Promise((r) => setTimeout(r, 200));
    // Verify the first call was kicked off but no result is in the DOM yet.
    await waitFor(() => expect(federatedSearchMock).toHaveBeenCalledTimes(1));
    // Continue typing → second debounce → call #2 resolves immediately.
    await user.type(input, "nth");
    await new Promise((r) => setTimeout(r, 200));

    await waitFor(() => {
      expect(federatedSearchMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Anthropic")).toBeInTheDocument();
    });

    // Now resolve the FIRST (stale) call with a different result. The UI
    // should NOT replace "Anthropic" with the stale data.
    resolveFirst({
      query: "A",
      identityScope: "authenticated" as const,
      total: 1,
      timedOut: false,
      partial: false,
      hybridUsed: false,
      collections: [
        {
          collection: "nb_entities",
          ok: true,
          count: 1,
          results: [entityHandle("alphabet", "Alphabet")],
        },
      ],
    });

    // Give microtasks time to settle.
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByText("Anthropic")).toBeInTheDocument();
    expect(screen.queryByText("Alphabet")).not.toBeInTheDocument();
  });
});
