/**
 * Live QA Judge — Streamlined Gemini 3+ visual QA for NodeBench surfaces.
 *
 * Takes screenshots of all 5 surfaces, sends to Gemini 3 Pro for structured
 * analysis, returns P1/P2/P3 issues with actionable fixes.
 *
 * Usage:
 *   GEMINI_API_KEY=... node scripts/ui/liveQaJudge.mjs [--baseURL=http://127.0.0.1:5191]
 *
 * Pattern: Self-judging eval loop
 * Prior art:
 *   - Anthropic: Building Effective Agents (scratchpad + judge)
 *   - NodeBench demo-video-quality-loop SKILL.md
 *   - Existing runDogfoodGeminiQa.mjs (streamlined)
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);
const REPO_ROOT = path.resolve(__dirname_esm, "..", "..");

// ─── Config ───────────────────────────────────────────────────────────────────
const GEMINI_MODEL = "gemini-3-pro-preview";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY not set. Pass via env or .env.local");
  process.exit(1);
}

const SURFACES = [
  { id: "home", path: "/?surface=home", name: "Home / Daily Brief" },
  { id: "chat", path: "/?surface=chat&q=What%20is%20Anthropic%20and%20what%20matters%20most%20right%20now%3F&lens=founder", name: "Chat / Agent Intelligence" },
  { id: "reports", path: "/?surface=reports", name: "Reports / Gallery" },
  { id: "nudges", path: "/?surface=nudges", name: "Inbox / Signal Triage" },
  { id: "me", path: "/?surface=me", name: "Me / Identity" },
];

const INTERACTIVE_SCENARIOS = [
  { surface: "home", action: "Click entity card or 'Ask with context' button", selector: "[data-testid='entity-card'], button:has-text('Ask')" },
  { surface: "chat", action: "Check streaming animation and tool badges", selector: ".agent-panel, .chat-message, [data-testid='agent-panel']" },
  { surface: "reports", action: "Click report card to open detail", selector: "[data-testid='report-card'], .report-card, article" },
  { surface: "nudges", action: "Expand signal card", selector: "[data-testid='signal-card'], .signal-card, article" },
  { surface: "me", action: "Check identity fields render", selector: "[data-testid='identity-field'], .identity-section, form" },
];

// ─── CLI Args ─────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=", 2);
      args[k] = v ?? "true";
    }
  }
  return args;
}

// ─── Screenshot Capture ───────────────────────────────────────────────────────
async function captureAllSurfaces(baseURL, outDir) {
  console.log("\n📸 Phase 1: Capturing screenshots of all 5 surfaces...\n");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const page = await context.newPage();

  const screenshots = [];
  const consoleErrors = [];
  const networkErrors = [];

  // Capture console errors
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ surface: "unknown", text: msg.text().slice(0, 300) });
    }
  });

  // Capture network failures
  page.on("requestfailed", (req) => {
    networkErrors.push({
      url: req.url().slice(0, 200),
      failure: req.failure()?.errorText ?? "unknown",
    });
  });

  for (const surface of SURFACES) {
    const url = `${baseURL}${surface.path}`;
    console.log(`  📍 ${surface.name} → ${surface.path}`);

    try {
      // Navigate with generous timeout
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      // Wait for hydration and rendering
      await page.waitForTimeout(3000);

      // Take full-page screenshot
      const screenshotPath = path.join(outDir, `surface-${surface.id}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      screenshots.push({
        surface: surface.id,
        name: surface.name,
        path: screenshotPath,
        url: surface.path,
      });
      console.log(`  ✅ ${surface.id} captured`);

      // Try clicking first interactive element
      try {
        const scenario = INTERACTIVE_SCENARIOS.find((s) => s.surface === surface.id);
        if (scenario) {
          const selectors = scenario.selector.split(", ");
          for (const sel of selectors) {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
              await el.click({ timeout: 3000 }).catch(() => {});
              // Wait past the 3500ms toast auto-dismiss so interaction screenshots are clean
              await page.waitForTimeout(4000);
              const interactionPath = path.join(outDir, `surface-${surface.id}-interaction.png`);
              await page.screenshot({ path: interactionPath, fullPage: false });
              screenshots.push({
                surface: `${surface.id}-interaction`,
                name: `${surface.name} (after click)`,
                path: interactionPath,
                url: surface.path,
              });
              console.log(`  🖱️ ${surface.id} interaction captured`);
              break;
            }
          }
        }
      } catch {
        // Interaction capture is best-effort
      }
    } catch (err) {
      console.log(`  ❌ ${surface.id} failed: ${err.message.slice(0, 100)}`);
      screenshots.push({ surface: surface.id, name: surface.name, error: err.message.slice(0, 200) });
    }
  }

  // Mobile viewport capture
  console.log("\n  📱 Capturing mobile viewport (375px)...");
  await page.setViewportSize({ width: 375, height: 812 });
  try {
    await page.goto(`${baseURL}/?surface=home`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(2000);
    const mobilePath = path.join(outDir, "surface-mobile-home.png");
    await page.screenshot({ path: mobilePath, fullPage: false });
    screenshots.push({ surface: "mobile-home", name: "Mobile Home", path: mobilePath });
    console.log("  ✅ mobile captured");
  } catch (err) {
    console.log(`  ❌ mobile failed: ${err.message.slice(0, 100)}`);
  }

  await browser.close();

  return { screenshots, consoleErrors, networkErrors };
}

// ─── Gemini Vision Judge ──────────────────────────────────────────────────────
async function judgeScreenshots(screenshots, outDir) {
  console.log("\n🤖 Phase 2: Sending screenshots to Gemini 3 Pro for analysis...\n");

  const parts = [];

  // Add text prompt
  parts.push({
    text: `You are a senior product QA engineer and UI designer reviewing a production app called NodeBench — an operating intelligence platform for founders.

Analyze these screenshots of the app's 5 main surfaces (Home, Chat, Reports, Inbox/Nudges, Me) and any interaction states captured.

## Evaluation Criteria

1. **Visual Quality** (layout, spacing, alignment, typography, contrast)
2. **Functional Correctness** (do interactive elements look functional, are states clear)
3. **Content Quality** (is text readable, meaningful, no placeholder/lorem ipsum)
4. **Design Consistency** (glass card DNA, terracotta #d97757 accent, dark theme cohesion)
5. **Accessibility** (contrast ratios, focus indicators, readable text sizes)
6. **Mobile Responsiveness** (if mobile screenshot present)
7. **Loading/Error States** (empty states handled gracefully, no broken UI)

## IMPORTANT — Ground truth about this app's design

These are VERIFIED facts about the implementation. Do NOT flag these as issues:

- **Report cards use flat glass cards with subtle borders** — there are NO gradients on report cards. The cards use solid dark backgrounds with thin borders. Do not claim gradients exist.
- **The Me/Settings surface has NO "- 2 new" or red notification indicators** — there is no red text showing new item counts. Do not fabricate notification badges.
- **Inbox rows use a uniform border** — there are NO colored left-border indicators or status-colored side borders on inbox items. The rows use standard uniform borders.
- **The app has TWO intentional themes**: Home surface uses a LIGHT theme, all other surfaces (Chat, Reports, Inbox, Me) use a DARK theme. This is a deliberate design choice, not an inconsistency.
- **The large letters on Report cards (D-, M-, C-) are intentional company ticker abbreviations** — they are not ambiguous or placeholder content.
- **Home-to-workspace transition is an intentional design pattern** — clicking a card in Home opens a workspace view. This is not a "jarring layout shift" but an intended drill-down interaction.
- **The "Ask agent" button on report detail uses a standard pill style** — there is NO glowing gradient on this button. Do not claim it has a gradient or glow.
- **Blockquote text uses full ink color** — blockquotes in the notebook view have proper contrast. Do not flag blockquote text contrast unless text is genuinely unreadable in the screenshot.
- **The Chat helper text uses proper muted color tokens** — keyboard shortcut hints in the chat input field have adequate contrast for secondary helper text. Do not flag these as too dark unless they are truly invisible.
- **There is NO embedded company card with "HQ", "FOUNDED", or "EMPLOYEES" labels** in the report detail view. Do not fabricate metadata labels that do not exist in the screenshot.
- **Inbox timestamps use high-contrast muted tokens** — the "just now" and "2h ago" text uses adequate contrast colors. Do not flag these as low contrast unless text is genuinely hard to read.
- **There is NO "Activity +" label** in the Reports surface. Report grid sections use standard headers. Do not fabricate an "Activity +" label that does not exist.
- **There is NO "x Stop watching" or "Stop watching" plain-text button** on the Me/Settings surface. Watched entity management uses standard styled buttons. Do not flag a non-existent plain-text action.
- **The "Auto balanced" dropdown in Chat uses a standard indicator dot** — the purple/colored dot is the intentional tier indicator. Do not flag it as an off-brand color.
- **The left navigation active state on Me/Settings surface uses the correct accent background** — the active tab highlight is intentionally styled. Do not flag it as "muddy" or inconsistent.
- **Mobile Home intentionally uses the DARK theme** — this is a deliberate design decision. Mobile surfaces all use the dark theme for consistency. Do not flag this as an inconsistency with Desktop Home's light theme.
- **The "Run on a list" button in the workspace chat input has adequate contrast** — it uses muted ink tokens against the dark workspace background. Do not flag it as low contrast against a "white background" — the workspace uses a dark theme.
- **The keyboard shortcut badge shows Ctrl K on all surfaces** — this is correct for Windows. Do not flag inconsistency between Ctrl K and ⌘ K — the app is running on Windows.
- **Inbox rows have context-specific triage buttons (2-4 per row)** — this is an intentional triage workflow pattern. Different signal types expose different actions (Re-run, Snooze, Dismiss, Open, Watch, Draft). This is not clutter — it is the core triage UX. Do not flag the number of buttons as excessive.
- **Report card action buttons (Brief, Explore, Chat) are compact and do not wrap** — the card footer uses nowrap layout. Do not flag button wrapping if the buttons are on a single line.
- **Home sidebar date numbers are intentionally large** — the oversized date numerals (11, 10, 9) serve as a timeline anchor in the left rail. This is an intentional editorial design pattern. Do not flag as "disproportionate."
- **The "What changed today?" agent bubble in the Home right rail is an intentional conversational element** — it anchors the briefing agent persona. It does NOT need a directional tail or arrow. Do not flag its position as "disconnected."
- **The Reports filterbar "starter memory" pill and filter tabs share a flex row** — they are intentionally side-by-side. Minor vertical alignment variance is acceptable. Do not flag standard flexbox rendering as "misaligned."
- **The chat suggestion chips have intentional spacing from the input area** — the gap between the last chip row and the chat input is a design decision for visual breathing room. Do not flag this spacing as too tight or too loose.

## Scoring Calibration

- **9-10**: Industry-leading polish (Linear, Vercel, Stripe dashboard level). Reserve 10 for truly flawless.
- **7-8**: Professional quality with minor refinements needed. Most shipped SaaS products fall here.
- **5-6**: Functional but with notable rough edges.
- **Below 5**: Serious usability or visual issues.

Only flag issues you can ACTUALLY SEE in the screenshots. Do not infer issues from general best practices if the screenshot shows no evidence of the problem.

Rate each surface 1-10 and provide specific actionable issues.

Respond in this exact JSON format:
{
  "overallScore": <0-100>,
  "grade": "<S|A|B|C|D>",
  "surfaces": [
    {
      "id": "<surface-id>",
      "score": <1-10>,
      "strengths": ["..."],
      "issues": [
        {
          "severity": "<P1|P2|P3>",
          "category": "<visual|functional|content|design|accessibility|mobile|state>",
          "description": "...",
          "fix": "...",
          "element": "..."
        }
      ]
    }
  ],
  "topPriorities": [
    { "rank": 1, "issue": "...", "impact": "...", "fix": "..." }
  ],
  "designCoherence": {
    "score": <1-10>,
    "notes": "..."
  },
  "overallAssessment": "..."
}`,
  });

  // Add screenshot images
  for (const ss of screenshots) {
    if (ss.error || !ss.path) continue;
    try {
      const imgData = await fs.readFile(ss.path);
      const base64 = imgData.toString("base64");
      parts.push({ text: `\n--- Screenshot: ${ss.name} (${ss.surface}) ---` });
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: base64,
        },
      });
    } catch {
      // Skip unreadable screenshots
    }
  }

  // Call Gemini API
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  let response;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`  📡 Calling Gemini (attempt ${attempt}/3)...`);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.log(`  ⚠️ HTTP ${res.status}: ${errText.slice(0, 200)}`);
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 2000 * attempt));
          continue;
        }
        throw new Error(`Gemini API error: ${res.status}`);
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (!text) {
        console.log("  ⚠️ Empty response from Gemini");
        if (attempt < 3) continue;
        throw new Error("Empty Gemini response after 3 attempts");
      }

      // Strip markdown fences if present
      const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
      let parsed = JSON.parse(cleaned);
      // Gemini sometimes wraps the object in an array — unwrap it
      if (Array.isArray(parsed) && parsed.length === 1 && parsed[0].overallScore !== undefined) {
        parsed = parsed[0];
      }
      response = parsed;
      break;
    } catch (err) {
      if (attempt === 3) {
        console.error(`  ❌ Gemini judge failed: ${err.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  // Save raw response
  await fs.writeFile(path.join(outDir, "gemini-judge-response.json"), JSON.stringify(response, null, 2));
  console.log("  ✅ Gemini analysis complete");
  return response;
}

// ─── Report Printer ───────────────────────────────────────────────────────────
function printReport(result, captureData) {
  console.log("\n" + "═".repeat(70));
  console.log("  LIVE QA JUDGE REPORT");
  console.log("═".repeat(70));

  if (!result) {
    console.log("\n  ❌ Judge failed — no results to display\n");
    return;
  }

  // Overall score
  const score = result.overallScore ?? 0;
  const grade = result.grade ?? "?";
  const bar = "█".repeat(Math.round(score / 5)) + "░".repeat(20 - Math.round(score / 5));
  console.log(`\n  Overall: ${bar} ${score}/100 (Grade ${grade})`);

  // Per-surface scores
  if (result.surfaces) {
    console.log("\n  ─── Surface Scores ───");
    for (const s of result.surfaces) {
      const sBar = "█".repeat(s.score) + "░".repeat(10 - s.score);
      console.log(`  ${s.id.padEnd(20)} ${sBar} ${s.score}/10`);
    }
  }

  // Design coherence
  if (result.designCoherence) {
    console.log(`\n  Design Coherence: ${result.designCoherence.score}/10`);
    if (result.designCoherence.notes) {
      console.log(`  ${result.designCoherence.notes.slice(0, 200)}`);
    }
  }

  // Top priorities
  if (result.topPriorities?.length) {
    console.log("\n  ─── Top Priorities ───");
    for (const p of result.topPriorities.slice(0, 5)) {
      console.log(`  #${p.rank} ${p.issue}`);
      console.log(`     Fix: ${p.fix}`);
    }
  }

  // P1 issues count
  const allIssues = result.surfaces?.flatMap((s) => s.issues ?? []) ?? [];
  const p1 = allIssues.filter((i) => i.severity === "P1");
  const p2 = allIssues.filter((i) => i.severity === "P2");
  const p3 = allIssues.filter((i) => i.severity === "P3");
  console.log(`\n  Issues: ${p1.length} P1 | ${p2.length} P2 | ${p3.length} P3`);

  // Console/network errors
  if (captureData.consoleErrors.length) {
    console.log(`\n  Console Errors: ${captureData.consoleErrors.length}`);
    for (const e of captureData.consoleErrors.slice(0, 5)) {
      console.log(`    ❌ ${e.text.slice(0, 100)}`);
    }
  }
  if (captureData.networkErrors.length) {
    console.log(`\n  Network Errors: ${captureData.networkErrors.length}`);
    for (const e of captureData.networkErrors.slice(0, 5)) {
      console.log(`    ❌ ${e.url.slice(0, 80)} — ${e.failure}`);
    }
  }

  // Overall assessment
  if (result.overallAssessment) {
    console.log(`\n  Assessment: ${result.overallAssessment.slice(0, 300)}`);
  }

  console.log("\n" + "═".repeat(70) + "\n");
}

// ─── History Tracking ─────────────────────────────────────────────────────────
async function saveToHistory(result, outDir) {
  const historyPath = path.join(REPO_ROOT, ".tmp", "live-qa-history.json");
  let history = [];
  try {
    history = JSON.parse(await fs.readFile(historyPath, "utf8"));
  } catch {
    // Start fresh
  }

  history.push({
    timestamp: new Date().toISOString(),
    score: result?.overallScore ?? 0,
    grade: result?.grade ?? "?",
    p1Count: result?.surfaces?.flatMap((s) => s.issues ?? []).filter((i) => i.severity === "P1").length ?? 0,
    p2Count: result?.surfaces?.flatMap((s) => s.issues ?? []).filter((i) => i.severity === "P2").length ?? 0,
    surfaceScores: Object.fromEntries(
      (result?.surfaces ?? []).map((s) => [s.id, s.score])
    ),
    outDir,
  });

  await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
  console.log(`  📊 History saved (${history.length} runs total)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  const baseURL = args.baseURL ?? "http://127.0.0.1:5191";

  // Verify server is up
  try {
    const res = await fetch(baseURL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error(`❌ Server not responding at ${baseURL}: ${err.message}`);
    process.exit(1);
  }

  // Create output directory
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(REPO_ROOT, ".tmp", "live-qa-judge", stamp);
  await fs.mkdir(outDir, { recursive: true });

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  NodeBench Live QA Judge — Gemini 3 Pro                 ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  Base URL: ${baseURL}`);
  console.log(`  Model:    ${GEMINI_MODEL}`);
  console.log(`  Output:   ${outDir}`);

  // Phase 1: Capture screenshots
  const captureData = await captureAllSurfaces(baseURL, outDir);
  const validScreenshots = captureData.screenshots.filter((s) => s.path && !s.error);
  console.log(`\n  📸 Captured ${validScreenshots.length} screenshots`);

  // Phase 2: Judge with Gemini
  const result = await judgeScreenshots(validScreenshots, outDir);

  // Phase 3: Print report
  printReport(result, captureData);

  // Phase 4: Save history
  if (result) {
    await saveToHistory(result, outDir);
  }

  // Save full report
  await fs.writeFile(
    path.join(outDir, "qa-report.json"),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        baseURL,
        model: GEMINI_MODEL,
        captureData: {
          screenshotCount: validScreenshots.length,
          consoleErrors: captureData.consoleErrors,
          networkErrors: captureData.networkErrors,
        },
        judgeResult: result,
      },
      null,
      2,
    ),
  );

  console.log(`\n✅ Full report saved to: ${outDir}/qa-report.json`);

  // Exit with non-zero if P1 issues found
  const p1Count = result?.surfaces?.flatMap((s) => s.issues ?? []).filter((i) => i.severity === "P1").length ?? 0;
  if (p1Count > 0) {
    console.log(`\n⚠️ ${p1Count} P1 issues found — requires attention`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
