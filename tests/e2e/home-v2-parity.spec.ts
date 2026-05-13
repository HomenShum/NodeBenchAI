import { expect, type Locator, type Page, test } from "@playwright/test";

const DESKTOP = { width: 1440, height: 1000 };
const NARROW_DESKTOP = { width: 1180, height: 900 };

function rightRail(page: Page): Locator {
  return page
    .locator(
      [
        '[data-testid="home-v2-right-rail"]',
        '[data-testid="redesign-right-rail"]',
        '[data-testid="utility-inspector"]',
        '[data-testid="right-inspector"]',
        'aside[aria-label*="Right rail"]',
        'aside[aria-label*="right rail"]',
        'aside[aria-label*="Inspector"]',
        'aside[aria-label*="inspector"]',
        "aside.rd-pane--right",
      ].join(", "),
    )
    .first();
}

function reportCards(page: Page): Locator {
  return page.locator(
    [
      '[data-testid="report-card"]',
      '[data-testid="redesign-report-card"]',
      "[data-report-card]",
      ".rd-report-card",
    ].join(", "),
  );
}

async function normalizedText(locator: Locator): Promise<string> {
  return (await locator.innerText()).replace(/\s+/g, " ").trim();
}

async function reportTitle(card: Locator): Promise<string> {
  const title = card
    .locator('[data-report-title], .rd-report-card__entity, [role="heading"], h2, h3')
    .first();
  const titleText = (await title.textContent().catch(() => null))?.trim();
  if (titleText) return titleText;
  return (await normalizedText(card)).split(/\s{2,}|\n/)[0].trim();
}

async function selectReport(card: Locator): Promise<void> {
  const bodyTarget = card.locator(".rd-report-card__entity, [data-report-title], h2, h3").first();
  if ((await bodyTarget.count()) > 0) {
    await bodyTarget.click();
  } else {
    await card.click();
  }
}

async function expectRailInViewport(rail: Locator, minWidth = 280): Promise<void> {
  await expect(rail).toBeVisible({ timeout: 10_000 });
  const box = await rail.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });

  expect(box.width, "right rail keeps a usable desktop width").toBeGreaterThanOrEqual(minWidth);
  expect(box.height, "right rail has visible vertical real estate").toBeGreaterThan(240);
  expect(box.left, "right rail starts inside the viewport").toBeLessThan(box.viewportWidth);
  expect(box.right, "right rail stays inside the viewport").toBeLessThanOrEqual(box.viewportWidth + 1);
  expect(box.top, "right rail is not pushed below the fold").toBeLessThan(box.viewportHeight);
  expect(box.bottom, "right rail intersects the visible viewport").toBeGreaterThan(0);
}

test.describe("Home v2 /redesign parity", () => {
  test("desktop Home renders the live home-v2 layout", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/redesign", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("complementary", { name: "Edition browser" })).toBeVisible();
    await expect(page.getByTestId("home-v2-pulse-landing")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your agent already did the first pass." })).toBeVisible();
    await expect(page.getByText("What the agent did").first()).toBeVisible();
    await expect(page.getByText("Who reads this").first()).toBeVisible();
    await expect(page.getByText("Agent handoff").first()).toBeVisible();
    await expect(page.getByText("Memory first").first()).toBeVisible();
    await expect(page.getByText("Report matching").first()).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Briefing agent" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Find a person, company, or action" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
    await expect(page.getByText("Public inbox tracker demo")).toHaveCount(0);
    await expect(page.getByText(/Live edition/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Career ops")).toHaveCount(0);
    await expect(page.getByText("One queue. One decision at a time.")).toHaveCount(0);
    await expect(page.getByText(/static UI kit/i)).toHaveCount(0);
    await expect(page.getByTestId("home-v2-daily-brief-content")).toBeVisible();
    await expect(page.getByTestId("home-v2-brief-section")).toHaveCount(6);
    await expect(page.getByText("Reports touched").first()).toBeVisible();
    await expect(page.getByText("Sources used").first()).toBeVisible();
    await expect(page.getByText("Actions created").first()).toBeVisible();

    const pulseText = await page.getByTestId("home-v2-pulse-landing").innerText();
    expect(pulseText).not.toMatch(/r\/technology|random headline/i);

    const primaryAction = page.getByRole("button", { name: "Ask the agent" });
    await expect(primaryAction).toBeVisible();
    await expect
      .poll(async () => await primaryAction.evaluate((node) => getComputedStyle(node).backgroundColor))
      .not.toBe("rgb(255, 255, 255)");
  });

  test("desktop Reports selection updates the right rail", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/redesign/reports", { waitUntil: "domcontentloaded" });

    const rail = rightRail(page);
    await expectRailInViewport(rail);

    const cards = reportCards(page);
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => await cards.count()).toBeGreaterThanOrEqual(2);

    const firstCard = cards.first();
    const secondCard = cards.nth(1);
    const firstTitle = await reportTitle(firstCard);
    const secondTitle = await reportTitle(secondCard);

    await selectReport(firstCard);
    await expect.poll(async () => await normalizedText(rail)).toContain(firstTitle);
    const firstRailText = await normalizedText(rail);

    await selectReport(secondCard);
    await expect.poll(async () => await normalizedText(rail)).toContain(secondTitle);
    await expect.poll(async () => await normalizedText(rail)).not.toBe(firstRailText);
  });

  test("desktop Chat shows utility inspector tabs", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/redesign/chat", { waitUntil: "domcontentloaded" });

    const rail = rightRail(page);
    await expectRailInViewport(rail);

    const utilityTabs = rail.getByRole("tab");
    await expect.poll(async () => await utilityTabs.count()).toBeGreaterThanOrEqual(4);
    for (const label of ["Entity", "Graph", "Sources", "Threads"]) {
      await expect(rail.getByRole("tab", { name: new RegExp(`^${label}$`, "i") })).toBeVisible();
    }
  });

  test("desktop Chat blocks paid live research for guests without fabricating an answer", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/redesign/chat?q=what%20changed%20today", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("what changed today").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("The UI is not inserting a showcase answer for this turn.")).toHaveCount(0);
    await expect(page.locator("[data-chat-run-id]")).toHaveCount(0);
    await expect(page.getByText(/Live chat is not running/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Sign in with an email-backed account/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/will not fabricate a showcase answer/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("desktop right rail remains visible at the narrow desktop breakpoint", async ({ page }) => {
    await page.setViewportSize(NARROW_DESKTOP);
    await page.goto("/redesign/chat", { waitUntil: "domcontentloaded" });

    await expect(page.locator("[data-redesign] .rd-shell")).toBeVisible({ timeout: 10_000 });
    await expectRailInViewport(rightRail(page), 260);
  });

  test("desktop Me keeps its notebook width instead of adding the global agent rail", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/redesign/me", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "This is what NodeBench remembers about you." })).toBeVisible();
    await expect(page.locator("aside.rd-pane--right")).toHaveCount(0);
  });

  test("live and prototype routes avoid horizontal overflow at tablet and mobile widths", async ({ page }) => {
    test.setTimeout(90_000);

    const paths = [
      "/redesign",
      "/redesign/reports",
      "/redesign/chat",
      "/redesign/inbox",
      "/redesign/me",
      "/redesign?qa=home-v2-implementation",
      "/redesign/reports?qa=home-v2-implementation",
      "/redesign/chat?qa=home-v2-implementation",
      "/redesign/inbox?qa=home-v2-implementation",
      "/redesign/me?qa=home-v2-implementation",
    ];
    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const path of paths) {
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await expect(page.locator("[data-redesign]").first()).toBeVisible({ timeout: 10_000 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${path} overflow at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

test.describe("Home v2 prototype kit mode", () => {
  const qa = "qa=home-v2-implementation";

  test("renders the UI kit chrome across every surface", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });

    const cases = [
      {
        path: `/redesign?${qa}`,
        nav: "Home",
        center: "One queue. One decision at a time.",
        rail: "Briefing agent",
      },
      {
        path: `/redesign/reports?${qa}`,
        nav: "Reports",
        center: "Entity intelligence",
        rail: "Coverage agent",
      },
      {
        path: `/redesign/chat?${qa}`,
        nav: "Chat",
        center: "Sequoia ratchet analysis",
        rail: "Context",
      },
      {
        path: `/redesign/inbox?${qa}`,
        nav: "Inbox",
        center: "Requires action",
        rail: "Triage agent",
      },
      {
        path: `/redesign/me?${qa}`,
        nav: "Me",
        center: "USER.md",
        rail: "Settings agent",
      },
    ] as const;

    for (const item of cases) {
      await page.goto(item.path, { waitUntil: "domcontentloaded" });

      await expect(page.getByRole("button", { name: "NodeBench home" })).toBeVisible();
      await expect(page.getByRole("button", { name: item.nav, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.getByText(item.center).first()).toBeVisible();
      await expect(page.getByRole("complementary", { name: item.rail })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
    }
  });

  test("prototype mode preserves route navigation between surfaces", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/redesign?${qa}`, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: "Reports" }).click();
    await expect(page).toHaveURL(/\/redesign\/reports\?qa=home-v2-implementation$/);
    await expect(page.getByText("Entity intelligence").first()).toBeVisible();

    await page.getByRole("button", { name: "Chat" }).click();
    await expect(page).toHaveURL(/\/redesign\/chat\?qa=home-v2-implementation$/);
    await expect(page.getByText("Saved to Sequoia Capital").first()).toBeVisible();
  });

  test("prototype Reports selection updates the coverage rail", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/redesign/reports?${qa}`, { waitUntil: "domcontentloaded" });

    await page.getByText("Sequoia Capital").first().click();
    await expect(page.getByRole("complementary", { name: "Coverage agent" })).toContainText("Sequoia Capital");
    await expect(page.getByRole("complementary", { name: "Coverage agent" })).toContainText("Score 74");
    await expect(page.getByRole("complementary", { name: "Coverage agent" })).toContainText("Full-ratchet anti-dilution clause added");

    await page.getByRole("button", { name: /OpenAI 62/i }).click();
    await expect(page.getByRole("complementary", { name: "Coverage agent" })).toContainText("OpenAI");
    await expect(page.getByRole("complementary", { name: "Coverage agent" })).toContainText("Score 62");
  });

  test("prototype Chat includes answer packet details and interactive utility tabs", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/redesign/chat?${qa}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Evidence").first()).toBeVisible();
    await expect(page.getByText("Draft counterproposal").first()).toBeVisible();
    await expect(page.getByText("Attach").first()).toBeVisible();

    await page.getByRole("tab", { name: "Graph" }).click();
    await expect(page.getByRole("complementary", { name: "Context" })).toContainText("Graph neighborhood");
    await page.getByRole("tab", { name: "Sources" }).click();
    await expect(page.getByRole("complementary", { name: "Context" })).toContainText("Cooley primer");
  });

  test("prototype Inbox and Me include the deep parity affordances", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.goto(`/redesign/inbox?${qa}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Show 38 more items")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Triage agent" })).toContainText("P0");
    await expect(page.getByRole("complementary", { name: "Triage agent" })).toContainText("Draft reply");

    await page.goto(`/redesign/me?${qa}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("GitHub").first()).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Settings agent" })).toContainText("Execute trades");
    await expect(page.getByRole("complementary", { name: "Settings agent" })).toContainText("Review memory update");
  });

  test("prototype QA mode bypasses the legacy mobile shell", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/redesign/reports?${qa}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Entity intelligence").first()).toBeVisible();
    await expect(page.getByText("Enterprise tier repriced").first()).toBeVisible();
    await expect(page.getByText("No reports yet")).toHaveCount(0);
  });
});
