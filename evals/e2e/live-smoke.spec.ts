/**
 * live-smoke.spec.ts — Tier B hydrated-DOM verifier.
 *
 * Complements scripts/verify-live.ts (Tier A = raw-HTML). Tier A proves the
 * server is serving the right bundle; Tier B proves the browser actually
 * renders the route after hydration.
 *
 * Together they enforce .claude/rules/live_dom_verification.md:
 *
 *   Before saying "deployed", "live", "shipped":
 *     1. git push
 *     2. vercel ls / convex deploy → Ready
 *     3. npx tsx scripts/verify-live.ts → LIVE OK  (Tier A)
 *     4. BASE_URL=https://www.nodebenchai.com npx playwright test live-smoke  (Tier B)
 *     5. ONLY THEN claim live
 *
 * Override URL for preview deploys:
 *   BASE_URL=https://preview-xyz.vercel.app npx playwright test live-smoke
 *
 * Why separate from the other e2e specs:
 *   - All other specs use BASE_URL=localhost (dev server). This spec is
 *     explicitly for PROD / PREVIEW. Running it against localhost works
 *     but the signal is different.
 *   - Keeping it in its own file lets `npm run live-smoke` target just
 *     these assertions for fast verification after deploy.
 *
 * The assertions are deliberately minimal — no flaky dependencies on
 * Convex auth, LLM API keys, or live data. Just "does the React tree
 * hydrate and render the correct component for the route".
 */

import { test, expect, type Page } from "@playwright/test";
import { installVercelPreviewBypass } from "./helpers/vercelPreview";

const BASE_URL =
  process.env.BASE_URL?.replace(/\/$/, "") ?? "https://www.nodebenchai.com";

// Each test navigates then waits for the SPA to hydrate. networkidle is
// flaky on production (background Convex subscriptions keep firing), so
// we wait for a specific element instead.
test.describe("live-smoke — Tier B hydrated-DOM verification", () => {
  test.setTimeout(45_000);
  test.beforeEach(async ({ page }) => {
    await installVercelPreviewBypass(page, BASE_URL);
  });

  async function expectSingleWorkspace(page: Page) {
    await expect(page).toHaveURL(/\/redesign\/chat(?:[/?#]|$)/);
    await expect(page.locator('[data-product-surface="decision-workspace"]')).toHaveCount(1);
    await expect(page.getByTestId("one-surface-workspace")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("textarea:visible")).toHaveCount(1);
    await expect(page.locator("nav")).toHaveCount(0);
  }

  test("landing renders after hydration", async ({ page }) => {
    await page.goto(BASE_URL + "/");
    await expectSingleWorkspace(page);
    await expect(
      page.getByRole("heading", { name: "What do you need to know?" }),
    ).toBeVisible();
  });

  test("/share/{dummy} renders 'Link not found' StatusCard", async ({ page }) => {
    const response = await page.goto(
      BASE_URL + "/share/nonexistent-token-live-smoke",
    );
    expect(response?.status()).toBe(200);
    // PublicEntityShareView.tsx renders the describeShareStatus('not_found')
    // title text after React hydrates + Convex query resolves.
    await expect(page.getByText(/Link not found/i)).toBeVisible({
      timeout: 20_000,
    });
    // Also verify the recovery CTA is present so users aren't stranded.
    await expect(page.getByRole("link", { name: /Back to NodeBench/i })).toBeVisible();
  });

  test("/developers page hydrates", async ({ page }) => {
    const response = await page.goto(BASE_URL + "/developers");
    expect(response?.status()).toBe(200);
    // Any <h1> or <h2> is enough — confirms React tree rendered content.
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("/pricing page hydrates", async ({ page }) => {
    const response = await page.goto(BASE_URL + "/pricing");
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("/changelog page hydrates", async ({ page }) => {
    const response = await page.goto(BASE_URL + "/changelog");
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("/reports/:slug/graph opens map context in the single workspace", async ({ page }) => {
    const response = await page.goto(BASE_URL + "/reports/acme-ai/graph");
    expect(response?.status()).toBe(200);
    await expectSingleWorkspace(page);
    await expect(page).toHaveURL(/\/redesign\/chat\?report=acme-ai&artifact=map/);
    await expect(page.getByText(/map context/i).first()).toBeVisible();
    await expect(page.locator('[data-testid="report-detail-workspace"]')).toHaveCount(0);
  });

  test("/?surface=reports retires the reports rail into the single workspace", async ({ page }) => {
    const response = await page.goto(BASE_URL + "/?surface=reports");
    expect(response?.status()).toBe(200);
    await expectSingleWorkspace(page);
    await expect(page.getByTestId("reports-performance-root")).toHaveCount(0);
  });

  test("main-host /workspace/w/:id converges on the single workspace", async ({ page }) => {
    // Dedicated workspace hosts retain their separate delivery surface. On the
    // main product host, workspace paths must not resurrect a second app shell.
    const response = await page.goto(BASE_URL + "/workspace/w/acme-ai?tab=brief");
    expect(response?.status()).toBe(200);
    await expectSingleWorkspace(page);
    await expect(
      page.locator('[data-agent-contact="standalone-workspace-runtime"]'),
    ).toHaveCount(0);
  });

  test("console has no uncaught errors during landing load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto(BASE_URL + "/");
    await page.waitForTimeout(3_000);
    // Filter out known-benign sources (third-party scripts, CSP warnings
    // that don't block functionality). If this starts flaking in CI, drop
    // to a whitelist pattern.
    const real = errors.filter(
      (e) =>
        !/favicon/i.test(e) &&
        !/CSP/i.test(e) &&
        !/Third-party cookie/i.test(e) &&
        !/extension/i.test(e),
    );
    expect(
      real,
      "console errors on landing:\n" + real.map((e) => "  - " + e).join("\n"),
    ).toEqual([]);
  });
});
