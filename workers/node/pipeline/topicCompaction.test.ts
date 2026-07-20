/**
 * Scenario tests for topicCompaction — layered memory L2 compaction.
 *
 * Personas:
 *   - First-time compaction (cold start): founder block has 3 facts
 *   - Repeat run: same 3 facts re-observed → unchanged verdict
 *   - Repeat + new: 2 new facts arrive → updated verdict, added=2
 *   - Bounded: >200 facts → status="bounded", droppedToCap > 0
 *   - Adversarial: duplicate fact text with different sourceRefId → kept as 2 rows
 *   - Adversarial: whitespace-varying fact text → normalized to same key
 *   - Long-running: 1000 sequential compactions stay deterministic + bounded
 *   - Drift: entity version advanced mid-run → caller must re-run
 */

import { describe, it, expect } from "vitest";
import {
  compactTopic,
  isEntityVersionStale,
  buildOneLineSummary,
  type CompactionFact,
  type TopicFileContent,
} from "./topicCompaction";

function mkFact(
  text: string,
  observedAt = 1_000,
  sourceRefId?: string,
): CompactionFact {
  return { text, observedAt, sourceRefId };
}

describe("compactTopic — cold start (first run)", () => {
  it("no existing content → status='created' with sorted facts", () => {
    const v = compactTopic({
      topicName: "founder",
      existing: null,
      newFacts: [
        mkFact("Jane Doe is CEO", 2_000),
        mkFact("John Smith is CTO", 1_500),
        mkFact("Both ex-Google", 3_000),
      ],
      compactedAtMs: 5_000,
    });
    expect(v.status).toBe("created");
    if (v.status !== "created") throw new Error("unreachable");
    expect(v.newContent.facts).toHaveLength(3);
    // Sorted newest first (observedAt 3000 → 2000 → 1500)
    expect(v.newContent.facts[0].text).toBe("Both ex-Google");
    expect(v.newContent.facts[1].text).toBe("Jane Doe is CEO");
    expect(v.newContent.facts[2].text).toBe("John Smith is CTO");
    expect(v.newContent.schemaVersion).toBe(1);
  });

  it("empty new facts on cold start → status='created' with empty content", () => {
    const v = compactTopic({
      topicName: "patent",
      existing: null,
      newFacts: [],
      compactedAtMs: 1_000,
    });
    expect(v.status).toBe("created");
  });

  it("cold start with > 200 facts → status='bounded' droppedToCap > 0", () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      mkFact(`fact-${i}`, 1000 + i),
    );
    const v = compactTopic({
      topicName: "news",
      existing: null,
      newFacts: many,
      compactedAtMs: 1_000,
    });
    expect(v.status).toBe("bounded");
    if (v.status !== "bounded") throw new Error("unreachable");
    expect(v.newContent.facts).toHaveLength(200);
    expect(v.droppedToCap).toBe(50);
    // Newest-first bound: the 200 kept are observedAt 1249 → 1050.
    expect(v.newContent.facts[0].observedAt).toBe(1249);
  });
});

describe("compactTopic — repeat run (idempotency + merge)", () => {
  const existing: TopicFileContent = {
    topicName: "founder",
    facts: [
      mkFact("Jane is CEO", 2_000),
      mkFact("John is CTO", 1_500),
    ],
    oneLineSummary: "founder · 2 facts · \"Jane is CEO\"",
    compactedAt: 2_500,
    schemaVersion: 1,
  };

  it("same facts re-observed at SAME observedAt → status='unchanged'", () => {
    const v = compactTopic({
      topicName: "founder",
      existing,
      newFacts: [mkFact("Jane is CEO", 2_000), mkFact("John is CTO", 1_500)],
      compactedAtMs: 5_000,
    });
    expect(v.status).toBe("unchanged");
  });

  it("same facts with LATER observedAt → status='updated' (timestamp bumped)", () => {
    const v = compactTopic({
      topicName: "founder",
      existing,
      newFacts: [mkFact("Jane is CEO", 10_000)],
      compactedAtMs: 10_500,
    });
    expect(v.status).toBe("updated");
    if (v.status !== "updated") throw new Error("unreachable");
    expect(v.added).toBe(0);
    // Jane's timestamp bumped to 10_000, so she's now newest.
    expect(v.newContent.facts[0].text).toBe("Jane is CEO");
    expect(v.newContent.facts[0].observedAt).toBe(10_000);
  });

  it("new facts arrive → status='updated' with added count", () => {
    const v = compactTopic({
      topicName: "founder",
      existing,
      newFacts: [
        mkFact("Raised $25M seed", 3_000),
        mkFact("HQ in Palo Alto", 2_500),
      ],
      compactedAtMs: 3_500,
    });
    expect(v.status).toBe("updated");
    if (v.status !== "updated") throw new Error("unreachable");
    expect(v.added).toBe(2);
    expect(v.newContent.facts).toHaveLength(4);
  });

  it("running compaction TWICE with same input is idempotent", () => {
    const first = compactTopic({
      topicName: "founder",
      existing,
      newFacts: [mkFact("Raised $25M seed", 3_000)],
      compactedAtMs: 3_500,
    });
    expect(first.status).toBe("updated");
    if (first.status !== "updated") throw new Error("unreachable");
    const second = compactTopic({
      topicName: "founder",
      existing: first.newContent,
      newFacts: [mkFact("Raised $25M seed", 3_000)],
      compactedAtMs: 3_600,
    });
    expect(second.status).toBe("unchanged");
  });
});

describe("compactTopic — dedup + normalization", () => {
  it("whitespace-varying fact text dedups to same key", () => {
    const v = compactTopic({
      topicName: "product",
      existing: null,
      newFacts: [
        mkFact("Launched   v2.0  " /* extra whitespace */, 1_000),
        mkFact("Launched v2.0", 2_000), // canonical
      ],
      compactedAtMs: 5_000,
    });
    expect(v.status).toBe("created");
    if (v.status !== "created") throw new Error("unreachable");
    expect(v.newContent.facts).toHaveLength(1);
    // Both reduce to the same key → whichever arrived later wins in Map.set.
  });

  it("same text with different sourceRefId → kept as 2 separate facts", () => {
    const v = compactTopic({
      topicName: "funding",
      existing: null,
      newFacts: [
        mkFact("Raised $25M", 1_000, "src-crunchbase"),
        mkFact("Raised $25M", 1_000, "src-techcrunch"),
      ],
      compactedAtMs: 2_000,
    });
    if (v.status !== "created") throw new Error("unreachable");
    expect(v.newContent.facts).toHaveLength(2);
  });

  it("empty string fact filtered out", () => {
    const v = compactTopic({
      topicName: "founder",
      existing: null,
      newFacts: [mkFact(""), mkFact("   "), mkFact("real fact", 100)],
      compactedAtMs: 500,
    });
    if (v.status !== "created") throw new Error("unreachable");
    expect(v.newContent.facts).toHaveLength(1);
    expect(v.newContent.facts[0].text).toBe("real fact");
  });

  it("overly long fact truncated at 800 chars", () => {
    const long = "x".repeat(1500);
    const v = compactTopic({
      topicName: "news",
      existing: null,
      newFacts: [mkFact(long, 1_000)],
      compactedAtMs: 2_000,
    });
    if (v.status !== "created") throw new Error("unreachable");
    expect(v.newContent.facts[0].text.length).toBe(800);
  });
});

describe("compactTopic — long-running + determinism", () => {
  it("DETERMINISTIC: identical inputs produce identical TopicFileContent", () => {
    const facts = [mkFact("a", 100), mkFact("b", 200), mkFact("c", 150)];
    const a = compactTopic({
      topicName: "founder",
      existing: null,
      newFacts: facts,
      compactedAtMs: 1000,
    });
    const b = compactTopic({
      topicName: "founder",
      existing: null,
      newFacts: facts,
      compactedAtMs: 1000,
    });
    expect(a).toEqual(b);
  });

  it("1000 sequential compactions stay bounded AND deterministic", () => {
    let state: TopicFileContent | null = null;
    for (let i = 0; i < 1000; i++) {
      const v = compactTopic({
        topicName: "news",
        existing: state,
        newFacts: [mkFact(`iteration ${i}`, 1_000 + i)],
        compactedAtMs: 2_000 + i,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state = (v as any).newContent ?? state;
    }
    expect(state).not.toBeNull();
    expect(state!.facts.length).toBeLessThanOrEqual(200);
    expect(state!.facts.length).toBe(200); // cap reached
    // Newest kept: iteration 999 (observedAt 1999).
    expect(state!.facts[0].text).toBe("iteration 999");
  });
});

describe("isEntityVersionStale — drift detection", () => {
  it("same version → not stale", () => {
    expect(
      isEntityVersionStale({
        scratchpadEntityVersion: 5,
        currentEntityVersion: 5,
      }),
    ).toBe(false);
  });

  it("current advanced → stale (caller must re-run)", () => {
    expect(
      isEntityVersionStale({
        scratchpadEntityVersion: 5,
        currentEntityVersion: 7,
      }),
    ).toBe(true);
  });

  it("scratchpad newer than current (impossible in practice) → not stale", () => {
    expect(
      isEntityVersionStale({
        scratchpadEntityVersion: 10,
        currentEntityVersion: 5,
      }),
    ).toBe(false);
  });
});

describe("buildOneLineSummary — MEMORY.md index row", () => {
  it("empty facts → 'no facts yet'", () => {
    expect(buildOneLineSummary("founder", [])).toBe("founder: no facts yet");
  });

  it("format matches layered_memory.md guidance (< 200 chars, scannable)", () => {
    const s = buildOneLineSummary("patent", [mkFact("USPTO granted 2024", 100)]);
    expect(s).toContain("patent");
    expect(s).toContain("1 fact");
    expect(s).toContain("USPTO granted 2024");
    expect(s.length).toBeLessThan(200);
  });

  it("pluralization: 1 vs 3 facts", () => {
    const one = buildOneLineSummary("founder", [mkFact("a", 1)]);
    const three = buildOneLineSummary("founder", [
      mkFact("a", 1),
      mkFact("b", 2),
      mkFact("c", 3),
    ]);
    expect(one).toContain("1 fact ");
    expect(three).toContain("3 facts ");
  });

  it("very long headline fact → truncated at 120 chars", () => {
    const long = "x".repeat(500);
    const s = buildOneLineSummary("news", [mkFact(long, 1)]);
    // "news · 1 fact · \"" is 18 chars, plus 120 chars of text plus '"'
    expect(s.length).toBeLessThanOrEqual(18 + 120 + 1);
  });
});
