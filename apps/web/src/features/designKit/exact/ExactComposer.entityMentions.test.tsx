/**
 * ExactComposer — scenario tests for the @entity autocomplete popup.
 *
 * Per .claude/rules/scenario_testing.md, every test starts from a real
 * user persona, executes a realistic action sequence, and verifies system
 * behavior including HONEST_STATUS error reporting and bounded results.
 *
 * Personas covered:
 *
 *   1. Banker disambiguating "Orbital" — types "@Or", picks the autocomplete
 *      hit via mouse, confirms `@orbital-labs` is inserted at the caret.
 *
 *   2. Keyboard power user — arrow-key navigation through results, Enter
 *      selects, Escape dismisses. Verifies aria-activedescendant follows
 *      the active option (combobox a11y pattern).
 *
 *   3. Degraded backend — useFederatedSearch surfaces an error. The popup
 *      must show "Entity lookup temporarily unavailable" (HONEST_STATUS),
 *      not silently swallow the failure.
 *
 *   4. Empty result — server returns 0 hits for the prefix. The popup shows
 *      "No matches" (not a blank rectangle that confuses users).
 *
 *   5. Email-like text — typing "foo@bar.com" must NOT open the popup, so
 *      day-to-day chat text is not interrupted by spurious lookups.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ExactComposer } from "./ExactComposer";
import type { FederatedSearchResponse } from "@/layouts/chrome/commandPalette/types";

/* -------------------------------------------------------------------------- */
/* Mocks                                                                       */
/* -------------------------------------------------------------------------- */

// useFederatedSearch is the dependency we control. Mock at the module level
// so the @entity hook resolves to controlled hits / errors / empty states.
type MockResult = {
  data: FederatedSearchResponse | null;
  isLoading: boolean;
  error: Error | null;
};

let mockResult: MockResult = { data: null, isLoading: false, error: null };

vi.mock("@/layouts/chrome/commandPalette/useFederatedSearch", () => ({
  useFederatedSearch: () => mockResult,
}));

function setEntityHits(
  hits: Array<{ slug: string; title: string; source?: string; snippet?: string }>,
  extra?: Partial<MockResult>,
) {
  mockResult = {
    data: {
      query: "Or",
      collections: [
        {
          collection: "nb_entities",
          ok: true,
          count: hits.length,
          results: hits.map((h) => ({
            type: "nb_entities" as const,
            uri: `entity://${h.slug}`,
            title: h.title,
            snippet: h.snippet ?? "",
            source: h.source ?? "company",
            score: 1,
            actions: [],
          })),
        },
      ],
      total: hits.length,
      timedOut: false,
      partial: false,
      identityScope: "anonymous",
    },
    isLoading: false,
    error: null,
    ...extra,
  };
}

function setEntityError(message = "kaboom") {
  mockResult = {
    data: null,
    isLoading: false,
    error: new Error(message),
  };
}

function setEntityEmpty() {
  mockResult = {
    data: {
      query: "Xz",
      collections: [
        { collection: "nb_entities", ok: true, count: 0, results: [] },
      ],
      total: 0,
      timedOut: false,
      partial: false,
      identityScope: "anonymous",
    },
    isLoading: false,
    error: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Test harness                                                                */
/* -------------------------------------------------------------------------- */

function Harness(props: { initial?: string }) {
  const [value, setValue] = useState(props.initial ?? "");
  return (
    <ExactComposer
      value={value}
      onValueChange={setValue}
      onSubmit={() => {}}
      placeholder="Ask anything"
      ariaLabel="Chat composer"
      inputTestId="composer-input"
      enableEntityMentions
    />
  );
}

async function typeIntoComposer(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
  input.focus();
  await user.type(input, text);
  return input;
}

beforeEach(() => {
  mockResult = { data: null, isLoading: false, error: null };
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* Scenarios                                                                   */
/* -------------------------------------------------------------------------- */

describe("ExactComposer @entity autocomplete", () => {
  it("opens popup when typing @<prefix> at a whitespace boundary", async () => {
    setEntityHits([
      { slug: "orbital-labs", title: "Orbital Labs", source: "Company" },
      { slug: "orion-energy", title: "Orion Energy", source: "Company" },
    ]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<Harness />);
    await typeIntoComposer(user, "@Or");
    // Flush debounce (100 ms).
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByRole("listbox", { name: /entity suggestions/i })).toBeInTheDocument();
    expect(screen.getByTestId("exact-composer-mention-option-orbital-labs")).toBeInTheDocument();
    expect(screen.getByTestId("exact-composer-mention-option-orion-energy")).toBeInTheDocument();

    const input = screen.getByTestId("composer-input");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toMatch(/-0$/);
  });

  it("inserts @<slug> on click and emits onEntityMention", async () => {
    setEntityHits([{ slug: "orbital-labs", title: "Orbital Labs", source: "Company" }]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onMention = vi.fn();

    function Wired() {
      const [v, setV] = useState("");
      return (
        <ExactComposer
          value={v}
          onValueChange={setV}
          onSubmit={() => {}}
          placeholder="Ask"
          ariaLabel="Chat composer"
          inputTestId="composer-input"
          enableEntityMentions
          onEntityMention={onMention}
        />
      );
    }
    render(<Wired />);
    await typeIntoComposer(user, "Hi @Or");
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    const opt = await screen.findByTestId("exact-composer-mention-option-orbital-labs");
    // Popup uses onMouseDown — fire that, not click, to match production path.
    await user.pointer({ keys: "[MouseLeft>]", target: opt });
    await user.pointer({ keys: "[/MouseLeft]", target: opt });

    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    expect(input.value).toContain("@orbital-labs");
    expect(onMention).toHaveBeenCalledWith({ slug: "orbital-labs", title: "Orbital Labs" });
  });

  it("arrow-down moves aria-activedescendant; Enter selects", async () => {
    setEntityHits([
      { slug: "orbital-labs", title: "Orbital Labs" },
      { slug: "orion-energy", title: "Orion Energy" },
    ]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);

    const input = (await typeIntoComposer(user, "@Or")) as HTMLTextAreaElement;
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(input.getAttribute("aria-activedescendant")).toMatch(/-0$/);

    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toMatch(/-1$/);

    await user.keyboard("{Enter}");
    expect(input.value).toContain("@orion-energy");
  });

  it("Escape closes the popup without inserting", async () => {
    setEntityHits([{ slug: "orbital-labs", title: "Orbital Labs" }]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);

    await typeIntoComposer(user, "@Or");
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.queryByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    expect(input.value).toBe("@Or");
    expect(input.value).not.toContain("orbital-labs");
  });

  it("surfaces honest error when useEntitySuggest reports a failure", async () => {
    setEntityError("backend_down");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);

    await typeIntoComposer(user, "@An");
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByTestId("exact-composer-mention-error")).toHaveTextContent(
      /entity lookup temporarily unavailable/i,
    );
  });

  it("renders 'No matches' empty state when server returns 0 hits", async () => {
    setEntityEmpty();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);

    await typeIntoComposer(user, "@Xz");
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByTestId("exact-composer-mention-empty")).toHaveTextContent(/no matches/i);
  });

  it("does NOT open the popup for inline email-like text (foo@bar)", async () => {
    setEntityHits([{ slug: "orbital-labs", title: "Orbital Labs" }]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);

    await typeIntoComposer(user, "email me at foo@bar");
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.queryByRole("listbox", { name: /entity suggestions/i })).not.toBeInTheDocument();
  });
});
