const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  await page.goto("http://127.0.0.1:5182/agents", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1000);
  const controls = await page.locator("button, a").evaluateAll((nodes) => nodes
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    })
    .map((node) => ({
      tag: node.tagName.toLowerCase(),
      text: (node.textContent || "").replace(/\s+/g, " ").trim(),
      aria: node.getAttribute("aria-label"),
      title: node.getAttribute("title"),
      testId: node.getAttribute("data-testid"),
    }))
    .filter((control) => /agent|chat|ask/i.test(`${control.text} ${control.aria} ${control.title}`)));
  console.log(JSON.stringify(controls, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
