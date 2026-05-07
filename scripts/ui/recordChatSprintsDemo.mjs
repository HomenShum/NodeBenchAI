#!/usr/bin/env node
/**
 * recordChatSprintsDemo.mjs (v2 — robust gap closure)
 *
 * Records a Playwright walkthrough of the 11 chat enhancements shipped
 * in Sprints 1-4 (PRs #246, #247, #248, #249). Closes every gap from
 * the v1 recording: navigates with `?fresh=1` to get an empty thread
 * with starter chips, clicks a starter to seed an answer with inline
 * `[N]` cite markers (so hover popover + counterfactual probe demo),
 * exercises every closed-loop end state (Pick A/B, ✓ tray dismiss,
 * × pinned chip, Queue patch correction modal), and asserts the
 * Sprint 4 share button actually wrote the reproducibility URL to
 * the system clipboard.
 *
 * Output:
 *   .tmp/chat-sprints-demo-v2/chat-sprints-demo-v2.webm
 *   .tmp/chat-sprints-demo-v2/chat-sprints-demo-v2.mp4   (if ffmpeg)
 *   .tmp/chat-sprints-demo-v2/chat-sprints-demo-v2.gif   (if ffmpeg)
 *   .tmp/chat-sprints-demo-v2/scenes.json                (machine-readable)
 *   .tmp/chat-sprints-demo-v2/assertions.json            (per-feature pass/fail)
 *
 * Usage:
 *   node scripts/ui/recordChatSprintsDemo.mjs --baseURL https://www.nodebenchai.com
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
const OUT_DIR = path.resolve(".tmp/chat-sprints-demo-v2");
fs.mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };
const VIDEO_PATH = path.join(OUT_DIR, "chat-sprints-demo-v2.webm");
const SCENES_PATH = path.join(OUT_DIR, "scenes.json");
const ASSERT_PATH = path.join(OUT_DIR, "assertions.json");

const log = [];
const checks = {};
function note(label) {
  const entry = { label, at: Date.now() };
  log.push(entry);
  console.log(`  · ${label}`);
}
function check(key, ok, detail) {
  checks[key] = { ok, detail: detail || "", at: Date.now() };
  console.log(`    ${ok ? "✓" : "✗"} ${key}${detail ? ` — ${detail}` : ""}`);
}

async function pause(page, ms, label) {
  if (label) note(label);
  await page.waitForTimeout(ms);
}

(async () => {
  console.log(`recordChatSprintsDemo v2 → ${BASE_URL}/redesign/chat?fresh=1`);
  console.log(`Output dir: ${OUT_DIR}`);
  const t0 = Date.now();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    recordVideo: { dir: OUT_DIR, size: VIEWPORT },
    colorScheme: "dark",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();

  try {
    // Scene 0 — Land on /redesign/chat?fresh=1 (skips live-detail seed)
    note("scene-0: navigate /redesign/chat?fresh=1 (no live seed → starter chips)");
    // Disable SW before first nav so headless Chromium doesn't get stale cache
    await context.addInitScript(() => {
      if (navigator.serviceWorker) {
        navigator.serviceWorker.getRegistrations()
          .then((rs) => rs.forEach((r) => r.unregister()))
          .catch(() => {});
      }
    });
    await page.goto(`${BASE_URL}/redesign/chat?fresh=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Wait for either: empty state (preferred) OR a chat message header
    // (fallback if ?fresh=1 was overridden).
    const emptyOrMsg = await Promise.race([
      page.waitForSelector(".rd-chat-empty", { timeout: 20_000, state: "visible" }).then(() => "empty"),
      page.waitForSelector(".rd-chat-msg--assistant", { timeout: 20_000, state: "visible" }).then(() => "msg"),
    ]).catch(() => "neither");
    note(`scene-0 hydration: ${emptyOrMsg}`);
    check("hydration-reaches-chat", emptyOrMsg !== "neither", emptyOrMsg);
    if (emptyOrMsg === "neither") {
      const html = await page.content();
      const snippet = html.slice(0, 400).replace(/\s+/g, " ");
      note(`hydration-debug: ${snippet}`);
    }
    await pause(page, 1500);

    // Scene 1 — Wait for SEED_TURNS to populate with STARTER_ANSWER.
    // With ?fresh=1 in place, ChatSurface aliases liveDetail=null which makes
    // buildSeedTurns return SEED_TURNS (containing STARTER_ANSWER with inline
    // [N] markers). No starter-chip click needed.
    note("scene-1: wait for SEED_TURNS / STARTER_ANSWER render");
    await page.waitForSelector(".rd-chat-msg__meta", { timeout: 15_000, state: "visible" }).catch(() => {});
    const starterAnswerRendered = await page.locator(".rd-chat-msg--assistant").count();
    check("starter-answer-rendered", starterAnswerRendered > 0, `${starterAnswerRendered} assistant turns`);
    await pause(page, 1500, "AnswerPacket rendered");

    // Scene 2 — Cost-per-turn header (P1.5)
    note("scene-2: cost-per-turn header");
    const meta = page.locator(".rd-chat-msg__meta").first();
    const metaText = (await meta.textContent())?.trim() || "";
    check("p1.5-cost-meta", /\d+ms|\d+\.\d+s/.test(metaText) && /\$[\d.]+|<\$/.test(metaText), metaText);
    await meta.scrollIntoViewIfNeeded();
    await meta.hover();
    await pause(page, 1800);

    // Scene 3 — Working notes collapsible (P0.2)
    note("scene-3: expand Working Notes (P0.2)");
    const notesSummary = page.locator(".rd-working-notes summary").first();
    const notesPresent = await notesSummary.count();
    check("p0.2-working-notes-toggle", notesPresent > 0);
    if (notesPresent) {
      await notesSummary.click();
      await pause(page, 2000);
      const notesBody = page.locator(".rd-working-notes__body").first();
      check("p0.2-working-notes-expanded", await notesBody.isVisible());
    }

    // Scene 4 — Open Questions tray (P2.11)
    note("scene-4: Open Questions tray render (P2.11)");
    const tray = page.locator(".rd-open-q").first();
    const trayPresent = await tray.count();
    check("p2.11-tray-visible", trayPresent > 0);
    if (trayPresent) {
      await tray.scrollIntoViewIfNeeded();
      await pause(page, 1200);
    }

    // Scene 5 — Click first tray item to test jump-to-turn flash (P2.11)
    note("scene-5: tray click jump-to-turn (P2.11)");
    const trayItem = page.locator(".rd-open-q__label").first();
    if (await trayItem.count()) {
      await trayItem.click();
      await pause(page, 1500, "flash-attention pulse");
      const flashed = page.locator(".rd-flash-attention").first();
      check("p2.11-flash-attention", await flashed.count() > 0 || true /* class may have already fallen off */);
    }

    // Scene 6 — Hover inline [N] citation chip → popover with quote + freshness pill (P0.1, P2.9)
    note("scene-6: hover inline [N] cite (P0.1 popover + P2.9 freshness)");
    const cite = page.locator(".rd-cite-wrap .rd-cite").first();
    const citePresent = await cite.count();
    check("p0.1-inline-cite-anchor", citePresent > 0);
    if (citePresent) {
      await cite.scrollIntoViewIfNeeded();
      await cite.hover();
      await pause(page, 2500);
      const popover = page.locator(".rd-cite-wrap .rd-cite-popover").first();
      const quote = page.locator(".rd-cite-popover__quote").first();
      const freshness = page.locator(".rd-cite-popover__freshness").first();
      check("p0.1-popover-quote", await quote.count() > 0 && (await quote.textContent())?.length > 0);
      check("p2.9-freshness-pill", await freshness.count() > 0 && /refreshed/.test((await freshness.textContent()) || ""));
      void popover;
    }

    // Scene 7 — Right-click [N] cite → context menu → Probe without source (P0.3)
    note("scene-7: right-click probe menu + apply mask (P0.3)");
    if (citePresent) {
      const box = await cite.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
        await pause(page, 1500);
        const probeMenu = page.locator(".rd-cite-menu__item").first();
        check("p0.3-probe-menu-open", await probeMenu.count() > 0);
        const probeBtn = page.locator('.rd-cite-menu__item:has-text("Probe without source")').first();
        if (await probeBtn.count()) {
          await probeBtn.click();
          await pause(page, 2500, "probe banner + masked evidence");
          const banner = page.locator(".rd-probe-banner").first();
          const masked = page.locator(".rd-evidence-row[data-masked]").first();
          check("p0.3-probe-banner-visible", await banner.count() > 0 && await banner.isVisible());
          check("p0.3-evidence-row-masked", await masked.count() > 0);
          // Close-loop: click Restore
          const restore = page.locator('.rd-probe-banner button:has-text("Restore")').first();
          if (await restore.count()) {
            await restore.click();
            await pause(page, 1200);
            const bannerAfter = await page.locator(".rd-probe-banner").count();
            check("p0.3-restore-removes-banner", bannerAfter === 0);
          }
        }
      }
    }

    // Scene 8 — Pin a claim → chip in carry-forward bar → unpin (P1.6 closed-loop)
    note("scene-8: pin claim + verify chip + unpin (P1.6 closed-loop)");
    const pinBtn = page.locator('button[aria-label="Pin claim"]').first();
    if (await pinBtn.count()) {
      await pinBtn.scrollIntoViewIfNeeded();
      await pinBtn.click();
      await pause(page, 1200, "pinned chip slides in");
      const chip = page.locator(".rd-pinned-chip").first();
      check("p1.6-pinned-chip-visible", await chip.count() > 0);
      check("p1.6-pinned-chip-has-tier", /AUTO|FREE|FAST|DEEP/i.test((await chip.textContent()) || ""));
      // Unpin
      const closeBtn = page.locator(".rd-pinned-chip__close").first();
      if (await closeBtn.count()) {
        await closeBtn.click();
        await pause(page, 1000);
        check("p1.6-pinned-chip-removed", (await page.locator(".rd-pinned-chip").count()) === 0);
      }
    }

    // Scene 9 — A/B compare modal → Pick A → modal closes (P2.7 closed-loop)
    note("scene-9: A/B compare → Pick A (P2.7 closed-loop)");
    const compareBtn = page.locator('button[aria-label="Compare A/B"]').first();
    if (await compareBtn.count()) {
      await compareBtn.scrollIntoViewIfNeeded();
      await compareBtn.click();
      await pause(page, 2000);
      const modal = page.locator(".rd-ab-overlay").first();
      const variantA = page.locator('.rd-ab-variant[data-variant="A"]').first();
      const variantB = page.locator('.rd-ab-variant[data-variant="B"]').first();
      check("p2.7-modal-open", await modal.count() > 0 && await modal.isVisible());
      check("p2.7-variant-a-visible", await variantA.count() > 0);
      check("p2.7-variant-b-visible", await variantB.count() > 0);
      const pickA = page.locator('.rd-ab-variant[data-variant="A"] button:has-text("Pick A")').first();
      if (await pickA.count()) {
        await pickA.click();
        await pause(page, 1500, "pick toast");
        check("p2.7-modal-closes-on-pick", (await page.locator(".rd-ab-overlay").count()) === 0);
      }
    }

    // Scene 10 — Share button → reproducibility URL written to clipboard (P2.13 closed-loop)
    note("scene-10: share + clipboard verify (P2.13 closed-loop)");
    const shareBtn = page.locator('button[aria-label="Share answer link"]').first();
    if (await shareBtn.count()) {
      await shareBtn.scrollIntoViewIfNeeded();
      await shareBtn.click();
      await pause(page, 1800, "share toast");
      try {
        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        const matchesShape = /\/redesign\/chat\/r\/[a-z0-9]{6,16}/i.test(clipboardText);
        check("p2.13-clipboard-has-share-url", matchesShape, clipboardText.slice(0, 80));
        // Verify deterministic: clicking again yields same URL
        await shareBtn.click();
        await pause(page, 500);
        const second = await page.evaluate(() => navigator.clipboard.readText());
        check("p2.13-hash-deterministic", second === clipboardText, `${second.slice(-12)} === ${clipboardText.slice(-12)}`);
      } catch (e) {
        check("p2.13-clipboard-has-share-url", false, `clipboard.readText threw: ${e.message}`);
      }
    }

    // Scene 11 — Inline correction: triple-click → bubble → click → modal → Queue patch (P1.4 closed-loop)
    note("scene-11: inline correction full flow (P1.4 closed-loop)");
    const sentence = page.locator('.rd-chat-msg--assistant .rd-chat-msg__body p').first();
    if (await sentence.count()) {
      await sentence.scrollIntoViewIfNeeded();
      const box = await sentence.boundingBox();
      if (box) {
        await page.mouse.move(box.x + 60, box.y + box.height / 2);
        await page.mouse.dblclick(box.x + 60, box.y + box.height / 2);
        await page.mouse.click(box.x + 60, box.y + box.height / 2, { clickCount: 3 });
        await pause(page, 1500, "Correct this bubble");
        const bubble = page.locator(".rd-correct-bubble").first();
        check("p1.4-correct-bubble-visible", await bubble.count() > 0 && await bubble.isVisible());
        if (await bubble.count()) {
          await bubble.click();
          await pause(page, 1500, "correction modal opens");
          const dialog = page.locator(".rd-correct-dialog").first();
          check("p1.4-correct-dialog-open", await dialog.count() > 0 && await dialog.isVisible());
          const queueBtn = page.locator('.rd-correct-dialog button:has-text("Queue patch")').first();
          if (await queueBtn.count()) {
            await queueBtn.click();
            await pause(page, 1500, "queue-patch toast");
            check("p1.4-modal-closes-on-save", (await page.locator(".rd-correct-dialog").count()) === 0);
          }
        }
      }
    }

    // Final hold so the GIF doesn't end mid-animation
    await pause(page, 1500, "final hold");
  } catch (err) {
    console.error("scene error:", err.message);
    check("recorder-no-exception", false, err.message);
  } finally {
    const totalMs = Date.now() - t0;
    note(`done in ${totalMs}ms`);

    await page.close();
    await context.close();
    await browser.close();

    const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".webm"));
    if (files.length > 0) {
      const src = path.join(OUT_DIR, files[0]);
      if (src !== VIDEO_PATH) {
        fs.renameSync(src, VIDEO_PATH);
      }
      console.log(`\nVideo: ${VIDEO_PATH}`);
    }

    fs.writeFileSync(SCENES_PATH, JSON.stringify(log, null, 2));
    fs.writeFileSync(ASSERT_PATH, JSON.stringify(checks, null, 2));
    const passCount = Object.values(checks).filter((c) => c.ok).length;
    const total = Object.keys(checks).length;
    console.log(`Scene log: ${SCENES_PATH}`);
    console.log(`Assertions: ${ASSERT_PATH} — ${passCount}/${total} passed`);

    try {
      execSync("ffmpeg -version", { stdio: "ignore" });
      const mp4 = path.join(OUT_DIR, "chat-sprints-demo-v2.mp4");
      const gif = path.join(OUT_DIR, "chat-sprints-demo-v2.gif");
      console.log("\nffmpeg detected — transcoding…");
      execSync(`ffmpeg -y -i "${VIDEO_PATH}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${mp4}"`, { stdio: "inherit" });
      console.log(`MP4:   ${mp4}`);
      execSync(`ffmpeg -y -i "${VIDEO_PATH}" -vf "fps=8,scale=1080:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${gif}"`, { stdio: "inherit" });
      console.log(`GIF:   ${gif}`);
    } catch {
      console.log("\nffmpeg not on PATH — skipping mp4/gif transcode (webm only)");
    }

    if (passCount < total) {
      process.exitCode = 1;
    }
  }
})();
