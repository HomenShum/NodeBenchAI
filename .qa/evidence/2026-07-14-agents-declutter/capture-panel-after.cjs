const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const URL = "http://127.0.0.1:5187/agents";
const OUT_DIR = path.join(__dirname, "after");

async function capture(browser, scheme) {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 900 },
    colorScheme: scheme,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`PAGEERR ${error.message}`));

  await page.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByRole("button", { name: "Open agent panel" }).click();
  await page.waitForTimeout(1200);
  const tabletFile = path.join(OUT_DIR, `fast-agent-tablet-${scheme}.png`);
  await page.screenshot({ path: tabletFile });

  const tabletMetrics = await page.evaluate(() => ({
    bodyText: document.body.innerText.slice(0, 600),
    visibleControls: Array.from(document.querySelectorAll("button, a, textarea, input, select"))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .map((node) => node.getAttribute("aria-label") || (node.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean),
  }));

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: scheme,
    deviceScaleFactor: 2,
  });
  const mobilePage = await mobileContext.newPage();
  mobilePage.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  mobilePage.on("pageerror", (error) => consoleErrors.push(`PAGEERR ${error.message}`));
  await mobilePage.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
  const mobileTrigger = mobilePage.locator('[aria-label="Open agent panel"]');
  if (await mobileTrigger.count() === 0) throw new Error("Mobile agent-panel trigger is absent from the DOM");
  await mobileTrigger.evaluate((node) => node.click());
  await mobilePage.waitForTimeout(800);
  const mobileFile = path.join(OUT_DIR, `fast-agent-mobile-${scheme}.png`);
  await mobilePage.screenshot({ path: mobileFile });

  console.log(JSON.stringify({
    scheme,
    tabletFile,
    mobileFile,
    consoleErrors,
    tabletMetrics,
  }));
  await mobileContext.close();
  await context.close();
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  await capture(browser, "light");
  await capture(browser, "dark");
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
