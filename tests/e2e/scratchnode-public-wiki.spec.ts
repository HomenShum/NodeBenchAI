import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HOME_V5_HTML = readFileSync(resolve("public/proto/home-v5.html"), "utf8");

const WIKI = {
  eventName: "Rooftop Launch Party",
  eventSlug: "rooftop-launch",
  roomCode: "ROOFTOP",
  eventStatus: "ended",
  title: "Rooftop Launch Party Wiki",
  bodyHtml:
    "<h1>Rooftop Launch Party</h1><p>PUBLIC_RECAP_BODY — what happened tonight.</p><ul><li>Demo shipped</li></ul>",
  version: 2,
  publishedAt: 1770000000000,
};

async function mount(page: import("@playwright/test").Page, opts: { configStatus?: number } = {}) {
  await page.route("https://scratchnode.live/api/scratchnode-config", async (route) => {
    if (opts.configStatus && opts.configStatus >= 400) {
      await route.fulfill({ status: opts.configStatus, body: "config unavailable" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ convexUrl: "https://example.convex.cloud" }),
    });
  });

  await page.route("https://esm.sh/convex@1.29.0/browser", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `
        export class ConvexClient {
          constructor(url) { window.__snMockClientUrl = url; }
          close() {}
          mutation() { return Promise.resolve({}); }
          query(name, args) {
            if (name === 'events:getPublishedWikiBySlug') {
              return Promise.resolve(window.__snWikiBySlug === undefined ? null : window.__snWikiBySlug);
            }
            return Promise.resolve(null);
          }
          action() { return Promise.resolve(null); }
          onUpdate(name, args, cb) {
            if (name === 'events:getPublishedWikiBySlug') {
              setTimeout(() => cb(window.__snWikiBySlug === undefined ? null : window.__snWikiBySlug), 0);
            }
            return () => {};
          }
        }
      `,
    });
  });

  await page.route("https://scratchnode.live/**", async (route) => {
    if (route.request().resourceType() === "document") {
      await route.fulfill({ status: 200, contentType: "text/html", body: HOME_V5_HTML });
      return;
    }
    await route.fallback();
  });
}

test.describe("ScratchNode public /wiki/<slug> reader", () => {
  test("a no-account visitor reads a published wiki, with a reverse-viral CTA", async ({
    page,
  }) => {
    await mount(page);
    await page.addInitScript((wiki) => {
      (window as any).__snWikiBySlug = wiki;
    }, WIKI);

    await page.goto("https://scratchnode.live/wiki/rooftop-launch", { waitUntil: "domcontentloaded" });

    // Wiki page-mode: the room shell is hidden, the wiki reader is shown.
    await expect(page.locator("body")).toHaveAttribute("data-page-mode", "wiki");
    await expect(page.locator("#sn-wiki")).toBeVisible();
    // HONESTY: a read-only artifact never claims the room is live.
    await expect(page.locator("body")).not.toHaveAttribute("data-sn-live", "true");

    // The published content renders (server-built, public-safe bodyHtml).
    await expect(page.locator(".sn-wiki__title")).toHaveText("Rooftop Launch Party Wiki", {
      timeout: 6_000,
    });
    await expect(page.locator("#sn-wiki-article")).toContainText("PUBLIC_RECAP_BODY");
    await expect(page.locator(".sn-wiki__meta")).toContainText("ROOFTOP");
    await expect(page.locator(".sn-wiki__kicker")).toContainText("v2");

    // Reverse-viral: a reader can spin up their own room.
    const createCta = page.locator('.sn-wiki__foot a.sn-wiki__cta', { hasText: "Create your own room" });
    await expect(createCta).toHaveAttribute("href", "/");

    const nodeBenchCta = page.locator("#sn-wiki-nb");
    await expect(nodeBenchCta).toHaveAttribute(
      "href",
      "https://nodebenchai.com/events/rooftop-launch/wiki?source=scratchnode&room=ROOFTOP",
    );
    const nodeBenchHref = await nodeBenchCta.getAttribute("href");
    expect(nodeBenchHref).not.toContain("token=");
    expect(nodeBenchHref).not.toContain("session=");
    expect(nodeBenchHref).not.toContain("continuation=");
    expect(nodeBenchHref).not.toContain("publicArtifact=");
    expect(nodeBenchHref).not.toContain("noteCount=");

    // The room shell must be hidden in wiki mode.
    await expect(page.locator("main.m")).toBeHidden();

    await page.locator("#sn-wiki").screenshot({ path: "test-results/wiki-desktop.png" });
    await page.setViewportSize({ width: 375, height: 800 });
    await page.locator("#sn-wiki").screenshot({ path: "test-results/wiki-mobile.png" });
  });

  test("an unpublished room shows an honest empty state (never a fabricated wiki)", async ({ page }) => {
    await mount(page);
    await page.addInitScript(() => {
      (window as any).__snWikiBySlug = null;
    });

    await page.goto("https://scratchnode.live/wiki/not-published-yet", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-page-mode", "wiki");
    await expect(page.locator("#sn-wiki-main")).toContainText("hasn’t published its wiki yet", {
      timeout: 6_000,
    });
    // No fabricated article body.
    await expect(page.locator("#sn-wiki-article")).toHaveCount(0);
    // Still offers the reverse-viral path.
    await expect(page.locator("#sn-wiki-main a.sn-wiki__cta")).toContainText("Create your own room");
  });

  test("a backend-config failure shows an honest error state, not a blank or fake wiki", async ({
    page,
  }) => {
    await mount(page, { configStatus: 500 });

    await page.goto("https://scratchnode.live/wiki/rooftop-launch", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-page-mode", "wiki");
    await expect(page.locator("#sn-wiki-main")).toContainText("Couldn't load this wiki", {
      timeout: 6_000,
    });
  });
});
