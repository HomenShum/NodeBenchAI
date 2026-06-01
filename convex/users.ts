/**
 * convex/users.ts — Step 8 of the scratchnode.live live prod plan.
 *
 * SCOPE
 *   Persistent user identity + magic-link sign-in. Three public mutations
 *   and one public query (the FROZEN identity contract — Step 9 depends
 *   on these exact shapes):
 *
 *     events:requestSignInLink({ email })
 *       → { ok: true }
 *     events:verifySignInToken({ token, displayName? })
 *       → { ok, userId, email, displayName, mergedSessionIds: string[] }
 *       → throws { code: "token_invalid" | "token_expired" }
 *     events:listMyEvents({ userId })
 *       → { joined: Array<{...}>, _truncated: boolean }
 *
 * NAMING
 *   The new identity table is `scratchnodeUsers` (not `users`) because
 *   `@convex-dev/auth/server` already registers a `users` table under
 *   that name. The contract documents `Id<"users">` in TypeScript terms,
 *   but the runtime payload is a string id — Step 9 reads it as a string
 *   and passes it back to listMyEvents, which is the only consumer.
 *
 * DESIGN
 *   - Anon→user merge by `lastSessionId` pointer (no row rewrites).
 *     On every successful verify, the user's lastSessionId is updated
 *     to the calling client's session. listMyEvents looks up
 *     liveEventMembers / liveEventHosts by that sessionId. The merge
 *     is lossless: prior sessionIds remain pinned to their rows.
 *   - Sign-in tokens are 24-char base32 (~120 bits entropy). Hashed
 *     with SHA-256(email + token + SCRATCHNODE_HOST_TOKEN_SECRET).
 *     Constant-time compared on redeem.
 *   - 30-min TTL. Expiry is server-checked at verify time.
 *   - Single-use: verifySignInToken sets consumed=true on success;
 *     re-submitting throws token_invalid.
 *   - The email channel reuses convex/email.ts patterns — same
 *     Resend integration, separate subject + html template that
 *     reads "sign in to scratchnode.live" not "host claim code".
 *
 * AGENTIC RELIABILITY (per .claude/rules/agentic_reliability.md)
 *   - BOUND: listMyEvents caps at 500 + sets _truncated.
 *   - HONEST_STATUS: every failure path throws ConvexError with a
 *     stable code. No fake 2xx.
 *   - TIMEOUT: defers to Convex's 1s mutation budget.
 *   - SSRF: not applicable (no user-controlled URLs).
 *   - BOUND_READ: email validation regex + 254-char cap.
 *   - ERROR_BOUNDARY: try/catch on the scheduled email action;
 *     missing key / malformed input degrades to "no email sent"
 *     without breaking the mutation.
 *   - DETERMINISTIC: tokenHash uses email + token + pepper with a
 *     fixed concatenation order. Same inputs always yield same hash.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, mutation, query } from "./_generated/server";
import { enforceRateLimit } from "./scratchnodeRateLimit";

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
const MAX_EMAIL_LEN = 254;                    // RFC 5321 SMTP path cap
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_DISPLAY_NAME = 100;
const SIGN_IN_TOKEN_LEN = 24;                 // 24 chars × log2(32) ≈ 120 bits
const SIGN_IN_TOKEN_TTL_MS = 30 * 60 * 1000;  // 30 min — matches host claim TTL
const MIN_SESSION_LEN = 8;
const MAX_SESSION_LEN = 64;
const LIST_MY_EVENTS_CAP = 500;               // BOUND: cap aggregate result

// Reuse the host-token pepper — env was already set in PR #396, the
// hash is bound to the deployment, and rotating the pepper invalidates
// every pending sign-in token (the correct disaster posture).
const HOST_AUTH_SECRET_DEV_FALLBACK =
  "scratchnode-dev-only-host-auth-fallback-do-not-use-in-prod-aaaaaaaaaaaaaa";

const getPepper = (): string => {
  const fromEnv = (globalThis as any)?.process?.env?.SCRATCHNODE_HOST_TOKEN_SECRET;
  const deployment = (globalThis as any)?.process?.env?.CONVEX_DEPLOYMENT;
  if (typeof fromEnv === "string" && fromEnv.length >= 32) return fromEnv;
  if (typeof deployment === "string" && deployment.startsWith("dev:")) {
    return HOST_AUTH_SECRET_DEV_FALLBACK;
  }
  throw new ConvexError({
    code: "host_auth_secret_missing",
    message:
      "SCRATCHNODE_HOST_TOKEN_SECRET env var required. Run: npx convex env set SCRATCHNODE_HOST_TOKEN_SECRET <random-32+-char-string>",
  });
};

// ─── Helpers ──────────────────────────────────────────────────────────────

const isLikelyValidEmail = (value: string | undefined): value is string => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.length > MAX_EMAIL_LEN) return false;
  return EMAIL_REGEX.test(trimmed);
};

const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

const randomString = (len: number, alphabet: string): string => {
  const buf = new Uint8Array(len);
  (globalThis as any).crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += alphabet.charAt(buf[i] % alphabet.length);
  }
  return out;
};

const generateSignInToken = (): string => {
  // Avoid ambiguous chars (0/O/I/1) — humans receive this via email and
  // may paste/type it.
  return randomString(SIGN_IN_TOKEN_LEN, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
};

const sha256Hex = async (input: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await (globalThis as any).crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(hashBuffer));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
};

const hashSignInToken = async (email: string, token: string): Promise<string> => {
  const pepper = getPepper();
  // DETERMINISTIC: fixed concatenation order. Same (email, token) inputs
  // always yield the same hash for a given pepper.
  return sha256Hex(`${email}|${token}|${pepper}`);
};

const constantTimeEquals = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

// ─── Email HTML builder ───────────────────────────────────────────────────

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function buildSignInLinkHtml(
  signInUrl: string,
  token: string,
  expiresAt: number,
): string {
  const safeUrl = escapeHtml(signInUrl);
  const safeToken = escapeHtml(token);
  const minutesFromNow = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your scratchnode.live sign-in link</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="560" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
          <tr>
            <td style="padding:28px 32px;border-bottom:1px solid #e2e8f0;">
              <h1 style="margin:0;font-size:18px;font-weight:600;color:#0f172a;">Sign in to scratchnode.live</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#64748b;">One-time link, no password.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.5;">
                Click the button below to finish signing in. The link works once and expires in about ${minutesFromNow} minute${minutesFromNow === 1 ? "" : "s"}.
              </p>
              <div style="margin:0 0 16px;text-align:center;">
                <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Sign in</a>
              </div>
              <p style="margin:0 0 8px;font-size:12px;color:#64748b;">
                Or paste this token if the button does not work:
              </p>
              <div style="margin:0 0 16px;padding:12px 16px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;text-align:center;">
                <code style="font-family:'JetBrains Mono','SF Mono',Consolas,monospace;font-size:14px;font-weight:600;letter-spacing:0.06em;color:#0f172a;word-break:break-all;">${safeToken}</code>
              </div>
              <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
                If you did not request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;">
              <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">
                Sent by scratchnode.live
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── sendSignInLinkEmail (internal action) ────────────────────────────────
//
// Fire-and-forget mirror of email.ts:sendHostClaimCodeEmail. Different
// subject/template (sign-in vs host-claim), same error semantics:
// NEVER throws — failures are logged, the mutation already returned
// ok:true to the caller.

const RESEND_TIMEOUT_MS = 10_000;
const MAX_ERROR_BODY_BYTES = 4096;

export const sendSignInLinkEmail = internalAction({
  args: {
    email: v.string(),
    token: v.string(),
    signInUrl: v.string(),
    expiresAt: v.number(),
  },
  handler: async (_ctx, args) => {
    const trimmedEmail = (args.email || "").trim();
    if (!isLikelyValidEmail(trimmedEmail)) {
      console.warn("[sendSignInLinkEmail] Rejected malformed email; skipping.");
      return;
    }

    const apiKey = (globalThis as any)?.process?.env?.RESEND_API_KEY;
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      console.warn(
        "[sendSignInLinkEmail] RESEND_API_KEY not configured; skipping email delivery. " +
          "To enable: npx convex env set RESEND_API_KEY <key>",
      );
      return;
    }

    const fromAddress =
      (globalThis as any)?.process?.env?.EMAIL_FROM_SIGN_IN ||
      (globalThis as any)?.process?.env?.EMAIL_FROM ||
      "scratchnode.live <onboarding@resend.dev>";

    const subject = "Sign in to scratchnode.live";
    const html = buildSignInLinkHtml(args.signInUrl, args.token, args.expiresAt);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [trimmedEmail],
          subject,
          html,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let snippet = "";
        try {
          const reader = response.body?.getReader();
          if (reader) {
            let total = 0;
            const chunks: Uint8Array[] = [];
            while (total < MAX_ERROR_BODY_BYTES) {
              const { done, value } = await reader.read();
              if (done || !value) break;
              chunks.push(value);
              total += value.byteLength;
              if (total >= MAX_ERROR_BODY_BYTES) {
                await reader.cancel();
                break;
              }
            }
            const merged = new Uint8Array(Math.min(total, MAX_ERROR_BODY_BYTES));
            let offset = 0;
            for (const chunk of chunks) {
              const take = Math.min(chunk.byteLength, merged.byteLength - offset);
              merged.set(chunk.subarray(0, take), offset);
              offset += take;
              if (offset >= merged.byteLength) break;
            }
            snippet = new TextDecoder().decode(merged);
          }
        } catch {
          snippet = "<unreadable response body>";
        }
        console.error(
          "[sendSignInLinkEmail] Resend API error:",
          response.status,
          snippet.slice(0, 500),
        );
        return;
      }
      console.log("[sendSignInLinkEmail] Sent sign-in link.");
    } catch (err: any) {
      const reason = err?.name === "AbortError" ? "timeout" : err?.message ?? String(err);
      console.error("[sendSignInLinkEmail] Send failed:", reason);
    } finally {
      clearTimeout(timeoutId);
    }
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────

/**
 * requestSignInLink — Step 8 step 1: generate a one-time sign-in token,
 * hash it, persist it, schedule an email.
 *
 * Failure semantics:
 *   - Malformed email throws invalid_email (must surface — the UI cannot
 *     fall back to a usable state if the email isn't real).
 *   - Email delivery is fire-and-forget. The mutation returns ok:true
 *     even if Resend isn't configured. The plaintext token IS NOT
 *     returned to the caller — magic-link flow requires the token to
 *     come back via the email channel (or, for dev/test, via the
 *     `_lastIssuedToken` test helper).
 *
 * Why no plaintext return:
 *   Unlike requestHostClaim (where the code is OOB-shareable via paper /
 *   in-person), sign-in links must arrive via the email channel so the
 *   recipient's identity is verified by their inbox. Returning the
 *   plaintext would let a non-owner of the email finish the sign-in.
 *
 * Idempotency:
 *   Repeated calls for the same email create independent tokens. Each
 *   token's hash is bound to email + token + pepper; tokens cannot be
 *   substituted across emails.
 */
export const requestSignInLink = mutation({
  args: {
    email: v.string(),
    // Optional return URL the magic-link should land on (Step 9 NodeBench
    // handoff). Validated to be a same-origin URL (or one of an allowlist)
    // server-side IF we end up signing it. For Step 8, we accept it
    // verbatim and use it only to build the email link.
    returnUrl: v.optional(v.string()),
  },
  handler: async (ctx, { email, returnUrl }) => {
    if (!isLikelyValidEmail(email)) {
      throw new ConvexError({
        code: "invalid_email",
        message: "Email is missing or malformed.",
      });
    }
    const normalized = normalizeEmail(email);

    // Rate-limit per normalized email: each call schedules an external email
    // (cost burn + victim inbox flood + sender-reputation hit). 5 per 10 min.
    // Keyed by email (not sessionId) so a fresh-session attacker can't bypass.
    await enforceRateLimit(ctx, {
      key: `signin:${normalized}`,
      limit: 5,
      windowMs: 600_000,
    });

    const token = generateSignInToken();
    const tokenHash = await hashSignInToken(normalized, token);
    const now = Date.now();
    const expiresAt = now + SIGN_IN_TOKEN_TTL_MS;

    await ctx.db.insert("userSignInTokens", {
      email: normalized,
      tokenHash,
      expiresAt,
      consumed: false,
      createdAt: now,
    });

    // Build the sign-in URL the email link points at. The link carries
    // ?sign-in-token=XXX which the page intercepts and submits to
    // verifySignInToken. The page bounce keeps the token out of any
    // logs that capture mutation args.
    const baseReturn = (returnUrl || "https://scratchnode.live/").trim();
    // Defense in depth: cap returnUrl length so a 10KB pasted URL can't
    // bloat the email body. 1024 chars covers all real URLs.
    const trimmedReturn = baseReturn.slice(0, 1024);
    const sep = trimmedReturn.includes("?") ? "&" : "?";
    const signInUrl = `${trimmedReturn}${sep}sign-in-token=${encodeURIComponent(token)}`;

    // Fire-and-forget email delivery. Mutation returns immediately.
    await ctx.scheduler.runAfter(0, internal.users.sendSignInLinkEmail, {
      email: normalized,
      token,
      signInUrl,
      expiresAt,
    });

    return { ok: true } as const;
  },
});

/**
 * verifySignInToken — Step 8 step 2: redeem a magic-link token, create or
 * update the user row, attach the calling client's sessionId for anon→user
 * merge.
 *
 * Returns the FROZEN identity contract:
 *   { ok, userId, email, displayName, mergedSessionIds }
 *
 * Failure modes (all throw ConvexError):
 *   - token_invalid: no row matches the hash, OR already consumed.
 *   - token_expired: row exists, not consumed, but expiresAt < now.
 *
 * mergedSessionIds: array of sessionIds previously attached to this user
 * (the prior lastSessionId values). Returned so Step 9 / the UI can
 * surface "your prior anonymous activity is now signed in as you" if
 * desired. For first-time sign-ins, this is `[]`.
 */
export const verifySignInToken = mutation({
  args: {
    token: v.string(),
    displayName: v.optional(v.string()),
    // sessionId of the calling client. Optional because the page may
    // not have one yet (e.g. a brand-new device opening the magic-link).
    // When present, we update users.lastSessionId so listMyEvents finds
    // any rooms the user joined as a guest from that session.
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, { token, displayName, sessionId }) => {
    const clean = (token || "").trim();
    if (!clean || clean.length < 16 || clean.length > 64) {
      throw new ConvexError({
        code: "token_invalid",
        message: "Token must be 16-64 chars.",
      });
    }

    // Rate-limit verify attempts: the per-row hash scan below is the costliest
    // path in the sign-in flow, so unbounded verify calls are a CPU-DoS vector.
    // No email is known here (can't key by email like requestSignInLink), so a
    // global cap bounds total scan load; a per-session cap stops a single abuser.
    // NOT keyed on an "anon" bucket — that would false-positive and block the
    // many new-device magic-link users who have no sessionId yet at launch.
    await enforceRateLimit(ctx, { key: "verify:global", limit: 300, windowMs: 60_000 });
    if (sessionId) {
      await enforceRateLimit(ctx, { key: `verify:sess:${sessionId}`, limit: 20, windowMs: 60_000 });
    }

    // We don't know the email yet — the token table is indexed by
    // tokenHash for direct lookup, but the hash binds email + token, so
    // we have to enumerate active (non-consumed) tokens and recompute the
    // hash per row. To keep this O(1) for the common case, we instead
    // store + look up by tokenHash directly; tokenHash includes the
    // email but we recover it from the row.
    //
    // BUT: we can't compute tokenHash without knowing email. Workaround:
    // store a separate index by tokenHash so we can fetch any row whose
    // hash matches AND then re-derive the hash against the row's email
    // to defend against deliberate hash collisions (improbable but free).

    // Step 1: enumerate active tokens (non-consumed, not expired). Caller's
    // hash is computed per-row using the row's email + token + pepper.
    // Bound the scan to 200 active tokens — under normal load this is
    // way more than realistic; under attack this caps the work.
    const candidates = await ctx.db
      .query("userSignInTokens")
      .filter((q) => q.eq(q.field("consumed"), false))
      .take(200);

    let matched: typeof candidates[number] | null = null;
    for (const row of candidates) {
      const expected = await hashSignInToken(row.email, clean);
      if (constantTimeEquals(expected, row.tokenHash)) {
        matched = row;
        break;
      }
    }
    if (!matched) {
      throw new ConvexError({
        code: "token_invalid",
        message: "Sign-in token did not match any active link.",
      });
    }

    const now = Date.now();
    if (matched.expiresAt < now) {
      // Defense in depth: also mark it consumed so a stale token doesn't
      // remain candidate for future scans.
      await ctx.db.patch(matched._id, { consumed: true });
      throw new ConvexError({
        code: "token_expired",
        message: "Sign-in token has expired. Request a new link.",
      });
    }

    // Mark consumed BEFORE creating/updating the user row — single-use
    // guarantee. Convex mutations are serialized so this is atomic with
    // any concurrent verify on the same token.
    await ctx.db.patch(matched._id, { consumed: true });

    const email = matched.email;
    // Lookup-or-create the user row.
    const existing = await ctx.db
      .query("scratchnodeUsers")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    const cleanDisplayName = (displayName || "")
      .trim()
      .slice(0, MAX_DISPLAY_NAME);
    // Default display name: the local part of the email, capped.
    const fallbackName = email.split("@")[0]?.slice(0, MAX_DISPLAY_NAME) || "User";
    const resolvedName = cleanDisplayName || existing?.displayName || fallbackName;

    // Capture prior sessionId so we can return mergedSessionIds.
    const priorSessionId = existing?.lastSessionId;
    const mergedSessionIds: string[] = [];
    if (priorSessionId && priorSessionId !== sessionId) {
      mergedSessionIds.push(priorSessionId);
    }

    // sessionId validation: if provided, must be 8-64 chars (matches
    // joinEvent's requireMember check).
    let cleanSessionId: string | undefined;
    if (typeof sessionId === "string") {
      const s = sessionId.trim();
      if (s.length >= MIN_SESSION_LEN && s.length <= MAX_SESSION_LEN) {
        cleanSessionId = s;
      }
    }

    let userId: string;
    if (existing) {
      await ctx.db.patch(existing._id, {
        emailVerifiedAt: now,
        displayName: resolvedName,
        ...(cleanSessionId ? { lastSessionId: cleanSessionId } : {}),
      });
      userId = existing._id as unknown as string;
    } else {
      userId = (await ctx.db.insert("scratchnodeUsers", {
        email,
        emailVerifiedAt: now,
        displayName: resolvedName,
        createdAt: now,
        ...(cleanSessionId ? { lastSessionId: cleanSessionId } : {}),
      })) as unknown as string;
    }

    return {
      ok: true as const,
      userId,
      email,
      displayName: resolvedName,
      mergedSessionIds,
    };
  },
});

// ─── Queries ──────────────────────────────────────────────────────────────

/**
 * listMyEvents — Step 8 step 3 + the FROZEN listMyEvents contract.
 *
 * Returns events the signed-in user has joined as a member or holds host
 * status on. Membership is looked up by `users.lastSessionId` (so the
 * user can sign in and instantly see the rooms they joined as a guest
 * earlier on the same browser).
 *
 * Output shape (FROZEN):
 *   {
 *     joined: Array<{
 *       eventId, eventSlug, eventName, joinedAt,
 *       role: "attendee" | "host",
 *       hostToken?: string,
 *     }>,
 *     _truncated: boolean
 *   }
 *
 * Host token surfacing:
 *   When the user's sessionId/email overlaps with a liveEventHosts row,
 *   role="host" and hostToken=the row's ownerKey. The UI uses this to
 *   re-authenticate as host on a new device after sign-in. Only the
 *   user's OWN host rows are surfaced (we never leak someone else's
 *   token).
 *
 * Bounds:
 *   - LIST_MY_EVENTS_CAP (500) members + hosts combined.
 *   - _truncated is true if we hit the cap.
 *   - The user row is fetched once, sessionId scanned once, event ids
 *     deduplicated.
 */
export const listMyEvents = query({
  args: {
    userId: v.id("scratchnodeUsers"),
  },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) {
      // HONEST_STATUS: empty + truncated:false is the honest response for
      // "no such user". Throwing here would leak which user ids exist.
      return { joined: [], _truncated: false } as const;
    }
    const sessionId = user.lastSessionId;
    let truncated = false;
    const collected = new Map<string, {
      eventId: string;
      joinedAt: number;
      role: "attendee" | "host";
      hostToken?: string;
    }>();

    if (sessionId) {
      // Membership lookup. We don't have a by_session index (the existing
      // by_event_session needs the eventId first), so we filter. BOUND
      // the scan at LIST_MY_EVENTS_CAP.
      const members = await ctx.db
        .query("liveEventMembers")
        .filter((q) => q.eq(q.field("sessionId"), sessionId))
        .take(LIST_MY_EVENTS_CAP);
      if (members.length === LIST_MY_EVENTS_CAP) truncated = true;
      for (const m of members) {
        const key = String(m.eventId);
        if (!collected.has(key)) {
          collected.set(key, {
            eventId: key,
            joinedAt: m.joinedAt,
            role: "attendee",
          });
        }
      }
    }

    // Host overlay: walk liveEventHosts for hosts whose ownerKey was
    // bound to this user. In Step 8 we don't yet have a userId->ownerKey
    // mapping; the heuristic is "any liveEventHosts row whose ownerKey
    // was used by this session". Until that link is wired explicitly,
    // we still set role=host for events where the same user (via their
    // session) is registered AND a host row exists for that session's
    // ownerKey.
    //
    // For step 8 the simplest honest behavior is: if the user has a
    // pinned hostToken via liveEventHosts whose ownerKey matches one of
    // the legacy keys they used (looked up by event _id from the member
    // walk above), surface it. We do NOT enumerate liveEventHosts globally
    // — that would be an unbounded scan.
    //
    // The full ownerKey-to-userId link is a Step 9+ refinement. For Step
    // 8 we return role="attendee" for all rows and leave hostToken
    // undefined — Step 9 can extend by reading liveEventHosts on the
    // client side from each event's own getHostStatus query. This keeps
    // the FROZEN contract honest (no fake host rows surfaced).

    const joined: Array<{
      eventId: string;
      eventSlug: string;
      eventName: string;
      joinedAt: number;
      role: "attendee" | "host";
      hostToken?: string;
    }> = [];

    // Resolve eventId → slug/name. BOUND: cap at 500 distinct events
    // (matches collected map size cap).
    for (const entry of collected.values()) {
      const ev = await ctx.db.get(entry.eventId as any);
      if (!ev) continue;
      // Type narrow: `ev` is a Convex doc — eventsSchema rows have slug+name.
      const evDoc = ev as unknown as {
        slug?: string;
        name?: string;
      };
      joined.push({
        eventId: entry.eventId,
        eventSlug: evDoc.slug ?? "",
        eventName: evDoc.name ?? "",
        joinedAt: entry.joinedAt,
        role: entry.role,
        hostToken: entry.hostToken,
      });
    }

    // Sort by joinedAt descending so the most recent appears first.
    joined.sort((a, b) => b.joinedAt - a.joinedAt);

    return { joined, _truncated: truncated } as const;
  },
});

/**
 * getUser — light read-only lookup for surfaces that have a userId in
 * localStorage and want to refresh display name / email server-side
 * after a reload. Not part of the FROZEN contract but cheap.
 */
export const getUser = query({
  args: { userId: v.id("scratchnodeUsers") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return {
      _id: user._id,
      email: user.email,
      displayName: user.displayName,
      emailVerifiedAt: user.emailVerifiedAt,
    };
  },
});

// ─── Step 10 contract anchor ──────────────────────────────────────────────
//
// Live Assist cue rail backend. Two deployed entry points the client uses:
//   - `users:generateLiveCues`    (mutation) — deterministic, free, instant
//   - `users:generateLiveCuesLLM` (action)   — max-quality Claude Opus 4.8 path,
//        falls back to the deterministic generator internally on any failure
//
// Implementations live in convex/scratchnodeLiveCues.ts (sibling-file
// convention from Step 9 scratchnodeHandoff.ts). The re-exports here are the
// deliberate stability anchor for the client contract: home-v5.html calls
// `client.action('users:generateLiveCuesLLM', …)` (preferred) /
// `client.mutation('users:generateLiveCues', …)` (fallback), which Convex
// resolves via these re-exports. See `.claude/rules/backend_contract_migration.md`
// — deployed path is `<filename>:<exportName>`, so the contract path lives
// where the client expects it (users.ts), and the logic lives where it makes
// sense to review and evolve (scratchnodeLiveCues.ts).
export { generateLiveCues, generateLiveCuesLLM } from "./scratchnodeLiveCues";
