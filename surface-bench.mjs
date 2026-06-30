/**
 * proof-looping SURFACE BENCHMARK — runs every nodebench-ai UI surface through the REAL browser
 * on the live site, capturing screenshot + video + console per surface, scoring with deterministic
 * UI-contract checks + a Gemini visual judge. The "verify across all UI" shape from solo-founder-nodes.
 *
 * Evidence -> .proofloop-ui/<ts>/{screenshots,videos,scorecard.json,scorecard.md}
 * Keys: GEMINI_API_KEY (visual judge; injected at run time, never printed).
 * Run:  BASE_URL=https://www.nodebenchai.com node surface-bench.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const BASE = (process.env.BASE_URL ?? "https://www.nodebenchai.com").replace(/\/$/, "");
const GEMINI = process.env.GEMINI_API_KEY ?? "";
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const ROOT = `.proofloop-ui/${ts}`;
mkdirSync(`${ROOT}/screenshots`, { recursive: true });
mkdirSync(`${ROOT}/videos`, { recursive: true });

// The surface set (public + anonymous-session reachable). Auth-gated ones are EXPECTED to score low —
// the benchmark reports which surfaces render vs gate/break. That honesty IS the signal.
const SURFACES = [
  { id: "landing", route: "/", task: "Landing renders with a clear primary action" },
  { id: "developers", route: "/developers", task: "Developer/API surface renders" },
  { id: "pricing", route: "/pricing", task: "Pricing renders" },
  { id: "agents", route: "/agents", task: "Agents surface renders" },
  { id: "benchmarks", route: "/benchmarks", task: "Benchmarks surface renders" },
  { id: "research", route: "/research", task: "Research surface renders" },
  { id: "lens", route: "/lens", task: "Lens surface renders" },
  { id: "pulse", route: "/pulse", task: "Pulse surface renders" },
  { id: "capture", route: "/capture", task: "Capture surface renders" },
  { id: "compare", route: "/compare", task: "Compare surface renders" },
  { id: "reports", route: "/reports", task: "Reports surface renders" },
  { id: "receipts", route: "/receipts", task: "Receipts surface renders" },
  { id: "cli", route: "/cli", task: "CLI surface renders" },
  { id: "changelog", route: "/changelog", task: "Changelog renders" },
  { id: "about", route: "/about", task: "About renders" },
  { id: "share-404", route: "/share/nonexistent-proofloop", task: "Missing share shows recovery StatusCard (graceful 404)", expect: /Link not found|not found|Back to NodeBench/i },
  // deep surfaces — auth-gated; honestly record whether they show content or a clean sign-in (not a hard fail)
  { id: "chat", route: "/chat", task: "Chat/agent surface reachable", authExpected: true },
  { id: "me", route: "/me", task: "Personal workspace (auth-gated)", authExpected: true },
  { id: "inbox", route: "/inbox", task: "Inbox (auth-gated)", authExpected: true },
];

async function geminiJudge(pngPath, surface) {
  if (!GEMINI) return { score: null, blockers: [], notes: "no GEMINI_API_KEY" };
  const b64 = readFileSync(pngPath).toString("base64");
  const prompt = `You are a strict product-UI judge. Surface: "${surface.id}" — intended job: ${surface.task}.
Judge ONLY what is visible in the screenshot. Return ONLY minified JSON:
{"score":0-2,"blockers":["critical visible defect", ...],"notes":"one line"}
score 2 = clean, clear primary action, no overflow/blank/broken state. 1 = usable but flawed. 0 = blank/broken/error.
Do not infer success from anything not visible.`;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/png", data: b64 } }] }], generationConfig: { temperature: 0 } }),
    });
    if (!r.ok) return { score: null, blockers: [], notes: `gemini ${r.status}` };
    const j = await r.json();
    const txt = (j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").replace(/```(?:json)?/gi, "").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : {};
    return { score: typeof parsed.score === "number" ? parsed.score : null, blockers: parsed.blockers ?? [], notes: parsed.notes ?? "" };
  } catch (e) { return { score: null, blockers: [], notes: `judge error: ${String(e?.message ?? e).slice(0, 80)}` }; }
}

const browser = await chromium.launch();
const results = [];
console.log(`\n=== proof-looping SURFACE BENCHMARK @ ${BASE} (${SURFACES.length} surfaces) ===\n`);

for (const s of SURFACES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: `${ROOT}/videos`, size: { width: 1280, height: 800 } } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
  const rec = { id: s.id, route: s.route, task: s.task };
  const t0 = Date.now();
  try {
    const resp = await page.goto(BASE + s.route, { waitUntil: "domcontentloaded", timeout: 30000 });
    rec.status = resp?.status() ?? 0;
    await page.locator("h1, h2, [role=heading], main").first().waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1200); // let hydration settle
    rec.loadMs = Date.now() - t0;
    rec.title = (await page.title()).slice(0, 80);
    const expSrc = s.expect ? s.expect.source : null;
    const m = await page.evaluate((es) => {
      const txt = (document.body?.innerText ?? "").trim();
      const hasHeading = !!document.querySelector("h1,h2,[role=heading]");
      const overflow = document.documentElement.scrollWidth > window.innerWidth + 4;
      const agentRoot = !!document.querySelector("[data-main-content],[data-screen-id]");
      const expectMet = es ? new RegExp(es, "i").test(txt) : (txt.length > 200 || hasHeading);
      return { textLen: txt.length, hasHeading, overflow, agentRoot, expectMet, firstText: txt.slice(0, 120) };
    }, expSrc);
    Object.assign(rec, m);
    const shot = `${ROOT}/screenshots/${s.id}.png`;
    await page.screenshot({ path: shot, fullPage: false });
    rec.screenshot = shot;
    rec.consoleErrors = consoleErrors.length;
    // deterministic score — per-surface acceptance (expectMet), not a blanket length rule
    let score = 100;
    const renders = (rec.status ?? 0) < 400 && (m.hasHeading || m.expectMet || m.textLen > 200);
    if (!renders) score -= 100;
    if (!m.expectMet) score -= 35;
    score -= Math.min(consoleErrors.length * 10, 30);
    if (m.overflow) score -= 15;
    if (!m.agentRoot) score -= 5; // advisory: marketing pages may not use AgentScreen
    rec.detScore = Math.max(0, score);
    rec.renders = renders;
  } catch (e) {
    rec.error = String(e?.message ?? e).slice(0, 160);
    rec.renders = false; rec.detScore = 0; rec.consoleErrors = consoleErrors.length;
  }
  await ctx.close();
  try { rec.video = await page.video()?.path(); } catch {}
  // visual judge
  if (rec.screenshot) { const v = await geminiJudge(rec.screenshot, s); rec.visualScore = v.score; rec.visualBlockers = v.blockers; rec.visualNotes = v.notes; }
  let pass = rec.renders && rec.detScore >= 70 && (rec.visualScore == null || rec.visualScore >= 1);
  if (s.authExpected) { rec.gated = true; pass = !rec.error && (rec.status ?? 0) < 500; } // reachable without crash = OK
  rec.pass = pass;
  results.push(rec);
  console.log(`${pass ? "PASS" : "FAIL"}  ${s.id.padEnd(12)} det=${rec.detScore} vis=${rec.visualScore ?? "-"} err=${rec.consoleErrors} ${rec.loadMs ?? "?"}ms ${rec.gated ? "[gated]" : ""} ${rec.error ? "ERR:" + rec.error : ""}`);
}

// ── INTERACTIVE TASK: anonymous user submits a research query and must get a response (submit -> result) ──
{
  const s = { id: "interactive-fastagent", route: "/", task: "Anonymous user submits a research query and receives a response" };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: `${ROOT}/videos`, size: { width: 1280, height: 900 } } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  const rec = { id: s.id, route: s.route, task: s.task, interactive: true };
  const t0 = Date.now();
  try {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);
    let input = page.getByPlaceholder(/message|ask about|^ask|research/i).first();
    if (!(await input.isVisible().catch(() => false))) {
      const opener = page.getByRole("button", { name: /chat|ask|agent|assistant|new (chat|message)/i }).first();
      if (await opener.isVisible().catch(() => false)) { await opener.click().catch(() => {}); await page.waitForTimeout(1500); }
      input = page.getByPlaceholder(/message|ask about|^ask|research/i).first();
    }
    await input.waitFor({ state: "visible", timeout: 12000 });
    await page.screenshot({ path: `${ROOT}/screenshots/${s.id}-before.png` });
    const query = "What is Anthropic's enterprise strategy and the key risks in 2026?";
    await input.click(); await input.fill(query);
    await input.press("Enter").catch(() => {});
    const cancel = page.getByRole("button", { name: /cancel request|stop/i }).first();
    await cancel.waitFor({ state: "visible", timeout: 10000 }).catch(() => {}); // request started
    const done = page.getByRole("button", { name: /copy message|good response|copy to clipboard/i }).first();
    await Promise.race([
      done.waitFor({ state: "visible", timeout: 80000 }).catch(() => {}),
      cancel.waitFor({ state: "hidden", timeout: 80000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(2500);
    rec.screenshot = `${ROOT}/screenshots/${s.id}-after.png`;
    await page.screenshot({ path: rec.screenshot });
    const after = await page.evaluate(() => { const t = (document.body?.innerText ?? "").trim(); return { len: t.length, tail: t.slice(-700) }; });
    rec.responseChars = after.len; rec.responseTail = after.tail; rec.loadMs = Date.now() - t0; rec.consoleErrors = consoleErrors.length;
    const respondedDom = await done.isVisible().catch(() => false);
    const signInBlock = await page.getByText(/sign in|log in|sign up|create an account|continue with/i).first().isVisible().catch(() => false);
    rec.blockedBy = (signInBlock && !respondedDom) ? "auth (sign-in required)" : undefined;
    // HONEST detector: a real answer must (a) show a completion affordance, (b) actually address THIS query,
    // and (c) not be sign-in-gated. The demo template's own copy-buttons + seed content twice fooled the
    // affordance/keyword checks — the visual judge was right that submit is auth-gated. Require topic match.
    const topicHit = /anthropic/i.test(after.tail);
    rec.responded = respondedDom && topicHit && !signInBlock;
    rec.detScore = rec.responded ? 100 : 0; rec.renders = true;
  } catch (e) { rec.error = String(e?.message ?? e).slice(0, 180); rec.responded = false; rec.detScore = 0; rec.renders = false; }
  await ctx.close();
  try { rec.video = await page.video()?.path(); } catch {}
  if (rec.screenshot) { const v = await geminiJudge(rec.screenshot, s); rec.visualScore = v.score; rec.visualBlockers = v.blockers; rec.visualNotes = v.notes; }
  // the visual judge is authoritative on "blocked": if it sees an auth/sign-in wall, the task did NOT complete.
  if ((rec.visualBlockers || []).some((b) => /auth|sign.?in|log.?in|blocked|required/i.test(String(b)))) { rec.responded = false; rec.blockedBy = rec.blockedBy ?? "auth (visual judge: sign-in required)"; }
  if (!rec.responded && !rec.blockedBy) rec.blockedBy = "no answer to this query";
  rec.pass = !!rec.responded && (rec.visualScore == null || rec.visualScore >= 1);
  results.push(rec);
  console.log(`${rec.pass ? "PASS" : "FAIL"}  ${s.id.padEnd(20)} responded=${rec.responded} ${rec.blockedBy ? "[blocked: " + rec.blockedBy + "]" : ""} chars=${rec.responseChars ?? "-"} vis=${rec.visualScore ?? "-"} ${rec.loadMs ?? "?"}ms ${rec.error ? "ERR:" + rec.error : ""}`);
}

await browser.close();

const passed = results.filter((r) => r.pass).length;
const det = Math.round(results.reduce((a, r) => a + (r.detScore || 0), 0) / results.length);
const visScores = results.map((r) => r.visualScore).filter((x) => typeof x === "number");
const vis = visScores.length ? (visScores.reduce((a, b) => a + b, 0) / visScores.length).toFixed(2) : "n/a";
const summary = { base: BASE, surfaces: results.length, passed, failed: results.length - passed, meanDetScore: det, meanVisualScore: vis, ts };

writeFileSync(`${ROOT}/scorecard.json`, JSON.stringify({ summary, results }, null, 2));
const md = [
  `# proof-looping surface benchmark — ${BASE}`,
  `${passed}/${results.length} surfaces pass · mean det ${det}/100 · mean visual ${vis}/2`, ``,
  `| surface | route | pass | det | vis | err | load | note |`,
  `|---|---|---|---|---|---|---|---|`,
  ...results.map((r) => `| ${r.id} | ${r.route} | ${r.pass ? "✅" : "❌"} | ${r.detScore} | ${r.visualScore ?? "-"} | ${r.consoleErrors ?? "-"} | ${r.loadMs ?? "-"}ms | ${(r.error || r.visualNotes || "").slice(0, 60)} |`),
].join("\n");
writeFileSync(`${ROOT}/scorecard.md`, md);
console.log(`\n=== ${passed}/${results.length} pass · mean det ${det}/100 · mean visual ${vis}/2 ===`);
console.log(`evidence: ${ROOT}/ (screenshots + videos + scorecard.md)`);
