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

test.describe("live-smoke-mobile — canonical runtime surfaces", () => {
  test.setTimeout(45_000);

  test("Home keeps the mobile wrapper around the runtime-backed Home surface", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    const surface = page.locator('[data-testid="mobile-home-surface"]');
    await expect(surface).toBeVisible({ timeout: 20_000 });
    await expect(surface.locator('[data-testid="exact-web-home-surface"]')).toBeVisible();
    await expect(surface.locator('[data-testid="exact-web-home-composer"]')).toBeVisible();
    await expect(surface.locator('[data-testid="mobile-home-async-run"]')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("Reports exposes real pipeline controls and honest runtime report state", async ({ page }) => {
    await page.goto(`${BASE_URL}/?surface=reports`);
    const surface = page.locator('[data-testid="mobile-reports-surface"]');
    await expect(surface).toBeVisible({ timeout: 20_000 });
    await expect(surface.locator('[data-testid="reports-performance-root"]')).toBeVisible();
    await expect(surface.locator('[data-testid="pipeline-launcher"]')).toBeVisible();
    await expect(surface.locator('[data-testid="pipeline-launcher-sign-in"]')).toBeVisible();
    await expect(
      surface.locator('[data-testid="reports-loading"], [data-testid="reports-empty"], [data-testid="report-card"]').first(),
    ).toBeVisible();
    await expect(surface.locator('[data-testid="mobile-report-card"]')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("Chat mounts the live runtime and a working composer, not a verified fixture", async ({ page }) => {
    await page.goto(`${BASE_URL}/?surface=chat`);
    const surface = page.locator('[data-testid="mobile-chat-surface"]');
    await expect(surface).toBeVisible({ timeout: 20_000 });
    await expect(surface.locator('[data-testid="exact-web-chat-stream"]')).toBeVisible();
    await expect(surface.getByLabel("Chat composer")).toBeVisible();
    await expect(surface.getByLabel("Chat composer")).toHaveAttribute(
      "placeholder",
      "Ask or paste text... (@ to mention an entity)",
    );
    await expect(surface.getByText("Live Context Runtime")).toBeVisible();
    await expect(surface.getByText(/3 entities - 24 sources/i)).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("Inbox shows only the runtime snapshot or its honest empty/loading state", async ({ page }) => {
    await page.goto(`${BASE_URL}/?surface=inbox`);
    const surface = page.locator('[data-testid="mobile-inbox-surface"]');
    await expect(surface).toBeVisible({ timeout: 20_000 });
    await expect(surface.locator('[data-testid="exact-web-inbox-surface"]')).toBeVisible();
    await expect(surface.getByRole("button", { name: /^All / })).toBeVisible();
    await expect(surface.getByRole("button", { name: /^Mentions / })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("Me uses runtime identity and memory rather than canned workspace controls", async ({ page }) => {
    await page.goto(`${BASE_URL}/?surface=me`);
    const surface = page.locator('[data-testid="mobile-me-surface"]');
    await expect(surface).toBeVisible({ timeout: 20_000 });
    await expect(surface.locator('[data-testid="exact-web-me-surface"]')).toBeVisible();
    await expect(surface.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(
      surface.locator('[data-testid="me-memory-loading"], [data-testid="me-memory-empty"], .nb-settings-section').first(),
    ).toBeVisible();
    await expect(surface.getByText(/^Workspaces$/)).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
});
