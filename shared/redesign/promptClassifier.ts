export type PromptClassification = { kind: string; entity?: string };

// Real bug found live (docs/ACCOUNTING-FR-A1-BANK-RECONCILIATION.md,
// docs/ACCOUNTING-FR-A6-TRIAL-BALANCE.md): the old single .match() (no /g flag) picked
// whichever 2+-char capitalized word happened to occur FIRST anywhere in the prompt, with
// zero check that it's an actual entity name. "I need to reconcile my bank statement...
// Bank statement ending balance is $12,540.75..." matched "Bank" (the first word of the
// SECOND sentence, capitalized only because English capitalizes sentence starts) --
// "Bank" occurs earlier in the string than any real entity would. "Please check this
// trial balance..." matched "Please" the same way. Fix: collect every candidate (not just
// the first) and skip ones that are common English words/sentence-starters rather than
// entity names, so a real entity later in the prompt (e.g. "Tell me about Apple.") is
// still found instead of stopping at "Tell".
// Categorized rather than one flat list, since real test prompts kept surfacing new gaps
// (accounting line-item nouns, WH-words, pronouns, month names) -- same pragmatic,
// domain-scoped-keyword-list approach already used for CALCULATION_INTENT_PATTERNS in
// contextRuntimePolicy.ts, not a general NLP solution. Tradeoff accepted explicitly: a
// genuine multi-word entity that happens to start with one of these words (e.g. "General
// Electric") would be missed and fall through to "general" -- a graceful degradation
// (still searchable, just not company_search-routed), not a broken experience, and far
// rarer in this app's live traffic than the confirmed, repeated accounting-prompt harm.
const WH_AND_PRONOUNS = [
  "what", "when", "where", "why", "how", "who", "which", "we", "you", "i",
  "there", "this", "that", "these", "those", "it", "he", "she", "they",
];
const COMMON_VERBS_AND_STARTERS = [
  "please", "check", "add", "show", "tell", "total", "need", "want", "have", "will",
  "let", "give", "find", "pull", "list", "see", "today", "now", "just", "here", "try",
  "can", "should", "would", "looking", "help", "get", "reconcile", "reconciliation",
];
const ACCOUNTING_NOUNS = [
  "bank", "cash", "ledger", "general", "inventory", "statement", "balance", "account",
  "accounts", "payable", "receivable", "owner", "equity", "outstanding", "net",
  "credit", "debit", "credits", "debits", "asset", "assets", "liability", "liabilities",
];
const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june", "july", "august", "september",
  "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug",
  "sep", "sept", "oct", "nov", "dec",
];
const PROMPT_ENTITY_STOPWORDS = new Set([
  ...WH_AND_PRONOUNS,
  ...COMMON_VERBS_AND_STARTERS,
  ...ACCOUNTING_NOUNS,
  ...MONTH_NAMES,
]);

const CANDIDATE_ENTITY_RE = /(?:about |on |for |re )?([A-Z][A-Za-z0-9]+(?:\s[A-Z][A-Za-z0-9]+)*)/g;

function isStopwordCandidate(candidate: string): boolean {
  // Reject if ANY word in a multi-word candidate ("Accounts Payable") is a stopword, not
  // just the phrase as a whole -- accounting line-item labels are almost always 1-2 common
  // nouns, so checking per-word catches them without needing every exact phrase enumerated.
  return candidate.split(/\s+/).some((w) => PROMPT_ENTITY_STOPWORDS.has(w.toLowerCase()));
}

export function classifyPrompt(prompt: string): PromptClassification {
  const lower = prompt.toLowerCase();
  const candidates = prompt.matchAll(CANDIDATE_ENTITY_RE);
  let entity: string | undefined;
  for (const candidate of candidates) {
    const word = candidate[1];
    if (!word || word.length <= 2) continue;
    if (isStopwordCandidate(word)) continue;
    entity = word;
    break;
  }
  if (lower.includes(" vs ") || lower.includes(" compare ")) return { kind: "competitor", entity };
  if (entity) return { kind: "company_search", entity };
  return { kind: "general" };
}
