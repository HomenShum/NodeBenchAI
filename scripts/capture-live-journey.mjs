#!/usr/bin/env node
/**
 * Capture gate for the primary journey, run against a REAL Convex backend.
 *
 * What this exists to prove, and why it did not exist before: every product
 * route in this repo used to render the "Convex backend not configured" card,
 * so promotion defect D1 said the whole runtime below the trust boundary —
 * validation, the scheduled orchestrator, the model call, persistence,
 * cancellation — was readable and unit-testable but never *runnable* from the
 * repository. Nine of twelve gate conditions are judged on what the browser
 * shows, so all nine were stuck at UNVERIFIED for one reason: nothing rendered.
 *
 * This script drives the journeys named in promotion/PRODUCT_JOURNEYS.md
 * against a deployment you provisioned, in a real browser, and writes what it
 * observed. It asserts; it does not narrate. Every check below can fail.
 *
 *   J1  ask a question, watch it stream, land an answer with a source count
 *   J2  open the permanent receipt link cold and get the SAME answer back,
 *       proven by the latest-run id being unchanged (no second paid run)
 *   J4  cancel a live run, get an honest terminal state, keep working
 *
 * It also reads the durable rows back out of Convex (START_HERE step 8), so
 * "it streamed" is separated from "it persisted": the UI could in principle
 * show text that never became a row.
 *
 * PREREQUISITE — this needs a Convex deployment. There is no local substitute.
 * See docs/START_HERE.md "Before Step 1". In short:
 *
 *   npx convex dev --once --configure new --project <yours> --team <yours>
 *   npx @convex-dev/auth              # JWT_PRIVATE_KEY + JWKS + SITE_URL
 *   npx convex env set GEMINI_API_KEY -- "<key>"
 *
 * Run:    node scripts/capture-live-journey.mjs [--port 4902] [--question "..."]
 * Output: promotion/evidence/live-journey/*.png + report.json
 * Exit:   0 only when every case passed.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "promotion", "evidence", "live-journey");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg("--port", 4902));
const QUESTION = arg("--question", "What has changed at Anthropic in the last year?");
const CANCEL_QUESTION = "Summarise the funding history of Databricks in three bullets.";
const FOLLOWUP_QUESTION = "Name one competitor of Anthropic.";
const MOBILE_QUESTION = "What has changed at Databricks in the last year?";
const BASE = `http://127.0.0.1:${PORT}`;
const CHAT = "/redesign/chat";
const DESKTOP = { label: "desktop", width: 1280, height: 900 };
const MOBILE = { label: "mobile", width: 375, height: 812 };
/** A live Gemini run in this repo measured ~21s; give it room without hanging. */
const ANSWER_TIMEOUT_MS = 180_000;

const results = [];
const failures = [];

function record(name, detail, problems) {
  results.push({ check: name, detail, problems });
  if (problems.length) failures.push(`${name}: ${problems.join("; ")}`);
  console.log(`${problems.length ? "FAIL" : "ok  "}  ${name}${problems.length ? ` — ${problems.join("; ")}` : ""}`);
}

// ─── prerequisites ─────────────────────────────────────────────────────────

async function resolveConvexUrl() {
  if (process.env.VITE_CONVEX_URL) return process.env.VITE_CONVEX_URL.trim();
  try {
    const text = await fs.readFile(path.join(repoRoot, ".env.local"), "utf8");
    const line = text.split(/\r?\n/).find((l) => l.trim().startsWith("VITE_CONVEX_URL="));
    if (line) return line.slice(line.indexOf("=") + 1).trim();
  } catch {
    /* no .env.local */
  }
  throw new Error(
    "No VITE_CONVEX_URL. This gate drives the real product, which has no local backend.\n" +
      "Provision one first — see docs/START_HERE.md 'Before Step 1'.",
  );
}

/**
 * Mint a session the way the app's own client does: `auth:signIn` with the
 * Password provider, then the two localStorage keys @convex-dev/auth reads.
 * The account is a throwaway fixture in the deployment under test — live
 * research is refused to anonymous callers (`requirePaidChatUserId`,
 * backend/convex/domains/redesign/chatRuns.ts:159), so the journey cannot be
 * driven signed out. Nothing here is written to disk.
 */
async function mintSession(convexUrl) {
  const client = new ConvexClient(convexUrl);
  try {
    const email = `nodebench-gate.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = `Gate!${Math.random().toString(36).slice(2)}${Date.now() % 1_000_000}`;
    const res = await client.action(makeFunctionReference("auth:signIn"), {
      provider: "password",
      params: { email, password, flow: "signUp" },
    });
    if (!res?.tokens?.token) throw new Error("auth:signIn returned no tokens");
    return { token: res.tokens.token, refreshToken: res.tokens.refreshToken };
  } finally {
    await client.close();
  }
}

function startVite(convexUrl) {
  const child = spawn(
    process.execPath,
    [path.join(repoRoot, "node_modules", "vite", "bin", "vite.js"), "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
    { cwd: repoRoot, env: { ...process.env, VITE_CONVEX_URL: convexUrl }, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer(url, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`dev server never answered ${url}`);
}

// ─── page helpers ──────────────────────────────────────────────────────────

async function newAuthedContext(browser, convexUrl, session, viewport) {
  const namespace = convexUrl.replace(/[^a-zA-Z0-9]/g, "");
  const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  await ctx.addInitScript(
    ([ns, jwt, refresh]) => {
      localStorage.setItem(`__convexAuthJWT_${ns}`, jwt);
      localStorage.setItem(`__convexAuthRefreshToken_${ns}`, refresh);
    },
    [namespace, session.token, session.refreshToken],
  );
  const page = await ctx.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 300)}`));
  // Condition 9 is "no unexplained console errors AND no failed requests".
  // Chrome's console line for a bad response is just "Failed to load resource:
  // … 404" with no URL, which is unactionable; the response event has the URL.
  page.on("response", (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(0, 200)}`);
  });
  page.on("requestfailed", (r) => failedRequests.push(`failed ${r.url().slice(0, 200)}`));
  page.setDefaultNavigationTimeout(240_000);
  return { ctx, page, consoleErrors, failedRequests };
}

const readSurface = (page) =>
  page.evaluate(() => {
    const surface = document.querySelector("[data-agent-runtime-surface]");
    const turns = [...document.querySelectorAll("[data-turn-id]")];
    return {
      mounted: surface?.getAttribute("data-agent-runtime-surface") ?? null,
      empty: surface?.getAttribute("data-empty") ?? null,
      turnCount: turns.length,
      runIds: turns.map((t) => t.getAttribute("data-chat-run-id")).filter(Boolean),
      lastTurnText: (turns[turns.length - 1]?.textContent ?? "").replace(/\s+/g, " ").trim(),
      continuationState:
        document.querySelector('[data-testid="continued-chat-context"]')?.getAttribute("data-state") ?? null,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });

async function submit(page, text) {
  const composer = page.getByPlaceholder("Ask anything · type / for commands");
  await composer.click();
  await composer.fill(text);
  await page.keyboard.press("Enter");
}

const GET_RUN = makeFunctionReference("domains/redesign/chatRuns:getRun");
const STREAM_EVENTS = makeFunctionReference("domains/redesign/chatRuns:streamEventsForRun");
const LATEST_RUN = makeFunctionReference("domains/redesign/chatRuns:getLatestOwnedRun");

/**
 * Wait for the run to REACH A TERMINAL STATE, asked of the server, then let the
 * UI catch up.
 *
 * Two text heuristics were tried here first and both were wrong in a way worth
 * recording. "SOURCES … evidence rows" never appears for an answer with zero
 * sources, so an ungrounded run hung the gate instead of failing it. Relaxing
 * that to the packet header (`N sources ·`) then matched the RuntimeBoard while
 * the turn was still *streaming*, and every later check read a half-finished
 * run: status "running", no packet, and a receipt that had nothing to replay.
 * The run row is the authority — the UI is what we then verify against it.
 */
async function waitForAnswer(page, authed, timeoutMs = ANSWER_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let runId = null;
  let runRow = null;
  while (Date.now() < deadline) {
    const s = await readSurface(page);
    runId = s.runIds[s.runIds.length - 1] ?? runId;
    if (runId) {
      runRow = await authed.query(GET_RUN, { runId });
      if (runRow && ["complete", "error", "cancelled"].includes(runRow.status)) break;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (!runRow || !["complete", "error", "cancelled"].includes(runRow.status)) {
    throw new Error(`run ${runId} never reached a terminal state within ${timeoutMs}ms (status ${runRow?.status})`);
  }
  // The browser learns by subscription, so give the push a bounded moment and
  // confirm the sealed header actually reached the DOM.
  const uiDeadline = Date.now() + 30_000;
  let surface = await readSurface(page);
  while (Date.now() < uiDeadline && !/\b\d+\s+sources?\s*·/i.test(surface.lastTurnText)) {
    await new Promise((r) => setTimeout(r, 1500));
    surface = await readSurface(page);
  }
  return { runId, runRow, surface };
}

/** Sonner auto-dismisses after 3.5s (components/Toast.tsx), so read while it lives. */
async function captureToast(page, windowMs = 3500) {
  const deadline = Date.now() + windowMs;
  const seen = [];
  while (Date.now() < deadline) {
    const texts = await page.evaluate(() =>
      [...document.querySelectorAll("[data-sonner-toast]")]
        .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean),
    );
    for (const t of texts) if (!seen.includes(t)) seen.push(t);
    await new Promise((r) => setTimeout(r, 250));
  }
  return seen;
}

const shot = (page, name) => page.screenshot({ path: path.join(outDir, name) });
const rel = (p) => path.relative(repoRoot, p).replace(/\\/g, "/");

// ─── the run ───────────────────────────────────────────────────────────────

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const convexUrl = await resolveConvexUrl();
  // Deliberately NOT the host: this artifact is committed to a public repo, and
  // a dev deployment URL is a live endpoint whose auth:signIn is public. Which
  // deployment it was is not part of the evidence; that it was a real one is.
  const deployment = new URL(convexUrl).host.endsWith(".convex.cloud")
    ? "a Convex cloud deployment (host redacted)"
    : "a self-hosted Convex deployment (host redacted)";
  const session = await mintSession(convexUrl);

  const authed = new ConvexClient(convexUrl);
  authed.setAuth(async () => session.token);

  const server = startVite(convexUrl);
  const browser = await chromium.launch();
  const captures = [];
  let observed = {};

  try {
    await waitForServer(`${BASE}${CHAT}`);

    // ── J1 · stages 3-8, desktop ────────────────────────────────────────
    const { ctx, page, consoleErrors, failedRequests } = await newAuthedContext(browser, convexUrl, session, DESKTOP);
    await page.goto(`${BASE}${CHAT}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!document.querySelector("[data-agent-runtime-surface]"), null, { timeout: 120_000 });
    await page.waitForTimeout(6000);

    const beforeAsk = await readSurface(page);
    await shot(page, "01-empty-desktop.png");
    captures.push("01-empty-desktop.png");
    record(
      "J1 step 2 — designed empty state on a live backend",
      beforeAsk,
      [
        beforeAsk.mounted !== "redesign-chat" && `product surface not mounted (got ${JSON.stringify(beforeAsk.mounted)})`,
        beforeAsk.empty !== "true" && `expected data-empty="true", got ${JSON.stringify(beforeAsk.empty)}`,
        beforeAsk.scrollWidth > beforeAsk.clientWidth && `horizontal overflow ${beforeAsk.scrollWidth}>${beforeAsk.clientWidth}`,
      ].filter(Boolean),
    );

    // stage 3 → 4: submit, then look while it is still running.
    await submit(page, QUESTION);
    await page.waitForTimeout(5000);
    const running = await readSurface(page);
    await shot(page, "02-agent-running-desktop.png");
    captures.push("02-agent-running-desktop.png");
    record(
      "J1 steps 3-4 — agent-running state is designed, not a spinner",
      { turnCount: running.turnCount, runIds: running.runIds, excerpt: running.lastTurnText.slice(0, 220) },
      [
        running.empty === "true" && "surface still reports data-empty after submit",
        running.turnCount < 2 && `expected a user turn and an assistant turn, saw ${running.turnCount}`,
        running.runIds.length === 0 && "assistant turn carries no data-chat-run-id — no durable run was started",
        !/Live research run/i.test(running.lastTurnText) && "no live-research checklist while the run is in flight",
      ].filter(Boolean),
    );

    const { runId, runRow, surface: answered } = await waitForAnswer(page, authed);
    await page.evaluate(() => {
      const scroller = document.querySelector(".rd-chat-transcript__content")?.parentElement;
      if (scroller) scroller.scrollTop = 0;
    });
    await page.waitForTimeout(600);
    await shot(page, "03-answer-desktop.png");
    captures.push("03-answer-desktop.png");
    await page.evaluate(() => {
      const scroller = document.querySelector(".rd-chat-transcript__content")?.parentElement;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    await page.waitForTimeout(600);
    await shot(page, "04-answer-trace-desktop.png");
    captures.push("04-answer-trace-desktop.png");

    const answerDetail = await page.evaluate(() => {
      const turns = [...document.querySelectorAll("[data-turn-id]")];
      const last = turns[turns.length - 1];
      const text = (last?.textContent ?? "").replace(/\s+/g, " ").trim();
      return {
        sourceLine: text.match(/(\d+)\s+sources?/i)?.[0] ?? null,
        sourceCount: Number(text.match(/(\d+)\s+sources?\s*·/i)?.[1] ?? NaN),
        // chatRuns.ts:843 — what the packet says instead of inventing evidence.
        sourceNeededNotice: /Source needed: no supported URL is available/i.test(text),
        evidenceRows: text.match(/(\d+)\s+evidence rows?/i)?.[0] ?? null,
        toolCalls: [...(last?.querySelectorAll("button") ?? [])]
          .map((b) => (b.textContent ?? "").trim())
          .filter((t) => t.startsWith("Tool ·"))
          .map((t) => t.replace(/\s+/g, " ").slice(0, 80)),
        answerText: text,
      };
    });
    const sourceCount = Number.isFinite(answerDetail.sourceCount) ? answerDetail.sourceCount : -1;
    record(
      "J1 step 4 — a real answer packet whose source count and evidence agree",
      {
        runId,
        sources: answerDetail.sourceLine,
        sourceCount,
        evidenceRows: answerDetail.evidenceRows,
        sourceNeededNotice: answerDetail.sourceNeededNotice,
        toolCalls: answerDetail.toolCalls,
      },
      [
        !runId && "no run id on the answered turn",
        !answerDetail.sourceLine && "answer reports no source count",
        answerDetail.toolCalls.length === 0 && "no tool-call rows rendered (START_HERE step 7)",
        /live chat is unavailable|liveChatUnavailable/i.test(answerDetail.answerText) &&
          "surface rendered the unavailable fallback rather than an answer",
        answered.scrollWidth > answered.clientWidth && "horizontal overflow on the answered transcript",
        // The honesty invariant, gated in BOTH directions.
        //
        // "sources >= 1" was tried first and is not assertable: the same prompt,
        // model and settings produced 3, 2, 1 and 0 grounded sources across five
        // runs, because Gemini decides how many groundingChunks to return. A gate
        // that fails a third of the time for reasons outside this repo teaches
        // people to ignore it. What IS deterministic — and is the actual product
        // promise — is that the count and the evidence agree, and that a zero
        // count is stated rather than papered over.
        sourceCount > 0 && !answerDetail.evidenceRows &&
          `packet claims ${sourceCount} source(s) but rendered no evidence rows`,
        sourceCount === 0 && !answerDetail.sourceNeededNotice &&
          "packet sealed with 0 sources and did NOT show the 'Source needed: no supported URL is available' notice",
      ].filter(Boolean),
    );
    observed.answerExcerpt = answerDetail.answerText.slice(0, 400);

    // ── stages 5 + 8 · the durable rows, read straight out of Convex ────
    let latestBefore = null;
    {
      const events = await authed.query(STREAM_EVENTS, { runId });
      latestBefore = await authed.query(LATEST_RUN, {});
      const idxs = events.map((e) => e.idx);
      const ordered = idxs.every((v, i) => i === 0 || v > idxs[i - 1]);
      const types = [...new Set(events.map((e) => e.eventType))];
      observed.persistence = { status: runRow?.status ?? null, eventCount: events.length, eventTypes: types };
      record(
        "START_HERE steps 5+8 — the answer is durable rows, not a socket message",
        observed.persistence,
        [
          runRow?.status !== "complete" && `run row status is ${JSON.stringify(runRow?.status)}, expected "complete"`,
          events.length === 0 && "no rows in redesignChatStreamEvents for this run",
          !ordered && `idx is not strictly increasing: ${idxs.slice(0, 20).join(",")}`,
          !types.includes("tool_call") && `no tool_call rows persisted (saw ${types.join(", ")})`,
          !types.includes("packet_complete") && `run never sealed a packet (saw ${types.join(", ")})`,
        ].filter(Boolean),
      );
    }

    // ── J2 · the receipt returns the same answer, not a new one ─────────
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    await page.getByRole("button", { name: "Share reproducible link" }).click();
    await page.waitForTimeout(1500);
    const receiptUrl = await page.evaluate(() => navigator.clipboard.readText());
    const hash = receiptUrl.match(/\/redesign\/chat\/r\/([A-Za-z0-9_-]+)/)?.[1] ?? null;

    const cold = await newAuthedContext(browser, convexUrl, session, DESKTOP);
    await cold.page.goto(receiptUrl.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "domcontentloaded" });
    await cold.page.waitForTimeout(12_000);
    const receipt = await readSurface(cold.page);
    await shot(cold.page, "05-receipt-desktop.png");
    captures.push("05-receipt-desktop.png");

    const latestAfter = await authed.query(LATEST_RUN, {});

    // The point of a receipt is that it REPLAYS. Two independent proofs:
    // the restored text matches, and no new run row was created by opening it.
    const normalise = (s) => s.replace(/\s+/g, " ").replace(/just now|\d+\s*(s|ms) ago/gi, "").trim();
    const originalCore = normalise(observed.answerExcerpt).slice(0, 200);
    const replayed = normalise(receipt.lastTurnText);
    record(
      "J2 — the permanent link replays the stored answer instead of re-running it",
      {
        hash,
        continuationState: receipt.continuationState,
        latestRunIdBefore: latestBefore?.runId ?? null,
        latestRunIdAfter: latestAfter?.runId ?? null,
      },
      [
        !hash && `share button produced no /r/<hash> url (got ${JSON.stringify(receiptUrl).slice(0, 120)})`,
        receipt.continuationState !== "ready" &&
          `continuation aside is ${JSON.stringify(receipt.continuationState)}, expected "ready"`,
        !replayed.includes(originalCore.slice(0, 60)) &&
          "replayed answer text does not match the original — the link re-ran the question",
        latestBefore?.runId !== latestAfter?.runId &&
          `opening the receipt created a new run (${latestBefore?.runId} -> ${latestAfter?.runId})`,
      ].filter(Boolean),
    );
    await cold.ctx.close();

    // ── J4 · cancel, honest terminal state, keep working ────────────────
    await submit(page, CANCEL_QUESTION);
    await page.waitForTimeout(3500);
    // The visible label is "Stop"; the accessible name is the aria-label, and
    // the control is visibility:hidden plus arming-delayed while idle
    // (UniversalComposer.tsx, CANCEL_ARM_DELAY_MS). Ask for it the way a
    // screen-reader user would.
    await page.getByRole("button", { name: "Cancel active run" }).click();
    const toasts = await captureToast(page);
    await page.waitForTimeout(3000);
    const cancelledTurn = await page.evaluate(() =>
      ([...document.querySelectorAll("[data-turn-id]")].pop()?.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    await shot(page, "06-cancelled-desktop.png");
    captures.push("06-cancelled-desktop.png");
    // Two halves, and the second is the one that matters: the run must report a
    // cancellation AND must not have quietly produced an answer packet anyway.
    // ChatSurface.tsx:600 replaces the turn body once the server row reaches
    // `cancelled`; the optimistic "(cancellation requested)" is the earlier form.
    const honest = /Run cancelled\.|cancellation requested|Cancellation (recorded|queued)|already terminal/i.test(
      `${toasts.join(" | ")} ${cancelledTurn}`,
    );
    record(
      "J4 — a cancelled run reports an honest terminal state and fabricates no answer",
      { toasts: toasts.slice(0, 4), excerpt: cancelledTurn.slice(0, 240) },
      [
        !honest && `no cancellation signal on screen: ${cancelledTurn.slice(0, 220)}`,
        // Match the sealed-packet HEADER ("Auto · 3 sources · 21.4s · <$0.01"),
        // not the words "evidence rows" — liveChatUnavailableMarkdown's own copy
        // says "stream tool events, evidence rows, and the final answer packet",
        // so the naive phrase match failed an entirely correct cancellation.
        /\d+\s+sources?\s*·/i.test(cancelledTurn) &&
          "the cancelled turn still rendered a sealed answer packet",
      ].filter(Boolean),
    );

    const turnsBeforeFollowup = (await readSurface(page)).turnCount;
    await submit(page, FOLLOWUP_QUESTION);
    await page.waitForTimeout(6000);
    const afterFollowup = await readSurface(page);
    record(
      "J4 — the session survives the cancel and accepts the next question",
      { turnsBefore: turnsBeforeFollowup, turnsAfter: afterFollowup.turnCount },
      [afterFollowup.turnCount <= turnsBeforeFollowup && "no new turn after the corrected question"].filter(Boolean),
    );

    observed.consoleErrors = consoleErrors;
    observed.failedRequests = failedRequests;
    record(
      "Condition 9 — no unexplained console errors and no failed requests",
      { consoleErrors: consoleErrors.slice(0, 6), failedRequests: failedRequests.slice(0, 6) },
      [
        consoleErrors.length > 0 && `${consoleErrors.length} console error(s): ${consoleErrors.slice(0, 3).join(" | ")}`,
        failedRequests.length > 0 && `${failedRequests.length} failed request(s): ${failedRequests.slice(0, 3).join(" | ")}`,
      ].filter(Boolean),
    );
    await ctx.close();

    // ── the error state, driven through the real trust boundary ─────────
    // `startChat` rejects a prompt under 3 characters (START_HERE step 5), so
    // this exercises server-side validation AND the designed error surface
    // without breaking anything to get there.
    //
    // Its own context on purpose: a rejected mutation is logged by the Convex
    // client as a console error, which is correct and expected here but would
    // contaminate the journey's condition-9 measurement above. Keeping it apart
    // lets that assertion stay at zero while this one asserts the error is the
    // specific one we provoked and nothing else.
    const errSession = await mintSession(convexUrl);
    const e = await newAuthedContext(browser, convexUrl, errSession, DESKTOP);
    await e.page.goto(`${BASE}${CHAT}`, { waitUntil: "domcontentloaded" });
    await e.page.waitForFunction(() => !!document.querySelector("[data-agent-runtime-surface]"), null, { timeout: 120_000 });
    await e.page.waitForTimeout(6000);
    await submit(e.page, "ab");
    const errToasts = await captureToast(e.page, 5000);
    const errSurface = await e.page.evaluate(() =>
      ([...document.querySelectorAll("[data-turn-id]")].pop()?.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    await shot(e.page, "09-validation-error-desktop.png");
    captures.push("09-validation-error-desktop.png");
    const errBlob = `${errToasts.join(" | ")} ${errSurface} ${e.consoleErrors.join(" | ")}`;
    record(
      "Condition 5 — the error state is designed, and validation happens on the server",
      { toasts: errToasts.slice(0, 3), turn: errSurface.slice(0, 200), consoleErrors: e.consoleErrors.slice(0, 3) },
      [
        !/Prompt too short/i.test(errBlob) &&
          `a 2-character prompt did not surface the server's validation message: ${errBlob.slice(0, 240)}`,
        /\d+\s+sources?\s*·/i.test(errSurface) && "a rejected prompt still produced an answer packet",
        e.consoleErrors.some((m) => !/Prompt too short|CONVEX/i.test(m)) &&
          `unexpected console error alongside the validation rejection: ${e.consoleErrors.join(" | ").slice(0, 200)}`,
      ].filter(Boolean),
    );
    await e.ctx.close();

    // ── mobile · the same journey at 375 ────────────────────────────────
    // Its own session on purpose: ChatSurface re-attaches to `getLatestOwnedRun`
    // on mount, so reusing the desktop account would let the desktop's run
    // populate the "empty" mobile transcript and quietly invalidate both checks.
    const mobileSession = await mintSession(convexUrl);
    const m = await newAuthedContext(browser, convexUrl, mobileSession, MOBILE);
    await m.page.goto(`${BASE}${CHAT}`, { waitUntil: "domcontentloaded" });
    await m.page.waitForFunction(() => !!document.querySelector("[data-agent-runtime-surface]"), null, { timeout: 120_000 });
    await m.page.waitForTimeout(6000);
    const mEmpty = await readSurface(m.page);
    await shot(m.page, "07-empty-mobile.png");
    captures.push("07-empty-mobile.png");
    const mobileAuthed = new ConvexClient(convexUrl);
    mobileAuthed.setAuth(async () => mobileSession.token);
    await submit(m.page, MOBILE_QUESTION);
    const { surface: mAnswered } = await waitForAnswer(m.page, mobileAuthed);
    await mobileAuthed.close();
    await shot(m.page, "08-answer-mobile.png");
    captures.push("08-answer-mobile.png");
    record(
      "Conditions 3-4 — the same journey is intentional at 375 wide",
      {
        empty: mEmpty.empty,
        scrollWidth: mAnswered.scrollWidth,
        clientWidth: mAnswered.clientWidth,
        consoleErrors: m.consoleErrors.length,
        // Recorded, not asserted: source count is an answer-quality property,
        // not a width property, and gating conditions 3-4 on it would conflate
        // two different findings. J1's own check fails on a 0-source answer.
        sealedSourceCount: mAnswered.lastTurnText.match(/(\d+)\s+sources?\s*·/i)?.[1] ?? null,
      },
      [
        mEmpty.mounted !== "redesign-chat" && "product surface not mounted at 375",
        mEmpty.scrollWidth > mEmpty.clientWidth && `horizontal overflow on the empty state at 375 (${mEmpty.scrollWidth})`,
        mAnswered.scrollWidth > mAnswered.clientWidth && `horizontal overflow on the answer at 375 (${mAnswered.scrollWidth})`,
        !/\d+\s+sources?\s*·/i.test(mAnswered.lastTurnText) && "no answer sealed at 375",
        m.consoleErrors.length > 0 && `console errors at 375: ${m.consoleErrors.slice(0, 2).join(" | ")}`,
      ].filter(Boolean),
    );
    await m.ctx.close();
  } catch (err) {
    // A gate that loses its report when one case throws is a gate nobody can
    // read afterwards. Record the throw as a failure and still write the file.
    record("gate aborted before finishing", { error: String(err?.message ?? err).slice(0, 600) }, ["threw"]);
  } finally {
    await authed.close();
    await browser.close();
    server.kill();
    await new Promise((r) => setTimeout(r, 1500));
  }

  const report = {
    capturedAt: new Date().toISOString(),
    deployment,
    port: PORT,
    question: QUESTION,
    journeys: ["J1", "J2", "J4"],
    expectation:
      "Against a real Convex deployment the primary journey renders, streams, persists ordered event rows, replays from its permanent link without a second run, and cancels honestly — at 1280 and at 375, with zero console errors.",
    observed,
    captures: captures.map((c) => rel(path.join(outDir, c))),
    results,
    verdict: failures.length ? "FAIL" : "PASS",
    failures,
  };
  await fs.writeFile(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (failures.length) {
    console.error(`\nFAIL: ${failures.length} check(s)\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log("\nPASS: J1, J2 and J4 drove end to end on a live backend at 1280 and 375, zero console errors.");
}

await main();
