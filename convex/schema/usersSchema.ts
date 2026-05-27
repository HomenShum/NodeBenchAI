/**
 * Users Schema — Phase 8 of the scratchnode.live live prod plan.
 *
 * Adds a persistent user identity (FROZEN identity contract for Step 9
 * NodeBench handoff). A user is keyed by email; the same browser session
 * (anonymous sessionId) can be "claimed" by a user when they verify a
 * magic-link sign-in token. listMyEvents queries by `lastSessionId` to
 * pull events the user joined as a guest before signing in.
 *
 * Design notes
 *  - users.lastSessionId enables anon→user merge WITHOUT rewriting
 *    historical liveEventMembers / userNotes rows. The user row simply
 *    "points at" the latest session it authenticated as. Subsequent
 *    sign-ins update lastSessionId; the prior sessionId remains intact
 *    on its membership/notes rows so the data is never moved.
 *  - userSignInTokens is kept separate from liveEvents.hostClaimCodeHash
 *    on purpose: they have different lifecycles (sign-in token TTL is
 *    30 min and consumed=true persists for audit; host claim hash is
 *    cleared from the event on redeem). Sharing the table would conflate
 *    two unrelated authentication flows.
 *  - tokenHash is SHA-256(email + token + SCRATCHNODE_HOST_TOKEN_SECRET).
 *    Reusing the existing host-token pepper keeps env config minimal and
 *    keeps the hash bound to deployment (rotating the pepper invalidates
 *    every pending sign-in token, which is the correct disaster posture).
 *
 * See: convex/users.ts for mutations and queries.
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

// ------------------------------------------------------------------
// users — persistent user identity tied to a verified email.
// One row per email (case-folded). createdAt is set on first verify;
// emailVerifiedAt mirrors the same timestamp on first verify and is
// updated on each subsequent verify. lastSessionId is the merge key
// for anon→user membership lookup.
// ------------------------------------------------------------------
export const users = defineTable({
  email: v.string(),                         // lowercased, RFC-5321-capped
  emailVerifiedAt: v.optional(v.number()),   // set when magic-link consumed
  displayName: v.string(),                   // capped at 100 chars
  createdAt: v.number(),
  // Anon→user merge: the latest sessionId that authenticated as this user.
  // Used to claim historical liveEventMembers / userNotes rows on sign-in.
  lastSessionId: v.optional(v.string()),
}).index("by_email", ["email"]);

// ------------------------------------------------------------------
// userSignInTokens — short-lived magic-link tokens for email sign-in.
// Lifecycle: insert on requestSignInLink → mark consumed:true on
// verifySignInToken success. Expired or consumed tokens are kept for
// audit + idempotency (re-submitting a consumed token reliably yields
// token_invalid instead of a 500).
// ------------------------------------------------------------------
export const userSignInTokens = defineTable({
  email: v.string(),
  tokenHash: v.string(),                     // SHA-256(email + token + pepper)
  expiresAt: v.number(),                     // 30-min TTL
  consumed: v.boolean(),
  createdAt: v.number(),
})
  .index("by_email_active", ["email", "consumed"])
  .index("by_tokenHash", ["tokenHash"]);
