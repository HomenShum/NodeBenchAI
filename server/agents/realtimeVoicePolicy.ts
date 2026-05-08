export type VoiceTier =
  | "gemini-flash-live"
  | "openai-whisper"
  | "openai-realtime-mini"
  | "openai-realtime-2"
  | "openai-realtime-translate";

export type VoiceSurface =
  | "anonymous"
  | "home"
  | "chat"
  | "event"
  | "report"
  | "agent"
  | "translation"
  | "unknown";

export type VoiceRoutingInput = {
  userKey: string;
  requestedTier?: string;
  surface?: string;
  agentMode?: boolean;
  translationMode?: boolean;
  transcriptionOnly?: boolean;
  deepWork?: boolean;
  networkQuality?: "good" | "poor" | "offline";
  dailyCostUsd?: number;
  dailyCapUsd?: number;
};

export type VoiceRoutingDecision = {
  tier: VoiceTier;
  provider: "gemini" | "openai" | "browser";
  model: string;
  captureOnly: boolean;
  capHit: boolean;
  gate: string;
  reason: string;
  banner?: string;
  dailyCostUsd: number;
  dailyCapUsd: number;
};

export type RedactedSpan = {
  start: number;
  end: number;
  reason: "phone" | "ssn" | "credit_card" | "email";
  replacement: string;
};

export type RedactionResult = {
  text: string;
  spans: RedactedSpan[];
};

export type ExtractedVoiceEntity = {
  label: string;
  type: "person" | "company" | "topic";
  confidence: number;
};

export const DEFAULT_VOICE_DAILY_CAP_USD = 5;
export const GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";

const MODEL_BY_TIER: Record<VoiceTier, string> = {
  "gemini-flash-live": GEMINI_LIVE_MODEL,
  "openai-whisper": "gpt-realtime-whisper",
  "openai-realtime-mini": "gpt-realtime-mini",
  "openai-realtime-2": "gpt-realtime-2",
  "openai-realtime-translate": "gpt-realtime-translate",
};

export function getUtcDay(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function normalizeVoiceSurface(value: string | undefined): VoiceSurface {
  if (!value) return "unknown";
  const normalized = value.toLowerCase();
  if (
    normalized === "anonymous" ||
    normalized === "home" ||
    normalized === "chat" ||
    normalized === "event" ||
    normalized === "report" ||
    normalized === "agent" ||
    normalized === "translation"
  ) {
    return normalized;
  }
  return "unknown";
}

export function selectVoiceModelTier(input: VoiceRoutingInput): VoiceRoutingDecision {
  const dailyCostUsd = Math.max(0, input.dailyCostUsd ?? 0);
  const dailyCapUsd = Math.max(0, input.dailyCapUsd ?? DEFAULT_VOICE_DAILY_CAP_USD);

  if (dailyCapUsd <= 0 || dailyCostUsd >= dailyCapUsd) {
    return {
      tier: "openai-whisper",
      provider: "openai",
      model: MODEL_BY_TIER["openai-whisper"],
      captureOnly: true,
      capHit: true,
      gate: "daily_cost_cap_hit",
      reason: "Daily voice spend cap reached, so NodeBench switches to capture-only transcription.",
      banner: "Daily voice spend limit reached. Capture-only mode is available until the UTC reset.",
      dailyCostUsd,
      dailyCapUsd,
    };
  }

  const requested = normalizeTier(input.requestedTier);
  if (requested) {
    return decisionForTier(requested, dailyCostUsd, dailyCapUsd, "requested_tier", "User or caller requested a specific voice tier.");
  }

  if (input.translationMode || normalizeVoiceSurface(input.surface) === "translation") {
    return decisionForTier(
      "openai-realtime-translate",
      dailyCostUsd,
      dailyCapUsd,
      "translation_mode",
      "Cross-language event mode requires dual-language realtime translation.",
    );
  }

  if (input.transcriptionOnly || input.networkQuality === "poor" || input.networkQuality === "offline") {
    return decisionForTier(
      "openai-whisper",
      dailyCostUsd,
      dailyCapUsd,
      "capture_only",
      "Capture-only or poor-network mode prefers transcription over live voice output.",
    );
  }

  if (input.agentMode) {
    return decisionForTier(
      "openai-realtime-2",
      dailyCostUsd,
      dailyCapUsd,
      "agent_mode",
      "Phone-grade agent mode needs preambles, reliable tool calls, and approval gates.",
    );
  }

  if (input.deepWork) {
    return decisionForTier(
      "openai-realtime-mini",
      dailyCostUsd,
      dailyCapUsd,
      "deep_work_handoff",
      "Realtime should acknowledge the request and hand durable research to async workers.",
    );
  }

  return decisionForTier(
    "gemini-flash-live",
    dailyCostUsd,
    dailyCapUsd,
    "default_live",
    "Current production default keeps the existing Gemini Live path stable.",
  );
}

function normalizeTier(value: string | undefined): VoiceTier | null {
  if (!value) return null;
  if (
    value === "gemini-flash-live" ||
    value === "openai-whisper" ||
    value === "openai-realtime-mini" ||
    value === "openai-realtime-2" ||
    value === "openai-realtime-translate"
  ) {
    return value;
  }
  return null;
}

function decisionForTier(
  tier: VoiceTier,
  dailyCostUsd: number,
  dailyCapUsd: number,
  gate: string,
  reason: string,
): VoiceRoutingDecision {
  const provider = tier.startsWith("openai") ? "openai" : "gemini";
  return {
    tier,
    provider,
    model: MODEL_BY_TIER[tier],
    captureOnly: tier === "openai-whisper",
    capHit: false,
    gate,
    reason,
    dailyCostUsd,
    dailyCapUsd,
  };
}

export function redactPII(input: string): RedactionResult {
  const spans: RedactedSpan[] = [];
  const matches: Array<{ start: number; end: number; reason: RedactedSpan["reason"] }> = [];

  collectRegexMatches(input, /\b\d{3}-\d{2}-\d{4}\b/g, "ssn", matches);
  collectRegexMatches(input, /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, "phone", matches);
  collectRegexMatches(input, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "email", matches);
  collectRegexMatches(input, /\b(?:\d[ -]?){13,19}\b/g, "credit_card", matches, (value) => {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
  });

  const ordered = matches
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((span, index, all) => !all.some((other, otherIndex) => otherIndex < index && span.start < other.end));

  let output = "";
  let cursor = 0;
  for (const span of ordered) {
    output += input.slice(cursor, span.start);
    const replacement = `[REDACTED:${span.reason}]`;
    output += replacement;
    spans.push({ ...span, replacement });
    cursor = span.end;
  }
  output += input.slice(cursor);

  return { text: output, spans };
}

function collectRegexMatches(
  input: string,
  regex: RegExp,
  reason: RedactedSpan["reason"],
  matches: Array<{ start: number; end: number; reason: RedactedSpan["reason"] }>,
  predicate: (value: string) => boolean = () => true,
): void {
  for (const match of input.matchAll(regex)) {
    if (match.index === undefined) continue;
    const value = match[0];
    if (!predicate(value)) continue;
    matches.push({ start: match.index, end: match.index + value.length, reason });
  }
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

export function extractVoiceEntities(text: string): ExtractedVoiceEntity[] {
  const entities = new Map<string, ExtractedVoiceEntity>();
  const companyPattern = /\b([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3}\s+(?:Labs|AI|Systems|Bank|Health|Software|Technologies|Tech|Capital|Partners|Inc|Corp))\b/g;
  const personPattern = /\b(?:[Mm]et|[Cc]all|[Ff]ollow up with|[Tt]alked to|[Ss]poke with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;
  const topicPattern = /\b(?:voice-agent eval infra|healthcare design partners?|funding|series [abc]|customer discovery|pilot criteria|translation|deep research)\b/gi;

  for (const match of text.matchAll(companyPattern)) {
    addEntity(entities, match[1].trim(), "company", 0.82);
  }
  for (const match of text.matchAll(personPattern)) {
    addEntity(entities, match[1].trim(), "person", 0.76);
  }
  for (const match of text.matchAll(topicPattern)) {
    addEntity(entities, match[0].trim(), "topic", 0.68);
  }

  return Array.from(entities.values()).slice(0, 12);
}

function addEntity(
  entities: Map<string, ExtractedVoiceEntity>,
  label: string,
  type: ExtractedVoiceEntity["type"],
  confidence: number,
): void {
  const normalized = label.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length < 2) return;
  const key = `${type}:${normalized.toLowerCase()}`;
  if (!entities.has(key)) entities.set(key, { label: normalized, type, confidence });
}

export function buildVoiceFollowUps(text: string, entities: ExtractedVoiceEntity[]): string[] {
  const lower = text.toLowerCase();
  const followUps: string[] = [];
  const company = entities.find((entity) => entity.type === "company")?.label;
  const person = entities.find((entity) => entity.type === "person")?.label;

  if (lower.includes("follow up") || lower.includes("partner") || lower.includes("pilot")) {
    followUps.push(
      company
        ? `Follow up with ${company} on fit, source quality, and next action.`
        : "Follow up on the captured event note and confirm next action.",
    );
  }
  if (person) {
    followUps.push(`Confirm ${person}'s last name, role, and contact channel.`);
  }
  if (lower.includes("deep research") || lower.includes("diligence")) {
    followUps.push("Queue async research and attach cited findings back to the report.");
  }

  return Array.from(new Set(followUps)).slice(0, 5);
}
