/**
 * Telegram Agent Handler
 *
 * Processes incoming Telegram messages through the agent system.
 * Enables natural language queries like "who raised money today?"
 *
 * Flow:
 * 1. User sends message to Telegram bot
 * 2. Telegram webhook → HTTP handler → this module
 * 3. Parse message, route to coordinator agent
 * 4. Agent processes with FREE-FIRST search tools
 * 5. Format response for Telegram (Markdown)
 * 6. Send reply back to user
 *
 * @module integrations/telegramAgent
 */

import { v } from "convex/values";
import { internalAction, httpAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { TelegramUpdate } from "./telegram";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const MAX_MESSAGE_LENGTH = 4096; // Telegram limit
const COMMANDS = {
  START: "/start",
  HELP: "/help",
  STATUS: "/status",
  FUNDING: "/funding",
  NEWS: "/news",
  STOP: "/stop",
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * HTTP webhook handler for Telegram updates.
 * Register this in convex/http.ts
 */
export const telegramWebhookHandler = httpAction(async (ctx, request) => {
  try {
    const update: TelegramUpdate = await request.json();

    // Handle text messages
    if (update.message?.text) {
      await ctx.runAction(internal.domains.integrations.telegramAgent.handleMessage, {
        update,
      });
    }

    // Handle callback queries (button presses)
    if (update.callback_query) {
      await ctx.runAction(internal.domains.integrations.telegramAgent.handleCallbackQuery, {
        callbackQueryId: update.callback_query.id,
        chatId: String(update.callback_query.message?.chat.id || update.callback_query.from?.id),
        data: update.callback_query.data || "",
      });
    }

    // Always return 200 OK to Telegram
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[TelegramAgent] Webhook error:", error);
    // Still return 200 to prevent Telegram from retrying
    return new Response("OK", { status: 200 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process incoming Telegram message.
 */
export const handleMessage = internalAction({
  args: {
    update: v.any(),
  },
  handler: async (ctx, args) => {
    const update = args.update as TelegramUpdate;
    const message = update.message;

    if (!message?.text || !message.chat) {
      return;
    }

    const chatId = String(message.chat.id);
    const text = message.text.trim();
    const username = message.from?.username;
    const firstName = message.from?.first_name;

    console.log(`[TelegramAgent] Message from ${username || chatId}: ${text.slice(0, 100)}`);

    // Log incoming message
    await ctx.runMutation(internal.domains.integrations.telegram.logTelegramMessage, {
      telegramChatId: chatId,
      messageText: text,
      messageType: "incoming",
      messageId: message.message_id,
    });

    // Register/update user
    await ctx.runMutation(internal.domains.integrations.telegram.registerTelegramUser, {
      telegramChatId: chatId,
      telegramUsername: username,
      firstName: firstName,
    });

    // Handle commands
    if (text.startsWith("/")) {
      await handleCommand(ctx, chatId, text);
      return;
    }

    // Process as natural language query through agent
    await processAgentQuery(ctx, chatId, text);
  },
});

/**
 * Handle slash commands.
 */
async function handleCommand(
  ctx: any,
  chatId: string,
  command: string
): Promise<void> {
  const cmd = command.toLowerCase().split(" ")[0];

  switch (cmd) {
    case COMMANDS.START:
      await ctx.runAction(internal.domains.integrations.telegram.sendMessage, {
        chatId,
        text: `*Welcome to NodeBench AI!* 🚀

I'm your intelligent research assistant. You can ask me questions like:

• "Who raised money today?"
• "Latest news on AI agents"
• "Tell me about Anthropic"
• "What are the top funding rounds this week?"

*Commands:*
/help - Show this help message
/status - Check system status
/funding - Today's funding news
/news - Latest tech news
/stop - Disable notifications

Just type your question and I'll find the answers for you!`,
        parseMode: "Markdown",
      });
      break;

    case COMMANDS.HELP:
      await ctx.runAction(internal.domains.integrations.telegram.sendMessage, {
        chatId,
        text: `*How to use NodeBench AI Bot:*

*Natural Language Queries:*
Just type your question naturally:
• "Who raised Series A this week?"
• "Latest Claude announcements"
• "Show me SEC filings for Tesla"

*Quick Commands:*
/funding - Today's funding events
/news - Latest tech news
/status - System status
/stop - Disable notifications

*Tips:*
• Be specific for better results
• Include company names or topics
• Ask follow-up questions for details`,
        parseMode: "Markdown",
      });
      break;

    case COMMANDS.STATUS:
      // TODO: Call actual status check
      await ctx.runAction(internal.domains.integrations.telegram.sendMessage, {
        chatId,
        text: `*System Status:* ✅ Online

*Search Providers:*
• Brave: ✅ Active (FREE)
• Serper: ✅ Active (FREE)
• Tavily: ✅ Active (FREE)
• Linkup: ✅ Fallback

*Agent:* Ready for queries`,
        parseMode: "Markdown",
      });
      break;

    case COMMANDS.FUNDING:
      // Quick funding query
      await processAgentQuery(ctx, chatId, "What funding announcements happened today?");
      break;

    case COMMANDS.NEWS:
      // Quick news query
      await processAgentQuery(ctx, chatId, "What's the latest tech and AI news today?");
      break;

    case COMMANDS.STOP:
      await ctx.runMutation(internal.domains.integrations.telegram.toggleNotifications, {
        telegramChatId: chatId,
        enabled: false,
      });
      await ctx.runAction(internal.domains.integrations.telegram.sendMessage, {
        chatId,
        text: "Notifications disabled. Send /start to re-enable.",
      });
      break;

    default:
      await ctx.runAction(internal.domains.integrations.telegram.sendMessage, {
        chatId,
        text: "Unknown command. Try /help for available commands.",
      });
  }
}

/**
 * Process a natural language query through the agent system.
 */
async function processAgentQuery(
  ctx: any,
  chatId: string,
  query: string
): Promise<void> {
  try {
    // Send typing indicator
    // Note: Telegram Bot API doesn't have a direct "typing" action in our implementation
    // but we could add it later

    // Send initial acknowledgment
    await ctx.runAction(internal.domains.integrations.telegram.sendMessage, {
      chatId,
      text: "🔍 Searching...",
    });

    // TODO: Route through coordinator agent when available
    // For now, use a simplified search approach
    const response = await performQuickSearch(ctx, query);

    // Format response for Telegram
    const formattedResponse = formatForTelegram(response);

    // Send response
    await ctx.runAction(internal.domains.integrations.telegram.sendMessage, {
      chatId,
      text: formattedResponse,
      parseMode: "Markdown",
      disablePreview: true,
    });

    // Log outgoing message
    await ctx.runMutation(internal.domains.integrations.telegram.logTelegramMessage, {
      telegramChatId: chatId,
      messageText: query,
      messageType: "outgoing",
      agentResponse: formattedResponse,
    });
  } catch (error) {
    console.error("[TelegramAgent] Query processing error:", error);

    await ctx.runAction(internal.domains.integrations.telegram.sendMessage, {
      chatId,
      text: "Sorry, I encountered an error processing your request. Please try again.",
    });
  }
}

/**
 * Perform a quick search using the FREE-FIRST fusion search.
 */
async function performQuickSearch(ctx: any, query: string): Promise<string> {
  // This is a placeholder - in production, route through coordinator agent
  // For now, return a helpful message
  return `*Query:* ${query}

_I received your query. Full agent integration coming soon!_

*Current capabilities:*
• Free-tier search across Brave, Serper, Tavily
• Funding event detection
• News aggregation
• Entity research

Try again later or check the web app for full functionality.`;
}

/**
 * Format response for Telegram (handle length limits, markdown).
 */
function formatForTelegram(text: string): string {
  // Truncate if too long
  if (text.length > MAX_MESSAGE_LENGTH) {
    return text.slice(0, MAX_MESSAGE_LENGTH - 50) + "\n\n_(truncated)_";
  }
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
// CALLBACK QUERY HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle callback queries from inline keyboard buttons.
 */
export const handleCallbackQuery = internalAction({
  args: {
    callbackQueryId: v.string(),
    chatId: v.string(),
    data: v.string(),
  },
  handler: async (ctx, args) => {
    // Acknowledge the button press
    await ctx.runAction(internal.domains.integrations.telegram.answerCallbackQuery, {
      callbackQueryId: args.callbackQueryId,
    });

    // Parse callback data
    const [action, ...params] = args.data.split(":");

    switch (action) {
      case "more":
        // Request more details about something
        await processAgentQuery(ctx, args.chatId, `Tell me more about ${params.join(":")}`);
        break;

      case "funding":
        // Quick funding lookup
        await processAgentQuery(ctx, args.chatId, "What are today's funding announcements?");
        break;

      case "news":
        // Quick news lookup
        await processAgentQuery(ctx, args.chatId, "What's the latest tech news?");
        break;

      case "refresh":
        // Re-run the last query
        // TODO: Implement message history lookup
        await ctx.runAction(internal.domains.integrations.telegram.sendMessage, {
          chatId: args.chatId,
          text: "Refresh functionality coming soon.",
        });
        break;

      default:
        console.log(`[TelegramAgent] Unknown callback action: ${action}`);
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PROACTIVE NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send a notification to a Telegram user.
 * Used by other parts of the system (digest, alerts, etc.)
 */
export const sendTelegramNotification = internalAction({
  args: {
    telegramChatId: v.string(),
    title: v.string(),
    body: v.string(),
    buttons: v.optional(
      v.array(
        v.array(
          v.object({
            text: v.string(),
            callbackData: v.optional(v.string()),
            url: v.optional(v.string()),
          })
        )
      )
    ),
  },
  handler: async (ctx, args) => {
    // Check if user has notifications enabled
    const user = await ctx.runQuery(internal.domains.integrations.telegram.getTelegramUser, {
      telegramChatId: args.telegramChatId,
    });

    if (!user?.notificationsEnabled) {
      console.log(`[TelegramAgent] Notifications disabled for ${args.telegramChatId}`);
      return { sent: false, reason: "notifications_disabled" };
    }

    const text = `*${args.title}*\n\n${args.body}`;

    if (args.buttons) {
      return await ctx.runAction(internal.domains.integrations.telegram.sendMessageWithButtons, {
        chatId: args.telegramChatId,
        text,
        buttons: args.buttons,
        parseMode: "Markdown",
      });
    }

    return await ctx.runAction(internal.domains.integrations.telegram.sendMessage, {
      chatId: args.telegramChatId,
      text,
      parseMode: "Markdown",
    });
  },
});

/**
 * Broadcast a message to all users with notifications enabled.
 */
export const broadcastToAllUsers = internalAction({
  args: {
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    // Get all users with notifications enabled
    // Note: This is a simplified implementation - in production,
    // you'd want pagination and rate limiting

    const text = `*${args.title}*\n\n${args.body}`;
    let sent = 0;
    let failed = 0;

    // TODO: Query all telegramUsers with notificationsEnabled = true
    // For now, this is a placeholder

    console.log(`[TelegramAgent] Broadcast complete: ${sent} sent, ${failed} failed`);
    return { sent, failed };
  },
});
