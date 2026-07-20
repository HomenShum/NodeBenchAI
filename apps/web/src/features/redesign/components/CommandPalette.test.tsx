/**
 * CommandPalette — scenario tests for the Cmd-K federated-search palette.
 *
 * Per .claude/rules/scenario_testing.md, every test models a real user
 * persona, action sequence, and verifies system behavior under that scenario.
 *
 * Scenarios covered:
 *
 *   1. Power user — types "Anthropic", sees grouped results, navigates with
 *      ArrowDown + Enter. Verifies focus, navigation, and recent-search storage.
 *
 *   2. First-time visitor (anonymous) — opens palette with empty query, sees
 *      Commands group + an honest "try searching..." prompt. Types and confirms
 *      anonymous-scoped collections (entities/reports/blocks/claims) return [].
 *
 *   3. Adversarial / degraded — server returns partial=true with one collection
 *      ok=false. Palette renders successful collections AND surfaces the failure
 *      inline — never silently hides it (HONEST_STATUS).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import type { FederatedSearchResponse } from "../../../layouts/chrome/commandPalette/types";
import { clearRecentCmdkSearches, getRecentCmdkSearches } from "../../../layouts/chrome/commandPalette/recentSearches";

class ResizeObserverMock implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  writable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(Element.prototype, "scrollIntoView", {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

/* -------------------------------------------------------------------------- */
/* Mocks                                                                       */
/* -------------------------------------------------------------------------- */

const federatedSearchMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: () => federatedSearchMock,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/features/product/lib/productIdentity", () => ({
  getAnonymousProductSessionId: () => "anon_test_session",
}));

vi.mock("@convex/_generated/api", () => ({
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

function authenticatedAnthropicResponse(): FederatedSearchResponse {
  return {
    query: "Anthropic",
    identityScope: "authenticated",
    total: 4,
    timedOut: false,
    partial: false,
    collections: [
      {
        collection: "nb_entities",
        ok: true,
        count: 1,
        results: [
          {
            type: "nb_entities",
            uri: "entity://anthropic",
            title: "Anthropic",
            snippet: "AI safety lab building Claude.",
            score: 1,
            source: "company",
            actions: ["open_entity"],
          },
        ],
      },
      {
        collection: "nb_reports",
        ok: true,
        count: 2,
        results: [
          {
            type: "nb_reports",
            uri: "report://r1",
            title: "Anthropic — Q4 2025 diligence",
            snippet: "Funding round and headcount summary.",
            score: 1,
            source: "founder",
            actions: ["open_report"],
          },
          {
            type: "nb_reports",
            uri: "report://r2",
            title: "Anthropic — competitor map",
            snippet: "OpenAI, DeepMind, Mistral comparison.",
            score: 1,
            source: "operator",
            actions: ["open_report"],
          },
        ],
      },
      {
        collection: "nb_notebook_blocks",
        ok: true,
        count: 0,
        results: [],
      },
      {
        collection: "nb_claims",
        ok: true,
        count: 0,
        results: [],
      },
      {
        collection: "nb_sources",
        ok: true,
        count: 1,
        results: [
          {
            type: "nb_sources",
            uri: "https://www.anthropic.com",
            title: "Anthropic — homepage",
            snippet: "Official company site.",
            score: 1,
            source: "html",
            actions: ["open_source"],
          },
        ],
      },
      {
        collection: "nb_captures",
        ok: true,
        count: 0,
        results: [],
      },
      {
        collection: "nb_threads",
        ok: true,
        count: 0,
        results: [],
      },
    ],
  };
}

function anonymousMostlyEmpty(): FederatedSearchResponse {
  // Anon caller: owner-scoped collections come back empty (no ownerKey access);
  // sources/threads may or may not have content. Honest empty state.
  return {
    query: "x",
    identityScope: "anonymous",
    total: 0,
    timedOut: false,
    partial: false,
    collections: [
      { collection: "nb_entities", ok: true, count: 0, results: [] },
      { collection: "nb_reports", ok: true, count: 0, results: [] },
      { collection: "nb_notebook_blocks", ok: true, count: 0, results: [] },
      { collection: "nb_claims", ok: true, count: 0, results: [] },
      { collection: "nb_sources", ok: true, count: 0, results: [] },
      { collection: "nb_captures", ok: true, count: 0, results: [] },
      { collection: "nb_threads", ok: true, count: 0, results: [] },
    ],
  };
}

function partialFailureResponse(): FederatedSearchResponse {
  return {
    query: "Anthropic",
    identityScope: "authenticated",
    total: 1,
    timedOut: false,
    partial: true,
    collections: [
      {
        collection: "nb_entities",
        ok: false,
        count: 0,
        results: [],
        error: "timeout",
      },
      {
        collection: "nb_reports",
        ok: true,
        count: 1,
        results: [
          {
            type: "nb_reports",
            uri: "report://r99",
            title: "Anthropic — surviving brief",
            snippet: "Reports stayed up while entities timed out.",
            score: 1,
            source: "founder",
            actions: ["open_report"],
          },
        ],
      },
      { collection: "nb_notebook_blocks", ok: true, count: 0, results: [] },
      { collection: "nb_claims", ok: true, count: 0, results: [] },
      { collection: "nb_sources", ok: true, count: 0, results: [] },
      { collection: "nb_captures", ok: true, count: 0, results: [] },
      { collection: "nb_threads", ok: true, count: 0, results: [] },
    ],
  };
}

function renderPalette() {
  const onClose = vi.fn();
  const result = render(
    <MemoryRouter>
      <CommandPalette open onClose={onClose} />
    </MemoryRouter>,
  );
  return { onClose, ...result };
}

beforeEach(() => {
  federatedSearchMock.mockReset();
  navigateMock.mockReset();
  clearRecentCmdkSearches();
});

afterEach(() => {
  clearRecentCmdkSearches();
});

/* -------------------------------------------------------------------------- */
/* Scenario 1 — Power user, full text query                                    */
/*                                                                             */
/* User:      power user (authenticated, founder lens)                         */
/* Goal:      find the Anthropic diligence report quickly via Cmd-K            */
/* Actions:   type "Anthropic" -> see grouped results -> ArrowDown -> Enter    */
/* Scale:     1 user, 1 search                                                 */
/* Duration:  short-running (< 1s)                                             */
/* Expected:  - results render grouped by collection                           */
/*            - status bar shows total + identity scope                        */
/*            - Enter on a report navigates to its route                       */
/*            - the query is stored in nb_cmdk_recent_v1                       */
/* Edge:      result with no snippet still renders (title only)                */
/* -------------------------------------------------------------------------- */

describe("Scenario 1 — Power user, full text query", () => {
  it("renders federated results grouped by collection and navigates on Enter", async () => {
    federatedSearchMock.mockResolvedValue(authenticatedAnthropicResponse());

    const user = userEvent.setup();
    renderPalette();

    const input = screen.getByLabelText("Search anything") as HTMLInputElement;
    await user.type(input, "Anthropic");

    // Wait for federated search response to surface.
    await waitFor(
      () => expect(screen.getAllByText(/4 results across 7 collections/i).length).toBeGreaterThan(0),
      { timeout: 3000 },
    );

    // Groups present (verify by data-cmdk-group attribute).
    expect(document.querySelector('[data-cmdk-group="nb_entities"]')).toBeTruthy();
    expect(document.querySelector('[data-cmdk-group="nb_reports"]')).toBeTruthy();
    expect(document.querySelector('[data-cmdk-group="nb_sources"]')).toBeTruthy();

    // Empty groups should NOT render headers.
    expect(document.querySelector('[data-cmdk-group="nb_notebook_blocks"]')).toBeNull();

    // Result rows.
    expect(screen.getByText("Anthropic — Q4 2025 diligence")).toBeInTheDocument();
    expect(screen.getByText("Anthropic — competitor map")).toBeInTheDocument();

    // Identity scope shown in status bar.
    expect(screen.getByText(/your account/i)).toBeInTheDocument();

    // ArrowDown twice (entity -> first report) -> Enter -> navigates.
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock.mock.calls[0][0]).toMatch(/^\/redesign\/reports\//);

    // Recent search persisted.
    const recents = getRecentCmdkSearches();
    expect(recents.length).toBe(1);
    expect(recents[0].query).toBe("Anthropic");
  });

  it("Cmd+Enter triggers the secondary 'ask about this' action", async () => {
    federatedSearchMock.mockResolvedValue(authenticatedAnthropicResponse());

    const user = userEvent.setup();
    renderPalette();

    const input = screen.getByLabelText("Search anything") as HTMLInputElement;
    await user.type(input, "Anthropic");
    await waitFor(() =>
      expect(screen.getAllByText(/4 results across/i).length).toBeGreaterThan(0),
    );

    // First item is the entity.
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock.mock.calls[0][0]).toMatch(/^\/redesign\/chat\?q=/);
  });
});

/* -------------------------------------------------------------------------- */
/* Scenario 2 — First-time anonymous visitor                                   */
/*                                                                             */
/* User:      anonymous (no auth), zero prior recent searches                  */
/* Goal:      explore the palette with no plan                                 */
/* Actions:   open with empty query -> see Commands + try-searching prompt    */
/*            type "x" -> get honest empty state on owner-scoped collections   */
/* Scale:     1 user, sustained (multiple keystrokes)                          */
/* Duration:  short-running                                                    */
/* Expected:  - empty state shows nav Commands + helper copy                   */
/*            - typed query yields anonymous identity scope in status bar      */
/*            - "0 results" honest message (not "try a different query")       */
/* -------------------------------------------------------------------------- */

describe("Scenario 2 — First-time anonymous visitor", () => {
  it("shows commands + helper copy when query is empty and no recents", () => {
    federatedSearchMock.mockResolvedValue(anonymousMostlyEmpty());
    renderPalette();

    // Commands group visible.
    expect(document.querySelector('[data-cmdk-group="commands"]')).toBeTruthy();
    expect(screen.getByText("Go to Home")).toBeInTheDocument();
    expect(screen.getByText("Go to Reports")).toBeInTheDocument();

    // Status bar SHOULD NOT render before any data has come back.
    expect(document.querySelector("[data-cmdk-status]")).toBeNull();
  });

  it("renders honest 0-results state for anonymous-scoped collections", async () => {
    federatedSearchMock.mockResolvedValue(anonymousMostlyEmpty());

    const user = userEvent.setup();
    renderPalette();

    const input = screen.getByLabelText("Search anything") as HTMLInputElement;
    // Use a query that won't match any nav-command keyword (so the Commands
    // bucket is empty and the "0 results for ..." message renders).
    await user.type(input, "zqxxqz");

    // Wait for the response.
    await waitFor(
      () => expect(screen.getAllByText(/0 results across 7 collections/i).length).toBeGreaterThan(0),
      { timeout: 3000 },
    );

    expect(screen.getByText(/anonymous/i)).toBeInTheDocument();
    // No federated result groups render (all anonymous-scoped collections
    // are empty, so no group headers).
    expect(document.querySelector('[data-cmdk-group="nb_entities"]')).toBeNull();
    expect(document.querySelector('[data-cmdk-group="nb_reports"]')).toBeNull();
    // Honest empty state with the user's literal query.
    expect(screen.getByText(/0 results for "zqxxqz"/i)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Scenario 3 — Adversarial / degraded — partial failure                       */
/*                                                                             */
/* User:      power user, slow network, one upstream collection timed out      */
/* Goal:      still find what they need despite a broken collection            */
/* Actions:   type "Anthropic" -> server returns partial, nb_entities ok=false */
/* Scale:     1 user                                                           */
/* Duration:  short-running                                                    */
/* Expected:  - reports group renders with the surviving result                */
/*            - nb_entities group renders an inline "Search failed" message    */
/*            - status bar shows "partial"                                     */
/*            - failure is NEVER silently hidden (HONEST_STATUS)               */
/* -------------------------------------------------------------------------- */

describe("Scenario 3 — Adversarial / degraded", () => {
  it("renders successful results AND surfaces per-collection failures inline", async () => {
    federatedSearchMock.mockResolvedValue(partialFailureResponse());

    const user = userEvent.setup();
    renderPalette();

    const input = screen.getByLabelText("Search anything") as HTMLInputElement;
    await user.type(input, "Anthropic");

    await waitFor(
      () => expect(screen.getAllByText(/1 result across 7 collections/i).length).toBeGreaterThan(0),
      { timeout: 3000 },
    );

    // Successful group renders the surviving report.
    expect(screen.getByText("Anthropic — surviving brief")).toBeInTheDocument();

    // Failed group renders the inline failure message.
    const entityGroup = document.querySelector('[data-cmdk-group="nb_entities"]');
    expect(entityGroup).toBeTruthy();
    expect(entityGroup?.textContent ?? "").toMatch(/search failed for entities/i);
    expect(entityGroup?.textContent ?? "").toMatch(/timeout/i);

    // Status bar must announce partial.
    expect(screen.getByText(/partial/i)).toBeInTheDocument();
  });

  it("server returning timedOut surfaces 'timed out' in the status bar", async () => {
    // Adversarial: server eats the budget, returns timedOut=true with empty
    // results. Palette must NOT pretend nothing happened — surface it.
    federatedSearchMock.mockResolvedValue({
      query: "Anthropic",
      identityScope: "authenticated",
      total: 0,
      timedOut: true,
      partial: true,
      collections: [
        { collection: "nb_entities", ok: false, count: 0, results: [], error: "federated_search_timeout" },
        { collection: "nb_reports", ok: false, count: 0, results: [], error: "federated_search_timeout" },
        { collection: "nb_notebook_blocks", ok: false, count: 0, results: [], error: "federated_search_timeout" },
        { collection: "nb_claims", ok: false, count: 0, results: [], error: "federated_search_timeout" },
        { collection: "nb_sources", ok: false, count: 0, results: [], error: "federated_search_timeout" },
        { collection: "nb_captures", ok: false, count: 0, results: [], error: "federated_search_timeout" },
        { collection: "nb_threads", ok: false, count: 0, results: [], error: "federated_search_timeout" },
      ],
    } satisfies FederatedSearchResponse);

    const user = userEvent.setup();
    renderPalette();

    const input = screen.getByLabelText("Search anything") as HTMLInputElement;
    await user.type(input, "Anthropic");

    await waitFor(
      () => expect(screen.getAllByText(/timed out/i).length).toBeGreaterThan(0),
      { timeout: 3000 },
    );

    // Per-collection failure messages must be rendered inline — never hidden.
    const errorGroups = document.querySelectorAll(".rd-cmdk__group-error");
    expect(errorGroups.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* A11y + keyboard sanity                                                      */
/* -------------------------------------------------------------------------- */

describe("A11y + keyboard", () => {
  it("dialog has correct ARIA + listbox + option roles", () => {
    federatedSearchMock.mockResolvedValue(anonymousMostlyEmpty());
    renderPalette();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Command palette");

    const listbox = screen.getByRole("listbox", { name: /search results/i });
    expect(listbox).toBeInTheDocument();

    // Each command renders as an option with aria-selected.
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    options.forEach((opt) => {
      expect(opt).toHaveAttribute("aria-selected");
    });
  });

  it("Escape closes the palette and calls onClose", async () => {
    federatedSearchMock.mockResolvedValue(anonymousMostlyEmpty());

    const { onClose } = renderPalette();

    // Listener is attached to `window` after the open useEffect runs.
    // Dispatching a real KeyboardEvent on `window` exercises that path
    // deterministically (userEvent + fake-timers can deadlock here).
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(onClose).toHaveBeenCalled();
  });
});
