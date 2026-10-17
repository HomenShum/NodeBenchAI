import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APPROVED_MODELS,
  DEFAULT_MODEL,
  FREE_LANE_MODEL,
  MODEL_SPECS,
  MODEL_PRIORITY_ORDER,
  UnknownModelError,
  assertKnownModelInput,
  assertKnownPipelineModel,
  executeWithModelFallback,
  getFallbackChain,
  getLanguageModel,
  getLanguageModelWithFallback,
  getLanguageModelSafe,
  getPaidFallbackCount,
  isApprovedModel,
  isFreeModel,
  normalizeFastAgentModel,
  normalizeModelInput,
  normalizeNodeBenchRuntimeModel,
  resolveModelAlias,
  resolvePipelineModelSelection,
} from "./modelResolver";
import { ANONYMOUS_FAST_AGENT_MODEL_ID } from "../../../../../../shared/llm/fastAgentRuntimeContract";
import { RefusedModelError, SPEC_BEDROCK_WIRE_IDS, SPEC_LIVE_FREE_WIRE_IDS, SPEC_NATIVE_WIRE_IDS, SPEC_OPENROUTER_WIRE_IDS, modelAliases, modelEquivalents, modelPricing } from "../../../../../../shared/llm/modelCatalog";

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

describe("an approved PAID model outside the priority order is tried first (SPEC-v9 D1, PR #662 round 7)", () => {
  // Persona: the public-research route resolves to glm-4.7-flash and a missing pi-ai key sends the run to
  // the AI-SDK fallback; a signed-in user posts args.model = "deepseek-r1" to pdfInsights. Before: both were
  // restarted at kimi-k2.6 (the pricier head), the requested model was never called and fallbacksUsed was 0.
  // Main did the same, but D1 says "a known id is never silently rerouted to another model", so the
  // requested id runs first and every later move is counted and reported through onFallback.
  const paidUnlisted = ["glm-4.7-flash", "deepseek-r1", "gemini-2.5-flash", "mistral-large", "claude-opus-4"];
  beforeEach(() => {
    // buildLanguageModel needs a key to construct the requested model and the fallbacks.
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-not-real");
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(paidUnlisted)("%s runs first with fallbacksUsed 0", async (id) => {
    expect(APPROVED_MODELS as readonly string[]).toContain(id);
    expect(MODEL_PRIORITY_ORDER as readonly string[]).not.toContain(id);
    expect(isFreeModel(id as never)).toBe(false);
    const r = await executeWithModelFallback(async (_m, used) => used, { startModel: id as never });
    expect(r.modelUsed).toBe(id);
    expect(r.fallbacksUsed).toBe(0);
  });

  it.each(paidUnlisted)("%s failing moves to the head of the order and counts the move", async (id) => {
    const tried: string[] = [];
    const moves: string[] = [];
    const r = await executeWithModelFallback(
      async (_m, used) => {
        tried.push(used);
        if (used === id) throw new Error("provider down");
        return used;
      },
      { startModel: id as never, maxRetries: 0, onFallback: (from, to) => moves.push(`${from}>${to}`) },
    );
    expect(tried).toEqual([id, MODEL_PRIORITY_ORDER[0]]);
    expect(r.modelUsed).toBe(MODEL_PRIORITY_ORDER[0]);
    expect(r.fallbacksUsed).toBe(1);
    expect(moves).toEqual([`${id}>${MODEL_PRIORITY_ORDER[0]}`]);
  });

  it.each(paidUnlisted)("%s leads the chains the other two helpers return", (id) => {
    expect(getFallbackChain(id as never)).toEqual([id, ...MODEL_PRIORITY_ORDER]);
    const wf = getLanguageModelWithFallback(id as never);
    expect(wf.modelId).toBe(id);
    expect(wf.fallbackChain).toEqual(MODEL_PRIORITY_ORDER);
  });

  it("a listed model still starts at its own place", async () => {
    const listed = MODEL_PRIORITY_ORDER[2];
    expect(getFallbackChain(listed)).toEqual(MODEL_PRIORITY_ORDER.slice(2));
    const r = await executeWithModelFallback(async (_m, used) => used, { startModel: listed });
    expect(r.modelUsed).toBe(listed);
    expect(r.fallbacksUsed).toBe(0);
  });
});

describe("the fallback helpers resolve an unvalidated start model first (A.0.10, PR #662 round 2)", () => {
  // pdfInsights.generatePDFInsights casts a user-supplied `args.model` to ApprovedModel. Persona: a
  // signed-in user posts a retired free alias, a typo, or the OpenRouter wire id of the free lane.
  // Before: priorityIndexOrThrow called isFreeModel on the raw string, so each one died with
  // "Cannot read properties of undefined (reading 'pricing')" before the callback ran.
  const FREE_WIRE = MODEL_SPECS[FREE_LANE_MODEL].sdkId;
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-not-real");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(["x-free", "retired-model-free", "someone/new:free"])("free-looking unknown %s resolves to the free lane in all three helpers", async (id) => {
    const r = await executeWithModelFallback(async (_m, used) => used, { startModel: id as never });
    expect(r.modelUsed).toBe(FREE_LANE_MODEL);
    expect(r.isFree).toBe(true);
    const chain = getFallbackChain(id as never);
    expect(chain[0]).toBe(FREE_LANE_MODEL);
    expect(chain.every((m) => isFreeModel(m))).toBe(true);
    expect(getLanguageModelWithFallback(id as never).modelId).toBe(FREE_LANE_MODEL);
  });

  it("the registered free-lane wire id resolves through the alias table", async () => {
    expect(FREE_WIRE).toBe("nvidia/nemotron-3-super-120b-a12b:free");
    const r = await executeWithModelFallback(async (_m, used) => used, { startModel: FREE_WIRE as never });
    expect(r.modelUsed).toBe(FREE_LANE_MODEL);
    expect(getFallbackChain(FREE_WIRE as never)[0]).toBe(FREE_LANE_MODEL);
    expect(getLanguageModelWithFallback(FREE_WIRE as never).modelId).toBe(FREE_LANE_MODEL);
  });

  it("any other unknown id throws UnknownModelError before the callback runs", async () => {
    const fn = vi.fn(async () => "x");
    await expect(executeWithModelFallback(fn, { startModel: "not-a-model" as never })).rejects.toBeInstanceOf(UnknownModelError);
    expect(fn).not.toHaveBeenCalled();
    expect(() => getFallbackChain("not-a-model" as never)).toThrow(UnknownModelError);
    expect(() => getLanguageModelWithFallback("not-a-model" as never)).toThrow(UnknownModelError);
  });

  it("an omitted start model still means DEFAULT_MODEL", () => {
    expect(getLanguageModelWithFallback().modelId).toBe(DEFAULT_MODEL);
    expect(getFallbackChain()).toEqual(getFallbackChain(DEFAULT_MODEL));
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

// Persona: a signed-in user types "toString" into a model field. LEGACY_ALIASES is a plain object, so the
// inherited property used to resolve to a function and pass every boundary (A.0.10, PR #662 round 5).
describe("Object.prototype keys are not models", () => {
  const PROTOTYPE_KEYS = ["toString", "valueOf", "hasOwnProperty", "constructor", "__proto__", "isPrototypeOf", "toLocaleString"];

  it.each(PROTOTYPE_KEYS)("%s resolves to nothing and every entry point rejects it", (key) => {
    expect(resolveModelAlias(key)).toBeNull();
    expect(() => normalizeModelInput(key)).toThrow(UnknownModelError);
    expect(() => getLanguageModelSafe(key)).toThrow(UnknownModelError);
    expect(() => resolvePipelineModelSelection(key)).toThrow(UnknownModelError);
    expect(() => assertKnownPipelineModel(key)).toThrow(UnknownModelError);
  });
});

// Persona: a safety engineer asks for the content-safety classifier by its OpenRouter id. It is one of the
// 15 live `:free` ids SPEC-v9 section 1.2 lists, so Homen D1 makes it known: it must reach OpenRouter as
// that id, never come back as the general chat model nvidia/nemotron-3-super (PR #662 review round 6, P2).
describe("D1: the SPEC-v9 1.2 live :free ids are known and are never rerouted", () => {
  // Typed out here, not read from SPEC_LIVE_FREE_WIRE_IDS, so the set cannot drift from the spec unseen.
  const SPEC_1_2_FREE = [
    "apodex/apodex-1.1-mini:free", "dots-studio/dots-3-note-preview:free", "liquid/lfm-2.5-2.6b:free",
    "nvidia/nemotron-3.5-lightning:free", "thinkingmachines/inkling-small:free", "poolside/laguna-s-2.1:free",
    "thinkingmachines/inkling:free", "poolside/laguna-xs-2.1:free", "cohere/north-mini-code:free",
    "nvidia/nemotron-3.5-content-safety:free", "nvidia/nemotron-3-ultra-550b-a55b:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free", "nvidia/nemotron-3-super-120b-a12b:free",
  ];
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-not-real");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("the set is exactly the 15 ids of the spec", () => {
    expect([...SPEC_LIVE_FREE_WIRE_IDS].sort()).toEqual([...SPEC_1_2_FREE].sort());
  });

  it("getLanguageModelSafe sends every one unchanged on OpenRouter", () => {
    for (const id of SPEC_1_2_FREE) {
      const model = getLanguageModelSafe(id) as { modelId: string; provider?: string };
      expect(model.modelId, id).toBe(id);
      expect(String(model.provider ?? "")).toMatch(/openai|chat/);
    }
  });

  it("is case and whitespace tolerant, like the alias lookup", () => {
    expect((getLanguageModelSafe("  Google/Gemma-4-31B-IT:free ") as { modelId: string }).modelId).toBe("google/gemma-4-31b-it:free");
  });

  it("an entry point that returns an alias refuses the unregistered ones with a reason; it never returns another model", () => {
    for (const id of SPEC_1_2_FREE) {
      const registered = resolveModelAlias(id);
      for (const call of [
        () => normalizeModelInput(id),
        () => resolvePipelineModelSelection(id).resolvedModelId,
        () => resolvePipelineModelSelection(`openrouter:${id}`).resolvedModelId,
      ]) {
        if (registered) {
          expect(call(), id).toBe(registered); // nemotron-super and laguna s/xs are registered aliases
        } else {
          expect(call, id).toThrow(RefusedModelError);
        }
      }
      if (registered) expect(() => assertKnownPipelineModel(id), id).not.toThrow();
      else expect(() => assertKnownPipelineModel(id), id).toThrow(RefusedModelError);
    }
    expect(() => normalizeModelInput("nvidia/nemotron-3.5-content-safety:free")).toThrow(/known id, refused/);
  });

  it("an id that is merely free-looking still takes the free lane", () => {
    expect((getLanguageModelSafe("nvidia/nemotron-9-invented:free") as { modelId: string }).modelId).toBe(FREE_LANE_WIRE_ID);
  });
});

// The review's sub-note: the native ids D1 calls known were reported as "Unknown model".
describe("D1: SPEC-v9 1.2 native ids the resolver registers in PR 2 are refused with the reason, not called unknown", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("says why, and is still an UnknownModelError for every boundary that catches that class", () => {
    for (const id of ["claude-sonnet-5-5", "gemini-3.8-flash"]) {
      expect(SPEC_NATIVE_WIRE_IDS.has(id)).toBe(true);
      for (const call of [() => getLanguageModelSafe(id), () => normalizeModelInput(id), () => resolvePipelineModelSelection(id)]) {
        let error: unknown;
        try { call(); } catch (e) { error = e; }
        expect(error, id).toBeInstanceOf(RefusedModelError);
        expect(error, id).toBeInstanceOf(UnknownModelError);
        expect((error as Error).message, id).toMatch(/registers in PR 2/);
        expect((error as Error).message, id).not.toMatch(/^Unknown model/);
      }
    }
  });
});

// PR #662 review round 5, P2: the section 1.2 OpenRouter and Bedrock columns are known too (Homen D1).
// Persona: an operator pastes `anthropic/claude-sonnet-5.5` or `moonshotai/kimi-k3` into a model field.
// It must be refused with the reason by every entry point, and must not become kimi-k2.6 under
// `allowPaidFallback: true` (a known id is never rerouted).
describe("D1: SPEC-v9 1.2 OpenRouter and Bedrock wire ids are refused with the reason, never rerouted", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("names every id of both columns", () => {
    expect([...SPEC_OPENROUTER_WIRE_IDS].sort()).toEqual([
      "anthropic/claude-fable-5.1", "anthropic/claude-haiku-5.5", "anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5.5",
      "google/gemini-3.1-pro-preview", "google/gemini-3.5-flash-lite", "google/gemini-3.6-flash", "google/gemini-3.8-flash",
      "minimax/minimax-m3", "moonshotai/kimi-k3", "openai/gpt-5.4-mini", "openai/gpt-6-luna", "openai/gpt-6.1-sol", "z-ai/glm-5.3",
    ]);
    expect([...SPEC_BEDROCK_WIRE_IDS].sort()).toEqual([
      "anthropic.claude-fable-5-1", "anthropic.claude-haiku-5-5", "anthropic.claude-opus-5-5", "anthropic.claude-sonnet-5-5",
    ]);
  });

  it("every entry point refuses each one with RefusedModelError, with and without allowPaidFallback", () => {
    for (const id of [...SPEC_OPENROUTER_WIRE_IDS, ...SPEC_BEDROCK_WIRE_IDS]) {
      for (const call of [
        () => getLanguageModelSafe(id),
        () => getLanguageModelSafe(id, { allowPaidFallback: true }),
        () => normalizeModelInput(id),
        () => normalizeModelInput(id, { allowPaidFallback: true }),
        () => resolvePipelineModelSelection(id),
        () => assertKnownModelInput(id),
      ]) {
        let error: unknown;
        try { call(); } catch (e) { error = e; }
        expect(error, id).toBeInstanceOf(RefusedModelError);
        expect((error as Error).message, id).toMatch(/known id, refused/);
        expect((error as Error).message, id).not.toMatch(/^Unknown model/);
      }
    }
  });
});

// Persona: an operator pins a dated Claude snapshot that is still served (claude-sonnet-4-5-20250929 until
// 2026-11-30; claude-opus-4-5-20251101 is active). LEGACY_ALIASES maps them to claude-sonnet-4 / claude-opus-4
// (wire ids ...-4-20250514, retired 2026-06-15), so the fallback helpers called a retired model first and
// reported "no fallback used" (PR #662 review round 7 P1 -> round 10). The id is refused instead; PR 2 maps it.
describe("D1: a dated snapshot whose only alias is a retired family is refused, not run as that family (PR #662 round 10)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const snapshots = ["claude-sonnet-4-5-20250929", "claude-opus-4-5-20251101", " Claude-Sonnet-4-5-20250929 "];

  it("every fail-closed entry point refuses it, and the fallback callback is never invoked", async () => {
    for (const id of snapshots) {
      for (const call of [
        () => getLanguageModelSafe(id),
        () => getLanguageModelSafe(id, { allowPaidFallback: true }),
        () => normalizeModelInput(id),
        () => normalizeNodeBenchRuntimeModel(id),
        () => assertKnownModelInput(id),
        () => getFallbackChain(id as never),
        () => getLanguageModelWithFallback(id as never),
      ]) {
        expect(call, id).toThrow(RefusedModelError);
      }
      const tried: string[] = [];
      await expect(executeWithModelFallback(async (_m, alias) => { tried.push(alias); return "ok"; }, { startModel: id as never })).rejects.toBeInstanceOf(RefusedModelError);
      expect(tried, id).toEqual([]);
    }
  });

  it("the alias rows stay for persisted data (resolveModelAlias unchanged; PR 2 repoints them)", () => {
    expect(resolveModelAlias("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4");
    expect(resolveModelAlias("claude-opus-4-5-20251101")).toBe("claude-opus-4");
  });
});

// Persona: a visitor who has not signed in opens the FastAgent panel and a script (or a stale client) sends
// a model field. The anonymous lane is bounded, but what was ASKED for is still validated first: an unknown
// id throws at the public boundary, and a free request never becomes the paid bounded model
// (SPEC-v9 A.0.10; PR #662 review round 6, P2). createThread and initiateAsyncStreaming both route here.
describe("FastAgent anonymous callers: the requested model is validated before the anonymous override", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());
  const anon = (requestedModel?: string) => normalizeFastAgentModel({ isAnonymous: true, requestedModel }, "executor");

  it("keeps a free request on the free lane, never the paid bounded model", () => {
    for (const id of ["auto-free", "invented-free", "x:free", FREE_LANE_MODEL, "qwen3-coder-free"]) {
      const resolved = anon(id);
      expect(isFreeModel(resolved), id).toBe(true);
      expect(resolved, id).not.toBe(ANONYMOUS_FAST_AGENT_MODEL_ID);
    }
    expect(anon("auto-free")).toBe(FREE_LANE_MODEL);
  });

  it("throws for an unknown id, including Object.prototype keys, instead of accepting it silently", () => {
    for (const id of ["constructor", "toString", "gpt-not-real", "freeloader-pro"]) {
      expect(() => anon(id), id).toThrow(UnknownModelError);
    }
  });

  it("refuses a known id the resolver has not registered yet, with the reason", () => {
    expect(() => anon("claude-sonnet-5-5")).toThrow(RefusedModelError);
    expect(() => anon("google/gemma-4-31b-it:free")).toThrow(RefusedModelError);
  });

  it("keeps the anonymous default when no model is passed, and the bounded lane for a known paid request", () => {
    expect(anon(undefined)).toBe(ANONYMOUS_FAST_AGENT_MODEL_ID);
    expect(anon("")).toBe(ANONYMOUS_FAST_AGENT_MODEL_ID);
    expect(anon("claude-opus-4.7")).toBe(ANONYMOUS_FAST_AGENT_MODEL_ID);
    expect(anon("gpt-5.4-mini")).toBe(ANONYMOUS_FAST_AGENT_MODEL_ID);
  });

  it("does not change a signed-in caller", () => {
    for (const id of [undefined, "auto-free", "gpt-5.4-mini", "claude-opus-4.7", "kimi-k2.6"]) {
      for (const profile of ["advisor", "executor"] as const) {
        expect(normalizeFastAgentModel({ isAnonymous: false, requestedModel: id }, profile), `${profile}/${id}`).toBe(
          normalizeNodeBenchRuntimeModel(id, profile),
        );
      }
    }
    expect(() => normalizeFastAgentModel({ isAnonymous: false, requestedModel: "constructor" }, "advisor")).toThrow(UnknownModelError);
  });
});

// Homen D1: "known" includes the repo's own registries, and a known id is never silently rerouted.
// Persona: a caller passes a short alias the shared catalog documents ("sonnet", "gpt5", "minimax"), the
// OpenRouter wire id of an approved model ("minimax/minimax-m2.7") or a catalog-priced model this resolver
// has no entry for ("grok-4", "deep-research-preview-04-2026"). On main each silently became kimi-k2.6 or
// gpt-5.4-mini; PR #662 round 7 first reported them as "Unknown model" (plain, as if nothing knew them).
describe("D1: ids the repo's own registries list are mapped or refused, never 'Unknown model' (PR #662 round 7)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-not-real");
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-real");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key-not-real");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // Typed out from the catalog's alias table and the resolver's MODEL_SPECS, not read from them.
  const mapped: Array<[string, string]> = [
    ["gpt5", "gpt-5.4"], ["gpt5.4", "gpt-5.4"], ["gpt", "gpt-5.4"], ["openai", "gpt-5.4"],
    ["claude-4", "claude-sonnet-4.6"], ["sonnet", "claude-sonnet-4.6"], ["anthropic", "claude-sonnet-4.6"],
    ["opus", "claude-opus-4.7"], ["haiku", "claude-haiku-4.5"],
    ["gemini-3", "gemini-3-flash-preview"], ["flash", "gemini-3-flash-preview"], ["google", "gemini-3-flash-preview"],
    ["gemini-2.5", "gemini-2.5-flash"],
    ["openrouter", "kimi-k2.6"], ["moonshotai/kimi-k2.6", "kimi-k2.6"],
    ["minimax", "minimax-m2.7"], ["minimax/minimax-m2.7", "minimax-m2.7"],
    ["deepseek/deepseek-r1", "deepseek-r1"], ["deepseek/deepseek-v3.2", "deepseek-v3.2"],
    ["qwen/qwen3-235b-a22b", "qwen3-235b"], ["mistralai/mistral-large-2411", "mistral-large"],
  ];
  it.each(mapped)("%s is the registered %s in every entry point", (input, target) => {
    expect(normalizeModelInput(input)).toBe(target);
    expect(resolveModelAlias(input)).toBe(target);
    expect(resolvePipelineModelSelection(input).resolvedModelId).toBe(target);
    expect(() => assertKnownModelInput(input)).not.toThrow();
    expect(() => getLanguageModelSafe(input)).not.toThrow();
  });

  const unregistered = [
    "deep research", "deep-research", "deep research max", "deep-research-preview-04-2026",
    "deep-research-max-preview-04-2026", "deep-research-pro-preview-12-2025",
    "grok-4-1-fast-reasoning", "grok-4-1-fast-non-reasoning", "grok-4-fast-reasoning", "grok-4-fast-non-reasoning",
    "grok-3", "grok-3-mini", "grok-code-fast-1", "grok-2-vision-1212", "grok-2",
  ];
  it.each(unregistered)("%s is listed by the shared catalog and refused as a known id, even with allowPaidFallback", (input) => {
    for (const call of [
      () => getLanguageModelSafe(input),
      () => getLanguageModelSafe(input, { allowPaidFallback: true }),
      () => normalizeModelInput(input),
      () => normalizeModelInput(input, { allowPaidFallback: true }),
      () => resolvePipelineModelSelection(input),
      () => assertKnownModelInput(input),
    ]) {
      expect(call, input).toThrow(RefusedModelError);
      expect(call, input).toThrow(/known id, refused/);
    }
  });

  it("no key of the catalog's alias, pricing or equivalents table, and no MODEL_SPECS wire id, is called 'Unknown model'", () => {
    const ids = new Set<string>([
      ...Object.keys(modelAliases), ...Object.keys(modelPricing), ...Object.keys(modelEquivalents),
      ...Object.values(MODEL_SPECS).map((spec) => spec.sdkId),
    ]);
    expect(ids.size).toBeGreaterThan(100);
    const plain: string[] = [];
    for (const id of ids) {
      for (const call of [() => getLanguageModelSafe(id), () => normalizeModelInput(id), () => resolvePipelineModelSelection(id)]) {
        try {
          call();
        } catch (error) {
          if (error instanceof UnknownModelError && !(error instanceof RefusedModelError)) plain.push(id);
        }
      }
    }
    expect([...new Set(plain)]).toEqual([]);
  });
});
