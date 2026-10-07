/**
 * convex/email.ts — Phase 4 follow-up Item 1: Resend integration for host
 * claim codes.
 *
 * SCOPE
 *   This module exposes ONE internal action: sendHostClaimCodeEmail. It is
 *   scheduled (fire-and-forget) by events.ts:requestHostClaim when the caller
 *   provides an optional `deliverToEmail`. The mutation still returns the
 *   plaintext code synchronously — email is a CONVENIENCE channel, not a
 *   source of truth.
 *
 * WHY ACTION (not mutation):
 *   Convex mutations must be deterministic and side-effect free wrt external
 *   services. The Resend API is a non-deterministic HTTP call, so it goes
 *   in an action and is scheduled via ctx.scheduler.runAfter(0, ...). The
 *   mutation returns immediately; the email is sent in the background.
 *
 * GRACEFUL DEGRADATION
 *   - Missing RESEND_API_KEY: logs warning, returns void. Does NOT throw.
 *     (The plaintext code already returned to the caller is the source of
 *     truth; a missing email key must not break the claim flow.)
 *   - Resend API error (4xx/5xx): logs error with status + body snippet,
 *     returns void. Does NOT throw. Same rationale.
 *   - Network/abort error: logs error, returns void.
 *
 * AGENTIC RELIABILITY (per .claude/rules/agentic_reliability.md)
 *   - HONEST_STATUS: the calling mutation does NOT pretend email succeeded.
 *     It returns the code synchronously; email status is fire-and-forget.
 *   - TIMEOUT: AbortController with 10s budget on the Resend HTTP call.
 *   - BOUND_READ: response body read with 4KB cap (Resend responses are
 *     small JSON; anything bigger indicates an upstream incident — we log
 *     a truncated snippet and move on).
 *   - SSRF: not applicable — destination URL is the hardcoded Resend API
 *     endpoint, not user-controlled.
 *   - ERROR_BOUNDARY: try/catch around all fetch + JSON parsing.
 *
 * PRIOR ART
 *   Mirrors the existing convex/domains/integrations/resend.ts sendEmail
 *   action shape (same fetch-to-api.resend.com, same Bearer auth) but
 *   adds: AbortController, bounded response read, fail-closed-on-no-key
 *   semantics (existing action throws — this one logs+returns to preserve
 *   the claim flow).
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";

// 10s budget — Resend's documented p99 is <1s, so 10s is a generous ceiling
// before we abort and surface the gap.
const RESEND_TIMEOUT_MS = 10_000;
// Bound the response body we read on error (BOUND_READ). Resend error JSON
// is typically <500 bytes; capping at 4KB catches misconfigured proxies
// returning HTML error pages.
const MAX_ERROR_BODY_BYTES = 4096;

// Validate email at the call site too — this is a defense-in-depth check
// so a misconfigured caller can't sneak garbage into the Resend API.
// Aligned with the regex used in events.ts:requestHostClaim.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254; // RFC 5321 SMTP path limit.

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Build the claim-code email HTML. Keep it short and scannable — the
 * recipient may be on mobile in a noisy hallway at the start of the event.
 */
function buildClaimCodeHtml(
  code: string,
  eventName: string,
  expiresHintAt: number,
): string {
  const safeCode = escapeHtml(code);
  const safeEventName = escapeHtml(eventName);
  // Localized "minutes from now" hint — Resend renders the HTML, but we
  // compute this server-side so the recipient's clock skew can't make the
  // expiry sound stale.
  const minutesFromNow = Math.max(
    1,
    Math.round((expiresHintAt - Date.now()) / 60_000),
  );
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your host claim code for ${safeEventName}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="560" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
          <tr>
            <td style="padding:28px 32px;border-bottom:1px solid #e2e8f0;">
              <h1 style="margin:0;font-size:18px;font-weight:600;color:#0f172a;">Your host claim code</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#64748b;">For event: <strong>${safeEventName}</strong></p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.5;">
                Enter this code on the scratchnode.live page to claim host access for this event. The code is one-time and valid for about ${minutesFromNow} minute${minutesFromNow === 1 ? "" : "s"}.
              </p>
              <div style="margin:0 0 16px;padding:16px 20px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;text-align:center;">
                <code style="font-family:'JetBrains Mono','SF Mono',Consolas,monospace;font-size:20px;font-weight:600;letter-spacing:0.08em;color:#0f172a;word-break:break-all;">${safeCode}</code>
              </div>
              <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
                If you did not request this, you can safely ignore this email. The code expires automatically and can be re-issued from the room.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 12px 12px;">
              <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">
                Sent by scratchnode.live - one-time host claim code
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

/**
 * sendHostClaimCodeEmail — internal action, fire-and-forget from
 * events.ts:requestHostClaim.
 *
 * Failure semantics: NEVER throws. All errors are logged and swallowed so
 * the upstream claim flow (which already returned the code to the caller)
 * is not affected by email-channel issues.
 */
export const sendHostClaimCodeEmail = internalAction({
  args: {
    email: v.string(),
    code: v.string(),
    eventName: v.string(),
    expiresHintAt: v.number(),
  },
  handler: async (_ctx, args) => {
    // Defense in depth — re-validate the email at the action boundary even
    // though events.ts:requestHostClaim already did. If a future caller
    // forgets, we still fail closed quietly.
    const trimmedEmail = (args.email || "").trim();
    if (
      !trimmedEmail ||
      trimmedEmail.length > MAX_EMAIL_LEN ||
      !EMAIL_REGEX.test(trimmedEmail)
    ) {
      console.warn(
        "[sendHostClaimCodeEmail] Rejected malformed email; skipping send.",
      );
      return;
    }

    const apiKey = (globalThis as any)?.process?.env?.RESEND_API_KEY;
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      // Fail closed but quietly — the plaintext code is already in the
      // caller's hands. Missing key must not break the claim flow.
      console.warn(
        "[sendHostClaimCodeEmail] RESEND_API_KEY not configured; skipping email delivery. " +
          "To enable: npx convex env set RESEND_API_KEY <key>",
      );
      return;
    }

    const fromAddress =
      (globalThis as any)?.process?.env?.EMAIL_FROM_HOST_CLAIM ||
      (globalThis as any)?.process?.env?.EMAIL_FROM ||
      "scratchnode.live <onboarding@resend.dev>";

    // Subject is short, recognizable, and does NOT include the code (codes
    // appear in many email previews — putting it in the subject would leak
    // it in notification banners).
    const safeEventName = args.eventName.slice(0, 80) || "scratchnode.live event";
    const subject = `Your host claim code for ${safeEventName}`;
    const html = buildClaimCodeHtml(args.code, safeEventName, args.expiresHintAt);

    // TIMEOUT — abort the request if Resend hangs.
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
        // BOUND_READ — cap the body we ingest on error. Resend errors are
        // small JSON; oversized responses indicate a misconfigured proxy
        // returning HTML, which we don't need verbatim.
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
          // If we can't even read the error body, log what we have.
          snippet = "<unreadable response body>";
        }
        console.error(
          "[sendHostClaimCodeEmail] Resend API error:",
          response.status,
          snippet.slice(0, 500),
        );
        return;
      }
      // Success — log a minimal record (no PII beyond a short event-name
      // marker). The Convex dashboard will surface this on demand.
      console.log(
        "[sendHostClaimCodeEmail] Sent claim code email for event:",
        safeEventName,
      );
    } catch (err: any) {
      // Aborts and network failures land here. Never re-throw — this is a
      // fire-and-forget side channel.
      const reason = err?.name === "AbortError" ? "timeout" : err?.message ?? String(err);
      console.error("[sendHostClaimCodeEmail] Send failed:", reason);
    } finally {
      clearTimeout(timeoutId);
    }
  },
});
