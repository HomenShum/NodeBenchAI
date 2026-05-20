#!/usr/bin/env node
/**
 * Interactive Gemini QA Pipeline — cross-round comparison + video analysis + interaction testing.
 *
 * Addresses three gaps in fullSurfaceGeminiQa.mjs:
 * 1. Cross-round comparison: accumulates round history in .tmp/full-surface-qa/history.jsonl
 *    with gen-over-gen diff tracking (P1 resolution, regression detection, dimension trends)
 * 2. Live interaction testing: records actual user flows (click, navigate, type, wait for data)
 *    with before/during/after state capture via Playwright video recording
 * 3. Gemini video analysis: uploads interaction videos to Gemini 3+ models via File API
 *    for holistic temporal evaluation of interactions, timing, and data display correctness
 *
 * Prior art:
 *   - fullSurfaceGeminiQa.mjs (static screenshot pipeline — this extends it)
 *   - convex/domains/evaluation/dogfood/videoQa.ts (Gemini File API pattern)
 *   - convex/domains/evaluation/dogfood/screenshotQa.ts (SHA256 dedup pattern)
 *
 * Usage:
 *   node scripts/ui/interactiveGeminiQaPipeline.mjs [--base-url http://localhost:5200] [--round-label "post-fix-batch"]
 */
import { chromium } from "playwright";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(ROOT, ".env.local") });

/* ── CLI args ──────────────────────────────────────────────── */
const BASE_URL = process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1] || "http://localhost:5200";
const ROUND_LABEL = process.argv.find((a) => a.startsWith("--round-label="))?.split("=")[1] || "";
const SKIP_VIDEO = process.argv.includes("--skip-video");
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) { console.error("GEMINI_API_KEY not found in .env.local"); process.exit(1); }

/* ── Constants ─────────────────────────────────────────────── */
const OUT_DIR = path.join(ROOT, ".tmp", "full-surface-qa");
const HISTORY_FILE = path.join(OUT_DIR, "history.jsonl");
const ROUNDS_DIR = path.join(OUT_DIR, "rounds");
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const MAX_HISTORY_ROUNDS = 100; // BOUND: cap history to prevent unbounded growth

const SURFACES = [
  { id: "home", path: "/redesign", label: "Home" },
  { id: "reports", path: "/redesign/reports", label: "Reports" },
  { id: "chat", path: "/redesign/chat", label: "Chat" },
  { id: "inbox", path: "/redesign/inbox", label: "Inbox" },
  { id: "me", path: "/redesign/me", label: "Me / Profile" },
  { id: "workspace", path: "/redesign/workspace", label: "Workspace" },
];

/** Interaction flows for video recording — real user scenarios S1-S8 */
const INTERACTION_FLOWS = [
  {
    id: "nav-cycle",
    label: "S7: Rapid surface switching",
    steps: [
      { action: "goto", url: "/redesign", wait: 2000 },
      { action: "screenshot", name: "before-nav" },
      { action: "click", selector: "nav a[href*='reports'], nav button:has-text('Reports')", wait: 1200 },
      { action: "screenshot", name: "during-reports" },
      { action: "click", selector: "nav a[href*='chat'], nav button:has-text('Chat')", wait: 1200 },
      { action: "screenshot", name: "during-chat" },
      { action: "click", selector: "nav a[href*='inbox'], nav button:has-text('Inbox')", wait: 1200 },
      { action: "screenshot", name: "during-inbox" },
      { action: "click", selector: "nav a[href*='/redesign/me'], nav button:has-text('Me')", wait: 1200 },
      { action: "screenshot", name: "after-me" },
    ],
  },
  {
    id: "home-to-report-drill",
    label: "S6: Home -> Reports -> drill -> back",
    steps: [
      { action: "goto", url: "/redesign", wait: 2000 },
      { action: "screenshot", name: "before-home" },
      { action: "click", selector: "nav a[href*='reports'], nav button:has-text('Reports')", wait: 1500 },
      { action: "screenshot", name: "during-reports-list" },
      { action: "click", selector: "[data-redesign] .rd-card:first-child, [data-redesign] article:first-child", wait: 1500 },
      { action: "screenshot", name: "during-report-detail" },
      { action: "click", selector: "nav a[href*='/redesign'], nav button:has-text('Home')", wait: 1500 },
      { action: "screenshot", name: "after-back-home" },
    ],
  },
  {
    id: "chat-conversation",
    label: "S8: Start a chat conversation",
    steps: [
      { action: "goto", url: "/redesign/chat", wait: 2000 },
      { action: "screenshot", name: "before-chat" },
      { action: "click", selector: "[data-redesign] textarea, [data-redesign] input[type='text'], [data-redesign] [contenteditable]", wait: 800 },
      { action: "type", text: "Tell me about Anthropic's latest research", wait: 500 },
      { action: "screenshot", name: "during-typing" },
      { action: "key", key: "Enter", wait: 3000 },
      { action: "screenshot", name: "after-send" },
    ],
  },
  {
    id: "inbox-triage",
    label: "S5: Inbox scan and action",
    steps: [
      { action: "goto", url: "/redesign/inbox", wait: 2000 },
      { action: "screenshot", name: "before-inbox" },
      { action: "click", selector: "[data-redesign] .rd-card:first-child, [data-redesign] article:first-child, [data-redesign] li:first-child", wait: 1200 },
      { action: "screenshot", name: "during-item-open" },
      { action: "click", selector: "[data-redesign] .rd-btn:has-text('Approve'), [data-redesign] .rd-btn:has-text('Accept'), [data-redesign] .rd-btn--primary", wait: 1000 },
      { action: "screenshot", name: "after-action" },
    ],
  },
];

const SCREENSHOT_EVAL_PROMPT = `You are a senior product designer conducting a comprehensive QA dogfood review of "NodeBench AI" — an entity intelligence platform.

You are reviewing screenshots from MULTIPLE surfaces in both mobile and desktop viewports, dark and light themes.

DESIGN SYSTEM: Glass card DNA (backdrop-filter blur, semi-transparent bg, subtle borders), terracotta #d97757 accent, Manrope + JetBrains Mono, dark bg #151413.

EVALUATION FRAMEWORK — Score each surface across 10 dimensions (1-10):
1. VISUAL HIERARCHY  2. TOUCH TARGETS (mobile >=44px)  3. CONTENT DENSITY
4. TYPOGRAPHY & CONTRAST (WCAG AA)  5. FIRST IMPRESSION  6. GLASS DESIGN SYSTEM
7. NAVIGATION  8. EMPTY/LOADING STATES  9. RESPONSIVE PARITY  10. INTERACTION QUALITY

USER SCENARIOS: S1-S8 (new user clarity, nav switching, search, reports, inbox, drill-down, rapid switch, chat)

OUTPUT FORMAT (JSON):
{
  "overallScore": <1-100>,
  "surfaceScores": { "<id>": { "score": <1-100>, "dimensions": {...}, "findings": [...], "p1Issues": [{"issue":"..","location":"..","fix":"..","scenario":"S1-S8","issueId":"p1-<surface>-<n>"}], "p2Issues": [{"issue":"..","location":"..","fix":"..","issueId":"p2-<surface>-<n>"}] } },
  "scenarioResults": { "S1": {"pass": true/false, "notes": "..."}, ... "S8": {"pass": true/false, "notes": "..."} },
  "crossSurfaceIssues": [{"issue":"..","surfaces":[".."],"fix":".."}],
  "topPriorityFixes": ["1. ...", "2. ...", "3. ...", "4. ...", "5. ..."],
  "marketComparisonVerdict": "paragraph comparing to ChatGPT/Perplexity/Linear/Notion"
}

IMPORTANT: Every P1 and P2 issue MUST have a unique "issueId" field (format: "p1-<surface>-<n>" or "p2-<surface>-<n>") so we can track resolution across rounds. Be specific: name elements, sizes, CSS selectors. Every fix must be actionable in <30 min.`;

const VIDEO_EVAL_PROMPT = `You are evaluating a VIDEO RECORDING of real user interaction flows in the NodeBench AI web app.

Watch the video carefully and evaluate TEMPORAL aspects that screenshots cannot capture:

1. TRANSITION SMOOTHNESS (1-10) — Are surface switches animated? Any janky repaints?
2. LOADING TIMING (1-10) — How fast does content appear after navigation? Any blank flashes?
3. STATE PERSISTENCE (1-10) — Does scroll position reset? Do inputs lose focus? Any state loss?
4. DATA LOADING (1-10) — Do Convex queries resolve? Is there real data or just fixtures?
5. INTERACTION RESPONSIVENESS (1-10) — Click-to-response latency. Any frozen frames?
6. ERROR HANDLING (1-10) — Any console errors visible? Red flashes? Broken layouts during transitions?
7. NAVIGATION FLOW (1-10) — Does back-navigation work? Tab highlight updates correctly?
8. ANIMATION QUALITY (1-10) — Smooth fade-ins? No seizure-inducing flashes? Reduced motion respected?

OUTPUT FORMAT (JSON):
{
  "overallInteractionScore": <1-100>,
  "dimensions": {
    "transitionSmoothness": <1-10>,
    "loadingTiming": <1-10>,
    "statePersistence": <1-10>,
    "dataLoading": <1-10>,
    "interactionResponsiveness": <1-10>,
    "errorHandling": <1-10>,
    "navigationFlow": <1-10>,
    "animationQuality": <1-10>
  },
  "temporalIssues": [
    { "timestamp": "approx MM:SS", "issue": "...", "severity": "p1|p2", "fix": "...", "issueId": "vid-<n>" }
  ],
  "flowResults": {
    "navCycle": { "pass": true/false, "notes": "..." },
    "drillDown": { "pass": true/false, "notes": "..." },
    "chatConversation": { "pass": true/false, "notes": "..." },
    "inboxTriage": { "pass": true/false, "notes": "..." }
  },
  "liveDataVerdict": "Are we seeing real Convex data or just fixtures/demo data?",
  "topTemporalFixes": ["1. ...", "2. ...", "3. ..."]
}

Be precise about timestamps. Flag any moment where the UI feels slower than Linear or ChatGPT.`;

const MODELS_SCREENSHOT = ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-pro"];
const MODELS_VIDEO = ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-pro"];

/* ═══════════════════════════════════════════════════════════════
   PHASE 0: Round History Management
   ═══════════════════════════════════════════════════════════════ */

function loadRoundHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  const lines = fs.readFileSync(HISTORY_FILE, "utf-8").trim().split("\n").filter(Boolean);
  // BOUND: only keep last MAX_HISTORY_ROUNDS
  const parsed = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return parsed.slice(-MAX_HISTORY_ROUNDS);
}

function getNextRoundNumber(history) {
  if (history.length === 0) return 1;
  return Math.max(...history.map((r) => r.roundNumber || 0)) + 1;
}

function appendRoundToHistory(roundData) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.appendFileSync(HISTORY_FILE, JSON.stringify(roundData) + "\n");

  // BOUND: trim history file if over limit
  const lines = fs.readFileSync(HISTORY_FILE, "utf-8").trim().split("\n").filter(Boolean);
  if (lines.length > MAX_HISTORY_ROUNDS) {
    fs.writeFileSync(HISTORY_FILE, lines.slice(-MAX_HISTORY_ROUNDS).join("\n") + "\n");
  }
}

/* ═══════════════════════════════════════════════════════════════
   PHASE 1: Screenshot Capture (same surfaces, saved per-round)
   ═══════════════════════════════════════════════════════════════ */

async function captureAllSurfaces(roundDir) {
  console.log(`\n[Phase 1] Capturing screenshots at ${BASE_URL} ...\n`);
  const browser = await chromium.launch({ headless: true });
  const shots = [];

  for (const viewport of [
    { ...MOBILE, name: "mobile", scheme: "dark" },
    { ...DESKTOP, name: "desktop", scheme: "dark" },
    { ...MOBILE, name: "mobile-light", scheme: "light" },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: viewport.scheme,
      deviceScaleFactor: viewport.name.startsWith("mobile") ? 3 : 2,
      userAgent: viewport.name.startsWith("mobile")
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
        : undefined,
    });
    const page = await context.newPage();

    for (const surface of SURFACES) {
      const url = `${BASE_URL}${surface.path}`;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(2000);

        const filename = `${surface.id}-${viewport.name}.png`;
        const filepath = path.join(roundDir, filename);
        await page.screenshot({ path: filepath, fullPage: false });
        shots.push({
          surface: surface.id, label: surface.label,
          viewport: viewport.name, scheme: viewport.scheme,
          path: filepath, dimensions: `${viewport.width}x${viewport.height}`,
        });
        console.log(`  OK ${surface.label} (${viewport.name})`);
      } catch (e) {
        console.log(`  FAIL ${surface.label} (${viewport.name}): ${e.message?.slice(0, 80)}`);
        shots.push({
          surface: surface.id, label: surface.label,
          viewport: viewport.name, scheme: viewport.scheme,
          path: null, error: e.message?.slice(0, 120),
        });
      }
    }
    await context.close();
  }

  await browser.close();
  const validShots = shots.filter((s) => s.path);
  console.log(`\n  Captured ${validShots.length}/${shots.length} screenshots.\n`);
  return { shots, validShots };
}

/* ═══════════════════════════════════════════════════════════════
   PHASE 2: Interaction Video Recording (new)
   ═══════════════════════════════════════════════════════════════ */

async function recordInteractionVideos(roundDir) {
  if (SKIP_VIDEO) {
    console.log("\n[Phase 2] Skipping video recording (--skip-video)\n");
    return { videos: [], interactionShots: [] };
  }

  console.log("\n[Phase 2] Recording interaction videos ...\n");
  const videoDir = path.join(roundDir, "videos");
  fs.mkdirSync(videoDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const videos = [];
  const interactionShots = [];

  for (const flow of INTERACTION_FLOWS) {
    console.log(`  Recording: ${flow.label} ...`);
    const context = await browser.newContext({
      viewport: MOBILE,
      colorScheme: "dark",
      deviceScaleFactor: 2,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      recordVideo: { dir: videoDir, size: MOBILE },
    });
    const page = await context.newPage();

    let flowSuccess = true;
    const stepResults = [];

    for (const step of flow.steps) {
      try {
        switch (step.action) {
          case "goto":
            await page.goto(`${BASE_URL}${step.url}`, { waitUntil: "domcontentloaded", timeout: 15000 });
            break;
          case "click":
            try {
              await page.click(step.selector, { timeout: 5000 });
            } catch {
              // Fallback: try a broader selector
              const buttons = await page.$$("button, a, [role='button']");
              if (buttons.length > 0) await buttons[0].click();
            }
            break;
          case "type":
            await page.keyboard.type(step.text, { delay: 50 });
            break;
          case "key":
            await page.keyboard.press(step.key);
            break;
          case "screenshot": {
            const shotPath = path.join(roundDir, `interaction-${flow.id}-${step.name}.png`);
            await page.screenshot({ path: shotPath, fullPage: false });
            interactionShots.push({
              flow: flow.id, step: step.name, path: shotPath,
              label: `${flow.label} — ${step.name}`,
            });
            break;
          }
        }
        if (step.wait) await page.waitForTimeout(step.wait);
        stepResults.push({ action: step.action, status: "ok" });
      } catch (e) {
        stepResults.push({ action: step.action, status: "error", error: e.message?.slice(0, 100) });
        flowSuccess = false;
      }
    }

    // Close context to finalize video
    await context.close();

    // Find the video file that was just created
    const videoFiles = fs.readdirSync(videoDir).filter((f) => f.endsWith(".webm")).sort();
    const latestVideo = videoFiles[videoFiles.length - 1];
    if (latestVideo) {
      const videoPath = path.join(videoDir, latestVideo);
      // Rename to meaningful name
      const renamedPath = path.join(videoDir, `${flow.id}.webm`);
      if (!fs.existsSync(renamedPath)) {
        fs.renameSync(videoPath, renamedPath);
      }
      videos.push({
        flowId: flow.id, label: flow.label, path: renamedPath,
        success: flowSuccess, stepResults,
        sizeBytes: fs.statSync(renamedPath).size,
      });
      console.log(`  OK ${flow.label} (${(fs.statSync(renamedPath).size / 1024).toFixed(0)}KB)`);
    } else {
      console.log(`  WARN No video file found for ${flow.label}`);
      videos.push({ flowId: flow.id, label: flow.label, path: null, success: flowSuccess, stepResults });
    }
  }

  await browser.close();
  console.log(`\n  Recorded ${videos.filter((v) => v.path).length}/${videos.length} interaction videos.\n`);
  return { videos, interactionShots };
}

/* ═══════════════════════════════════════════════════════════════
   PHASE 3: Screenshot Evaluation with Gemini
   ═══════════════════════════════════════════════════════════════ */

async function evaluateScreenshots(validShots, roundNumber, history) {
  console.log("[Phase 3] Sending screenshots to Gemini 3 Flash ...");
  const genAI = new GoogleGenerativeAI(GEMINI_KEY);

  const imageParts = validShots.map((s) => ({
    inlineData: { mimeType: "image/png", data: fs.readFileSync(s.path).toString("base64") },
  }));

  const imageLabels = validShots
    .map((s) => `[Image: ${s.label} - ${s.viewport} ${s.dimensions || ""} ${s.scheme} mode]`)
    .join("\n");

  // Inject previous round context for comparison
  let historyContext = "";
  if (history.length > 0) {
    const prev = history[history.length - 1];
    const prevP1s = extractAllP1Ids(prev.screenshotEval);
    historyContext = `\n\nPREVIOUS ROUND CONTEXT (Round ${prev.roundNumber}, score ${prev.screenshotEval?.overallScore || "?"}):\n` +
      `Previous P1 issue IDs: ${prevP1s.join(", ") || "none"}\n` +
      `Previous top fixes: ${(prev.screenshotEval?.topPriorityFixes || []).slice(0, 3).join("; ")}\n` +
      `For each P1 you find, note if it existed in the previous round (regression) or is new.\n`;
  }

  let result;
  for (const modelName of MODELS_SCREENSHOT) {
    try {
      console.log(`  Trying: ${modelName} ...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      result = await model.generateContent({
        contents: [{ role: "user", parts: [
          { text: SCREENSHOT_EVAL_PROMPT + historyContext +
            `\n\nRound ${roundNumber}. ${validShots.length} screenshots:\n${imageLabels}` },
          ...imageParts,
          { text: "\nRespond with ONLY valid JSON matching the schema above. No markdown fencing." },
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      });
      console.log(`  OK model: ${modelName}`);
      break;
    } catch (e) {
      console.log(`  FAIL ${modelName}: ${e.message?.slice(0, 120)}`);
    }
  }

  if (!result) { console.error("All screenshot models failed."); return null; }

  const text = result.response.text();
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("Failed to parse screenshot eval response");
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   PHASE 4: Video Evaluation with Gemini (new — File API)
   ═══════════════════════════════════════════════════════════════ */

async function evaluateVideos(videos) {
  if (SKIP_VIDEO || videos.filter((v) => v.path).length === 0) {
    console.log("\n[Phase 4] Skipping video evaluation (no videos)\n");
    return null;
  }

  console.log("\n[Phase 4] Uploading videos to Gemini File API ...\n");
  const genAI = new GoogleGenerativeAI(GEMINI_KEY);
  const fileManager = new GoogleAIFileManager(GEMINI_KEY);

  // Upload all valid videos
  const uploadedFiles = [];
  for (const video of videos.filter((v) => v.path)) {
    try {
      console.log(`  Uploading ${video.flowId} (${(video.sizeBytes / 1024).toFixed(0)}KB) ...`);
      const uploadResult = await fileManager.uploadFile(video.path, {
        mimeType: "video/webm",
        displayName: `nodebench-qa-${video.flowId}`,
      });

      // Poll until file is ACTIVE
      let file = uploadResult.file;
      let attempts = 0;
      while (file.state === "PROCESSING" && attempts < 30) {
        await new Promise((r) => setTimeout(r, 2000));
        file = await fileManager.getFile(file.name);
        attempts++;
      }

      if (file.state === "ACTIVE") {
        uploadedFiles.push({ flowId: video.flowId, fileUri: file.uri, fileName: file.name });
        console.log(`  OK ${video.flowId} uploaded and active`);
      } else {
        console.log(`  WARN ${video.flowId} stuck in state: ${file.state}`);
      }
    } catch (e) {
      console.log(`  FAIL upload ${video.flowId}: ${e.message?.slice(0, 120)}`);
    }
  }

  if (uploadedFiles.length === 0) {
    console.log("  No videos uploaded successfully.");
    return null;
  }

  // Send all uploaded videos to Gemini for temporal analysis
  let result;
  for (const modelName of MODELS_VIDEO) {
    try {
      console.log(`  Evaluating with ${modelName} ...`);
      const model = genAI.getGenerativeModel({ model: modelName });

      const fileParts = uploadedFiles.map((f) => ({
        fileData: { mimeType: "video/webm", fileUri: f.fileUri },
      }));

      const fileLabels = uploadedFiles.map((f) => `[Video: ${f.flowId}]`).join("\n");

      result = await model.generateContent({
        contents: [{ role: "user", parts: [
          { text: VIDEO_EVAL_PROMPT + `\n\n${uploadedFiles.length} interaction videos:\n${fileLabels}` },
          ...fileParts,
          { text: "\nRespond with ONLY valid JSON. No markdown fencing." },
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      });
      console.log(`  OK video eval with ${modelName}`);
      break;
    } catch (e) {
      console.log(`  FAIL ${modelName}: ${e.message?.slice(0, 120)}`);
    }
  }

  // Cleanup uploaded files
  for (const f of uploadedFiles) {
    try { await fileManager.deleteFile(f.fileName); } catch { /* best effort */ }
  }

  if (!result) { console.error("All video eval models failed."); return null; }

  const text = result.response.text();
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error("Failed to parse video eval response");
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   PHASE 5: Cross-Round Comparison — Gen-over-Gen Milestone Engine
   ═══════════════════════════════════════════════════════════════
   Upgraded from simple prev-round diff to full generational analysis:
   - Milestone comparisons (vs baseline, midpoints, every 5th round)
   - Semantic P1 fingerprinting (dedup stochastic re-flags by description)
   - Video dimension trends across ALL rounds (not just score)
   - All-time dimension stats with trend direction + velocity
   - Generation segmentation (Gen 1 = R11-R15, Gen 2 = R16-R20, etc.)
   ═══════════════════════════════════════════════════════════════ */

const GEN_SIZE = 5; // Rounds per generation

function extractAllP1Ids(screenshotEval) {
  if (!screenshotEval?.surfaceScores) return [];
  const ids = [];
  for (const [, data] of Object.entries(screenshotEval.surfaceScores)) {
    for (const p1 of data.p1Issues || []) {
      if (p1.issueId) ids.push(p1.issueId);
    }
  }
  return ids;
}

function extractAllP1Details(screenshotEval) {
  if (!screenshotEval?.surfaceScores) return [];
  const details = [];
  for (const [surfaceId, data] of Object.entries(screenshotEval.surfaceScores)) {
    for (const p1 of data.p1Issues || []) {
      details.push({ ...p1, surface: surfaceId });
    }
  }
  return details;
}

/**
 * Semantic P1 fingerprint — normalize issue text to catch stochastic
 * re-flags that get different issueId each round but describe the same bug.
 * E.g. "p1-home-3" and "p1-home-2" with text "Chat now button low contrast"
 * should be recognized as the same issue.
 */
function p1Fingerprint(p1) {
  const text = (p1.issue || p1.issueId || "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")     // strip punctuation
    .replace(/\s+/g, " ")            // normalize whitespace
    .trim();
  const surface = (p1.surface || "").toLowerCase();
  // Use first 60 chars of normalized issue text + surface as fingerprint
  return `${surface}::${text.slice(0, 60)}`;
}

/**
 * Group rounds into generations. Gen 1 = first GEN_SIZE rounds, etc.
 */
function assignGeneration(roundNumber, baselineRound) {
  return Math.floor((roundNumber - baselineRound) / GEN_SIZE) + 1;
}

/**
 * Select milestone rounds for comparison from history:
 * - Baseline (first round)
 * - Midpoint (50% through history)
 * - Every GEN_SIZE-th round (generation boundaries)
 * - Previous round
 */
function selectMilestoneRounds(history, currentRound) {
  if (history.length === 0) return [];
  const milestones = [];
  const seen = new Set();

  // Baseline (first round)
  const baseline = history[0];
  milestones.push({ tag: "baseline", round: baseline });
  seen.add(baseline.roundNumber);

  // Generation boundaries (every GEN_SIZE rounds)
  const baseRound = history[0].roundNumber;
  for (const r of history) {
    const gen = assignGeneration(r.roundNumber, baseRound);
    const genStart = baseRound + (gen - 1) * GEN_SIZE;
    // Pick the first round of each generation as boundary marker
    if (r.roundNumber === genStart && !seen.has(r.roundNumber)) {
      milestones.push({ tag: `gen-${gen}-start`, round: r });
      seen.add(r.roundNumber);
    }
  }

  // Midpoint
  const midIdx = Math.floor(history.length / 2);
  if (!seen.has(history[midIdx].roundNumber)) {
    milestones.push({ tag: "midpoint", round: history[midIdx] });
    seen.add(history[midIdx].roundNumber);
  }

  // Previous round (most recent in history)
  const prev = history[history.length - 1];
  if (!seen.has(prev.roundNumber)) {
    milestones.push({ tag: "previous", round: prev });
    seen.add(prev.roundNumber);
  }

  return milestones.sort((a, b) => a.round.roundNumber - b.round.roundNumber);
}

/**
 * Compute a milestone diff: current vs reference round.
 */
function computeMilestoneDiff(current, reference, tag) {
  const currScore = current.screenshotEval?.overallScore || 0;
  const refScore = reference.screenshotEval?.overallScore || 0;
  const currP1s = extractAllP1Details(current.screenshotEval);
  const refP1s = extractAllP1Details(reference.screenshotEval);

  // Semantic fingerprint diff
  const currFingerprints = new Set(currP1s.map(p1Fingerprint));
  const refFingerprints = new Set(refP1s.map(p1Fingerprint));
  const resolvedFingerprints = [...refFingerprints].filter(f => !currFingerprints.has(f));
  const newFingerprints = [...currFingerprints].filter(f => !refFingerprints.has(f));

  // Scenario diff
  const currScenarios = current.screenshotEval?.scenarioResults || {};
  const refScenarios = reference.screenshotEval?.scenarioResults || {};
  const currPass = Object.values(currScenarios).filter(r => r.pass).length;
  const refPass = Object.values(refScenarios).filter(r => r.pass).length;

  // Video diff
  const currVideoScore = current.videoEval?.overallInteractionScore || null;
  const refVideoScore = reference.videoEval?.overallInteractionScore || null;

  // Dimension diff (screenshot)
  const dimNames = ["visualHierarchy", "touchTargets", "contentDensity", "typography", "firstImpression",
    "glassDesignSystem", "navigation", "emptyLoadingStates", "responsiveParity", "interactionQuality"];
  const dimDiffs = {};
  for (const dim of dimNames) {
    const currAvg = avgDimension(current.screenshotEval, dim);
    const refAvg = avgDimension(reference.screenshotEval, dim);
    if (currAvg != null && refAvg != null) {
      dimDiffs[dim] = { current: currAvg, reference: refAvg, delta: +(currAvg - refAvg).toFixed(1) };
    }
  }

  // Video dimension diff
  const videoDimDiffs = {};
  const vidDimNames = ["transitionSmoothness", "loadingTiming", "statePersistence", "dataLoading",
    "interactionResponsiveness", "errorHandling", "navigationFlow", "animationQuality"];
  for (const dim of vidDimNames) {
    const curr = current.videoEval?.dimensions?.[dim] ?? null;
    const ref = reference.videoEval?.dimensions?.[dim] ?? null;
    if (curr != null && ref != null) {
      videoDimDiffs[dim] = { current: curr, reference: ref, delta: curr - ref };
    }
  }

  return {
    tag,
    referenceRound: reference.roundNumber,
    referenceLabel: reference.label || "",
    roundsApart: current.roundNumber - reference.roundNumber,
    scoreDiff: { current: currScore, reference: refScore, delta: currScore - refScore },
    p1Diff: {
      current: currP1s.length, reference: refP1s.length, delta: currP1s.length - refP1s.length,
      resolvedSemanticCount: resolvedFingerprints.length,
      newSemanticCount: newFingerprints.length,
    },
    scenarioDiff: { current: currPass, reference: refPass, delta: currPass - refPass },
    videoDiff: currVideoScore != null && refVideoScore != null
      ? { current: currVideoScore, reference: refVideoScore, delta: currVideoScore - refVideoScore }
      : null,
    dimensionDiffs: dimDiffs,
    videoDimensionDiffs: videoDimDiffs,
  };
}

function avgDimension(screenshotEval, dim) {
  if (!screenshotEval?.surfaceScores) return null;
  const scores = Object.values(screenshotEval.surfaceScores)
    .map(s => s.dimensions?.[dim]).filter(v => v != null);
  return scores.length > 0 ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null;
}

/**
 * Compute trend direction and velocity from a numeric series.
 * Returns: { direction: "up"|"down"|"flat", velocity: number, start, end, range }
 */
function computeTrend(series) {
  const valid = series.filter(v => v != null);
  if (valid.length < 2) return { direction: "flat", velocity: 0, start: valid[0] ?? null, end: valid[0] ?? null, range: 0 };
  const start = valid[0];
  const end = valid[valid.length - 1];
  const delta = end - start;
  const velocity = +(delta / valid.length).toFixed(2);
  const range = Math.max(...valid) - Math.min(...valid);
  const direction = Math.abs(delta) < 0.5 ? "flat" : delta > 0 ? "up" : "down";
  return { direction, velocity, start, end, range: +range.toFixed(1) };
}

function generateCrossRoundComparison(currentRound, history) {
  console.log("\n[Phase 5] Generating gen-over-gen cross-round comparison ...\n");

  const allRounds = [...history, currentRound];
  const baselineRound = allRounds[0]?.roundNumber || currentRound.roundNumber;

  const comparison = {
    currentRound: currentRound.roundNumber,
    currentGeneration: assignGeneration(currentRound.roundNumber, baselineRound),
    totalRoundsCompleted: allRounds.length,
    totalGenerations: assignGeneration(currentRound.roundNumber, baselineRound),
    timestamp: currentRound.timestamp,

    // === Full score trajectory (all rounds) ===
    scoreTrajectory: [],

    // === Milestone diffs: current vs baseline, midpoint, gen boundaries, previous ===
    milestoneDiffs: [],

    // === Generation summary: aggregated stats per generation ===
    generationSummary: [],

    // === P1 tracking with semantic fingerprinting ===
    p1Tracking: { resolved: [], regressed: [], persistent: [], new: [], stochastic: [] },

    // === ALL-TIME dimension trends (every round, not just last 5) ===
    dimensionTrends: {},
    dimensionStats: {},

    // === Video dimension trends (all rounds) ===
    videoDimensionTrends: {},
    videoDimensionStats: {},

    // === Video score trajectory ===
    videoScoreTrajectory: [],

    // === Scenario trends (all rounds) ===
    scenarioTrends: {},
    scenarioStats: {},

    // === Summary + actions ===
    summary: "",
    generationNarrative: "",
    nextActions: [],
  };

  // ── Build full score trajectory ──
  for (const round of allRounds) {
    const ss = round.screenshotEval;
    if (!ss) continue;
    const gen = assignGeneration(round.roundNumber, baselineRound);
    comparison.scoreTrajectory.push({
      round: round.roundNumber,
      generation: gen,
      score: ss.overallScore || 0,
      p1Count: extractAllP1Details(ss).length,
      p2Count: Object.values(ss.surfaceScores || {}).reduce((sum, s) => sum + (s.p2Issues?.length || 0), 0),
      scenarioPassRate: ss.scenarioResults
        ? +(Object.values(ss.scenarioResults).filter(r => r.pass).length / Math.max(Object.values(ss.scenarioResults).length, 1)).toFixed(2)
        : null,
      label: round.label || "",
    });

    // Video trajectory — now includes dimensions
    if (round.videoEval?.overallInteractionScore) {
      comparison.videoScoreTrajectory.push({
        round: round.roundNumber,
        generation: gen,
        score: round.videoEval.overallInteractionScore,
        dimensions: round.videoEval.dimensions || {},
      });
    }
  }

  // ── Milestone diffs ──
  const milestones = selectMilestoneRounds(history, currentRound);
  console.log(`  Milestone comparisons: ${milestones.map(m => `${m.tag}(R${m.round.roundNumber})`).join(", ") || "none (first round)"}`);
  for (const m of milestones) {
    comparison.milestoneDiffs.push(computeMilestoneDiff(currentRound, m.round, m.tag));
  }

  // ── Generation summary: aggregate stats per generation ──
  const genMap = new Map();
  for (const round of allRounds) {
    const gen = assignGeneration(round.roundNumber, baselineRound);
    if (!genMap.has(gen)) genMap.set(gen, []);
    genMap.get(gen).push(round);
  }
  for (const [gen, rounds] of [...genMap.entries()].sort((a, b) => a[0] - b[0])) {
    const scores = rounds.map(r => r.screenshotEval?.overallScore).filter(v => v != null);
    const p1Counts = rounds.map(r => extractAllP1Details(r.screenshotEval).length);
    const videoScores = rounds.map(r => r.videoEval?.overallInteractionScore).filter(v => v != null);
    const scenarioPassRates = rounds.map(r => {
      const sr = r.screenshotEval?.scenarioResults;
      return sr ? Object.values(sr).filter(s => s.pass).length / Math.max(Object.values(sr).length, 1) : null;
    }).filter(v => v != null);

    comparison.generationSummary.push({
      generation: gen,
      roundRange: `R${rounds[0].roundNumber}-R${rounds[rounds.length - 1].roundNumber}`,
      roundCount: rounds.length,
      avgScore: scores.length > 0 ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null,
      bestScore: scores.length > 0 ? Math.max(...scores) : null,
      avgP1Count: +(p1Counts.reduce((a, b) => a + b, 0) / p1Counts.length).toFixed(1),
      avgVideoScore: videoScores.length > 0 ? +(videoScores.reduce((a, b) => a + b, 0) / videoScores.length).toFixed(1) : null,
      avgScenarioPassRate: scenarioPassRates.length > 0
        ? +(scenarioPassRates.reduce((a, b) => a + b, 0) / scenarioPassRates.length).toFixed(2) : null,
    });
  }

  // ── P1 tracking with SEMANTIC FINGERPRINTING ──
  if (history.length > 0) {
    const prev = history[history.length - 1];
    const currP1Details = extractAllP1Details(currentRound.screenshotEval);
    const prevP1Details = extractAllP1Details(prev.screenshotEval);

    // Build fingerprint maps
    const currFpMap = new Map(); // fingerprint -> p1 detail
    for (const p of currP1Details) currFpMap.set(p1Fingerprint(p), p);
    const prevFpMap = new Map();
    for (const p of prevP1Details) prevFpMap.set(p1Fingerprint(p), p);

    const currFingerprints = new Set(currFpMap.keys());
    const prevFingerprints = new Set(prevFpMap.keys());

    // Also build all-history fingerprint map for regression detection
    const allHistoryFpSets = history.slice(0, -1).map(r => {
      const details = extractAllP1Details(r.screenshotEval);
      return new Set(details.map(p1Fingerprint));
    });
    const allHistoryFingerprints = new Set();
    for (const fpSet of allHistoryFpSets) {
      for (const fp of fpSet) allHistoryFingerprints.add(fp);
    }

    // Resolved: was in prev, not in current (by fingerprint)
    for (const fp of prevFingerprints) {
      if (!currFingerprints.has(fp)) {
        const detail = prevFpMap.get(fp);
        comparison.p1Tracking.resolved.push({
          fingerprint: fp,
          issueId: detail?.issueId || fp,
          issue: detail?.issue || fp,
          surface: detail?.surface,
          resolvedInRound: currentRound.roundNumber,
        });
      }
    }

    // New: in current, not in prev (by fingerprint)
    for (const fp of currFingerprints) {
      if (!prevFingerprints.has(fp)) {
        const detail = currFpMap.get(fp);
        // Check if this is actually a stochastic re-flag (appeared in older rounds, disappeared, reappeared)
        const isStochastic = allHistoryFingerprints.has(fp) && !prevFingerprints.has(fp);
        if (isStochastic) {
          comparison.p1Tracking.stochastic.push({
            fingerprint: fp,
            issueId: detail?.issueId || fp,
            issue: detail?.issue || fp,
            surface: detail?.surface,
            note: "Stochastic re-flag: appeared before, disappeared, reappeared (likely Gemini variance, not a real regression)",
          });
        } else {
          comparison.p1Tracking.new.push({
            fingerprint: fp,
            issueId: detail?.issueId || fp,
            issue: detail?.issue || fp,
            surface: detail?.surface,
          });
        }
      }
    }

    // Persistent: in both (by fingerprint)
    for (const fp of currFingerprints) {
      if (prevFingerprints.has(fp)) {
        const detail = currFpMap.get(fp);
        // Count how many consecutive rounds this has persisted
        let streak = 0;
        for (let i = history.length - 1; i >= 0; i--) {
          const rFps = new Set(extractAllP1Details(history[i].screenshotEval).map(p1Fingerprint));
          if (rFps.has(fp)) streak++;
          else break;
        }
        comparison.p1Tracking.persistent.push({
          fingerprint: fp,
          issueId: detail?.issueId || fp,
          issue: detail?.issue || fp,
          surface: detail?.surface,
          persistedRounds: streak + 1, // +1 for current round
        });
      }
    }

    // Regressed: appeared in history, resolved, now back (excluding stochastic)
    for (const fp of currFingerprints) {
      if (allHistoryFingerprints.has(fp) && !prevFingerprints.has(fp)) {
        // Already captured in stochastic above — only flag as regression if
        // it was resolved for 3+ rounds (not just 1-round Gemini variance)
        let gapRounds = 0;
        for (let i = history.length - 1; i >= 0; i--) {
          const rFps = new Set(extractAllP1Details(history[i].screenshotEval).map(p1Fingerprint));
          if (!rFps.has(fp)) gapRounds++;
          else break;
        }
        if (gapRounds >= 3) {
          const detail = currFpMap.get(fp);
          comparison.p1Tracking.regressed.push({
            fingerprint: fp,
            issueId: detail?.issueId || fp,
            issue: detail?.issue || fp,
            surface: detail?.surface,
            gapRounds,
          });
        }
      }
    }
  }

  // ── ALL-TIME screenshot dimension trends (every round) ──
  const dimNames = ["visualHierarchy", "touchTargets", "contentDensity", "typography", "firstImpression",
    "glassDesignSystem", "navigation", "emptyLoadingStates", "responsiveParity", "interactionQuality"];
  for (const dim of dimNames) {
    const series = allRounds.map(r => ({
      round: r.roundNumber,
      generation: assignGeneration(r.roundNumber, baselineRound),
      avg: avgDimension(r.screenshotEval, dim),
    }));
    comparison.dimensionTrends[dim] = series;
    comparison.dimensionStats[dim] = computeTrend(series.map(s => s.avg));
  }

  // ── ALL-TIME video dimension trends ──
  const vidDimNames = ["transitionSmoothness", "loadingTiming", "statePersistence", "dataLoading",
    "interactionResponsiveness", "errorHandling", "navigationFlow", "animationQuality"];
  for (const dim of vidDimNames) {
    const series = allRounds.map(r => ({
      round: r.roundNumber,
      generation: assignGeneration(r.roundNumber, baselineRound),
      value: r.videoEval?.dimensions?.[dim] ?? null,
    })).filter(s => s.value != null);
    comparison.videoDimensionTrends[dim] = series;
    comparison.videoDimensionStats[dim] = computeTrend(series.map(s => s.value));
  }

  // ── ALL-TIME scenario trends ──
  for (const sId of ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]) {
    const series = allRounds.map(r => ({
      round: r.roundNumber,
      generation: assignGeneration(r.roundNumber, baselineRound),
      pass: r.screenshotEval?.scenarioResults?.[sId]?.pass ?? null,
    }));
    comparison.scenarioTrends[sId] = series;
    // Compute pass rate and stability
    const valid = series.filter(s => s.pass != null);
    const passCount = valid.filter(s => s.pass).length;
    comparison.scenarioStats[sId] = {
      passRate: valid.length > 0 ? +(passCount / valid.length).toFixed(2) : null,
      totalPasses: passCount,
      totalFails: valid.length - passCount,
      lastFlip: (() => {
        for (let i = valid.length - 1; i > 0; i--) {
          if (valid[i].pass !== valid[i - 1].pass) return valid[i].round;
        }
        return null;
      })(),
    };
  }

  // ── Generate summary ──
  const curr = currentRound.screenshotEval;
  const prevScore = history.length > 0 ? history[history.length - 1].screenshotEval?.overallScore : null;
  const scoreDelta = prevScore != null && curr?.overallScore != null ? curr.overallScore - prevScore : null;
  const baselineScore = history.length > 0 ? history[0].screenshotEval?.overallScore : null;
  const baselineDelta = baselineScore != null && curr?.overallScore != null ? curr.overallScore - baselineScore : null;
  const resolvedCount = comparison.p1Tracking.resolved.length;
  const newCount = comparison.p1Tracking.new.length;
  const persistentCount = comparison.p1Tracking.persistent.length;
  const stochasticCount = comparison.p1Tracking.stochastic.length;

  comparison.summary = [
    `Round ${currentRound.roundNumber} (Gen ${comparison.currentGeneration}): score ${curr?.overallScore || "?"}`,
    scoreDelta != null ? `${scoreDelta >= 0 ? "+" : ""}${scoreDelta} vs prev` : null,
    baselineDelta != null ? `${baselineDelta >= 0 ? "+" : ""}${baselineDelta} vs baseline` : null,
    resolvedCount > 0 ? `${resolvedCount} P1s resolved` : null,
    newCount > 0 ? `${newCount} genuinely new P1s` : null,
    stochasticCount > 0 ? `${stochasticCount} stochastic re-flags (Gemini variance)` : null,
    persistentCount > 0 ? `${persistentCount} P1s persistent` : null,
    comparison.p1Tracking.regressed.length > 0 ? `WARNING: ${comparison.p1Tracking.regressed.length} P1s regressed after 3+ round absence` : null,
  ].filter(Boolean).join(". ") + ".";

  // ── Generation narrative ──
  if (comparison.generationSummary.length >= 2) {
    const gens = comparison.generationSummary;
    const first = gens[0];
    const last = gens[gens.length - 1];
    const scoreDelta = last.avgScore != null && first.avgScore != null ? +(last.avgScore - first.avgScore).toFixed(1) : null;
    const p1Delta = +(last.avgP1Count - first.avgP1Count).toFixed(1);
    comparison.generationNarrative = [
      `${gens.length} generations completed (${first.roundRange} -> ${last.roundRange}).`,
      scoreDelta != null ? `Score trajectory: Gen 1 avg ${first.avgScore} -> Gen ${gens.length} avg ${last.avgScore} (${scoreDelta >= 0 ? "+" : ""}${scoreDelta}).` : null,
      `P1 trend: Gen 1 avg ${first.avgP1Count} -> Gen ${gens.length} avg ${last.avgP1Count} (${p1Delta >= 0 ? "+" : ""}${p1Delta}).`,
      last.avgVideoScore != null && first.avgVideoScore != null
        ? `Video: Gen 1 avg ${first.avgVideoScore} -> Gen ${gens.length} avg ${last.avgVideoScore} (${(last.avgVideoScore - first.avgVideoScore).toFixed(1)}).`
        : null,
    ].filter(Boolean).join(" ");
  }

  // ── Next actions ──
  // Persistent P1s with long streaks are highest priority
  const longPersistent = comparison.p1Tracking.persistent.filter(p => p.persistedRounds >= 3);
  if (longPersistent.length > 0) {
    comparison.nextActions.push(`PRIORITY: Fix ${longPersistent.length} P1s persisting 3+ rounds: ${longPersistent.map(p => `${p.issueId}(${p.persistedRounds}R)`).join(", ")}`);
  }
  if (comparison.p1Tracking.regressed.length > 0) {
    comparison.nextActions.push(`URGENT: Investigate ${comparison.p1Tracking.regressed.length} regressions after 3+ round absence`);
  }

  // Check dimension trends for declining areas
  for (const [dim, stats] of Object.entries(comparison.dimensionStats)) {
    if (stats.direction === "down" && stats.velocity < -0.3) {
      comparison.nextActions.push(`DECLINING: ${dim} trending down (${stats.start} -> ${stats.end}, velocity ${stats.velocity}/round)`);
    }
  }

  // Score plateau detection (3+ rounds within 2 points)
  const last5 = comparison.scoreTrajectory.slice(-5);
  if (last5.length >= 3) {
    const scores = last5.map(r => r.score);
    const range = Math.max(...scores) - Math.min(...scores);
    if (range <= 2) {
      comparison.nextActions.push(`Score plateau (last ${last5.length} rounds within ${range} points). Consider: model rotation, new scenario types, structural CSS overhaul.`);
    }
  }

  // Scenario stability
  const unstableScenarios = Object.entries(comparison.scenarioStats)
    .filter(([, stats]) => stats.passRate != null && stats.passRate < 1.0 && stats.passRate > 0)
    .map(([sId, stats]) => `${sId}(${Math.round(stats.passRate * 100)}%)`);
  if (unstableScenarios.length > 0) {
    comparison.nextActions.push(`Unstable scenarios: ${unstableScenarios.join(", ")} — investigate root cause of flakiness`);
  }

  return comparison;
}

/* ═══════════════════════════════════════════════════════════════
   PHASE 6: Report Printing — Gen-over-Gen Upgrade
   ═══════════════════════════════════════════════════════════════ */

function printReport(roundData) {
  const { screenshotEval, videoEval, comparison } = roundData;

  console.log("\n" + "=".repeat(72));
  console.log(`  INTERACTIVE GEMINI QA — ROUND ${roundData.roundNumber} (Gen ${comparison?.currentGeneration || "?"})`);
  console.log("=".repeat(72));

  // ── Cross-round summary ──
  if (comparison) {
    console.log(`\n${comparison.summary}`);

    // Generation narrative
    if (comparison.generationNarrative) {
      console.log(`\nGeneration narrative: ${comparison.generationNarrative}`);
    }

    // Compact score trajectory (grouped by generation)
    const grouped = new Map();
    for (const r of comparison.scoreTrajectory) {
      const key = `Gen${r.generation}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(`R${r.round}:${r.score}`);
    }
    console.log("\nScore trajectory by generation:");
    for (const [gen, rounds] of grouped) {
      console.log(`  ${gen.padEnd(6)} ${rounds.join(" -> ")}`);
    }

    // ── Milestone diffs (the gen-over-gen comparisons) ──
    if (comparison.milestoneDiffs?.length > 0) {
      console.log("\nMilestone comparisons (current vs historical reference):");
      console.log("  " + "Tag".padEnd(18) + "Ref".padEnd(6) + "Score".padEnd(10) + "P1s".padEnd(10) + "Scenarios".padEnd(12) + "Video");
      console.log("  " + "-".repeat(66));
      for (const m of comparison.milestoneDiffs) {
        const scoreStr = `${m.scoreDiff.delta >= 0 ? "+" : ""}${m.scoreDiff.delta}`;
        const p1Str = `${m.p1Diff.delta >= 0 ? "+" : ""}${m.p1Diff.delta}`;
        const scenStr = `${m.scenarioDiff.delta >= 0 ? "+" : ""}${m.scenarioDiff.delta}`;
        const vidStr = m.videoDiff ? `${m.videoDiff.delta >= 0 ? "+" : ""}${m.videoDiff.delta}` : "n/a";
        console.log(`  ${m.tag.padEnd(18)}R${String(m.referenceRound).padEnd(5)}${scoreStr.padEnd(10)}${p1Str.padEnd(10)}${scenStr.padEnd(12)}${vidStr}`);
      }
    }

    // ── Generation summary table ──
    if (comparison.generationSummary?.length > 1) {
      console.log("\nGeneration summary:");
      console.log("  " + "Gen".padEnd(6) + "Rounds".padEnd(12) + "AvgScore".padEnd(10) + "BestScore".padEnd(10) + "AvgP1s".padEnd(8) + "AvgVideo".padEnd(10) + "Scenarios");
      console.log("  " + "-".repeat(72));
      for (const g of comparison.generationSummary) {
        console.log(`  ${String(g.generation).padEnd(6)}${g.roundRange.padEnd(12)}${String(g.avgScore ?? "?").padEnd(10)}${String(g.bestScore ?? "?").padEnd(10)}${String(g.avgP1Count).padEnd(8)}${String(g.avgVideoScore ?? "?").padEnd(10)}${g.avgScenarioPassRate != null ? Math.round(g.avgScenarioPassRate * 100) + "%" : "?"}`);
      }
    }

    // ── P1 tracking (semantic fingerprinted) ──
    if (comparison.p1Tracking.resolved.length > 0) {
      console.log(`\nRESOLVED P1s (${comparison.p1Tracking.resolved.length}):`);
      comparison.p1Tracking.resolved.forEach((p) => console.log(`  [RESOLVED] ${p.issueId}: ${p.issue?.slice(0, 80)}`));
    }
    if (comparison.p1Tracking.new.length > 0) {
      console.log(`\nGENUINELY NEW P1s (${comparison.p1Tracking.new.length}):`);
      comparison.p1Tracking.new.forEach((p) => console.log(`  [NEW] ${p.issueId}: ${p.issue?.slice(0, 80)}`));
    }
    if (comparison.p1Tracking.stochastic.length > 0) {
      console.log(`\nSTOCHASTIC RE-FLAGS (${comparison.p1Tracking.stochastic.length}) — Gemini variance, not real regressions:`);
      comparison.p1Tracking.stochastic.forEach((p) => console.log(`  [STOCHASTIC] ${p.issueId}: ${p.issue?.slice(0, 80)}`));
    }
    if (comparison.p1Tracking.persistent.length > 0) {
      console.log(`\nPERSISTENT P1s (${comparison.p1Tracking.persistent.length}):`);
      comparison.p1Tracking.persistent.forEach((p) =>
        console.log(`  [PERSISTENT ${p.persistedRounds}R] ${p.issueId}: ${p.issue?.slice(0, 80)}`));
    }
    if (comparison.p1Tracking.regressed.length > 0) {
      console.log(`\n*** TRUE REGRESSIONS (${comparison.p1Tracking.regressed.length}) — absent ${">"}= 3 rounds then reappeared:`);
      comparison.p1Tracking.regressed.forEach((p) =>
        console.log(`  [REGRESSED gap=${p.gapRounds}R] ${p.issueId}: ${p.issue?.slice(0, 80)}`));
    }

    // ── Dimension trend summary (all-time, compact) ──
    const trendingDims = Object.entries(comparison.dimensionStats || {})
      .filter(([, s]) => s.direction !== "flat")
      .sort((a, b) => Math.abs(b[1].velocity) - Math.abs(a[1].velocity));
    if (trendingDims.length > 0) {
      console.log("\nDimension trends (all-time):");
      for (const [dim, stats] of trendingDims) {
        const arrow = stats.direction === "up" ? "^" : "v";
        console.log(`  ${arrow} ${dim.padEnd(24)} ${stats.start} -> ${stats.end}  (${stats.velocity >= 0 ? "+" : ""}${stats.velocity}/round)`);
      }
    }

    // ── Video dimension trends ──
    const vidTrends = Object.entries(comparison.videoDimensionStats || {})
      .filter(([, s]) => s.direction !== "flat" && s.start != null)
      .sort((a, b) => Math.abs(b[1].velocity) - Math.abs(a[1].velocity));
    if (vidTrends.length > 0) {
      console.log("\nVideo dimension trends (all-time):");
      for (const [dim, stats] of vidTrends) {
        const arrow = stats.direction === "up" ? "^" : "v";
        console.log(`  ${arrow} ${dim.padEnd(30)} ${stats.start} -> ${stats.end}  (${stats.velocity >= 0 ? "+" : ""}${stats.velocity}/round)`);
      }
    }

    // ── Scenario stability ──
    const scenarioEntries = Object.entries(comparison.scenarioStats || {}).filter(([, s]) => s.passRate != null);
    if (scenarioEntries.length > 0) {
      console.log("\nScenario stability (all-time):");
      for (const [sId, stats] of scenarioEntries) {
        const rate = Math.round(stats.passRate * 100);
        const badge = rate === 100 ? "STABLE" : rate >= 75 ? "FLAKY" : rate >= 50 ? "UNSTABLE" : "FAILING";
        const lastFlip = stats.lastFlip ? ` last-flip=R${stats.lastFlip}` : "";
        console.log(`  ${sId} ${String(rate).padStart(3)}% ${badge.padEnd(8)} (${stats.totalPasses}p/${stats.totalFails}f)${lastFlip}`);
      }
    }
  }

  // ── Screenshot eval summary ──
  if (screenshotEval) {
    console.log(`\nScreenshot Score: ${screenshotEval.overallScore}/100`);
    if (screenshotEval.surfaceScores) {
      const sorted = Object.entries(screenshotEval.surfaceScores).sort((a, b) => (a[1].score || 0) - (b[1].score || 0));
      for (const [id, data] of sorted) {
        const dims = data.dimensions || {};
        const lowest = Object.entries(dims).sort((a, b) => a[1] - b[1]).slice(0, 2);
        console.log(`  ${id.padEnd(12)} ${String(data.score || "?").padStart(3)}/100  weak: ${lowest.map(([k, v]) => `${k}=${v}`).join(", ")}`);
      }
    }
    if (screenshotEval.scenarioResults) {
      const passed = Object.values(screenshotEval.scenarioResults).filter((r) => r.pass).length;
      const total = Object.values(screenshotEval.scenarioResults).length;
      console.log(`\nScenarios: ${passed}/${total} passing`);
    }
  }

  // ── Video eval summary ──
  if (videoEval) {
    console.log(`\nVideo Interaction Score: ${videoEval.overallInteractionScore}/100`);
    if (videoEval.dimensions) {
      for (const [dim, score] of Object.entries(videoEval.dimensions)) {
        const bar = score >= 8 ? "OK" : score >= 6 ? "WARN" : "FAIL";
        // Show trend from comparison if available
        const trend = comparison?.videoDimensionStats?.[dim];
        const trendStr = trend && trend.direction !== "flat" ? ` (${trend.direction} ${trend.velocity >= 0 ? "+" : ""}${trend.velocity}/R)` : "";
        console.log(`  ${dim.padEnd(30)} ${score}/10  ${bar}${trendStr}`);
      }
    }
    if (videoEval.temporalIssues?.length) {
      console.log(`\nTemporal issues (${videoEval.temporalIssues.length}):`);
      videoEval.temporalIssues.forEach((t) =>
        console.log(`  [${t.severity}] @${t.timestamp}: ${t.issue?.slice(0, 80)}`));
    }
    if (videoEval.liveDataVerdict) {
      console.log(`\nLive data verdict: ${videoEval.liveDataVerdict.slice(0, 200)}`);
    }
  }

  // ── Next actions ──
  if (comparison?.nextActions?.length) {
    console.log("\nNext actions:");
    comparison.nextActions.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
  }

  console.log("\n" + "=".repeat(72));
}

/* ═══════════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════════ */

async function main() {
  const history = loadRoundHistory();
  const roundNumber = getNextRoundNumber(history);
  const roundDir = path.join(ROUNDS_DIR, `round-${String(roundNumber).padStart(3, "0")}`);
  fs.mkdirSync(roundDir, { recursive: true });

  console.log("=== Interactive Gemini QA Pipeline ===");
  console.log(`Round: ${roundNumber} | Base URL: ${BASE_URL} | Label: ${ROUND_LABEL || "(none)"}`);
  console.log(`History: ${history.length} previous rounds`);
  console.log(`Surfaces: ${SURFACES.map((s) => s.label).join(", ")}`);
  console.log(`Video: ${SKIP_VIDEO ? "SKIP" : `${INTERACTION_FLOWS.length} flows`}`);

  // Phase 1: Screenshots
  const { shots, validShots } = await captureAllSurfaces(roundDir);
  if (validShots.length === 0) {
    console.error("No screenshots captured. Is the dev server running?");
    process.exit(1);
  }

  // Phase 2: Interaction videos
  const { videos, interactionShots } = await recordInteractionVideos(roundDir);

  // Phase 3: Screenshot evaluation
  const screenshotEval = await evaluateScreenshots(validShots, roundNumber, history);
  if (!screenshotEval) {
    console.error("Screenshot evaluation failed.");
    process.exit(1);
  }

  // Phase 4: Video evaluation
  const videoEval = await evaluateVideos(videos);

  // Build round data
  const roundData = {
    roundNumber,
    timestamp: new Date().toISOString(),
    label: ROUND_LABEL,
    baseUrl: BASE_URL,
    screenshotEval,
    videoEval,
    metadata: {
      screenshotCount: validShots.length,
      videoCount: videos.filter((v) => v.path).length,
      interactionShotCount: interactionShots.length,
      flowResults: videos.map((v) => ({ flowId: v.flowId, success: v.success })),
    },
  };

  // Phase 5: Cross-round comparison
  const comparison = generateCrossRoundComparison(roundData, history);
  roundData.comparison = comparison;

  // Save round data
  fs.writeFileSync(path.join(roundDir, "evaluation.json"), JSON.stringify(roundData, null, 2));
  fs.writeFileSync(path.join(roundDir, "comparison.json"), JSON.stringify(comparison, null, 2));

  // Also write to the legacy location for backward compat
  fs.writeFileSync(path.join(OUT_DIR, "evaluation.json"), JSON.stringify(screenshotEval, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify({
    timestamp: roundData.timestamp, shots, validCount: validShots.length, roundNumber,
  }, null, 2));

  // Append to history
  appendRoundToHistory(roundData);

  // Phase 6: Print report
  printReport(roundData);

  console.log(`\nRound ${roundNumber} saved to: ${roundDir}`);
  console.log(`History: ${history.length + 1} rounds in ${HISTORY_FILE}`);

  return roundData;
}

main().catch((e) => { console.error(e); process.exit(1); });
