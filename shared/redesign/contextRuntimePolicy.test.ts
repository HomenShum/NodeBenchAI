import { describe, expect, it } from "vitest";
import { decideLiveGrounding } from "./contextRuntimePolicy";

describe("decideLiveGrounding", () => {
  it("keeps memory-first recall off live search when selected context is sufficient", () => {
    const decision = decideLiveGrounding({
      prompt: "Have I seen Orbital Labs before?",
      hasContext: true,
      memoryHit: true,
      sourceCacheHit: true,
      selectedContextCount: 3,
      sourceRefCount: 2,
    });

    expect(decision.useLiveGrounding).toBe(false);
    expect(decision.memorySufficient).toBe(true);
    expect(decision.reason).toMatch(/Memory-first/i);
  });

  it("enables live grounding for freshness requests even when memory exists", () => {
    const decision = decideLiveGrounding({
      prompt: "What happened with OpenAI today?",
      hasContext: true,
      memoryHit: true,
      sourceCacheHit: true,
      selectedContextCount: 3,
      sourceRefCount: 2,
    });

    expect(decision.useLiveGrounding).toBe(true);
    expect(decision.freshnessIntent).toBe(true);
  });

  it("enables live grounding when no selected context is attached", () => {
    const decision = decideLiveGrounding({
      prompt: "Research Noho Labs for a founder call",
      hasContext: false,
      memoryHit: false,
      sourceCacheHit: false,
      selectedContextCount: 0,
      sourceRefCount: 0,
    });

    expect(decision.useLiveGrounding).toBe(true);
    expect(decision.signals).toContain("no_context");
  });

  // Real bug found via live proofloop runs (docs/ACCOUNTING-FR-A1-BANK-RECONCILIATION.md,
  // docs/ACCOUNTING-FR-A4-JOURNAL-ENTRY.md): a bank-reconciliation/journal-entry question asked
  // inside a "Daily Brief" thread whose cached sources are unrelated tech/markets articles was
  // getting memorySufficient=true purely on structural signals (>=2 cached refs), so it skipped
  // live grounding and answered against sources that had nothing to do with the actual numbers.
  it("forces live grounding for a reconciliation request even when the thread's cached context looks structurally sufficient", () => {
    const decision = decideLiveGrounding({
      prompt:
        "I need to reconcile my bank statement and general ledger. Bank statement ending balance is $12,540.75. General ledger ending balance is $12,128.25. There is one outstanding item: check #1042 for $412.50 has not cleared yet. Please reconcile these two balances and tell me whether they tie out, showing your math.",
      hasContext: true,
      memoryHit: true,
      sourceCacheHit: true,
      selectedContextCount: 4,
      sourceRefCount: 6, // matches the live bug: 6 cached refs, all topically irrelevant
    });

    expect(decision.useLiveGrounding).toBe(true);
    expect(decision.signals.some((s) => /reconcil/i.test(s))).toBe(true);
  });

  it("forces live grounding for a journal-entry request even when memory-first phrasing is also present", () => {
    const decision = decideLiveGrounding({
      prompt:
        "Based on the report, propose the journal entry for a $5,000 deferred revenue cash receipt and confirm debits equal credits.",
      hasContext: true,
      memoryHit: true,
      sourceCacheHit: true,
      selectedContextCount: 4,
      sourceRefCount: 6,
    });

    expect(decision.useLiveGrounding).toBe(true);
  });

  it("does not force live grounding for an ordinary funding-news question that merely mentions a dollar amount", () => {
    const decision = decideLiveGrounding({
      prompt: "Have I seen that Rogo's total disclosed funding is $160M before?",
      hasContext: true,
      memoryHit: true,
      sourceCacheHit: true,
      selectedContextCount: 3,
      sourceRefCount: 2,
    });

    expect(decision.useLiveGrounding).toBe(false);
  });
});
