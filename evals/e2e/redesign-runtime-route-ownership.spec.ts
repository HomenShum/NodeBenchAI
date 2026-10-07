import { expect, test } from "@playwright/test";

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:5173";

async function goto(page: import("@playwright/test").Page, path: string) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(1_500);
}

test.describe("runtime route ownership", () => {
  test("current redesign chat owns the Agent Runtime Inspector", async ({ page }) => {
    await goto(page, "/redesign/chat?qa=runtime-ownership");

    const inspector = page.getByTestId("right-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector).toHaveAttribute("data-agent-runtime-surface", "redesign-chat");
    await expect(inspector).toContainText("Progress");
    await expect(inspector).toContainText("Artifacts");

    await page.getByRole("tab", { name: "Trace" }).click();
    await expect(inspector).toContainText("Tool calls");
    await expect(inspector).toContainText("Est. cost");
    await expect(inspector).toContainText("Graph packet");
  });

  test("current redesign reports owns the Report Runtime Inspector", async ({ page }) => {
    await goto(page, "/redesign/reports?qa=runtime-ownership");

    const inspector = page.getByTestId("reports-runtime-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector).toHaveAttribute("data-agent-runtime-surface", "redesign-reports");
    await expect(inspector).toContainText("Report Runtime Inspector");
    await expect(inspector).toContainText("ContextRuntimePacket");
    await expect(inspector).toContainText("Graph context packet");

    const contextRef = await inspector.getAttribute("data-agent-context-ref");
    expect(contextRef, "reports rail should expose a bounded graph context ref").toBeTruthy();
  });

  test("ExactKit cockpit chat remains separate from /redesign/chat", async ({ page }) => {
    await goto(page, "/?surface=chat&qa=runtime-ownership");

    const stream = page.getByTestId("exact-web-chat-stream");
    await expect(stream).toBeVisible();
    await expect(stream).toHaveAttribute("data-chat-live-status", /idle|thinking|ok|error/);
    await expect(page.locator(".nb-stream-header h2")).toContainText("Live Context Runtime");
    await expect(page.locator(".nb-stream-savebar strong")).toContainText("NodeBench live runtime");
  });

  test("ScratchNode event shell remains separate from NodeBench routes", async ({ page }) => {
    await goto(page, "/proto/home-v5.html#demo");

    await expect(page).toHaveTitle(/ScratchNode/);
    await expect(page.locator("body")).toContainText("ScratchNode");
    await expect(page.locator("body")).toContainText("/ask");
  });
});
