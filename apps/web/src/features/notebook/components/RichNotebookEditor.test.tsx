import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { RichNotebookEditor } from "./RichNotebookEditor";

describe("RichNotebookEditor wiring", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("appends a parent action request once and routes it through onChange", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RichNotebookEditor
        initialContent="<p>Base memo</p>"
        testId="rich-editor"
        onChange={onChange}
      />,
    );

    await screen.findByText("Base memo");

    rerender(
      <RichNotebookEditor
        initialContent="<p>Base memo</p>"
        testId="rich-editor"
        onChange={onChange}
        appendRequest={{
          id: "patch.1",
          html: "<h3>Accepted section</h3><p>Inserted from action patch.</p>",
        }}
      />,
    );

    await screen.findByText("Accepted section");
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.stringContaining("Accepted section"));
    });

    rerender(
      <RichNotebookEditor
        initialContent="<p>Base memo</p>"
        testId="rich-editor"
        onChange={onChange}
        appendRequest={{
          id: "patch.1",
          html: "<h3>Accepted section</h3><p>Inserted from action patch.</p>",
        }}
      />,
    );

    expect(screen.getAllByText("Accepted section")).toHaveLength(1);
  });

  it("parses seeded proposal and claim nodes from data attributes", async () => {
    render(
      <RichNotebookEditor
        initialContent="<p>Base memo</p>"
        testId="rich-editor"
        proposals={[
          {
            id: "proposal.1",
            label: "Rewrite",
            note: "Tighten this sentence.",
            originalText: "Original wording",
            proposedText: "Sharper wording",
          },
        ]}
        claims={[
          {
            statement: "Orbital Labs is seed-stage.",
            support: 0,
            conflict: 1,
            evidence: [],
            open: true,
          },
        ]}
      />,
    );

    await screen.findByText("Sharper wording");
    expect(screen.getByText("Original wording")).toBeInTheDocument();
    expect(screen.getByText("Orbital Labs is seed-stage.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept proposal: Rewrite" })).toBeInTheDocument();
  });
});
