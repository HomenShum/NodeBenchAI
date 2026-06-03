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
            window.__snMockMessages = [];
            window.__snMockAnswers = [];
            window.__snMockActions = [];
            window.__snMockPromotedAnswerIds = [];
            window.__snMockPublishedWiki = null;
            window.__snWikiPublished = false;
            window.__snPublishWikiArgs = null;
            window.__snMockSubscriptions = {};
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
              const messageId = 'liveEventMessages:' + (window.__snMockMessages.length + 1);
              const nextMessage = {
                _id: messageId,
                eventId: args.eventId,
                displayName: args.displayName,
                text: args.text,
                kind: args.kind,
                createdAt: 1770000000000 + window.__snMockMessages.length,
              };
              window.__snMockMessages.push(nextMessage);
              const notifyMessages = window.__snMockSubscriptions['events:getMessages'];
              if (typeof notifyMessages === 'function') {
                notifyMessages(window.__snMockMessages.slice());
              }
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
            if (name === 'events:suggestAnswerForFaq') {
              return Promise.resolve({ ok: true, answerId: args.answerId });
            }
            if (name === 'events:promoteAnswerToFaq') {
              const promoted = Array.isArray(window.__snMockPromotedAnswerIds)
                ? window.__snMockPromotedAnswerIds
                : [];
              if (!promoted.includes(args.answerId)) promoted.push(args.answerId);
              window.__snMockPromotedAnswerIds = promoted;
              return Promise.resolve({ ok: true, answerId: args.answerId });
            }
            if (name === 'events:publishWiki') {
              window.__snWikiPublished = true;
              window.__snPublishWikiArgs = args;
              localStorage.setItem('__snWikiPublishArgs', JSON.stringify(args));
              const promotedIds = Array.isArray(window.__snMockPromotedAnswerIds)
                ? window.__snMockPromotedAnswerIds
                : [];
              const promotedAnswers = (window.__snMockAnswers || []).filter((answer) =>
                promotedIds.includes(answer._id),
              );
              const bodyHtml =
                '<div class="wiki-search"><span>&#128269;</span><input type="text" placeholder="Search this wiki..." aria-label="Search wiki"><kbd>&#8984;K</kbd></div>' +
                '<h1>AI Infra Summit &middot; Wiki</h1>' +
                promotedAnswers.map((answer, index) =>
                  '<section id="faq-' + (index + 1) + '">' +
                    '<h2>' + answer.question + '</h2>' +
                    '<p>' + answer.body + '</p>' +
                    '<div class="wiki-src-chips"><span>' + answer.sourceCount + ' sources</span></div>' +
                  '</section>'
                ).join('') +
                '<div class="wiki-callout"><span class="icon">&#128274;</span><div><strong>Privacy:</strong> Your private notes never enter the wiki. Only public chat, /ask answers, and host-uploaded sources are compacted into this page.</div></div>';
              const finalBodyHtml = promotedAnswers.length
                ? bodyHtml
                : '<h1>AI Infra Summit Wiki</h1><p>Published public memory.</p>';
              window.__snMockPublishedWiki = {
                eventId: args.eventId,
                version: 1,
                title: 'AI Infra Summit · Wiki',
                bodyHtml: finalBodyHtml,
                sourceAnswerIds: promotedAnswers.map((answer) => answer._id),
                sourceIds: ['liveEventSources:1'],
                createdAt: 1770000000000,
                publishedAt: 1770000001000,
                sections: promotedAnswers.map((answer, index) => ({
                  id: 'faq-' + (index + 1),
                  title: answer.question,
                  body: answer.body,
                  sourceCount: answer.sourceCount,
                })),
                generatedAt: 1770000002000 + promotedAnswers.length,
              };
              return Promise.resolve({ ok: true, eventId: args.eventId, version: 1, status: 'published' });
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
            if (name === 'events:getPublishedWiki') return Promise.resolve(window.__snMockPublishedWiki);
            if (name === 'events:getHostStatus') {
              const token = localStorage.getItem('sn_host_owner_key_v2');
              return Promise.resolve(token ? { isHost: true, role: 'owner', displayName: 'Mock Host' } : { isHost: false });
            }
            return Promise.resolve([]);
          }
          action(name, args) {
            window.__snMockActions.push({ name, args });
            if (name === 'events:askAgent') {
              const answerId = 'liveEventAnswers:' + (window.__snMockAnswers.length + 1);
              const nextAnswer = {
                _id: answerId,
                question: args.question,
                body: 'Mock sourced answer for ' + args.question,
                questionMessageId: args.questionMessageId,
                sourceCount: 2,
                sources: [
                  { title: 'Event wiki cache', uri: 'doc://event/wiki', excerpt: 'Public event context' },
                  { title: 'Speaker notes', uri: 'doc://event/sources', excerpt: 'Host-uploaded public source' },
                ],
                externalSearches: 0,
                cacheHit: false,
                estimatedCostCents: 0.0123,
                evaluation: { score: 97 },
                trace: [
                  { step: 'semantic_cache_lookup', status: 'ok', detail: 'public cache hit path' },
                  { step: 'public_private_boundary', status: 'ok', detail: 'private notes excluded from retrieval, cache, and answer' },
                ],
                createdAt: 1770000001000 + window.__snMockAnswers.length,
              };
              window.__snMockAnswers.push(nextAnswer);
              const notifyAnswers = window.__snMockSubscriptions['events:getAnswers'];
              if (typeof notifyAnswers === 'function') {
                notifyAnswers(window.__snMockAnswers.slice());
              }
              return Promise.resolve(nextAnswer);
            }
            return Promise.resolve(null);
          }
          onUpdate(name, _args, cb) {
            window.__snMockSubscriptions[name] = cb;
            if (name === 'events:getMessages') {
              setTimeout(() => cb(window.__snMockMessages.slice()), 0);
            }
            if (name === 'events:getAnswers') {
              const answers = [
                ...((window.__snAnswers || [])),
                ...((window.__snMockAnswers || [])),
              ];
              setTimeout(() => cb(answers), 0);
            }
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
    expect(HOME_V5_HTML).not.toContain("toast('Shared'");
    expect(HOME_V5_HTML).toContain("function _snShareAnswer");

    await fulfillScratchNodePage(page);
    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    const written = await page.evaluate(() => {
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
    expect(written).toContain("/e/");
    expect(written).toContain("ScratchNode");
  });

  test("normal public chat stays human and never invokes the agent", async ({ page }) => {
    await fulfillScratchNodePage(page);

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    const chatText = "does anyone have the link to the workshop deck?";
    await page.evaluate((text) => {
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (window as any).sendComposerMessage();
    }, chatText);

    await expect(page.locator(".row-text", { hasText: chatText })).toHaveCount(1);
    await expect(page.locator(".ans", { hasText: chatText })).toHaveCount(0);

    const chatState = await page.evaluate((text) => {
      const win = window as any;
      return {
        actions: win.__snMockActions || [],
        publicChatCalls: (win.__snMockMutations || []).filter(
          (call: any) =>
            call.name === "events:sendMessage" &&
            call.args?.text === text &&
            call.args?.kind === "chat",
        ),
        askCalls: (win.__snMockMutations || []).filter(
          (call: any) => call.name === "events:sendMessage" && call.args?.kind === "ask",
        ),
      };
    }, chatText);

    expect(chatState.actions).toEqual([]);
    expect(chatState.publicChatCalls).toEqual([
      expect.objectContaining({
        args: expect.objectContaining({
          text: chatText,
          kind: "chat",
          eventId: "liveEvents:1",
        }),
      }),
    ]);
    expect(chatState.askCalls).toEqual([]);
  });

  test("locked composer saves a private note without public chat or agent calls", async ({ page }) => {
    await fulfillScratchNodePage(page);

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    const initialNoteCount = await page.evaluate(() => {
      const win = window as any;
      win.ensureNotesStore?.();
      return win.getPrivateNoteHandoffCount?.() ?? 0;
    });

    await page.locator("#lock").click();
    await expect(page.locator("body")).toHaveAttribute("data-mode", "private");

    const noteText = "private note: ask Priya for the clinical triage deck";
    await page.evaluate((text) => {
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (window as any).sendComposerMessage();
    }, noteText);

    await expect
      .poll(() => page.locator("#pn-inline-count").textContent(), { timeout: 5_000 })
      .toBe(String(initialNoteCount + 1));
    await expect(page.locator(".row-text", { hasText: noteText })).toHaveCount(0);
    await expect(page.locator(".ans", { hasText: noteText })).toHaveCount(0);

    const privateNoteState = await page.evaluate((text) => {
      const win = window as any;
      const handoffUrl = win.buildNodeBenchEventPrivateUrl?.();
      return {
        noteCount: win.getPrivateNoteHandoffCount?.(),
        handoffUrl,
        signInUrl: win.buildNodeBenchSignInUrl?.(handoffUrl),
        actions: win.__snMockActions || [],
        sendCalls: (win.__snMockMutations || []).filter(
          (call: any) => call.name === "events:sendMessage" && call.args?.text === text,
        ),
      };
    }, noteText);

    expect(privateNoteState.noteCount).toBe(initialNoteCount + 1);
    expect(privateNoteState.handoffUrl).toContain(`noteCount=${initialNoteCount + 1}`);
    expect(privateNoteState.handoffUrl).toContain("continuation=private-notes");
    const handoffUrl = new URL(privateNoteState.handoffUrl);
    expect(handoffUrl.origin).toBe("https://nodebenchai.com");
    expect(handoffUrl.pathname).toMatch(/^\/events\/.+\/private$/);
    expect(handoffUrl.searchParams.get("source")).toBe("scratchnode");
    expect(handoffUrl.searchParams.get("publicArtifact")).toBe("event-wiki");
    expect(handoffUrl.searchParams.get("return")).toBe("https://scratchnode.live/e/ai-infra-summit-2026");
    const signInUrl = new URL(privateNoteState.signInUrl);
    expect(signInUrl.origin).toBe("https://nodebenchai.com");
    expect(signInUrl.pathname).toBe("/sign-in");
    expect(signInUrl.searchParams.get("intent")).toBe("save-private-notes");
    expect(signInUrl.searchParams.get("return")).toBe(privateNoteState.handoffUrl);
    expect(privateNoteState.actions).toEqual([]);
    expect(privateNoteState.sendCalls).toEqual([]);
  });

  test("private notes anchored from public messages preserve context without public leakage", async ({
    page,
  }) => {
    await fulfillScratchNodePage(page);

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    const initialNoteCount = await page.evaluate(() => {
      const win = window as any;
      win.ensureNotesStore?.();
      return win.getPrivateNoteHandoffCount?.() ?? 0;
    });

    const publicText = "public chat anchor source for private note test";
    await page.evaluate((text) => {
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (window as any).sendComposerMessage();
    }, publicText);

    const publicRow = page.locator(".row", { hasText: publicText }).first();
    await expect(publicRow.locator(".row-text")).toContainText(publicText);
    const messageId = await publicRow.getAttribute("data-mid");
    expect(messageId).toMatch(/^liveEventMessages:/);

    await page.evaluate((mid) => {
      (window as any).noteOnMessage?.(mid);
    }, messageId);
    await expect(page.locator("body")).toHaveAttribute("data-mode", "private");
    await expect(page.locator("#reply-ctx")).toHaveAttribute("data-open", "true");
    await expect(page.locator("#reply-ctx-quote")).toContainText(publicText);

    const privateText = "private anchored note: ask Alex about the auth timeline";
    await page.evaluate((text) => {
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (window as any).sendComposerMessage();
    }, privateText);

    await expect
      .poll(() => page.locator("#pn-inline-count").textContent(), { timeout: 5_000 })
      .toBe(String(initialNoteCount + 1));
    await expect(page.locator("#reply-ctx")).toHaveAttribute("data-open", "false");
    await expect(page.locator(".row-text", { hasText: privateText })).toHaveCount(0);
    await expect(page.locator(".ans", { hasText: privateText })).toHaveCount(0);
    await expect(publicRow.locator(".private-note-marker")).toHaveAttribute(
      "aria-label",
      "1 private note anchored here",
    );

    const anchorState = await page.evaluate(
      ({ privateText, messageId, publicText }) => {
        const win = window as any;
        const note = (win._notes_v5 || []).find((entry: any) =>
          String(entry.title + "\n" + entry.body).includes(privateText),
        );
        return {
          note,
          actions: win.__snMockActions || [],
          privateSendCalls: (win.__snMockMutations || []).filter(
            (call: any) =>
              call.name === "events:sendMessage" &&
              call.args?.text === privateText,
          ),
          publicSendCalls: (win.__snMockMutations || []).filter(
            (call: any) =>
              call.name === "events:sendMessage" &&
              call.args?.text === publicText &&
              call.args?.kind === "chat",
          ),
          markerCount: document.querySelectorAll(
            `.row[data-mid="${messageId}"] .private-note-marker`,
          ).length,
        };
      },
      { privateText, messageId, publicText },
    );

    expect(anchorState.note).toEqual(
      expect.objectContaining({
        anchorType: "message",
        anchorId: messageId,
        anchorPreview: publicText,
      }),
    );
    expect(anchorState.actions).toEqual([]);
    expect(anchorState.privateSendCalls).toEqual([]);
    expect(anchorState.publicSendCalls).toHaveLength(1);
    expect(anchorState.markerCount).toBe(1);
  });

  test("sensitive event mode forces /ask into private notes without agent calls", async ({ page }) => {
    await fulfillScratchNodePage(page);

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    const initialNoteCount = await page.evaluate(() => {
      const win = window as any;
      win.ensureNotesStore?.();
      return win.getPrivateNoteHandoffCount?.() ?? 0;
    });

    await page.evaluate(() => (window as any).setEventMode?.("sensitive"));
    await expect(page.locator("body")).toHaveAttribute("data-event-mode", "sensitive");

    const sensitivePrompt = "summarize the private vendor pricing concern";
    await page.evaluate((text) => {
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = `/ask ${text}`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (window as any).sendComposerMessage();
    }, sensitivePrompt);

    await expect
      .poll(() => page.locator("#pn-inline-count").textContent(), { timeout: 5_000 })
      .toBe(String(initialNoteCount + 1));
    await expect(page.locator(".row-text", { hasText: sensitivePrompt })).toHaveCount(0);
    await expect(page.locator(".ans", { hasText: sensitivePrompt })).toHaveCount(0);

    const sensitiveState = await page.evaluate((text) => {
      const win = window as any;
      return {
        noteCount: win.getPrivateNoteHandoffCount?.(),
        actions: win.__snMockActions || [],
        sendCalls: (win.__snMockMutations || []).filter(
          (call: any) => call.name === "events:sendMessage" && call.args?.text === text,
        ),
        noteTexts: (win._notes_v5 || []).map((note: any) => note.title + "\n" + note.body),
      };
    }, sensitivePrompt);

    expect(sensitiveState.noteCount).toBe(initialNoteCount + 1);
    expect(sensitiveState.actions).toEqual([]);
    expect(sensitiveState.sendCalls).toEqual([]);
    expect(sensitiveState.noteTexts.join("\n")).toContain(sensitivePrompt);
  });

  test("private /ask stays out of the public feed and increases the NodeBench handoff note count", async ({
    page,
  }) => {
    await fulfillScratchNodePage(page);

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    const initialNoteCount = await page.evaluate(() => {
      const win = window as any;
      win.ensureNotesStore?.();
      return win.getPrivateNoteHandoffCount?.() ?? 0;
    });

    const privatePrompt = "what follow-up should I save for after the summit?";
    await page.evaluate((text) => {
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = `/ask private ${text}`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (window as any).sendComposerMessage();
    }, privatePrompt);

    await expect
      .poll(() => page.locator("#pn-inline-count").textContent(), { timeout: 5_000 })
      .toBe(String(initialNoteCount + 1));
    await expect(page.locator("#pn-inline")).toHaveAttribute("data-count", String(initialNoteCount + 1));
    await expect(page.locator(".row-text", { hasText: privatePrompt })).toHaveCount(0);
    await expect(page.locator(".ans", { hasText: privatePrompt })).toHaveCount(0);
    await expect(page.locator("#pn-inline")).toContainText("private note(s) saved this event");

    const privateState = await page.evaluate((text) => {
      const win = window as any;
      return {
        noteCount: win.getPrivateNoteHandoffCount?.(),
        handoffUrl: win.buildNodeBenchEventPrivateUrl?.(),
        sendCalls: (win.__snMockMutations || []).filter(
          (call: any) => call.name === "events:sendMessage" && call.args?.text === text,
        ).length,
      };
    }, privatePrompt);

    expect(privateState.noteCount).toBe(initialNoteCount + 1);
    expect(privateState.handoffUrl).toContain("continuation=private-notes");
    expect(privateState.handoffUrl).toContain(`noteCount=${initialNoteCount + 1}`);
    expect(privateState.handoffUrl).toContain("publicArtifact=event-wiki");
    expect(privateState.sendCalls).toBe(0);

    await page.evaluate(() => (window as any).openNotes?.());
    await expect(page.locator("#sheet-title")).toContainText("My notes");
    await expect(page.locator("#sheet-content")).toContainText(privatePrompt);
    await expect(page.locator("#sheet-content")).toContainText("Open NodeBench event notebook");
    await expect(page.locator("#sn-nodebench-private-handoff")).toBeVisible();
  });

  test("public /ask after a private note still excludes private note text", async ({ page }) => {
    await fulfillScratchNodePage(page);

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    const initialNoteCount = await page.evaluate(() => {
      const win = window as any;
      win.ensureNotesStore?.();
      return win.getPrivateNoteHandoffCount?.() ?? 0;
    });

    const privateText = "private note: portfolio company diligence thread";
    await page.locator("#lock").click();
    await expect(page.locator("body")).toHaveAttribute("data-mode", "private");
    await page.evaluate((text) => {
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (window as any).sendComposerMessage();
    }, privateText);
    await expect
      .poll(() => page.locator("#pn-inline-count").textContent(), { timeout: 5_000 })
      .toBe(String(initialNoteCount + 1));

    await page.locator("#lock").click();
    await expect(page.locator("body")).toHaveAttribute("data-mode", "public");

    const publicPrompt = "what are the public follow-ups from the MCP panel?";
    await page.evaluate((text) => {
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = `/ask ${text}`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (window as any).sendComposerMessage();
    }, publicPrompt);

    await expect(page.locator(".row-text", { hasText: publicPrompt })).toHaveCount(1);
    const answerCard = page.locator(".ans").filter({ hasText: publicPrompt }).first();
    await expect(answerCard).toContainText("Mock sourced answer for " + publicPrompt);
    await expect(answerCard).toContainText("private notes excluded");
    await expect(answerCard).not.toContainText(privateText);

    const publicAskState = await page.evaluate((privateNoteText) => {
      const win = window as any;
      return {
        noteCount: win.getPrivateNoteHandoffCount?.(),
        actions: win.__snMockActions || [],
        serializedAnswers: JSON.stringify(win.__snMockAnswers || []),
        publicAskCalls: (win.__snMockMutations || []).filter(
          (call: any) => call.name === "events:sendMessage" && call.args?.kind === "ask",
        ),
        privateSendCalls: (win.__snMockMutations || []).filter(
          (call: any) => call.name === "events:sendMessage" && call.args?.text === privateNoteText,
        ),
      };
    }, privateText);

    expect(publicAskState.noteCount).toBe(initialNoteCount + 1);
    expect(publicAskState.publicAskCalls).toHaveLength(1);
    expect(publicAskState.privateSendCalls).toEqual([]);
    expect(publicAskState.actions).toEqual([
      expect.objectContaining({
        name: "events:askAgent",
        args: expect.objectContaining({
          question: publicPrompt,
        }),
      }),
    ]);
    expect(publicAskState.serializedAnswers).not.toContain(privateText);
  });

  test("public /ask keeps the parent ask visible and shows FAQ/wiki actions with a public-only trace", async ({
    page,
  }) => {
    await fulfillScratchNodePage(page);

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    const publicPrompt = "what changed in the MCP auth timeline?";
    await page.evaluate((text) => {
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = `/ask ${text}`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (window as any).sendComposerMessage();
    }, publicPrompt);

    await expect(page.locator(".row-text", { hasText: publicPrompt })).toHaveCount(1);
    const answerCard = page.locator(".ans").filter({ hasText: publicPrompt }).first();
    await expect(answerCard).toContainText("Mock sourced answer for " + publicPrompt);
    await expect(answerCard).toContainText("private notes excluded");
    await expect(answerCard).toContainText("Suggest for FAQ");
    await expect(answerCard).toContainText("View in wiki");
    await expect(answerCard.getByRole("button", { name: "Promote to FAQ" })).toHaveCount(0);
    await answerCard.getByRole("button", { name: "Suggest for FAQ" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            ((window as any).__snMockMutations || []).filter(
              (call: any) => call.name === "events:suggestAnswerForFaq",
            ).length,
        ),
      )
      .toBe(1);
    await answerCard.getByRole("button", { name: /Pin to wall/i }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => ((window as any).__snMockMutations || []).filter((call: any) => call.name === "wall:pinToWall").length,
        ),
      )
      .toBe(1);
    const wikiButton = answerCard.locator("button").filter({ hasText: /View in wiki/i }).last();
    await expect(wikiButton).toHaveCount(1);
    await wikiButton.evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator("#sheet-title")).toContainText("AI Infra Summit");
    await expect(page.locator("#sheet-content")).toContainText("Wiki not published yet");
    await expect(page.locator("#sheet-content")).not.toContainText(publicPrompt);

    const publicAskState = await page.evaluate(() => {
      const win = window as any;
      return {
        noteCount: win.getPrivateNoteHandoffCount?.() ?? 0,
        sendCalls: (win.__snMockMutations || []).filter(
          (call: any) => call.name === "events:sendMessage" && call.args?.kind === "ask",
        ).length,
        answers: (win.__snMockAnswers || []).map((answer: any) => ({
          question: answer.question,
          questionMessageId: answer.questionMessageId,
          trace: answer.trace,
        })),
        faqSuggestionCalls: (win.__snMockMutations || []).filter(
          (call: any) => call.name === "events:suggestAnswerForFaq",
        ),
        wallPinCalls: (win.__snMockMutations || []).filter((call: any) => call.name === "wall:pinToWall"),
        hostOnlyCalls: (win.__snMockMutations || []).filter((call: any) =>
          ["events:promoteAnswerToFaq", "events:publishWiki"].includes(call.name),
        ),
      };
    });

    expect(publicAskState.noteCount).toBe(0);
    expect(publicAskState.sendCalls).toBe(1);
    expect(publicAskState.answers).toHaveLength(1);
    expect(publicAskState.answers[0].question).toBe(publicPrompt);
    expect(publicAskState.answers[0].questionMessageId).toBe("liveEventMessages:1");
    expect(publicAskState.answers[0].trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.stringContaining("private notes excluded"),
        }),
      ]),
    );
    expect(publicAskState.faqSuggestionCalls).toEqual([
      expect.objectContaining({
        args: expect.objectContaining({
          answerId: "liveEventAnswers:1",
          eventId: "liveEvents:1",
        }),
      }),
    ]);
    expect(publicAskState.wallPinCalls).toEqual([
      expect.objectContaining({
        args: expect.objectContaining({
          eventId: "liveEvents:1",
          refAnswerId: "liveEventAnswers:1",
          refType: "answer",
        }),
      }),
    ]);
    expect(publicAskState.hostOnlyCalls).toEqual([]);
  });

  test("verified host can promote a public ask answer without publishing the wiki", async ({ page }) => {
    await fulfillScratchNodePage(page);
    const ownerKey = "hk1:liveEvents:1:nonce:1770000000000:abcdefabcdefabcdefabcdefabcdef12";
    await page.addInitScript((key) => {
      localStorage.setItem("sn_host_owner_key_v2", key);
    }, ownerKey);

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");
    await expect.poll(() => page.evaluate(() => document.body.getAttribute("data-role")), { timeout: 5_000 }).toBe("host");

    const hostPrompt = "which source should become the host FAQ?";
    await page.evaluate((text) => {
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = `/ask ${text}`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (window as any).sendComposerMessage();
    }, hostPrompt);

    const answerCard = page.locator(".ans").filter({ hasText: hostPrompt }).first();
    await expect(answerCard).toContainText("Mock sourced answer for " + hostPrompt);
    await expect(answerCard).toContainText("Promote to FAQ");
    await answerCard.getByRole("button", { name: "Promote to FAQ" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            ((window as any).__snMockMutations || []).filter(
              (call: any) => call.name === "events:promoteAnswerToFaq",
            ).length,
        ),
      )
      .toBe(1);

    const hostPromotionState = await page.evaluate(() => {
      const win = window as any;
      return {
        promotionCalls: (win.__snMockMutations || []).filter(
          (call: any) => call.name === "events:promoteAnswerToFaq",
        ),
        attendeeOnlyCalls: (win.__snMockMutations || []).filter(
          (call: any) => call.name === "events:suggestAnswerForFaq",
        ),
        publishCalls: (win.__snMockMutations || []).filter((call: any) => call.name === "events:publishWiki"),
      };
    });

    expect(hostPromotionState.promotionCalls).toEqual([
      expect.objectContaining({
        args: expect.objectContaining({
          answerId: "liveEventAnswers:1",
          eventId: "liveEvents:1",
          ownerKey,
        }),
      }),
    ]);
    expect(hostPromotionState.attendeeOnlyCalls).toEqual([]);
    expect(hostPromotionState.publishCalls).toEqual([]);
  });

  test("verified host can publish a wiki snapshot without sending private note text", async ({ page }) => {
    await fulfillScratchNodePage(page);
    const ownerKey = "hk1:liveEvents:1:nonce:1770000000000:abcdefabcdefabcdefabcdefabcdef12";
    await page.addInitScript((key) => {
      localStorage.setItem("sn_host_owner_key_v2", key);
    }, ownerKey);

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");
    await expect.poll(() => page.evaluate(() => document.body.getAttribute("data-role")), { timeout: 5_000 }).toBe("host");

    const privateNoteText = "private board note: acquisition diligence call with Priya";
    const initialNoteCount = await page.evaluate(() => (window as any).getPrivateNoteHandoffCount?.() ?? 0);
    await page.evaluate((text) => {
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = `/ask private ${text}`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (window as any).sendComposerMessage();
    }, privateNoteText);
    await expect
      .poll(() => page.evaluate(() => (window as any).getPrivateNoteHandoffCount?.() ?? 0), { timeout: 5_000 })
      .toBeGreaterThanOrEqual(initialNoteCount + 1);

    await page.evaluate(() => (window as any).openSheet("host"));
    await page.getByRole("button", { name: "Publish wiki snapshot" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            ((window as any).__snMockMutations || []).filter((call: any) => call.name === "events:publishWiki")
              .length,
        ),
      )
      .toBe(1);

    const publishState = await page.evaluate(() => {
      const win = window as any;
      return {
        publishCalls: (win.__snMockMutations || []).filter((call: any) => call.name === "events:publishWiki"),
        answerCalls: (win.__snMockMutations || []).filter((call: any) =>
          ["events:suggestAnswerForFaq", "events:promoteAnswerToFaq"].includes(call.name),
        ),
      };
    });

    expect(publishState.publishCalls).toEqual([
      expect.objectContaining({
        args: expect.objectContaining({
          eventId: "liveEvents:1",
          ownerKey,
        }),
      }),
    ]);
    expect(JSON.stringify(publishState.publishCalls[0].args)).not.toContain(privateNoteText);
    expect(publishState.answerCalls).toEqual([]);
  });

  test("verified host publishes promoted public answers into the wiki without leaking private notes", async ({
    page,
  }) => {
    await fulfillScratchNodePage(page);
    const ownerKey = "hk1:liveEvents:1:nonce:1770000000000:abcdefabcdefabcdefabcdefabcdef12";
    await page.addInitScript((key) => {
      localStorage.setItem("sn_host_owner_key_v2", key);
    }, ownerKey);

    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");
    await expect.poll(() => page.evaluate(() => document.body.getAttribute("data-role")), { timeout: 5_000 }).toBe("host");

    const publicPrompt = "what changed in the MCP auth timeline?";
    await page.evaluate((text) => {
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = `/ask ${text}`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (window as any).sendComposerMessage();
    }, publicPrompt);

    const answerCard = page.locator(".ans").filter({ hasText: publicPrompt }).first();
    await expect(answerCard).toContainText("Mock sourced answer for " + publicPrompt);
    await answerCard.getByRole("button", { name: "Promote to FAQ" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            ((window as any).__snMockMutations || []).filter(
              (call: any) => call.name === "events:promoteAnswerToFaq",
            ).length,
        ),
      )
      .toBe(1);

    const privateNoteText = "private board note: acquisition diligence call with Priya";
    await page.evaluate((text) => {
      const input = document.getElementById("ci") as HTMLInputElement;
      input.value = `/ask private ${text}`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (window as any).sendComposerMessage();
    }, privateNoteText);
    await expect
      .poll(() => page.evaluate(() => (window as any).getPrivateNoteHandoffCount?.() ?? 0), { timeout: 5_000 })
      .toBeGreaterThan(0);

    await page.evaluate(() => (window as any).openSheet("host"));
    await page.getByRole("button", { name: "Publish wiki snapshot" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            ((window as any).__snMockMutations || []).filter((call: any) => call.name === "events:publishWiki")
              .length,
        ),
      )
      .toBe(1);
    await expect.poll(() => page.evaluate(() => (window as any)._sn_published_wiki_body ?? ""), { timeout: 5_000 }).toContain(
      publicPrompt,
    );

    const publishedWikiButton = answerCard.locator("button").filter({ hasText: /View in wiki/i }).last();
    await expect(publishedWikiButton).toHaveCount(1);
    await publishedWikiButton.evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator("#sheet-title")).toContainText("AI Infra Summit");
    await expect(page.locator("#sheet-content")).toContainText(publicPrompt);
    await expect(page.locator("#sheet-content")).toContainText("Mock sourced answer for " + publicPrompt);
    await expect(page.locator("#sheet-content")).not.toContainText(privateNoteText);
    await expect(page.locator("#sheet-content")).toContainText("Your private notes never enter the wiki");

    const publishedWiki = await page.evaluate(() => (window as any).__snMockPublishedWiki);
    expect(publishedWiki).toMatchObject({
      eventId: "liveEvents:1",
      version: 1,
    });
    expect(publishedWiki.sections).toEqual([
      expect.objectContaining({
        title: publicPrompt,
        body: "Mock sourced answer for " + publicPrompt,
      }),
    ]);
    expect(JSON.stringify(publishedWiki)).not.toContain(privateNoteText);
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
    await expect(page.locator("#share-moment")).toHaveAttribute("data-open", "true");
    await expect(page.locator("#invite-card-code")).toHaveText("BIRTHDAY");
    await expect(page.locator("#share-link-input")).toHaveValue(/\/e\/launch-room$/);
    await expect(page.locator("#invite-card-qr")).toHaveAttribute("src", /create-qr-code/);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("sn_host_owner_key_v2")), {
        timeout: 5_000,
      })
      .toContain("hk1:");
    expect(page.url()).toBe("https://scratchnode.live/");
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
    await expect(page.locator("#share-moment")).toHaveAttribute("data-open", "true");
    await expect(page.locator("#invite-card-code")).toHaveText("LAUNCH");
    await page.click("#share-enter-btn");
    await expect.poll(() => page.url(), { timeout: 5_000 }).toContain("/e/launch-room");
  });

  test("share moment: copy link + invite text + share buttons are wired", async ({ page }) => {
    await fulfillScratchNodePage(page);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("https://scratchnode.live/", { waitUntil: "domcontentloaded" });
    await page.fill("#landing-create-name", "Launch Party");
    await page.fill("#landing-create-code", "LAUNCH");
    await page.click("#landing-create-btn");
    await expect(page.locator("#share-moment")).toHaveAttribute("data-open", "true");

    await expect(page.locator("#share-moment .share-moment__sub")).toContainText("shared memory");
    await expect(page.locator("#share-moment .invite-card__tag")).toContainText("remembers everything");

    await page.click("#share-link-copy");
    await expect(page.locator("#share-link-copy")).toHaveAttribute("data-copied", "true");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("/e/launch-room");

    await page.click("#share-invite-copy");
    const invite = await page.evaluate(() => navigator.clipboard.readText());
    expect(invite).toContain("Launch Party");
    expect(invite).toContain("/e/launch-room");

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
    await expect(page.locator(".landing-room-meta")).toContainText("6 inside");
    await expect(page.locator(".landing-room-meta")).toContainText("OFFICE");
    await expect(page.locator(".landing-room-meta .dot-inside")).toBeVisible();
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
    await expect(join).toHaveText("Request to join");
    await expect(join).toHaveJSProperty("tagName", "BUTTON");

    await join.click();
    await expect(join).toHaveText("Requested ✓", { timeout: 6_000 });
    await expect(join).toHaveAttribute("data-state", "requested");
    expect(page.url()).toBe("https://scratchnode.live/");
    const reqArgs = await page.evaluate(() => (window as any).__snRequestJoinArgs);
    expect(reqArgs.slug).toBe("rooftop-launch");
    expect(typeof reqArgs.sessionId).toBe("string");
    expect(reqArgs.sessionId.length).toBeGreaterThanOrEqual(8);

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
    // The big number is the EXACT reactive backend count — never a marketing figure.
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
      (window as any).__snLandingStats = { roomsCreated: 8, liveNow: 6, activeNow: 40, capped: false };
    });

    await page.goto("https://scratchnode.live/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#landing-pulse")).toBeVisible({ timeout: 6_000 });

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

    await expect.poll(() => page.locator("#landing-pulse-num").textContent()).toBe("8");
    await expect(page.locator("#landing-pulse-live")).toHaveText("6");
    await expect(page.locator("#landing-pulse-active")).toHaveText("40");
  });

  test("publishing the wiki surfaces an end-event recap moment with the public /wiki link", async ({
    page,
  }) => {
    await fulfillScratchNodePage(page);
    await page.goto("https://scratchnode.live/e/orbital", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toHaveAttribute("data-sn-live", "true");

    await page.evaluate(() => (window as any).snPublishWiki());

    const moment = page.locator("#wiki-live-moment");
    await expect(moment).toHaveAttribute("data-open", "true", { timeout: 6_000 });
    const link = await page.locator("#wiki-live-input").inputValue();
    expect(link).toMatch(/\/wiki\/[a-z0-9-]+$/i);
    await expect(moment).toContainText("Your wiki is live");
    await expect(moment).toContainText("the room remembers everything");
    const published = await page.evaluate(() => (window as any).__snPublishWikiArgs);
    expect(published).toBeTruthy();

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
});
