/**
 * Tests for EvidenceChip — the inline confidence + source chip.
 *
 * Scenario: First-time user opens an entity page and sees rendered facts
 *           inline. Every fact carries a chip so the user can tell at a
 *           glance which facts to trust. This chip is the single most
 *           visible primitive of the credibility-first UX.
 *
 * Invariants under test:
 *   - Tier label is always visible text (color-blind safety)
 *   - Screen-reader aria-label includes the reason
 *   - Singular/plural source count renders correctly (Ive polish)
 *   - Compact mode shrinks padding, not legibility
 *   - Every tier has a dot indicator (accessibility: color is not the only signal)
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvidenceChip } from "./EvidenceChip";

describe("EvidenceChip", () => {
  it("renders the Verified label for verified tier (never raw enum value)", () => {
    render(<EvidenceChip tier="verified" />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.queryByText("verified")).not.toBeInTheDocument(); // raw enum never rendered
  });

  it("renders the Corroborated label for corroborated tier", () => {
    render(<EvidenceChip tier="corroborated" />);
    expect(screen.getByText("Corroborated")).toBeInTheDocument();
  });

  it("renders the Single source label for single-source tier", () => {
    render(<EvidenceChip tier="single-source" />);
    expect(screen.getByText("Single source")).toBeInTheDocument();
  });

  it("renders the Unverified label for unverified tier", () => {
    render(<EvidenceChip tier="unverified" />);
    expect(screen.getByText("Unverified")).toBeInTheDocument();
  });

  it("includes the reason in aria-label for screen-readers (a11y rule)", () => {
    render(
      <EvidenceChip
        tier="verified"
        reason="Confirmed by SEC EDGAR Form D and company press release."
      />,
    );
    const chip = screen.getByRole("status");
    expect(chip).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Confirmed by SEC EDGAR"),
    );
  });

  it("defaults the reason when none is supplied (never blank aria-label)", () => {
    render(<EvidenceChip tier="unverified" />);
    const chip = screen.getByRole("status");
    expect(chip.getAttribute("aria-label") ?? "").toMatch(/Not yet verified/i);
  });

  it("renders source label when supplied", () => {
    render(<EvidenceChip tier="corroborated" sourceLabel="LinkedIn · TechCrunch" />);
    expect(screen.getByText("LinkedIn · TechCrunch")).toBeInTheDocument();
  });

  it("renders singular 'src' for exactly 1 source (Ive polish: grammar)", () => {
    render(<EvidenceChip tier="single-source" sourceCount={1} />);
    // count + unit are in the same span, separated by a space
    expect(screen.getByText(/^1\s+src$/)).toBeInTheDocument();
  });

  it("renders plural 'srcs' for 2+ sources", () => {
    render(<EvidenceChip tier="verified" sourceCount={3} />);
    expect(screen.getByText(/^3\s+srcs$/)).toBeInTheDocument();
  });

  it("does not render source-count span when sourceCount is 0 (don't advertise nothing)", () => {
    render(<EvidenceChip tier="unverified" sourceCount={0} />);
    expect(screen.queryByText(/srcs?$/)).not.toBeInTheDocument();
  });

  it("does not render source-count span when sourceCount is undefined", () => {
    render(<EvidenceChip tier="verified" />);
    expect(screen.queryByText(/srcs?$/)).not.toBeInTheDocument();
  });

  it("shows the full reason in the title attribute (hover tooltip)", () => {
    render(
      <EvidenceChip tier="verified" reason="Company About page + Crunchbase." />,
    );
    const chip = screen.getByRole("status");
    expect(chip).toHaveAttribute("title", "Company About page + Crunchbase.");
  });

  it("has a dot indicator for color-blind safety (not color-only signaling)", () => {
    const { container } = render(<EvidenceChip tier="verified" />);
    // The dot is the first aria-hidden span; it must exist
    const dot = container.querySelector("span[aria-hidden='true']");
    expect(dot).not.toBeNull();
  });

  it("applies compact padding when compact prop is true", () => {
    const { container } = render(<EvidenceChip tier="verified" compact />);
    const chip = container.querySelector("[role='status']");
    expect(chip?.className).toContain("py-0.5");
  });

  it("applies normal padding when compact is false (default)", () => {
    const { container } = render(<EvidenceChip tier="verified" />);
    const chip = container.querySelector("[role='status']");
    expect(chip?.className).toContain("py-1");
  });
});
