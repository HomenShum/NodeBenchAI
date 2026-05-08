/**
 * E2E — Editorial home (Phase 7a, gated by `?edition=1`).
 *
 * Source spec: docs/architecture/HOME_EDITORIAL_REDESIGN.md
 * Rules cited: .claude/rules/scenario_testing.md (anatomy below),
 *              .claude/rules/agentic_reliability.md (HONEST_STATUS),
 *              .claude/rules/live_dom_verification.md (Tier B).
 *
 * ─── Scenario A — first-time visitor flips ?edition=1 ────────────
 * User:        New user (anonymous, no localStorage state)
 * Goal:        See the editorial daily edition without logging in
 * Prior state: No pulses, hypotheses, or forecasts persisted yet
 * Actions:     Navigate to /redesign?edition=1 directly
 * Scale:       1 user
 * Duration:    Single page load (< 5s)
 * Expected:    Edition root mounts; sections present (or honestly
 *              hidden where the spec says hide); no horizontal
 *              overflow at 375px; legacy markers absent.
 * Edge cases:  Hypotheses empty → section absent (spec §5).
 *              Daily brief absent → scoreboard shows empty state.
 *
 * ─── Scenario B — same user without the flag ─────────────────────
 * User:        Same anonymous visitor
 * Goal:        Verify the legacy home is preserved exactly
 * Actions:     Navigate to /redesign (no flag)
 * Expected:    Operations dashboard region renders (legacy marker).
 *              No `[data-edition]` root in the document.
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:5173";

const EDITION_SECTIONS = [
  "what-moved",
  "what-to-look-at",
  "scoreboard",
  "capabilities",
  "footnotes",
] as const;

test.describe("Editorial home — Phase 7a", () => {
  test("Scenario A: ?edition=1 renders the editorial layout", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto(`${BASE_URL}/redesign?edition=1`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    // Edition root mounts (proves the flag took effect).
    const editionRoot = page.locator("[data-edition]");
    await expect(editionRoot).toBeVisible({ timeout: 10_000 });

    // Each guaranteed section should render (the only conditional one
    // is `competing-explanations`, which is allowed to be absent per
    // spec §5 when no public hypotheses are active).
    for (const id of EDITION_SECTIONS) {
      const section = page.locator(`[data-section="${id}"]`);
      await expect(section).toBeVisible({ timeout: 5_000 });
    }

    // Hypotheses section: present OR honestly absent (no fake data).
    const hypotheses = page.locator('[data-section="competing-explanations"]');
    const hypCount = await hypotheses.count();
    expect(hypCount === 0 || hypCount === 1).toBeTruthy();

    // No horizontal overflow at mobile width (375px) — Phase 7a's
    // edition flag bypasses MobileShell at the home surface so the
    // single-column editorial layout stays responsive (spec §3
    // Variant C: "mobile and desktop are identical").
    await page.setViewportSize({ width: 375, height: 720 });
    // Allow re-render + the editorial mount to settle (the shell
    // checks isMobile via a media-query listener).
    await page.waitForSelector("[data-edition]", { timeout: 5_000 });
    await page.waitForTimeout(300);
    const horizontalOverflow = await page.evaluate(() => {
      const root = document.querySelector("[data-edition]");
      if (!root) return null;
      return root.scrollWidth - (root as HTMLElement).clientWidth;
    });
    expect(horizontalOverflow).not.toBeNull();
    expect(horizontalOverflow ?? 999).toBeLessThanOrEqual(2);

    // Legacy operations dashboard MUST NOT render in editorial mode.
    const legacyOps = page.locator('section[aria-label="Operations dashboard"]');
    expect(await legacyOps.count()).toBe(0);

    // No console / page errors.
    expect(errors, `Errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("Scenario B: legacy home preserved without the flag", async ({ page }) => {
    await page.goto(`${BASE_URL}/redesign`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    // Editorial root MUST NOT render.
    const editionRoot = page.locator("[data-edition]");
    expect(await editionRoot.count()).toBe(0);

    // Legacy "Operations dashboard" landmark must still render.
    const legacyOps = page.locator('section[aria-label="Operations dashboard"]');
    await expect(legacyOps).toBeVisible({ timeout: 10_000 });
  });
});
