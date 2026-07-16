/**
 * Tier B runtime-grounding verification for the five ExactKit cockpit surfaces.
 *
 * These checks deliberately do not require fixture counts. Optional product
 * sections may render only when their backing runtime query returns data.
 */

import { expect, test, type Page } from "@playwright/test";
import { installVercelPreviewBypass } from "./helpers/vercelPreview";

const BASE_URL =
  process.env.BASE_URL?.replace(/\/$/, "") ?? "https://www.nodebenchai.com";

test.beforeEach(async ({ page }) => {
  await installVercelPreviewBypass(page, BASE_URL);
});

async function navigate(page: Page, surface: string) {
  await page.goto(`${BASE_URL}/?surface=${surface}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
}

test("Quick Search follows the real Home route and focuses its canonical composer", async ({
  page,
}) => {
  await navigate(page, "workspace");
  await page.getByRole("button", { name: "Search reports, entities, inbox" }).click();
  await page.locator('[data-agent-id="cmd:quick-search"]').click();

  await expect(page).toHaveURL(/\/redesign(?:\?|$)/);
  await expect(page.locator("#redesign-home-composer")).toBeFocused();
});

test("Home keeps one useful composer and renders only runtime-returned sections", async ({
  page,
}) => {
  await navigate(page, "ask");

  await expect(page.getByTestId("exact-web-home-surface")).toBeVisible();
  await expect(page.getByTestId("exact-web-home-composer")).toBeVisible();
  await expect(page.locator(".nb-composer-hero h1")).toHaveText(
    "Get the read before you walk in.",
  );
  await expect(page.getByTestId("home-async-proof")).toHaveText(
    "Background runs continue server-side and stay visible in Reports.",
  );
  await expect(page.getByTestId("home-first-impression-board")).toBeVisible();

  const state = await page.evaluate(() => {
    const has = (selector: string) => Boolean(document.querySelector(selector));
    const count = (selector: string) => document.querySelectorAll(selector).length;
    return {
      pulsePresent: has('[data-testid="exact-home-pulse-strip"]'),
      pulseItems: count(".nb-pulse-card, .nb-pulse-mini"),
      todayPresent: has('[data-testid="exact-home-today-intel"]'),
      todayItems: count(".nb-today-item"),
      activeEventPresent: has('[data-testid="exact-home-active-event"]'),
      recentSection: has('[data-testid="exact-home-recent-reports"]'),
      recentLoading: has('[data-testid="home-recent-reports-loading"]'),
      recentEmpty: has('[data-testid="home-recent-reports-empty"]'),
      recentCards: count(".nb-recent-card"),
      bodyText: document.body.textContent ?? "",
    };
  });

  expect(state.recentSection).toBe(true);
  expect(
    Number(state.recentLoading) +
      Number(state.recentEmpty) +
      Number(state.recentCards > 0),
    "Recent reports has one honest loading, empty, or live-data state",
  ).toBe(1);
  expect(state.pulsePresent).toBe(false);
  expect(state.pulseItems).toBe(0);
  if (state.todayPresent) expect(state.todayItems).toBeGreaterThan(0);
  if (state.activeEventPresent) {
    await expect(page.getByTestId("exact-home-active-event")).toBeVisible();
  }
  expect(state.bodyText).not.toMatch(/Orbital Labs|DISCO|Mercor|attached 10-K/i);
});

test("Chat routes guests to the session runtime and has one prompt row", async ({
  page,
}) => {
  await navigate(page, "workspace");

  const stream = page.getByTestId("exact-web-chat-stream");
  await expect(stream).toBeVisible();
  await expect(stream).toHaveAttribute("data-chat-runtime-route", "session-fast-agent");
  await expect(stream).toHaveAttribute("data-chat-live-eligible", "false");
  await expect(stream).toHaveAttribute("data-chat-live-status", /.+/);
  await expect(page.locator(".nb-stream-header h2")).toContainText(
    "Live Context Runtime",
  );
  await expect(page.locator(".nb-stream-inner")).toContainText(
    "Runtime evidence and sources appear after you send.",
  );
  await expect(page.locator(".nb-composer-card")).toBeVisible();
  await expect(
    page.locator(
      '[data-exact-composer="golden"][data-exact-composer-version="2026-05-02"]',
    ),
  ).toBeVisible();
  await expect(page.locator(".nb-composer-input")).toHaveAttribute(
    "placeholder",
    "Ask or paste text... (@ to mention an entity)",
  );
  await expect(page.locator(".nb-prompt-chip")).toHaveCount(3);
  await expect(page.locator(".nb-followup-chip")).toHaveCount(0);
  await expect(page.locator(".nb-model-trigger")).toHaveCount(0);
  await expect(page.locator(".nb-epill, .nb-confirm")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Ship Demo Day");
});

test("Reports exposes honest loading, empty, or live state without fixture chrome", async ({
  page,
}) => {
  await navigate(page, "reports");

  const root = page.getByTestId("reports-performance-root");
  await expect(root).toBeVisible();
  await expect(page.getByTestId("pipeline-launcher")).toBeVisible();
  await expect(page.getByTestId("pipeline-launcher-sign-in")).toBeVisible();
  await expect(
    page.locator('[data-testid="pipeline-runs-panel"], [data-testid="pipeline-runs-empty"], [data-testid="pipeline-runs-unavailable"]'),
  ).toBeVisible();

  await expect
    .poll(
      async () => root.getAttribute("data-reports-source"),
      { timeout: 15_000 },
    )
    .not.toBe("loading");

  const state = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="reports-performance-root"]');
    const reportCards = root?.querySelectorAll('[data-testid="report-card"]').length ?? 0;
    return {
      source: root?.getAttribute("data-reports-source"),
      loading: Boolean(root?.querySelector('[data-testid="reports-loading"]')),
      empty: Boolean(root?.querySelector('[data-testid="reports-empty"]')),
      reportCards,
      sourcePills: root?.querySelectorAll(".nb-reports-source-pill").length ?? 0,
      viewToggles: root?.querySelectorAll(".nb-view-toggle").length ?? 0,
      bodyText: root?.textContent ?? "",
    };
  });

  expect(["empty", "live_convex"]).toContain(state.source);
  expect(
    Number(state.loading) + Number(state.empty) + Number(state.reportCards > 0),
    "Reports has exactly one runtime-backed state",
  ).toBe(1);
  if (state.source === "empty") {
    expect(state.empty).toBe(true);
    expect(state.sourcePills).toBe(0);
    expect(state.viewToggles).toBe(0);
  } else {
    expect(state.reportCards).toBeGreaterThan(0);
    expect(state.sourcePills).toBe(1);
    expect(state.viewToggles).toBe(1);
  }
  expect(state.bodyText).not.toMatch(/Orbital Labs|DISCO|Mercor/i);
  await expect(page.getByTestId("pipeline-launcher")).not.toContainText(
    /Upload a file|Record voice|Add URL/i,
  );
});

test("Inbox shows runtime nudges or an honest loading/empty state", async ({
  page,
}) => {
  await navigate(page, "nudges");

  const surface = page.getByTestId("exact-web-inbox-surface");
  await expect(surface).toBeVisible();
  await expect(surface.locator(".nb-inbox-head h1")).toHaveText("Inbox");
  await expect(surface.locator(".nb-inbox-filter button")).toHaveCount(4);
  await expect(surface.locator(".nb-inbox-filter button")).toContainText([
    "All",
    "Act",
    "Auto",
    "Watch",
  ]);

  const stateCount = await surface.evaluate((node) =>
    Number(Boolean(node.querySelector('[data-testid="inbox-loading"]'))) +
    Number((node.textContent ?? "").includes("No runtime nudges")) +
    Number(node.querySelectorAll(".nb-ibx-row").length > 0),
  );
  expect(stateCount).toBe(1);
});

test("Me reflects guest or runtime identity without plans or preference clutter", async ({
  page,
}) => {
  await navigate(page, "me");

  const surface = page.getByTestId("exact-web-me-surface");
  await expect(surface).toBeVisible();
  await expect(surface.locator(".nb-me-sidenav")).toBeVisible();
  await expect(surface.locator(".nb-settings-h1")).toHaveText("Memory");
  await expect(surface.locator(".nb-me-sidenav .section-title")).toHaveText([
    "Account",
  ]);
  await expect(surface.locator(".nb-me-sidenav button")).toContainText(
    "Settings",
  );

  const identity = await surface.evaluate((node) => ({
    initial: node.querySelector(".nb-me-sidenav .av")?.textContent?.trim() ?? "",
    name: node.querySelector(".nb-me-sidenav .nm")?.textContent?.trim() ?? "",
    detail: node.querySelector(".nb-me-sidenav .em")?.textContent?.trim() ?? "",
    loading: Boolean(node.querySelector('[data-testid="me-memory-loading"]')),
    empty: Boolean(node.querySelector('[data-testid="me-memory-empty"]')),
    live: Boolean(node.querySelector(".nb-settings-section")),
  }));
  expect(identity.initial).toBe(identity.name.slice(0, 1).toUpperCase());
  if (identity.detail === "Anonymous session") {
    expect(identity.name).toBe("Guest workspace");
    expect(identity.initial).toBe("G");
  } else {
    expect(identity.name.length).toBeGreaterThan(0);
    expect(identity.detail.length).toBeGreaterThan(0);
  }
  expect(Number(identity.loading) + Number(identity.empty) + Number(identity.live)).toBe(1);
  await expect(surface.locator(".nb-me-sidenav .section-title")).not.toContainText(
    /Preferences|Workspace/i,
  );
  await expect(surface).not.toContainText(/Pro plan|Upgrade|usage/i);
});

test("An unknown report stays in the cockpit and fails closed", async ({ page }) => {
  const reportId = "__missing_runtime_report__";
  await page.goto(`${BASE_URL}/?surface=packets&report=${reportId}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  const detail = page.getByTestId("exact-web-report-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute("data-report-id", reportId);
  await expect(detail).toContainText(
    "No runtime-backed report was found for this id.",
  );
  await expect(detail.locator(".nb-rdetail-cockpit, .nb-rdetail-title")).toHaveCount(0);
  expect(page.url()).not.toContain("workspace.nodebenchai.com");

  await page.getByTestId("report-detail-back").click();
  await expect(page).toHaveURL(/surface=packets/);
  await expect(page).not.toHaveURL(/report=/);
  await expect(page.getByTestId("reports-performance-root")).toBeVisible();
});

test("Avatar menu exposes runtime identity and useful controls only", async ({
  page,
}) => {
  await navigate(page, "ask");

  const trigger = page.locator(".nb-avm-trigger");
  await expect(trigger).toBeVisible();
  const triggerInitial = (await trigger.locator(".nb-avm-avatar-sm").textContent())?.trim() ?? "";
  await expect(page.getByTestId("exact-avatar-menu")).toHaveCount(0);
  await trigger.click();

  const menu = page.getByTestId("exact-avatar-menu");
  await expect(menu).toBeVisible();
  const identity = await menu.evaluate((node) => ({
    name: node.querySelector(".nb-avm-name")?.textContent?.trim() ?? "",
    detail: node.querySelector(".nb-avm-id")?.textContent?.trim() ?? "",
    watchRows: node.querySelectorAll(".nb-avm-watch-row").length,
    watchEmpty: node.querySelectorAll(".nb-avm-section .nb-avm-empty").length,
    sessionRows: node.querySelectorAll(".nb-avm-session").length,
    sessionEmpty: (node.textContent ?? "").includes("runtime sessions"),
  }));
  expect(triggerInitial).toBe(identity.name.slice(0, 1).toUpperCase());
  if (identity.detail === "Anonymous session") {
    expect(identity.name).toBe("Guest workspace");
    expect(triggerInitial).toBe("G");
  }

  await expect(menu.locator(".nb-avm-section-label")).toContainText([
    /Recent entities/,
    "Recent sessions",
    "Theme",
  ]);
  expect(identity.watchRows > 0 || identity.watchEmpty > 0).toBe(true);
  expect(identity.sessionRows > 0 || identity.sessionEmpty).toBe(true);
  await expect(menu.locator(".nb-avm-theme-opt")).toHaveText(["Light", "Dark"]);
  await expect(menu.locator(".nb-avm-link")).toHaveText(["Settings"]);
  await expect(
    menu.locator(".nb-avm-pro, .nb-avm-pulse, .nb-avm-usage, .nb-avm-upgrade"),
  ).toHaveCount(0);
  await expect(menu).not.toContainText(/Hannah Sato|Today's pulse|This month|Shortcuts|Help|Sign out/i);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("Developers page starts from an honest MCP empty state", async ({ page }) => {
  await page.goto(`${BASE_URL}/developers`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  await expect(page.getByRole("heading", { name: /Bring NodeBench into Claude/i })).toBeVisible();
  await expect(page.getByTestId("mcp-terminal-empty")).toContainText(
    "No MCP call has run on this page.",
  );
  await expect(page.getByRole("button", { name: "Copy install command" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy hosted public URL" })).toBeVisible();
  await expect(page.getByTestId("mcp-terminal-empty")).not.toContainText(
    /DISCO|first dossier returned|tools loaded/i,
  );
});
