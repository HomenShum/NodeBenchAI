/**
 * Tier B verification: all 5 cockpit surfaces render the kit's pixel-perfect
 * Exact* surfaces on production.  Probes for kit-specific DOM signals that
 * only the ExactKit JSX produces.
 */

import { test, expect } from "@playwright/test";

const BASE_URL =
  process.env.BASE_URL?.replace(/\/$/, "") ?? "https://www.nodebenchai.com";

async function navigate(page: import("@playwright/test").Page, surface: string) {
  await page.goto(`${BASE_URL}/?surface=${surface}`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(5000);
}

test("PR A4: Home renders ExactHomeSurface composer hero", async ({ page }) => {
  await navigate(page, "ask");
  const result = await page.evaluate(() => ({
    composer: !!document.querySelector('[data-testid="exact-web-home-composer"]'),
    kicker: !!Array.from(document.querySelectorAll(".nb-kicker")).find((el) =>
      el.textContent?.toLowerCase().includes("on-the-go intelligence"),
    ),
    h1: Array.from(document.querySelectorAll(".nb-composer-hero h1")).map((h) => h.textContent?.trim()),
    lanes: Array.from(document.querySelectorAll(".nb-lane")).map((b) => b.textContent?.trim().slice(0, 20)),
    asyncProof: !!document.querySelector('[data-testid="home-async-proof"]'),
    firstImpression: !!document.querySelector('[data-testid="home-first-impression-board"]'),
  }));
  console.log("HOME:", JSON.stringify(result, null, 2));
  expect(result.composer).toBe(true);
  expect(result.kicker).toBe(true);
  expect(result.h1).toContain("Get the read before you walk in.");
  expect(result.lanes.length).toBeGreaterThanOrEqual(3);
  expect(result.asyncProof).toBe(true);
  expect(result.firstImpression).toBe(true);
});

test("PR A6: Home renders full kit HomePulse layout", async ({ page }) => {
  await navigate(page, "ask");
  const result = await page.evaluate(() => ({
    pulseStrip: !!document.querySelector('[data-testid="exact-home-pulse-strip"]'),
    pulseHeroCards: document.querySelectorAll(".nb-pulse-card").length,
    pulseMiniCards: document.querySelectorAll(".nb-pulse-mini").length,
    todayIntel: !!document.querySelector('[data-testid="exact-home-today-intel"]'),
    todayLanes: document.querySelectorAll(".nb-today-lane").length,
    activeEvent: !!document.querySelector('[data-testid="exact-home-active-event"]'),
    eventStats: document.querySelectorAll(".nb-event-stat").length,
    recentReports: !!document.querySelector('[data-testid="exact-home-recent-reports"]'),
    recentCards: document.querySelectorAll(".nb-recent-card").length,
  }));
  console.log("HOME PULSE:", JSON.stringify(result, null, 2));
  expect(result.pulseStrip, "PulseStrip section should render").toBe(true);
  expect(result.pulseHeroCards, "4 hero metric cards").toBeGreaterThanOrEqual(4);
  expect(result.pulseMiniCards, "6 secondary mini cards").toBeGreaterThanOrEqual(6);
  expect(result.todayIntel, "Today's intelligence section").toBe(true);
  expect(result.todayLanes, "4 today lanes").toBeGreaterThanOrEqual(4);
  expect(result.activeEvent, "Active event section").toBe(true);
  expect(result.eventStats, "4 event stats").toBeGreaterThanOrEqual(4);
  expect(result.recentReports, "Recent reports section").toBe(true);
  expect(result.recentCards, "3 recent report cards").toBeGreaterThanOrEqual(3);
});

test("PR A8: Chat renders ExactChatSurface ChatStream (full conversation thread)", async ({ page }) => {
  await navigate(page, "workspace");
  const result = await page.evaluate(() => ({
    streamMount: !!document.querySelector('[data-testid="exact-web-chat-stream"]'),
    streamRoot: !!document.querySelector(".nb-stream-root"),
    threadHeader: !!document.querySelector(".nb-stream-header h2"),
    headerTitle: document.querySelector(".nb-stream-header h2")?.textContent,
    saveBar: !!document.querySelector(".nb-stream-savebar"),
    saveBarReportName: document.querySelector(".nb-stream-savebar strong")?.textContent,
    fresh: !!document.querySelector(".nb-stream-fresh"),
    turns: document.querySelectorAll(".nb-turn").length,
    userTurns: document.querySelectorAll(".nb-turn[data-role=\"user\"]").length,
    agentTurns: document.querySelectorAll(".nb-turn[data-role=\"agent\"]").length,
    runBars: document.querySelectorAll(".nb-runbar").length,
    runUpdates: document.querySelectorAll(".nb-runup").length,
    entityPills: document.querySelectorAll(".nb-epill").length,
    followupChips: document.querySelectorAll(".nb-followup-chip").length,
    composerCard: !!document.querySelector(".nb-composer-card"),
    composerPin: !!document.querySelector(".nb-composer-pins .nb-pin"),
    composerInput: !!document.querySelector(".nb-composer-input"),
    composerSendButton: !!document.querySelector(".nb-composer-send"),
    suggestChips: document.querySelectorAll(".nb-prompt-chip").length,
    modelPill: !!document.querySelector(".nb-model-trigger"),
  }));
  console.log("CHAT STREAM:", JSON.stringify(result, null, 2));
  expect(result.streamMount, "ChatStream mount").toBe(true);
  expect(result.streamRoot).toBe(true);
  expect(result.threadHeader).toBe(true);
  expect(result.headerTitle).toContain("Orbital Labs");
  expect(result.saveBar, "Save bar").toBe(true);
  expect(result.saveBarReportName).toContain("Orbital Labs");
  expect(result.turns, "≥4 turns (2 user + 2 agent)").toBeGreaterThanOrEqual(4);
  expect(result.userTurns).toBeGreaterThanOrEqual(2);
  expect(result.agentTurns).toBeGreaterThanOrEqual(2);
  expect(result.runBars, "agent run bars").toBeGreaterThanOrEqual(2);
  expect(result.entityPills, "inline entity pills").toBeGreaterThan(0);
  expect(result.followupChips, "follow-up chips").toBeGreaterThan(0);
  expect(result.composerCard).toBe(true);
  expect(result.composerPin, "Ship Demo Day pin").toBe(true);
  expect(result.composerInput).toBe(true);
  expect(result.suggestChips, "3 suggest chips").toBeGreaterThanOrEqual(3);
  expect(result.modelPill, "Claude Sonnet 4.5 pill").toBe(true);
});

test("PR A2: Reports renders ExactReportsSurface card grid", async ({ page }) => {
  await navigate(page, "reports");
  const result = await page.evaluate(() => ({
    grid: !!document.querySelector(".nb-reports-grid"),
    rcards: document.querySelectorAll(".nb-rcard").length,
    exactCards: document.querySelectorAll('[data-exact-testid="exact-report-card"]').length,
    actionRows: document.querySelectorAll('[data-testid="report-card-actions"]').length,
  }));
  console.log("REPORTS:", JSON.stringify(result, null, 2));
  expect(result.grid).toBe(true);
  expect(result.rcards).toBeGreaterThan(0);
  expect(result.exactCards).toBeGreaterThan(0);
  expect(result.actionRows).toBeGreaterThan(0);
});

test("PR A1: Inbox renders ExactInboxSurface single-column rows", async ({ page }) => {
  await navigate(page, "nudges");
  const result = await page.evaluate(() => ({
    head: !!document.querySelector(".nb-inbox-head"),
    filterPills: Array.from(document.querySelectorAll(".nb-inbox-filter button")).map((b) =>
      (b.textContent ?? "").trim().split(/\s+/)[0],
    ),
    h1: document.querySelector(".nb-inbox-head h1")?.textContent?.trim(),
    rows: document.querySelectorAll(".nb-ibx-row, .nb-panel").length,
  }));
  console.log("INBOX:", JSON.stringify(result, null, 2));
  expect(result.head).toBe(true);
  expect(result.h1).toBe("Inbox");
  expect(result.filterPills.slice(0, 4)).toEqual(["All", "Act", "Auto", "Watching"]);
});

test("PR A3: Me renders ExactMeSurface 2-pane sidenav", async ({ page }) => {
  await navigate(page, "me");
  const result = await page.evaluate(() => ({
    grid: !!document.querySelector(".nb-me-grid"),
    sidenav: !!document.querySelector(".nb-me-sidenav"),
    profileAvatar: !!document.querySelector(".nb-me-sidenav .av"),
    sectionGroups: Array.from(document.querySelectorAll(".nb-me-sidenav .section-title")).map((el) =>
      el.textContent?.trim(),
    ),
  }));
  console.log("ME:", JSON.stringify(result, null, 2));
  expect(result.grid).toBe(true);
  expect(result.sidenav).toBe(true);
  expect(result.profileAvatar).toBe(true);
  expect(result.sectionGroups).toEqual(["Account", "Preferences", "Workspace"]);
});

test("PR A7: Reports card click renders inline detail (no workspace redirect)", async ({ page }) => {
  // Direct navigation: ?surface=packets&report=disco should render inline detail
  await page.goto(`${BASE_URL}/?surface=packets&report=disco`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(5000);

  // 1. Confirm we're STILL on the cockpit host, NOT redirected to workspace.nodebenchai.com
  const url1 = page.url();
  expect(url1, "card-click should NOT redirect to workspace subdomain").not.toContain("workspace.nodebenchai.com");
  expect(url1).toContain("surface=packets");
  expect(url1).toContain("report=disco");

  // 2. Confirm inline detail shell rendered
  const detail = await page.evaluate(() => ({
    detailMount: !!document.querySelector('[data-testid="exact-web-report-detail"]'),
    reportId: document.querySelector('[data-testid="exact-web-report-detail"]')?.getAttribute("data-report-id"),
    breadcrumbCurrent: document.querySelector(".nb-rdetail-crumb-current")?.textContent,
    title: document.querySelector(".nb-rdetail-title")?.textContent,
    eyebrow: document.querySelector(".nb-rdetail-eyebrow")?.textContent,
    sectionCount: document.querySelectorAll(".nb-rdetail-section").length,
    embeddedCard: !!document.querySelector(".nb-rdetail-card"),
    quote: !!document.querySelector(".nb-rdetail-quote"),
    backButton: !!document.querySelector(".nb-rdetail-back"),
    liveBadge: !!document.querySelector(".nb-rdetail-live"),
    askAgentButton: !!Array.from(document.querySelectorAll(".nb-btn")).find((el) =>
      el.textContent?.toLowerCase().includes("ask agent"),
    ),
  }));
  console.log("INLINE DETAIL:", JSON.stringify(detail, null, 2));
  expect(detail.detailMount, "inline detail mount").toBe(true);
  expect(detail.reportId).toBe("disco");
  expect(detail.title).toContain("DISCO");
  expect(detail.sectionCount, "DISCO has 5 sections").toBeGreaterThanOrEqual(5);
  expect(detail.embeddedCard, "Product & moat embedded company card").toBe(true);
  expect(detail.quote, "investment thesis quote").toBe(true);
  expect(detail.backButton).toBe(true);
  expect(detail.liveBadge).toBe(true);
  expect(detail.askAgentButton).toBe(true);

  // 3. Click back, confirm grid renders again
  await page.click(".nb-rdetail-back");
  await page.waitForTimeout(2000);
  const url2 = page.url();
  expect(url2).toContain("surface=packets");
  expect(url2, "back nav should clear ?report").not.toContain("report=");
  const back = await page.evaluate(() => ({
    grid: !!document.querySelector(".nb-reports-grid"),
    rcards: document.querySelectorAll(".nb-rcard").length,
  }));
  console.log("AFTER BACK:", JSON.stringify(back, null, 2));
  expect(back.grid).toBe(true);
  expect(back.rcards).toBeGreaterThanOrEqual(3);
});

test("PR A9: Avatar HS button opens kit status panel", async ({ page }) => {
  await navigate(page, "ask");

  // Closed state — trigger present, panel not in DOM
  const before = await page.evaluate(() => ({
    trigger: !!document.querySelector(".nb-avm-trigger"),
    avatarMark: document.querySelector(".nb-avm-avatar-sm")?.textContent,
    panelClosed: !document.querySelector('[data-testid="exact-avatar-menu"]'),
  }));
  console.log("AVATAR (closed):", JSON.stringify(before, null, 2));
  expect(before.trigger).toBe(true);
  expect(before.avatarMark).toBe("HS");
  expect(before.panelClosed).toBe(true);

  // Click the trigger
  await page.click(".nb-avm-trigger");
  await page.waitForSelector('[data-testid="exact-avatar-menu"]', { timeout: 10_000 });
  await page.waitForTimeout(500);

  const open = await page.evaluate(() => ({
    panel: !!document.querySelector('[data-testid="exact-avatar-menu"]'),
    name: document.querySelector(".nb-avm-name")?.textContent,
    proBadge: document.querySelector(".nb-avm-pro")?.textContent,
    sectionLabels: Array.from(document.querySelectorAll(".nb-avm-section-label")).map((el) => el.textContent),
    pulseTiles: document.querySelectorAll(".nb-avm-pulse").length,
    pulseValues: Array.from(document.querySelectorAll(".nb-avm-pulse-v")).map((el) => el.textContent),
    watchRows: document.querySelectorAll(".nb-avm-watch-row").length,
    usageBars: document.querySelectorAll(".nb-avm-usage").length,
    upgradeBtn: !!document.querySelector(".nb-avm-upgrade"),
    sessionRows: document.querySelectorAll(".nb-avm-session").length,
    thisMarker: !!document.querySelector(".nb-avm-session-this"),
    themeOpts: Array.from(document.querySelectorAll(".nb-avm-theme-opt")).map((el) => el.textContent?.trim()),
    links: Array.from(document.querySelectorAll(".nb-avm-link span:first-of-type")).map((el) => el.textContent),
  }));
  console.log("AVATAR (open):", JSON.stringify(open, null, 2));
  expect(open.panel).toBe(true);
  expect(open.name).toBe("Hannah Sato");
  expect(open.proBadge).toBe("PRO");
  expect(open.sectionLabels).toEqual(
    expect.arrayContaining(["Today's pulse", "Watching · 12 entities", "This month · Pro", "Recent sessions", "Theme"]),
  );
  expect(open.pulseTiles, "3 pulse tiles").toBeGreaterThanOrEqual(3);
  expect(open.pulseValues).toEqual(expect.arrayContaining(["74%", "38", "91%"]));
  expect(open.watchRows, "3 watch rows").toBeGreaterThanOrEqual(3);
  expect(open.usageBars, "3 usage bars").toBeGreaterThanOrEqual(3);
  expect(open.upgradeBtn).toBe(true);
  expect(open.sessionRows, "3 recent sessions").toBeGreaterThanOrEqual(3);
  expect(open.thisMarker).toBe(true);
  expect(open.themeOpts).toEqual(["Light", "Dark"]);
  expect(open.links).toEqual(expect.arrayContaining(["Settings", "Shortcuts", "Help", "Sign out"]));

  // Esc closes
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const closed = await page.evaluate(() => !document.querySelector('[data-testid="exact-avatar-menu"]'));
  expect(closed, "Esc closes panel").toBe(true);
});

test("PR A10: Tier A live wiring graceful fallback when unauthenticated", async ({ page }) => {
  // Anonymous visitor: entities.listEntities returns []. The wired surfaces
  // (PulseStrip, TodayIntel reports-updated lane, RecentReports, Avatar
  // Watching) MUST fall back to seed data so the demo experience is preserved.
  // This asserts the fallback path doesn't break anything; live-data
  // assertion would need an authenticated session w/ entities (separate suite).
  await navigate(page, "ask");
  const result = await page.evaluate(() => ({
    pulseHero: document.querySelectorAll(".nb-pulse-card").length,
    pulseMini: document.querySelectorAll(".nb-pulse-mini").length,
    todayLanes: document.querySelectorAll(".nb-today-lane").length,
    todayItems: document.querySelectorAll(".nb-today-item").length,
    recent: document.querySelectorAll(".nb-recent-card").length,
    recentTitles: Array.from(document.querySelectorAll(".nb-recent-title")).map(
      (el) => el.textContent,
    ),
  }));
  console.log("LIVE FALLBACK:", JSON.stringify(result, null, 2));
  expect(result.pulseHero).toBeGreaterThanOrEqual(4);
  expect(result.pulseMini).toBeGreaterThanOrEqual(6);
  expect(result.todayLanes).toBeGreaterThanOrEqual(4);
  expect(result.todayItems).toBeGreaterThanOrEqual(6);
  expect(result.recent).toBeGreaterThanOrEqual(3);
  // Anonymous fallback shows seed cards (Orbital / DISCO / Mercor titles)
  expect(result.recentTitles.join("|")).toMatch(/Orbital|DISCO|Mercor/);

  // Open avatar — Watching list should also fall back to seed (Orbital Labs / DISCO / Mira Patel)
  await page.click(".nb-avm-trigger");
  await page.waitForSelector('[data-testid="exact-avatar-menu"]');
  await page.waitForTimeout(500);
  const watching = await page.evaluate(() => ({
    rows: document.querySelectorAll(".nb-avm-watch-row").length,
    label: document.querySelector(".nb-avm-section-label:not([data-skip])")?.textContent,
    names: Array.from(document.querySelectorAll(".nb-avm-watch-name")).map(
      (el) => el.textContent,
    ),
  }));
  console.log("WATCHING:", JSON.stringify(watching, null, 2));
  expect(watching.rows).toBeGreaterThanOrEqual(3);
  // Anonymous: 12 entities default; live: real count. Either is OK.
  expect(watching.names.length).toBeGreaterThanOrEqual(3);
});
