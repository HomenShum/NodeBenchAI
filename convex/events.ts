/**
 * convex/events.ts — Phase 1 of the scratchnode.live live prod plan
 *
 * Anonymous shared chat for event rooms. No auth — visitors send a
 * `sessionId` from `localStorage` and that's their identity.
 *
 * Public API surface (called from public/proto/home-v5.html):
 *   - getEventBySlug({ slug })
 *   - getMessages({ eventId, limit? })            // realtime subscription
 *   - getMembers({ eventId })                     // realtime subscription
 *   - getMyEvents({ sessionId, ownerKey, limit? }) // lightweight account/event state
 *   - createEvent({ title, sessionId, displayName, ... }) // creates live room + host token
 *   - joinEvent({ slug, sessionId, displayName }) // returns { eventId, ... }
 *   - sendMessage({ eventId, sessionId, displayName, text, kind, replyToMessageId? })
 *   - heartbeat({ eventId, sessionId })
 *   - ensureDemoEvent()                            // dev/explicit demo seed only
 *
 * Privacy invariants (release-blocker, per docs.html):
 *   - This file only handles PUBLIC chat. Private notes will be a separate
 *     table (Phase 3). Never accept a "kind: private" here.
 *   - displayName is snapshotted at send time — renames don't rewrite history.
 *
 * Reliability (per .claude/rules/agentic_reliability.md):
 *   - BOUND: getMessages limit defaults to 200, max 500
 *   - HONEST_STATUS: throws ConvexError on missing event, no fake 200
 *   - TIMEOUT: Convex functions have a 1s mutation / 10s query budget by default
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { enforceRateLimit } from "./scratchnodeRateLimit";
import { routeLLM, askAnswerSignals } from "../shared/llm/router";
import { rerankWithGemini, condenseQuery, type TriCandidate } from "../shared/search/triSearch";

class ConvexError<T extends Record<string, unknown>> extends Error {
  data: T;

  constructor(data: T) {
    super(String(data.message ?? JSON.stringify(data)));
    this.name = "ConvexError";
    this.data = data;
    (this as Record<PropertyKey, unknown>)[Symbol.for("ConvexError")] = true;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────
const MAX_DISPLAY_NAME = 40;
const MAX_MESSAGE_TEXT = 4000;
const MAX_EVENT_NAME = 90;
const MAX_EVENT_SLUG = 80;
const MAX_EVENT_CONTEXT = 2_000;
const DEFAULT_MESSAGE_LIMIT = 200;
const MAX_MESSAGE_LIMIT = 500;
const PRESENCE_TTL_MS = 5 * 60 * 1000; // 5 min
// Phase 4 defense-in-depth: after this window, an unredeemed host-claim-code
// hash is force-cleared by the janitor cron. Codes are ~120 bits of entropy
// already; this just narrows the brute-force window further. Cutoff is
// deliberately wider than the UI expiresHintAt (also 30 min) so that a slow
// human still completes their claim — the janitor only sweeps abandoned
// codes, never racing the redemption path.
const HOST_CLAIM_CODE_TTL_MS = 30 * 60 * 1000; // 30 min
// BOUND: cap per-run evictions so the janitor never thunders the DB.
const MAX_STALE_HOST_CLAIM_EVICT = 100;
const MAX_SOURCE_BODY = 12_000;
const MAX_ANSWER_BODY = 4_000;
// Dedicated /ask rate-limit (Finding #3). A sourced /ask is FAR more expensive
// than a chat send: it scans the corpus, reranks, and calls a provider (~0.36¢
// each). `send:<session>` (30/min) bounds chat flood but not provider cost, so a
// single attendee could trigger 30 provider calls/min. 12/min/session stays well
// above genuine human Q&A cadence while capping worst-case spend to ~4.3¢/min/session.
const ASK_RATE_LIMIT_PER_MIN = 12;
const ASK_RATE_WINDOW_MS = 60_000;
const MAX_ANSWER_LIMIT = 100;
const MAX_MY_EVENTS_LIMIT = 50;
const MAX_WIKI_ANSWERS = 20;
// Phase 4 raised this from 80 -> 120 to fit HMAC-signed host tokens
// (hk1:<eventIdShort>:<nonce>:<issuedAt>:<hmacShort> ~ 80-90 chars).
// 120 is still tight enough to reject obvious junk.
const MAX_OWNER_KEY_LEN = 120;
const MAX_AGENT_CONTEXT_SOURCES = 6;
const MAX_AGENT_CONTEXT_CHARS = 9_000;
const MAX_LINKUP_SOURCES = 4;
// /ask model selection lives in shared/llm/router.ts — the ask_answer pool
// (Haiku floor; escalates to Sonnet on long / analytical / multi-entity Qs).
// Legacy SCRATCHNODE_ASK_MODEL still force-pins for ops; the pool floor defaults
// to the exact prior Haiku id so an unset env is behavior-preserving.

// Phase 4 follow-up Item 1: optional email channel for claim codes.
// Validation kept basic on purpose — Resend re-validates server-side, and
// the regex is meant to catch *obviously* malformed input (missing @,
// missing dot, oversized strings) before we even schedule the action.
// MAX_EMAIL_LEN matches RFC 5321 (SMTP path length).
const MAX_EMAIL_LEN = 254;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isLikelyValidEmail = (value: string | undefined): value is string => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_EMAIL_LEN) return false;
  return EMAIL_REGEX.test(trimmed);
};

const DEMO_SOURCES = [
  {
    uri: "transcript://ai-infra-summit-2026/mcp-auth-panel",
    kind: "transcript" as const,
    title: "MCP auth panel transcript",
    excerpt: "Panelists agreed that scoped credentials, audit trails, and revocation UX are the gating items for enterprise MCP adoption.",
    body: "MCP auth timeline: teams are moving from static API keys toward scoped, revocable credentials, delegated OAuth-style flows, and visible audit trails. The key adoption concern is not tool count, it is whether every agent action can be traced to a person, policy, source, and approval state. Enterprise buyers asked for admin dashboards, session revocation, and least-privilege tool profiles before broad rollout.",
  },
  {
    uri: "doc://ai-infra-summit-2026/voice-agent-eval-notes",
    kind: "doc" as const,
    title: "Voice-agent evaluation notes",
    excerpt: "Voice agents need evaluation on latency, interruption handling, hallucinated actions, and handoff quality, not only transcript accuracy.",
    body: "Voice-agent evaluation: attendees compared latency, barge-in handling, transcription quality, hallucinated tool calls, escalation to humans, and post-call summary faithfulness. The strongest recurring point was that voice agents fail in edge cases where a user interrupts, changes intent, or asks for an action that needs approval.",
  },
  {
    uri: "slide://ai-infra-summit-2026/healthcare-pilots",
    kind: "slide" as const,
    title: "Healthcare workflow pilot slide",
    excerpt: "Healthcare pilots clustered around intake, clinical note preparation, payer admin, and compliance-heavy review workflows.",
    body: "Healthcare pilots: the session separated low-risk workflow automation from clinical decision support. Good first deployments include intake routing, clinical note preparation, prior-authorization packet assembly, and quality review. Buyers asked for HIPAA boundaries, source retention, and human approval before any patient-impacting write.",
  },
  {
    uri: "url://ai-infra-summit-2026/orbital-labs-demo",
    kind: "url" as const,
    title: "Orbital Labs demo brief",
    excerpt: "Orbital Labs positioned its eval layer as a way to compare agent behavior across tools, memories, and approval policies.",
    body: "Orbital Labs demo: the company framed agent evaluation as a runtime problem across tools, memory, policies, and approvals. The team showed comparison dashboards for tool-call failure, answer grounding, and human correction loops. The market implication is that eval moves closer to operations and workflow governance.",
  },
  {
    uri: "doc://ai-infra-summit-2026/event-wiki-policy",
    kind: "doc" as const,
    title: "Event wiki privacy policy",
    excerpt: "Public wiki compaction may use public chat, public answers, and host-uploaded sources, but never private attendee notes.",
    body: "Event wiki policy: only public chat messages, public sourced answers, host-uploaded sources, and host-promoted FAQ entries may enter the durable wiki. Private notes, private asks, and attendee-local drafts are excluded from compaction and from answer caches. The trace should explicitly say when private notes were not used.",
  },
];

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const normalizeQuestion = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);

const normalizeEventTitle = (value: string) =>
  (value || "").replace(/\s+/g, " ").trim().slice(0, MAX_EVENT_NAME);

const slugifyEventTitle = (value: string): string => {
  const base = normalizeEventTitle(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_EVENT_SLUG)
    .replace(/-+$/g, "");
  return base || "event";
};

const normalizeRequestedSlug = (value: string | undefined, title: string): string => {
  const raw = (value || "").trim();
  return slugifyEventTitle(raw || title);
};

const normalizeRequestedRoomCode = (value: string | undefined): string | null => {
  const raw = (value || "").trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "");
  if (!raw) return null;
  return raw.slice(0, 24);
};

const tokenize = (value: string) =>
  new Set(normalizeQuestion(value).split(" ").filter((token) => token.length > 2));

const scoreSource = (question: string, source: { title: string; excerpt: string; body: string }) => {
  const qTokens = tokenize(question);
  const haystack = tokenize(`${source.title} ${source.excerpt} ${source.body}`);
  let overlap = 0;
  for (const token of qTokens) {
    if (haystack.has(token)) overlap += 1;
  }
  return overlap + (source.title.toLowerCase().includes(question.toLowerCase()) ? 3 : 0);
};

const requireOwnerKey = (ownerKey: string) => {
  if (!ownerKey || ownerKey.length < 8 || ownerKey.length > MAX_OWNER_KEY_LEN) {
    throw new ConvexError({
      code: "invalid_owner_key",
      message: `ownerKey must be 8-${MAX_OWNER_KEY_LEN} chars.`,
    });
  }
};

// ─── Phase 4 real-auth: claim-code + HMAC-signed ownerKey ─────────────────
//
// SECURITY MODEL
//   The Phase 1-3 ownerKey was chosen by the client (any 8+ char string).
//   That was structurally enforced (only one owner per event) but did NOT
//   prove identity — anyone could call claimHost first and become owner.
//
//   Phase 4 closes the gap with a two-step proof-of-possession flow:
//     1. requestHostClaim — server generates a 24-char random code, stores
//        SHA-256(eventId|code) on the event, returns the plaintext code
//        ONCE. Only callable by a member; when a real-auth host already
//        holds the event, rotation requires the existing token.
//     2. claimHostWithCode — client submits the plaintext code. Server
//        re-hashes and constant-time compares against the stored hash.
//        On match, server generates an HMAC-signed ownerKey and persists
//        the host row with authMethod=claim_code. Returns the signed
//        token, which the client must persist (it is the new ownerKey).
//     3. requireHost — accepts both formats. Plain ownerKeys match by
//        DB lookup (Phase 1-3 back-compat). HMAC tokens are
//        cryptographically verified, then confirmed by DB row lookup
//        so revoked hosts are caught even if the token is still
//        cryptographically valid.
//
// PRIOR ART
//   - GitHub/Linear/Notion: server-issued bearer tokens
//   - JWT-lite: HMAC-signed self-contained tokens
//   - PagerDuty/Datadog: one-time codes for first-claim flows
//
// SCRATCHNODE_HOST_TOKEN_SECRET
//   Set via Convex env (`npx convex env set SCRATCHNODE_HOST_TOKEN_SECRET
//   <random>`). Falls back to a dev-only deterministic value when running
//   on a non-prod deployment (CONVEX_DEPLOYMENT starts with "dev:"). In
//   production with no secret set, getHostAuthSecret throws — better to
//   fail closed than silently issue forgeable tokens.
// ─────────────────────────────────────────────────────────────────────────

const HOST_AUTH_SECRET_DEV_FALLBACK =
  "scratchnode-dev-only-host-auth-fallback-do-not-use-in-prod-aaaaaaaaaaaaaa";

const HOST_CLAIM_CODE_LEN = 24; // 24 chars from a 32-symbol alphabet ≈ 120 bits entropy
const HOST_TOKEN_PREFIX = "hk1:";
const HOST_TOKEN_NONCE_LEN = 16; // 16 chars ≈ 95 bits entropy on the nonce alone

const getHostAuthSecret = (): string => {
  const fromEnv = (globalThis as any)?.process?.env?.SCRATCHNODE_HOST_TOKEN_SECRET;
  const deployment = (globalThis as any)?.process?.env?.CONVEX_DEPLOYMENT;
  if (typeof fromEnv === "string" && fromEnv.length >= 32) return fromEnv;
  // Allow dev fallback ONLY when explicitly running on a dev: deployment.
  if (typeof deployment === "string" && deployment.startsWith("dev:")) {
    return HOST_AUTH_SECRET_DEV_FALLBACK;
  }
  // In production with no secret set, refuse to operate — better to fail
  // closed than silently issue forgeable tokens.
  throw new ConvexError({
    code: "host_auth_secret_missing",
    message:
      "SCRATCHNODE_HOST_TOKEN_SECRET env var required. Run: npx convex env set SCRATCHNODE_HOST_TOKEN_SECRET <random-32+-char-string>",
  });
};

const canSeedDemoEvent = (): boolean => {
  const allow = (globalThis as any)?.process?.env?.SCRATCHNODE_ALLOW_DEMO_SEED;
  const deployment = (globalThis as any)?.process?.env?.CONVEX_DEPLOYMENT;
  return allow === "1" || (typeof deployment === "string" && deployment.startsWith("dev:"));
};

// Convex runtime exposes Web Crypto (`crypto.subtle`) and
// `crypto.getRandomValues` for cryptographic operations. Same APIs used
// in convex/domains/agents/receipts/actionReceipts.ts.
const randomString = (len: number, alphabet: string): string => {
  const buf = new Uint8Array(len);
  (globalThis as any).crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += alphabet.charAt(buf[i] % alphabet.length);
  }
  return out;
};

const generateClaimCode = (): string => {
  // Avoid ambiguous chars (0/O/I/1) so users can read+type the code
  // from a screen accurately.
  return randomString(HOST_CLAIM_CODE_LEN, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
};

const generateNonce = (): string => {
  return randomString(HOST_TOKEN_NONCE_LEN, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789");
};

const sha256Hex = async (input: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await (globalThis as any).crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(hashBuffer));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
};

const hmacSha256Hex = async (secret: string, message: string): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await (globalThis as any).crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await (globalThis as any).crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message),
  );
  const bytes = Array.from(new Uint8Array(sig));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
};

// Constant-time string compare — prevents timing side channels on
// the hmac/hash equality check.
const constantTimeEquals = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

const buildHmacPayload = (eventIdShort: string, nonce: string, issuedAt: number) =>
  `${eventIdShort}|${nonce}|${issuedAt}`;

const issueHostToken = async (eventId: string, issuedAt: number): Promise<string> => {
  // Use a stable short prefix of the eventId so the token self-identifies
  // the event without needing a separate field.
  const eventIdShort = eventId.slice(0, 16);
  const nonce = generateNonce();
  const secret = getHostAuthSecret();
  const hmac = await hmacSha256Hex(secret, buildHmacPayload(eventIdShort, nonce, issuedAt));
  // Truncate hmac to 32 hex chars (128 bits) — keeps tokens under 120 chars
  // (MAX_OWNER_KEY_LEN) while remaining infeasible to brute force.
  const hmacShort = hmac.slice(0, 32);
  return `${HOST_TOKEN_PREFIX}${eventIdShort}:${nonce}:${issuedAt}:${hmacShort}`;
};

// Returns true iff the ownerKey is a well-formed HMAC token AND its
// signature verifies under SCRATCHNODE_HOST_TOKEN_SECRET AND its eventId
// prefix matches the provided event. Does NOT check DB for host row
// existence — that's the caller's job (so revoked hosts are caught).
const verifyHostToken = async (
  ownerKey: string,
  eventId: string,
): Promise<boolean> => {
  if (!ownerKey.startsWith(HOST_TOKEN_PREFIX)) return false;
  const body = ownerKey.slice(HOST_TOKEN_PREFIX.length);
  const parts = body.split(":");
  // Convex ids contain ":" (for example "liveEvents:123"), so parse the
  // token from the right instead of assuming exactly four colon-separated
  // segments.
  if (parts.length < 4) return false;
  const hmacShort = parts.pop() || "";
  const issuedAtStr = parts.pop() || "";
  const nonce = parts.pop() || "";
  const eventIdShort = parts.join(":");
  if (!eventIdShort || !nonce || !issuedAtStr || !hmacShort) return false;
  if (eventIdShort !== eventId.slice(0, 16)) return false;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return false;
  // Reject tokens dated in the future (> 60s skew) or impossibly old
  // (> 365 days) — the latter catches stale tokens after secret rotation.
  const now = Date.now();
  if (issuedAt > now + 60_000) return false;
  if (issuedAt < now - 365 * 24 * 60 * 60 * 1000) return false;
  const secret = getHostAuthSecret();
  const expectedHmac = (
    await hmacSha256Hex(secret, buildHmacPayload(eventIdShort, nonce, issuedAt))
  ).slice(0, 32);
  return constantTimeEquals(hmacShort, expectedHmac);
};

const ensureDemoSourcesForEvent = async (ctx: any, eventId: any) => {
  const now = Date.now();
  let inserted = 0;
  for (const source of DEMO_SOURCES) {
    const existing = await ctx.db
      .query("liveEventSources")
      .withIndex("by_event_uri", (q: any) => q.eq("eventId", eventId).eq("uri", source.uri))
      .first();
    if (existing) continue;
    await ctx.db.insert("liveEventSources", {
      eventId,
      uri: source.uri,
      kind: source.kind,
      title: source.title,
      excerpt: source.excerpt,
      body: source.body.slice(0, MAX_SOURCE_BODY),
      sourceHash: stableHash(`${source.uri}|${source.body}`),
      isSeeded: true,
      uploadedAt: now,
    });
    inserted += 1;
  }
  return inserted;
};

const requireMember = async (ctx: any, eventId: any, sessionId: string) => {
  if (!sessionId || sessionId.length < 8) {
    throw new ConvexError({
      code: "invalid_session",
      message: "Must join the event first.",
    });
  }
  const member = await ctx.db
    .query("liveEventMembers")
    .withIndex("by_event_session", (q: any) =>
      q.eq("eventId", eventId).eq("sessionId", sessionId),
    )
    .first();
  if (!member) {
    throw new ConvexError({
      code: "not_joined",
      message: "Call joinEvent before using this event.",
    });
  }
  return member;
};

// Verifies the caller is a registered host for this event.
//
// Phase 4: accepts both formats —
//   1. HMAC token (hk1:...): cryptographically verified under
//      SCRATCHNODE_HOST_TOKEN_SECRET first (cheap, no DB read), then
//      confirmed by a liveEventHosts row lookup (so revoked hosts are
//      caught even if their token is still cryptographically valid).
//   2. Legacy plain ownerKey: must match an existing liveEventHosts
//      row (authMethod=legacy_ownerkey). Authentication = "you possess
//      the ownerKey that was registered". Acceptable for back-compat
//      ONLY — the legacy claimHost path is being phased out.
//
// In both cases the function returns the liveEventHosts row so callers
// can record createdByOwnerKey, etc.
const requireHost = async (ctx: any, eventId: any, ownerKey: string) => {
  requireOwnerKey(ownerKey);
  // Path 1: HMAC token. Verify signature first (cheap, no DB read), then
  // confirm row exists (catches revocations / db cleanups).
  if (ownerKey.startsWith(HOST_TOKEN_PREFIX)) {
    const valid = await verifyHostToken(ownerKey, eventId);
    if (!valid) {
      throw new ConvexError({
        code: "not_host",
        message: "Host token failed verification.",
      });
    }
    const host = await ctx.db
      .query("liveEventHosts")
      .withIndex("by_event_owner", (q: any) => q.eq("eventId", eventId).eq("ownerKey", ownerKey))
      .first();
    if (!host) {
      throw new ConvexError({
        code: "not_host",
        message: "Host record revoked or not found.",
      });
    }
    return host;
  }
  // Path 2: legacy ownerKey. Match against row directly.
  const host = await ctx.db
    .query("liveEventHosts")
    .withIndex("by_event_owner", (q: any) => q.eq("eventId", eventId).eq("ownerKey", ownerKey))
    .first();
  if (!host) {
    throw new ConvexError({
      code: "not_host",
      message: "Host ownership is required for this action.",
    });
  }
  return host;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function synthesizeAnswer(
  question: string,
  eventName: string,
  sources: Array<{ title: string; excerpt: string; body: string }>,
) {
  const evidence = sources
    .map((source, index) => {
      const sentence = (source.excerpt || source.body || "").split(/[.!?]/)[0]?.trim();
      return `${index + 1}. ${source.title}: ${sentence || "Relevant event source."}.`;
    })
    .join("\n");
  const top = sources[0];
  return [
    `The strongest sourced read from ${eventName} is that ${top.excerpt || top.title}.`,
    "",
    "Evidence used:",
    evidence,
    "",
    `What to do next: treat this as a public-event answer, then open the cited sources or ask a narrower follow-up before using it as a final decision record.`,
    `Question answered: ${question}`,
  ].join("\n");
}

function shouldProbeLiveSearch(question: string, ranked: Array<{ score: number }>) {
  const q = question.toLowerCase();
  const freshnessIntent = /\b(today|latest|recent|this week|this month|2026|now|new|announced|raised|launched)\b/.test(q);
  const weakCorpusMatch = ranked.length === 0 || (ranked[0]?.score ?? 0) <= 1;
  return freshnessIntent || weakCorpusMatch;
}

function boundedContextText(sources: Array<{ title: string; excerpt: string; body: string; uri?: string }>) {
  let remaining = MAX_AGENT_CONTEXT_CHARS;
  return sources.slice(0, MAX_AGENT_CONTEXT_SOURCES).map((source, index) => {
    const raw = `${source.excerpt || ""}\n${source.body || ""}`.trim();
    const body = raw.slice(0, Math.max(0, remaining));
    remaining -= body.length;
    return [
      `[${index + 1}] ${source.title}`,
      `URI: ${source.uri || "event-source"}`,
      body,
    ].join("\n");
  }).join("\n\n---\n\n");
}

function estimateTokens(input: string) {
  return Math.ceil((input || "").length / 4);
}

function estimateAnthropicCostCents(inputTokens: number, outputTokens: number, modelId: string) {
  // Conservative planning rates per 1M tokens. Actual billing is provider-side.
  const fast = modelId.includes("haiku");
  const inputPer1M = fast ? 1 : 3;
  const outputPer1M = fast ? 5 : 15;
  return Number((((inputTokens / 1_000_000) * inputPer1M + (outputTokens / 1_000_000) * outputPer1M) * 100).toFixed(4));
}

function evaluateAnswerQuality(args: {
  question: string;
  body: string;
  sourceCount: number;
  traceSteps: string[];
}) {
  const checks: Array<{ name: string; status: "pass" | "warn" | "fail"; detail?: string }> = [];
  const body = args.body || "";
  const hasBody = body.trim().length >= 80;
  checks.push({
    name: "substantive_answer",
    status: hasBody ? "pass" : "fail",
    detail: hasBody ? "Answer has enough body to be useful." : "Answer is too short.",
  });
  const hasSources = args.sourceCount > 0;
  checks.push({
    name: "source_backed",
    status: hasSources ? "pass" : "fail",
    detail: `${args.sourceCount} public sources attached.`,
  });
  const privateLeak = /\bprivate note|userNotes|only your notebook\b/i.test(body);
  checks.push({
    name: "public_private_boundary",
    status: privateLeak ? "fail" : "pass",
    detail: privateLeak ? "Answer body references private-note implementation details." : "No private-note content in answer body.",
  });
  const hasRuntimeTrace = args.traceSteps.length >= 3;
  checks.push({
    name: "runtime_trace",
    status: hasRuntimeTrace ? "pass" : "warn",
    detail: `${args.traceSteps.length} trace steps persisted.`,
  });
  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;
  const score = Math.max(0, 100 - failed * 35 - warned * 10);
  return { passed: failed === 0, score, checks };
}

// External-provider fetch timeouts (TIMEOUT — agentic_reliability #4). Convex
// actions get a multi-minute budget, NOT the query budget, so without an
// AbortController a hung provider socket would stall the /ask lane and never
// reach the deterministic synthesizeAnswer fallback below.
const LINKUP_TIMEOUT_MS = Number(process.env.SCRATCHNODE_LINKUP_TIMEOUT_MS) || 12000;
const ANTHROPIC_TIMEOUT_MS = Number(process.env.SCRATCHNODE_ANTHROPIC_TIMEOUT_MS) || 20000;

async function searchLinkup(question: string) {
  const apiKey = process.env.LINKUP_API_KEY;
  if (!apiKey || process.env.SCRATCHNODE_ALLOW_LINKUP !== "1") {
    return { status: "skipped" as const, sources: [], detail: "Linkup disabled or key not configured." };
  }
  const startedAt = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LINKUP_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.linkup.so/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: question,
        depth: "standard",
        outputType: "searchResults",
        includeSources: true,
        maxResults: MAX_LINKUP_SOURCES,
      }),
      signal: ac.signal,
    });
    if (!response.ok) {
      return {
        status: "error" as const,
        sources: [],
        detail: `Linkup returned HTTP ${response.status} in ${Date.now() - startedAt}ms.`,
      };
    }
    const data: any = await response.json();
    const rawSources = Array.isArray(data.sources) ? data.sources : Array.isArray(data.results) ? data.results : [];
    const sources = rawSources.slice(0, MAX_LINKUP_SOURCES).map((source: any, index: number) => ({
      uri: String(source.url || source.uri || `linkup://${stableHash(`${question}:${index}`)}`).slice(0, 500),
      kind: "url" as const,
      title: String(source.name || source.title || "External source").slice(0, 200),
      excerpt: String(source.snippet || source.content || "").slice(0, 500),
      body: String(source.content || source.snippet || source.name || "").slice(0, MAX_SOURCE_BODY),
    }));
    return {
      status: "ok" as const,
      sources,
      detail: `Linkup returned ${sources.length} sources in ${Date.now() - startedAt}ms.`,
    };
  } catch (err: any) {
    return {
      status: "error" as const,
      sources: [],
      detail: ac.signal.aborted
        ? `Linkup timed out after ${LINKUP_TIMEOUT_MS}ms.`
        : `Linkup failed: ${err?.message || String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function generateProviderAnswer(args: {
  eventName: string;
  question: string;
  sources: Array<{ title: string; excerpt: string; body: string; uri?: string }>;
  model: string; // chosen by the LLM router (shared/llm/router.ts) at the call site
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false as const, detail: "ANTHROPIC_API_KEY not configured." };
  }
  const model = args.model;
  const system = [
    "You are ScratchNode's event answer agent.",
    "Answer only from the provided public event sources.",
    "Do not use or mention private notes.",
    "If evidence is thin, say what is known and what remains unclear.",
    "Write concise, useful prose for an event attendee.",
    "End with a short 'Next move:' sentence.",
  ].join(" ");
  const context = boundedContextText(args.sources);
  const user = [
    `Event: ${args.eventName}`,
    `Question: ${args.question}`,
    "",
    "Public event sources:",
    context,
  ].join("\n");
  const inputTokens = estimateTokens(system + "\n" + user);
  const startedAt = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        temperature: 0.2,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: ac.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false as const,
        detail: `Anthropic HTTP ${response.status}: ${body.slice(0, 240)}`,
        model,
        inputTokens,
        elapsedMs: Date.now() - startedAt,
      };
    }
    const data: any = await response.json();
    const text = Array.isArray(data.content)
      ? data.content.map((part: any) => part?.type === "text" ? part.text : "").join("").trim()
      : "";
    const outputTokens = Number(data.usage?.output_tokens ?? estimateTokens(text));
    const usageInput = Number(data.usage?.input_tokens ?? inputTokens);
    if (!text) {
      return {
        ok: false as const,
        detail: "Anthropic returned an empty text response.",
        model,
        inputTokens: usageInput,
        outputTokens,
        elapsedMs: Date.now() - startedAt,
      };
    }
    return {
      ok: true as const,
      body: text.slice(0, MAX_ANSWER_BODY),
      model,
      inputTokens: usageInput,
      outputTokens,
      estimatedCostCents: estimateAnthropicCostCents(usageInput, outputTokens, model),
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err: any) {
    return {
      ok: false as const,
      detail: ac.signal.aborted
        ? `Anthropic timed out after ${ANTHROPIC_TIMEOUT_MS}ms.`
        : `Anthropic request failed: ${err?.message || String(err)}`,
      model,
      inputTokens,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function buildAnswerPayload(ctx: any, answerId: any) {
  const answer = await ctx.db.get(answerId);
  if (!answer) return null;
  const sources: any[] = [];
  for (const sourceId of answer.sourceIds.slice(0, 8)) {
    const source = await ctx.db.get(sourceId);
    if (source) {
      sources.push({
        _id: source._id,
        title: source.title,
        uri: source.uri,
        excerpt: source.excerpt,
        kind: source.kind,
      });
    }
  }
  return { ...answer, sources };
}

async function buildWikiHtml(ctx: any, eventName: string, answers: any[], sourceIds: any[]) {
  const sourceRows: any[] = [];
  for (const sourceId of sourceIds.slice(0, 20)) {
    const source = await ctx.db.get(sourceId);
    if (source) sourceRows.push(source);
  }
  const qa = answers.length
    ? answers
      .map((answer) =>
        `<h3>${escapeHtml(answer.question)}</h3><p>${escapeHtml(answer.body).replace(/\n/g, "<br>")}</p>`,
      )
      .join("\n")
    : "<p>No promoted public answers yet. Ask public questions during the event to build this wiki.</p>";
  const sources = sourceRows.length
    ? `<ul>${sourceRows.map((source) => `<li><strong>${escapeHtml(source.title)}</strong> - ${escapeHtml(source.excerpt)}</li>`).join("")}</ul>`
    : "<p>No public sources attached yet.</p>";
  return [
    `<h1>${escapeHtml(eventName)} Wiki</h1>`,
    "<p>This wiki is generated only from public event sources and public /ask answers. Private notes are excluded.</p>",
    "<h2>Common Q&A</h2>",
    qa,
    "<h2>Sources</h2>",
    sources,
  ].join("\n");
}

// ─── QUERIES ──────────────────────────────────────────────────────────────

/**
 * Resolve a user-facing path segment to an event. Tries slug first, then
 * roomCode (case-insensitive, normalized to UPPERCASE). Returns null if
 * neither resolves — callers (UI) should fall back / surface "not found".
 *
 * Why both: the share copy on every event card says "join with code
 * ORBITAL". Users type the room code into the URL bar (`/e/orbital`)
 * expecting it to work — the v1 launch bug was exactly this: slug-only
 * lookup → null → silent local-only chat → no cross-tab sync.
 */
function isRoomCodeShape(s: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]{1,23}$/.test(s);
}

export const getEventBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    if (!slug || slug.length > 120) return null;
    const event = await ctx.db
      .query("liveEvents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (event) return event;
    // Fallback: treat the path segment as a room code.
    const roomCode = slug.trim().toUpperCase();
    if (!isRoomCodeShape(roomCode)) return null;
    return await ctx.db
      .query("liveEvents")
      .withIndex("by_roomCode", (q) => q.eq("roomCode", roomCode))
      .first();
  },
});

// BOUND (agentic_reliability): cap every landing-stats scan. There is no count
// aggregate in Convex, so each metric is an index-ordered scan capped with a +1
// sentinel — if we hit the cap the UI honestly renders "N+" rather than silently
// undercounting. Limits sit far above current volume.
const MAX_LANDING_EVENT_SCAN = 10000;
const MAX_LANDING_SESSION_SCAN = 5000;

/**
 * Live landing stats — powers the animated counter on the apex landing.
 *
 * Convex queries are REACTIVE: every subscribed landing visitor's numbers tick
 * the instant a room is created, opens/ends, or someone joins/leaves — no client
 * timers (the client also keeps a 25s poll fallback for older Convex browsers).
 *
 * Three real metrics (synthesis of the two parallel implementations — Codex
 * contributed the index-backed presence counting; this keeps the reactive +
 * honest-hide framing):
 *   - roomsCreated: every room ever made (ended rooms keep their row) — by_startedAt
 *   - liveNow:      rooms still open (status=live)                     — by_status_startedAt
 *   - activeNow:    member sessions seen within the presence TTL       — by_lastSeen
 *
 * Honesty (agentic_reliability HONEST_SCORES): every number is a real row count —
 * no hardcoded floor, no inflation. `capped`/`activeCapped` are surfaced so the UI
 * shows "N+" instead of a wrong number. When the backend is unreachable the client
 * HIDES the counter rather than render a fabricated number.
 */
export const getLandingStats = query({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    const rooms = await ctx.db
      .query("liveEvents")
      .withIndex("by_startedAt")
      .order("desc")
      .take(MAX_LANDING_EVENT_SCAN + 1);
    const liveRows = await ctx.db
      .query("liveEvents")
      .withIndex("by_status_startedAt", (q) => q.eq("status", "live"))
      .order("desc")
      .take(MAX_LANDING_EVENT_SCAN + 1);
    const activeRows = await ctx.db
      .query("liveEventMembers")
      .withIndex("by_lastSeen", (q) => q.gte("lastSeenAt", cutoff))
      .take(MAX_LANDING_SESSION_SCAN + 1);
    return {
      roomsCreated: Math.min(rooms.length, MAX_LANDING_EVENT_SCAN),
      liveNow: Math.min(liveRows.length, MAX_LANDING_EVENT_SCAN),
      activeNow: Math.min(activeRows.length, MAX_LANDING_SESSION_SCAN),
      capped: rooms.length > MAX_LANDING_EVENT_SCAN,
      activeCapped: activeRows.length > MAX_LANDING_SESSION_SCAN,
    };
  },
});

/**
 * Realtime message stream. The Convex client re-runs this on every change.
 * Ordered ascending by createdAt so the latest is last (matches UI append order).
 */
export const getMessages = query({
  args: {
    eventId: v.id("liveEvents"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { eventId, limit }) => {
    const safeLimit = Math.min(Math.max(limit ?? DEFAULT_MESSAGE_LIMIT, 1), MAX_MESSAGE_LIMIT);
    const rows = await ctx.db
      .query("liveEventMessages")
      .withIndex("by_event_time", (q) => q.eq("eventId", eventId))
      .order("desc")
      .take(safeLimit);
    return rows.reverse(); // ascending for UI
  },
});

/**
 * Active members — only those with a lastSeenAt within the presence TTL window.
 * Stale rows are evicted by the janitor cron (see convex/crons.ts).
 *
 * BOUNDED (agentic_reliability: BOUND): capped at MAX_ACTIVE_MEMBERS = 500.
 * Without this cap, a large public event (e.g. a YC demo day at 5k+ joiners)
 * would force the query to scan + serialize every active member row on every
 * caller refresh. The janitor cron normally keeps this small, but a launch-day
 * spike can outpace eviction. 500 is the soft ceiling we surface to the UI;
 * the member-count strip already says "500+ in the room" past that.
 */
const MAX_ACTIVE_MEMBERS = 500;

export const getMembers = query({
  args: { eventId: v.id("liveEvents") },
  handler: async (ctx, { eventId }) => {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    const rows = await ctx.db
      .query("liveEventMembers")
      .withIndex("by_event_lastSeen", (q) =>
        q.eq("eventId", eventId).gte("lastSeenAt", cutoff),
      )
      .take(MAX_ACTIVE_MEMBERS);
    return rows;
  },
});

export const getSources = query({
  args: { eventId: v.id("liveEvents") },
  handler: async (ctx, { eventId }) => {
    return await ctx.db
      .query("liveEventSources")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .take(100);
  },
});

export const getAnswers = query({
  args: {
    eventId: v.id("liveEvents"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { eventId, limit }) => {
    const safeLimit = Math.min(Math.max(limit ?? DEFAULT_MESSAGE_LIMIT, 1), MAX_ANSWER_LIMIT);
    const rows = await ctx.db
      .query("liveEventAnswers")
      .withIndex("by_event_time", (q) => q.eq("eventId", eventId))
      .order("desc")
      .take(safeLimit);
    const enriched: any[] = [];
    for (const row of rows.reverse()) {
      const sources: any[] = [];
      for (const sourceId of row.sourceIds.slice(0, 8)) {
        const source = await ctx.db.get(sourceId);
        if (source) {
          sources.push({
            _id: source._id,
            title: source.title,
            uri: source.uri,
            excerpt: source.excerpt,
            kind: source.kind,
          });
        }
      }
      enriched.push({ ...row, sources });
    }
    return enriched;
  },
});

/**
 * /ask operability telemetry (PR C) — a bounded, read-only aggregate over an
 * event's answers, for launch-ops + host visibility into the /ask pipeline:
 * mode mix, PROVIDER FAILURE RATE (the headline degraded-health signal),
 * quality pass rate, cost, and provider latency.
 *
 * Honesty (agentic_reliability):
 *   - BOUND: capped scan (≤1000), `capped` flag surfaced when the window is full.
 *   - HONEST_SCORES: every number is computed from real rows; rates are null
 *     (not a fake 0/100) when there's no denominator — the UI must show "—",
 *     never a fabricated "100% healthy".
 *   - No private data: liveEventAnswers are public; never touches userNotes.
 */
export const getAskTelemetry = query({
  args: { eventId: v.id("liveEvents"), limit: v.optional(v.number()) },
  handler: async (ctx, { eventId, limit }) => {
    const cap = Math.min(Math.max(limit ?? 500, 1), 1000); // BOUND
    const rows = await ctx.db
      .query("liveEventAnswers")
      .withIndex("by_event_time", (q) => q.eq("eventId", eventId))
      .order("desc")
      .take(cap);

    const modes = { provider: 0, cache: 0, deterministic: 0, provider_fallback: 0 };
    let costCentsTotal = 0;
    let qualitySum = 0;
    let qualityCount = 0;
    let passCount = 0;
    let providerLatencySum = 0;
    let providerLatencyCount = 0;
    let liveSearchCount = 0;

    for (const r of rows) {
      const mode = (r.agentMode ?? "deterministic") as keyof typeof modes;
      if (mode in modes) modes[mode] += 1;
      costCentsTotal += r.estimatedCostCents ?? 0;
      liveSearchCount += r.externalSearches ?? 0;
      if (r.evaluation) {
        qualitySum += r.evaluation.score ?? 0;
        qualityCount += 1;
        if (r.evaluation.passed) passCount += 1;
      }
      const provStep = (r.trace ?? []).find(
        (s: any) => s.step === "provider_llm" && s.status === "ok",
      );
      if (provStep) {
        providerLatencySum += provStep.durationMs ?? 0;
        providerLatencyCount += 1;
      }
    }

    // Provider failure rate = fallbacks / (real provider ATTEMPTS). A provider
    // attempt is a success (mode=provider) OR a fallback (mode=provider_fallback);
    // cache/deterministic never reached the provider, so they're excluded from
    // the denominator. Null when no attempts — no fabricated "0% failures".
    const providerAttempts = modes.provider + modes.provider_fallback;
    const round = (x: number, p: number) => Math.round(x * 10 ** p) / 10 ** p;
    return {
      total: rows.length,
      capped: rows.length >= cap,
      modes,
      providerAttempts,
      providerFailureRate: providerAttempts > 0 ? round(modes.provider_fallback / providerAttempts, 3) : null,
      qualityPassRate: qualityCount > 0 ? round(passCount / qualityCount, 3) : null,
      avgQualityScore: qualityCount > 0 ? Math.round(qualitySum / qualityCount) : null,
      totalCostCents: round(costCentsTotal, 4),
      avgProviderLatencyMs: providerLatencyCount > 0 ? Math.round(providerLatencySum / providerLatencyCount) : null,
      liveSearchCount,
    };
  },
});

export const getHostStatus = query({
  args: {
    eventId: v.id("liveEvents"),
    ownerKey: v.string(),
  },
  handler: async (ctx, { eventId, ownerKey }) => {
    if (!ownerKey || ownerKey.length < 8) return { isHost: false };
    const host = await ctx.db
      .query("liveEventHosts")
      .withIndex("by_event_owner", (q) => q.eq("eventId", eventId).eq("ownerKey", ownerKey))
      .first();
    return host ? { isHost: true, role: host.role, displayName: host.displayName } : { isHost: false };
  },
});

export const getMyEvents = query({
  args: {
    sessionId: v.optional(v.string()),
    ownerKey: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { sessionId, ownerKey, limit }) => {
    const safeLimit = Math.min(Math.max(limit ?? 20, 1), MAX_MY_EVENTS_LIMIT);
    const joined: any[] = [];
    const hosted: any[] = [];

    if (sessionId && sessionId.length >= 8 && sessionId.length <= 64) {
      const memberRows = await ctx.db
        .query("liveEventMembers")
        .withIndex("by_session_joined", (q) => q.eq("sessionId", sessionId))
        .order("desc")
        .take(safeLimit);

      for (const membership of memberRows) {
        const event = await ctx.db.get(membership.eventId);
        if (!event) continue;
        joined.push({
          eventId: event._id,
          slug: event.slug,
          name: event.name,
          roomCode: event.roomCode,
          status: event.status,
          role: "attendee",
          joinedAt: membership.joinedAt,
          lastSeenAt: membership.lastSeenAt,
        });
      }
    }

    if (ownerKey && ownerKey.length >= 8 && ownerKey.length <= MAX_OWNER_KEY_LEN) {
      const hostRows = await ctx.db
        .query("liveEventHosts")
        .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
        .order("desc")
        .take(safeLimit);

      for (const host of hostRows) {
        const event = await ctx.db.get(host.eventId);
        if (!event) continue;
        hosted.push({
          eventId: event._id,
          slug: event.slug,
          name: event.name,
          roomCode: event.roomCode,
          status: event.status,
          role: host.role,
          authMethod: host.authMethod ?? "legacy_ownerkey",
          createdAt: host.createdAt,
        });
      }
    }

    return { joined, hosted };
  },
});

export const getPublishedWiki = query({
  args: { eventId: v.id("liveEvents") },
  handler: async (ctx, { eventId }) => {
    const rows = await ctx.db
      .query("liveEventWikiVersions")
      .withIndex("by_event_status", (q) => q.eq("eventId", eventId).eq("status", "published"))
      .order("desc")
      .take(1);
    return rows[0] ?? null;
  },
});

/**
 * Shared /ask context loader — the SINGLE source of truth for question
 * integrity, semantic-cache lookup, source corpus, and the asker's prior turns.
 *
 * Used by BOTH `_prepareAskAgentContext` (the askAgent action's internalQuery)
 * AND `composeAnswer` (the deterministic mutation fallback) so the two /ask
 * paths can NEVER drift on the security-critical integrity check (#2) or the
 * multi-turn prior-turn derivation. Works with any ctx exposing `db` (query OR
 * mutation), because every operation here is a read.
 *
 * Pattern: extracted-helper to enforce contract parity across two entrypoints.
 * See: .claude/rules/backend_contract_migration.md (no-drift), agentic_reliability.
 */
async function loadAskContext(
  ctx: any,
  args: { eventId: any; sessionId: string; questionMessageId: any; question: string },
) {
  const event = await ctx.db.get(args.eventId);
  if (!event) {
    throw new ConvexError({ code: "event_not_found", message: "Event no longer exists." });
  }
  if (event.status === "ended") {
    throw new ConvexError({ code: "event_ended", message: "This event has ended." });
  }
  await requireMember(ctx, args.eventId, args.sessionId);
  // INTEGRITY (review #2): never trust the client's question text or parent id blindly. Load the
  // ask-message row server-side, prove it belongs to THIS event + THIS caller session, and derive
  // the canonical question from the stored row — so an answer cannot be attached to someone else's
  // (or another event's) message, and the question text can't be spoofed.
  const askMsg: any = await ctx.db.get(args.questionMessageId);
  if (!askMsg || askMsg.eventId !== args.eventId || askMsg.sessionId !== args.sessionId) {
    throw new ConvexError({ code: "invalid_question_message", message: "Question message not found for this room and session." });
  }
  const question = (askMsg.text || args.question || "").trim().slice(0, 1000);
  if (!question) {
    throw new ConvexError({ code: "empty_question", message: "/ask question required." });
  }
  const normalizedQuestion = normalizeQuestion(question);
  const cached = await ctx.db
    .query("liveEventAnswers")
    .withIndex("by_event_normalized", (q: any) =>
      q.eq("eventId", args.eventId).eq("normalizedQuestion", normalizedQuestion),
    )
    .order("desc")
    .first();
  const sources = await ctx.db
    .query("liveEventSources")
    .withIndex("by_event", (q: any) => q.eq("eventId", args.eventId))
    .take(100);
  // Asker's OWN recent turns for multi-turn query condensation. PRIVACY: filtered to
  // this sessionId only — never other attendees' messages. Bounded recent scan. The
  // identical current-question text is excluded so a verbatim re-ask is NOT treated as a
  // follow-up (it correctly reuses the cache instead of re-condensing).
  const recentMsgs = await ctx.db
    .query("liveEventMessages")
    .withIndex("by_event_time", (q: any) => q.eq("eventId", args.eventId))
    .order("desc")
    .take(60);
  const priorTurns = recentMsgs
    .filter((m: any) => m.sessionId === args.sessionId && (m.kind === "chat" || m.kind === "ask") && (m.text || "").trim() && m.text.trim() !== question)
    .slice(0, 5)
    .reverse()
    .map((m: any) => m.text.trim().slice(0, 300));
  return {
    event: {
      _id: event._id,
      slug: event.slug,
      name: event.name,
      status: event.status,
    },
    question,
    normalizedQuestion,
    cached,
    sources,
    priorTurns,
  };
}

/**
 * Pure decision: should a cache HIT be SKIPPED rather than reused? (reviews #1 + #4)
 * The semantic cache is keyed by the RAW normalized question. Reusing it is only
 * correct for a standalone question whose answer is still current. Returns a
 * human-readable skip reason (surfaced in the trace) or null when the cache is safe.
 *   - follow-up: prior-turn context means the condensed retrieval query differs
 *     from the raw cache key, so the cached standalone answer may be wrong.
 *   - stale: a source changed after the cached answer was written.
 *   - freshness: the asker explicitly wants the latest/current info.
 *
 * Pure (no ctx) so askAgent (action) and composeAnswer (mutation) share IDENTICAL logic.
 */
function computeCacheSkipReason(opts: {
  cached: any;
  priorTurns: string[];
  sources: any[];
  question: string;
}): string | null {
  if (!opts.cached) return null;
  const hasPriorContext = (opts.priorTurns || []).length > 0;
  const maxSourceTs = (opts.sources || []).reduce((m: number, s: any) => Math.max(m, s.uploadedAt || 0), 0);
  const cacheStale = (opts.cached._creationTime || 0) < maxSourceTs;
  const freshnessIntent = /\b(latest|recent|current|today|now|just|update[ds]?|new(?:est|ly)?)\b/i.test(opts.question);
  if (hasPriorContext) return "follow-up; condensed query differs from the raw cache key";
  if (cacheStale) return "a source changed after the cached answer";
  if (freshnessIntent) return "caller asked for the latest/current info";
  return null;
}

/**
 * Reserve the /ask slot before any expensive work (Finding #3): idempotency +
 * a dedicated provider-cost rate-limit, in ONE transaction. Shared by askAgent
 * (via the _reserveAskSlot internalMutation) and composeAnswer (inline) so the
 * two paths enforce IDENTICAL idempotency + limits.
 *
 *  - Idempotency: if an answer already exists for THIS question message AND it
 *    belongs to this caller, return it instead of computing/charging again. This
 *    collapses the client's askAgent→composeAnswer fallback (both fire the same
 *    questionMessageId) and any double-submit into a single answer. A mismatched
 *    owner falls through — the authoritative integrity check (#2) then rejects it.
 *  - Rate-limit: only NEW work is charged; idempotent replays are free.
 */
async function reserveAskSlot(
  ctx: any,
  args: { eventId: any; sessionId: string; questionMessageId: any },
): Promise<{ existingAnswer: any | null }> {
  const existing = await ctx.db
    .query("liveEventAnswers")
    .withIndex("by_question", (q: any) => q.eq("questionMessageId", args.questionMessageId))
    .first();
  if (existing && existing.eventId === args.eventId && existing.askedBySessionId === args.sessionId) {
    return { existingAnswer: await buildAnswerPayload(ctx, existing._id) };
  }
  await enforceRateLimit(ctx, {
    key: `ask:${args.sessionId}`,
    limit: ASK_RATE_LIMIT_PER_MIN,
    windowMs: ASK_RATE_WINDOW_MS,
  });
  return { existingAnswer: null };
}

// askAgent is an action (no DB-write ctx), so it reserves its slot through this
// internalMutation — the idempotency check + rate-limit then happen in one txn.
export const _reserveAskSlot = internalMutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    questionMessageId: v.id("liveEventMessages"),
  },
  handler: async (ctx, args) => reserveAskSlot(ctx, args),
});

export const _prepareAskAgentContext = internalQuery({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    questionMessageId: v.id("liveEventMessages"),
    question: v.string(),
  },
  // Thin wrapper over the shared loader (anti-drift): identical reads + integrity
  // check that composeAnswer also runs. Keep this a pure pass-through.
  handler: async (ctx, args) => loadAskContext(ctx, args),
});

export const _upsertAgentSources = internalMutation({
  args: {
    eventId: v.id("liveEvents"),
    sources: v.array(v.object({
      uri: v.string(),
      kind: v.union(
        v.literal("transcript"),
        v.literal("doc"),
        v.literal("url"),
        v.literal("slide"),
      ),
      title: v.string(),
      excerpt: v.string(),
      body: v.string(),
    })),
  },
  handler: async (ctx, { eventId, sources }) => {
    const rows: any[] = [];
    for (const source of sources.slice(0, MAX_LINKUP_SOURCES)) {
      const uri = source.uri.slice(0, 500);
      const body = (source.body || source.excerpt || source.title).slice(0, MAX_SOURCE_BODY);
      const existing = await ctx.db
        .query("liveEventSources")
        .withIndex("by_event_uri", (q) => q.eq("eventId", eventId).eq("uri", uri))
        .first();
      if (existing) {
        rows.push(existing);
        continue;
      }
      const id = await ctx.db.insert("liveEventSources", {
        eventId,
        uri,
        kind: source.kind,
        title: source.title.slice(0, 200),
        excerpt: source.excerpt.slice(0, 500),
        body,
        sourceHash: stableHash(`${uri}|${body}`),
        isSeeded: false,
        uploadedAt: Date.now(),
      });
      const inserted = await ctx.db.get(id);
      if (inserted) rows.push(inserted);
    }
    return rows;
  },
});

export const _persistAgentAnswer = internalMutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    questionMessageId: v.id("liveEventMessages"),
    question: v.string(),
    normalizedQuestion: v.string(),
    body: v.string(),
    sourceIds: v.array(v.id("liveEventSources")),
    trace: v.array(v.object({
      step: v.string(),
      status: v.union(v.literal("ok"), v.literal("miss"), v.literal("error")),
      detail: v.optional(v.string()),
      durationMs: v.number(),
    })),
    cacheHit: v.boolean(),
    agentMode: v.union(
      v.literal("deterministic"),
      v.literal("provider"),
      v.literal("provider_fallback"),
      v.literal("cache"),
    ),
    provider: v.optional(v.string()),
    modelId: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    estimatedCostCents: v.optional(v.number()),
    externalSearches: v.optional(v.number()),
    evaluation: v.object({
      passed: v.boolean(),
      score: v.number(),
      checks: v.array(v.object({
        name: v.string(),
        status: v.union(v.literal("pass"), v.literal("warn"), v.literal("fail")),
        detail: v.optional(v.string()),
      })),
    }),
  },
  handler: async (ctx, args) => {
    const answerId = await ctx.db.insert("liveEventAnswers", {
      eventId: args.eventId,
      questionMessageId: args.questionMessageId,
      askedBySessionId: args.sessionId,
      question: args.question,
      normalizedQuestion: args.normalizedQuestion,
      body: args.body.slice(0, MAX_ANSWER_BODY),
      sourceIds: args.sourceIds,
      trace: args.trace,
      cacheHit: args.cacheHit,
      agentMode: args.agentMode,
      provider: args.provider,
      modelId: args.modelId,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      estimatedCostCents: args.estimatedCostCents,
      externalSearches: args.externalSearches,
      evaluation: args.evaluation,
      faqStatus: "none",
      createdAt: Date.now(),
    });
    return await buildAnswerPayload(ctx, answerId);
  },
});

// ─── MUTATIONS ────────────────────────────────────────────────────────────

/**
 * Create a real ScratchNode event room and return a server-issued host token.
 *
 * This is the launch replacement for the old Host Console "SOLARIS" toast.
 * The mutation creates the event, joins the creator, registers them as host,
 * and inserts one public starter source so `/ask` has a bounded public corpus
 * from the first minute. Private notes are not read or copied.
 */
export const createEvent = mutation({
  args: {
    title: v.string(),
    sessionId: v.string(),
    displayName: v.string(),
    slug: v.optional(v.string()),
    roomCode: v.optional(v.string()),
    agendaText: v.optional(v.string()),
    status: v.optional(v.union(v.literal("draft"), v.literal("live"))),
  },
  handler: async (ctx, args) => {
    // Fail before writing if production host-token env is missing.
    // `issueHostToken` calls this again after we have the event id.
    void getHostAuthSecret();

    const title = normalizeEventTitle(args.title);
    if (title.length < 3) {
      throw new ConvexError({
        code: "invalid_event_title",
        message: "Event title must be at least 3 characters.",
      });
    }
    if (!args.sessionId || args.sessionId.length < 8 || args.sessionId.length > 64) {
      throw new ConvexError({
        code: "invalid_session",
        message: "sessionId must be a 8-64 char UUID-like string.",
      });
    }

    // Rate-limit self-serve room creation. Hosts can still manage an existing
    // room with their host token, but anonymous sessions cannot create an
    // unbounded number of durable public rooms.
    await enforceRateLimit(ctx, {
      key: `create:${args.sessionId}`,
      limit: 5,
      windowMs: 10 * 60_000,
    });

    const requestedSlug = normalizeRequestedSlug(args.slug, title);
    const explicitSlug = !!(args.slug && args.slug.trim());
    const existingSlug = await ctx.db
      .query("liveEvents")
      .withIndex("by_slug", (q) => q.eq("slug", requestedSlug))
      .first();
    if (existingSlug && explicitSlug) {
      throw new ConvexError({
        code: "slug_taken",
        message: "That event slug is already in use.",
      });
    }

    let slug = requestedSlug;
    if (existingSlug) {
      for (let i = 0; i < 8; i += 1) {
        const suffix = randomString(4, "abcdefghjkmnpqrstuvwxyz23456789").toLowerCase();
        const candidate = `${requestedSlug.slice(0, Math.max(1, MAX_EVENT_SLUG - 5))}-${suffix}`;
        const collision = await ctx.db
          .query("liveEvents")
          .withIndex("by_slug", (q) => q.eq("slug", candidate))
          .first();
        if (!collision) {
          slug = candidate;
          break;
        }
      }
      if (slug === requestedSlug) {
        throw new ConvexError({
          code: "slug_generation_failed",
          message: "Could not generate a unique event slug. Try another title.",
        });
      }
    }

    const requestedRoomCode = normalizeRequestedRoomCode(args.roomCode);
    if (requestedRoomCode && !isRoomCodeShape(requestedRoomCode)) {
      throw new ConvexError({
        code: "invalid_room_code",
        message: "Room code must be 2-24 letters, numbers, or dashes.",
      });
    }

    let roomCode = requestedRoomCode || "";
    if (roomCode) {
      const existingRoom = await ctx.db
        .query("liveEvents")
        .withIndex("by_roomCode", (q) => q.eq("roomCode", roomCode))
        .first();
      if (existingRoom) {
        throw new ConvexError({
          code: "room_code_taken",
          message: "That room code is already in use.",
        });
      }
    } else {
      for (let i = 0; i < 12; i += 1) {
        const candidate = randomString(6, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
        const existingRoom = await ctx.db
          .query("liveEvents")
          .withIndex("by_roomCode", (q) => q.eq("roomCode", candidate))
          .first();
        if (!existingRoom) {
          roomCode = candidate;
          break;
        }
      }
      if (!roomCode) {
        throw new ConvexError({
          code: "room_code_generation_failed",
          message: "Could not generate a room code. Try again.",
        });
      }
    }

    const now = Date.now();
    const status = args.status || "live";
    const eventId = await ctx.db.insert("liveEvents", {
      slug,
      name: title,
      roomCode,
      status,
      startedAt: now,
    });

    const safeName = (args.displayName || "Host").slice(0, MAX_DISPLAY_NAME).trim() || "Host";
    await ctx.db.insert("liveEventMembers", {
      eventId,
      sessionId: args.sessionId,
      displayName: safeName,
      joinedAt: now,
      lastSeenAt: now,
    });

    const ownerKey = await issueHostToken(eventId, now);
    const hostId = await ctx.db.insert("liveEventHosts", {
      eventId,
      ownerKey,
      displayName: safeName,
      role: "owner",
      authMethod: "claim_code",
      createdAt: now,
    });

    const agenda = (args.agendaText || "").replace(/\s+/g, " ").trim().slice(0, MAX_EVENT_CONTEXT);
    const sourceBody = [
      `${title} live room starter context.`,
      agenda || "The host has not uploaded a detailed agenda yet. Use public chat and host-approved sources as the event develops.",
      "Privacy rule: public answers use public event context only. Private attendee notes are excluded from public answers, public wiki compaction, and public cache.",
    ].join("\n");
    const sourceId = await ctx.db.insert("liveEventSources", {
      eventId,
      uri: `event://${slug}/starter-context`,
      kind: "doc",
      title: `${title} starter context`,
      excerpt: (agenda || `Host-created room ${roomCode}. Public answers exclude private notes.`).slice(0, 280),
      body: sourceBody.slice(0, MAX_SOURCE_BODY),
      sourceHash: stableHash(`${slug}|${sourceBody}`),
      isSeeded: true,
      uploadedAt: now,
    });

    return {
      ok: true as const,
      eventId,
      slug,
      name: title,
      roomCode,
      status,
      ownerKey,
      hostId,
      sourceId,
    };
  },
});

export const updateEvent = mutation({
  args: {
    eventId: v.id("liveEvents"),
    ownerKey: v.string(),
    title: v.optional(v.string()),
    roomCode: v.optional(v.string()),
    status: v.optional(v.union(v.literal("draft"), v.literal("live"))),
  },
  handler: async (ctx, { eventId, ownerKey, title, roomCode, status }) => {
    await requireHost(ctx, eventId, ownerKey);
    const event = await ctx.db.get(eventId);
    if (!event) {
      throw new ConvexError({ code: "event_not_found", message: "Event no longer exists." });
    }
    if (event.status === "ended" && status !== undefined) {
      throw new ConvexError({
        code: "event_ended",
        message: "Ended events cannot be reopened.",
      });
    }

    const patch: Record<string, unknown> = {};
    if (title !== undefined) {
      const cleanTitle = normalizeEventTitle(title);
      if (cleanTitle.length < 3) {
        throw new ConvexError({
          code: "invalid_event_title",
          message: "Event title must be at least 3 characters.",
        });
      }
      patch.name = cleanTitle;
    }
    if (status !== undefined) {
      patch.status = status;
      if (status === "live" && event.status === "draft") {
        patch.startedAt = Date.now();
      }
    }
    if (roomCode !== undefined) {
      const nextRoomCode = normalizeRequestedRoomCode(roomCode);
      if (!nextRoomCode || !isRoomCodeShape(nextRoomCode)) {
        throw new ConvexError({
          code: "invalid_room_code",
          message: "Room code must be 2-24 letters, numbers, or dashes.",
        });
      }
      if (nextRoomCode !== event.roomCode) {
        const existingRoom = await ctx.db
          .query("liveEvents")
          .withIndex("by_roomCode", (q) => q.eq("roomCode", nextRoomCode))
          .first();
        if (existingRoom && existingRoom._id !== eventId) {
          throw new ConvexError({
            code: "room_code_taken",
            message: "That room code is already in use.",
          });
        }
        patch.roomCode = nextRoomCode;
      }
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(eventId, patch);
    }
    const updated = await ctx.db.get(eventId);
    return {
      ok: true as const,
      eventId,
      slug: updated?.slug ?? event.slug,
      name: updated?.name ?? event.name,
      roomCode: updated?.roomCode ?? event.roomCode,
      status: updated?.status ?? event.status,
    };
  },
});

export const endEvent = mutation({
  args: {
    eventId: v.id("liveEvents"),
    ownerKey: v.string(),
  },
  handler: async (ctx, { eventId, ownerKey }) => {
    await requireHost(ctx, eventId, ownerKey);
    const event = await ctx.db.get(eventId);
    if (!event) {
      throw new ConvexError({ code: "event_not_found", message: "Event no longer exists." });
    }
    const endedAt = Date.now();
    await ctx.db.patch(eventId, { status: "ended", endedAt });
    return { ok: true as const, eventId, status: "ended" as const, endedAt };
  },
});

export const upsertEventSource = mutation({
  args: {
    eventId: v.id("liveEvents"),
    ownerKey: v.string(),
    title: v.string(),
    body: v.string(),
    uri: v.optional(v.string()),
    excerpt: v.optional(v.string()),
    kind: v.optional(v.union(
      v.literal("transcript"),
      v.literal("doc"),
      v.literal("url"),
      v.literal("slide"),
    )),
  },
  handler: async (ctx, args) => {
    await requireHost(ctx, args.eventId, args.ownerKey);
    const event = await ctx.db.get(args.eventId);
    if (!event) {
      throw new ConvexError({ code: "event_not_found", message: "Event no longer exists." });
    }
    const title = (args.title || "").replace(/\s+/g, " ").trim().slice(0, 180);
    const body = (args.body || "").replace(/\s+/g, " ").trim().slice(0, MAX_SOURCE_BODY);
    if (title.length < 2 || body.length < 10) {
      throw new ConvexError({
        code: "invalid_source",
        message: "Source title and body are required.",
      });
    }
    const uri = (args.uri || `event://${event.slug}/source/${stableHash(`${title}|${body}`).slice(0, 10)}`)
      .trim()
      .slice(0, 500);
    const excerpt = (args.excerpt || body).replace(/\s+/g, " ").trim().slice(0, 280);
    const existing = await ctx.db
      .query("liveEventSources")
      .withIndex("by_event_uri", (q) => q.eq("eventId", args.eventId).eq("uri", uri))
      .first();
    const patch = {
      eventId: args.eventId,
      uri,
      kind: args.kind || "doc",
      title,
      excerpt,
      body,
      sourceHash: stableHash(`${uri}|${body}`),
      isSeeded: false,
      uploadedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { ok: true as const, sourceId: existing._id, created: false };
    }
    const sourceId = await ctx.db.insert("liveEventSources", patch);
    return { ok: true as const, sourceId, created: true };
  },
});

export const deleteEventSource = mutation({
  args: {
    eventId: v.id("liveEvents"),
    ownerKey: v.string(),
    sourceId: v.id("liveEventSources"),
  },
  handler: async (ctx, { eventId, ownerKey, sourceId }) => {
    await requireHost(ctx, eventId, ownerKey);
    const source = await ctx.db.get(sourceId);
    if (!source || source.eventId !== eventId) {
      throw new ConvexError({ code: "source_not_found", message: "Source no longer exists." });
    }
    await ctx.db.delete(sourceId);
    return { ok: true as const, sourceId };
  },
});

/**
 * Idempotent join: upsert liveEventMembers by (eventId, sessionId).
 * Missing rooms fail honestly; production join never creates demo fixtures.
 */
export const joinEvent = mutation({
  args: {
    slug: v.string(),
    sessionId: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, { slug, sessionId, displayName }) => {
    if (!slug || slug.length > 120) {
      throw new ConvexError({ code: "invalid_slug", message: "Bad event slug." });
    }
    if (!sessionId || sessionId.length < 8 || sessionId.length > 64) {
      throw new ConvexError({
        code: "invalid_session",
        message: "sessionId must be a 8-64 char UUID-like string.",
      });
    }
    const safeName = (displayName || "Anonymous Guest").slice(0, MAX_DISPLAY_NAME).trim()
      || "Anonymous Guest";

    // Rate-limit joins per session: a join can auto-seed an event + insert a
    // member row. 20 per minute absorbs reconnect churn but caps a join-storm.
    await enforceRateLimit(ctx, {
      key: `join:${sessionId}`,
      limit: 20,
      windowMs: 60_000,
    });

    let event = await ctx.db
      .query("liveEvents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();

    // Fallback: roomCode lookup. Share copy on event cards reads "join
    // with code ORBITAL" — users type the code into the URL bar
    // (`/e/orbital`). Without this, both windows render the static mock
    // chat, sendMessage fails silently, and cross-tab sync never works.
    const normalizedRoomCode = slug.trim().toUpperCase();
    if (!event && isRoomCodeShape(normalizedRoomCode)) {
      event = await ctx.db
        .query("liveEvents")
        .withIndex("by_roomCode", (q) => q.eq("roomCode", normalizedRoomCode))
        .first();
    }

    if (!event) {
      throw new ConvexError({ code: "event_not_found", message: "No such event slug." });
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("liveEventMembers")
      .withIndex("by_event_session", (q) =>
        q.eq("eventId", event._id).eq("sessionId", sessionId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: now, displayName: safeName });
    } else {
      await ctx.db.insert("liveEventMembers", {
        eventId: event._id,
        sessionId,
        displayName: safeName,
        joinedAt: now,
        lastSeenAt: now,
      });
    }

    return {
      eventId: event._id,
      slug: event.slug,
      name: event.name,
      roomCode: event.roomCode,
      status: event.status,
    };
  },
});

/**
 * Post a public message to the event feed. Three kinds:
 *   - "chat": normal user message
 *   - "ask":  /ask invocation; Phase 2 will trigger the agent action.
 *             Phase 1 just stores the row so the UI can show it.
 *   - "system": joins/leaves/mod notes (Phase 4 hosts only)
 *
 * Private mode NEVER hits this function — see convex/notes.ts (Phase 3).
 */
export const sendMessage = mutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    displayName: v.string(),
    text: v.string(),
    kind: v.union(v.literal("chat"), v.literal("ask"), v.literal("system")),
    replyToMessageId: v.optional(v.id("liveEventMessages")),
    ownerKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const text = (args.text || "").trim();
    if (!text) {
      throw new ConvexError({ code: "empty_message", message: "Message text required." });
    }
    if (text.length > MAX_MESSAGE_TEXT) {
      throw new ConvexError({
        code: "message_too_long",
        message: `Max ${MAX_MESSAGE_TEXT} chars.`,
      });
    }
    if (!args.sessionId || args.sessionId.length < 8) {
      throw new ConvexError({
        code: "invalid_session",
        message: "Must join the event before sending.",
      });
    }

    // Rate-limit sends per session: 30/min ≈ one message every 2s sustained,
    // comfortably above human typing cadence but caps spam/flood bursts.
    await enforceRateLimit(ctx, {
      key: `send:${args.sessionId}`,
      limit: 30,
      windowMs: 60_000,
    });

    const event = await ctx.db.get(args.eventId);
    if (!event) {
      throw new ConvexError({ code: "event_not_found", message: "Event no longer exists." });
    }
    if (event.status === "ended") {
      throw new ConvexError({
        code: "event_ended",
        message: "This event has ended.",
      });
    }

    // Verify the sender is a member (presence row exists) — prevents drive-by sends.
    if (args.kind === "system") {
      if (!args.ownerKey) {
        throw new ConvexError({
          code: "not_host",
          message: "Host ownership is required for system messages.",
        });
      }
      await requireHost(ctx, args.eventId, args.ownerKey);
    }

    const member = await ctx.db
      .query("liveEventMembers")
      .withIndex("by_event_session", (q) =>
        q.eq("eventId", args.eventId).eq("sessionId", args.sessionId),
      )
      .first();
    if (!member) {
      throw new ConvexError({
        code: "not_joined",
        message: "Call joinEvent before sendMessage.",
      });
    }

    // Display name snapshot — prefer client-provided (typo fix), fall back to member.
    const safeName = (args.displayName || member.displayName || "Anonymous Guest")
      .slice(0, MAX_DISPLAY_NAME)
      .trim() || "Anonymous Guest";

    const now = Date.now();
    const messageId = await ctx.db.insert("liveEventMessages", {
      eventId: args.eventId,
      sessionId: args.sessionId,
      displayName: safeName,
      text,
      kind: args.kind,
      replyToMessageId: args.replyToMessageId,
      createdAt: now,
    });

    // Bump presence as a side effect of sending (saves a heartbeat round trip).
    await ctx.db.patch(member._id, { lastSeenAt: now });

    return { messageId, createdAt: now };
  },
});

/**
 * askAgent - provider-ready /ask path for live events.
 *
 * This action is the production path. It reads only public event sources,
 * optionally probes Linkup when freshness is justified, calls Anthropic when the
 * key is configured, and falls back to deterministic synthesis with the same
 * source and quality metadata. `composeAnswer` remains the deterministic
 * mutation fallback for older clients or environments where Convex actions are
 * unavailable.
 */
export const askAgent = action({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    questionMessageId: v.id("liveEventMessages"),
    question: v.string(),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    // Idempotency + provider-cost rate-limit (Finding #3) in one txn, BEFORE any
    // expensive work. An idempotent replay (the client's askAgent→composeAnswer
    // fallback, or a double-submit) returns the existing answer instead of
    // computing — and paying for — a second one.
    const reserved: any = await ctx.runMutation((internal as any).events._reserveAskSlot, {
      eventId: args.eventId,
      sessionId: args.sessionId,
      questionMessageId: args.questionMessageId,
    });
    if (reserved.existingAnswer) return reserved.existingAnswer;
    let prepared: any = await ctx.runQuery((internal as any).events._prepareAskAgentContext, {
      eventId: args.eventId,
      sessionId: args.sessionId,
      questionMessageId: args.questionMessageId,
      question: (args.question || "").trim().slice(0, 1000),
    });
    // Use the server-verified, canonical question for everything downstream (review #2).
    const question = prepared.question;

    // Cache safety (reviews #1 + #4) — shared pure decision so askAgent and the
    // composeAnswer fallback can never disagree on when a cache hit is safe to reuse.
    const cacheSkipReason = computeCacheSkipReason({
      cached: prepared.cached,
      priorTurns: prepared.priorTurns,
      sources: prepared.sources,
      question,
    });

    if (prepared.cached && !cacheSkipReason) {
      const evaluation = evaluateAnswerQuality({
        question,
        body: prepared.cached.body,
        sourceCount: prepared.cached.sourceIds?.length ?? 0,
        traceSteps: ["semantic_cache_lookup"],
      });
      return await ctx.runMutation((internal as any).events._persistAgentAnswer, {
        eventId: args.eventId,
        sessionId: args.sessionId,
        questionMessageId: args.questionMessageId,
        question,
        normalizedQuestion: prepared.normalizedQuestion,
        body: prepared.cached.body,
        sourceIds: prepared.cached.sourceIds,
        trace: [{
          step: "semantic_cache_lookup",
          status: "ok",
          detail: `Reused public answer ${prepared.cached._id}; private notes excluded.`,
          durationMs: Date.now() - startedAt,
        }],
        cacheHit: true,
        agentMode: "cache",
        provider: prepared.cached.provider || "cache",
        modelId: prepared.cached.modelId || "cached-answer",
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostCents: 0,
        externalSearches: 0,
        evaluation,
      });
    }

    let sources: any[] = prepared.sources || [];

    // Multi-turn (rewrite-then-retrieve, the prod standard): condense the asker's OWN
    // prior turns + this follow-up into a standalone retrieval query so "those"/"that"
    // resolve. Raw `question` is kept verbatim for the answer (condense-plus-context).
    const condensed = await condenseQuery(question, prepared.priorTurns || []);
    const retrievalQuery = condensed.query;

    const retrievalStarted = Date.now();
    let ranked = sources
      .map((source: any) => ({ source, score: scoreSource(retrievalQuery, source) }))
      .sort((a: any, b: any) => b.score - a.score || b.source.uploadedAt - a.source.uploadedAt);
    const trace: Array<{ step: string; status: "ok" | "miss" | "error"; detail?: string; durationMs: number }> = [
      {
        step: "semantic_cache_lookup",
        status: "miss",
        detail: cacheSkipReason
          ? `Cached answer skipped — ${cacheSkipReason}.`
          : "No same-question public answer found for this event.",
        durationMs: retrievalStarted - startedAt,
      },
    ];
    trace.push({
      step: "condense_query",
      status: condensed.status === "rewritten" ? "ok" : "miss",
      detail: condensed.status === "rewritten"
        ? `Rewrote follow-up from ${(prepared.priorTurns || []).length} prior turn(s) → "${retrievalQuery.slice(0, 80)}"`
        : condensed.detail,
      durationMs: condensed.durationMs,
    });

    let externalSearches = 0;
    if (shouldProbeLiveSearch(retrievalQuery, ranked)) {
      const externalStarted = Date.now();
      const linkup = await searchLinkup(retrievalQuery);
      trace.push({
        step: "external_search",
        status: linkup.status === "ok" ? "ok" : linkup.status === "skipped" ? "miss" : "error",
        detail: linkup.detail,
        durationMs: Date.now() - externalStarted,
      });
      if (linkup.status === "ok" && linkup.sources.length > 0) {
        externalSearches = 1;
        const rows = await ctx.runMutation((internal as any).events._upsertAgentSources, {
          eventId: args.eventId,
          sources: linkup.sources,
        });
        sources = [...sources, ...rows];
        ranked = sources
          .map((source: any) => ({ source, score: scoreSource(retrievalQuery, source) }))
          .sort((a: any, b: any) => b.score - a.score || b.source.uploadedAt - a.source.uploadedAt);
      }
    } else {
      trace.push({
        step: "external_search",
        status: "miss",
        detail: "Skipped because event corpus had enough matching public sources.",
        durationMs: 0,
      });
    }

    const selected = ranked.filter((row: any) => row.score > 0).slice(0, MAX_AGENT_CONTEXT_SOURCES);
    let topSources = (selected.length ? selected : ranked.slice(0, 3)).map((row: any) => row.source);
    trace.push({
      step: "bounded_source_retrieval",
      status: topSources.length > 0 ? "ok" : "error",
      detail: `Scored ${sources.length} sources; selected ${topSources.length}.`,
      durationMs: Date.now() - retrievalStarted,
    });
    if (!topSources.length) {
      throw new ConvexError({
        code: "no_sources",
        message: "No event sources are available for sourced /ask yet.",
      });
    }

    // Tri-search third leg: rerank the lexically-scored sources by LLM relevance
    // (Gemini Flash-Lite cross-encoder, shared/search/triSearch) BEFORE synthesis,
    // so the answer is grounded in — and cites — the most relevant sources first.
    // Honest fallback: on no-key / timeout / failure, topSources keeps its lexical
    // order (rerankWithGemini returns the input order with status skipped|fallback).
    {
      const candidates: TriCandidate[] = topSources.map((s: any) => ({
        id: String(s._id),
        title: s.title,
        snippet: s.excerpt || s.body || "",
        url: s.uri,
        source: "event",
      }));
      const rr = await rerankWithGemini(retrievalQuery, candidates, { topN: candidates.length });
      // Reorder topSources to the reranked id order; append any not reranked (completeness).
      const byId = new Map<string, any>(topSources.map((s: any) => [String(s._id), s]));
      const reordered: any[] = [];
      for (const c of rr.ranked) {
        const s = byId.get(c.id);
        if (s) { reordered.push(s); byId.delete(c.id); }
      }
      for (const s of byId.values()) reordered.push(s);
      topSources = reordered;
      trace.push({
        step: "rerank_sources",
        status: rr.rerankStatus === "ok" ? "ok" : "miss",
        detail: rr.detail,
        durationMs: rr.durationMs,
      });
    }

    // Prism-style routing (shared/llm/router.ts): a deterministic planner picks
    // the model for THIS question from the ask_answer pool (Haiku floor ->
    // Sonnet on long / analytical / multi-entity Qs). Single-shot path with no
    // prompt-cache to evict, so we route per request at zero added latency.
    const askRoute = routeLLM("ask_answer", askAnswerSignals(question, topSources.length));
    const askModel = process.env.SCRATCHNODE_ASK_MODEL || askRoute.model; // legacy env force-pins
    trace.push({
      step: "model_route",
      status: "ok",
      detail: process.env.SCRATCHNODE_ASK_MODEL
        ? `env-pinned ${askModel}`
        : `${askRoute.reason} -> ${askRoute.model}${askRoute.escalated ? " (escalated)" : ""}`,
      durationMs: 0,
    });
    const provider = await generateProviderAnswer({
      eventName: prepared.event.name,
      question,
      sources: topSources,
      model: askModel,
    });
    let body: string;
    let agentMode: "provider" | "provider_fallback";
    if (provider.ok) {
      body = provider.body;
      agentMode = "provider";
      trace.push({
        step: "provider_llm",
        status: "ok",
        detail: `Anthropic ${provider.model}; estimated ${provider.estimatedCostCents} cents.`,
        durationMs: provider.elapsedMs,
      });
    } else {
      body = synthesizeAnswer(question, prepared.event.name, topSources).slice(0, MAX_ANSWER_BODY);
      agentMode = "provider_fallback";
      trace.push({
        step: "provider_llm",
        status: "error",
        detail: provider.detail,
        durationMs: provider.elapsedMs ?? 0,
      });
      trace.push({
        step: "deterministic_fallback",
        status: "ok",
        detail: "Generated from public event corpus only; private notes excluded.",
        durationMs: Date.now() - startedAt,
      });
    }

    let evaluation = evaluateAnswerQuality({
      question,
      body,
      sourceCount: topSources.length,
      traceSteps: trace.map((step) => step.step),
    });
    // PRIVACY ENFORCEMENT (review #5): the public/private gate must BLOCK, not just record telemetry.
    // In a public room, never publish an answer that references private-note material — replace it with
    // the deterministic public-only synthesis (built from public sources, which can't leak) and re-grade.
    if (evaluation.checks.some((c: any) => c.name === "public_private_boundary" && c.status === "fail")) {
      body = synthesizeAnswer(question, prepared.event.name, topSources).slice(0, MAX_ANSWER_BODY);
      agentMode = "provider_fallback";
      trace.push({
        step: "privacy_redaction",
        status: "ok",
        detail: "Answer referenced private-note material; replaced with public-only synthesis before publishing.",
        durationMs: Date.now() - startedAt,
      });
      evaluation = evaluateAnswerQuality({
        question,
        body,
        sourceCount: topSources.length,
        traceSteps: trace.map((step) => step.step),
      });
    }
    trace.push({
      step: "quality_gate",
      status: evaluation.passed ? "ok" : "error",
      detail: `Deterministic answer quality score ${evaluation.score}.`,
      durationMs: Date.now() - startedAt,
    });

    return await ctx.runMutation((internal as any).events._persistAgentAnswer, {
      eventId: args.eventId,
      sessionId: args.sessionId,
      questionMessageId: args.questionMessageId,
      question,
      normalizedQuestion: prepared.normalizedQuestion,
      body,
      sourceIds: topSources.map((source: any) => source._id),
      trace,
      cacheHit: false,
      agentMode,
      provider: provider.ok ? "anthropic" : "deterministic",
      modelId: provider.model || "bounded-source-synthesizer",
      inputTokens: provider.inputTokens ?? 0,
      outputTokens: provider.outputTokens ?? estimateTokens(body),
      estimatedCostCents: provider.estimatedCostCents ?? 0,
      externalSearches,
      evaluation,
    });
  },
});

export const composeAnswer = mutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    questionMessageId: v.id("liveEventMessages"),
    question: v.string(),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    // Idempotency + dedicated provider-cost rate-limit (Finding #3), identical to
    // askAgent — collapses the askAgent→composeAnswer fallback and double-submits
    // into one answer, and bounds /ask volume per session.
    const reserved = await reserveAskSlot(ctx, args);
    if (reserved.existingAnswer) return reserved.existingAnswer;

    // Shared loader = the SAME integrity check (#2) + cache + prior-turn derivation
    // askAgent runs, so this deterministic fallback can never be weaker than primary.
    const prepared = await loadAskContext(ctx, args);
    const question = prepared.question;
    const normalizedQuestion = prepared.normalizedQuestion;

    // Cache safety (#1 + #4): reuse a cache hit only when it's actually safe; skip
    // + recompute on follow-ups, source staleness, or explicit freshness intent.
    const cacheSkipReason = computeCacheSkipReason({
      cached: prepared.cached,
      priorTurns: prepared.priorTurns,
      sources: prepared.sources,
      question,
    });

    if (prepared.cached && !cacheSkipReason) {
      const answerId = await ctx.db.insert("liveEventAnswers", {
        eventId: args.eventId,
        questionMessageId: args.questionMessageId,
        askedBySessionId: args.sessionId,
        question,
        normalizedQuestion,
        body: prepared.cached.body,
        sourceIds: prepared.cached.sourceIds,
        trace: [
          {
            step: "semantic_cache_lookup",
            status: "ok",
            detail: `Reused public answer ${prepared.cached._id}; source bundle unchanged; private notes excluded.`,
            durationMs: Date.now() - startedAt,
          },
        ],
        cacheHit: true,
        agentMode: "cache",
        provider: prepared.cached.provider,
        modelId: prepared.cached.modelId,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostCents: 0,
        externalSearches: 0,
        evaluation: evaluateAnswerQuality({
          question,
          body: prepared.cached.body,
          sourceCount: prepared.cached.sourceIds.length,
          traceSteps: ["semantic_cache_lookup"],
        }),
        faqStatus: "none",
        createdAt: Date.now(),
      });
      return await buildAnswerPayload(ctx, answerId);
    }

    const retrieveStarted = Date.now();
    const sources = prepared.sources;
    const ranked = sources
      .map((source: any) => ({ source, score: scoreSource(question, source) }))
      .sort((a: any, b: any) => b.score - a.score || b.source.uploadedAt - a.source.uploadedAt);
    const selected = ranked.filter((row: any) => row.score > 0).slice(0, 4);
    const topSources = (selected.length ? selected : ranked.slice(0, 3)).map((row: any) => row.source);
    if (!topSources.length) {
      throw new ConvexError({
        code: "no_sources",
        message: "No event sources are available for sourced /ask yet.",
      });
    }

    const answerBody = synthesizeAnswer(question, prepared.event.name, topSources).slice(0, MAX_ANSWER_BODY);
    const answerId = await ctx.db.insert("liveEventAnswers", {
      eventId: args.eventId,
      questionMessageId: args.questionMessageId,
      askedBySessionId: args.sessionId,
      question,
      normalizedQuestion,
      body: answerBody,
      sourceIds: topSources.map((source: any) => source._id),
      trace: [
        {
          step: "semantic_cache_lookup",
          status: "miss",
          detail: cacheSkipReason
            ? `Cached answer skipped — ${cacheSkipReason}.`
            : "No same-question public answer found for this event.",
          durationMs: retrieveStarted - startedAt,
        },
        {
          step: "bounded_source_retrieval",
          status: "ok",
          detail: `Scored ${sources.length} sources; selected ${topSources.length}.`,
          durationMs: Date.now() - retrieveStarted,
        },
        {
          step: "deterministic_synthesis",
          status: "ok",
          detail: "Generated from public event corpus only; private notes excluded.",
          durationMs: Date.now() - startedAt,
        },
      ],
      cacheHit: false,
      agentMode: "deterministic",
      provider: "deterministic",
      modelId: "bounded-source-synthesizer",
      inputTokens: estimateTokens(`${question}\n${topSources.map((source: any) => source.body).join("\n")}`),
      outputTokens: estimateTokens(answerBody),
      estimatedCostCents: 0,
      externalSearches: 0,
      evaluation: evaluateAnswerQuality({
        question,
        body: answerBody,
        sourceCount: topSources.length,
        traceSteps: ["semantic_cache_lookup", "bounded_source_retrieval", "deterministic_synthesis"],
      }),
      faqStatus: "none",
      createdAt: Date.now(),
    });
    return await buildAnswerPayload(ctx, answerId);
  },
});

export const suggestAnswerForFaq = mutation({
  args: {
    eventId: v.id("liveEvents"),
    answerId: v.id("liveEventAnswers"),
    sessionId: v.string(),
  },
  handler: async (ctx, { eventId, answerId, sessionId }) => {
    await requireMember(ctx, eventId, sessionId);
    const answer = await ctx.db.get(answerId);
    if (!answer || answer.eventId !== eventId) {
      throw new ConvexError({ code: "answer_not_found", message: "Answer no longer exists." });
    }
    if (answer.faqStatus === "none") {
      await ctx.db.patch(answerId, { faqStatus: "suggested" });
    }
    return { ok: true, faqStatus: answer.faqStatus === "promoted" ? "promoted" : "suggested" };
  },
});

/**
 * claimHost — Phase 1-3 legacy entry point. KEPT FOR BACKWARD COMPAT.
 *
 * The client picks an 8+ char ownerKey and "owns" the event. This is
 * structurally exclusive (one owner per event) but does NOT prove
 * identity — anyone who races to call this first becomes owner.
 *
 * Phase 4 callers should use `requestHostClaim` + `claimHostWithCode`
 * instead, which give the same surface but require possession of a
 * server-issued one-time code. This entry point remains so:
 *   - the dogfood static-key flow keeps passing
 *   - in-flight legacy localStorage sessions don't break mid-deploy
 *     (expand-contract per .claude/rules/backend_contract_migration.md)
 *
 * Hardenings vs. Phase 1-3:
 *   - Rejects ownerKeys starting with "hk1:" — those go through
 *     claimHostWithCode. Allowing them here would let a leaked legacy
 *     ownerKey forge a real-auth host row.
 *   - Records authMethod=legacy_ownerkey so future audits can sort.
 */
export const claimHost = mutation({
  args: {
    eventId: v.id("liveEvents"),
    ownerKey: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, { eventId, ownerKey, displayName }) => {
    requireOwnerKey(ownerKey);
    // Reject HMAC tokens here — those go through claimHostWithCode.
    // Allowing them in claimHost would let a leaked legacy ownerKey
    // impersonate a real-auth host row.
    if (ownerKey.startsWith(HOST_TOKEN_PREFIX)) {
      throw new ConvexError({
        code: "use_claim_host_with_code",
        message: "HMAC tokens must be claimed via claimHostWithCode after requestHostClaim.",
      });
    }
    const existingForOwner = await ctx.db
      .query("liveEventHosts")
      .withIndex("by_event_owner", (q) => q.eq("eventId", eventId).eq("ownerKey", ownerKey))
      .first();
    if (existingForOwner) {
      return { ok: true, hostId: existingForOwner._id, role: existingForOwner.role, created: false };
    }
    const existingHosts = await ctx.db
      .query("liveEventHosts")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .take(1);
    if (existingHosts.length > 0) {
      throw new ConvexError({
        code: "host_already_claimed",
        message: "This room already has a host.",
      });
    }
    const hostId = await ctx.db.insert("liveEventHosts", {
      eventId,
      ownerKey,
      displayName: (displayName || "Host").slice(0, MAX_DISPLAY_NAME).trim() || "Host",
      role: "owner",
      authMethod: "legacy_ownerkey",
      createdAt: Date.now(),
    });
    return { ok: true, hostId, role: "owner", created: true };
  },
});

/**
 * requestHostClaim — Phase 4 step 1: server generates a one-time claim code.
 *
 * Returns the plaintext code EXACTLY ONCE. The caller must:
 *   - Show it to the legitimate host out-of-band (event creator email,
 *     printed page, organizer dashboard) OR
 *   - Immediately call claimHostWithCode on the SAME browser session that
 *     just generated the code (the bootstrap UX for scratchnode.live).
 *
 * Idempotency / replay:
 *   - If a host with authMethod=claim_code already exists for this event,
 *     the code may only be regenerated by the existing host (proven by
 *     supplying their current HMAC token in existingOwnerKey) — supports
 *     rotation / device migration.
 *   - If a legacy host (authMethod=legacy_ownerkey) holds the event, the
 *     code cannot be regenerated through this endpoint — the legacy
 *     ownerKey path must be used. Prevents bypass via "request a code,
 *     legacy holder didn't see it, race to claim".
 *   - Each call OVERWRITES the previous hash — old codes stop working
 *     immediately. "Lost the code? request a new one" is the legitimate
 *     recovery path for an unclaimed event.
 *
 * Pre-claim window (no host exists):
 *   - ANY member can request a code. This matches the legacy claimHost
 *     race semantics but adds proof-of-possession (need both the code
 *     AND the subsequent claimHostWithCode call to win). The pre-claim
 *     window closes the moment the first claimHostWithCode succeeds.
 */
export const requestHostClaim = mutation({
  args: {
    eventId: v.id("liveEvents"),
    // requesterSessionId is the joinEvent sessionId of the caller. We
    // require that the caller is a member of the event (proves they
    // can at least see the room) so this isn't a drive-by enumeration.
    requesterSessionId: v.string(),
    // If this event is already held by a real-auth host, the existing
    // host can rotate by providing their current ownerKey (HMAC token).
    // Required only when an existing claim_code host exists.
    existingOwnerKey: v.optional(v.string()),
    // Phase 4 follow-up Item 1: optional out-of-band email channel. When
    // present and well-formed, the mutation schedules a fire-and-forget
    // action (convex/email.ts:sendHostClaimCodeEmail) to deliver the
    // plaintext code by email. The mutation STILL returns the code
    // synchronously — email is a convenience channel, not a source of
    // truth. Failed delivery does NOT break the claim flow.
    deliverToEmail: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, requesterSessionId, existingOwnerKey, deliverToEmail }) => {
    // Membership gate — same shape as composeAnswer / suggestAnswerForFaq.
    await requireMember(ctx, eventId, requesterSessionId);
    // Rate-limit host-claim requests per session: each generates a claim code
    // (and may schedule a delivery email). 5 per 10 min stops claim-code
    // grinding while leaving room for a host who fat-fingers the flow.
    await enforceRateLimit(ctx, {
      key: `hostclaim:${requesterSessionId}`,
      limit: 5,
      windowMs: 600_000,
    });
    const event = await ctx.db.get(eventId);
    if (!event) {
      throw new ConvexError({ code: "event_not_found", message: "Event no longer exists." });
    }
    const existingHosts = await ctx.db
      .query("liveEventHosts")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .take(2);
    if (existingHosts.length > 0) {
      const realAuthHost = existingHosts.find((h) => h.authMethod === "claim_code");
      const legacyHost = existingHosts.find((h) => h.authMethod !== "claim_code");
      if (realAuthHost) {
        // Rotation path — must prove possession of current token.
        if (!existingOwnerKey) {
          throw new ConvexError({
            code: "claim_code_rotation_requires_token",
            message: "Event already has a real-auth host. Provide existingOwnerKey to rotate.",
          });
        }
        await requireHost(ctx, eventId, existingOwnerKey);
        // proceed below — caller is the existing host, allowed to rotate
      } else if (legacyHost) {
        // Legacy host holds the event. Can't upgrade through this endpoint
        // because we have no way to verify the legacy host is the one
        // requesting (they chose their own ownerKey).
        throw new ConvexError({
          code: "legacy_host_must_rotate_first",
          message:
            "Event held by a legacy host. The legacy host must release or rotate via claimHost before requesting a code.",
        });
      }
    }
    const code = generateClaimCode();
    const codeHash = await sha256Hex(`${eventId}|${code}`);
    await ctx.db.patch(eventId, {
      hostClaimCodeHash: codeHash,
      hostClaimCodeCreatedAt: Date.now(),
    });
    const expiresHintAt = Date.now() + 30 * 60 * 1000;

    // Phase 4 follow-up Item 1 — optional email channel.
    // Fire-and-forget: schedule the action so the mutation can return
    // synchronously. Validation here is cheap (regex + length) — the
    // action re-validates as defense in depth. Failures inside the
    // action are logged but do NOT break the claim flow.
    if (deliverToEmail !== undefined) {
      if (isLikelyValidEmail(deliverToEmail)) {
        await ctx.scheduler.runAfter(
          0,
          internal.email.sendHostClaimCodeEmail,
          {
            email: deliverToEmail.trim(),
            code,
            eventName: event.name,
            expiresHintAt,
          },
        );
      }
      // Malformed email: silently skip scheduling. We don't throw because
      // the plaintext code is still being returned to the caller, and a
      // bad email is a UX issue, not a security issue. (Future: surface
      // a soft warning field in the response if UX needs it.)
    }

    // Return the plaintext code EXACTLY ONCE. Caller must persist it
    // immediately — it is never recoverable from the database.
    return {
      ok: true,
      hostClaimCode: code,
      // Bound how long the UI should wait before assuming the code is
      // stale. Not enforced server-side (the hash is the source of
      // truth) — purely for UX. requestHostClaim can be re-called any
      // time to mint a new code.
      expiresHintAt,
    };
  },
});

/**
 * claimHostWithCode — Phase 4 step 2: redeem the one-time code, receive
 * a server-issued HMAC token, become host.
 *
 * On success:
 *   - Removes the claim code hash from the event (single-use).
 *   - Inserts liveEventHosts row with authMethod=claim_code.
 *   - Returns the HMAC token. Caller MUST store it (localStorage) — it
 *     is the ONLY way to authenticate as host going forward.
 *
 * Race semantics:
 *   - Two concurrent claimHostWithCode calls for the same event: Convex
 *     mutations are serialized, so the second call finds the hash
 *     cleared and rejects with code_invalid.
 *
 * Re-using the same code twice:
 *   - First call clears the hash. Second call sees no hash → rejects
 *     with code_invalid. To re-issue, the caller must go back to
 *     requestHostClaim.
 */
export const claimHostWithCode = mutation({
  args: {
    eventId: v.id("liveEvents"),
    hostClaimCode: v.string(),
    displayName: v.string(),
    requesterSessionId: v.string(),
  },
  handler: async (ctx, { eventId, hostClaimCode, displayName, requesterSessionId }) => {
    await requireMember(ctx, eventId, requesterSessionId);
    const code = (hostClaimCode || "").trim();
    if (!code || code.length < 16 || code.length > 64) {
      throw new ConvexError({
        code: "code_invalid",
        message: "Host claim code must be 16-64 chars.",
      });
    }
    const event = await ctx.db.get(eventId);
    if (!event) {
      throw new ConvexError({ code: "event_not_found", message: "Event no longer exists." });
    }
    if (!event.hostClaimCodeHash) {
      throw new ConvexError({
        code: "code_invalid",
        message: "No active host claim code for this event. Request a new code first.",
      });
    }
    const submittedHash = await sha256Hex(`${eventId}|${code}`);
    if (!constantTimeEquals(submittedHash, event.hostClaimCodeHash)) {
      throw new ConvexError({
        code: "code_invalid",
        message: "Host claim code did not match.",
      });
    }
    // Code matches. Check for an existing real-auth host (rotation case).
    // Convex mutations are serialized per-document so this is safe.
    const existingHosts = await ctx.db
      .query("liveEventHosts")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .take(2);
    const issuedAt = Date.now();
    const newOwnerKey = await issueHostToken(eventId, issuedAt);
    const safeName =
      (displayName || "Host").slice(0, MAX_DISPLAY_NAME).trim() || "Host";
    // Clear the claim-code hash atomically with the host insert so the
    // code is single-use.
    await ctx.db.patch(eventId, {
      hostClaimCodeHash: undefined,
      hostClaimCodeCreatedAt: undefined,
    });
    // If there's an existing real-auth host (rotation), revoke it by
    // deleting that row. Legacy hosts (authMethod != claim_code) are
    // explicitly NOT auto-revoked here — the legacy_host_must_rotate
    // gate in requestHostClaim already blocks that path.
    for (const h of existingHosts) {
      if (h.authMethod === "claim_code") {
        await ctx.db.delete(h._id);
      }
    }
    const hostId = await ctx.db.insert("liveEventHosts", {
      eventId,
      ownerKey: newOwnerKey,
      displayName: safeName,
      role: "owner",
      authMethod: "claim_code",
      createdAt: issuedAt,
    });
    return {
      ok: true,
      hostId,
      role: "owner" as const,
      // The token IS the ownerKey going forward. Caller must persist it.
      ownerKey: newOwnerKey,
    };
  },
});

export const promoteAnswerToFaq = mutation({
  args: {
    eventId: v.id("liveEvents"),
    answerId: v.id("liveEventAnswers"),
    ownerKey: v.string(),
  },
  handler: async (ctx, { eventId, answerId, ownerKey }) => {
    await requireHost(ctx, eventId, ownerKey);
    const answer = await ctx.db.get(answerId);
    if (!answer || answer.eventId !== eventId) {
      throw new ConvexError({ code: "answer_not_found", message: "Answer no longer exists." });
    }
    await ctx.db.patch(answerId, { faqStatus: "promoted" });
    return { ok: true, faqStatus: "promoted" };
  },
});

export const publishWiki = mutation({
  args: {
    eventId: v.id("liveEvents"),
    ownerKey: v.string(),
  },
  handler: async (ctx, { eventId, ownerKey }) => {
    const host = await requireHost(ctx, eventId, ownerKey);
    const event = await ctx.db.get(eventId);
    if (!event) {
      throw new ConvexError({ code: "event_not_found", message: "Event no longer exists." });
    }
    const answers = await ctx.db
      .query("liveEventAnswers")
      .withIndex("by_event_time", (q) => q.eq("eventId", eventId))
      .order("desc")
      .take(MAX_WIKI_ANSWERS);
    const promoted = answers.filter((answer) => answer.faqStatus === "promoted");
    const publicAnswers = (promoted.length ? promoted : answers.slice(0, 8)).reverse();
    const sourceIds = Array.from(new Set(publicAnswers.flatMap((answer) => answer.sourceIds)));
    const latest = await ctx.db
      .query("liveEventWikiVersions")
      .withIndex("by_event_version", (q) => q.eq("eventId", eventId))
      .order("desc")
      .first();
    const version = (latest?.version ?? 0) + 1;
    const bodyHtml = await buildWikiHtml(ctx, event.name, publicAnswers, sourceIds);
    const wikiId = await ctx.db.insert("liveEventWikiVersions", {
      eventId,
      version,
      status: "published",
      title: `${event.name} Wiki`,
      bodyHtml,
      sourceAnswerIds: publicAnswers.map((answer) => answer._id),
      sourceIds,
      createdByOwnerKey: host.ownerKey,
      createdAt: Date.now(),
      publishedAt: Date.now(),
    });
    return { ok: true, wikiId, version };
  },
});

/**
 * releaseHost — relinquish host ownership of an event.
 *
 * Why this exists: once a `liveEventHosts` row exists, both `claimHost` and
 * `requestHostClaim` refuse to proceed (a different ownerKey gets either
 * `host_already_claimed` or `legacy_host_must_rotate_first`). Without a
 * release path, an event whose host loses access OR a test event that needs
 * to be reset is permanently stuck. This is the canonical release.
 *
 * Auth: the caller must prove possession of the CURRENT host's ownerKey —
 * either the legacy plain-string format OR the `hk1:` HMAC token. Same
 * `requireHost` gate that `promoteAnswerToFaq` / `publishWiki` use.
 *
 * Side effects:
 *   - Deletes ALL `liveEventHosts` rows for this eventId (rotation history
 *     can leave more than one row from prior `claimHostWithCode` migrations;
 *     this clears them all so the next host starts from a clean state).
 *   - Clears `liveEvents.hostClaimCodeHash` + `hostClaimCodeCreatedAt` so a
 *     dangling code mid-rotation doesn't become exploitable.
 *
 * HONEST_STATUS: emits `console.warn` for audit visibility — host release
 * is a destructive operation and operators should see it in logs.
 *
 * Idempotency: a second call from a now-non-host caller throws `not_host`
 * (because the host row was just deleted). This is correct — the operation
 * was applied, the contract is "you must be the current host to call this."
 */
/**
 * _adminForceReleaseHost — internal admin tool for one-time pollution
 * recovery. NEVER call from user-facing code. Callable ONLY via:
 *
 *   npx convex run --prod events:_adminForceReleaseHost '{"eventId":"..."}'
 *
 * Use case: an event was claimed by a now-unknown ownerKey (e.g., an
 * earlier dogfood run with a RUN_ID-randomized key). The legitimate
 * `releaseHost` mutation requires the current host's ownerKey, so the
 * event is stuck — neither legacy `claimHost` nor Phase 4
 * `requestHostClaim` can proceed. This internal mutation force-deletes
 * all liveEventHosts rows + clears any dangling claim code WITHOUT
 * proving host ownership.
 *
 * Security:
 *   - `internalMutation` is NOT exposed via api.* — only via
 *     `internal.events._adminForceReleaseHost`, which Convex restricts
 *     to server-side callers (CLI via `npx convex run`, scheduler,
 *     crons, other actions).
 *   - The HTTP /api/mutation endpoint refuses internal paths — a
 *     curl POST to "events:_adminForceReleaseHost" returns
 *     function_not_found.
 *   - Audit log emitted via console.warn for forensic visibility.
 *
 * Naming convention:
 *   - Leading underscore signals "internal, do not call from frontend"
 *     (same convention as `_evictStalePresence`, `_evictStaleHostClaimCodes`).
 *   - `Unsafe` not in the name to keep the CLI command paste-friendly,
 *     but the JSDoc above is the canonical "do not use lightly" warning.
 */
export const _adminForceReleaseHost = internalMutation({
  args: {
    eventId: v.id("liveEvents"),
  },
  handler: async (ctx, { eventId }) => {
    const allHosts = await ctx.db
      .query("liveEventHosts")
      .withIndex("by_event", (q: any) => q.eq("eventId", eventId))
      .collect();
    let hostsDeleted = 0;
    for (const row of allHosts) {
      await ctx.db.delete(row._id);
      hostsDeleted += 1;
    }
    const event = await ctx.db.get(eventId);
    if (event && (event.hostClaimCodeHash || event.hostClaimCodeCreatedAt)) {
      await ctx.db.patch(eventId, {
        hostClaimCodeHash: undefined,
        hostClaimCodeCreatedAt: undefined,
      });
    }
    console.warn(
      `[_adminForceReleaseHost] eventId=${eventId} hostsDeleted=${hostsDeleted} ` +
        `(force release — no auth check; called via internal admin path)`,
    );
    return { ok: true, released: hostsDeleted > 0, hostsDeleted };
  },
});

export const releaseHost = mutation({
  args: {
    eventId: v.id("liveEvents"),
    ownerKey: v.string(),
  },
  handler: async (ctx, { eventId, ownerKey }) => {
    const callingHost = await requireHost(ctx, eventId, ownerKey);
    // Pull every host row for the event — rotation may have left more than
    // one. Use the by_event index so we don't scan the full table.
    const allHosts = await ctx.db
      .query("liveEventHosts")
      .withIndex("by_event", (q: any) => q.eq("eventId", eventId))
      .collect();
    let hostsDeleted = 0;
    for (const row of allHosts) {
      await ctx.db.delete(row._id);
      hostsDeleted += 1;
    }
    // Defensive: clear any dangling claim code so the event is fully reset.
    const event = await ctx.db.get(eventId);
    if (event && (event.hostClaimCodeHash || event.hostClaimCodeCreatedAt)) {
      await ctx.db.patch(eventId, {
        hostClaimCodeHash: undefined,
        hostClaimCodeCreatedAt: undefined,
      });
    }
    console.warn(
      `[releaseHost] eventId=${eventId} hostsDeleted=${hostsDeleted} ` +
        `by=${callingHost.role} authMethod=${callingHost.authMethod ?? "legacy_ownerkey"}`,
    );
    return { ok: true, released: hostsDeleted > 0, hostsDeleted };
  },
});

/**
 * Cheap presence heartbeat. UI calls this every 30s. Idempotent — early-returns
 * if lastSeenAt was bumped within the last 15s (rate-limits accidental spam).
 */
export const heartbeat = mutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
  },
  handler: async (ctx, { eventId, sessionId }) => {
    const member = await ctx.db
      .query("liveEventMembers")
      .withIndex("by_event_session", (q) =>
        q.eq("eventId", eventId).eq("sessionId", sessionId),
      )
      .first();
    if (!member) {
      // Not joined — caller should call joinEvent. Return false so UI can react.
      return { ok: false, reason: "not_joined" };
    }
    const now = Date.now();
    if (now - member.lastSeenAt < 15_000) {
      return { ok: true, skipped: true };
    }
    await ctx.db.patch(member._id, { lastSeenAt: now });
    return { ok: true, skipped: false };
  },
});

/**
 * Idempotent seed for the demo event. Safe to call repeatedly; only inserts
 * if the slug isn't already present. Used by the dev/admin tooling — not
 * called automatically by joinEvent for non-demo slugs.
 */
export const ensureDemoEvent = mutation({
  args: {},
  handler: async (ctx) => {
    if (!canSeedDemoEvent()) {
      throw new ConvexError({
        code: "demo_seed_disabled",
        message: "Demo seeding is disabled on this deployment.",
      });
    }
    const existing = await ctx.db
      .query("liveEvents")
      .withIndex("by_slug", (q) => q.eq("slug", "ai-infra-summit-2026"))
      .first();
    if (existing) {
      const sourcesInserted = await ensureDemoSourcesForEvent(ctx, existing._id);
      return { eventId: existing._id, created: false, sourcesInserted };
    }
    const id = await ctx.db.insert("liveEvents", {
      slug: "ai-infra-summit-2026",
      name: "AI Infra Summit",
      roomCode: "ORBITAL",
      status: "live",
      startedAt: Date.now(),
    });
    const sourcesInserted = await ensureDemoSourcesForEvent(ctx, id);
    return { eventId: id, created: true, sourcesInserted };
  },
});

/**
 * One-off operator tool — reseed the public showcase room with a clean,
 * curated demo so launch visitors never see dogfood/QA test residue.
 *
 * Wipes ALL messages, answers, and wiki versions for the target event (scoped
 * by eventId), re-ensures the public demo sources (idempotent), seeds a short
 * realistic conversation + two promoted /ask answers, and republishes a clean
 * wiki snapshot. Answer evaluation is computed from the seed content (HONEST_
 * SCORES — no hardcoded floor). Direct inserts intentionally bypass the
 * member/presence + rate-limit gates: this is an operator seed, not a live send.
 *
 * internalMutation → not callable from the public API. Run via:
 *   npx convex run events:_reseedShowcaseEvent '{}'
 * (deploy key required). Defaults to the ai-infra-summit-2026 showcase.
 */
export const _reseedShowcaseEvent = internalMutation({
  args: { slug: v.optional(v.string()) },
  handler: async (ctx, { slug }) => {
    const targetSlug = slug || "ai-infra-summit-2026";
    const event = await ctx.db
      .query("liveEvents")
      .withIndex("by_slug", (q) => q.eq("slug", targetSlug))
      .first();
    if (!event) return { ok: false as const, reason: "event_not_found", slug: targetSlug };
    const eventId = event._id;

    // 1. Wipe polluted feed / answers / wiki for this event only.
    let deletedMessages = 0;
    for (const m of await ctx.db
      .query("liveEventMessages")
      .withIndex("by_event_time", (q) => q.eq("eventId", eventId))
      .collect()) {
      await ctx.db.delete(m._id);
      deletedMessages++;
    }
    let deletedAnswers = 0;
    for (const a of await ctx.db
      .query("liveEventAnswers")
      .withIndex("by_event_time", (q) => q.eq("eventId", eventId))
      .collect()) {
      await ctx.db.delete(a._id);
      deletedAnswers++;
    }
    let deletedWiki = 0;
    for (const w of await ctx.db
      .query("liveEventWikiVersions")
      .withIndex("by_event_version", (q) => q.eq("eventId", eventId))
      .collect()) {
      await ctx.db.delete(w._id);
      deletedWiki++;
    }

    // 2. Ensure clean public demo sources, then collect their ids.
    await ensureDemoSourcesForEvent(ctx, eventId);
    const sourceRows = await ctx.db
      .query("liveEventSources")
      .withIndex("by_event_uri", (q) => q.eq("eventId", eventId))
      .collect();
    const seededIds = sourceRows.filter((s) => s.isSeeded).map((s) => s._id);
    const sourceIds = (seededIds.length ? seededIds : sourceRows.map((s) => s._id)).slice(0, 5);

    // 3. Seed a short, realistic conversation (backdated so timestamps read naturally).
    const t0 = Date.now() - 18 * 60_000;
    const chat = async (
      displayName: string,
      text: string,
      minute: number,
      kind: "chat" | "ask" = "chat",
    ) =>
      await ctx.db.insert("liveEventMessages", {
        eventId,
        sessionId: `seed-showcase-${displayName.toLowerCase().replace(/\s+/g, "-")}`,
        displayName,
        text,
        kind,
        createdAt: t0 + minute * 60_000,
      });

    await chat("Priya Nadkarni", "Welcome to the AI Infra Summit live room. Ask anything here, and use /ask for a sourced answer pulled from the public session notes.", 0);
    await chat("Marcus Lee", "The enterprise auth panel was excellent. Anyone capture the recommendation for MCP servers?", 2);
    const q1 = await chat("Marcus Lee", "What did the panel recommend for MCP enterprise authentication?", 3, "ask");
    await chat("Aisha Khan", "Also loved the bounded tool-registry section — progressive discovery is underrated for keeping agents fast.", 5);
    await chat("Tomas Rivera", "Did they cover how to keep long-running agent loops from burning budget?", 7);
    const q2 = await chat("Tomas Rivera", "How should teams control runaway cost in long-running agent loops?", 8, "ask");
    await chat("Priya Nadkarni", "Great questions — the wiki updates live from the public /ask answers, so newcomers can catch up fast.", 10);

    // 4. Seed two promoted /ask answers; evaluation computed from the content.
    const mkEval = (body: string, srcCount: number) => {
      const checks = [
        { name: "grounded_in_public_sources", status: (srcCount > 0 ? "pass" : "fail") as "pass" | "warn" | "fail", detail: `${srcCount} public sources attached.` },
        { name: "answer_has_body", status: (body.length >= 120 ? "pass" : "warn") as "pass" | "warn" | "fail", detail: `${body.length} characters.` },
        { name: "public_private_boundary", status: "pass" as "pass" | "warn" | "fail", detail: "No private-note content in answer body." },
      ];
      const failed = checks.filter((c) => c.status === "fail").length;
      const warned = checks.filter((c) => c.status === "warn").length;
      return { passed: failed === 0, score: Math.max(0, 100 - failed * 35 - warned * 10), checks };
    };
    const mkTrace = (srcCount: number) => [
      { step: "classify_query", status: "ok" as const, detail: "Identified a public event question.", durationMs: 6 },
      { step: "retrieve_public_sources", status: "ok" as const, detail: `Matched ${srcCount} public sources.`, durationMs: 14 },
      { step: "compose_answer", status: "ok" as const, detail: "Synthesized from the public event corpus.", durationMs: 9 },
    ];
    const seedAnswer = async (questionMessageId: any, question: string, body: string) => {
      const trimmed = body.slice(0, MAX_ANSWER_BODY);
      return await ctx.db.insert("liveEventAnswers", {
        eventId,
        questionMessageId,
        askedBySessionId: "seed-showcase",
        question,
        normalizedQuestion: question.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim(),
        body: trimmed,
        sourceIds,
        trace: mkTrace(sourceIds.length),
        cacheHit: false,
        agentMode: "deterministic" as const,
        externalSearches: 0,
        evaluation: mkEval(trimmed, sourceIds.length),
        faqStatus: "promoted" as const,
        createdAt: Date.now(),
      });
    };
    const body1 = "Based on the public session notes: panelists recommended treating MCP servers like any other production service — short-lived scoped credentials over static API keys, an explicit per-client allow-list of tools, and server-side enforcement of every host-only action (never trust the UI). They stressed auditing tool calls and rotating secrets on a fixed cadence. Next move: inventory which MCP tools each client can reach today, then gate the destructive ones behind a host check.";
    const body2 = "From the public notes: bound every loop. Set a per-run budget (wall-clock, tokens, and tool-call count), put timeouts with abort signals on external calls so one hung provider can't stall a lane, cache repeated lookups, and fall back to a deterministic answer when a provider is slow. Track cost per answer so regressions are visible. Next move: add an abort + budget gate to your slowest external call first — it usually pays for itself immediately.";
    const a1 = await seedAnswer(q1, "What did the panel recommend for MCP enterprise authentication?", body1);
    const a2 = await seedAnswer(q2, "How should teams control runaway cost in long-running agent loops?", body2);

    // 5. Republish a clean wiki snapshot from the curated answers.
    const bodyHtml = await buildWikiHtml(
      ctx,
      event.name,
      [
        { question: "What did the panel recommend for MCP enterprise authentication?", body: body1 },
        { question: "How should teams control runaway cost in long-running agent loops?", body: body2 },
      ],
      sourceIds,
    );
    const wikiId = await ctx.db.insert("liveEventWikiVersions", {
      eventId,
      version: 1,
      status: "published",
      title: `${event.name} Wiki`,
      bodyHtml,
      sourceAnswerIds: [a1, a2],
      sourceIds,
      createdByOwnerKey: "system_reseed",
      createdAt: Date.now(),
      publishedAt: Date.now(),
    });

    return {
      ok: true as const,
      eventId,
      slug: targetSlug,
      deletedMessages,
      deletedAnswers,
      deletedWiki,
      seededMessages: 7,
      seededAnswers: 2,
      sources: sourceIds.length,
      wikiId,
    };
  },
});

// ─── INTERNAL: presence janitor (called from crons.ts) ──────────────────

/**
 * Internal cron handler — deletes liveEventMembers rows whose lastSeenAt is
 * older than the presence TTL. Bounded delete: max 500 per run to avoid
 * blowing the mutation budget when an event ends with many attendees.
 */
export const _evictStalePresence = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    // Scan all events' stale rows (no by-event narrowing — janitor is global).
    // Index by_event_lastSeen lets us at least range-scan within each event,
    // but Convex doesn't support index-less full scans cheaply. For Phase 1
    // this is acceptable: usually <10 active events at once.
    const stale = await ctx.db
      .query("liveEventMembers")
      .filter((q) => q.lt(q.field("lastSeenAt"), cutoff))
      .take(500);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    return { evicted: stale.length };
  },
});

/**
 * Phase 4 follow-up Item 5 — soft-prune stale host-claim-code hashes.
 *
 * Defense-in-depth janitor. `requestHostClaim` writes a code hash + minted-at
 * timestamp on the event row; `claimHostWithCode` clears both atomically on
 * a successful redemption. If a user mints a code and never redeems, the hash
 * lingers — codes already have ~120 bits of entropy (24 chars A-Z2-9), but
 * letting the hash sit forever widens the brute-force attack window for no
 * reason. This cron narrows that window to ~30 min.
 *
 * Contract:
 *   - Runs every 10 min from convex/crons.ts.
 *   - Clears `hostClaimCodeHash` and `hostClaimCodeCreatedAt` on rows where
 *     `hostClaimCodeCreatedAt < Date.now() - HOST_CLAIM_CODE_TTL_MS`.
 *   - Rows without a hash (no claim ever requested, or already-redeemed) are
 *     filtered out by the `hostClaimCodeCreatedAt` lt-check (undefined fails
 *     lt comparison) — they are never patched.
 *   - BOUND: at most MAX_STALE_HOST_CLAIM_EVICT rows per run. If more accrue
 *     than that in a 10-min window, the next tick catches them.
 *   - HONEST_STATUS: returns { evicted: N } so the operator surface (and
 *     tests) can verify behavior.
 *
 * Idempotent — patching `undefined` onto an already-cleared row is a no-op
 * (Convex treats `undefined` as field-removal).
 */
export const _evictStaleHostClaimCodes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - HOST_CLAIM_CODE_TTL_MS;
    // Filter on hostClaimCodeCreatedAt (the timestamp). Convex `q.lt` against
    // an undefined field yields false, so rows that never minted a code are
    // skipped — exactly the behavior we want.
    const stale = await ctx.db
      .query("liveEvents")
      .filter((q) => q.lt(q.field("hostClaimCodeCreatedAt"), cutoff))
      .take(MAX_STALE_HOST_CLAIM_EVICT);
    let evicted = 0;
    for (const row of stale) {
      // Belt-and-suspenders: only patch when the hash is actually set. The
      // filter above should already guarantee this, but checking the hash
      // explicitly keeps the eviction safe if the filter ever loosens.
      if (!row.hostClaimCodeHash) continue;
      await ctx.db.patch(row._id, {
        hostClaimCodeHash: undefined,
        hostClaimCodeCreatedAt: undefined,
      });
      evicted += 1;
    }
    return { evicted };
  },
});
