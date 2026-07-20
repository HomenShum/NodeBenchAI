"use node";

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const sendEmail = action({
  args: {
    to: v.string(),
    subject: v.string(),
    body: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    id: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, { to, subject, body }) => {
    // Require authentication to prevent abuse
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { success: false, error: "Not authenticated" };
    }

    const apiKey = process.env.RESEND_API_KEY;
    // Align default with auth.ts style
    const from = process.env.EMAIL_FROM ?? "Nodebench <no-reply@example.com>";

    if (!apiKey) {
      console.error("[email.sendEmail] Missing RESEND_API_KEY env var");
      return { success: false, error: "Missing RESEND_API_KEY" };
    }

    // Basic recipient email validation
    const trimmedTo = to.trim();
    if (!isValidEmail(trimmedTo)) {
      console.warn("[email.sendEmail] Invalid recipient email", { to });
      return { success: false, error: "Invalid recipient email address" };
    }

    try {
      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);
      const text = body;
      const html = `<div>${escapeHtml(body).replace(/\n/g, "<br/>")}</div>`;

      const { data, error } = await resend.emails.send({
        from,
        to: trimmedTo,
        subject,
        text,
        html,
      });

      if (error) {
        console.error("[email.sendEmail] Resend error", error);
        return { success: false, error: error?.message || "Failed to send" };
      }

      console.info("[email.sendEmail] Email sent", { to: trimmedTo, id: data?.id });
      return { success: true, id: data?.id };
    } catch (err: any) {
      console.error("[email.sendEmail] Exception", err);
      return { success: false, error: err?.message || "Failed to send" };
    }
  },
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Simple email format validation
function isValidEmail(email: string): boolean {
  const emailRe = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  return emailRe.test(email);
}
