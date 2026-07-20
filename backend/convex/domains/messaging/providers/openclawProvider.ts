/**
 * OpenClaw Super-Provider — Routes all OpenClaw Gateway channels
 *
 * Single provider serving WhatsApp, Signal, iMessage, MS Teams, Matrix, WebChat.
 * Each outbound message is routed through the Gateway with sandbox enforcement
 * (logged to openclawExecutions for audit).
 *
 * This is NOT a standalone ChannelProvider — it's a factory that creates
 * per-channel providers sharing the same Gateway client.
 */

import type {
  ChannelProvider,
  OutboundMessage,
  DeliveryResult,
  RawContent,
  FormatConstraints,
  FormattedPayload,
  RateLimitConfig,
  OpenClawChannelId,
} from "../channelProvider.js";
import {
  OPENCLAW_CHANNELS,
  EXTENDED_CHANNEL_CAPABILITIES,
  getConstraintsForChannel,
} from "../channelProvider.js";
import * as gateway from "./openclawGatewayClient.js";

/* ================================================================== */
/* OPENCLAW PAYLOAD                                                    */
/* ================================================================== */

interface OpenClawPayload {
  /** Message text (plain or formatted per channel) */
  text: string;
  /** OpenClaw session key for routing */
  sessionKey: string;
  /** Original channel ID for audit */
  channelId: OpenClawChannelId;
}

/* ================================================================== */
/* PER-CHANNEL PROVIDER FACTORY                                        */
/* ================================================================== */

/**
 * Create a ChannelProvider for a specific OpenClaw channel.
 *
 * All OpenClaw providers share the same Gateway client and rate limits.
 * The channel ID determines the session key prefix and formatting constraints.
 */
function createOpenClawChannelProvider(channelId: OpenClawChannelId): ChannelProvider {
  const cap = EXTENDED_CHANNEL_CAPABILITIES[channelId];

  return {
    channelId,
    providerType: "openclaw",
    displayName: `OpenClaw → ${channelId}`,

    async send(message: OutboundMessage): Promise<DeliveryResult> {
      const payload = message.formatted.payload as OpenClawPayload;
      const start = Date.now();

      const result = await gateway.sendMessage(payload.sessionKey, payload.text);

      return {
        channelId,
        success: result.success,
        messageId: result.messageId,
        deliveredAt: result.success ? Date.now() : undefined,
        error: result.error,
        costCents: 0,
        latencyMs: result.latencyMs ?? (Date.now() - start),
      };
    },

    formatContent(content: RawContent, constraints: FormatConstraints): FormattedPayload {
      // Pick the best text representation for this channel
      let text: string;
      if (constraints.supportsMarkdown && content.markdown) {
        text = content.markdown;
      } else if (constraints.supportsRichText && content.html) {
        // Strip HTML tags for channels that don't render HTML natively
        text = content.html.replace(/<[^>]+>/g, "");
      } else {
        text = content.text;
      }

      // Prepend subject if present
      if (content.subject) {
        text = `*${content.subject}*\n\n${text}`;
      }

      // Append action links
      if (content.actions && content.actions.length > 0) {
        const links = content.actions
          .slice(0, 3)
          .map((a) => `${a.label}: ${a.url}`)
          .join("\n");
        text += `\n\n${links}`;
      }

      text = text.slice(0, constraints.maxLength);

      const payload: OpenClawPayload = {
        text,
        sessionKey: "", // Filled by outbound pipeline from recipient/preferences
        channelId,
      };

      return {
        channelId,
        payload,
        estimatedBytes: text.length * 2,
      };
    },

    async isAvailable(): Promise<boolean> {
      // Check if the Gateway is reachable AND this channel is connected
      const isUp = await gateway.ping();
      if (!isUp) return false;

      const statuses = await gateway.getChannelStatus();
      return statuses.some((s) => s.channel === channelId && s.connected);
    },

    getRateLimit(): RateLimitConfig {
      // Conservative defaults — per-channel Gateway limits
      return {
        maxPerMinute: 30,
        maxPerDay: 5000,
        burstSize: 5,
        burstCooldownMs: 2000,
      };
    },

    getConstraints(): FormatConstraints {
      return getConstraintsForChannel(channelId);
    },
  };
}

/* ================================================================== */
/* EXPORTS                                                             */
/* ================================================================== */

/** Pre-built providers for all OpenClaw channels */
export const openclawProviders: Record<OpenClawChannelId, ChannelProvider> = {
  whatsapp: createOpenClawChannelProvider("whatsapp"),
  signal: createOpenClawChannelProvider("signal"),
  imessage: createOpenClawChannelProvider("imessage"),
  msteams: createOpenClawChannelProvider("msteams"),
  matrix: createOpenClawChannelProvider("matrix"),
  webchat: createOpenClawChannelProvider("webchat"),
};

/**
 * Check if the OpenClaw Gateway is reachable at all.
 * Used by the registry to decide whether to register OpenClaw channels.
 */
export async function isGatewayAvailable(): Promise<boolean> {
  return gateway.ping();
}
