#!/usr/bin/env npx tsx
/**
 * NodeBench Demo Video — Gemini Video Understanding Judge
 *
 * Self-evaluating quality loop: render → upload to Gemini → score → diagnose → suggest fixes.
 * Uses Google Gemini's native video understanding (not frame extraction).
 *
 * Usage:
 *   npx tsx scripts/judge-demo-video.ts                          # Judge the latest render
 *   npx tsx scripts/judge-demo-video.ts --video path/to/video.mp4  # Judge a specific file
 *   npx tsx scripts/judge-demo-video.ts --loop 3                 # Run 3 improvement iterations
 *   npx tsx scripts/judge-demo-video.ts --history                # Show score history
 *
 * Prior art:
 *   - Gemini 2.5 Flash video understanding (native multimodal)
 *   - Wistia video engagement research (2-minute sweet spot)
 *   - Reference demos: Linear, Cursor, Arc Browser, Figma Config, Claude Code
 *
 * See: .claude/skills/demo-video-quality-loop/SKILL.md
 */

import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ─── Config ──────────────────────────────────────────────────

const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);
const DEMO_VIDEO_DIR = path.resolve(__dirname_esm, "../public/proto/demo-video");
const DEFAULT_VIDEO = path.join(DEMO_VIDEO_DIR, "out/nodebench-demo-v2.mp4");
const HISTORY_FILE = path.join(DEMO_VIDEO_DIR, "out/judge-history.json");
const STORYBOARD_FILE = path.join(DEMO_VIDEO_DIR, "src/storyboard.ts");

const MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.5-pro";

// ─── Types ───────────────────────────────────────────────────

interface DimensionScore {
  score: number;       // 0-10
  diagnosis: string;   // What's working or failing
  suggestion: string;  // Specific actionable fix
}

interface VideoJudgment {
  timestamp: string;
  videoFile: string;
  model: string;
  overallScore: number; // 0-100
  grade: string;        // S/A/B/C/D/F
  dimensions: {
    pacing: DimensionScore;
    visualClarity: DimensionScore;
    informationDensity: DimensionScore;
    transitionQuality: DimensionScore;
    narrationVisualSync: DimensionScore;
    interactionQuality: DimensionScore;
    montageEffectiveness: DimensionScore;
    openingHook: DimensionScore;
    emotionalArc: DimensionScore;
    callToAction: DimensionScore;
  };
  topIssues: string[];     // Ranked list of most impactful fixes
  referenceComparison: string; // How it compares to top reference demos
  rawNotes: string;        // Free-form observations
}

interface JudgeHistory {
  runs: VideoJudgment[];
}

// ─── Gemini Video Judge ──────────────────────────────────────

const JUDGE_PROMPT = `You are a world-class product demo video critic. You have deep expertise in what makes SaaS product demos go viral — you've studied Linear's speed-focused demos, Cursor's real coding sessions, Arc Browser's personality-driven rapid montages, Figma Config's "product speaks for itself" approach, and Claude Code's split-screen parallel task demos.

You are evaluating a demo video for NodeBench, an operating intelligence platform for founders. The video showcases a prototype with 5 surfaces (Home, Reports, Chat, Inbox, Me), entity intelligence, verification systems, and design system features.

## Your evaluation framework

Score each dimension 0-10. Be brutally honest — a 7 is "good but not memorable", a 9 is "would share on Twitter", a 10 is "best-in-class reference material".

### 1. PACING (0-10)
- Does each scene feel the right length? No dead air, no rushing?
- Does the video maintain momentum throughout?
- Reference: Linear demos never pause. Arc uses 1.5-2s rapid cuts for montages.
- Diagnose: which specific scenes feel too long or too short?

### 2. VISUAL CLARITY (0-10)
- Can you read text, see UI elements, understand what's on screen?
- Are highlight boxes well-positioned on the actual UI elements they label?
- Is contrast good between overlays and screenshots?
- Diagnose: which scenes have readability issues?

### 3. INFORMATION DENSITY (0-10)
- Is each scene showing the right amount of information?
- Too much = overwhelming. Too little = boring. Right = "wow, that's a lot of capability."
- Reference: Figma shows ONE feature per scene, deeply. Linear shows SPEED across many.

### 4. TRANSITION QUALITY (0-10)
- Are transitions smooth and purposeful?
- Do slide/fade/zoom transitions match the content shift?
- Are montage cuts crisp and rhythmic?

### 5. NARRATION-VISUAL SYNC (0-10)
- Does the voiceover match what's visible on screen at that moment?
- Are key terms spoken when the relevant UI element is highlighted?
- Is there enough visual time for the narration to land?

### 6. INTERACTION QUALITY (0-10)
- Do cursor movements feel natural and human-like?
- Are zoom-to-element effects well-timed and well-targeted?
- Does the streaming text effect look realistic?
- Does the before/after wipe feel smooth?

### 7. MONTAGE EFFECTIVENESS (0-10)
- Do rapid-cut montages create energy and demonstrate breadth?
- Are labels readable during quick cuts?
- Is the rhythm of cuts consistent and pleasing?
- Reference: Arc Browser montages are 1.5s per cut with centered labels.

### 8. OPENING HOOK (0-10)
- Does the first 5 seconds grab attention?
- Would someone stop scrolling on Twitter/LinkedIn to watch this?
- Reference: TikTok rule — content must deliver value before 3 seconds.

### 9. EMOTIONAL ARC (0-10)
- Does the video build excitement progressively?
- Is there a clear "hero moment" (the thing that makes you go "wow")?
- Does the pacing create a sense of momentum and competence?
- Reference: Apple keynotes have a clear crescendo → reveal → awe moment.

### 10. CALL TO ACTION (0-10)
- Does the outro make you want to try the product?
- Are the key stats memorable?
- Is there a clear next step (URL, signup, etc.)?

## Output format

Return ONLY valid JSON matching this exact schema:

{
  "overallScore": <number 0-100>,
  "grade": "<S|A|B|C|D|F>",
  "dimensions": {
    "pacing": { "score": <0-10>, "diagnosis": "<what's working or failing>", "suggestion": "<specific fix>" },
    "visualClarity": { "score": <0-10>, "diagnosis": "...", "suggestion": "..." },
    "informationDensity": { "score": <0-10>, "diagnosis": "...", "suggestion": "..." },
    "transitionQuality": { "score": <0-10>, "diagnosis": "...", "suggestion": "..." },
    "narrationVisualSync": { "score": <0-10>, "diagnosis": "...", "suggestion": "..." },
    "interactionQuality": { "score": <0-10>, "diagnosis": "...", "suggestion": "..." },
    "montageEffectiveness": { "score": <0-10>, "diagnosis": "...", "suggestion": "..." },
    "openingHook": { "score": <0-10>, "diagnosis": "...", "suggestion": "..." },
    "emotionalArc": { "score": <0-10>, "diagnosis": "...", "suggestion": "..." },
    "callToAction": { "score": <0-10>, "diagnosis": "...", "suggestion": "..." }
  },
  "topIssues": ["<most impactful fix first>", "<second>", "<third>", "<fourth>", "<fifth>"],
  "referenceComparison": "<2-3 sentences comparing to Linear/Cursor/Arc/Figma/Claude Code demos>",
  "rawNotes": "<free-form observations about what stood out, both good and bad>"
}

Grade scale:
- S (90-100): Viral quality. Would share unprompted.
- A (75-89): Professional. Competitive with top SaaS demos.
- B (60-74): Good but forgettable. Needs polish.
- C (45-59): Functional but amateur. Missing energy.
- D (30-44): Below standard. Multiple fundamental issues.
- F (0-29): Not ready to show anyone.`;

async function judgeVideo(videoPath: string): Promise<VideoJudgment> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Try reading from .env.local
    const envPath = path.resolve(__dirname_esm, "../.env.local");
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, "utf-8");
      const match = envContent.match(/GEMINI_API_KEY=(.+)/);
      if (match) {
        process.env.GEMINI_API_KEY = match[1].trim();
      }
    }
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY not found in env or .env.local");
  }

  const ai = new GoogleGenAI({ apiKey: key });

  console.log(`\n📹 Uploading video to Gemini File API...`);
  console.log(`   File: ${path.basename(videoPath)}`);
  const stat = fs.statSync(videoPath);
  console.log(`   Size: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);

  // Upload video via File API
  const uploadResult = await ai.files.upload({
    file: videoPath,
    config: { mimeType: "video/mp4" },
  });

  const fileUri = uploadResult.uri;
  const fileName = uploadResult.name;
  console.log(`   URI:  ${fileUri}`);

  // Wait for file processing
  console.log(`\n⏳ Waiting for Gemini to process video...`);
  let file = await ai.files.get({ name: fileName! });
  let waitTime = 0;
  while (file.state === "PROCESSING") {
    await new Promise((r) => setTimeout(r, 5000));
    waitTime += 5;
    process.stdout.write(`   Processing... ${waitTime}s\r`);
    file = await ai.files.get({ name: fileName! });
  }

  if (file.state === "FAILED") {
    throw new Error(`Video processing failed: ${JSON.stringify(file)}`);
  }
  console.log(`   ✅ Video processed (${waitTime}s)`);

  // Read storyboard for context
  let storyboardContext = "";
  if (fs.existsSync(STORYBOARD_FILE)) {
    const sb = fs.readFileSync(STORYBOARD_FILE, "utf-8");
    // Extract scene IDs and durations for context
    const sceneMatches = sb.matchAll(/id:\s*"([^"]+)".*?durationSec:\s*(\d+).*?tier:\s*"([^"]+)"/gs);
    const scenes: string[] = [];
    for (const m of sceneMatches) {
      scenes.push(`${m[1]} (${m[2]}s, ${m[3]})`);
    }
    if (scenes.length > 0) {
      storyboardContext = `\n\nSTORYBOARD CONTEXT (${scenes.length} scenes):\n${scenes.join("\n")}`;
    }
  }

  // Call Gemini with video
  console.log(`\n🤖 Calling ${MODEL} for video analysis...`);
  let modelId = MODEL;
  let result;

  try {
    result = await ai.models.generateContent({
      model: modelId,
      contents: [
        {
          role: "user",
          parts: [
            { fileData: { fileUri: fileUri!, mimeType: "video/mp4" } },
            { text: JUDGE_PROMPT + storyboardContext },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0.3,
      },
    });
  } catch (err: any) {
    console.log(`   ⚠️ ${MODEL} failed, trying ${FALLBACK_MODEL}...`);
    modelId = FALLBACK_MODEL;
    result = await ai.models.generateContent({
      model: modelId,
      contents: [
        {
          role: "user",
          parts: [
            { fileData: { fileUri: fileUri!, mimeType: "video/mp4" } },
            { text: JUDGE_PROMPT + storyboardContext },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0.3,
      },
    });
  }

  // Parse response
  const text = result.text ?? "";
  let judgment: any;
  try {
    // Try direct parse
    judgment = JSON.parse(text);
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      judgment = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    } else {
      throw new Error(`Failed to parse Gemini response as JSON:\n${text.slice(0, 500)}`);
    }
  }

  // Clean up uploaded file
  try {
    await ai.files.delete({ name: fileName! });
    console.log(`   🗑️ Cleaned up uploaded file`);
  } catch {
    // Non-critical
  }

  const videoJudgment: VideoJudgment = {
    timestamp: new Date().toISOString(),
    videoFile: path.basename(videoPath),
    model: modelId,
    overallScore: judgment.overallScore,
    grade: judgment.grade,
    dimensions: judgment.dimensions,
    topIssues: judgment.topIssues || [],
    referenceComparison: judgment.referenceComparison || "",
    rawNotes: judgment.rawNotes || "",
  };

  return videoJudgment;
}

// ─── Display ─────────────────────────────────────────────────

function displayJudgment(j: VideoJudgment): void {
  const gradeColors: Record<string, string> = {
    S: "\x1b[35m", // magenta
    A: "\x1b[32m", // green
    B: "\x1b[33m", // yellow
    C: "\x1b[33m", // yellow
    D: "\x1b[31m", // red
    F: "\x1b[31m", // red
  };
  const reset = "\x1b[0m";
  const dim = "\x1b[2m";
  const bold = "\x1b[1m";
  const cyan = "\x1b[36m";
  const terracotta = "\x1b[38;5;173m";

  console.log(`\n${bold}═══════════════════════════════════════════════════${reset}`);
  console.log(`${bold}  DEMO VIDEO QUALITY JUDGMENT${reset}`);
  console.log(`${bold}═══════════════════════════════════════════════════${reset}`);
  console.log(`  ${dim}Model: ${j.model} | ${j.timestamp}${reset}`);
  console.log(`  ${dim}Video: ${j.videoFile}${reset}`);
  console.log();

  const gc = gradeColors[j.grade] || "";
  console.log(`  ${bold}Overall: ${gc}${j.overallScore}/100 (Grade ${j.grade})${reset}`);
  console.log();

  // Dimension table
  console.log(`  ${bold}${terracotta}Dimension Scores:${reset}`);
  const dims = j.dimensions;
  const dimEntries: [string, DimensionScore][] = [
    ["Pacing", dims.pacing],
    ["Visual Clarity", dims.visualClarity],
    ["Info Density", dims.informationDensity],
    ["Transitions", dims.transitionQuality],
    ["Narration Sync", dims.narrationVisualSync],
    ["Interactions", dims.interactionQuality],
    ["Montage", dims.montageEffectiveness],
    ["Opening Hook", dims.openingHook],
    ["Emotional Arc", dims.emotionalArc],
    ["Call to Action", dims.callToAction],
  ];

  for (const [name, dim_score] of dimEntries) {
    const bar = "█".repeat(dim_score.score) + "░".repeat(10 - dim_score.score);
    const scoreColor = dim_score.score >= 8 ? "\x1b[32m" : dim_score.score >= 6 ? "\x1b[33m" : "\x1b[31m";
    console.log(
      `  ${scoreColor}${bar}${reset} ${dim_score.score.toString().padStart(2)}/10  ${bold}${name.padEnd(16)}${reset} ${dim}${dim_score.diagnosis.slice(0, 70)}${reset}`
    );
  }

  // Top issues
  console.log(`\n  ${bold}${terracotta}Top Issues (priority order):${reset}`);
  j.topIssues.forEach((issue, i) => {
    const prefix = i === 0 ? "🔴" : i < 3 ? "🟡" : "⚪";
    console.log(`  ${prefix} ${i + 1}. ${issue}`);
  });

  // Reference comparison
  console.log(`\n  ${bold}${cyan}vs. Reference Demos:${reset}`);
  console.log(`  ${dim}${j.referenceComparison}${reset}`);

  // Suggestions
  console.log(`\n  ${bold}${terracotta}Actionable Suggestions:${reset}`);
  for (const [name, dim_score] of dimEntries) {
    if (dim_score.score < 8 && dim_score.suggestion) {
      console.log(`  ${dim}${name}:${reset} ${dim_score.suggestion}`);
    }
  }

  console.log(`\n${bold}═══════════════════════════════════════════════════${reset}\n`);
}

// ─── History ─────────────────────────────────────────────────

function loadHistory(): JudgeHistory {
  if (fs.existsSync(HISTORY_FILE)) {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
  }
  return { runs: [] };
}

function saveHistory(history: JudgeHistory): void {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function displayHistory(history: JudgeHistory): void {
  if (history.runs.length === 0) {
    console.log("No judge history yet. Run a judgment first.");
    return;
  }

  console.log(`\n  📊 Score History (${history.runs.length} runs):\n`);
  console.log("  Run  Score  Grade  Model              Date");
  console.log("  ───  ─────  ─────  ─────              ────");

  for (let i = 0; i < history.runs.length; i++) {
    const r = history.runs[i];
    const delta =
      i > 0
        ? ` (${r.overallScore > history.runs[i - 1].overallScore ? "+" : ""}${r.overallScore - history.runs[i - 1].overallScore})`
        : "";
    console.log(
      `  ${(i + 1).toString().padStart(3)}  ${r.overallScore.toString().padStart(5)}  ${r.grade.padStart(5)}  ${r.model.padEnd(19)} ${r.timestamp.slice(0, 16)}${delta}`
    );
  }

  // Dimension trend (latest 3)
  const recent = history.runs.slice(-3);
  if (recent.length >= 2) {
    console.log(`\n  📈 Dimension Trends (last ${recent.length} runs):`);
    const dimKeys = Object.keys(recent[0].dimensions) as (keyof VideoJudgment["dimensions"])[];
    for (const key of dimKeys) {
      const scores = recent.map((r) => r.dimensions[key].score);
      const trend = scores.map((s) => s.toString()).join(" → ");
      const delta = scores[scores.length - 1] - scores[0];
      const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
      console.log(`  ${arrow} ${key.padEnd(24)} ${trend}`);
    }
  }
  console.log();
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // --history flag
  if (args.includes("--history")) {
    const history = loadHistory();
    displayHistory(history);
    return;
  }

  // --video <path>
  let videoPath = DEFAULT_VIDEO;
  const videoIdx = args.indexOf("--video");
  if (videoIdx >= 0 && args[videoIdx + 1]) {
    videoPath = path.resolve(args[videoIdx + 1]);
  }

  if (!fs.existsSync(videoPath)) {
    console.error(`❌ Video not found: ${videoPath}`);
    console.error(`   Render first: cd public/proto/demo-video && npx remotion render NodeBenchDemo out/nodebench-demo-v2.mp4`);
    process.exit(1);
  }

  // --loop <count>
  const loopIdx = args.indexOf("--loop");
  const loopCount = loopIdx >= 0 ? parseInt(args[loopIdx + 1] || "1") : 1;

  const history = loadHistory();

  for (let i = 0; i < loopCount; i++) {
    if (loopCount > 1) {
      console.log(`\n${"=".repeat(50)}`);
      console.log(`  ITERATION ${i + 1} / ${loopCount}`);
      console.log(`${"=".repeat(50)}`);
    }

    try {
      const judgment = await judgeVideo(videoPath);
      displayJudgment(judgment);

      // Save to history
      history.runs.push(judgment);
      saveHistory(history);
      console.log(`  💾 Saved to ${path.relative(process.cwd(), HISTORY_FILE)}`);

      // Check for improvement plateau
      if (history.runs.length >= 3) {
        const last3 = history.runs.slice(-3).map((r) => r.overallScore);
        const variance = Math.max(...last3) - Math.min(...last3);
        if (variance <= 3) {
          console.log(`\n  ⚠️ Score plateau detected (${last3.join(", ")}). Consider structural changes.`);
        }
      }

      // If looping and not last iteration, print improvement plan
      if (i < loopCount - 1) {
        console.log(`\n  🔄 Improvement plan for next iteration:`);
        judgment.topIssues.slice(0, 3).forEach((issue, idx) => {
          console.log(`     ${idx + 1}. ${issue}`);
        });
        console.log(`\n  Apply fixes to storyboard.ts / SceneView.tsx, re-render, then re-judge.`);
        console.log(`  Waiting 5s before next iteration...`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    } catch (err: any) {
      console.error(`\n❌ Judge failed: ${err.message}`);
      if (err.message.includes("API_KEY")) {
        console.error(`   Set GEMINI_API_KEY in .env.local or environment`);
      }
      process.exit(1);
    }
  }

  // Final summary
  if (history.runs.length > 1) {
    console.log(`\n  📊 Quick History:`);
    displayHistory(history);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
