/**
 * agentHarness.ts — NodeBench Agent Harness
 *
 * The runtime that turns NodeBench from a dashboard into the engine
 * that orchestrates how agents gather, analyze, and act on intelligence.
 *
 * Like claw-code's harness pattern:
 * - assistant: LLM conversation loop with tool calling
 * - coordinator: plans and dispatches tool chains
 * - hooks: pre/post tool execution (profiling, caching, permission)
 * - bridge: routes to different LLM providers based on task
 *
 * Architecture:
 * 1. User query → Gemini Flash Lite classifies intent + entities
 * 2. Gemini Flash plans a tool chain (which tools, what order, what parallel)
 * 3. Harness executes the plan, logging each step
 * 4. After each step, Gemini observes results and can adapt the plan
 * 5. Final synthesis into structured ResultPacket
 *
 * This replaces the flat switch statement in search.ts with an
 * LLM-orchestrated execution loop.
 */

import { recordAction, recordFailure, getReflectionPrompt, recordRecoveryOutcome, initSessionMemoryTables } from "../packages/mcp-local/src/sync/sessionMemory.js";
import {
  formatEntityMemoryRecallForPrompt,
  MEMORY_CONTEXT_STEP_ID,
  type EntityMemoryRecallEntry,
} from "./lib/entityMemoryRecall.js";
import { parseJsonObjectFromText } from "./lib/jsonObjectParser.js";

// ── Types ─────────────────────────────────────────────────────────────

export interface HarnessStep {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  purpose: string;
  stepIndex?: number;
  groupId?: string;
  parallel?: boolean;  // Can run alongside other parallel steps
  dependsOn?: string | string[];  // Backward-compatible input, normalized to string[]
  model?: string;
  complexity?: TaskComplexity;
  injectPriorResults?: string[];
  acceptsSteering?: boolean;
}

export interface HarnessPlan {
  objective: string;
  classification: string;
  entityTargets: string[];
  steps: HarnessStep[];
  synthesisPrompt: string;  // How to combine results into a packet
}

export interface HarnessStepResult {
  stepId: string;
  toolName: string;
  result: unknown;
  success: boolean;
  durationMs: number;
  error?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  groupId?: string;
  stepIndex?: number;
  startedAt?: number;
  completedAt?: number;
  injectedContext?: string[];
  steeringApplied?: boolean;
  preview?: string;
}

export type HarnessStepV2 = HarnessStep;
export type HarnessPlanV2 = HarnessPlan;
export type HarnessStepResultV2 = HarnessStepResult;

export interface HarnessExecution {
  plan: HarnessPlan;
  stepResults: HarnessStepResult[];
  totalDurationMs: number;
  totalCostUsd: number;
  adaptations: number;  // How many times the plan was revised
}

export type HarnessTraceEvent =
  | { type: "trace"; step: string; tool?: string; status: "ok" | "error" | "skip" | "adapting"; detail?: string }
  | {
      type: "step_start";
      stepId: string;
      toolName: string;
      stepIndex?: number;
      groupId?: string;
      model?: string;
      purpose?: string;
      startedAt: number;
    }
  | {
      type: "step_done";
      stepId: string;
      toolName: string;
      stepIndex?: number;
      groupId?: string;
      model?: string;
      durationMs: number;
      startedAt: number;
      completedAt: number;
      success: boolean;
      error?: string;
      preview?: string;
      tokensIn?: number;
      tokensOut?: number;
      costUsd?: number;
      injectedContext?: string[];
      steeringApplied?: boolean;
    };

export type TraceCallback = (event: HarnessTraceEvent) => void;

type ToolCaller = (name: string, args: Record<string, unknown>) => Promise<unknown>;

type SynthesizedSource = {
  label: string;
  href?: string;
  type: string;
};

type SynthesizedSignal = {
  name: string;
  direction: string;
  impact: string;
  score?: number;
  sourceLabel?: string;
  sourceHref?: string;
  evidenceQuote?: string;
};

type SynthesizedChange = {
  description: string;
  date?: string;
  score?: number;
  sourceLabel?: string;
  sourceHref?: string;
  evidenceQuote?: string;
};

type SynthesizedRisk = {
  title: string;
  description: string;
  score?: number;
  sourceLabel?: string;
  sourceHref?: string;
  evidenceQuote?: string;
};

type SynthesizedComparable = {
  name: string;
  relevance: string;
  note: string;
  score?: number;
  sourceLabel?: string;
  sourceHref?: string;
  evidenceQuote?: string;
};

const COMPANY_NAME_STOPWORDS = new Set([
  "approximately",
  "ai",
  "api",
  "about",
  "llm",
  "ml",
  "nlp",
  "gpu",
  "cpu",
  "yoy",
  "arr",
  "mrr",
  "tm",
  "inc",
  "corp",
  "ltd",
  "co",
  "the",
  "a",
  "an",
  "what",
  "when",
  "where",
  "which",
  "company",
  "competitive",
  "landscape",
  "market",
  "share",
  "large",
  "small",
  "series",
  "seed",
  "pre-seed",
  "preseed",
  "round",
  "however",
  "therefore",
  "moreover",
  "war",
  "race",
  "battle",
  "category",
  "tpu",
  "tpus",
  "trainium",
  "inferentia",
  "claude",
  "gemini",
  "vertex",
  "bedrock",
  "statistics",
  "analysis",
  "overview",
  "report",
  "update",
  "latest",
  "enterprise",
  "foundation",
  "models",
  "model",
  "position",
  "positioning",
  "strategy",
  "risk",
  "risks",
  "challenge",
  "challenges",
  "funding",
  "valuation",
  "revenue",
  "growth",
  "intelligence",
  "memo",
  "index",
  "peer",
  "it",
  "multi",
  "dimensional",
  "global",
  "business",
  "professional",
  "we",
  "safety",
  "focused",
  "leader",
  "leaders",
  "their",
  "them",
  "our",
  "us",
  "ventures",
  "venture",
  "capital",
  "partners",
  "management",
  "holdings",
  "fund",
  "fortune",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "overview",
  "outlook",
  "briefing",
  "brief",
  "readout",
  "recon",
  "contracts",
  "data",
  "pricing",
  "buyers",
  "reporting",
  "contract",
  "positioned",
  "deployments",
  "ecosystems",
  "cowork",
  "coworker",
  "western",
]);

const SOURCE_ENTITY_STOPWORDS = new Set([
  "axios",
  "bloomberg",
  "coatue",
  "crunchbase",
  "dragoneer",
  "eweek",
  "forbes",
  "gic",
  "gdpr",
  "hipaa",
  "linkedin",
  "pitchbook",
  "reddit",
  "reuters",
  "sacra",
  "sequoia",
  "soc 2",
  "soc2",
  "statista",
  "substack",
  "techcrunch",
  "the information",
  "wikipedia",
  "youtube",
]);

const NON_PEER_COMPARABLE_NAMES = new Set([
  "alphabet",
  "aws",
  "azure",
  "bedrock",
  "google cloud",
  "microsoft azure",
  "pentagon",
  "vertex ai",
]);

const COMPARABLE_CONNECTOR_STOPWORDS = new Set([
  "another",
  "as",
  "both",
  "by",
  "despite",
  "each",
  "every",
  "many",
  "most",
  "other",
  "others",
  "several",
  "some",
]);

const KNOWN_ACRONYM_COMPANY_NAMES = new Set([
  "AMD",
  "AWS",
  "IBM",
  "NVIDIA",
  "SAP",
  "TSMC",
]);

const HIGH_AUTHORITY_SOURCE_HOST_PATTERNS = [
  /anthropic\.com$/i,
  /openai\.com$/i,
  /google\.com$/i,
  /abcxyz\.com$/i,
  /sec\.gov$/i,
  /reuters\.com$/i,
  /nytimes\.com$/i,
  /wsj\.com$/i,
  /ft\.com$/i,
  /bloomberg\.com$/i,
  /theinformation\.com$/i,
  /sacra\.com$/i,
];

const LOW_AUTHORITY_SOURCE_HOST_PATTERNS = [
  /247wallst\.com$/i,
  /aibusinessweekly\.net$/i,
  /atonementlicensing\.com$/i,
  /electroiq\.com$/i,
  /europeanbusinessmagazine\.com$/i,
  /futuresearch\.ai$/i,
  /redolentech\.com$/i,
];

const PERCENT_VALUE_PATTERN = /\d{1,3}(?:,\d{3})*(?:\.\d+)?%/g;

function looksLikeSourceTitle(value: string): boolean {
  return /[|]/.test(value)
    || /\b(statistics?(?:\s+by)?|company analysis|outlook report|full financial breakdown|what investors need to know|what .* need to know|powerhouse hiding in plain sight|arms race|index(?:\s+\w+){0,3}\s+update|worth buying|turns the tables|who is winning|why .* is winning|why businesses choose|battle that will reshape|looking ahead to|dominance is being tested|ai war|ai race|critical revenue category|leading one half|market share 20\d{2}|competitors?\s*&\s*.+alternatives?|understanding the .* milestone|let'?s break down)\b/i.test(value)
    || /\s[-:]\s(?:[A-Z][A-Za-z0-9&.]+(?:\s+[A-Z][A-Za-z0-9&.]+){0,3})$/.test(value.trim())
    || /^\d+\.\s/.test(value);
}

function decodeCommonHtmlEntities(value: string): string {
  return value
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeWhitespace(value: string): string {
  return decodeCommonHtmlEntities(value).replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}

function sentenceSplit(value: string): string[] {
  return normalizeWhitespace(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalizeWhitespace(value));
  }
  return deduped;
}

function preferLongerNarrativeVariants(values: string[]): string[] {
  const selected: string[] = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) continue;
    const normalizedLower = normalized.toLowerCase();
    const existingIndex = selected.findIndex((item) => {
      const existingLower = item.toLowerCase();
      return existingLower.startsWith(normalizedLower) || normalizedLower.startsWith(existingLower);
    });
    if (existingIndex === -1) {
      selected.push(normalized);
      continue;
    }
    if (normalized.length > selected[existingIndex].length) {
      selected[existingIndex] = normalized;
    }
  }
  return selected;
}

function normalizeCandidateScore(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value <= 1 && value >= 0) return Math.round(value * 100);
  const normalized = Math.round(value);
  if (normalized < 0 || normalized > 100) return undefined;
  return normalized;
}

function normalizeCandidateMetadata<T extends {
  score?: unknown;
  sourceLabel?: unknown;
  sourceHref?: unknown;
  evidenceQuote?: unknown;
}>(item: T) {
  return {
    score: normalizeCandidateScore(item?.score),
    sourceLabel: normalizeWhitespace(String(item?.sourceLabel ?? "")) || undefined,
    sourceHref: normalizeWhitespace(String(item?.sourceHref ?? "")) || undefined,
    evidenceQuote: normalizeWhitespace(String(item?.evidenceQuote ?? "")) || undefined,
  };
}

function containsRiskLanguage(value: string): boolean {
  return /\b(risk|pressure|threat|challenge|headwind|dependency|concentration|regulat|compliance|pricing|margin|capital|compute|customer concentration|durability|retention|execution|burn|cash|governance|safety|litigation|antitrust|slowdown|uncertain|exposure)\b/i.test(value);
}

function isQuestionLike(value: string): boolean {
  return /\?$/.test(value.trim()) || /^(what|how|why|when|where|which|who)\b/i.test(value.trim());
}

function looksLikeFundingHeadline(value: string): boolean {
  return /\b(raises?|raised|funding|post-money valuation|valuation marks|targeting a .* ipo|revenue nearly doubled|powerhouse hiding in plain sight|worth buying)\b/i.test(value);
}

function looksLikeEvidenceFragment(value: string): boolean {
  return value.length > 220
    || /^[a-z]/.test(value)
    || /^(per\s+user\/month|this report outlines|this article discusses|according to customer data from)/i.test(value)
    || /^(those|these|they|it)\b/i.test(value)
    || /^\d{1,2},\s+\d{4}\b/.test(value)
    || /\.\.\.|prove this .* valuation is real/i.test(value);
}

function looksLikeNarrativeFluff(value: string): boolean {
  return /^(this report|the report|this article|the article|this comparison|the comparison)\b/i.test(value)
    || /\b(could prove conservative|people will keep using the product|projections suggest|the article argues|the report argues|this report highlights|this comparison highlights)\b/i.test(value)
    || /\b(trajectory resembles|resembles how|feature into a core revenue driver|early capital intensity|market leader in enterprise ai and coding|may hold approximately|anecdotal)\b/i.test(value);
}

function looksLikeSpeculativeCapitalMarketsFiller(value: string): boolean {
  return /\b(an ipo would|eye potential ipos?|valuation volatility|clearest look yet|justify a valuation larger than most|larger than most of the s&p 500|high-growth potential into sustainable, long-term enterprise value)\b/i.test(value);
}

function looksLikeGenericMarketBackdrop(value: string): boolean {
  return /\b(the enterprise ai market is experiencing exponential growth|moves from niche experiments to foundational technology across industries|across industries|industry faces valuation volatility)\b/i.test(value);
}

function looksLikeTruncatedNarrative(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  if (/[.!?]$/.test(normalized)) return false;
  if (/\.\.\.$/.test(normalized)) return true;
  const lastToken = normalized.split(/\s+/).pop() ?? "";
  if (!lastToken) return false;
  if (lastToken.length <= 2) return true;
  if (/^(and|or|but|with|for|to|of|in|on|at|by|as|while|when|because|which|that|who|whose|where|via|than|from|into|over|under|after|before|around|across)$/i.test(lastToken)) {
    return true;
  }
  return false;
}

function cleanEvidenceSentence(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^[-•]+\s*/, "")
    .replace(/^(?:[A-Z][a-z]{2,9}\.?\s+)?[A-Z][a-z]{2,9}\s+\d{1,2},\s+\d{4}\s+[—-]\s*/i, "")
    .replace(/^(?:[A-Z][a-z]{2,9}\.?\s+)?\d{1,2},\s+\d{4}\s+/i, "")
    .replace(/^(?:updated|published|reported)\s+[A-Z][a-z]{2,9}\s+\d{1,2},\s+\d{4}\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasBankerSignalContent(value: string): boolean {
  return /(\$\d|\b\d+%|\b(revenue|run-rate|run rate|growth|pricing|retention|distribution|bundle|bundling|contract|enterprise|valuation|margin|buyers?|share|deployments?|capex|spend|pipeline|bookings|demand|market position|subscriptions?|usage|users?|win rates?)\b)/i.test(value);
}

function scoreEvidenceSentence(value: string): number {
  let score = 0;
  if (/\$\d/.test(value)) score += 3;
  if (/\b\d+%/.test(value)) score += 2;
  if (/\b(revenue|run-rate|run rate|valuation|margin|bookings|capex|pricing|retention)\b/i.test(value)) score += 2;
  if (/\b(contract|enterprise|distribution|buyers?|deployments?|pipeline|demand|market position|win rates?)\b/i.test(value)) score += 1;
  if (/\b(risk|pressure|headwind|challenge|dependency|exposure)\b/i.test(value)) score += 1;
  return score;
}

function hasConcreteMetric(value: string): boolean {
  PERCENT_VALUE_PATTERN.lastIndex = 0;
  return /\$\d/.test(value) || PERCENT_VALUE_PATTERN.test(value) || /\b\d+(?:\.\d+)?\s?(?:B|M|billion|million)\b/i.test(value);
}

function looksLikeSoftAdoptionClaim(value: string): boolean {
  return /\b(leading position|record highs|strong demand|gaining traction|momentum is real|maintains a leading position|business usage rebounding|challenge .* dominance)\b/i.test(value);
}

function scoreUnderwritingSignal(value: string): number {
  let score = scoreEvidenceSentence(value);
  if (hasConcreteMetric(value)) score += 3;
  if (/\b(gross margin|run-rate revenue|run rate revenue|annualized revenue|valuation|backlog|contracts?|pricing|retention|compute costs?|inference costs?|bookings|enterprise spend)\b/i.test(value)) {
    score += 3;
  }
  if (/\b(500 customers|fortune 100|paying users?|per user\/month|\$200\/month|\$25[–-]30 per user\/month)\b/i.test(value)) {
    score += 1;
  }
  if (looksLikeSoftAdoptionClaim(value)) score -= 4;
  if (looksLikeGenericMarketBackdrop(value)) score -= 4;
  if (looksLikeNarrativeFluff(value)) score -= 3;
  return score;
}

function extractSourceHost(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function looksLikeWeakBankerSourceLabel(label: string): boolean {
  return /\b(statistics?(?:\s+202\d)?|top\s+\d+|pitfalls|investors need to know|full financial breakdown|forecast|benchmarks?\b|negotiation tactics|magazine|why .* is winning|dominance is being tested|shocking fall from grace|selling safety as)\b/i.test(label);
}

function scoreSourceAuthority(label: string, href: string | undefined, type: string): number {
  let score = 0;
  const host = extractSourceHost(href);
  if (type !== "web") score += 2;
  if (host && HIGH_AUTHORITY_SOURCE_HOST_PATTERNS.some((pattern) => pattern.test(host))) score += 7;
  if (host && LOW_AUTHORITY_SOURCE_HOST_PATTERNS.some((pattern) => pattern.test(host))) score -= 7;
  if (/\b(official release|official blog|investor relations|shareholder letter|earnings|transcript|10-k|10-q|sec)\b/i.test(label)) score += 5;
  if (/\b(sacra|reuters|bloomberg|new york times|wall street journal|financial times|the information)\b/i.test(label)) score += 4;
  if (looksLikeSourceTitle(label)) score -= 2;
  if (looksLikeWeakBankerSourceLabel(label)) score -= 5;
  return score;
}

function stripTrailingConnectorTail(value: string): string {
  return value
    .replace(/\b(?:as|of|the|with|because|which|that|while|and|or|but|to|for|in|on|at|its|their|a|an)(?:\s+\b(?:as|of|the|with|because|which|that|while|and|or|but|to|for|in|on|at|its|their|a|an))*$/i, "")
    .replace(/[,.:\-\u2013\u2014\s]+$/, "");
}

function compressNarrativePhrase(value: string, maxLength = 140): string {
  const normalized = normalizeWhitespace(value).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized.replace(/\.$/, "");
  const clause = normalized.split(/[;:]/)[0]?.trim() ?? normalized;
  if (clause.length <= maxLength) return clause.replace(/\.$/, "");
  return clause.slice(0, maxLength).replace(/\s+\S*$/, "").replace(/[,.:\-–—\s]+$/, "");
}

function hasNonPeerRelationshipCue(value: string): boolean {
  return /\b(available across|available on|backed by|capital backing|cloud platforms? like|customers including|deployed on|distribution through|hosted on|infrastructure stack|integrated with|partner(?:ed)? with|sold through|strategic backing|used by)\b/i.test(value);
}

function buildDefaultRiskDescription(title: string): string {
  if (/pricing/i.test(title)) {
    return "Large enterprise buyers can use bundled suites and multi-vendor negotiations to pressure pricing and shorten contract duration.";
  }
  if (/capital/i.test(title)) {
    return "Model training and inference costs can compress gross margin and force continued external capital needs.";
  }
  if (/customer concentration/i.test(title)) {
    return "A narrow set of large enterprise accounts can create renewal and spend-concentration risk if one buyer slows usage.";
  }
  if (/regulat/i.test(title)) {
    return "Evolving AI governance, procurement, and compliance rules can slow enterprise adoption and raise diligence burden.";
  }
  if (/distribution/i.test(title)) {
    return "Reliance on larger platform channels can weaken direct buyer access and negotiating leverage.";
  }
  return "Rapid enterprise growth still has to convert into repeatable deployments, retention, and disciplined field execution.";
}

function descriptionMatchesRiskTitle(title: string, description: string): boolean {
  if (/pricing/i.test(title)) return /\b(pricing|discount|bundle|margin|contract|retention)\b/i.test(description);
  if (/capital/i.test(title)) return /\b(capital|compute|burn|cash|capex|inference|training)\b/i.test(description);
  if (/customer concentration/i.test(title)) return /\b(customer concentration|buyers|retention|concentration|renewal|account)\b/i.test(description);
  if (/regulat/i.test(title)) return /\b(regulat|compliance|antitrust|litigation|governance|policy)\b/i.test(description);
  if (/distribution/i.test(title)) return /\b(distribution|platform|ecosystem|channel|bundle|cloud)\b/i.test(description);
  return /\b(execution|retention|deployment|conversion|delivery|concentration|pricing|margin|risk|pressure|headwind)\b/i.test(description);
}

function normalizeChangeDescription(value: string): string {
  const normalized = normalizeNarrativeSentence(value);
  if (!normalized) return "";
  if (!hasBankerSignalContent(normalized)) return "";
  const completeNarrative =
    looksLikeTruncatedNarrative(normalized) && normalized.includes(",")
      ? normalizeWhitespace(normalized.slice(0, normalized.lastIndexOf(",")))
      : normalized;
  if (!completeNarrative) return "";
  if (!looksLikeTruncatedNarrative(completeNarrative)) {
    return stripTrailingConnectorTail(completeNarrative);
  }
  const cleaned = stripTrailingConnectorTail(completeNarrative);
  if (!cleaned || !hasBankerSignalContent(cleaned)) return "";
  if (looksLikeTruncatedNarrative(cleaned)) {
    const compressed = stripTrailingConnectorTail(compressNarrativePhrase(completeNarrative, 210));
    return looksLikeTruncatedNarrative(compressed) ? "" : compressed;
  }
  return cleaned;
}

function focusRiskDescription(value: string, title: string): string {
  const normalized = normalizeNarrativeSentence(value);
  const candidates = sentenceSplit(normalized)
    .map((sentence) => normalizeNarrativeSentence(sentence))
    .filter((sentence) => sentence.length >= 18)
    .filter((sentence) => !looksLikeSourceTitle(sentence))
    .filter((sentence) => !looksLikeFundingHeadline(sentence))
    .filter((sentence) => !looksLikeNarrativeFluff(sentence));
  const matched =
    candidates.find((sentence) => descriptionMatchesRiskTitle(title, sentence))
    ?? candidates.find((sentence) => containsRiskLanguage(`${title} ${sentence}`))
    ?? candidates[0]
    ?? normalized;
  return compressNarrativePhrase(matched, 150);
}

function extractEvidenceSentences(text: string): string[] {
  return sentenceSplit(text)
    .map((sentence) => cleanEvidenceSentence(sentence))
    .filter((sentence) => sentence.length >= 24)
    .filter((sentence) => !looksLikeSourceTitle(sentence))
    .filter((sentence) => !looksLikeEvidenceFragment(sentence))
    .filter((sentence) => !isQuestionLike(sentence))
    .filter((sentence) => hasBankerSignalContent(sentence))
    .sort((a, b) => scoreEvidenceSentence(b) - scoreEvidenceSentence(a))
    .slice(0, 4);
  return sentenceSplit(text)
    .map((sentence) => sentence.replace(/^[-•]\s*/, "").trim())
    .filter((sentence) => sentence.length >= 25)
    .filter((sentence) => !looksLikeSourceTitle(sentence))
    .filter((sentence) => !looksLikeEvidenceFragment(sentence))
    .filter((sentence) => !isQuestionLike(sentence))
    .filter((sentence) => /(\$\d|\b\d+%|\b(revenue|run-rate|run rate|growth|pricing|retention|distribution|bundle|bundling|contract|enterprise|valuation|margin|buyers?|share|deployments?)\b)/i.test(sentence))
    .slice(0, 4);
}

function normalizeNarrativeSentence(value: string): string {
  const cleaned = cleanEvidenceSentence(value)
    .replace(/\*\*/g, "")
    .replace(/`+/g, "")
    .replace(/\[[0-9]+\]\s*/g, "")
    .replace(/^#{1,6}\s+/g, "")
    .replace(/^[^\p{L}\p{N}$#]+/u, "")
    .replace(/^(?:reality check|bottom line|takeaway)\s*:\s*/i, "")
    .trim();
  const colonIndex = cleaned.indexOf(":");
  if (colonIndex > 0 && colonIndex <= 34) {
    const prefix = cleaned.slice(0, colonIndex).trim();
    const suffix = cleaned.slice(colonIndex + 1).trim();
    if (
      suffix.length >= 24
      && hasBankerSignalContent(suffix)
      && /^[A-Z][A-Za-z0-9&'/-]*(?:\s+[A-Z][A-Za-z0-9&'/-]*){0,4}$/.test(prefix)
      && !/\d/.test(prefix)
    ) {
      return suffix;
    }
  }
  return cleaned;
}

function extractEvidenceSentencesSafe(text: string): string[] {
  return sentenceSplit(text)
    .map((sentence) => normalizeNarrativeSentence(sentence))
    .filter((sentence) => sentence.length >= 24)
    .filter((sentence) => !looksLikeSourceTitle(sentence))
    .filter((sentence) => !looksLikeEvidenceFragment(sentence))
    .filter((sentence) => !looksLikeNarrativeFluff(sentence))
    .filter((sentence) => !isQuestionLike(sentence))
    .filter((sentence) => hasBankerSignalContent(sentence))
    .sort((a, b) => scoreEvidenceSentence(b) - scoreEvidenceSentence(a))
    .slice(0, 4);
}

function normalizePossibleCompanyName(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.&, -]+$/g, "")
    .replace(/^(?:while|as|but|and|however|meanwhile|although|despite|if|when|whereas|versus|vs\.?|against|compared to)\s+/i, "")
    .replace(/[.,;:]+$/g, "")
    .trim();
}

function isPotentialCompanyName(name: string, entityName: string): boolean {
  const cleaned = normalizePossibleCompanyName(name);
  if (!cleaned || cleaned.length < 2 || cleaned.length > 60) return false;
  const lower = cleaned.toLowerCase();
  if (lower === entityName.toLowerCase()) return false;
  if (NON_PEER_COMPARABLE_NAMES.has(lower)) return false;
  if (COMPARABLE_CONNECTOR_STOPWORDS.has(lower)) return false;
  if (COMPANY_NAME_STOPWORDS.has(lower)) return false;
  if (SOURCE_ENTITY_STOPWORDS.has(lower)) return false;
  if (/^(the|a|an)\s+/i.test(cleaned)) return false;
  if (/^series\s+[a-z0-9]+$/i.test(cleaned)) return false;
  if (/\b(trainium|inferentia|tpu|tpus|model|models)\b/i.test(cleaned)) return false;
  if (/\.\s+[A-Z]/.test(cleaned)) return false;
  if (/\b(this|that|these|those|half|one)\b/i.test(cleaned)) return false;
  if (/\b(gpus?|cpus?|tpus?|chips?|contracts?|buyers?|accounts?|usage|market|share|pricing|bundling|deployment|deployments)\b/i.test(cleaned)) return false;
  if (/^(today|yesterday|quarter|year|source|report|index|analysis)$/i.test(cleaned)) return false;
  if (/^(AI|API|LLM|ML|GPU|CPU|YoY|ARR|MRR)$/i.test(cleaned)) return false;
  if (/^[A-Z]{2,6}$/.test(cleaned) && !KNOWN_ACRONYM_COMPANY_NAMES.has(cleaned)) return false;
  if (/^[A-Z][a-z]+ly$/.test(cleaned)) return false;
  if (/\b(company overview|overview|analysis|outlook|report|briefing|readout|market update|pricing pressure|enterprise ai)\b/i.test(cleaned)) {
    return false;
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  const nonGenericWords = words.filter((word) => !COMPANY_NAME_STOPWORDS.has(word.toLowerCase()));
  if (nonGenericWords.length === 0) return false;
  const genericWordCount = words.length - nonGenericWords.length;
  if (genericWordCount >= Math.max(1, words.length - 1)) return false;
  return /[A-Z]/.test(cleaned[0] ?? "") || /[A-Z]{2,}/.test(cleaned);
}

function inferSignalTheme(value: string): string {
  const lower = value.toLowerCase();
  if (/\b(run-rate|run rate|arr|mrr|revenue|bookings|sales)\b/.test(lower)) return "revenue";
  if (/\b(growth|accelerat|yoy|quarter|momentum)\b/.test(lower)) return "growth";
  if (/\b(pricing|discount|bundle|bundling|margin|contract|retention|renewal)\b/.test(lower)) return "pricing";
  if (/\b(distribution|partner|channel|ecosystem|bedrock|cloud|platform)\b/.test(lower)) return "distribution";
  if (/\b(enterprise|deployments?|buyers?|subscriptions?|usage|adoption)\b/.test(lower)) return "adoption";
  if (/\b(valuation|funding|capital raise|financing|investor demand)\b/.test(lower)) return "capital_markets";
  if (/\b(regulat|compliance|governance|policy|litigation|antitrust)\b/.test(lower)) return "regulatory";
  if (/\b(compute|training|inference|gpu|capex|capital intensity|burn|cash)\b/.test(lower)) return "capital_intensity";
  if (/\b(product|launch|release|model|feature|developer)\b/.test(lower)) return "product";
  return "general";
}

function selectDiverseSignals(
  items: Array<{ name: string; direction: string; impact: string }>,
): Array<{ name: string; direction: string; impact: string }> {
  const selected: Array<{ name: string; direction: string; impact: string }> = [];
  const themeCounts = new Map<string, number>();
  const themeLimit = new Map<string, number>([
    ["revenue", 1],
    ["growth", 1],
    ["pricing", 1],
    ["distribution", 1],
    ["adoption", 1],
    ["capital_markets", 1],
    ["regulatory", 1],
    ["capital_intensity", 1],
    ["product", 1],
    ["general", 2],
  ]);

  for (const item of items) {
    if (selected.length >= 5) break;
    const theme = inferSignalTheme(item.name);
    if (theme === "adoption" && !hasConcreteMetric(item.name) && looksLikeSoftAdoptionClaim(item.name)) {
      continue;
    }
    const currentCount = themeCounts.get(theme) ?? 0;
    const maxCount = themeLimit.get(theme) ?? 1;
    if (currentCount >= maxCount) continue;
    selected.push(item);
    themeCounts.set(theme, currentCount + 1);
  }

  if (selected.length >= 3) {
    return selected.slice(0, 5);
  }

  for (const item of items) {
    if (selected.length >= 5) break;
    if (selected.some((entry) => entry.name.toLowerCase() === item.name.toLowerCase())) continue;
    selected.push(item);
  }

  return selected.slice(0, 5);
}

function extractComparableCandidatesFromText(
  text: string,
  entityName: string,
  options?: { allowCapitalizedFallback?: boolean },
): string[] {
  const candidates: string[] = [];
  const versusPattern = /\b([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,2})\s+(?:vs\.?|versus|against|compared to)\s+([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,2}(?:\s*(?:,\s*|\s+and\s+)[A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,2})*)/g;
  const nameListPattern =
    "([A-Z][A-Za-z0-9&.-]*(?:\\s+[A-Z][A-Za-z0-9&.-]*){0,2}(?:\\s*(?:,\\s*|\\s+and\\s+)[A-Z][A-Za-z0-9&.-]*(?:\\s+[A-Z][A-Za-z0-9&.-]*){0,2})*)";
  const patterns = [
    new RegExp(`\\b(?:vs\\.?|versus|against|compared to)\\s+${nameListPattern}`, "g"),
    new RegExp(`\\b(?:competitors?|rivals?|alternatives?)\\s+(?:include|includes|are|remain|such as|like)\\s+${nameListPattern}`, "g"),
    new RegExp(`\\b(?:competes?|competing|competed|positioned|stacks up)\\s+(?:most directly\\s+)?(?:with|against|versus|vs\\.?)\\s+${nameListPattern}`, "g"),
  ];

  for (const match of text.matchAll(versusPattern)) {
    for (const segment of [match[1] ?? "", match[2] ?? ""]) {
      for (const part of segment.split(/\s*,\s*|\s+and\s+/i)) {
        const candidate = normalizePossibleCompanyName(part);
        if (isPotentialCompanyName(candidate, entityName)) {
          candidates.push(candidate);
        }
      }
    }
  }

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const segment = match[1] ?? "";
      for (const part of segment.split(/\s*,\s*|\s+and\s+/i)) {
        const candidate = normalizePossibleCompanyName(part);
        if (isPotentialCompanyName(candidate, entityName)) {
          candidates.push(candidate);
        }
      }
    }
  }

  if (
    options?.allowCapitalizedFallback !== false &&
    (
      /\b(compete|competitor|rival|alternative|versus|vs\.|against|compared to|peer set|peer group)\b/i.test(text)
      || (text.toLowerCase().includes(entityName.toLowerCase()) && /\b(pricing|pressure|bundle|distribution|contract|retention|challenge)\b/i.test(text))
      || /\b(pricing|pressure|bundle|distribution|contract|retention|challenge|enterprise|market share)\b/i.test(text)
    )
  ) {
    const capitalizedMatches = text.match(/\b[A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,2}\b/g) ?? [];
    for (const candidate of capitalizedMatches) {
      const cleanedCandidate = normalizePossibleCompanyName(candidate);
      if (isPotentialCompanyName(cleanedCandidate, entityName)) {
        candidates.push(cleanedCandidate);
      }
    }
  }

  return dedupeStrings(candidates).slice(0, 6);
}

function extractEntityCompanyListCandidates(text: string, entityName: string): string[] {
  if (!text.toLowerCase().includes(entityName.toLowerCase())) {
    return [];
  }
  if (!/[,:]/.test(text) && !/\s+and\s+/i.test(text)) {
    return [];
  }
  if (!/\b(enterprise|market|pricing|retention|distribution|platform|models?|companies|labs?)\b/i.test(text)) {
    return [];
  }
  const capitalizedMatches = text.match(/\b[A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,2}\b/g) ?? [];
  const candidates: string[] = [];
  for (const candidate of capitalizedMatches) {
    const cleanedCandidate = normalizePossibleCompanyName(candidate);
    if (isPotentialCompanyName(cleanedCandidate, entityName)) {
      candidates.push(cleanedCandidate);
    }
  }
  return dedupeStrings(candidates).slice(0, 6);
}

function extractLooseComparableCandidatesFromText(
  text: string,
  entityName: string,
  options?: { allowStrategicCue?: boolean },
): string[] {
  const hasCompetitiveCue = /\b(compete|competitor|rival|alternative|versus|vs\.|against|compared to|peer set|peer group|compare)\b/i.test(text);
  const hasStrategicCue =
    options?.allowStrategicCue === true
    && /\b(pricing|pressure|bundle|distribution|contract|retention|buyer|buyers|enterprise)\b/i.test(text);
  const listCandidates = extractEntityCompanyListCandidates(text, entityName);
  if (listCandidates.length > 0) {
    return listCandidates;
  }
  if (!hasCompetitiveCue && hasNonPeerRelationshipCue(text)) {
    return [];
  }
  if (!hasCompetitiveCue && !hasStrategicCue) {
    return [];
  }
  const candidates: string[] = [];
  const capitalizedMatches = text.match(/\b[A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,2}\b/g) ?? [];
  for (const candidate of capitalizedMatches) {
    const cleanedCandidate = normalizePossibleCompanyName(candidate);
    if (isPotentialCompanyName(cleanedCandidate, entityName)) {
      candidates.push(cleanedCandidate);
    }
  }
  return dedupeStrings(candidates).slice(0, 6);
}

function addComparableCandidateScores(
  scores: Map<string, { name: string; score: number }>,
  candidates: string[],
  weight: number,
): void {
  for (const candidate of candidates) {
    const cleaned = normalizeWhitespace(candidate);
    const key = cleaned.toLowerCase();
    if (!cleaned || !key) continue;
    const existing = scores.get(key);
    if (existing) {
      existing.score += weight;
      continue;
    }
    scores.set(key, { name: cleaned, score: weight });
  }
}

function deriveComparableCandidates(execution: HarnessExecution, entityName: string): string[] {
  if (execution.plan.classification === "multi_entity") {
    const comparisonTargets = dedupeStrings(
      (execution.plan.entityTargets ?? []).filter((target): target is string => typeof target === "string" && Boolean(target)),
    );
    return (comparisonTargets.slice(1).length > 0 ? comparisonTargets.slice(1) : comparisonTargets).slice(0, 4);
  }

  const candidateScores = new Map<string, { name: string; score: number }>();
  const fallbackTexts: string[] = [];
  const fallbackNarrativeTexts: string[] = [];
  const fallbackTitleTexts: string[] = [];

  for (const target of execution.plan.entityTargets ?? []) {
    if (typeof target === "string" && isPotentialCompanyName(target, entityName)) {
      addComparableCandidateScores(candidateScores, [target], 2.5);
    }
  }

  for (const step of execution.stepResults) {
    if (!step.success || !step.result) continue;
    const raw = step.result as any;

    if (Array.isArray(raw?.comparables)) {
      for (const comparable of raw.comparables) {
        const name = typeof comparable === "string" ? comparable : comparable?.name;
        if (typeof name === "string" && isPotentialCompanyName(name, entityName)) {
          addComparableCandidateScores(candidateScores, [name], 1.5);
        }
      }
    }

    if (Array.isArray(raw?.competitors)) {
      for (const comparable of raw.competitors) {
        const name = typeof comparable === "string" ? comparable : comparable?.name;
        if (typeof name === "string" && isPotentialCompanyName(name, entityName)) {
          addComparableCandidateScores(candidateScores, [name], 1.75);
        }
      }
    }

    const textBlobs: string[] = [];
    if (typeof raw?.answer === "string") {
      fallbackTexts.push(raw.answer);
      if (!looksLikeSourceTitle(raw.answer)) fallbackNarrativeTexts.push(raw.answer);
      addComparableCandidateScores(
        candidateScores,
        extractComparableCandidatesFromText(raw.answer, entityName, { allowCapitalizedFallback: false }),
        2.5,
      );
    }
    if (typeof raw?.summary === "string") {
      fallbackTexts.push(raw.summary);
      if (!looksLikeSourceTitle(raw.summary)) fallbackNarrativeTexts.push(raw.summary);
      addComparableCandidateScores(
        candidateScores,
        extractComparableCandidatesFromText(raw.summary, entityName, { allowCapitalizedFallback: false }),
        2.25,
      );
    }
    if (typeof raw?.description === "string") {
      fallbackTexts.push(raw.description);
      if (!looksLikeSourceTitle(raw.description)) fallbackNarrativeTexts.push(raw.description);
      addComparableCandidateScores(
        candidateScores,
        extractComparableCandidatesFromText(raw.description, entityName, { allowCapitalizedFallback: false }),
        2.25,
      );
    }
    if (typeof raw?.content === "string") {
      fallbackTexts.push(raw.content);
      if (!looksLikeSourceTitle(raw.content)) fallbackNarrativeTexts.push(raw.content);
      addComparableCandidateScores(
        candidateScores,
        extractComparableCandidatesFromText(raw.content, entityName, { allowCapitalizedFallback: false }),
        2,
      );
    }
    for (const signal of raw?.signals ?? raw?.findings ?? []) {
      const signalText = typeof signal === "string" ? signal : signal?.name;
      if (typeof signalText === "string") {
        fallbackTexts.push(signalText);
        if (!looksLikeSourceTitle(signalText)) fallbackNarrativeTexts.push(signalText);
        addComparableCandidateScores(
          candidateScores,
          extractComparableCandidatesFromText(signalText, entityName, { allowCapitalizedFallback: false }),
          2,
        );
      }
    }
    for (const item of raw?.sources ?? []) {
      if (typeof item?.name === "string") {
        fallbackTexts.push(item.name);
        fallbackTitleTexts.push(item.name);
        addComparableCandidateScores(
          candidateScores,
          extractComparableCandidatesFromText(item.name, entityName, { allowCapitalizedFallback: false }),
          2.5,
        );
      }
      if (typeof item?.title === "string") {
        fallbackTexts.push(item.title);
        fallbackTitleTexts.push(item.title);
        addComparableCandidateScores(
          candidateScores,
          extractComparableCandidatesFromText(item.title, entityName, { allowCapitalizedFallback: false }),
          2.5,
        );
      }
      if (typeof item?.snippet === "string") {
        fallbackTexts.push(item.snippet);
        if (!looksLikeSourceTitle(item.snippet)) fallbackNarrativeTexts.push(item.snippet);
        addComparableCandidateScores(
          candidateScores,
          extractComparableCandidatesFromText(item.snippet, entityName, { allowCapitalizedFallback: false }),
          2.25,
        );
      }
      if (typeof item?.description === "string") {
        fallbackTexts.push(item.description);
        if (!looksLikeSourceTitle(item.description)) fallbackNarrativeTexts.push(item.description);
        addComparableCandidateScores(
          candidateScores,
          extractComparableCandidatesFromText(item.description, entityName, { allowCapitalizedFallback: false }),
          2,
        );
      }
    }
    for (const item of raw?.results ?? raw?.webResults ?? []) {
      if (typeof item?.title === "string") {
        fallbackTexts.push(item.title);
        fallbackTitleTexts.push(item.title);
        addComparableCandidateScores(
          candidateScores,
          extractComparableCandidatesFromText(item.title, entityName, { allowCapitalizedFallback: false }),
          2.5,
        );
      }
      if (typeof item?.snippet === "string") {
        fallbackTexts.push(item.snippet);
        if (!looksLikeSourceTitle(item.snippet)) fallbackNarrativeTexts.push(item.snippet);
        addComparableCandidateScores(
          candidateScores,
          extractComparableCandidatesFromText(item.snippet, entityName, { allowCapitalizedFallback: false }),
          2.25,
        );
      }
      if (typeof item?.description === "string") {
        fallbackTexts.push(item.description);
        if (!looksLikeSourceTitle(item.description)) fallbackNarrativeTexts.push(item.description);
        addComparableCandidateScores(
          candidateScores,
          extractComparableCandidatesFromText(item.description, entityName, { allowCapitalizedFallback: false }),
          2,
        );
      }
      if (typeof item?.content === "string") {
        fallbackTexts.push(item.content);
        if (!looksLikeSourceTitle(item.content)) fallbackNarrativeTexts.push(item.content);
        addComparableCandidateScores(
          candidateScores,
          extractComparableCandidatesFromText(item.content, entityName, { allowCapitalizedFallback: false }),
          2,
        );
      }
    }
  }

  if (candidateScores.size < 2) {
    for (const text of fallbackNarrativeTexts) {
      const listCandidates = extractEntityCompanyListCandidates(text, entityName);
      const looseCandidates =
        listCandidates.length > 0
          ? listCandidates
          : extractLooseComparableCandidatesFromText(text, entityName, { allowStrategicCue: true });
      addComparableCandidateScores(
        candidateScores,
        looseCandidates,
        listCandidates.length > 0 ? 1.5 : 1,
      );
    }
  }

  if (candidateScores.size < 2) {
    for (const text of fallbackTitleTexts) {
      const listCandidates = extractEntityCompanyListCandidates(text, entityName);
      const looseCandidates =
        listCandidates.length > 0
          ? listCandidates
          : extractLooseComparableCandidatesFromText(text, entityName, { allowStrategicCue: candidateScores.size > 0 });
      addComparableCandidateScores(
        candidateScores,
        looseCandidates,
        1.25,
      );
    }
  }

  const ranked = Array.from(candidateScores.values())
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  const highConfidence = ranked.filter((entry) => entry.score >= 2).map((entry) => entry.name);
  if (highConfidence.length > 0) {
    const selected = [...highConfidence];
    for (const entry of ranked) {
      if (selected.length >= 4) break;
      if (selected.includes(entry.name)) continue;
      if (entry.score < 1.25) continue;
      selected.push(entry.name);
    }
    return selected.slice(0, 4);
  }
  return ranked.map((entry) => entry.name).slice(0, 2);
}

function mergeSignals(
  primary: SynthesizedSignal[],
  fallbacks: SynthesizedSignal[],
): SynthesizedSignal[] {
  const seen = new Set<string>();
  const merged: SynthesizedSignal[] = [];
  for (const item of [...primary, ...fallbacks]) {
    const key = normalizeWhitespace(item.name).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(0, 5);
}

function isNarrativeReadySignal(value: string): boolean {
  if (looksLikeSourceTitle(value)) return false;
  if (/^(Anthropic|OpenAI|Google|Microsoft|Amazon)\s+(raises|raised|funding|doubles funding|plans to raise)\b/i.test(value)) {
    return false;
  }
  if (/\bseries\s+[a-z0-9]+\b/i.test(value)) return false;
  return true;
}

function collectFallbackSignals(
  execution: HarnessExecution,
  context?: { entityName?: string; classification?: string; entityTargets?: string[] },
): SynthesizedSignal[] {
  const signals: Array<Partial<SynthesizedSignal>> = [];
  for (const step of execution.stepResults) {
    if (!step.success || !step.result) continue;
    const raw = step.result as any;
    if (step.toolName === "run_recon" && Array.isArray(raw?.findings)) {
      for (const finding of raw.findings) {
        signals.push({
          name: typeof finding === "string" ? finding : finding?.name,
          direction: typeof finding === "object" ? finding?.direction : "neutral",
          impact: typeof finding === "object" ? finding?.impact : "medium",
        });
      }
    }
    if (step.toolName === "enrich_entity" && Array.isArray(raw?.signals)) {
      for (const signal of raw.signals) {
        signals.push({
          name: typeof signal === "string" ? signal : signal?.name,
          direction: typeof signal === "object" ? signal?.direction : "neutral",
          impact: typeof signal === "object" ? signal?.impact : "medium",
        });
      }
    }
    for (const sentence of extractEvidenceSentencesSafe(String(raw?.answer ?? raw?.summary ?? raw?.description ?? ""))) {
      signals.push({ name: sentence, direction: "neutral", impact: "high" });
    }
    for (const source of [...(Array.isArray(raw?.sources) ? raw.sources : []), ...(Array.isArray(raw?.results) ? raw.results : []), ...(Array.isArray(raw?.webResults) ? raw.webResults : [])].slice(0, 6)) {
      for (const sentence of extractEvidenceSentencesSafe(String(source?.snippet ?? source?.description ?? source?.content ?? ""))) {
        signals.push({ name: sentence, direction: "neutral", impact: "medium" });
      }
    }
  }
  return sanitizeSignals(signals, context);
}

function looksLikeOperationalChange(value: string): boolean {
  return /\b(announced|expanded|grew|growth|increased|launched|now exceeds|partnered|quadrupled|reached|released|reported|represent over half|tripled|updated|unveiled)\b/i.test(value);
}

function collectFallbackChanges(execution: HarnessExecution): Array<{ description: string; date?: string }> {
  const changes: Array<{ description: string; date?: string }> = [];
  for (const step of execution.stepResults) {
    if (!step.success || !step.result) continue;
    const raw = step.result as any;

    if (step.toolName === "run_recon" && Array.isArray(raw?.findings)) {
      for (const finding of raw.findings) {
        const description = String(typeof finding === "string" ? finding : finding?.name ?? "");
        if (!description || !looksLikeOperationalChange(description)) continue;
        changes.push({ description });
      }
    }

    for (const change of Array.isArray(raw?.changes) ? raw.changes : []) {
      const description = String(typeof change === "string" ? change : change?.description ?? change?.change ?? "");
      if (!description || !looksLikeOperationalChange(description)) continue;
      changes.push({ description, date: typeof change === "object" ? change?.date : undefined });
    }

    for (const sentence of extractEvidenceSentencesSafe(String(raw?.answer ?? raw?.summary ?? raw?.description ?? ""))) {
      const description = sentence;
      if (!description || !looksLikeOperationalChange(description)) continue;
      changes.push({ description });
    }

    for (const source of [...(Array.isArray(raw?.sources) ? raw.sources : []), ...(Array.isArray(raw?.results) ? raw.results : []), ...(Array.isArray(raw?.webResults) ? raw.webResults : [])].slice(0, 8)) {
      for (const sentence of extractEvidenceSentencesSafe(String(source?.snippet ?? source?.description ?? source?.content ?? ""))) {
        const description = sentence;
        if (!description || !looksLikeOperationalChange(description)) continue;
        changes.push({ description });
      }
    }
  }
  return changes;
}

function collectFallbackRisks(execution: HarnessExecution): Array<{ title: string; description: string }> {
  const risks: Array<{ title?: string; description?: string }> = [];
  for (const step of execution.stepResults) {
    if (!step.success || !step.result) continue;
    const raw = step.result as any;

    if (step.toolName === "run_recon" && Array.isArray(raw?.findings)) {
      for (const finding of raw.findings) {
        const description = normalizeWhitespace(String(typeof finding === "string" ? finding : finding?.name ?? ""));
        const direction = String(typeof finding === "object" ? finding?.direction ?? "" : "");
        if (!description) continue;
        if (direction === "down" || containsRiskLanguage(description)) {
          risks.push({ title: inferRiskTitleFromDescription(description), description });
        }
      }
    }

    if (Array.isArray(raw?.risks)) {
      for (const risk of raw.risks) {
        risks.push({
          title: typeof risk === "object" ? String(risk?.title ?? "") : "",
          description: typeof risk === "string" ? risk : String(risk?.description ?? ""),
        });
      }
    }

    for (const sentence of extractEvidenceSentencesSafe(String(raw?.answer ?? raw?.summary ?? raw?.description ?? ""))) {
      if (containsRiskLanguage(sentence)) {
        risks.push({ title: inferRiskTitleFromDescription(sentence), description: sentence });
      }
    }

    for (const source of [...(Array.isArray(raw?.sources) ? raw.sources : []), ...(Array.isArray(raw?.results) ? raw.results : []), ...(Array.isArray(raw?.webResults) ? raw.webResults : [])].slice(0, 8)) {
      for (const sentence of extractEvidenceSentencesSafe(String(source?.snippet ?? source?.description ?? source?.content ?? ""))) {
        if (containsRiskLanguage(sentence)) {
          risks.push({ title: inferRiskTitleFromDescription(sentence), description: sentence });
        }
      }
    }
  }
  return sanitizeRisks(risks);
}

function sanitizeSignals(
  items: Array<Partial<SynthesizedSignal>> | undefined,
  context?: { entityName?: string; classification?: string; entityTargets?: string[] },
): SynthesizedSignal[] {
  const seen = new Set<string>();
  const sanitized: SynthesizedSignal[] = [];
  for (const item of items ?? []) {
    const name = normalizeNarrativeSentence(String(item?.name ?? ""));
    if (!name || /^signal \d+$/i.test(name)) continue;
    if (/^(company overview|overview|analysis|outlook report|the)$/i.test(name)) continue;
    if (/\b(company overview|overview|analysis|outlook report|market update)\b/i.test(name)) continue;
    if (looksLikeAmbiguousSubjectSignal(name)) continue;
    if (looksLikeFundingHeadline(name)) continue;
    if (looksLikeEvidenceFragment(name)) continue;
    if (looksLikeNarrativeFluff(name)) continue;
    if (looksLikeSpeculativeCapitalMarketsFiller(name)) continue;
    if (looksLikeGenericMarketBackdrop(name)) continue;
    if (
      context?.entityName
      && isSingleEntityPacketClassification(context.classification)
      && !isEntityGroundedCandidate(
        {
          text: name,
          sourceLabel: item?.sourceLabel,
          sourceHref: item?.sourceHref,
          evidenceQuote: item?.evidenceQuote,
        },
        context.entityName,
        context.entityTargets,
      )
    ) {
      continue;
    }
    if (name.length > 100 && /[-:]\s[A-Z][A-Za-z0-9&.\s]+$/.test(name)) continue;
    if (looksLikeSourceTitle(name)) continue;
    if (!hasBankerSignalContent(name) && !containsRiskLanguage(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const metadata = normalizeCandidateMetadata(item);
    sanitized.push({
      name,
      direction: item?.direction === "up" || item?.direction === "down" ? item.direction : "neutral",
      impact: item?.impact === "high" || item?.impact === "low" ? item.impact : "medium",
      ...metadata,
    });
  }
  return selectDiverseSignals(
    sanitized
      .sort((a, b) => scoreUnderwritingSignal(b.name) - scoreUnderwritingSignal(a.name)),
  );
}

function sanitizeChanges(
  items: Array<Partial<SynthesizedChange>> | undefined,
  context?: { entityName?: string; classification?: string; entityTargets?: string[] },
): SynthesizedChange[] {
  const normalizedEntries = (items ?? [])
    .map((item) => ({
      description: normalizeChangeDescription(String(item?.description ?? "")),
      date: item?.date ?? undefined,
      ...normalizeCandidateMetadata(item),
    }))
    .filter((item) => item.description.length > 0);
  const deduped = dedupeStrings(preferLongerNarrativeVariants(normalizedEntries.map((item) => item.description)))
    .filter((description) => description.length >= 18)
    .filter((description) => !looksLikeSourceTitle(description))
    .filter((description) => !looksLikeFundingHeadline(description))
    .filter((description) => !looksLikeEvidenceFragment(description))
    .filter((description) => !looksLikeNarrativeFluff(description))
    .filter((description) => !looksLikeSpeculativeCapitalMarketsFiller(description))
    .filter((description) => !looksLikeGenericMarketBackdrop(description))
    .filter((description) => !looksLikeAmbiguousSubjectSignal(description))
    .filter((description) => !/\b(sacra|24\/7 wall st|forbes|axios|deepresearchglobal)\b/i.test(description));
  return deduped.slice(0, 4).map((description) => ({
    description,
    date: normalizedEntries.find((item) => item.description === description)?.date,
    score: normalizedEntries.find((item) => item.description === description)?.score,
    sourceLabel: normalizedEntries.find((item) => item.description === description)?.sourceLabel,
    sourceHref: normalizedEntries.find((item) => item.description === description)?.sourceHref,
    evidenceQuote: normalizedEntries.find((item) => item.description === description)?.evidenceQuote,
  })).filter((item) => {
    if (!context?.entityName || !isSingleEntityPacketClassification(context.classification)) return true;
    return isEntityGroundedCandidate(
      {
        text: item.description,
        sourceLabel: item.sourceLabel,
        sourceHref: item.sourceHref,
        evidenceQuote: item.evidenceQuote,
      },
      context.entityName,
      context.entityTargets,
    );
  });
}

function inferRiskTitleFromDescription(description: string): string {
  if (/\bpricing|bundle|discount|margin\b/i.test(description)) return "Pricing pressure";
  if (/\bcustomer concentration|enterprise buyers|buyer concentration|retention\b/i.test(description)) return "Customer concentration";
  if (/\bregulat|compliance|litigation|antitrust|governance\b/i.test(description)) return "Regulatory exposure";
  if (/\bcapital|compute|cash|burn|capex\b/i.test(description)) return "Capital intensity";
  if (/\bdistribution|platform|ecosystem\b/i.test(description)) return "Distribution dependency";
  return "Execution risk";
}

function sanitizeRisks(
  items: Array<Partial<SynthesizedRisk>> | undefined,
  context?: { entityName?: string; classification?: string; entityTargets?: string[] },
): SynthesizedRisk[] {
  const seen = new Set<string>();
  const seenTitles = new Set<string>();
  const sanitized: SynthesizedRisk[] = [];
  for (const item of items ?? []) {
    let title = normalizeWhitespace(String(item?.title ?? ""));
    let description = normalizeNarrativeSentence(String(item?.description ?? ""));
    if (!description || description.length < 18) continue;
    if (looksLikeSourceTitle(description)) continue;
    if (looksLikeFundingHeadline(description)) continue;
    if (looksLikeEvidenceFragment(description)) continue;
    if (looksLikeNarrativeFluff(description)) continue;
    if (!title || isQuestionLike(title) || looksLikeSourceTitle(title) || title.length > 90) {
      title = inferRiskTitleFromDescription(description);
    }
    if (looksLikeFundingHeadline(title)) {
      title = inferRiskTitleFromDescription(description);
    }
    description = focusRiskDescription(description, title);
    if (!descriptionMatchesRiskTitle(title, description) || (!/[.!?]$/.test(description) && description.length > 85)) {
      description = buildDefaultRiskDescription(title);
    }
    if (!containsRiskLanguage(`${title} ${description}`)) continue;
    if (
      context?.entityName
      && isSingleEntityPacketClassification(context.classification)
      && !isEntityGroundedCandidate(
        {
          text: `${title}. ${description}`,
          sourceLabel: item?.sourceLabel,
          sourceHref: item?.sourceHref,
          evidenceQuote: item?.evidenceQuote,
        },
        context.entityName,
        context.entityTargets,
      )
    ) {
      continue;
    }
    const key = `${title.toLowerCase()}::${description.toLowerCase()}`;
    if (seen.has(key)) continue;
    const titleKey = title.toLowerCase();
    if (seenTitles.has(titleKey)) continue;
    seen.add(key);
    seenTitles.add(titleKey);
    sanitized.push({ title, description, ...normalizeCandidateMetadata(item) });
  }
  return sanitized.slice(0, 4);
}

function sanitizeComparables(
  items: Array<Partial<SynthesizedComparable>> | undefined,
  entityName: string,
  fallbacks: string[],
  context?: { classification?: string; entityTargets?: string[] },
): SynthesizedComparable[] {
  const seen = new Set<string>();
  const sanitized: SynthesizedComparable[] = [];
  const fallbackSet = new Set(fallbacks.map((value) => normalizeWhitespace(value).toLowerCase()).filter(Boolean));
  const normalizedTargets = dedupeStrings((context?.entityTargets ?? []).map((value) => normalizeWhitespace(String(value))));
  const targetSet = new Set(normalizedTargets.map((value) => value.toLowerCase()).filter(Boolean));
  const entityTokens = new Set(entityName.split(/\s+vs\s+|\s*,\s*/i).map((value) => normalizeWhitespace(value).toLowerCase()).filter(Boolean));
  const anchorTarget = normalizedTargets[0]?.toLowerCase();

  const pushComparable = (
    name: string,
    relevance = "medium",
    note = "Referenced in cited sources.",
    metadata?: ReturnType<typeof normalizeCandidateMetadata>,
  ) => {
    const cleanedName = normalizeWhitespace(name);
    const explicitTarget = targetSet.has(cleanedName.toLowerCase());
    if (!explicitTarget && !isPotentialCompanyName(cleanedName, entityName)) return;
    const lowerName = cleanedName.toLowerCase();
    const noteText = normalizeWhitespace(note).toLowerCase();
    if (SOURCE_ENTITY_STOPWORDS.has(lowerName) && !explicitTarget) return;
    if (looksLikeSourceTitle(cleanedName)) return;
    if (/\b(index|statistics|report|briefing|analysis|investors need to know)\b/i.test(`${cleanedName} ${note}`)) return;
    if (context?.classification === "multi_entity") {
      if (anchorTarget && lowerName === anchorTarget && normalizedTargets.length > 1) return;
      if (!targetSet.has(lowerName) && !fallbackSet.has(lowerName)) return;
      if (entityTokens.has(lowerName) && !targetSet.has(lowerName)) return;
    }
    if ((context?.classification === "competitor" || context?.classification === "company_search") && fallbackSet.size > 0) {
      if (!fallbackSet.has(lowerName) && !targetSet.has(lowerName)) return;
    }
    if ((/research|index|statistics|report|outlook|news|publication|newsletter/.test(noteText) || /market update/.test(noteText)) && !targetSet.has(lowerName)) {
      return;
    }
    const key = cleanedName.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    sanitized.push({
      name: cleanedName,
      relevance: relevance === "high" || relevance === "low" ? relevance : "medium",
      note: normalizeWhitespace(note || "Referenced in cited sources."),
      ...metadata,
    });
  };

  for (const item of items ?? []) {
    pushComparable(
      String(item?.name ?? ""),
      String(item?.relevance ?? "medium"),
      String(item?.note ?? ""),
      normalizeCandidateMetadata(item),
    );
  }
  for (const fallback of fallbacks) {
    pushComparable(fallback, "medium", "Derived from cited competitive references.");
  }
  if (context?.classification === "multi_entity") {
    for (const target of normalizedTargets.slice(1)) {
      pushComparable(target, "high", "Explicit company in the scoped comparison set.");
    }
  }

  const maxComparables = context?.classification === "multi_entity" ? 4 : 2;
  return sanitized.slice(0, maxComparables);
}

function sanitizeNextActions(
  items: Array<{ action?: string; impact?: string }> | undefined,
  lens: string,
  entityName: string,
  comparables: Array<{ name: string; relevance: string; note: string }>,
  risks: Array<{ title: string; description: string }>,
  context?: { classification?: string; entityTargets?: string[] },
): Array<{ action: string; impact: string }> {
  const deduped = dedupeStrings((items ?? []).map((item) => String(item?.action ?? "")));
  const sanitized = deduped
    .filter((action) => action.length >= 12)
    .filter((action) => !/contextQuestions|check_framework|gather project|ingest_upload|Answer any|Use\s+\w+_\w+/i.test(action))
    .filter((action) => !/^(review the provided context|gather project context|answer context questions)/i.test(action))
    .filter((action) => !/^(do more research|research further|investigate further)$/i.test(action))
    .filter((action) => context?.classification !== "multi_entity" || !/\bbenchmark\b.+\bagainst\b/i.test(action))
    .slice(0, 3)
    .map((action, index) => ({
      action,
      impact: items?.[index]?.impact === "low" || items?.[index]?.impact === "medium" ? items[index].impact : "high",
    }));

  const topComparable = comparables[0]?.name;
  const topRisk = risks[0]?.title.toLowerCase().includes("regulat") || risks[0]?.description.toLowerCase().includes("regulat")
    ? `Pressure-test regulatory and diligence exposure around ${entityName}.`
    : topComparable
      ? `Benchmark ${entityName} against ${topComparable} on positioning, pricing, and enterprise traction.`
      : `Pressure-test the core investment thesis for ${entityName} against the cited evidence.`;

  const targetNames = dedupeStrings((context?.entityTargets ?? []).map((item) => normalizeWhitespace(String(item))));
  const comparisonLabel = targetNames.length > 1 ? targetNames.join(", ") : entityName;
  const defaults =
    context?.classification === "multi_entity" && lens === "banker"
      ? [
          `Build a side-by-side diligence matrix for ${comparisonLabel} covering pricing, enterprise traction, buyer fit, and contract durability.`,
          `Pressure-test which company has the most defensible distribution advantage versus bundled platform pressure.`,
          `Map likely strategic buyers, counterparties, or financing narratives for each company in the set before choosing a preferred angle.`,
        ]
      : context?.classification === "multi_entity" && lens === "investor"
        ? [
            `Build a side-by-side market map for ${comparisonLabel} covering pricing power, enterprise traction, and distribution leverage.`,
            `Pressure-test whether the current winner is product-led, distribution-led, or simply benefiting from timing and narrative momentum.`,
            `Identify the one data point that would most change the relative ranking across the current peer set.`,
          ]
        : lens === "banker"
      ? [
          `Build a buyer and strategic-counterparty map for ${entityName} using the current competitive set.`,
          `Pressure-test revenue durability, customer concentration, and capital intensity for ${entityName}.`,
          topRisk,
        ]
      : lens === "investor"
        ? [
            `Benchmark ${entityName}'s market position, share gains, and enterprise traction against the nearest cited peer set.`,
            `Pressure-test whether ${entityName}'s current edge is product-led, distribution-led, or simply timing-driven.`,
            topRisk,
          ]
        : [
            `Identify which cited signals for ${entityName} are durable versus narrative-driven.`,
            `Turn the strongest comparable set into an explicit positioning map for ${entityName}.`,
            topRisk,
          ];

  const merged = [...sanitized];
  for (const action of defaults) {
    if (merged.length >= 3) break;
    if (merged.some((item) => item.action.toLowerCase() === action.toLowerCase())) continue;
    merged.push({ action, impact: "high" });
  }

  return merged.slice(0, 3);
}

function buildDefaultNextQuestions(args: {
  classification: string;
  entityName: string;
  comparables: Array<{ name: string; relevance: string; note: string }>;
  risks: Array<{ title: string; description: string }>;
  entityTargets?: string[];
}): string[] {
  if (args.classification === "multi_entity") {
    const comparisonLabel = dedupeStrings((args.entityTargets ?? []).map((item) => normalizeWhitespace(String(item)))).slice(0, 3).join(", ") || args.entityName;
    return [
      `Which company in ${comparisonLabel} has the strongest enterprise distribution today, and what evidence would overturn that ranking?`,
      `Where do pricing power and contract durability differ most across the current peer set?`,
      `Which buyer segment structurally favors one company over the others, and why?`,
      `What evidence would most change the relative ranking across the current comparison set?`,
    ];
  }

  return [
    `What are the specific drivers behind ${args.entityName}'s recent growth or decline?`,
    args.risks.length > 0
      ? `How likely is "${args.risks[0]?.title}" to materialize, and what would trigger it?`
      : `What are the biggest threats to ${args.entityName}'s market position?`,
    args.comparables.length > 0
      ? `How does ${args.entityName} compare to ${args.comparables[0]?.name} on unit economics and retention?`
      : `Who are ${args.entityName}'s most dangerous competitors and why?`,
    `What would make you change your thesis on ${args.entityName} and what evidence would you need to see?`,
  ];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferMetricEntity(value: string, entityName: string, entityTargets?: string[]): string | null {
  const orderedTargets = dedupeStrings([...(entityTargets ?? []), entityName].map((item) => normalizeWhitespace(String(item))));
  for (const target of orderedTargets) {
    if (!target) continue;
    const pattern = new RegExp(`\\b${escapeRegex(target)}\\b`, "i");
    if (pattern.test(value)) return target;
  }
  return null;
}

function isSingleEntityPacketClassification(classification?: string): boolean {
  return classification === "company_search";
}

function hrefMentionsEntityTarget(href: string | undefined, entityName: string, entityTargets?: string[]): boolean {
  if (!href) return false;
  const lowerHref = href.toLowerCase();
  const orderedTargets = dedupeStrings([...(entityTargets ?? []), entityName].map((item) => normalizeWhitespace(String(item)))).filter(Boolean);
  for (const target of orderedTargets) {
    const lowerTarget = target.toLowerCase();
    if (lowerHref.includes(lowerTarget)) return true;
    const tokens = lowerTarget.split(/\s+/).filter((token) => token.length >= 3);
    if (tokens.length > 0 && tokens.every((token) => lowerHref.includes(token))) return true;
  }
  return false;
}

function isEntityGroundedCandidate(
  value: { text?: string; sourceLabel?: string; sourceHref?: string; evidenceQuote?: string },
  entityName: string,
  entityTargets?: string[],
): boolean {
  const combined = normalizeWhitespace(
    [value.text, value.sourceLabel, value.evidenceQuote]
      .map((item) => String(item ?? ""))
      .join(" "),
  );
  if (combined && inferMetricEntity(combined, entityName, entityTargets) !== null) {
    return true;
  }
  return hrefMentionsEntityTarget(value.sourceHref, entityName, entityTargets);
}

function findExecutionSourceEvidence(
  execution: HarnessExecution,
  label: string,
  href?: string,
): string | undefined {
  const normalizedLabel = normalizeWhitespace(label).toLowerCase();
  const normalizedHref = normalizeWhitespace(href ?? "").toLowerCase();
  if (!normalizedLabel && !normalizedHref) return undefined;

  for (const step of execution.stepResults) {
    if (!step.success || !step.result) continue;
    const raw = step.result as any;
    const candidates = [
      ...(Array.isArray(raw?.sources) ? raw.sources : []),
      ...(Array.isArray(raw?.results) ? raw.results : []),
      ...(Array.isArray(raw?.webResults) ? raw.webResults : []),
    ];

    for (const candidate of candidates) {
      const candidateLabel = normalizeWhitespace(String(candidate?.name ?? candidate?.title ?? candidate?.label ?? ""));
      const candidateHref = normalizeWhitespace(String(candidate?.url ?? candidate?.link ?? candidate?.href ?? ""));
      const labelMatch =
        normalizedLabel.length > 0
        && candidateLabel.length > 0
        && (
          candidateLabel.toLowerCase() === normalizedLabel
          || candidateLabel.toLowerCase().includes(normalizedLabel)
          || normalizedLabel.includes(candidateLabel.toLowerCase())
        );
      const hrefMatch =
        normalizedHref.length > 0
        && candidateHref.length > 0
        && candidateHref.toLowerCase() === normalizedHref;
      if (!labelMatch && !hrefMatch) continue;

      const evidence = normalizeWhitespace(
        String(candidate?.snippet ?? candidate?.description ?? candidate?.summary ?? candidate?.content ?? ""),
      );
      if (evidence) return evidence;
    }
  }

  return undefined;
}

function mentionsEntityTarget(value: string, entityTargets?: string[]): boolean {
  return inferMetricEntity(value, "", entityTargets) !== null;
}

function looksLikeAmbiguousSubjectSignal(value: string): boolean {
  return /^(its|the company|reports indicated|by march|by december|new data from)/i.test(normalizeWhitespace(value));
}

function inferMetricLabels(
  sentence: string,
  entityName: string,
  entityTargets?: string[],
): string[] {
  const normalizedTargets = dedupeStrings((entityTargets ?? []).map((item) => normalizeWhitespace(String(item))));
  const multiEntity = normalizedTargets.length > 1;
  const subject = inferMetricEntity(sentence, entityName, entityTargets) ?? (multiEntity ? null : entityName);
  if (!subject) return [];
  const prefix = `${subject} `;
  const labels: string[] = [];
  if (/\b(annualized revenue|run-rate revenue|run rate revenue|pace to generate|revenue reached|revenue now exceeds|arr)\b/i.test(sentence)) {
    labels.push(`${prefix}revenue`.trim());
  }
  if (/\b(post-money valuation|valuation|valued at)\b/i.test(sentence)) {
    labels.push(`${prefix}valuation`.trim());
  }
  if (/\bgross margin\b/i.test(sentence)) {
    labels.push(`${prefix}gross margin`.trim());
  }
  if (/\b(inference costs?|compute costs?|training costs?|capex)\b/i.test(sentence)) {
    labels.push(`${prefix}compute cost`.trim());
  }
  if (/\b(market share|enterprise l?lm market share|share of enterprise spend|enterprise share)\b/i.test(sentence)) {
    labels.push(`${prefix}market share`.trim());
  }
  if (/\b(year-over-year|yoy|growth)\b/i.test(sentence) && /\d{1,3}(?:,\d{3})*(?:\.\d+)?%/.test(sentence)) {
    labels.push(`${prefix}growth`.trim());
  }
  if (/\b(paying users?|enterprise use|subscriptions?|contracts?|deployments?)\b/i.test(sentence) && /\d{1,3}(?:,\d{3})*(?:\.\d+)?%/.test(sentence)) {
    labels.push(`${prefix}usage mix`.trim());
  }
  return labels;
}

function inferMetricLabel(
  sentence: string,
  entityName: string,
  entityTargets?: string[],
): string | null {
  return inferMetricLabels(sentence, entityName, entityTargets)[0] ?? null;
}

function normalizeMetricValue(rawValue: string): string {
  return normalizeWhitespace(rawValue)
    .replace(/\b(billion|million)\b/gi, (match) => (match.toLowerCase() === "billion" ? "B" : "M"))
    .replace(/\s+([bBmM])\b/g, (_, suffix: string) => suffix.toUpperCase())
    .replace(/\s+(B|M)\b/g, "$1");
}

function getMetricCategory(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("revenue")) return "revenue";
  if (normalized.includes("valuation")) return "valuation";
  if (normalized.includes("gross margin")) return "gross_margin";
  if (normalized.includes("compute cost")) return "compute_cost";
  if (normalized.includes("market share")) return "market_share";
  if (normalized.includes("growth")) return "growth";
  if (normalized.includes("usage mix")) return "usage_mix";
  return "other";
}

function formatMetricClause(metric: { label: string; value: string }): string {
  const label = normalizeWhitespace(metric.label);
  const value = normalizeMetricValue(metric.value);
  if (!label || !value) return "";
  if (/\b(gross margin|growth|market share|usage mix)\b/i.test(label)) {
    return `${label} of ${value}`;
  }
  if (/\b(revenue|valuation|compute cost)\b/i.test(label)) {
    return `${label} at ${value}`;
  }
  return `${label} ${value}`;
}

function joinNaturalLanguage(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function sentenceSupportsMetricLabel(sentence: string, label: string): boolean {
  const normalizedLabel = label.toLowerCase();
  if (normalizedLabel.includes("revenue")) {
    return /\b(annualized revenue|run-rate revenue|run rate revenue|pace to generate|revenue reached|revenue now exceeds|revenue|arr)\b/i.test(sentence);
  }
  if (normalizedLabel.includes("valuation")) {
    return /\b(post-money valuation|valuation|valued at)\b/i.test(sentence);
  }
  if (normalizedLabel.includes("compute cost")) {
    return /\b(inference costs?|compute costs?|training costs?|capex)\b/i.test(sentence);
  }
  if (normalizedLabel.includes("gross margin")) {
    return /\bgross margin\b/i.test(sentence);
  }
  if (normalizedLabel.includes("market share")) {
    return /\b(market share|enterprise l?lm market share|share of enterprise spend|enterprise share)\b/i.test(sentence);
  }
  if (normalizedLabel.includes("growth")) {
    return /\b(year-over-year|yoy|growth)\b/i.test(sentence);
  }
  if (normalizedLabel.includes("usage mix")) {
    return /\b(paying users?|enterprise use|subscriptions?|contracts?|deployments?|share of enterprise spend)\b/i.test(sentence);
  }
  return true;
}

function hasMetricEvidenceSupport(
  label: string,
  value: string,
  evidenceSentences: Array<{ text: string }>,
): boolean {
  const normalizedValue = normalizeMetricValue(value).toLowerCase();
  return evidenceSentences.some((evidence) => {
    if (!sentenceSupportsMetricLabel(evidence.text, label)) return false;
    const selectedCandidate = selectMetricCandidate(evidence.text, label);
    if (!selectedCandidate) return false;
    return normalizeMetricValue(selectedCandidate).toLowerCase() === normalizedValue;
  });
}

function collectMetricMatches(pattern: RegExp, sentence: string): Array<{ value: string; index: number }> {
  const safePattern = new RegExp(pattern.source, pattern.flags);
  return Array.from(sentence.matchAll(safePattern)).map((match) => ({
    value: match[0],
    index: match.index ?? 0,
  }));
}

function selectMetricCandidate(sentence: string, label: string): string | null {
  const currencyMatches = collectMetricMatches(/\$\d+(?:\.\d+)?\s?(?:B|M|billion|million)/gi, sentence);
  const percentMatches = collectMetricMatches(PERCENT_VALUE_PATTERN, sentence);
  const normalizedLabel = label.toLowerCase();

  const closestMatch = (
    matches: Array<{ value: string; index: number }>,
    cuePattern: RegExp,
  ): string | null => {
    if (matches.length === 0) return null;
    const cueMatch = cuePattern.exec(sentence);
    cuePattern.lastIndex = 0;
    if (!cueMatch || typeof cueMatch.index !== "number") {
      return matches[0]?.value ?? null;
    }
    return matches
      .slice()
      .sort((left, right) => Math.abs(left.index - cueMatch.index) - Math.abs(right.index - cueMatch.index))[0]?.value
      ?? null;
  };

  if (normalizedLabel.includes("revenue")) {
    return closestMatch(currencyMatches, /\b(annualized revenue|run-rate revenue|run rate revenue|pace to generate|revenue reached|revenue now exceeds|revenue|arr)\b/i);
  }
  if (normalizedLabel.includes("valuation")) {
    return closestMatch(currencyMatches, /\b(post-money valuation|valuation|valued at)\b/i);
  }
  if (normalizedLabel.includes("compute cost")) {
    return closestMatch(currencyMatches, /\b(inference costs?|compute costs?|training costs?|capex)\b/i);
  }
  if (normalizedLabel.includes("gross margin")) {
    return closestMatch(percentMatches, /\bgross margin\b/i);
  }
  if (normalizedLabel.includes("market share")) {
    return closestMatch(percentMatches, /\b(market share|enterprise l?lm market share|share of enterprise spend|enterprise share)\b/i);
  }
  if (normalizedLabel.includes("growth")) {
    return closestMatch(percentMatches, /\b(year-over-year|yoy|growth)\b/i);
  }
  if (normalizedLabel.includes("usage mix")) {
    return closestMatch(percentMatches, /\b(paying users?|enterprise use|subscriptions?|contracts?|deployments?)\b/i);
  }
  return currencyMatches[0]?.value ?? percentMatches[0]?.value ?? null;
}

function collectMetricSentences(
  execution: HarnessExecution,
  signals: Array<{ name: string }>,
  changes: Array<{ description: string }>,
): Array<{ text: string; source: "signal" | "change" | "tool_text" | "tool_finding" | "web_snippet" }> {
  const evidences: Array<{ text: string; source: "signal" | "change" | "tool_text" | "tool_finding" | "web_snippet" }> = [];
  const pushEvidence = (
    text: unknown,
    source: "signal" | "change" | "tool_text" | "tool_finding" | "web_snippet",
  ) => {
    if (typeof text !== "string" || !text.trim()) return;
    for (const sentence of extractEvidenceSentencesSafe(text)) {
      evidences.push({ text: sentence, source });
    }
  };

  for (const signal of signals) pushEvidence(signal.name, "signal");
  for (const change of changes) pushEvidence(change.description, "change");
  for (const step of execution.stepResults) {
    if (!step.success || !step.result) continue;
    const raw = step.result as any;
    for (const field of [raw?.answer, raw?.summary, raw?.description, raw?.content]) {
      pushEvidence(field, "tool_text");
    }
    for (const finding of raw?.findings ?? raw?.signals ?? []) {
      const text = typeof finding === "string" ? finding : finding?.name;
      pushEvidence(text, "tool_finding");
    }
    for (const item of [...(raw?.sources ?? []), ...(raw?.results ?? []), ...(raw?.webResults ?? [])]) {
      for (const field of [item?.snippet, item?.description, item?.content]) {
        pushEvidence(field, "web_snippet");
      }
    }
  }
  const byText = new Map<string, { text: string; source: "signal" | "change" | "tool_text" | "tool_finding" | "web_snippet"; rank: number }>();
  const sourceRank: Record<string, number> = {
    signal: 5,
    change: 4,
    tool_finding: 3,
    tool_text: 2,
    web_snippet: 1,
  };
  for (const evidence of evidences) {
    const key = normalizeWhitespace(evidence.text).toLowerCase();
    if (!key) continue;
    const rank = sourceRank[evidence.source] ?? 0;
    const existing = byText.get(key);
    if (!existing || rank > existing.rank) {
      byText.set(key, { ...evidence, rank });
    }
  }
  return Array.from(byText.values()).map(({ text, source }) => ({ text, source }));
}

function deriveEvidenceKeyMetrics(args: {
  provided?: Array<{ label?: string; value?: string }>;
  execution: HarnessExecution;
  entityName: string;
  entityTargets?: string[];
  lens?: string;
  classification?: string;
  signals: Array<{ name: string; direction: string; impact: string }>;
  changes: Array<{ description: string; date?: string }>;
}): Array<{ label: string; value: string }> {
  const candidatesByLabelValue = new Map<string, {
    label: string;
    value: string;
    totalScore: number;
    supportCount: number;
    maxScore: number;
  }>();
  const evidenceSentences = collectMetricSentences(args.execution, args.signals, args.changes);
  const scoreMetricEvidence = (
    evidence: { text: string; source: "signal" | "change" | "tool_text" | "tool_finding" | "web_snippet" },
  ): number => {
    let score = scoreEvidenceSentence(evidence.text);
    if (evidence.source === "signal") score += 6;
    else if (evidence.source === "change") score += 5;
    else if (evidence.source === "tool_finding") score += 3;
    else if (evidence.source === "tool_text") score += 2;
    return score;
  };

  const metricValueMatchesLabel = (label: string, value: string): boolean => {
    const normalizedLabel = label.toLowerCase();
    const isCurrency = /\$\d/i.test(value);
    const isPercent = /%/.test(value);
    if (normalizedLabel.includes("revenue") || normalizedLabel.includes("valuation") || normalizedLabel.includes("compute cost")) {
      return isCurrency;
    }
    if (normalizedLabel.includes("gross margin") || normalizedLabel.includes("market share") || normalizedLabel.includes("growth") || normalizedLabel.includes("usage mix")) {
      return isPercent;
    }
    return isCurrency || isPercent;
  };

  const pushMetric = (label: string, value: string, score: number) => {
    const cleanedLabel = normalizeWhitespace(label);
    const cleanedValue = normalizeMetricValue(value);
    if (!cleanedLabel || !cleanedValue) return;
    if (/^(sources?|confidence|comparables?|diligence flags?)$/i.test(cleanedLabel)) return;
    if (!/(\$\d|\d+(?:\.\d+)?%|\d+(?:\.\d+)?(?:x|B|M)\b)/i.test(cleanedValue)) return;
    if (!metricValueMatchesLabel(cleanedLabel, cleanedValue)) return;
    const key = `${cleanedLabel.toLowerCase()}::${cleanedValue.toLowerCase()}`;
    const existing = candidatesByLabelValue.get(key);
    if (existing) {
      existing.totalScore += score;
      existing.supportCount += 1;
      existing.maxScore = Math.max(existing.maxScore, score);
      return;
    }
    candidatesByLabelValue.set(key, {
      label: cleanedLabel,
      value: cleanedValue,
      totalScore: score,
      supportCount: 1,
      maxScore: score,
    });
  };

  for (const item of args.provided ?? []) {
    if (typeof item?.label !== "string" || typeof item?.value !== "string") continue;
    const category = getMetricCategory(item.label);
    const bankerPercentCategory = ["gross_margin", "market_share", "growth", "usage_mix"].includes(category);
    if (args.lens === "banker" && bankerPercentCategory) {
      continue;
    }
    const requiresEvidenceSupport =
      args.lens === "banker"
      && category !== "other";
    if (requiresEvidenceSupport && !hasMetricEvidenceSupport(item.label, item.value, evidenceSentences)) continue;
    pushMetric(item.label, item.value, 3);
  }

  for (const evidence of evidenceSentences) {
    for (const label of inferMetricLabels(evidence.text, args.entityName, args.entityTargets)) {
      const candidate = selectMetricCandidate(evidence.text, label);
      if (!candidate) continue;
      let score = scoreMetricEvidence(evidence);
      if (/\$\d/.test(candidate)) score += 2;
      if (/%/.test(candidate)) score += 1;
      if (label.toLowerCase().includes("revenue") || label.toLowerCase().includes("valuation")) score += 1;
      pushMetric(label, candidate, score);
    }
  }

  const bestByLabel = new Map<string, {
    label: string;
    value: string;
    totalScore: number;
    supportCount: number;
    maxScore: number;
  }>();

  for (const candidate of candidatesByLabelValue.values()) {
    const key = candidate.label.toLowerCase();
    const existing = bestByLabel.get(key);
    if (
      !existing
      || candidate.supportCount > existing.supportCount
      || (candidate.supportCount === existing.supportCount && candidate.totalScore > existing.totalScore)
      || (candidate.supportCount === existing.supportCount
        && candidate.totalScore === existing.totalScore
        && candidate.maxScore > existing.maxScore)
    ) {
      bestByLabel.set(key, candidate);
    }
  }

  const ranked = Array.from(bestByLabel.values())
    .sort((left, right) =>
      right.supportCount - left.supportCount
      || right.totalScore - left.totalScore
      || right.maxScore - left.maxScore
      || left.label.localeCompare(right.label),
    );

  const limit = args.lens === "banker" ? 6 : 4;
  const preferredCategoryOrder =
    args.lens === "banker"
      ? ["revenue", "valuation", "gross_margin", "compute_cost", "market_share", "growth", "usage_mix", "other"]
      : ["revenue", "growth", "valuation", "gross_margin", "compute_cost", "market_share", "usage_mix", "other"];

  const selected: Array<{
    label: string;
    value: string;
    totalScore: number;
    supportCount: number;
    maxScore: number;
  }> = [];
  const selectedLabels = new Set<string>();
  const entityCounts = new Map<string, number>();

  const canSelectMetric = (metric: {
    label: string;
    value: string;
    totalScore: number;
    supportCount: number;
    maxScore: number;
  }): boolean => {
    if (selectedLabels.has(metric.label.toLowerCase())) return false;
    if (!(args.lens === "banker" && args.classification === "multi_entity")) return true;
    const entity = inferMetricEntity(metric.label, args.entityName, args.entityTargets);
    if (!entity) return true;
    return (entityCounts.get(entity.toLowerCase()) ?? 0) < 2;
  };

  const commitMetric = (metric: {
    label: string;
    value: string;
    totalScore: number;
    supportCount: number;
    maxScore: number;
  }) => {
    const key = metric.label.toLowerCase();
    if (selectedLabels.has(key)) return;
    selected.push(metric);
    selectedLabels.add(key);
    const entity = inferMetricEntity(metric.label, args.entityName, args.entityTargets);
    if (entity) {
      const entityKey = entity.toLowerCase();
      entityCounts.set(entityKey, (entityCounts.get(entityKey) ?? 0) + 1);
    }
  };

  for (const category of preferredCategoryOrder) {
    if (selected.length >= limit) break;
    const candidate = ranked.find((metric) => getMetricCategory(metric.label) === category && canSelectMetric(metric));
    if (candidate) commitMetric(candidate);
  }

  for (const metric of ranked) {
    if (selected.length >= limit) break;
    if (!canSelectMetric(metric)) continue;
    commitMetric(metric);
  }

  return selected.map(({ label, value }) => ({ label, value }));
}

function sanitizeSources(
  items: Array<{ label?: string; href?: string; type?: string }> | undefined,
  execution: HarnessExecution,
  context?: { entityName?: string; classification?: string; entityTargets?: string[] },
): Array<{ label: string; href?: string; type: string }> {
  const seen = new Set<string>();
  const sanitized: Array<{ label: string; href?: string; type: string; authorityScore: number }> = [];

  const pushSource = (label: string, href: string | undefined, type: string) => {
    const cleanedLabel = normalizeWhitespace(label);
    if (!cleanedLabel || /^(web_search|run_recon|linkup_search|enrich_entity|simulate_decision_paths)$/i.test(cleanedLabel)) {
      return;
    }
    if (/\b(powerhouse hiding in plain sight|worth buying|turns the tables|arms race|who will win|why .* is winning|leading one half|outlook report|ramp ai index)\b/i.test(cleanedLabel)) {
      return;
    }
    if (href && /vertexaisearch\.cloud\.google\.com\/grounding-api-redirect/i.test(href)) {
      return;
    }
    if (
      context?.entityName
      && isSingleEntityPacketClassification(context.classification)
      && !isEntityGroundedCandidate(
        {
          text: cleanedLabel,
          sourceLabel: cleanedLabel,
          sourceHref: href,
          evidenceQuote: findExecutionSourceEvidence(execution, cleanedLabel, href),
        },
        context.entityName,
        context.entityTargets,
      )
    ) {
      return;
    }
    const authorityScore = scoreSourceAuthority(cleanedLabel, href, type || "web");
    if (authorityScore < 0) {
      return;
    }
    const key = `${cleanedLabel.toLowerCase()}::${href ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    sanitized.push({ label: cleanedLabel, href, type: type || "web", authorityScore });
  };

  for (const item of items ?? []) {
    pushSource(String(item?.label ?? ""), item?.href, String(item?.type ?? "web"));
  }

  if (sanitized.length === 0) {
    for (const step of execution.stepResults) {
      if (!step.success || !step.result) continue;
      const raw = step.result as any;
      for (const source of raw?.sources ?? []) {
        pushSource(String(source?.name ?? source?.title ?? ""), source?.url, "web");
      }
      for (const source of raw?.results ?? raw?.webResults ?? []) {
        pushSource(String(source?.title ?? source?.name ?? ""), source?.url ?? source?.link ?? source?.href, "web");
      }
    }
  }

  const webSources = sanitized
    .filter((item) => item.type === "web" && item.href)
    .sort((left, right) => right.authorityScore - left.authorityScore || left.label.localeCompare(right.label));
  if (webSources.length >= 3) {
    const retainedLocalSources = sanitized.filter(
      (item) =>
        item.type !== "web"
        && /\b(10-k|10-q|earnings|filing|transcript|investor presentation|proxy|sec|official release)\b/i.test(item.label),
    );
    return [...webSources, ...retainedLocalSources]
      .slice(0, 8)
      .map(({ label, href, type }) => ({ label, href, type }));
  }

  return sanitized.slice(0, 8).map(({ label, href, type }) => ({ label, href, type }));
}

function sanitizeExecutiveAnswer(
  answer: string,
  entityName: string,
  keyMetrics: Array<{ label: string; value: string }>,
  signals: Array<{ name: string; direction: string; impact: string }>,
  comparables: Array<{ name: string; relevance: string; note: string }>,
  risks: Array<{ title: string; description: string }>,
  nextActions: Array<{ action: string; impact: string }>,
  context?: { classification?: string; entityTargets?: string[]; lens?: string },
): string {
  const cleaned = normalizeWhitespace(answer.replace(/```json|```/g, ""));
  const sentences = dedupeStrings(sentenceSplit(cleaned))
    .filter((sentence) => sentence.length >= 25 && !/^sources?:/i.test(sentence));
  const filteredSentences = sentences.filter(
    (sentence) => !/\b(arms race|what investors need to know|index\s+\w+\s+update|source artifact|worth buying|turns the tables|leading one half)\b/i.test(sentence)
      && !looksLikeNarrativeFluff(sentence)
      && !looksLikeSpeculativeCapitalMarketsFiller(sentence)
      && !looksLikeGenericMarketBackdrop(sentence)
  );

  const looksHealthy =
    filteredSentences.length >= 2 &&
    filteredSentences.length <= 5 &&
    cleaned.length <= 700 &&
    !/\.{3,}|^\{/.test(cleaned) &&
    filteredSentences.every((sentence) => /[.!?]$/.test(sentence) || sentence.length <= 100) &&
    !filteredSentences.some((sentence) => looksLikeSourceTitle(sentence) || looksLikeFundingHeadline(sentence)) &&
    !looksLikeSourceTitle(cleaned) &&
    !looksLikeFundingHeadline(cleaned) &&
    !looksLikeSpeculativeCapitalMarketsFiller(cleaned) &&
    !looksLikeGenericMarketBackdrop(cleaned) &&
    !/(most clearly defined against|what investors need to know|arms race|index\s+\w+\s+update|worth buying|turns the tables|leading one half)/i.test(cleaned);

  const summarySignals = signals.filter((signal) => !looksLikeGenericMarketBackdrop(signal.name));
  if (looksHealthy) {
    return filteredSentences.slice(0, 4).join(" ");
  }

  const summaryParts: string[] = [];
  const preferredLeadSignal =
    summarySignals.find((signal) => !containsRiskLanguage(signal.name) && scoreUnderwritingSignal(signal.name) >= 6)
    ?? summarySignals.find((signal) => !containsRiskLanguage(signal.name) && (signal.direction === "up" || scoreUnderwritingSignal(signal.name) >= 4))
    ?? summarySignals.find((signal) => !containsRiskLanguage(signal.name))
    ?? summarySignals[0]
    ?? signals.find((signal) => !containsRiskLanguage(signal.name) && scoreUnderwritingSignal(signal.name) >= 6)
    ?? signals.find((signal) => !containsRiskLanguage(signal.name) && (signal.direction === "up" || scoreUnderwritingSignal(signal.name) >= 4))
    ?? signals.find((signal) => !containsRiskLanguage(signal.name))
    ?? signals[0];
  const leadSignalEntity = context?.classification === "multi_entity"
    ? inferMetricEntity(preferredLeadSignal?.name ?? "", entityName, context?.entityTargets)
    : null;
  const supportCandidates = [...summarySignals, ...signals]
    .filter((signal) => signal.name !== preferredLeadSignal?.name)
    .filter((signal) => {
      if (context?.classification !== "multi_entity") return true;
      if (!looksLikeAmbiguousSubjectSignal(signal.name)) return true;
      return mentionsEntityTarget(signal.name, context?.entityTargets);
    });
  const preferredSupportSignal =
    supportCandidates.find((signal) =>
      context?.classification === "multi_entity"
      && leadSignalEntity
      && !containsRiskLanguage(signal.name)
      && scoreUnderwritingSignal(signal.name) >= 6
      && inferMetricEntity(signal.name, entityName, context?.entityTargets)
      && inferMetricEntity(signal.name, entityName, context?.entityTargets) !== leadSignalEntity,
    )
    ?? supportCandidates.find((signal) => !containsRiskLanguage(signal.name) && scoreUnderwritingSignal(signal.name) >= 6 && (context?.classification !== "multi_entity" || mentionsEntityTarget(signal.name, context?.entityTargets)))
    ?? supportCandidates.find((signal) => !containsRiskLanguage(signal.name) && scoreUnderwritingSignal(signal.name) >= 4)
    ?? supportCandidates.find((signal) => !containsRiskLanguage(signal.name))
    ?? supportCandidates.find(() => true)
    ?? null;
  const leadSignal = preferredLeadSignal?.name;
  const supportSignal = preferredSupportSignal?.name;
  const leadComparable = comparables[0]?.name;
  const comparableLabel = comparables.slice(0, 2).map((item) => item.name).join(" and ");
  const leadRisk = risks[0];
  const comparisonSet = dedupeStrings((context?.entityTargets ?? []).map((item) => normalizeWhitespace(String(item)))).slice(0, 3);
  const bankerMetricClauses = keyMetrics
    .slice(0, context?.lens === "banker" ? 4 : 3)
    .map((metric) => formatMetricClause(metric))
    .filter(Boolean);

  if (context?.lens === "banker") {
    const scope = context?.classification === "multi_entity"
      ? (comparisonSet.length > 1 ? comparisonSet.join(", ") : entityName)
      : entityName;
    summaryParts.push(
      context?.classification === "multi_entity"
        ? `The current underwriting read on ${scope} is that the peer set is separating on revenue quality, margin durability, and distribution leverage rather than raw model quality alone.`
        : `The current underwriting read on ${entityName} is that the cited evidence supports a real operating story, but the quality of revenue and durability of pricing still need to hold up under diligence.`,
    );
    if (bankerMetricClauses.length > 0) {
      summaryParts.push(`Current hard datapoints include ${joinNaturalLanguage(bankerMetricClauses)}.`);
    } else if (leadSignal && !looksLikeSourceTitle(leadSignal) && !looksLikeEvidenceFragment(leadSignal) && leadSignal.length <= 170) {
      summaryParts.push(`One critical data point is ${stripTrailingConnectorTail(compressNarrativePhrase(leadSignal, 150))}.`);
    }
    if (leadRisk) {
      summaryParts.push(
        context?.classification === "multi_entity"
          ? `The underwriting question is which platform can keep pricing power and contract durability once buyers consolidate spend, with ${leadRisk.title.toLowerCase()} as the main current flag because ${stripTrailingConnectorTail(compressNarrativePhrase(leadRisk.description, 135))}.`
          : `The underwriting question is whether ${entityName} can keep pricing power and contract durability, with ${leadRisk.title.toLowerCase()} as the main current flag because ${stripTrailingConnectorTail(compressNarrativePhrase(leadRisk.description, 135))}.`,
      );
    } else if (comparableLabel) {
      summaryParts.push(`The closest operating comparables in the cited set are ${comparableLabel}.`);
    }
    if (nextActions[0]?.action) {
      summaryParts.push(`The immediate next step is to ${nextActions[0].action.charAt(0).toLowerCase()}${nextActions[0].action.slice(1)}.`);
    }
    return normalizeWhitespace(summaryParts.slice(0, 4).join(" "))
      .replace(/\.(?:\s*\.)+/g, ".")
      .replace(/\.{2,}/g, ".");
  }

  if (context?.classification === "multi_entity") {
    const scope = comparisonSet.length > 1 ? comparisonSet.join(", ") : entityName;
    summaryParts.push(`Across ${scope}, the current evidence separates the peer set on enterprise traction, pricing leverage, and distribution durability.`);
    if (leadSignal && !looksLikeSourceTitle(leadSignal) && !looksLikeEvidenceFragment(leadSignal) && leadSignal.length <= 170) {
      summaryParts.push(`One critical data point is ${stripTrailingConnectorTail(compressNarrativePhrase(leadSignal, 150))}.`);
      if (
        context?.lens === "banker"
        && supportSignal
        && supportSignal !== leadSignal
        && !looksLikeSourceTitle(supportSignal)
        && !looksLikeEvidenceFragment(supportSignal)
      ) {
        summaryParts.push(`A second underwriting datapoint is ${stripTrailingConnectorTail(compressNarrativePhrase(supportSignal, 145))}.`);
      }
    } else if (context?.lens === "banker") {
      summaryParts.push("The current read suggests the comparison is separating on distribution leverage, contract durability, and pricing power rather than raw model capability alone.");
    } else {
      summaryParts.push("The current read suggests the comparison is separating on enterprise distribution, pricing leverage, and buyer fit.");
    }
    if (context?.lens === "banker") {
      summaryParts.push("For a banker, the underwriting question is which platform can hold pricing power and contract durability once enterprise buyers consolidate spend.");
    }
    if (leadRisk) {
      summaryParts.push(`The main diligence flag is ${leadRisk.title.toLowerCase()}, which matters because ${stripTrailingConnectorTail(compressNarrativePhrase(leadRisk.description, 135))}.`);
    }
    if (nextActions[0]?.action) {
      summaryParts.push(`The immediate next move is to ${nextActions[0].action.charAt(0).toLowerCase()}${nextActions[0].action.slice(1)}.`);
    }
    return summaryParts.slice(0, 4).join(" ");
  }

  summaryParts.push(
    leadSignal && isNarrativeReadySignal(leadSignal) && !looksLikeEvidenceFragment(leadSignal)
      ? `${entityName} is showing a real operating signal: ${stripTrailingConnectorTail(compressNarrativePhrase(leadSignal, 145))}.`
      : `${entityName} is being assessed on enterprise traction, pricing leverage, and contract durability using the current cited evidence set.`,
  );
  if (leadComparable) {
    summaryParts.push(
      comparableLabel
        ? `The closest operating comparables in the current evidence set are ${comparableLabel}.`
        : `${entityName}'s closest operating comparable in the current evidence set is ${leadComparable}.`,
    );
    if (context?.lens === "banker") {
      summaryParts.push(`For a banker, the underwriting question is whether ${entityName} can defend pricing and contract durability against ${comparableLabel || leadComparable}.`);
    }
  }
  if (leadRisk) {
    summaryParts.push(`The main diligence flag is ${leadRisk.title.toLowerCase()}, which matters because ${stripTrailingConnectorTail(compressNarrativePhrase(leadRisk.description, 130))}.`);
  }
  if (nextActions[0]?.action) {
    summaryParts.push(`The immediate next move is to ${nextActions[0].action.charAt(0).toLowerCase()}${nextActions[0].action.slice(1)}.`);
  }

  return normalizeWhitespace(summaryParts.slice(0, 4).join(" "))
    .replace(/\.(?:\s*\.)+/g, ".")
    .replace(/\.{2,}/g, ".");
}

// ── Multi-model LLM call via existing provider bus ───────────────────
// Uses call_llm MCP tool which routes: Gemini → OpenAI → Anthropic
// Falls back to direct Gemini fetch if call_llm unavailable

// ── Context budgeting (DeerFlow pattern) ─────────────────────────────
// Instead of hardcoded char limits, calculate how much data fits in the
// model's context window and summarize overflow.

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gemini-3.1-flash-lite-preview": 32000,
  "gemini-3.1-flash-preview": 128000,
  "gemini-3.1-pro-preview": 128000,
  "claude-sonnet-4-6": 200000,
  "claude-opus-4-6": 200000,
};

function budgetToolData(toolResults: Array<{ tool: string; data: string }>, maxTokensBudget: number): string {
  // Rough estimate: 1 token ≈ 4 chars. Reserve 40% for system prompt + output.
  const inputBudget = Math.floor(maxTokensBudget * 0.6 * 4); // chars available for tool data
  const perToolBudget = Math.floor(inputBudget / Math.max(toolResults.length, 1));

  return toolResults
    .map(r => {
      const data = r.data.length > perToolBudget
        ? r.data.slice(0, perToolBudget - 50) + "\n[...truncated to fit context budget]"
        : r.data;
      return `=== [${r.tool}] ===\n${data}`;
    })
    .join("\n\n");
}

// ── Model freshness: latest model names as of April 2026 ─────────────
// These should be updated when new models release.
// TODO: Add OpenRouter dynamic discovery to auto-detect latest models.
// For now, manually kept current. Last updated: 2026-04-01.
const LATEST_MODELS = {
  gemini: { lite: "gemini-3.1-flash-lite-preview", flash: "gemini-3.1-flash-preview", pro: "gemini-3.1-pro-preview" },
  openai: { nano: "gpt-5.4-nano", mini: "gpt-5.4-mini", standard: "gpt-5.4", pro: "gpt-5.4-pro" },
} as const;

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gemini-3.1-flash-lite-preview": { input: 0.075, output: 0.30 },
  "gemini-3.1-flash-preview": { input: 0.15, output: 0.60 },
  "gemini-3.1-pro-preview": { input: 1.25, output: 5.00 },
  "gpt-5.4-nano": { input: 0.05, output: 0.20 },
  "gpt-5.4-mini": { input: 0.20, output: 0.80 },
  "gpt-5.4": { input: 1.25, output: 5.00 },
  "gpt-5.4-pro": { input: 15.00, output: 60.00 },
  "claude-haiku-4-5-20251001": { input: 1.00, output: 5.00 },
  "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
  "claude-opus-4-6": { input: 15.00, output: 75.00 },
};

function estimateModelCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["gemini-3.1-flash-preview"];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

// ── Kilo Code-style auto model routing ───────────────────────────────
// Pattern from Kilo Code: detect task complexity, route to optimal model.
// - Classification/extraction → Flash Lite (cheapest, fastest)
// - Analysis/synthesis → Flash or Pro (deeper reasoning)
// - Complex multi-step → Pro or Claude (highest capability)
// Only latest models. No deprecated models.

type TaskComplexity = "low" | "medium" | "high";

function assessComplexity(prompt: string, maxTokens: number): TaskComplexity {
  const len = prompt.length;
  if (maxTokens <= 500 && len < 2000) return "low";      // Classification, extraction
  if (maxTokens <= 1000 && len < 8000) return "medium";   // Analysis, summarization
  return "high";                                           // Deep synthesis, IB memo
}

interface ModelConfig {
  name: string;
  endpoint: string;
  apiKeyEnv: string;
  timeoutMs: number;
  contextLimit: number;
  makeBody: (prompt: string, system: string | undefined, maxTokens: number, options?: LlmCallOptions) => string;
  extractResponse: (data: any) => string;
}

type JsonSchemaDefinition = Record<string, unknown>;

interface LlmCallOptions {
  responseJsonSchema?: JsonSchemaDefinition;
  responseSchemaName?: string;
  forceJson?: boolean;
}

function buildGeminiGenerationConfig(
  maxTokens: number,
  temperature: number,
  options?: LlmCallOptions,
): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = { temperature, maxOutputTokens: maxTokens };
  if (options?.responseJsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = options.responseJsonSchema;
  } else if (options?.forceJson) {
    generationConfig.responseMimeType = "application/json";
  }
  return generationConfig;
}

function buildOpenAiStructuredResponseFormat(options?: LlmCallOptions): Record<string, unknown> | undefined {
  if (options?.responseJsonSchema) {
    return {
      type: "json_schema",
      json_schema: {
        name: options.responseSchemaName ?? "nodebench_response",
        strict: true,
        schema: options.responseJsonSchema,
      },
    };
  }
  if (options?.forceJson) return { type: "json_object" };
  return undefined;
}

function buildOpenAiChatBody(
  model: string,
  prompt: string,
  system: string | undefined,
  maxTokens: number,
  options?: LlmCallOptions,
): string {
  const responseFormat = buildOpenAiStructuredResponseFormat(options);
  return JSON.stringify({
    model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: prompt },
    ],
    max_tokens: maxTokens,
    temperature: 0,
    ...(responseFormat ? { response_format: responseFormat } : {}),
  });
}

const GEMINI_MODELS: Record<TaskComplexity, ModelConfig> = {
  low: {
    name: "gemini-3.1-flash-lite-preview",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent",
    apiKeyEnv: "GEMINI_API_KEY",
    timeoutMs: 15000,
    contextLimit: 32000,
    makeBody: (prompt, system, maxTokens, options) => JSON.stringify({
      contents: [{ parts: [{ text: system ? `${system}\n\n${prompt}` : prompt }] }],
      generationConfig: buildGeminiGenerationConfig(maxTokens, 0, options),
    }),
    extractResponse: (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
  },
  medium: {
    name: "gemini-3.1-flash-preview",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-preview:generateContent",
    apiKeyEnv: "GEMINI_API_KEY",
    timeoutMs: 25000,
    contextLimit: 128000,
    makeBody: (prompt, system, maxTokens, options) => JSON.stringify({
      contents: [{ parts: [{ text: system ? `${system}\n\n${prompt}` : prompt }] }],
      generationConfig: buildGeminiGenerationConfig(maxTokens, 0, options),
    }),
    extractResponse: (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
  },
  high: {
    name: "gemini-3.1-pro-preview",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent",
    apiKeyEnv: "GEMINI_API_KEY",
    timeoutMs: 40000,
    contextLimit: 128000,
    makeBody: (prompt, system, maxTokens, options) => JSON.stringify({
      contents: [{ parts: [{ text: system ? `${system}\n\n${prompt}` : prompt }] }],
      generationConfig: buildGeminiGenerationConfig(maxTokens, 0, options),
    }),
    extractResponse: (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
  },
};

// OpenAI models — Kilo-style complexity routing
// GPT-5.4 series (latest as of April 2026)
// nano=classification, mini=fast analysis, standard=deep synthesis, pro=complex reasoning
const OPENAI_MODELS: Record<TaskComplexity, ModelConfig> = {
  low: {
    name: "gpt-5.4-nano",
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKeyEnv: "OPENAI_API_KEY",
    timeoutMs: 10000,
    contextLimit: 128000,
    makeBody: (prompt, system, maxTokens, options) => buildOpenAiChatBody("gpt-5.4-nano", prompt, system, maxTokens, options),
    extractResponse: (data) => data?.choices?.[0]?.message?.content ?? "",
  },
  medium: {
    name: "gpt-5.4-mini",
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKeyEnv: "OPENAI_API_KEY",
    timeoutMs: 20000,
    contextLimit: 128000,
    makeBody: (prompt, system, maxTokens, options) => buildOpenAiChatBody("gpt-5.4-mini", prompt, system, maxTokens, options),
    extractResponse: (data) => data?.choices?.[0]?.message?.content ?? "",
  },
  high: {
    name: "gpt-5.4",
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiKeyEnv: "OPENAI_API_KEY",
    timeoutMs: 35000,
    contextLimit: 128000,
    makeBody: (prompt, system, maxTokens, options) => buildOpenAiChatBody("gpt-5.4", prompt, system, maxTokens, options),
    extractResponse: (data) => data?.choices?.[0]?.message?.content ?? "",
  },
};

function isHarnessDebugEnabled(): boolean {
  return process.env.NODEBENCH_DEBUG_HARNESS === "1";
}

function logHarnessDebug(...args: unknown[]): void {
  if (!isHarnessDebugEnabled()) return;
  console.info(...args);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

function isExpectedMissingLlmError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("call_llm tool unavailable in this test")
    || message.includes("call_llm unavailable in this test");
}

function isMissingApiKeyError(error: unknown): boolean {
  return /^No [A-Z0-9_]+$/.test(getErrorMessage(error));
}

function hasConfiguredApiKey(envName: string): boolean {
  return Boolean(process.env[envName]);
}

function isAutomatedTestRuntime(): boolean {
  return process.env.NODE_ENV === "test"
    || process.env.VITEST === "1"
    || process.env.VITEST === "true"
    || Boolean(process.env.VITEST_WORKER_ID);
}

function shouldAllowExternalLlmFallback(): boolean {
  if (process.env.NODEBENCH_ALLOW_EXTERNAL_LLM_FALLBACK_IN_TESTS === "1") return true;
  return !isAutomatedTestRuntime();
}

async function callModel(
  config: ModelConfig,
  prompt: string,
  system: string | undefined,
  maxTokens: number,
  options?: LlmCallOptions,
): Promise<string> {
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) throw new Error(`No ${config.apiKeyEnv}`);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url = config.endpoint;
  if (config.apiKeyEnv === "GEMINI_API_KEY") {
    url += `?key=${apiKey}`;
  } else {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const resp = await fetch(url, {
    method: "POST", headers,
    body: config.makeBody(prompt, system, maxTokens, options),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!resp.ok) throw new Error(`${config.name} ${resp.status}`);
  const data = (await resp.json()) as any;
  return config.extractResponse(data);
}

async function callLLM(
  callTool: ToolCaller,
  prompt: string,
  system?: string,
  maxTokens?: number,
  options?: LlmCallOptions,
): Promise<string> {
  const tokens = maxTokens ?? 1000;
  let sawExpectedMissingLlm = false;
  let sawConfiguredModelPath = false;
  const unexpectedFailures: string[] = [];
  const wantsStrictJson =
    Boolean(options?.responseJsonSchema || options?.forceJson)
    || /return\s+only\s+(?:valid\s+)?json|responseMimeType|valid JSON/i.test(`${system ?? ""}\n${prompt}`);

  // Path 1: MCP tool bus
  if (!wantsStrictJson) try {
    const toolResult = await callTool("call_llm", {
      prompt,
      system,
      maxTokens: tokens,
      temperature: 0,
    }) as { response?: string; output?: string; content?: string; error?: boolean } | string;
    const text =
      typeof toolResult === "string"
        ? toolResult
        : toolResult?.error
          ? ""
          : String(toolResult?.response ?? toolResult?.output ?? toolResult?.content ?? "");
    if (text.length > 10) return text;
  } catch (toolErr: unknown) {
    if (isExpectedMissingLlmError(toolErr)) {
      sawExpectedMissingLlm = true;
    } else {
      const message = getErrorMessage(toolErr).slice(0, 80);
      unexpectedFailures.push(`tool bus: ${message}`);
      console.error("[callLLM] tool bus failed:", message);
    }
  }

  // Path 2: Direct Gemini API (most reliable — always try this)
  if (!shouldAllowExternalLlmFallback()) {
    if (!sawExpectedMissingLlm && unexpectedFailures.length === 0) {
      logHarnessDebug("[callLLM] Skipping external fallback in automated test runtime.");
    }
    return "";
  }

  const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    sawConfiguredModelPath = true;
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${geminiKey}`;
      const body = {
        contents: [{ parts: [{ text: system ? `${system}\n\n${prompt}` : prompt }] }],
        generationConfig: buildGeminiGenerationConfig(tokens, 0.1, {
          ...options,
          forceJson: true,
        }),
      };
      const resp = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      });
      if (resp.ok) {
        const data = (await resp.json()) as any;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (text.length > 10) {
          logHarnessDebug("[callLLM] Gemini direct succeeded:", text.length, "chars");
          return text;
        }
      } else {
        unexpectedFailures.push(`Gemini direct ${resp.status}`);
        logHarnessDebug("[callLLM] Gemini direct failed:", resp.status);
      }
    } catch (geminiErr: unknown) {
      const message = getErrorMessage(geminiErr).slice(0, 80);
      unexpectedFailures.push(`Gemini direct error: ${message}`);
      logHarnessDebug("[callLLM] Gemini direct error:", message);
    }
  }

  // Path 3: Model bus fallback chain (Gemini variants + OpenAI)
  const complexity = assessComplexity(prompt, tokens);
  const primaryModel = GEMINI_MODELS[complexity];
  const chain = [primaryModel];
  chain.push(OPENAI_MODELS[complexity]);
  if (complexity === "high") chain.push(GEMINI_MODELS.medium);
  if (complexity !== "low") chain.push(GEMINI_MODELS.low);
  if (complexity !== "low") chain.push(OPENAI_MODELS.low);

  const seenModelNames = new Set<string>();
  const eligibleChain = chain.filter((model) => {
    if (seenModelNames.has(model.name)) return false;
    seenModelNames.add(model.name);
    return hasConfiguredApiKey(model.apiKeyEnv);
  });

  for (const model of eligibleChain) {
    sawConfiguredModelPath = true;
    try {
      const result = await callModel(model, prompt, system, tokens, options);
      if (result && result.length > 10) return result;
    } catch (modelErr: unknown) {
      if (!isMissingApiKeyError(modelErr)) {
        unexpectedFailures.push(`${model.name}: ${getErrorMessage(modelErr).slice(0, 80)}`);
      }
    }
  }

  if (unexpectedFailures.length > 0) {
    console.error("[callLLM] ALL paths failed. Returning empty.", unexpectedFailures.join(" | "));
  } else if (sawConfiguredModelPath) {
    logHarnessDebug("[callLLM] Configured model paths returned no usable text.");
  } else if (!sawExpectedMissingLlm) {
    logHarnessDebug("[callLLM] No configured LLM path available.");
  }
  return "";
}

// ── Plan generation via LLM ──────────────────────────────────────────

const PLAN_PROMPT = `You are NodeBench's agent orchestrator. Given a user query, plan which tools to call and in what order.

Available tools:
- web_search: Search the web for company/market intelligence. Args: {query, maxResults}
- run_recon: Deep reconnaissance on a company. Args: {target, focus}
- founder_local_gather: Get local founder context (company state, changes, contradictions). Args: {daysBack}
- founder_local_synthesize: Synthesize a founder packet (weekly_reset, important_change, pre_delegation). Args: {query, packetType, daysBack}
- founder_local_weekly_reset: Generate weekly founder reset. Args: {daysBack}
- founder_direction_assessment: Assess company direction and readiness. Args: {query}
- enrich_entity: Enrich entity with structured intelligence. Args: {query, entityName, lens}
- build_claim_graph: Extract claims from sources. Args: {sources}
- extract_variables: Identify key variables. Args: {context}
- generate_countermodels: Generate alternative explanations. Args: {thesis, evidence}
- rank_interventions: Rank next actions by impact. Args: {context, variables}
- render_decision_memo: Render a decision memo. Args: {title, recommendation, variables}

Return ONLY valid JSON:
{
  "objective": "what this plan accomplishes",
  "steps": [
    {"id": "s1", "stepIndex": 0, "groupId": "discover", "toolName": "tool_name", "args": {...}, "purpose": "why this step"},
    {"id": "s2", "stepIndex": 1, "groupId": "analyze", "toolName": "tool_name", "args": {...}, "purpose": "why this step", "dependsOn": ["s1"], "injectPriorResults": ["s1"], "model": "gemini-3.1-flash-lite-preview"}
  ],
  "synthesisPrompt": "how to combine results into a final answer"
}

Rules:
- Use 2-5 steps. Don't over-plan.
- Steps in the same tier should share the same stepIndex.
- Steps that run together should share a groupId.
- dependsOn must be an array of step IDs, never a single string.
- For company searches: web_search + run_recon in parallel, then synthesize.
- For founder questions: founder_local_gather first, then direction_assessment or synthesize.
- For comparisons: web_search per entity in parallel, then compare.
- Always include at least one intelligence-gathering step.`;

const HARNESS_PLAN_SCHEMA: JsonSchemaDefinition = {
  type: "object",
  additionalProperties: false,
  properties: {
    objective: { type: "string", description: "What this plan accomplishes." },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          stepIndex: { type: "integer" },
          groupId: { type: "string" },
          toolName: { type: "string" },
          args: {
            type: "object",
            description: "Tool arguments as a JSON object. Use an empty object when no arguments are needed.",
            additionalProperties: true,
          },
          purpose: { type: "string" },
          dependsOn: { type: "array", items: { type: "string" } },
          injectPriorResults: { type: "array", items: { type: "string" } },
          model: { type: "string", description: "Model preference or empty string." },
          parallel: { type: "boolean" },
          acceptsSteering: { type: "boolean" },
          complexity: { type: "string", enum: ["", "low", "medium", "high"] },
        },
        required: [
          "id",
          "stepIndex",
          "groupId",
          "toolName",
          "args",
          "purpose",
          "dependsOn",
          "injectPriorResults",
          "model",
          "parallel",
          "acceptsSteering",
          "complexity",
        ],
      },
    },
    synthesisPrompt: { type: "string" },
  },
  required: ["objective", "steps", "synthesisPrompt"],
};

function normalizeDependsOn(dependsOn?: string | string[]): string[] | undefined {
  if (!dependsOn) return undefined;
  const normalized = (Array.isArray(dependsOn) ? dependsOn : [dependsOn])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function summarizeResultPreview(result: unknown, error?: string): string | undefined {
  if (error) return error;
  if (result == null) return undefined;
  if (typeof result === "string") return result.replace(/\s+/g, " ").trim().slice(0, 120);
  if (typeof result === "number" || typeof result === "boolean") return String(result);
  if (typeof result === "object") {
    try {
      const json = JSON.stringify(result);
      return json.replace(/\s+/g, " ").trim().slice(0, 160);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function estimateTokenCount(value: unknown): number {
  try {
    return Math.max(1, Math.ceil(JSON.stringify(value ?? "").length / 4));
  } catch {
    return 1;
  }
}

function resolveStepModel(step: HarnessStep): string | undefined {
  if (step.model) return step.model;
  if (step.complexity) {
    return GEMINI_MODELS[step.complexity]?.name;
  }
  return undefined;
}

function inferStepIndex(
  step: HarnessStep,
  stepMap: Map<string, HarnessStep>,
  memo: Map<string, number>,
  visiting = new Set<string>(),
): number {
  if (typeof step.stepIndex === "number") return step.stepIndex;
  const cached = memo.get(step.id);
  if (cached != null) return cached;
  if (visiting.has(step.id)) return 0;
  visiting.add(step.id);
  const dependsOn = normalizeDependsOn(step.dependsOn);
  if (!dependsOn?.length) {
    memo.set(step.id, 0);
    visiting.delete(step.id);
    return 0;
  }
  const index = Math.max(
    ...dependsOn.map((depId) => {
      const depStep = stepMap.get(depId);
      return depStep ? inferStepIndex(depStep, stepMap, memo, visiting) + 1 : 0;
    }),
  );
  memo.set(step.id, index);
  visiting.delete(step.id);
  return index;
}

function normalizeHarnessPlan(plan: HarnessPlan): HarnessPlan {
  const draftSteps = plan.steps.map((step, index) => ({
    ...step,
    id: step.id ?? `step_${index}`,
  }));
  const stepMap = new Map(draftSteps.map((step) => [step.id, step]));
  const memo = new Map<string, number>();

  const steps = draftSteps.map((step) => {
    const dependsOn = normalizeDependsOn(step.dependsOn);
    const stepIndex = inferStepIndex(step, stepMap, memo);
    return {
      ...step,
      dependsOn,
      stepIndex,
      groupId: step.groupId ?? (step.parallel ? `tier_${stepIndex}` : `${step.id}`),
      model: resolveStepModel(step),
      injectPriorResults: step.injectPriorResults ?? dependsOn,
    };
  });

  return {
    ...plan,
    steps: steps.sort((left, right) => {
      const leftIndex = typeof left.stepIndex === "number" ? left.stepIndex : Number.MAX_SAFE_INTEGER;
      const rightIndex = typeof right.stepIndex === "number" ? right.stepIndex : Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return left.id.localeCompare(right.id);
    }),
  };
}

function uniqueStepRefs(values: Array<string | undefined>): string[] | undefined {
  const deduped = [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
  return deduped.length > 0 ? deduped : undefined;
}

function applyRecalledMemoryToPlan(
  plan: HarnessPlan,
  recalledMemory: EntityMemoryRecallEntry[] | null | undefined,
): HarnessPlan {
  if (!recalledMemory?.length) return plan;

  return {
    ...plan,
    synthesisPrompt: `${plan.synthesisPrompt}\n\nCarry-forward memory is injected under _priorResults.${MEMORY_CONTEXT_STEP_ID}. Use it to preserve continuity, saved-because context, and delta framing without rediscovering the same entity from scratch.`,
    steps: plan.steps.map((step) => ({
      ...step,
      injectPriorResults: uniqueStepRefs([...(step.injectPriorResults ?? []), MEMORY_CONTEXT_STEP_ID]),
    })),
  };
}

export async function generatePlan(
  query: string,
  classification: string,
  entityTargets: string[],
  lens: string,
  callTool: ToolCaller,
  options?: {
    recalledMemory?: EntityMemoryRecallEntry[] | null;
  },
): Promise<HarnessPlan> {
  const recalledMemoryPrompt = formatEntityMemoryRecallForPrompt(options?.recalledMemory);
  // Multi-entity and weekly_reset: always use deterministic fallback plan.
  // LLM plans often drop the second entity or miss weekly_reset web fallbacks.
  if (
    classification === "multi_entity" ||
    classification === "weekly_reset" ||
    classification === "company_search" ||
    classification === "competitor"
  ) {
    return applyRecalledMemoryToPlan(
      normalizeHarnessPlan(buildFallbackPlan(query, classification, entityTargets, lens)),
      options?.recalledMemory,
    );
  }

  try {
    const text = await callLLM(
      callTool,
      `${PLAN_PROMPT}\n\nQuery: "${query}"\nClassification: ${classification}\nEntities: ${entityTargets.join(", ") || "none"}\nLens: ${lens}${recalledMemoryPrompt ? `\n\nCarry-forward entity memory:\n${recalledMemoryPrompt}` : ""}`,
      undefined,
      500,
      {
        responseSchemaName: "nodebench_harness_plan",
        responseJsonSchema: HARNESS_PLAN_SCHEMA,
        forceJson: true,
      },
    );
    const parsedResult = parseJsonObjectFromText<any>(text);
    if (!parsedResult.ok) throw new Error(parsedResult.error);

    const parsed = parsedResult.value;
    return applyRecalledMemoryToPlan(normalizeHarnessPlan({
      objective: parsed.objective ?? query,
      classification,
      entityTargets,
      steps: (parsed.steps ?? []).map((s: any, i: number) => ({
        id: s.id ?? `step_${i}`,
        stepIndex: typeof s.stepIndex === "number" ? s.stepIndex : undefined,
        groupId: typeof s.groupId === "string" ? s.groupId : undefined,
        toolName: s.toolName ?? "web_search",
        args: s.args ?? {},
        purpose: s.purpose ?? "",
        parallel: s.parallel ?? false,
        dependsOn: s.dependsOn,
        model: typeof s.model === "string" ? s.model : undefined,
        complexity: typeof s.complexity === "string" ? s.complexity : undefined,
        injectPriorResults: Array.isArray(s.injectPriorResults) ? s.injectPriorResults : undefined,
        acceptsSteering: Boolean(s.acceptsSteering),
      })),
      synthesisPrompt: parsed.synthesisPrompt ?? "Synthesize results into a structured intelligence packet.",
    }), options?.recalledMemory);
  } catch {
    // Fallback: deterministic plan based on classification
    return applyRecalledMemoryToPlan(
      normalizeHarnessPlan(buildFallbackPlan(query, classification, entityTargets, lens)),
      options?.recalledMemory,
    );
  }
}

// ── Fallback deterministic planning ──────────────────────────────────

function extractEntityFromQuery(query: string): string {
  // Extract likely entity name from natural language query
  // Look for capitalized proper nouns that aren't common question words
  const stopWords = new Set(["what", "why", "how", "when", "where", "who", "which", "the", "are", "is", "do", "does", "did", "can", "will", "should", "would", "could", "am", "i", "my", "for", "in", "on", "at", "to", "of", "a", "an", "and", "or", "not", "biggest", "main", "key", "top", "most", "best", "worst", "right", "now", "today", "currently", "about", "tell", "me", "show", "give", "get", "find", "analyze", "compare", "ready", "pitch"]);

  const words = query.replace(/[?!.,]+/g, "").split(/\s+/);
  const candidates = words.filter(w =>
    w.length > 1 &&
    /^[A-Z]/.test(w) &&
    !stopWords.has(w.toLowerCase())
  );

  // Join consecutive capitalized words (e.g., "Y Combinator", "Open AI")
  if (candidates.length > 0) {
    const result: string[] = [];
    let current = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      const prevIdx = words.indexOf(candidates[i - 1]);
      const currIdx = words.indexOf(candidates[i]);
      if (currIdx === prevIdx + 1) {
        current += " " + candidates[i];
      } else {
        result.push(current);
        current = candidates[i];
      }
    }
    result.push(current);
    return result[0]; // Return first entity found
  }

  // Last resort: first 3 meaningful words
  return words.filter(w => !stopWords.has(w.toLowerCase())).slice(0, 3).join(" ") || query.slice(0, 30);
}

function buildFallbackPlan(query: string, classification: string, entityTargets: string[], lens: string): HarnessPlan {
  const entity = entityTargets[0] ?? extractEntityFromQuery(query);
  const year = new Date().getFullYear();

  switch (classification) {
    case "weekly_reset":
      return {
        objective: "Generate founder weekly reset with latest market signals",
        classification, entityTargets,
        steps: [
          { id: "s1", stepIndex: 0, groupId: "discover", toolName: "founder_local_weekly_reset", args: { daysBack: 7 }, purpose: "Get weekly reset packet", parallel: true },
          { id: "s2", stepIndex: 0, groupId: "discover", toolName: "web_search", args: { query: `AI startup ecosystem latest news changes this week ${year}`, maxResults: 5 }, purpose: "Latest market signals (fallback for serverless)", parallel: true },
          { id: "s3", stepIndex: 0, groupId: "discover", toolName: "linkup_search", args: { query: `top AI and tech changes this week ${year}`, maxResults: 3 }, purpose: "Deep intelligence on weekly changes", parallel: true },
        ],
        synthesisPrompt: "Format as a weekly founder reset: what changed, biggest risks, and next 3 moves. Use web intelligence when local context is unavailable.",
      };

    case "important_change":
    case "pre_delegation":
      return {
        objective: `Synthesize ${classification} packet`,
        classification, entityTargets,
        steps: [
          { id: "s1", stepIndex: 0, groupId: "packet", toolName: "founder_local_synthesize", args: { query, packetType: classification, daysBack: 7 }, purpose: "Synthesize packet", parallel: false },
        ],
        synthesisPrompt: "Format as a structured founder packet.",
      };

    case "multi_entity": {
      const comparisonSet = entityTargets.slice(0, 3);
      const steps: HarnessStep[] = comparisonSet.flatMap((e, i) => [
        {
          id: `s${i * 4 + 1}`,
          toolName: "linkup_search",
          args: { query: `${e} enterprise AI revenue valuation customers pricing competitors ${year}`, maxResults: 4 },
          purpose: `Deep comparative research for ${e}`,
          parallel: true,
        },
        {
          id: `s${i * 4 + 2}`,
          toolName: "web_search",
          args: { query: `${e} competitors market share enterprise AI pricing risks ${year}`, maxResults: 4 },
          purpose: `Competitive and pricing evidence for ${e}`,
          parallel: true,
        },
        {
          id: `s${i * 4 + 3}`,
          toolName: "run_recon",
          args: { target: e, focus: `Compare ${e} against ${comparisonSet.filter((target) => target !== e).join(", ") || query}` },
          purpose: `Structured diligence scan for ${e}`,
          parallel: true,
        },
        {
          id: `s${i * 4 + 4}`,
          toolName: "enrich_entity",
          args: { query: `${e} competitive position, enterprise traction, and diligence flags`, entityName: e, lens },
          purpose: `Structured enrichment for ${e}`,
          parallel: true,
        },
      ]);
      // NOTE: founder_local_gather EXCLUDED from multi-entity comparisons (returns dev noise for external entities)
      return {
        objective: `Compare ${comparisonSet.join(" vs ")}`,
        classification, entityTargets, steps,
        synthesisPrompt:
          lens === "banker"
            ? `Build an investment-banking style comparative briefing on ${comparisonSet.join(", ")}. Cover market position, financial evidence, comparables, diligence flags, and next diligence questions.`
            : `Compare ${comparisonSet.join(", ")} across competitive position, traction, risks, and next actions for a ${lens} audience.`,
      };
    }

    case "company_search":
    case "competitor":
      return {
        objective: `Analyze ${entity}`,
        classification, entityTargets,
        steps: [
          { id: "s1", stepIndex: 0, groupId: "discover", toolName: "linkup_search", args: { query: `${entity} revenue valuation funding enterprise customers market share ${year}`, maxResults: 5 }, purpose: "Deep entity, financial, and market-share intelligence", parallel: true },
          { id: "s2", stepIndex: 0, groupId: "discover", toolName: "web_search", args: { query: `${entity} competitors enterprise market share pricing risks ${year}`, maxResults: 5 }, purpose: "Competitive map, pricing pressure, and core risks", parallel: true },
          { id: "s3", stepIndex: 0, groupId: "discover", toolName: "web_search", args: { query: `${entity} revenue valuation funding growth enterprise customers ${year}`, maxResults: 5 }, purpose: "Financial and operating evidence", parallel: true },
          { id: "s4", stepIndex: 1, groupId: "analyze", toolName: "run_recon", args: { target: entity, focus: query }, purpose: "Structured recon for positioning and diligence gaps", dependsOn: ["s1", "s2", "s3"], injectPriorResults: ["s1", "s2", "s3"], acceptsSteering: true, model: "gemini-3.1-flash-lite-preview" },
          { id: "s5", stepIndex: 1, groupId: "analyze", toolName: "enrich_entity", args: { query: `${entity} strategic position and competitive moat`, entityName: entity, lens }, purpose: "Structured lens-specific synthesis", dependsOn: ["s1", "s2", "s3"], injectPriorResults: ["s1", "s2", "s3"], acceptsSteering: true },
          // NOTE: founder_local_gather EXCLUDED from external entity searches.
        ],
        synthesisPrompt: `Synthesize intelligence about ${entity} for a ${lens} audience. Include financial facts, competitive set, diligence flags, and concrete next actions.`,
      };

    case "plan_proposal":
      return {
        objective: `Plan: ${query}`,
        classification, entityTargets,
        steps: [
          { id: "s1", stepIndex: 0, groupId: "context", toolName: "founder_local_gather", args: { daysBack: 7 }, purpose: "Understand current context", parallel: false },
          { id: "s2", stepIndex: 1, groupId: "discover", toolName: "web_search", args: { query: `${query} best practices ${year}`, maxResults: 3 }, purpose: "Research approaches", parallel: false, dependsOn: ["s1"], injectPriorResults: ["s1"], acceptsSteering: true },
        ],
        synthesisPrompt: "Generate a structured feature plan with phases, risks, and next steps.",
      };

    default:
      return {
        objective: query,
        classification, entityTargets,
        steps: [
          { id: "s1", toolName: "web_search", args: { query: `${query} ${year}`, maxResults: 5 }, purpose: "Web research", parallel: true },
          { id: "s2", toolName: "web_search", args: { query: `${entity} market risks competitors ${year}`, maxResults: 3 }, purpose: "Risk & competitive context", parallel: true },
          { id: "s3", toolName: "linkup_search", args: { query: `${query} ${year}`, maxResults: 3 }, purpose: "Deep web intelligence", parallel: true },
        ],
        synthesisPrompt: `Answer the query "${query}" using gathered intelligence. Format as a structured founder packet.`,
      };
  }
}

// ── Harness execution engine ─────────────────────────────────────────

export async function executeHarness(
  plan: HarnessPlan,
  callTool: ToolCaller,
  onTrace?: TraceCallback,
  options?: {
    toolTimeoutMs?: number;
    episodeId?: string;
    pendingUserSteering?: Record<string, unknown> | string | null;
    consumeUserSteering?: (step: HarnessStep) => Record<string, unknown> | string | null | undefined;
    seedContext?: Record<string, unknown>;
  },
): Promise<HarnessExecution> {
  const normalizedPlan = normalizeHarnessPlan(plan);
  const startMs = Date.now();
  const stepResults: HarnessStepResult[] = [];
  const completedSteps = new Set<string>();
  const runContext = new Map<string, unknown>();
  const toolTimeoutMs = options?.toolTimeoutMs ?? 12_000;
  const episodeId = options?.episodeId ?? `harness_${Date.now()}`;
  const staticSteeringPayload = options?.pendingUserSteering;

  // Initialize session memory tables (safe if already exists)
  try { initSessionMemoryTables(); } catch { /* SQLite may not be available in all envs */ }

  const seedEntries = Object.entries(options?.seedContext ?? {}).filter(([, value]) => value !== undefined);
  for (const [seedId, value] of seedEntries) {
    runContext.set(seedId, value);
  }
  if (seedEntries.length > 0) {
    onTrace?.({
      type: "trace",
      step: "seed_context",
      status: "ok",
      detail: `Injected seed context: ${seedEntries.map(([seedId]) => seedId).join(", ")}`,
    });
  }

  const runStep = async (step: HarnessStep): Promise<HarnessStepResult> => {
    const startedAt = Date.now();
    const model = resolveStepModel(step);
    const dependsOn = normalizeDependsOn(step.dependsOn) ?? [];
    const unmetDependencies = dependsOn.filter((dependency) => !completedSteps.has(dependency));
    const injectedContext = (step.injectPriorResults ?? []).filter((dependency) => runContext.has(dependency));
    const steeringPayload = step.acceptsSteering
      ? (options?.consumeUserSteering?.(step) ?? staticSteeringPayload)
      : null;
    const steeringApplied = Boolean(step.acceptsSteering && steeringPayload != null);

    if (unmetDependencies.length > 0) {
      onTrace?.({
        type: "trace",
        step: "skip_step",
        tool: step.toolName,
        status: "skip",
        detail: `${step.id} waiting on ${unmetDependencies.join(", ")}`,
      });
      return {
        stepId: step.id,
        toolName: step.toolName,
        result: null,
        success: false,
        durationMs: 0,
        error: `blocked: unmet dependencies ${unmetDependencies.join(", ")}`,
        model,
        groupId: step.groupId,
        stepIndex: step.stepIndex,
        startedAt,
        completedAt: startedAt,
        injectedContext,
        steeringApplied,
      };
    }

    const enrichedArgs: Record<string, unknown> = { ...step.args };
    if (injectedContext.length > 0) {
      enrichedArgs._priorResults = Object.fromEntries(injectedContext.map((id) => [id, runContext.get(id)]));
    }
    if (steeringApplied) {
      enrichedArgs._steering = steeringPayload;
      onTrace?.({
        type: "trace",
        step: "steering_applied",
        tool: step.toolName,
        status: "ok",
        detail: `${step.id} received queued steering`,
      });
    }
    if (model && enrichedArgs.model == null && step.toolName === "call_llm") {
      enrichedArgs.model = model;
    }

    onTrace?.({
      type: "step_start",
      stepId: step.id,
      toolName: step.toolName,
      stepIndex: step.stepIndex,
      groupId: step.groupId,
      model,
      purpose: step.purpose,
      startedAt,
    });

    try {
      const result = await Promise.race([
        callTool(step.toolName, enrichedArgs),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), toolTimeoutMs)),
      ]);
      const completedAt = Date.now();
      const durationMs = completedAt - startedAt;
      const tokensIn = estimateTokenCount(enrichedArgs);
      const tokensOut = estimateTokenCount(result);
      const costUsd = model ? estimateModelCost(model, tokensIn, tokensOut) : 0;
      const stepResult: HarnessStepResult = {
        stepId: step.id,
        toolName: step.toolName,
        result,
        success: true,
        durationMs,
        model,
        tokensIn,
        tokensOut,
        costUsd,
        groupId: step.groupId,
        stepIndex: step.stepIndex,
        startedAt,
        completedAt,
        injectedContext,
        steeringApplied,
        preview: summarizeResultPreview(result),
      };
      completedSteps.add(step.id);
      runContext.set(step.id, result);
      onTrace?.({
        type: "step_done",
        stepId: step.id,
        toolName: step.toolName,
        stepIndex: step.stepIndex,
        groupId: step.groupId,
        model,
        durationMs,
        startedAt,
        completedAt,
        success: true,
        preview: stepResult.preview,
        tokensIn,
        tokensOut,
        costUsd,
        injectedContext,
        steeringApplied,
      });
      return stepResult;
    } catch (err: any) {
      const completedAt = Date.now();
      const durationMs = completedAt - startedAt;
      const tokensIn = estimateTokenCount(enrichedArgs);
      const stepResult: HarnessStepResult = {
        stepId: step.id,
        toolName: step.toolName,
        result: null,
        success: false,
        durationMs,
        error: err?.message,
        model,
        tokensIn,
        tokensOut: 0,
        costUsd: 0,
        groupId: step.groupId,
        stepIndex: step.stepIndex,
        startedAt,
        completedAt,
        injectedContext,
        steeringApplied,
        preview: summarizeResultPreview(null, err?.message),
      };
      onTrace?.({
        type: "step_done",
        stepId: step.id,
        toolName: step.toolName,
        stepIndex: step.stepIndex,
        groupId: step.groupId,
        model,
        durationMs,
        startedAt,
        completedAt,
        success: false,
        error: err?.message,
        tokensIn,
        tokensOut: 0,
        costUsd: 0,
        injectedContext,
        steeringApplied,
      });
      return stepResult;
    }
  };

  const tiers = new Map<number, HarnessStep[]>();
  for (const step of normalizedPlan.steps) {
    const tier = step.stepIndex ?? 0;
    const existing = tiers.get(tier) ?? [];
    existing.push(step);
    tiers.set(tier, existing);
  }

  for (const tier of [...tiers.keys()].sort((left, right) => left - right)) {
    const steps = tiers.get(tier) ?? [];
    const groups = new Map<string, HarnessStep[]>();
    for (const step of steps) {
      const key = step.groupId ?? step.id;
      const existing = groups.get(key) ?? [];
      existing.push(step);
      groups.set(key, existing);
    }

    const tierGroupResults = await Promise.all(
      [...groups.entries()].map(async ([groupId, groupSteps]) => {
        if (groupSteps.length > 1) {
          onTrace?.({
            type: "trace",
            step: "parallel_dispatch",
            tool: groupSteps.map((step) => step.toolName).join(", "),
            status: "ok",
            detail: `tier=${tier} group=${groupId} count=${groupSteps.length}`,
          });
        }

        const groupResults = groupSteps.length > 1
          ? await Promise.all(groupSteps.map((step) => runStep(step)))
          : [await runStep(groupSteps[0]!)];

        return { groupSteps, groupResults };
      }),
    );

    for (const { groupSteps, groupResults } of tierGroupResults) {
      stepResults.push(...groupResults);
      for (const result of groupResults) {
        try {
          recordAction({
            episodeId,
            stepIndex: result.stepIndex ?? tier,
            toolName: result.toolName,
            input: JSON.stringify(groupSteps.find((step) => step.id === result.stepId)?.args ?? {}).slice(0, 2048),
            output: JSON.stringify(result.result ?? result.error ?? "").slice(0, 2048),
            success: result.success,
            durationMs: result.durationMs,
            timestamp: new Date().toISOString(),
          });
          if (!result.success && result.error) {
            const failureType = result.error.includes("timeout") ? "timeout" : "error";
            const reflection = getReflectionPrompt(failureType, result.toolName);
            recordFailure({
              episodeId,
              stepIndex: result.stepIndex ?? tier,
              toolName: result.toolName,
              failureType,
              rootCause: result.error,
              recoveryStrategy: reflection,
              recoverySuccessful: null,
              timestamp: new Date().toISOString(),
            });
          }
        } catch {
          /* session memory is best-effort */
        }
      }
    }
  }

  onTrace?.({ type: "trace", step: "assemble_response", status: "ok", detail: `${stepResults.length} steps completed` });

  return {
    plan: normalizedPlan,
    stepResults,
    totalDurationMs: Date.now() - startMs,
    totalCostUsd: stepResults.reduce((sum, result) => sum + (result.costUsd ?? 0), 0),
    adaptations: 0,
  };
}

const SYNTHESIZED_SOURCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: "string" },
    href: { type: "string", description: "Source URL or empty string." },
    type: { type: "string", enum: ["web", "doc", "local", "field_note", ""] },
  },
  required: ["label", "href", "type"],
};

const SYNTHESIZED_EVIDENCE_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    direction: { type: "string", enum: ["up", "down", "neutral"] },
    impact: { type: "string", enum: ["high", "medium", "low"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    sourceLabel: { type: "string" },
    sourceHref: { type: "string" },
    evidenceQuote: { type: "string" },
  },
  required: ["name", "direction", "impact", "score", "sourceLabel", "sourceHref", "evidenceQuote"],
};

const SYNTHESIS_RESPONSE_SCHEMA: JsonSchemaDefinition = {
  type: "object",
  additionalProperties: false,
  properties: {
    entityName: { type: "string" },
    answer: { type: "string" },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    keyMetrics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          value: { type: "string" },
        },
        required: ["label", "value"],
      },
    },
    whyThisTeam: {
      type: "object",
      additionalProperties: false,
      properties: {
        founderCredibility: { type: "string" },
        trustSignals: { type: "array", items: { type: "string" } },
        visionMagnitude: { type: "string" },
        reinventionCapacity: { type: "string" },
        hiddenRequirements: { type: "array", items: { type: "string" } },
      },
      required: ["founderCredibility", "trustSignals", "visionMagnitude", "reinventionCapacity", "hiddenRequirements"],
    },
    signals: { type: "array", items: SYNTHESIZED_EVIDENCE_ITEM_SCHEMA },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          description: { type: "string" },
          date: { type: "string", description: "Date or empty string." },
          score: { type: "integer", minimum: 0, maximum: 100 },
          sourceLabel: { type: "string" },
          sourceHref: { type: "string" },
          evidenceQuote: { type: "string" },
        },
        required: ["description", "date", "score", "sourceLabel", "sourceHref", "evidenceQuote"],
      },
    },
    risks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          score: { type: "integer", minimum: 0, maximum: 100 },
          sourceLabel: { type: "string" },
          sourceHref: { type: "string" },
          evidenceQuote: { type: "string" },
        },
        required: ["title", "description", "score", "sourceLabel", "sourceHref", "evidenceQuote"],
      },
    },
    comparables: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          relevance: { type: "string", enum: ["high", "medium", "low"] },
          note: { type: "string" },
          score: { type: "integer", minimum: 0, maximum: 100 },
          sourceLabel: { type: "string" },
          sourceHref: { type: "string" },
          evidenceQuote: { type: "string" },
        },
        required: ["name", "relevance", "note", "score", "sourceLabel", "sourceHref", "evidenceQuote"],
      },
    },
    nextActions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string" },
          impact: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["action", "impact"],
      },
    },
    nextQuestions: { type: "array", items: { type: "string" } },
    sources: { type: "array", items: SYNTHESIZED_SOURCE_SCHEMA },
  },
  required: [
    "entityName",
    "answer",
    "confidence",
    "keyMetrics",
    "whyThisTeam",
    "signals",
    "changes",
    "risks",
    "comparables",
    "nextActions",
    "nextQuestions",
    "sources",
  ],
};

// ── Synthesis: combine step results into a ResultPacket ──────────────

export async function synthesizeResults(
  execution: HarnessExecution,
  query: string,
  lens: string,
  callTool: ToolCaller,
): Promise<{
  entityName: string;
  answer: string;
  confidence: number;
  keyMetrics: Array<{ label: string; value: string }>;
  signals: SynthesizedSignal[];
  changes: SynthesizedChange[];
  risks: SynthesizedRisk[];
  comparables: SynthesizedComparable[];
  whyThisTeam: {
    founderCredibility: string;
    trustSignals: string[];
    visionMagnitude: string;
    reinventionCapacity: string;
    hiddenRequirements: string[];
  } | null;
  nextActions: Array<{ action: string; impact: string }>;
  nextQuestions: string[];
  sources: SynthesizedSource[];
}> {
  const comparableFallbacks = deriveComparableCandidates(execution, execution.plan.entityTargets[0] ?? extractEntityFromQuery(query));

  // Collect all successful results — no hardcoded truncation
  const resultData = execution.stepResults
    .filter(r => r.success && r.result)
    .map(r => {
      const res = r.result as any;
      return {
        tool: r.toolName,
        data: typeof res === "string" ? res : JSON.stringify(res),
      };
    });

  // For entity-focused queries, use the plan's target. For non-entity queries
  // (weekly_reset, general), use a descriptive label — never extractEntityFromQuery
  // which hallucinates entities from phrase fragments like "changed this week".
  const nonEntityTypes = new Set(["weekly_reset", "important_change", "pre_delegation", "general"]);
  const entityName =
    execution.plan.classification === "multi_entity" && (execution.plan.entityTargets?.length ?? 0) > 1
      ? execution.plan.entityTargets.slice(0, 3).join(" vs ")
      : execution.plan.entityTargets[0]
        ?? (nonEntityTypes.has(execution.plan.classification) ? "Your Intelligence Brief" : extractEntityFromQuery(query));

  // Use multi-model provider bus (Gemini → OpenAI → Anthropic)
  // This is the PRIMARY synthesis path — an IB analyst writing a memo from raw data.
  if (resultData.length > 0) {
    try {
      const text = await callLLM(
        callTool,
        `You are a senior investment banking analyst writing an intelligence memo. Analyze these raw data sources and produce a structured assessment.

QUERY: "${query}"
AUDIENCE: ${lens} (tailor depth and focus accordingly)
OBJECTIVE: ${execution.plan.objective}

RAW DATA FROM ${resultData.length} SOURCES:
${budgetToolData(resultData, 32000)}

ANALYSIS REQUIREMENTS:
0. PRESERVE THE USER'S REQUESTED WORKFLOW: If the query asks for event capture, interview prep, a reply draft, customer discovery, demo-day diligence, or a workspace handoff, include those deliverables explicitly in the answer and nextActions. Do not collapse those requests into a generic company memo.
1. ANSWER: Write a 3-4 sentence executive summary with SPECIFIC numbers, dates, and facts from the data. No generic statements. If data says "$26B revenue" — cite it. If data mentions "70% market share" — cite it.
2. KEY METRICS: Extract up to 4 banker-grade datapoints as {label, value}. Use real numbers only, such as revenue, valuation, gross margin, market share, compute cost, or growth.
3. SIGNALS: Extract 3-5 key signals with direction (up/down/neutral) and impact. Each signal must reference a specific fact from the data, not a generic observation.
3. RISKS: Identify 2-3 material risks with evidence. For each risk, explain WHY it matters and what could trigger it. Not just "competition risk" — specify which competitor and what they're doing.
4. COMPARABLES: Name 2-4 direct competitors with WHY they're relevant (what they do differently, where they overlap, competitive advantage). Include evidence from the data.
   - Never use publishers, research outlets, indices, newsletters, or article-title fragments as comparables.
   - For multi-entity requests, keep the comparison set anchored to the companies explicitly in scope plus directly adjacent operating peers only.
5. WHY THIS TEAM (REQUIRED — this is the most important section. What makes outsiders trust or doubt this company):
   - founderCredibility: 1-2 sentences on founder background, domain relevance, and what makes them credible for THIS problem
   - trustSignals: 2-4 specific trust-building facts (notable backers, advisors, prior exits, shipped products, institutional affiliations, public work)
   - visionMagnitude: 1-2 sentences — is the opportunity large enough to matter? Feature, product, or company?
   - reinventionCapacity: 1 sentence — can this team adapt if the wedge changes? Evidence of resilience/iteration.
   - hiddenRequirements: 2-4 things sophisticated outsiders (VCs, banks, enterprise buyers) would secretly expect before taking this seriously
6. NEXT ACTIONS: 2-3 specific, actionable steps the ${lens} should take this week. Not generic "do more research" — specific actions like "review Q4 filing for revenue breakdown" or "compare pricing vs competitor X".
7. FOLLOW-UP QUESTIONS: 3-4 specific questions that would deepen this analysis. Questions should reference gaps in the current data.
8. SOURCES: List actual source names/URLs from the data. Never list tool names like "web_search" or "run_recon". Use the actual article titles, document names, or website domains.
9. SOURCE LINKING: Every signal, change, risk, and comparable must include score (0-100), sourceLabel, sourceHref when available, and evidenceQuote. Omit weak items instead of fabricating provenance.

Return ONLY valid JSON with ALL fields populated:
{
  "entityName": "company name",
  "answer": "3-4 sentence summary with numbers",
  "confidence": 0-100,
  "keyMetrics": [{"label": "metric name", "value": "metric value"}],
  "whyThisTeam": {"founderCredibility": "why these founders are credible for this problem", "trustSignals": ["signal1", "signal2"], "visionMagnitude": "feature, product, or company-scale?", "reinventionCapacity": "can they pivot?", "hiddenRequirements": ["what outsiders expect"]},
  "signals": [{"name": "signal", "direction": "up|down|neutral", "impact": "high|medium|low", "score": 0, "sourceLabel": "source", "sourceHref": "https://...", "evidenceQuote": "proof"}],
  "changes": [{"description": "recent change", "date": "optional", "score": 0, "sourceLabel": "source", "sourceHref": "https://...", "evidenceQuote": "proof"}],
  "risks": [{"title": "risk", "description": "why it matters", "score": 0, "sourceLabel": "source", "sourceHref": "https://...", "evidenceQuote": "proof"}],
  "comparables": [{"name": "competitor", "relevance": "high|medium|low", "note": "why relevant", "score": 0, "sourceLabel": "source", "sourceHref": "https://...", "evidenceQuote": "proof"}],
  "nextActions": [{"action": "step", "impact": "high|medium|low"}],
  "nextQuestions": ["follow-up question"],
  "sources": [{"label": "source title", "href": "url", "type": "web|doc"}]
}`,
        "You are a senior investment banking analyst. Every claim must cite specific data. No generic statements. No placeholder text. If data is insufficient, say so honestly rather than fabricating.",
        2200,
        {
          responseSchemaName: "nodebench_synthesis_packet",
          responseJsonSchema: SYNTHESIS_RESPONSE_SCHEMA,
          forceJson: true,
        },
      );

      const parsedResult = parseJsonObjectFromText<any>(text);
      logHarnessDebug(
        "[synthesis] LLM returned",
        text.length,
        "chars. jsonParse:",
        parsedResult.ok ? `ok${parsedResult.repaired ? ` repaired=${parsedResult.repairNotes.join(";")}` : ""}` : `failed=${parsedResult.error}`,
        "first 100:",
        text.slice(0, 100),
      );
      if (parsedResult.ok) {
        const parsed = parsedResult.value;
        logHarnessDebug("[synthesis] Parsed OK. entityName:", parsed.entityName, "signals:", parsed.signals?.length, "risks:", parsed.risks?.length);
        const signalContext = {
          entityName,
          classification: execution.plan.classification,
          entityTargets: execution.plan.entityTargets,
        };
        const signals = mergeSignals(collectFallbackSignals(execution, signalContext), sanitizeSignals(parsed.signals, signalContext));
        const changes = sanitizeChanges([
          ...collectFallbackChanges(execution),
          ...(Array.isArray(parsed.changes) ? parsed.changes : []),
        ], signalContext);
        const risks = sanitizeRisks([
          ...collectFallbackRisks(execution),
          ...(Array.isArray(parsed.risks) ? parsed.risks : []),
        ], signalContext);
        const comparables = sanitizeComparables(parsed.comparables, entityName, comparableFallbacks, {
          classification: execution.plan.classification,
          entityTargets: execution.plan.entityTargets,
        });
        const keyMetrics = deriveEvidenceKeyMetrics({
          provided: Array.isArray(parsed.keyMetrics) ? parsed.keyMetrics : [],
          execution,
          entityName,
          entityTargets: execution.plan.entityTargets,
          lens,
          classification: execution.plan.classification,
          signals,
          changes,
        });
        const nextActions = sanitizeNextActions(parsed.nextActions, lens, entityName, comparables, risks, {
          classification: execution.plan.classification,
          entityTargets: execution.plan.entityTargets,
        });
        const sources = sanitizeSources(parsed.sources, execution, signalContext);
        const nextQuestions = dedupeStrings(
          Array.isArray(parsed.nextQuestions) ? parsed.nextQuestions.map((item: unknown) => String(item ?? "")) : [],
        )
          .filter((item) => item.length >= 12 && isQuestionLike(item))
          .slice(0, 4);
        const finalQuestions = dedupeStrings([
          ...nextQuestions,
          ...buildDefaultNextQuestions({
            classification: execution.plan.classification,
            entityName,
            comparables,
            risks,
            entityTargets: execution.plan.entityTargets,
          }),
        ]).slice(0, 4);
        const whyThisTeam =
          parsed.whyThisTeam && typeof parsed.whyThisTeam === "object"
            ? {
                founderCredibility: normalizeWhitespace(String(parsed.whyThisTeam.founderCredibility ?? "")),
                trustSignals: dedupeStrings(
                  Array.isArray(parsed.whyThisTeam.trustSignals)
                    ? parsed.whyThisTeam.trustSignals.map((item: unknown) => String(item ?? ""))
                    : [],
                ).slice(0, 4),
                visionMagnitude: normalizeWhitespace(String(parsed.whyThisTeam.visionMagnitude ?? "")),
                reinventionCapacity: normalizeWhitespace(String(parsed.whyThisTeam.reinventionCapacity ?? "")),
                hiddenRequirements: dedupeStrings(
                  Array.isArray(parsed.whyThisTeam.hiddenRequirements)
                    ? parsed.whyThisTeam.hiddenRequirements.map((item: unknown) => String(item ?? ""))
                    : [],
                ).slice(0, 4),
              }
            : null;
        const answer = sanitizeExecutiveAnswer(
          String(parsed.answer ?? ""),
          entityName,
          keyMetrics,
          signals,
          comparables,
          risks,
          nextActions,
          {
            classification: execution.plan.classification,
            entityTargets: execution.plan.entityTargets,
            lens,
          },
        );

        return {
          entityName: parsed.entityName ?? entityName,
          answer,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 50,
          keyMetrics,
          signals,
          changes,
          risks,
          comparables,
          whyThisTeam,
          nextActions,
          nextQuestions: finalQuestions,
          sources,
        };
      }
    } catch (synthErr: any) { console.error("[synthesis] LLM path failed:", synthErr?.message?.slice(0, 150)); }
  }

  // Deterministic synthesis: extract structured data from raw tool results
  // This is the structural path — not a "fallback". Tool results ARE structured data.
  const signals: SynthesizedSignal[] = [];
  const changes: SynthesizedChange[] = [];
  const risks: SynthesizedRisk[] = [];
  const comparables: SynthesizedComparable[] = [];
  const nextActions: Array<{ action: string; impact: string }> = [];
  const sources: Array<{ label: string; href?: string; type: string }> = [];
  const answerParts: string[] = [];

  for (const sr of execution.stepResults) {
    if (!sr.success || !sr.result) continue;
    const raw = sr.result as any;

    // Skip results that report their own errors (HONEST_STATUS: tool returned 200 but error inside)
    if (raw?.error === true) continue;

    // ── linkup_search results (richest source — answer + sources with snippets) ──
    if (sr.toolName === "linkup_search") {
      if (raw?.answer) answerParts.unshift(String(raw.answer).slice(0, 500)); // Linkup answer is highest quality, prepend
      const lSources = raw?.sources ?? [];
      for (const s of (Array.isArray(lSources) ? lSources : []).slice(0, 5)) {
        const title = s?.name ?? s?.title ?? "";
        const snippet = s?.snippet ?? s?.description ?? "";
        const url = s?.url ?? "";
        if (title) sources.push({ label: title.slice(0, 80), href: url || undefined, type: "web" });
        if (snippet) {
          if (/\b(revenue|growth|raised|funding|launch|expand|partner|acquir|billion|million|valuation)/i.test(snippet)) {
            const titleNeg = /\b(trouble|fail|declin|crash|struggle|layoff|scandal|problem|crisis|concern|threaten|warn)/i.test(title || snippet);
            signals.push({
              name: extractEvidenceSentencesSafe(snippet)[0] ?? snippet.slice(0, 120),
              direction: titleNeg ? "down" : "up",
              impact: "high",
              score: 82,
              sourceLabel: title || undefined,
              sourceHref: url || undefined,
              evidenceQuote: extractEvidenceSentencesSafe(snippet)[0] ?? snippet.slice(0, 180),
            });
          }
          if (/\b(layoff|decline|loss|risk|lawsuit|regulat|concern|investig|threat|challenge|vulnerab)/i.test(snippet)) {
            risks.push({
              title: inferRiskTitleFromDescription(snippet),
              description: snippet.slice(0, 200),
              score: 80,
              sourceLabel: title || undefined,
              sourceHref: url || undefined,
              evidenceQuote: extractEvidenceSentencesSafe(snippet)[0] ?? snippet.slice(0, 180),
            });
          }
          if (/\b(compet|rival|alternative|versus|vs\.|compared to)/i.test(snippet)) {
            // Extract competitor names from snippet
            const compMatch = snippet.match(/(?:competitors?|rivals?|alternatives?)\s+(?:like|such as|including)\s+([A-Z][a-zA-Z]+(?:\s*,\s*[A-Z][a-zA-Z]+)*)/i);
            if (compMatch) {
              for (const name of compMatch[1].split(/,\s*/)) {
                if (name.trim().length > 2 && !/^(and|or|the|a|an|its|their|also|but|with)$/i.test(name.trim())) comparables.push({ name: name.trim(), relevance: "high", note: "Identified via Linkup", score: 76, sourceLabel: title || undefined, sourceHref: url || undefined, evidenceQuote: extractEvidenceSentencesSafe(snippet)[0] ?? snippet.slice(0, 180) });
              }
            }
          }
          // Extract recent changes from Linkup intelligence
          if (/\b(announced|launched|released|updated|acquired|raised|hired|expanded|partnered|introduced|unveiled|reported)\b/i.test(snippet)) {
            const description = normalizeChangeDescription(extractEvidenceSentencesSafe(snippet)[0] ?? snippet);
            if (description) changes.push({ description, score: 78, sourceLabel: title || undefined, sourceHref: url || undefined, evidenceQuote: extractEvidenceSentencesSafe(snippet)[0] ?? snippet.slice(0, 180) });
          }
        }
      }
    }

    // ── web_search results ──
    if (sr.toolName === "web_search") {
      // web_search returns { results: [...] } or { webResults: [...] } or { content: "..." }
      const results = raw?.results ?? raw?.webResults ?? (Array.isArray(raw) ? raw : []);
      for (const r of (Array.isArray(results) ? results : []).slice(0, 5)) {
        const title = r?.title ?? r?.name ?? "";
        const snippet = r?.snippet ?? r?.description ?? r?.content ?? "";
        const url = r?.url ?? r?.link ?? r?.href ?? "";
        if (title) sources.push({ label: title.slice(0, 80), href: url || undefined, type: "web" });
        if (snippet) {
          answerParts.push(snippet.slice(0, 200));
          if (/\b(growth|revenue|raised|funding|launch|expand|partner|acquir)/i.test(snippet)) {
            // Check title sentiment — don't assign "up" if headline is negative
            const titleNeg = /\b(trouble|fail|declin|crash|struggle|layoff|scandal|problem|crisis|concern|threaten|warn)/i.test(title);
            signals.push({
              name: extractEvidenceSentencesSafe(snippet)[0] ?? snippet.slice(0, 120),
              direction: titleNeg ? "down" : "up",
              impact: "medium",
              score: 74,
              sourceLabel: title || undefined,
              sourceHref: url || undefined,
              evidenceQuote: extractEvidenceSentencesSafe(snippet)[0] ?? snippet.slice(0, 180),
            });
          }
          if (/\b(layoff|decline|loss|risk|lawsuit|regulat|concern|investig)/i.test(snippet)) {
            risks.push({
              title: inferRiskTitleFromDescription(snippet),
              description: snippet.slice(0, 200),
              score: 72,
              sourceLabel: title || undefined,
              sourceHref: url || undefined,
              evidenceQuote: extractEvidenceSentencesSafe(snippet)[0] ?? snippet.slice(0, 180),
            });
          }
          // Extract recent changes from news-style snippets
          if (/\b(announced|launched|released|updated|acquired|raised|hired|expanded|partnered|introduced|unveiled|reported)\b/i.test(snippet)) {
            const description = normalizeChangeDescription(extractEvidenceSentencesSafe(snippet)[0] ?? snippet);
            if (description) changes.push({ description, score: 70, sourceLabel: title || undefined, sourceHref: url || undefined, evidenceQuote: extractEvidenceSentencesSafe(snippet)[0] ?? snippet.slice(0, 180) });
          }
          // Extract comparables from competitive mentions
          if (/\b(compet|rival|alternative|versus|vs\.|compared to)/i.test(snippet)) {
            const compMatch = snippet.match(/(?:competitors?|rivals?|alternatives?)\s+(?:like|such as|including)\s+([A-Z][a-zA-Z]+(?:\s*,\s*[A-Z][a-zA-Z]+)*)/i);
            if (compMatch) {
              for (const name of compMatch[1].split(/,\s*/)) {
                if (name.trim().length > 2 && !/^(and|or|the|a|an|its|their|also|but|with)$/i.test(name.trim())) comparables.push({ name: name.trim(), relevance: "high", note: "Web intelligence", score: 68, sourceLabel: title || undefined, sourceHref: url || undefined, evidenceQuote: extractEvidenceSentencesSafe(snippet)[0] ?? snippet.slice(0, 180) });
              }
            }
          }
        }
      }
      // web_search may also return content as a single string (grounded search)
      if (typeof raw?.content === "string" && raw.content.length > 20) {
        answerParts.push(raw.content.slice(0, 500));
        sources.push({ label: raw?.query ?? "web search", type: "web" });
      }
    }

    // ── run_recon results ──
    if (sr.toolName === "run_recon") {
      // run_recon returns { status: "active", researchPlan: {...}, nextSteps: [...] }
      // or completed recon: { findings: [...], summary: "..." }
      if (raw?.researchPlan) {
        // Async recon — extract planned sources as signals
        const plan = raw.researchPlan;
        const external = plan?.externalSources ?? [];
        const internal = plan?.internalChecks ?? [];
        // Recon plan is internal execution status, not intelligence — don't surface it
        // Don't add "run_recon" as a source label — use actual findings instead
      }
      if (raw?.findings) {
        for (const f of (Array.isArray(raw.findings) ? raw.findings : []).slice(0, 5)) {
          const name = typeof f === "string" ? f : (f?.name ?? f?.title ?? f?.finding ?? "");
          if (!name) continue;
          const normalizedFinding = normalizeWhitespace(name).slice(0, 260);
          signals.push({ name: normalizedFinding, direction: f?.direction ?? "neutral", impact: f?.impact ?? "medium" });
          if (/\b(quadrupled|doubled|tripled|expanded|grew|growth|increased|reached|now exceeds|accelerat|represent over half|enterprise use)\b/i.test(normalizedFinding)) {
            const description = normalizeChangeDescription(normalizedFinding);
            if (description) changes.push({ description });
          }
        }
      }
      if (raw?.nextSteps) {
        for (const s of (Array.isArray(raw.nextSteps) ? raw.nextSteps : []).slice(0, 3)) {
          const action = typeof s === "string" ? s : (s?.action ?? "");
          if (action) nextActions.push({ action: action.slice(0, 100), impact: "medium" });
        }
      }
      if (raw?.summary) answerParts.push(String(raw.summary).slice(0, 300));
    }

    // ── founder_local_gather results ──
    if (sr.toolName === "founder_local_gather") {
      // Returns { gathered, identity, recentChanges, publicSurfaces, sessionMemory, dogfoodFindings, architectureDocs }
      if (raw?.identity?.projectName) {
        signals.push({ name: `Project: ${raw.identity.projectName}`, direction: "neutral", impact: "low" });
      }
      if (raw?.recentChanges?.commitCount > 0) {
        signals.push({ name: `${raw.recentChanges.commitCount} commits in last ${raw.recentChanges.daysBack}d`, direction: "up", impact: "medium" });
        for (const c of (raw.recentChanges.topCommits ?? []).slice(0, 3)) {
          changes.push({ description: (c?.message ?? c?.subject ?? String(c)).slice(0, 120), date: c?.date });
        }
      }
      if (raw?.sessionMemory?.actions7d > 0) {
        signals.push({ name: `${raw.sessionMemory.actions7d} actions in last 7d`, direction: "up", impact: "medium" });
      }
      if (raw?.dogfoodFindings?.p0 > 0) {
        risks.push({ title: `${raw.dogfoodFindings.p0} P0 issues`, description: "Critical issues found in dogfood" });
      }
      sources.push({ label: "Local company context", type: "local" });
    }

    // ── founder_local_synthesize / weekly_reset ──
    if (sr.toolName.startsWith("founder_local") && sr.toolName !== "founder_local_gather") {
      if (raw?.changes) {
        for (const c of (Array.isArray(raw.changes) ? raw.changes : []).slice(0, 5)) {
          const desc = typeof c === "string" ? c : (c?.description ?? c?.change ?? "");
          if (desc) changes.push({ description: desc.slice(0, 120), date: c?.date });
        }
      }
      if (raw?.contradictions) {
        for (const c of (Array.isArray(raw.contradictions) ? raw.contradictions : []).slice(0, 3)) {
          const claim = typeof c === "string" ? c : (c?.claim ?? c?.contradiction ?? "");
          if (claim) risks.push({ title: "Contradiction", description: claim.slice(0, 150) });
        }
      }
      if (raw?.nextMoves ?? raw?.recommendations) {
        for (const m of (raw.nextMoves ?? raw.recommendations ?? []).slice(0, 3)) {
          const action = typeof m === "string" ? m : (m?.action ?? m?.move ?? "");
          if (action) nextActions.push({ action: action.slice(0, 100), impact: m?.impact ?? "medium" });
        }
      }
      if (raw?.summary ?? raw?.briefing) answerParts.push(String(raw.summary ?? raw.briefing).slice(0, 300));
      sources.push({ label: "Founder intelligence synthesis", type: "local" });
    }

    // ── enrich_entity results ──
    if (sr.toolName === "enrich_entity") {
      if (raw?.signals) {
        for (const s of (Array.isArray(raw.signals) ? raw.signals : []).slice(0, 5)) {
          signals.push({ name: (s?.name ?? String(s)).slice(0, 120), direction: s?.direction ?? "neutral", impact: s?.impact ?? "medium" });
        }
      }
      if (raw?.description) answerParts.push(String(raw.description).slice(0, 300));
    }

    // ── simulate_decision_paths (Monte Carlo) results ──
    if (sr.toolName === "simulate_decision_paths") {
      const sim = raw?.summary;
      if (sim) {
        // IB three-case model: bull (p90), base (median), bear (p10)
        const bull = raw?.bestPath;
        const bear = raw?.worstPath;
        // Cap MC signals to 2 — simulation context is supplementary, not primary intelligence
        signals.push({ name: `Monte Carlo (${sim.paths} paths): ${sim.successRate} success, base payoff ${sim.medianPayoff}`, direction: "neutral", impact: "medium" });
        if (bull && bear) {
          signals.push({ name: `3-case model: Bull ${bull.payoff} | Bear ${bear.payoff} (${sim.confidenceInterval})`, direction: "neutral", impact: "medium" });
        }
        // Decision sensitivity → risks
        for (const d of (raw?.decisionSensitivity ?? [])) {
          risks.push({ title: `Decision: ${d.decision}`, description: `Best choice: "${d.bestChoice}" (${d.impact} vs average). Wrong choice here materially affects outcomes.` });
        }
        // Don't append raw simulation text to answer body — MC data shown in signals
        sources.push({ label: `Financial simulation (${sim.paths} scenarios)`, type: "local" });
      }
    }

    // ── Generic fallback: extract any summary from unknown tools ──
    if (!["web_search", "run_recon", "founder_local_gather", "enrich_entity"].includes(sr.toolName) && !sr.toolName.startsWith("founder_local")) {
      const summary = raw?.summary ?? raw?.answer ?? raw?.result ?? raw?.output ?? raw?.briefing;
      if (typeof summary === "string" && summary.length > 10) {
        answerParts.push(summary.slice(0, 300));
        sources.push({ label: summary.slice(0, 80), type: "local" });
      }
    }
  }

  // Build answer from collected parts
  const signalContext = {
    entityName,
    classification: execution.plan.classification,
    entityTargets: execution.plan.entityTargets,
  };
  const sanitizedSignals = mergeSignals(sanitizeSignals(signals, signalContext), collectFallbackSignals(execution, signalContext));
  const sanitizedChanges = sanitizeChanges(changes, signalContext);
  const sanitizedRisks = sanitizeRisks([...risks, ...collectFallbackRisks(execution)], signalContext);
  const sanitizedComparables = sanitizeComparables(comparables, entityName, comparableFallbacks, {
    classification: execution.plan.classification,
    entityTargets: execution.plan.entityTargets,
  });
  const keyMetrics = deriveEvidenceKeyMetrics({
    execution,
    entityName,
    entityTargets: execution.plan.entityTargets,
    lens,
    classification: execution.plan.classification,
    signals: sanitizedSignals,
    changes: sanitizedChanges,
  });
  const sanitizedNextActions = sanitizeNextActions(nextActions, lens, entityName, sanitizedComparables, sanitizedRisks, {
    classification: execution.plan.classification,
    entityTargets: execution.plan.entityTargets,
  });
  const sanitizedSources = sanitizeSources(sources, execution, signalContext);
  const answer = sanitizeExecutiveAnswer(
    answerParts.length > 0
      ? answerParts.slice(0, 5).join(" ").slice(0, 800)
      : `Analysis of "${query}" using ${execution.stepResults.filter(r => r.success).length} tools.`,
    entityName,
    keyMetrics,
    sanitizedSignals,
    sanitizedComparables,
    sanitizedRisks,
    sanitizedNextActions,
    {
      classification: execution.plan.classification,
      entityTargets: execution.plan.entityTargets,
      lens,
    },
  );

  // Add default next actions if none extracted — make them specific and actionable
  if (sanitizedNextActions.length === 0) {
    const isEntityQuery = entityName && entityName.length > 1 && !/^(AI|the|your|my|this)$/i.test(entityName) && !entityName.includes("Intelligence Brief");
    if (sanitizedRisks.length > 0) {
      sanitizedNextActions.push({ action: `Investigate "${sanitizedRisks[0].title}" and identify the concrete trigger points that would make it matter.`, impact: "high" });
    }
    if (isEntityQuery) {
      if (sanitizedComparables.length > 0) {
        sanitizedNextActions.push({ action: `Compare ${entityName} against ${sanitizedComparables[0].name} on pricing, enterprise traction, and durability of demand.`, impact: "medium" });
      } else {
        sanitizedNextActions.push({ action: `Map ${entityName}'s competitive moat and separate durable edge from narrative momentum.`, impact: "medium" });
      }
      sanitizedNextActions.push({ action: `Review ${entityName}'s most recent filings, announcements, or product launches for diligence-grade evidence.`, impact: "medium" });
    } else {
      // Non-entity queries (weekly reset, general) — action-oriented defaults
      sanitizedNextActions.push({ action: "Identify the top 3 risks to your current strategy and assign a concrete mitigation owner to each.", impact: "high" });
      sanitizedNextActions.push({ action: "Review what changed this week and decide what to act on versus defer with explicit rationale.", impact: "medium" });
    }
  }

  const successCount = execution.stepResults.filter(r => r.success).length;
  const totalSteps = execution.stepResults.length;
  const webSourceCount = sanitizedSources.filter(s => s.type === "web" && s.href).length;
  // Confidence formula: rewards web sources (real data) over local tools
  // Base 20 + success rate bonus + web sources (10 pts each, max 40) + signals (3 pts each, max 15) + comparables (5 pts each, max 10)
  const successRate = totalSteps > 0 ? successCount / totalSteps : 0;
  const confidence = Math.min(95, Math.round(
    20
    + (successRate * 15)                                      // 0-15: did tools succeed?
    + (Math.min(webSourceCount, 4) * 10)                      // 0-40: real web sources (most important)
    + (Math.min(signals.length, 5) * 3)                       // 0-15: intelligence signals
    + (Math.min(comparables.length, 2) * 5)                   // 0-10: competitive context
  ));

  return {
    entityName,
    answer,
    confidence,
    keyMetrics,
    signals: sanitizedSignals
      .filter(s => !/in progress|recon plan|project:|commits in last|research plan|status.*active|tool_call|step\s+\d|executing|queued/i.test(s.name))
      .slice(0, 8),
    changes: sanitizedChanges.slice(0, 5),
    risks: sanitizedRisks.slice(0, 5),
    comparables: sanitizedComparables.slice(0, 4),
    whyThisTeam: null, // populated by LLM synthesis path; deterministic path lacks founder data
    nextActions: sanitizedNextActions
      .filter(a => !/contextQuestions|check_framework|gather project|ingest_upload|Answer any|Use\s+\w+_\w+/i.test(a.action))
      .slice(0, 4),
    nextQuestions: dedupeStrings(
      buildDefaultNextQuestions({
        classification: execution.plan.classification,
        entityName,
        comparables: sanitizedComparables,
        risks: sanitizedRisks,
        entityTargets: execution.plan.entityTargets,
      }),
    ).slice(0, 4),
    sources: sanitizedSources.slice(0, 8),
  };
}
