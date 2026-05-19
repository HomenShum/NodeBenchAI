import { chromium } from "playwright";

const BASE_URL = process.argv[2] || "http://localhost:5200";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  colorScheme: "dark",
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto(`${BASE_URL}/redesign`, { timeout: 45000 });
await page.waitForSelector(".rd-v3-home-composer-head", { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2000);

const metrics = await page.evaluate(() => {
  const r = {};
  const dock = document.querySelector(".rd-v3-halo-dock");
  r.dockDisplay = dock ? window.getComputedStyle(dock).display : "not found";
  r.dockHeight = dock ? dock.offsetHeight : 0;

  const mono = document.querySelector(".rd-mono");
  r.shortcutDisplay = mono ? window.getComputedStyle(mono).display : "not in DOM";
  r.shortcutText = mono ? mono.textContent.slice(0, 50) : "";

  const composerHead = document.querySelector(".rd-v3-home-composer-head");
  r.composerTop = composerHead ? Math.round(composerHead.getBoundingClientRect().top) : -1;
  r.composerHeight = composerHead ? composerHead.offsetHeight : -1;

  const h1 = composerHead?.querySelector("h1");
  r.h1FontSize = h1 ? window.getComputedStyle(h1).fontSize : "not found";

  const ta = document.querySelector("textarea");
  r.textboxTop = ta ? Math.round(ta.getBoundingClientRect().top) : -1;

  const haloSection = document.querySelector('[aria-label="Report memory halo"]');
  r.haloHeight = haloSection ? haloSection.offsetHeight : -1;

  const promises = [];
  document.querySelectorAll(".rd-row > span").forEach((s) => {
    if (s.textContent.includes("Continues") || s.textContent.includes("Saves") || s.textContent.includes("Export")) {
      promises.push({
        text: s.textContent.slice(0, 30),
        height: s.offsetHeight,
        fontSize: window.getComputedStyle(s).fontSize,
        minHeight: window.getComputedStyle(s).minHeight,
      });
    }
  });
  r.promiseBadges = promises;

  r.viewport = window.innerWidth + "x" + window.innerHeight;
  r.aboveFold = r.textboxTop < 844 ? "YES" : "NO";
  return r;
});

console.log("=== Mobile Layout Verification ===");
console.log(`Viewport: ${metrics.viewport}`);
console.log(`Dock: display=${metrics.dockDisplay} h=${metrics.dockHeight} ${metrics.dockDisplay === "none" ? "PASS" : "FAIL"}`);
console.log(`Shortcut hints: ${metrics.shortcutDisplay} ${metrics.shortcutDisplay === "none" ? "PASS (hidden)" : metrics.shortcutDisplay === "not in DOM" ? "PASS (absent)" : "FAIL"}`);
console.log(`H1 font-size: ${metrics.h1FontSize}`);
console.log(`Halo section height: ${metrics.haloHeight}px`);
console.log(`Composer top: ${metrics.composerTop}px`);
console.log(`Textbox top: ${metrics.textboxTop}px — above fold? ${metrics.aboveFold}`);
if (metrics.promiseBadges.length) {
  console.log(`Promise badges (${metrics.promiseBadges.length}):`);
  metrics.promiseBadges.forEach((b) => console.log(`  "${b.text}" h=${b.height} fontSize=${b.fontSize} minH=${b.minHeight}`));
} else {
  console.log("Promise badges: not found");
}

await browser.close();
