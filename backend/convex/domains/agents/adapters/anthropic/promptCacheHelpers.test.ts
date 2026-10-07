/**
 * Scenario-based tests for Anthropic prompt-cache helpers.
 *
 * Per .claude/rules/scenario_testing.md every test must declare:
 *   Who (persona) · What (goal) · How (action) · Scale · Duration · Failure
 *
 * Personas exercised here:
 *   - "DeepReasoning sub-agent run" — single-turn execute() with a small
 *     system prompt (below cache floor — must NOT attach a marker).
 *   - "CodeAnalysis sub-agent run" — single-turn execute() with a long
 *     system prompt (above cache floor — must attach a marker on system).
 *   - "MultiToolAgent runWithTools loop" — 5-iteration loop with a 12-tool
 *     catalog (above cache floor — marker must land on the LAST tool, no
 *     mutation of the input array).
 *   - "Agent with no tools" — catalog is empty, tools cache MUST stay off.
 *   - "Agent with 1 tiny tool" — catalog far below floor, tools cache MUST
 *     stay off (no wasted bytes on a no-op marker).
 *   - "Operator dashboard" — extractCacheStats produces honest stats whether
 *     the API returns the cache fields, returns nulls, or omits them.
 */

import { describe, expect, it } from "vitest";

import {
  ANTHROPIC_CACHE_MIN_TOKENS,
  buildCachedSystem,
  buildCachedTools,
  estimateTokens,
  extractCacheStats,
} from "./promptCacheHelpers";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — produce realistic-shaped test inputs.
// ─────────────────────────────────────────────────────────────────────────────

/** Synthesize a system prompt of approximately `targetTokens` tokens. */
function makeSystemPrompt(targetTokens: number): string {
  // ~4 chars per token is what the helper assumes; produce slightly more so
  // the estimator sees us above the floor.
  const chars = targetTokens * 4 + 8;
  return "S".repeat(chars);
}

/** Synthesize N tools each with a chunky JSON schema description. */
function makeTools(count: number, descriptionTokens = 100) {
  const desc = "D".repeat(descriptionTokens * 4);
  return Array.from({ length: count }, (_, i) => ({
    name: `tool_${i}`,
    description: desc,
    input_schema: { type: "object", properties: { x: { type: "string" } } },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns 0 for empty string (defensive — avoids NaN downstream)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it("rounds up so a 1-char string still costs 1 token (caller never undercounts)", () => {
    expect(estimateTokens("x")).toBe(1);
    expect(estimateTokens("xxxx")).toBe(1);
    expect(estimateTokens("xxxxx")).toBe(2);
  });
});

describe("buildCachedSystem — small prompt persona (DeepReasoning sub-agent)", () => {
  it("returns the original string when systemPrompt is below the 1024-token floor", () => {
    const small = "You are a helpful assistant.";
    const result = buildCachedSystem(small);
    expect(result.attached).toBe(false);
    expect(result.system).toBe(small);
  });

  it("returns undefined and attached=false when systemPrompt is undefined", () => {
    const result = buildCachedSystem(undefined);
    expect(result.attached).toBe(false);
    expect(result.system).toBeUndefined();
  });

  it("does NOT attach a marker just below the floor (estimator must gate before the API)", () => {
    // Build a prompt the estimator will see strictly below the floor by
    // requesting (floor - 100) tokens worth of chars. The +8 pad in
    // makeSystemPrompt is below the per-token rounding noise here.
    const justBelow = makeSystemPrompt(ANTHROPIC_CACHE_MIN_TOKENS - 100);
    const result = buildCachedSystem(justBelow);
    expect(result.attached).toBe(false);
    expect(typeof result.system).toBe("string");
  });
});

describe("buildCachedSystem — large prompt persona (CodeAnalysis sub-agent)", () => {
  it("attaches cache_control on a system prompt above the floor", () => {
    const large = makeSystemPrompt(ANTHROPIC_CACHE_MIN_TOKENS + 100);
    const result = buildCachedSystem(large);
    expect(result.attached).toBe(true);
    expect(Array.isArray(result.system)).toBe(true);
    if (Array.isArray(result.system)) {
      expect(result.system).toHaveLength(1);
      expect(result.system[0].type).toBe("text");
      expect(result.system[0].text).toBe(large);
      expect(result.system[0].cache_control).toEqual({ type: "ephemeral" });
    }
  });
});

describe("buildCachedTools — empty / tiny catalog persona (no-op cases)", () => {
  it("returns an empty array unchanged when no tools are provided", () => {
    const result = buildCachedTools([]);
    expect(result.attached).toBe(false);
    expect(result.tools).toEqual([]);
  });

  it("returns undefined unchanged when tools is undefined", () => {
    const result = buildCachedTools(undefined);
    expect(result.attached).toBe(false);
    expect(result.tools).toBeUndefined();
  });

  it("does NOT attach a marker on a single tiny tool (would be a wasted no-op)", () => {
    const tools = [
      {
        name: "ping",
        description: "tiny",
        input_schema: { type: "object" },
      },
    ];
    const result = buildCachedTools(tools);
    expect(result.attached).toBe(false);
    // Returned array should be the same reference (no copy when not caching)
    expect(result.tools).toBe(tools);
    expect(result.tools?.[0]).not.toHaveProperty("cache_control");
  });
});

describe("buildCachedTools — large catalog persona (MultiToolAgent)", () => {
  it("attaches cache_control to the LAST tool only when the catalog is large", () => {
    const tools = makeTools(12, 100); // 12 tools × ~100 token desc each = ~1200 tokens
    const result = buildCachedTools(tools);
    expect(result.attached).toBe(true);
    expect(result.tools).toHaveLength(12);
    // First N-1 tools must NOT carry the marker.
    for (let i = 0; i < 11; i++) {
      expect(result.tools?.[i]).not.toHaveProperty("cache_control");
    }
    // The last tool MUST carry it.
    expect(result.tools?.[11]).toMatchObject({
      cache_control: { type: "ephemeral" },
    });
  });

  it("does not mutate the input array (DETERMINISTIC — re-running yields same shape)", () => {
    const tools = makeTools(12, 100);
    const snapshot = JSON.stringify(tools);
    const first = buildCachedTools(tools);
    const second = buildCachedTools(tools);
    // Original untouched
    expect(JSON.stringify(tools)).toBe(snapshot);
    expect(tools[11]).not.toHaveProperty("cache_control");
    // Two runs produce structurally identical output (no Math.random etc.)
    expect(JSON.stringify(first.tools)).toBe(JSON.stringify(second.tools));
  });
});

describe("extractCacheStats — operator dashboard persona", () => {
  it("returns honest zeros when usage is undefined and no marker was attached", () => {
    const stats = extractCacheStats(undefined, false);
    expect(stats).toEqual({
      cacheControlAttached: false,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inputTokens: 0,
      cacheHitRate: 0,
    });
  });

  it("reports cacheControlAttached=true even when the API returned no cache fields (first call)", () => {
    // Simulates the first request after attaching a marker — API hasn't built
    // the cache yet, so cache_read=0 and cache_creation reflects writes.
    const usage = {
      input_tokens: 200,
      cache_creation_input_tokens: 1500,
      cache_read_input_tokens: 0,
      output_tokens: 300,
    } as unknown as Parameters<typeof extractCacheStats>[0];
    const stats = extractCacheStats(usage, true);
    expect(stats.cacheControlAttached).toBe(true);
    expect(stats.cacheCreationInputTokens).toBe(1500);
    expect(stats.cacheReadInputTokens).toBe(0);
    expect(stats.cacheHitRate).toBe(0);
  });

  it("computes hit rate correctly on a warm-cache call (cache_read > 0)", () => {
    const usage = {
      input_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 1500,
      output_tokens: 300,
    } as unknown as Parameters<typeof extractCacheStats>[0];
    const stats = extractCacheStats(usage, true);
    // hit rate = 1500 / (200 + 0 + 1500) = ~0.882
    expect(stats.cacheHitRate).toBeCloseTo(0.882, 2);
  });

  it("clamps cacheHitRate to [0,1] even when API returns absurd values (defensive)", () => {
    const usage = {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 99999,
      output_tokens: 0,
    } as unknown as Parameters<typeof extractCacheStats>[0];
    const stats = extractCacheStats(usage, true);
    // Even though numerator > denominator nominally, we accept the API's
    // reported counts and clamp to 1 so dashboards don't render >100%.
    expect(stats.cacheHitRate).toBeLessThanOrEqual(1);
    expect(stats.cacheHitRate).toBeGreaterThanOrEqual(0);
  });

  it("treats null cache fields as 0 (some SDK versions emit null instead of omitting)", () => {
    const usage = {
      input_tokens: 100,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      output_tokens: 50,
    } as unknown as Parameters<typeof extractCacheStats>[0];
    const stats = extractCacheStats(usage, true);
    expect(stats.cacheCreationInputTokens).toBe(0);
    expect(stats.cacheReadInputTokens).toBe(0);
  });
});

describe("scale + duration scenario — sustained tool-loop cache hits", () => {
  it("repeated buildCachedTools calls produce the SAME shape (no per-call drift)", () => {
    // Simulates a long-running agent that invokes runWithTools 1000 times in
    // a session — the helper must not accumulate state, mutate inputs, or
    // produce different cache placement across calls.
    const tools = makeTools(15, 80);
    const shapes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const r = buildCachedTools(tools);
      shapes.add(JSON.stringify(r.tools));
    }
    expect(shapes.size).toBe(1);
  });

  it("estimateTokens is pure under repeated invocation (no entropy)", () => {
    const sample = makeSystemPrompt(2048);
    const first = estimateTokens(sample);
    for (let i = 0; i < 100; i++) {
      expect(estimateTokens(sample)).toBe(first);
    }
  });
});
