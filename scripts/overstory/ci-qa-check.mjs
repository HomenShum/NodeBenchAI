#!/usr/bin/env node
/**
 * ci-qa-check.mjs — CI-compatible dogfood QA gate check
 *
 * Reads dogfood artifacts from public/dogfood/ and validates:
 * 1. All required manifests exist and are fresh
 * 2. Complete one-surface screenshot coverage (4 route variants + 2
 *    interactions + 1 settings state)
 * 3. Walkthrough has enough chapters (>= 9)
 * 4. Frames extracted
 * 5. Scribe steps captured
 *
 * Exit code 0 = pass, 1 = fail
 * Designed for GitHub Actions — no SQLite deps, just reads JSON files.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

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

console.log("=== Dogfood QA Gate (CI) ===\n");

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
  check("manifest fresh (< 24h)", age < 24, `${Math.floor(age)}h old`);
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
  check("walkthrough fresh (< 24h)", age < 24, `${Math.floor(age)}h old`);
  const totalSec = chapters.length > 0 ? chapters[chapters.length - 1].startSec : 0;
  check("video duration >= 10s", totalSec >= 10, `${totalSec}s`);
}
console.log();

// ── Frames ──
console.log("[3/4] Frames (frames.json)");
const frames = readJSON("frames.json");
check("frames exists", !!frames);
if (frames) {
  const items = frames.items || frames.frames || [];
  check("frame count >= 9", items.length >= 9, `${items.length} frames`);
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
  check("scribe fresh (< 24h)", age < 24, `${Math.floor(age)}h old`);
}
console.log();

// ── Summary ──
const passCount = CHECKS.filter((c) => c.ok).length;
const failCount = CHECKS.filter((c) => !c.ok).length;

console.log("=== Summary ===");
console.log(`  Passed: ${passCount}/${CHECKS.length}`);
console.log(`  Failed: ${failCount}/${CHECKS.length}`);
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
