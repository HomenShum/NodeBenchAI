// @vitest-environment node
/**
 * The ~14 generateWithProvider copies (dealFlow.ts, morningDigest.ts, ...) call
 * `getModelWithFailover(resolveModelAlias(x))` and pass `.model` straight to
 * `anthropic.messages.create({ model })`. Before this change that string was the
 * dotted catalog alias ("claude-sonnet-4.6"), which api.anthropic.com does not
 * accept, so every anthropic branch 404'd. The fix lives once, in the catalog
 * (SPEC-v9 A.0.5: an explicit table, not string surgery), so these tests drive
 * the function every copy routes through.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANTHROPIC_WIRE_IDS,
  LEGACY_PASSTHROUGH_IDS,
  OPENROUTER_ONLY_REGISTRY_IDS,
  SPEC_BEDROCK_WIRE_IDS,
  SPEC_NATIVE_WIRE_IDS,
  SPEC_OPENROUTER_WIRE_IDS,
  assertKnownModel,
  modelAliases,
  modelEquivalents,
  modelPricing,
  anthropicText,
  anthropicWireId,
  FREE_LANE_CATALOG_ID,
  FREE_LANE_WIRE_ID,
  RefusedModelError,
  SPEC_LIVE_FREE_WIRE_IDS,
  UnknownModelError,
  getEquivalentModel,
  getModelPricing,
  getModelWithFailover,
  getNextFallback,
  getProviderForModel,
  llmModelCatalog,
  resolveModelAlias,
} from "./modelCatalog";
import { APPROVED_MODELS, FREE_LANE_MODEL, LEGACY_ALIASES, MODEL_SPECS } from "../../backend/convex/domains/agents/mcp_tools/models/modelResolver";

describe("ANTHROPIC_WIRE_IDS agrees with the resolver's MODEL_SPECS", () => {
  const anthropicSpecs = Object.values(MODEL_SPECS).filter((spec) => spec.provider === "anthropic");

  it("covers every anthropic spec with the same wire id", () => {
    expect(anthropicSpecs.length).toBeGreaterThan(0);
    for (const spec of anthropicSpecs) {
      expect(ANTHROPIC_WIRE_IDS[spec.alias], `${spec.alias} missing from ANTHROPIC_WIRE_IDS`).toBe(spec.sdkId);
    }
    expect(Object.keys(ANTHROPIC_WIRE_IDS).sort()).toEqual(anthropicSpecs.map((s) => s.alias).sort());
  });

  it("never contains a dotted wire id", () => {
    for (const wire of Object.values(ANTHROPIC_WIRE_IDS)) expect(wire).not.toContain(".");
  });
});

describe("anthropicWireId", () => {
  it("maps catalog aliases and short aliases to wire ids", () => {
    expect(anthropicWireId("claude-sonnet-4.6")).toBe("claude-sonnet-4-6");
    expect(anthropicWireId("claude-haiku-4.5")).toBe("claude-haiku-4-5");
    expect(anthropicWireId("claude-opus-4.7")).toBe("claude-opus-4-7");
    expect(anthropicWireId("claude")).toBe("claude-sonnet-4-6");
    expect(anthropicWireId("Haiku")).toBe("claude-haiku-4-5");
  });

  it("returns a string that already is a wire id unchanged, and null for anything else", () => {
    expect(anthropicWireId("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    // Round 3 pinned null here; main sent the dated snapshots unchanged and the resolver still
    // recognises them, so they pass through (round 4, SPEC-v9 A.0.4: PR 1 moves no ids).
    for (const snapshot of ["claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929", "claude-opus-4-5-20251101"]) {
      expect(anthropicWireId(snapshot)).toBe(snapshot);
    }
    expect(anthropicWireId("gpt-5.4")).toBeNull();
    expect(anthropicWireId("")).toBeNull();
  });
});

describe("getModelWithFailover sends wire ids to Anthropic", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("every anthropic model in the catalog resolves to a wire id with no dot", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real");
    const aliases = new Set(Object.values(llmModelCatalog.anthropic).flat());
    expect(aliases.size).toBeGreaterThan(0);
    for (const alias of aliases) {
      const { model, provider } = getModelWithFailover(resolveModelAlias(alias));
      expect(provider).toBe("anthropic");
      expect(model, alias).toBe(ANTHROPIC_WIRE_IDS[alias]);
      expect(model).not.toContain(".");
    }
  });

  it("converts an equivalent chosen by provider failover too", () => {
    // OpenAI and Gemini keys absent: gpt-5.4 fails over to its Anthropic equivalent.
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real");
    expect(getModelWithFailover("gpt-5.4")).toMatchObject({
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      isFallback: true,
    });
  });

  it("passes a known wire id through untouched", () => {
    // Round 3 (A.0.10): this used to pass the unknown snapshot "claude-haiku-4-5-20251001" through
    // on its `claude-` prefix alone. No caller supplies one (getLlmModel has no env override), the
    // public actions normalise user input to the alias first, and a prefix is not knowledge.
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real");
    for (const wire of Object.values(ANTHROPIC_WIRE_IDS)) {
      expect(getModelWithFailover(wire), wire).toMatchObject({ model: wire, provider: "anthropic", isFallback: false });
    }
    // An unrecognised snapshot-shaped id is still unknown: the prefix alone is not knowledge.
    expect(() => getModelWithFailover("claude-haiku-4-5-29990101")).toThrow(/Unknown model/);
  });

  // Round 4 (A.0.4): getModelWithFailover threw for ids the resolver recognises and main sent unchanged.
  describe("legacy ids the resolver recognises", () => {
    // Not wire ids, so main's request for them failed at the provider: dotted Claude ids, and the
    // gpt-oss* OpenRouter free aliases that the `gpt-` prefix used to route to paid OpenAI.
    const NOT_WIRE_IDS = ["claude-opus-4.6", "claude-opus-4.5", "claude-sonnet-4.5", "gpt-oss-120b", "gpt-oss", "gpt-oss-20b"];
    const providerOf = (id: string) => (id.startsWith("claude-") ? "anthropic" : id.startsWith("gpt-") ? "openai" : "gemini");
    beforeEach(() => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real");
      vi.stubEnv("OPENAI_API_KEY", "sk-test-key-not-real-0000");
      vi.stubEnv("GEMINI_API_KEY", "gemini-test-key-not-real");
    });

    it("every LEGACY_PASSTHROUGH_IDS entry is a resolver alias and goes out unchanged", () => {
      expect(LEGACY_PASSTHROUGH_IDS.size).toBeGreaterThan(0);
      for (const id of LEGACY_PASSTHROUGH_IDS) {
        expect(LEGACY_ALIASES, `${id} must stay a resolver alias`).toHaveProperty(id);
        expect(getModelWithFailover(resolveModelAlias(id)), id).toEqual({ model: id, provider: providerOf(id), isFallback: false });
      }
    });

    it("no provider-prefixed LEGACY_ALIASES key is rejected by the catalog (drift guard)", () => {
      const keys = Object.keys(LEGACY_ALIASES).filter((id) => /^(claude-|gpt-|gemini-)/.test(id) && !NOT_WIRE_IDS.includes(id));
      expect(keys.length).toBeGreaterThan(20);
      for (const id of keys) {
        expect(() => getModelWithFailover(resolveModelAlias(id)), `${id}: add it to LEGACY_PASSTHROUGH_IDS`).not.toThrow();
      }
    });

    it("the ids main could not have served still fail closed", () => {
      for (const id of NOT_WIRE_IDS) {
        // Round 5 (Homen D1): a registry-known OpenRouter id (gpt-oss-120b) is a known id, refused with
        // its reason; it was "Unknown model" before. Every other id here is still unknown.
        const label = OPENROUTER_ONLY_REGISTRY_IDS.has(resolveModelAlias(id)) ? /known id, refused/ : /Unknown model/;
        expect(() => getModelWithFailover(resolveModelAlias(id)), id).toThrow(label);
      }
    });
  });

  it("leaves non-Anthropic providers alone", () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key-not-real");
    expect(getModelWithFailover("gemini-3-flash-preview")).toMatchObject({
      model: "gemini-3-flash-preview",
      provider: "gemini",
    });
  });
});

describe("anthropicText reads content blocks by type", () => {
  it("skips a leading thinking block (content[0] is not the answer)", () => {
    expect(
      anthropicText([
        { type: "thinking" },
        { type: "text", text: "hello " },
        { type: "tool_use" },
        { type: "text", text: "world" },
      ]),
    ).toBe("hello world");
  });

  it("returns an empty string when there is no text", () => {
    expect(anthropicText([{ type: "thinking" }])).toBe("");
    expect(anthropicText(undefined)).toBe("");
    expect(anthropicText(null)).toBe("");
  });
});

// An unknown id used to become gpt-5.4-mini on OpenAI, free-looking ones included
// (SPEC-v9 A.0.10; PR #662 review round 1).
describe("getModelWithFailover fails closed", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-not-real-0000");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key-not-real");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("names the same free lane as the resolver", () => {
    expect(FREE_LANE_CATALOG_ID).toBe(FREE_LANE_MODEL);
    expect(FREE_LANE_WIRE_ID).toBe(MODEL_SPECS[FREE_LANE_MODEL].sdkId);
  });

  it("sends an unknown free-looking id to the free lane on OpenRouter as the WIRE id, never a paid default or the alias", () => {
    // The returned `model` goes straight into the provider request, so the alias
    // `flint-v1-free` must never be what comes back (SPEC-v9 A.2.10 rule (b)).
    for (const id of ["retired-model-free", "someone/new-model:free"]) {
      expect(getModelWithFailover(id), id).toEqual({ model: FREE_LANE_WIRE_ID, provider: "openrouter", isFallback: true });
    }
  });

  it("free route aliases take the free lane instead of throwing", () => {
    for (const id of ["openrouter/free", "auto-free", "nodebench:auto-free", "kilo-auto/free", "free"]) {
      expect(getModelWithFailover(id), id).toEqual({ model: FREE_LANE_WIRE_ID, provider: "openrouter", isFallback: true });
    }
  });

  it("a prefix-shaped invented id never fails over to a paid provider, even when only Gemini is configured", () => {
    // Before: getProviderForModel inferred a provider from the prefix, so these missed the
    // unknown-id branch and failed over to the paid gemini-3.1-flash-lite-preview.
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key-not-real");
    for (const id of ["gpt-not-real", "claude-not-real"]) {
      expect(() => getModelWithFailover(id), id).toThrow(/never fails over to a paid default/);
    }
    // free-looking wins over the prefix
    expect(getModelWithFailover("gpt-not-real-free")).toEqual({ model: FREE_LANE_WIRE_ID, provider: "openrouter", isFallback: true });
    // a KNOWN catalog model still fails over as before
    expect(getModelWithFailover("gpt-5.4").provider).toBe("gemini");
  });

  it("every model the catalog itself names still resolves, so no default now throws", () => {
    const named = new Set(Object.values(llmModelCatalog).flatMap((byTask) => Object.values(byTask).flat()));
    expect(named.size).toBeGreaterThan(10);
    for (const id of named) expect(() => getModelWithFailover(resolveModelAlias(id)), id).not.toThrow();
  });

  it("an invented or unlisted paid id throws even when its provider is configured", () => {
    // Round 3 (A.0.10): with OPENAI_API_KEY set these returned {provider:"openai", isFallback:false}
    // and reached openai.chat.completions.create from the public daily-brief actions.
    for (const id of ["gpt-not-real", "gpt-5.5-pro", "claude-not-real", "gemini-not-real"]) {
      expect(() => getModelWithFailover(id), id).toThrow(/Unknown model/);
    }
  });

  it("every resolver spec the catalog can route resolves by its sdkId", () => {
    for (const spec of Object.values(MODEL_SPECS)) {
      if (spec.provider !== "openai" && spec.provider !== "google") continue;
      expect(() => getModelWithFailover(spec.sdkId), spec.sdkId).not.toThrow();
    }
  });

  it("throws for any other unknown id", () => {
    for (const id of ["not-a-model", "freeloader-pro", "mistral-unknown"]) {
      expect(() => getModelWithFailover(id), id).toThrow(/Unknown model/);
    }
  });

  it("a configured free catalog model stays free, and an unconfigured provider never fails over to a paid one", () => {
    expect(getModelWithFailover(FREE_LANE_MODEL)).toEqual({ model: FREE_LANE_WIRE_ID, provider: "openrouter", isFallback: false });
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(() => getModelWithFailover(FREE_LANE_MODEL)).toThrow(/never fails over to a paid provider/);
  });
});

// Persona: a signed-in user types "toString" into a model field. The alias, pricing, equivalent,
// fallback and wire-id tables are plain objects, so an inherited property used to count as a model
// and (with OpenRouter unset) the request went to a paid default (A.0.10, PR #662 round 5).
describe("Object.prototype keys are not models", () => {
  const PROTOTYPE_KEYS = ["toString", "valueOf", "hasOwnProperty", "constructor", "__proto__", "isPrototypeOf", "toLocaleString"];

  it.each(PROTOTYPE_KEYS)("%s is unknown in every catalog table and never dispatches", (key) => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key-not-real");
    expect(resolveModelAlias(key)).toBe(key);
    expect(anthropicWireId(key)).toBeNull();
    expect(getModelPricing(key)).toBeNull();
    expect(getProviderForModel(key)).toBeNull();
    expect(getNextFallback(key, [])).toBeNull();
    expect(typeof getEquivalentModel(key, "openai")).toBe("string");
    expect(() => getModelWithFailover(resolveModelAlias(key))).toThrow(UnknownModelError);
  });
});

// Homen D1 (2026-10-16): "known" = SPEC-v9 section 1.2 plus the repo's own registries, and a known id is
// never silently rerouted. PR 1 moves no ids (A.0.4), so every 1.2 native id that main sent unchanged to
// its own provider is still sent unchanged (PR #662 review round 4, P1).
describe("D1: SPEC-v9 1.2 native wire ids are known and go out unchanged", () => {
  const providerOf = (id: string) => (id.startsWith("claude-") ? "anthropic" : id.startsWith("gemini-") ? "gemini" : "openai");
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-not-real-0000");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key-not-real");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("names the 1.2 anthropic, google and openai columns, including the ids the review listed", () => {
    for (const id of ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gpt-6.1-sol", "gpt-6-luna"]) {
      expect(SPEC_NATIVE_WIRE_IDS.has(id), id).toBe(true);
    }
    for (const id of SPEC_NATIVE_WIRE_IDS) expect(id).not.toContain("/");
  });

  it("every one is accepted by the boundary check and dispatched to its own provider as written", () => {
    for (const id of SPEC_NATIVE_WIRE_IDS) {
      expect(() => assertKnownModel(resolveModelAlias(id)), id).not.toThrow();
      expect(getModelWithFailover(resolveModelAlias(id)), id).toEqual({ model: id, provider: providerOf(id), isFallback: false });
    }
  });

  it("the Claude ones have an Anthropic wire id, themselves", () => {
    for (const id of SPEC_NATIVE_WIRE_IDS) {
      if (id.startsWith("claude-")) expect(anthropicWireId(id), id).toBe(id);
    }
  });
});

// D1 for the resolver-registry ids the catalog cannot dispatch: it has no OpenRouter branch until PR 2.
// Disposition: REFUSED with a reason. Before this change they either threw as "unknown" (paid-looking) or,
// when free-looking, were silently rerouted to the free lane; on main they went to the paid gpt-5.4-mini.
describe("D1: resolver-registry ids the catalog cannot dispatch are refused, never rerouted", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-not-real-0000");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key-not-real");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key-not-real");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // The set the resolver registers on OpenRouter (its ids, its legacy-alias keys and its wire strings),
  // less what the catalog already dispatches and the free lane itself.
  const derived = (): Set<string> => {
    const catalogKnows = (name: string) => {
      const id = resolveModelAlias(name); // the boundary resolves catalog aliases first ("kimi" -> kimi-k2.6)
      return Object.hasOwn(modelPricing, id) || Object.hasOwn(modelEquivalents, id);
    };
    const out = new Set<string>();
    for (const id of new Set<string>([...APPROVED_MODELS, ...Object.keys(LEGACY_ALIASES)])) {
      // The resolver checks APPROVED_MODELS before LEGACY_ALIASES, so "deepseek-r1" is itself, not the
      // legacy row that points it at deepseek-r1-free (that row hid its own wire id "deepseek/deepseek-r1").
      const target = (APPROVED_MODELS as readonly string[]).includes(id) ? id : ((LEGACY_ALIASES as Record<string, string>)[id] ?? id);
      const spec = (MODEL_SPECS as Record<string, { provider: string; sdkId: string }>)[target];
      if (spec?.provider !== "openrouter" || target === FREE_LANE_MODEL) continue;
      for (const name of [id, target, spec.sdkId]) if (!catalogKnows(name) && name !== FREE_LANE_WIRE_ID) out.add(name);
    }
    return out;
  };

  it("OPENROUTER_ONLY_REGISTRY_IDS is exactly the registry's OpenRouter ids (no stale entry, none missing)", () => {
    const want = derived();
    expect(want.size).toBeGreaterThan(50);
    expect([...OPENROUTER_ONLY_REGISTRY_IDS].sort()).toEqual([...want].sort());
  });

  it("every one is refused with its reason by the boundary check and by dispatch, with every provider configured", () => {
    for (const id of OPENROUTER_ONLY_REGISTRY_IDS) {
      expect(() => assertKnownModel(id), id).toThrow(UnknownModelError);
      expect(() => getModelWithFailover(id), id).toThrow(/OpenRouter branch/);
    }
  });

  it("the named examples are among them, free-looking ones included (no silent reroute to nemotron)", () => {
    for (const id of ["z-ai/glm-4.7", "z-ai/glm-4.7-flash", "qwen3-coder", "llama-3.3-70b", "laguna-s-2.1-free", "poolside/laguna-s-2.1:free", "poolside/laguna-xs-2.1:free"]) {
      expect(OPENROUTER_ONLY_REGISTRY_IDS.has(id), id).toBe(true);
      expect(() => getModelWithFailover(id), id).toThrow(UnknownModelError);
    }
  });

  it("the free lane itself is not refused, and an id the registry does not know still takes the free lane (logged)", () => {
    expect(getModelWithFailover(FREE_LANE_MODEL)).toEqual({ model: FREE_LANE_WIRE_ID, provider: "openrouter", isFallback: false });
    expect(getModelWithFailover("brand-new-model:free")).toEqual({ model: FREE_LANE_WIRE_ID, provider: "openrouter", isFallback: true });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("brand-new-model:free"));
  });

  // Not wire ids: main sent them to api.anthropic.com, which 404s on a dotted Claude id. They stay refused.
  it("dotted Claude ids that were never wire ids stay refused", () => {
    for (const id of ["claude-opus-4.6", "claude-opus-4.5", "claude-sonnet-4.5"]) {
      expect(() => getModelWithFailover(id), id).toThrow(UnknownModelError);
    }
  });
});

// PR #662 review round 5, P2: the section 1.2 OpenRouter and Bedrock columns are known ids too. They were
// reported as "Unknown model"; the registry-known OpenRouter ids were mislabelled the same way.
describe("D1: SPEC-v9 1.2 OpenRouter and Bedrock wire ids, and registry OpenRouter ids, are refused as known", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-not-real-0000");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key-not-real");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key-not-real");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("each one is a RefusedModelError at the boundary check and at dispatch, never 'Unknown model'", () => {
    expect(SPEC_OPENROUTER_WIRE_IDS.size).toBe(14);
    expect(SPEC_BEDROCK_WIRE_IDS.size).toBe(4);
    for (const id of [...SPEC_OPENROUTER_WIRE_IDS, ...SPEC_BEDROCK_WIRE_IDS]) {
      for (const call of [() => assertKnownModel(id), () => getModelWithFailover(id)]) {
        expect(call, id).toThrow(RefusedModelError);
        expect(call, id).toThrow(/known id, refused/);
      }
    }
  });

  it("registry-known OpenRouter ids carry the same label", () => {
    for (const id of ["z-ai/glm-4.7", "qwen3-coder", "llama-3.3-70b"]) {
      expect(() => assertKnownModel(id), id).toThrow(RefusedModelError);
      expect(() => assertKnownModel(id), id).not.toThrow(/^Unknown model/);
    }
  });
});

// Homen D1 for the 15 live `:free` ids of SPEC-v9 section 1.2 (PR #662 review round 6, P2). This catalog has no
// OpenRouter branch until PR 2: it serves the free lane's own wire id as asked and refuses the other 14 with a
// reason. It never answers a request for a known free id with a different model.
describe("D1: the SPEC-v9 1.2 live :free ids through getModelWithFailover", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key-not-real");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("each is served as itself or refused with a reason, and none comes back as another model", () => {
    expect(SPEC_LIVE_FREE_WIRE_IDS.size).toBe(15);
    for (const id of SPEC_LIVE_FREE_WIRE_IDS) {
      if (id === FREE_LANE_WIRE_ID) {
        expect(getModelWithFailover(id), id).toEqual({ model: FREE_LANE_WIRE_ID, provider: "openrouter", isFallback: false });
        expect(() => assertKnownModel(id), id).not.toThrow();
      } else {
        expect(() => assertKnownModel(id), id).toThrow(UnknownModelError);
        expect(() => getModelWithFailover(id), id).toThrow(UnknownModelError);
        let error: unknown;
        try { getModelWithFailover(id); } catch (e) { error = e; }
        expect((error as Error).message, id).toMatch(/until PR 2/);
      }
    }
    // the ones the review named
    for (const id of ["apodex/apodex-1.1-mini:free", "google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-content-safety:free"]) {
      expect(() => getModelWithFailover(id), id).toThrow(RefusedModelError);
    }
  });
});

// Homen D1 (PR #662 round 7): the catalog's own short aliases are known ids. The public actions resolve them
// before they call in, but the functions themselves threw "Unknown model" for "moonshotai/kimi-k2.6", "kimi",
// "sonnet" and the rest when called with the alias as written.
describe("D1: the catalog's own aliases are known at assertKnownModel and getModelWithFailover as written", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key-not-real-0000");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key-not-real");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key-not-real");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ["moonshotai/kimi-k2.6", "kimi-k2.6"],
    ["kimi", "kimi-k2.6"],
    ["openrouter", "kimi-k2.6"],
    ["minimax/minimax-m2.7", "minimax-m2.7"],
    ["gpt5", "gpt-5.4"],
    ["sonnet", "claude-sonnet-4.6"],
    ["flash", "gemini-3-flash-preview"],
    ["deep research", "deep-research-preview-04-2026"],
  ])("%s dispatches exactly as %s does", (alias, target) => {
    expect(() => assertKnownModel(alias)).not.toThrow();
    expect(getModelWithFailover(alias)).toEqual(getModelWithFailover(target));
  });

  it("no key of modelAliases is called 'Unknown model' by either function", () => {
    for (const alias of Object.keys(modelAliases)) {
      for (const call of [() => assertKnownModel(alias), () => getModelWithFailover(alias)]) {
        try {
          call();
        } catch (error) {
          expect(error instanceof UnknownModelError && !(error instanceof RefusedModelError), alias).toBe(false);
        }
      }
    }
  });

  it("the resolver's own OpenRouter wire id 'deepseek/deepseek-r1' is refused as a known id here (no OpenRouter branch until PR 2)", () => {
    expect(() => assertKnownModel("deepseek/deepseek-r1")).toThrow(RefusedModelError);
    expect(() => getModelWithFailover("deepseek/deepseek-r1")).toThrow(RefusedModelError);
  });
});
