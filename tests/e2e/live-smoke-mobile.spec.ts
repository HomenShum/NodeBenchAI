/**
 * live-smoke-mobile.spec.ts — Tier B hydrated-DOM verifier for mobile-only
 * surfaces ported from docs/design/nodebench-ai-design-system/ui_kits/
 * nodebench-mobile/.
 *
 * Runs in iPhone 14 viewport (390x844) so the `md:hidden` / `hidden md:block`
 * split renders the mobile surfaces we shipped (PR #23 Home, #24 Chat, #25
 * Inbox). The parallel desktop live-smoke in live-smoke.spec.ts stays at
 * the default Playwright viewport so desktop parity is still checked.
 *
 * Override URL for preview deploys:
 *   BASE_URL=https://preview-xyz.vercel.app npx playwright test live-smoke-mobile
 */
import { test, expect } from "@playwright/test";

const BASE_URL =
  process.env.BASE_URL?.replace(/\/$/, "") ?? "https://www.nodebenchai.com";

// Emulate iPhone 14 viewport + touch on Chromium (no WebKit install needed).
// The Tailwind `md:*` breakpoint in our app triggers at 768px; 390x844 is
// safely below it so all md:hidden / hidden md:block gates render the
// mobile surface variants.
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});

test.describe("live-smoke-mobile — Tier B (iPhone 14 viewport)", () => {
  test.setTimeout(45_000);

  test("Home surface — MobileHomeSurface mounts with watchlist + nudges + threads", async ({ page }) => {
    await page.goto(BASE_URL + "/");
    await expect(page.locator('[data-testid="mobile-home-surface"]')).toBeVisible({
      timeout: 20_000,
    });
    // First-impression async run contract
    await expect(page.getByText(/Need the read before you walk in/i)).toBeVisible();
    await expect(page.locator('[data-testid="mobile-home-async-run"]')).toBeVisible();
    await expect(page.locator('[data-testid="mobile-home-first-impression"]')).toBeVisible();
    await expect(page.getByText(/safe to leave/i)).toBeVisible();
    // Watchlist kicker
    await expect(page.getByText(/Watchlist/i).first()).toBeVisible();
    // At least one watchlist tile — Disco is the DISCO scenario root
    await expect(page.getByText(/^Today$/).first()).toBeVisible();
    await expect(page.getByText(/Announced GA/i).first()).toBeVisible();
    await page.getByText(/Watchlist/i).first().click();
    await expect(page.getByText(/^DISCO$/).first()).toBeVisible();
    // Nudges section
    await expect(page.getByText(/Recent threads/i).first()).toBeVisible();
    // Recent threads kicker
    // Home already has a primary research control; no floating button should cover cards.
    await expect(page.locator('[data-testid="mobile-capture-fab"]')).toHaveCount(0);
  });

  test("Chat surface — MobileChatSurface mounts with answer + entities + sources", async ({ page }) => {
    await page.goto(BASE_URL + "/?surface=chat");
    await expect(page.locator('[data-testid="mobile-chat-surface"]')).toBeVisible({
      timeout: 20_000,
    });
    // Verified pill
    await expect(page.getByText(/verified/i)).toBeVisible();
    // "So what" callout (design-kit vocabulary)
    await expect(page.getByText(/So what/i)).toBeVisible();
    // Entities strip header
    const chatSurface = page.locator('[data-testid="mobile-chat-surface"]');
    await expect(chatSurface.getByText(/^Evidence$/i)).toBeVisible();
    await expect(chatSurface.getByText(/3 entities - 24 sources/i)).toBeVisible();
    await chatSurface.getByText(/^Evidence$/i).click();
    await expect(page.getByText(/Entities/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Open entity cards/i })).toBeVisible();
    // Top sources header
    await expect(page.getByText(/Top sources/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /View source list/i })).toBeVisible();
    // Follow-up chips
    await expect(
      page.locator('[data-testid="mobile-chat-surface"]').getByText(/^Next$/),
    ).toBeVisible();
    // Composer dock input
    await expect(page.getByPlaceholder(/Ask a follow-up/i)).toBeVisible();
    const stripHeadersFit = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".m-strip-head")).every((header) => {
        const rect = header.getBoundingClientRect();
        return Array.from(header.children).every((child) => {
          const childRect = child.getBoundingClientRect();
          return childRect.left >= rect.left - 1 && childRect.right <= rect.right + 1;
        });
      }),
    );
    expect(stripHeadersFit, "mobile chat strip headers should not collide or overflow").toBe(true);
    await expect(page.locator('[data-testid="mobile-capture-fab"]')).toHaveCount(0);
  });

  test("Inbox surface — MobileInboxSurface mounts with filter tabs", async ({ page }) => {
    await page.goto(BASE_URL + "/?surface=inbox");
    await expect(page.locator('[data-testid="mobile-inbox-surface"]')).toBeVisible({
      timeout: 20_000,
    });
    // Filter tabs
    await expect(page.getByRole("button", { name: /^All / })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Mentions / })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Signals / })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Tasks / })).toBeVisible();
    // Today section kicker
    await expect(page.getByText(/^Today$/).first()).toBeVisible();
  });

  test("Me surface — MobileMeSurface mounts with identity + workspaces + shortcuts", async ({ page }) => {
    await page.goto(BASE_URL + "/?surface=me");
    const meSurface = page.locator('[data-testid="mobile-me-surface"]');
    await expect(meSurface).toBeVisible({ timeout: 20_000 });
    // Identity card (scoped to the mobile surface so we do not collide with
    // any desktop MeHome slice that shares similar copy).
    await expect(meSurface.getByText(/Homen Shum/i)).toBeVisible();
    // Stats strip label — exact match inside the mobile surface
    await expect(meSurface.getByText(/^Threads$/i).first()).toBeVisible();
    // Workspaces section header inside the mobile surface
    await expect(meSurface.getByText(/^Workspaces$/).first()).toBeVisible();
    // Quick settings section inside the mobile surface
    await expect(meSurface.getByText(/Quick settings/i)).toBeVisible();
    // Shortcuts CTA inside the mobile surface
    await expect(meSurface.getByRole("button", { name: /Starred threads/i })).toBeVisible();
  });

  test("Reports surface — mobile mounts live pipeline controls and report cards", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto(BASE_URL + "/?surface=reports&nbPerf=1");
    const reportsSurface = page.locator('[data-testid="mobile-reports-surface"]');
    const pipelineBlock = reportsSurface.locator('[data-testid="mobile-reports-pipeline-block"]');
    await expect(reportsSurface).toBeVisible({ timeout: 20_000 });
    await expect(pipelineBlock).toBeVisible();
    await expect(reportsSurface.locator(".m-title")).toHaveText("Reports");
    await expect(pipelineBlock.getByText(/Background safe/i)).toBeVisible();
    await expect(pipelineBlock.getByText(/Start or check research/i)).toHaveCount(0);
    await expect(pipelineBlock.getByRole("tab", { name: /^Runs$/ })).toBeVisible();
    await expect(pipelineBlock.getByRole("tab", { name: /^Quality$/ })).toBeVisible();
    await expect(pipelineBlock.getByRole("tab", { name: /^Refreshes$/ })).toBeVisible();
    await expect(pipelineBlock.locator('[data-exact-composer="golden"]')).toBeVisible();
    await expect(
      pipelineBlock.locator('[data-testid="pipeline-launcher"] .nb-composer-input'),
    ).toHaveAttribute("placeholder", "Ask, capture, paste, upload, or record...");
    await expect(pipelineBlock.locator('[data-testid="pipeline-launcher"] .nb-model-trigger')).toBeVisible();
    await expect(pipelineBlock.locator('[data-testid="pipeline-launcher"] .nb-model-trigger')).toContainText("Auto balanced");
    const mobileModelSelect = pipelineBlock
      .locator('[data-testid="pipeline-launcher-model"]')
      .filter({ visible: true });
    await expect(mobileModelSelect).toContainText("Auto free");
    await mobileModelSelect.selectOption("nodebench:auto-free");
    await expect(mobileModelSelect).toHaveValue("nodebench:auto-free");
    await expect(
      pipelineBlock.locator('[data-testid="pipeline-launcher"] .nb-composer-meta'),
    ).toContainText("Memory-first - free route");
    await expect(pipelineBlock.locator('[data-testid="pipeline-launcher"] .nb-prompt-chip')).toHaveCount(3);
    await expect(pipelineBlock.getByText(/What should NodeBench find out/i)).toHaveCount(0);
    await expect(pipelineBlock.getByText(/Options:/i)).toHaveCount(0);
    await expect(pipelineBlock.getByText(/Run a pipeline/i)).toHaveCount(0);
    await expect(pipelineBlock.getByText(/Run pipeline/i)).toHaveCount(0);
    await expect(pipelineBlock.getByText(/idempotent|@convex-dev/i)).toHaveCount(0);
    await expect(page.locator('[data-testid="mobile-capture-fab"]')).toHaveCount(0);
    await expect(pipelineBlock.locator('[data-testid="reports-pipeline-launcher-slot"]')).toBeVisible();
    await expect(pipelineBlock.locator('[data-testid="pipeline-launcher"]')).toBeVisible();
    await expect(pipelineBlock.locator('[data-testid="pipeline-launcher"]')).toHaveAttribute(
      "data-pipeline-launcher-variant",
      "compact",
    );
    await expect(pipelineBlock.locator('[data-testid="reports-pipelines-panel-slot"]')).toHaveCount(0);
    await expect(pipelineBlock.locator('[data-testid="reports-pipeline-eval-slot"]')).toHaveCount(0);
    await pipelineBlock.getByRole("tab", { name: /^Runs$/ }).click();
    await expect(pipelineBlock.getByRole("tab", { name: /^Runs$/ })).toHaveAttribute("data-active", "true");
    await expect(pipelineBlock.locator('[data-testid="reports-pipelines-panel-slot"]')).toBeVisible();
    await expect(pipelineBlock.locator('[data-testid="pipeline-runs-panel"], [data-testid="pipeline-runs-empty"]')).toBeVisible();
    await expect(
      pipelineBlock.locator(
        '[data-testid="pipeline-stat-window"], [data-testid="pipeline-runs-empty"], [data-testid="pipeline-run-list"]',
      ).first(),
    ).toBeVisible();
    await pipelineBlock.getByRole("tab", { name: /^Quality$/ }).click();
    await expect(pipelineBlock.locator('[data-testid="reports-pipeline-eval-slot"]')).toBeVisible();
    await expect(
      pipelineBlock.locator(
        '[data-testid="pipeline-eval-scorecard"], [data-testid="pipeline-eval-scorecard-empty"], .nb-deferred-panel',
      ),
    ).toBeVisible();
    await expect(pipelineBlock.locator('[data-testid="pipeline-schedules-panel"]')).toHaveCount(0);
    await pipelineBlock.getByRole("tab", { name: /^Refreshes$/ }).click();
    await expect(pipelineBlock.locator('[data-testid="reports-pipeline-schedules-slot"]')).toBeVisible();
    await expect(pipelineBlock.locator('[data-testid="pipeline-schedules-panel"], [data-testid="pipeline-schedules-empty"]')).toBeVisible();
    await expect(reportsSurface.getByRole("button", { name: /^Brief$/ })).toHaveCount(0);
    await expect(reportsSurface.getByRole("button", { name: /^Sources$/ })).toHaveCount(0);
    await expect(reportsSurface.getByRole("button", { name: /^Notebook$/ })).toHaveCount(0);
    await expect(reportsSurface.locator('[data-testid="mobile-reports-card-list"]')).toBeVisible();
    await expect(reportsSurface.locator('[data-testid="mobile-report-card"]')).toHaveCount(5);
    await expect(reportsSurface.locator('[data-testid="mobile-report-card"]').first()).toContainText(
      "DISCO - diligence debrief",
    );

    const noHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noHorizontalOverflow, "mobile reports should not create document-level horizontal overflow").toBe(true);

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const perfApi = window as Window & {
              __nodebenchPerf?: {
                getLatest: (routeId?: string) => { rootVisibleMs?: number; firstActionVisibleMs?: number } | undefined;
              };
            };
            const record = perfApi.__nodebenchPerf?.getLatest("mobile-reports");
            return Boolean(record?.rootVisibleMs != null && record?.firstActionVisibleMs != null);
          }),
        { timeout: 5_000 },
      )
      .toBe(true);
    const perf = await page.evaluate(() => {
      const perfApi = window as Window & {
        __nodebenchPerf?: {
          getLatest: (routeId?: string) =>
            | {
                rootVisibleMs?: number;
                firstActionVisibleMs?: number;
                convexWarningCount?: number;
              }
            | undefined;
        };
      };
      return perfApi.__nodebenchPerf?.getLatest("mobile-reports");
    });
    expect(perf?.rootVisibleMs ?? Infinity).toBeLessThanOrEqual(1_500);
    expect(perf?.firstActionVisibleMs ?? Infinity).toBeLessThanOrEqual(2_000);
    expect(perf?.convexWarningCount ?? 0, "mobile reports should not emit Convex fallback warnings").toBe(0);

    const real = errors.filter(
      (e) =>
        !/favicon/i.test(e) &&
        !/CSP/i.test(e) &&
        !/Third-party cookie/i.test(e) &&
        !/extension/i.test(e),
    );
    expect(real, "mobile reports console/page errors:\n" + real.map((e) => "  - " + e).join("\n")).toEqual([]);
  });

  test("Report detail — MobileReportSurface mounts with Brief|Sources|Notebook sub-tabs", async ({ page }) => {
    await page.goto(BASE_URL + "/reports/acme-ai/graph");
    await expect(page.locator('[data-testid="mobile-report-surface"]')).toBeVisible({
      timeout: 20_000,
    });
    // Sub-tab strip
    await expect(page.locator('[data-testid="mobile-report-subtabs"]')).toBeVisible();
    // Brief default
    await expect(page.getByRole("button", { name: /^Brief$/ })).toBeVisible();
    await expect(page.getByText(/Verdict/i).first()).toBeVisible();
    // Tap Sources → SOURCES view mounts
    await page.getByRole("button", { name: /^Sources$/ }).click();
    await expect(page.getByText(/Run signal/i)).toBeVisible();
    await expect(page.getByText(/All sources/i)).toBeVisible();
    // Tap Notebook → NOTEBOOK view mounts
    await page.getByRole("button", { name: /^Notebook$/ }).click();
    await expect(page.getByText(/April field notes/i)).toBeVisible();
    await expect(page.getByText(/Footnotes/i)).toBeVisible();
  });

  test("Home → nudge chevron routes to Inbox surface", async ({ page }) => {
    await page.goto(BASE_URL + "/");
    await expect(page.locator('[data-testid="mobile-home-surface"]')).toBeVisible({
      timeout: 15_000,
    });
    // The "All N" link routes to Inbox
    await page.getByRole("button", { name: /All \d+/ }).first().click();
    await expect(page.locator('[data-testid="mobile-inbox-surface"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test("console has no uncaught errors during mobile landing load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto(BASE_URL + "/");
    await page.waitForTimeout(3_000);
    const real = errors.filter(
      (e) =>
        !/favicon/i.test(e) &&
        !/CSP/i.test(e) &&
        !/Third-party cookie/i.test(e) &&
        !/extension/i.test(e),
    );
    expect(
      real,
      "mobile console errors on landing:\n" + real.map((e) => "  - " + e).join("\n"),
    ).toEqual([]);
  });
});
