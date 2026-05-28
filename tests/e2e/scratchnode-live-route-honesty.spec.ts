import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HOME_V5_HTML = readFileSync(resolve("public/proto/home-v5.html"), "utf8");

async function fulfillScratchNodePage(
  page: import("@playwright/test").Page,
  options: {
    configStatus?: number;
    joinMode?: "ok" | "not-found";
  } = {},
) {
  await page.route("https://scratchnode.live/api/scratchnode-config", async (route) => {
    if (options.configStatus && options.configStatus >= 400) {
      await route.fulfill({ status: options.configStatus, body: "config unavailable" });
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
          constructor(url) {
            window.__snMockClientUrl = url;
            window.__snMockMutations = [];
          }
          close() { window.__snMockClosed = true; }
          mutation(name, args) {
            window.__snMockMutations.push({ name, args });
            if (name === 'events:joinEvent') {
              if (window.__snJoinMode === 'not-found') {
                const err = new Error('event_not_found');
                err.data = { code: 'event_not_found' };
                return Promise.reject(err);
              }
              return Promise.resolve({
                eventId: 'liveEvents:1',
                slug: 'ai-infra-summit-2026',
                name: 'AI Infra Summit',
                roomCode: 'ORBITAL',
                status: 'live'
              });
            }
            if (name === 'events:sendMessage') {
              if (window.__snSendMode === 'fail') {
                const err = new Error('network_down');
                err.data = { code: 'network_down' };
                return Promise.reject(err);
              }
              return Promise.resolve({ messageId: 'liveEventMessages:1' });
            }
            if (name === 'events:createEvent') {
              window.__snCreatedEventArgs = args;
              localStorage.setItem('__snCreatedEventArgs', JSON.stringify(args));
              return Promise.resolve({
                ok: true,
                eventId: 'liveEvents:new',
                slug: 'launch-room',
                name: args.title,
                roomCode: args.roomCode || 'LAUNCH',
                status: 'live',
                ownerKey: 'hk1:liveEvents:new:nonce:1770000000000:abcdefabcdefabcdefabcdefabcdef12',
              });
            }
            return Promise.resolve({});
          }
          query(name) {
            if (name === 'events:getMyEvents') return Promise.resolve({ joined: [], hosted: [] });
            if (name === 'events:getPublishedWiki') return Promise.resolve(null);
            if (name === 'events:getHostStatus') return Promise.resolve({ isHost: false });
            return Promise.resolve([]);
          }
          action() { return Promise.resolve(null); }
          onUpdate(name, _args, cb) {
            if (name === 'events:getMembers') {
              setTimeout(() => cb([{ displayName: 'Mock Host' }, { displayName: 'Mock Guest' }]), 0);
            }
          }
        }
      `,
    });
  });

  await page.addInitScript((joinMode) => {
    (window as any).__snJoinMode = joinMode;
  }, options.joinMode ?? "ok");

  await page.route("https://scratchnode.live/**", async (route) => {
    if (route.request().resourceType() === "document") {
      await route.fulfill({ status: 200, contentType: "text/html", body: HOME_V5_HTML });
      return;
    }
    await route.fallback();
  });
}

test.describe("ScratchNode live route honesty", () => {
  test("event routes do not show mock chat when config is unavailable", async ({ page }) => {
    await fulfillScratchNodePage(page, { configStatus: 500 });

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });

    await expect(page.locator('[data-sn-live-error="true"]')).toContainText(
      "Could not load live room config",
    );
    await expect(page.locator("#ci")).toBeDisabled();
    await expect(page.locator(".row, .ans")).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveAttribute("data-sn-live", "true");
  });

  test("missing event/room code shows an alert instead of static mock chat", async ({ page }) => {
    await fulfillScratchNodePage(page, { joinMode: "not-found" });

    await page.goto("https://scratchnode.live/e/zzz-fake", { waitUntil: "domcontentloaded" });

    await expect(page.locator('[data-sn-live-error="true"]')).toContainText(
      "No room matches /e/zzz-fake",
    );
    await expect(page.locator("#ci")).toBeDisabled();
    await expect(page.locator(".row, .ans")).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveAttribute("data-sn-live", "true");
  });

  test("successful room-code join uses Convex and public send failures do not append local rows", async ({
    page,
  }) => {
    await fulfillScratchNodePage(page);

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    const joinCall = await page.evaluate(() =>
      (window as any).__snMockMutations.find((call: any) => call.name === "events:joinEvent"),
    );
    expect(joinCall.args.slug).toBe("orbital");

    await page.evaluate(() => {
      (window as any).__snSendMode = "fail";
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = "this must not be local-only";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (window as any).sendComposerMessage();
    });

    await expect
      .poll(() => page.locator(".row-text", { hasText: "this must not be local-only" }).count(), {
        timeout: 5_000,
      })
      .toBe(0);
    await expect(page.locator("#ci")).toHaveValue("this must not be local-only");
  });

  test("live wiki and people sheets do not show stale static launch counts", async ({ page }) => {
    await fulfillScratchNodePage(page);

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    await page.evaluate(() => (window as any).openWiki());
    await expect(page.locator("#sheet-title")).toContainText("AI Infra Summit");
    await expect(page.locator("#sheet-content")).toContainText("Wiki not published yet");
    await expect(page.locator("#sheet-content")).not.toContainText("318 attendees");
    await page.evaluate(() => (window as any).closeSheet());

    await page.evaluate(() => (window as any).openPeople());
    await expect(page.locator("#sheet-title")).toContainText("People in the room");
    await expect(page.locator("#sheet-content")).toContainText("Mock Host");
    await expect(page.locator("#sheet-content")).not.toContainText("318 joined");
  });

  test("host create event uses live mutation and navigates to the created room", async ({ page }) => {
    await fulfillScratchNodePage(page);

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    await page.evaluate(() => (window as any).openSheet("host"));
    await expect(page.locator("#sheet-title")).toContainText("Host console");
    await expect(page.locator("#sn-create-event-btn")).toBeEnabled();
    await page.fill("#sheet-host-title", "Launch Room");
    await page.fill("#sheet-host-room-code", "LAUNCH");
    await page.fill("#sheet-host-agenda", "Public starter source for launch.");
    await page.click("#sn-create-event-btn");

    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("__snCreatedEventArgs") || "{}")), { timeout: 5_000 })
      .toMatchObject({
        title: "Launch Room",
        roomCode: "LAUNCH",
        agendaText: "Public starter source for launch.",
        status: "live",
      });
    await expect.poll(() => page.url(), { timeout: 5_000 }).toContain("/e/launch-room");
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("sn_host_owner_key_v2")))
      .toContain("hk1:");
  });
});
