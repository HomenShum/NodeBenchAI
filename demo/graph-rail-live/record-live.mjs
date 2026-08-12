/**
 * Record the rail populating from a LIVE Convex deployment running
 * NodeBench's real backend. Requires: `npx convex dev --once` done against
 * an isolated dev deployment (never production), env keys set for module
 * analysis, and the deployment URL passed as argv[2].
 *
 *   node demo/graph-rail-live/record-live.mjs https://<dev>.convex.cloud
 *
 * The gate: the page must show 0 entities BEFORE the seed runs, and >=10
 * after the repo's own scripts/seed-entity-contexts.ts writes through the
 * real storeEntityContext mutation — populated reactively over WebSocket,
 * no polling, no replay file. Exits nonzero otherwise.
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { renameSync, rmSync, mkdirSync } from "node:fs";

const deployment = process.argv[2];
if (!deployment) { console.error("usage: record-live.mjs <convex-url>"); process.exit(1); }
const srv = spawn(process.platform === "win32" ? "python" : "python3", ["-m", "http.server", "4671"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1500));
mkdirSync("demo/graph-rail-live/media", { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark",
  recordVideo: { dir: "demo/graph-rail-live/media", size: { width: 1280, height: 860 } } });
const p = await ctx.newPage();
const video = p.video();
await p.goto(`http://127.0.0.1:4671/demo/graph-rail-live/?deployment=${encodeURIComponent(deployment)}`, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => (document.querySelector("#status")?.textContent ?? "").includes("waiting for data"), null, { timeout: 30000 });
if (await p.getAttribute("#status", "data-entities") !== "0") { console.error("RAIL NOT EMPTY BEFORE SEED"); process.exit(1); }
await p.waitForTimeout(2500);
spawn("npx", ["tsx", "scripts/seed-entity-contexts.ts"], { shell: true, env: { ...process.env, CONVEX_URL: deployment }, stdio: "inherit" });
await p.waitForFunction(() => Number(document.querySelector("#status")?.dataset.entities ?? 0) >= 10, null, { timeout: 120000 });
console.log("LIVE:", await p.textContent("#status"));
await p.waitForTimeout(5000);
await p.screenshot({ path: "demo/graph-rail-live/live-convex-rail.png" });
await ctx.close();
const tmp = await video.path();
rmSync("demo/graph-rail-live/media/live-convex-rail.webm", { force: true });
renameSync(tmp, "demo/graph-rail-live/media/live-convex-rail.webm");
await b.close();
srv.kill();
console.log("PASS live convex rail recorded");
