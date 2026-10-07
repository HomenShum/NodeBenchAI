#!/usr/bin/env node
/**
 * recordCoordinationDemo.mjs — 3DClaw-Inspired Coordination Demo Recording
 *
 * Records a video of the full shared context coordination flow:
 *   1. Navigate to Coordination Hub
 *   2. Fire real API calls (peer registration, packet publish, delegation)
 *   3. Show real-time UI updates via SSE
 *   4. Capture the event feed and delegation target cards
 *
 * Usage:
 *   node scripts/ui/recordCoordinationDemo.mjs [--baseURL http://localhost:5191] [--serverURL http://localhost:3100]
 *
 * Output:
 *   public/dogfood/coordination-demo.mp4 (+ .webm source)
 *   public/dogfood/coordination-demo.json (manifest)
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { buildNodeWorkerDevCommand } from "../lib/standardTreePaths.mjs";

// ── CLI args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}

const baseURL = getArg("--baseURL") || "http://localhost:5191";
const serverURL = getArg("--serverURL") || "http://localhost:3100";
const headless = !args.includes("--headed");

// ── Dirs ──────────────────────────────────────────────────────────────────

const outDir = resolve(".tmp/coordination-demo-video");
const publicDir = resolve("public/dogfood");

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true });

// ── Test data ─────────────────────────────────────────────────────────────

const DEMO_PACKETS = [
  {
    entityName: "Anthropic",
    canonicalEntity: "Anthropic",
    answer: "Claude 4.6 Opus with 1M context — most capable coding model available.",
    confidence: 92,
    proofStatus: "verified",
    packetId: "demo-packet-anthropic",
    packetType: "founder_packet",
    query: "What is Anthropic's latest product launch?",
    sourceRefs: [{ id: "s1", href: "https://anthropic.com/news", label: "Anthropic Blog" }],
    changes: [{ description: "Claude 4.6 released with extended context window" }],
    risks: [{ title: "OpenAI o3 competitive pressure" }],
    interventions: [{ action: "Update competitive matrix" }],
    nextQuestions: ["How does 1M context compare to Gemini's 2M?"],
  },
  {
    entityName: "OpenAI",
    canonicalEntity: "OpenAI",
    answer: "OpenAI announced GPT-5 Turbo with advanced reasoning capabilities.",
    confidence: 78,
    proofStatus: "provisional",
    packetId: "demo-packet-openai",
    packetType: "founder_packet",
    query: "What is OpenAI's competitive positioning?",
    sourceRefs: [{ id: "s2", href: "https://openai.com/blog", label: "OpenAI Blog" }],
    changes: [{ description: "GPT-5 Turbo entered limited beta" }],
    risks: [{ title: "Pricing undercut by open-source models" }],
    interventions: [{ action: "Run pricing comparison analysis" }],
    nextQuestions: ["Will GPT-5 maintain API backward compatibility?"],
  },
];

// ── ffmpeg transcode ──────────────────────────────────────────────────────

async function maybeTranscodeToMp4(inputPath, outputPath) {
  let ffmpegPath;
  try {
    const mod = await import("ffmpeg-static");
    ffmpegPath = mod.default || mod;
  } catch {
    return { ok: false, reason: "ffmpeg-static not installed" };
  }
  if (!ffmpegPath) return { ok: false, reason: "ffmpeg binary missing" };

  try {
    execSync(
      `"${ffmpegPath}" -y -i "${inputPath}" -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p -movflags +faststart "${outputPath}"`,
      { stdio: "pipe", timeout: 120_000 },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("[coordination-demo] Starting recording...");
  console.log(`  App URL:    ${baseURL}`);
  console.log(`  Server URL: ${serverURL}`);
  console.log(`  Headless:   ${headless}`);

  // Check server health
  try {
    const healthRes = await fetch(`${serverURL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!healthRes.ok) throw new Error(`Health check returned ${healthRes.status}`);
    console.log("[coordination-demo] Server healthy");
  } catch (err) {
    console.error(`[coordination-demo] Server not reachable at ${serverURL}: ${err.message}`);
    console.error(`  Start it with: ${buildNodeWorkerDevCommand()}`);
    process.exit(1);
  }

  const userDataDir = resolve(".tmp/coordination-demo-userdata");
  if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 1440, height: 900 },
    baseURL,
    colorScheme: "dark",
    reducedMotion: "reduce",
    recordVideo: {
      dir: outDir,
      size: { width: 1440, height: 900 },
    },
  });

  const page = context.pages()[0] || (await context.newPage());

  const chapters = [];
  let chapterStartTime = Date.now();

  function markChapter(name) {
    const elapsed = (Date.now() - chapterStartTime) / 1000;
    chapters.push({ name, startSec: Math.round(elapsed * 10) / 10 });
    console.log(`  [${elapsed.toFixed(1)}s] ${name}`);
  }

  try {
    // ── Dismiss onboarding dialog if present ────────────────────────
    chapterStartTime = Date.now();
    await page.goto("/founder/coordination", { waitUntil: "domcontentloaded" });
    // Set localStorage to skip onboarding, then reload
    await page.evaluate(() => {
      localStorage.setItem("nodebench-onboarded", "true");
      localStorage.setItem("nodebench-founder-onboarding-done", "true");
    });
    await page.goto("/founder/coordination", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // ── Chapter 1: Navigate to Coordination Hub ────────────────────
    markChapter("Navigate to Coordination Hub");

    // ── Chapter 2: Show initial state (demo mode) ──────────────────
    markChapter("Initial state — demo mode");
    await page.waitForTimeout(1000);

    // ── Chapter 3: Publish packets via real API ────────────────────
    markChapter("Publishing context packets via API");

    for (const packet of DEMO_PACKETS) {
      const res = await fetch(`${serverURL}/api/shared-context/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packet }),
      });
      const data = await res.json();
      console.log(`    Published ${packet.entityName}: ${data.success ? "OK" : "FAIL"}`);
      await page.waitForTimeout(800);
    }

    // ── Chapter 4: Refresh UI to show live data ────────────────────
    markChapter("Refreshing UI — live data appears");
    const refreshBtn = page.locator('button[aria-label="Refresh"]');
    if (await refreshBtn.isVisible()) {
      await refreshBtn.click();
    }
    await page.waitForTimeout(2000);

    // ── Chapter 5: Delegate to Claude Code ─────────────────────────
    markChapter("Delegating to Claude Code");
    const delegateRes = await fetch(`${serverURL}/api/shared-context/delegate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packet: DEMO_PACKETS[0],
        targetAgent: "claude_code",
        goal: "Build competitive analysis: Claude 4.6 vs GPT-5 coding capabilities",
      }),
    });
    const delegateData = await delegateRes.json();
    console.log(`    Delegated to Claude Code: ${delegateData.success ? "OK" : "FAIL"}`);
    await page.waitForTimeout(1000);

    // ── Chapter 6: Delegate to OpenClaw ────────────────────────────
    markChapter("Delegating to OpenClaw");
    const delegateOcRes = await fetch(`${serverURL}/api/shared-context/delegate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packet: DEMO_PACKETS[1],
        targetAgent: "openclaw",
        goal: "Run competitive intel sweep on OpenAI product pipeline",
      }),
    });
    const delegateOcData = await delegateOcRes.json();
    console.log(`    Delegated to OpenClaw: ${delegateOcData.success ? "OK" : "FAIL"}`);
    await page.waitForTimeout(1000);

    // ── Chapter 7: Refresh to show delegation results ──────────────
    markChapter("Showing delegation results");
    if (await refreshBtn.isVisible()) {
      await refreshBtn.click();
    }
    await page.waitForTimeout(2000);

    // ── Chapter 8: Open event feed ─────────────────────────────────
    markChapter("Opening live event feed");
    const eventFeedBtn = page.locator('button:has-text("Live Event Feed")');
    if (await eventFeedBtn.isVisible()) {
      await eventFeedBtn.click();
      await page.waitForTimeout(1500);
    }

    // ── Chapter 9: Final snapshot ──────────────────────────────────
    markChapter("Final state — full coordination visible");
    await page.waitForTimeout(2000);

  } catch (err) {
    console.error("[coordination-demo] Error during recording:", err);
  }

  // Close context to finalize video
  await context.close();

  // Find recorded video
  const { readdirSync } = await import("node:fs");
  const videoFiles = readdirSync(outDir).filter((f) => f.endsWith(".webm"));
  if (videoFiles.length === 0) {
    console.error("[coordination-demo] No video file found in", outDir);
    process.exit(1);
  }

  const latestVideo = resolve(outDir, videoFiles[videoFiles.length - 1]);
  const webmDest = join(publicDir, "coordination-demo.webm");
  const mp4Dest = join(publicDir, "coordination-demo.mp4");

  // Copy webm
  renameSync(latestVideo, webmDest);
  console.log(`[coordination-demo] WebM saved: ${webmDest}`);

  // Transcode to MP4
  const transcodeResult = await maybeTranscodeToMp4(webmDest, mp4Dest);
  if (transcodeResult.ok) {
    console.log(`[coordination-demo] MP4 saved: ${mp4Dest}`);
  } else {
    console.warn(`[coordination-demo] MP4 transcode skipped: ${transcodeResult.reason}`);
  }

  // Write manifest
  const manifest = {
    capturedAtIso: new Date().toISOString(),
    baseURL,
    serverURL,
    mime: transcodeResult.ok ? "video/mp4" : "video/webm",
    chapters,
    videoPath: transcodeResult.ok
      ? "/dogfood/coordination-demo.mp4"
      : "/dogfood/coordination-demo.webm",
  };
  writeFileSync(join(publicDir, "coordination-demo.json"), JSON.stringify(manifest, null, 2));
  console.log("[coordination-demo] Manifest saved");
  console.log("[coordination-demo] Done!");
}

main().catch((err) => {
  console.error("[coordination-demo] Fatal:", err);
  process.exit(1);
});
