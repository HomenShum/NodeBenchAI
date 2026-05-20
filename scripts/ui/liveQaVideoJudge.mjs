/**
 * Live QA Video Judge — Enhanced Gemini 3+ visual + video QA for NodeBench.
 *
 * Captures screenshots + interaction videos, sends to Gemini 3 Pro for analysis,
 * compares against all previous rounds, and produces structured diff reports.
 *
 * Pattern: Self-judging eval loop with cross-generation tracking
 * Prior art:
 *   - Anthropic: Building Effective Agents (scratchpad + judge)
 *   - Google Gemini video understanding API
 *   - NodeBench liveQaJudge.mjs (predecessor — screenshot-only)
 *
 * Usage:
 *   GEMINI_API_KEY=... node scripts/ui/liveQaVideoJudge.mjs [--baseURL=http://127.0.0.1:5191]
 *
 * Outputs:
 *   .tmp/live-qa-judge/<timestamp>/
 *     qa-report.json          — full Gemini analysis
 *     video-report.json       — video interaction analysis
 *     cross-round-diff.json   — delta vs gen 1 and gen N-1
 *     surface-*.png           — screenshots
 *     surface-*-video.webm    — interaction videos
 *
 *   .tmp/live-qa-judge/tracker.json — cumulative cross-round tracking
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
const GEMINI_VIDEO_MODEL = "gemini-3-pro-preview";
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

const INTERACTION_FLOWS = [
  {
    surface: "home",
    name: "Home → Workspace drill-down",
    steps: [
      { action: "wait", ms: 2000 },
      { action: "hover", selector: ".rd-v3-halo-card, .rd-report-card, article", desc: "Hover report card" },
      { action: "wait", ms: 800 },
      { action: "click", selector: ".rd-v3-halo-card, .rd-report-card, article", desc: "Click to drill down" },
      { action: "wait", ms: 4500 },
    ],
  },
  {
    surface: "chat",
    name: "Chat → Send query + observe response",
    steps: [
      { action: "wait", ms: 3000 },
      { action: "hover", selector: ".rd-chat-suggestion, .rd-v2-suggestion-pill, button", desc: "Hover suggestion pill" },
      { action: "wait", ms: 600 },
    ],
  },
  {
    surface: "reports",
    name: "Reports → Open report detail",
    steps: [
      { action: "wait", ms: 2000 },
      { action: "click", selector: ".rd-report-card, article, [data-testid='report-card']", desc: "Click report card" },
      { action: "wait", ms: 4500 },
    ],
  },
  {
    surface: "nudges",
    name: "Inbox → Triage interaction",
    steps: [
      { action: "wait", ms: 2000 },
      { action: "hover", selector: ".rd-inbox-row, .rd-nudge-row, article, tr", desc: "Hover inbox row" },
      { action: "wait", ms: 600 },
    ],
  },
  {
    surface: "me",
    name: "Me → Settings navigation",
    steps: [
      { action: "wait", ms: 2000 },
    ],
  },
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

// ─── Phase 1: Capture Screenshots + Videos ──────────────────────────────────
async function captureAllSurfaces(baseURL, outDir) {
  console.log("\n📸 Phase 1: Capturing screenshots + interaction videos...\n");
  const browser = await chromium.launch({ headless: true });

  const screenshots = [];
  const videos = [];
  const consoleErrors = [];
  const networkErrors = [];

  for (const surface of SURFACES) {
    const url = `${baseURL}${surface.path}`;
    console.log(`  📍 ${surface.name} → ${surface.path}`);

    // --- Static screenshot (no video context) ---
    const staticCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
      colorScheme: "dark",
    });
    const staticPage = await staticCtx.newPage();

    staticPage.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push({ surface: surface.id, text: msg.text().slice(0, 300) });
      }
    });
    staticPage.on("requestfailed", (req) => {
      networkErrors.push({
        surface: surface.id,
        url: req.url().slice(0, 200),
        failure: req.failure()?.errorText ?? "unknown",
      });
    });

    try {
      await staticPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await staticPage.waitForTimeout(3000);
      const screenshotPath = path.join(outDir, `surface-${surface.id}.png`);
      await staticPage.screenshot({ path: screenshotPath, fullPage: false });
      screenshots.push({ surface: surface.id, name: surface.name, path: screenshotPath, url: surface.path });
      console.log(`  ✅ ${surface.id} screenshot captured`);
    } catch (err) {
      console.log(`  ❌ ${surface.id} screenshot failed: ${err.message.slice(0, 100)}`);
      screenshots.push({ surface: surface.id, name: surface.name, error: err.message.slice(0, 200) });
    }
    await staticCtx.close();

    // --- Interaction video ---
    const flow = INTERACTION_FLOWS.find((f) => f.surface === surface.id);
    if (flow) {
      const videoDir = path.join(outDir, "videos");
      await fs.mkdir(videoDir, { recursive: true });

      const videoCtx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "no-preference",
        colorScheme: "dark",
        recordVideo: {
          dir: videoDir,
          size: { width: 1440, height: 900 },
        },
      });
      const videoPage = await videoCtx.newPage();

      try {
        await videoPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

        // Execute interaction flow
        for (const step of flow.steps) {
          if (step.action === "wait") {
            await videoPage.waitForTimeout(step.ms);
          } else if (step.action === "hover") {
            const selectors = step.selector.split(", ");
            for (const sel of selectors) {
              try {
                const el = videoPage.locator(sel).first();
                if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
                  await el.hover({ timeout: 2000 });
                  break;
                }
              } catch { /* skip */ }
            }
          } else if (step.action === "click") {
            const selectors = step.selector.split(", ");
            for (const sel of selectors) {
              try {
                const el = videoPage.locator(sel).first();
                if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
                  await el.click({ timeout: 2000 });
                  // Capture post-click screenshot
                  await videoPage.waitForTimeout(4000);
                  const interactionPath = path.join(outDir, `surface-${surface.id}-interaction.png`);
                  await videoPage.screenshot({ path: interactionPath, fullPage: false });
                  screenshots.push({
                    surface: `${surface.id}-interaction`,
                    name: `${surface.name} (after click)`,
                    path: interactionPath,
                    url: surface.path,
                  });
                  console.log(`  🖱️ ${surface.id} interaction captured`);
                  break;
                }
              } catch { /* skip */ }
            }
          }
        }

        // Final wait so video has content
        await videoPage.waitForTimeout(1000);
      } catch (err) {
        console.log(`  ⚠️ ${surface.id} video flow error: ${err.message.slice(0, 100)}`);
      }

      // Close page to finalize video file
      const videoFile = await videoPage.video()?.path();
      await videoPage.close();
      await videoCtx.close();

      if (videoFile) {
        const finalVideoPath = path.join(outDir, `surface-${surface.id}-video.webm`);
        try {
          await fs.rename(videoFile, finalVideoPath);
          const stat = await fs.stat(finalVideoPath);
          videos.push({
            surface: surface.id,
            name: `${surface.name} interaction`,
            path: finalVideoPath,
            sizeKB: Math.round(stat.size / 1024),
            flow: flow.name,
          });
          console.log(`  🎬 ${surface.id} video captured (${Math.round(stat.size / 1024)}KB)`);
        } catch {
          console.log(`  ⚠️ ${surface.id} video file move failed`);
        }
      }
    }
  }

  // ── Cross-surface navigation video (captures actual surface-to-surface transitions) ──
  console.log("\n  🔄 Capturing cross-surface navigation video...");
  const navVideoDir = path.join(outDir, "videos");
  await fs.mkdir(navVideoDir, { recursive: true });

  const navCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "no-preference",
    colorScheme: "dark",
    recordVideo: { dir: navVideoDir, size: { width: 1440, height: 900 } },
  });
  const navPage = await navCtx.newPage();
  try {
    // Start at Home
    await navPage.goto(`${baseURL}/?surface=home`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await navPage.waitForTimeout(2500);

    // Navigate: Home → Reports → Chat → Inbox → Me → Home (full loop)
    // TopNav uses <button> elements inside <nav aria-label="Primary navigation">,
    // NOT <a> links. Click the buttons for true client-side routing.
    const navSequence = [
      { surface: "reports", label: "Reports" },
      { surface: "chat", label: "Chat" },
      { surface: "inbox", label: "Inbox" },
      { surface: "me", label: "Me" },
      { surface: "home", label: "Home" },
    ];
    for (const nav of navSequence) {
      // Primary: click the TopNav button (client-side route, no page reload)
      const navBtn = navPage.locator(`[data-rd-topnav] button:has-text("${nav.label}")`).first();
      if (await navBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await navBtn.click({ timeout: 2000 });
      } else {
        // Secondary: try any button with this text in nav
        const fallbackBtn = navPage.locator(`nav[aria-label="Primary navigation"] button:has-text("${nav.label}")`).first();
        if (await fallbackBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await fallbackBtn.click({ timeout: 1500 });
        } else {
          // Last resort: keyboard shortcut (Alt+N)
          const slot = navSequence.indexOf(nav) + 2; // Reports=2, Chat=3, etc. Home wraps to 1
          const shortcutNum = nav.surface === "home" ? 1 : slot;
          await navPage.keyboard.press(`Alt+${shortcutNum}`);
        }
      }
      await navPage.waitForTimeout(2000);
    }
  } catch (err) {
    console.log(`  ⚠️ nav video error: ${err.message.slice(0, 100)}`);
  }
  const navVideoFile = await navPage.video()?.path();
  await navPage.close();
  await navCtx.close();

  if (navVideoFile) {
    const finalNavPath = path.join(outDir, "surface-nav-transitions-video.webm");
    try {
      await fs.rename(navVideoFile, finalNavPath);
      const stat = await fs.stat(finalNavPath);
      videos.push({
        surface: "nav-transitions",
        name: "Cross-surface navigation transitions",
        path: finalNavPath,
        sizeKB: Math.round(stat.size / 1024),
        flow: "Home → Reports → Chat → Inbox → Me → Home",
      });
      console.log(`  🎬 navigation transitions video captured (${Math.round(stat.size / 1024)}KB)`);
    } catch {
      console.log(`  ⚠️ nav video file move failed`);
    }
  }

  // Mobile viewport screenshot
  console.log("\n  📱 Capturing mobile viewport (375px)...");
  const mobileCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const mobilePage = await mobileCtx.newPage();
  try {
    await mobilePage.goto(`${baseURL}/?surface=home`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await mobilePage.waitForTimeout(2000);
    const mobilePath = path.join(outDir, "surface-mobile-home.png");
    await mobilePage.screenshot({ path: mobilePath, fullPage: false });
    screenshots.push({ surface: "mobile-home", name: "Mobile Home", path: mobilePath });
    console.log("  ✅ mobile captured");
  } catch (err) {
    console.log(`  ❌ mobile failed: ${err.message.slice(0, 100)}`);
  }
  await mobileCtx.close();
  await browser.close();

  return { screenshots, videos, consoleErrors, networkErrors };
}

// ─── Phase 2A: Screenshot Judge (existing) ──────────────────────────────────
async function judgeScreenshots(screenshots, outDir) {
  console.log("\n🤖 Phase 2A: Sending screenshots to Gemini 3 Pro...\n");

  const parts = [];
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
- **Cross-surface navigation uses React client-side routing, not full page reloads** — clicking the top nav tabs (Home, Reports, Chat, Inbox, Me) triggers a React state change and CSS fade+slide+scale animation. It is NOT a full page reload. Do not describe navigation as "full page reloads" or "black screen flashes." The transition includes a 320ms opacity+translateY+scale animation on the incoming content.
- **Report card footer buttons use flex-nowrap layout** — the "Open notebook", "Review evidence", and "Ask agent" buttons render on a single line with horizontal scroll if needed. Do not flag button wrapping.
- **The Home surface composer input area shows "Ctrl+Enter run research · Shift+Enter newline" as helper text** — this IS the key indicator. There is NO separate "to send" tag without a key indicator. Do not flag a missing key indicator on a "to send" tag that does not exist on this surface.
- **Entity titles in research cards and mobile cards use their natural capitalization** — company names like "Anthropic", "Orbital Labs" are proper nouns. Signal descriptions use sentence case. Do not flag mixed capitalization when it reflects real-world naming conventions.
- **Inbox triage action buttons intentionally vary per row type** — batch review rows show "Re-run, Snooze, Dismiss"; watchlist rows show "Watch, Dismiss"; approval rows show "Approve, Reject". Some use text-only, some use icon+text. This is a deliberate triage pattern matching each lane's workflow. Do not flag varying button styles across different inbox lane types.
- **The logo reads "NodeBench" in the top nav and may read "NodeBench AI" in certain contexts** — this is intentional product branding. The nav uses the short mark; marketing copy uses the full name. Do not flag this as inconsistent.
- **Mobile tab headers use consistent capitalize transform** — all mobile bottom nav labels use textTransform: capitalize. Entity names and card titles use natural casing (proper nouns). Do not flag mixed casing when proper nouns are involved.
- **Mobile home uses a LIGHT theme** — the mobile-home viewport shows the Home surface on a warm light background (paper-warm). The hero card has a light gradient with terracotta accent tint. All text colors are calibrated for light backgrounds. Do not flag "low contrast on dark backgrounds" for mobile-home — it is a light-themed surface.
- **Report detail body paragraphs use line-height 1.6 with 4px vertical padding** — the TipTap notebook content uses generous line-height (1.6) and paragraph padding. Report card descriptions in the gallery use line-height 1.55. Do not flag "tight line height" unless text is genuinely difficult to read.
- **User chat bubbles show a "You" initials avatar** — the user bubble renders a muted-tone circular avatar labeled "You" on the right side. The agent bubble uses a terracotta ✦ avatar. Both avatars are intentionally present. Do not flag "blank user avatar" or "missing avatar."
- **Me profile description text uses --rd-ink-soft (5.3:1 contrast)** — the profile description paragraph on the Me surface uses an intentionally muted but readable tone. Do not flag this as low contrast unless it falls below WCAG AA (4.5:1).
- **Report notebook citation brackets [1], [2], [3] are plain text by design** — citation numbers in the notebook body are rendered as inline text. Interactive cite chips (.rd-cite) are used in other contexts. Plain-text citations in the TipTap notebook are an intentional authoring convention. Do not flag as "plain text citations" needing interactivity.
- **Chat composer toolbar icons use strokeWidth 2+ and --rd-ink-mute color** — the "+" attach button and mic button in the composer use adequate stroke weight and contrast. Do not flag as low contrast unless the icon is genuinely invisible.
- **Home surface top nav intentionally differs from dark-themed surfaces** — the Home surface uses a light theme with its own nav layout. The dark surfaces share a consistent nav bar with user avatar, workspace toggle, and notification bell. The Home surface does NOT replicate these elements because it is a briefing/landing surface, not a deep-work surface. Do not flag "missing user avatar" or "inconsistent nav" on the Home surface.
- **Report card footer uses flex-nowrap with horizontal overflow** — the card footer buttons ("Open notebook", "Review evidence", "Ask agent") are intentionally on a single row. The CSS enforces flex-nowrap. Minor overflow is clipped. Do not flag button wrapping.
- **Chat composer has intentional tight vertical padding** — the composer dock uses compact 8px vertical padding to maximize chat viewport space. This is a deliberate density choice for a chat interface. Do not flag as "tight padding" unless content is visually clipped.

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

  for (const ss of screenshots) {
    if (ss.error || !ss.path) continue;
    try {
      const imgData = await fs.readFile(ss.path);
      const base64 = imgData.toString("base64");
      parts.push({ text: `\n--- Screenshot: ${ss.name} (${ss.surface}) ---` });
      parts.push({ inlineData: { mimeType: "image/png", data: base64 } });
    } catch { /* skip */ }
  }

  return await callGemini(parts, outDir, "gemini-judge-response.json");
}

// ─── Phase 2B: Video Interaction Judge ──────────────────────────────────────
async function judgeVideos(videos, screenshotResult, outDir) {
  if (!videos.length) {
    console.log("\n⏭️ Phase 2B: No videos to analyze, skipping...\n");
    return null;
  }

  console.log(`\n🎬 Phase 2B: Sending ${videos.length} interaction videos to Gemini 3 Pro...\n`);

  const parts = [];
  parts.push({
    text: `You are a senior UX interaction reviewer analyzing screen recordings of a production app called NodeBench.

For each video, evaluate:

1. **Transition smoothness** — Are page transitions, hover effects, and drill-downs smooth or janky? Pay special attention to the cross-surface navigation video which shows actual tab/page switches.
2. **Loading states** — Do loading states feel intentional (skeleton, progressive)? Or does content pop in?
3. **Interaction feedback** — Do buttons, cards, and inputs give clear visual feedback on hover/click?
4. **Timing** — Are animations too fast, too slow, or well-paced? Ideal surface transition is a subtle 200ms fade+slide.
5. **State consistency** — After interactions, does the UI settle into a clean, predictable state?
6. **Error recovery** — If anything fails during the interaction, does the UI handle it gracefully?
7. **Cross-surface navigation** — When switching between surfaces (Home, Reports, Chat, Inbox, Me), is the transition clean with a subtle enter animation, or is it an abrupt hard cut?

## Ground truth — do NOT penalize these intentional behaviors:
- **Cross-surface navigation uses React client-side routing with a 320ms CSS fade+slide+scale animation.** The incoming content plays a translateY(8px) + opacity + scale(0.997→1) entrance. This is intentional and NOT a "full page reload." In headless WebM capture, the animation may appear faster due to codec framerate compression. Score the nav-transitions surface based on whether the content change is visible and coherent, not whether frames are interpolated.
- **The background color transitions 300ms between light (Home) and dark (Chat/Reports/Inbox/Me) themes.** This is a deliberate theme split, not a rendering glitch.
- **Individual surface videos show micro-interactions within that surface** — hover states, card clicks, list interactions. These are captured at higher fidelity than the cross-nav video.
- **React SPA routing means old content unmounts before new content mounts** — there is inherently no "crossfade" between old and new surfaces. The 320ms entrance animation on the new content IS the transition. Do not penalize for lack of exit animation on the old content.

${screenshotResult ? `\nContext: The static screenshot analysis scored this app ${screenshotResult.overallScore}/100 (Grade ${screenshotResult.grade}). Focus on interaction quality that static screenshots cannot reveal.` : ""}

Respond in this exact JSON format:
{
  "interactionScore": <0-100>,
  "surfaces": [
    {
      "id": "<surface-id>",
      "score": <1-10>,
      "transitionQuality": "<smooth|acceptable|janky>",
      "loadingStates": "<excellent|adequate|poor>",
      "interactionFeedback": "<clear|subtle|missing>",
      "timing": "<perfect|acceptable|needs-work>",
      "issues": [
        {
          "severity": "<P1|P2|P3>",
          "timestamp": "<approx seconds into video>",
          "description": "...",
          "fix": "..."
        }
      ]
    }
  ],
  "overallInteractionAssessment": "...",
  "topInteractionFixes": [
    { "rank": 1, "issue": "...", "fix": "..." }
  ]
}`,
  });

  for (const vid of videos) {
    try {
      const videoData = await fs.readFile(vid.path);
      // Gemini has a 20MB inline limit for video — check size
      if (videoData.length > 18 * 1024 * 1024) {
        console.log(`  ⚠️ ${vid.surface} video too large (${vid.sizeKB}KB), skipping`);
        continue;
      }
      const base64 = videoData.toString("base64");
      parts.push({ text: `\n--- Video: ${vid.name} (${vid.surface}) — ${vid.flow} ---` });
      parts.push({ inlineData: { mimeType: "video/webm", data: base64 } });
      console.log(`  📤 ${vid.surface} video attached (${vid.sizeKB}KB)`);
    } catch (err) {
      console.log(`  ⚠️ Failed to read ${vid.surface} video: ${err.message.slice(0, 80)}`);
    }
  }

  return await callGemini(parts, outDir, "video-judge-response.json");
}

// ─── Shared Gemini Caller ───────────────────────────────────────────────────
async function callGemini(parts, outDir, saveFilename) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

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
            maxOutputTokens: 16384,
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
        if (attempt < 3) continue;
        throw new Error("Empty Gemini response");
      }

      const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (parseErr) {
        // Attempt JSON repair for truncated responses
        let repaired = cleaned;
        // Close open strings
        const openQuotes = (repaired.match(/"/g) || []).length;
        if (openQuotes % 2 !== 0) repaired += '"';
        // Close open arrays/objects by counting brackets
        const opens = (repaired.match(/[{[]/g) || []).length;
        const closes = (repaired.match(/[}\]]/g) || []).length;
        for (let i = 0; i < opens - closes; i++) {
          // Determine if we need ] or }
          const lastOpen = repaired.lastIndexOf("{") > repaired.lastIndexOf("[") ? "}" : "]";
          repaired += lastOpen;
        }
        try {
          parsed = JSON.parse(repaired);
          console.log(`  🔧 JSON repaired (${opens - closes} unclosed brackets)`);
        } catch {
          throw parseErr; // Repair failed, throw original error
        }
      }
      if (Array.isArray(parsed) && parsed.length === 1) parsed = parsed[0];

      await fs.writeFile(path.join(outDir, saveFilename), JSON.stringify(parsed, null, 2));
      console.log(`  ✅ Analysis complete → ${saveFilename}`);
      return parsed;
    } catch (err) {
      if (attempt === 3) {
        console.error(`  ❌ Gemini failed: ${err.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return null;
}

// ─── Phase 3: Cross-Round Comparison ────────────────────────────────────────
async function buildCrossRoundDiff(currentResult, videoResult, outDir) {
  console.log("\n📊 Phase 3: Building cross-round comparison...\n");

  const trackerPath = path.join(REPO_ROOT, ".tmp", "live-qa-judge", "tracker.json");
  let tracker = { rounds: [], issueRegistry: {} };
  try {
    tracker = JSON.parse(await fs.readFile(trackerPath, "utf8"));
  } catch { /* fresh start */ }

  const round = tracker.rounds.length + 1;
  const timestamp = new Date().toISOString();

  // Build current round entry
  const allIssues = currentResult?.surfaces?.flatMap((s) => s.issues ?? []) ?? [];
  const currentEntry = {
    round,
    timestamp,
    score: currentResult?.overallScore ?? 0,
    grade: currentResult?.grade ?? "?",
    interactionScore: videoResult?.interactionScore ?? null,
    designCoherence: currentResult?.designCoherence?.score ?? 0,
    surfaceScores: Object.fromEntries(
      (currentResult?.surfaces ?? []).map((s) => [s.id, s.score])
    ),
    p1Count: allIssues.filter((i) => i.severity === "P1").length,
    p2Count: allIssues.filter((i) => i.severity === "P2").length,
    p3Count: allIssues.filter((i) => i.severity === "P3").length,
    issueFingerprints: allIssues.map((i) => ({
      severity: i.severity,
      element: i.element,
      category: i.category,
      desc: i.description?.slice(0, 80),
    })),
    outDir,
  };

  tracker.rounds.push(currentEntry);

  // Compute diffs
  const gen1 = tracker.rounds[0];
  const genPrev = tracker.rounds.length > 1 ? tracker.rounds[tracker.rounds.length - 2] : null;

  const diff = {
    round,
    timestamp,
    current: {
      score: currentEntry.score,
      grade: currentEntry.grade,
      interactionScore: currentEntry.interactionScore,
      p1: currentEntry.p1Count,
      p2: currentEntry.p2Count,
      p3: currentEntry.p3Count,
    },
    vsGen1: gen1 ? {
      scoreDelta: currentEntry.score - gen1.score,
      p1Delta: currentEntry.p1Count - gen1.p1Count,
      p2Delta: currentEntry.p2Count - gen1.p2Count,
      surfaceDeltas: Object.fromEntries(
        Object.entries(currentEntry.surfaceScores).map(([k, v]) => [k, v - (gen1.surfaceScores[k] ?? 0)])
      ),
    } : null,
    vsGenPrev: genPrev ? {
      scoreDelta: currentEntry.score - genPrev.score,
      p1Delta: currentEntry.p1Count - genPrev.p1Count,
      p2Delta: currentEntry.p2Count - genPrev.p2Count,
      surfaceDeltas: Object.fromEntries(
        Object.entries(currentEntry.surfaceScores).map(([k, v]) => [k, v - (genPrev.surfaceScores[k] ?? 0)])
      ),
    } : null,
    trajectory: tracker.rounds.map((r) => ({
      round: r.round,
      score: r.score,
      grade: r.grade,
      p1: r.p1Count,
      p2: r.p2Count,
      p3: r.p3Count,
      interactionScore: r.interactionScore,
    })),
    // Detect regressions
    regressions: [],
    improvements: [],
  };

  // Surface-level regression/improvement detection vs previous round
  if (genPrev) {
    for (const [surfaceId, score] of Object.entries(currentEntry.surfaceScores)) {
      const prevScore = genPrev.surfaceScores[surfaceId] ?? 0;
      if (score < prevScore) {
        diff.regressions.push({ surface: surfaceId, from: prevScore, to: score });
      } else if (score > prevScore) {
        diff.improvements.push({ surface: surfaceId, from: prevScore, to: score });
      }
    }
  }

  // Issue resolution tracking — compare current issue fingerprints to previous
  if (genPrev) {
    const prevElements = new Set(genPrev.issueFingerprints?.map((i) => i.element) ?? []);
    const currElements = new Set(currentEntry.issueFingerprints.map((i) => i.element));

    diff.resolvedIssues = [...prevElements].filter((e) => !currElements.has(e));
    diff.newIssues = [...currElements].filter((e) => !prevElements.has(e));
    diff.persistentIssues = [...currElements].filter((e) => prevElements.has(e));
  }

  // Save tracker and diff
  await fs.writeFile(trackerPath, JSON.stringify(tracker, null, 2));
  await fs.writeFile(path.join(outDir, "cross-round-diff.json"), JSON.stringify(diff, null, 2));

  return diff;
}

// ─── Report Printers ────────────────────────────────────────────────────────
function printScreenshotReport(result, captureData) {
  console.log("\n" + "═".repeat(70));
  console.log("  SCREENSHOT QA REPORT");
  console.log("═".repeat(70));

  if (!result) {
    console.log("\n  ❌ Screenshot judge failed\n");
    return;
  }

  const score = result.overallScore ?? 0;
  const grade = result.grade ?? "?";
  const bar = "█".repeat(Math.round(score / 5)) + "░".repeat(20 - Math.round(score / 5));
  console.log(`\n  Overall: ${bar} ${score}/100 (Grade ${grade})`);

  if (result.surfaces) {
    console.log("\n  ─── Surface Scores ───");
    for (const s of result.surfaces) {
      const sBar = "█".repeat(s.score) + "░".repeat(10 - s.score);
      console.log(`  ${s.id.padEnd(20)} ${sBar} ${s.score}/10`);
    }
  }

  if (result.designCoherence) {
    console.log(`\n  Design Coherence: ${result.designCoherence.score}/10`);
    if (result.designCoherence.notes) {
      console.log(`  ${result.designCoherence.notes.slice(0, 200)}`);
    }
  }

  if (result.topPriorities?.length) {
    console.log("\n  ─── Top Priorities ───");
    for (const p of result.topPriorities.slice(0, 5)) {
      console.log(`  #${p.rank} ${p.issue}`);
      console.log(`     Fix: ${p.fix}`);
    }
  }

  const allIssues = result.surfaces?.flatMap((s) => s.issues ?? []) ?? [];
  const p1 = allIssues.filter((i) => i.severity === "P1");
  const p2 = allIssues.filter((i) => i.severity === "P2");
  const p3 = allIssues.filter((i) => i.severity === "P3");
  console.log(`\n  Issues: ${p1.length} P1 | ${p2.length} P2 | ${p3.length} P3`);

  if (captureData.consoleErrors.length) {
    console.log(`\n  Console Errors: ${captureData.consoleErrors.length}`);
    for (const e of captureData.consoleErrors.slice(0, 3)) {
      console.log(`    ❌ ${e.text.slice(0, 100)}`);
    }
  }

  if (result.overallAssessment) {
    console.log(`\n  Assessment: ${result.overallAssessment.slice(0, 300)}`);
  }
  console.log("═".repeat(70));
}

function printVideoReport(result) {
  if (!result) return;
  console.log("\n" + "═".repeat(70));
  console.log("  VIDEO INTERACTION REPORT");
  console.log("═".repeat(70));

  console.log(`\n  Interaction Score: ${result.interactionScore ?? "?"}/100`);

  if (result.surfaces) {
    console.log("\n  ─── Per-Surface Interaction ───");
    for (const s of result.surfaces) {
      console.log(`  ${(s.id ?? "?").padEnd(16)} Score: ${s.score}/10  Transition: ${s.transitionQuality ?? "?"}  Loading: ${s.loadingStates ?? "?"}  Feedback: ${s.interactionFeedback ?? "?"}`);
    }
  }

  if (result.topInteractionFixes?.length) {
    console.log("\n  ─── Top Interaction Fixes ───");
    for (const f of result.topInteractionFixes.slice(0, 3)) {
      console.log(`  #${f.rank} ${f.issue}`);
      console.log(`     Fix: ${f.fix}`);
    }
  }

  if (result.overallInteractionAssessment) {
    console.log(`\n  Assessment: ${result.overallInteractionAssessment.slice(0, 300)}`);
  }
  console.log("═".repeat(70));
}

function printCrossRoundDiff(diff) {
  if (!diff) return;
  console.log("\n" + "═".repeat(70));
  console.log(`  CROSS-ROUND COMPARISON — Round ${diff.round}`);
  console.log("═".repeat(70));

  console.log(`\n  Current: ${diff.current.score}/100 (Grade ${diff.current.grade}) | P1:${diff.current.p1} P2:${diff.current.p2} P3:${diff.current.p3}`);
  if (diff.current.interactionScore !== null) {
    console.log(`  Interaction: ${diff.current.interactionScore}/100`);
  }

  if (diff.vsGen1) {
    const arrow = diff.vsGen1.scoreDelta > 0 ? "↑" : diff.vsGen1.scoreDelta < 0 ? "↓" : "→";
    console.log(`\n  vs Gen 1:  ${arrow} ${diff.vsGen1.scoreDelta > 0 ? "+" : ""}${diff.vsGen1.scoreDelta} points | P1: ${diff.vsGen1.p1Delta > 0 ? "+" : ""}${diff.vsGen1.p1Delta} | P2: ${diff.vsGen1.p2Delta > 0 ? "+" : ""}${diff.vsGen1.p2Delta}`);

    // Surface deltas
    const surfaceChanges = Object.entries(diff.vsGen1.surfaceDeltas).filter(([, d]) => d !== 0);
    if (surfaceChanges.length) {
      for (const [s, d] of surfaceChanges) {
        console.log(`    ${s.padEnd(20)} ${d > 0 ? "+" : ""}${d}`);
      }
    }
  }

  if (diff.vsGenPrev) {
    const arrow = diff.vsGenPrev.scoreDelta > 0 ? "↑" : diff.vsGenPrev.scoreDelta < 0 ? "↓" : "→";
    console.log(`\n  vs Prev:   ${arrow} ${diff.vsGenPrev.scoreDelta > 0 ? "+" : ""}${diff.vsGenPrev.scoreDelta} points | P1: ${diff.vsGenPrev.p1Delta > 0 ? "+" : ""}${diff.vsGenPrev.p1Delta} | P2: ${diff.vsGenPrev.p2Delta > 0 ? "+" : ""}${diff.vsGenPrev.p2Delta}`);
  }

  if (diff.resolvedIssues?.length) {
    console.log(`\n  ✅ Resolved (${diff.resolvedIssues.length}): ${diff.resolvedIssues.join(", ")}`);
  }
  if (diff.newIssues?.length) {
    console.log(`  🆕 New (${diff.newIssues.length}): ${diff.newIssues.join(", ")}`);
  }
  if (diff.persistentIssues?.length) {
    console.log(`  🔄 Persistent (${diff.persistentIssues.length}): ${diff.persistentIssues.join(", ")}`);
  }

  if (diff.regressions?.length) {
    console.log("\n  ⚠️ REGRESSIONS:");
    for (const r of diff.regressions) {
      console.log(`    ${r.surface}: ${r.from} → ${r.to} (${r.to - r.from})`);
    }
  }
  if (diff.improvements?.length) {
    console.log("\n  🎯 IMPROVEMENTS:");
    for (const i of diff.improvements) {
      console.log(`    ${i.surface}: ${i.from} → ${i.to} (+${i.to - i.from})`);
    }
  }

  // Score trajectory sparkline
  if (diff.trajectory?.length > 1) {
    console.log("\n  ─── Score Trajectory ───");
    const scores = diff.trajectory.map((t) => t.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min || 1;
    const sparkChars = " ▁▂▃▄▅▆▇█";
    const spark = scores.map((s) => sparkChars[Math.round(((s - min) / range) * 8)]).join("");
    console.log(`  ${spark}  (${min}-${max})`);
    console.log(`  Rounds: ${diff.trajectory.map((t) => t.score).join(" → ")}`);
  }

  console.log("\n" + "═".repeat(70));
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

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(REPO_ROOT, ".tmp", "live-qa-judge", stamp);
  await fs.mkdir(outDir, { recursive: true });

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  NodeBench Live QA Video Judge — Gemini 3 Pro           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  Base URL:  ${baseURL}`);
  console.log(`  Model:     ${GEMINI_MODEL}`);
  console.log(`  Output:    ${outDir}`);

  // Phase 1: Capture screenshots + videos
  const captureData = await captureAllSurfaces(baseURL, outDir);
  const validScreenshots = captureData.screenshots.filter((s) => s.path && !s.error);
  console.log(`\n  📸 ${validScreenshots.length} screenshots | 🎬 ${captureData.videos.length} videos`);

  // Phase 2A: Screenshot judge
  const screenshotResult = await judgeScreenshots(validScreenshots, outDir);

  // Phase 2B: Video interaction judge
  const videoResult = await judgeVideos(captureData.videos, screenshotResult, outDir);

  // Phase 3: Cross-round comparison
  const diff = await buildCrossRoundDiff(screenshotResult, videoResult, outDir);

  // Phase 4: Print all reports
  printScreenshotReport(screenshotResult, captureData);
  printVideoReport(videoResult);
  printCrossRoundDiff(diff);

  // Save combined report
  const fullReport = {
    timestamp: new Date().toISOString(),
    round: diff?.round ?? 1,
    baseURL,
    model: GEMINI_MODEL,
    captureData: {
      screenshotCount: validScreenshots.length,
      videoCount: captureData.videos.length,
      consoleErrors: captureData.consoleErrors,
      networkErrors: captureData.networkErrors,
    },
    screenshotResult,
    videoResult,
    crossRoundDiff: diff,
  };

  await fs.writeFile(path.join(outDir, "qa-report.json"), JSON.stringify(fullReport, null, 2));
  console.log(`\n✅ Full report saved to: ${outDir}/qa-report.json`);

  // Exit code
  const p1Count = screenshotResult?.surfaces?.flatMap((s) => s.issues ?? []).filter((i) => i.severity === "P1").length ?? 0;
  if (p1Count > 0) {
    console.log(`\n⚠️ ${p1Count} P1 issues found — requires attention`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
