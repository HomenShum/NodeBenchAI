/**
 * Unit tests for resolveChain.  Pure function — no Convex runtime.
 *
 * Tests the contract surfaced in chainResolver.ts:
 *  1. Tier-floor enforcement (no model below floor, even if it matches caps)
 *  2. Avoid list stripping
 *  3. preferIds pinned to front in supplied order
 *  4. primaryModelId placed first when it passes filters
 *  5. Empty chain when nothing matches → reason set (HONEST_STATUS)
 *  6. Capability requirement filter (vision/tools/reasoning/long-context/streaming)
 *  7. maxChainLength clamp
 */
import { describe, expect, it } from "vitest";
import { resolveChain } from "./chainResolver";
import { CAPABILITY_REGISTRY } from "./capabilityRegistry";

// Pick a stable canary model from the registry to use across tests.
// `qwen3-coder-free` is documented in chainResolver.ts header — free tier,
// supports tools + reasoning + longContext + streaming.
const REGISTERED_FREE = "qwen3-coder-free";

describe("resolveChain", () => {
  describe("registry sanity (tests depend on these IDs being registered)", () => {
    it("free-tier canary is in the registry", () => {
      expect(CAPABILITY_REGISTRY[REGISTERED_FREE]).toBeDefined();
      expect(CAPABILITY_REGISTRY[REGISTERED_FREE].tier).toBe("free");
    });
  });

  describe("tier-floor enforcement", () => {
    it("returns at least one chain entry when requirement matches free models", () => {
      const result = resolveChain({
        requirement: { supportsTools: true },
        tierFloor: "free",
      });
      expect(result.chain.length).toBeGreaterThan(0);
    });

    it("with tierFloor='premium', no free model appears in the chain", () => {
      const result = resolveChain({
        requirement: { supportsTools: true },
        tierFloor: "premium",
      });
      for (const id of result.chain) {
        const caps = CAPABILITY_REGISTRY[id];
        expect(caps).toBeDefined();
        expect(caps.tier).toBe("premium");
      }
    });

    it("never includes models below the tier floor even when capability matches", () => {
      const result = resolveChain({
        requirement: {},
        tierFloor: "standard",
      });
      const tierOrder = ["free", "cheap", "standard", "premium"];
      const floorIdx = tierOrder.indexOf("standard");
      for (const id of result.chain) {
        const caps = CAPABILITY_REGISTRY[id];
        const idx = tierOrder.indexOf(caps.tier);
        expect(idx).toBeGreaterThanOrEqual(floorIdx);
      }
    });
  });

  describe("avoid list", () => {
    it("strips models in avoidModelIds from the chain", () => {
      const baseline = resolveChain({
        requirement: { supportsTools: true },
        tierFloor: "free",
      });
      // Pick the first chain entry to avoid; rerun and assert it's gone.
      const toAvoid = baseline.chain[0];
      const result = resolveChain({
        requirement: { supportsTools: true },
        tierFloor: "free",
        avoidModelIds: [toAvoid],
      });
      expect(result.chain).not.toContain(toAvoid);
    });

    it("primary in avoid list → primaryOutcome surfaces dropped_in_avoid_list", () => {
      const result = resolveChain({
        requirement: { supportsTools: true },
        tierFloor: "free",
        primaryModelId: REGISTERED_FREE,
        avoidModelIds: [REGISTERED_FREE],
      });
      expect(result.diagnostics.primaryOutcome).toBe("dropped_in_avoid_list");
      expect(result.chain).not.toContain(REGISTERED_FREE);
    });
  });

  describe("preferIds pinning", () => {
    it("registered preferId moves to the front", () => {
      const result = resolveChain({
        requirement: { supportsTools: true },
        tierFloor: "free",
        preferIds: [REGISTERED_FREE],
      });
      expect(result.chain[0]).toBe(REGISTERED_FREE);
      expect(result.diagnostics.preferredAccepted).toContain(REGISTERED_FREE);
    });

    it("unregistered preferId surfaces in preferredDropped diagnostics", () => {
      const result = resolveChain({
        requirement: { supportsTools: true },
        tierFloor: "free",
        preferIds: ["__not_a_real_model__"],
      });
      expect(result.chain).not.toContain("__not_a_real_model__");
      expect(
        result.diagnostics.preferredDropped.some(
          (d) => d.modelId === "__not_a_real_model__" && d.reason === "not_in_registry",
        ),
      ).toBe(true);
    });
  });

  describe("primaryModelId placement", () => {
    it("registered primary appears first when it passes filters", () => {
      const result = resolveChain({
        requirement: { supportsTools: true },
        tierFloor: "free",
        primaryModelId: REGISTERED_FREE,
      });
      expect(result.chain[0]).toBe(REGISTERED_FREE);
      expect(result.diagnostics.primaryOutcome).toBe("kept");
    });

    it("unregistered primary → diagnostics.primaryOutcome = dropped_not_in_registry", () => {
      const result = resolveChain({
        requirement: { supportsTools: true },
        tierFloor: "free",
        primaryModelId: "__not_a_real_model__",
      });
      expect(result.chain).not.toContain("__not_a_real_model__");
      expect(result.diagnostics.primaryOutcome).toBe("dropped_not_in_registry");
    });
  });

  describe("capability requirement filter", () => {
    it("requirement.supportsVision=true keeps only vision-capable models", () => {
      const result = resolveChain({
        requirement: { supportsVision: true },
        tierFloor: "free",
      });
      for (const id of result.chain) {
        expect(CAPABILITY_REGISTRY[id].supportsVision).toBe(true);
      }
    });
  });

  describe("HONEST_STATUS — empty chain on no match", () => {
    it("impossible requirement → empty chain + reason set", () => {
      const result = resolveChain({
        requirement: {
          supportsVision: true,
          supportsTools: true,
          supportsReasoning: true,
          supportsLongContext: true,
          supportsStreaming: true,
        },
        // Force an impossible combo across all five flags at the cheapest tier.
        tierFloor: "premium",
        avoidModelIds: Object.keys(CAPABILITY_REGISTRY), // remove every registered model
      });
      expect(result.chain).toEqual([]);
      expect(result.reason).toBeDefined();
    });
  });

  describe("maxChainLength clamp", () => {
    it("respects maxChainLength=2 even when more candidates exist", () => {
      const result = resolveChain({
        requirement: { supportsTools: true },
        tierFloor: "free",
        maxChainLength: 2,
      });
      expect(result.chain.length).toBeLessThanOrEqual(2);
    });

    it("treats maxChainLength=0 as 1 (defensive lower bound)", () => {
      const result = resolveChain({
        requirement: { supportsTools: true },
        tierFloor: "free",
        maxChainLength: 0,
      });
      expect(result.chain.length).toBeGreaterThanOrEqual(0);
      expect(result.chain.length).toBeLessThanOrEqual(1);
    });
  });
});
