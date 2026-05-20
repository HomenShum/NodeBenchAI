#!/usr/bin/env node
/**
 * Mobile Home Surface Gemini QA — self-evaluation loop.
 * Captures mobile screenshots of /redesign at 390x844, sends to Gemini for
 * structured evaluation against top market references (ChatGPT, Perplexity,
 * Linear, TikTok mobile UX).
 *
 * Usage: node scripts/ui/mobileHomeGeminiQa.mjs [--base-url http://localhost:5200]
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

const OUT_DIR = path.join(ROOT, ".tmp", "mobile-home-qa");
fs.mkdirSync(OUT_DIR, { recursive: true });

const MOBILE_VIEWPORT = { width: 390, height: 844 };

const MARKET_REFERENCE_PROMPT = `You are a senior product designer and mobile UX expert evaluating a mobile web app.

CONTEXT: This is the mobile Home surface (390x844 viewport, dark mode) of "NodeBench AI" — an entity intelligence platform. The surface shows:
- A "Report Halo" section (reusable memory/reports list)
- An "Ask First" section with a universal search/chat composer
- Daily introspection and runtime promise badges

EVALUATION CRITERIA — Score each 1-10 against these top market mobile references:

1. VISUAL HIERARCHY (ref: ChatGPT mobile — single clear input, minimal chrome)
   - Is there ONE clear primary action? Or competing visual weights?
   - Does the typography scale feel native-mobile (not shrunk desktop)?
   - Is the information density appropriate for a phone screen?

2. TOUCH TARGETS & SPACING (ref: Linear mobile — 44px+ touch targets, generous padding)
   - Are all interactive elements >= 44px touch target?
   - Is there enough breathing room between tappable items?
   - Would a thumb comfortably reach primary actions?

3. CONTENT DENSITY (ref: TikTok — one piece of content fills the screen)
   - Is there too much above the fold competing for attention?
   - Does the user need to scroll before seeing actionable content?
   - Is the report list overwhelming or well-curated?

4. TYPOGRAPHY & READABILITY (ref: Perplexity mobile — clean, readable, good contrast)
   - Is body text >= 14px? Are labels legible without squinting?
   - Is contrast sufficient against dark backgrounds?
   - Are line lengths comfortable for mobile reading?

5. FIRST IMPRESSION / TIME TO VALUE (ref: ChatGPT — < 3s to understand what to do)
   - Does a new user immediately know what to type/tap?
   - Is the value proposition clear in the first viewport?
   - Is there visual noise that delays comprehension?

6. GLASS CARD DESIGN SYSTEM (NodeBench-specific)
   - Do cards use consistent glass morphism (backdrop-blur, subtle borders)?
   - Is the terracotta (#d97757) accent used purposefully (CTAs, active states)?
   - Are Manrope/JetBrains Mono fonts rendering correctly on mobile?

7. MOBILE-NATIVE FEEL (ref: native iOS/Android apps)
   - Does it feel like a mobile app or a shrunk desktop site?
   - Are gestures, scroll physics, and transitions smooth?
   - Is the bottom of the screen usable (safe area, no hidden overflow)?

OUTPUT FORMAT (JSON):
{
  "overallScore": <1-100>,
  "dimensions": {
    "visualHierarchy": { "score": <1-10>, "findings": ["..."], "fixes": ["..."] },
    "touchTargets": { "score": <1-10>, "findings": ["..."], "fixes": ["..."] },
    "contentDensity": { "score": <1-10>, "findings": ["..."], "fixes": ["..."] },
    "typography": { "score": <1-10>, "findings": ["..."], "fixes": ["..."] },
    "firstImpression": { "score": <1-10>, "findings": ["..."], "fixes": ["..."] },
    "glassDesignSystem": { "score": <1-10>, "findings": ["..."], "fixes": ["..."] },
    "mobileNativeFeel": { "score": <1-10>, "findings": ["..."], "fixes": ["..."] }
  },
  "p1Issues": [{ "issue": "...", "location": "...", "fix": "...", "cssSelector": "..." }],
  "p2Issues": [{ "issue": "...", "location": "...", "fix": "..." }],
  "topPriorityFixes": ["1. ...", "2. ...", "3. ..."],
  "marketComparisonVerdict": "one paragraph comparing to ChatGPT/Perplexity/Linear mobile"
}

Be specific and actionable. Reference exact UI elements, approximate pixel sizes, and CSS properties. Each fix should be implementable in < 30 min.`;

async function captureScreenshots() {
  console.log(`Capturing mobile screenshots at ${BASE_URL}/redesign ...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: MOBILE_VIEWPORT,
    colorScheme: "dark",
    deviceScaleFactor: 3,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();

  const shots = [];

  // Shot 1: Above the fold
  await page.goto(`${BASE_URL}/redesign`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  const aboveFold = path.join(OUT_DIR, "mobile-home-above-fold.png");
  await page.screenshot({ path: aboveFold, fullPage: false });
  shots.push({ name: "above-fold", path: aboveFold });
  console.log("  Captured: above-fold");

  // Shot 2: Full page
  const fullPage = path.join(OUT_DIR, "mobile-home-full-page.png");
  await page.screenshot({ path: fullPage, fullPage: true });
  shots.push({ name: "full-page", path: fullPage });
  console.log("  Captured: full-page");

  // Shot 3: Scroll to Ask First section
  await page.evaluate(() => {
    const askFirst = document.querySelector('[class*="composer-head"]') ||
      document.querySelector('h1, h2, h3');
    if (askFirst) askFirst.scrollIntoView({ behavior: "instant", block: "start" });
  });
  await page.waitForTimeout(500);
  const askSection = path.join(OUT_DIR, "mobile-home-ask-section.png");
  await page.screenshot({ path: askSection, fullPage: false });
  shots.push({ name: "ask-section", path: askSection });
  console.log("  Captured: ask-section");

  // Shot 4: Light mode variant
  await context.close();
  const lightCtx = await browser.newContext({
    viewport: MOBILE_VIEWPORT,
    colorScheme: "light",
    deviceScaleFactor: 3,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const lightPage = await lightCtx.newPage();
  await lightPage.goto(`${BASE_URL}/redesign`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await lightPage.waitForTimeout(2000);
  const lightShot = path.join(OUT_DIR, "mobile-home-light-mode.png");
  await lightPage.screenshot({ path: lightShot, fullPage: false });
  shots.push({ name: "light-mode", path: lightShot });
  console.log("  Captured: light-mode");

  await browser.close();
  console.log(`Captured ${shots.length} screenshots.`);
  return shots;
}

async function evaluateWithGemini(shots) {
  console.log("\nSending to Gemini for evaluation...");
  const genAI = new GoogleGenerativeAI(GEMINI_KEY);

  const imageParts = shots.map((s) => ({
    inlineData: {
      mimeType: "image/png",
      data: fs.readFileSync(s.path).toString("base64"),
    },
  }));

  const imageLabels = shots.map((s) => `[Image: ${s.name} — ${MOBILE_VIEWPORT.width}x${MOBILE_VIEWPORT.height} mobile viewport]`).join("\n");

  const models = ["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-2.5-pro"];
  let result;
  for (const modelName of models) {
    try {
      console.log(`  Trying model: ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      result = await model.generateContent([
        MARKET_REFERENCE_PROMPT,
        `\n\nHere are ${shots.length} screenshots of the mobile Home surface:\n${imageLabels}`,
        ...imageParts,
        "\n\nRespond with ONLY valid JSON matching the schema above. No markdown fencing.",
      ]);
      console.log(`  Success with model: ${modelName}`);
      break;
    } catch (e) {
      console.log(`  Model ${modelName} failed: ${e.message?.slice(0, 100)}`);
    }
  }
  if (!result) { console.error("All models failed."); return null; }

  const text = result.response.text();

  // Extract JSON from response (handle markdown fencing)
  let json;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    json = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("Failed to parse Gemini response as JSON:");
    console.error(text.slice(0, 2000));
    fs.writeFileSync(path.join(OUT_DIR, "raw-response.txt"), text);
    return null;
  }

  return json;
}

async function main() {
  console.log("=== NodeBench Mobile Home — Gemini QA Self-Evaluation ===\n");

  const shots = await captureScreenshots();
  const evaluation = await evaluateWithGemini(shots);

  if (!evaluation) {
    console.error("Evaluation failed — see raw response.");
    process.exit(1);
  }

  // Save results
  const resultPath = path.join(OUT_DIR, "evaluation.json");
  fs.writeFileSync(resultPath, JSON.stringify(evaluation, null, 2));
  console.log(`\nResults saved to: ${resultPath}`);

  // Print summary
  console.log("\n=== EVALUATION SUMMARY ===");
  console.log(`Overall Score: ${evaluation.overallScore}/100`);
  console.log("\nDimension Scores:");
  if (evaluation.dimensions) {
    for (const [dim, data] of Object.entries(evaluation.dimensions)) {
      console.log(`  ${dim}: ${data.score}/10`);
      if (data.findings?.length) {
        data.findings.slice(0, 2).forEach((f) => console.log(`    - ${f}`));
      }
    }
  }

  console.log(`\nP1 Issues (${evaluation.p1Issues?.length || 0}):`);
  (evaluation.p1Issues || []).forEach((p, i) =>
    console.log(`  ${i + 1}. [${p.location}] ${p.issue}\n     Fix: ${p.fix}`)
  );

  console.log(`\nP2 Issues (${evaluation.p2Issues?.length || 0}):`);
  (evaluation.p2Issues || []).forEach((p, i) =>
    console.log(`  ${i + 1}. [${p.location}] ${p.issue}`)
  );

  console.log("\nTop Priority Fixes:");
  (evaluation.topPriorityFixes || []).forEach((f) => console.log(`  ${f}`));

  if (evaluation.marketComparisonVerdict) {
    console.log(`\nMarket Comparison:\n  ${evaluation.marketComparisonVerdict}`);
  }

  return evaluation;
}

main().catch((e) => { console.error(e); process.exit(1); });
