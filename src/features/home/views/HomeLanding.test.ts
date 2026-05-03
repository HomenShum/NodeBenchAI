import { describe, expect, it } from "vitest";
import { getApi } from "@/lib/convexApi";

import {
  buildVisibleHomeReports,
  formatPulseFreshness,
  isPulsePreviewVisible,
} from "./HomeLanding";

describe("buildVisibleHomeReports", () => {
  it("dedupes saved reports by entity slug before choosing visible cards", () => {
    const visible = buildVisibleHomeReports([
      {
        key: "report-1",
        title: "Stripe",
        summary: "Latest Stripe brief",
        prompt: "What matters most about Stripe right now?",
        type: "company",
        lens: "investor",
        entitySlug: "stripe",
        updatedLabel: "Today",
      },
      {
        key: "report-2",
        title: "Stripe",
        summary: "Older Stripe brief",
        prompt: "Update Stripe and show me what changed.",
        type: "company",
        lens: "investor",
        entitySlug: "stripe",
        updatedLabel: "Yesterday",
      },
      {
        key: "report-3",
        title: "Datadog",
        summary: "Datadog brief",
        prompt: "What changed at Datadog?",
        type: "company",
        lens: "founder",
        entitySlug: "datadog",
        updatedLabel: "Today",
      },
    ]);

    expect(visible.map((report) => report.key)).toEqual([
      "report-1",
      "report-3",
      "starter-market",
    ]);
  });

  it("fills remaining slots with starter cards when there are too few unique saved reports", () => {
    const visible = buildVisibleHomeReports([
      {
        key: "report-1",
        title: "OpenAI",
        summary: "OpenAI brief",
        prompt: "Summarize OpenAI.",
        type: "company",
        lens: "founder",
        entitySlug: "openai",
        updatedLabel: "Today",
      },
    ]);

    expect(visible.map((report) => report.key)).toEqual([
      "report-1",
      "starter-market",
      "starter-role",
    ]);
  });

  it("dedupes legacy alias reports even when their entity slugs differ", () => {
    const visible = buildVisibleHomeReports([
      {
        key: "report-1",
        title: "SoftBank Group Corp.",
        summary: "Alias report",
        prompt: "What matters most about SoftBank right now?",
        type: "company",
        lens: "investor",
        entitySlug: "softbank-group-corp",
        updatedLabel: "Today",
      },
      {
        key: "report-2",
        title: "SoftBank",
        summary: "Canonical report",
        prompt: "Update SoftBank and show me what changed.",
        type: "company",
        lens: "investor",
        entitySlug: "softbank",
        updatedLabel: "Yesterday",
      },
    ]);

    expect(visible.map((report) => report.key)).toEqual([
      "report-1",
      "starter-market",
      "starter-role",
    ]);
  });

  it("shows pulse only when the projection is fresh and has at least three items", () => {
    expect(
      isPulsePreviewVisible({
        freshnessState: "fresh",
        items: [{}, {}, {}],
      }),
    ).toBe(true);
    expect(
      isPulsePreviewVisible({
        freshnessState: "stale",
        items: [{}, {}, {}],
      }),
    ).toBe(false);
    expect(
      isPulsePreviewVisible({
        freshnessState: "fresh",
        items: [{}, {}],
      }),
    ).toBe(false);
  });

  it("formats pulse freshness for recent and older updates", () => {
    const now = Date.now();
    expect(formatPulseFreshness(now - 5 * 60 * 1000)).toBe("Updated 5m ago");
    expect(formatPulseFreshness(now - 2 * 60 * 60 * 1000)).toBe("Updated 2h ago");
    expect(formatPulseFreshness(now - 2 * 24 * 60 * 60 * 1000)).toBe("Updated 2d ago");
  });

  it("exposes the Pulse backend projection through the lazy Convex api surface", async () => {
    const api = await getApi();
    expect(api.domains.product.home.getPulsePreview).toBeDefined();
  });

  it("exposes latest public entity research for the Home landing", async () => {
    const api = await getApi();
    expect(api.domains.publicResearch.core.listLatestPublicEntityResearch).toBeDefined();
  });
});
