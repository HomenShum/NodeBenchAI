#!/usr/bin/env node
/**
 * Full-Surface Gemini QA — end-to-end dogfood across all redesign surfaces.
 * Captures screenshots of all 6 surfaces (Home, Reports, Chat, Inbox, Me, Workspace)
 * in both mobile (390x844) and desktop (1280x800) viewports, dark and light mode.
 * Sends to Gemini 3 Flash for structured evaluation with interaction testing.
 *
 * Usage: node scripts/ui/fullSurfaceGeminiQa.mjs [--base-url http://localhost:5200]
 */
import { chromium } from "playwright";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(ROOT, ".env.local") });

const BASE_URL = process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1] || "http://localhost:5200";
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) { console.error("GEMINI_API_KEY not found in .env.local"); process.exit(1); }

const OUT_DIR = path.join(ROOT, ".tmp", "full-surface-qa");
fs.mkdirSync(OUT_DIR, { recursive: true });

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

const SURFACES = [
  { id: "home", path: "/redesign", label: "Home" },
  { id: "reports", path: "/redesign/reports", label: "Reports" },
  { id: "chat", path: "/redesign/chat", label: "Chat" },
  { id: "inbox", path: "/redesign/inbox", label: "Inbox" },
  { id: "me", path: "/redesign/me", label: "Me / Profile" },
  { id: "workspace", path: "/redesign/workspace", label: "Workspace" },
];

const MODELS = [
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
];

const EVALUATION_PROMPT = `You are a senior product designer conducting a comprehensive QA dogfood review of a web application called "NodeBench AI" — an entity intelligence platform.

You are reviewing screenshots from MULTIPLE surfaces (pages) of the app, captured in both mobile and desktop viewports, dark and light themes.

DESIGN SYSTEM REFERENCE:
- Glass card DNA: backdrop-filter blur, semi-transparent bg, subtle white/8% borders
- Primary accent: terracotta #d97757 for CTAs and active states
- Typography: Manrope for UI, JetBrains Mono for code/data
- Dark theme bg: #151413, light theme: white
- Section labels: 11px uppercase tracking-widened, muted color

EVALUATION FRAMEWORK — Score each surface across 10 dimensions (1-10):

1. VISUAL HIERARCHY — Clear primary action, typography scale, information density
2. TOUCH TARGETS (mobile only) — All interactive elements >= 44px, comfortable spacing
3. CONTENT DENSITY — Appropriate information per viewport, scrollability
4. TYPOGRAPHY & CONTRAST — Body >= 14px, labels legible, WCAG AA contrast
5. FIRST IMPRESSION — Time to value < 5s, clear value proposition
6. GLASS DESIGN SYSTEM — Consistent glass cards, accent usage, font rendering
7. NAVIGATION — Tab bar works, active state clear, surface switching smooth
8. EMPTY/LOADING STATES — Skeleton loaders, helpful empty states, no blank screens
9. RESPONSIVE PARITY — Same features accessible on mobile and desktop, no broken layouts
10. INTERACTION QUALITY — Buttons respond, hover/focus states, keyboard accessibility

USER SCENARIOS TO EVALUATE (easy → complex):
- S1 (Easy): New user lands on Home — can they understand what the app does in 5 seconds?
- S2 (Easy): User taps a nav item — does the surface switch cleanly?
- S3 (Medium): User wants to search/ask a question — is the input obvious and reachable?
- S4 (Medium): User reviews reports — can they scan, filter, and drill into a report?
- S5 (Medium): User checks inbox — are notifications/items scannable and actionable?
- S6 (Complex): User navigates from Home → Reports → drills into a report → returns to Home
- S7 (Complex): User on mobile rotates between all 5 bottom nav surfaces rapidly
- S8 (Complex): User in Chat starts a conversation — does the interface support multi-turn?

MARKET REFERENCES:
- ChatGPT mobile: single-purpose clarity, instant input, streaming responses
- Perplexity: clean search + citation cards, source attribution
- Linear mobile: 44px+ targets, sub-50ms response, keyboard-first
- TikTok: zero-friction first content, single-screen focus
- Notion mobile: workspace navigation, content density, smooth transitions

OUTPUT FORMAT (JSON):
{
  "overallScore": <1-100>,
  "surfaceScores": {
    "<surfaceId>": {
      "score": <1-100>,
      "dimensions": {
        "visualHierarchy": <1-10>,
        "touchTargets": <1-10>,
        "contentDensity": <1-10>,
        "typography": <1-10>,
        "firstImpression": <1-10>,
        "glassDesignSystem": <1-10>,
        "navigation": <1-10>,
        "emptyLoadingStates": <1-10>,
        "responsiveParity": <1-10>,
        "interactionQuality": <1-10>
      },
      "findings": ["..."],
      "p1Issues": [{ "issue": "...", "location": "...", "fix": "...", "scenario": "S1-S8" }],
      "p2Issues": [{ "issue": "...", "location": "...", "fix": "..." }]
    }
  },
  "scenarioResults": {
    "S1": { "pass": true/false, "notes": "..." },
    "S2": { "pass": true/false, "notes": "..." },
    "S3": { "pass": true/false, "notes": "..." },
    "S4": { "pass": true/false, "notes": "..." },
    "S5": { "pass": true/false, "notes": "..." },
    "S6": { "pass": true/false, "notes": "..." },
    "S7": { "pass": true/false, "notes": "..." },
    "S8": { "pass": true/false, "notes": "..." }
  },
  "crossSurfaceIssues": [{ "issue": "...", "surfaces": ["..."], "fix": "..." }],
  "topPriorityFixes": ["1. ...", "2. ...", "3. ...", "4. ...", "5. ..."],
  "marketComparisonVerdict": "two paragraphs comparing to ChatGPT/Perplexity/Linear/Notion mobile"
}

Be specific: name exact elements, approximate sizes, CSS selectors when possible. Every fix must be actionable in < 30 min.`;

async function captureAllSurfaces() {
  console.log(`\nCapturing all surfaces at ${BASE_URL} ...\n`);
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
        const filepath = path.join(OUT_DIR, filename);
        await page.screenshot({ path: filepath, fullPage: false });
        shots.push({
          surface: surface.id,
          label: surface.label,
          viewport: viewport.name,
          scheme: viewport.scheme,
          path: filepath,
          dimensions: `${viewport.width}x${viewport.height}`,
        });
        console.log(`  ✓ ${surface.label} (${viewport.name})`);
      } catch (e) {
        console.log(`  ✗ ${surface.label} (${viewport.name}): ${e.message?.slice(0, 80)}`);
        shots.push({
          surface: surface.id,
          label: surface.label,
          viewport: viewport.name,
          scheme: viewport.scheme,
          path: null,
          error: e.message?.slice(0, 120),
        });
      }
    }

    // Interaction test: navigate between surfaces via bottom nav (mobile only)
    if (viewport.name === "mobile") {
      try {
        await page.goto(`${BASE_URL}/redesign`, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(1500);

        // Try clicking each bottom nav button
        const navButtons = await page.$$('[data-redesign] nav button, [data-redesign] nav a');
        if (navButtons.length > 0) {
          for (let i = 0; i < Math.min(navButtons.length, 5); i++) {
            await navButtons[i].click();
            await page.waitForTimeout(800);
          }
          const navShot = path.join(OUT_DIR, "nav-interaction-mobile.png");
          await page.screenshot({ path: navShot, fullPage: false });
          shots.push({
            surface: "nav-interaction",
            label: "Navigation Interaction Test",
            viewport: "mobile",
            scheme: "dark",
            path: navShot,
            dimensions: `${MOBILE.width}x${MOBILE.height}`,
          });
          console.log(`  ✓ Navigation interaction test (mobile)`);
        }
      } catch (e) {
        console.log(`  ✗ Navigation interaction: ${e.message?.slice(0, 80)}`);
      }
    }

    await context.close();
  }

  await browser.close();
  const validShots = shots.filter((s) => s.path);
  console.log(`\nCaptured ${validShots.length}/${shots.length} screenshots.\n`);
  return { shots, validShots };
}

async function evaluateWithGemini(validShots) {
  console.log("Sending to Gemini 3 Flash for evaluation...");
  const genAI = new GoogleGenerativeAI(GEMINI_KEY);

  const imageParts = validShots.map((s) => ({
    inlineData: {
      mimeType: "image/png",
      data: fs.readFileSync(s.path).toString("base64"),
    },
  }));

  const imageLabels = validShots
    .map((s) => `[Image: ${s.label} — ${s.viewport} ${s.dimensions || ""} ${s.scheme} mode]`)
    .join("\n");

  let result;
  for (const modelName of MODELS) {
    try {
      console.log(`  Trying model: ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      result = await model.generateContent([
        EVALUATION_PROMPT,
        `\n\nHere are ${validShots.length} screenshots across all surfaces and viewports:\n${imageLabels}`,
        ...imageParts,
        "\n\nRespond with ONLY valid JSON matching the schema above. No markdown fencing.",
      ]);
      console.log(`  ✓ Success with model: ${modelName}`);
      break;
    } catch (e) {
      console.log(`  ✗ ${modelName}: ${e.message?.slice(0, 120)}`);
    }
  }

  if (!result) {
    console.error("All Gemini models failed.");
    return null;
  }

  const text = result.response.text();
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("Failed to parse Gemini response:");
    console.error(text.slice(0, 3000));
    fs.writeFileSync(path.join(OUT_DIR, "raw-response.txt"), text);
    return null;
  }
}

function printReport(evaluation) {
  console.log("\n" + "=".repeat(70));
  console.log("  FULL-SURFACE QA EVALUATION REPORT");
  console.log("=".repeat(70));
  console.log(`\nOverall Score: ${evaluation.overallScore}/100\n`);

  if (evaluation.surfaceScores) {
    console.log("Surface Scores:");
    const sorted = Object.entries(evaluation.surfaceScores).sort((a, b) => (a[1].score || 0) - (b[1].score || 0));
    for (const [id, data] of sorted) {
      const score = data.score || "?";
      const dims = data.dimensions || {};
      const lowest = Object.entries(dims).sort((a, b) => a[1] - b[1]).slice(0, 2);
      const lowestStr = lowest.map(([k, v]) => `${k}=${v}`).join(", ");
      console.log(`  ${id.padEnd(12)} ${String(score).padStart(3)}/100  weakest: ${lowestStr}`);
      if (data.p1Issues?.length) {
        data.p1Issues.forEach((p) => console.log(`    P1: [${p.location}] ${p.issue}`));
      }
    }
  }

  if (evaluation.scenarioResults) {
    console.log("\nScenario Results:");
    for (const [id, result] of Object.entries(evaluation.scenarioResults)) {
      const icon = result.pass ? "✓" : "✗";
      console.log(`  ${icon} ${id}: ${result.notes?.slice(0, 100) || ""}`);
    }
  }

  if (evaluation.crossSurfaceIssues?.length) {
    console.log(`\nCross-Surface Issues (${evaluation.crossSurfaceIssues.length}):`);
    evaluation.crossSurfaceIssues.forEach((c, i) =>
      console.log(`  ${i + 1}. [${c.surfaces?.join(", ")}] ${c.issue}\n     Fix: ${c.fix}`)
    );
  }

  const totalP1 = Object.values(evaluation.surfaceScores || {}).reduce((sum, s) => sum + (s.p1Issues?.length || 0), 0);
  const totalP2 = Object.values(evaluation.surfaceScores || {}).reduce((sum, s) => sum + (s.p2Issues?.length || 0), 0);
  console.log(`\nTotal: ${totalP1} P1s, ${totalP2} P2s`);

  if (evaluation.topPriorityFixes?.length) {
    console.log("\nTop Priority Fixes:");
    evaluation.topPriorityFixes.forEach((f) => console.log(`  ${f}`));
  }

  if (evaluation.marketComparisonVerdict) {
    console.log(`\nMarket Comparison:\n  ${evaluation.marketComparisonVerdict.slice(0, 500)}`);
  }
}

async function main() {
  console.log("=== NodeBench Full-Surface Gemini QA ===");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Surfaces: ${SURFACES.map((s) => s.label).join(", ")}`);
  console.log(`Viewports: mobile (390x844), desktop (1280x800)`);
  console.log(`Themes: dark, light`);

  const { shots, validShots } = await captureAllSurfaces();

  if (validShots.length === 0) {
    console.error("No screenshots captured. Is the dev server running?");
    process.exit(1);
  }

  const evaluation = await evaluateWithGemini(validShots);
  if (!evaluation) {
    console.error("Evaluation failed — see raw response.");
    process.exit(1);
  }

  const resultPath = path.join(OUT_DIR, "evaluation.json");
  fs.writeFileSync(resultPath, JSON.stringify(evaluation, null, 2));
  console.log(`\nResults saved to: ${resultPath}`);

  // Save screenshot manifest
  const manifest = { timestamp: new Date().toISOString(), shots, validCount: validShots.length };
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  printReport(evaluation);
  return evaluation;
}

main().catch((e) => { console.error(e); process.exit(1); });
