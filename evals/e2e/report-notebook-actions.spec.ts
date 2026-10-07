import { expect, test } from "@playwright/test";

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

test.describe("Web report notebook actions", () => {
  test("propose, review, and accept a notebook action patch into TipTap", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      serviceWorkers: "block",
    });
    const page = await context.newPage();
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

    try {
      await page.goto(`${baseURL}/reports/starter-market/notebook?verify=web-report-actions`, {
        waitUntil: "domcontentloaded",
      });

      await expect(page.getByTestId("report-notebook-detail")).toBeVisible();
      await expect(page.getByText("Executable notebook")).toBeVisible();
      await expect(page.getByText("Propose a safe patch")).toBeVisible();

      await page.getByTestId("notebook-action-context").fill(
        "Met Alex from Orbital Labs. Voice agent eval infra, seed, wants healthcare design partners.",
      );
      await page.getByRole("button", { name: /Organize notes/i }).click();

      const preview = page.getByTestId("notebook-action-patch-preview");
      await expect(preview).toBeVisible();
      await expect(preview).toContainText("Grouped 1 captures into 1 notebook sections.");
      await expect(preview).toContainText("Search memory");

      await page.getByRole("button", { name: /Accept into notebook/i }).click();
      const persistenceStatus = page.getByTestId("notebook-action-persistence-status");
      await expect(persistenceStatus).toBeVisible();
      await expect(persistenceStatus).toContainText("Latest accepted patch inserted into the editor.");
      await expect(persistenceStatus).toContainText(/canonical memory/i);
      await expect(page.getByRole("heading", { name: /Notebook action: Grouped 1 captures/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Orbital Labs" })).toBeVisible();
      await expect(page.getByTestId("report-notebook-editor").getByText(/Voice agent eval infra/i)).toBeVisible();

      expect(consoleIssues).toEqual([]);
    } finally {
      await context.close().catch(() => undefined);
    }
  });
});
