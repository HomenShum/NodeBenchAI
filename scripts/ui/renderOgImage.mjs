// Rasterize the ScratchNode OG card SVG -> PNG (1200x630).
//
// Crawlers (Slack/Discord/X/iMessage/LinkedIn) prefer a real PNG over SVG for
// link previews, so og:image points at og-scratchnode.png. This script renders
// public/og-scratchnode.svg through the already-installed Playwright Chromium,
// loading the brand fonts (Manrope + JetBrains Mono) from Google Fonts so the
// card matches the live site. If the font CDN is unreachable the SVG's own
// fallback chain (system-ui / ui-monospace) keeps the render legible.
//
// Run: node scripts/ui/renderOgImage.mjs
// Re-run whenever public/og-scratchnode.svg changes.

import { chromium } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const SVG_PATH = resolve("public/og-scratchnode.svg");
const PNG_PATH = resolve("public/og-scratchnode.png");

const svg = readFileSync(SVG_PATH, "utf8");
const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<style>html,body{margin:0;padding:0;background:#151413}svg{display:block}</style>
</head><body>${svg}</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  // networkidle so the Google Fonts stylesheet + font files settle; tolerate a
  // timeout (offline CI) and fall back to the SVG's own font chain.
  try {
    await page.setContent(html, { waitUntil: "networkidle", timeout: 15000 });
  } catch {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
  }
  try {
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null));
  } catch {
    /* fonts API unavailable — proceed with whatever loaded */
  }
  const el = await page.$("svg");
  if (!el) throw new Error("svg element not found in render page");
  await el.screenshot({ path: PNG_PATH, type: "png" });
  const { size } = statSync(PNG_PATH);
  console.log(`wrote ${PNG_PATH} (${size} bytes, 1200x630)`);
} finally {
  await browser.close();
}
