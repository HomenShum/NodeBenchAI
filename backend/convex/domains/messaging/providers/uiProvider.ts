/**
 * UI Channel Provider — In-app notifications via Convex subscriptions
 *
 * No external API calls. Messages are written directly to Convex tables
 * and delivered via real-time subscriptions to the web client.
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

interface UIPayload {
  title?: string;
  body: string;
  html?: string;
  urgency: string;
  contentType: string;
  actions?: Array<{ label: string; url: string }>;
}

export const uiProvider: ChannelProvider = {
  channelId: "ui",
  providerType: "native",
  displayName: "In-App UI",

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    // UI delivery is handled by the Convex mutation that writes to
    // the notifications table. The web client subscribes to changes.
    // This provider formats the content — actual write happens in the pipeline.
    return {
      channelId: "ui",
      success: true,
      messageId: `ui-${Date.now()}`,
      deliveredAt: Date.now(),
      costCents: 0,
      latencyMs: 0,
    };
  },

  formatContent(content: RawContent, constraints: FormatConstraints): FormattedPayload {
    const payload: UIPayload = {
      title: content.subject,
      body: content.text,
      html: content.html,
      urgency: content.urgency,
      contentType: content.contentType,
      actions: content.actions,
    };

    return {
      channelId: "ui",
      payload,
      estimatedBytes: JSON.stringify(payload).length,
    };
  },

  async isAvailable(): Promise<boolean> {
    return true; // Always available — it's the local Convex subscription
  },

  getRateLimit(): RateLimitConfig {
    return { maxPerMinute: 600, maxPerDay: 100000, burstSize: 50, burstCooldownMs: 500 };
  },

  getConstraints(): FormatConstraints {
    return getConstraintsForChannel("ui");
  },
};
