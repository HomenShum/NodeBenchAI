import { expect, test } from "@playwright/test";
import {
  NOTEBOOK_ENTITY_SLUG,
  openEntityLiveNotebook,
  primeSharedProductSession,
  seedNotebookEntity,
} from "./helpers/entityNotebook";

const IGNORE_CONSOLE_PATTERNS = [
  /^\[vite\]/,
  /^%cDownload the React DevTools/,
  /^\[NodeBench Analytics\]/,
];

function isIgnorableConsoleMessage(type: string, text: string) {
  if (type === "debug" || type === "info") {
    return IGNORE_CONSOLE_PATTERNS.some((pattern) => pattern.test(text));
  }
  return false;
}

test.describe("Product shell smoke", () => {
  test("home, reports, and saved entity live routes render without blocking console errors", async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();
    const sharedSessionId = `pw-shell-${Date.now()}`;
    const consoleIssues: string[] = [];

    page.on("console", (msg) => {
      const text = msg.text();
      if (msg.type() === "error" || msg.type() === "warning") {
        consoleIssues.push(`${msg.type()}: ${text}`);
        return;
      }
      if (!isIgnorableConsoleMessage(msg.type(), text)) {
        consoleIssues.push(`${msg.type()}: ${text}`);
      }
    });

    page.on("pageerror", (error) => {
      consoleIssues.push(`pageerror: ${error.message}`);
    });

    await primeSharedProductSession(context, sharedSessionId, {
      entitySlug: NOTEBOOK_ENTITY_SLUG,
      entityViewMode: "classic",
    });

    try {
      await seedNotebookEntity(sharedSessionId, [
        "SoftBank shell smoke notebook",
        "Smoke seed section",
        "Smoke seed body for saved entity route verification.",
        "Smoke wrap-up",
      ]);

      await page.goto("/?surface=home", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: /Get the read before you walk in\./i })).toBeVisible();
      await expect(page.getByTestId("home-async-proof")).toBeVisible();

      await page.goto("/?surface=reports", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();

      await openEntityLiveNotebook(page, NOTEBOOK_ENTITY_SLUG);

      expect(consoleIssues).toEqual([]);
    } finally {
      await context.close().catch(() => undefined);
    }
  });

  // Scenario:  First-time visitor lands on each of the 5 surfaces. Each surface must pass the
  //            current mobile IA / shell contract at a glance:
  //              - Home and Chat stay visually distinct (different H1, different entry control)
  //              - Reports never renders the generic "Company memory" label that was shadowing card titles
  //              - Inbox uses the new push-surface framing and positive empty state copy
  //              - Me renders as "Your context" with the self-model sentence, not as "Settings"
  //            This test is isolated from notebook hydration so surface-copy regressions surface
  //            independently of any seeded-data timing.
  // User:      Unsigned visitor, cold start, default locale
  // Duration:  5 route navigations, no seeded state required
  // Failure modes covered: copy revert, stale route aliases, CTA rewiring to the wrong surfaceId
  test("all 5 surfaces render their State/Target/Transition/Invariant signatures", async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();

    try {
      // Home: actionable first-impression H1 + async background CTA.
      await page.goto("/?surface=home", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: /Get the read before you walk in\./i })).toBeVisible();
      await expect(page.getByRole("button", { name: /run in background/i })).toBeVisible();
      await expect(page.getByTestId("home-first-impression-board")).toBeVisible();
      await expect(page.getByText(/Continues if the phone locks/i)).toBeVisible();

      // Reports — named cards (never "Company memory") + freshness-aware subtitle
      await page.goto("/?surface=reports", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
      await expect(page.getByText(/\d+ reports?/i).first()).toBeVisible();
      // The generic system label must never dominate a card — this is the core identity fix
      await expect(page.getByText(/^company memory$/i)).toHaveCount(0);

      // Chat — visually distinct from Home (different H1 + dedicated composer contract)
      await page.goto("/?surface=chat", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: /^Chat$/i })).toBeVisible();
      await expect(page.getByText(/Every turn keeps the entity context/i)).toBeVisible();
      await expect(page.getByPlaceholder(/Ask, capture, paste/i)).toBeVisible();
      // Regression guard: Chat must not wear Home's eyebrow
      await expect(page.getByText(/^new run$/i)).toHaveCount(0);

      // Inbox: meaningful-change framing and filter tabs.
      await page.goto("/?surface=inbox", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: /^Inbox$/i })).toBeVisible();
      await expect(page.getByText(/only when something meaningful changed/i)).toBeVisible();
      await expect(page.getByRole("button", { name: /^All /i })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Watching /i })).toBeVisible();
      await expect(page.getByText(/what shows up here/i)).toHaveCount(0);
      await expect(page.getByRole("heading", { name: /nothing urgent right now/i })).toHaveCount(0);

      // Me: notebook-first personal context surface, not a generic Settings page.
      await page.goto("/?surface=me", { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { level: 1, name: /^Notebook$/i })).toBeVisible();
      await expect(page.getByText(/Entities you have taught NodeBench to watch/i)).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: /^settings$/i })).toHaveCount(0);
    } finally {
      await context.close().catch(() => undefined);
    }
  });

  test("top navigation active state follows surface navigation", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();

    try {
      await page.goto("/?surface=home", { waitUntil: "networkidle" });
      const nav = page.getByRole("navigation", { name: "Primary product navigation" });
      const homeButton = nav.getByRole("button", { name: "Home", exact: true });
      const reportsButton = nav.getByRole("button", { name: "Reports", exact: true });
      const chatButton = nav.getByRole("button", { name: "Chat", exact: true });
      const inboxButton = nav.getByRole("button", { name: "Inbox", exact: true });
      const meButton = nav.getByRole("button", { name: "Me", exact: true });

      await expect(homeButton).toHaveAttribute("data-active", "true");
      await expect(homeButton).toHaveAttribute("aria-current", "page");

      await reportsButton.click();
      await expect(page).toHaveURL(/surface=reports/);
      await expect(reportsButton).toHaveAttribute("data-active", "true");
      await expect(reportsButton).toHaveAttribute("aria-current", "page");
      await expect(homeButton).toHaveAttribute("data-active", "false");

      await chatButton.click();
      await expect(page).toHaveURL(/surface=chat/);
      await expect(chatButton).toHaveAttribute("data-active", "true");
      await expect(chatButton).toHaveAttribute("aria-current", "page");
      await expect(reportsButton).toHaveAttribute("data-active", "false");

      await inboxButton.click();
      await expect(page).toHaveURL(/surface=inbox/);
      await expect(inboxButton).toHaveAttribute("data-active", "true");
      await expect(inboxButton).toHaveAttribute("aria-current", "page");
      await expect(chatButton).toHaveAttribute("data-active", "false");

      await meButton.click();
      await expect(page).toHaveURL(/surface=me/);
      await expect(meButton).toHaveAttribute("data-active", "true");
      await expect(meButton).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { level: 1, name: /your context/i })).toBeVisible();
      await expect(inboxButton).toHaveAttribute("data-active", "false");
    } finally {
      await context.close().catch(() => undefined);
    }
  });

  test("bare root can navigate directly to Me from the mobile tab bar", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();

    try {
      await page.goto("/", { waitUntil: "networkidle" });
      const nav = page.getByRole("navigation", { name: "Mobile navigation" });
      const meButton = nav.getByRole("button", { name: "Me", exact: true });

      await meButton.click();

      await expect(page).toHaveURL(/surface=me/);
      await expect(meButton).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { level: 1, name: /your context/i })).toBeVisible();
    } finally {
      await context.close().catch(() => undefined);
    }
  });

  test("home composer task mode stays inline and updates its primary action", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();

    try {
      await page.goto("/?surface=home", { waitUntil: "networkidle" });

      const composerRoot = page.locator('[data-nb-composer-root="intake"]').first();
      const taskTab = page.getByRole("tab", { name: "Task", exact: true }).first();

      await taskTab.click();

      await expect(taskTab).toHaveAttribute("data-state", "active");
      await expect(composerRoot).toHaveAttribute("data-nb-composer-mode", "task");
      await expect(composerRoot).toHaveAttribute("data-nb-composer-primary-action", "save_task");
      await expect(composerRoot).toHaveAttribute(
        "data-nb-composer-placeholder",
        "Capture a task, follow-up, or reminder...",
      );
      await expect(page.getByRole("button", { name: "Save task", exact: true }).first()).toBeVisible();
      expect(await page.getByLabel(/ask nodebench assistant/i).isVisible().catch(() => false)).toBe(false);
    } finally {
      await context.close().catch(() => undefined);
    }
  });

  test("chat artifacts tab keeps visible content after switching from a scrolled thread", async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();

    try {
      await page.goto(
        "/?surface=chat&q=What%20is%20SoftBank%20and%20what%20matters%20most%20right%20now%3F&lens=founder",
        { waitUntil: "networkidle" },
      );

      const artifactsTab = page.getByRole("tab", { name: "Artifacts", exact: true });
      await expect(artifactsTab).toBeVisible({ timeout: 60_000 });

      await page.evaluate(() => {
        for (const node of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
          if (node.scrollHeight > node.clientHeight + 20) {
            node.scrollTop = node.scrollHeight;
          }
        }
      });

      await artifactsTab.click();

      const artifactsPanel = page.locator("#chat-detail-panel-artifacts");
      await expect(artifactsPanel).toBeVisible();
      await expect(artifactsPanel).toContainText(/artifacts for this thread/i);
      await expect(artifactsPanel).toContainText(
        /this session|artifacts appear once a thread is running|cannot restore its artifacts here/i,
      );
    } finally {
      await context.close().catch(() => undefined);
    }
  });

  test("chat source and file affordances expose real browser actions", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();

    try {
      await page.goto(
        "/?surface=chat&q=What%20is%20SoftBank%20and%20what%20matters%20most%20right%20now%3F&lens=founder",
        { waitUntil: "networkidle" },
      );

      const attachButton = page.getByRole("button", { name: /attach files/i }).first();
      await expect(attachButton).toBeVisible({ timeout: 60_000 });

      const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 5_000 }),
        attachButton.click(),
      ]);

      expect(fileChooser).toBeTruthy();

      const sourceLink = page.locator("#chat-source-strip a[href]").first();
      await expect(sourceLink).toBeVisible();
      await expect(sourceLink).toHaveAttribute("href", /^https?:\/\//i);
    } finally {
      await context.close().catch(() => undefined);
    }
  });

  test("entity live notebook remains primary reading width on desktop", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
    const sharedSessionId = `pw-notes-width-${Date.now()}`;

    await primeSharedProductSession(context, sharedSessionId, {
      entitySlug: NOTEBOOK_ENTITY_SLUG,
      entityViewMode: "live",
    });

    try {
      await seedNotebookEntity(sharedSessionId, [
        "SoftBank live width notebook",
        "Width verification seed",
        "Width verification body copy so the live notebook renders a realistic reading surface.",
        "Wrap-up width seed",
      ]);

      const page = await context.newPage();
      const { reportRegion, notebook } = await openEntityLiveNotebook(
        page,
        NOTEBOOK_ENTITY_SLUG,
      );

      const [reportBox, notebookBox] = await Promise.all([
        reportRegion.boundingBox(),
        notebook.boundingBox(),
      ]);

      expect(reportBox).not.toBeNull();
      expect(notebookBox).not.toBeNull();

      expect(notebookBox?.width ?? 0).toBeGreaterThan(780);
      expect((notebookBox?.width ?? 0) / (reportBox?.width ?? 1)).toBeGreaterThan(0.7);
    } finally {
      await context.close().catch(() => undefined);
    }
  });
});
