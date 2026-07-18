const { chromium } = require("../../../../../node_modules/playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1512, height: 900 } });
  await page.goto("https://www.nodebenchai.com/agents", {
    waitUntil: "networkidle",
    timeout: 45000,
  });
  await page.waitForTimeout(1200);
  const controls = await page.locator("button, a, textarea, input, select, summary").evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .map((node) => ({
        tag: node.tagName.toLowerCase(),
        text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90),
        aria: node.getAttribute("aria-label"),
        title: node.getAttribute("title"),
      })),
  );
  console.log(JSON.stringify(controls, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
