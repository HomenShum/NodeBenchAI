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
  normalizeFastAgentModel,
  normalizeModelInput,
  normalizeNodeBenchRuntimeModel,
  resolveModelAlias,
  resolvePipelineModelSelection,
} from "./modelResolver";
import { ANONYMOUS_FAST_AGENT_MODEL_ID } from "../../../../../../shared/llm/fastAgentRuntimeContract";
import { RefusedModelError, SPEC_LIVE_FREE_WIRE_IDS, SPEC_NATIVE_WIRE_IDS } from "../../../../../../shared/llm/modelCatalog";

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

describe("an approved PAID model outside the priority order keeps main's behaviour", () => {
  // Main restarts such a start model at the head of the order (kimi-k2.6) and lists the whole chain.
  // Changing that is a caller-argument decision (PR body, C item c), not part of A.0.10.
  const paidUnlisted = ["glm-4.7-flash", "deepseek-r1", "gemini-2.5-flash", "mistral-large", "claude-opus-4"];
  it.each(paidUnlisted)("%s does not throw and starts at the head", async (id) => {
    // buildLanguageModel needs a key to construct the head model and the requested model.
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-not-real");
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
    expect(APPROVED_MODELS as readonly string[]).toContain(id);
    expect(MODEL_PRIORITY_ORDER as readonly string[]).not.toContain(id);
    expect(isFreeModel(id as never)).toBe(false);
    const r = await executeWithModelFallback(async (_m, used) => used, { startModel: id as never });
    expect(r.modelUsed).toBe(MODEL_PRIORITY_ORDER[0]);
    expect(getFallbackChain(id as never)).toEqual(MODEL_PRIORITY_ORDER);
    expect(getLanguageModelWithFallback(id as never).fallbackChain).toEqual(MODEL_PRIORITY_ORDER);
    vi.unstubAllEnvs();
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
