import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL,
  getLanguageModel,
  resolveModelAlias,
  resolvePipelineModelSelection,
} from "./modelResolver";

describe("pipeline model route resolution", () => {
  it("maps NodeBench auto routes to approved runtime aliases", () => {
    expect(resolvePipelineModelSelection("nodebench:auto-balanced")).toMatchObject({
      requestedModelId: "nodebench:auto-balanced",
      resolvedModelId: "kimi-k2.6",
      routeTier: "balanced",
      isFreeRoute: false,
    });
    expect(resolvePipelineModelSelection("nodebench:auto-free")).toMatchObject({
      resolvedModelId: "laguna-s-2.1-free",
      routeTier: "free",
      isFreeRoute: true,
    });
  });

  it("accepts Kilo-style route aliases and old provider-prefixed values", () => {
    expect(resolvePipelineModelSelection("kilo-auto/free").resolvedModelId).toBe(
      "laguna-s-2.1-free",
    );
    expect(resolvePipelineModelSelection("kilo-auto/public-research")).toMatchObject({
      resolvedModelId: "glm-4.7-flash",
      routeTier: "balanced",
      isFreeRoute: false,
    });
    expect(resolvePipelineModelSelection("anthropic:claude-haiku-4.5").resolvedModelId).toBe(
      "claude-haiku-4.5",
    );
    expect(resolvePipelineModelSelection("openai:gpt-4o-mini").resolvedModelId).toBe(
      "gpt-5.4-mini",
    );
  });

  it("keeps the base approved model alias resolver intact", () => {
    expect(resolveModelAlias("gpt-4o-mini")).toBe("gpt-5.4-mini");
    expect(resolveModelAlias("poolside/laguna-s-2.1:free")).toBe("laguna-s-2.1-free");
  });
});

describe("a missing provider key must not break Convex module analysis", () => {
  // Convex analyses every backend module on every push, and
  // domains/agents/core/coordinatorAgent.ts builds DEFAULT_MODEL ("kimi-k2.6",
  // an OpenRouter model) at module scope. When buildLanguageModel threw for an
  // unset OPENROUTER_API_KEY, `convex dev` failed the ENTIRE push with
  // `InvalidModules: Failed to analyze domains/agents/digestAgent.js`, so a
  // reader with only a Gemini key got no backend at all. Construction must
  // succeed; the call must still fail.
  const savedKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedKey;
  });

  it("constructs the default OpenRouter model with no key, and fails only when called", async () => {
    // `LanguageModel` is `string | LanguageModelV2`; the object branch is the
    // one under test, so read it through one local cast rather than four.
    const model = getLanguageModel(DEFAULT_MODEL) as any;
    expect(model.modelId).toBe(DEFAULT_MODEL);
    expect(model.provider).toBe("unconfigured");
    await expect(model.doGenerate({})).rejects.toThrow(
      /OPENROUTER_API_KEY not configured/,
    );
    await expect(model.doStream({})).rejects.toThrow(
      /OPENROUTER_API_KEY not configured/,
    );
  });
});
