/**
 * Drift guard: apps/web/src/shared/llm/approvedModels.ts is a hand-kept mirror of
 * backend/convex/domains/agents/mcp_tools/models/modelResolver.ts (Convex cannot import
 * from the web tree). The two had already drifted - MODEL_PRIORITY_ORDER had 16 entries
 * against the resolver's 24 - so the selector could offer or order models the backend
 * would route differently (SPEC-v9 A.2.10 PR 1). Failing here means one side was edited
 * without the other: regenerate the web side from the resolver, never loosen this test.
 */

import { describe, expect, it } from "vitest";

import * as web from "./approvedModels";
import { PIPELINE_MODEL_OPTIONS } from "./pipelineModelRoutes";
import * as backend from "../../../../../backend/convex/domains/agents/mcp_tools/models/modelResolver";
import { RefusedModelError } from "../../../../../shared/llm/modelCatalog";

describe("web approvedModels mirrors modelResolver", () => {
  it("lists the same approved ids in the same order", () => {
    expect([...web.APPROVED_MODELS]).toEqual([...backend.APPROVED_MODELS]);
  });

  it("has a UI row for every approved id, agreeing on provider and free status", () => {
    expect(Object.keys(web.MODEL_UI_INFO).sort()).toEqual([...backend.APPROVED_MODELS].sort());
    for (const id of backend.APPROVED_MODELS) {
      const ui = web.MODEL_UI_INFO[id];
      expect(ui.id, id).toBe(id);
      expect(ui.provider, `${id} provider`).toBe(backend.MODEL_SPECS[id].provider);
      expect(Boolean(ui.isFree), `${id} isFree`).toBe(backend.isFreeModel(id));
    }
  });

  it("agrees on the default, fallback and free-lane constants", () => {
    expect(web.DEFAULT_MODEL).toBe(backend.DEFAULT_MODEL);
    expect(web.FALLBACK_MODEL).toBe(backend.FALLBACK_MODEL);
    expect(web.MODEL_UI_INFO[backend.FREE_LANE_MODEL].isFree).toBe(true);
  });

  it("agrees on the priority order and the advisor/executor/background lanes", () => {
    expect(web.MODEL_PRIORITY_ORDER).toEqual(backend.MODEL_PRIORITY_ORDER);
    expect(web.NODEBENCH_ADVISOR_MODEL).toBe(backend.NODEBENCH_ADVISOR_MODEL);
    expect(web.NODEBENCH_EXECUTOR_MODELS).toEqual(backend.NODEBENCH_EXECUTOR_MODELS);
    expect(web.NODEBENCH_BACKGROUND_MODELS).toEqual(backend.NODEBENCH_BACKGROUND_MODELS);
  });

  it("normalizes every approved id to the same lane model, or refuses the same model on the same profile on both sides", () => {
    // A known model the profile does not allow is refused by both (Homen D1, PR #662 round 14); it used to
    // come back as the profile default on both, and this test compared those defaults. Round 15: the refusal
    // is compared as a refusal (the backend's RefusedModelError, and a web error that names the same model and
    // profile), not as "anything threw", so a TypeError on either side no longer matches.
    const run = (normalize: () => string) => {
      try {
        return { value: normalize() };
      } catch (error) {
        return { error };
      }
    };
    let refused = 0;
    for (const profile of ["advisor", "executor", "background"] as const) {
      for (const id of backend.APPROVED_MODELS) {
        const key = `${profile}/${id}`;
        const expected = run(() => backend.normalizeNodeBenchRuntimeModel(id, profile));
        const actual = run(() => web.normalizeNodeBenchRuntimeModel(id, profile));
        if ("value" in expected) {
          expect(actual, key).toEqual(expected);
          continue;
        }
        refused += 1;
        expect(expected.error, key).toBeInstanceOf(RefusedModelError);
        expect(actual.error, key).toBeInstanceOf(Error);
        expect(actual.error, key).not.toBeInstanceOf(TypeError);
        for (const error of [expected.error, actual.error] as Error[]) {
          expect(error.message, key).toContain(`"${id}"`);
          expect(error.message, key).toContain(`${profile} profile`);
        }
      }
    }
    expect(refused).toBeGreaterThan(0);
  });

  it("offers a signed-in user only models the advisor profile the panel sends accepts, and drops nothing else", () => {
    // Persona: a signed-in user opens the model picker, picks any option, and presses New chat or Send. The panel
    // sends the advisor profile (createThread; initiateAsyncStreaming with useCoordinator: true). 19 of the 44
    // approved models were offered and then refused (PR #662 round 14 made the refusal; the picker was not changed).
    const offered = web.getSelectableModelUIList("advisor").map((m) => m.id);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered).toContain(web.DEFAULT_MODEL);
    expect(offered).toContain(backend.FREE_LANE_MODEL);
    for (const id of offered) {
      expect(
        backend.normalizeFastAgentModel({ isAnonymous: false, requestedModel: id }, "advisor"),
        `offered ${id}`,
      ).toBe(id);
    }
    for (const id of backend.APPROVED_MODELS.filter((m) => !offered.includes(m))) {
      expect(
        () => backend.normalizeFastAgentModel({ isAnonymous: false, requestedModel: id }, "advisor"),
        `hidden ${id} is refused`,
      ).toThrow(RefusedModelError);
    }
  });

  it("pins every selector option, including the auto-free literal, to the backend route resolver", () => {
    // pipelineModelRoutes.ts types its resolved ids by hand. With getBestFreeModel reverted to
    // laguna, the web tests still passed and only modelResolver.test.ts failed; this closes that gap.
    for (const option of PIPELINE_MODEL_OPTIONS) {
      const resolved = backend.resolvePipelineModelSelection(option.value);
      expect(resolved.resolvedModelId, `${option.value} resolvedModelId`).toBe(option.resolvedModelId);
      expect(resolved.isFreeRoute, `${option.value} isFree`).toBe(option.isFree);
    }
  });
});
