import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://localhost:5173");
await page.waitForLoadState("networkidle");

// Sign in anonymously
const anonBtn = page.locator('button:has-text("Sign in anonymously")');
if (await anonBtn.count() > 0) {
  console.log("Signing in anonymously...");
  await anonBtn.click();
  await page.waitForTimeout(3000);
  await page.waitForLoadState("networkidle");
}

// Now check buttons again
const buttons = await page.$$eval("button", (els) =>
  els.map((el) => ({
    text: (el.textContent || "").trim().slice(0, 60),
    ariaLabel: el.getAttribute("aria-label"),
    title: el.getAttribute("title"),
  }))
);

console.log("Found", buttons.length, "buttons after sign-in:");
for (const b of buttons) {
  if (b.ariaLabel || b.title || (b.text && b.text.toLowerCase().includes("setting"))) {
    console.log("  >>", JSON.stringify(b));
  }
}

// Check for aria-labels
const ariaEls = await page.$$eval("[aria-label]", (els) =>
  els.map((el) => ({
    tag: el.tagName,
    ariaLabel: el.getAttribute("aria-label"),
  }))
);
console.log("\nAll aria-labels after sign-in:");
for (const a of ariaEls) {
  console.log("  ", JSON.stringify(a));
}

// Check for title attributes on buttons
const titledBtns = await page.$$eval("button[title]", (els) =>
  els.map((el) => ({
    title: el.getAttribute("title"),
    text: (el.textContent || "").trim().slice(0, 40),
  }))
);
console.log("\nButtons with title:");
for (const t of titledBtns) {
  console.log("  ", JSON.stringify(t));
}

await page.screenshot({ path: "test-results/debug-signed-in.png" });
console.log("\nScreenshot saved: test-results/debug-signed-in.png");
await browser.close();
