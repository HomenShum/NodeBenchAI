#!/usr/bin/env node
/**
 * recordChatSprintsDemo.mjs
 *
 * Records a Playwright walkthrough of the 11 chat enhancements shipped
 * in Sprints 1-4 (PRs #246, #247, #248, #249). Renders to .tmp/chat-sprints-demo/.
 *
 * Pattern mirrors scripts/ui/recordDogfoodWalkthrough.mjs:
 *   1. Persistent context with video dir
 *   2. Pace each scene with explicit waits so the recorded video reads
 *   3. Optional ffmpeg transcode to GIF if ffmpeg is on PATH
 *
 * Usage:
 *   node scripts/ui/recordChatSprintsDemo.mjs --baseURL https://www.nodebenchai.com
 *
 * Output:
 *   .tmp/chat-sprints-demo/chat-sprints-demo.webm   (Playwright native)
 *   .tmp/chat-sprints-demo/chat-sprints-demo.mp4    (if ffmpeg available)
 *   .tmp/chat-sprints-demo/chat-sprints-demo.gif    (if ffmpeg available, 720p, 8fps)
 *   .tmp/chat-sprints-demo/scenes.json              (machine-readable scene log)
 */

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const BASE_URL = flag("baseURL", "https://www.nodebenchai.com");
const OUT_DIR = path.resolve(".tmp/chat-sprints-demo");
fs.mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };
const VIDEO_PATH = path.join(OUT_DIR, "chat-sprints-demo.webm");
const SCENES_PATH = path.join(OUT_DIR, "scenes.json");

const log = [];
function note(label, ms) {
  const entry = { label, at: Date.now(), elapsedMs: ms };
  log.push(entry);
  console.log(`  · ${label}${ms ? ` (+${ms}ms)` : ""}`);
}

async function pause(page, ms, label) {
  if (label) note(label);
  await page.waitForTimeout(ms);
}

(async () => {
  console.log(`recordChatSprintsDemo → ${BASE_URL}/redesign/chat`);
  console.log(`Output dir: ${OUT_DIR}`);
  const t0 = Date.now();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    recordVideo: { dir: OUT_DIR, size: VIEWPORT },
    colorScheme: "dark",
  });
  const page = await context.newPage();

  try {
    // Scene 0 — Land on /redesign/chat
    note("scene-0: navigate /redesign/chat");
    await page.goto(`${BASE_URL}/redesign/chat`, { waitUntil: "networkidle", timeout: 30_000 });
    await pause(page, 1500);

    // Scene 1 — Click a starter chip to seed a real AnswerPacket
    note("scene-1: click starter 'Run diligence on a company'");
    const starter = page.locator('button:has-text("Run diligence on a company")').first();
    if (await starter.count()) {
      await starter.click();
      await pause(page, 3500, "wait for AnswerPacket to render");
    } else {
      note("starter not found — skipping");
    }

    // Scene 2 — Show the cost-per-turn meta in the AnswerPacket header (P1.5)
    note("scene-2: highlight cost-per-turn meta");
    const meta = page.locator(".rd-chat-msg__meta").first();
    if (await meta.count()) {
      await meta.scrollIntoViewIfNeeded();
      await meta.hover();
      await pause(page, 1800);
    }

    // Scene 3 — Open Working Notes (P0.2)
    note("scene-3: expand Working Notes");
    const notes = page.locator(".rd-working-notes summary").first();
    if (await notes.count()) {
      await notes.click();
      await pause(page, 2200);
    }

    // Scene 4 — Show Open Questions tray (P2.11)
    note("scene-4: show OpenQuestionsTray");
    const tray = page.locator(".rd-open-q").first();
    if (await tray.count()) {
      await tray.scrollIntoViewIfNeeded();
      await pause(page, 1800);
    }

    // Scene 5 — Hover a citation chip if any inline cite exists (P0.1, P2.9)
    note("scene-5: hover citation chip if inline cite present");
    const cite = page.locator(".rd-cite-wrap .rd-cite").first();
    if (await cite.count()) {
      await cite.scrollIntoViewIfNeeded();
      await cite.hover();
      await pause(page, 2400);
    } else {
      note("no inline cite in body — popover demo skipped (fixture-dependent)");
    }

    // Scene 6 — Pin a claim (P1.6)
    note("scene-6: click pin in MessageActions");
    const pinBtn = page.locator('button[aria-label="Pin claim"]').first();
    if (await pinBtn.count()) {
      await pinBtn.scrollIntoViewIfNeeded();
      await pinBtn.hover();
      await pause(page, 600);
      await pinBtn.click();
      await pause(page, 2000, "pinned chip slides in");
    }

    // Scene 7 — Counterfactual probe (P0.3) — right-click an evidence-row block cite if no inline cite worked
    note("scene-7: right-click [N] cite for probe menu");
    if (await cite.count()) {
      const box = await cite.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
        await pause(page, 2000);
        // Click Probe option if menu rendered
        const probeBtn = page.locator('.rd-cite-menu__item:has-text("Probe without source")').first();
        if (await probeBtn.count()) {
          await probeBtn.click();
          await pause(page, 2500, "probe banner + masked evidence");
          // Restore
          const restore = page.locator('.rd-probe-banner button:has-text("Restore")').first();
          if (await restore.count()) {
            await restore.click();
            await pause(page, 1200);
          }
        }
      }
    }

    // Scene 8 — A/B compare modal (P2.7)
    note("scene-8: click Compare A/B");
    const compareBtn = page.locator('button[aria-label="Compare A/B"]').first();
    if (await compareBtn.count()) {
      await compareBtn.scrollIntoViewIfNeeded();
      await compareBtn.click();
      await pause(page, 3000, "A/B modal shows Variant A and B");
      // Pick A
      const pickA = page.locator('button:has-text("Pick A")').first();
      if (await pickA.count()) {
        await pickA.click();
        await pause(page, 1500);
      }
    }

    // Scene 9 — Share / reproducibility hash (P2.13)
    note("scene-9: click Share for reproducibility URL");
    const shareBtn = page.locator('button[aria-label="Share answer link"]').first();
    if (await shareBtn.count()) {
      await shareBtn.scrollIntoViewIfNeeded();
      await shareBtn.click();
      await pause(page, 2400, "reproducibility URL toast");
    }

    // Scene 10 — Inline correction bubble (P1.4)
    note("scene-10: triple-click an answer line for correction bubble");
    const sentence = page.locator('.rd-chat-msg--assistant .rd-chat-msg__body p, .rd-chat-msg--assistant .rd-chat-msg__body li').first();
    if (await sentence.count()) {
      await sentence.scrollIntoViewIfNeeded();
      const box = await sentence.boundingBox();
      if (box) {
        // Triple-click to select the line
        await page.mouse.move(box.x + 60, box.y + box.height / 2);
        await page.mouse.dblclick(box.x + 60, box.y + box.height / 2);
        await page.mouse.click(box.x + 60, box.y + box.height / 2, { clickCount: 3 });
        await pause(page, 2000, "Correct this bubble appears");
      }
    }

    // Final hold
    await pause(page, 1500, "final hold");
  } catch (err) {
    console.error("scene error:", err.message);
  } finally {
    const totalMs = Date.now() - t0;
    note(`done in ${totalMs}ms`);

    await page.close();
    await context.close();
    await browser.close();

    // Playwright writes the video on context.close(). Find + rename.
    const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".webm"));
    if (files.length > 0) {
      const src = path.join(OUT_DIR, files[0]);
      if (src !== VIDEO_PATH) {
        fs.renameSync(src, VIDEO_PATH);
      }
      console.log(`\nVideo: ${VIDEO_PATH}`);
    }

    fs.writeFileSync(SCENES_PATH, JSON.stringify(log, null, 2));
    console.log(`Scene log: ${SCENES_PATH}`);

    // Optional: ffmpeg transcode webm → mp4 + gif
    try {
      execSync("ffmpeg -version", { stdio: "ignore" });
      const mp4 = path.join(OUT_DIR, "chat-sprints-demo.mp4");
      const gif = path.join(OUT_DIR, "chat-sprints-demo.gif");
      console.log("\nffmpeg detected — transcoding…");
      execSync(`ffmpeg -y -i "${VIDEO_PATH}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${mp4}"`, { stdio: "inherit" });
      console.log(`MP4:   ${mp4}`);
      // 720p, 8fps GIF (smaller, demo-suitable)
      execSync(`ffmpeg -y -i "${VIDEO_PATH}" -vf "fps=8,scale=1080:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${gif}"`, { stdio: "inherit" });
      console.log(`GIF:   ${gif}`);
    } catch {
      console.log("\nffmpeg not on PATH — skipping mp4/gif transcode (webm only)");
    }
  }
})();
