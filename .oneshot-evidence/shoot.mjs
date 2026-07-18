import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:4188";
const OUT = `${process.cwd()}/.oneshot-evidence`;

async function seedAndShoot(page, { width, height, theme, file }) {
  await page.setViewportSize({ width, height });
  // Prime localStorage on the origin before the app reads it, then reload so
  // the ?qaState=answer seed effect fires with the dogfood-chrome flag set.
  await page.goto(`${BASE}/redesign/chat`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => {
    localStorage.setItem("nodebench-redesign-qa-chrome", "1");
    localStorage.setItem("nodebench:redesign:theme", t);
  }, theme);
  await page.goto(`${BASE}/redesign/chat?qaState=answer`, { waitUntil: "networkidle" });
  // Wait for the seeded answer to render.
  await page.waitForSelector(".rd-answer-copy", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  const info = await page.evaluate(() => {
    const msg = document.querySelector(".rd-chat-assistant");
    return {
      hasAssistantMessage: !!msg,
      hasAnswerCopy: !!document.querySelector(".rd-answer-copy"),
      disclosureCount: document.querySelectorAll(".rd-answer-disclose").length,
      hasReceipt: !!document.querySelector(".rd-answer-receipt__line"),
      hasActions: !!document.querySelector(".rd-answer-actions"),
      hasRisks: !!document.querySelector(".rd-answer-risks"),
      hasNext: !!document.querySelector(".rd-answer-next"),
      theme: document.querySelector("[data-redesign]")?.getAttribute("data-redesign-theme"),
      hasTool: !!document.querySelector(".rd-answer-tool"),
      textareas: document.querySelectorAll("textarea").length,
    };
  });
  console.log(file, JSON.stringify(info));
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await seedAndShoot(page, { width: 1440, height: 900, theme: "dark", file: "answer-desktop-dark.png" });
await seedAndShoot(page, { width: 1440, height: 900, theme: "light", file: "answer-desktop-light.png" });
await seedAndShoot(page, { width: 390, height: 844, theme: "dark", file: "answer-mobile-dark.png" });
await browser.close();
console.log("DONE");
