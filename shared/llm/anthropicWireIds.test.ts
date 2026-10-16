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
  anthropicText,
  anthropicWireId,
  FREE_LANE_CATALOG_ID,
  FREE_LANE_WIRE_ID,
  UnknownModelError,
  getEquivalentModel,
  getModelPricing,
  getModelWithFailover,
  getNextFallback,
  getProviderForModel,
  llmModelCatalog,
  resolveModelAlias,
} from "./modelCatalog";
import { FREE_LANE_MODEL, LEGACY_ALIASES, MODEL_SPECS } from "../../backend/convex/domains/agents/mcp_tools/models/modelResolver";

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
        expect(() => getModelWithFailover(resolveModelAlias(id)), id).toThrow(/Unknown model/);
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
    // `nemotron-3-super-free` must never be what comes back (SPEC-v9 A.2.10 rule (b)).
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
