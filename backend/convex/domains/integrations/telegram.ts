/**
 * Telegram Bot Integration
 *
 * 100% FREE unlimited messaging via Telegram Bot API.
 * Enables bidirectional mobile communication with your app.
 *
 * Features:
 * - Send messages with Markdown/HTML formatting
 * - Inline keyboards for quick actions
 * - Photo/document attachments
 * - Webhook-based message receiving
 *
 * Setup:
 * 1. Message @BotFather on Telegram: /newbot
 * 2. Set name and username (must end in "bot")
 * 3. Copy API token → TELEGRAM_BOT_TOKEN env var
 * 4. Set webhook via setWebhook endpoint
 *
 * @see https://core.telegram.org/bots/api
 * @module integrations/telegram
 */

import { v } from "convex/values";
import { action, internalAction, mutation, query, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Telegram inline keyboard button */
interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

/** Telegram inline keyboard markup */
interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/** Telegram message options */
interface SendMessageOptions {
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  reply_markup?: InlineKeyboardMarkup;
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
}

/** Telegram API response */
interface TelegramResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/** Telegram message object */
interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  };
  chat: {
    id: number;
    type: "private" | "group" | "supergroup" | "channel";
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  date: number;
  text?: string;
  entities?: Array<{
    type: string;
    offset: number;
    length: number;
  }>;
}

/** Telegram update object (webhook payload) */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramMessage["from"];
    message?: TelegramMessage;
    data?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is not set");
  }
  return token;
}

async function callTelegramApi<T>(
  method: string,
  body: Record<string, unknown>
): Promise<TelegramResponse<T>> {
  const token = getBotToken();
  const url = `https://api.telegram.org/bot${token}/${method}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data: TelegramResponse<T> = await response.json();

  if (!data.ok) {
    console.error(`[Telegram] API error: ${data.description}`, { method, error_code: data.error_code });
  }

  return data;
}

// ═══════════════════════════════════════════════════════════════════════════
// SEND ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send a text message via Telegram.
 */
export const sendMessage = internalAction({
  args: {
    chatId: v.string(),
    text: v.string(),
    parseMode: v.optional(v.union(v.literal("Markdown"), v.literal("MarkdownV2"), v.literal("HTML"))),
    disablePreview: v.optional(v.boolean()),
    disableNotification: v.optional(v.boolean()),
    replyMarkup: v.optional(v.any()), // InlineKeyboardMarkup
  },
  handler: async (ctx, args): Promise<{ sent: boolean; messageId?: number; error?: string }> => {
    try {
      const body: Record<string, unknown> = {
        chat_id: args.chatId,
        text: args.text,
      };

      if (args.parseMode) body.parse_mode = args.parseMode;
      if (args.disablePreview) body.disable_web_page_preview = true;
      if (args.disableNotification) body.disable_notification = true;
      if (args.replyMarkup) body.reply_markup = args.replyMarkup;

      const response = await callTelegramApi<TelegramMessage>("sendMessage", body);

      if (response.ok && response.result) {
        console.log(`[Telegram] Message sent to ${args.chatId}, messageId: ${response.result.message_id}`);
        return { sent: true, messageId: response.result.message_id };
      }

      return { sent: false, error: response.description };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[Telegram] sendMessage failed:", errorMsg);
      return { sent: false, error: errorMsg };
    }
  },
});

/**
 * Send a message with inline keyboard buttons.
 */
export const sendMessageWithButtons = internalAction({
  args: {
    chatId: v.string(),
    text: v.string(),
    buttons: v.array(
      v.array(
        v.object({
          text: v.string(),
          callbackData: v.optional(v.string()),
          url: v.optional(v.string()),
        })
      )
    ),
    parseMode: v.optional(v.union(v.literal("Markdown"), v.literal("MarkdownV2"), v.literal("HTML"))),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; messageId?: number; error?: string }> => {
    try {
      const inlineKeyboard = args.buttons.map((row: Array<{ text: string; callbackData?: string; url?: string }>) =>
        row.map((btn: { text: string; callbackData?: string; url?: string }) => ({
          text: btn.text,
          ...(btn.callbackData && { callback_data: btn.callbackData }),
          ...(btn.url && { url: btn.url }),
        }))
      );

      const body: Record<string, unknown> = {
        chat_id: args.chatId,
        text: args.text,
        reply_markup: { inline_keyboard: inlineKeyboard },
      };

      if (args.parseMode) body.parse_mode = args.parseMode;

      const response = await callTelegramApi<TelegramMessage>("sendMessage", body);

      if (response.ok && response.result) {
        return { sent: true, messageId: response.result.message_id };
      }

      return { sent: false, error: response.description };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { sent: false, error: errorMsg };
    }
  },
});

/**
 * Send a photo via Telegram.
 */
export const sendPhoto = internalAction({
  args: {
    chatId: v.string(),
    photoUrl: v.string(),
    caption: v.optional(v.string()),
    parseMode: v.optional(v.union(v.literal("Markdown"), v.literal("MarkdownV2"), v.literal("HTML"))),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; messageId?: number; error?: string }> => {
    try {
      const body: Record<string, unknown> = {
        chat_id: args.chatId,
        photo: args.photoUrl,
      };

      if (args.caption) body.caption = args.caption;
      if (args.parseMode) body.parse_mode = args.parseMode;

      const response = await callTelegramApi<TelegramMessage>("sendPhoto", body);

      if (response.ok && response.result) {
        return { sent: true, messageId: response.result.message_id };
      }

      return { sent: false, error: response.description };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { sent: false, error: errorMsg };
    }
  },
});

/**
 * Answer a callback query (acknowledge button press).
 */
export const answerCallbackQuery = internalAction({
  args: {
    callbackQueryId: v.string(),
    text: v.optional(v.string()),
    showAlert: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    try {
      const body: Record<string, unknown> = {
        callback_query_id: args.callbackQueryId,
      };

      if (args.text) body.text = args.text;
      if (args.showAlert) body.show_alert = true;

      const response = await callTelegramApi("answerCallbackQuery", body);
      return { ok: response.ok };
    } catch (error) {
      return { ok: false };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK SETUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Set the webhook URL for receiving updates.
 * Call this once after deployment to configure Telegram.
 */
export const setWebhook = action({
  args: {
    webhookUrl: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; description?: string }> => {
    try {
      const response = await callTelegramApi("setWebhook", {
        url: args.webhookUrl,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      });

      if (response.ok) {
        console.log(`[Telegram] Webhook set to: ${args.webhookUrl}`);
      }

      return { ok: response.ok, description: response.description };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { ok: false, description: errorMsg };
    }
  },
});

/**
 * Get current webhook info.
 */
export const getWebhookInfo = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; webhookUrl?: string; pendingUpdates?: number }> => {
    try {
      interface WebhookInfo {
        url: string;
        has_custom_certificate: boolean;
        pending_update_count: number;
        last_error_date?: number;
        last_error_message?: string;
      }

      const response = await callTelegramApi<WebhookInfo>("getWebhookInfo", {});

      if (response.ok && response.result) {
        return {
          ok: true,
          webhookUrl: response.result.url,
          pendingUpdates: response.result.pending_update_count,
        };
      }

      return { ok: false };
    } catch (error) {
      return { ok: false };
    }
  },
});

/**
 * Delete the current webhook.
 */
export const deleteWebhook = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean }> => {
    try {
      const response = await callTelegramApi("deleteWebhook", {
        drop_pending_updates: true,
      });
      return { ok: response.ok };
    } catch (error) {
      return { ok: false };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TELEGRAM USER PREFERENCES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Store a user's Telegram chat ID for notifications.
 */
export const registerTelegramUser = mutation({
  args: {
    telegramChatId: v.string(),
    telegramUsername: v.optional(v.string()),
    firstName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if user exists by telegram chat ID
    const existing = await ctx.db
      .query("telegramUsers")
      .withIndex("by_chat_id", (q) => q.eq("telegramChatId", args.telegramChatId))
      .first() as Doc<"telegramUsers"> | null;

    if (existing) {
      // Update existing
      await ctx.db.patch(existing._id, {
        telegramUsername: args.telegramUsername,
        firstName: args.firstName,
        lastActiveAt: Date.now(),
      });
      return { userId: existing._id, isNew: false };
    }

    // Create new
    const userId = await ctx.db.insert("telegramUsers", {
      telegramChatId: args.telegramChatId,
      telegramUsername: args.telegramUsername,
      firstName: args.firstName,
      notificationsEnabled: true,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });

    return { userId, isNew: true };
  },
});

/**
 * Get Telegram user by chat ID.
 */
export const getTelegramUser = query({
  args: {
    telegramChatId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("telegramUsers")
      .withIndex("by_chat_id", (q) => q.eq("telegramChatId", args.telegramChatId))
      .first() as Doc<"telegramUsers"> | null;
  },
});

/**
 * Toggle notifications for a Telegram user.
 */
export const toggleNotifications = mutation({
  args: {
    telegramChatId: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("telegramUsers")
      .withIndex("by_chat_id", (q) => q.eq("telegramChatId", args.telegramChatId))
      .first() as Doc<"telegramUsers"> | null;

    if (user) {
      await ctx.db.patch(user._id, {
        notificationsEnabled: args.enabled,
      });
      return { success: true };
    }

    return { success: false, error: "User not found" };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE LOGGING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Log incoming Telegram message for audit/debugging.
 */
export const logTelegramMessage = internalMutation({
  args: {
    telegramChatId: v.string(),
    messageText: v.string(),
    messageType: v.union(v.literal("incoming"), v.literal("outgoing")),
    messageId: v.optional(v.number()),
    agentResponse: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("telegramMessages", {
      telegramChatId: args.telegramChatId,
      messageText: args.messageText,
      messageType: args.messageType,
      messageId: args.messageId,
      agentResponse: args.agentResponse,
      timestamp: Date.now(),
    });
  },
});

/**
 * Get recent messages for a chat.
 */
export const getRecentMessages = query({
  args: {
    telegramChatId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;

    return await ctx.db
      .query("telegramMessages")
      .withIndex("by_chat_id", (q) => q.eq("telegramChatId", args.telegramChatId))
      .order("desc")
      .take(limit) as Doc<"telegramMessages">[];
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if Telegram integration is configured.
 */
export const isConfigured = action({
  args: {},
  handler: async (ctx): Promise<{ configured: boolean }> => {
    try {
      getBotToken();
      return { configured: true };
    } catch {
      return { configured: false };
    }
  },
});

/**
 * Get bot information.
 */
export const getBotInfo = action({
  args: {},
  handler: async (ctx) => {
    try {
      interface BotInfo {
        id: number;
        is_bot: boolean;
        first_name: string;
        username: string;
        can_join_groups: boolean;
        can_read_all_group_messages: boolean;
        supports_inline_queries: boolean;
      }

      const response = await callTelegramApi<BotInfo>("getMe", {});

      if (response.ok && response.result) {
        return {
          ok: true,
          botId: response.result.id,
          username: response.result.username,
          firstName: response.result.first_name,
        };
      }

      return { ok: false, error: response.description };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { ok: false, error: errorMsg };
    }
  },
});
