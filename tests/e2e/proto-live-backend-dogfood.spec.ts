import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const RUN_LIVE = process.env.PROTO_DOGFOOD_LIVE === "1";
const SCRATCHNODE_APEX_URL = process.env.SCRATCHNODE_APEX_URL ?? "https://scratchnode.live/";
const SCRATCHNODE_EVENT_URL =
  process.env.SCRATCHNODE_EVENT_URL ?? "https://scratchnode.live/e/ai-infra-summit-2026";
const NODEBENCH_V4_URL =
  process.env.NODEBENCH_V4_URL ?? "https://www.nodebenchai.com/proto/home-v4.html";
const ARTIFACT_DIR = join(process.cwd(), ".tmp", "proto-live-backend-dogfood");

test.skip(!RUN_LIVE, "Set PROTO_DOGFOOD_LIVE=1 to run real production backend dogfood.");
test.describe.configure({ mode: "serial", timeout: 180_000 });

function withQa(url: string, qaId: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("qa", qaId);
  return parsed.toString();
}

async function waitForScratchNodeLive(page: import("@playwright/test").Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => ({
          live: document.body.getAttribute("data-sn-live"),
          phases: document.body.getAttribute("data-sn-phases"),
          eventId: (window as any)._sn_live?.eventId ?? null,
        })),
      { timeout: 45_000, intervals: [500, 1_000, 2_000] },
    )
    .toMatchObject({
      live: "true",
      phases: "1,2,3,4,5",
      eventId: expect.any(String),
    });
}

async function sendComposer(page: import("@playwright/test").Page, text: string) {
  await page.evaluate((value) => {
    const input = document.getElementById("ci") as HTMLInputElement | HTMLTextAreaElement | null;
    if (!input) throw new Error("ScratchNode composer #ci not found");
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    (window as any).sendComposerMessage();
  }, text);
}

async function findAnswerForQuestion(page: import("@playwright/test").Page, question: string) {
  return await page.evaluate((q) => {
    const answers = Array.from(document.querySelectorAll<HTMLElement>(".ans"));
    const answer = answers.find((node) => node.textContent?.includes(q));
    return answer
      ? {
          id: answer.getAttribute("data-answer-id"),
          text: answer.textContent || "",
        }
      : null;
  }, question);
}

async function queryAnswer(page: import("@playwright/test").Page, answerId: string) {
  return await page.evaluate(async (id) => {
    const live = (window as any)._sn_live;
    if (!live?.client || !live?.eventId) throw new Error("ScratchNode live client missing");
    const rows = await live.client.query("events:getAnswers", { eventId: live.eventId, limit: 100 });
    return rows.find((row: any) => String(row._id) === id) ?? null;
  }, answerId);
}

async function waitForHostRole(page: import("@playwright/test").Page, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const role = await page.evaluate(() => document.body.getAttribute("data-role"));
    if (role === "host") return true;
    await page.waitForTimeout(500);
  }
  return false;
}

test("home-v5 runs the live Convex event-room loop across shipped phases", async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const qaId = `proto-v5-${Date.now()}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await pageA.goto(withQa(SCRATCHNODE_APEX_URL, `${qaId}-apex`), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await waitForScratchNodeLive(pageA);
    await expect(pageA).toHaveTitle(/ScratchNode/i);
    const boundary = await pageA.evaluate(() => {
      const win = window as any;
      return {
        publicBaseUrl: win.PUBLIC_BASE_URL,
        eventUrl: win.EVENT_URL,
        workspaceBaseUrl: win.WORKSPACE_BASE_URL,
        privateHandoffUrl: win.buildNodeBenchEventPrivateUrl?.(),
        signInHandoffUrl: win.buildNodeBenchSignInUrl?.(),
        hasOpenHandoff: typeof win.openNodeBenchPrivateHandoff,
      };
    });
    const expectedPublicOrigin = new URL(SCRATCHNODE_APEX_URL).origin;
    expect(boundary.publicBaseUrl).toBe(expectedPublicOrigin);
    expect(boundary.eventUrl).toBe(`${expectedPublicOrigin}/e/ai-infra-summit-2026`);
    expect(boundary.eventUrl).not.toContain("scratchnode.com");
    expect(boundary.workspaceBaseUrl).toBe("https://nodebenchai.com");
    expect(boundary.privateHandoffUrl).toContain(
      "https://nodebenchai.com/events/ai-infra-summit-2026/private",
    );
    expect(boundary.privateHandoffUrl).toContain("source=scratchnode");
    expect(boundary.privateHandoffUrl).toContain("room=ORBITAL");
    expect(decodeURIComponent(boundary.privateHandoffUrl)).toContain(
      `return=${expectedPublicOrigin}/e/ai-infra-summit-2026`,
    );
    expect(decodeURIComponent(boundary.signInHandoffUrl)).toContain(
      "/events/ai-infra-summit-2026/private",
    );
    expect(boundary.hasOpenHandoff).toBe("function");
    await pageA.screenshot({
      path: join(ARTIFACT_DIR, `${qaId}-apex-live.png`),
      fullPage: true,
    });

    await pageA.goto(withQa(SCRATCHNODE_EVENT_URL, `${qaId}-a`), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await pageB.goto(withQa(SCRATCHNODE_EVENT_URL, `${qaId}-b`), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await waitForScratchNodeLive(pageA);
    await waitForScratchNodeLive(pageB);

    const myEvents = await pageA.evaluate(async () => {
      const live = (window as any)._sn_live;
      return await live.client.query("events:getMyEvents", {
        sessionId: live.sessionId,
        ownerKey:
          localStorage.getItem("sn_host_owner_key_v2") ||
          localStorage.getItem("sn_host_owner_key") ||
          live.sessionId,
        limit: 10,
      });
    });
    expect(myEvents.joined.some((event: any) => event.slug === "ai-infra-summit-2026")).toBe(true);
    await pageA.evaluate(() => (window as any).openEvents());
    await expect(pageA.locator("#sheet-title")).toContainText("My events");
    await expect(pageA.locator("#sheet-content")).toContainText("AI Infra Summit");
    await pageA.evaluate(() => (window as any).closeSheet());

    const chatText = `QA public chat sync ${qaId}`;
    await sendComposer(pageA, chatText);
    await expect
      .poll(
        () =>
          pageB.evaluate((text) => {
            return Array.from(document.querySelectorAll(".row-text")).some((node) =>
              node.textContent?.includes(text),
            );
          }, chatText),
        { timeout: 30_000 },
      )
      .toBe(true);
    const publicMessageId = await pageA.evaluate((text) => {
      const row = Array.from(document.querySelectorAll(".row[data-mid]")).find((node) =>
        node.querySelector(".row-text")?.textContent?.includes(text),
      );
      return row?.getAttribute("data-mid") ?? null;
    }, chatText);
    expect(publicMessageId, "public message should have a stable row id for private anchors").toBeTruthy();

    const question = `what did attendees say about MCP auth ${qaId}`;
    await sendComposer(pageA, `/ask ${question}`);
    await expect
      .poll(() => findAnswerForQuestion(pageA, question), { timeout: 60_000 })
      .toMatchObject({ id: expect.any(String) });

    const answer = await findAnswerForQuestion(pageA, question);
    expect(answer?.id, "sourced answer should render with data-answer-id").toBeTruthy();
    expect(answer?.text, "answer reuse line should state private notes were excluded").toContain(
      "no private notes",
    );

    await expect
      .poll(() => queryAnswer(pageA, answer!.id!), { timeout: 15_000 })
      .not.toBeNull();
    const answerRecord = await queryAnswer(pageA, answer!.id!);
    expect(answerRecord.cacheHit).toBe(false);
    expect(answerRecord.sources.length).toBeGreaterThan(0);
    expect(["provider", "provider_fallback", "deterministic"]).toContain(answerRecord.agentMode);
    expect(answerRecord.evaluation?.passed).toBe(true);
    expect(answerRecord.evaluation?.score).toBeGreaterThanOrEqual(80);
    expect(
      answerRecord.trace.some((step: any) =>
        ["provider_llm", "deterministic_synthesis", "deterministic_fallback"].includes(step.step),
      ),
    ).toBe(true);
    expect(answerRecord.trace.some((step: any) => step.step === "quality_gate")).toBe(true);

    await pageA.evaluate((answerId) => (window as any).snSuggestFaq(answerId), answer!.id);
    await expect
      .poll(async () => (await queryAnswer(pageA, answer!.id!))?.faqStatus, { timeout: 15_000 })
      .toBe("suggested");

    await pageA.evaluate(() => (window as any).snClaimHost());
    const hostClaimed = await waitForHostRole(pageA);
    if (hostClaimed) {
      await pageA.evaluate((answerId) => (window as any).snPromoteFaq(answerId), answer!.id);
      await expect
        .poll(async () => (await queryAnswer(pageA, answer!.id!))?.faqStatus, { timeout: 15_000 })
        .toBe("promoted");

      await pageA.evaluate(() => (window as any).snPublishWiki());
      await expect
        .poll(
          () =>
            pageA.evaluate(() => {
              const body = (window as any)._sn_published_wiki_body;
              return typeof body === "string" && body.includes("AI Infra Summit Wiki");
            }),
          { timeout: 20_000 },
        )
        .toBe(true);
    } else {
      const hostStatus = await pageA.evaluate(async () => {
        const live = (window as any)._sn_live;
        return await live.client.query("events:getHostStatus", {
          eventId: live.eventId,
          ownerKey: localStorage.getItem("sn_host_owner_key") || live.sessionId,
        });
      });
      expect(hostStatus.isHost).toBe(false);
      await pageA.evaluate((answerId) => (window as any).snPromoteFaq(answerId), answer!.id);
      await pageA.waitForTimeout(1_000);
      expect((await queryAnswer(pageA, answer!.id!))?.faqStatus).not.toBe("promoted");
    }

    const privateNote = `QA private note ${qaId}`;
    await pageA.evaluate((mid) => (window as any).noteOnMessage(mid), publicMessageId);
    await expect
      .poll(() => pageA.evaluate(() => document.body.getAttribute("data-mode")), { timeout: 5_000 })
      .toBe("private");
    await sendComposer(pageA, privateNote);

    await expect
      .poll(
        () =>
          pageA.evaluate((text) => {
            return ((window as any)._notes_v5 || []).some(
              (note: any) =>
                note._convex &&
                (String(note.title || "").includes(text) ||
                  String(note.body || "").includes(text)),
            );
          }, privateNote),
        { timeout: 30_000 },
      )
      .toBe(true);

    const noteId = await pageA.evaluate((text) => {
      const note = ((window as any)._notes_v5 || []).find(
        (row: any) =>
          row._convex &&
          (String(row.title || "").includes(text) || String(row.body || "").includes(text)),
      );
      return note?.id ?? null;
    }, privateNote);
    expect(noteId, "private note should have a Convex id").toBeTruthy();
    const anchoredNote = await pageA.evaluate((id) => {
      return ((window as any)._notes_v5 || []).find((note: any) => note.id === id) ?? null;
    }, noteId);
    expect(anchoredNote.anchorType).toBe("message");
    expect(anchoredNote.anchorId).toBe(publicMessageId);
    await expect
      .poll(
        () =>
          pageA.evaluate((mid) => {
            const row = Array.from(document.querySelectorAll(".row[data-mid]")).find(
              (node) => node.getAttribute("data-mid") === mid,
            );
            return row?.querySelector(".private-note-marker")?.textContent ?? "";
          }, publicMessageId),
        { timeout: 15_000 },
      )
      .toContain("private note");
    await expect
      .poll(
        () =>
          pageB.evaluate((mid) => {
            const row = Array.from(document.querySelectorAll(".row[data-mid]")).find(
              (node) => node.getAttribute("data-mid") === mid,
            );
            return !!row?.querySelector(".private-note-marker");
          }, publicMessageId),
        { timeout: 5_000 },
      )
      .toBe(false);

    await pageA.evaluate(() => (window as any).openNotes());
    await expect(pageA.locator("#sn-nodebench-private-handoff")).toBeVisible();
    await expect(pageA.locator("#sheet-content")).toContainText("Open NodeBench event notebook");
    await expect(pageA.locator("#sheet-content")).toContainText(
      "https://nodebenchai.com/events/ai-infra-summit-2026/private",
    );
    await pageA.evaluate(() => (window as any).closeSheet());

    await pageA.evaluate((id) => {
      (window as any)._activeNoteId = id;
      return (window as any).togglePinNote();
    }, noteId);
    await expect
      .poll(
        () =>
          pageA.evaluate((id) => {
            return !!((window as any)._notes_v5 || []).find((note: any) => note.id === id)?.pinned;
          }, noteId),
        { timeout: 15_000 },
      )
      .toBe(true);

    expect(await pageA.locator("#feed").textContent()).not.toContain(privateNote);
    expect(await pageB.locator("body").textContent()).not.toContain(privateNote);

    await pageA.evaluate((id) => {
      (window as any)._activeNoteId = id;
      return (window as any).deleteActiveNote();
    }, noteId);
    await expect
      .poll(
        () =>
          pageA.evaluate((id) => {
            return !((window as any)._notes_v5 || []).some((note: any) => note.id === id);
          }, noteId),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          pageA.evaluate((mid) => {
            const row = Array.from(document.querySelectorAll(".row[data-mid]")).find(
              (node) => node.getAttribute("data-mid") === mid,
            );
            return !!row?.querySelector(".private-note-marker");
          }, publicMessageId),
        { timeout: 15_000 },
      )
      .toBe(false);

    await pageA.screenshot({
      path: join(ARTIFACT_DIR, `${qaId}-event-final.png`),
      fullPage: true,
    });
    await pageB.screenshot({
      path: join(ARTIFACT_DIR, `${qaId}-second-browser-sync.png`),
      fullPage: true,
    });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("home-v5 runDemoFull emits evaluated L1/L2/L3 output envelopes", async ({ page }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const qaId = `proto-v5-contract-${Date.now()}`;
  const parsed = new URL(SCRATCHNODE_EVENT_URL);
  parsed.searchParams.set("demo", "1");
  parsed.searchParams.set("demoSpeed", "instant");
  parsed.searchParams.set("qa", qaId);

  await page.goto(parsed.toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForFunction(() => typeof (window as any).runDemoQA === "function", null, {
    timeout: 45_000,
  });
  await page.waitForTimeout(2_500);

  const qa = await page.evaluate(async () => {
    await (window as any).runDemoFull({ speed: "instant" });
    return (window as any).runDemoQA();
  });

  expect(qa.failed).toBe(0);
  expect(qa.total).toBe(17);
  expect(qa.contract.passed).toBe(true);
  expect(qa.contract.missingFamilies).toEqual([]);
  expect(qa.contract.rendererMapped).toBe(true);
  expect(qa.contract.evaluatorMapped).toBe(true);
  expect(qa.riskAttack.passed).toBe(7);
  expect(qa.riskAttack.failed).toBe(0);
  expect(qa.riskAttack.total).toBe(7);
  expect(qa.riskAttack.observedRisks).toEqual([]);
  expect(Object.keys(qa.contract.byL1).sort()).toEqual([
    "agent_trace",
    "generated_artifact",
    "graph_memory",
    "operational_cache",
    "private_memory",
    "public_knowledge",
    "retrieval_context",
    "ui_renderable",
  ]);

  await page.screenshot({
    path: join(ARTIFACT_DIR, `${qaId}-output-contract.png`),
    fullPage: true,
  });
});

// ─── Phase 4 host auth — code flow against the live backend ─────────
//
// Verifies the new requestHostClaim + claimHostWithCode + HMAC token
// surface against production Convex. The shared demo event
// (ai-infra-summit-2026) is held by Alice's legacy ownerKey, so a
// fresh attempt by a new sessionId must hit the
// legacy_host_must_rotate_first gate — which IS the auth invariant
// we're protecting. We also verify claimHost rejects an hk1: prefix
// (legacy → real-auth impersonation blocker) by reading the raw
// HTTP response.
test("home-v5 Phase 4 host-auth surface rejects unauthorized requestHostClaim and forged tokens", async ({ browser }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const qaId = `proto-v5-phase4-${Date.now()}`;
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(withQa(SCRATCHNODE_EVENT_URL, qaId), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await waitForScratchNodeLive(page);

    // The dogfood event is held by Alice (legacy ownerKey). A new
    // sessionId requesting a code MUST be blocked — either by
    // legacy_host_must_rotate_first or by the membership gate.
    const requestResult = await page.evaluate(async () => {
      const live = (window as any)._sn_live;
      try {
        await live.client.mutation("events:requestHostClaim", {
          eventId: live.eventId,
          requesterSessionId: live.sessionId,
        });
        return { blocked: false };
      } catch (err: any) {
        return { blocked: true, message: String(err?.message ?? err) };
      }
    });
    expect(
      requestResult.blocked,
      "requestHostClaim from non-host on legacy-held event must be blocked",
    ).toBe(true);

    // claimHost MUST reject an hk1: prefix (so a leaked legacy ownerKey
    // can't impersonate a real-auth host row).
    const claimRejectsHk1 = await page.evaluate(async () => {
      const live = (window as any)._sn_live;
      try {
        await live.client.mutation("events:claimHost", {
          eventId: live.eventId,
          ownerKey: "hk1:fake:nonce:1700000000000:0000000000000000",
          displayName: "Forger",
        });
        return { rejected: false };
      } catch (err: any) {
        return { rejected: true, message: String(err?.message ?? err) };
      }
    });
    expect(
      claimRejectsHk1.rejected,
      "claimHost must reject an hk1: prefix to prevent legacy → real-auth bypass",
    ).toBe(true);

    // claimHostWithCode with a bogus code MUST be rejected (code_invalid).
    const bogusCode = await page.evaluate(async () => {
      const live = (window as any)._sn_live;
      try {
        await live.client.mutation("events:claimHostWithCode", {
          eventId: live.eventId,
          hostClaimCode: "BOGUSCODEBOGUSCODEBOGUS",
          displayName: "Attacker",
          requesterSessionId: live.sessionId,
        });
        return { rejected: false };
      } catch (err: any) {
        return { rejected: true, message: String(err?.message ?? err) };
      }
    });
    expect(
      bogusCode.rejected,
      "claimHostWithCode with a bogus code must be rejected",
    ).toBe(true);

    // A forged HMAC token MUST fail requireHost (signature check). We
    // exercise it through promoteAnswerToFaq, which uses requireHost —
    // we don't need a real answerId because requireHost throws first.
    const forgedToken = await page.evaluate(async () => {
      const live = (window as any)._sn_live;
      const forged =
        "hk1:" +
        String(live.eventId).slice(0, 16) +
        ":abcdefghijklmnop:" +
        Date.now() +
        ":00000000000000000000000000000000";
      try {
        await live.client.mutation("events:promoteAnswerToFaq", {
          eventId: live.eventId,
          answerId: "liveEventAnswers:nonexistent",
          ownerKey: forged,
        });
        return { rejected: false };
      } catch (err: any) {
        return { rejected: true, message: String(err?.message ?? err) };
      }
    });
    expect(
      forgedToken.rejected,
      "forged HMAC token must fail HMAC verification in requireHost",
    ).toBe(true);

    await page.screenshot({
      path: join(ARTIFACT_DIR, `${qaId}-phase4-auth-rejections.png`),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test("home-v4 dogfoods every prototype interaction without claiming live backend", async ({ page }) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const qaId = `proto-v4-${Date.now()}`;
  await page.goto(withQa(NODEBENCH_V4_URL, qaId), {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });

  await expect(page).toHaveTitle(/NodeBench v4/i);
  const initialProbe = await page.evaluate(() => ({
    snLive: document.body.getAttribute("data-sn-live"),
    hasScratchLiveClient: !!(window as any)._sn_live,
    hasConvexRuntimeScript: Array.from(document.scripts).some((script) =>
      script.textContent?.includes("ConvexReactClient"),
    ),
    functions: {
      switchMode: typeof (window as any).switchMode,
      openMentionById: typeof (window as any).openMentionById,
      openBacklinks: typeof (window as any).openBacklinks,
      toggleRefExpand: typeof (window as any).toggleRefExpand,
      sendChat: typeof (window as any).sendChat,
      toggleWideMode: typeof (window as any).toggleWideMode,
    },
  }));
  expect(initialProbe.snLive).toBe(null);
  expect(initialProbe.hasScratchLiveClient).toBe(false);
  expect(initialProbe.hasConvexRuntimeScript).toBe(false);
  expect(Object.values(initialProbe.functions)).toEqual([
    "function",
    "function",
    "function",
    "function",
    "function",
    "function",
  ]);

  const modeProbe = async (mode: string) => {
    await page.evaluate((m) => (window as any).switchMode(m), mode);
    return await page.evaluate(() => ({
      shellMode: document.querySelector(".shell")?.getAttribute("data-mode"),
      leftMode: document.querySelector(".left-index")?.getAttribute("data-mode"),
      activeSurface: document.querySelector(".center-surface.active")?.getAttribute("data-mode"),
      rightRailChat: document.getElementById("right-context")?.classList.contains("chat-active"),
      artifactCards: document.querySelectorAll(".art-card").length,
    }));
  };

  expect(await modeProbe("notebook")).toMatchObject({
    shellMode: "notebook",
    leftMode: "notebook",
    activeSurface: "notebook",
    rightRailChat: false,
  });
  expect(await modeProbe("artifacts")).toMatchObject({
    shellMode: "artifacts",
    leftMode: "artifacts",
    activeSurface: "artifacts",
    rightRailChat: false,
  });
  expect((await modeProbe("artifacts")).artifactCards).toBeGreaterThan(0);
  expect(await modeProbe("chat")).toMatchObject({
    shellMode: "chat",
    leftMode: "chat",
    activeSurface: "chat",
    rightRailChat: true,
  });

  const chatText = `Compare Orbital Labs and Anthropic ${qaId}`;
  await page.evaluate((text) => {
    const input = document.getElementById("chat-input") as HTMLInputElement | null;
    if (!input) throw new Error("home-v4 chat input missing");
    input.value = text;
    (window as any).sendChat();
  }, chatText);
  await expect(page.locator("#chat-messages")).toContainText(chatText);
  await expect(page.locator("#chat-messages")).toContainText("Processing query", { timeout: 5_000 });
  await expect(page.locator("#chat-messages")).toContainText("I found relevant context", {
    timeout: 5_000,
  });

  await page.evaluate(() => (window as any).openMentionById("ent_orbital"));
  await expect(page.locator("#ctx-entity-name")).toContainText("Orbital Labs");

  await page.evaluate(() => (window as any).openBacklinks("topic_mcp"));
  await expect(page.locator("#bl-drawer")).toHaveClass(/open/);
  await expect(page.locator("#bl-drawer-title")).toContainText("MCP Protocol");
  await expect(page.locator("#bl-drawer-content")).toContainText("Notebooks");

  await page.evaluate(() => {
    const mention = document.querySelector(".mention[data-id='ent_anthropic']");
    (window as any).toggleRefExpand(mention);
  });
  await expect(page.locator(".nb-ref-expand[data-kind='company']")).toContainText("Anthropic");

  await page.evaluate(() => (window as any).toggleWideMode());
  await expect(page.locator(".shell")).toHaveAttribute("data-wide", "");
  await page.evaluate(() => (window as any).toggleWideMode());
  await expect(page.locator(".shell")).not.toHaveAttribute("data-wide", "");

  await page.screenshot({
    path: join(ARTIFACT_DIR, `${qaId}-home-v4-interactions.png`),
    fullPage: true,
  });
});
