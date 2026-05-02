/**
 * Tier B regression spec for PR #77 — me kit-aligned section anchors + jump nav.
 *
 * Defaults to production www.nodebenchai.com.  Override with BASE_URL env to
 * point at a preview deployment or localhost dev server.  Mirrors the
 * BASE_URL convention from tests/e2e/live-smoke.spec.ts so this spec can be
 * folded into the live-smoke run when desired.
 *
 * What this guards against:
 *   - The 7 kit-aligned section anchors disappearing from MeHome
 *   - The jump-nav pill row regressing label or order (kit voice)
 *   - The me cockpit case routing back to ExactMeSurface (which has no
 *     anchor IDs and no jump nav — the regression that PR #73's cockpit
 *     fix corrected)
 */

import { test, expect } from "@playwright/test";

const BASE_URL =
  process.env.BASE_URL?.replace(/\/$/, "") ?? "https://www.nodebenchai.com";

test("PR #77: /?surface=me has 7 kit-aligned anchor IDs + jump nav", async ({ page }) => {
  await page.goto(`${BASE_URL}/?surface=me`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(3000);

  const result = await page.evaluate(() => {
    const anchors = [
      "me-notebook",
      "me-profile",
      "me-files",
      "me-plan",
      "me-saved-context",
      "me-connectors",
      "me-privacy",
    ];
    return {
      hasJumpNav: !!document.querySelector('nav[aria-label="Jump to section"]'),
      navLabels: Array.from(document.querySelectorAll('nav[aria-label="Jump to section"] a')).map((a) =>
        (a.textContent ?? "").trim(),
      ),
      anchorsFound: anchors.filter((id) => !!document.getElementById(id)),
    };
  });

  console.log("PR77 Me anchor nav:", JSON.stringify(result, null, 2));

  expect(result.hasJumpNav).toBe(true);
  expect(result.navLabels).toEqual([
    "Memory",
    "Profile",
    "Files",
    "Plan",
    "Data & memory",
    "Integrations",
    "Privacy",
  ]);
  expect(result.anchorsFound).toEqual([
    "me-notebook",
    "me-profile",
    "me-files",
    "me-plan",
    "me-saved-context",
    "me-connectors",
    "me-privacy",
  ]);
});
