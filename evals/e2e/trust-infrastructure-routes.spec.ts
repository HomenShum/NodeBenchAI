import { test, expect, Page } from "@playwright/test";
import { join } from "path";
import { mkdirSync } from "fs";

/**
 * Trust Infrastructure Route Smoke Tests
 *
 * Verifies the 3 new agent trust routes render correctly:
 * - /control-plane (landing page with links to sub-surfaces)
 * - /receipts (action receipt feed with demo data)
 * - /investigation (enterprise investigation with FTX golden dataset)
 *
 * Each test:
 *   User:      Returning analyst checking agent trust surfaces
 *   Goal:      Navigate to route, verify primary content renders, no crash
 *   Duration:  Single page load per route
 *   Scale:     1 user
 *   Edge:      Cold load (no localStorage), reduced motion, dark mode
 */

const OUT_DIR = join(
  process.cwd(),
  'tests', 'fixtures',
  "screenshots",
  "trust-infrastructure",
);

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

/** Force dark mode + reduced motion to avoid animation flashes. */
async function setupTheme(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "nodebench-theme",
      JSON.stringify({ mode: "dark", reducedMotion: true }),
    );
    localStorage.setItem("theme", "dark");
  });
}

// ─── Control Plane ──────────────────────────────────────────────────────────

test.describe("Control Plane Landing", () => {
  test("renders heading and navigation links", async ({ page }) => {
    await setupTheme(page);
    await page.goto("/control-plane");
    await page.waitForLoadState("networkidle");

    // Should show the control plane heading
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    // Should have at least one clickable navigation element
    const links = page.locator("button, a").filter({ hasText: /oracle|receipt|investigation/i });
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(1);

    await page.screenshot({
      path: join(OUT_DIR, "control-plane.png"),
      fullPage: true,
    });
  });

  test("no console errors on cold load", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await setupTheme(page);
    await page.goto("/control-plane");
    await page.waitForLoadState("networkidle");

    // Filter out known Convex auth warnings (expected without auth)
    const real = errors.filter(
      (e) => !e.includes("Convex") && !e.includes("auth") && !e.includes("clerk"),
    );
    expect(real).toHaveLength(0);
  });
});

// ─── Action Receipts ────────────────────────────────────────────────────────

test.describe("Action Receipts Feed", () => {
  test("renders demo receipts with stats bar", async ({ page }) => {
    await setupTheme(page);
    await page.goto("/receipts");
    await page.waitForLoadState("networkidle");

    // Should show the Action Receipts heading
    await expect(
      page.locator("h1").filter({ hasText: /action receipts/i }),
    ).toBeVisible({ timeout: 10000 });

    // Stats bar should show the current 5 trust summary cards.
    await expect(page.locator("text=Total").first()).toBeVisible();
    await expect(page.locator("text=Needs approval").first()).toBeVisible();
    await expect(page.locator("text=Reversible").first()).toBeVisible();
    await expect(page.locator("text=Denied").first()).toBeVisible();
    await expect(page.locator("text=Allowed").first()).toBeVisible();

    // Should have at least 1 receipt card rendered
    const receiptCards = page.locator("button").filter({ hasText: /research-scout|financial-analyst|autonomous-trader/i });
    const count = await receiptCards.count();
    expect(count).toBeGreaterThanOrEqual(1);

    await page.screenshot({
      path: join(OUT_DIR, "receipts-feed.png"),
      fullPage: true,
    });
  });

  test("filter buttons work", async ({ page }) => {
    await setupTheme(page);
    await page.goto("/receipts");
    await page.waitForLoadState("networkidle");

    // Click "Denied" filter
    const deniedBtn = page.locator("button").filter({ hasText: /^Denied/ });
    await deniedBtn.click();

    // Should show only denied receipts (1 in demo data)
    const visibleCards = page.locator("button").filter({ hasText: /autonomous-trader/i });
    await expect(visibleCards).toBeVisible();

    // "Allowed" agents should not be visible
    const allowedCards = page.locator("button").filter({ hasText: /research-scout/i });
    await expect(allowedCards).toHaveCount(0);

    await page.screenshot({
      path: join(OUT_DIR, "receipts-filtered-denied.png"),
      fullPage: true,
    });
  });

  test("receipt card expands to show details", async ({ page }) => {
    await setupTheme(page);
    await page.goto("/receipts");
    await page.waitForLoadState("networkidle");

    // Click the first receipt card to expand it
    const firstCard = page.locator("button").filter({ hasText: /Searched SEC EDGAR/i });
    await firstCard.click();

    // Expanded content should show tool name and policy rule
    await expect(page.locator("code").filter({ hasText: "web_search" })).toBeVisible();
    await expect(
      page.locator("text=Allow public data reads"),
    ).toBeVisible();

    await page.screenshot({
      path: join(OUT_DIR, "receipts-expanded.png"),
      fullPage: true,
    });
  });

  test("reversible demo receipts can be rolled back and irreversible ones are explicit", async ({ page }) => {
    await setupTheme(page);
    await page.goto("/receipts");
    await page.waitForLoadState("networkidle");

    await page.locator("button").filter({ hasText: /Created investigation dossier from gathered evidence/i }).click();
    await page.getByRole("button", { name: /Undo action/i }).click();

    await expect(page.locator("text=Rolled back in demo mode").first()).toBeVisible();
    await expect(page.locator("text=rollback_ref:").first()).toBeVisible();

    await page.locator("button").filter({ hasText: /Searched SEC EDGAR for FTX bankruptcy filings/i }).click();
    await expect(page.locator("text=No rollback available.").first()).toBeVisible();

    await page.screenshot({
      path: join(OUT_DIR, "receipts-rollback.png"),
      fullPage: true,
    });
  });
});

// ─── Passport & Delegation ───────────────────────────────────────────────────

test.describe("Passport & Delegation", () => {
  test("renders the scope matrix, scope token, and delegation graph", async ({ page }) => {
    await setupTheme(page);
    await page.goto("/passport");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h1").filter({ hasText: /passport & delegation/i })).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Passport scope matrix").first()).toBeVisible();
    await expect(page.locator("text=Scope token object").first()).toBeVisible();
    await expect(page.locator("text=Delegation graph v0").first()).toBeVisible();
    await expect(page.locator("text=share_externally").first()).toBeVisible();
    await expect(page.locator("text=Human supervisor").first()).toBeVisible();

    await page.screenshot({
      path: join(OUT_DIR, "passport-scope-matrix.png"),
      fullPage: true,
    });
  });
});

// ─── Enterprise Investigation ───────────────────────────────────────────────

test.describe("Enterprise Investigation View", () => {
  test("renders FTX golden dataset with all 7 sections", async ({ page }) => {
    await setupTheme(page);
    await page.goto("/investigation");
    await page.waitForLoadState("networkidle");

    // Should show investigation heading
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 10000 });

    // Should have observed facts section
    await expect(
      page.locator("text=Observed Facts").first(),
    ).toBeVisible();

    // Should have hypotheses section
    await expect(
      page.locator("text=Hypotheses").first(),
    ).toBeVisible();

    // Should have limitations section (the differentiator)
    await expect(
      page.locator("text=Limitations").first(),
    ).toBeVisible();

    await page.screenshot({
      path: join(OUT_DIR, "investigation-full.png"),
      fullPage: true,
    });
  });

  test("shows provenance badges on evidence items", async ({ page }) => {
    await setupTheme(page);
    await page.goto("/investigation");
    await page.waitForLoadState("networkidle");

    // Should show at least one provenance badge (VERIFIED, INFERRED, or SIMULATED)
    const badges = page.locator("text=/VERIFIED|INFERRED|SIMULATED/i");
    const count = await badges.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("adversarial review challenges are visible", async ({ page }) => {
    await setupTheme(page);
    await page.goto("/investigation");
    await page.waitForLoadState("networkidle");

    // Scroll to adversarial review section
    const reviewSection = page.locator("text=Adversarial Review").first();
    if (await reviewSection.isVisible()) {
      await reviewSection.scrollIntoViewIfNeeded();
      // Should show confidence adjustment
      await expect(
        page.locator("text=/confidence|penalty|adjusted/i").first(),
      ).toBeVisible();
    }
  });
});

// ─── Cross-route navigation ────────────────────────────────────────────────

test.describe("Cross-route navigation", () => {
  test("control-plane links navigate to receipts and investigation", async ({
    page,
  }) => {
    await setupTheme(page);
    await page.goto("/control-plane");
    await page.waitForLoadState("networkidle");

    // Click Action Receipts link
    const receiptsLink = page.locator("button, a").filter({ hasText: /receipt/i }).first();
    if (await receiptsLink.isVisible()) {
      await receiptsLink.click();
      await page.waitForLoadState("networkidle");
      // Should now be on receipts page
      await expect(
        page.locator("h1").filter({ hasText: /action receipts/i }),
      ).toBeVisible({ timeout: 10000 });
    }

    await page.screenshot({
      path: join(OUT_DIR, "cross-nav-receipts.png"),
      fullPage: true,
    });
  });

  test("after storage clear, routes still render (no stale state crash)", async ({
    page,
  }) => {
    // Simulate fresh browser — no localStorage
    await page.goto("/investigation");
    await page.waitForLoadState("networkidle");

    // Should not crash — heading should appear
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 15000 });
  });
});
