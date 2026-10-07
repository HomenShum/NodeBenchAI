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
            window.__snMockState = window.__snMockState || { messages: [], answers: [], userNotes: [] };
            window.__snMockSubscribers = window.__snMockSubscribers || {};
          }
          close() { window.__snMockClosed = true; }
          _emit(name) {
            const subscribers = window.__snMockSubscribers[name] || [];
            const state = window.__snMockState || { messages: [], answers: [], userNotes: [] };
            const payload =
              name === 'events:getMessages' ? state.messages :
              name === 'events:getAnswers' ? (window.__snAnswers || state.answers) :
              name === 'notes:listMyNotes' ? state.userNotes :
              [];
            for (const cb of subscribers) {
              setTimeout(() => cb(payload), 0);
            }
          }
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
              const messageId = 'liveEventMessages:' + (window.__snMockState.messages.length + 1);
              window.__snMockState.messages.push({
                _id: messageId,
                eventId: args.eventId,
                sessionId: args.sessionId,
                displayName: args.displayName,
                text: args.text,
                kind: args.kind,
                createdAt: 1770000000000 + window.__snMockState.messages.length,
              });
              this._emit('events:getMessages');
              return Promise.resolve({ messageId });
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
            if (name === 'events:publishWiki') {
              window.__snWikiPublished = true;
              window.__snPublishWikiArgs = args;
              localStorage.setItem('__snWikiPublishArgs', JSON.stringify(args));
              return Promise.resolve({ ok: true, version: 1, wikiId: 'liveEventWikiVersions:1' });
            }
            if (name === 'events:suggestAnswerForFaq') {
              window.__snSuggestFaqArgs = args;
              const answer = window.__snMockState.answers.find((row) => row._id === args.answerId);
              if (answer) answer.faqStatus = 'suggested';
              this._emit('events:getAnswers');
              return Promise.resolve({ ok: true, answerId: args.answerId, status: 'suggested' });
            }
            if (name === 'events:promoteAnswerToFaq') {
              window.__snPromoteFaqArgs = args;
              const answer = window.__snMockState.answers.find((row) => row._id === args.answerId);
              if (answer) answer.faqStatus = 'promoted';
              this._emit('events:getAnswers');
              return Promise.resolve({ ok: true, answerId: args.answerId, status: 'promoted' });
            }
            if (name === 'notes:createNote') {
              const noteId = 'userNotes:' + (window.__snMockState.userNotes.length + 1);
              const note = {
                _id: noteId,
                ownerKey: args.ownerKey,
                eventId: args.eventId,
                title: args.title,
                bodyHtml: args.bodyHtml,
                tags: args.tags || [],
                isAsk: !!args.isAsk,
                pinned: !!args.pinned,
                createdAt: 1770000000000 + window.__snMockState.userNotes.length,
                updatedAt: 1770000000000 + window.__snMockState.userNotes.length,
              };
              window.__snMockState.userNotes.push(note);
              this._emit('notes:listMyNotes');
              return Promise.resolve({ ok: true, noteId });
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
            return Promise.resolve({});
          }
          query(name) {
            if (name === 'events:getMyEvents') return Promise.resolve({ joined: [], hosted: [] });
            if (name === 'events:getPublishedWiki') {
              if (!window.__snWikiPublished) return Promise.resolve(null);
              const publicAnswers = (window.__snMockState && window.__snMockState.answers || [])
                .map((answer) => '<section><h2>' + answer.question + '</h2><p>' + answer.body + '</p></section>')
                .join('');
              return Promise.resolve({
                version: 1,
                title: 'AI Infra Summit Wiki',
                bodyHtml: '<h1>AI Infra Summit Wiki</h1><p>Published public memory.</p>' + publicAnswers + '<p>Private notes stay out of the public wiki.</p>',
                sourceAnswerIds: ['liveEventAnswers:share1'],
                sourceIds: ['liveEventSources:1'],
                createdAt: 1770000000000,
                publishedAt: 1770000001000,
              });
            }
            if (name === 'events:getHostStatus') {
              const token = localStorage.getItem('sn_host_owner_key_v2');
              return Promise.resolve(token ? { isHost: true, role: 'owner', displayName: 'Mock Host' } : { isHost: false });
            }
            return Promise.resolve([]);
          }
          action(name, args) {
            if (name === 'events:askAgent') {
              const answerId = 'liveEventAnswers:' + (window.__snMockState.answers.length + 1);
              const answer = {
                _id: answerId,
                eventId: args.eventId,
                questionMessageId: args.questionMessageId,
                question: args.question,
                body: 'Mock sourced answer for: ' + args.question,
                sources: [{ title: 'Public agenda', uri: 'https://example.test/agenda', excerpt: 'public source only' }],
                sourceIds: ['liveEventSources:1'],
                externalSearches: 0,
                estimatedCostCents: 0,
                agentMode: 'deterministic',
                cacheHit: false,
                faqStatus: 'none',
                createdAt: 1770000001000 + window.__snMockState.answers.length,
                trace: [
                  { status: 'ok', step: 'context_resolved', detail: 'public event corpus only' },
                  { status: 'ok', step: 'public_private_boundary', detail: 'private notes excluded from retrieval, cache, and answer' },
                ],
              };
              window.__snMockState.answers.push(answer);
              this._emit('events:getAnswers');
              return Promise.resolve(answer);
            }
            return Promise.resolve(null);
          }
          onUpdate(name, _args, cb) {
            window.__snMockSubscribers[name] = window.__snMockSubscribers[name] || [];
            window.__snMockSubscribers[name].push(cb);
            const unsubscribe = () => {
              const subscribers = window.__snMockSubscribers[name] || [];
              window.__snMockSubscribers[name] = subscribers.filter((entry) => entry !== cb);
            };
            if (name === 'events:getMessages' || name === 'events:getAnswers' || name === 'notes:listMyNotes') {
              this._emit(name);
              return unsubscribe;
            }
            if (name === 'events:getMembers') {
              setTimeout(() => cb([{ displayName: 'Mock Host' }, { displayName: 'Mock Guest' }]), 0);
              return unsubscribe;
            }
            if (name === 'events:getLandingStats') {
              const s = window.__snLandingStats || { roomsCreated: 0, liveNow: 0, activeNow: 0, capped: false };
              setTimeout(() => cb(s), 0);
              return unsubscribe;
            }
            if (name === 'events:listPublicRooms') {
              const rooms = window.__snPublicRooms || [];
              setTimeout(() => cb({ rooms, activeWindowMs: 1800000 }), 0);
              return unsubscribe;
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
              return () => {
                clearInterval(iv);
                unsubscribe();
              };
            }
            return unsubscribe;
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

  test("published wiki exposes a real public wiki URL in the share sheet", async ({ page }) => {
    await fulfillScratchNodePage(page);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      localStorage.setItem(
        "sn_host_owner_key_v2",
        "hk1:liveEvents:1:nonce:1770000000000:abcdefabcdefabcdefabcdefabcdef12",
      );
    });

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");
    await expect
      .poll(() => page.evaluate(() => typeof (window as any).snPublishWiki), { timeout: 5_000 })
      .toBe("function");

    await page.evaluate(() => (window as any).snPublishWiki());
    await expect
      .poll(() => page.evaluate(() => (window as any)._sn_published_wiki_body || ""), {
        timeout: 5_000,
      })
      .toContain("Published public memory");

    await page.evaluate(() => (window as any).openShare());
    await expect(page.locator("#sheet-content")).toContainText("Public wiki is live");
    await expect(page.locator("#sheet-content code").filter({ hasText: "/wiki" })).toContainText(
      "/e/ai-infra-summit-2026/wiki",
    );

    await page.getByRole("button", { name: "Copy wiki" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      "/e/ai-infra-summit-2026/wiki",
    );
  });

  test("answer share copies an addressable answer URL instead of only showing a toast", async ({
    page,
  }) => {
    await fulfillScratchNodePage(page);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      (window as any).__snAnswers = [
        {
          _id: "liveEventAnswers:share1",
          question: "What did we decide?",
          body: "We agreed to ship the public wiki loop.",
          sourceIds: ["liveEventSources:1"],
          sources: [{ title: "Agenda", uri: "doc://agenda", excerpt: "Public agenda source." }],
          createdAt: 1770000000000,
          agentMode: "deterministic",
          cacheHit: false,
        },
      ];
    });

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");
    const answer = page.locator('[data-answer-id="liveEventAnswers:share1"]');
    await expect(answer).toContainText("We agreed to ship the public wiki loop.");

    await answer.getByRole("button", { name: "Share" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      "/e/ai-infra-summit-2026#answer-liveEventAnswers%3Ashare1",
    );
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
    // A verified host is the realistic precondition for publishing (scratchnode/002
    // boundary fix: snPublishWiki now early-returns for non-verified sessions).
    await page.addInitScript(() => {
      localStorage.setItem("sn_host_owner_key_v2", "hk1:liveEvents:1:nonce:1770000000000:abcdefabcdefabcdefabcdefabcdef12");
    });
    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");
    await expect
      .poll(() => page.evaluate(() => (window as any)._sn_live?.hostVerified === true), { timeout: 5_000 })
      .toBe(true);

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

  test("NodeBench handoff CTAs target a SHIPPED route, never the dead /events/<slug>/private (no 404)", async ({
    page,
  }) => {
    await fulfillScratchNodePage(page);
    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    // The handoff URL must point at the EXISTING /scratchnode-events surface, not
    // the route that 404s. Carries event context for the future tokenized route.
    const url = await page.evaluate(() => (window as any).buildNodeBenchEventPrivateUrl());
    expect(url).toContain("nodebenchai.com");
    expect(url).toContain("/scratchnode-events");
    expect(url).not.toMatch(/\/events\/[^/]+\/private/);
    expect(url).toContain("continuation=private-notes");
    expect(url).toContain("publicArtifact=event-wiki");
  });

  test("in-room memory nudge reveals once with the REAL live count and dismisses stickily", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // reveal at 0ms (skip the 4s beat)
    await fulfillScratchNodePage(page);
    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    const nudge = page.locator("#sn-mem-nudge");
    await expect(nudge).toHaveAttribute("data-show", "true", { timeout: 6_000 });
    // HONESTY: the count is the REAL getMembers count (2 mock members), not fabricated.
    await expect(page.locator("#sn-mem-nudge-count")).toHaveText("2");
    await expect(nudge).toContainText("the richer this room");
    await expect(nudge.locator(".sn-mem-nudge__invite")).toBeVisible();

    // Dismiss is sticky (localStorage flag) and hides the nudge.
    await page.click(".sn-mem-nudge__close");
    await expect(nudge).toHaveAttribute("data-show", "false");
    expect(await page.evaluate(() => localStorage.getItem("sn_mem_nudge_off"))).toBe("1");
  });

  test("guest cannot trigger host-only public-write mutations (promoteFaq / publishWiki)", async ({
    page,
  }) => {
    await fulfillScratchNodePage(page);
    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    // Guest session: no sn_host_owner_key_v2 was set, so _sn_live.hostVerified is false.
    // The two PUBLIC-write actions must early-return via _snRequireVerifiedHostOwnerKey,
    // NOT fall back to sessionId (the scratchnode/002 boundary fix). Backend requireHost
    // would also reject, but the frontend must not even attempt the mutation.
    await page.evaluate(() => {
      const w = window as any;
      if (typeof w.snPromoteFaq === "function") w.snPromoteFaq("liveEventAnswers:1");
      if (typeof w.snPublishWiki === "function") w.snPublishWiki();
    });

    const calledMutations = await page.evaluate(() =>
      ((window as any).__snMockMutations || []).map((c: any) => c.name),
    );
    expect(calledMutations).not.toContain("events:promoteAnswerToFaq");
    expect(calledMutations).not.toContain("events:publishWiki");
    await expect(page.locator(".toast")).toContainText("Host verification required");
  });

  test("SN-LIVE-006 public /ask trace excludes private-note text and private refs", async ({
    page,
  }) => {
    // Gate SN-LIVE-006: answer trace has no private-note text and stays public-only.
    await fulfillScratchNodePage(page);
    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    await page.evaluate(() => {
      const w = window as any;
      if (document.body.getAttribute("data-mode") !== "private") w.toggleLock();
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = "private-note-secret";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      w.sendComposerMessage();
      if (document.body.getAttribute("data-mode") === "private") w.toggleLock();
    });
    await expect
      .poll(() => page.evaluate(() => ((window as any).__snMockState.userNotes || []).length), {
        timeout: 5_000,
      })
      .toBeGreaterThan(0);

    await page.fill("#ci", "/ask what changed after the keynote?");
    await page.keyboard.press("Enter");

    const answer = page.locator(".ans").last();
    await expect(answer).toContainText("Mock sourced answer for: what changed after the keynote?");
    await answer.locator(".ans-show").click();
    await expect(answer.locator(".ans-how")).toContainText("private notes excluded");

    const state = await page.evaluate(() => (window as any).__snMockState);
    expect(state.answers).toHaveLength(1);
    expect(JSON.stringify(state.answers[0].trace)).not.toContain("private-note-secret");
    expect(JSON.stringify(state.answers[0])).not.toMatch(/userNotes|private_note/i);
  });

  test("SN-LIVE-007 private send saves to notes, not events:sendMessage or liveEventMessages", async ({
    page,
  }) => {
    // Gate SN-LIVE-007: private send recorded as a private note, not public feed.
    await fulfillScratchNodePage(page);
    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    const result = await page.evaluate(() => {
      const w = window as any;
      const countBefore =
        typeof w.getPrivateNoteHandoffCount === "function"
          ? w.getPrivateNoteHandoffCount()
          : (w._privateNotes_v5 || []).length;
      // Enter private mode, then send a uniquely-identifiable private note.
      if (document.body.getAttribute("data-mode") !== "private") w.toggleLock();
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = "PRIV-secret-latency-budget-xyz";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      w.sendComposerMessage();
      const countAfter =
        typeof w.getPrivateNoteHandoffCount === "function"
          ? w.getPrivateNoteHandoffCount()
          : (w._privateNotes_v5 || []).length;
      return { countBefore, countAfter };
    });

    // SN-LIVE-007: the private text must NEVER reach a public eventMessages write.
    const sentPublicly = await page.evaluate(() =>
      ((window as any).__snMockMutations || []).some(
        (c: any) =>
          c.name === "events:sendMessage" &&
          JSON.stringify(c.args || {}).includes("secret-latency-budget-xyz"),
      ),
    );
    expect(sentPublicly).toBe(false);
    expect(result.countAfter).toBeGreaterThan(result.countBefore);

    const state = await page.evaluate(() => (window as any).__snMockState);
    expect(state.userNotes).toHaveLength(1);
    expect(state.userNotes[0].bodyHtml).toContain("PRIV-secret-latency-budget-xyz");
    expect(state.messages).toHaveLength(0);
    const mutationNames = await page.evaluate(() =>
      ((window as any).__snMockMutations || []).map((call: any) => call.name),
    );
    expect(mutationNames.filter((name: string) => name === "notes:createNote")).toHaveLength(1);
    expect(mutationNames.filter((name: string) => name === "events:sendMessage")).toHaveLength(0);
  });

  test("SN-LIVE-008 private send appears in the notebook mock without leaking to public rows", async ({
    page,
  }) => {
    // Gate SN-LIVE-008: private send is present in userNotes/notebook state.
    await fulfillScratchNodePage(page);
    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    await page.evaluate(() => {
      const w = window as any;
      if (document.body.getAttribute("data-mode") !== "private") w.toggleLock();
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = "Capture the off-record follow-up";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      w.sendComposerMessage();
    });

    await expect
      .poll(() => page.evaluate(() => ((window as any).__snMockState.userNotes || []).length), {
        timeout: 5_000,
      })
      .toBe(1);
    await page.evaluate(() => (window as any).openSheet("notes"));
    await expect(page.locator("#sheet-title")).toContainText("notes");
    await expect(page.locator("#sheet-content")).toContainText("Capture the off-record follow-up");
    await expect(page.locator(".row-text", { hasText: "Capture the off-record follow-up" })).toHaveCount(0);
    const state = await page.evaluate(() => (window as any).__snMockState);
    expect(JSON.stringify(state.messages)).not.toContain("Capture the off-record follow-up");
  });

  test("SN-LIVE-009 attendee sees Suggest for FAQ and records events:suggestAnswerForFaq", async ({
    page,
  }) => {
    // Gate SN-LIVE-009: attendee can suggest a public answer for FAQ review.
    await fulfillScratchNodePage(page);
    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    await page.fill("#ci", "/ask what should we write down?");
    await page.keyboard.press("Enter");

    const answer = page.locator(".ans").last();
    await expect(answer).toContainText("Mock sourced answer for: what should we write down?");
    await expect(answer.locator(".ans-actions .attendee-only")).toBeVisible();
    await expect(answer.locator(".ans-actions .host-only")).toBeHidden();
    await answer.locator(".ans-actions .attendee-only").click();

    const state = await page.evaluate(() => ({
      suggestArgs: (window as any).__snSuggestFaqArgs,
      answers: (window as any).__snMockState.answers,
    }));
    expect(state.suggestArgs.answerId).toBe("liveEventAnswers:1");
    expect(state.answers[0].faqStatus).toBe("suggested");
  });

  test("SN-LIVE-010 host sees Promote to FAQ and records events:promoteAnswerToFaq", async ({
    page,
  }) => {
    // Gate SN-LIVE-010: verified host can promote the answer into the public wiki set.
    await fulfillScratchNodePage(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        "sn_host_owner_key_v2",
        "hk1:liveEvents:1:nonce:1770000000000:abcdefabcdefabcdefabcdefabcdef12",
      );
    });
    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");
    await expect
      .poll(() => page.evaluate(() => (window as any)._sn_live?.hostVerified === true), {
        timeout: 5_000,
      })
      .toBe(true);

    await page.fill("#ci", "/ask which public FAQ survives the event?");
    await page.keyboard.press("Enter");

    const answer = page.locator(".ans").last();
    await expect(answer).toContainText("Mock sourced answer for: which public FAQ survives the event?");
    await expect(answer.locator(".ans-actions .host-only")).toBeVisible();
    await answer.locator(".ans-actions .host-only").click();

    const state = await page.evaluate(() => ({
      promoteArgs: (window as any).__snPromoteFaqArgs,
      answers: (window as any).__snMockState.answers,
    }));
    expect(state.promoteArgs.answerId).toBe("liveEventAnswers:1");
    expect(state.answers[0].faqStatus).toBe("promoted");
  });

  test("SN-LIVE-012 published wiki excludes private-note text", async ({
    page,
  }) => {
    // Gate SN-LIVE-012: public wiki body excludes private note content.
    await fulfillScratchNodePage(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        "sn_host_owner_key_v2",
        "hk1:liveEvents:1:nonce:1770000000000:abcdefabcdefabcdefabcdefabcdef12",
      );
    });
    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");
    await expect
      .poll(() => page.evaluate(() => (window as any)._sn_live?.hostVerified === true), {
        timeout: 5_000,
      })
      .toBe(true);

    await page.fill("#ci", "/ask what belongs in the public recap?");
    await page.keyboard.press("Enter");
    await page.evaluate(() => {
      const w = window as any;
      if (document.body.getAttribute("data-mode") !== "private") w.toggleLock();
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = "private-note-secret";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      w.sendComposerMessage();
      if (document.body.getAttribute("data-mode") === "private") w.toggleLock();
    });

    const answer = page.locator(".ans").last();
    await answer.locator(".ans-actions .host-only").click();
    await page.evaluate(() => (window as any).snPublishWiki());
    await expect
      .poll(() => page.evaluate(() => (window as any)._sn_published_wiki_body || ""), {
        timeout: 5_000,
      })
      .toContain("Mock sourced answer for: what belongs in the public recap?");

    const publishedWikiBody = await page.evaluate(() => (window as any)._sn_published_wiki_body || "");
    expect(publishedWikiBody).not.toContain("private-note-secret");
    expect(publishedWikiBody).toContain("Private notes stay out of the public wiki");
  });

  test("public send DOES create a public message (boundary control)", async ({ page }) => {
    await fulfillScratchNodePage(page);
    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    await page.evaluate(() => {
      const w = window as any;
      if (document.body.getAttribute("data-mode") === "private") w.toggleLock();
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = "PUBLIC-hello-everyone-xyz";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      w.sendComposerMessage();
    });

    await expect
      .poll(
        () =>
          page.evaluate(() =>
            ((window as any).__snMockMutations || []).some(
              (c: any) => c.name === "events:sendMessage",
            ),
          ),
        { timeout: 5000 },
      )
      .toBe(true);
  });
});
