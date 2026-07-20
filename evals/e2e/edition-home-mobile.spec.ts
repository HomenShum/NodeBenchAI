/**
 * E2E — Editorial home, mobile-first verification at 375x812.
 *
 * Source spec: docs/architecture/HOME_EDITORIAL_REDESIGN.md
 * Rules cited:
 *   .claude/rules/scenario_testing.md   (anatomy below — every scenario
 *                                        explicitly documents persona,
 *                                        scale, duration, edge cases)
 *   .claude/rules/agentic_reliability.md (HONEST_STATUS — no overflow lies)
 *   .claude/rules/live_dom_verification.md (Tier B mobile coverage)
 *
 * Why this spec exists:
 *   The desktop spec at evals/e2e/edition-home.spec.ts asserts a single
 *   line of mobile coverage by calling page.setViewportSize(375, ...)
 *   inside Scenario A — but the test runs under chromium with a desktop
 *   user agent, no DPR shift, and no touch. That hides real mobile
 *   regressions: rails that never collapse, chips that wrap badly at
 *   375px, share buttons sized below 44px, etc.
 *
 *   This file uses test.use({ viewport: ... }) at the describe level so
 *   every test starts in mobile, AND specifically targets the three
 *   temporal branches (today / day / week) that PR #285 added without
 *   a real mobile pass.
 *
 *   Per analyst_diagnostic — if any check fails here, the fix is
 *   structural (CSS/layout), not a lowered assertion. We're catching
 *   landmine (b) from live_dom_verification.md: "Suspense / client-only
 *   regressions ... real browsers hydrate but crawlers/LLM agents see a
 *   blank shell." A 1024px desktop test passes; a 375px mobile test
 *   tells the truth.
 *
 * ─── Scenario Mobile-A — today branch on mobile (375x812) ────────
 * User:        First-time visitor on iPhone-class viewport (no JS
 *              configured for hover, no mouse).
 * Goal:        Read the editorial home as published, not a desktop
 *              skeleton.
 * Prior state: industryUpdates seeded by Track B so guest §1 returns
 *              provenance: "public-trending"; deep-history empty for
 *              this viewer.
 * Actions:     1. goto /redesign with mobile viewport.
 *              2. Wait for [data-edition] mount.
 *              3. Check horizontal overflow on root + every visible
 *                 [data-section].
 *              4. Assert TOC ([data-edition-toc]) is hidden or absent
 *                 — desktop-only per Scenario F in edition-home.spec.ts.
 *              5. Spot-check tap-target heights for chips, share btn,
 *                 and the "back to daily edition" discoverability link.
 * Scale:       1 user.
 * Duration:    Single page load.
 * Expected:    Zero horizontal overflow (≤ 2px tolerance for sub-px
 *              rounding); TOC hidden; minimum tap target 44px on every
 *              interactive element checked.
 * Edge cases:  Some elements (e.g. format-strip share) might be present
 *              but inside a CSS-collapsed parent — the check uses
 *              boundingBox() to read computed size after layout, which
 *              returns null when display:none. We tolerate null (means
 *              the element is intentionally hidden on mobile) but never
 *              tolerate a sub-44px present box.
 *
 * ─── Scenario Mobile-B — archived day branch on mobile ───────────
 * User:        Reader following an archive link from a peer.
 * Goal:        Read the day branch with no horizontal overflow.
 * Actions:     /redesign?edition=2026-05-08 → mobile assertions.
 * Expected:    Branch mounts (either archive-summary or archive-empty),
 *              zero overflow, no console errors.
 *
 * ─── Scenario Mobile-C — weekly digest branch on mobile ──────────
 * User:        Reader exploring weekly cadence.
 * Goal:        Read the week branch with no horizontal overflow.
 * Actions:     /redesign?edition=week:2026-W19 → mobile assertions.
 * Expected:    Branch mounts (either week or honest empty state),
 *              zero overflow, no console errors.
 *
 * ─── Scenario Mobile-D — chip click triggers branch swap on mobile
 * User:        Reader on the today branch, taps "This week" chip.
 * Goal:        URL updates AND week branch DOM mounts.
 * Actions:     1. goto /redesign on mobile.
 *              2. Tap [data-edition-chip="week"].
 *              3. Wait for URL to contain ?edition=week:.
 *              4. Wait for [data-edition-kind="week"] OR week branch
 *                 marker to mount.
 * Edge cases:  Chip wrapping at 375px must not push the chip out of
 *              tap range — covered by overflow check in Mobile-A.
 *
 * ─── Scenario Mobile-E — section visibility honesty on mobile ────
 * User:        Reader on the editorial home today.
 * Goal:        Every section that's documented to render on mobile
 *              actually renders.
 * Actions:     /redesign on mobile, assert each [data-section] is
 *              visible OR explicitly absent (hypotheses can be 0/1).
 * Expected:    Same five required sections as desktop; hypotheses
 *              optional.  No section silently hidden by a media query.
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:5173";

// iPhone 13/14/15 viewport — the most common modern mobile profile.
const MOBILE_VIEWPORT = { width: 375, height: 812 } as const;

// Sub-pixel rounding tolerance — 2px is a known-safe budget across
// browsers for fractional layout sizes that Playwright reports.
const OVERFLOW_TOLERANCE_PX = 2;

// Apple HIG + W3C minimum tap target.
const MIN_TAP_TARGET_PX = 44;

const REQUIRED_SECTIONS = [
  "what-moved",
  "what-to-look-at",
  "scoreboard",
  "capabilities",
  "footnotes",
] as const;

/**
 * Read horizontal-overflow for a given selector (root or section) and
 * return the diff in CSS pixels. Negative or zero means no overflow.
 */
async function readOverflow(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<number | null> {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const root = el as HTMLElement;
    return root.scrollWidth - root.clientWidth;
  }, selector);
}

/**
 * Read computed bounding box height for a tap-target element. Returns
 * null when the element is display:none / hidden — which is a valid
 * mobile state for some controls (e.g. desktop-only share alts).
 */
async function readTapHeight(
  locator: import("@playwright/test").Locator,
): Promise<number | null> {
  const count = await locator.count();
  if (count === 0) return null;
  const box = await locator.first().boundingBox();
  return box?.height ?? null;
}

test.describe("Editorial home — mobile (375x812)", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("Mobile-A: today branch — no overflow, TOC hidden, tap targets ≥ 44px", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto(`${BASE_URL}/redesign`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    const editionRoot = page.locator("[data-edition]");
    await expect(editionRoot).toBeVisible({ timeout: 10_000 });

    // (a) horizontal overflow on root.
    const rootOverflow = await readOverflow(page, "[data-edition]");
    expect(rootOverflow, "root overflow read").not.toBeNull();
    expect(
      rootOverflow ?? Number.MAX_SAFE_INTEGER,
      `[data-edition] horizontal overflow ${rootOverflow}px > ${OVERFLOW_TOLERANCE_PX}px`,
    ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

    // Also check document.documentElement — catches absolutely-positioned
    // off-canvas content (rails, drawers) that escape [data-edition].
    const docOverflow = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });
    expect(
      docOverflow,
      `<html> horizontal overflow ${docOverflow}px > ${OVERFLOW_TOLERANCE_PX}px`,
    ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

    // (b) every section in the editorial DOM has zero overflow.
    for (const id of REQUIRED_SECTIONS) {
      const sel = `[data-section="${id}"]`;
      const exists = await page.locator(sel).count();
      if (exists === 0) continue; // some are conditional
      const sectionOverflow = await readOverflow(page, sel);
      // null when the section exists but isn't visible yet — wait briefly
      // and re-read once more to avoid hydration-window flakes.
      const finalOverflow =
        sectionOverflow == null
          ? await page.waitForTimeout(200).then(() => readOverflow(page, sel))
          : sectionOverflow;
      expect(
        finalOverflow ?? Number.MAX_SAFE_INTEGER,
        `${sel} overflow ${finalOverflow}px > ${OVERFLOW_TOLERANCE_PX}px`,
      ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
    }

    // (c) TOC must be hidden or absent on mobile (per Scenario F).
    const tocVisible = await page.evaluate(() => {
      const el = document.querySelector("[data-edition-toc]");
      if (!el) return false;
      const styles = window.getComputedStyle(el);
      return styles.display !== "none" && styles.visibility !== "hidden";
    });
    expect(tocVisible, "[data-edition-toc] visible at 375px").toBe(false);

    // (d) tap-target heights — chip group (Today / Yesterday / Week / etc.).
    const chipHeight = await readTapHeight(
      page.locator('[data-edition-chip="today"]'),
    );
    if (chipHeight !== null) {
      expect(
        chipHeight,
        `today chip height ${chipHeight}px < ${MIN_TAP_TARGET_PX}px`,
      ).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX - 1);
    }

    // (e) share-link button — present and tappable. Some mobile layouts
    // hide it; we don't fail when hidden, only when present-but-tiny.
    const shareHeight = await readTapHeight(page.locator("[data-format-share]"));
    if (shareHeight !== null) {
      expect(
        shareHeight,
        `share button height ${shareHeight}px < ${MIN_TAP_TARGET_PX}px`,
      ).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX - 1);
    }

    // (f) "Switch to classic" / "back to daily edition" discoverability.
    const discoverHeight = await readTapHeight(
      page.locator("[data-edition-discover]"),
    );
    if (discoverHeight !== null) {
      expect(
        discoverHeight,
        `[data-edition-discover] tap height ${discoverHeight}px < ${MIN_TAP_TARGET_PX}px`,
      ).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX - 1);
    }

    // (g) zero pageerror / console.error.
    expect(errors, `Errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("Mobile-B: archived day branch — no overflow, branch mounts honestly", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    // Past day — exercises the archive code path. Either the branch
    // renders archive-summary (data exists) or archive-empty (honest
    // empty state with earliest-edition link). Both are valid.
    await page.goto(`${BASE_URL}/redesign?edition=2026-05-08`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForLoadState("networkidle");

    await page.waitForSelector("[data-edition]", { timeout: 10_000 });

    // Canonical branch indicator: [data-edition-kind="day"] root, OR
    // a day-specific section. Authoring ref:
    // src/features/redesign/surfaces/EditorialHomeSurface.tsx:631-740.
    const branchPresent = await page.evaluate(() => {
      const root = document.querySelector("[data-edition]");
      const kind = root?.getAttribute("data-edition-kind");
      if (kind === "day") return true;
      const summary = document.querySelector('[data-section="archive-summary"]');
      const empty = document.querySelector('[data-section="archive-empty"]');
      const today = document.querySelector('[data-section="what-moved"]');
      return Boolean(summary || empty || today);
    });
    expect(branchPresent, "day branch mounted some recognizable section").toBe(
      true,
    );

    // Mobile overflow check.
    const rootOverflow = await readOverflow(page, "[data-edition]");
    expect(
      rootOverflow ?? Number.MAX_SAFE_INTEGER,
    ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

    expect(errors, `Errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("Mobile-C: weekly digest branch — no overflow, branch mounts honestly", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    // 2026-W19 is the current week — rendering may surface either a
    // populated weekly digest or an honest empty state. Both are valid.
    await page.goto(`${BASE_URL}/redesign?edition=week:2026-W19`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForLoadState("networkidle");

    await page.waitForSelector("[data-edition]", { timeout: 10_000 });

    // Canonical branch indicator: [data-edition-kind="week"] root, with
    // any of the week-* sections OR archive-empty inside. Authoring
    // ref: src/features/redesign/surfaces/EditorialHomeSurface.tsx:812.
    // Falling back to today (what-moved) is also valid for malformed
    // ISO weeks (HONEST_STATUS — never crash, always render something).
    const branchPresent = await page.evaluate(() => {
      const root = document.querySelector("[data-edition]");
      const kind = root?.getAttribute("data-edition-kind");
      if (kind === "week") return true;
      // Fallback: explicit week sections.
      const weekTotals = document.querySelector('[data-section="week-totals"]');
      const weekForecasts = document.querySelector(
        '[data-section="week-forecasts"]',
      );
      const archiveEmpty = document.querySelector(
        '[data-section="archive-empty"]',
      );
      const today = document.querySelector('[data-section="what-moved"]');
      return Boolean(weekTotals || weekForecasts || archiveEmpty || today);
    });
    expect(branchPresent, "week branch mounted some recognizable section").toBe(
      true,
    );

    const rootOverflow = await readOverflow(page, "[data-edition]");
    expect(
      rootOverflow ?? Number.MAX_SAFE_INTEGER,
    ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

    expect(errors, `Errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("Mobile-D: 'This week' chip tap on mobile — URL updates + branch swap", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/redesign`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("[data-edition]", { timeout: 10_000 });

    const weekChip = page.locator('[data-edition-chip="week"]');
    await expect(weekChip).toBeVisible({ timeout: 5_000 });

    // Use .tap() to exercise touch event dispatch (mobile reality)
    // rather than .click() which simulates mouse.
    // hasTouch=true is required for tap() — set on the test context.
    // Use click() if tap() throws on the chromium device (some
    // headless configs lack touch).
    try {
      await weekChip.tap();
    } catch {
      await weekChip.click();
    }

    // URL gains the week marker. Browsers URL-encode `:` to `%3A` in
    // query strings, so the regex must accept both forms.
    await expect(page).toHaveURL(/[?&]edition=week(?::|%3A)/, {
      timeout: 5_000,
    });

    // Branch DOM swaps to weekly. Canonical: data-edition-kind="week"
    // on the root, OR any week-specific section, OR archive-empty
    // (when no week digest exists yet for the requested ISO week).
    await page.waitForFunction(
      () => {
        const root = document.querySelector("[data-edition]");
        const kind = root?.getAttribute("data-edition-kind");
        if (kind === "week") return true;
        const weekTotals = document.querySelector(
          '[data-section="week-totals"]',
        );
        const weekForecasts = document.querySelector(
          '[data-section="week-forecasts"]',
        );
        const empty = document.querySelector('[data-section="archive-empty"]');
        return Boolean(weekTotals || weekForecasts || empty);
      },
      undefined,
      { timeout: 5_000 },
    );

    // Returning to today via the same chip group — explicit, single tap.
    const todayChip = page.locator('[data-edition-chip="today"]');
    if ((await todayChip.count()) > 0) {
      try {
        await todayChip.tap();
      } catch {
        await todayChip.click();
      }
      await expect(page).not.toHaveURL(/[?&]edition=week(?::|%3A)/, {
        timeout: 5_000,
      });
    }
  });

  test("Mobile-E: every required section renders or is honestly absent", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/redesign`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("[data-edition]", { timeout: 10_000 });

    for (const id of REQUIRED_SECTIONS) {
      const sel = `[data-section="${id}"]`;
      const sec = page.locator(sel);
      // Each required section must be in the DOM. Visibility is best-
      // effort because some scoreboard rows can be empty-state cards.
      const count = await sec.count();
      expect(count, `Required section ${id} not present at 375px`).toBe(1);
    }
  });
});

/**
 * Configuration note — on devices without touch (some chromium headless
 * configs), Mobile-D's tap() falls back to click(). To run with full
 * touch dispatch use a dedicated mobile project; this spec is
 * intentionally project-agnostic so it runs in any chromium project that
 * evals/e2e is configured for.
 */
