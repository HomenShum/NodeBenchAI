import { expect, test } from "@playwright/test";

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, "") ?? "http://localhost:5173";

async function visibleSvgTextCount(page: import("@playwright/test").Page, selector: string) {
  return page.locator(selector).evaluateAll((els) =>
    els.filter((el) => {
      const styleOpacity = Number(getComputedStyle(el).opacity || "1");
      const attrOpacity = Number(el.getAttribute("opacity") ?? styleOpacity);
      return styleOpacity * attrOpacity > 0.05;
    }).length,
  );
}

test.describe("redesign reports graph readability", () => {
  test.setTimeout(45_000);

  test("keeps graph labels bounded and moves long titles into disclosure", async ({ page }) => {
    await page.goto(`${BASE_URL}/redesign/reports?view=graph&qa=graph-scale-controls`);
    const graph = page.locator(".rd-v3-graph");
    await expect(graph).toBeVisible({ timeout: 20_000 });
    await expect(graph).toHaveAttribute("data-scale-mode", /focus|clustered|expanded/);

    await expect(page.locator(".rd-v3-graph-node").first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_000);

    const nodeCount = Number(await graph.getAttribute("data-node-count"));
    expect(nodeCount).toBeGreaterThan(0);

    const visibleLabels = await visibleSvgTextCount(page, ".rd-v3-graph-node__label");
    const visibleEdgeLabels = await visibleSvgTextCount(page, ".rd-v3-graph-edge-label");
    expect(visibleLabels).toBeLessThanOrEqual(Math.ceil(nodeCount * 0.55));
    expect(visibleEdgeLabels).toBe(0);

    const tooLongVisibleLabels = await page.locator(".rd-v3-graph-node__label").evaluateAll((els) =>
      els
        .filter((el) => {
          const styleOpacity = Number(getComputedStyle(el).opacity || "1");
          const attrOpacity = Number(el.getAttribute("opacity") ?? styleOpacity);
          return styleOpacity * attrOpacity > 0.05;
        })
        .map((el) => el.textContent?.trim() ?? "")
        .filter((text) => text.length > 28),
    );
    expect(tooLongVisibleLabels).toEqual([]);

    const firstNode = page.locator(".rd-v3-graph-node").nth(Math.min(6, nodeCount - 1));
    const box = await firstNode.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    await expect(page.locator(".rd-v3-graph-peek")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".rd-v3-graph-peek")).toContainText(/Sources|Freshness|Verified/);

    const afterClickEdgeLabels = await visibleSvgTextCount(page, ".rd-v3-graph-edge-label");
    expect(afterClickEdgeLabels).toBeLessThanOrEqual(Math.max(8, Math.ceil(nodeCount * 0.25)));

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
