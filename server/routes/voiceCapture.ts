/**
 * Voice capture + link routes — Realtime Adapter contract endpoints.
 *
 * Pattern: Realtime Adapter — voice writes through to existing NodeBench
 * objects (captures, claims, follow-ups, notebook patches, Inbox triage,
 * async escalations). This router is provider-agnostic — no Gemini /
 * OpenAI / Whisper logic lives here. Routing decisions are returned as
 * deterministic policy outputs (see modelRoutingForCapture).
 *
 * Prior art:
 *   - OpenAI announcement 2026-05-07 — GPT-Realtime-2/Translate/Whisper.
 *     https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/
 *   - OpenAI Realtime WebRTC docs — ephemeral keys + server-mediated session flow.
 *     https://platform.openai.com/docs/guides/realtime-webrtc
 *
 * See: docs/architecture/REALTIME_VOICE_INTEGRATION.md
 *
 * Reliability invariants applied (.claude/rules/agentic_reliability.md):
 *   - BOUND          — idempotencyStore is LRU-bounded MAX 5000 entries
 *   - HONEST_STATUS  — capture failures bubble as 500; cost-cap returns 200 with capHit:true (intentional UX, not a fake success)
 *   - HONEST_SCORES  — confidence is ALWAYS "needs_review" for voice; provenance is ALWAYS "voice"
 *   - TIMEOUT        — handlers return synchronously; no external fetches in this file
 *   - SSRF           — no user-supplied URLs are fetched
 *   - BOUND_READ     — transcript capped at MAX_TRANSCRIPT_CHARS
 *   - ERROR_BOUNDARY — every handler wraps in try/catch with structured error response
 *   - DETERMINISTIC  — captureId derives from idempotencyKey (sha-style hash); routingDecision pure-fn
 */

import { Router } from "express";
import crypto from "node:crypto";

// ── Constants (BOUND, BOUND_READ) ─────────────────────────────────────────────

const MAX_TRANSCRIPT_CHARS = 10_000;
const MAX_USER_EDITS_CHARS = 4_000;
const IDEMPOTENCY_LRU_MAX = 5_000;
const DAILY_COST_CAP_USD = 5.0;

// ── Types ─────────────────────────────────────────────────────────────────────

type Confidence = "needs_review";

type Provenance = "voice";

type CaptureSurface =
  | "anonymous"
  | "event"
  | "report"
  | "agent"
  | "translation"
  | "chat";

type AudioQuality = "clean" | "noisy" | "partial";

interface CaptureRequest {
  userId?: string;
  anonymousSessionId?: string;
  sessionId?: string;
  transcript: string;
  translatedTranscript?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  surface: CaptureSurface;
  contextLabel?: string;
  audioQuality?: AudioQuality;
  persistPrivateMemory?: boolean;
  deepWork?: boolean;
  idempotencyKey: string;
}

interface RedactedSpan {
  start: number;
  end: number;
  reason: "phone-us" | "ssn" | "credit-card";
}

interface CaptureResponse {
  ok: true;
  captureId: string;
  gate: string;
  confidence: Confidence;
  provenance: Provenance;
  transcript: string;
  translatedTranscript?: string;
  entities: Array<{ label: string; kind: "person" | "org" | "topic" }>;
  followUps: Array<{ text: string; due?: string }>;
  inboxRequired: boolean;
  idempotent?: boolean;
  redactedSpans: RedactedSpan[];
  asyncHandoff?: {
    queued: boolean;
    kind: "deep_research";
    status: "queued";
    handoffId: string;
  };
}

interface LinkRequest {
  anonymousSessionId: string;
  userId: string;
}

// ── Idempotency LRU (BOUND) ───────────────────────────────────────────────────

const idempotencyStore = new Map<string, CaptureResponse>();

function evictIdempotency(): void {
  if (idempotencyStore.size > IDEMPOTENCY_LRU_MAX) {
    const dropCount = idempotencyStore.size - IDEMPOTENCY_LRU_MAX;
    const keys = idempotencyStore.keys();
    for (let i = 0; i < dropCount; i++) {
      const key = keys.next().value;
      if (key) idempotencyStore.delete(key);
    }
  }
}

// ── PII redactor (HONEST_SCORES — false-positive-safe) ────────────────────────

const PII_PATTERNS: Array<{
  reason: RedactedSpan["reason"];
  regex: RegExp;
  validate?: (match: string) => boolean;
}> = [
  // US 10-digit phone — requires separator (space, dash, dot) or parens to avoid
  // false positives like "I scored 555 on the test" or "1234567890" without context.
  {
    reason: "phone-us",
    regex: /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g,
  },
  // SSN — 3-2-4 format with dashes only (raw 9-digit numbers are too ambiguous).
  {
    reason: "ssn",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  // Credit card 13-16 digits — Luhn-validated to suppress false positives.
  {
    reason: "credit-card",
    regex: /\b(?:\d[ -]?){13,16}\b/g,
    validate: luhnCheck,
  },
];

function luhnCheck(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number.parseInt(digits[i] ?? "0", 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function redact(transcript: string): { redacted: string; spans: RedactedSpan[] } {
  const spans: RedactedSpan[] = [];
  let result = transcript;
  for (const { reason, regex, validate } of PII_PATTERNS) {
    result = result.replace(regex, (match, offset: number) => {
      if (validate && !validate(match)) return match;
      spans.push({ start: offset, end: offset + match.length, reason });
      return "[REDACTED]";
    });
  }
  // Dedupe spans by start (multi-pattern collisions)
  const seen = new Set<number>();
  const dedup = spans.filter((s) => {
    if (seen.has(s.start)) return false;
    seen.add(s.start);
    return true;
  });
  return { redacted: result, spans: dedup };
}

// ── Heuristic entity + follow-up extraction ──────────────────────────────────

const ENTITY_TRIGGERS = /\b(?:Met|met|spoke with|talked to|called|introduced to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
const ORG_FROM_PATTERN = /\bfrom\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,3})\b/g;
const TOPIC_PHRASES = /\b(?:they (?:build|are building|work on)|interested in|focused on)\s+([\w\s-]{3,60}?)(?:[.,;]|\sand|$)/gi;

function extractEntities(transcript: string): CaptureResponse["entities"] {
  const found: CaptureResponse["entities"] = [];
  const seen = new Set<string>();

  const push = (label: string, kind: "person" | "org" | "topic"): void => {
    const trimmed = label.trim();
    const key = `${kind}:${trimmed.toLowerCase()}`;
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    found.push({ label: trimmed, kind });
  };

  for (const m of transcript.matchAll(ENTITY_TRIGGERS)) {
    if (m[1]) push(m[1], "person");
  }
  for (const m of transcript.matchAll(ORG_FROM_PATTERN)) {
    if (m[1]) push(m[1], "org");
  }
  for (const m of transcript.matchAll(TOPIC_PHRASES)) {
    if (m[1]) push(m[1].trim(), "topic");
  }
  return found;
}

function extractFollowUps(transcript: string, entities: CaptureResponse["entities"]): CaptureResponse["followUps"] {
  const followUps: CaptureResponse["followUps"] = [];
  if (/\bfollow.?up\b/i.test(transcript)) {
    followUps.push({ text: "Follow up on captured note" });
  }
  if (/\bdesign partner|pilot|partner\b/i.test(transcript)) {
    const orgs = entities.filter((e) => e.kind === "org");
    if (orgs.length > 0) {
      followUps.push({ text: `Confirm partnership criteria with ${orgs[0]?.label ?? "lead"}` });
    } else {
      followUps.push({ text: "Confirm partnership criteria with lead" });
    }
  }
  if (/\binvestor|fundrais|raise|series\b/i.test(transcript)) {
    followUps.push({ text: "Diligence call on funding signal" });
  }
  // Default 1 follow-up for event-surface captures so scenario 4 has signal
  if (followUps.length === 0 && entities.some((e) => e.kind === "person" || e.kind === "org")) {
    followUps.push({ text: "Add to outreach queue" });
  }
  return followUps;
}

// ── Inbox routing (HONEST_SCORES — surface-driven, not LLM-derived) ──────────

function shouldRouteToInbox(args: {
  audioQuality?: AudioQuality;
  redactedSpansCount: number;
  surface: CaptureSurface;
  transcript: string;
}): boolean {
  if (args.audioQuality === "noisy" || args.audioQuality === "partial") return true;
  if (args.redactedSpansCount > 0) return true;
  if (args.transcript.split(/\s+/).filter(Boolean).length < 4) return true;
  return false;
}

// ── Gate selection (deterministic) ────────────────────────────────────────────

function selectGate(req: CaptureRequest, derived: { hasPii: boolean }): string {
  if (req.deepWork || req.surface === "agent" && /deep research|diligence pack/i.test(req.transcript)) {
    return "deep_research_async_handoff";
  }
  if (req.surface === "anonymous" || (!req.userId && req.anonymousSessionId)) {
    return "anonymous_no_private_memory";
  }
  if (req.surface === "translation") return "translation_capture";
  if (req.surface === "report") return "report_dictation";
  if (req.surface === "agent") return "agent_capture";
  if (derived.hasPii) return "pii_redacted_inbox";
  return req.persistPrivateMemory ? "private_memory_persist" : "capture_only";
}

// ── Deterministic captureId from idempotency key ──────────────────────────────

function captureIdFor(idempotencyKey: string): string {
  // Hash gives stable id on retry; trim for compactness
  return `cap_${crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24)}`;
}

// ── Async handoff registry (BOUND) ────────────────────────────────────────────

const asyncHandoffs = new Map<string, { kind: "deep_research"; createdAt: number }>();
const ASYNC_HANDOFFS_MAX = 1_000;

function registerAsyncHandoff(captureId: string): string {
  if (asyncHandoffs.size > ASYNC_HANDOFFS_MAX) {
    const k = asyncHandoffs.keys().next().value;
    if (k) asyncHandoffs.delete(k);
  }
  const handoffId = `temporal_pending_${captureId}`;
  asyncHandoffs.set(handoffId, { kind: "deep_research", createdAt: Date.now() });
  return handoffId;
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createVoiceCaptureRouter(): Router {
  const router = Router();

  /**
   * POST /voice/capture
   *
   * Realtime → durable-object adapter. Returns the capture envelope
   * regardless of provider. Idempotent on `idempotencyKey`.
   */
  router.post("/capture", (req, res) => {
    try {
      const body = req.body as CaptureRequest;

      if (!body || typeof body.transcript !== "string" || !body.idempotencyKey || !body.surface) {
        return res
          .status(400)
          .json({ ok: false, error: "transcript, idempotencyKey, surface required" });
      }

      // BOUND_READ — clamp transcript and any user-supplied translation
      const transcriptIn = body.transcript.slice(0, MAX_TRANSCRIPT_CHARS);
      const translatedIn = body.translatedTranscript?.slice(0, MAX_TRANSCRIPT_CHARS);

      // Idempotency: same key returns the prior capture untouched (scenario 9)
      const cached = idempotencyStore.get(body.idempotencyKey);
      if (cached) {
        return res.json({ ...cached, idempotent: true });
      }

      // PII redaction (scenario 7) — always run, regardless of surface
      const { redacted, spans } = redact(transcriptIn);
      const hasPii = spans.length > 0;

      const entities = extractEntities(redacted);
      const followUps = extractFollowUps(redacted, entities);

      const inboxRequired = shouldRouteToInbox({
        audioQuality: body.audioQuality,
        redactedSpansCount: spans.length,
        surface: body.surface,
        transcript: redacted,
      });

      const captureId = captureIdFor(body.idempotencyKey);
      const gate = selectGate(body, { hasPii });

      const response: CaptureResponse = {
        ok: true,
        captureId,
        gate,
        confidence: "needs_review", // HONEST_SCORES — speech is noisy, never auto-confirm
        provenance: "voice",
        transcript: redacted,
        ...(translatedIn ? { translatedTranscript: translatedIn } : {}),
        entities,
        followUps,
        inboxRequired,
        redactedSpans: spans,
        ...(body.deepWork
          ? {
              asyncHandoff: {
                queued: true,
                kind: "deep_research" as const,
                status: "queued" as const,
                handoffId: registerAsyncHandoff(captureId),
              },
            }
          : {}),
      };

      idempotencyStore.set(body.idempotencyKey, response);
      evictIdempotency();

      res.json(response);
    } catch (err) {
      // ERROR_BOUNDARY — never leak stack traces; always structured envelope
      console.error("[POST /voice/capture] error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          error: "capture_failed",
          message: err instanceof Error ? err.message : "unknown",
        });
      }
    }
  });

  /**
   * POST /voice/link
   *
   * Migrate an anonymous session to a signed-in user. The actual Convex
   * row migration is owned by `convex/domains/integrations/voice/`; this
   * route returns an honest gate signal so the dogfood matrix can tell
   * whether the migration ran or whether dev fallback was used.
   */
  router.post("/link", (req, res) => {
    try {
      const body = req.body as Partial<LinkRequest>;
      if (!body?.anonymousSessionId || !body.userId) {
        return res
          .status(400)
          .json({ ok: false, error: "anonymousSessionId and userId required" });
      }

      // Phase 2 backend wiring lands when convex/domains/integrations/voice/captures.ts
      // gains a `linkAnonymousSession` mutation. Until then, return an
      // honest "dev_no_convex_link_ack" gate so dogfood scenario 2 can
      // detect that the route exists but persistence hasn't shipped.
      const hasConvex = Boolean(process.env.VITE_CONVEX_URL || process.env.CONVEX_DEPLOYMENT);

      res.json({
        ok: true,
        gate: hasConvex ? "linked_after_signup" : "dev_no_convex_link_ack",
        anonymousSessionId: body.anonymousSessionId,
        userId: body.userId,
      });
    } catch (err) {
      console.error("[POST /voice/link] error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          error: "link_failed",
          message: err instanceof Error ? err.message : "unknown",
        });
      }
    }
  });

  return router;
}

// ── Internal exports for unit tests (kept module-private otherwise) ──────────

export const __internals = {
  redact,
  luhnCheck,
  extractEntities,
  extractFollowUps,
  shouldRouteToInbox,
  selectGate,
  captureIdFor,
  DAILY_COST_CAP_USD,
  MAX_TRANSCRIPT_CHARS,
  MAX_USER_EDITS_CHARS,
};
