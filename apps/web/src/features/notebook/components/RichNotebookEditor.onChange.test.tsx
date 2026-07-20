import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RichNotebookEditor } from "./RichNotebookEditor";

afterEach(() => {
  cleanup();
  // localStorage is shared across tests in jsdom; clear notebook keys.
  if (typeof window !== "undefined") {
    Object.keys(window.localStorage).forEach((k) => {
      if (k.startsWith("nodebench.report.")) window.localStorage.removeItem(k);
    });
  }
});

describe("RichNotebookEditor — onChange callback (Convex persistence hook)", () => {
  it("Scenario: typing into the editor invokes onChange with the latest HTML", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(html: string) => void>();
    render(
      <RichNotebookEditor
        initialContent="<p>seed</p>"
        onChange={onChange}
        testId="cb-editor"
      />,
    );

    const editor = await waitFor(() => {
      const el = document.querySelector(
        '[data-testid="cb-editor"] [contenteditable="true"]',
      );
      if (!el) throw new Error("editor not yet mounted");
      return el as HTMLElement;
    });
    editor.focus();
    await user.keyboard(" appended");

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const lastCall = onChange.mock.calls.at(-1);
    expect(typeof lastCall?.[0]).toBe("string");
    expect(lastCall?.[0]).toContain("appended");
  });

  it("Scenario: onChange is not called for purely structural mounts (no spurious save fires)", async () => {
    const onChange = vi.fn<(html: string) => void>();
    render(
      <RichNotebookEditor
        initialContent="<p>stable</p>"
        onChange={onChange}
        testId="stable-editor"
      />,
    );

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="stable-editor"] [contenteditable="true"]'),
      ).not.toBeNull();
    });
    // Allow a frame to ensure no async transactions land.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Scenario: localStorage save survives editor remount with the same storageKey", async () => {
    const user = userEvent.setup();
    const storageKey = "nodebench.report.test-key.notebook";

    // First mount — type, the editor writes to localStorage on its own
    // (independent from the onChange callback).
    const { unmount } = render(
      <RichNotebookEditor
        initialContent="<p>v1</p>"
        storageKey={storageKey}
        testId="ls-editor"
      />,
    );

    const editor1 = await waitFor(() => {
      const el = document.querySelector(
        '[data-testid="ls-editor"] [contenteditable="true"]',
      );
      if (!el) throw new Error("editor not yet mounted");
      return el as HTMLElement;
    });
    editor1.focus();
    await user.keyboard(" persisted");

    // Wait a beat for the debounced save.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1000));
    });
    const stored = window.localStorage.getItem(storageKey);
    expect(stored).toContain("persisted");

    unmount();

    // Second mount — editor should read from localStorage instead of seed.
    render(
      <RichNotebookEditor
        initialContent="<p>v1-different-seed</p>"
        storageKey={storageKey}
        testId="ls-editor-2"
      />,
    );
    const editor2 = await waitFor(() => {
      const el = document.querySelector(
        '[data-testid="ls-editor-2"] [contenteditable="true"]',
      );
      if (!el) throw new Error("editor 2 not yet mounted");
      return el as HTMLElement;
    });
    expect(editor2.innerHTML).toContain("persisted");
  });
});
