/**
 * Email Channel Provider — Wraps convex/domains/integrations/resend.ts
 */

import type {
  ChannelProvider,
  OutboundMessage,
  DeliveryResult,
  RawContent,
  FormatConstraints,
  FormattedPayload,
  RateLimitConfig,
} from "../channelProvider.js";
import { getConstraintsForChannel } from "../channelProvider.js";

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export const emailProvider: ChannelProvider = {
  channelId: "email",
  providerType: "native",
  displayName: "Email (Resend)",

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const payload = message.formatted.payload as EmailPayload;
    const apiKey = process.env.RESEND_API_KEY;
    const start = Date.now();

    if (!apiKey) {
      return {
        channelId: "email",
        success: false,
        error: "RESEND_API_KEY not configured",
        latencyMs: Date.now() - start,
      };
    }

    const fromAddress = process.env.EMAIL_FROM || "NodeBench AI <research@nodebench.ai>";

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [payload.to],
          subject: payload.subject,
          html: payload.html,
          ...(payload.text ? { text: payload.text } : {}),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          channelId: "email",
          success: false,
          error: `Resend API error: ${response.status} ${errorText}`,
          latencyMs: Date.now() - start,
        };
      }

      const result = await response.json();
      return {
        channelId: "email",
        success: true,
        messageId: result.id,
        deliveredAt: Date.now(),
        costCents: 0.1,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        channelId: "email",
        success: false,
        error: err.message ?? "Email send failed",
        latencyMs: Date.now() - start,
      };
    }
  },

  formatContent(content: RawContent, constraints: FormatConstraints): FormattedPayload {
    const subject = content.subject ?? `[${content.contentType}] ${content.text.slice(0, 60)}`;
    const html = content.html ?? `<div>${content.text.replace(/\n/g, "<br>")}</div>`;
    const text = content.text;

    const payload: EmailPayload = {
      to: "", // Filled by outbound pipeline from recipient
      subject,
      html,
      text,
    };

    return {
      channelId: "email",
      payload,
      estimatedBytes: html.length + subject.length,
    };
  },

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.RESEND_API_KEY);
  },

  getRateLimit(): RateLimitConfig {
    return { maxPerMinute: 30, maxPerDay: 2000, burstSize: 5, burstCooldownMs: 10000 };
  },

  getConstraints(): FormatConstraints {
    return getConstraintsForChannel("email");
  },
};
