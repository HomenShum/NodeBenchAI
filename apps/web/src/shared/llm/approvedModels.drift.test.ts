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

  it("normalizes every approved id to the same lane model, or refuses it on both sides", () => {
    // A known model the profile does not allow is refused by both (Homen D1, PR #662 round 14); it used to
    // come back as the profile default on both, and this test compared those defaults.
    const outcome = (normalize: () => string) => {
      try {
        return normalize();
      } catch (error) {
        void error;
        return "refused";
      }
    };
    let refused = 0;
    for (const profile of ["advisor", "executor", "background"] as const) {
      for (const id of backend.APPROVED_MODELS) {
        const expected = outcome(() => backend.normalizeNodeBenchRuntimeModel(id, profile));
        if (expected === "refused") refused += 1;
        expect(outcome(() => web.normalizeNodeBenchRuntimeModel(id, profile)), `${profile}/${id}`).toBe(expected);
      }
    }
    expect(refused).toBeGreaterThan(0);
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
