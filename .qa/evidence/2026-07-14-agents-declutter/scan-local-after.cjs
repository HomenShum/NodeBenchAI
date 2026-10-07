const { chromium } = require("playwright");

const URL = "http://127.0.0.1:5187/agents";

async function scan(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1200);

  return page.evaluate(() => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const controls = Array.from(document.querySelectorAll("button, a, textarea, input, select, summary"))
      .filter(visible)
      .map((node) => ({
        tag: node.tagName.toLowerCase(),
        text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90),
        aria: node.getAttribute("aria-label"),
        title: node.getAttribute("title"),
      }));
    const recentTopics = Array.from(document.querySelectorAll("section"))
      .find((node) => node.textContent?.includes("Recent topics"));
    const commandArea = document.querySelector('textarea[aria-label="Message input"]')?.closest("div.space-y-2");
    const hubSelect = document.querySelector('select[aria-label^="Choose hub"]');

    return {
      documentHeight: document.documentElement.scrollHeight,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      controlCount: controls.length,
      buttonCount: controls.filter((control) => control.tag === "button").length,
      linkCount: controls.filter((control) => control.tag === "a").length,
      topicHeight: recentTopics?.getBoundingClientRect().height ?? null,
      commandHeight: commandArea?.getBoundingClientRect().height ?? null,
      hasCompactHubSelect: Boolean(hubSelect && visible(hubSelect)),
      controls,
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const desktopPage = await browser.newPage({ viewport: { width: 1512, height: 900 } });
  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const desktop = await scan(desktopPage, { width: 1512, height: 900 });
  const mobile = await scan(mobilePage, { width: 390, height: 844 });
  console.log(JSON.stringify({ desktop, mobile }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
