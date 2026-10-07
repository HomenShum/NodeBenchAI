import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HOME_V5_HTML = readFileSync(resolve("public/proto/home-v5.html"), "utf8");

async function fulfillHomeV5(page: import("@playwright/test").Page) {
  await page.route("https://scratchnode.live/**", async (route) => {
    if (route.request().resourceType() === "document") {
      await route.fulfill({ status: 200, contentType: "text/html", body: HOME_V5_HTML });
      return;
    }
    if (route.request().url().includes("/api/scratchnode-config")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ convexUrl: "https://example.convex.cloud" }),
      });
      return;
    }
    await route.fallback();
  });
}

async function getDemoState(page: import("@playwright/test").Page) {
  return await page.evaluate(() => ({
    pageMode: document.body.getAttribute("data-page-mode"),
    live: document.body.getAttribute("data-sn-live"),
    fullDemoAllowed: (window as any).shouldRunScratchNodeFullDemo?.(),
    legacyDemoAllowed: (window as any).shouldRunScratchNodeLegacyDemo?.(),
    simPostType: typeof (window as any).simPost,
    demoLogLength: Array.isArray((window as any)._demo_log)
      ? (window as any)._demo_log.length
      : 0,
    feedText: document.querySelector("#feed")?.textContent ?? "",
  }));
}

test.describe("ScratchNode demo route gate", () => {
  test("stale demo query/hash does not arm helpers or autoplay on apex", async ({ page }) => {
    await fulfillHomeV5(page);

    await page.goto("https://scratchnode.live/?demo=1#demo", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof (window as any).runDemoFull === "function");
    await page.waitForTimeout(900);

    expect(await getDemoState(page)).toMatchObject({
      pageMode: "landing",
      fullDemoAllowed: false,
      legacyDemoAllowed: false,
      simPostType: "undefined",
      demoLogLength: 0,
    });
  });

  test("stale demo query/hash does not autoplay on live event routes", async ({ page }) => {
    await fulfillHomeV5(page);

    await page.goto("https://scratchnode.live/e/orbital?demo=1#demo", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(() => typeof (window as any).runDemoFull === "function");
    await page.waitForTimeout(900);

    const state = await getDemoState(page);
    expect(state.pageMode).toBe("event");
    expect(state.fullDemoAllowed).toBe(false);
    expect(state.legacyDemoAllowed).toBe(false);
    expect(state.simPostType).toBe("undefined");
    expect(state.demoLogLength).toBe(0);
    expect(state.feedText).not.toContain("Maya from VoiceLayer");
  });

  test("/demo_ver route is the only full-demo autoplay route", async ({ page }) => {
    await fulfillHomeV5(page);

    await page.goto("https://scratchnode.live/demo_ver1?demoSpeed=instant", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(() => (window as any)._demo_log?.length === 14, {
      timeout: 10_000,
    });

    expect(await getDemoState(page)).toMatchObject({
      pageMode: "demo",
      fullDemoAllowed: true,
      legacyDemoAllowed: false,
      simPostType: "function",
      demoLogLength: 14,
    });
  });

  test("/demo_ver route can be loaded without autoplay", async ({ page }) => {
    await fulfillHomeV5(page);

    await page.goto("https://scratchnode.live/demo_ver1?demo=0", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(() => typeof (window as any).runDemoFull === "function");
    await page.waitForTimeout(900);

    expect(await getDemoState(page)).toMatchObject({
      pageMode: "demo",
      fullDemoAllowed: false,
      legacyDemoAllowed: false,
      simPostType: "function",
      demoLogLength: 0,
    });
  });
});
