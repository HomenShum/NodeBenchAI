import type { ProductComposerMode } from "@/features/product/components/ProductIntakeComposer";
import {
  classifyIntake,
  type IntakeSource,
} from "@/features/product/components/intakeSourceClassifier";

export type CaptureIntent =
  | "capture_field_note"
  | "ask_question"
  | "append_to_report"
  | "create_followup"
  | "expand_entity";

export type CaptureTarget =
  | "current_report"
  | "active_event_session"
  | "inbox_item"
  | "unassigned_buffer";

export type CaptureEntityType =
  | "person"
  | "company"
  | "product"
  | "market"
  | "event"
  | "role"
  | "source";

export type CaptureConfidenceGate =
  | "auto_route"
  | "confirm_target"
  | "review_unassigned";

export interface CaptureEntity {
  name: string;
  type: CaptureEntityType;
  confidence: number;
}

export interface CaptureClaim {
  text: string;
  confidence: number;
  verificationStatus: "field_note" | "needs_verification";
}

export interface CaptureFollowUp {
  text: string;
  priority: "low" | "medium" | "high";
}

export interface CaptureRoute {
  intent: CaptureIntent;
  target: CaptureTarget;
  targetLabel: string;
  confidence: number;
  gate: CaptureConfidenceGate;
  needsConfirmation: boolean;
  reason: string;
  sources: ReadonlyArray<IntakeSource>;
  entities: CaptureEntity[];
  claims: CaptureClaim[];
  followUps: CaptureFollowUp[];
  evidence: string[];
  ack: string;
  nextActions: string[];
}

type InferCaptureRouteArgs = {
  text?: string;
  files?: ReadonlyArray<{ name: string; size?: number }>;
  mode?: ProductComposerMode;
  activeContextLabel?: string | null;
};

const QUESTION_START = /^(ask|who|what|when|where|why|how|which|compare|research|evaluate|find|show|summarize|build|draft)\b/i;
const EXPLORE_REQUEST_MARKERS = /\b(need|create|build|produce|turn this into|cluster|compare|rank|verify|diligence|research|explore|workspace|map|brief|sources|cards|notebook)\b/i;
const FIELD_NOTE_MARKERS = /\b(met|talked|spoke|coffee|demo day|conference|booth|voice memo|recorded|handwritten|whiteboard|screenshot|photo|notes?|lecture|pitch|customer call)\b/i;
const FOLLOW_UP_MARKERS = /\b(follow up|follow-up|todo|remind|task|next step|ask them|email|intro|reply|schedule)\b/i;
const APPEND_MARKERS = /\b(add|attach|save|append|put this|log this)\b.*\b(report|brief|dossier|workspace|notebook)\b/i;
const EVENT_MARKERS = /\b(demo day|conference|event|booth|lecture|whiteboard|pitch|summit|meetup)\b/i;
const INBOX_MARKERS = /\b(recruiter|email|inbox|newsletter|invite|application|offer|rejected|job spec)\b/i;
const REPORT_MARKERS = /\b(report|brief|dossier|market map|prd|memo|company|startup|competitor|vendor|paper|repo)\b/i;
const COMPANY_SUFFIX = /\b(Inc|Labs|AI|Systems|Technologies|Tech|Health|Bio|Robotics|Capital|Ventures|Partners|Bank|University|Labs)\b/;

const ENTITY_STOPWORDS = new Set([
  "At",
  "The",
  "This",
  "That",
  "Need",
  "Met",
  "Asked",
  "Follow",
  "Voice",
  "Demo",
  "Series",
  "Seed",
  "Healthcare",
  "Market",
  "Browser",
  "Wants",
  "Saved",
  "Workspace",
]);

export function inferCaptureRoute({
  text = "",
  files = [],
  mode = "ask",
  activeContextLabel,
}: InferCaptureRouteArgs): CaptureRoute {
  const normalized = text.replace(/\s+/g, " ").trim();
  const sources = classifyIntake({ text: normalized, files });
  const hasFiles = files.length > 0;
  const intent = inferIntent(normalized, mode, hasFiles);
  const rawTarget = inferTarget(normalized, intent, activeContextLabel);
  const entities = extractEntities(normalized, sources, rawTarget);
  const claims = extractClaims(normalized, entities);
  const followUps = extractFollowUps(normalized, intent, entities, rawTarget);
  const evidence = extractEvidence(sources);
  const confidence = scoreRoute({
    text: normalized,
    sources,
    entities,
    claims,
    followUps,
    target: rawTarget,
    intent,
    hasFiles,
  });
  const gate = confidence >= 0.78
    ? "auto_route"
    : confidence >= 0.52
      ? "confirm_target"
      : "review_unassigned";
  const target = gate === "review_unassigned" ? "unassigned_buffer" : rawTarget;
  const needsConfirmation = gate !== "auto_route";
  const targetLabel = labelForTarget(target, activeContextLabel);

  return {
    intent,
    target,
    targetLabel,
    confidence,
    gate,
    needsConfirmation,
    reason: buildReason(intent, target, sources, entities),
    sources,
    entities,
    claims,
    followUps,
    evidence,
    ack: buildAck(target, targetLabel, needsConfirmation),
    nextActions: buildNextActions(intent, target, needsConfirmation),
  };
}

function inferIntent(
  text: string,
  mode: ProductComposerMode,
  hasFiles: boolean,
): CaptureIntent {
  if (mode === "task") return "create_followup";
  if (FOLLOW_UP_MARKERS.test(text)) return "create_followup";
  if (APPEND_MARKERS.test(text)) return "append_to_report";
  if (mode === "note") return "capture_field_note";
  if (/^\s*ask\b/i.test(text)) return "ask_question";
  if (mode === "ask" && EXPLORE_REQUEST_MARKERS.test(text) && (EVENT_MARKERS.test(text) || REPORT_MARKERS.test(text))) {
    return "expand_entity";
  }
  if (FIELD_NOTE_MARKERS.test(text) || hasFiles) return "capture_field_note";
  if (QUESTION_START.test(text) || text.includes("?")) {
    return REPORT_MARKERS.test(text) ? "expand_entity" : "ask_question";
  }
  if (REPORT_MARKERS.test(text)) return "expand_entity";
  return "capture_field_note";
}

function inferTarget(
  text: string,
  intent: CaptureIntent,
  activeContextLabel?: string | null,
): CaptureTarget {
  const context = activeContextLabel?.trim() ?? "";
  const looksLikeEventContext =
    EVENT_MARKERS.test(context) || /\b(demo|conference|event|summit|meetup)\b/i.test(context);
  const looksLikeEventCapture =
    /\b(?:met|talked to|spoke with)\s+[A-Z][A-Za-z.-]*(?:\s+[A-Z][A-Za-z.-]*)?\s+from\s+[A-Z]/i.test(text);

  if (EVENT_MARKERS.test(text) || looksLikeEventContext || looksLikeEventCapture) {
    return "active_event_session";
  }
  if (INBOX_MARKERS.test(text)) return "inbox_item";
  if (intent === "append_to_report" || REPORT_MARKERS.test(text)) {
    return "current_report";
  }
  if (context) return "current_report";
  return "unassigned_buffer";
}

function scoreRoute(args: {
  text: string;
  sources: ReadonlyArray<IntakeSource>;
  entities: ReadonlyArray<CaptureEntity>;
  claims: ReadonlyArray<CaptureClaim>;
  followUps: ReadonlyArray<CaptureFollowUp>;
  target: CaptureTarget;
  intent: CaptureIntent;
  hasFiles: boolean;
}) {
  if (!args.text && !args.hasFiles) return 0;
  let score = 0.38;
  if (args.sources.length > 0) score += 0.12;
  if (args.entities.length > 0) score += 0.18;
  if (args.claims.length > 0) score += 0.12;
  if (args.followUps.length > 0) score += 0.08;
  if (args.target !== "unassigned_buffer") score += 0.08;
  if (args.target === "active_event_session" && args.entities.length >= 2) score += 0.04;
  if (args.intent === "ask_question" || args.intent === "expand_entity") score += 0.04;
  if (args.text.length > 240) score += 0.04;
  return Math.min(0.96, Number(score.toFixed(2)));
}

function extractEntities(
  text: string,
  sources: ReadonlyArray<IntakeSource>,
  target: CaptureTarget,
): CaptureEntity[] {
  const entities: CaptureEntity[] = [];
  const seen = new Set<string>();
  const add = (name: string, type: CaptureEntityType, confidence: number) => {
    const cleaned = name.replace(/[.,:;!?]+$/g, "").trim();
    if (!cleaned || cleaned.length < 2) return;
    const key = `${type}:${cleaned.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push({ name: cleaned, type, confidence });
  };

  for (const source of sources) {
    if (source.kind === "linkedin_url" && source.slug) add(source.slug, "person", 0.72);
    if (source.kind === "github_url") {
      if (source.repo) add(source.repo, "product", 0.74);
      else if (source.owner) add(source.owner, "source", 0.68);
    }
    if ("host" in source && source.host) add(source.host, "source", 0.66);
    if ("fileName" in source) add(source.fileName, "source", 0.7);
  }

  const fromMatch = text.match(/\bfrom\s+([A-Z][A-Za-z0-9&-]*(?:\s+[A-Z][A-Za-z0-9&-]*){0,3})/);
  if (fromMatch) add(fromMatch[1], "company", 0.86);

  const metMatch = text.match(/\b(?:met|talked to|spoke with|coffee with)\s+([A-Z][A-Za-z.-]*(?:\s+(?!from\b)[A-Z][A-Za-z.-]*)?)/i);
  if (metMatch) add(metMatch[1], "person", 0.82);

  const capitalized = text.match(/\b[A-Z][A-Za-z0-9&-]*(?:\s+[A-Z][A-Za-z0-9&-]*){0,3}\b/g) ?? [];
  for (const phrase of capitalized) {
    const first = phrase.split(/\s+/)[0];
    if (ENTITY_STOPWORDS.has(first)) continue;
    if (COMPANY_SUFFIX.test(phrase)) {
      add(phrase, "company", 0.72);
    } else if (phrase.split(/\s+/).length <= 2 && target !== "active_event_session") {
      add(phrase, "company", 0.58);
    }
  }

  for (const market of ["healthcare", "legal tech", "voice agent", "AI infra", "developer tools", "sales", "education"]) {
    if (text.toLowerCase().includes(market)) {
      add(market, market.includes("agent") || market.includes("infra") ? "product" : "market", 0.7);
    }
  }

  return entities.slice(0, 8);
}

function extractClaims(
  text: string,
  entities: ReadonlyArray<CaptureEntity>,
): CaptureClaim[] {
  if (!text.trim()) return [];
  const chunks = text
    .split(/(?<=[.!?])\s+|;\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const claimy = chunks.filter((part) =>
    /\b(builds?|building|uses|wants|looking for|raised|seed|series|ARR|NRR|claims?|needs?|launched|ships?|competitor|risk|budget|hiring)\b/i.test(part),
  );
  if (claimy.length === 0 && entities.length >= 2) {
    const [first, second] = entities;
    return [{
      text: `${first.name} is related to ${second.name}`,
      confidence: 0.48,
      verificationStatus: "field_note",
    }];
  }
  return claimy.slice(0, 4).map((part) => ({
    text: part.replace(/^[-*]\s*/, ""),
    confidence: /\b(claims?|heard|said|mentioned)\b/i.test(part) ? 0.46 : 0.62,
    verificationStatus: /\b(verified|source|filing|article|press)\b/i.test(part)
      ? "needs_verification"
      : "field_note",
  }));
}

function extractFollowUps(
  text: string,
  intent: CaptureIntent,
  entities: ReadonlyArray<CaptureEntity>,
  target: CaptureTarget,
): CaptureFollowUp[] {
  const followUps: CaptureFollowUp[] = [];
  const normalized = text.toLowerCase();
  if (FOLLOW_UP_MARKERS.test(text) || intent === "create_followup") {
    followUps.push({
      text: text.replace(/^[-*]\s*/, "").slice(0, 160),
      priority: normalized.includes("urgent") || normalized.includes("tomorrow") ? "high" : "medium",
    });
  }
  if (normalized.includes("design partner") || normalized.includes("pilot")) {
    followUps.push({
      text: "Ask about pilot criteria and design-partner timeline",
      priority: "high",
    });
  }
  if (target === "active_event_session" && entities.some((entity) => entity.type === "person" || entity.type === "company")) {
    followUps.push({
      text: "Prioritize follow-up queue for this event",
      priority: "medium",
    });
  }
  return dedupeFollowUps(followUps).slice(0, 4);
}

function dedupeFollowUps(items: CaptureFollowUp[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractEvidence(sources: ReadonlyArray<IntakeSource>) {
  return sources
    .map((source) => {
      if ("url" in source) return source.url;
      if ("fileName" in source) return source.fileName;
      return "";
    })
    .filter(Boolean)
    .slice(0, 6);
}

function labelForTarget(target: CaptureTarget, activeContextLabel?: string | null) {
  if (target === "current_report") return activeContextLabel?.trim() || "current report";
  if (target === "active_event_session") return "active event session";
  if (target === "inbox_item") return "inbox item";
  return "unassigned capture review";
}

function buildReason(
  intent: CaptureIntent,
  target: CaptureTarget,
  sources: ReadonlyArray<IntakeSource>,
  entities: ReadonlyArray<CaptureEntity>,
) {
  const sourcePhrase = sources.length > 0 ? `${sources.length} source hint${sources.length === 1 ? "" : "s"}` : "plain text";
  const entityPhrase = entities.length > 0 ? `${entities.length} inferred entit${entities.length === 1 ? "y" : "ies"}` : "no strong entity";
  return `${labelForIntent(intent)} from ${sourcePhrase}; ${entityPhrase}; routed to ${labelForTarget(target)}.`;
}

function buildAck(target: CaptureTarget, targetLabel: string, needsConfirmation: boolean) {
  if (needsConfirmation) return `Needs confirmation before saving to ${targetLabel}.`;
  if (target === "unassigned_buffer") return "Saved to unassigned captures.";
  return `Saved to ${targetLabel}.`;
}

function buildNextActions(
  intent: CaptureIntent,
  target: CaptureTarget,
  needsConfirmation: boolean,
) {
  if (needsConfirmation) return ["Confirm target", "Move", "Discard"];
  if (intent === "ask_question" || intent === "expand_entity") return ["Open card", "Go deeper", "Verify"];
  if (intent === "create_followup") return ["Add follow-up", "Open queue", "Draft reply"];
  if (target === "active_event_session") return ["Edit", "Move", "Go deeper"];
  return ["Open card", "Attach to report", "Verify"];
}

function labelForIntent(intent: CaptureIntent) {
  switch (intent) {
    case "capture_field_note":
      return "field note";
    case "ask_question":
      return "question";
    case "append_to_report":
      return "report append";
    case "create_followup":
      return "follow-up";
    case "expand_entity":
      return "entity expansion";
  }
}
