/**
 * One-flow regression: an anonymous visitor can traverse the five canonical
 * surfaces and sees only runtime-backed loading, empty, or live states.
 */

import { expect, test, type Page } from "@playwright/test";
import { installVercelPreviewBypass } from "./helpers/vercelPreview";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4173";

test.beforeEach(async ({ page }) => {
  await installVercelPreviewBypass(page, BASE_URL);
});

const SURFACES = {
  home: "/?surface=home",
  chat: "/?surface=chat",
  reports: "/?surface=reports",
  inbox: "/?surface=inbox",
  me: "/?surface=me",
  exactHome: "/?surface=ask",
} as const;

async function goSurface(page: Page, surface: keyof typeof SURFACES) {
  await page.goto(`${BASE_URL}${SURFACES[surface]}`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForTimeout(800);
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("ResizeObserver") || text.includes("React DevTools")) return;
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

test.describe("ONE-FLOW REGRESSION", () => {
  test("anonymous visitor completes a fixture-free runtime surface tour", async ({ page }) => {
    const errors = collectErrors(page);

    await goSurface(page, "home");
    await expect(page).toHaveURL(/\/redesign(?:[/?#]|$)/);
    const home = page.getByTestId("home-v3-chat-first-frontpage");
    await expect(home).toBeVisible();
    await expect(
      home.getByPlaceholder(
        "Ask about a company, person, event, market, report, or source packet...",
      ),
    ).toBeVisible();

    await goSurface(page, "chat");
    const chat = page.getByTestId("exact-web-chat-stream");
    await expect(chat).toBeVisible();
    await expect(chat).toHaveAttribute(
      "data-chat-runtime-route",
      /^(paid-redesign|session-fast-agent)$/,
    );
    await expect(chat.locator('[data-exact-composer="golden"]')).toHaveCount(1);
    await expect(chat.locator(".nb-prompt-chip")).toHaveCount(3);
    await expect(chat.locator(".nb-followup-chip")).toHaveCount(0);
    await expect(chat).not.toContainText(/Ship Demo Day|no fixture answer loaded|ContextRuntimePacket/i);

    await goSurface(page, "reports");
    const reports = page.getByTestId("reports-performance-root");
    await expect(reports).toBeVisible();
    await expect
      .poll(() => reports.getAttribute("data-reports-source"), { timeout: 15_000 })
      .not.toBe("loading");
    const reportStateCount = await reports.evaluate((node) => {
      const cards = node.querySelectorAll('[data-testid="report-card"]').length;
      return Number(Boolean(node.querySelector('[data-testid="reports-loading"]'))) +
        Number(Boolean(node.querySelector('[data-testid="reports-empty"]'))) +
        Number(cards > 0);
    });
    expect(reportStateCount, "Reports exposes one loading, empty, or live runtime state").toBe(1);
    await expect(reports).not.toContainText(/Orbital Labs|DISCO|Mercor/i);

    await goSurface(page, "inbox");
    const inbox = page.getByTestId("exact-web-inbox-surface");
    await expect(inbox).toBeVisible();
    await expect(inbox.locator(".nb-inbox-filter button")).toHaveCount(4);
    const inboxStateCount = await inbox.evaluate((node) =>
      Number(Boolean(node.querySelector('[data-testid="inbox-loading"]'))) +
      Number((node.textContent ?? "").includes("No runtime nudges")) +
      Number(node.querySelectorAll(".nb-ibx-row").length > 0));
    expect(inboxStateCount, "Inbox exposes one loading, empty, or live runtime state").toBe(1);

    await goSurface(page, "me");
    const me = page.getByTestId("exact-web-me-surface");
    await expect(me).toBeVisible();
    const meStateCount = await me.evaluate((node) =>
      Number(Boolean(node.querySelector('[data-testid="me-memory-loading"]'))) +
      Number(Boolean(node.querySelector('[data-testid="me-memory-empty"]'))) +
      Number(Boolean(node.querySelector(".nb-settings-section"))));
    expect(meStateCount, "Me exposes one loading, empty, or live memory state").toBe(1);
    await expect(me).not.toContainText(/Pro plan|Upgrade|usage/i);

    await goSurface(page, "exactHome");
    await page.locator(".nb-avm-trigger").click();
    const menu = page.getByTestId("exact-avatar-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".nb-avm-section-label")).toContainText([
      /Recent entities/,
      "Recent sessions",
      "Theme",
    ]);
    await expect(menu.locator(".nb-avm-theme-opt")).toHaveText(["Light", "Dark"]);
    await expect(menu.locator(".nb-avm-link")).toHaveText(["Settings"]);
    await expect(
      menu.locator(".nb-avm-pro, .nb-avm-pulse, .nb-avm-usage, .nb-avm-upgrade"),
    ).toHaveCount(0);

    expect(errors, `console errors during flow: ${errors.join(" | ")}`).toEqual([]);
  });
});
