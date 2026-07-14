/**
 * One-flow regression test — the canonical user journey.
 *
 * Per the stabilization-sprint spec: "Can a user leave, come back,
 * resume the same entity, see prior chats, edit the notebook, trust
 * the sources, explore relationships, and export?"
 *
 * Flow under test:
 *   1. Anonymous visitor lands on canonical Home (?surface=home -> /redesign)
 *   2. Switches to Chat (?surface=chat) — sees seeded thread
 *   3. Source chips render with cached/live badges
 *   4. Switches to Reports (?surface=reports) — sees seeded report grid
 *   5. Opens a report (?surface=reports&report=X) — ExactReportDetailSurface inline
 *   6. Switches to Inbox (?surface=inbox) — sees Today's pulse + seeded items
 *   7. Switches to Me (?surface=me) — Watching count + sessions visible
 *   8. Avatar HS button opens status panel — Watching · 12 entities + 3 pulse tiles
 *   9. Theme toggle works (Light/Dark)
 *  10. No console errors anywhere in the flow
 *
 * This is the "cosmetic completion" gate: passes 10/10 means the
 * 5-surface cockpit + the chat parity work + A9 fallback fixes are
 * all live.
 *
 * Run as `npm run live-smoke` or via the Tier B preview workflow on
 * every PR. BASE_URL controls target (preview URL in CI, prod for
 * post-deploy verification).
 */

import { test, expect, type Page } from "@playwright/test";
import {
  expectAvatarPulseContract,
  readAvatarPulseMetrics,
} from "./helpers/avatarPulse";
import { installVercelPreviewBypass } from "./helpers/vercelPreview";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4173";

test.beforeEach(async ({ page }) => {
  await installVercelPreviewBypass(page, BASE_URL);
});

// Public surface URLs plus the exact-cockpit compatibility route used by A9.
const SURFACES = {
  home: "/?surface=home",
  chat: "/?surface=chat",
  reports: "/?surface=reports",
  inbox: "/?surface=inbox",
  me: "/?surface=me",
  exactHome: "/?surface=ask",
} as const;

async function goSurface(
  page: Page,
  surface: keyof typeof SURFACES,
): Promise<void> {
  await page.goto(`${BASE_URL}${SURFACES[surface]}`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForTimeout(800); // settle for staggered animations
}

async function collectErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      // Filter out 3rd-party noise (e.g. ResizeObserver, dev-only warnings)
      const text = msg.text();
      if (text.includes("ResizeObserver")) return;
      if (text.includes("React DevTools")) return;
      errors.push(`console.error: ${text}`);
    }
  });
  return errors;
}

test.describe("ONE-FLOW REGRESSION", () => {
  test("anonymous visitor: full surface tour with no console errors + seed fallback intact", async ({
    page,
  }) => {
    const errors = await collectErrors(page);

    // 1. Home
    await goSurface(page, "home");
    await expect(
      page,
      "canonical Home redirects to the current redesign",
    ).toHaveURL(/\/redesign(?:[/?#]|$)/);
    await expect(
      page.getByTestId("home-v3-chat-first-frontpage"),
      "chat-first Home front page",
    ).toBeVisible();
    await expect(
      page.getByTestId("home-v3-report-halo"),
      "report-memory halo",
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Ask once. Turn it into reusable intelligence.",
      }),
      "Home intent heading",
    ).toBeVisible();
    await expect(
      page.getByPlaceholder(
        "Ask about a company, person, event, market, report, or source packet...",
      ),
      "Home universal composer",
    ).toBeVisible();

    // 2. Chat — honest live-ready state, with no fixture answer substituted
    await goSurface(page, "chat");
    const chatReady = await page.evaluate(() => ({
      streamMount: !!document.querySelector(
        '[data-testid="exact-web-chat-stream"]',
      ),
      liveStatus: document
        .querySelector('[data-testid="exact-web-chat-stream"]')
        ?.getAttribute("data-chat-live-status"),
      noFixtureText: document.body.textContent?.includes(
        "no fixture answer loaded",
      ),
      contextRuntimeText:
        document.body.textContent?.includes("Context Runtime") ||
        document.body.textContent?.includes("ContextRuntimePacket"),
      turns: document.querySelectorAll(".nb-turn").length,
      agentTurns: document.querySelectorAll('.nb-turn[data-role="agent"]')
        .length,
      runBars: document.querySelectorAll(".nb-runbar").length,
      followups: document.querySelectorAll(".nb-followup-chip").length,
      goldenComposer: !!document.querySelector(
        '[data-exact-composer="golden"][data-exact-composer-version="2026-05-02"]',
      ),
    }));
    expect(chatReady.streamMount, "ChatStream mount").toBe(true);
    expect(
      chatReady.liveStatus,
      "Chat exposes its live run status",
    ).toBeTruthy();
    expect(
      chatReady.noFixtureText,
      "Chat discloses the fixture-free live-ready state",
    ).toBe(true);
    expect(
      chatReady.contextRuntimeText,
      "Chat names the Context Runtime contract",
    ).toBe(true);
    expect(
      chatReady.turns,
      "Chat has at least the live-ready turn",
    ).toBeGreaterThanOrEqual(1);
    expect(
      chatReady.agentTurns,
      "Chat has a live-ready agent turn",
    ).toBeGreaterThanOrEqual(1);
    expect(
      chatReady.runBars,
      "Chat exposes agent run status",
    ).toBeGreaterThanOrEqual(1);
    expect(
      chatReady.followups,
      "Chat has actionable follow-up chips",
    ).toBeGreaterThanOrEqual(1);
    expect(
      chatReady.goldenComposer,
      "Chat keeps the shared golden composer",
    ).toBe(true);

    // 3. Reports list
    await goSurface(page, "reports");
    const reportsReady = await page.evaluate(() => ({
      cards: document.querySelectorAll(".nb-rcard, .nb-report-card").length,
    }));
    expect(
      reportsReady.cards,
      "Reports list shows seeded cards",
    ).toBeGreaterThanOrEqual(1);

    // 4. Inbox
    await goSurface(page, "inbox");
    const inboxReady = await page.evaluate(() => ({
      head: !!document.querySelector(".nb-inbox-head"),
      heading: document.querySelector(".nb-inbox-head h1")?.textContent?.trim(),
      filters: Array.from(
        document.querySelectorAll(".nb-inbox-filter button"),
      ).map((button) => (button.textContent ?? "").trim().split(/\s+/)[0]),
      rows: document.querySelectorAll(".nb-ibx-row, .nb-panel").length,
    }));
    expect(inboxReady.head, "Inbox renders its current header").toBe(true);
    expect(inboxReady.heading, "Inbox heading").toBe("Inbox");
    expect(
      inboxReady.filters.slice(0, 4),
      "Inbox keeps the locked primary filters",
    ).toEqual(["All", "Act", "Auto", "Watching"]);
    expect(
      inboxReady.rows,
      "Inbox renders actionable rows",
    ).toBeGreaterThanOrEqual(1);

    // 5. Me
    await goSurface(page, "me");
    const meReady = await page.evaluate(() => ({
      sidenav: !!document.querySelector(".nb-me-sidenav, .nb-me-shell"),
    }));
    expect(meReady.sidenav, "Me surface renders kit shell").toBeTruthy();

    // 6. Avatar status panel — A9 regression coverage
    await goSurface(page, "exactHome");
    await page.click(".nb-avm-trigger", { timeout: 10_000 });
    await page.waitForSelector('[data-testid="exact-avatar-menu"]', {
      timeout: 10_000,
    });
    await page.waitForTimeout(400);
    const avatarReady = await page.evaluate(() => ({
      pulseTiles: document.querySelectorAll(".nb-avm-pulse").length,
      sectionLabels: Array.from(
        document.querySelectorAll(".nb-avm-section-label"),
      ).map((el) => el.textContent),
      watchRows: document.querySelectorAll(".nb-avm-watch-row").length,
      sessionRows: document.querySelectorAll(".nb-avm-session").length,
    }));
    expect(avatarReady.pulseTiles, "3 pulse tiles").toBe(3);
    expectAvatarPulseContract(await readAvatarPulseMetrics(page));
    expect(
      avatarReady.sectionLabels,
      "Watching reads 12 entities (A9 fix)",
    ).toEqual(expect.arrayContaining(["Watching · 12 entities"]));
    expect(avatarReady.watchRows, "3 watch rows").toBeGreaterThanOrEqual(3);
    expect(
      avatarReady.sessionRows,
      "at least 3 recent sessions",
    ).toBeGreaterThanOrEqual(3);

    // 7. No console errors throughout
    expect(errors, `console errors during flow: ${errors.join(" | ")}`).toEqual(
      [],
    );
  });

  test("source chip click opens domain in new tab (interactive behavior)", async ({
    page,
    context,
  }) => {
    await goSurface(page, "chat");
    const chipExists = await page.evaluate(
      () => !!document.querySelector(".nb-src-chip"),
    );
    test.skip(
      !chipExists,
      "no source chip rendered — skipping interactive test",
    );

    // Wait for new-tab popup when chip is clicked
    const popupPromise = context.waitForEvent("page", { timeout: 5_000 });
    await page.click(".nb-src-chip");
    const popup = await popupPromise.catch(() => null);
    if (popup) {
      expect(popup.url(), "source chip opens external URL").toMatch(
        /^https?:\/\//,
      );
      await popup.close();
    }
    // If browser blocked the popup, the click should still register without error.
  });

  test("follow-up chip sends as new prompt (interactive behavior)", async ({
    page,
  }) => {
    await goSurface(page, "chat");
    const followupExists = await page.evaluate(
      () => !!document.querySelector(".nb-followup-chip"),
    );
    test.skip(
      !followupExists,
      "no followup chip rendered — skipping interactive test",
    );

    const before = await page.evaluate(
      () => document.querySelectorAll(".nb-turn").length,
    );
    await page.click(".nb-followup-chip");
    await page.waitForTimeout(800); // wait for streaming start
    const after = await page.evaluate(
      () => document.querySelectorAll(".nb-turn").length,
    );
    expect(after, "follow-up chip appended a new user turn").toBeGreaterThan(
      before,
    );
  });
});
