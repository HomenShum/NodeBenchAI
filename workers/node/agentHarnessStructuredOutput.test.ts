/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { generatePlan, synthesizeResults, type HarnessExecution } from "./agentHarness.js";

const originalGeminiKey = process.env.GEMINI_API_KEY;
const originalAllowFallback = process.env.NODEBENCH_ALLOW_EXTERNAL_LLM_FALLBACK_IN_TESTS;

function mockGeminiResponse(text: string) {
  return {
    ok: true,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text }],
          },
        },
      ],
    }),
  } as Response;
}

describe("agentHarness structured output provider payloads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalGeminiKey == null) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiKey;
    }
    if (originalAllowFallback == null) {
      delete process.env.NODEBENCH_ALLOW_EXTERNAL_LLM_FALLBACK_IN_TESTS;
    } else {
      process.env.NODEBENCH_ALLOW_EXTERNAL_LLM_FALLBACK_IN_TESTS = originalAllowFallback;
    }
  });

  it("asks Gemini for a structured plan with responseJsonSchema", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.NODEBENCH_ALLOW_EXTERNAL_LLM_FALLBACK_IN_TESTS = "1";
    const fetchMock = vi.fn(async () => mockGeminiResponse(JSON.stringify({
      objective: "Build an event capture plan",
      steps: [
        {
          id: "s1",
          stepIndex: 0,
          groupId: "discover",
          toolName: "web_search",
          args: { query: "Orbital Labs", maxResults: 3 },
          purpose: "Find public context",
          dependsOn: [],
          injectPriorResults: [],
          model: "",
          parallel: false,
          acceptsSteering: false,
          complexity: "",
        },
      ],
      synthesisPrompt: "Summarize the event context.",
    })));
    vi.stubGlobal("fetch", fetchMock);

    await generatePlan(
      "Met Alex from Orbital Labs at Ship Demo Day",
      "pre_delegation",
      ["Orbital Labs"],
      "investor",
      async () => {
        throw new Error("call_llm unavailable in this test");
      },
    );

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema.required).toContain("objective");
    expect(body.generationConfig.responseJsonSchema.properties.steps.items.required).toContain("toolName");
  });

  it("asks Gemini for a structured synthesis packet with responseJsonSchema", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.NODEBENCH_ALLOW_EXTERNAL_LLM_FALLBACK_IN_TESTS = "1";
    const fetchMock = vi.fn(async () => mockGeminiResponse(JSON.stringify({
      entityName: "Orbital Labs",
      answer: "Orbital Labs should be captured as an event lead with healthcare design partner follow-up.",
      confidence: 86,
      keyMetrics: [],
      whyThisTeam: {
        founderCredibility: "Founder credibility needs verification.",
        trustSignals: [],
        visionMagnitude: "Company-scale if voice-agent eval infra becomes a category.",
        reinventionCapacity: "Needs more evidence.",
        hiddenRequirements: ["Pilot criteria", "Evidence-backed customer pull"],
      },
      signals: [],
      changes: [],
      risks: [],
      comparables: [],
      nextActions: [{ action: "Attach capture to active event session.", impact: "high" }],
      nextQuestions: ["What healthcare pilot criteria would qualify this lead?"],
      sources: [],
    })));
    vi.stubGlobal("fetch", fetchMock);

    const execution: HarnessExecution = {
      plan: {
        objective: "Capture event lead",
        classification: "pre_delegation",
        entityTargets: ["Orbital Labs"],
        steps: [],
        synthesisPrompt: "Build the event capture ack.",
      },
      stepResults: [
        {
          stepId: "s1",
          toolName: "web_search",
          result: { answer: "Orbital Labs builds voice-agent eval infra for healthcare design partners." },
          success: true,
          durationMs: 12,
        },
      ],
      totalDurationMs: 12,
      totalCostUsd: 0,
      adaptations: 0,
    };

    await synthesizeResults(
      execution,
      "Met Alex from Orbital Labs. Voice-agent eval infra. Wants healthcare design partners.",
      "investor",
      async () => {
        throw new Error("call_llm unavailable in this test");
      },
    );

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema.required).toContain("signals");
    expect(body.generationConfig.responseJsonSchema.properties.whyThisTeam.required).toContain("trustSignals");
  });
});
