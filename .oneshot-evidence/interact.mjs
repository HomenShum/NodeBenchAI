import { chromium } from "playwright";
const BASE = process.env.BASE_URL || "http://127.0.0.1:4188";
const b = await chromium.launch();
const p = await b.newPage();
await p.setViewportSize({ width: 1440, height: 900 });
await p.goto(`${BASE}/redesign/chat`, { waitUntil: "domcontentloaded" });
await p.evaluate(() => { localStorage.setItem("nodebench-redesign-qa-chrome","1"); localStorage.setItem("nodebench:redesign:theme","dark"); });
await p.goto(`${BASE}/redesign/chat?qaState=answer`, { waitUntil: "networkidle" });
await p.waitForSelector(".rd-answer-copy", { timeout: 15000 });
// Expand Reasoning + Sources
const triggers = await p.$$(".rd-answer-disclose");
for (const t of triggers) { await t.click(); await p.waitForTimeout(200); }
await p.waitForTimeout(600);
const info = await p.evaluate(() => ({
  evidenceRows: document.querySelectorAll(".rd-evidence-row[data-cite]").length,
  badges: document.querySelectorAll(".rd-evidence-row__badge").length,
  runThread: !!document.querySelector(".rd-run-thread li[data-state]"),
  runtimeBoard: !!document.querySelector('[data-testid="chat-runtime-board"]'),
  traceLabel: (document.querySelector(".rd-answer-trace__label")?.textContent||"").trim(),
  reasoningOpen: !!document.querySelector('.rd-answer-reasoning [data-state="open"]'),
  sourcesOpen: !!document.querySelector('.rd-answer-sources[data-state="open"], .rd-answer-sources [data-state="open"]'),
  structuredBlock: !!document.querySelector(".rd-answer-structured"),
  nav: document.querySelectorAll("nav").length,
  oneSurface: !!document.querySelector('[data-testid="one-surface-workspace"]'),
}));
console.log(JSON.stringify(info, null, 2));
await p.screenshot({ path: `${process.cwd()}/.oneshot-evidence/answer-desktop-dark-expanded.png`, fullPage: true });
await b.close();
