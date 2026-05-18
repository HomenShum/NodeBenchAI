/**
 * Capture all demo video screenshots from the home-v3 prototype.
 * Run: node capture-screenshots.mjs
 * Requires: local dev server at http://localhost:5403
 */
import puppeteer from "puppeteer";
import { resolve } from "path";

const BASE_URL = "http://localhost:5403/proto/home-v3.html";
const OUT = resolve("public/screenshots");
const VP = { width: 1920, height: 1080 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: VP,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  // ─── Helper: navigate to surface via JS ───
  async function goSurface(name) {
    await page.evaluate((s) => {
      const nav = document.querySelector(`[data-surface-nav="${s}"]`);
      if (nav) { nav.click(); return; }
      // fallback: click the topbar link
      const links = document.querySelectorAll(".topbar-nav a, .topbar-nav button");
      for (const l of links) {
        if (l.textContent.trim().toLowerCase() === s.toLowerCase()) { l.click(); return; }
      }
    }, name);
    await sleep(800);
  }

  // ─── Helper: screenshot ───
  async function ss(filename) {
    await page.screenshot({ path: resolve(OUT, filename), type: "jpeg", quality: 92 });
    console.log(`  ✓ ${filename}`);
  }

  console.log("Loading prototype...");
  await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1500);

  // ═══ HOME (dark, default) ═══
  console.log("\n─── HOME ───");
  await goSurface("Home");
  await sleep(500);
  await ss("home-dark.jpg");

  // Scroll down for What Changed + Sources
  await page.evaluate(() => {
    const center = document.querySelector(".home-center") || document.querySelector(".center-pane");
    if (center) center.scrollTop = center.scrollHeight * 0.4;
  });
  await sleep(500);
  await ss("home-scrolled.jpg");

  // Scroll back up
  await page.evaluate(() => {
    const center = document.querySelector(".home-center") || document.querySelector(".center-pane");
    if (center) center.scrollTop = 0;
  });
  await sleep(300);

  // ─── Wide mode ───
  await page.evaluate(() => {
    const shell = document.querySelector(".shell");
    if (shell) shell.setAttribute("data-wide", "");
  });
  await sleep(500);
  await ss("home-wide.jpg");

  // Turn off wide mode
  await page.evaluate(() => {
    const shell = document.querySelector(".shell");
    if (shell) shell.removeAttribute("data-wide");
  });
  await sleep(300);

  // ─── Light theme ───
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "light");
  });
  await sleep(500);
  await ss("home-light.jpg");

  // Back to dark
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await sleep(300);

  // ═══ REPORTS ═══
  console.log("\n─── REPORTS ───");
  await goSurface("Reports");
  await sleep(800);
  await ss("reports-dark.jpg");

  // ─── Reports: Graph view ───
  await page.evaluate(() => {
    const graphBtn = document.querySelector('[data-view="graph"], .view-mode-btn[title*="Graph"], button[aria-label*="Graph"]');
    if (graphBtn) graphBtn.click();
    // fallback: look for a graph tab
    const tabs = document.querySelectorAll('.view-tabs button, .view-toggle button');
    for (const t of tabs) {
      if (t.textContent.trim().toLowerCase().includes('graph')) { t.click(); break; }
    }
  });
  await sleep(1200);
  await ss("reports-graph.jpg");

  // ─── Reports: Board view ───
  await page.evaluate(() => {
    const boardBtn = document.querySelector('[data-view="board"], .view-mode-btn[title*="Board"], button[aria-label*="Board"]');
    if (boardBtn) boardBtn.click();
    const tabs = document.querySelectorAll('.view-tabs button, .view-toggle button');
    for (const t of tabs) {
      if (t.textContent.trim().toLowerCase().includes('board')) { t.click(); break; }
    }
  });
  await sleep(800);
  await ss("reports-board.jpg");

  // ─── Reports: Table view ───
  await page.evaluate(() => {
    const tableBtn = document.querySelector('[data-view="table"], .view-mode-btn[title*="Table"], button[aria-label*="Table"]');
    if (tableBtn) tableBtn.click();
    const tabs = document.querySelectorAll('.view-tabs button, .view-toggle button');
    for (const t of tabs) {
      if (t.textContent.trim().toLowerCase().includes('table')) { t.click(); break; }
    }
  });
  await sleep(800);
  await ss("reports-table.jpg");

  // Back to gallery for consistency
  await page.evaluate(() => {
    const galleryBtn = document.querySelector('[data-view="gallery"], .view-mode-btn[title*="Gallery"], button[aria-label*="Gallery"]');
    if (galleryBtn) galleryBtn.click();
    const tabs = document.querySelectorAll('.view-tabs button, .view-toggle button');
    for (const t of tabs) {
      if (t.textContent.trim().toLowerCase().includes('gallery')) { t.click(); break; }
    }
  });
  await sleep(500);

  // ═══ CHAT ═══
  console.log("\n─── CHAT ───");
  await goSurface("Chat");
  await sleep(800);
  await ss("chat-dark.jpg");

  // ─── Chat: scroll to show artifact overlay area ───
  await page.evaluate(() => {
    const chatCenter = document.querySelector(".chat-center") || document.querySelector(".center-pane");
    if (chatCenter) chatCenter.scrollTop = chatCenter.scrollHeight * 0.6;
  });
  await sleep(500);
  await ss("chat-scrolled.jpg");

  // ═══ INBOX ═══
  console.log("\n─── INBOX ───");
  await goSurface("Inbox");
  await sleep(800);
  await ss("inbox-dark.jpg");

  // ═══ ME ═══
  console.log("\n─── ME ───");
  await goSurface("Me");
  await sleep(800);
  await ss("me-dark.jpg");

  // ─── Me: scroll down to show integrations/memory ───
  await page.evaluate(() => {
    const meCenter = document.querySelector(".me-center") || document.querySelector(".center-pane");
    if (meCenter) meCenter.scrollTop = meCenter.scrollHeight * 0.5;
  });
  await sleep(500);
  await ss("me-scrolled.jpg");

  // ═══ MOBILE VIEWPORT ═══
  console.log("\n─── MOBILE ───");
  await page.setViewport({ width: 390, height: 844 });
  await goSurface("Home");
  await sleep(800);
  await ss("home-mobile.jpg");

  // Restore desktop viewport
  await page.setViewport(VP);
  await sleep(300);

  console.log("\n[done] All screenshots captured.");
  await browser.close();
}

capture().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
