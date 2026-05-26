import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const eventsSource = readFileSync(join(here, "events.ts"), "utf8");

function functionBlock(name: string): string {
  const start = eventsSource.indexOf(`export const ${name} = mutation({`);
  expect(start, `${name} mutation should exist`).toBeGreaterThanOrEqual(0);
  const next = eventsSource.indexOf("\nexport const ", start + 1);
  return eventsSource.slice(start, next > start ? next : undefined);
}

describe("scratchnode public runtime boundaries", () => {
  it("keeps public /ask (composeAnswer) isolated from private user notes", () => {
    const composeAnswer = functionBlock("composeAnswer");

    expect(composeAnswer).not.toContain("userNotes");
    expect(composeAnswer).not.toContain("getPrivate");
    expect(composeAnswer).toContain("requireMember");
    expect(composeAnswer).toContain("liveEventSources");
    expect(composeAnswer).toContain("deterministic_synthesis");
  });

  it("keeps wiki publishing host-gated and sourced from public answers", () => {
    const publishWiki = functionBlock("publishWiki");

    expect(publishWiki).toContain("requireHost");
    expect(publishWiki).toContain("liveEventAnswers");
    expect(publishWiki).toContain("liveEventWikiVersions");
    expect(publishWiki).not.toContain("userNotes");
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

  it("HOST_AUTH_SECRET fails closed in production — no silent dev fallback", () => {
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
