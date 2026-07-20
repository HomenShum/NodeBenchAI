/**
 * Demo Walkthrough — Playwright smoke for TF01–TF14
 *
 * Runs the 14 canonical task flows from fast-slow-ui-ux-cases.csv against
 * a dev or preview server. Screenshots every key step.
 *
 * Hard gates (fail on any violation):
 *   - Route loads (no 500, no unhandled rejection)
 *   - Body element becomes visible within 10s
 *   - Zero console errors across the whole flow
 *
 * Soft gates (captured in report as needs_review but do not fail):
 *   - Specific testids present
 *   - Content-shape matchers (disambiguation, low-confidence cards)
 *
 * The philosophy: if a route 500s or throws in the console, the demo is in
 * danger. Missing testids are tomorrow-morning polish, not ship blockers.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:4173 npm run live-smoke:demo   # or:
 *   BASE_URL=http://127.0.0.1:4173 npx playwright test tests/e2e/demo-walkthrough.spec.ts --project=chromium
 *
 * Outputs:
 *   screenshots → .tmp/demo-walkthrough/{tf}/*.png
 *   report      → .tmp/demo-walkthrough/report.json
 *
 * Related:
 *   docs/architecture/fast-slow-ui-ux-cases.csv
 *   docs/architecture/DEMO_PREFLIGHT.md
 */

import { test, expect, devices, type Page, type Locator } from "@playwright/test";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const OUT_DIR = resolve(process.cwd(), ".tmp", "demo-walkthrough");
const REPORT_FILE = resolve(OUT_DIR, "report.json");

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

type SoftGateResult = {
  label: string;
  found: boolean;
  selector: string;
};

type CaseReport = {
  tf: string;
  route: string;
  status: "pass" | "fail";
  consoleErrorCount: number;
  consoleErrors: string[];
  softGates: SoftGateResult[];
  screenshots: string[];
  elapsedMs: number;
};

const reportSink: CaseReport[] = [];

function attachConsoleWatcher(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      // Filter out known-noisy-but-harmless sources
      const text = msg.text();
      if (/Download the React DevTools|Failed to load resource.*favicon/i.test(text)) return;
      errors.push(text);
    }
  });
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return errors;
}

async function checkSoft(
  page: Page,
  label: string,
  selector: string,
  results: SoftGateResult[],
): Promise<Locator> {
  const locator = page.locator(selector).first();
  const count = await locator.count();
  results.push({ label, found: count > 0, selector });
  return locator;
}

async function snapshot(page: Page, tf: string, name: string, list: string[]): Promise<void> {
  const dir = resolve(OUT_DIR, tf);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Scroll to top so the viewport capture starts at the page header.
  // Also capture a full-page snapshot so above/below-fold content is inspectable.
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  const viewportFile = resolve(dir, `${name}.png`);
  await page.screenshot({ path: viewportFile, fullPage: false });
  const fullFile = resolve(dir, `${name}-full.png`);
  await page.screenshot({ path: fullFile, fullPage: true });
  list.push(viewportFile, fullFile);
}

async function loadRoute(page: Page, path: string, soft: SoftGateResult[]): Promise<void> {
  const response = await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  if (response) {
    const status = response.status();
    expect(status, `${path} must not return 5xx`).toBeLessThan(500);
    soft.push({ label: `status<500`, found: status < 500, selector: `HTTP ${status}` });
  }
  await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
  // Wait for Suspense fallbacks to settle so we screenshot the real content,
  // not the module-loading skeleton. 2.5s is enough for lazy-loaded chunks
  // on preview builds without introducing flake.
  await page
    .waitForLoadState("networkidle", { timeout: 2500 })
    .catch(() => undefined);
}

async function finalizeCase(args: {
  tf: string;
  route: string;
  consoleErrors: string[];
  softGates: SoftGateResult[];
  screenshots: string[];
  elapsedMs: number;
}): Promise<CaseReport> {
  const report: CaseReport = {
    tf: args.tf,
    route: args.route,
    status: args.consoleErrors.length === 0 ? "pass" : "fail",
    consoleErrorCount: args.consoleErrors.length,
    consoleErrors: args.consoleErrors,
    softGates: args.softGates,
    screenshots: args.screenshots,
    elapsedMs: args.elapsedMs,
  };
  reportSink.push(report);
  return report;
}

// Use Pixel 7 (Chromium-native) instead of iPhone 13 (WebKit) so the
// --project=chromium runner can launch without needing a separate WebKit
// install. The mobile IA + 390–412px viewport assertions still hold.
test.use({ ...devices["Pixel 7"] });

test.describe("Demo walkthrough — TF01–TF14 on Pixel 7 (mobile Chromium)", () => {
  test.describe.configure({ mode: "serial" });

  // ── TF01 Cold start ─────────────────────────────────────────────────────
  test("TF01 cold_start — Home route loads and shows a primary action", async ({ page }) => {
    const t0 = Date.now();
    const errors = attachConsoleWatcher(page);
    const soft: SoftGateResult[] = [];
    const shots: string[] = [];

    await loadRoute(page, "/", soft);
    await snapshot(page, "TF01", "landing", shots);

    // Soft: primary CTA discoverable
    await checkSoft(page, "primary-cta-button", 'button, [role="button"], a[role="button"]', soft);
    await checkSoft(page, "text-ask-or-search", ':text-matches("ask|chat|search|start|try", "i")', soft);

    const report = await finalizeCase({
      tf: "TF01",
      route: "/",
      consoleErrors: errors,
      softGates: soft,
      screenshots: shots,
      elapsedMs: Date.now() - t0,
    });
    expect(report.status, `console errors: ${errors.join(" | ")}`).toBe("pass");
  });

  // ── TF02 Quick company ask ──────────────────────────────────────────────
  test("TF02 quick_company_ask — /chat loads composer", async ({ page }) => {
    const t0 = Date.now();
    const errors = attachConsoleWatcher(page);
    const soft: SoftGateResult[] = [];
    const shots: string[] = [];

    await loadRoute(page, "/chat", soft);
    await snapshot(page, "TF02", "chat-open", shots);

    const input = await checkSoft(page, "composer-textbox", 'input[type="text"], textarea, [role="textbox"], [contenteditable="true"]', soft);
    if ((await input.count()) > 0) {
      try {
        await input.fill("tell me about stripe");
        await snapshot(page, "TF02", "composer-typed", shots);
      } catch {
        // Input may be read-only until auth — not a hard fail
      }
    }

    const report = await finalizeCase({
      tf: "TF02",
      route: "/chat",
      consoleErrors: errors,
      softGates: soft,
      screenshots: shots,
      elapsedMs: Date.now() - t0,
    });
    expect(report.status, `console errors: ${errors.join(" | ")}`).toBe("pass");
  });

  // ── TF03 Ambiguous prompt ───────────────────────────────────────────────
  test("TF03 ambiguous_prompt — /chat renders without crash on ambiguous input", async ({ page }) => {
    const t0 = Date.now();
    const errors = attachConsoleWatcher(page);
    const soft: SoftGateResult[] = [];
    const shots: string[] = [];

    await loadRoute(page, "/chat", soft);
    // Look for disambiguation affordances anywhere on the page (soft)
    await checkSoft(page, "disambiguation-candidates", '[data-testid="disambiguation"], [data-testid="low-confidence-card"], :text-matches("which one|ambiguous|multiple", "i")', soft);
    await snapshot(page, "TF03", "chat-initial", shots);

    const report = await finalizeCase({
      tf: "TF03",
      route: "/chat",
      consoleErrors: errors,
      softGates: soft,
      screenshots: shots,
      elapsedMs: Date.now() - t0,
    });
    expect(report.status, `console errors: ${errors.join(" | ")}`).toBe("pass");
  });

  // ── TF04 Open artifact ──────────────────────────────────────────────────
  test("TF04 open_artifact — /reports lists reports or empty state", async ({ page }) => {
    const t0 = Date.now();
    const errors = attachConsoleWatcher(page);
    const soft: SoftGateResult[] = [];
    const shots: string[] = [];

    await loadRoute(page, "/reports", soft);
    await snapshot(page, "TF04", "reports", shots);
    await checkSoft(page, "report-card-or-empty", '[data-testid="report-card"], [data-testid="empty-state"], :text-matches("no reports|nothing here yet|start.*report", "i")', soft);

    const report = await finalizeCase({
      tf: "TF04",
      route: "/reports",
      consoleErrors: errors,
      softGates: soft,
      screenshots: shots,
      elapsedMs: Date.now() - t0,
    });
    expect(report.status, `console errors: ${errors.join(" | ")}`).toBe("pass");
  });

  // ── TF05 Notebook ↔ Report ──────────────────────────────────────────────
  test("TF05 notebook_report_switch — /reports detail (if available)", async ({ page }) => {
    const t0 = Date.now();
    const errors = attachConsoleWatcher(page);
    const soft: SoftGateResult[] = [];
    const shots: string[] = [];

    await loadRoute(page, "/reports", soft);
    const firstReport = page.locator('[data-testid="report-card"], article, a[href*="/report/"]').first();
    if ((await firstReport.count()) > 0) {
      await firstReport.click().catch(() => undefined);
      await snapshot(page, "TF05", "report-detail", shots);
      await checkSoft(page, "notebook-tab", '[role="tab"]:has-text("Notebook"), [data-testid="tab-notebook"]', soft);
      await checkSoft(page, "report-tab", '[role="tab"]:has-text("Report"), [data-testid="tab-report"]', soft);
    } else {
      await snapshot(page, "TF05", "reports-empty", shots);
    }

    const report = await finalizeCase({
      tf: "TF05",
      route: "/reports",
      consoleErrors: errors,
      softGates: soft,
      screenshots: shots,
      elapsedMs: Date.now() - t0,
    });
    expect(report.status, `console errors: ${errors.join(" | ")}`).toBe("pass");
  });

  // ── TF06 Thread detail tabs ─────────────────────────────────────────────
  test("TF06 thread_tabs — /chat tab navigation", async ({ page }) => {
    const t0 = Date.now();
    const errors = attachConsoleWatcher(page);
    const soft: SoftGateResult[] = [];
    const shots: string[] = [];

    await loadRoute(page, "/chat", soft);
    for (const label of ["Conversation", "Steps", "Artifacts", "Files"]) {
      await checkSoft(page, `tab-${label.toLowerCase()}`, `[role="tab"]:has-text("${label}"), [data-testid="tab-${label.toLowerCase()}"]`, soft);
    }
    await snapshot(page, "TF06", "chat-tabs", shots);

    const report = await finalizeCase({
      tf: "TF06",
      route: "/chat",
      consoleErrors: errors,
      softGates: soft,
      screenshots: shots,
      elapsedMs: Date.now() - t0,
    });
    expect(report.status, `console errors: ${errors.join(" | ")}`).toBe("pass");
  });

  // ── TF07 Open Steps ─────────────────────────────────────────────────────
  test("TF07 steps_understanding — Steps tab content", async ({ page }) => {
    const t0 = Date.now();
    const errors = attachConsoleWatcher(page);
    const soft: SoftGateResult[] = [];
    const shots: string[] = [];

    await loadRoute(page, "/chat", soft);
    const stepsTab = page.locator('[role="tab"]:has-text("Steps"), [data-testid="tab-steps"]').first();
    if ((await stepsTab.count()) > 0) {
      await stepsTab.click().catch(() => undefined);
      await snapshot(page, "TF07", "steps", shots);
      await checkSoft(page, "steps-timeline-or-empty", '[data-testid="steps-timeline"], [data-testid="empty-state"], :text-matches("no runs|not started", "i")', soft);
    } else {
      await snapshot(page, "TF07", "chat-no-tabs", shots);
    }

    const report = await finalizeCase({
      tf: "TF07",
      route: "/chat",
      consoleErrors: errors,
      softGates: soft,
      screenshots: shots,
      elapsedMs: Date.now() - t0,
    });
    expect(report.status, `console errors: ${errors.join(" | ")}`).toBe("pass");
  });

  // ── TF08 Open Files ─────────────────────────────────────────────────────
  test("TF08 files_open — Files tab content", async ({ page }) => {
    const t0 = Date.now();
    const errors = attachConsoleWatcher(page);
    const soft: SoftGateResult[] = [];
    const shots: string[] = [];

    await loadRoute(page, "/chat", soft);
    const filesTab = page.locator('[role="tab"]:has-text("Files"), [data-testid="tab-files"]').first();
    if ((await filesTab.count()) > 0) {
      await filesTab.click().catch(() => undefined);
      await snapshot(page, "TF08", "files", shots);
    } else {
      await snapshot(page, "TF08", "chat-no-files-tab", shots);
    }

    const report = await finalizeCase({
      tf: "TF08",
      route: "/chat",
      consoleErrors: errors,
      softGates: soft,
      screenshots: shots,
      elapsedMs: Date.now() - t0,
    });
    expect(report.status, `console errors: ${errors.join(" | ")}`).toBe("pass");
  });

  // ── TF09 Inbox triage ───────────────────────────────────────────────────
  test("TF09 inbox_triage — /inbox sections or empty", async ({ page }) => {
    const t0 = Date.now();
    const errors = attachConsoleWatcher(page);
    const soft: SoftGateResult[] = [];
    const shots: string[] = [];

    await loadRoute(page, "/inbox", soft);
    await snapshot(page, "TF09", "inbox", shots);
    await checkSoft(page, "action-required", ':text-matches("action required|action needed", "i")', soft);
    await checkSoft(page, "updates", ':text-matches("^updates$|updates feed", "i")', soft);
    await checkSoft(page, "empty-or-sections", '[data-testid="empty-state"], [role="region"], section', soft);

    const report = await finalizeCase({
      tf: "TF09",
      route: "/inbox",
      consoleErrors: errors,
      softGates: soft,
      screenshots: shots,
      elapsedMs: Date.now() - t0,
    });
    expect(report.status, `console errors: ${errors.join(" | ")}`).toBe("pass");
  });

  // ── TF10 Pulse / daily brief ────────────────────────────────────────────
  test("TF10 pulse_daily_brief — Home pulse or welcome state", async ({ page }) => {
    const t0 = Date.now();
    const errors = attachConsoleWatcher(page);
    const soft: SoftGateResult[] = [];
    const shots: string[] = [];

    await loadRoute(page, "/", soft);
    await snapshot(page, "TF10", "home", shots);
    await checkSoft(page, "pulse-or-welcome", '[data-testid="pulse-card"], [data-testid="welcome"], [data-testid="empty-state"], :text-matches("today|pulse|brief|welcome", "i")', soft);

    const report = await finalizeCase({
      tf: "TF10",
      route: "/",
      consoleErrors: errors,
      softGates: soft,
      screenshots: shots,
      elapsedMs: Date.now() - t0,
    });
    expect(report.status, `console errors: ${errors.join(" | ")}`).toBe("pass");
  });

  // ── TF11 Upload file ────────────────────────────────────────────────────
  test("TF11 upload_file — composer has attach affordance", async ({ page }) => {
    const t0 = Date.now();
    const errors = attachConsoleWatcher(page);
    const soft: SoftGateResult[] = [];
    const shots: string[] = [];

    await loadRoute(page, "/chat", soft);
    await snapshot(page, "TF11", "composer", shots);
    await checkSoft(page, "attach-file-input", 'input[type="file"], [data-testid="attach-file"], [aria-label*="attach" i], button:has-text("Attach")', soft);

    const report = await finalizeCase({
      tf: "TF11",
      route: "/chat",
      consoleErrors: errors,
      softGates: soft,
      screenshots: shots,
      elapsedMs: Date.now() - t0,
    });
    expect(report.status, `console errors: ${errors.join(" | ")}`).toBe("pass");
  });

  // ── TF12 Reopen recent ──────────────────────────────────────────────────
  test("TF12 reopen_recent — Home surfaces recent artifacts or empty", async ({ page }) => {
    const t0 = Date.now();
    const errors = attachConsoleWatcher(page);
    const soft: SoftGateResult[] = [];
    const shots: string[] = [];

    await loadRoute(page, "/", soft);
    await snapshot(page, "TF12", "home-recent", shots);
    await checkSoft(page, "recent-artifacts", '[data-testid="recent-artifacts"], [data-testid="report-card"], [data-testid="empty-state"], a[href*="/report/"]', soft);

    const report = await finalizeCase({
      tf: "TF12",
      route: "/",
      consoleErrors: errors,
      softGates: soft,
      screenshots: shots,
      elapsedMs: Date.now() - t0,
    });
    expect(report.status, `console errors: ${errors.join(" | ")}`).toBe("pass");
  });

  // ── TF13 Share / export ─────────────────────────────────────────────────
  test("TF13 share_export — share CTA on report detail (if available)", async ({ page }) => {
    const t0 = Date.now();
    const errors = attachConsoleWatcher(page);
    const soft: SoftGateResult[] = [];
    const shots: string[] = [];

    await loadRoute(page, "/reports", soft);
    const firstReport = page.locator('[data-testid="report-card"], article, a[href*="/report/"]').first();
    if ((await firstReport.count()) > 0) {
      await firstReport.click().catch(() => undefined);
      await checkSoft(page, "share-cta", 'button:has-text("Share"), button:has-text("Copy link"), [data-testid="share-button"]', soft);
      await snapshot(page, "TF13", "report-share", shots);
    } else {
      await snapshot(page, "TF13", "reports-empty", shots);
    }

    const report = await finalizeCase({
      tf: "TF13",
      route: "/reports",
      consoleErrors: errors,
      softGates: soft,
      screenshots: shots,
      elapsedMs: Date.now() - t0,
    });
    expect(report.status, `console errors: ${errors.join(" | ")}`).toBe("pass");
  });

  // ── TF14 Background return ──────────────────────────────────────────────
  test("TF14 background_return — thread state after nav-away and back", async ({ page }) => {
    const t0 = Date.now();
    const errors = attachConsoleWatcher(page);
    const soft: SoftGateResult[] = [];
    const shots: string[] = [];

    await loadRoute(page, "/chat", soft);
    const input = page.locator('input[type="text"], textarea, [role="textbox"], [contenteditable="true"]').first();
    if ((await input.count()) > 0) {
      await input.fill("hello demo").catch(() => undefined);
    }
    await loadRoute(page, "/reports", soft);
    await loadRoute(page, "/chat", soft);
    await snapshot(page, "TF14", "returned", shots);
    await checkSoft(page, "composer-still-present", 'input[type="text"], textarea, [role="textbox"], [contenteditable="true"]', soft);

    const report = await finalizeCase({
      tf: "TF14",
      route: "/chat",
      consoleErrors: errors,
      softGates: soft,
      screenshots: shots,
      elapsedMs: Date.now() - t0,
    });
    expect(report.status, `console errors: ${errors.join(" | ")}`).toBe("pass");
  });
});

test.afterAll(async () => {
  const summary = {
    baseUrl: BASE_URL,
    completedAt: new Date().toISOString(),
    totalCases: reportSink.length,
    passCount: reportSink.filter((r) => r.status === "pass").length,
    failCount: reportSink.filter((r) => r.status === "fail").length,
    totalConsoleErrors: reportSink.reduce((s, r) => s + r.consoleErrorCount, 0),
    softGateTotals: {
      found: reportSink.flatMap((r) => r.softGates).filter((g) => g.found).length,
      missing: reportSink.flatMap((r) => r.softGates).filter((g) => !g.found).length,
    },
    cases: reportSink,
  };
  writeFileSync(REPORT_FILE, JSON.stringify(summary, null, 2));

  // Print a quick digest so CI log is readable even without opening the JSON
  /* eslint-disable no-console */
  console.log("");
  console.log("================= DEMO WALKTHROUGH =================");
  console.log(`base url        : ${BASE_URL}`);
  console.log(`cases           : ${summary.totalCases}`);
  console.log(`pass            : ${summary.passCount}`);
  console.log(`fail            : ${summary.failCount}`);
  console.log(`console errors  : ${summary.totalConsoleErrors}`);
  console.log(`soft found      : ${summary.softGateTotals.found}`);
  console.log(`soft missing    : ${summary.softGateTotals.missing}`);
  console.log(`report          : ${REPORT_FILE}`);
  console.log("====================================================");
  /* eslint-enable no-console */
});
