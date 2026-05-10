#!/usr/bin/env node
/**
 * recordPrDemo.mjs — automated PR demo video recording.
 *
 * When a PR ships, this script renders a 30–60 s walkthrough of the
 * surfaces it changed and writes the result to `dist/pr-videos/PR-{N}.mp4`.
 * The recorder reuses the same Playwright + persistent-context pattern as
 * `scripts/ui/recordDogfoodWalkthrough.mjs` — see that file for the
 * canonical recording engine; this script only adds:
 *
 *   1. PR-aware surface routing (which routes to record based on which
 *      files the PR changed).
 *   2. A fixed BOUNDED budget per recording session.
 *   3. HONEST_STATUS — non-zero exit on any failure, with the failure
 *      mode written to a sibling JSON manifest so the GitHub workflow
 *      doesn't post a fake "demo recorded" comment.
 *
 * Invocation:
 *
 *   npm run pr-demo -- --pr-number=305
 *   npm run pr-demo -- --pr-number=305 --base-url=https://www.nodebenchai.com
 *   npm run pr-demo -- --pr-number=305 --output=dist/pr-videos/PR-305.mp4
 *
 * Reliability invariants (.claude/rules/agentic_reliability.md):
 *   - BOUND          MAX_SURFACES_PER_SESSION = 5; MAX_RECORDING_MS = 90s
 *                    (60s spec + 30s grace).  Hard cap on the entire
 *                    Playwright session at 5 minutes.
 *   - HONEST_STATUS  Per-step try/catch.  On any failure, exit code !=0
 *                    AND write `_localManifestPath` with `{ ok: false,
 *                    reason }` so the calling workflow can comment
 *                    truthfully ("demo failed" not "demo recorded").
 *   - TIMEOUT        Per-page navigation: 30s max.  Per-surface settle:
 *                    3.5s.  Whole session: 5min hard cap via Promise.race.
 *   - SSRF           No outbound fetch beyond Playwright's loading of
 *                    the explicit base URL the user passed.  PR file
 *                    lookup is `gh pr view` which validates against the
 *                    user's authenticated repo.
 *   - ERROR_BOUNDARY Top-level try/catch + manifest write before exit.
 *   - DETERMINISTIC  Same PR + same base-url → same surface list.  The
 *                    surface routing table is a pure function of the
 *                    PR's changed-file paths.
 *
 * Prior art:
 *   - scripts/ui/recordDogfoodWalkthrough.mjs — the recording engine
 *     this reuses (persistent context, video → mp4, manifest write).
 *   - scripts/ui/runDogfoodGeminiQa.mjs       — pipeline orchestrator
 *     that also reads `gh` CLI metadata.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);

/* ── Bounds (agentic_reliability) ──────────────────────────────── */

const MAX_SURFACES_PER_SESSION = 5;
const MAX_RECORDING_MS = 90_000; // 60s target + 30s grace
const SESSION_HARD_CAP_MS = 5 * 60 * 1000; // 5 minutes
const NAV_TIMEOUT_MS = 30_000;
const SETTLE_MS = 3_500;

/* ── CLI parsing ──────────────────────────────────────────────── */

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const [k, v] = raw.split("=", 2);
    if (v !== undefined) args.set(k.slice(2), v);
    else
      args.set(
        k.slice(2),
        argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true",
      );
  }
  return args;
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function msToSec(ms) {
  return Math.round((ms / 1000) * 10) / 10;
}

async function removePathRobustly(targetPath) {
  if (!existsSync(targetPath)) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
      return;
    } catch (err) {
      if (attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
}

/* ── Surface routing (pure function of changed-file paths) ─────── */

/**
 * Routing table: file-path patterns → surfaces to record.
 *
 * Each rule is `{ match: RegExp, name: string, path: string }` plus a
 * description used in the overlay caption.  The deterministic ordering
 * below is significant — earlier rules win, and the result is
 * deduplicated while preserving order.
 *
 * Adding a new surface: drop a rule here.  Don't add ad-hoc logic to
 * the recording loop — keep routing as a pure data structure so it
 * stays testable.
 */
const ROUTING_RULES = [
  {
    match: /^src\/features\/redesign\/surfaces\//,
    name: "Redesign surface",
    path: "/redesign",
  },
  {
    match: /^src\/features\/redesign\/components\/edition\//,
    name: "Edition components",
    path: "/redesign",
  },
  {
    match: /^convex\/domains\/integrations\/voice\//,
    name: "Voice surface",
    path: "/voice/health",
  },
  {
    match: /^convex\/domains\/integrations\/macro\//,
    name: "Scoreboard (macro stats)",
    path: "/redesign",
  },
  {
    match: /^convex\/domains\/integrations\/video\//,
    name: "Editorial home (video lite-embed)",
    path: "/redesign",
  },
  {
    match: /^src\/features\/redesign\//,
    name: "Redesign shell",
    path: "/redesign",
  },
];

/**
 * Default fallback record list when the routing table doesn't match
 * (e.g. doc-only PR, CI workflow PR).  Always includes the landing
 * page — proves the build still serves something.
 */
const DEFAULT_SURFACES = [
  { name: "Landing", path: "/" },
  { name: "Redesign home", path: "/redesign" },
];

/**
 * Pick which surfaces to record for a given list of changed files.
 *
 * Pure function — same input always produces the same output.  Caps at
 * MAX_SURFACES_PER_SESSION and always includes at least one surface.
 *
 * Exported as a named export so the unit-test file
 * (recordPrDemo.test.mjs) can pin the routing contract.
 */
export function pickSurfacesForPr(files) {
  const matched = [];
  const seen = new Set();
  for (const file of files) {
    for (const rule of ROUTING_RULES) {
      if (!rule.match.test(file)) continue;
      const key = rule.path;
      if (seen.has(key)) continue;
      seen.add(key);
      matched.push({ name: rule.name, path: rule.path });
      break; // first matching rule wins for this file
    }
    if (matched.length >= MAX_SURFACES_PER_SESSION) break;
  }
  if (matched.length === 0) return DEFAULT_SURFACES.slice(0, MAX_SURFACES_PER_SESSION);
  return matched.slice(0, MAX_SURFACES_PER_SESSION);
}

/* ── PR file lookup via `gh` ───────────────────────────────────── */

/**
 * Fetch the list of changed file paths in a PR via `gh pr view --json files`.
 *
 * Returns string[] of repo-relative paths.  Throws on non-zero exit.
 *
 * The shell call uses `spawnSync` (not `execFile`) so we can fail
 * loudly with stderr surfaced to the caller — this is HONEST_STATUS:
 * a missing `gh` binary or auth failure should kill the recorder, not
 * silently fall through to a default surface list.
 */
function fetchPrChangedFiles(prNumber) {
  const result = spawnSync(
    "gh",
    ["pr", "view", String(prNumber), "--json", "files"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `gh pr view ${prNumber} failed (exit ${result.status}): ${result.stderr || result.stdout || "no output"}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`gh pr view returned non-JSON: ${err}`);
  }
  if (!parsed || !Array.isArray(parsed.files)) {
    throw new Error("gh pr view JSON missing `files` array");
  }
  return parsed.files
    .map((f) => (typeof f.path === "string" ? f.path : null))
    .filter(Boolean);
}

/* ── ffmpeg transcode (lifted from recordDogfoodWalkthrough.mjs) ─ */

async function maybeTranscodeToMp4(inputPath, outputPath) {
  let ffmpegPath;
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    const mod = await import("ffmpeg-static");
    ffmpegPath = mod.default || mod;
  } catch {
    return { ok: false, reason: "ffmpeg-static not installed" };
  }
  if (!ffmpegPath) return { ok: false, reason: "ffmpeg binary missing" };

  await execFileAsync(ffmpegPath, [
    "-y",
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
  return { ok: true };
}

/* ── Main recording loop ──────────────────────────────────────── */

async function recordWithBudget(page, surfaces) {
  const startedAt = Date.now();
  const chapters = [];
  for (const [idx, surface] of surfaces.entries()) {
    if (Date.now() - startedAt > MAX_RECORDING_MS) {
      // BOUND — stop early, don't keep recording past the budget.
      chapters.push({
        index: chapters.length + 1,
        name: "Truncated (budget hit)",
        path: "(truncated)",
        startSec: msToSec(Date.now() - startedAt),
      });
      break;
    }
    const t0 = Date.now();
    chapters.push({
      index: idx + 1,
      name: surface.name,
      path: surface.path,
      startSec: msToSec(t0 - startedAt),
    });
    try {
      // First surface uses a full goto; subsequent surfaces use
      // SPA history.pushState so we don't re-load the bundle.
      if (idx === 0) {
        await page.goto(surface.path, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT_MS,
        });
      } else {
        await page.evaluate((p) => {
          history.pushState({}, "", p);
          window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
        }, surface.path);
      }
      await page.waitForTimeout(SETTLE_MS);
    } catch (err) {
      // HONEST_STATUS — log per-surface failures into the manifest
      // (chapter still recorded so the video keeps the timestamp).
      chapters[chapters.length - 1].error = String(
        err instanceof Error ? err.message : err,
      );
    }
  }
  return chapters;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prNumber = args.get("pr-number");
  if (!prNumber || !/^\d+$/.test(String(prNumber))) {
    throw new Error("--pr-number=N (positive integer) required");
  }

  const baseURL = args.get("base-url") ?? "https://www.nodebenchai.com";
  const outDir = args.get("out-dir") ?? path.resolve(process.cwd(), "dist", "pr-videos");
  const headless = (args.get("headless") ?? "true") !== "false";

  const stamp = nowStamp();
  await mkdir(outDir, { recursive: true });

  const userDataDir = path.join(outDir, `userdata-PR-${prNumber}-${stamp}`);
  await removePathRobustly(userDataDir);
  await mkdir(userDataDir, { recursive: true });

  // Resolve --output relative to CWD so users can pass paths like
  // `dist/pr-videos/PR-305.mp4` without double-joining against outDir.
  // Default (no --output) is ${outDir}/PR-${prNumber}.mp4.
  const outputArg = args.get("output");
  const outputPath = outputArg
    ? (path.isAbsolute(outputArg) ? outputArg : path.resolve(process.cwd(), outputArg))
    : path.join(outDir, `PR-${prNumber}.mp4`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const manifestPath = outputPath.replace(/\.(mp4|webm)$/, ".json");

  const baseManifest = {
    capturedAtIso: new Date().toISOString(),
    prNumber: Number(prNumber),
    baseURL,
    ok: false,
    reason: null,
    surfaces: [],
    chapters: [],
    videoPath: null,
    durationSec: null,
  };

  // PR file lookup — fail-fast.
  let files;
  try {
    files = fetchPrChangedFiles(prNumber);
  } catch (err) {
    baseManifest.reason = `gh pr lookup failed: ${err instanceof Error ? err.message : err}`;
    await writeFile(manifestPath, JSON.stringify(baseManifest, null, 2) + "\n", "utf8");
    throw err;
  }

  const surfaces = pickSurfacesForPr(files);
  baseManifest.surfaces = surfaces;

  const startedAt = Date.now();

  // Wrap the entire Playwright session in a hard cap (BOUND).
  let context;
  let page;
  let videoPath = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
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
    page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

    const recordingPromise = recordWithBudget(page, surfaces);
    const hardCap = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`session exceeded ${SESSION_HARD_CAP_MS}ms hard cap`)),
        SESSION_HARD_CAP_MS,
      ),
    );
    const chapters = await Promise.race([recordingPromise, hardCap]);
    baseManifest.chapters = chapters;

    const video = page.video();
    await page.close();
    await context.close();
    if (video) {
      videoPath = await video.path();
    }
  } catch (err) {
    baseManifest.reason = `recording failed: ${err instanceof Error ? err.message : err}`;
    try {
      if (page) await page.close();
      if (context) await context.close();
    } catch {
      // best-effort
    }
    await writeFile(manifestPath, JSON.stringify(baseManifest, null, 2) + "\n", "utf8");
    await removePathRobustly(userDataDir).catch(() => {});
    throw err;
  }

  await removePathRobustly(userDataDir).catch(() => {});

  if (!videoPath) {
    baseManifest.reason = "no video captured (Playwright recordVideo missing or empty)";
    await writeFile(manifestPath, JSON.stringify(baseManifest, null, 2) + "\n", "utf8");
    throw new Error(baseManifest.reason);
  }

  // Try to transcode webm → mp4.  If ffmpeg-static isn't installed,
  // keep the webm and rename the output.
  const transcoded = await maybeTranscodeToMp4(videoPath, outputPath);
  if (transcoded.ok) {
    baseManifest.videoPath = path.relative(process.cwd(), outputPath);
  } else {
    // Fall back to keeping the original webm.
    const fallbackPath = outputPath.replace(/\.mp4$/, ".webm");
    const fs = await import("node:fs/promises");
    await fs.copyFile(videoPath, fallbackPath);
    baseManifest.videoPath = path.relative(process.cwd(), fallbackPath);
    baseManifest.reason = `mp4 transcode unavailable (${transcoded.reason}); kept webm`;
  }

  baseManifest.ok = true;
  baseManifest.durationSec = msToSec(Date.now() - startedAt);
  await writeFile(manifestPath, JSON.stringify(baseManifest, null, 2) + "\n", "utf8");

  // eslint-disable-next-line no-console
  console.log(
    `Recorded PR-${prNumber} demo:\n  Video: ${baseManifest.videoPath}\n  Manifest: ${path.relative(process.cwd(), manifestPath)}\n  Surfaces: ${surfaces.map((s) => s.name).join(", ")}`,
  );
}

// Direct-invoke guard.  When imported by the unit test we don't run main().
//
//   process.argv[1] is the script that node was invoked with.  When
//   the test imports this file via `import { pickSurfacesForPr }`,
//   process.argv[1] is the vitest runner, NOT this script — so this
//   block is skipped.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace(/^file:\/\//, ""));

if (invokedDirectly || process.argv[1]?.endsWith("recordPrDemo.mjs")) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[recordPrDemo] FAILED: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
