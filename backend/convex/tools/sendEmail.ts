// convex/tools/sendEmail.ts
// Email send tool for Agent component with full audit logging
//
// IMPORTANT: Every email send is logged to emailEvents table for compliance.
// Tool always stores: {userId, threadId, messageId, to, subject, status, providerResponse}

"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";

// Simple email format validation
function isValidEmail(email: string): boolean {
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRe.test(email.trim());
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Send an email via Resend API with full audit logging
 *
 * Every email operation is recorded in the emailEvents table with:
 * - userId, threadId, runId for provenance
 * - Full recipient, subject, body preview
 * - Provider response and status
 *
 * IMPORTANT: The LLM should NEVER fabricate email addresses.
 * Only use addresses explicitly provided by the user or from contact lookups.
 */
export const sendEmail = createTool({
  description: `Send an email on behalf of the user via Resend.

IMPORTANT RULES:
1. NEVER fabricate or guess email addresses - only use addresses explicitly provided by user
2. Always confirm email content with user before sending (unless urgent)
3. Keep subject lines concise and professional
4. Body content should be well-formatted with clear paragraphs
5. Every send is logged for audit compliance

Use this tool when the user explicitly asks to send an email.`,

  args: z.object({
    to: z.string().describe("Recipient email address - must be explicitly provided by user"),
    subject: z.string().describe("Email subject line - concise and professional"),
    body: z.string().describe("Email body content - supports basic formatting"),
    cc: z.array(z.string()).optional().describe("CC recipients (optional)"),
    bcc: z.array(z.string()).optional().describe("BCC recipients (optional)"),
    isHtml: z.boolean().default(false).describe("If true, body is treated as HTML. Default: plain text with line breaks converted."),
  }),

  handler: async (ctx, args): Promise<string> => {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM ?? "NodeBench <no-reply@nodebench.ai>";

    // ═══════════════════════════════════════════════════════════════════════
    // VALIDATION
    // ═══════════════════════════════════════════════════════════════════════

    if (!apiKey) {
      console.error("[sendEmail] Missing RESEND_API_KEY env var");
      return "❌ Email service not configured. Please contact support.";
    }

    const trimmedTo = args.to.trim();
    if (!isValidEmail(trimmedTo)) {
      console.warn("[sendEmail] Invalid recipient email", { to: args.to });
      return `❌ Invalid recipient email address: "${args.to}". Please provide a valid email.`;
    }

    // Validate CC/BCC if provided
    const validCc = args.cc?.filter(email => isValidEmail(email.trim())).map(e => e.trim()) || [];
    const validBcc = args.bcc?.filter(email => isValidEmail(email.trim())).map(e => e.trim()) || [];

    // ═══════════════════════════════════════════════════════════════════════
    // SEND EMAIL
    // ═══════════════════════════════════════════════════════════════════════

    const startTime = Date.now();
    let messageId: string | undefined;
    let status: "sent" | "failed" = "failed";
    let errorMessage: string | undefined;
    let providerResponse: any;

    try {
      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);

      // Prepare email content
      const text = args.body;
      const html = args.isHtml
        ? args.body
        : `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333;">${escapeHtml(args.body).replace(/\n/g, "<br/>")}</div>`;

      const emailPayload: any = {
        from,
        to: trimmedTo,
        subject: args.subject,
        text,
        html,
      };

      if (validCc.length > 0) emailPayload.cc = validCc;
      if (validBcc.length > 0) emailPayload.bcc = validBcc;

      console.log("[sendEmail] Sending email", {
        to: trimmedTo,
        subject: args.subject,
        ccCount: validCc.length,
        bccCount: validBcc.length,
      });

      const { data, error } = await resend.emails.send(emailPayload);

      if (error) {
        console.error("[sendEmail] Resend error", error);
        errorMessage = error.message || "Failed to send email";
        providerResponse = error;
      } else {
        messageId = data?.id;
        status = "sent";
        providerResponse = data;
        console.info("[sendEmail] Email sent successfully", {
          to: trimmedTo,
          id: messageId,
          elapsedMs: Date.now() - startTime,
        });
      }
    } catch (err: any) {
      console.error("[sendEmail] Exception", err);
      errorMessage = err?.message || "Failed to send email";
      providerResponse = { error: err?.message };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // AUDIT LOG (always store, regardless of success/failure)
    // ═══════════════════════════════════════════════════════════════════════

    try {
      await ctx.runMutation(internal.tools.sendEmailMutations.logEmailEvent, {
        to: trimmedTo,
        cc: validCc.length > 0 ? validCc : undefined,
        bcc: validBcc.length > 0 ? validBcc : undefined,
        subject: args.subject,
        bodyPreview: args.body.substring(0, 200),
        status,
        messageId,
        providerResponse,
        errorMessage,
      });
    } catch (logError) {
      console.error("[sendEmail] Failed to log email event:", logError);
      // Don't fail the tool call just because logging failed
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RETURN RESULT
    // ═══════════════════════════════════════════════════════════════════════

    if (status === "sent") {
      let result = `✅ Email sent successfully!\n\n`;
      result += `**To:** ${trimmedTo}\n`;
      if (validCc.length > 0) result += `**CC:** ${validCc.join(", ")}\n`;
      if (validBcc.length > 0) result += `**BCC:** ${validBcc.length} recipients\n`;
      result += `**Subject:** ${args.subject}\n`;
      result += `**Message ID:** ${messageId || "N/A"}\n`;
      result += `\nThe email has been logged for audit compliance.`;
      return result;
    } else {
      return `❌ Failed to send email: ${errorMessage}\n\nPlease check the recipient address and try again.`;
    }
  },
});
