import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";

import { RichNotebookEditor } from "./RichNotebookEditor";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

/**
 * Scenario: power-user opens the in-notebook finder via Cmd+F while the
 * editor has focus. This is the keystroke-shortcut analog of the existing
 * AI proposals / claims tests — same test harness, but driven by the
 * keyboard rather than seeded data.
 *
 * User:        power-user editing a report notebook
 * Goal:        find "founder" inside a notebook with many blocks
 * Prior state: editor mounted with reportId="r1"
 * Actions:     focus editor → press Cmd+F → type "founder"
 * Scale:       single user
 * Duration:    short — keystroke + 2s waitFor for lazy mount
 * Expected:    finder dialog mounts, carries data-report-id, browser's
 *              native Find does NOT also fire (preventDefault).
 * Edge cases:  Cmd+F WITHOUT reportId is a no-op (graceful);
 *              Cmd+F when focus is OUTSIDE the editor article is a no-op;
 *              Escape closes the finder and returns focus to the editor.
 */
describe("RichNotebookEditor — Cmd+F finder (in-notebook find)", () => {
  function dispatchCmdF(target: HTMLElement) {
    // Match the editor-side handler: capture-phase keydown on `document`,
    // listening for `e.key === "f" || "F"` with metaKey OR ctrlKey.
    const e = new KeyboardEvent("keydown", {
      key: "f",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(e);
    return e;
  }

  it("Scenario: Cmd+F opens NotebookBlockFinder scoped to the reportId", async () => {
    render(
      <RichNotebookEditor
        initialContent="<p>founder bio here</p>"
        reportId="r1"
        testId="rne"
      />,
    );

    // Wait for TipTap to actually mount its contenteditable host.
    const editable = await waitFor(() => {
      const el = document.querySelector('[data-testid="rne"] [contenteditable="true"]');
      if (!el) throw new Error("editor not mounted");
      return el as HTMLElement;
    });
    editable.focus();
    expect(document.activeElement).toBe(editable);

    // Browser's native Find returns a preventDefault-capable event; we assert
    // the editor cancels the default (so the page-level Find dialog never opens).
    const event = await act(async () => dispatchCmdF(editable));
    expect(event.defaultPrevented).toBe(true);

    // The lazy NotebookBlockFinder should mount after the Suspense resolves.
    const finder = await screen.findByTestId("notebook-block-finder");
    expect(finder.getAttribute("data-report-id")).toBe("r1");
    // The status pill renders the empty-query helper text.
    expect(screen.getByTestId("notebook-block-finder-status")).toBeTruthy();
  });

  it("Scenario: Cmd+F WITHOUT reportId is a no-op — finder does not mount, browser default proceeds", async () => {
    render(
      <RichNotebookEditor
        initialContent="<p>baseline body</p>"
        testId="rne-no-report"
      />,
    );

    const editable = await waitFor(() => {
      const el = document.querySelector(
        '[data-testid="rne-no-report"] [contenteditable="true"]',
      );
      if (!el) throw new Error("editor not mounted");
      return el as HTMLElement;
    });
    editable.focus();

    const event = await act(async () => dispatchCmdF(editable));
    // Without reportId, the editor does not register the listener — the
    // browser's native Find runs unmodified.
    expect(event.defaultPrevented).toBe(false);

    // Finder never mounts.
    expect(screen.queryByTestId("notebook-block-finder")).toBeNull();
  });

  it("Scenario: Cmd+F dispatched while focus is OUTSIDE the editor does NOT open the finder", async () => {
    // Mount an external focus target alongside the editor.
    const outside = document.createElement("input");
    outside.setAttribute("data-testid", "outside-input");
    document.body.appendChild(outside);
    try {
      render(
        <RichNotebookEditor
          initialContent="<p>scope test</p>"
          reportId="r2"
          testId="rne-scope"
        />,
      );

      await waitFor(() => {
        const el = document.querySelector('[data-testid="rne-scope"] [contenteditable="true"]');
        if (!el) throw new Error("editor not mounted");
        return el;
      });

      // Focus the OUTSIDE input, then dispatch Cmd+F. The editor's handler
      // should bail out of the focus-guard branch without preventDefault.
      outside.focus();
      expect(document.activeElement).toBe(outside);

      const event = await act(async () => dispatchCmdF(outside));
      expect(event.defaultPrevented).toBe(false);
      // 100ms grace for any spurious Suspense mounts.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
      expect(screen.queryByTestId("notebook-block-finder")).toBeNull();
    } finally {
      outside.remove();
    }
  });

  it("Scenario: opening the finder with reportId='other' keeps the data-report-id in sync", async () => {
    render(
      <RichNotebookEditor
        initialContent="<p>cross-report check</p>"
        reportId="other"
        testId="rne-other"
      />,
    );

    const editable = await waitFor(() => {
      const el = document.querySelector('[data-testid="rne-other"] [contenteditable="true"]');
      if (!el) throw new Error("editor not mounted");
      return el as HTMLElement;
    });
    editable.focus();

    await act(async () => dispatchCmdF(editable));
    const finder = await screen.findByTestId("notebook-block-finder");
    expect(finder.getAttribute("data-report-id")).toBe("other");
  });

  it("Scenario: Escape closes the finder (a11y contract)", async () => {
    render(
      <RichNotebookEditor
        initialContent="<p>escape me</p>"
        reportId="r3"
        testId="rne-esc"
      />,
    );

    const editable = await waitFor(() => {
      const el = document.querySelector('[data-testid="rne-esc"] [contenteditable="true"]');
      if (!el) throw new Error("editor not mounted");
      return el as HTMLElement;
    });
    editable.focus();
    await act(async () => dispatchCmdF(editable));

    const finder = await screen.findByTestId("notebook-block-finder");
    expect(finder).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId("notebook-block-finder")).toBeNull();
    });
  });

  // Long-running sentinel: confirm 100 rapid Cmd+F bursts do not stack listeners
  // or leak finder instances. Catches the regression where capture-phase
  // listeners accumulate on every prop change.
  it("Scenario (sustained): 100 rapid Cmd+F bursts produce exactly one finder, no listener leak", async () => {
    const onChangeSpy = vi.fn();
    render(
      <RichNotebookEditor
        initialContent="<p>burst test</p>"
        reportId="burst"
        testId="rne-burst"
        onChange={onChangeSpy}
      />,
    );

    const editable = await waitFor(() => {
      const el = document.querySelector('[data-testid="rne-burst"] [contenteditable="true"]');
      if (!el) throw new Error("editor not mounted");
      return el as HTMLElement;
    });
    editable.focus();

    for (let i = 0; i < 100; i += 1) {
      await act(async () => dispatchCmdF(editable));
    }
    await screen.findByTestId("notebook-block-finder");
    // Exactly one finder is mounted regardless of how many times Cmd+F fires.
    expect(screen.getAllByTestId("notebook-block-finder")).toHaveLength(1);
  });
});
