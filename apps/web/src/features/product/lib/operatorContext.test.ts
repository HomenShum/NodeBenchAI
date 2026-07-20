import { describe, expect, it } from "vitest";

import {
  buildOperatorContextHint,
  buildOperatorContextLabel,
  normalizeRolesOfInterest,
  rolesOfInterestToText,
} from "./operatorContext";

describe("operatorContext helpers", () => {
  it("normalizes roles of interest from free-form text", () => {
    expect(normalizeRolesOfInterest("Founder, investor\nfounder, operator")).toEqual([
      "Founder",
      "investor",
      "founder",
      "operator",
    ]);
  });

  it("builds a compact context hint from profile fields", () => {
    const hint = buildOperatorContextHint({
      backgroundSummary: "Former startup operator evaluating infra and fintech companies.",
      preferredLens: "investor",
      rolesOfInterest: ["Founder", "Operator"],
      preferences: {
        communicationStyle: "concise",
        evidenceStyle: "citation_heavy",
        avoidCorporateTone: true,
      },
    });

    expect(hint).toContain("Background:");
    expect(hint).toContain("Preferred lens: investor.");
    expect(hint).toContain("Roles of interest: Founder, Operator.");
    expect(hint).toContain("Communication style: concise.");
    expect(hint).toContain("Evidence mode: citation heavy.");
    expect(hint).toContain("Avoid corporate or filler-heavy tone.");
  });

  it("builds a visible operator context label", () => {
    expect(
      buildOperatorContextLabel({
        preferredLens: "founder",
        preferences: {
          communicationStyle: "concise",
          evidenceStyle: "citation_heavy",
          avoidCorporateTone: true,
        },
      }),
    ).toBe("founder | concise | citation heavy | no corporate tone");
  });

  it("round-trips roles text for the form", () => {
    expect(rolesOfInterestToText(["Founder", "Investor"])).toBe("Founder, Investor");
  });
});
