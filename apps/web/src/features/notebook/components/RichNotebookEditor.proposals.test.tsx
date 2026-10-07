import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RichNotebookEditor } from "./RichNotebookEditor";

afterEach(() => {
  cleanup();
});

describe("RichNotebookEditor — AI proposals (kit-parity nb_proposal)", () => {
  const baseProposal = {
    id: "p1",
    label: "Tighten phrasing",
    note: "Removes hedge words; same meaning, fewer syllables.",
    originalText: "We should probably consider revisiting the pricing.",
    proposedText: "Revisit pricing.",
  };

  it("Scenario: pending proposal renders with original + proposed text and Accept/Dismiss actions", async () => {
    render(
      <RichNotebookEditor
        initialContent="<h2>Notebook</h2><p>Body.</p>"
        proposals={[{ ...baseProposal, state: "pending" }]}
      />,
    );

    // Wait for TipTap to mount and render the seeded proposal node.
    await waitFor(() => {
      expect(
        document.querySelector('[data-proposal-id="p1"]'),
      ).not.toBeNull();
    });

    const proposalRoot = document.querySelector(
      '[data-proposal-id="p1"]',
    ) as HTMLElement | null;
    expect(proposalRoot).not.toBeNull();
    expect(proposalRoot!.getAttribute("data-accepted")).toBe("false");
    expect(proposalRoot!.textContent).toContain(baseProposal.originalText);
    expect(proposalRoot!.textContent).toContain(baseProposal.proposedText);

    expect(
      screen.getByRole("button", { name: /Accept proposal: Tighten phrasing/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Dismiss proposal: Tighten phrasing/i }),
    ).toBeTruthy();
  });

  it("Scenario: clicking Accept flips state to accepted, hides actions, shows applied", async () => {
    const user = userEvent.setup();
    render(
      <RichNotebookEditor
        initialContent="<p>Edit me.</p>"
        proposals={[{ ...baseProposal, state: "pending" }]}
      />,
    );

    const acceptBtn = await screen.findByRole("button", {
      name: /Accept proposal/i,
    });
    await user.click(acceptBtn);

    await waitFor(() => {
      const root = document.querySelector('[data-proposal-id="p1"]');
      expect(root?.getAttribute("data-accepted")).toBe("true");
    });

    // Accept/Dismiss are gone after acceptance.
    expect(screen.queryByRole("button", { name: /Accept proposal/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Dismiss proposal/i })).toBeNull();
    // The accepted proposal renders only the proposed text (original is no longer
    // shown as strike-through).
    const root = document.querySelector('[data-proposal-id="p1"]')!;
    expect(root.textContent).toContain(baseProposal.proposedText);
    expect(root.textContent).not.toContain(baseProposal.originalText);
  });

  it("Scenario: clicking Dismiss removes the visible proposal — Accept/Dismiss disappear, original/proposed text gone", async () => {
    const user = userEvent.setup();
    render(
      <RichNotebookEditor
        initialContent="<p>Edit me.</p>"
        proposals={[{ ...baseProposal, state: "pending" }]}
      />,
    );

    const dismissBtn = await screen.findByRole("button", {
      name: /Dismiss proposal/i,
    });
    await user.click(dismissBtn);

    // Once dismissed, neither action button is reachable.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Accept proposal/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /Dismiss proposal/i })).toBeNull();
    });
    // And the original/proposed text is no longer in any visible proposal node
    // (NodeViewWrapper renders display:none for dismissed state).
    const visibleProposalText = Array.from(
      document.querySelectorAll('[data-proposal-id="p1"]'),
    )
      .filter((el) => {
        // Walk up to find any ancestor with display:none.
        let cursor: HTMLElement | null = el as HTMLElement;
        while (cursor) {
          const style = cursor.getAttribute("style") ?? "";
          if (/display\s*:\s*none/.test(style)) return false;
          cursor = cursor.parentElement;
        }
        return true;
      })
      .map((el) => el.textContent ?? "")
      .join("");
    expect(visibleProposalText).not.toContain(baseProposal.originalText);
    expect(visibleProposalText).not.toContain(baseProposal.proposedText);
  });

  it("Scenario: multiple proposals render independently — accepting one does not affect the other", async () => {
    const user = userEvent.setup();
    render(
      <RichNotebookEditor
        initialContent="<p>x</p>"
        proposals={[
          { ...baseProposal, id: "pa", label: "A", state: "pending" },
          { ...baseProposal, id: "pb", label: "B", state: "pending" },
        ]}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-proposal-id="pa"]')).not.toBeNull();
      expect(document.querySelector('[data-proposal-id="pb"]')).not.toBeNull();
    });

    await user.click(await screen.findByRole("button", { name: /Accept proposal: A/i }));

    await waitFor(() => {
      expect(
        document.querySelector('[data-proposal-id="pa"]')?.getAttribute("data-accepted"),
      ).toBe("true");
    });
    expect(
      document.querySelector('[data-proposal-id="pb"]')?.getAttribute("data-accepted"),
    ).toBe("false");
  });

  it("Scenario: pre-accepted proposal seeded in initial state — already shows applied, no actions", async () => {
    render(
      <RichNotebookEditor
        initialContent="<p>x</p>"
        proposals={[{ ...baseProposal, state: "accepted" }]}
      />,
    );

    await waitFor(() => {
      const root = document.querySelector('[data-proposal-id="p1"]');
      expect(root?.getAttribute("data-accepted")).toBe("true");
    });
    expect(screen.queryByRole("button", { name: /Accept proposal/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Dismiss proposal/i })).toBeNull();
  });
});
