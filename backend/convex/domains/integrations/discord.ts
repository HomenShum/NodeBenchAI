/**
 * Discord Bot Integration
 *
 * FREE messaging via Discord Bot API with slash commands.
 * Enables bidirectional communication through Discord channels.
 *
 * Features:
 * - Slash commands (/query, /funding, /news, /status)
 * - Rich embeds for formatted responses
 * - Button interactions for quick actions
 * - Webhook-based interactions (no gateway needed)
 *
 * Setup:
 * 1. Go to https://discord.com/developers/applications
 * 2. Create new application → Bot → Enable Message Content Intent
 * 3. Copy Bot Token → DISCORD_BOT_TOKEN env var
 * 4. Copy Application ID → DISCORD_APPLICATION_ID env var
 * 5. Copy Public Key → DISCORD_PUBLIC_KEY env var
 * 6. Set Interactions Endpoint URL to your webhook
 * 7. Invite bot to server with applications.commands scope
 *
 * @see https://discord.com/developers/docs/interactions/receiving-and-responding
 * @module integrations/discord
 */

import { v } from "convex/values";
import { action, internalAction, mutation, query, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import nacl from "tweetnacl";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Discord Interaction Types */
export enum InteractionType {
  PING = 1,
  APPLICATION_COMMAND = 2,
  MESSAGE_COMPONENT = 3,
  APPLICATION_COMMAND_AUTOCOMPLETE = 4,
  MODAL_SUBMIT = 5,
}

/** Discord Interaction Response Types */
export enum InteractionResponseType {
  PONG = 1,
  CHANNEL_MESSAGE_WITH_SOURCE = 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5,
  DEFERRED_UPDATE_MESSAGE = 6,
  UPDATE_MESSAGE = 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT = 8,
  MODAL = 9,
}

/** Discord Message Flags */
export enum MessageFlags {
  EPHEMERAL = 64, // Only visible to the user who triggered
}

/** Discord Embed object */
export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: {
    text: string;
    icon_url?: string;
  };
  author?: {
    name: string;
    url?: string;
    icon_url?: string;
  };
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  thumbnail?: { url: string };
  image?: { url: string };
}

/** Discord Button Component */
export interface DiscordButton {
  type: 2; // Button
  style: 1 | 2 | 3 | 4 | 5; // Primary, Secondary, Success, Danger, Link
  label: string;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
  emoji?: { name: string; id?: string };
}

/** Discord Action Row */
export interface DiscordActionRow {
  type: 1;
  components: DiscordButton[];
}

/** Discord Interaction payload */
export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: InteractionType;
  data?: {
    id: string;
    name: string;
    type?: number;
    options?: Array<{
      name: string;
      type: number;
      value: string | number | boolean;
    }>;
    custom_id?: string;
    component_type?: number;
  };
  guild_id?: string;
  channel_id?: string;
  member?: {
    user: DiscordUser;
    nick?: string;
    roles: string[];
  };
  user?: DiscordUser;
  token: string;
  version: number;
  message?: {
    id: string;
    content: string;
  };
}

/** Discord User object */
export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name?: string;
  avatar?: string;
}

/** Discord API response */
interface DiscordApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

function getConfig() {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const applicationId = process.env.DISCORD_APPLICATION_ID;
  const publicKey = process.env.DISCORD_PUBLIC_KEY;

  return { botToken, applicationId, publicKey };
}

function getBotToken(): string {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN environment variable is not set");
  }
  return token;
}

function getApplicationId(): string {
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId) {
    throw new Error("DISCORD_APPLICATION_ID environment variable is not set");
  }
  return appId;
}

// ═══════════════════════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════════════════════

async function callDiscordApi<T>(
  endpoint: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: Record<string, unknown>
): Promise<DiscordApiResponse<T>> {
  const token = getBotToken();
  const url = `https://discord.com/api/v10${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      ...(body && { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Discord] API error: ${response.status}`, errorText);
      return { ok: false, error: errorText, status: response.status };
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return { ok: true };
    }

    const data = await response.json();
    return { ok: true, data: data as T };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[Discord] API call failed:", errorMsg);
    return { ok: false, error: errorMsg };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SIGNATURE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify Discord interaction signature using tweetnacl Ed25519.
 * Discord requires this for all interaction webhooks.
 *
 * Based on discord-interactions library approach:
 * - Message = timestamp + body (concatenated as string, then encoded to bytes)
 * - Signature = hex-encoded Ed25519 signature
 * - Public key = hex-encoded Ed25519 public key
 */
export function verifyDiscordSignature(
  signature: string,
  timestamp: string,
  body: string,
  publicKey: string
): boolean {
  try {
    // Convert hex to Uint8Array
    const sigBytes = hexToUint8Array(signature);
    const pubKeyBytes = hexToUint8Array(publicKey);

    // Message is timestamp + body, encoded as UTF-8
    const message = new TextEncoder().encode(timestamp + body);

    // Verify using tweetnacl
    const isValid = nacl.sign.detached.verify(message, sigBytes, pubKeyBytes);

    console.log("[Discord] Verification details:", {
      sigLength: sigBytes.length,
      pubKeyLength: pubKeyBytes.length,
      messageLength: message.length,
      result: isValid,
    });

    return isValid;
  } catch (error) {
    console.error("[Discord] Signature verification failed:", error);
    return false;
  }
}

/**
 * Convert hex string to Uint8Array.
 */
function hexToUint8Array(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g);
  if (!matches) {
    throw new Error("Invalid hex string");
  }
  return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
}

// ═══════════════════════════════════════════════════════════════════════════
// SEND ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send a message to a Discord channel.
 */
export const sendMessage = internalAction({
  args: {
    channelId: v.string(),
    content: v.optional(v.string()),
    embeds: v.optional(v.array(v.any())), // DiscordEmbed[]
    components: v.optional(v.array(v.any())), // DiscordActionRow[]
  },
  handler: async (ctx, args): Promise<{ sent: boolean; messageId?: string; error?: string }> => {
    try {
      const body: Record<string, unknown> = {};

      if (args.content) body.content = args.content;
      if (args.embeds) body.embeds = args.embeds;
      if (args.components) body.components = args.components;

      const response = await callDiscordApi<{ id: string }>(
        `/channels/${args.channelId}/messages`,
        "POST",
        body
      );

      if (response.ok && response.data) {
        console.log(`[Discord] Message sent to channel ${args.channelId}`);
        return { sent: true, messageId: response.data.id };
      }

      return { sent: false, error: response.error };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { sent: false, error: errorMsg };
    }
  },
});

/**
 * Send a DM to a Discord user.
 */
export const sendDirectMessage = internalAction({
  args: {
    userId: v.string(),
    content: v.optional(v.string()),
    embeds: v.optional(v.array(v.any())),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; messageId?: string; error?: string }> => {
    try {
      // First, create a DM channel with the user
      const dmChannel = await callDiscordApi<{ id: string }>(
        `/users/@me/channels`,
        "POST",
        { recipient_id: args.userId }
      );

      if (!dmChannel.ok || !dmChannel.data) {
        return { sent: false, error: dmChannel.error || "Failed to create DM channel" };
      }

      // Then send the message
      const body: Record<string, unknown> = {};
      if (args.content) body.content = args.content;
      if (args.embeds) body.embeds = args.embeds;

      const response = await callDiscordApi<{ id: string }>(
        `/channels/${dmChannel.data.id}/messages`,
        "POST",
        body
      );

      if (response.ok && response.data) {
        return { sent: true, messageId: response.data.id };
      }

      return { sent: false, error: response.error };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { sent: false, error: errorMsg };
    }
  },
});

/**
 * Edit an existing message.
 */
export const editMessage = internalAction({
  args: {
    channelId: v.string(),
    messageId: v.string(),
    content: v.optional(v.string()),
    embeds: v.optional(v.array(v.any())),
    components: v.optional(v.array(v.any())),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    try {
      const body: Record<string, unknown> = {};
      if (args.content !== undefined) body.content = args.content;
      if (args.embeds) body.embeds = args.embeds;
      if (args.components) body.components = args.components;

      const response = await callDiscordApi(
        `/channels/${args.channelId}/messages/${args.messageId}`,
        "PATCH",
        body
      );

      return { success: response.ok, error: response.error };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERACTION RESPONSES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send a followup message to an interaction.
 * Use this after sending a deferred response.
 */
export const sendFollowup = internalAction({
  args: {
    interactionToken: v.string(),
    content: v.optional(v.string()),
    embeds: v.optional(v.array(v.any())),
    components: v.optional(v.array(v.any())),
    ephemeral: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; error?: string }> => {
    try {
      const appId = getApplicationId();
      const body: Record<string, unknown> = {};

      if (args.content) body.content = args.content;
      if (args.embeds) body.embeds = args.embeds;
      if (args.components) body.components = args.components;
      if (args.ephemeral) body.flags = MessageFlags.EPHEMERAL;

      const response = await callDiscordApi(
        `/webhooks/${appId}/${args.interactionToken}`,
        "POST",
        body
      );

      return { sent: response.ok, error: response.error };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { sent: false, error: errorMsg };
    }
  },
});

/**
 * Edit the original interaction response.
 */
export const editOriginalResponse = internalAction({
  args: {
    interactionToken: v.string(),
    content: v.optional(v.string()),
    embeds: v.optional(v.array(v.any())),
    components: v.optional(v.array(v.any())),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    try {
      const appId = getApplicationId();
      const body: Record<string, unknown> = {};

      if (args.content !== undefined) body.content = args.content;
      if (args.embeds) body.embeds = args.embeds;
      if (args.components) body.components = args.components;

      const response = await callDiscordApi(
        `/webhooks/${appId}/${args.interactionToken}/messages/@original`,
        "PATCH",
        body
      );

      return { success: response.ok, error: response.error };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SLASH COMMAND REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

/** Slash command definitions */
const SLASH_COMMANDS = [
  {
    name: "query",
    description: "Ask NodeBench AI a question",
    options: [
      {
        name: "question",
        description: "Your question or search query",
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: "funding",
    description: "Get today's funding announcements",
    options: [
      {
        name: "sector",
        description: "Filter by sector (optional)",
        type: 3, // STRING
        required: false,
      },
    ],
  },
  {
    name: "news",
    description: "Get latest tech and AI news",
    options: [
      {
        name: "topic",
        description: "Filter by topic (optional)",
        type: 3, // STRING
        required: false,
      },
    ],
  },
  {
    name: "status",
    description: "Check NodeBench AI system status",
  },
  {
    name: "help",
    description: "Show help and available commands",
  },
];

/**
 * Register slash commands globally.
 * Run this once after bot setup.
 */
export const registerCommands = action({
  args: {
    guildId: v.optional(v.string()), // If provided, registers to specific guild (faster for testing)
  },
  handler: async (ctx, args): Promise<{ success: boolean; registered: number; error?: string }> => {
    try {
      const appId = getApplicationId();

      const endpoint = args.guildId
        ? `/applications/${appId}/guilds/${args.guildId}/commands`
        : `/applications/${appId}/commands`;

      const response = await callDiscordApi<unknown[]>(
        endpoint,
        "POST" as "POST",
        SLASH_COMMANDS as unknown as Record<string, unknown>
      );

      // Actually need to PUT for bulk overwrite
      const bulkResponse = await fetch(
        `https://discord.com/api/v10${endpoint}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bot ${getBotToken()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(SLASH_COMMANDS),
        }
      );

      if (!bulkResponse.ok) {
        const errorText = await bulkResponse.text();
        return { success: false, registered: 0, error: errorText };
      }

      const commands = await bulkResponse.json();
      console.log(`[Discord] Registered ${commands.length} slash commands`);

      return { success: true, registered: commands.length };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, registered: 0, error: errorMsg };
    }
  },
});

/**
 * List registered commands.
 */
export const listCommands = action({
  args: {
    guildId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const appId = getApplicationId();

      const endpoint = args.guildId
        ? `/applications/${appId}/guilds/${args.guildId}/commands`
        : `/applications/${appId}/commands`;

      const response = await callDiscordApi<Array<{ id: string; name: string; description: string }>>(
        endpoint
      );

      if (response.ok && response.data) {
        return {
          success: true,
          commands: response.data.map((cmd) => ({
            id: cmd.id,
            name: cmd.name,
            description: cmd.description,
          })),
        };
      }

      return { success: false, commands: [], error: response.error };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, commands: [], error: errorMsg };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DISCORD USER/SERVER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register a Discord user for notifications.
 */
export const registerDiscordUser = mutation({
  args: {
    discordUserId: v.string(),
    discordUsername: v.string(),
    discordGuildId: v.optional(v.string()),
    discordChannelId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("discordUsers")
      .withIndex("by_user_id", (q) => q.eq("discordUserId", args.discordUserId))
      .first() as Doc<"discordUsers"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        discordUsername: args.discordUsername,
        lastActiveAt: Date.now(),
      });
      return { id: existing._id, isNew: false };
    }

    const id = await ctx.db.insert("discordUsers", {
      discordUserId: args.discordUserId,
      discordUsername: args.discordUsername,
      discordGuildId: args.discordGuildId,
      discordChannelId: args.discordChannelId,
      notificationsEnabled: true,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });

    return { id, isNew: true };
  },
});

/**
 * Get Discord user by ID.
 */
export const getDiscordUser = query({
  args: {
    discordUserId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("discordUsers")
      .withIndex("by_user_id", (q) => q.eq("discordUserId", args.discordUserId))
      .first() as Doc<"discordUsers"> | null;
  },
});

/**
 * Toggle notifications for a Discord user.
 */
export const toggleNotifications = mutation({
  args: {
    discordUserId: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("discordUsers")
      .withIndex("by_user_id", (q) => q.eq("discordUserId", args.discordUserId))
      .first() as Doc<"discordUsers"> | null;

    if (user) {
      await ctx.db.patch(user._id, { notificationsEnabled: args.enabled });
      return { success: true };
    }

    return { success: false, error: "User not found" };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE LOGGING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Log Discord interaction for audit/debugging.
 */
export const logDiscordInteraction = internalMutation({
  args: {
    discordUserId: v.string(),
    discordUsername: v.string(),
    guildId: v.optional(v.string()),
    channelId: v.optional(v.string()),
    interactionType: v.string(),
    commandName: v.optional(v.string()),
    commandOptions: v.optional(v.any()),
    agentResponse: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("discordInteractions", {
      discordUserId: args.discordUserId,
      discordUsername: args.discordUsername,
      guildId: args.guildId,
      channelId: args.channelId,
      interactionType: args.interactionType,
      commandName: args.commandName,
      commandOptions: args.commandOptions,
      agentResponse: args.agentResponse,
      timestamp: Date.now(),
    });
  },
});

/**
 * Get recent interactions for a user.
 */
export const getRecentInteractions = query({
  args: {
    discordUserId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;

    return await ctx.db
      .query("discordInteractions")
      .withIndex("by_user_id", (q) => q.eq("discordUserId", args.discordUserId))
      .order("desc")
      .take(limit) as Doc<"discordInteractions">[];
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if Discord integration is configured.
 */
export const isConfigured = action({
  args: {},
  handler: async (ctx): Promise<{ configured: boolean; missing: string[] }> => {
    const config = getConfig();
    const missing: string[] = [];

    if (!config.botToken) missing.push("DISCORD_BOT_TOKEN");
    if (!config.applicationId) missing.push("DISCORD_APPLICATION_ID");
    if (!config.publicKey) missing.push("DISCORD_PUBLIC_KEY");

    return {
      configured: missing.length === 0,
      missing,
    };
  },
});

/**
 * Get bot information.
 */
export const getBotInfo = action({
  args: {},
  handler: async (ctx) => {
    try {
      const response = await callDiscordApi<{
        id: string;
        username: string;
        discriminator: string;
        avatar?: string;
      }>("/users/@me");

      if (response.ok && response.data) {
        return {
          ok: true,
          botId: response.data.id,
          username: response.data.username,
          discriminator: response.data.discriminator,
        };
      }

      return { ok: false, error: response.error };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMsg };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// EMBED BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

/** Color constants for embeds */
export const EmbedColors = {
  PRIMARY: 0x5865f2, // Discord Blurple
  SUCCESS: 0x57f287, // Green
  WARNING: 0xfee75c, // Yellow
  ERROR: 0xed4245, // Red
  INFO: 0x5865f2, // Blurple
  FUNDING: 0x57f287, // Green for funding
  NEWS: 0x5865f2, // Blurple for news
};

/**
 * Build a standard embed for responses.
 */
export function buildEmbed(options: {
  title: string;
  description: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: string;
  url?: string;
}): DiscordEmbed {
  return {
    title: options.title,
    description: options.description,
    color: options.color || EmbedColors.PRIMARY,
    fields: options.fields,
    footer: options.footer ? { text: options.footer } : undefined,
    url: options.url,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build action buttons.
 */
export function buildButtons(
  buttons: Array<{
    label: string;
    customId?: string;
    url?: string;
    style?: "primary" | "secondary" | "success" | "danger" | "link";
  }>
): DiscordActionRow {
  const styleMap = {
    primary: 1,
    secondary: 2,
    success: 3,
    danger: 4,
    link: 5,
  } as const;

  return {
    type: 1,
    components: buttons.map((btn) => ({
      type: 2 as const,
      style: styleMap[btn.style || (btn.url ? "link" : "primary")] as 1 | 2 | 3 | 4 | 5,
      label: btn.label,
      ...(btn.customId && { custom_id: btn.customId }),
      ...(btn.url && { url: btn.url }),
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DEBUG FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test signature verification (for debugging).
 */
export const testSignatureVerification = action({
  args: {
    signature: v.string(),
    timestamp: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args): Promise<{ valid: boolean; publicKey: string; error?: string }> => {
    try {
      const publicKey = process.env.DISCORD_PUBLIC_KEY;
      if (!publicKey) {
        return { valid: false, publicKey: "", error: "DISCORD_PUBLIC_KEY not set" };
      }

      const isValid = verifyDiscordSignature(args.signature, args.timestamp, args.body, publicKey);
      return { valid: isValid, publicKey };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { valid: false, publicKey: "", error: errorMsg };
    }
  },
});

/**
 * Test tweetnacl is working.
 */
export const testNacl = action({
  args: {},
  handler: async (ctx): Promise<{ working: boolean; error?: string }> => {
    try {
      // Test that nacl sign.detached.verify works
      const keyPair = nacl.sign.keyPair();
      const message = new TextEncoder().encode("test");
      const signature = nacl.sign.detached(message, keyPair.secretKey);
      const isValid = nacl.sign.detached.verify(message, signature, keyPair.publicKey);
      return { working: isValid };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { working: false, error: errorMsg };
    }
  },
});
