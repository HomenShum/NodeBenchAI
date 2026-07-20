/**
 * live-smoke-mobile — Tier B / post-deploy mobile verification.
 *
 * Rewritten 2026-07-17: the previous version asserted the standalone mobile
 * shell surfaces (mobile-home-surface, mobile-reports-surface, ...), which
 * stopped mounting when #561 contracted NodeBench to the single decision
 * workspace — every entry route now resolves to /redesign/chat at every
 * viewport. The old assertions were red against current production while
 * living outside CI: exactly the "test the pipeline cannot see" failure mode
 * issue #567 documented. This spec now asserts the one-surface reality;
 * richer per-clause coverage lives in the surface contract
 * (proof/ui-contract/surfaces/decision-workspace.contract.json) executed
 * by ui-contract-runner.spec.ts.
 */

import { expect, test } from "@playwright/test";

const BASE_URL =
  process.env.BASE_URL?.replace(/\/$/, "") ?? "https://www.nodebenchai.com";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  expect(fits, "mobile runtime surface should not overflow horizontally").toBe(true);
}

test.describe("live-smoke-mobile — one workspace at 390px", () => {
  test.setTimeout(45_000);

  for (const path of ["/", "/?surface=reports", "/?surface=chat", "/?surface=inbox", "/?surface=me"]) {
    test(`${path} resolves to the single decision workspace`, async ({ page }) => {
      await page.goto(`${BASE_URL}${path}`);
      await expect(page).toHaveURL(/\/redesign\/chat(?:[/?#]|$)/, { timeout: 20_000 });
      await expect(page.getByTestId("one-surface-workspace")).toBeVisible({ timeout: 20_000 });
      // Exactly one composer; the legacy mobile shell must not resurface.
      await expect(page.locator("textarea:visible")).toHaveCount(1);
      await expect(page.getByTestId("mobile-home-surface")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("unknown share link degrades honestly on mobile", async ({ page }) => {
    await page.goto(`${BASE_URL}/redesign/chat/r/__smoke_missing__`);
    await expect(page.getByText("That reproducible answer is unavailable").first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("one-surface-workspace")).toBeVisible({ timeout: 20_000 });
    await expectNoHorizontalOverflow(page);
  });
});
