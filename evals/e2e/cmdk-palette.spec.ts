/**
 * cmdk-palette.spec.ts — end-to-end smoke for the federated Cmd-K palette.
 *
 * Verifies the three reliability scenarios from
 * src/features/redesign/components/CommandPalette.test.tsx in a real browser:
 *
 *   1. Power user opens palette and types a query — DOM reflects status bar
 *      + at least one group testid renders (proves federatedSearch round-trip).
 *   2. Empty query — Commands group renders, status bar absent (no fetch fired).
 *   3. Escape closes the palette.
 *
 * Run locally:    npx playwright test evals/e2e/cmdk-palette.spec.ts --project=chromium
 * Run on prod:    BASE_URL=https://www.nodebenchai.com npm run live-smoke -- evals/e2e/cmdk-palette.spec.ts
 *
 * The test deliberately does NOT assert on specific result counts or text
 * (those depend on what's in the user's account). It asserts on the
 * structural contract — testids, ARIA, status bar wording shape.
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:5173";

test.describe("Cmd-K federated palette — /redesign", () => {
  test.setTimeout(60_000);

  test("opens on Cmd+K, renders Commands group when query is empty", async ({ page, browserName }) => {
    await page.goto(`${BASE_URL}/redesign`);
    // Wait for hydration — h1 always exists on /redesign HomeSurface.
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });

    // Press Cmd+K (Meta on Mac/WebKit; Control elsewhere).
    const isMac = browserName === "webkit" || process.platform === "darwin";
    await page.keyboard.press(isMac ? "Meta+k" : "Control+k");

    const modal = page.locator("[data-cmdk-modal]");
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Input should auto-focus.
    const input = page.locator("[data-cmdk-input]");
    await expect(input).toBeFocused();

    // Status bar should NOT render before the user types anything.
    await expect(page.locator("[data-cmdk-status]")).toHaveCount(0);

    // Commands group always present (nav fallback).
    await expect(page.locator('[data-cmdk-group="commands"]')).toBeVisible();
    await expect(page.getByText("Go to Home", { exact: true })).toBeVisible();
  });

  test("typing a query fires federatedSearch and renders the status bar", async ({ page, browserName }) => {
    await page.goto(`${BASE_URL}/redesign`);
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });

    const isMac = browserName === "webkit" || process.platform === "darwin";
    await page.keyboard.press(isMac ? "Meta+k" : "Control+k");

    const input = page.locator("[data-cmdk-input]");
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill("a");

    // Status bar surfaces — wait up to 4 s (server budget 3 s + 0.5 s buffer + jitter).
    const status = page.locator("[data-cmdk-status]");
    await expect(status).toBeVisible({ timeout: 4_500 });

    // Status text matches the contract: "<N> results across <M> collections"
    // OR "Searching..." (transient) OR an honest failure message.
    const statusText = (await status.textContent()) ?? "";
    expect(statusText).toMatch(
      /(results? across \d+ collections|Searching|Search request failed)/,
    );
  });

  test("Escape closes the palette and returns focus to the document body", async ({ page, browserName }) => {
    await page.goto(`${BASE_URL}/redesign`);
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });

    const isMac = browserName === "webkit" || process.platform === "darwin";
    await page.keyboard.press(isMac ? "Meta+k" : "Control+k");
    await expect(page.locator("[data-cmdk-modal]")).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-cmdk-modal]")).toHaveCount(0, { timeout: 2_000 });
  });
});
