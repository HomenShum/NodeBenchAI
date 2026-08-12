/**
 * Record the NodeGraph rail INSIDE the real product UI (EntityProfilePage,
 * reached via the /#entity/<name> grammar that digest links and
 * scripts/seed-entity-contexts.ts print), against a LIVE Convex deployment.
 *
 *   node demo/graph-rail-live/record-product-rail.mjs [convex-url]
 *
 * The deployment URL defaults to VITE_CONVEX_URL from .env.local — the same
 * isolated dev deployment the product frontend itself talks to. NEVER point
 * this at production.
 *
 * What is on camera, in order:
 *   1. The product page loads at /#entity/Anthropic and the rail populates
 *      reactively from the page's own Convex queries (entity + sources +
 *      relationship edges), starting from 0 nodes.
 *   2. A REAL write through the backend's own storeEntityContext mutation
 *      (the exact mutation the seed script uses) appends one extra cited
 *      source — the rail grows by one node live over the WebSocket, no
 *      reload, no polling. The original sources are restored afterwards so
 *      the deployment data stays canonical.
 *
 * GATES (exit nonzero on failure — an empty rail is a failed recording):
 *   - the rail element must exist on the product page
 *   - rail nodes must reach >= 4 from the initial reactive population
 *   - rail nodes must strictly increase after the live mutation
 */
import { spawn } from "node:child_process";
import { readFileSync, renameSync, rmSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const PORT = 4674;
const die = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

// ── deployment URL: argv > env > .env.local (the product's own config) ──
let deployment = process.argv[2] || process.env.CONVEX_URL;
if (!deployment) {
  const env = readFileSync(".env.local", "utf8");
  deployment = env.match(/^VITE_CONVEX_URL=(.+)$/m)?.[1]?.trim();
}
if (!deployment) die("no deployment url (argv, CONVEX_URL, or VITE_CONVEX_URL in .env.local)");
if (/agile-caribou/.test(deployment)) die("refusing: that deployment is not the isolated dev one");
console.log(`deployment: ${new URL(deployment).host}`);

// ── start the REAL product frontend (vite reads .env.local itself) ──
const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  shell: true, stdio: "ignore",
});
const cleanup = () => { try { vite.kill(); } catch { /* already dead */ } };
process.on("exit", cleanup);
for (let i = 0; ; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) break; } catch { /* not up yet */ }
  if (i > 60) die("vite dev server never became ready");
  await new Promise((r) => setTimeout(r, 1000));
}

// ── the live mutation payload: read current context, append one source ──
const client = new ConvexHttpClient(deployment);
const getEntityContext = makeFunctionReference("domains/knowledge/entityContexts:getEntityContext");
const storeEntityContext = makeFunctionReference("domains/knowledge/entityContexts:storeEntityContext");
const target = { entityName: "Anthropic", entityType: "company" };
const before = await client.query(getEntityContext, target);
if (!before) die("Anthropic not seeded on this deployment — run scripts/seed-entity-contexts.ts first");
const baseArgs = {
  ...target,
  summary: before.summary,
  keyFacts: before.keyFacts ?? [],
  sources: (before.sources ?? []).map(({ name, url, snippet }) => ({ name, url, snippet })),
  crmFields: before.crmFields,
  funding: before.funding,
  people: before.people,
  recentNewsItems: before.recentNewsItems,
  personaHooks: before.personaHooks,
};
const extraSource = {
  name: "Reuters",
  url: "https://reuters.com/technology/anthropic",
  snippet: "Wire coverage appended live on camera through storeEntityContext",
};

// ── record ──
mkdirSync("demo/graph-rail-live/media", { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 1280, height: 860 },
  recordVideo: { dir: "demo/graph-rail-live/media", size: { width: 1280, height: 860 } },
});
const p = await ctx.newPage();
const video = p.video();
await p.goto(`http://127.0.0.1:${PORT}/#entity/Anthropic`, { waitUntil: "domcontentloaded" });

const RAIL = '[data-testid="entity-graph-rail"]';
await p.waitForSelector(RAIL, { timeout: 60000 }).catch(() => die("rail never appeared in the product page"));
await p.waitForFunction(
  (sel) => Number(document.querySelector(sel)?.dataset.railNodes ?? 0) >= 4,
  RAIL,
  { timeout: 60000 },
).catch(() => die("rail stayed under 4 nodes — reactive population did not happen"));
const populated = Number(await p.getAttribute(RAIL, "data-rail-nodes"));
console.log(`populated reactively: ${populated} nodes`);
await p.waitForTimeout(5000); // let the layout settle on camera

// live mutation on camera → rail must grow without a reload
await client.mutation(storeEntityContext, { ...baseArgs, sources: [...baseArgs.sources, extraSource] });
await p.waitForFunction(
  ({ sel, n }) => Number(document.querySelector(sel)?.dataset.railNodes ?? 0) > n,
  { sel: RAIL, n: populated },
  { timeout: 30000 },
).catch(() => die("rail did not grow after the live storeEntityContext write"));
const grown = Number(await p.getAttribute(RAIL, "data-rail-nodes"));
console.log(`after live mutation: ${grown} nodes (was ${populated})`);
await p.waitForTimeout(6000);
await p.screenshot({ path: "demo/graph-rail-live/product-rail-live.png" });
await ctx.close();

// restore canonical seeded sources
await client.mutation(storeEntityContext, baseArgs);

const tmp = await video.path();
rmSync("demo/graph-rail-live/media/product-rail-live.webm", { force: true });
renameSync(tmp, "demo/graph-rail-live/media/product-rail-live.webm");
await b.close();
cleanup();
console.log(`PASS product rail recorded: ${populated} -> ${grown} nodes live`);
