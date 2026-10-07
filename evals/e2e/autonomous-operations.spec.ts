import { expect, test } from "@playwright/test";

test.describe("Autonomous operations control tower", () => {
  test("renders the control tower summary without nested button markup errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await page.goto("/agents", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("heading", { name: /AI Assistants/i }).waitFor({ timeout: 30_000 });

    const panel = page.getByRole("heading", { name: /Autonomous Operations/i });
    await expect(panel).toBeVisible();
    await expect(page.getByRole("button", { name: /Run Now/i })).toBeVisible();
    await expect(page.getByText("System Health")).toBeVisible();
    await expect(page.getByText("Active Alerts")).toBeVisible();
    await expect(page.getByText("Self-Healing")).toBeVisible();
    await expect(page.getByText("Latest Maintenance")).toBeVisible();

    expect(
      consoleErrors.filter((entry) => /cannot be a descendant of|nested <button>|cannot contain a nested/i.test(entry)),
      `Unexpected nested-button console errors:\n${consoleErrors.join("\n")}`,
    ).toHaveLength(0);
  });

  test("expands and collapses the control tower details", async ({ page }) => {
    await page.goto("/agents", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("heading", { name: /AI Assistants/i }).waitFor({ timeout: 30_000 });

    const toggle = page.getByRole("button", { name: /Autonomous Operations/i }).first();
    const details = page.locator("#autonomous-operations-panel");

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(details).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(details).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(details).toBeVisible();
  });
});
