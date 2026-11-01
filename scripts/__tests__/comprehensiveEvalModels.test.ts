// @vitest-environment node
/**
 * run-comprehensive-eval.ts is how a model candidate gets measured
 * (`--models <candidate> --suite full --judge ...`, SPEC-v9 A.2.10). Ways it used
 * to mislead: a `--models` value the resolver did not know was silently served by the
 * default model (so "candidate X" measured kimi-k2.6), a legacy alias such as
 * gpt-4o-mini was accepted and then every row was disqualified only after the paid
 * run finished, its own retry could switch models mid-row, and a row from a Convex
 * deployment built before the identity fields existed passed with no identity at all.
 * These helpers make the run abort before spending and the row disqualify.
 * Pure functions; no Convex, no network, no spend.
 */

import { describe, expect, it } from "vitest";

import { identityViolations, runSingleEpisode, unresolvableModels } from "../run-comprehensive-eval";

describe("unresolvableModels (--models aborts only on a value the resolver does not resolve)", () => {
  it("accepts approved ids", () => {
    expect(unresolvableModels(["kimi-k2.6", "claude-sonnet-4.6", "gpt-5.4-mini", "flint-v1-free"])).toEqual([]);
  });

  it("flags ids the resolver does not know, including the removed minimax-m2.1 and Object.prototype keys", () => {
    expect(unresolvableModels(["kimi-k2.6", "minimax-m2.1", "claude-opus-9", "constructor"])).toEqual(["minimax-m2.1", "claude-opus-9", "constructor"]);
  });

  // Round 6 (SPEC-v9 PR 1: abort only when a value "does not resolve"; Homen D1: CLI overrides are pass-through).
  // Round 5 pinned these two as refused because resolveModelAlias(m) !== m. Persona: an operator reruns an old
  // command line with --models gpt-4o-mini. It resolves, so the run starts; identityViolations (below) still
  // disqualifies every row that resolved to another id, so the alias can never pass as a receipt.
  it("lets a known alias through, as the operator typed it", () => {
    expect(unresolvableModels(["gpt-4o-mini", "claude-sonnet-4-5-20250929", "GPT-5.4-MINI"])).toEqual([]);
  });

  it("the alias run is still not evidence: its rows resolve to another id and are disqualified", () => {
    const aliasRow = { model: "gpt-4o-mini", resolvedModelId: "gpt-5.4-mini", fallbackUsed: false, scenarioId: "s1", scenarioName: "s", passed: true, elapsed: 1, failureReasons: [] } as never;
    expect(identityViolations([aliasRow])).toHaveLength(1);
  });
});

describe("identityViolations (a row is evidence only for the model it requested)", () => {
  const row = (over: Record<string, unknown>) =>
    ({ model: "claude-sonnet-4.6", scenarioId: "s1", scenarioName: "s", passed: true, elapsed: 1, failureReasons: [], ...over }) as never;

  it("passes rows that resolved to the requested id without a retry switch", () => {
    expect(identityViolations([row({ resolvedModelId: "claude-sonnet-4.6", fallbackUsed: false })])).toEqual([]);
  });

  it("disqualifies a row whose resolved id differs from the request", () => {
    const bad = row({ resolvedModelId: "kimi-k2.6", fallbackUsed: false });
    expect(identityViolations([row({ resolvedModelId: "claude-sonnet-4.6", fallbackUsed: false }), bad])).toEqual([bad]);
  });

  it("disqualifies a row whose own retry switched models", () => {
    const bad = row({ resolvedModelId: "claude-sonnet-4.6", fallbackUsed: true });
    expect(identityViolations([bad])).toEqual([bad]);
  });

  it("disqualifies a passing row with no resolved identity (a deployment built before the identity fields)", () => {
    // Before: a row without resolvedModelId counted as clean, so the run exited 0 with no per-row identity.
    const old = row({});
    const empty = row({ resolvedModelId: "", fallbackUsed: false });
    expect(identityViolations([old, empty])).toEqual([old, empty]);
  });

  it("disqualifies a row with an identity but no explicit fallback status", () => {
    const bad = row({ resolvedModelId: "claude-sonnet-4.6" });
    expect(identityViolations([bad])).toEqual([bad]);
  });
});

describe("runSingleEpisode keeps identity on an error row", () => {
  const scenario = { id: "s1", name: "s", query: "q", expectedPersona: "p", evalSuite: "core" } as never;

  it("records resolvedModelId and fallbackUsed when the retry throws after the first attempt answered", async () => {
    let calls = 0;
    const client = {
      action: async () => {
        calls += 1;
        if (calls === 1) return { resolvedModelId: "kimi-k2.6", runs: [{ ok: false, responseText: "", failureReasons: [] }] };
        throw new Error("boom");
      },
    } as never;
    const row = await runSingleEpisode(client, "secret", "kimi-k2.6", scenario, "core", false, "kimi-k2.6");
    expect(row.error).toBe("boom");
    // The first attempt's identity and the retry's model switch survive the exception.
    expect(row.resolvedModelId).toBe("kimi-k2.6");
    expect(row.fallbackUsed).toBe(true);
    expect(identityViolations([row])).toEqual([row]);
  });

  it("reports an explicit fallbackUsed=false even when the very first call throws", async () => {
    const client = { action: async () => { throw new Error("down"); } } as never;
    const row = await runSingleEpisode(client, "secret", "kimi-k2.6", scenario, "core", false, "kimi-k2.6");
    expect(row.fallbackUsed).toBe(false);
    expect(row.resolvedModelId).toBeUndefined();
    expect(identityViolations([row])).toEqual([row]);
  });
});
