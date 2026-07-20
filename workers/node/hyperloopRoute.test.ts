/**
 * @vitest-environment node
 */

import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("createHyperloopRouter", () => {
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl = "";
  let tempDir = "";
  let evaluateTask: typeof import("../packages/mcp-local/src/sync/hyperloopEval.js").evaluateTask;
  let createHyperloopRouter: typeof import("./routes/hyperloop.js").createHyperloopRouter;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "nodebench-hyperloop-"));
    process.env.NODEBENCH_DATA_DIR = tempDir;
    vi.resetModules();

    ({ evaluateTask } = await import("../packages/mcp-local/src/sync/hyperloopEval.js"));
    ({ createHyperloopRouter } = await import("./routes/hyperloop.js"));

    evaluateTask({
      episodeId: "episode_hyperloop",
      query: "Anthropic competitive analysis",
      lens: "founder",
      entity: "Anthropic",
      classification: "company_search",
      totalSignals: 4,
      verifiedSignals: 3,
      totalClaims: 5,
      groundedClaims: 4,
      contradictionsCaught: 1,
      userEditDistance: 0.2,
      wasExported: false,
      wasDelegated: true,
      latencyMs: 4200,
      costUsd: 0.09,
      toolCallCount: 6,
      llmJudge: {
        verdict: "PASS",
        score: "6/7",
        failingCriteria: ["Needs stronger evidence coverage"],
        fixSuggestions: ["Add more grounded source citations"],
      },
    });

    const app = express();
    app.use("/hyperloop", createHyperloopRouter());

    server = await new Promise<ReturnType<express.Express["listen"]>>((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind HyperLoop test server");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // SQLite handles can remain briefly on Windows.
      }
    }
  });

  it("returns archive stats, recent evaluations, and improvement curves", async () => {
    const response = await fetch(`${baseUrl}/hyperloop/stats`);
    const json = await response.json() as any;

    expect(response.status).toBe(200);
    expect(json.archive.total).toBeGreaterThanOrEqual(1);
    expect(json.archive.byType.packet_template).toBeGreaterThanOrEqual(1);
    expect(json.recentEvals).toHaveLength(1);
    expect(json.recentEvals[0].query).toContain("Anthropic");
    expect(json.recentEvals[0].rubricVersion).toBe("hyperloop_v2");
    expect(Array.isArray(json.recentEvals[0].scoreComponents)).toBe(true);
    expect(Array.isArray(json.recentEvals[0].gates)).toBe(true);
    expect(json.recentEvals[0].llmJudge.verdict).toBe("PASS");
    expect(Array.isArray(json.improvementCurve.company_search)).toBe(true);
    expect(json.improvementCurve.company_search[0].sampleSize).toBeGreaterThanOrEqual(1);
  });
});
