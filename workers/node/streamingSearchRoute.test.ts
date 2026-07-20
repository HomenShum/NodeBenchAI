import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  runSearchPipelineMock,
  classifyMock,
  createInitialPipelineStateMock,
  stateToResultPacketMock,
  createEnvelopeFromPipelineStateMock,
  trajectoryFromPipelineStateMock,
  saveSearchTrajectoryMock,
  detectReplayCandidateMock,
  saveReportMock,
  createNudgeMock,
  decideHarnessRoutingMock,
} = vi.hoisted(() => ({
  runSearchPipelineMock: vi.fn(),
  classifyMock: vi.fn(),
  createInitialPipelineStateMock: vi.fn(),
  stateToResultPacketMock: vi.fn(),
  createEnvelopeFromPipelineStateMock: vi.fn(),
  trajectoryFromPipelineStateMock: vi.fn(),
  saveSearchTrajectoryMock: vi.fn(),
  detectReplayCandidateMock: vi.fn(),
  saveReportMock: vi.fn(),
  createNudgeMock: vi.fn(),
  decideHarnessRoutingMock: vi.fn(),
}));

vi.mock("./pipeline/searchPipeline.js", () => ({
  classify: classifyMock,
  createInitialPipelineState: createInitialPipelineStateMock,
  runSearchPipeline: runSearchPipelineMock,
  stateToResultPacket: stateToResultPacketMock,
}));

vi.mock("./lib/workflowEnvelope.js", () => ({
  createEnvelopeFromPipelineState: createEnvelopeFromPipelineStateMock,
}));

vi.mock("./lib/trajectoryStore.js", () => ({
  trajectoryFromPipelineState: trajectoryFromPipelineStateMock,
  saveSearchTrajectory: saveSearchTrajectoryMock,
}));

vi.mock("./lib/replayDetector.js", () => ({
  detectReplayCandidate: detectReplayCandidateMock,
}));

vi.mock("./lib/canonicalModels.js", () => ({
  saveReport: saveReportMock,
  createNudge: createNudgeMock,
}));

vi.mock("./harnessRuntime.js", () => ({
  decideHarnessRouting: decideHarnessRoutingMock,
}));

import { createStreamingSearchRouter } from "./routes/streamingSearch.js";

describe("createStreamingSearchRouter", () => {
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl = "";

  beforeAll(async () => {
    const app = express();
    app.use(createStreamingSearchRouter());
    server = await new Promise<ReturnType<express.Express["listen"]>>((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind streaming search route test server");
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
  });

  beforeEach(() => {
    vi.clearAllMocks();
    createInitialPipelineStateMock.mockImplementation((query: string, lens: string, contextHint?: string) => ({
      query,
      lens,
      contextHint,
    }));
    classifyMock.mockReturnValue({
      classification: "plan_proposal",
      entity: "Anthropic",
    });
    decideHarnessRoutingMock.mockReturnValue({
      routingMode: "advisor",
      routingReason: "Planning requests need deeper upfront reasoning.",
      routingSource: "automatic",
      plannerModel: "gemini-3.1-pro-preview",
      executionModel: "gemini-3.1-flash-preview",
      reasoningEffort: "high",
    });
    runSearchPipelineMock.mockResolvedValue({
      entityName: "Anthropic",
      classification: "company_search",
      answer: "Anthropic raised more capital and expanded enterprise distribution.",
      confidence: 84,
      searchSources: [
        {
          name: "Anthropic",
          url: "https://www.anthropic.com",
          snippet: "Anthropic homepage",
          domain: "anthropic.com",
        },
      ],
      risks: [],
      trace: [],
    });
    stateToResultPacketMock.mockReturnValue({
      answer: "Anthropic raised more capital and expanded enterprise distribution.",
      entityName: "Anthropic",
      sourceRefs: [],
    });
    createEnvelopeFromPipelineStateMock.mockReturnValue({
      transport: {
        envelopeId: "env_test_1",
        envelopeType: "research_packet",
      },
    });
    trajectoryFromPipelineStateMock.mockReturnValue({ id: "traj_1" });
    detectReplayCandidateMock.mockReturnValue(null);
    saveReportMock.mockReturnValue("report_1");
  });

  it("emits routing metadata on the plan event and forwards contextHint into the pipeline", async () => {
    const response = await fetch(
      `${baseUrl}/stream?query=${encodeURIComponent("Go deeper on Anthropic enterprise strategy")}&lens=investor&contextHint=${encodeURIComponent("investor | concise | citation heavy")}`,
      {
        headers: { Accept: "text/event-stream" },
      },
    );

    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain('event: plan');
    expect(text).toContain('"routingMode":"advisor"');
    expect(text).toContain('"routingReason":"Planning requests need deeper upfront reasoning."');
    expect(text).toContain('"plannerModel":"gemini-3.1-pro-preview"');
    expect(text).toContain('"executionModel":"gemini-3.1-flash-preview"');
    expect(text).toContain('event: complete');
    expect(createInitialPipelineStateMock).toHaveBeenCalledWith(
      "Go deeper on Anthropic enterprise strategy",
      "investor",
      "investor | concise | citation heavy",
    );
    expect(runSearchPipelineMock).toHaveBeenCalledWith(
      "Go deeper on Anthropic enterprise strategy",
      "investor",
      expect.any(Function),
      "investor | concise | citation heavy",
    );
  });

  it("accepts large packets over POST so pasted diligence notes do not rely on URL length", async () => {
    const response = await fetch(`${baseUrl}/stream`, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "Recruiter packet\nhttps://cliffside.ventures/\nhttps://www.linkedin.com/in/xudirk/\nCompare this role to my background.",
        lens: "founder",
        contextHint: "founder | bilingual | prep mode",
      }),
    });

    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("event: plan");
    expect(text).toContain("event: complete");
    expect(runSearchPipelineMock).toHaveBeenCalledWith(
      "Recruiter packet\nhttps://cliffside.ventures/\nhttps://www.linkedin.com/in/xudirk/\nCompare this role to my background.",
      "founder",
      expect.any(Function),
      "founder | bilingual | prep mode",
    );
  });
});
