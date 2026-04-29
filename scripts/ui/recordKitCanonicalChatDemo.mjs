#!/usr/bin/env node
/**
 * recordKitCanonicalChatDemo.mjs — capture a walkthrough video that
 * demonstrates every kit-canonical affordance ported in PR #207:
 *
 *   1. Composer compression (visible by chat scroll area dominating viewport)
 *   2. ReasoningTrace expand/collapse (.nb-trace)
 *   3. Branches selector switching active branch (.nb-turn-branches)
 *   4. ActionChips post-answer row (.nb-turn-chips)
 *   5. Receipts block under answer (.nb-turn-receipts)
 *   6. Sources strip with +N more overflow (.nb-turn-sources, .nb-src-chip-more)
 *   7. UserTurn edit/copy actions on hover (.nb-turn-actions)
 *   8. Composer lanes — Answer / Deep dive / Admin (.nb-composer-lanes)
 *   9. Quote-on-selection popover (.nb-quote-pop)
 *  10. Toggleable rails (.nb-chat-threads-rail, .nb-chat-context-rail)
 *
 * Output: public/dogfood/kit-canonical-chat-demo.webm
 *
 * Run: node scripts/ui/recordKitCanonicalChatDemo.mjs
 *      BASE_URL=http://127.0.0.1:5200 node scripts/ui/recordKitCanonicalChatDemo.mjs
 */

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5200";
const OUT_DIR = path.resolve(process.cwd(), "public", "dogfood");
const OUT_NAME = "kit-canonical-chat-demo.webm";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: OUT_DIR,
      size: { width: 1440, height: 900 },
    },
  });

  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[browser]", msg.text());
  });

  console.log(`▶ navigating to ${BASE_URL}/?surface=workspace`);
  await page.goto(`${BASE_URL}/?surface=workspace`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="exact-web-chat-stream"]', { timeout: 15_000 });
  await sleep(2000);

  console.log("▶ scene 1 — viewport overview");
  await sleep(1500);

  console.log("▶ scene 2 — answer header badges + reasoning trace expand");
  await page.evaluate(() => {
    const t = document.querySelector('.nb-turn[data-role="agent"] .nb-trace-head');
    t?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await sleep(1200);
  await page.click('.nb-trace-head', { timeout: 5_000 }).catch(() => {});
  await sleep(2000);

  console.log("▶ scene 3 — branches: switch active branch");
  await page.evaluate(() => {
    document.querySelector('.nb-turn-branches')?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await sleep(1500);
  await page.click('.nb-turn-branches .nb-branch:nth-child(3)').catch(() => {});
  await sleep(1200);
  await page.click('.nb-turn-branches .nb-branch:nth-child(4)').catch(() => {});
  await sleep(1200);

  console.log("▶ scene 4 — sources strip (visible alongside branches)");
  await page.evaluate(() => {
    document.querySelector('.nb-turn-sources')?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await sleep(1500);

  console.log("▶ scene 5 — receipts row");
  await page.evaluate(() => {
    document.querySelector('.nb-turn-receipts')?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await sleep(1500);

  console.log("▶ scene 6 — action chips post-answer");
  await page.evaluate(() => {
    document.querySelector('.nb-turn-chips')?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await sleep(1500);

  console.log("▶ scene 7 — user turn edit affordance (hover)");
  await page.evaluate(() => {
    document.querySelector('.nb-turn[data-role="user"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await sleep(800);
  await page.hover('.nb-turn[data-role="user"]:first-of-type', { timeout: 2_500 }).catch(() => {});
  await sleep(2000);

  console.log("▶ scene 8 — composer hover (chips + badges reveal)");
  await page.evaluate(() => {
    document.querySelector('.nb-stream-composer')?.scrollIntoView({ behavior: "smooth", block: "end" });
  });
  await sleep(1000);
  // Hover an agent turn to reveal the gated chips + badges
  await page.hover('.nb-turn[data-role="agent"]:nth-of-type(2)').catch(() => {});
  await sleep(1800);
  await page.hover('.nb-turn[data-role="user"]:first-of-type').catch(() => {});
  await sleep(1500);

  console.log("▶ scene 9 — quote-on-selection popover");
  await page.evaluate(() => {
    const target = document.querySelector('.nb-turn[data-role="agent"] .nb-turn-text p');
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await sleep(1200);
  await page.evaluate(() => {
    const target = document.querySelector('.nb-turn[data-role="agent"] .nb-turn-text p');
    if (!target) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await sleep(2200);
  // Dismiss popover by clicking outside selection
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await sleep(800);

  console.log("▶ scene 10 — toggle threads rail");
  await page.click('.nb-rail-toggle[aria-label*="thread" i]').catch(() => {});
  await sleep(1500);
  await page.click('.nb-stream-backdrop').catch(() => {});
  await sleep(1200);

  console.log("▶ scene 11 — toggle context rail");
  await page.click('.nb-rail-toggle[aria-label*="context" i]').catch(() => {});
  await sleep(1500);
  await page.click('.nb-stream-backdrop').catch(() => {});
  await sleep(1200);

  console.log("▶ closing context to flush video");
  const videoHandle = page.video();
  await context.close();
  await browser.close();

  const tempPath = videoHandle ? await videoHandle.path() : null;
  if (tempPath) {
    const finalPath = path.join(OUT_DIR, OUT_NAME);
    if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
    fs.renameSync(tempPath, finalPath);
    const stat = fs.statSync(finalPath);
    console.log(`✓ video saved: ${finalPath} (${(stat.size / 1024).toFixed(1)} KB)`);
  } else {
    console.warn("! video path unavailable");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
