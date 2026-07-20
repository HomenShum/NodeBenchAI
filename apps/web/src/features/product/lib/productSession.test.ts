import { describe, expect, it } from "vitest";

import { formatRecentSearchLabel } from "./productSession";

describe("formatRecentSearchLabel", () => {
  it("collapses multiline recruiter packets into a short single-line label", () => {
    const label = formatRecentSearchLabel(
      "Recruiter notes for due diligence.\nCliffside Ventures founder: https://www.linkedin.com/in/xudirk/\nNeed: role thesis, fit gaps, diligence questions, and a prep brief.",
      80,
    );

    expect(label).toBe(
      "Recruiter notes for due diligence. Cliffside Ventures founder: https://www.li...",
    );
  });
});
