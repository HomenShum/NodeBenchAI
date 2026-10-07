/**
 * Discord Channel Provider — Wraps convex/domains/integrations/discord.ts
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

interface DiscordPayload {
  content?: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    color?: number;
    url?: string;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>;
  components?: Array<{
    type: number;
    components: Array<{
      type: number;
      label: string;
      style: number;
      url?: string;
      custom_id?: string;
    }>;
  }>;
}

/** Map urgency to Discord embed color */
function urgencyToColor(urgency: RawContent["urgency"]): number {
  switch (urgency) {
    case "critical": return 0xED4245; // Red
    case "high": return 0xFEE75C; // Yellow
    case "normal": return 0x5865F2; // Blurple
    case "low": return 0x57F287; // Green
  }
}

export const discordProvider: ChannelProvider = {
  channelId: "discord",
  providerType: "native",
  displayName: "Discord",

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const payload = message.formatted.payload as DiscordPayload;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    const start = Date.now();

    if (!botToken) {
      return {
        channelId: "discord",
        success: false,
        error: "DISCORD_BOT_TOKEN not configured",
        latencyMs: Date.now() - start,
      };
    }

    const channelId = message.recipient;

    try {
      const response = await fetch(
        `https://discord.com/api/v10/channels/${channelId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          channelId: "discord",
          success: false,
          error: `Discord API error: ${response.status} ${errorText}`,
          latencyMs: Date.now() - start,
        };
      }

      const result = await response.json();
      return {
        channelId: "discord",
        success: true,
        messageId: result.id,
        deliveredAt: Date.now(),
        costCents: 0,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        channelId: "discord",
        success: false,
        error: err.message ?? "Discord send failed",
        latencyMs: Date.now() - start,
      };
    }
  },

  formatContent(content: RawContent, constraints: FormatConstraints): FormattedPayload {
    const embed: DiscordPayload["embeds"] = [
      {
        title: content.subject?.slice(0, 256),
        description: (content.markdown ?? content.text).slice(0, 4096),
        color: urgencyToColor(content.urgency),
      },
    ];

    const payload: DiscordPayload = {
      embeds: embed,
    };

    // Action buttons (Discord action row)
    if (content.actions && content.actions.length > 0) {
      payload.components = [
        {
          type: 1, // ACTION_ROW
          components: content.actions.slice(0, 5).map((a) => ({
            type: 2, // BUTTON
            label: a.label.slice(0, 80),
            style: 5, // LINK
            url: a.url,
          })),
        },
      ];
    }

    return {
      channelId: "discord",
      payload,
      estimatedBytes: JSON.stringify(payload).length,
    };
  },

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.DISCORD_BOT_TOKEN);
  },

  getRateLimit(): RateLimitConfig {
    // Discord: 5 msgs/sec per channel
    return { maxPerMinute: 300, maxPerDay: 50000, burstSize: 5, burstCooldownMs: 1000 };
  },

  getConstraints(): FormatConstraints {
    return getConstraintsForChannel("discord");
  },
};
