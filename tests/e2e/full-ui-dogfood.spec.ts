import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const ROUTES = [
  {
    path: "/?surface=home",
    name: "home",
    readyHeading: /(Get the read before you walk in\.|Need the read before you walk in\?)/i,
  },
  {
    path: "/?surface=chat",
    name: "chat",
    readyHeading: "Ask NodeBench",
  },
  {
    path: "/?surface=reports",
    name: "reports",
    readyHeading: "Reports",
  },
  {
    path: "/?surface=inbox",
    name: "inbox",
    readyHeading: "What changed, and what needs your attention.",
  },
  {
    path: "/?surface=me",
    name: "me",
    readyHeading: "Your context",
  },
] as const;

const VARIANTS = [
  { theme: "dark", viewport: { width: 1440, height: 900 }, suffix: "" },
  { theme: "light", viewport: { width: 1440, height: 900 }, suffix: "-light" },
  { theme: "dark", viewport: { width: 390, height: 844 }, suffix: "-mobile" },
  { theme: "light", viewport: { width: 390, height: 844 }, suffix: "-mobile-light" },
] as const;

type BrowserIssueKind = "pageerror" | "console" | "requestfailed" | "response";

type BrowserIssue = {
  kind: BrowserIssueKind;
  route: string;
  detail: string;
};

const BENIGN_PAGE_ERROR_PATTERNS = [/ResizeObserver loop limit exceeded/i];
const BENIGN_CONSOLE_ERROR_PATTERNS = [
  /ResizeObserver loop limit exceeded/i,
  /unsupported command-line flag: --no-sandbox/i,
  /http:\/\/(?:127\.0\.0\.1|localhost):3100\/search(?:\/stream)? .*ERR_CONNECTION_(?:REFUSED|RESET)/i,
  /Failed to load resource: net::ERR_CONNECTION_(?:REFUSED|RESET)/i,
];
const BENIGN_REQUEST_FAILURE_PATTERNS = [
  /ERR_ABORTED/i,
  /http:\/\/(?:127\.0\.0\.1|localhost):3100\/search(?:\/stream)? .*ERR_CONNECTION_(?:REFUSED|RESET)/i,
];
const BENIGN_RESPONSE_FAILURE_PATTERNS = [
  /\/favicon\.ico 404$/i,
  /\/dogfood\/walkthrough\.(?:mp4|webm) 404$/i,
];

function isBenignBrowserIssue(kind: BrowserIssueKind, detail: string) {
  const patterns =
    kind === "pageerror"
      ? BENIGN_PAGE_ERROR_PATTERNS
      : kind === "console"
        ? BENIGN_CONSOLE_ERROR_PATTERNS
        : kind === "requestfailed"
          ? BENIGN_REQUEST_FAILURE_PATTERNS
          : BENIGN_RESPONSE_FAILURE_PATTERNS;

  return patterns.some((pattern) => pattern.test(detail));
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getSelectedRoutes() {
  const shardTotal = readPositiveIntegerEnv("DOGFOOD_ROUTE_SHARD_TOTAL", 1);
  const shardIndex = Math.min(
    Math.max(readPositiveIntegerEnv("DOGFOOD_ROUTE_SHARD_INDEX", 1), 1),
    shardTotal,
  );

  return ROUTES.filter((_, index) => index % shardTotal === shardIndex - 1);
}

function shouldIncludeInteractions() {
  return process.env.DOGFOOD_INCLUDE_INTERACTIONS !== "false";
}

function shouldIncludeRoutes() {
  return process.env.DOGFOOD_INCLUDE_ROUTES !== "false";
}

function getScreenshotPath(fileName: string) {
  const configuredDir = process.env.DOGFOOD_SCREENSHOT_DIR?.trim();
  const baseDir = configuredDir && configuredDir.length > 0
    ? configuredDir
    : path.join("test-results", "full-ui-dogfood");
  return path.join(baseDir, fileName);
}

async function resetBrowserStorage(page: Page) {
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();

    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ("caches" in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    }
  });
}

function formatBrowserIssues(issues: BrowserIssue[]) {
  if (issues.length === 0) {
    return "No unexpected browser runtime issues were captured.";
  }

  return issues
    .map((issue, index) => `${index + 1}. [${issue.kind}] ${issue.route}: ${issue.detail}`)
    .join("\n");
}

async function signInIfPrompted(page: Page) {
  const anonymousButton = page.getByRole("button", { name: /sign in anonymously/i }).first();
  if (await anonymousButton.count()) {
    await anonymousButton.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector("#main-content", { state: "visible", timeout: 60_000 });
    await page.waitForTimeout(1000);
    return;
  }

  const signInButton = page.getByRole("button", { name: /^sign in$/i }).first();
  if (await signInButton.count()) {
    await signInButton.click();
    await page.waitForTimeout(500);

    const modalAnonymousButton = page.getByRole("button", { name: /sign in anonymously/i }).first();
    if (await modalAnonymousButton.count()) {
      await modalAnonymousButton.click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForSelector("#main-content", { state: "visible", timeout: 60_000 });
      await page.waitForTimeout(1000);
    }
  }
}

async function navigateWithinApp(page: Page, targetPath: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      let response: Awaited<ReturnType<Page["goto"]>> | null = null;
      try {
        response = await page.goto(targetPath, { waitUntil: "domcontentloaded", timeout: 60_000 });
      } catch {
        response = null;
      }

      const mainShellVisible = await page
        .locator("#main-content")
        .isVisible({ timeout: 5_000 })
        .catch(() => false);

      if (targetPath !== "/" && (!response || response.status() >= 400 || !mainShellVisible)) {
        await page.goto("/", { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForSelector("#main-content", { state: "visible", timeout: 60_000 });
        await page.evaluate((path) => {
          window.history.pushState({}, "", path);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }, targetPath);
        await page.waitForTimeout(1200);
      }

      await page.waitForSelector("#main-content", { state: "visible", timeout: 20_000 });
      await page.waitForTimeout(900);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
      await page.waitForTimeout(1200);
    }
  }

  throw lastError;
}

async function ensureSurfaceReady(
  page: Page,
  route: (typeof ROUTES)[number],
) {
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.locator("#main-content")).toBeVisible({ timeout: 20_000 });
  const heading = page.getByRole("heading", { name: route.readyHeading }).first();
  const headingVisible = await heading.isVisible().catch(() => false);
  if (headingVisible) {
    return;
  }
  const routeRegion = page.getByRole("region", { name: new RegExp(`^${route.name}$`, "i") }).first();
  const routeRegionVisible = await routeRegion.isVisible().catch(() => false);
  if (routeRegionVisible) {
    return;
  }
  if (route.name === "chat") {
    const chatRegion = page.getByRole("region", { name: "Chat" }).first();
    const chatRegionVisible = await chatRegion.isVisible().catch(() => false);
    if (chatRegionVisible) {
      return;
    }
    await expect(
      page.getByRole("textbox", { name: /paste notes, links, or your ask/i }).first(),
    ).toBeVisible({ timeout: 20_000 });
    return;
  }
  await expect(heading).toBeVisible({ timeout: 20_000 });
}

async function ensureChatRunReady(page: Page, query: string) {
  await expect(page).toHaveURL(/surface=chat/, { timeout: 20_000 });
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  const queryHeading = page.getByRole("heading", { name: query }).first();
  const headingVisible = await queryHeading.isVisible().catch(() => false);
  if (headingVisible) {
    return;
  }
  const queryEcho = page.getByText(query, { exact: true }).first();
  const queryEchoVisible = await queryEcho.isVisible().catch(() => false);
  if (queryEchoVisible) {
    return;
  }
  const primaryComposer = page.getByRole("textbox", { name: /paste notes, links, or your ask/i }).first();
  if (await primaryComposer.count()) {
    await expect(primaryComposer).toBeVisible({ timeout: 20_000 });
    return;
  }

  await expect(page.locator("textarea:visible").first()).toBeVisible({ timeout: 20_000 });
}

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((t) => {
    localStorage.setItem(
      "nodebench-theme",
      JSON.stringify({
        mode: t,
        accentColor: "indigo",
        density: "comfortable",
        fontFamily: "Inter",
        backgroundPattern: "none",
        reducedMotion: false,
      }),
    );
    localStorage.setItem("theme", t);
  }, theme);
}

test.describe("Full UI Dogfood", () => {
  test.use({ serviceWorkers: "block" });

  test("dogfood public product routes and interactions", async ({ page }) => {
    test.setTimeout(25 * 60 * 1000);
    const selectedRoutes = shouldIncludeRoutes() ? getSelectedRoutes() : [];
    const includeInteractions = shouldIncludeInteractions();

    const browserIssues: BrowserIssue[] = [];
    let activeRoute = "/";
    const captureIssue = (kind: BrowserIssueKind, detail: string) => {
      if (isBenignBrowserIssue(kind, detail)) {
        return;
      }
      browserIssues.push({ kind, route: activeRoute, detail });
      console.error(`${kind.toUpperCase()}:`, detail);
    };

    page.on("pageerror", (error) => {
      captureIssue("pageerror", error?.message ?? String(error));
    });
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      captureIssue("console", msg.text());
    });
    page.on("requestfailed", (request) => {
      const detail = `${request.url()} ${request.failure()?.errorText ?? ""}`.trim();
      captureIssue("requestfailed", detail);
    });
    page.on("response", (response) => {
      if (response.status() < 400) return;
      captureIssue("response", `${response.url()} ${response.status()}`);
    });

    activeRoute = "/";
    await page.goto("/", { waitUntil: "networkidle" });
    await resetBrowserStorage(page);
    await page.evaluate(() => {
      localStorage.setItem("nodebench-onboarded", "1");
      localStorage.setItem(
        "nodebench-theme",
        JSON.stringify({
          mode: "dark",
          accentColor: "indigo",
          density: "comfortable",
          fontFamily: "Inter",
          backgroundPattern: "none",
          reducedMotion: false,
        }),
      );
      localStorage.setItem("theme", "dark");
    });

    activeRoute = "/";
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByText("Convex backend not configured")).toHaveCount(0);
    await signInIfPrompted(page);
    await expect(page.locator("#main-content")).toBeVisible({ timeout: 60_000 });

    for (const variant of VARIANTS) {
      await page.setViewportSize(variant.viewport);
      await setTheme(page, variant.theme);
      activeRoute = "/";
      await page.goto("/", { waitUntil: "networkidle" });
      await page.waitForTimeout(900);

      for (const route of selectedRoutes) {
        activeRoute = route.path;
        await navigateWithinApp(page, route.path);
        await ensureSurfaceReady(page, route);
        await page.screenshot({
          path: getScreenshotPath(`${route.name}${variant.suffix}.png`),
          fullPage: true,
        });
      }
    }

    if (includeInteractions) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await setTheme(page, "dark");

      activeRoute = "/?surface=home";
      await navigateWithinApp(page, "/?surface=home");
      const homeQuery = "What does Ditto AI do and what matters most right now?";
      const homeInput = page
        .getByRole("textbox", { name: /Ask anything - a company, a market, or a question|Paste notes, links, or your ask/ })
        .first();
      await expect(homeInput).toBeVisible({ timeout: 20_000 });
      await homeInput.fill(homeQuery);
      await page.getByRole("button", { name: /^open workspace$/i }).first().click();
      await page.waitForTimeout(2500);
      await ensureChatRunReady(page, homeQuery);
      await page.screenshot({
        path: getScreenshotPath("interaction-home-to-chat.png"),
        fullPage: true,
      });

      const themeToggle = page.getByRole("button", { name: /switch to (light|dark) mode/i }).first();
      await expect(themeToggle).toBeVisible({ timeout: 20_000 });
      await themeToggle.click();
      await page.waitForTimeout(700);
      await page.screenshot({
        path: getScreenshotPath("settings-theme-toggle.png"),
        fullPage: true,
      });
      await themeToggle.click();
      await page.waitForTimeout(500);

      activeRoute = "/?surface=reports";
      await navigateWithinApp(page, "/?surface=reports");
      const visibleChatButton = page.locator("button:visible").filter({ hasText: /^Chat$/i }).first();
      await expect(visibleChatButton).toBeVisible({ timeout: 20_000 });
      await visibleChatButton.click();
      await page.waitForTimeout(1500);
      await ensureChatRunReady(page, homeQuery);
      await page.screenshot({
        path: getScreenshotPath("interaction-reports-to-chat.png"),
        fullPage: true,
      });
    }

    expect(browserIssues, formatBrowserIssues(browserIssues)).toEqual([]);
  });
});
