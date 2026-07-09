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

  // Real bug found live (docs/ACCOUNTING-FR-A1-RERUN-FULL-PASS.md thread): an AR-aging question
  // phrased with "show your calculation" (not "math"/"work") and no explicit reconcile/journal-entry
  // keyword only got routed correctly by ACCIDENT -- "today's date" in the prompt happened to also
  // trip FRESHNESS_PATTERNS. Without a freshness word present, this shape would fall through to the
  // same irrelevant-cache bug the calculation gate was built to fix.
  it("forces live grounding for an AR aging question with no freshness wording present", () => {
    const decision = decideLiveGrounding({
      prompt:
        "I need an AR aging analysis. We have an invoice for $3,200 issued on 2026-05-15, with payment terms of Net 30. As of 2026-07-01, which aging bucket does this invoice fall into, and exactly how many days past due is it? Please show your calculation.",
      hasContext: true,
      memoryHit: true,
      sourceCacheHit: true,
      selectedContextCount: 4,
      sourceRefCount: 6,
    });

    expect(decision.useLiveGrounding).toBe(true);
    expect(decision.freshnessIntent).toBe(false); // confirms it's the calculation gate firing, not freshness luck
  });

  it("does not force live grounding for an ordinary earnings headline that happens to contain 'net' near a number", () => {
    const decision = decideLiveGrounding({
      prompt: "Have I seen that Acme's net income rose to $30M in the reported quarter?",
      hasContext: true,
      memoryHit: true,
      sourceCacheHit: true,
      selectedContextCount: 3,
      sourceRefCount: 2,
    });

    expect(decision.useLiveGrounding).toBe(false);
  });
});
