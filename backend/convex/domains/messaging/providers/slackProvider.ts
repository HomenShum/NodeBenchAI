/**
 * Slack Channel Provider — Wraps convex/domains/integrations/slack/slackWebhook.ts
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

interface SlackPayload {
  text: string;
  blocks?: Array<Record<string, unknown>>;
  unfurl_links?: boolean;
}

export const slackProvider: ChannelProvider = {
  channelId: "slack",
  providerType: "native",
  displayName: "Slack",

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const payload = message.formatted.payload as SlackPayload;
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    const start = Date.now();

    if (!webhookUrl) {
      return {
        channelId: "slack",
        success: false,
        error: "SLACK_WEBHOOK_URL not configured",
        latencyMs: Date.now() - start,
      };
    }

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          channelId: "slack",
          success: false,
          error: `Slack webhook error: ${response.status} ${errorText}`,
          latencyMs: Date.now() - start,
        };
      }

      return {
        channelId: "slack",
        success: true,
        messageId: `slack-${Date.now()}`,
        deliveredAt: Date.now(),
        costCents: 0,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        channelId: "slack",
        success: false,
        error: err.message ?? "Slack send failed",
        latencyMs: Date.now() - start,
      };
    }
  },

  formatContent(content: RawContent, constraints: FormatConstraints): FormattedPayload {
    const blocks: Array<Record<string, unknown>> = [];

    // Header block
    if (content.subject) {
      blocks.push({
        type: "header",
        text: { type: "plain_text", text: content.subject.slice(0, 150) },
      });
    }

    // Body as markdown section
    const bodyText = (content.markdown ?? content.text).slice(0, 3000);
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: bodyText },
    });

    // Action buttons
    if (content.actions && content.actions.length > 0) {
      blocks.push({
        type: "actions",
        elements: content.actions.slice(0, 5).map((a, i) => ({
          type: "button",
          text: { type: "plain_text", text: a.label.slice(0, 75) },
          url: a.url,
          action_id: `action_${i}`,
        })),
      });
    }

    const payload: SlackPayload = {
      text: content.text.slice(0, 200), // Fallback text
      blocks,
    };

    return {
      channelId: "slack",
      payload,
      estimatedBytes: JSON.stringify(payload).length,
    };
  },

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.SLACK_WEBHOOK_URL || process.env.SLACK_BOT_TOKEN);
  },

  getRateLimit(): RateLimitConfig {
    // Slack: 1 msg/sec per webhook
    return { maxPerMinute: 60, maxPerDay: 10000, burstSize: 5, burstCooldownMs: 1000 };
  },

  getConstraints(): FormatConstraints {
    return getConstraintsForChannel("slack");
  },
};
