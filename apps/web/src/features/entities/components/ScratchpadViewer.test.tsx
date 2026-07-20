/**
 * Tests for ScratchpadViewer — raw working-memory viewer.
 *
 * Scenario: A power user opens the scratchpad drawer during a live run to
 *           see what the agent is writing. The viewer defaults to collapsed
 *           (non-power users never see it), shows honest loading/empty
 *           states, and never steals focus.
 *
 * Invariants under test:
 *   - Default-collapsed (not shown unless user asks)
 *   - Loading state is honest ("Loading scratchpad…")
 *   - Empty state is actionable, never "nothing here"
 *   - Raw markdown renders as pre-wrap monospace
 *   - Click toggles expand/collapse via aria-expanded
 *   - "Open full" button fires callback when provided
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScratchpadViewer } from "./ScratchpadViewer";

describe("ScratchpadViewer", () => {
  it("starts collapsed by default (power-user opt-in)", () => {
    render(<ScratchpadViewer markdownSource="# Acme\nfounders: Jane Doe" />);
    const header = screen.getByRole("button", { name: /scratchpad/i });
    expect(header).toHaveAttribute("aria-expanded", "false");
    // Body should not be rendered
    expect(screen.queryByText(/# Acme/)).not.toBeInTheDocument();
  });

  it("can default-expand when explicitly requested", () => {
    render(
      <ScratchpadViewer
        markdownSource="# Acme\nfounders: Jane Doe"
        defaultExpanded
      />,
    );
    const header = screen.getByRole("button", { name: /scratchpad/i });
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  it("toggles open/closed on header click", () => {
    render(<ScratchpadViewer markdownSource="# Content" />);
    const header = screen.getByRole("button", { name: /scratchpad/i });
    expect(header).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/# Content/i)).toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("shows honest loading state when markdownSource is undefined", () => {
    render(<ScratchpadViewer markdownSource={undefined} defaultExpanded />);
    expect(screen.getByText(/loading scratchpad/i)).toBeInTheDocument();
  });

  it("shows actionable empty state when markdownSource is null (never 'nothing here')", () => {
    render(<ScratchpadViewer markdownSource={null} defaultExpanded />);
    expect(screen.getByText(/no scratchpad yet/i)).toBeInTheDocument();
    expect(screen.getByText(/start a run/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing here/i)).not.toBeInTheDocument();
  });

  it("renders markdown source as preformatted monospace block", () => {
    const md = "# Acme AI\n\n## Founders\n- Jane Doe\n- Arun Patel";
    render(<ScratchpadViewer markdownSource={md} defaultExpanded />);
    const pre = screen.getByLabelText(/scratchpad markdown content/i);
    expect(pre.tagName.toLowerCase()).toBe("pre");
    expect(pre.textContent).toContain("Acme AI");
    expect(pre.textContent).toContain("Jane Doe");
  });

  it("renders run label + version when supplied", () => {
    render(
      <ScratchpadViewer
        markdownSource="test"
        runLabel="Acme AI · run 42"
        version={7}
        defaultExpanded
      />,
    );
    expect(screen.getByText(/Acme AI . run 42/)).toBeInTheDocument();
    expect(screen.getByText(/v7/)).toBeInTheDocument();
  });

  it("fires onOpenFull callback when 'Open full view' button is clicked", () => {
    const onOpenFull = vi.fn();
    render(
      <ScratchpadViewer
        markdownSource="test"
        onOpenFull={onOpenFull}
        defaultExpanded
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open full view/i }));
    expect(onOpenFull).toHaveBeenCalledTimes(1);
  });

  it("omits 'Open full view' button when no callback supplied", () => {
    render(<ScratchpadViewer markdownSource="test" defaultExpanded />);
    expect(screen.queryByRole("button", { name: /open full view/i })).not.toBeInTheDocument();
  });

  it("describes scratchpad as the agent's working memory (power-user context)", () => {
    render(<ScratchpadViewer markdownSource="test" defaultExpanded />);
    expect(screen.getByText(/raw working memory/i)).toBeInTheDocument();
    expect(screen.getByText(/derived from this file on checkpoint/i)).toBeInTheDocument();
  });
});
