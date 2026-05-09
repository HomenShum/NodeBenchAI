/**
 * E2E — Editorial home (Phase 7a + 7b + 7c).
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
 *
 * ─── Scenario C — discoverability round-trip (Phase 7c) ──────────
 * User:        Returning visitor on the legacy home, never opted in
 * Goal:        Discover the editorial edition + return to classic
 * Actions:     /redesign → click "Try the daily edition" → verify
 *              the editorial layout mounts → click "Switch to classic"
 *              → verify legacy operations dashboard returns.
 * Expected:    Round-trip is one click in either direction; URL
 *              reflects the current view (`?edition=1` ↔ no flag).
 *
 * ─── Scenario D — section numbers are consecutive (Bug 0a) ───────
 * User:        Any visitor on the editorial home
 * Goal:        Read 01 → 02 → ... → N with no gaps even when a
 *              conditional section (hypotheses) is hidden.
 * Actions:     Navigate to /redesign?edition=1, query
 *              `[data-section-number]` attributes in document order.
 * Expected:    Numbers are consecutive starting at "01".
 *
 * ─── Scenario E — footnote sup anchors point to real targets ─────
 * User:        Reader hopping between body text and Sources
 * Goal:        Every superscript citation jumps to a real footnote.
 * Actions:     Find every `[data-footnote]` sup with an href
 *              `#fn-N`; assert each `id="fn-N"` exists in §6 OR the
 *              page has zero footnote refs (honest empty state).
 *
 * ─── Scenario F — TOC scroll-spy is desktop only (Phase 7b) ──────
 * User:        Desktop reader vs mobile reader
 * Goal:        Desktop sees rail; mobile does not.
 * Actions:     1440px → assert `[data-edition-toc]` is in DOM.
 *              375px  → assert it is hidden or absent.
 *
 * ─── Scenario G — Copy share-link writes to clipboard (7c) ───────
 * User:        Reader who wants to share the edition
 * Goal:        One-click copy of a shareable URL.
 * Actions:     Stub `navigator.clipboard.writeText`, click
 *              `[data-format-share]`, assert the stub was called
 *              with a URL containing `?edition=1&share=`.
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

    const editionRoot = page.locator("[data-edition]");
    await expect(editionRoot).toBeVisible({ timeout: 10_000 });

    for (const id of EDITION_SECTIONS) {
      const section = page.locator(`[data-section="${id}"]`);
      await expect(section).toBeVisible({ timeout: 5_000 });
    }

    const hypotheses = page.locator('[data-section="competing-explanations"]');
    const hypCount = await hypotheses.count();
    expect(hypCount === 0 || hypCount === 1).toBeTruthy();

    await page.setViewportSize({ width: 375, height: 720 });
    await page.waitForSelector("[data-edition]", { timeout: 5_000 });
    await page.waitForTimeout(300);
    const horizontalOverflow = await page.evaluate(() => {
      const root = document.querySelector("[data-edition]");
      if (!root) return null;
      return root.scrollWidth - (root as HTMLElement).clientWidth;
    });
    expect(horizontalOverflow).not.toBeNull();
    expect(horizontalOverflow ?? 999).toBeLessThanOrEqual(2);

    const legacyOps = page.locator('section[aria-label="Operations dashboard"]');
    expect(await legacyOps.count()).toBe(0);

    expect(errors, `Errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("Scenario B: legacy home preserved without the flag", async ({ page }) => {
    await page.goto(`${BASE_URL}/redesign`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    const editionRoot = page.locator("[data-edition]");
    expect(await editionRoot.count()).toBe(0);

    const legacyOps = page.locator('section[aria-label="Operations dashboard"]');
    await expect(legacyOps).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Editorial home — Phase 7b + 7c", () => {
  test("Scenario C: discoverability round-trip via legacy → editorial → classic", async ({ page }) => {
    await page.goto(`${BASE_URL}/redesign`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    // Discoverability link is present on the legacy home.
    const tryEdition = page.locator("[data-edition-discover]").first();
    await expect(tryEdition).toBeVisible({ timeout: 10_000 });

    // Click it — URL should now include ?edition=1, editorial mounts.
    await tryEdition.click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\?edition=1$/);
    await expect(page.locator("[data-edition]")).toBeVisible({ timeout: 10_000 });

    // Reciprocal "Switch to classic" returns the user.
    const switchToClassic = page.locator("[data-edition-switch]").first();
    await expect(switchToClassic).toBeVisible({ timeout: 5_000 });
    await switchToClassic.click();
    await page.waitForLoadState("networkidle");

    // URL no longer carries the flag, legacy ops dashboard is back.
    await expect(page).not.toHaveURL(/edition=1/);
    const legacyOps = page.locator('section[aria-label="Operations dashboard"]');
    await expect(legacyOps).toBeVisible({ timeout: 10_000 });
  });

  test("Scenario D: section numbers render consecutively (Bug 0a)", async ({ page }) => {
    await page.goto(`${BASE_URL}/redesign?edition=1`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    await page.waitForSelector("[data-edition]", { timeout: 10_000 });

    const numbers = await page.$$eval(
      "[data-edition] [data-section-number]",
      (nodes) => nodes.map((n) => (n as HTMLElement).dataset.sectionNumber ?? ""),
    );

    expect(numbers.length).toBeGreaterThan(0);
    // Each number must be the zero-padded 1-based index.
    numbers.forEach((n, i) => {
      const expected = (i + 1).toString().padStart(2, "0");
      expect(n).toBe(expected);
    });
  });

  test("Scenario E: footnote sup anchors point to real targets", async ({ page }) => {
    await page.goto(`${BASE_URL}/redesign?edition=1`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    await page.waitForSelector("[data-edition]", { timeout: 10_000 });

    const supRefs = await page.$$eval(
      '[data-edition] sup[data-footnote] a[href^="#fn-"]',
      (nodes) =>
        nodes.map((n) => {
          const href = (n as HTMLAnchorElement).getAttribute("href") ?? "";
          return href.replace(/^#/, "");
        }),
    );

    if (supRefs.length === 0) {
      // Honest empty state — no footnotes referenced today.  Test
      // passes trivially with a clear message.
      // eslint-disable-next-line no-console
      console.log("Scenario E: no footnote sup refs in today's edition (honest empty state).");
      return;
    }

    for (const id of supRefs) {
      const target = page.locator(`#${CSS.escape(id)}`);
      const count = await target.count();
      expect(count, `Footnote target ${id} should exist`).toBe(1);
    }
  });

  test("Scenario F: TOC scroll-spy is desktop only", async ({ page }) => {
    // Desktop viewport — TOC must be present.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/redesign?edition=1`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("[data-edition]", { timeout: 10_000 });

    const tocDesktop = page.locator("[data-edition-toc]");
    await expect(tocDesktop).toBeVisible({ timeout: 5_000 });

    // Mobile viewport — TOC hidden via media query.
    await page.setViewportSize({ width: 375, height: 720 });
    // Wait for re-render of media-query-driven mount state.
    await page.waitForTimeout(400);
    const tocMobileVisible = await page.evaluate(() => {
      const el = document.querySelector("[data-edition-toc]");
      if (!el) return false;
      const styles = window.getComputedStyle(el);
      return styles.display !== "none" && styles.visibility !== "hidden";
    });
    expect(tocMobileVisible).toBe(false);
  });

  test("Scenario G: Copy share-link writes to clipboard", async ({ page }) => {
    // Stub navigator.clipboard.writeText BEFORE the page loads so the
    // FormatStrip onClick uses our stub.
    await page.addInitScript(() => {
      (window as unknown as { __copiedUrls: string[] }).__copiedUrls = [];
      const stub = (text: string) => {
        (window as unknown as { __copiedUrls: string[] }).__copiedUrls.push(text);
        return Promise.resolve();
      };
      try {
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: stub, readText: () => Promise.resolve("") },
          configurable: true,
        });
      } catch {
        // Fallback: define on existing clipboard.
        (navigator as unknown as { clipboard: { writeText: (t: string) => Promise<void> } }).clipboard.writeText = stub;
      }
    });

    await page.goto(`${BASE_URL}/redesign?edition=1`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("[data-edition]", { timeout: 10_000 });

    const shareBtn = page.locator("[data-format-share]").first();
    await expect(shareBtn).toBeVisible({ timeout: 5_000 });
    await shareBtn.click();

    // Allow click handler + promise to flush.
    await page.waitForTimeout(200);

    const copied = await page.evaluate(
      () => (window as unknown as { __copiedUrls: string[] }).__copiedUrls,
    );
    expect(copied.length).toBeGreaterThanOrEqual(1);
    expect(copied[0]).toMatch(/[?&]edition=1(?:&|$)/);
    expect(copied[0]).toMatch(/[?&]share=/);
  });
});
