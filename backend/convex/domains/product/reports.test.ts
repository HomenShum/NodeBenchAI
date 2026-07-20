import { describe, expect, it } from "vitest";

import { mergeReportCardsForHome } from "./reports";

describe("mergeReportCardsForHome", () => {
  it("collapses legacy alias reports onto the canonical entity name and slug", () => {
    const merged = mergeReportCardsForHome([
      {
        _id: "report_alias" as any,
        ownerKey: "anon:test",
        entitySlug: "softbank-group-corp",
        primaryEntity: "SoftBank Group Corp.",
        title: "SoftBank Group Corp.",
        summary: "Alias summary",
        query: "What matters most about SoftBank right now?",
        type: "report",
        updatedAt: 10,
        createdAt: 10,
        status: "saved",
        pinned: false,
        lens: "investor",
        sections: [],
        sources: [],
        evidenceItemIds: [],
        canonicalAliasKey: "softbank",
        canonicalDisplayName: "SoftBank Group Corp.",
      },
      {
        _id: "report_canonical" as any,
        ownerKey: "anon:test",
        entitySlug: "softbank",
        primaryEntity: "SoftBank",
        title: "SoftBank",
        summary: "Canonical summary",
        query: "Update SoftBank and show me what changed.",
        type: "company",
        updatedAt: 9,
        createdAt: 9,
        status: "saved",
        pinned: false,
        lens: "investor",
        sections: [],
        sources: [],
        evidenceItemIds: [],
        canonicalAliasKey: "softbank",
        canonicalDisplayName: "SoftBank",
      },
    ] as any);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe("SoftBank");
    expect(merged[0]?.entitySlug).toBe("softbank");
  });
});
