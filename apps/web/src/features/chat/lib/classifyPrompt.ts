import type { LensId } from "@/features/controlPlane/components/searchTypes";
import type { ProductComposerMode } from "@/features/product/components/ProductIntakeComposer";

export type RuntimeProfile = "fast" | "slow";

export interface PromptClassification {
  intents: ProductComposerMode[];
  personas: LensId[];
  runtime: RuntimeProfile;
  confidence: number;
  reasons: {
    intent: string;
    persona: string;
    runtime: string;
  };
}

interface ScoredHit<T extends string> {
  id: T;
  score: number;
  signals: string[];
}

const TASK_LEAD_VERBS = [
  "create",
  "make",
  "generate",
  "build",
  "write",
  "draft",
  "compose",
  "summarize",
  "summarise",
  "convert",
  "translate",
  "extract",
  "download",
  "export",
  "schedule",
  "remind",
  "send",
  "email",
  "post",
  "publish",
  "save",
  "add",
  "prep",
  "analyze",
  "analyse",
  "evaluate",
  "investigate",
  "research",
  "review",
  "assess",
  "outline",
  "plan",
  "rank",
  "benchmark",
  "calculate",
  "estimate",
  "forecast",
  "project",
  "model",
  "score",
  "turn this into",
  "make me",
  "draft me",
  "build me",
  "write me",
  "walk me through",
];

const NOTE_LEAD_MARKERS = [
  "note:",
  "saving:",
  "fyi:",
  "to remember:",
  "quick thought",
  "tl;dr",
  "jot down",
  "keep this",
  "file this",
  "remember that",
  "reminder:",
];

const ASK_LEAD_WORDS = [
  "what",
  "how",
  "why",
  "when",
  "where",
  "who",
  "which",
  "is",
  "are",
  "can",
  "should",
  "would",
  "does",
  "do",
  "will",
  "could",
  "explain",
  "tell me",
  "describe",
  "compare",
  "walk me through",
];

const PERSONA_KEYWORDS: Record<LensId, string[]> = {
  founder: [
    "my company",
    "our product",
    "we're building",
    "we are building",
    "our traction",
    "our mrr",
    "our arr",
    "we raised",
    "my startup",
    "go to market",
    "gtm",
    "product market fit",
    "founder",
    "pricing strategy",
    "growth loop",
    "activation",
    "retention",
    "runway",
    "burn",
    "hiring plan",
  ],
  investor: [
    "valuation",
    "tam",
    "sam",
    "som",
    "cac",
    "ltv",
    "cohort",
    "moic",
    "irr",
    "term sheet",
    "convertible",
    "safe note",
    "due diligence",
    "diligence",
    "dd ",
    "comps",
    "preferred stock",
    "moat",
    "unit economics",
    "exit",
    "liquidity",
    "allocation",
    "check size",
    "lead round",
    "dry powder",
    "series a",
    "series b",
    "series c",
    "series d",
    "pre-seed",
    "preseed",
    "seed round",
    "bridge round",
    "down round",
    "cap table",
    "portfolio company",
    "lp ",
    "limited partner",
  ],
  banker: [
    "m&a",
    "merger",
    "acquisition",
    "ebitda",
    "dcf",
    "multiples",
    "precedent transactions",
    "cim",
    "revenue growth",
    "margin expansion",
    "fairness opinion",
    "10-k",
    "10-q",
    "8-k",
    "sec filing",
    "s-1",
    "prospectus",
    "syndicate",
    "underwriter",
    "capital structure",
    "leverage",
    "rating",
    "basel",
    "fdic",
    "credit risk",
    "default rate",
    "swap",
    "derivative",
  ],
  ceo: [
    "board meeting",
    "board deck",
    "okr",
    "quarterly",
    "all-hands",
    "all hands",
    "headcount",
    "org structure",
    "key hire",
    "strategy review",
    "exec team",
    "executive team",
    "leadership team",
    "company health",
    "decision memo",
    "kpi",
    "north star",
    "roadmap review",
  ],
  legal: [
    "contract",
    "msa",
    "nda",
    "sow",
    "liability",
    "indemnity",
    "jurisdiction",
    "gdpr",
    "ccpa",
    "hipaa",
    "compliance",
    "regulatory",
    "litigation",
    "breach",
    "warranty",
    "trademark",
    "patent",
    "license",
    "termination clause",
    "ip assignment",
    "subpoena",
    "injunction",
  ],
  student: [
    "homework",
    "assignment",
    "class ",
    "professor",
    "syllabus",
    "study guide",
    "thesis",
    "research paper",
    "essay",
    "citation",
    "cite ",
    "textbook",
    "lecture",
    "exam",
    "quiz",
    "bibliography",
    "coursework",
    "coursera",
  ],
};

const SLOW_SIGNALS = [
  "deep dive",
  "analyze",
  "analyse",
  "compare",
  "evaluate",
  "investigate",
  "research",
  "thorough",
  "comprehensive",
  "detailed",
  "due diligence",
  "teardown",
  "breakdown",
  "end-to-end",
  "full analysis",
  "complete overview",
  "strategic",
  "memo",
  "brief",
  "report",
  "pros and cons",
  "risk assessment",
  "scenario",
  "stress test",
  "benchmark",
];

const FAST_SIGNALS = [
  "quick",
  "fast",
  "tldr",
  "tl;dr",
  "short answer",
  "one-liner",
  "summary only",
  "in one sentence",
  "short",
  "brief answer",
];

const URL_PATTERN = /https?:\/\/\S+/gi;
const QUESTION_MARK = /\?/;

function countMatches(text: string, needles: string[]): { hits: number; signals: string[] } {
  const lower = text.toLowerCase();
  const signals: string[] = [];
  let hits = 0;
  for (const needle of needles) {
    if (lower.includes(needle)) {
      hits += 1;
      signals.push(needle);
    }
  }
  return { hits, signals };
}

function startsWithAny(text: string, prefixes: string[]): string | null {
  const lower = text.toLowerCase().trimStart();
  for (const prefix of prefixes) {
    const normalized = prefix.endsWith(" ") || prefix.endsWith(":") ? prefix : `${prefix} `;
    if (lower.startsWith(prefix.toLowerCase()) || lower.startsWith(normalized.toLowerCase())) {
      return prefix;
    }
  }
  return null;
}

function detectIntents(text: string): { primary: ProductComposerMode; all: ProductComposerMode[]; reason: string } {
  const trimmed = text.trim();
  if (!trimmed) return { primary: "ask", all: ["ask"], reason: "empty input defaults to ask" };

  const taskLead = startsWithAny(trimmed, TASK_LEAD_VERBS);
  const { hits: taskInlineHits, signals: taskInlineSignals } = countMatches(trimmed, TASK_LEAD_VERBS);
  const taskScore = (taskLead ? 3 : 0) + taskInlineHits;

  const noteLead = startsWithAny(trimmed, NOTE_LEAD_MARKERS);
  const { hits: noteInlineHits, signals: noteInlineSignals } = countMatches(trimmed, NOTE_LEAD_MARKERS);
  const isDeclarative = !QUESTION_MARK.test(trimmed) && !startsWithAny(trimmed, ASK_LEAD_WORDS);
  const urlsOnly = URL_PATTERN.test(trimmed) && trimmed.replace(URL_PATTERN, "").trim().length < 10;
  const noteScore = (noteLead ? 3 : 0) + noteInlineHits + (urlsOnly ? 2 : 0) + (isDeclarative && trimmed.length < 140 ? 1 : 0);

  const askLead = startsWithAny(trimmed, ASK_LEAD_WORDS);
  const endsInQuestion = QUESTION_MARK.test(trimmed);
  const askScore = (askLead ? 2 : 0) + (endsInQuestion ? 2 : 0);

  const scores: Array<ScoredHit<ProductComposerMode>> = [
    { id: "task", score: taskScore, signals: taskLead ? [`leads with "${taskLead}"`, ...taskInlineSignals] : taskInlineSignals },
    { id: "note", score: noteScore, signals: noteLead ? [`note marker "${noteLead}"`, ...noteInlineSignals] : noteInlineSignals },
    { id: "ask", score: askScore, signals: [askLead ? `leads with "${askLead}"` : "", endsInQuestion ? "question mark" : ""].filter(Boolean) },
  ];

  scores.sort((a, b) => b.score - a.score);

  const primary: ProductComposerMode = scores[0].score > 0 ? scores[0].id : "ask";
  const all: ProductComposerMode[] = [primary];
  for (const s of scores.slice(1)) {
    if (s.score >= Math.max(1, scores[0].score - 1)) {
      all.push(s.id);
    }
  }

  const primarySignals = scores.find((s) => s.id === primary)?.signals ?? [];
  const reason = primarySignals.length > 0 ? `${primary} — ${primarySignals.slice(0, 2).join(", ")}` : `${primary} (default)`;

  return { primary, all, reason };
}

function detectPersonas(text: string): { primary: LensId; all: LensId[]; reason: string } {
  const scored: Array<ScoredHit<LensId>> = (Object.keys(PERSONA_KEYWORDS) as LensId[]).map((persona) => {
    const { hits, signals } = countMatches(text, PERSONA_KEYWORDS[persona]);
    return { id: persona, score: hits, signals };
  });

  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top || top.score === 0) {
    return { primary: "founder", all: ["founder"], reason: "no persona signals — defaulting to founder" };
  }

  const primary = top.id;
  const all: LensId[] = [primary];
  for (const s of scored.slice(1)) {
    if (s.score >= Math.max(1, top.score - 1)) {
      all.push(s.id);
    }
  }

  const reason = `${primary} (${top.signals.slice(0, 3).join(", ")})`;
  return { primary, all, reason };
}

function detectRuntime(
  text: string,
  intents: ProductComposerMode[],
  personas: LensId[],
): { profile: RuntimeProfile; reason: string } {
  const len = text.trim().length;
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 4).length;
  const urlCount = (text.match(URL_PATTERN) ?? []).length;
  const { hits: slowHits, signals: slowSignals } = countMatches(text, SLOW_SIGNALS);
  const { hits: fastHits } = countMatches(text, FAST_SIGNALS);

  const slowPersonas = personas.filter((p) => p === "banker" || p === "investor" || p === "legal");

  const slowScore =
    slowHits * 2 +
    (len > 240 ? 2 : 0) +
    (sentences > 2 ? 1 : 0) +
    (urlCount >= 2 ? 1 : 0) +
    slowPersonas.length;
  const fastScore = fastHits * 2 + (len <= 80 ? 1 : 0) + (intents.includes("note") ? 2 : 0);

  if (slowScore > fastScore) {
    const reasons: string[] = [];
    if (slowHits > 0) reasons.push(slowSignals.slice(0, 2).join(", "));
    if (len > 240) reasons.push(`${len}-char prompt`);
    if (urlCount >= 2) reasons.push(`${urlCount} URLs`);
    if (slowPersonas.length > 0) reasons.push(`${slowPersonas[0]} lens`);
    return {
      profile: "slow",
      reason: reasons.length > 0 ? `slow — ${reasons.slice(0, 2).join(", ")}` : "slow (deep analysis heuristic)",
    };
  }

  const reasons: string[] = [];
  if (fastHits > 0) reasons.push("brevity signal");
  if (len <= 80) reasons.push("short prompt");
  if (intents.includes("note")) reasons.push("note capture");
  return {
    profile: "fast",
    reason: reasons.length > 0 ? `fast — ${reasons[0]}` : "fast (default)",
  };
}

export function classifyPrompt(raw: string): PromptClassification {
  const text = (raw ?? "").slice(0, 4000);
  const intent = detectIntents(text);
  const persona = detectPersonas(text);
  const runtime = detectRuntime(text, intent.all, persona.all);

  const confidence = Math.min(
    1,
    (intent.all.length === 1 ? 0.35 : 0.2) +
      (persona.all.length === 1 ? 0.35 : 0.2) +
      (text.trim().length > 20 ? 0.2 : 0) +
      (text.trim().length > 80 ? 0.1 : 0),
  );

  return {
    intents: intent.all,
    personas: persona.all,
    runtime: runtime.profile,
    confidence: Number(confidence.toFixed(2)),
    reasons: {
      intent: intent.reason,
      persona: persona.reason,
      runtime: runtime.reason,
    },
  };
}

export const INTENT_LABEL: Record<ProductComposerMode, string> = {
  ask: "Ask",
  note: "Note",
  task: "Task",
};

export const LENS_LABEL: Record<LensId, string> = {
  founder: "Founder",
  investor: "Investor",
  banker: "Banker",
  ceo: "CEO",
  legal: "Legal",
  student: "Student",
};

export const RUNTIME_LABEL: Record<RuntimeProfile, string> = {
  fast: "Fast path",
  slow: "Deep reasoning",
};
