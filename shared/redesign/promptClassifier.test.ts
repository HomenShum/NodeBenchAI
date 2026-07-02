import { describe, expect, it } from "vitest";
import { classifyPrompt } from "./promptClassifier";

describe("classifyPrompt", () => {
  // The two real, live-observed bugs this fix closes.
  it("does not misclassify a bank-reconciliation prompt as an entity search on 'Bank'", () => {
    const result = classifyPrompt(
      "I need to reconcile my bank statement and general ledger. Bank statement ending balance is $12,540.75. General ledger ending balance is $12,128.25. There is one outstanding item: check #1042 for $412.50 has not cleared yet. Please reconcile these two balances and tell me whether they tie out, showing your math.",
    );
    expect(result.kind).toBe("general");
    expect(result.entity).toBeUndefined();
  });

  it("does not misclassify a trial-balance prompt as an entity search on 'Please'", () => {
    const result = classifyPrompt(
      "Please check this trial balance for me. Cash is $18,750 debit. Inventory is $11,250 debit. Accounts Payable is $4,900 credit. Owner's Equity is $25,100 credit.",
    );
    expect(result.kind).toBe("general");
    expect(result.entity).toBeUndefined();
  });

  it("does not misclassify an AR aging prompt on 'Net'", () => {
    const result = classifyPrompt(
      "I need an AR aging analysis. We have an invoice for $3,200 issued on May 15, 2026, with payment terms of Net 30.",
    );
    expect(result.kind).toBe("general");
  });

  // Real entities must still be found -- including the harder case where a stopword
  // (a generic verb) occurs earlier in the prompt than the real entity.
  it("still finds a real entity that appears after a stopword-like sentence starter", () => {
    const result = classifyPrompt("Tell me about Apple's latest earnings call.");
    expect(result.kind).toBe("company_search");
    expect(result.entity).toBe("Apple");
  });

  it("still classifies a genuine company-name query as company_search", () => {
    const result = classifyPrompt("What is Rogo's latest valuation?");
    expect(result.kind).toBe("company_search");
    expect(result.entity).toContain("Rogo");
  });

  it("still classifies a competitor comparison correctly", () => {
    const result = classifyPrompt("Compare Google vs Amazon on cloud market share.");
    expect(result.kind).toBe("competitor");
  });

  it("classifies a prompt with no capitalized entity at all as general", () => {
    const result = classifyPrompt("what changed today in my reports?");
    expect(result.kind).toBe("general");
    expect(result.entity).toBeUndefined();
  });

  // Regression: all 3 real live-session accounting prompts, stress-tested against the
  // fixed classifier and confirmed correct before shipping (docs/ACCOUNTING-FR-A4-*.md,
  // ACCOUNTING-FR-A1-RERUN-FULL-PASS.md, ACCOUNTING-FR-A6-TRIAL-BALANCE.md).
  it("does not misclassify the real live journal-entry prompt", () => {
    const result = classifyPrompt(
      "I need a journal entry proposal. We received a $5,000 cash payment from a customer for services not yet performed (deferred revenue), and we paid $1,200 cash for office rent for this month. Please propose the journal entries for both transactions, showing account names and whether each line is a debit or credit, and confirm debits equal credits for each entry.",
    );
    expect(result.kind).toBe("general");
  });

  it("does not misclassify the real live bank-reconciliation rerun prompt", () => {
    const result = classifyPrompt(
      "I need to reconcile my bank statement and general ledger. Bank statement ending balance is $7,320.60. General ledger ending balance is $7,105.10. There is one outstanding item: check #3311 for $215.50 has not cleared yet. Please reconcile these two balances and tell me whether they tie out, showing your math.",
    );
    expect(result.kind).toBe("general");
  });
});
