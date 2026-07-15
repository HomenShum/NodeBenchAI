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

import { test, expect } from "@playwright/test";
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

  test("landing renders after hydration", async ({ page }) => {
    await page.goto(BASE_URL + "/");
    // After hydration there must be AT LEAST one element with real content —
    // picking <h1> as the universal "page has content" signal.
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });
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

  test("/reports/:slug/graph mounts ReportDetailWorkspace", async ({ page }) => {
    const response = await page.goto(BASE_URL + "/reports/acme-ai/graph");
    expect(response?.status()).toBe(200);
    // ReportDetailPage falls back to fixture cards in demo mode so this
    // assertion does not require the Convex ontology to be populated.
    await expect(
      page.locator('[data-testid="report-detail-workspace"]'),
    ).toBeVisible({ timeout: 20_000 });
    // Cards tab is the default; expect at least one card + the breadcrumb.
    await expect(
      page.locator('[data-testid="resource-card"]').first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[aria-label="Breadcrumb"]')).toBeVisible();
  });

  test("/?surface=reports shows contextual report action row on cards", async ({ page }) => {
    const response = await page.goto(BASE_URL + "/?surface=reports");
    expect(response?.status()).toBe(200);
    // Wait for report cards to hydrate.
    await expect(
      page.locator('[data-testid="report-card"]').first(),
    ).toBeVisible({ timeout: 20_000 });
    // Every card must carry the new action row.
    // Action labels were refreshed in PR #17 (Graph → Explore, wiring the
    // new `/workspace/w/{slug}?tab=...` URLs).
    const actionRow = page.locator('[data-testid="report-card-actions"]').first();
    await expect(actionRow).toBeVisible();
    await expect(actionRow.getByRole("button", { name: "Brief" })).toBeVisible();
    await expect(actionRow.getByRole("button", { name: /Open report sources/i })).toBeVisible();
    await expect(actionRow.getByRole("button", { name: /Open report notebook/i })).toBeVisible();
    await expect(actionRow.getByRole("button", { name: /Resume report chat/i })).toBeVisible();
    await expect(actionRow.getByRole("button", { name: /Export report to CRM CSV/i })).toBeVisible();
  });

  test("/workspace/w/:id mounts UniversalWorkspacePage chromelessly", async ({ page }) => {
    // Workspace is a separate deploy surface per docs/design/PRODUCT_SURFACES.md.
    // On the main domain the path `/workspace/*` triggers the chromeless shell
    // (the same bundle rendered via `workspace.nodebenchai.com` once DNS is live).
    const response = await page.goto(BASE_URL + "/workspace/w/acme-ai?tab=brief");
    expect(response?.status()).toBe(200);
    // Chromeless shell: assert the stable runtime contact and current report-shell
    // contract rather than retired fixture-era copy.
    const workspace = page.locator(
      '[data-agent-contact="standalone-workspace-runtime"]',
    );
    await expect(workspace).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "acme-ai" })).toBeVisible();
    await expect(page.getByText("WORKSPACE", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Detail pending - report shell active", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-rd-topnav]")).toHaveCount(0);
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
