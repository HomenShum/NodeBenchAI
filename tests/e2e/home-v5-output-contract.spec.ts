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
