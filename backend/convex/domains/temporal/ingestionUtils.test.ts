import { describe, expect, it } from "vitest";
import {
  buildObservationsFromExtraction,
  getSafeAverageStepMs,
} from "./ingestionUtils";
import type { ExtractionResult } from "./langExtract";

describe("temporal ingestion utils", () => {
  it("maps extracted evidence into ordered observations with source refs", () => {
    const extraction: ExtractionResult = {
      entities: [],
      claims: [
        {
          claimText: "Payment retries caused a three day delay.",
          claimType: "causal",
          entities: ["Payment retries"],
          confidence: 0.9,
          sourceSpan: {
            lineStart: 3,
            lineEnd: 3,
            excerpt: "Payment retries caused a three day delay.",
          },
          temporalMarker: "Q1 2026",
        },
      ],
      temporalMarkers: [
        {
          text: "Q1 2026",
          resolvedDate: new Date("2026-01-01T00:00:00Z").getTime(),
          lineNumber: 1,
        },
      ],
      numericFacts: [
        {
          metric: "token_cost",
          value: 18,
          units: "percent",
          context: "Project Atlas reduced token cost by 18%",
          lineNumber: 2,
        },
      ],
      sourceMetadata: {
        totalLines: 3,
        totalChars: 90,
        extractionDurationMs: 12,
      },
    };

    const observations = buildObservationsFromExtraction(
      extraction,
      {
        sourceType: "jira",
        sourceLabel: "jira-history",
        sourceUrl: "https://example.com/jira/ABC-123",
      },
      new Date("2026-02-01T00:00:00Z").getTime()
    );

    expect(observations).toHaveLength(3);
    expect(observations[0]?.observationType).toBe("numeric");
    expect(observations[0]?.sourceRefs?.[0]).toMatchObject({
      label: "jira-history",
      href: "https://example.com/jira/ABC-123",
      lineStart: 2,
      lineEnd: 2,
    });
    expect(observations.some((observation) => observation.observationType === "event")).toBe(true);
    expect(
      observations.some((observation) => observation.headline === "temporal_marker")
    ).toBe(true);
  });

  it("falls back to one day spacing when timestamps are identical", () => {
    expect(
      getSafeAverageStepMs([
        { t: 1000, v: 1 },
        { t: 1000, v: 2 },
        { t: 1000, v: 3 },
      ])
    ).toBe(86400000);
  });
});
