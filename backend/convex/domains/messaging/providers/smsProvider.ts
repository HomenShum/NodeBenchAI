/**
 * SMS Channel Provider — Wraps convex/domains/integrations/sms.ts (Twilio)
 *
 * A2P 10DLC compliant. Cost: ~1.09¢/segment (0.79¢ Twilio + 0.30¢ carrier).
 * SMS is the most expensive channel — prefer WhatsApp/ntfy for non-critical messages.
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

interface SmsPayload {
  to: string;
  body: string;
}

/** GSM-7 segment calculation */
function calculateSegments(body: string): number {
  const gsm7 = /^[\x20-\x7E\xA0\xA1\xA3-\xA5\xA7\xBF\xC4-\xC6\xC9\xD1\xD6\xD8\xDC\xDF-\xE6\xE8-\xF1\xF2\xF6\xF8\xFC\u0394\u03A6\u0393\u039B\u03A9\u03A0\u03A8\u03A3\u0398\u039E\r\n]*$/;
  const isGsm7 = gsm7.test(body);
  const length = body.length;
  if (isGsm7) return length <= 160 ? 1 : Math.ceil(length / 153);
  return length <= 70 ? 1 : Math.ceil(length / 67);
}

export const smsProvider: ChannelProvider = {
  channelId: "sms",
  providerType: "native",
  displayName: "SMS (Twilio)",

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const payload = message.formatted.payload as SmsPayload;
    const start = Date.now();

    // SMS send is delegated to the Convex Twilio component action
    // This provider is used for formatting + availability checks.
    // Actual delivery goes through convex/domains/integrations/sms.ts sendSms action.
    const segments = calculateSegments(payload.body);
    const costCents = Math.round(segments * 1.09 * 100) / 100;

    return {
      channelId: "sms",
      success: true,
      messageId: `sms-delegated-${Date.now()}`,
      deliveredAt: Date.now(),
      costCents,
      latencyMs: Date.now() - start,
    };
  },

  formatContent(content: RawContent, constraints: FormatConstraints): FormattedPayload {
    // SMS: plain text only, max 1600 chars (10 segments)
    let body = content.text;

    // Append first action URL if available
    if (content.actions?.[0]) {
      const actionSuffix = `\n\n${content.actions[0].label}: ${content.actions[0].url}`;
      if (body.length + actionSuffix.length <= constraints.maxLength) {
        body += actionSuffix;
      }
    }

    body = body.slice(0, constraints.maxLength);

    const payload: SmsPayload = {
      to: "", // Filled by outbound pipeline
      body,
    };

    return {
      channelId: "sms",
      payload,
      estimatedBytes: body.length * 2, // UCS-2 worst case
    };
  },

  async isAvailable(): Promise<boolean> {
    return Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER,
    );
  },

  getRateLimit(): RateLimitConfig {
    // Twilio A2P 10DLC: ~10 msgs/sec
    return { maxPerMinute: 600, maxPerDay: 10000, burstSize: 10, burstCooldownMs: 1000 };
  },

  getConstraints(): FormatConstraints {
    return getConstraintsForChannel("sms");
  },
};
