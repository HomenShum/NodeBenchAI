// Deterministic bank-reconciliation fact extractor.
//
// CORRECTION follow-up to shared/redesign/contextRuntimePolicy.ts's
// CALCULATION_INTENT_PATTERNS gate -- see docs/ACCOUNTING-FR-A4-JOURNAL-ENTRY.md,
// "CORRECTION" section. Forcing live grounding (contextRuntimePolicy.ts) fixed
// the evidence-relevance bug, and a prompt instruction (chatRuns.ts systemPrompt)
// asks the model to "show your math" -- but re-driving the exact bank-
// reconciliation shape live, 3/3 times, showed the model still never surfaces
// the explicit arithmetic ("$X - $Y = $Z"); it only asserts the conclusion. A
// natural-language instruction is not a reliable enough lever for a small,
// fast model formatting under a tight one-paragraph constraint.
//
// This module is the deterministic fix: a narrow, PURE extractor scoped only
// to the bank-reconciliation shape (bank balance, ledger balance, one
// outstanding item). It:
//   (a) extracts dollar amounts from the raw prompt text via regex,
//   (b) if the prompt is bank-reconciliation-shaped (contains "reconcile" /
//       "reconciliation" / "tie(s/d) out" -- the same keyword family as
//       CALCULATION_INTENT_PATTERNS in contextRuntimePolicy.ts) AND exactly
//       3 dollar amounts are present, each unambiguously tagged to one of
//       {bank, ledger, outstanding} by nearby keywords, computes
//       bankBalance - outstandingItem and compares it to the ledger balance,
//   (c) returns a VERIFIED_CALCULATION fact string with the real arithmetic
//       for the caller (chatRuns.ts) to inject into the context bundle, so
//       the model relays a pre-verified fact instead of being asked to both
//       compute and format a derivation under constraint.
//
// If ANYTHING about the shape is ambiguous -- wrong amount count, a keyword
// that doesn't map cleanly to exactly one amount, a role claimed twice, a role
// never claimed -- this returns null. It never guesses a role assignment; a
// wrong injected "fact" would be worse than the current gap (an assertion with
// no derivation), because the model would relay it as verified. Callers must
// treat `null` as "no-op, let the existing prompt-only behavior stand."
//
// Deliberately mirrors the style of the deterministic accounting oracles in
// noderl/packages/nodeeval/src/accounting/*.ts (a sibling, unrelated repo with
// no package dependency from nodebench-ai, hence no import -- this reimplements
// the same *pattern*, not the same module): pure function, no Date.now/
// Math.random/IO/clocks, half-cent tolerance for float noise on money
// comparisons.

export interface VerifiedCalculationFact {
  /** The literal fact string to inject into the context bundle / system prompt. */
  fact: string;
  bankBalance: number;
  ledgerBalance: number;
  outstandingItem: number;
  /** bankBalance - outstandingItem */
  reconciledBalance: number;
  /** True iff reconciledBalance ties to ledgerBalance within CENT_TOLERANCE. */
  tiesOut: boolean;
  /** abs(reconciledBalance - ledgerBalance) */
  delta: number;
}

/**
 * Half a cent: the documented monetary tie tolerance, matching the tolerance
 * convention used by noderl's accounting oracles (bankReconciliation.ts /
 * journalEntry.ts): two amounts are "equal to the cent" iff
 * Math.abs(a - b) <= CENT_TOLERANCE. Absorbs float noise (100.00 vs
 * 100.004999...) without masking a real 1-cent-or-more discrepancy.
 */
export const CENT_TOLERANCE = 0.005;

// Narrow, bank-reconciliation-specific subset of CALCULATION_INTENT_PATTERNS
// (contextRuntimePolicy.ts). Intentionally duplicated rather than imported:
// this extractor is about to assign per-amount SEMANTIC ROLES, which needs
// more evidence than "the word reconcile appears somewhere," so it is an
// independent, narrower gate layered on top of (not a replacement for) the
// live-grounding gate. If contextRuntimePolicy.ts's reconciliation patterns
// change, revisit this constant too.
const RECONCILIATION_SHAPE_RE = /\breconcil(?:e|es|ed|ing|iation)\b|\btie(?:s|d)?\s+out\b/i;

// P1 fix (adversarial review, docs/ACCOUNTING-DERIVATION-FIX-ADVERSARIAL-FINDING.md):
// gate 1 used to be "contains reconcile/tie-out" alone, which a non-financial
// prompt can satisfy coincidentally (e.g. "I need to reconcile my emotions...
// my bank account triggered a wave of anxiety... my ledger of regrets...").
// This requires a SECOND, independent signal: a genuine balance/statement
// noun. Deliberately does NOT include "bank" / "ledger" / "account" here --
// any prompt that reaches a non-null result already MUST contain a "bank"
// match and a "ledger"/"books" match (see ROLE_PATTERNS below, required by
// the role-assignment gate), so re-requiring those same words here would be a
// no-op against exactly the adversarial case this gate exists to stop
// (metaphorical text that borrows "bank"/"ledger"/"account" vocabulary).
// "balance" / "statement" are the words consistently present in every real
// reconciliation prompt (verified against this file's own test corpus) but
// are NOT already guaranteed by the role-keyword gates, so they carry real,
// non-redundant signal.
const ACCOUNTING_CONTEXT_RE = /\bbalances?\b|\bstatements?\b/i;

// Matches a dollar amount like "$12,540.75", "$412.50", "$500", "$ 35.00".
const DOLLAR_AMOUNT_RE = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\b/g;

type Role = "bank" | "ledger" | "outstanding";

const ROLE_PATTERNS: Record<Role, RegExp> = {
  bank: /\bbank\b/i,
  ledger: /\b(?:general\s+ledger|ledger|books?)\b/i,
  // P0 fix (adversarial review): "deposits? in transit" used to be routed
  // into this same `outstanding` slot, which the formula below always
  // SUBTRACTS (bankBalance - outstandingItem). Real accounting ADDS
  // deposits-in-transit to the bank side, so that mapping was a live sign
  // inversion (reproduced: bank $8,200 + deposit-in-transit $500 = ledger
  // $8,700 truly ties out; the old code instead computed 8200 - 500 = 7700
  // and reported a fabricated $1,000 "DOES NOT MATCH"). Deliberately
  // REMOVED rather than reworked into its own `+` role: this extractor has
  // zero test coverage proving the addition direction, and per the review,
  // the safe minimal fix is preferred over guessing at an unverified
  // formula. A clause that only mentions "deposit in transit" now matches
  // no role keyword and falls through to `null` (the pre-existing,
  // prompt-only behavior), same as any other unimplemented shape.
  outstanding:
    /\boutstanding\b|\bnot\s+(?:yet\s+)?cleared\b|\bhas(?:n'?t| not)\s+cleared\b|\bcheck\s*#?\s*\d+\b/i,
};

function parseAmount(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

/**
 * Minor fix (adversarial review): `-$500.00` and `($500.00)` are both
 * conventional negative-amount notations. DOLLAR_AMOUNT_RE only captures the
 * digits after `$`, so without this check the leading `-` or the wrapping
 * parens would be silently dropped and the amount would be (mis)treated as
 * positive. Checks the characters immediately surrounding the match (a
 * couple of characters of optional whitespace tolerated) rather than trying
 * to parse a signed-amount grammar.
 */
function isSignOrParenWrapped(text: string, matchStart: number, matchEnd: number): boolean {
  const before = text.slice(Math.max(0, matchStart - 3), matchStart);
  if (/-\s?$/.test(before)) return true;
  if (/\(\s?$/.test(before)) {
    const after = text.slice(matchEnd, matchEnd + 3);
    if (/^\s?\)/.test(after)) return true;
  }
  return false;
}

/**
 * Extracts every dollar amount in `str`. Returns `null` (rather than an
 * array) if any matched amount is negative or parenthesized -- unparseable
 * per `isSignOrParenWrapped`, so the caller must treat the whole prompt as
 * ambiguous rather than silently coercing the sign to positive.
 */
function extractDollarAmounts(str: string): number[] | null {
  const amounts: number[] = [];
  for (const m of str.matchAll(DOLLAR_AMOUNT_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (isSignOrParenWrapped(str, start, end)) return null;
    amounts.push(parseAmount(m[1]));
  }
  return amounts;
}

/** True iff `a` and `b` are equal within the documented half-cent tolerance. */
function equalToTheCent(a: number, b: number): boolean {
  return Math.abs(a - b) <= CENT_TOLERANCE;
}

/** Fixed 2-decimal rendering for a stable, deterministic fact string. */
function money(n: number): string {
  const v = Object.is(n, -0) ? 0 : n;
  return v.toFixed(2);
}

/**
 * Split into clause-sized chunks on sentence-ish boundaries so each dollar
 * amount can be checked against nearby role keywords without bleeding into
 * an unrelated clause elsewhere in the prompt.
 */
function splitClauses(text: string): string[] {
  return text
    .split(/(?<=[.!?;:])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Extract a pre-verified bank-reconciliation fact from a raw prompt, or
 * return null if the shape is anything less than unambiguous.
 *
 * Confident-match requirements (ALL must hold, or this returns null):
 *  1. The prompt contains a reconciliation/tie-out keyword (RECONCILIATION_SHAPE_RE)
 *     AND a genuine balance/statement noun (ACCOUNTING_CONTEXT_RE) -- two
 *     independent lexical signals, not just the reconcile/tie-out verb alone.
 *  2. Exactly 3 dollar amounts appear in the whole prompt (not 2, not 4+) --
 *     bank balance, ledger balance, one outstanding item. 2 amounts can't
 *     support the identity; 4+ means there are extra numbers we can't
 *     confidently rule out as candidates (e.g. a fee, a second outstanding
 *     item) without guessing which 3 of N matter. None of the 3 amounts may
 *     be negative or parenthesized (e.g. `-$500.00`, `($500.00)`) -- the sign
 *     would otherwise be silently dropped.
 *  3. Each of the 3 amounts lives in a clause that contains exactly ONE
 *     dollar amount AND exactly ONE of {bank, ledger, outstanding} role
 *     keywords -- a clause with 2 amounts, or 0 or 2+ role keywords, is
 *     unresolvable without guessing.
 *  4. All 3 roles get exactly one amount each (no role missing, no role
 *     claimed by two different clauses).
 */
export function extractBankReconciliationFact(prompt: string): VerifiedCalculationFact | null {
  const text = prompt || "";
  if (!RECONCILIATION_SHAPE_RE.test(text)) return null;
  if (!ACCOUNTING_CONTEXT_RE.test(text)) return null;

  const allAmounts = extractDollarAmounts(text);
  if (allAmounts === null) return null; // negative/parenthesized amount -- unparseable, never guess the sign.
  if (allAmounts.length !== 3 || allAmounts.some((n) => !Number.isFinite(n))) {
    // Wrong count -- ambiguous. Never guess which numbers matter.
    return null;
  }

  const roleAmounts: Partial<Record<Role, number>> = {};

  for (const clause of splitClauses(text)) {
    const clauseAmounts = extractDollarAmounts(clause);
    if (clauseAmounts === null) return null; // defensive: same unparseable-sign check, clause-scoped.
    if (clauseAmounts.length === 0) continue;
    if (clauseAmounts.length > 1) {
      // Two+ dollar amounts crammed into one clause -- can't tell which
      // keyword (if any) governs which number.
      return null;
    }

    const matchedRoles = (Object.keys(ROLE_PATTERNS) as Role[]).filter((role) =>
      ROLE_PATTERNS[role].test(clause),
    );
    if (matchedRoles.length !== 1) {
      // Zero role keywords (can't tell what this number is) or 2+ role
      // keywords (can't tell which one governs) in the clause that owns
      // this amount.
      return null;
    }

    const role = matchedRoles[0];
    if (roleAmounts[role] !== undefined) {
      // Same role claimed by a second clause -- ambiguous which is real.
      return null;
    }
    roleAmounts[role] = clauseAmounts[0];
  }

  if (
    roleAmounts.bank === undefined ||
    roleAmounts.ledger === undefined ||
    roleAmounts.outstanding === undefined
  ) {
    return null;
  }

  const bankBalance = roleAmounts.bank;
  const ledgerBalance = roleAmounts.ledger;
  const outstandingItem = roleAmounts.outstanding;

  const reconciledBalance = bankBalance - outstandingItem;
  const delta = Math.abs(reconciledBalance - ledgerBalance);
  const tiesOut = equalToTheCent(reconciledBalance, ledgerBalance);

  const fact =
    `VERIFIED_CALCULATION: Bank ending balance $${money(bankBalance)} - outstanding item $${money(outstandingItem)} ` +
    `= $${money(reconciledBalance)}, which ${tiesOut ? "MATCHES" : "DOES NOT MATCH"} the ledger ending balance of ` +
    `$${money(ledgerBalance)} (difference $${money(delta)}).`;

  return { fact, bankBalance, ledgerBalance, outstandingItem, reconciledBalance, tiesOut, delta };
}
