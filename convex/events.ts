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
 *   - joinEvent({ slug, sessionId, displayName }) // returns { eventId, ... }
 *   - sendMessage({ eventId, sessionId, displayName, text, kind, replyToMessageId? })
 *   - heartbeat({ eventId, sessionId })
 *   - ensureDemoEvent()                            // seeds ai-infra-summit-2026 if missing
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
import { query, mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

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
const MAX_ANSWER_LIMIT = 100;
const MAX_WIKI_ANSWERS = 20;
// Phase 4 raised this from 80 -> 120 to fit HMAC-signed host tokens
// (hk1:<eventIdShort>:<nonce>:<issuedAt>:<hmacShort> ~ 80-90 chars).
// 120 is still tight enough to reject obvious junk.
const MAX_OWNER_KEY_LEN = 120;

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
  if (parts.length !== 4) return false;
  const [eventIdShort, nonce, issuedAtStr, hmacShort] = parts;
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
 * Fetch an event by its slug. Returns null if missing — callers (UI) should
 * fall back to the demo event flow.
 */
export const getEventBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    if (!slug || slug.length > 120) return null;
    const event = await ctx.db
      .query("liveEvents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    return event;
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
 */
export const getMembers = query({
  args: { eventId: v.id("liveEvents") },
  handler: async (ctx, { eventId }) => {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    const all = await ctx.db
      .query("liveEventMembers")
      .withIndex("by_event_lastSeen", (q) =>
        q.eq("eventId", eventId).gte("lastSeenAt", cutoff),
      )
      .collect();
    return all;
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

// ─── MUTATIONS ────────────────────────────────────────────────────────────

/**
 * Idempotent join: upsert liveEventMembers by (eventId, sessionId).
 * Auto-creates the demo event on first call if missing.
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

    let event = await ctx.db
      .query("liveEvents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();

    // Auto-seed the demo event so the first visitor to scratchnode.live
    // doesn't hit an empty room.
    if (!event && slug === "ai-infra-summit-2026") {
      const id = await ctx.db.insert("liveEvents", {
        slug: "ai-infra-summit-2026",
        name: "AI Infra Summit",
        roomCode: "ORBITAL",
        status: "live",
        startedAt: Date.now(),
      });
      event = await ctx.db.get(id);
    }
    if (!event) {
      throw new ConvexError({ code: "event_not_found", message: "No such event slug." });
    }
    if (event.slug === "ai-infra-summit-2026") {
      await ensureDemoSourcesForEvent(ctx, event._id);
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
 * composeAnswer — Phase 2 deterministic synthesis for /ask in live events.
 *
 * Ranks event sources by source-token-overlap against the question, then
 * stitches a citation-grounded answer together with NO LLM call. This is the
 * Phase 2 wiring that runs today.
 *
 * The future LLM-backed action (vector search + Anthropic) will ship as a
 * separate function named `askAgent` when the Anthropic integration lands —
 * see public/proto/docs.html "Live prod plan / Phase 2". Renaming this
 * function frees the `askAgent` name for that real-LLM caller and prevents
 * future readers from assuming LLM behavior that isn't here.
 */
export const composeAnswer = mutation({
  args: {
    eventId: v.id("liveEvents"),
    sessionId: v.string(),
    questionMessageId: v.id("liveEventMessages"),
    question: v.string(),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const question = (args.question || "").trim().slice(0, 1000);
    if (!question) {
      throw new ConvexError({ code: "empty_question", message: "/ask question required." });
    }
    const event = await ctx.db.get(args.eventId);
    if (!event) {
      throw new ConvexError({ code: "event_not_found", message: "Event no longer exists." });
    }
    if (event.status === "ended") {
      throw new ConvexError({ code: "event_ended", message: "This event has ended." });
    }
    await requireMember(ctx, args.eventId, args.sessionId);
    if (event.slug === "ai-infra-summit-2026") {
      await ensureDemoSourcesForEvent(ctx, args.eventId);
    }

    const normalizedQuestion = normalizeQuestion(question);
    const cached = await ctx.db
      .query("liveEventAnswers")
      .withIndex("by_event_normalized", (q) =>
        q.eq("eventId", args.eventId).eq("normalizedQuestion", normalizedQuestion),
      )
      .order("desc")
      .first();

    if (cached) {
      const answerId = await ctx.db.insert("liveEventAnswers", {
        eventId: args.eventId,
        questionMessageId: args.questionMessageId,
        question,
        normalizedQuestion,
        body: cached.body,
        sourceIds: cached.sourceIds,
        trace: [
          {
            step: "semantic_cache_lookup",
            status: "ok",
            detail: `Reused answer ${cached._id}; source bundle unchanged.`,
            durationMs: Date.now() - startedAt,
          },
        ],
        cacheHit: true,
        faqStatus: "none",
        createdAt: Date.now(),
      });
      return await buildAnswerPayload(ctx, answerId);
    }

    const retrieveStarted = Date.now();
    const sources = await ctx.db
      .query("liveEventSources")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .take(100);
    const ranked = sources
      .map((source) => ({ source, score: scoreSource(question, source) }))
      .sort((a, b) => b.score - a.score || b.source.uploadedAt - a.source.uploadedAt);
    const selected = ranked.filter((row) => row.score > 0).slice(0, 4);
    const topSources = (selected.length ? selected : ranked.slice(0, 3)).map((row) => row.source);
    if (!topSources.length) {
      throw new ConvexError({
        code: "no_sources",
        message: "No event sources are available for sourced /ask yet.",
      });
    }

    const answerBody = synthesizeAnswer(question, event.name, topSources).slice(0, MAX_ANSWER_BODY);
    const answerId = await ctx.db.insert("liveEventAnswers", {
      eventId: args.eventId,
      questionMessageId: args.questionMessageId,
      question,
      normalizedQuestion,
      body: answerBody,
      sourceIds: topSources.map((source) => source._id),
      trace: [
        {
          step: "semantic_cache_lookup",
          status: "miss",
          detail: "No same-question public answer found for this event.",
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
