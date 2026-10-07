/**
 * Tests for FounderRenderer — prose-native DOM for Founders decoration.
 *
 * Scenario: A founder-identification sub-agent has structured its output
 *           at checkpoint. The renderer converts that into the HTMLElement
 *           that the ProseMirror widget decoration displays inline in the
 *           notebook reading flow.
 *
 * Invariants under test:
 *   - Produces a plain DIV (not SECTION) to avoid duplicate ARIA landmarks
 *   - Carries role="region" + aria-label so SRs can reach it
 *   - Title text equals data.headerText exactly (no re-branding)
 *   - Tier chip has correct tier label + matching color class
 *   - Body renders multiple paragraphs when bodyProse contains blank-line separators
 *   - Body renders the empty state when bodyProse is absent or whitespace
 *   - Action buttons carry data-action + data-block + data-run-id so
 *     delegated click handlers in EntityNotebookLive can route them
 *   - DOM has contenteditable="false" hint at the block attribute level
 *     (applied by the plugin wrapper, not the renderer itself)
 */

import { describe, it, expect } from "vitest";
import { renderFounderDecoration } from "./FounderRenderer";
import type { DiligenceDecorationData } from "../DiligenceDecorationPlugin";

function baseData(overrides?: Partial<DiligenceDecorationData>): DiligenceDecorationData {
  return {
    blockType: "founder",
    overallTier: "verified",
    headerText: "Founders",
    bodyProse: undefined,
    scratchpadRunId: "run_001",
    version: 1,
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("renderFounderDecoration", () => {
  it("returns a DIV with role=region + aria-label (not SECTION — avoids duplicate landmarks)", () => {
    const node = renderFounderDecoration(baseData({ headerText: "Founders" }));
    expect(node.tagName.toLowerCase()).toBe("div");
    expect(node.getAttribute("role")).toBe("region");
    expect(node.getAttribute("aria-label")).toBe("Founders");
  });

  it("applies the founder-specific class alongside the generic decoration class", () => {
    const node = renderFounderDecoration(baseData());
    expect(node.className).toContain("diligence-decoration");
    expect(node.className).toContain("diligence-decoration-founder");
  });

  it("renders the header title text exactly as supplied (no re-branding)", () => {
    const node = renderFounderDecoration(
      baseData({ headerText: "Founders · 2 verified, 1 unresolved" }),
    );
    const title = node.querySelector(".diligence-decoration-title");
    expect(title?.textContent).toBe("Founders · 2 verified, 1 unresolved");
  });

  it("emits tier chip with correct label + tone class for verified", () => {
    const node = renderFounderDecoration(baseData({ overallTier: "verified" }));
    const chip = node.querySelector(".diligence-tier");
    expect(chip?.textContent).toContain("Verified");
    expect(chip?.className).toContain("diligence-tier-verified");
    expect(chip?.getAttribute("aria-label")).toBe("Evidence tier: Verified");
  });

  it("emits distinct tone class per tier (color-blind safety is label + shape, not only color)", () => {
    for (const [tier, label, toneClass] of [
      ["verified", "Verified", "diligence-tier-verified"],
      ["corroborated", "Corroborated", "diligence-tier-corroborated"],
      ["single-source", "Single source", "diligence-tier-single"],
      ["unverified", "Unverified", "diligence-tier-unverified"],
    ] as const) {
      const node = renderFounderDecoration(baseData({ overallTier: tier }));
      const chip = node.querySelector(".diligence-tier");
      expect(chip?.textContent).toContain(label);
      expect(chip?.className).toContain(toneClass);
    }
  });

  it("renders body paragraphs split on blank lines", () => {
    const node = renderFounderDecoration(
      baseData({
        bodyProse:
          "Jane Doe is the CEO and previously worked at Stripe.\n\nArun Patel is the CTO and previously worked at Scale AI.",
      }),
    );
    const paragraphs = node.querySelectorAll(".diligence-decoration-body p");
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[0].textContent).toContain("Jane Doe");
    expect(paragraphs[1].textContent).toContain("Arun Patel");
  });

  it("renders empty-state prose when bodyProse is absent (never 'nothing here')", () => {
    const node = renderFounderDecoration(baseData({ bodyProse: undefined }));
    const empty = node.querySelector(".diligence-decoration-empty");
    expect(empty).not.toBeNull();
    expect(empty?.textContent ?? "").toMatch(/No founders identified yet/);
    expect(empty?.textContent ?? "").toMatch(/upload a team bio/);
  });

  it("renders empty-state when bodyProse is only whitespace", () => {
    const node = renderFounderDecoration(baseData({ bodyProse: "   \n\n  " }));
    const empty = node.querySelector(".diligence-decoration-empty");
    expect(empty).not.toBeNull();
  });

  it("emits 3 action buttons with data-action + data-block + data-run-id delegation hooks", () => {
    const node = renderFounderDecoration(
      baseData({ scratchpadRunId: "run_xyz_42" }),
    );
    const actions = node.querySelectorAll(".diligence-decoration-action");
    expect(actions.length).toBe(3);
    // Accept, Refresh, Dismiss in order
    const kinds = Array.from(actions).map((a) => a.getAttribute("data-action"));
    expect(kinds).toEqual(["accept", "refresh", "dismiss"]);
    // Every action carries block + run-id for delegated handlers
    for (const a of Array.from(actions)) {
      expect(a.getAttribute("data-block")).toBe("founder");
      expect(a.getAttribute("data-run-id")).toBe("run_xyz_42");
    }
  });

  it("renders a human relative timestamp like 'Xm ago' or 'just now'", () => {
    const recent = renderFounderDecoration(
      baseData({ updatedAt: Date.now() - 2 * 60_000 }),
    );
    const updated = recent.querySelector(".diligence-decoration-updated");
    expect(updated?.textContent ?? "").toMatch(/updated\s+2m ago/);

    const veryRecent = renderFounderDecoration(
      baseData({ updatedAt: Date.now() - 10_000 }),
    );
    expect(
      veryRecent.querySelector(".diligence-decoration-updated")?.textContent ?? "",
    ).toMatch(/updated\s+just now/);
  });

  it("dismiss button has the muted modifier class (visually quieter)", () => {
    const node = renderFounderDecoration(baseData());
    const dismiss = node.querySelector('[data-action="dismiss"]');
    expect(dismiss?.className).toContain("diligence-decoration-action-muted");
  });
});
