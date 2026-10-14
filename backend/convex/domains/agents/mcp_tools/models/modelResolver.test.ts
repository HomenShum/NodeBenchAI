import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APPROVED_MODELS,
  DEFAULT_MODEL,
  FREE_LANE_MODEL,
  MODEL_SPECS,
  MODEL_PRIORITY_ORDER,
  UnknownModelError,
  assertKnownPipelineModel,
  executeWithModelFallback,
  getFallbackChain,
  getLanguageModel,
  getLanguageModelWithFallback,
  getLanguageModelSafe,
  getPaidFallbackCount,
  isApprovedModel,
  isFreeModel,
  normalizeModelInput,
  normalizeNodeBenchRuntimeModel,
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
    // Was laguna-s-2.1-free: that lane expires on OpenRouter 2026-10-31, so auto-free
    // resolves to FREE_LANE_MODEL (SPEC-v9 A.2.10 PR 1; NodeVideo's measured pick).
    expect(resolvePipelineModelSelection("nodebench:auto-free")).toMatchObject({
      resolvedModelId: FREE_LANE_MODEL,
      routeTier: "free",
      isFreeRoute: true,
    });
  });

  it("accepts Kilo-style route aliases and old provider-prefixed values", () => {
    expect(resolvePipelineModelSelection("kilo-auto/free").resolvedModelId).toBe(FREE_LANE_MODEL);
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

// ---------------------------------------------------------------------------
// Free lane registration and fail-closed resolution (SPEC-v9 A.0.10, A.2.10 PR 1)
// ---------------------------------------------------------------------------

const FREE_LANE_WIRE_ID = "nvidia/nemotron-3-super-120b-a12b:free";

describe("free lane registration (Codex v3 N2)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-not-real");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("registers FREE_LANE_MODEL as an approved, zero-priced alias", () => {
    expect(isApprovedModel(FREE_LANE_MODEL)).toBe(true);
    expect(APPROVED_MODELS).toContain(FREE_LANE_MODEL);
    expect(isFreeModel(FREE_LANE_MODEL)).toBe(true);
    expect(MODEL_SPECS[FREE_LANE_MODEL]).toMatchObject({
      provider: "openrouter",
      sdkId: FREE_LANE_WIRE_ID,
      pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    });
  });

  it("resolves the OpenRouter wire id to the typed alias", () => {
    expect(resolveModelAlias(FREE_LANE_WIRE_ID)).toBe(FREE_LANE_MODEL);
  });

  it("builds an OpenRouter model whose modelId is the wire string", () => {
    const model = getLanguageModel(FREE_LANE_MODEL) as { modelId: string };
    expect(model.modelId).toBe(FREE_LANE_WIRE_ID);
  });
});

describe("unknown model ids fail closed", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-not-real");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends an unknown free-looking alias to the free lane, never a paid id", () => {
    for (const input of ["retired-model-free", "someone/new-model:free", "auto-free", "openrouter/free", "kilo-auto/free"]) {
      const model = getLanguageModelSafe(input) as { modelId: string };
      expect(model.modelId).toBe(FREE_LANE_WIRE_ID);
      expect(normalizeModelInput(input)).toBe(FREE_LANE_MODEL);
    }
  });

  it("throws for an unknown paid alias instead of using DEFAULT_MODEL", () => {
    expect(() => getLanguageModelSafe("gpt-9-ultra")).toThrow(UnknownModelError);
    expect(() => normalizeModelInput("claude-opus-9")).toThrow(UnknownModelError);
    // 'free' only counts as a suffix; it must not be a substring loophole
    expect(() => getLanguageModelSafe("freeloader-pro")).toThrow(UnknownModelError);
  });

  it("keeps empty input on the default and known aliases on themselves", () => {
    expect(normalizeModelInput(undefined)).toBe(DEFAULT_MODEL);
    expect(normalizeModelInput("")).toBe(DEFAULT_MODEL);
    expect(normalizeModelInput("gpt-4o-mini")).toBe("gpt-5.4-mini");
  });

  it("allowPaidFallback falls back to DEFAULT_MODEL and is counted", () => {
    const before = getPaidFallbackCount();
    const model = getLanguageModelSafe("gpt-9-ultra", { allowPaidFallback: true }) as { modelId: string };
    expect(model.modelId).toBe(MODEL_SPECS[DEFAULT_MODEL].sdkId);
    expect(getPaidFallbackCount()).toBe(before + 1);
    expect(normalizeModelInput("gpt-9-ultra", { allowPaidFallback: true })).toBe(DEFAULT_MODEL);
    expect(getPaidFallbackCount()).toBe(before + 2);
    // a known alias does not touch the counter
    getLanguageModelSafe("gpt-5.4", { allowPaidFallback: true });
    expect(getPaidFallbackCount()).toBe(before + 2);
  });

  it("resolves wikiDreamingGraph's provider-prefixed strings instead of rejecting them", () => {
    // They used to be unknown and silently ran on DEFAULT_MODEL; the strings are also persisted.
    expect(resolveModelAlias("google:models/gemini-3-flash-preview")).toBe("gemini-3-flash-preview");
    expect(resolveModelAlias("google:models/gemini-3.1-pro-preview")).toBe("gemini-3.1-pro-preview");
  });

  it("allowPaidFallback must be exactly true", () => {
    expect(() => getLanguageModelSafe("gpt-9-ultra", { allowPaidFallback: undefined })).toThrow(UnknownModelError);
    expect(() => getLanguageModelSafe("gpt-9-ultra", {} as never)).toThrow(UnknownModelError);
  });

  it("resolvePipelineModelSelection throws for unknown ids and keeps free ids free", () => {
    expect(() => resolvePipelineModelSelection("not-a-model")).toThrow(UnknownModelError);
    expect(() => resolvePipelineModelSelection("openai:gpt-9")).toThrow(UnknownModelError);
    expect(resolvePipelineModelSelection("x:free")).toMatchObject({
      resolvedModelId: FREE_LANE_MODEL,
      isFreeRoute: true,
      routeTier: "free",
      usedDefault: false,
    });
    // usedDefault is true only for empty input
    expect(resolvePipelineModelSelection("")).toMatchObject({ resolvedModelId: DEFAULT_MODEL, usedDefault: true });
    expect(resolvePipelineModelSelection(undefined).usedDefault).toBe(true);
    expect(resolvePipelineModelSelection("gpt-5.4").usedDefault).toBe(false);
  });

  it("assertKnownPipelineModel applies the same rules at the launch boundary", () => {
    expect(() => assertKnownPipelineModel("not-a-model")).toThrow(UnknownModelError);
    expect(() => assertKnownPipelineModel(undefined)).not.toThrow();
    expect(() => assertKnownPipelineModel("nodebench:auto-balanced")).not.toThrow();
    expect(() => assertKnownPipelineModel("x:free")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// A free request never becomes a paid one (SPEC-v9 A.0.10; PR #662 review round 1)
// ---------------------------------------------------------------------------

describe("fallback helpers keep a free request on free models", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-not-real");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("every free id in MODEL_PRIORITY_ORDER sits after every paid id, so a chain from a free id is all free", () => {
    const firstFree = MODEL_PRIORITY_ORDER.findIndex((id) => isFreeModel(id));
    expect(firstFree).toBeGreaterThan(0);
    expect(MODEL_PRIORITY_ORDER.slice(firstFree).every((id) => isFreeModel(id))).toBe(true);
    // FREE_LANE_MODEL heads the free segment: it is listed, and nothing paid follows it.
    expect(MODEL_PRIORITY_ORDER[firstFree]).toBe(FREE_LANE_MODEL);
  });

  it("executeWithModelFallback from FREE_LANE_MODEL never reaches a paid model, even when every free model fails", async () => {
    // Before: FREE_LANE_MODEL was not in the order, so an unlisted start model restarted at
    // index 0 (kimi-k2.6, $0.75/$3.5 per M tokens) and reported isFree=false.
    const tried: string[] = [];
    const first = await executeWithModelFallback(async (_m, id) => {
      tried.push(id);
      return id;
    }, { startModel: FREE_LANE_MODEL });
    expect(first.modelUsed).toBe(FREE_LANE_MODEL);
    expect(first.isFree).toBe(true);

    const triedAll: string[] = [];
    await expect(
      executeWithModelFallback(
        async (_m, id) => {
          triedAll.push(id);
          throw new Error("provider down");
        },
        { startModel: FREE_LANE_MODEL, maxRetries: 0 },
      ),
    ).rejects.toThrow(/All models in fallback chain failed/);
    expect(triedAll[0]).toBe(FREE_LANE_MODEL);
    expect(triedAll.length).toBeGreaterThan(1);
    expect(triedAll.every((id) => isFreeModel(id as never))).toBe(true);
  });

  it("starting on a legacy free id (laguna) stays free too", async () => {
    const r = await executeWithModelFallback(async (_m, id) => id, { startModel: "laguna-s-2.1-free" });
    expect(r.modelUsed).toBe("laguna-s-2.1-free");
    expect(r.isFree).toBe(true);
  });

  it("getFallbackChain and getLanguageModelWithFallback from FREE_LANE_MODEL are all free", () => {
    const chain = getFallbackChain(FREE_LANE_MODEL);
    expect(chain[0]).toBe(FREE_LANE_MODEL);
    expect(chain.every((id) => isFreeModel(id))).toBe(true);
    const wf = getLanguageModelWithFallback(FREE_LANE_MODEL);
    expect(wf.modelId).toBe(FREE_LANE_MODEL);
    expect(wf.isFree).toBe(true);
    expect(wf.fallbackChain.every((id) => isFreeModel(id))).toBe(true);
  });

  it("an approved model that is not in the priority order throws instead of restarting at the paid head", async () => {
    const unlisted = APPROVED_MODELS.find((id) => !MODEL_PRIORITY_ORDER.includes(id) && isFreeModel(id));
    expect(unlisted, "expected an approved free model outside the priority order").toBeDefined();
    await expect(executeWithModelFallback(async () => "x", { startModel: unlisted! })).rejects.toThrow(/not in MODEL_PRIORITY_ORDER/);
    expect(() => getFallbackChain(unlisted!)).toThrow(/not in MODEL_PRIORITY_ORDER/);
    expect(() => getLanguageModelWithFallback(unlisted!)).toThrow(/not in MODEL_PRIORITY_ORDER/);
  });
});

describe("normalizeNodeBenchRuntimeModel is the first resolver and fails closed", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const PROFILES = ["advisor", "executor", "background"] as const;

  it("throws for an unknown non-free id in every profile (was: kimi / gemini, all paid)", () => {
    for (const profile of PROFILES) {
      expect(() => normalizeNodeBenchRuntimeModel("gpt-9-ultra", profile), profile).toThrow(UnknownModelError);
    }
  });

  it("keeps a free-looking unknown id on the free lane in every profile", () => {
    for (const profile of PROFILES) {
      for (const input of ["x:free", "some-model-free", "auto-free"]) {
        expect(normalizeNodeBenchRuntimeModel(input, profile), `${profile}/${input}`).toBe(FREE_LANE_MODEL);
      }
    }
  });

  it("keeps a known free model free in every profile (FREE_LANE_MODEL, qwen3-coder-free, laguna)", () => {
    for (const profile of PROFILES) {
      for (const id of [FREE_LANE_MODEL, "qwen3-coder-free", "laguna-s-2.1-free"] as const) {
        expect(normalizeNodeBenchRuntimeModel(id, profile), `${profile}/${id}`).toBe(id);
      }
    }
  });

  it("empty input takes the profile default, and a known paid model outside the profile takes it too", () => {
    expect(normalizeNodeBenchRuntimeModel(undefined, "advisor")).toBe("kimi-k2.6");
    expect(normalizeNodeBenchRuntimeModel("", "executor")).toBe("gemini-3.1-flash-lite-preview");
    expect(normalizeNodeBenchRuntimeModel(null, "background")).toBe("gemini-3.1-pro-preview");
    expect(normalizeNodeBenchRuntimeModel("claude-opus-4.7", "executor")).toBe("gemini-3.1-flash-lite-preview");
  });

  it("allowPaidFallback turns an unknown id into the profile-checked DEFAULT_MODEL", () => {
    expect(normalizeNodeBenchRuntimeModel("gpt-9-ultra", "advisor", { allowPaidFallback: true })).toBe(DEFAULT_MODEL);
  });
});
