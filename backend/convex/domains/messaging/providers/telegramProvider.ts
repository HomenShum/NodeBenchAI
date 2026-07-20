/**
 * Telegram Channel Provider — Wraps convex/domains/integrations/telegram.ts
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

interface TelegramPayload {
  chat_id: string;
  text: string;
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  reply_markup?: {
    inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>>;
  };
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
}

export const telegramProvider: ChannelProvider = {
  channelId: "telegram",
  providerType: "native",
  displayName: "Telegram",

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const payload = message.formatted.payload as TelegramPayload;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const start = Date.now();

    if (!botToken) {
      return {
        channelId: "telegram",
        success: false,
        error: "TELEGRAM_BOT_TOKEN not configured",
        latencyMs: Date.now() - start,
      };
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const result = await response.json();

      if (!result.ok) {
        return {
          channelId: "telegram",
          success: false,
          error: result.description ?? "Telegram API error",
          latencyMs: Date.now() - start,
        };
      }

      return {
        channelId: "telegram",
        success: true,
        messageId: String(result.result?.message_id),
        deliveredAt: Date.now(),
        costCents: 0,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        channelId: "telegram",
        success: false,
        error: err.message ?? "Telegram send failed",
        latencyMs: Date.now() - start,
      };
    }
  },

  formatContent(content: RawContent, constraints: FormatConstraints): FormattedPayload {
    const text = (content.markdown ?? content.text).slice(0, constraints.maxLength);

    const payload: TelegramPayload = {
      chat_id: "", // Filled by outbound pipeline
      text,
      parse_mode: content.markdown ? "Markdown" : undefined,
      disable_notification: content.urgency === "low",
    };

    // Inline keyboard for actions
    if (content.actions && content.actions.length > 0) {
      payload.reply_markup = {
        inline_keyboard: [
          content.actions.slice(0, 3).map((a) => ({
            text: a.label,
            url: a.url,
          })),
        ],
      };
    }

    return {
      channelId: "telegram",
      payload,
      estimatedBytes: JSON.stringify(payload).length,
    };
  },

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN);
  },

  getRateLimit(): RateLimitConfig {
    // Telegram: 30 msgs/sec global, 1 msg/sec per chat
    return { maxPerMinute: 30, maxPerDay: 50000, burstSize: 10, burstCooldownMs: 1000 };
  },

  getConstraints(): FormatConstraints {
    return getConstraintsForChannel("telegram");
  },
};
