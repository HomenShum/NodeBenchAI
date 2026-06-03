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
            if (name === 'events:updateEvent') {
              window.__snUpdatedEventArgs = args;
              localStorage.setItem('__snUpdatedEventArgs', JSON.stringify(args));
              return Promise.resolve({
                ok: true,
                eventId: args.eventId,
                slug: 'ai-infra-summit-2026',
                name: args.title,
                roomCode: args.roomCode,
                status: args.status || 'live',
              });
            }
            if (name === 'events:upsertEventSource') {
              window.__snUpsertedSourceArgs = args;
              localStorage.setItem('__snUpsertedSourceArgs', JSON.stringify(args));
              return Promise.resolve({ ok: true, sourceId: 'liveEventSources:qa', created: true });
            }
            if (name === 'events:deleteEventSource') {
              window.__snDeletedSourceArgs = args;
              localStorage.setItem('__snDeletedSourceArgs', JSON.stringify(args));
              return Promise.resolve({ ok: true, sourceId: args.sourceId });
            }
            if (name === 'events:endEvent') {
              window.__snEndedEventArgs = args;
              localStorage.setItem('__snEndedEventArgs', JSON.stringify(args));
              return Promise.resolve({ ok: true, eventId: args.eventId, status: 'ended' });
            }
            if (name === 'events:requestJoinEvent') {
              window.__snRequestJoinArgs = args;
              localStorage.setItem('__snRequestJoinArgs', JSON.stringify(args));
              const mode = window.__snRequestJoinMode || 'pending';
              const terminal = (mode === 'open' || mode === 'already_member' || mode === 'approved');
              return Promise.resolve({
                ok: true,
                status: terminal ? mode : 'pending',
                eventId: 'liveEvents:req',
                slug: args.slug,
                requestId: 'liveEventJoinRequests:1',
              });
            }
            if (name === 'events:publishWiki') {
              window.__snPublishWikiArgs = args;
              return Promise.resolve({ ok: true, wikiId: 'liveEventWikiVersions:1', version: 3 });
            }
            return Promise.resolve({});
          }
          query(name) {
            if (name === 'events:getMyEvents') return Promise.resolve({ joined: [], hosted: [] });
            if (name === 'events:getPublishedWiki') return Promise.resolve(null);
            if (name === 'events:getHostStatus') {
              const token = localStorage.getItem('sn_host_owner_key_v2');
              return Promise.resolve(token ? { isHost: true, role: 'owner', displayName: 'Mock Host' } : { isHost: false });
            }
            return Promise.resolve([]);
          }
          action() { return Promise.resolve(null); }
          onUpdate(name, _args, cb) {
            if (name === 'events:getMembers') {
              setTimeout(() => cb([{ displayName: 'Mock Host' }, { displayName: 'Mock Guest' }]), 0);
            }
            if (name === 'events:getLandingStats') {
              const s = window.__snLandingStats || { roomsCreated: 0, liveNow: 0, activeNow: 0, capped: false };
              setTimeout(() => cb(s), 0);
            }
            if (name === 'events:listPublicRooms') {
              const rooms = window.__snPublicRooms || [];
              setTimeout(() => cb({ rooms, activeWindowMs: 1800000 }), 0);
            }
            if (name === 'events:getMyJoinRequest') {
              const tick = () => {
                const status = window.__snJoinRequestStatus || 'pending';
                cb({
                  eventId: 'liveEvents:req',
                  slug: _args && _args.slug,
                  joinPolicy: 'request',
                  isMember: status === 'approved',
                  status,
                  guestMessage: null,
                });
              };
              setTimeout(tick, 0);
              const iv = setInterval(tick, 50);
              return () => clearInterval(iv);
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

  test("/ask answer Share copies a REAL link (no fake 'Shared' toast)", async ({ page }) => {
    // The old lying handler (toasted "Answer link copied" while copying nothing)
    // must be gone from the shipped file, and the honest helper must exist.
    expect(HOME_V5_HTML).not.toContain("toast('Shared'");
    expect(HOME_V5_HTML).toContain("function _snShareAnswer");

    await fulfillScratchNodePage(page);
    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    // Force the clipboard path and capture what actually gets written — proving the
    // Share button copies a real room link + the question, not a fake success toast.
    const written = await page.evaluate(() => {
      // navigator.share lives on the prototype in Chromium — shadow it with an
      // own undefined property so the helper takes the testable clipboard path.
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
      let captured = "";
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: (t: string) => { captured = t; return Promise.resolve(); } },
        configurable: true,
      });
      (window as any)._snShareAnswer("", "What is the MCP auth timeline?");
      return captured;
    });
    expect(written).toContain("What is the MCP auth timeline?");
    expect(written).toContain("/e/"); // a real room URL, not an empty string
    expect(written).toContain("ScratchNode");
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
    await page.evaluate(() => {
      (document.getElementById("sheet-host-title") as HTMLInputElement).value = "Launch Room";
      (document.getElementById("sheet-host-room-code") as HTMLInputElement).value = "LAUNCH";
      (document.getElementById("sheet-host-agenda") as HTMLTextAreaElement).value = "Public starter source for launch.";
    });
    await expect(page.locator("#sheet-host-room-code")).toHaveValue("LAUNCH");
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

  test("verified host can manage room metadata, public sources, and end session", async ({ page }) => {
    await fulfillScratchNodePage(page);
    page.on("dialog", (dialog) => dialog.accept());
    await page.addInitScript(() => {
      localStorage.setItem("sn_host_owner_key_v2", "hk1:liveEvents:1:nonce:1770000000000:abcdefabcdefabcdefabcdefabcdef12");
    });

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");
    await expect.poll(() => page.evaluate(() => document.body.getAttribute("data-role")), { timeout: 5_000 }).toBe("host");
    await expect.poll(() => page.evaluate(() => (window as any)._sn_live?.hostVerified === true), { timeout: 5_000 }).toBe(true);
    await page.evaluate(() => (window as any).openSheet("host"));

    await expect(page.locator("#sheet-content")).toContainText("Manage this live room");
    await expect(page.locator("#sheet-content")).toContainText("Public source context");
    await page.fill("#sheet-host-update-title", "Launch QA Room");
    await page.fill("#sheet-host-update-room-code", "QA-ROOM");
    await page.click("#sn-update-event-btn");
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("__snUpdatedEventArgs") || "{}")), { timeout: 5_000 })
      .toMatchObject({ title: "Launch QA Room", roomCode: "QA-ROOM" });
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("__snUpdatedEventArgs") || "{}").status ?? null), { timeout: 5_000 })
      .toBeNull();
    await expect(page.locator("#sn-manage-event-output")).toContainText("Saved room QA-ROOM");

    await page.fill("#sheet-host-source-title", "Launch source");
    await page.fill("#sheet-host-source-uri", "doc://launch/source");
    await page.fill("#sheet-host-source-body", "This is public launch source context for the event ask runtime and wiki.");
    await page.click("#sn-save-source-btn");
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("__snUpsertedSourceArgs") || "{}")), { timeout: 5_000 })
      .toMatchObject({
        title: "Launch source",
        uri: "doc://launch/source",
        kind: "doc",
      });
    await expect(page.locator("#sn-source-output")).toContainText("Saved public source");

    await page.click("#sn-delete-source-btn");
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("__snDeletedSourceArgs") || "{}")), { timeout: 5_000 })
      .toMatchObject({ sourceId: "liveEventSources:qa" });
    await expect(page.locator("#sn-source-output")).toContainText("Deleted the last source");

    await page.click("#sn-end-event-btn");
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("__snEndedEventArgs") || "{}")), { timeout: 5_000 })
      .toMatchObject({ eventId: "liveEvents:1" });
    await expect(page.locator("#sn-manage-event-output")).toContainText("Session ended");
    await expect(page.locator("#ev-mode-label")).toContainText("ended");
  });

  test("landing 'Create a room' creates a live room and enters it as host", async ({ page }) => {
    await fulfillScratchNodePage(page);

    await page.goto("https://scratchnode.live/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-page-mode", "landing");
    // Apex must stay honestly "not live" until the host lands in the room.
    await expect(page.locator("body")).not.toHaveAttribute("data-sn-live", "true");
    await expect(page.locator("#landing-create-btn")).toBeVisible();

    await page.fill("#landing-create-name", "Sarah's Birthday");
    await page.fill("#landing-create-code", "BIRTHDAY");
    await page.click("#landing-create-btn");

    await expect
      .poll(
        () => page.evaluate(() => JSON.parse(localStorage.getItem("__snCreatedEventArgs") || "{}")),
        { timeout: 5_000 },
      )
      .toMatchObject({
        title: "Sarah's Birthday",
        roomCode: "BIRTHDAY",
        status: "live",
      });
    // Viral loop: the host lands on the "your event is live, invite now" moment
    // (NOT dropped straight into the room) with a shareable invite card.
    await expect(page.locator("#share-moment")).toHaveAttribute("data-open", "true");
    await expect(page.locator("#invite-card-code")).toHaveText("BIRTHDAY");
    await expect(page.locator("#share-link-input")).toHaveValue(/\/e\/launch-room$/);
    await expect(page.locator("#invite-card-qr")).toHaveAttribute("src", /create-qr-code/);
    // Host token persisted before navigation.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("sn_host_owner_key_v2")), { timeout: 5_000 })
      .toContain("hk1:");
    // Still on the landing — apex stays honestly "not live" until they enter.
    expect(page.url()).toBe("https://scratchnode.live/");
    // "Enter your room →" carries the host into their live room.
    await page.click("#share-enter-btn");
    await expect.poll(() => page.url(), { timeout: 5_000 }).toContain("/e/launch-room");
  });

  test("landing create works with no custom code (auto-generated room code)", async ({ page }) => {
    await fulfillScratchNodePage(page);

    await page.goto("https://scratchnode.live/", { waitUntil: "domcontentloaded" });
    await page.fill("#landing-create-name", "Friday Demo Night");
    await page.click("#landing-create-btn");

    await expect
      .poll(
        () => page.evaluate(() => JSON.parse(localStorage.getItem("__snCreatedEventArgs") || "{}")),
        { timeout: 5_000 },
      )
      .toMatchObject({ title: "Friday Demo Night", status: "live" });
    // roomCode omitted (undefined) so the server auto-generates one.
    const sentRoomCode = await page.evaluate(
      () => JSON.parse(localStorage.getItem("__snCreatedEventArgs") || "{}").roomCode ?? null,
    );
    expect(sentRoomCode).toBeNull();
    // Share moment appears with the auto-generated code; "Enter your room →" navigates.
    await expect(page.locator("#share-moment")).toHaveAttribute("data-open", "true");
    await expect(page.locator("#invite-card-code")).toHaveText("LAUNCH");
    await page.click("#share-enter-btn");
    await expect.poll(() => page.url(), { timeout: 5_000 }).toContain("/e/launch-room");
  });

  test("share moment: copy link + invite text + share buttons are wired", async ({ page }) => {
    // Persona: host who just created a room and wants to invite friends.
    await fulfillScratchNodePage(page);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("https://scratchnode.live/", { waitUntil: "domcontentloaded" });
    await page.fill("#landing-create-name", "Launch Party");
    await page.fill("#landing-create-code", "LAUNCH");
    await page.click("#landing-create-btn");
    await expect(page.locator("#share-moment")).toHaveAttribute("data-open", "true");

    // The reason-to-share copy + the screenshot-worthy invite card. Scoped to
    // #share-moment — the wiki-live recap moment reuses the same classes.
    await expect(page.locator("#share-moment .share-moment__sub")).toContainText("shared memory");
    await expect(page.locator("#share-moment .invite-card__tag")).toContainText("remembers everything");

    // Copy link writes the room URL to the clipboard + flashes confirmation.
    await page.click("#share-link-copy");
    await expect(page.locator("#share-link-copy")).toHaveAttribute("data-copied", "true");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("/e/launch-room");

    // Copy invite text carries the reason to share + the link.
    await page.click("#share-invite-copy");
    const invite = await page.evaluate(() => navigator.clipboard.readText());
    expect(invite).toContain("Launch Party");
    expect(invite).toContain("/e/launch-room");

    // Text + Email deep links carry the invite + URL.
    await expect(page.locator("#share-btn-text")).toHaveAttribute("href", /^sms:.*launch-room/);
    await expect(page.locator("#share-btn-email")).toHaveAttribute("href", /^mailto:.*launch-room/);
  });

  test("landing create can opt a room into public discovery", async ({ page }) => {
    await fulfillScratchNodePage(page);

    await page.goto("https://scratchnode.live/", { waitUntil: "domcontentloaded" });
    await page.fill("#landing-create-name", "Open Demo Office Hours");
    await page.check("#landing-create-public");
    await page.click("#landing-create-btn");

    await expect
      .poll(
        () => page.evaluate(() => JSON.parse(localStorage.getItem("__snCreatedEventArgs") || "{}")),
        { timeout: 5_000 },
      )
      .toMatchObject({
        title: "Open Demo Office Hours",
        status: "live",
        publicDiscoverable: true,
        joinPolicy: "open",
      });
  });

  test("landing create rejects a too-short name without calling the backend", async ({ page }) => {
    await fulfillScratchNodePage(page);

    await page.goto("https://scratchnode.live/", { waitUntil: "domcontentloaded" });
    await page.fill("#landing-create-name", "ab");
    await page.click("#landing-create-btn");

    await expect(page.locator("#landing-create-status")).toContainText("at least 3 characters");
    // No createEvent call should have fired — the page never left the landing.
    await expect(page.locator("body")).toHaveAttribute("data-page-mode", "landing");
    expect(
      await page.evaluate(() => localStorage.getItem("__snCreatedEventArgs")),
    ).toBeNull();
    expect(page.url()).toBe("https://scratchnode.live/");
  });

  test("landing create fails honestly when the backend config is unavailable", async ({ page }) => {
    await fulfillScratchNodePage(page, { configStatus: 500 });

    await page.goto("https://scratchnode.live/", { waitUntil: "domcontentloaded" });
    await page.fill("#landing-create-name", "Conference Sidecar");
    await page.click("#landing-create-btn");

    await expect(page.locator("#landing-create-status")).toHaveAttribute("data-state", "error");
    await expect(page.locator("#landing-create-status")).toContainText("Could not load room config");
    // Honest failure: no navigation, no host token persisted.
    expect(page.url()).toBe("https://scratchnode.live/");
    expect(
      await page.evaluate(() => localStorage.getItem("sn_host_owner_key_v2")),
    ).toBeNull();
    await expect(page.locator("#landing-create-btn")).toBeEnabled();
  });

  test("landing renders discoverable public rooms from real backend data", async ({ page }) => {
    await fulfillScratchNodePage(page);
    await page.addInitScript(() => {
      (window as any).__snLandingStats = { roomsCreated: 12, liveNow: 2, capped: false };
      (window as any).__snPublicRooms = [
        {
          eventId: "liveEvents:open",
          slug: "open-office-hours",
          name: "Open Office Hours",
          roomCode: "OFFICE",
          startedAt: 1770000000000,
          lastActivityAt: 1770000001000,
          activeSessions: 6,
          activeSessionsCapped: false,
          joinPolicy: "open",
        },
      ];
    });

    await page.goto("https://scratchnode.live/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#landing-public")).toHaveAttribute("data-visible", "true", {
      timeout: 6_000,
    });
    await expect(page.locator(".landing-room-title")).toHaveText("Open Office Hours");
    // "● N inside" presence cue (live dot + count), not a bare "active" label.
    await expect(page.locator(".landing-room-meta")).toContainText("6 inside");
    await expect(page.locator(".landing-room-meta")).toContainText("OFFICE");
    await expect(page.locator(".landing-room-meta .dot-inside")).toBeVisible();
    // Open-policy room → one-tap navigate (<a>), no approval needed.
    await expect(page.locator(".landing-room-join")).toHaveText("Join now");
    await expect(page.locator(".landing-room-join")).toHaveAttribute("href", "/e/open-office-hours");
  });

  test("request-policy room files a one-tap join request against the live door backend", async ({ page }) => {
    await fulfillScratchNodePage(page);
    await page.addInitScript(() => {
      (window as any).__snLandingStats = { roomsCreated: 12, liveNow: 2, capped: false };
      (window as any).__snRequestJoinMode = "pending";
      (window as any).__snJoinRequestStatus = "pending";
      (window as any).__snPublicRooms = [
        {
          eventId: "liveEvents:req",
          slug: "rooftop-launch",
          name: "Rooftop Launch Party",
          roomCode: "ROOFTOP",
          startedAt: 1770000000000,
          lastActivityAt: 1770000001000,
          activeSessions: 9,
          activeSessionsCapped: false,
          joinPolicy: "request",
        },
      ];
    });

    await page.goto("https://scratchnode.live/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#landing-public")).toHaveAttribute("data-visible", "true", {
      timeout: 6_000,
    });
    const join = page.locator(".landing-room-join");
    // Request-policy room → a real <button> wired to the backend, not a navigate <a>.
    await expect(join).toHaveText("Request to join");
    await expect(join).toHaveJSProperty("tagName", "BUTTON");

    await join.click();
    // Honest pending state — never a fake entry; the real door request was filed.
    await expect(join).toHaveText("Requested ✓", { timeout: 6_000 });
    await expect(join).toHaveAttribute("data-state", "requested");
    expect(page.url()).toBe("https://scratchnode.live/");
    const reqArgs = await page.evaluate(() => (window as any).__snRequestJoinArgs);
    expect(reqArgs.slug).toBe("rooftop-launch");
    expect(typeof reqArgs.sessionId).toBe("string");
    expect(reqArgs.sessionId.length).toBeGreaterThanOrEqual(8);

    // Host approves → the guest is carried into the room on the SAME sn_session_id,
    // so the joinEvent door gate lets them through.
    await page.evaluate(() => {
      (window as any).__snJoinRequestStatus = "approved";
    });
    await page.waitForURL("https://scratchnode.live/e/rooftop-launch", { timeout: 6_000 });
  });

  test("landing surfaces a live 'big number' room counter from real backend data", async ({ page }) => {
    await fulfillScratchNodePage(page);
    await page.addInitScript(() => {
      (window as any).__snLandingStats = { roomsCreated: 1342, liveNow: 7, activeNow: 18, capped: false };
    });

    await page.goto("https://scratchnode.live/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#landing-pulse")).toBeVisible({ timeout: 6_000 });
    // Every number is the EXACT reactive backend count — never a marketing figure.
    await expect
      .poll(() => page.locator("#landing-pulse-num").textContent(), { timeout: 6_000 })
      .toBe("1,342");
    await expect(page.locator("#landing-pulse-live")).toHaveText("7");
    await expect(page.locator("#landing-pulse-active")).toHaveText("18");
    await expect(page.locator("#landing-pulse-suffix")).toHaveText("");
  });

  test("landing big-number renders a '+' suffix when the scan cap is hit", async ({ page }) => {
    await fulfillScratchNodePage(page);
    await page.addInitScript(() => {
      (window as any).__snLandingStats = { roomsCreated: 5000, liveNow: 23, capped: true };
    });

    await page.goto("https://scratchnode.live/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#landing-pulse")).toBeVisible({ timeout: 6_000 });
    await expect
      .poll(() => page.locator("#landing-pulse-num").textContent(), { timeout: 6_000 })
      .toBe("5,000");
    await expect(page.locator("#landing-pulse-suffix")).toHaveText("+");
  });

  test("landing big-number stays hidden (never fabricated) when zero rooms exist", async ({ page }) => {
    await fulfillScratchNodePage(page);
    await page.addInitScript(() => {
      (window as any).__snLandingStats = { roomsCreated: 0, liveNow: 0, capped: false };
    });

    await page.goto("https://scratchnode.live/", { waitUntil: "domcontentloaded" });
    // Give the reactive subscription time to deliver the zero value, then assert
    // the counter is NOT shown — an empty backend never produces a fake number.
    await page.waitForTimeout(1_500);
    await expect(page.locator("#landing-pulse")).toBeHidden();
    // The landing still works — Join + Create remain available.
    await expect(page.locator("#landing-create-btn")).toBeVisible();
  });

  test("landing counter never shows more 'live' than 'total' during the count-up", async ({ page }) => {
    await fulfillScratchNodePage(page);
    await page.addInitScript(() => {
      // liveNow close to (but <=) total — live rooms are a subset of total, so the
      // displayed live count must never exceed the displayed total at any frame.
      (window as any).__snLandingStats = { roomsCreated: 8, liveNow: 6, activeNow: 40, capped: false };
    });

    await page.goto("https://scratchnode.live/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#landing-pulse")).toBeVisible({ timeout: 6_000 });

    // Sample both numbers repeatedly across the ~750ms count-up. The displayed
    // live count must NEVER exceed the displayed total at any frame.
    const parse = (s: string | null) => parseInt((s || "0").replace(/,/g, ""), 10);
    for (let i = 0; i < 14; i++) {
      const { rooms, live } = await page.evaluate(() => ({
        rooms: document.getElementById("landing-pulse-num")?.textContent ?? "0",
        live: document.getElementById("landing-pulse-live")?.textContent ?? "0",
      }));
      expect(parse(live), `live(${live}) must never exceed total(${rooms})`).toBeLessThanOrEqual(
        parse(rooms),
      );
      await page.waitForTimeout(70);
    }

    // …and it settles on the exact real values.
    await expect.poll(() => page.locator("#landing-pulse-num").textContent()).toBe("8");
    await expect(page.locator("#landing-pulse-live")).toHaveText("6");
    // activeNow is a different unit (sessions) and is allowed to exceed rooms.
    await expect(page.locator("#landing-pulse-active")).toHaveText("40");
  });

  test("publishing the wiki surfaces an end-event recap moment with the public /wiki link", async ({
    page,
  }) => {
    await fulfillScratchNodePage(page);
    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    // Host publishes the wiki (the real success path) — should open the recap
    // moment so they learn the public address, not just a toast.
    await page.evaluate(() => (window as any).snPublishWiki());

    const moment = page.locator("#wiki-live-moment");
    await expect(moment).toHaveAttribute("data-open", "true", { timeout: 6_000 });
    // HONESTY: the moment shows the REAL public /wiki/<slug> URL (never fabricated).
    const link = await page.locator("#wiki-live-input").inputValue();
    expect(link).toMatch(/\/wiki\/[a-z0-9-]+$/i);
    await expect(moment).toContainText("Your wiki is live");
    await expect(moment).toContainText("the room remembers everything");
    // It was a confirmed publish — the backend mutation actually ran.
    const published = await page.evaluate(() => (window as any).__snPublishWikiArgs);
    expect(published).toBeTruthy();

    // The recap is honest about state — the apex/room never falsely flips to a fake value.
    await page.evaluate(() => (window as any)._snWikiMomentClose());
    await expect(moment).toHaveAttribute("data-open", "false");
  });
});
