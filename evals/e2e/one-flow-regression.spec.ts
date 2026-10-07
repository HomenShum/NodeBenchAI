/**
 * One-flow regression: every product entry point resolves to one usable,
 * runtime-backed decision workspace with one composer.
 */

import { expect, test, type Page } from "@playwright/test";
import { installVercelPreviewBypass } from "./helpers/vercelPreview";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:4173").replace(/\/$/, "");

test.beforeEach(async ({ page }) => {
  await installVercelPreviewBypass(page, BASE_URL);
});

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/ResizeObserver|React DevTools|ERR_CONNECTION_(?:REFUSED|RESET)/i.test(text)) return;
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

async function go(page: Page, path: string) {
  await page.goto(`${BASE_URL}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await expect(page.getByTestId("one-surface-workspace")).toBeVisible({ timeout: 30_000 });
}

test.describe("ONE-FLOW REGRESSION", () => {
  test("anonymous visitor gets one calm workspace across legacy routes", async ({ page }) => {
    const errors = collectErrors(page);

    for (const path of [
      "/",
      "/?surface=home",
      "/?surface=reports",
      "/?surface=inbox",
      "/?surface=me",
      "/agents",
      "/workspace",
    ]) {
      await go(page, path);
      await expect(page).toHaveURL(/\/redesign\/chat(?:[/?#]|$)/);
      await expect(page.locator('[data-product-surface="decision-workspace"]')).toHaveCount(1);
      await expect(page.locator("textarea:visible")).toHaveCount(1);
      await expect(page.locator("nav")).toHaveCount(0);
    }

    await go(page, "/reports/runtime-report/graph");
    await expect(page).toHaveURL(/\/redesign\/chat\?report=runtime-report&artifact=map/);
    await expect(page.getByText(/map context/i).first()).toBeVisible();

    const composer = page.locator("textarea:visible");
    await composer.fill("Give me the decision, evidence, and next action.");
    await expect(composer).toHaveValue("Give me the decision, evidence, and next action.");
    await expect(page.getByRole("button", { name: /run research/i })).toBeEnabled();

    expect(errors, `console errors during flow: ${errors.join(" | ")}`).toEqual([]);
  });

  test("mobile 390px resolves the chat workspace to one full-width column", async ({ browser }) => {
    // 2026-07-16 production audit: `.rd-shell__main` computed `70px 320px` at
    // 390x844, clipping the chat to a 70px strip while the document-level
    // horizontal-overflow boolean stayed false — so only COMPUTED geometry
    // catches this class of regression (issue #570). The CSS-source guard
    // (AgentWorkspaceResponsiveCss.guard.test.ts) string-matches the mobile
    // rule but cannot detect a new higher-specificity competitor; this can.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    try {
      await installVercelPreviewBypass(page, BASE_URL);
      await page.goto(`${BASE_URL}/redesign/chat`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await expect(page.getByTestId("one-surface-workspace")).toBeVisible({ timeout: 30_000 });

      const geometry = await page.evaluate(() => {
        const main = document.querySelector<HTMLElement>(".rd-shell__main");
        const content = document.querySelector<HTMLElement>("main#main-content");
        if (!main || !content) return null;
        return {
          gridTemplateColumns: getComputedStyle(main).gridTemplateColumns,
          mainWidth: main.getBoundingClientRect().width,
          contentWidth: content.getBoundingClientRect().width,
        };
      });

      expect(geometry, ".rd-shell__main and main#main-content must exist on /redesign/chat").not.toBeNull();
      const trackCount = geometry!.gridTemplateColumns.trim().split(/\s+/).length;
      expect(
        trackCount,
        `expected a single grid column at 390px, got "${geometry!.gridTemplateColumns}"`,
      ).toBe(1);
      // The audit's failure mode left main#main-content at 70px. Full-width
      // minus padding must stay in the hundreds.
      expect(geometry!.contentWidth).toBeGreaterThan(300);
      expect(geometry!.mainWidth).toBeGreaterThan(300);
    } finally {
      await context.close();
    }
  });
});
