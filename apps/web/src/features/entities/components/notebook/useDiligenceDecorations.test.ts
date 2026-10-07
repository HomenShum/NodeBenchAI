/**
 * Tests for useDiligenceDecorations — the subscription→plugin dispatch bridge.
 *
 * Scenario: A notebook editor has the DiligenceDecorationPlugin registered.
 *           As useDiligenceBlocks emits new projections, this hook must:
 *             - keep a stable ref to the latest projections (so the plugin's
 *               getDecorations closure always sees current data)
 *             - fire exactly one meta-tagged transaction per real change
 *               (memo-keyed by {blockType, runId, version})
 *             - never touch the editor when `view` is null (pre-mount / teardown)
 *             - never touch a destroyed view
 *             - clear the ref on unmount so a remount starts clean
 *
 * Invariants under test:
 *   - buildDecorationsMemoKey stability for identical input
 *   - buildDecorationsMemoKey changes when any version bumps
 *   - Determinism: sort-stable across insertion order (DETERMINISTIC rule)
 */

import { describe, it, expect } from "vitest";
import { buildDecorationsMemoKey } from "./useDiligenceDecorations";
import type { DiligenceDecorationData } from "./DiligenceDecorationPlugin";

function make(overrides: Partial<DiligenceDecorationData>): DiligenceDecorationData {
  return {
    blockType: "founder",
    overallTier: "verified",
    headerText: "Founders",
    scratchpadRunId: "run_001",
    version: 1,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("buildDecorationsMemoKey", () => {
  it("returns 'empty' for an empty projection list", () => {
    expect(buildDecorationsMemoKey([])).toBe("empty");
  });

  it("keys only on {blockType, scratchpadRunId, version} — ignores updatedAt + headerText", () => {
    // Two entries with identical identity but different headerText + updatedAt
    const a = make({ headerText: "A", updatedAt: 1_700_000_000_000 });
    const b = make({ headerText: "B", updatedAt: 1_700_000_999_999 });
    expect(buildDecorationsMemoKey([a])).toBe(buildDecorationsMemoKey([b]));
  });

  it("key changes when version bumps (meaningful content change)", () => {
    const v1 = make({ version: 1 });
    const v2 = make({ version: 2 });
    expect(buildDecorationsMemoKey([v1])).not.toBe(buildDecorationsMemoKey([v2]));
  });

  it("key changes when scratchpadRunId changes (different run)", () => {
    const r1 = make({ scratchpadRunId: "run_001" });
    const r2 = make({ scratchpadRunId: "run_002" });
    expect(buildDecorationsMemoKey([r1])).not.toBe(buildDecorationsMemoKey([r2]));
  });

  it("key changes when blockType changes", () => {
    const f = make({ blockType: "founder" });
    const p = make({ blockType: "product" });
    expect(buildDecorationsMemoKey([f])).not.toBe(buildDecorationsMemoKey([p]));
  });

  it("is deterministic across insertion order (DETERMINISTIC rule)", () => {
    const a = make({ blockType: "founder", scratchpadRunId: "run_a" });
    const b = make({ blockType: "product", scratchpadRunId: "run_b" });
    // Same set, different order — same key.
    expect(buildDecorationsMemoKey([a, b])).toBe(buildDecorationsMemoKey([b, a]));
  });

  it("composite key is stable across multiple projections", () => {
    const first = [make({ version: 1 }), make({ blockType: "product", version: 1 })];
    const second = [make({ version: 1 }), make({ blockType: "product", version: 1 })];
    expect(buildDecorationsMemoKey(first)).toBe(buildDecorationsMemoKey(second));
  });

  it("key does not collide for ({runA, v1}+{runB, v1}) vs ({runA, v1}+{runB, v2})", () => {
    const setA = [
      make({ scratchpadRunId: "run_a", version: 1 }),
      make({ scratchpadRunId: "run_b", version: 1 }),
    ];
    const setB = [
      make({ scratchpadRunId: "run_a", version: 1 }),
      make({ scratchpadRunId: "run_b", version: 2 }),
    ];
    expect(buildDecorationsMemoKey(setA)).not.toBe(buildDecorationsMemoKey(setB));
  });
});
