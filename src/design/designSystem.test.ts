/**
 * Scenario-based tests for the NodeBench AI-surface design system.
 *
 * Personas exercised:
 *   - A coding agent reading the manifest before deciding how to migrate a component.
 *   - A CI design-drift gate auditing the AI-surface file set on every PR.
 *   - An adversarial input path (thousands of violations) that must stay bounded.
 */

import { describe, expect, it } from "vitest";
import {
  auditAiSurfaceDesign,
  getNodeBenchAiDesignManifest,
  nbAccent,
  nbRadiusScalePx,
  nbSemantic,
  nbTypeScalePx,
  aiSurfaceRoots,
  type AiPrimitiveAdoption,
} from "./designSystem";

const ALLOWED_ADOPTION: AiPrimitiveAdoption[] = [
  "migrated",
  "wrapped",
  "scaffolded",
  "planned",
  "keep_custom_boundary",
];

const AT = "2026-07-14T00:00:00.000Z"; // fixed timestamp — determinism

describe("Scenario: a coding agent reads the manifest before migrating", () => {
  const m = getNodeBenchAiDesignManifest();

  it("is well-formed and self-describing", () => {
    expect(m.apiVersion).toBe(1);
    expect(m.type).toBe("nodebench.ai-surface.design-system.manifest");
    expect(m.data.principles.length).toBeGreaterThanOrEqual(5);
    expect(m.data.primitives.length).toBeGreaterThan(0);
    expect(m.data.auditChecks.length).toBeGreaterThan(0);
  });

  it("gives every primitive an actionable role + must/avoid + a valid adoption status", () => {
    for (const p of m.data.primitives) {
      expect(p.primitive, "primitive name").toBeTruthy();
      expect(p.role.length, `${p.primitive} role`).toBeGreaterThan(10);
      expect(p.must.length, `${p.primitive} must`).toBeGreaterThan(0);
      expect(p.avoid.length, `${p.primitive} avoid`).toBeGreaterThan(0);
      expect(ALLOWED_ADOPTION, `${p.primitive} adoption`).toContain(p.adoption);
      expect(p.consumers.length, `${p.primitive} consumers`).toBeGreaterThan(0);
    }
  });

  it("encodes the honesty contract as a principle (agents must not fixture live streams)", () => {
    const joined = m.data.principles.join(" ").toLowerCase();
    expect(joined).toContain("honesty contract");
    expect(joined).toContain("never replace a live part with a fixture");
  });

  it("scopes governance to the AI surface, not the whole app", () => {
    expect(aiSurfaceRoots).toContain("src/components/ai-elements");
    expect(aiSurfaceRoots).toContain("src/features/agents/components/ai");
    expect(aiSurfaceRoots).toContain("src/features/agents/components/FastAgentPanel");
  });

  it("records the current migration scoreboard without closing the 56-file program", () => {
    expect(m.data.migration).toMatchObject({
      matrixFiles: 56,
      totalMilestones: 26,
      completedMilestones: 11,
      status: "ongoing",
      canonicalMainThrough: { pullRequest: 527, commit: "28d704b2" },
    });
    expect(m.data.migration.completedUnits).toHaveLength(11);
    expect(m.data.migration.completedUnits).toContain("UIMessageBubble");
    expect(m.data.migration.completedUnits).toContain("InputBar");
    expect(m.data.migration.completedUnits).toContain("LiveEventCard");
    expect(m.data.migration.countingRule).toContain("8 migrate, 17 wrap");
    expect(m.data.migration.countingRule).toContain("HumanRequestCard");
  });

  it("marks the merged live adapters and the non-live progress shell honestly", () => {
    const byPrimitive = new Map(m.data.primitives.map((rule) => [rule.primitive, rule]));
    expect(byPrimitive.get("message + reasoning + tool + sources")?.adoption).toBe("wrapped");
    expect(byPrimitive.get("prompt-input + context + model-selector")?.adoption).toBe("wrapped");
    expect(byPrimitive.get("tool")?.adoption).toBe("migrated");
    expect(byPrimitive.get("tool + task connector")?.adoption).toBe("migrated");

    const progress = byPrimitive.get("task + chain-of-thought + reasoning + tool");
    expect(progress?.adoption).toBe("wrapped");
    expect(progress?.must.join(" ").toLowerCase()).toContain("not a live-surface claim");
  });
});

describe("Scenario: token integrity — terracotta selection, green reserved", () => {
  it("keeps terracotta as the accent and success-green distinct from it", () => {
    expect(nbAccent.primary.toLowerCase()).toBe("#d97757");
    // Green must never equal the selection accent (design principle).
    expect(nbSemantic.success).not.toBe(nbAccent.primary);
  });

  it("exposes ascending, non-empty type + radius scales", () => {
    for (const scale of [nbTypeScalePx, nbRadiusScalePx]) {
      expect(scale.length).toBeGreaterThan(3);
      const arr = [...scale];
      expect(arr).toEqual([...arr].sort((a, b) => a - b));
    }
  });
});

describe("Scenario: CI design-drift gate audits the AI surface", () => {
  it("passes a clean, on-brand file (ok, zero high findings)", () => {
    const clean = {
      "src/components/ai-elements/message.tsx":
        'export const M = () => <div className="bg-surface text-content border-edge ring-ring">ok</div>;',
    };
    const res = auditAiSurfaceDesign(clean, AT);
    expect(res.ok).toBe(true);
    expect(res.summary.high).toBe(0);
    expect(res.summary.files).toBe(1);
    expect(res.checkedAt).toBe(AT);
  });

  it("catches drift: a saturated color + a hardcoded indigo focus ring", () => {
    const dirty = {
      "src/features/agents/components/ai/Bad.tsx":
        'export const B = () => <button className="bg-red-500 ring-indigo-500">x</button>;',
    };
    const res = auditAiSurfaceDesign(dirty, AT);
    expect(res.findings.length).toBeGreaterThan(0);
    // Every finding is attributed to a file so the gate can point at it.
    for (const f of res.findings) expect(f.file).toBe("src/features/agents/components/ai/Bad.tsx");
    const matches = res.findings.map((f) => f.match).join(" ");
    expect(matches).toContain("bg-red-500");
    expect(matches).toContain("ring-indigo-500");
  });
});

describe("Scenario: adversarial + long-running — the audit stays bounded and deterministic", () => {
  it("caps findings under a pathological input (BOUND) instead of ballooning", () => {
    // 2,000 files, each packed with violations — simulates a runaway scan.
    const flood: Record<string, string> = {};
    const line = 'className="bg-red-500 bg-blue-500 text-green-600 ring-indigo-500"';
    for (let i = 0; i < 2000; i++) {
      flood[`src/components/ai-elements/f${i}.tsx`] = `${line}\n`.repeat(20);
    }
    const res = auditAiSurfaceDesign(flood, AT);
    expect(res.findings.length).toBeGreaterThan(0); // drift was found
    expect(res.findings.length).toBeLessThanOrEqual(500); // but bounded
    expect(res.summary.medium).toBeGreaterThan(0); // saturated classes are medium
    // `ok` invariant: true iff zero HIGH-severity drift (matches lint:design exit code).
    expect(res.ok).toBe(res.summary.high === 0);
  });

  it("gates ok=false on HIGH-severity drift (ALL CAPS tracking-widest)", () => {
    // defaultSpec.ts's high-severity pattern (the canonical source auditAiSurfaceDesign uses).
    const highDrift = {
      "src/components/ai-elements/x.tsx": '<span className="uppercase tracking-widest">X</span>',
    };
    const res = auditAiSurfaceDesign(highDrift, AT);
    expect(res.summary.high).toBeGreaterThan(0);
    expect(res.ok).toBe(false);
  });

  it("is deterministic: same input + timestamp → identical result", () => {
    const files = {
      "b.tsx": 'className="bg-red-500"',
      "a.tsx": 'className="ring-indigo-500"',
    };
    const r1 = auditAiSurfaceDesign(files, AT);
    const r2 = auditAiSurfaceDesign(files, AT);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    // Files scanned in sorted order → "a.tsx" findings precede "b.tsx".
    const firstFile = r1.findings[0]?.file;
    expect(firstFile).toBe("a.tsx");
  });
});
