import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HOME_V5_HTML = readFileSync(resolve("public/proto/home-v5.html"), "utf8");

async function fulfillHomeV5(page: Page) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.hostname === "scratchnode.live" && request.resourceType() === "document") {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: HOME_V5_HTML,
      });
      return;
    }

    if (url.hostname === "scratchnode.live" && url.pathname === "/api/scratchnode-config") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ convexUrl: null, realtime: false }),
      });
      return;
    }

    await route.fulfill({ status: 204, body: "" });
  });
}

async function waitForDemoGate(page: Page) {
  await page.waitForFunction(
    () =>
      typeof (window as any).isScratchNodeDemoRoute === "function" &&
      typeof (window as any).shouldRunScratchNodeFullDemo === "function" &&
      typeof (window as any).shouldRunScratchNodeLegacyDemo === "function" &&
      typeof (window as any).runDemoFull === "function",
    null,
    { timeout: 15_000 },
  );
}

async function readGateState(page: Page) {
  return await page.evaluate(() => ({
    pageMode: document.body.dataset.pageMode,
    live: document.body.dataset.snLive ?? null,
    fullDemo: (window as any).shouldRunScratchNodeFullDemo(),
    legacyDemo: (window as any).shouldRunScratchNodeLegacyDemo(),
    logLength: ((window as any)._demo_log || []).length,
    hasInjectedDemoRows: !!document.querySelector('[data-demo-injected="true"]'),
    hasMayaDemoText: (document.getElementById("feed")?.textContent || "").includes(
      "Maya from VoiceLayer",
    ),
    hasSimPost: typeof (window as any).simPost === "function",
  }));
}

test.describe("ScratchNode demo route gate", () => {
  test("stale demo query/hash does not autoplay on scratchnode.live apex", async ({ page }) => {
    await fulfillHomeV5(page);
    await page.goto("https://scratchnode.live/?demo=1#demo", { waitUntil: "domcontentloaded" });
    await waitForDemoGate(page);
    await page.waitForTimeout(1_000);

    await expect(await readGateState(page)).toMatchObject({
      pageMode: "landing",
      live: null,
      fullDemo: false,
      legacyDemo: false,
      logLength: 0,
      hasInjectedDemoRows: false,
      hasMayaDemoText: false,
    });
  });

  test("stale demo query/hash does not autoplay on live event route", async ({ page }) => {
    await fulfillHomeV5(page);
    await page.goto("https://scratchnode.live/e/ai-infra-summit-2026?demo=1#demo", {
      waitUntil: "domcontentloaded",
    });
    await waitForDemoGate(page);
    await page.waitForTimeout(1_000);

    await expect(await readGateState(page)).toMatchObject({
      pageMode: "event",
      fullDemo: false,
      legacyDemo: false,
      logLength: 0,
      hasInjectedDemoRows: false,
      hasMayaDemoText: false,
      hasSimPost: false,
    });
  });

  test("stale demo query/hash does not autoplay on direct proto path", async ({ page }) => {
    await fulfillHomeV5(page);
    await page.goto("https://scratchnode.live/proto/home-v5.html?demo=1#demo", {
      waitUntil: "domcontentloaded",
    });
    await waitForDemoGate(page);
    await page.waitForTimeout(1_000);

    await expect(await readGateState(page)).toMatchObject({
      pageMode: "landing",
      fullDemo: false,
      legacyDemo: false,
      logLength: 0,
      hasInjectedDemoRows: false,
      hasMayaDemoText: false,
    });
  });

  test("/demo_ver route is the only full-demo autoplay route", async ({ page }) => {
    await fulfillHomeV5(page);
    await page.goto("https://scratchnode.live/demo_ver1?demoSpeed=instant", {
      waitUntil: "domcontentloaded",
    });
    await waitForDemoGate(page);

    await expect
      .poll(() => page.evaluate(() => ((window as any)._demo_log || []).length), {
        timeout: 15_000,
      })
      .toBe(14);

    await expect(await readGateState(page)).toMatchObject({
      pageMode: "demo",
      fullDemo: true,
      legacyDemo: false,
      logLength: 14,
      hasInjectedDemoRows: true,
    });
  });

  test("/demo_ver route can be loaded without autoplay", async ({ page }) => {
    await fulfillHomeV5(page);
    await page.goto("https://scratchnode.live/demo_ver1?demo=0", {
      waitUntil: "domcontentloaded",
    });
    await waitForDemoGate(page);
    await page.waitForTimeout(1_500);

    await expect(await readGateState(page)).toMatchObject({
      pageMode: "demo",
      fullDemo: false,
      legacyDemo: false,
      logLength: 0,
      hasInjectedDemoRows: false,
      hasMayaDemoText: false,
    });
  });
});
