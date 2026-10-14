// @vitest-environment node
/**
 * run-comprehensive-eval.ts is how a model candidate gets measured
 * (`--models <candidate> --suite full --judge ...`, SPEC-v9 A.2.10). Two ways it used
 * to mislead: a `--models` value the resolver did not know was silently served by the
 * default model (so "candidate X" measured kimi-k2.6), and its own retry could switch
 * models mid-row. These helpers are what makes the run abort and the row disqualify.
 * Pure functions; no Convex, no network, no spend.
 */

import { describe, expect, it } from "vitest";

import { identityViolations, unresolvedModels } from "../run-comprehensive-eval";

describe("unresolvedModels (--models must resolve or the run aborts)", () => {
  it("accepts approved ids and legacy aliases", () => {
    expect(unresolvedModels(["kimi-k2.6", "claude-sonnet-4.6", "gpt-4o-mini", "nemotron-3-super-free"])).toEqual([]);
  });

  it("flags ids the resolver does not know, including the removed minimax-m2.1", () => {
    expect(unresolvedModels(["kimi-k2.6", "minimax-m2.1", "claude-opus-9"])).toEqual(["minimax-m2.1", "claude-opus-9"]);
  });
});

describe("identityViolations (a row is evidence only for the model it requested)", () => {
  const row = (over: Record<string, unknown>) =>
    ({ model: "claude-sonnet-4.6", scenarioId: "s1", scenarioName: "s", passed: true, elapsed: 1, failureReasons: [], ...over }) as never;

  it("passes rows that resolved to the requested id without a retry switch", () => {
    expect(identityViolations([row({ resolvedModelId: "claude-sonnet-4.6", fallbackUsed: false })])).toEqual([]);
  });

  it("disqualifies a row whose resolved id differs from the request", () => {
    const bad = row({ resolvedModelId: "kimi-k2.6" });
    expect(identityViolations([row({ resolvedModelId: "claude-sonnet-4.6" }), bad])).toEqual([bad]);
  });

  it("disqualifies a row whose own retry switched models", () => {
    const bad = row({ resolvedModelId: "claude-sonnet-4.6", fallbackUsed: true });
    expect(identityViolations([bad])).toEqual([bad]);
  });
});
