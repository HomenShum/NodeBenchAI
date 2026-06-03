import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const eventsSource = readFileSync(join(here, "events.ts"), "utf8");
const notesSource = readFileSync(join(here, "notes.ts"), "utf8");
const wallSource = readFileSync(join(here, "wall.ts"), "utf8");
const eventsSchemaSource = readFileSync(join(here, "schema", "eventsSchema.ts"), "utf8");

function wallFunctionBlock(name: string, kind: "query" | "mutation" = "mutation"): string {
  const start = wallSource.indexOf(`export const ${name} = ${kind}({`);
  expect(start, `${name} ${kind} should exist in wall.ts`).toBeGreaterThanOrEqual(0);
  const next = wallSource.indexOf("\nexport const ", start + 1);
  return wallSource.slice(start, next > start ? next : undefined);
}

function functionBlock(name: string, kind: "query" | "mutation" | "action" | "internalQuery" | "internalMutation" = "mutation"): string {
  const start = eventsSource.indexOf(`export const ${name} = ${kind}({`);
  expect(start, `${name} ${kind} should exist`).toBeGreaterThanOrEqual(0);
  const next = eventsSource.indexOf("\nexport const ", start + 1);
  return eventsSource.slice(start, next > start ? next : undefined);
}

describe("scratchnode public runtime boundaries", () => {
  it("keeps public /ask isolated from private user notes", () => {
    const composeAnswer = functionBlock("composeAnswer");
    const askAgent = functionBlock("askAgent", "action");
    // PR A: the membership gate, #2 question-ownership integrity check, and the
    // public-source-only retrieval now live in the shared `loadAskContext` helper
    // so askAgent (action) and composeAnswer (mutation) can never drift. It's a
    // plain async function, so extract it directly (like requireHost below).
    const lacStart = eventsSource.indexOf("async function loadAskContext");
    expect(lacStart, "loadAskContext should exist").toBeGreaterThanOrEqual(0);
    const lacEnd = eventsSource.indexOf("function computeCacheSkipReason", lacStart);
    const loadAskContext = eventsSource.slice(lacStart, lacEnd > lacStart ? lacEnd : undefined);

    // composeAnswer must NOT touch private notes and must delegate its gates to
    // the shared loader + slot reservation (idempotency + ask rate-limit).
    expect(composeAnswer).not.toContain("userNotes");
    expect(composeAnswer).not.toContain("getPrivate");
    expect(composeAnswer).toContain("loadAskContext");
    expect(composeAnswer).toContain("reserveAskSlot");
    expect(composeAnswer).toContain("deterministic_synthesis");

    // The shared loader enforces the public/private boundary for BOTH /ask paths:
    // membership, public-source-only retrieval, and question-ownership integrity.
    expect(loadAskContext).not.toContain("userNotes");
    expect(loadAskContext).not.toContain("getPrivate");
    expect(loadAskContext).toContain("requireMember");
    expect(loadAskContext).toContain("liveEventSources");
    expect(loadAskContext).toContain("invalid_question_message"); // #2 integrity gate

    expect(askAgent).not.toContain("userNotes");
    expect(askAgent).not.toContain("getPrivate");
    expect(askAgent).toContain("_reserveAskSlot"); // idempotency + dedicated ask rate-limit
    expect(askAgent).toContain("_prepareAskAgentContext");
    expect(askAgent).toContain("generateProviderAnswer");
    expect(askAgent).toContain("quality_gate");
    expect(askAgent).toContain("private notes excluded");
  });

  it("keeps wiki publishing host-gated and sourced from public answers", () => {
    const publishWiki = functionBlock("publishWiki");

    expect(publishWiki).toContain("requireHost");
    expect(publishWiki).toContain("liveEventAnswers");
    expect(publishWiki).toContain("liveEventWikiVersions");
    expect(publishWiki).not.toContain("userNotes");
  });

  it("models private note anchors without making them public messages", () => {
    expect(eventsSchemaSource).toContain("anchorType");
    expect(eventsSchemaSource).toContain("by_owner_event_anchor");
    expect(eventsSchemaSource).toContain("by_session_joined");
    expect(eventsSchemaSource).toContain("by_owner");
    expect(notesSource).toContain("sanitizeAnchor");
    expect(notesSource).toContain("Private note anchors require anchorId");

    const sendMessage = functionBlock("sendMessage");
    expect(sendMessage).not.toContain("userNotes");
    expect(sendMessage).not.toContain("anchorType");
  });

  it("keeps host announcements as host-gated no-LLM event-log messages", () => {
    const sendMessage = functionBlock("sendMessage");
    const executableSendMessage = sendMessage
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n\r]*/g, "");

    expect(sendMessage).toContain('v.literal("system")');
    expect(sendMessage).toContain('args.kind === "system"');
    expect(sendMessage).toContain("Host ownership is required for system messages.");
    expect(sendMessage).toContain("requireHost(ctx, args.eventId, args.ownerKey)");
    expect(sendMessage).toContain('ctx.db.insert("liveEventMessages"');
    expect(sendMessage).toContain("kind: args.kind");
    expect(sendMessage).toContain("lastActivityAt: now");

    expect(executableSendMessage).not.toContain("askAgent");
    expect(executableSendMessage).not.toContain("composeAnswer");
    expect(executableSendMessage).not.toContain("liveEventAnswers");
    expect(executableSendMessage).not.toContain("liveEventWikiVersions");
    expect(executableSendMessage).not.toContain("userNotes");
  });

  it("keeps ScratchNode account event state as bounded joined and hosted lists", () => {
    const getMyEvents = functionBlock("getMyEvents", "query");

    expect(getMyEvents).toContain("MAX_MY_EVENTS_LIMIT");
    expect(getMyEvents).toContain("by_session_joined");
    expect(getMyEvents).toContain("by_owner");
    expect(getMyEvents).toContain("joined");
    expect(getMyEvents).toContain("hosted");
  });

  it("keeps landing stats and public room discovery bounded and activity-based", () => {
    const getLandingStats = functionBlock("getLandingStats", "query");
    const listPublicRooms = functionBlock("listPublicRooms", "query");
    const createEvent = functionBlock("createEvent");

    expect(eventsSchemaSource).toContain("publicDiscoverable");
    expect(eventsSchemaSource).toContain("joinPolicy");
    expect(eventsSchemaSource).toContain("lastActivityAt");
    expect(eventsSchemaSource).toContain("by_public_status_startedAt");

    expect(getLandingStats).toContain("MAX_LANDING_EVENT_SCAN");
    expect(getLandingStats).toContain("MAX_LANDING_SESSION_SCAN");
    expect(getLandingStats).toContain("PUBLIC_ROOM_ACTIVE_WINDOW_MS");
    expect(getLandingStats).toContain("getEventActivityAt");

    expect(listPublicRooms).toContain("MAX_PUBLIC_ROOM_CARDS");
    expect(listPublicRooms).toContain("MAX_PUBLIC_ROOM_CANDIDATES");
    expect(listPublicRooms).toContain('q.eq("publicDiscoverable", true)');
    expect(listPublicRooms).toContain("activeSessionsCapped");

    expect(createEvent).toContain("publicDiscoverable: args.publicDiscoverable === true");
    expect(createEvent).toContain('joinPolicy: args.joinPolicy || "open"');
  });

  it("does not let passive heartbeats keep public room listings warm", () => {
    const joinEvent = functionBlock("joinEvent");
    const sendMessage = functionBlock("sendMessage");
    const heartbeat = functionBlock("heartbeat");

    expect(joinEvent).toContain("lastActivityAt: now");
    expect(sendMessage).toContain("lastActivityAt: now");
    expect(heartbeat).not.toContain("lastActivityAt");
  });

  it("keeps host claim idempotent for the same owner key before rejecting claimed rooms", () => {
    const claimHost = functionBlock("claimHost");
    const ownerLookup = claimHost.indexOf('withIndex("by_event_owner"');
    const eventLookup = claimHost.indexOf('withIndex("by_event"');

    expect(ownerLookup).toBeGreaterThanOrEqual(0);
    expect(eventLookup).toBeGreaterThan(ownerLookup);
    expect(claimHost).toContain("host_already_claimed");
  });
});

// ─── Phase 4: real-auth host claim — static-analysis invariants ──────────
//
// These tests verify the SOURCE shape of events.ts to catch the obvious
// regressions: removed gates, weakened constraints, exposed claim codes.
// Real round-trip tests against a Convex instance go in the dogfood
// script (scripts/scratchnode-multi-user-dogfood.mjs scenarios 17-21).
describe("scratchnode Phase 4 host auth", () => {
  it("requestHostClaim requires membership and never accepts legacy ownerKey upgrade", () => {
    const requestHostClaim = functionBlock("requestHostClaim");

    // Membership gate — non-attendees can't request a code
    expect(requestHostClaim).toContain("requireMember");
    // Returns the plaintext code (only once — but the function MUST return it)
    expect(requestHostClaim).toContain("hostClaimCode");
    // Persists hash, not plaintext
    expect(requestHostClaim).toContain("hostClaimCodeHash");
    expect(requestHostClaim).toContain("sha256Hex");
    // Legacy host upgrade is explicitly blocked
    expect(requestHostClaim).toContain("legacy_host_must_rotate_first");
    // Rotation requires existing token verification
    expect(requestHostClaim).toContain("claim_code_rotation_requires_token");
  });

  it("claimHostWithCode is single-use, constant-time-compared, and issues HMAC tokens", () => {
    const claimHostWithCode = functionBlock("claimHostWithCode");

    // Membership gate — same shape as composeAnswer
    expect(claimHostWithCode).toContain("requireMember");
    // Hash comparison uses constant-time path (no naive ===)
    expect(claimHostWithCode).toContain("constantTimeEquals");
    // Code is invalidated atomically with host insert (single-use)
    expect(claimHostWithCode).toContain("hostClaimCodeHash: undefined");
    expect(claimHostWithCode).toContain("hostClaimCodeCreatedAt: undefined");
    // Server-issued token returned as ownerKey
    expect(claimHostWithCode).toContain("issueHostToken");
    expect(claimHostWithCode).toContain('authMethod: "claim_code"');
    // Honest error codes
    expect(claimHostWithCode).toContain("code_invalid");
  });

  it("claimHost (legacy) explicitly rejects hk1: HMAC tokens to prevent impersonation", () => {
    const claimHost = functionBlock("claimHost");

    // The legacy path MUST NOT accept HMAC-format ownerKeys — otherwise
    // a leaked legacy ownerKey could impersonate a real-auth host row.
    expect(claimHost).toContain("HOST_TOKEN_PREFIX");
    expect(claimHost).toContain("use_claim_host_with_code");
    // Records authMethod=legacy_ownerkey so future audits can sort
    expect(claimHost).toContain('authMethod: "legacy_ownerkey"');
  });

  it("requireHost cryptographically verifies HMAC tokens and confirms row exists", () => {
    // requireHost is a const, not an export — grep the source directly.
    const start = eventsSource.indexOf("const requireHost = async");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = eventsSource.indexOf("\n};", start);
    const requireHost = eventsSource.slice(start, end);

    // HMAC path: verify signature first, then confirm row
    expect(requireHost).toContain("HOST_TOKEN_PREFIX");
    expect(requireHost).toContain("verifyHostToken");
    // Both paths still hit the DB to confirm row existence — catches
    // revoked hosts even if HMAC token is still cryptographically valid
    expect(requireHost).toContain("liveEventHosts");
    expect(requireHost).toContain("not_host");
  });

  it("SCRATCHNODE_HOST_TOKEN_SECRET fails closed in production — no silent dev fallback", () => {
    const start = eventsSource.indexOf("const getHostAuthSecret");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = eventsSource.indexOf("\n};", start);
    const fn = eventsSource.slice(start, end);

    // Dev fallback gated on CONVEX_DEPLOYMENT prefix
    expect(fn).toContain("CONVEX_DEPLOYMENT");
    expect(fn).toContain('dev:');
    // Production with no secret throws ConvexError (not a hardcoded
    // default that ships with the binary)
    expect(fn).toContain("host_auth_secret_missing");
  });
});

// ─── Phase 8: Memory Wall (convex/wall.ts) — privacy + reliability invariants ──
//
// The Wall is a PUBLIC, collaborative-open overlay over the canonical event
// stream. These static-source assertions catch the obvious regressions:
// private-note leakage, removed BOUND/membership/rate-limit gates, and missing
// cross-event integrity checks.
describe("scratchnode Phase 8 Memory Wall boundaries", () => {
  it("the public wall NEVER references private user notes", () => {
    // The single most important invariant: a public spatial surface must not
    // be able to read or surface private, owner-keyed notes.
    //
    // Check for ACTUAL ACCESS, not mentions: a Convex table is only reached via
    // a quoted string literal — query("userNotes") / db access. Prose in the
    // module header legitimately names userNotes to DOCUMENT the invariant, so
    // we assert the quoted form, never the bare word.
    expect(wallSource).not.toContain('"userNotes"');
    expect(wallSource).not.toContain('"liveEventNoteAnchors"');
    expect(wallSource).not.toContain("getPrivate");
    expect(wallSource).not.toContain(".ownerKey");
    // It only ever dereferences PUBLIC content tables.
    expect(wallSource).toContain('"liveEventMessages"');
    expect(wallSource).toContain('"liveEventAnswers"');
  });

  it("listWallItems is BOUND (no unbounded scan of a hot public table)", () => {
    const listWallItems = wallFunctionBlock("listWallItems", "query");
    expect(listWallItems).toContain("MAX_WALL_ITEMS");
    expect(listWallItems).toContain(".take(");
    // The cap constant itself is defined and finite.
    expect(wallSource).toMatch(/const MAX_WALL_ITEMS = \d+/);
  });

  it("every wall mutation gates on membership before writing", () => {
    for (const name of [
      "pinToWall",
      "createWallNote",
      "moveWallItems",
      "recolorWallItem",
      "editWallNote",
      "groupWallItems",
      "ungroupWallItems",
      "removeWallItems",
    ]) {
      expect(wallFunctionBlock(name)).toContain("requireMember");
    }
  });

  it("every wall mutation enforces a rate limit", () => {
    for (const name of [
      "pinToWall",
      "createWallNote",
      "moveWallItems",
      "recolorWallItem",
      "editWallNote",
      "groupWallItems",
      "ungroupWallItems",
      "removeWallItems",
    ]) {
      expect(wallFunctionBlock(name)).toContain("enforceRateLimit");
    }
  });

  it("batch mutations are BOUND and id-mutations enforce cross-event integrity", () => {
    for (const name of ["moveWallItems", "groupWallItems", "ungroupWallItems", "removeWallItems"]) {
      const block = wallFunctionBlock(name);
      expect(block, `${name} should cap batch size`).toContain("MAX_WALL_BATCH");
    }
    // pin + move + recolor + edit + remove all verify the row belongs to the
    // event before touching it (prevents cross-event id smuggling).
    for (const name of ["moveWallItems", "recolorWallItem", "editWallNote", "removeWallItems"]) {
      expect(wallFunctionBlock(name)).toContain("item.eventId !== args.eventId");
    }
    expect(wallFunctionBlock("pinToWall")).toContain("!== args.eventId");
  });

  it("color writes are constrained to an allowlist (no arbitrary inline style)", () => {
    expect(wallSource).toContain("WALL_COLORS");
    expect(wallSource).toContain("safeColor");
  });
});
