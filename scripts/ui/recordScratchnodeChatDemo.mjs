#!/usr/bin/env node
/**
 * Record a read-only walkthrough of the LIVE ScratchNode chat (web + mobile)
 * for Gemini video-understanding QA. Captures the deployed product as a real
 * user sees it — colored avatars, author grouping, the ScratchNode bot answers,
 * an expanded trace, and (mobile) the bottom-pinned composer.
 *
 * Read-only: scroll / hover / expand only. NO /ask, NO writes — the public
 * showcase room is never polluted.
 *
 * Usage:
 *   node scripts/ui/recordScratchnodeChatDemo.mjs [--url <liveUrl>] [--out <dir>]
 *
 * Output: <out>/scratchnode-chat-desktop.webm, <out>/scratchnode-chat-mobile.webm
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const URL = getArg("--url", "https://scratchnode.live/e/ai-infra-summit-2026");
const OUT = path.resolve(getArg("--out", ".tmp/scratchnode-demo"));
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Slowly scroll an element/window so the clip is watchable (not a jump-cut). */
async function smoothScroll(page, totalPx, steps, perStepMs) {
  const per = Math.round(totalPx / steps);
  for (let i = 0; i < steps; i++) {
    await page.evaluate((y) => {
      const sc = document.scrollingElement || document.documentElement;
      sc.scrollTop += y;
    }, per);
    await sleep(perStepMs);
  }
}

const roomReadyStates = [
  { selector: "#feed .row", state: "populated_feed" },
  { selector: "#feed .ans", state: "agent_answer" },
  { selector: ".empty", state: "empty_feed" },
  { selector: "#ci[placeholder*='Live room unavailable']", state: "unavailable_composer" },
  { selector: ".c-box", state: "composer_shell" },
  { selector: ".h-code", state: "room_header" },
];

async function firstVisibleSelector(page, candidates, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const candidate of candidates) {
      const locator = page.locator(candidate.selector).first();
      const count = await locator.count().catch(() => 0);
      if (count < 1) continue;
      const visible = await locator.isVisible().catch(() => false);
      if (visible) return candidate;
    }
    await sleep(250);
  }
  return null;
}

async function captureLayoutSignal(page) {
  return page.evaluate(() => {
    const composer = document.querySelector(".c");
    const rect = composer ? composer.getBoundingClientRect() : null;
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || "1") > 0
        && box.width > 0
        && box.height > 0
        && box.bottom > 0
        && box.top < window.innerHeight
        && box.right > 0
        && box.left < window.innerWidth;
    };
    const chipSelectors = [
      ".h-live",
      ".h-code",
      ".h-menu",
      ".sn-room-toggle",
      ".id-set",
      ".id-notes",
      ".about-link",
      ".event-strip .ev-mode",
      ".event-strip .ev-cap",
      ".event-strip .la-toggle",
      ".event-strip .ev-link",
    ];
    const chipNodes = Array.from(document.querySelectorAll(chipSelectors.join(",")))
      .filter(isVisible);
    const labelFor = (el) => {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text) return text.slice(0, 48);
      const aria = (el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      if (aria) return aria.slice(0, 48);
      if (el.id) return `#${el.id}`.slice(0, 48);
      const className = typeof el.className === "string" ? el.className : "";
      return className ? `.${className.split(/\s+/).filter(Boolean).join(".")}`.slice(0, 48) : el.tagName.toLowerCase();
    };
    const headerChrome = {
      liveVisible: isVisible(document.querySelector(".h-live")),
      roomCodeVisible: isVisible(document.querySelector(".h-code")),
      eventTitleVisible:
        isVisible(document.querySelector("#sn-event-title-hero"))
        || isVisible(document.querySelector("#sn-event-title-strip")),
      visibleChipCount: chipNodes.length,
      visibleChipLabels: chipNodes.map(labelFor),
    };
    const viewport = {
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight),
    };
    const bottomDeltaPx = rect ? Math.round(viewport.height - rect.bottom) : null;
    return {
      pageMode: document.body?.dataset?.pageMode || null,
      scrollY: Math.round(window.scrollY),
      viewport,
      composer: rect
        ? {
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            height: Math.round(rect.height),
          }
        : null,
      composerPosition: composer ? window.getComputedStyle(composer).position : null,
      composerBottomDeltaPx: bottomDeltaPx,
      composerPinnedToViewportBottom: bottomDeltaPx == null ? null : Math.abs(bottomDeltaPx) <= 2,
      headerChrome,
    };
  });
}

async function waitForChat(page, label) {
  const ready = await firstVisibleSelector(page, roomReadyStates, 25000);
  if (!ready) {
    const selectors = roomReadyStates.map((candidate) => candidate.selector).join(", ");
    throw new Error(`[${label}] no room-ready selector appeared (${selectors}) - room did not load at ${URL}`);
  }
  // Give decorateRow + Convex a beat to paint avatars/grouping.
  await sleep(2500);
  const feedRows = await page.locator("#feed .row").count();
  const answerCards = await page.locator("#feed .ans").count();
  const avatars = await page.locator("#feed .row-avatar").count();
  const ansBots = await page.locator("#feed .ans-bot").count();
  const emptyFeed = await page.locator(".empty").first().isVisible().catch(() => false);
  const unavailableComposer = (await page.locator("#ci[placeholder*='Live room unavailable']").count()) > 0;
  await page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await sleep(250);
  const layout = await captureLayoutSignal(page);
  return {
    state: ready.state,
    readySelector: ready.selector,
    feedRows,
    answerCards,
    avatars,
    ansBots,
    emptyFeed,
    unavailableComposer,
    layout,
  };
}

async function recordViewport({ browser, name, viewport, mobile }) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: !!mobile,
    hasTouch: !!mobile,
    recordVideo: { dir: OUT, size: viewport },
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  let signal = { state: "unknown", avatars: 0, ansBots: 0 };
  let videoPath = null;
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    signal = await waitForChat(page, name);
    // Establish the room: let the top (identity + first messages) breathe.
    await sleep(1800);
    // Walk the conversation slowly so avatars / grouping / bot answers are visible.
    await smoothScroll(page, mobile ? 900 : 1100, 9, 420);
    await sleep(1000);
    // Expand the first "Show trace" to reveal the trace UI.
    const trace = page.locator("#feed .ans-show, #feed .ans button", { hasText: /show trace/i }).first();
    if (await trace.count()) {
      try {
        await trace.scrollIntoViewIfNeeded();
        await sleep(600);
        await trace.click({ timeout: 4000 });
        await sleep(1800);
      } catch { /* trace optional */ }
    }
    await smoothScroll(page, mobile ? 700 : 800, 7, 420);
    await sleep(1200);
  } finally {
    const v = page.video();
    await ctx.close(); // flush video
    if (v) videoPath = await v.path().catch(() => null);
  }
  return { name, viewport, videoPath, signal, consoleErrors };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    results.push(await recordViewport({ browser, name: "desktop", viewport: { width: 1280, height: 800 }, mobile: false }));
    results.push(await recordViewport({ browser, name: "mobile", viewport: { width: 390, height: 844 }, mobile: true }));
  } finally {
    await browser.close();
  }
  // Rename the auto-generated video files to stable names.
  const out = {};
  for (const r of results) {
    if (r.videoPath && fs.existsSync(r.videoPath)) {
      const dest = path.join(OUT, `scratchnode-chat-${r.name}.webm`);
      fs.renameSync(r.videoPath, dest);
      out[r.name] = { path: dest, ...r.signal, consoleErrors: r.consoleErrors.length };
    } else {
      out[r.name] = { path: null, error: "no video produced", ...r.signal };
    }
  }
  console.log(JSON.stringify({ url: URL, outDir: OUT, results: out }, null, 2));
})().catch((e) => {
  console.error("RECORD_FAILED:", e && e.message);
  process.exit(1);
});
