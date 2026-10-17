import { describe, expect, it, vi } from "vitest";
import { chooseNodeBenchRuntimeRoute } from "./runtimeRouting";
import { FREE_LANE_MODEL, UnknownModelError, isFreeModel } from "./mcp_tools/models/modelResolver";
import type { UltraLongChatWorkingSet } from "../../../../shared/ultraLongChatContext";

function buildWorkingSet(
  overrides: Partial<UltraLongChatWorkingSet> = {},
): UltraLongChatWorkingSet {
  return {
    compactionMode: "deterministic_compaction_first",
    summary: "Compacted session summary",
    priorityLedger: ["Equity upside matters more than base."],
    activeAngles: ["entity_profile"],
    angleCapsules: [],
    jitSlices: [],
    hotWindow: [],
    contextRotRisk: "low",
    messagesCompacted: 8,
    builtAt: Date.now(),
    ...overrides,
  };
}

describe("chooseNodeBenchRuntimeRoute", () => {
  it("routes explicit orchestration prompts to the advisor lane", () => {
    const route = chooseNodeBenchRuntimeRoute({
      prompt: "Plan and orchestrate a deep research run on Stripe.",
      useCoordinator: true,
      availableModels: [
        "kimi-k2.6",
        "gemini-3.1-pro-preview",
        "gemini-3-flash-preview",
        "gemini-3.1-flash-lite-preview",
        "gpt-5.4",
        "gpt-5.4-mini",
        "minimax-m2.7",
      ],
      workingSet: buildWorkingSet({
        activeAngles: ["entity_profile", "public_signals", "people_graph"],
        messagesCompacted: 10,
      }),
    });

    expect(route.profile).toBe("advisor");
    expect(route.model).toBe("kimi-k2.6");
    expect(route.reason).toBe("explicit_advisor");
  });

  it("routes anonymous turns to the cheapest Gemini 3 executor lane", () => {
    const route = chooseNodeBenchRuntimeRoute({
      prompt: "Summarize this company.",
      isAnonymous: true,
      availableModels: [
        "gemini-3.1-flash-lite-preview",
        "gemini-3-flash-preview",
        "minimax-m2.7",
        "gpt-5.4-mini",
      ],
      workingSet: buildWorkingSet(),
    });

    expect(route.profile).toBe("executor");
    expect(route.model).toBe("gemini-3.1-flash-lite-preview");
    expect(route.reason).toBe("anonymous_fast_executor");
  });

  it("routes structured extraction turns to Gemini 3.1 Flash-Lite first", () => {
    const route = chooseNodeBenchRuntimeRoute({
      prompt: "Extract this into JSON fields for the report schema.",
      availableModels: [
        "gemini-3.1-flash-lite-preview",
        "gemini-3-flash-preview",
        "minimax-m2.7",
        "gpt-5.4-mini",
      ],
      workingSet: buildWorkingSet({
        activeAngles: ["entity_profile", "document_discovery"],
        jitSlices: [
          {
            label: "cached profile",
            summary: "Entity cache present",
            source: "entity_cache",
            angleIds: ["entity_profile"],
          },
        ],
      }),
    });

    expect(route.profile).toBe("executor");
    expect(route.model).toBe("gemini-3.1-flash-lite-preview");
    expect(route.reason).toBe("structured_executor");
    expect(route.fallbackModels).toContain("minimax-m2.7");
  });

  it("routes tool-heavy execution to Gemini 3 Flash before fallback executors", () => {
    const route = chooseNodeBenchRuntimeRoute({
      prompt: "Use the browser tool and patch the script, then extract the result.",
      hasOpenRouter: true,
      availableModels: [
        "gemini-3-flash-preview",
        "gemini-3.1-flash-lite-preview",
        "minimax-m2.7",
        "gpt-5.4-mini",
      ],
      workingSet: buildWorkingSet({
        activeAngles: ["entity_profile", "document_discovery"],
        jitSlices: [
          {
            label: "tool context",
            summary: "Browser path needed",
            source: "known_state",
            angleIds: ["document_discovery"],
          },
        ],
      }),
    });

    expect(route.profile).toBe("executor");
    expect(route.model).toBe("gemini-3-flash-preview");
    expect(route.reason).toBe("tool_heavy_executor");
    expect(route.fallbackModels.slice(0, 3)).toEqual([
      "gemini-3.1-flash-lite-preview",
      "minimax-m2.7",
      "gpt-5.4-mini",
    ]);
  });

  it("escalates heavily compacted multi-angle sessions to the background lane", () => {
    const route = chooseNodeBenchRuntimeRoute({
      prompt: "Give me the final decision brief across all these threads.",
      availableModels: [
        "gemini-3.1-pro-preview",
        "gemini-3-flash-preview",
        "kimi-k2.6",
        "gpt-5.4",
      ],
      workingSet: buildWorkingSet({
        activeAngles: [
          "entity_profile",
          "public_signals",
          "people_graph",
          "competitive_intelligence",
        ],
        jitSlices: [
          {
            label: "pulse",
            summary: "Fresh pulse",
            source: "pulse",
            angleIds: ["public_signals"],
          },
          {
            label: "user priorities",
            summary: "Equity, ramp, long-term upside",
            source: "user_context",
            angleIds: ["people_graph", "financial_health"],
          },
        ],
        contextRotRisk: "high",
        messagesCompacted: 28,
      }),
    });

    expect(route.profile).toBe("background");
    expect(route.model).toBe("gemini-3.1-pro-preview");
    expect(route.reason).toBe("background_large_context");
  });

  it("falls back to an available non-Gemini executor when Google is unavailable", () => {
    const route = chooseNodeBenchRuntimeRoute({
      prompt: "Extract this into JSON fields for the report schema.",
      hasOpenRouter: true,
      availableModels: ["minimax-m2.7", "gpt-5.4-mini"],
      workingSet: buildWorkingSet(),
    });

    expect(route.profile).toBe("executor");
    expect(route.model).toBe("minimax-m2.7");
    expect(route.fallbackModels).toEqual(["gpt-5.4-mini"]);
  });

  it("does not let advisor-grade requested models override the fast executor default", () => {
    const route = chooseNodeBenchRuntimeRoute({
      prompt: "Give me a quick summary of DISCO.",
      requestedModel: "kimi-k2.6",
      hasOpenRouter: true,
      availableModels: [
        "gemini-3.1-flash-lite-preview",
        "gemini-3-flash-preview",
        "minimax-m2.7",
        "gpt-5.4-mini",
        "kimi-k2.6",
      ],
      workingSet: buildWorkingSet({
        activeAngles: ["entity_profile"],
        jitSlices: [],
      }),
    });

    expect(route.profile).toBe("executor");
    expect(route.reason).toBe("cheap_executor_default");
    expect(route.model).toBe("gemini-3.1-flash-lite-preview");
    expect(route.fallbackModels).toContain("kimi-k2.6");
  });
});

// A request for the free lane, or for a model that does not exist, must not become a paid
// request (SPEC-v9 A.0.10). Persona: a user who picked the free model in the selector.
describe("chooseNodeBenchRuntimeRoute keeps cost class and fails closed", () => {
  const paidAvailable = [
    "kimi-k2.6",
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview",
    "gpt-5.4",
    "gpt-5.4-mini",
    "minimax-m2.7",
  ] as never;
  const ask = (requestedModel: string, prompt: string, availableModels: never | null = paidAvailable) =>
    chooseNodeBenchRuntimeRoute({ prompt, requestedModel, useCoordinator: true, availableModels, workingSet: buildWorkingSet() });

  it("an explicit free request stays on the free lane in the advisor, executor and background routes", () => {
    const advisor = ask(FREE_LANE_MODEL, "Plan and orchestrate a deep research run on Stripe.");
    expect(advisor.model).toBe(FREE_LANE_MODEL);
    expect(advisor.fallbackModels.every((id) => isFreeModel(id))).toBe(true);

    const executor = ask(FREE_LANE_MODEL, "Summarize this company.");
    expect(executor.model).toBe(FREE_LANE_MODEL);
    expect(executor.fallbackModels.every((id) => isFreeModel(id))).toBe(true);

    const background = chooseNodeBenchRuntimeRoute({
      prompt: "Continue.",
      requestedModel: FREE_LANE_MODEL,
      availableModels: paidAvailable,
      workingSet: buildWorkingSet({ contextRotRisk: "high" }),
    });
    expect(background.model).toBe(FREE_LANE_MODEL);
    expect(background.fallbackModels.every((id) => isFreeModel(id))).toBe(true);
  });

  it("an explicit free request stays free on every executor branch a prompt keyword can reach", () => {
    // Persona: a user who picked the free model, then typed "patch this script" or "return JSON".
    // Before: these branches never read requestedModel and sent the turn to a paid Gemini model.
    const cases: Array<[string, string, Parameters<typeof chooseNodeBenchRuntimeRoute>[0]]> = [
      ["tool_heavy_executor", "Use the browser tool to patch this script", { prompt: "", workingSet: buildWorkingSet() }],
      ["structured_executor", "Return JSON with these fields", { prompt: "", workingSet: buildWorkingSet() }],
      [
        "context_rot_guard",
        "Continue the analysis.",
        { prompt: "", workingSet: buildWorkingSet({ contextRotRisk: "medium", activeAngles: ["entity_profile", "public_signals", "funding_intelligence"] }) },
      ],
      [
        "large_context_executor",
        "Continue the analysis.",
        { prompt: "", workingSet: buildWorkingSet({ activeAngles: ["entity_profile", "public_signals"] }) },
      ],
      ["anonymous_fast_executor", "Summarize this company.", { prompt: "", isAnonymous: true, workingSet: buildWorkingSet() }],
    ];
    for (const [reason, prompt, base] of cases) {
      const route = chooseNodeBenchRuntimeRoute({
        ...base,
        prompt,
        requestedModel: FREE_LANE_MODEL,
        useCoordinator: false,
        availableModels: paidAvailable,
      });
      expect(route.reason, reason).toBe(reason);
      expect(route.model, reason).toBe(FREE_LANE_MODEL);
      expect(route.fallbackModels.every((id) => isFreeModel(id)), reason).toBe(true);
    }
  });

  it("without a free request those branches keep their paid defaults", () => {
    const route = chooseNodeBenchRuntimeRoute({
      prompt: "Use the browser tool to patch this script",
      requestedModel: "gpt-5.4-mini",
      availableModels: paidAvailable,
      workingSet: buildWorkingSet(),
    });
    expect(route.reason).toBe("tool_heavy_executor");
    expect(route.model).toBe("gemini-3-flash-preview");
  });

  it("a free primary that is not in the available list does not fall over to a paid model", () => {
    // availableModels contains only paid ids: the old chooser would pick the first paid candidate.
    const route = ask(FREE_LANE_MODEL, "Plan and orchestrate a deep research run on Stripe.");
    expect(isFreeModel(route.model)).toBe(true);
  });

  it("an unknown requested id throws on every route instead of taking a paid default", () => {
    for (const prompt of [
      "Plan and orchestrate a deep research run on Stripe.", // advisor
      "Summarize this company.", // executor (reaches resolveRequestedExecutorModel)
    ]) {
      expect(() => ask("gpt-9-ultra", prompt), prompt).toThrow(UnknownModelError);
    }
  });

  it("a free-looking unknown id takes the free lane on the executor route", () => {
    expect(ask("some-model-free", "Summarize this company.").model).toBe(FREE_LANE_MODEL);
  });
});
