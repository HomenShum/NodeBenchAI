#!/usr/bin/env node
/**
 * ci-qa-check.mjs — CI-compatible public guest capture integrity check
 *
 * Reads dogfood artifacts from public/dogfood/ and validates:
 * 1. All required manifests exist and are fresh
 * 2. Referenced files and observed metadata (4 route variants + 2
 *    interactions + 1 settings state)
 * 3. Walkthrough has enough chapters (>= 9)
 * 4. Frames extracted
 * 5. Scribe steps captured
 *
 * A pass verifies capture integrity, not pixel quality, live answers, saved
 * report reopening, keyboard/tablet coverage, or production deployment.
 * Exit code 0 = pass, 1 = fail
 * Designed for GitHub Actions — no SQLite deps, just reads JSON files.
 */

import { readFileSync, existsSync, statSync } from "fs";
import { join, resolve, sep } from "path";

const REPO_ROOT = process.cwd();
const DOGFOOD_DIR = join(REPO_ROOT, "public", "dogfood");
const MIN_ROUTE_SCREENSHOTS = 4;
const MIN_INTERACTION_SCREENSHOTS = 2;
const MIN_SETTINGS_SCREENSHOTS = 1;
const MIN_SCREENSHOTS =
  MIN_ROUTE_SCREENSHOTS + MIN_INTERACTION_SCREENSHOTS + MIN_SETTINGS_SCREENSHOTS;

const CHECKS = [];
let passed = true;

function check(name, condition, detail) {
  const ok = condition;
  CHECKS.push({ name, ok, detail });
  if (!ok) passed = false;
  console.log(`  ${ok ? "OK" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

function readJSON(filename) {
  const filepath = join(DOGFOOD_DIR, filename);
  if (!existsSync(filepath)) return null;
  try {
    return JSON.parse(readFileSync(filepath, "utf8"));
  } catch {
    return null;
  }
}

function hoursAgo(isoDate) {
  if (!isoDate) return Infinity;
  const captured = new Date(isoDate);
  const now = new Date();
  return (now - captured) / (1000 * 60 * 60);
}

function fresh(isoDate) {
  const age = hoursAgo(isoDate);
  return Number.isFinite(age) && age >= 0 && age < 24;
}

function hasFile(publicPath) {
  if (typeof publicPath !== "string" || !publicPath.startsWith("/dogfood/")) return false;
  const target = resolve(REPO_ROOT, "public", publicPath.slice(1));
  if (!target.startsWith(`${DOGFOOD_DIR}${sep}`)) return false;
  try { const file = statSync(target); return file.isFile() && file.size > 0; } catch { return false; }
}

function observationsValid(rows) {
  return rows.every((row) => ["dark", "light"].includes(row.theme) && row.observedUrl && row.observedState &&
    (row.status === "CAPTURED" || (row.status === "NOT_RUN" && typeof row.cause === "string" && row.cause.trim())));
}

function guestActionsHonest(rows) {
  const find = (name) => rows.find((row) => row.name === `Interaction: ${name}`);
  return ["Home to Chat", "Reports to Chat"].every((name) => {
    const row = find(name);
    return row?.status === "NOT_RUN" && typeof row.cause === "string" && row.cause.trim();
  }) && find("Composer preparation")?.status === "CAPTURED" &&
    find("Theme toggle")?.status === "CAPTURED" && find("Theme toggle")?.theme === "light";
}

console.log("=== Dogfood Capture Integrity Gate (CI) ===\n");
console.log("Scope: public guest observations. Live research and saved-report reopening are NOT_RUN; pixels require separate review.\n");

// ── Manifest ──
console.log("[1/4] Screenshots (manifest.json)");
const manifest = readJSON("manifest.json");
check("manifest exists", !!manifest);
if (manifest) {
  const items = manifest.items || [];
  check(
    `screenshot count >= ${MIN_SCREENSHOTS}`,
    items.length >= MIN_SCREENSHOTS,
    `${items.length} screenshots`,
  );
  const age = hoursAgo(manifest.capturedAtIso);
  check("manifest fresh (0–24h)", fresh(manifest.capturedAtIso), `${Math.floor(age)}h old`);
  const routes = items.filter((i) => i.kind === "route").length;
  const interactions = items.filter((i) => i.kind === "interaction").length;
  const settings = items.filter((i) => i.kind === "settings").length;
  check(
    "has responsive/theme route screenshots",
    routes >= MIN_ROUTE_SCREENSHOTS,
    `${routes} route variants`,
  );
  check(
    "has interaction screenshots",
    interactions >= MIN_INTERACTION_SCREENSHOTS,
    `${interactions} interactions`,
  );
  check(
    "has settings screenshots",
    settings >= MIN_SETTINGS_SCREENSHOTS,
    `${settings} settings`,
  );
  const variants = new Set(items.filter((i) => i.kind === "route").map((i) => `${i.theme}:${i.dimensions?.width}x${i.dimensions?.height}`));
  check("actual four route variants", ["dark:1440x900", "light:1440x900", "dark:390x844", "light:390x844"].every((v) => variants.has(v)));
  check("screenshot files and matching capture metadata", observationsValid(items) && items.every((i) => {
    if (!/^[\w.-]+\.png$/.test(i.file ?? "") || !hasFile(`/dogfood/screenshots/${i.file}`) || !fresh(i.capturedAtIso)) return false;
    return JSON.stringify(readJSON(`screenshots/${i.file}.json`)) === JSON.stringify(i);
  }));
  check("guest preparation and missing-context screenshots", manifest.captureScope === "public-guest-read-only" &&
    items.some((i) => i.file === "interaction-workspace-ready.png" && i.status === "CAPTURED" && i.observedState === "Question filled; Run research enabled; not submitted") &&
    items.some((i) => i.file === "interaction-report-context.png" && i.status === "CAPTURED" && i.observedState === "Notebook context unavailable; no report attached; composer ready") &&
    items.some((i) => i.file === "settings-theme-toggle.png" && i.status === "CAPTURED" && i.theme === "light"));
}
console.log();

// ── Walkthrough ──
console.log("[2/4] Walkthrough (walkthrough.json)");
const walkthrough = readJSON("walkthrough.json");
check("walkthrough exists", !!walkthrough);
if (walkthrough) {
  const chapters = walkthrough.chapters || [];
  check("chapter count >= 9", chapters.length >= 9, `${chapters.length} chapters`);
  const age = hoursAgo(walkthrough.capturedAt || walkthrough.capturedAtIso);
  check("walkthrough fresh (0–24h)", fresh(walkthrough.capturedAtIso), `${Math.floor(age)}h old`);
  const totalSec = chapters.length > 0 ? chapters[chapters.length - 1].startSec : 0;
  check("recorded chapter span >= 10s", totalSec >= 10, `${totalSec}s (not a decoded duration check)`);
  check("manifest video included", ["/dogfood/walkthrough.mp4", "/dogfood/walkthrough.webm"].includes(walkthrough.videoPath) && hasFile(walkthrough.videoPath));
  check("settled ordered chapter samples", chapters.every((c, i) => Number.isFinite(c.actionStartSec) && c.actionStartSec >= 0 &&
    Number.isFinite(c.sampleSec) && c.sampleSec >= c.actionStartSec && c.startSec === c.sampleSec &&
    (i === 0 || c.actionStartSec >= chapters[i - 1].sampleSec)));
  check("walkthrough observations and unperformed actions disclosed", walkthrough.captureScope === "public-guest-read-only" && observationsValid(chapters) && guestActionsHonest(chapters));
}
console.log();

// ── Frames ──
console.log("[3/4] Frames (frames.json)");
const frames = readJSON("frames.json");
check("frames exists", !!frames);
if (frames) {
  const items = frames.items || frames.frames || [];
  check("frame count >= 9", items.length >= 9, `${items.length} frames`);
  check("frames refer to settled chapters and actual files", frames.captureScope === "public-guest-read-only" && fresh(frames.capturedAtIso) &&
    frames.videoPath === walkthrough?.videoPath && items.length === walkthrough?.chapters?.length &&
    items.every((item, i) => {
      const chapter = walkthrough?.chapters?.[i];
      return hasFile(item.image) && chapter && ["name", "sampleSec", "status", "cause", "theme", "observedUrl", "observedState"].every((key) => item[key] === chapter[key]);
    }));
}
console.log();

// ── Scribe ──
console.log("[4/4] Scribe (scribe.json)");
const scribe = readJSON("scribe.json");
check("scribe exists", !!scribe);
if (scribe) {
  const steps = scribe.steps || [];
  check("scribe steps >= 8", steps.length >= 8, `${steps.length} steps`);
  const age = hoursAgo(scribe.capturedAt || scribe.capturedAtIso);
  check("scribe fresh (0–24h)", fresh(scribe.capturedAtIso), `${Math.floor(age)}h old`);
  check("scribe observations, actual images and unperformed actions disclosed", scribe.captureScope === "public-guest-read-only" &&
    observationsValid(steps) && guestActionsHonest(steps) && steps.every((s) => hasFile(s.image)));
}
console.log();

// ── Summary ──
const passCount = CHECKS.filter((c) => c.ok).length;
const failCount = CHECKS.filter((c) => !c.ok).length;

console.log("=== Summary ===");
console.log(`  Passed: ${passCount}/${CHECKS.length}`);
console.log(`  Failed: ${failCount}/${CHECKS.length}`);
console.log("  This result covers artifact integrity. It does not certify completed research or a visual grade.");
console.log();

if (passed) {
  console.log("GATE: PASSED");
  process.exit(0);
} else {
  console.log("GATE: FAILED");
  CHECKS.filter((c) => !c.ok).forEach((c) => {
    console.log(`  - ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
  });
  process.exit(1);
}
