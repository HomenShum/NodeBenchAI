#!/usr/bin/env node
/**
 * Web Interface Guidelines review (PROMOTION condition 7) — the measuring half.
 *
 * A guidelines review is a JUDGEMENT, not a score, and this script does not
 * make it. What it does is take the measurements the judgement needs, on the
 * real rendered surface, so no finding in the written review rests on reading
 * source. A Lighthouse score is not a substitute: Lighthouse never checks hit
 * target sizes, `transition: all`, ellipsis placeholders, Enter-in-textarea
 * semantics, or whether a focus ring is actually visible.
 *
 * Guidelines: https://vercel.com/design/guidelines
 * Each probe below names the rule it measures. Rules that cannot be measured
 * from the DOM (real-device testing, screen-reader passes, optical alignment)
 * are listed in `notMeasured` rather than silently omitted, because a review
 * that hides its own coverage is the thing this file exists to prevent.
 *
 * PREREQUISITE: a Convex deployment (docs/START_HERE.md "Before Step 1"),
 * otherwise the page under review is the setup card.
 *
 * Run:    node scripts/review-web-interface-guidelines.mjs [--port 4902]
 * Output: promotion/evidence/wig-review/measurements.json + focus PNGs
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "promotion", "evidence", "wig-review");
const i = process.argv.indexOf("--port");
const PORT = Number(i > -1 ? process.argv[i + 1] : 4902);
const BASE = `http://127.0.0.1:${PORT}`;
const ROUTE = "/redesign/chat";

async function convexUrl() {
  if (process.env.VITE_CONVEX_URL) return process.env.VITE_CONVEX_URL.trim();
  const text = await fs.readFile(path.join(repoRoot, ".env.local"), "utf8").catch(() => "");
  const line = text.split(/\r?\n/).find((l) => l.trim().startsWith("VITE_CONVEX_URL="));
  if (!line) throw new Error("No VITE_CONVEX_URL — see docs/START_HERE.md 'Before Step 1'.");
  return line.slice(line.indexOf("=") + 1).trim();
}

async function waitFor(url, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server never answered ${url}`);
}

/** Everything measured inside one page.evaluate, so it is one snapshot. */
const probes = () => {
  const vw = window.innerWidth;
  const minTarget = vw < 768 ? 44 : 24;
  const interactive = [...document.querySelectorAll("button, a[href], input, textarea, select, [role='button'], [tabindex]:not([tabindex='-1'])")];
  const visible = interactive.filter((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  });

  const smallTargets = visible
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) };
    })
    .filter((t) => t.w < minTarget || t.h < minTarget);

  const unnamedIconButtons = visible
    .filter((el) => el.tagName === "BUTTON" && !(el.textContent || "").trim())
    .map((el) => ({ ariaLabel: el.getAttribute("aria-label"), title: el.getAttribute("title"), html: el.outerHTML.slice(0, 90) }))
    .filter((b) => !b.ariaLabel && !b.title);

  const fields = [...document.querySelectorAll("input, textarea")].map((el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute("type"),
    fontSizePx: parseFloat(getComputedStyle(el).fontSize),
    placeholder: el.getAttribute("placeholder"),
    hasLabel: !!(el.id && document.querySelector(`label[for="${el.id}"]`)) || !!el.closest("label") || !!el.getAttribute("aria-label"),
    autocomplete: el.getAttribute("autocomplete"),
  }));

  // Stylesheet-level rules. Same-origin sheets only; a cross-origin sheet
  // throws on .cssRules and is reported rather than skipped silently.
  let transitionAllCount = 0;
  let reducedMotionBlocks = 0;
  let focusVisibleRules = 0;
  let touchActionManipulation = 0;
  let unreadableSheets = 0;
  for (const sheet of [...document.styleSheets]) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      unreadableSheets += 1;
      continue;
    }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.conditionText?.includes("prefers-reduced-motion")) reducedMotionBlocks += 1;
        if (rule.cssRules) walk(rule.cssRules);
        const text = rule.selectorText ?? "";
        if (text.includes(":focus-visible")) focusVisibleRules += 1;
        const style = rule.style;
        if (!style) continue;
        const t = style.getPropertyValue("transition");
        if (/(^|\s|,)all(\s|$|,)/.test(t)) transitionAllCount += 1;
        if (style.getPropertyValue("touch-action") === "manipulation") touchActionManipulation += 1;
      }
    };
    walk(rules);
  }

  const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null;
  return {
    viewportWidth: vw,
    minTargetPx: minTarget,
    title: document.title,
    viewportMeta: viewport,
    zoomDisabled: /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/.test(viewport ?? ""),
    themeColorMeta: document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null,
    htmlColorScheme: getComputedStyle(document.documentElement).colorScheme,
    h1Count: document.querySelectorAll("h1").length,
    mainLandmarks: document.querySelectorAll("main, [role='main']").length,
    skipLink: !!document.querySelector("a[href^='#']"),
    ariaLiveRegions: document.querySelectorAll("[aria-live]").length,
    interactiveCount: visible.length,
    smallTargets,
    unnamedIconButtons,
    fields,
    css: { transitionAllCount, reducedMotionBlocks, focusVisibleRules, touchActionManipulation, unreadableSheets },
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  };
};

async function measureFocusRing(page) {
  // "Every focusable element displays a visible focus ring." Tab to the first
  // control and compare its outline/box-shadow against its resting state.
  const before = await page.evaluate(() => {
    const el = document.querySelector("button, a[href], textarea");
    if (!el) return null;
    const s = getComputedStyle(el);
    return { outline: s.outlineStyle + " " + s.outlineWidth, boxShadow: s.boxShadow };
  });
  await page.keyboard.press("Tab");
  const after = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
      outline: s.outlineStyle + " " + s.outlineWidth,
      boxShadow: s.boxShadow,
    };
  });
  return { restingFirstControl: before, focused: after, changed: !!after && (after.outline !== before?.outline || after.boxShadow !== before?.boxShadow) };
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const url = await convexUrl();
  const server = spawn(
    process.execPath,
    [path.join(repoRoot, "node_modules", "vite", "bin", "vite.js"), "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
    { cwd: repoRoot, env: { ...process.env, VITE_CONVEX_URL: url }, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", () => {});
  server.stderr.on("data", () => {});

  const browser = await chromium.launch();
  const measurements = {};
  try {
    await waitFor(`${BASE}${ROUTE}`);
    for (const vp of [
      { label: "desktop", width: 1280, height: 900 },
      { label: "mobile", width: 375, height: 812 },
    ]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      page.setDefaultNavigationTimeout(240_000);
      await page.goto(`${BASE}${ROUTE}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!document.querySelector("[data-agent-runtime-surface]"), null, { timeout: 180_000 });
      await page.waitForTimeout(5000);
      measurements[vp.label] = await page.evaluate(probes);
      measurements[vp.label].focusRing = await measureFocusRing(page);
      await page.screenshot({ path: path.join(outDir, `focus-${vp.label}.png`) });
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
    await new Promise((r) => setTimeout(r, 1000));
  }

  const out = {
    capturedAt: new Date().toISOString(),
    guidelines: "https://vercel.com/design/guidelines",
    url: `${BASE}${ROUTE}`,
    authState: "signed out",
    measurements,
    notMeasured: [
      "Test on actual mobile devices (emulation only here)",
      "Screen-reader passes (axe covers the tree, not the narration)",
      "Optical alignment ±1px",
      "iOS Low Power Mode / macOS Safari performance",
      "Locale formatting across locales",
    ],
  };
  await fs.writeFile(path.join(outDir, "measurements.json"), `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(out, null, 2));
}

await main();
