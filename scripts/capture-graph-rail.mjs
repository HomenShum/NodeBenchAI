#!/usr/bin/env node
/**
 * Capture gate for demo/graph-rail: serve the repo statically, replay the
 * committed fixture through the live graph rail, and fail loudly on anything
 * dishonest. Exits nonzero when:
 *   - the page logs ANY console error or throws;
 *   - the rail is empty after the replay (0 entities);
 *   - ANY rendered node label is not a literal substring of the fixture file
 *     (i.e. invented-looking data);
 *   - any edge claims to be evidence or assertion (the fixture cannot back
 *     either — it has no measured pair counts and no complete receipts).
 *
 * Run: node scripts/capture-graph-rail.mjs
 * Output: demo/graph-rail/graph-rail.png
 */
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(
  ROOT,
  "benchmarks/history/archived-2026-q1/persona-episode-eval-pack-20260105-153100.json",
);
const OUT = path.join(ROOT, "demo/graph-rail/graph-rail.png");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT)) throw new Error("outside root");
    const body = await fs.readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const failures = [];
const consoleErrors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(`http://127.0.0.1:${port}/demo/graph-rail/index.html`);

// Wait for the replay to finish and the rail to hold at least one entity.
await page.waitForFunction(
  () => window.__graphRail?.done === true && window.__graphRail.session.getSnapshot().nodes.length > 0,
  { timeout: 90_000 },
);
// Let the post-ingestion animation settle before the still capture.
await page.waitForTimeout(2_500);

const snapshot = await page.evaluate(() => {
  const s = window.__graphRail.session.getSnapshot();
  return {
    labels: s.nodes.map((n) => n.label),
    edgeTypes: s.edges.map((e) => e.type),
    nodes: s.nodes.length,
    edges: s.edges.length,
  };
});

if (snapshot.nodes === 0) failures.push("empty rail: 0 entities after replay");

// Honesty gate: every rendered label must literally appear in the fixture file.
const fixtureText = await fs.readFile(FIXTURE, "utf8");
for (const label of snapshot.labels) {
  if (!fixtureText.includes(label)) failures.push(`label not in fixture (invented?): "${label}"`);
}
// This fixture holds no measured pair counts and no assertion receipts.
for (const t of snapshot.edgeTypes) {
  if (t !== "traversal") failures.push(`edge type "${t}" cannot come from this fixture`);
}
for (const err of consoleErrors) failures.push(`console error: ${err}`);

await page.screenshot({ path: OUT, fullPage: true });
await browser.close();
server.close();

console.log(`rail: ${snapshot.nodes} entities, ${snapshot.edges} edges (all traversal)`);
console.log(`labels verified against fixture: ${snapshot.labels.length}`);
console.log(`capture: ${path.relative(ROOT, OUT)}`);
if (failures.length > 0) {
  console.error(`FAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS: zero console errors, non-empty rail, every label traced to the fixture");
