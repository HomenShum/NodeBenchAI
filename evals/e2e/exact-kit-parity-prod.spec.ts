/**
 * Tier B production-parity contract for NodeBench's single decision workspace.
 *
 * Legacy entry points must converge on the same runtime-backed chat surface;
 * this suite intentionally rejects the retired five-surface cockpit.
 */

import { expect, test, type Page } from "@playwright/test";
import { installVercelPreviewBypass } from "./helpers/vercelPreview";

const BASE_URL =
  process.env.BASE_URL?.replace(/\/$/, "") ?? "https://www.nodebenchai.com";

test.beforeEach(async ({ page }) => {
  await installVercelPreviewBypass(page, BASE_URL);
});

async function open(page: Page, path: string) {
  await page.goto(`${BASE_URL}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await expect(page.locator('[data-product-surface="decision-workspace"]')).toBeVisible({
    timeout: 30_000,
  });
}

async function expectSingleWorkspace(page: Page) {
  await expect(page).toHaveURL(/\/redesign\/chat(?:[/?#]|$)/);
  await expect(page.locator('[data-product-surface="decision-workspace"]')).toHaveCount(1);
  await expect(page.getByTestId("one-surface-workspace")).toBeVisible();
  await expect(page.locator("textarea:visible")).toHaveCount(1);
  await expect(page.locator("nav")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /switch to (light|dark) mode/i }),
  ).toBeVisible();
}

test("legacy cockpit entry points converge on exactly one decision workspace", async ({
  page,
}) => {
  const paths = [
    "/",
    "/?surface=home",
    "/?surface=chat",
    "/?surface=reports",
    "/?surface=inbox",
    "/?surface=me",
    "/?surface=workspace",
    "/agents",
    "/workspace",
    "/developers",
  ];

  for (const path of paths) {
    await open(page, path);
    await expectSingleWorkspace(page);
  }
});

test("retired cockpit controls and fixture projections stay absent", async ({ page }) => {
  await open(page, "/redesign/chat");
  await expectSingleWorkspace(page);

  await expect(
    page.getByRole("heading", { name: "What do you need to know?" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    /Orbital Labs|DISCO|Mercor|Ship Demo Day|Pro plan|Upgrade|usage/i,
  );
  await expect(
    page.locator(
      '[data-testid="exact-web-home-surface"], [data-testid="exact-web-chat-stream"], [data-testid="reports-performance-root"], [data-testid="exact-web-inbox-surface"], [data-testid="exact-web-me-surface"], [data-testid="exact-avatar-menu"]',
    ),
  ).toHaveCount(0);
});

test("report artifact URLs preserve context without reopening report editors", async ({
  page,
}) => {
  const reportId = "__missing_runtime_report__";
  await open(page, `/reports/${reportId}/notebook`);

  await expectSingleWorkspace(page);
  await expect(page).toHaveURL(
    new RegExp(`/redesign/chat\\?report=${reportId}&artifact=notebook`),
  );
  await expect(page.getByText(/notebook context/i).first()).toBeVisible();
  await expect(page.getByTestId("exact-web-report-detail")).toHaveCount(0);
});

test("the single composer remains useful and focused", async ({ page }) => {
  await open(page, "/redesign/chat");
  const composer = page.locator("textarea:visible");

  await composer.fill("What changed, why does it matter, and what should I do next?");
  await expect(composer).toHaveValue(
    "What changed, why does it matter, and what should I do next?",
  );
  await expect(page.getByRole("button", { name: /run research/i })).toBeEnabled();
});
