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

import { identityViolations, nonCanonicalModels, runSingleEpisode } from "../run-comprehensive-eval";

describe("nonCanonicalModels (--models must be an approved id exactly, or the run aborts before spending)", () => {
  it("accepts approved ids", () => {
    expect(nonCanonicalModels(["kimi-k2.6", "claude-sonnet-4.6", "gpt-5.4-mini", "nemotron-3-super-free"])).toEqual([]);
  });

  it("flags ids the resolver does not know, including the removed minimax-m2.1", () => {
    expect(nonCanonicalModels(["kimi-k2.6", "minimax-m2.1", "claude-opus-9"])).toEqual(["minimax-m2.1", "claude-opus-9"]);
  });

  it("flags a legacy alias, which resolves to a different id and would disqualify every row after the paid run", () => {
    // gpt-4o-mini resolves to gpt-5.4-mini; the previous check (resolveModelAlias(m) === null) accepted it.
    expect(nonCanonicalModels(["gpt-4o-mini", "GPT-5.4-MINI"])).toEqual(["gpt-4o-mini", "GPT-5.4-MINI"]);
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
