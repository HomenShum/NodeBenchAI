import { describe, expect, it } from "vitest";
import { CENT_TOLERANCE, extractBankReconciliationFact } from "./bankReconciliationFactExtractor";

describe("extractBankReconciliationFact", () => {
  // Real bug shape from the live proofloop run (docs/ACCOUNTING-FR-A4-JOURNAL-ENTRY.md,
  // "CORRECTION" section): bank $12,540.75, ledger $12,128.25, outstanding
  // check #1042 $412.50. 12,540.75 - 412.50 = 12,128.25 -- ties out exactly.
  it("computes a matching reconciliation and injects the real arithmetic", () => {
    const prompt =
      "I need to reconcile my bank statement and general ledger. Bank statement ending balance is " +
      "$12,540.75. General ledger ending balance is $12,128.25. There is one outstanding item: check " +
      "#1042 for $412.50 has not cleared yet. Please reconcile these two balances and tell me whether " +
      "they tie out, showing your math.";

    const result = extractBankReconciliationFact(prompt);

    expect(result).not.toBeNull();
    expect(result!.bankBalance).toBe(12540.75);
    expect(result!.ledgerBalance).toBe(12128.25);
    expect(result!.outstandingItem).toBe(412.5);
    expect(result!.reconciledBalance).toBeCloseTo(12128.25, 2);
    expect(result!.tiesOut).toBe(true);
    expect(result!.delta).toBeLessThanOrEqual(0.005);
    expect(result!.fact).toContain("VERIFIED_CALCULATION");
    expect(result!.fact).toContain("12540.75");
    expect(result!.fact).toContain("412.50");
    expect(result!.fact).toContain("12128.25");
    expect(result!.fact).toMatch(/MATCHES/);
    expect(result!.fact).not.toMatch(/DOES NOT MATCH/);
  });

  // Same shape, but the numbers genuinely don't tie -- the extractor must
  // report the real (failing) arithmetic, not silently suppress it or flip
  // it to "matches." Injection happens either way; the value is showing the
  // truth, not manufacturing a tie.
  it("computes a non-matching reconciliation and reports the real discrepancy", () => {
    const prompt =
      "Please reconcile the bank statement and general ledger. Bank balance is $10,000.00. Ledger " +
      "balance is $9,000.00. There is one outstanding check for $500.00 that has not cleared. Tell me " +
      "if these tie out.";

    const result = extractBankReconciliationFact(prompt);

    expect(result).not.toBeNull();
    expect(result!.bankBalance).toBe(10000);
    expect(result!.ledgerBalance).toBe(9000);
    expect(result!.outstandingItem).toBe(500);
    expect(result!.reconciledBalance).toBe(9500);
    expect(result!.tiesOut).toBe(false);
    expect(result!.delta).toBeCloseTo(500, 2);
    expect(result!.fact).toMatch(/DOES NOT MATCH/);
  });

  it("absorbs IEEE-754 float noise as a tie (documented CENT_TOLERANCE)", () => {
    // 0.30 - 0.10 === 0.19999999999999998 in IEEE-754 floats, not exactly 0.20
    // (see e.g. the classic 0.1 + 0.2 float-repr example) -- the half-cent
    // tolerance must absorb that noise rather than report a false discrepancy.
    const prompt =
      "Reconcile: bank balance is $0.30. Ledger balance is $0.20. Outstanding check for $0.10 has not cleared. " +
      "Do they tie out?";
    const result = extractBankReconciliationFact(prompt);
    expect(result).not.toBeNull();
    expect(result!.reconciledBalance).not.toBe(0.2); // the float noise is real
    expect(result!.delta).toBeLessThan(CENT_TOLERANCE);
    expect(result!.tiesOut).toBe(true);
    expect(result!.fact).toContain("0.20"); // money() rendering still shows the clean cent value
  });

  describe("ambiguous shapes -- must return null, never a guessed fact", () => {
    it("does not trigger when only 2 dollar amounts are present (no outstanding item)", () => {
      const prompt =
        "Bank balance is $500.00 and ledger balance is $480.00. Please reconcile and tell me if they tie out.";
      expect(extractBankReconciliationFact(prompt)).toBeNull();
    });

    it("does not trigger when 3 amounts are present but none are tagged with a recognizable role keyword", () => {
      const prompt =
        "First figure is $500.00. Second figure is $480.00. Third figure is $20.00. Please reconcile and " +
        "confirm whether these tie out.";
      expect(extractBankReconciliationFact(prompt)).toBeNull();
    });

    it("does not trigger when all 3 amounts are crammed into a single run-on clause", () => {
      const prompt =
        "Can you reconcile these numbers for me: bank $500.00, ledger $480.00, outstanding $20.00? Do they tie out?";
      expect(extractBankReconciliationFact(prompt)).toBeNull();
    });

    it("does not trigger when a role keyword is duplicated across two amounts (ambiguous which is real)", () => {
      const prompt =
        "Reconcile these balances. Bank balance is $500.00. Bank balance restated is $495.00. Outstanding " +
        "check for $20.00 has not cleared. Do they tie out?";
      expect(extractBankReconciliationFact(prompt)).toBeNull();
    });

    // Explicit scenario from the task: 3+ (here 4) dollar amounts present --
    // even though 3 of them are the clean, unambiguous bank/ledger/outstanding
    // shape, the presence of a 4th number means picking "the right 3" would be
    // a guess, so this must NOT trigger.
    it("does not trigger when 4+ dollar amounts are present, even if 3 look like a clean bank-reconciliation shape", () => {
      const prompt =
        "I need to reconcile my bank statement and general ledger. Bank statement ending balance is " +
        "$12,540.75. General ledger ending balance is $12,128.25. There is one outstanding item: check " +
        "#1042 for $412.50 has not cleared yet. Note there was also a $35.00 monthly bank fee. Please " +
        "reconcile these balances and tell me whether they tie out.";
      expect(extractBankReconciliationFact(prompt)).toBeNull();
    });

    it("does not trigger without a reconcile/tie-out keyword, even with a clean 3-amount shape", () => {
      const prompt =
        "Bank statement ending balance is $12,540.75. General ledger ending balance is $12,128.25. There " +
        "is one outstanding item: check #1042 for $412.50 has not cleared yet. What should I do next?";
      expect(extractBankReconciliationFact(prompt)).toBeNull();
    });

    it("does not trigger on an ordinary funding-news question that merely mentions a dollar amount", () => {
      const prompt = "Have I seen that Rogo's total disclosed funding is $160M before?";
      expect(extractBankReconciliationFact(prompt)).toBeNull();
    });

    it("does not trigger on an empty or missing prompt", () => {
      expect(extractBankReconciliationFact("")).toBeNull();
      // @ts-expect-error -- exercising the runtime guard against non-string input
      expect(extractBankReconciliationFact(undefined)).toBeNull();
    });

    it("does not trigger when a check number is written with a stray '$' prefix (inflates the amount count)", () => {
      // "Outstanding check $1042" (should have been "#1042") reads as its own
      // dollar amount to the regex, so the prompt has 4 total matches
      // ($900.00, $850.00, $1042, $50.00) even though a human would obviously
      // discount the check number. The extractor has no way to distinguish
      // "amount" from "check number formatted with $" without guessing, so the
      // top-level count gate (must be exactly 3) correctly rejects this.
      const prompt =
        "Reconcile: bank balance $900.00, ledger balance $850.00. Outstanding check $1042 for $50.00 has " +
        "not cleared. Do they tie out?";
      expect(extractBankReconciliationFact(prompt)).toBeNull();
    });

    // P0 fix regression tests (docs/ACCOUNTING-DERIVATION-FIX-ADVERSARIAL-FINDING.md):
    // "deposit in transit" used to be routed into the `outstanding` slot,
    // which the formula always SUBTRACTS -- a real sign inversion, since
    // accounting ADDS deposits-in-transit to the bank side. The fix removed
    // the deposit-in-transit keyword from the `outstanding` pattern entirely
    // (rather than guessing at an unverified `+` formula), so a
    // deposit-in-transit clause now matches zero role keywords and the whole
    // prompt safely falls through to null, regardless of whether the true
    // reconciliation would have tied out or not.
    it("does not trigger on a deposit-in-transit prompt that would truly tie out (8200 + 500 = 8700) -- P0 regression", () => {
      const prompt =
        "Please reconcile these balances. Bank shows $8,200.00. Ledger shows $8,700.00. We have a deposit " +
        "in transit of $500.00. Do they tie out?";
      expect(extractBankReconciliationFact(prompt)).toBeNull();
    });

    it("does not trigger on a deposit-in-transit prompt that would NOT tie out -- P0 regression", () => {
      const prompt =
        "Please reconcile these balances. Bank shows $5,000.00. Ledger shows $4,800.00. We have a deposit " +
        "in transit of $100.00. Do they tie out?";
      expect(extractBankReconciliationFact(prompt)).toBeNull();
    });

    // P1 fix regression test (adversarial review's exact repro shape): the
    // extractor used to fabricate a fact from non-financial text that merely
    // contained "reconcile" + exactly 3 dollar amounts in single-role
    // clauses. Reconstructed continuation of the review's quoted fragment
    // ("I need to reconcile my emotions. My bank account triggered a $500.00
    // wave of anxiety...") into the full single-role-clause shape the review
    // describes -- this used to satisfy every gate (bank/ledger/outstanding
    // roles each get exactly one of the 3 amounts, and even ties out exactly:
    // 500 - 200 = 300) purely by lexical coincidence. The new
    // ACCOUNTING_CONTEXT_RE gate requires a "balance"/"statement" noun
    // in addition to "reconcile", which this text never uses.
    it("does not trigger on non-financial text that lexically coincides with reconcile + 3 single-role amounts -- P1 regression", () => {
      const prompt =
        "I need to reconcile my emotions. My bank account triggered a $500.00 wave of anxiety. My ledger " +
        "of regrets adds up to $300.00. The outstanding tension between us is worth $200.00.";
      expect(extractBankReconciliationFact(prompt)).toBeNull();
    });

    // Minor fix regression tests: negative/parenthesized amounts must be
    // rejected outright rather than having their sign silently dropped.
    it("does not trigger when an amount is written with a leading minus sign", () => {
      const prompt =
        "Reconcile: bank balance is $900.00. Ledger balance is $850.00. Outstanding check for -$50.00 has " +
        "not cleared. Do they tie out?";
      expect(extractBankReconciliationFact(prompt)).toBeNull();
    });

    it("does not trigger when an amount is wrapped in parentheses (accounting negative notation)", () => {
      const prompt =
        "Reconcile: bank balance is $900.00. Ledger balance is $850.00. Outstanding check for ($50.00) has " +
        "not cleared. Do they tie out?";
      expect(extractBankReconciliationFact(prompt)).toBeNull();
    });
  });
});
