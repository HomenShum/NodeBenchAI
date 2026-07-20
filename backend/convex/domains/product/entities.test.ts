import { describe, expect, it } from "vitest";

import {
  inferProductEntityType,
  looksLikeCompanyName,
  looksLikePersonName,
  mergeEntityBrowseCards,
  slugifyProductEntityName,
} from "./entities";

describe("product entity inference", () => {
  it("keeps canonical company names typed as companies even when the packet mentions founders", () => {
    expect(looksLikeCompanyName("Cliffside Ventures")).toBe(true);
    expect(
      inferProductEntityType({
        type: "prep_brief",
        entityName: "Cliffside Ventures",
        title: "Prep brief — Cliffside Ventures",
        query:
          "Recruiter notes for due diligence. Cliffside Ventures founder: https://www.linkedin.com/in/xudirk/",
        sourceUrls: [
          "https://www.linkedin.com/in/xudirk/",
          "https://cliffside.ventures/",
        ],
      }),
    ).toBe("company");
  });

  it("keeps direct LinkedIn profiles typed as people", () => {
    expect(looksLikePersonName("Dirk Xu")).toBe(true);
    expect(
      inferProductEntityType({
        type: "prep_brief",
        entityName: "Dirk Xu",
        title: "Prep brief — Dirk Xu",
        query: "Prepare me for a conversation with Dirk Xu.",
        sourceUrls: ["https://www.linkedin.com/in/xudirk/"],
      }),
    ).toBe("person");
  });

  it("slugifies company names predictably", () => {
    expect(slugifyProductEntityName("Cliffside Ventures")).toBe("cliffside-ventures");
  });

  it("merges workspace alias cards that only differ by company suffixes", () => {
    const merged = mergeEntityBrowseCards([
      {
        _id: "entity_softbank_group" as any,
        ownerKey: "anon:test",
        slug: "softbank-group-corp",
        name: "SoftBank Group Corp.",
        entityType: "company",
        summary: "Alias summary",
        latestRevision: 1,
        reportCount: 1,
        createdAt: 1,
        updatedAt: 1,
        latestReportUpdatedAt: 1,
        canonicalAliasKey: "softbank",
        canonicalDisplayName: "SoftBank Group Corp.",
        sourceUrls: ["https://www.linkedin.com/company/softbank-group-corp/"],
        sourceLabels: ["LinkedIn"],
      },
      {
        _id: "entity_softbank" as any,
        ownerKey: "anon:test",
        slug: "softbank",
        name: "SoftBank",
        entityType: "company",
        summary: "Canonical summary",
        latestRevision: 2,
        reportCount: 2,
        createdAt: 2,
        updatedAt: 2,
        latestReportUpdatedAt: 2,
        canonicalAliasKey: "softbank",
        canonicalDisplayName: "SoftBank",
        sourceUrls: ["https://www.crunchbase.com/organization/softbank"],
        sourceLabels: ["Crunchbase"],
      },
    ] as any);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.slug).toBe("softbank");
    expect(merged[0]?.name).toBe("SoftBank");
    expect(merged[0]?.reportCount).toBe(3);
    expect(merged[0]?.sourceUrls).toEqual([
      "https://www.linkedin.com/company/softbank-group-corp/",
      "https://www.crunchbase.com/organization/softbank",
    ]);
  });
});
