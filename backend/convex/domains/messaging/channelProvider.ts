/**
 * Channel Provider Abstraction — Unified Multi-Channel Messaging Interface
 *
 * Promotes OpenClaw from sandbox-only to a super-provider for multi-channel
 * messaging while preserving all existing native integrations (ntfy, email,
 * SMS/Twilio, Slack, Telegram, Discord, UI).
 *
 * Architecture:
 *   Native providers wrap existing integrations (convex/domains/integrations/*)
 *   OpenClaw provider routes through Gateway (ws://127.0.0.1:18789)
 *   Provider registry resolves channelId → best available provider
 *
 * Extends: convex/domains/channels/channelIntelligence.ts (Channel, ChannelCapability)
 */

import type { Id } from "../../_generated/dataModel";

/* ================================================================== */
/* CHANNEL IDENTITY                                                    */
/* ================================================================== */

/** Native channels (existing integrations) */
export type NativeChannelId =
  | "ntfy"
  | "email"
  | "sms"
  | "slack"
  | "discord"
  | "telegram"
  | "ui";

/** OpenClaw Gateway channels (new via OpenClaw) */
export type OpenClawChannelId =
  | "whatsapp"
  | "signal"
  | "imessage"
  | "msteams"
  | "matrix"
  | "webchat";

/** All supported channel identifiers */
export type ChannelId = NativeChannelId | OpenClawChannelId;

/** Provider type — native (existing integration) or openclaw (Gateway proxy) */
export type ProviderType = "native" | "openclaw";

/* ================================================================== */
/* MESSAGE TYPES                                                       */
/* ================================================================== */

/** Raw content before channel-specific formatting */
export interface RawContent {
  /** Plain text body */
  text: string;
  /** Optional HTML body (for rich-text channels) */
  html?: string;
  /** Optional markdown body (for Telegram/Discord/Slack) */
  markdown?: string;
  /** Subject line (for email, ntfy title) */
  subject?: string;
  /** Urgency level — drives priority/interrupt behavior */
  urgency: "critical" | "high" | "normal" | "low";
  /** Content classification */
  contentType: "alert" | "digest" | "report" | "notification" | "agent_response";
  /** Optional attachments */
  attachments?: Array<{
    url: string;
    filename: string;
    mimeType: string;
  }>;
  /** Optional action buttons/links */
  actions?: Array<{
    label: string;
    url: string;
  }>;
  /** Correlation ID for tracing through the pipeline */
  traceId?: string;
}

/** Channel-specific formatting constraints */
export interface FormatConstraints {
  maxLength: number;
  supportsRichText: boolean;
  supportsImages: boolean;
  supportsLinks: boolean;
  supportsButtons: boolean;
  supportsMarkdown: boolean;
}

/** Formatted payload ready for delivery */
export interface FormattedPayload {
  channelId: ChannelId;
  /** Channel-native payload (ntfy JSON, Twilio body, Slack blocks, etc.) */
  payload: unknown;
  /** Byte size estimate for cost/quota tracking */
  estimatedBytes: number;
}

/** Outbound message — the unit of work for a provider */
export interface OutboundMessage {
  /** Recipient identifier (phone, email, chat ID, channel ID, session key) */
  recipient: string;
  /** Pre-formatted payload for this specific channel */
  formatted: FormattedPayload;
  /** Raw content (for re-formatting on retry to different channel) */
  raw: RawContent;
  /** User ID in Convex (for audit + preferences) */
  userId?: Id<"users">;
  /** Originating event (meeting, digest, agent run) */
  sourceEvent?: {
    type: string;
    id: string;
  };
  /** OpenClaw session key (for Gateway-routed messages) */
  openclawSessionKey?: string;
}

/** Result of a send attempt */
export interface DeliveryResult {
  channelId: ChannelId;
  success: boolean;
  /** Provider-assigned message ID (Twilio SID, Telegram message_id, etc.) */
  messageId?: string;
  /** Delivery timestamp */
  deliveredAt?: number;
  /** Error message on failure */
  error?: string;
  /** Number of retry attempts used */
  retryCount?: number;
  /** Cost in cents (SMS segments, API credits) */
  costCents?: number;
  /** Latency from send() call to provider acknowledgment */
  latencyMs?: number;
}

/* ================================================================== */
/* RATE LIMITING                                                       */
/* ================================================================== */

export interface RateLimitConfig {
  /** Max messages per minute */
  maxPerMinute: number;
  /** Max messages per day */
  maxPerDay: number;
  /** Burst allowance (above per-minute rate) */
  burstSize: number;
  /** Cooldown after burst (ms) */
  burstCooldownMs: number;
}

/* ================================================================== */
/* CHANNEL PROVIDER INTERFACE                                          */
/* ================================================================== */

/**
 * Unified channel provider interface.
 *
 * Each provider wraps a single delivery mechanism (Twilio, ntfy, OpenClaw Gateway, etc.)
 * and exposes a consistent API for the messaging pipeline.
 */
export interface ChannelProvider {
  /** Which channel this provider serves */
  readonly channelId: ChannelId;

  /** Whether this is a native integration or OpenClaw Gateway proxy */
  readonly providerType: ProviderType;

  /** Human-readable provider name (for logging/diagnostics) */
  readonly displayName: string;

  /**
   * Send a message through this channel.
   * The message.formatted.payload is already channel-specific.
   */
  send(message: OutboundMessage): Promise<DeliveryResult>;

  /**
   * Format raw content into a channel-specific payload.
   * Called by the outbound pipeline before send().
   */
  formatContent(content: RawContent, constraints: FormatConstraints): FormattedPayload;

  /**
   * Check if this provider is currently available (API key set, service reachable).
   * Used by the registry to determine which channels are online.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get rate limit configuration for this channel.
   * The pipeline enforces these limits before calling send().
   */
  getRateLimit(): RateLimitConfig;

  /**
   * Get formatting constraints for this channel.
   * Used by formatContent() and the pipeline for content truncation/adaptation.
   */
  getConstraints(): FormatConstraints;
}

/* ================================================================== */
/* CHANNEL CAPABILITIES (extended from channelIntelligence.ts)         */
/* ================================================================== */

/**
 * Extended channel capability metadata.
 * Superset of channelIntelligence.ChannelCapability with OpenClaw channels.
 */
export interface ExtendedChannelCapability {
  channelId: ChannelId;
  providerType: ProviderType;
  supportsRichText: boolean;
  supportsImages: boolean;
  supportsLinks: boolean;
  supportsButtons: boolean;
  supportsMarkdown: boolean;
  maxLength: number;
  latencyMs: number;
  costPerMessage: number;
  interruptLevel: "high" | "medium" | "low";
}

/** Full capability map for all channels (native + OpenClaw) */
export const EXTENDED_CHANNEL_CAPABILITIES: Record<ChannelId, ExtendedChannelCapability> = {
  // ─── Native channels ───
  ntfy: {
    channelId: "ntfy",
    providerType: "native",
    supportsRichText: false,
    supportsImages: false,
    supportsLinks: true,
    supportsButtons: false,
    supportsMarkdown: true,
    maxLength: 4096,
    latencyMs: 100,
    costPerMessage: 0,
    interruptLevel: "high",
  },
  email: {
    channelId: "email",
    providerType: "native",
    supportsRichText: true,
    supportsImages: true,
    supportsLinks: true,
    supportsButtons: false,
    supportsMarkdown: false,
    maxLength: 100_000,
    latencyMs: 2000,
    costPerMessage: 0.001,
    interruptLevel: "low",
  },
  sms: {
    channelId: "sms",
    providerType: "native",
    supportsRichText: false,
    supportsImages: false,
    supportsLinks: true,
    supportsButtons: false,
    supportsMarkdown: false,
    maxLength: 1600,
    latencyMs: 1000,
    costPerMessage: 0.0109,
    interruptLevel: "high",
  },
  slack: {
    channelId: "slack",
    providerType: "native",
    supportsRichText: true,
    supportsImages: true,
    supportsLinks: true,
    supportsButtons: true,
    supportsMarkdown: true,
    maxLength: 40_000,
    latencyMs: 500,
    costPerMessage: 0,
    interruptLevel: "medium",
  },
  discord: {
    channelId: "discord",
    providerType: "native",
    supportsRichText: true,
    supportsImages: true,
    supportsLinks: true,
    supportsButtons: true,
    supportsMarkdown: true,
    maxLength: 4000,
    latencyMs: 300,
    costPerMessage: 0,
    interruptLevel: "medium",
  },
  telegram: {
    channelId: "telegram",
    providerType: "native",
    supportsRichText: true,
    supportsImages: true,
    supportsLinks: true,
    supportsButtons: true,
    supportsMarkdown: true,
    maxLength: 4096,
    latencyMs: 200,
    costPerMessage: 0,
    interruptLevel: "medium",
  },
  ui: {
    channelId: "ui",
    providerType: "native",
    supportsRichText: true,
    supportsImages: true,
    supportsLinks: true,
    supportsButtons: true,
    supportsMarkdown: true,
    maxLength: 1_000_000,
    latencyMs: 50,
    costPerMessage: 0,
    interruptLevel: "low",
  },

  // ─── OpenClaw Gateway channels ───
  whatsapp: {
    channelId: "whatsapp",
    providerType: "openclaw",
    supportsRichText: false,
    supportsImages: true,
    supportsLinks: true,
    supportsButtons: true,
    supportsMarkdown: false,
    maxLength: 65_536,
    latencyMs: 500,
    costPerMessage: 0,
    interruptLevel: "high",
  },
  signal: {
    channelId: "signal",
    providerType: "openclaw",
    supportsRichText: false,
    supportsImages: true,
    supportsLinks: true,
    supportsButtons: false,
    supportsMarkdown: false,
    maxLength: 65_536,
    latencyMs: 300,
    costPerMessage: 0,
    interruptLevel: "high",
  },
  imessage: {
    channelId: "imessage",
    providerType: "openclaw",
    supportsRichText: false,
    supportsImages: true,
    supportsLinks: true,
    supportsButtons: false,
    supportsMarkdown: false,
    maxLength: 20_000,
    latencyMs: 400,
    costPerMessage: 0,
    interruptLevel: "high",
  },
  msteams: {
    channelId: "msteams",
    providerType: "openclaw",
    supportsRichText: true,
    supportsImages: true,
    supportsLinks: true,
    supportsButtons: true,
    supportsMarkdown: true,
    maxLength: 28_000,
    latencyMs: 600,
    costPerMessage: 0,
    interruptLevel: "medium",
  },
  matrix: {
    channelId: "matrix",
    providerType: "openclaw",
    supportsRichText: true,
    supportsImages: true,
    supportsLinks: true,
    supportsButtons: false,
    supportsMarkdown: true,
    maxLength: 65_536,
    latencyMs: 400,
    costPerMessage: 0,
    interruptLevel: "medium",
  },
  webchat: {
    channelId: "webchat",
    providerType: "openclaw",
    supportsRichText: true,
    supportsImages: true,
    supportsLinks: true,
    supportsButtons: true,
    supportsMarkdown: true,
    maxLength: 100_000,
    latencyMs: 100,
    costPerMessage: 0,
    interruptLevel: "low",
  },
};

/** All native channel IDs */
export const NATIVE_CHANNELS: NativeChannelId[] = [
  "ntfy", "email", "sms", "slack", "discord", "telegram", "ui",
];

/** All OpenClaw channel IDs */
export const OPENCLAW_CHANNELS: OpenClawChannelId[] = [
  "whatsapp", "signal", "imessage", "msteams", "matrix", "webchat",
];

/** All channel IDs */
export const ALL_CHANNELS: ChannelId[] = [...NATIVE_CHANNELS, ...OPENCLAW_CHANNELS];

/**
 * Helper: get FormatConstraints from channel capabilities
 */
export function getConstraintsForChannel(channelId: ChannelId): FormatConstraints {
  const cap = EXTENDED_CHANNEL_CAPABILITIES[channelId];
  return {
    maxLength: cap.maxLength,
    supportsRichText: cap.supportsRichText,
    supportsImages: cap.supportsImages,
    supportsLinks: cap.supportsLinks,
    supportsButtons: cap.supportsButtons,
    supportsMarkdown: cap.supportsMarkdown,
  };
}
