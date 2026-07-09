export type LiveGroundingDecision = {
  useLiveGrounding: boolean;
  reason: string;
  confidence: number;
  freshnessIntent: boolean;
  memorySufficient: boolean;
  signals: string[];
};

const FRESHNESS_PATTERNS = [
  /\btoday\b/i,
  /\blatest\b/i,
  /\brecent(?:ly)?\b/i,
  /\bcurrent(?:ly)?\b/i,
  /\bthis\s+(week|month|quarter|year)\b/i,
  /\bwhat\s+happened\b/i,
  /\bnews\b/i,
  /\bannounced?\b/i,
  /\braised?\b/i,
  /\brefresh\b/i,
  /\bupdate\b/i,
];

const MEMORY_FIRST_PATTERNS = [
  /\bhave\s+i\s+seen\b/i,
  /\bseen\s+.*\bbefore\b/i,
  /\bdo\s+we\s+already\s+know\b/i,
  /\bwhat\s+do\s+we\s+know\b/i,
  /\bbased\s+on\s+(this|the)\s+(report|brief|notebook|context)\b/i,
  /\bsummar(?:y|ize)\s+(this|the)\b/i,
  /\bexplain\s+(this|the)\b/i,
  /\bopen\s+claims?\b/i,
  /\breports?\s+touched\b/i,
  /\bsources?\s+used\b/i,
];

// A query asking to reconcile/derive/verify a specific calculation is domain-mismatched with
// whatever unrelated report happens to be the active thread's cached context (e.g. asking an
// accounting question inside a "Daily Brief" tech/markets thread). The memorySufficient shortcut
// below only checks structural signals (has context + >=2 cached refs) with no topical-relevance
// check, so it was firing on cached sources that had nothing to do with the question -- live-verified
// via repeated real bank-reconciliation/journal-entry runs returning the same irrelevant cached refs.
// Deliberately narrow to calculation/verification-shaped phrasing, not "mentions a dollar amount"
// (that alone would over-fire on ordinary funding-news/company queries and force live grounding on
// a huge swath of unrelated traffic -- the opposite of proportionate).
const CALCULATION_INTENT_PATTERNS = [
  /\breconcil(?:e|iation)\b/i,
  /\bjournal\s+entr(?:y|ies)\b/i,
  /\btrial\s+balance\b/i,
  /\btie(?:s|d)?\s+out\b/i,
  /\bdebits?\s+(?:and|=|equal)\s+credits?\b/i,
  /\bshow\s+(?:your\s+)?(?:math|work|calculation)\b/i,
  // AR/AP aging: found live -- "show your calculation" on an aging-bucket question only got
  // correctly routed because "today's date" happened to also trip FRESHNESS_PATTERNS. Without a
  // freshness word present, this shape would fall through to the same irrelevant-cache bug.
  /\bag(?:ing|e)\s+(?:bucket|analysis|report|schedule)\b/i,
  /\bdays?\s+past\s+due\b/i,
  /\b(?:ar|ap)\s+aging\b/i,
  /\bnet\s+\d{1,3}\b/i, // "Net 30" / "Net 60" payment terms
];

export function decideLiveGrounding(input: {
  prompt: string;
  hasContext: boolean;
  memoryHit: boolean;
  sourceCacheHit: boolean;
  selectedContextCount: number;
  sourceRefCount: number;
}): LiveGroundingDecision {
  const prompt = input.prompt || "";
  const freshnessSignals = FRESHNESS_PATTERNS.filter((pattern) => pattern.test(prompt)).map((pattern) => pattern.source);
  const memorySignals = MEMORY_FIRST_PATTERNS.filter((pattern) => pattern.test(prompt)).map((pattern) => pattern.source);
  const calculationSignals = CALCULATION_INTENT_PATTERNS.filter((pattern) => pattern.test(prompt)).map((pattern) => pattern.source);
  const freshnessIntent = freshnessSignals.length > 0;
  const memoryFirstIntent = memorySignals.length > 0;
  const calculationIntent = calculationSignals.length > 0;
  const memorySufficient = Boolean(
    input.hasContext &&
    input.memoryHit &&
    (input.sourceCacheHit || input.selectedContextCount > 0 || input.sourceRefCount > 0),
  );

  if (calculationIntent) {
    return {
      useLiveGrounding: true,
      reason: "Calculation/verification request detected -- the active thread's cached context is not a substitute for grounding the specific numbers asked about.",
      confidence: 0.85,
      freshnessIntent,
      memorySufficient,
      signals: calculationSignals,
    };
  }

  if (freshnessIntent) {
    return {
      useLiveGrounding: true,
      reason: "Freshness intent detected, so live grounded search stays enabled.",
      confidence: 0.92,
      freshnessIntent,
      memorySufficient,
      signals: freshnessSignals,
    };
  }

  if (memoryFirstIntent && memorySufficient) {
    return {
      useLiveGrounding: false,
      reason: "Memory-first recall intent with sufficient selected context; skip external search.",
      confidence: 0.9,
      freshnessIntent,
      memorySufficient,
      signals: memorySignals,
    };
  }

  if (memorySufficient && input.sourceRefCount >= 2) {
    return {
      useLiveGrounding: false,
      reason: "Selected report context has enough cached sources for a first-pass answer.",
      confidence: 0.78,
      freshnessIntent,
      memorySufficient,
      signals: ["selected_context", "source_cache"],
    };
  }

  return {
    useLiveGrounding: true,
    reason: input.hasContext
      ? "Context was weak or unresolved, so live grounded search is needed."
      : "No selected context was attached, so live grounded search is needed.",
    confidence: input.hasContext ? 0.72 : 0.82,
    freshnessIntent,
    memorySufficient,
    signals: input.hasContext ? ["weak_context"] : ["no_context"],
  };
}
