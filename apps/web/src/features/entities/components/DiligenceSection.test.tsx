/**
 * Tests for DiligenceSection — the reusable per-block renderer on the entity page.
 *
 * Scenario: A user opens a company entity page. For each diligence block
 *           (Founders, Products, Funding, etc.) one DiligenceSection
 *           renders — with a confidence chip, expand/collapse behavior,
 *           keyboard accessibility, and a non-useless empty state.
 *
 * Invariants under test:
 *   - Section renders with an evidence chip matching the overall tier
 *   - Collapse/expand works via click and matches aria-expanded
 *   - Empty state shows actionable copy — NEVER "nothing here"
 *   - Action clicks don't also toggle the section (stopPropagation)
 *   - Description renders when supplied, hides when not
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiligenceSection } from "./DiligenceSection";

type Founder = { name: string; role: string };

function FounderStub({ candidate }: { candidate: Founder }) {
  return (
    <div>
      <strong>{candidate.name}</strong> — {candidate.role}
    </div>
  );
}

describe("DiligenceSection", () => {
  it("renders the title and an evidence chip in the header", () => {
    render(
      <DiligenceSection<Founder>
        block="founder"
        title="Founders"
        overallTier="verified"
        candidates={[{ name: "Jane Doe", role: "CEO" }]}
        sourceCount={3}
        renderer={(c) => <FounderStub candidate={c} />}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Founders" })).toBeInTheDocument();
    // Evidence chip is a status role
    expect(screen.getByRole("status", { name: /evidence tier: verified/i })).toBeInTheDocument();
  });

  it("renders each candidate through the supplied renderer", () => {
    render(
      <DiligenceSection<Founder>
        block="founder"
        title="Founders"
        overallTier="verified"
        candidates={[
          { name: "Jane Doe", role: "CEO" },
          { name: "Arun Patel", role: "CTO" },
        ]}
        renderer={(c) => <FounderStub candidate={c} />}
      />,
    );
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Arun Patel")).toBeInTheDocument();
  });

  it("empty state shows actionable copy, never 'nothing here' (dogfood rule)", () => {
    render(
      <DiligenceSection<Founder>
        block="founder"
        title="Founders"
        overallTier="unverified"
        candidates={[]}
        renderer={(c) => <FounderStub candidate={c} />}
      />,
    );
    // Default empty label is actionable — references uploading context
    expect(screen.getByText(/unable to identify/i)).toBeInTheDocument();
    expect(screen.getByText(/uploading a deck or bio/i)).toBeInTheDocument();
    // The banned phrase must NOT appear
    expect(screen.queryByText(/nothing here/i)).not.toBeInTheDocument();
  });

  it("accepts a custom empty label", () => {
    render(
      <DiligenceSection<Founder>
        block="founder"
        title="Founders"
        overallTier="unverified"
        candidates={[]}
        renderer={(c) => <FounderStub candidate={c} />}
        emptyLabel="No founders identified yet — run a deeper pass or upload a pitch deck."
      />,
    );
    expect(screen.getByText(/run a deeper pass/i)).toBeInTheDocument();
  });

  it("collapse toggles on header click and updates aria-expanded", () => {
    render(
      <DiligenceSection<Founder>
        block="founder"
        title="Founders"
        overallTier="verified"
        candidates={[{ name: "Jane Doe", role: "CEO" }]}
        renderer={(c) => <FounderStub candidate={c} />}
      />,
    );
    const header = screen.getByRole("button", { name: /founders/i });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });

  it("starts collapsed when defaultCollapsed is true", () => {
    render(
      <DiligenceSection<Founder>
        block="founder"
        title="Founders"
        overallTier="verified"
        candidates={[{ name: "Jane Doe", role: "CEO" }]}
        renderer={(c) => <FounderStub candidate={c} />}
        defaultCollapsed
      />,
    );
    expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument();
    const header = screen.getByRole("button", { name: /founders/i });
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("renders description when supplied, omits when not", () => {
    const { rerender } = render(
      <DiligenceSection<Founder>
        block="founder"
        title="Founders"
        description="Verified against official bios."
        overallTier="verified"
        candidates={[{ name: "Jane Doe", role: "CEO" }]}
        renderer={(c) => <FounderStub candidate={c} />}
      />,
    );
    expect(screen.getByText("Verified against official bios.")).toBeInTheDocument();

    rerender(
      <DiligenceSection<Founder>
        block="founder"
        title="Founders"
        overallTier="verified"
        candidates={[{ name: "Jane Doe", role: "CEO" }]}
        renderer={(c) => <FounderStub candidate={c} />}
      />,
    );
    expect(screen.queryByText("Verified against official bios.")).not.toBeInTheDocument();
  });

  it("shows updatedLabel when supplied", () => {
    render(
      <DiligenceSection<Founder>
        block="founder"
        title="Founders"
        overallTier="verified"
        candidates={[{ name: "Jane Doe", role: "CEO" }]}
        updatedLabel="2h ago"
        renderer={(c) => <FounderStub candidate={c} />}
      />,
    );
    expect(screen.getByText(/updated 2h ago/i)).toBeInTheDocument();
  });

  it("action clicks do not toggle the section (stopPropagation)", () => {
    let actionClicked = false;
    render(
      <DiligenceSection<Founder>
        block="founder"
        title="Founders"
        overallTier="verified"
        candidates={[{ name: "Jane Doe", role: "CEO" }]}
        renderer={(c) => <FounderStub candidate={c} />}
        actions={
          <button type="button" onClick={() => { actionClicked = true; }}>
            Refresh
          </button>
        }
      />,
    );
    const refreshBtn = screen.getByRole("button", { name: "Refresh" });
    const header = screen.getByRole("button", { name: /founders/i });

    // Section starts expanded — verify, then click action
    expect(header).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(refreshBtn);
    expect(actionClicked).toBe(true);
    // Action click should NOT have toggled the section
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  it("exposes the panel region for screen readers via aria-labelledby", () => {
    render(
      <DiligenceSection<Founder>
        block="founder"
        title="Founders"
        overallTier="verified"
        candidates={[{ name: "Jane Doe", role: "CEO" }]}
        renderer={(c) => <FounderStub candidate={c} />}
      />,
    );
    const region = screen.getByRole("region", { name: /founders/i });
    expect(region).toBeInTheDocument();
  });
});
