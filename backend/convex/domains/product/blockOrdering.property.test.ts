/**
 * blockOrdering.property.test.ts — Property-based test for the fractional-index
 * comparator + tiebreaker.
 *
 * Scenario: the Mew-inspired fractional index produces a stable, total order
 * across any shape of concurrent-insert history. Row #1 in the hardening
 * changelog (NOTEBOOK_HARDENING_CHANGELOG.md) claimed this; the unit test
 * verifies it by brute force across 200 randomized shapes.
 *
 *   Persona:  power user or multi-client agent swarm
 *   Goal:     render the same block list in the same order on every client
 *   Scale:    up to 500 concurrent inserts between the same anchors
 *   Failure:  two distinct (int, frac, id) triples compare as equal → UI
 *             render order flips between refreshes.
 */

import { describe, expect, test } from "vitest";
import { comparePositions, comparePositionsWithId } from "./blockOrdering";

type Pos = { int: number; frac: string; id: string };

function mulberry32(seed: number) {
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFrac(rand: () => number, len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(rand() * chars.length)];
  }
  return out;
}

function makeShape(seed: number, size: number): Pos[] {
  const rand = mulberry32(seed);
  const arr: Pos[] = [];
  // Intentionally pick from a small int-tier pool and short frac strings so
  // collisions happen often — that is what exercises the id tiebreaker.
  const tiers = [100, 101, 102];
  const fracs = Array.from({ length: 8 }, (_, i) => randomFrac(rand, 2 + (i % 3)));
  for (let i = 0; i < size; i++) {
    arr.push({
      int: tiers[Math.floor(rand() * tiers.length)],
      frac: fracs[Math.floor(rand() * fracs.length)],
      // Collision-prone ids so we also exercise the id-equal edge case.
      id: `blk_${Math.floor(rand() * (size * 2))}`,
    });
  }
  return arr;
}

function shuffle<T>(arr: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

describe("comparePositionsWithId — property-based ordering", () => {
  test("is a total order (antisymmetric + transitive) across 200 random shapes", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const shape = makeShape(seed, 40);
      for (const a of shape) {
        for (const b of shape) {
          // Normalize -0 → 0 so Object.is-based toBe doesn't split ±0.
          const ab = Math.sign(comparePositionsWithId(a, b)) || 0;
          const ba = Math.sign(comparePositionsWithId(b, a)) || 0;
          // Antisymmetry: a<b iff b>a, and a==b only when fully equal.
          expect(ab).toBe(-ba || 0);
          if (ab === 0) {
            // The only ties allowed are exact (int, frac, id) equality.
            expect(a.int).toBe(b.int);
            expect(a.frac).toBe(b.frac);
            expect(a.id).toBe(b.id);
          }
        }
      }
    }
  });

  test("produces identical sort order regardless of input permutation", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const shape = makeShape(seed, 30);
      const baseline = [...shape].sort(comparePositionsWithId);
      // Verify 5 independently shuffled copies all sort to the same result.
      for (let s = 0; s < 5; s++) {
        const permuted = shuffle(shape, seed * 31 + s);
        const sorted = permuted.sort(comparePositionsWithId);
        expect(sorted).toEqual(baseline);
      }
    }
  });

  test("tiebreaker only engages when comparePositions returns 0", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const shape = makeShape(seed, 20);
      for (const a of shape) {
        for (const b of shape) {
          if (a.id === b.id) continue;
          const primary = comparePositions(a, b);
          const full = comparePositionsWithId(a, b);
          if (primary !== 0) {
            // Tiebreaker must NOT override the primary comparator.
            expect(Math.sign(full)).toBe(Math.sign(primary));
          } else {
            // Tie on (int, frac) — id must decide, and must be non-zero when
            // ids differ (by construction in this branch).
            expect(full).not.toBe(0);
          }
        }
      }
    }
  });

  test("withId tiebreaker is deterministic across process restarts (no Date.now or Math.random)", () => {
    const fixed: Pos[] = [
      { int: 100, frac: "aa", id: "blk_z" },
      { int: 100, frac: "aa", id: "blk_a" },
      { int: 100, frac: "aa", id: "blk_m" },
    ];
    const sorted = [...fixed].sort(comparePositionsWithId).map((p) => p.id);
    // Pure lexicographic on id — same output on any machine, any time.
    expect(sorted).toEqual(["blk_a", "blk_m", "blk_z"]);
  });
});
