#!/usr/bin/env node
/**
 * Record a short clip of demo/graph-rail replaying the committed eval
 * transcript: page load -> rail populates from recorded events -> hover a
 * real node (hover isolation) -> drag it (positions are layout, not meaning).
 *
 * Honesty gates (same stance as scripts/capture-graph-rail.mjs):
 *   - fails on any console error;
 *   - fails if the rail is empty after replay;
 *   - fails if any rendered label is not a literal substring of the fixture;
 *   - fails if any edge is not plain traversal.
 *
 * The only page modification is an observe-only shim: the importmap's "sigma"
 * entry is redirected to a subclass that records constructed instances on
 * window.__sigmas so this script can compute real node viewport coordinates
 * for the hover/drag. Rendering behaviour is unchanged.
 *
 * Run: node scripts/record-graph-rail-clip.mjs
 * Output: demo/graph-rail/graph-rail-clip.webm  (convert to gif with ffmpeg)
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
const OUT = path.join(ROOT, "demo/graph-rail/graph-rail-clip.webm");
const VIDEO_DIR = path.join(ROOT, "demo/graph-rail/.video-tmp");

const SIGMA_SHIM = `
import RealSigma from "https://esm.sh/sigma@3.0.3";
export * from "https://esm.sh/sigma@3.0.3";
class TracedSigma extends RealSigma {
  constructor(...args) { super(...args); (window.__sigmas ??= []).push(this); }
}
export default TracedSigma;
`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/__sigma_shim.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(SIGMA_SHIM);
      return;
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT)) throw new Error("outside root");
    let body = await fs.readFile(file);
    if (rel === "demo/graph-rail/index.html") {
      body = Buffer.from(
        body
          .toString("utf8")
          .replace('"sigma": "https://esm.sh/sigma@3.0.3"', '"sigma": "/__sigma_shim.js"'),
      );
    }
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
const context = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 860 } },
});
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(`http://127.0.0.1:${port}/demo/graph-rail/index.html`);

// The replay itself is the demo: recording runs while events stream in.
await page.waitForFunction(
  () =>
    window.__graphRail?.done === true &&
    window.__graphRail.session.getSnapshot().nodes.length > 0,
  { timeout: 90_000 },
);
// Let the layout settle so the hover/drag reads clearly.
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
const fixtureText = await fs.readFile(FIXTURE, "utf8");
for (const label of snapshot.labels) {
  if (!fixtureText.includes(label)) failures.push(`label not in fixture (invented?): "${label}"`);
}
for (const t of snapshot.edgeTypes) {
  if (t !== "traversal") failures.push(`edge type "${t}" cannot come from this fixture`);
}

// Locate a well-connected node's on-screen position through the traced sigma.
const target = await page.evaluate(() => {
  const sig = (window.__sigmas ?? [])[0];
  if (!sig) return null;
  const graph = sig.getGraph();
  let best = null;
  graph.forEachNode((node) => {
    const deg = graph.degree(node);
    if (!best || deg > best.deg) best = { node, deg };
  });
  if (!best) return null;
  const attrs = graph.getNodeAttributes(best.node);
  const p = sig.graphToViewport({ x: attrs.x, y: attrs.y });
  const rect = sig.getContainer().getBoundingClientRect();
  return { x: rect.left + p.x, y: rect.top + p.y, label: attrs.label, degree: best.deg };
});
if (!target) failures.push("sigma instance not traced; cannot locate a node to interact with");

if (target) {
  // Hover: approach the node, rest on it so hover isolation is visible.
  await page.mouse.move(target.x + 160, target.y + 120);
  await page.mouse.move(target.x, target.y, { steps: 40 });
  await page.waitForTimeout(1_600);
  // Drag: pick the node up, move it in a small arc, release.
  await page.mouse.down();
  await page.mouse.move(target.x + 90, target.y - 40, { steps: 35 });
  await page.mouse.move(target.x + 40, target.y + 55, { steps: 35 });
  await page.mouse.up();
  await page.waitForTimeout(1_800);
}

for (const err of consoleErrors) failures.push(`console error: ${err}`);

await context.close(); // flushes the video
await browser.close();
server.close();

const files = await fs.readdir(VIDEO_DIR);
const webm = files.find((f) => f.endsWith(".webm"));
if (!webm) {
  console.error("FAILED: no video produced");
  process.exit(1);
}
await fs.rm(OUT, { force: true });
await fs.rename(path.join(VIDEO_DIR, webm), OUT);
await fs.rm(VIDEO_DIR, { recursive: true, force: true });

console.log(`rail: ${snapshot.nodes} entities, ${snapshot.edges} edges (all traversal)`);
if (target) console.log(`interacted with node "${target.label}" (degree ${target.degree})`);
console.log(`clip: ${path.relative(ROOT, OUT)}`);
if (failures.length > 0) {
  console.error(`FAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS: zero console errors, non-empty rail, every label traced to the fixture");
