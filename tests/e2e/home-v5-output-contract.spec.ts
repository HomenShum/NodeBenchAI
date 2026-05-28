import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

test("home-v5 runDemoFull keeps visible invariants and L1/L2/L3 output contracts aligned", async ({
  page,
}) => {
  const fileUrl = pathToFileURL(resolve("public/proto/home-v5.html")).toString();

  await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => typeof (window as any).runDemoFull === "function" && typeof (window as any).runDemoQA === "function",
  );

  const qa = await page.evaluate(async () => {
    await (window as any).runDemoFull({ speed: "instant" });
    return (window as any).runDemoQA();
  });

  expect(qa.failed).toBe(0);
  expect(qa.total).toBe(17);
  expect(qa.contract.passed).toBe(true);
  expect(qa.contract.total).toBeGreaterThanOrEqual(20);
  expect(qa.contract.invalid).toEqual([]);
  expect(qa.contract.missingFamilies).toEqual([]);
  expect(qa.contract.rendererMapped).toBe(true);
  expect(qa.contract.evaluatorMapped).toBe(true);
  expect(qa.contract.liveAssist.liveCueCount).toBeGreaterThanOrEqual(1);
  expect(qa.contract.liveAssist.meetingBriefCount).toBe(1);
  expect(qa.riskAttack.passed).toBe(7);
  expect(qa.riskAttack.failed).toBe(0);
  expect(qa.riskAttack.total).toBe(7);
  expect(qa.riskAttack.observedRisks).toEqual([]);
  expect(Object.keys(qa.contract.byL1).sort()).toEqual([
    "agent_trace",
    "generated_artifact",
    "graph_memory",
    "operational_cache",
    "private_memory",
    "public_knowledge",
    "retrieval_context",
    "ui_renderable",
  ]);
});

test("home-v5 demo autoplay is gated to /demo_ver routes", async ({ page }) => {
  const fileUrl = `${pathToFileURL(resolve("public/proto/home-v5.html")).toString()}?demo=1#demo`;

  await page.goto(fileUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof (window as any).shouldRunScratchNodeFullDemo === "function" &&
      typeof (window as any).isScratchNodeDemoRoute === "function",
  );

  await page.waitForTimeout(1_500);

  const state = await page.evaluate(() => ({
    shouldRunHere: (window as any).shouldRunScratchNodeFullDemo(),
    logLength: ((window as any)._demo_log ?? []).length,
    feedText: document.getElementById("feed")?.textContent ?? "",
    routes: {
      root: (window as any).isScratchNodeDemoRoute("/"),
      event: (window as any).isScratchNodeDemoRoute("/e/ai-infra-summit-2026"),
      directProto: (window as any).isScratchNodeDemoRoute("/proto/home-v5.html"),
      demoRoot: (window as any).isScratchNodeDemoRoute("/demo_ver"),
      demoNumber: (window as any).isScratchNodeDemoRoute("/demo_ver1"),
      demoSlug: (window as any).isScratchNodeDemoRoute("/demo_ver_v5"),
      demoSlash: (window as any).isScratchNodeDemoRoute("/demo_ver/v5"),
      nearMiss: (window as any).isScratchNodeDemoRoute("/demo_version"),
    },
  }));

  expect(state.shouldRunHere).toBe(false);
  expect(state.logLength).toBe(0);
  expect(state.feedText).not.toContain("Maya from VoiceLayer");
  expect(state.routes).toEqual({
    root: false,
    event: false,
    directProto: false,
    demoRoot: true,
    demoNumber: true,
    demoSlug: true,
    demoSlash: true,
    nearMiss: false,
  });
});
