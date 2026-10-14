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
  anthropicText,
  anthropicWireId,
  FREE_LANE_CATALOG_ID,
  getModelWithFailover,
  llmModelCatalog,
  resolveModelAlias,
} from "./modelCatalog";
import { FREE_LANE_MODEL, MODEL_SPECS } from "../../backend/convex/domains/agents/mcp_tools/models/modelResolver";

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
    expect(anthropicWireId("claude-haiku-4-5-20251001")).toBeNull();
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

  it("passes an operator-supplied claude string through untouched (env override precedence)", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real");
    expect(getModelWithFailover("claude-haiku-4-5-20251001").model).toBe("claude-haiku-4-5-20251001");
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
  });

  it("sends an unknown free-looking id to the free lane on OpenRouter, never to a paid OpenAI default", () => {
    for (const id of ["retired-model-free", "someone/new-model:free"]) {
      expect(getModelWithFailover(id), id).toEqual({ model: FREE_LANE_MODEL, provider: "openrouter", isFallback: true });
    }
  });

  it("every model the catalog itself names still resolves, so no default now throws", () => {
    const named = new Set(Object.values(llmModelCatalog).flatMap((byTask) => Object.values(byTask).flat()));
    expect(named.size).toBeGreaterThan(10);
    for (const id of named) expect(() => getModelWithFailover(resolveModelAlias(id)), id).not.toThrow();
  });

  it("throws for any other unknown id", () => {
    for (const id of ["not-a-model", "freeloader-pro", "mistral-unknown"]) {
      expect(() => getModelWithFailover(id), id).toThrow(/Unknown model/);
    }
  });

  it("a configured free catalog model stays free, and an unconfigured provider never fails over to a paid one", () => {
    expect(getModelWithFailover(FREE_LANE_MODEL)).toMatchObject({ provider: "openrouter", isFallback: false });
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(() => getModelWithFailover(FREE_LANE_MODEL)).toThrow(/never fails over to a paid provider/);
  });
});
