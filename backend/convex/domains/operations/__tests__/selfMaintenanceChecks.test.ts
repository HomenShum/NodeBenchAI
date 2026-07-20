import { describe, expect, test } from "vitest";
import {
  evaluateDidYouKnowArchiveRow,
  evaluateDidYouKnowSourcesUsed,
  evaluateDailyBriefDidYouKnow,
  evaluateLinkedInArchiveAudit,
} from "../selfMaintenanceChecks";

describe("selfMaintenanceChecks", () => {
  test("evaluateLinkedInArchiveAudit passes only when hard issues are zero", () => {
    const ok = evaluateLinkedInArchiveAudit({
      scanned: 10,
      duplicates: { duplicateGroups: 0, duplicateRows: 0 },
      postUrnReuse: { distinctPostUrns: 10, reusedPostUrns: 0, reusedPostUrnsDifferentContent: 0 },
      issues: { missingPostUrn: 0, missingPostUrl: 0, overLength: 0, mojibake: 0, unknownCompany: 0, demoMarkers: 0 },
    });
    expect(ok.passed).toBe(true);

    const bad = evaluateLinkedInArchiveAudit({
      scanned: 10,
      duplicates: { duplicateGroups: 1, duplicateRows: 2 },
      postUrnReuse: { distinctPostUrns: 10, reusedPostUrns: 1, reusedPostUrnsDifferentContent: 0 },
      issues: { missingPostUrn: 0, missingPostUrl: 0, overLength: 0, mojibake: 0, unknownCompany: 0, demoMarkers: 0 },
    });
    expect(bad.passed).toBe(false);
    expect(bad.checks.noDuplicateRows).toBe(false);
  });

  test("evaluateDidYouKnowSourcesUsed requires url and publishedAtIso", () => {
    const ok = evaluateDidYouKnowSourcesUsed([
      { url: "https://example.com/a", publishedAtIso: "2026-02-01T00:00:00.000Z" },
      { canonicalUrl: "https://example.com/b", publishedAtIso: "2026-02-01T12:00:00.000Z" },
    ]);
    expect(ok.passed).toBe(true);

    const bad = evaluateDidYouKnowSourcesUsed([{ url: "https://example.com/a" }]);
    expect(bad.passed).toBe(false);
    expect(bad.checks.allSourcesHavePublishedAtIso).toBe(false);
  });

  test("evaluateDidYouKnowArchiveRow requires metadata.didYouKnow and llm judge pass", () => {
    const ok = evaluateDidYouKnowArchiveRow({
      postType: "did_you_know",
      metadata: {
        didYouKnow: {
          passed: true,
          llmJudge: { passed: true },
          checks: { allSourcesHavePublishedAtIso: true },
          sourcesUsed: [{ url: "https://example.com/a", publishedAtIso: "2026-02-01T00:00:00.000Z" }],
        },
      },
    });
    expect(ok.passed).toBe(true);

    const bad = evaluateDidYouKnowArchiveRow({
      postType: "did_you_know",
      metadata: { didYouKnow: { passed: true, llmJudge: { passed: false }, sourcesUsed: [] } },
    });
    expect(bad.passed).toBe(false);
  });

  test("evaluateDailyBriefDidYouKnow gates like archive row", () => {
    const ok = evaluateDailyBriefDidYouKnow({
      passed: true,
      llmJudge: { passed: true },
      sourcesUsed: [{ url: "https://example.com/a", publishedAtIso: "2026-02-01T00:00:00.000Z" }],
      checks: { allSourcesHavePublishedAtIso: true },
    });
    expect(ok.passed).toBe(true);

    const bad = evaluateDailyBriefDidYouKnow(null);
    expect(bad.passed).toBe(false);
  });
});

