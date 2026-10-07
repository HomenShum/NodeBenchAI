import { expect, test, type Page } from "@playwright/test";

async function expectOneRuntimeState(
  root: ReturnType<Page["locator"]>,
  selectors: string[],
  message: string,
) {
  const stateCount = await root.evaluate((node, candidates) =>
    candidates.reduce(
      (count, selector) => count + Number(Boolean(node.querySelector(selector))),
      0,
    ), selectors);

  expect(stateCount, message).toBe(1);
}

async function expectDesktopSurface(page: Page, surface: string) {
  if (surface === "home") {
    const home = page.getByTestId("home-v3-chat-first-frontpage");
    await expect(home).toBeVisible();
    await expect(
      home.getByRole("heading", {
        name: "Ask once. Turn it into reusable intelligence.",
      }),
    ).toBeVisible();
    await expect(
      home.getByPlaceholder(
        "Ask about a company, person, event, market, report, or source packet...",
      ),
    ).toBeVisible();
    return;
  }

  if (surface === "reports") {
    const reports = page.locator(".rd-v3-reports");
    await expect(reports).toBeVisible();
    await expect(reports.getByRole("heading", { level: 1 })).toBeVisible();
    const stateCount = await reports.evaluate((node) => {
      const text = node.textContent ?? "";
      const liveCardCount = node.querySelectorAll(".rd-v3-card").length;
      return Number(text.includes("Checking saved report artifacts.") && liveCardCount === 0) +
        Number(text.includes("No live coverage returned") || text.includes("No reports yet.")) +
        Number(liveCardCount > 0);
    });
    expect(stateCount, "Reports exposes exactly one loading, empty, or live runtime state").toBe(1);
    await expect(reports).not.toContainText(/Orbital Labs|DISCO|Mercor/i);
    return;
  }

  if (surface === "chat") {
    const chat = page.locator(".rd-chat-scroll-area");
    await expect(chat).toBeVisible();
    await expect(page.getByPlaceholder(
      "Ask anything · type / for commands · @ to mention an entity",
    )).toBeVisible();
    await expect(chat).not.toContainText("Ship Demo Day");
    return;
  }

  if (surface === "inbox") {
    const inbox = page.getByTestId("exact-web-inbox-surface");
    await expect(inbox).toBeVisible();
    await expect(inbox.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
    await expect(inbox.locator(".nb-inbox-filter button")).toHaveCount(4);
    const stateCount = await inbox.evaluate((node) =>
      Number(Boolean(node.querySelector('[data-testid="inbox-loading"]'))) +
      Number((node.textContent ?? "").includes("No runtime nudges")) +
      Number(node.querySelectorAll(".nb-ibx-row").length > 0));
    expect(stateCount, "Inbox exposes exactly one loading, empty, or live runtime state").toBe(1);
    return;
  }

  const me = page.getByTestId("exact-web-me-surface");
  await expect(me).toBeVisible();
  await expect(me.getByRole("heading", { level: 1, name: "Memory" })).toBeVisible();
  await expectOneRuntimeState(
    me,
    [
      '[data-testid="me-memory-loading"]',
      '[data-testid="me-memory-empty"]',
      ".nb-settings-section",
    ],
    "Me exposes exactly one loading, empty, or live memory state",
  );
  await expect(me).not.toContainText(/Pro plan|Upgrade|usage/i);
}

test.describe("Product shell smoke", () => {
  test("desktop navigation reaches all five canonical runtime surfaces", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto("/?surface=home", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/redesign(?:[?#]|$)/);

    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(nav).toBeVisible();

    const surfaces = [
      { label: "Home", id: "home", path: /\/redesign(?:[?#]|$)/ },
      { label: "Reports", id: "reports", path: /\/redesign\/reports(?:[?#]|$)/ },
      { label: "Chat", id: "chat", path: /\/redesign\/chat(?:[?#]|$)/ },
      { label: "Inbox", id: "inbox", path: /\/redesign\/inbox(?:[?#]|$)/ },
      { label: "Me", id: "me", path: /\/redesign\/me(?:[?#]|$)/ },
    ] as const;

    for (const [index, surface] of surfaces.entries()) {
      const target = nav.getByRole("button", { name: surface.label, exact: true });
      if (index > 0) await target.click();
      await expect(page).toHaveURL(surface.path);
      await expect(target).toHaveAttribute("aria-current", "page");
      await expectDesktopSurface(page, surface.id);
    }
  });

  test("mobile tab bar reaches the five canonical fixture-free surfaces", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const nav = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(nav).toBeVisible();

    const surfaces = [
      { label: "Home", id: "home", child: "exact-web-home-surface" },
      { label: "Reports", id: "reports", child: "reports-performance-root" },
      { label: "Chat", id: "chat", child: "exact-web-chat-stream" },
      { label: "Inbox", id: "inbox", child: "exact-web-inbox-surface" },
      { label: "Me", id: "me", child: "exact-web-me-surface" },
    ] as const;

    for (const [index, surface] of surfaces.entries()) {
      const target = nav.getByRole("button", { name: surface.label, exact: true });
      if (index > 0) await target.click();
      await expect(target).toHaveAttribute("aria-current", "page");
      if (surface.id !== "home") {
        await expect(page).toHaveURL(new RegExp(`surface=${surface.id}`));
      }

      const wrapper = page.getByTestId(`mobile-${surface.id}-surface`);
      await expect(wrapper).toBeVisible();
      await expect(wrapper.getByTestId(surface.child)).toBeVisible();
      await expect(wrapper).not.toContainText(/Orbital Labs|DISCO|Mercor|Ship Demo Day/i);
    }
  });
});
