/**
 * ntfy Channel Provider — Wraps convex/domains/integrations/ntfy.ts
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
import { EXTENDED_CHANNEL_CAPABILITIES, getConstraintsForChannel } from "../channelProvider.js";

interface NtfyPayload {
  topic: string;
  title: string;
  message: string;
  priority: number;
  tags?: string[];
  click?: string;
  markdown?: boolean;
}

function urgencyToPriority(urgency: RawContent["urgency"]): number {
  switch (urgency) {
    case "critical": return 5;
    case "high": return 4;
    case "normal": return 3;
    case "low": return 2;
  }
}

export const ntfyProvider: ChannelProvider = {
  channelId: "ntfy",
  providerType: "native",
  displayName: "ntfy Push Notifications",

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const payload = message.formatted.payload as NtfyPayload;
    const baseUrl = process.env.NTFY_BASE_URL || "https://ntfy.sh";
    const start = Date.now();

    try {
      const response = await fetch(`${baseUrl}/${payload.topic}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: payload.topic,
          title: payload.title,
          message: payload.message,
          priority: payload.priority,
          tags: payload.tags,
          click: payload.click,
          markdown: payload.markdown,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          channelId: "ntfy",
          success: false,
          error: `ntfy API error: ${response.status} ${errorText}`,
          latencyMs: Date.now() - start,
        };
      }

      const result = await response.json();
      return {
        channelId: "ntfy",
        success: true,
        messageId: result.id,
        deliveredAt: Date.now(),
        costCents: 0,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        channelId: "ntfy",
        success: false,
        error: err.message ?? "ntfy send failed",
        latencyMs: Date.now() - start,
      };
    }
  },

  formatContent(content: RawContent, constraints: FormatConstraints): FormattedPayload {
    const topic = process.env.NTFY_DEFAULT_TOPIC || "nodebench";
    const title = (content.subject ?? content.contentType).slice(0, 120);

    // Reserve space for actions
    const actionsText = content.actions
      ? content.actions.slice(0, 3).map((a) => `${a.label}: ${a.url}`).join(" | ")
      : "";
    const actionsReserve = actionsText ? actionsText.length + 10 : 0;

    const maxBody = constraints.maxLength - actionsReserve;
    let body = content.text.slice(0, maxBody);
    if (actionsText) body += `\n\n${actionsText}`;

    const payload: NtfyPayload = {
      topic,
      title,
      message: body,
      priority: urgencyToPriority(content.urgency),
      click: content.actions?.[0]?.url,
      markdown: true,
    };

    return {
      channelId: "ntfy",
      payload,
      estimatedBytes: JSON.stringify(payload).length,
    };
  },

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.NTFY_BASE_URL || process.env.NTFY_DEFAULT_TOPIC);
  },

  getRateLimit(): RateLimitConfig {
    return { maxPerMinute: 60, maxPerDay: 5000, burstSize: 10, burstCooldownMs: 5000 };
  },

  getConstraints(): FormatConstraints {
    return getConstraintsForChannel("ntfy");
  },
};
