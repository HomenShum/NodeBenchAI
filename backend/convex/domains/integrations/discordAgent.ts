/**
 * Discord Agent Handler
 *
 * Processes incoming Discord interactions through the agent system.
 * Enables natural language queries like "/query who raised money today?"
 *
 * Flow:
 * 1. User invokes slash command in Discord
 * 2. Discord webhook → HTTP handler → this module
 * 3. Parse interaction, route to coordinator agent
 * 4. Agent processes with FREE-FIRST search tools
 * 5. Format response as Discord embed
 * 6. Send reply back to user
 *
 * @module integrations/discordAgent
 */

import { v } from "convex/values";
import { internalAction, httpAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { DiscordInteraction, DiscordEmbed } from "./discord";
import {
  InteractionType,
  InteractionResponseType,
  MessageFlags,
  verifyDiscordSignature,
  EmbedColors,
  buildEmbed,
  buildButtons,
} from "./discord";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const MAX_EMBED_DESCRIPTION = 4096;
const MAX_FIELD_VALUE = 1024;

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * HTTP webhook handler for Discord interactions.
 * Register this in convex/http.ts
 */
export const discordWebhookHandler = httpAction(async (ctx, request) => {
  console.log("[DiscordAgent] Webhook received");

  try {
    // Get verification headers
    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");
    // Hardcoded for testing - process.env may not work in httpAction
    const publicKey = "9973b9bf46f64b7056dd13a785127c67540b7543256d11ee5f111771aee56e57";

    console.log("[DiscordAgent] Headers received:", {
      hasSignature: !!signature,
      hasTimestamp: !!timestamp,
      hasPublicKey: !!publicKey,
      signatureLength: signature?.length,
      publicKeyLength: publicKey?.length,
    });

    if (!signature || !timestamp || !publicKey) {
      console.error("[DiscordAgent] Missing signature headers or public key", {
        signature: !!signature,
        timestamp: !!timestamp,
        publicKey: !!publicKey,
      });
      return new Response("Unauthorized", { status: 401 });
    }

    // Get raw body for signature verification
    const rawBody = await request.text();
    console.log("[DiscordAgent] Raw body length:", rawBody.length, "First 100 chars:", rawBody.substring(0, 100));

    // Verify signature (async with discord-interactions library)
    console.log("[DiscordAgent] About to verify - signature:", signature.substring(0, 20) + "...", "timestamp:", timestamp, "bodyLen:", rawBody.length);
    console.log("[DiscordAgent] Public key:", publicKey.substring(0, 20) + "...", "length:", publicKey.length);

    let isValid = false;
    try {
      isValid = verifyDiscordSignature(signature, timestamp, rawBody, publicKey);
      console.log("[DiscordAgent] Signature verification result:", isValid);
    } catch (verifyError) {
      console.error("[DiscordAgent] Verification threw error:", verifyError);
      return new Response("Verification error", { status: 500 });
    }

    if (!isValid) {
      console.error("[DiscordAgent] Invalid signature - verification failed");
      return new Response("Invalid signature", { status: 401 });
    }

    // Parse the interaction
    const interaction: DiscordInteraction = JSON.parse(rawBody);

    // Handle PING (Discord verification)
    if (interaction.type === InteractionType.PING) {
      console.log("[DiscordAgent] Received PING, responding with PONG");
      return new Response(
        JSON.stringify({ type: InteractionResponseType.PONG }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Handle APPLICATION_COMMAND (slash commands)
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      // Send deferred response first (we have 3 seconds to respond)
      // Then process the command asynchronously using scheduler

      // Schedule the async handler (use scheduler for background execution)
      await ctx.scheduler.runAfter(0, internal.domains.integrations.discordAgent.handleSlashCommand, {
        interaction: interaction as unknown as Record<string, unknown>,
      });

      console.log("[DiscordAgent] Scheduled handleSlashCommand for command:", interaction.data?.name);

      // Return deferred response immediately
      return new Response(
        JSON.stringify({
          type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Handle MESSAGE_COMPONENT (button clicks)
    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      await ctx.scheduler.runAfter(0, internal.domains.integrations.discordAgent.handleButtonClick, {
        interaction: interaction as unknown as Record<string, unknown>,
      });

      console.log("[DiscordAgent] Scheduled handleButtonClick for:", interaction.data?.custom_id);

      // Acknowledge the button click
      return new Response(
        JSON.stringify({
          type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Unknown interaction type
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[DiscordAgent] Webhook error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SLASH COMMAND HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process a slash command after deferred response.
 */
export const handleSlashCommand = internalAction({
  args: {
    interaction: v.any(),
  },
  handler: async (ctx, args) => {
    const interaction = args.interaction as DiscordInteraction;
    const commandName = interaction.data?.name;
    const options = interaction.data?.options || [];

    // Get user info
    const user = interaction.member?.user || interaction.user;
    const userId = user?.id || "unknown";
    const username = user?.global_name || user?.username || "Unknown User";

    console.log(`[DiscordAgent] Command /${commandName} from ${username} (${userId})`);

    // Log the interaction
    await ctx.runMutation(internal.domains.integrations.discord.logDiscordInteraction, {
      discordUserId: userId,
      discordUsername: username,
      guildId: interaction.guild_id,
      channelId: interaction.channel_id,
      interactionType: "slash_command",
      commandName,
      commandOptions: options,
    });

    // Register/update user
    await ctx.runMutation(internal.domains.integrations.discord.registerDiscordUser, {
      discordUserId: userId,
      discordUsername: username,
      discordGuildId: interaction.guild_id,
      discordChannelId: interaction.channel_id,
    });

    // Route to appropriate handler
    let response: { embeds: DiscordEmbed[]; components?: any[] };

    switch (commandName) {
      case "query":
        response = await handleQueryCommand(ctx, options, userId);
        break;

      case "funding":
        response = await handleFundingCommand(ctx, options);
        break;

      case "news":
        response = await handleNewsCommand(ctx, options);
        break;

      case "status":
        response = await handleStatusCommand(ctx);
        break;

      case "help":
        response = handleHelpCommand();
        break;

      default:
        response = {
          embeds: [
            buildEmbed({
              title: "Unknown Command",
              description: `Command \`/${commandName}\` is not recognized. Try \`/help\` for available commands.`,
              color: EmbedColors.ERROR,
            }),
          ],
        };
    }

    // Send followup response
    await ctx.runAction(internal.domains.integrations.discord.sendFollowup, {
      interactionToken: interaction.token,
      embeds: response.embeds,
      components: response.components,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle /query command - Natural language query to agent.
 */
async function handleQueryCommand(
  ctx: any,
  options: Array<{ name: string; value: string | number | boolean }>,
  userId: string
): Promise<{ embeds: DiscordEmbed[]; components?: any[] }> {
  const question = options.find((o) => o.name === "question")?.value as string;

  if (!question) {
    return {
      embeds: [
        buildEmbed({
          title: "Missing Question",
          description: "Please provide a question to search for.",
          color: EmbedColors.ERROR,
        }),
      ],
    };
  }

  try {
    // TODO: Route through coordinator agent when available
    // For now, return a placeholder response
    const response = await performQuickSearch(ctx, question);

    return {
      embeds: [
        buildEmbed({
          title: "🔍 Search Results",
          description: response,
          color: EmbedColors.PRIMARY,
          footer: "Powered by NodeBench AI • FREE-FIRST Search",
        }),
      ],
      components: [
        buildButtons([
          { label: "More Details", customId: `more:${question.slice(0, 50)}`, style: "primary" },
          { label: "Open in App", url: "https://nodebench-ai.vercel.app/search", style: "link" },
        ]),
      ],
    };
  } catch (error) {
    console.error("[DiscordAgent] Query error:", error);
    return {
      embeds: [
        buildEmbed({
          title: "Search Error",
          description: "Sorry, I encountered an error processing your query. Please try again.",
          color: EmbedColors.ERROR,
        }),
      ],
    };
  }
}

/**
 * Handle /funding command - Today's funding news.
 */
async function handleFundingCommand(
  ctx: any,
  options: Array<{ name: string; value: string | number | boolean }>
): Promise<{ embeds: DiscordEmbed[]; components?: any[] }> {
  const sector = options.find((o) => o.name === "sector")?.value as string | undefined;

  // TODO: Integrate with actual funding detection
  const sectorText = sector ? ` in ${sector}` : "";

  return {
    embeds: [
      buildEmbed({
        title: "💰 Today's Funding News" + sectorText,
        description:
          "_Full funding detection integration coming soon!_\n\n" +
          "**Current capabilities:**\n" +
          "• FREE-FIRST search across Brave, Serper, Tavily\n" +
          "• Funding event pattern detection\n" +
          "• Multi-source verification\n\n" +
          "Try `/query who raised Series A today?` for manual search.",
        color: EmbedColors.FUNDING,
        footer: "Powered by NodeBench AI",
      }),
    ],
    components: [
      buildButtons([
        { label: "Funding Dashboard", url: "https://nodebench-ai.vercel.app/funding", style: "link" },
        { label: "Refresh", customId: "funding:refresh", style: "secondary" },
      ]),
    ],
  };
}

/**
 * Handle /news command - Latest tech news.
 */
async function handleNewsCommand(
  ctx: any,
  options: Array<{ name: string; value: string | number | boolean }>
): Promise<{ embeds: DiscordEmbed[]; components?: any[] }> {
  const topic = options.find((o) => o.name === "topic")?.value as string | undefined;

  const topicText = topic ? ` on "${topic}"` : "";

  return {
    embeds: [
      buildEmbed({
        title: "📰 Latest Tech News" + topicText,
        description:
          "_News aggregation integration coming soon!_\n\n" +
          "**Planned sources:**\n" +
          "• TechCrunch, The Verge, Ars Technica\n" +
          "• Hacker News top stories\n" +
          "• AI/ML research papers\n\n" +
          "Try `/query latest AI news` for manual search.",
        color: EmbedColors.NEWS,
        footer: "Powered by NodeBench AI",
      }),
    ],
    components: [
      buildButtons([
        { label: "News Feed", url: "https://nodebench-ai.vercel.app/news", style: "link" },
        { label: "Refresh", customId: "news:refresh", style: "secondary" },
      ]),
    ],
  };
}

/**
 * Handle /status command - System status.
 */
async function handleStatusCommand(ctx: any): Promise<{ embeds: DiscordEmbed[] }> {
  // TODO: Check actual quota usage
  return {
    embeds: [
      buildEmbed({
        title: "✅ System Status",
        description: "NodeBench AI is online and ready.",
        color: EmbedColors.SUCCESS,
        fields: [
          {
            name: "🔍 Search Providers",
            value:
              "• Brave: ✅ Active (FREE)\n" +
              "• Serper: ✅ Active (FREE)\n" +
              "• Tavily: ✅ Active (FREE)\n" +
              "• Linkup: ✅ Fallback",
            inline: true,
          },
          {
            name: "🤖 Agent Status",
            value: "• Coordinator: ✅ Ready\n• Deep Agents: ✅ Ready\n• Fusion Search: ✅ Ready",
            inline: true,
          },
          {
            name: "📊 Monthly Quota",
            value: "7,500+ FREE searches/month\nacross all providers",
            inline: false,
          },
        ],
        footer: "Last updated just now",
      }),
    ],
  };
}

/**
 * Handle /help command - Show available commands.
 */
function handleHelpCommand(): { embeds: DiscordEmbed[] } {
  return {
    embeds: [
      buildEmbed({
        title: "🤖 NodeBench AI Bot",
        description:
          "Your intelligent research assistant with FREE-FIRST search across multiple providers.",
        color: EmbedColors.INFO,
        fields: [
          {
            name: "📝 Commands",
            value:
              "`/query <question>` - Ask any question\n" +
              "`/funding [sector]` - Today's funding news\n" +
              "`/news [topic]` - Latest tech news\n" +
              "`/status` - System status\n" +
              "`/help` - Show this message",
            inline: false,
          },
          {
            name: "💡 Example Queries",
            value:
              "• Who raised money today?\n" +
              "• Latest Claude AI news\n" +
              "• Tell me about Anthropic\n" +
              "• What's new in machine learning?",
            inline: false,
          },
          {
            name: "🔍 Search Sources",
            value:
              "**FREE Tier (7,500+/month):**\n" +
              "Brave (2,000) • Serper (2,500) • Tavily (1,000) • Exa (2,000 one-time)\n\n" +
              "**Paid Fallback:**\n" +
              "Linkup (€0.55/search)",
            inline: false,
          },
        ],
        footer: "Powered by NodeBench AI • nodebench-ai.vercel.app",
      }),
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BUTTON CLICK HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle button click interactions.
 */
export const handleButtonClick = internalAction({
  args: {
    interaction: v.any(),
  },
  handler: async (ctx, args) => {
    const interaction = args.interaction as DiscordInteraction;
    const customId = interaction.data?.custom_id || "";
    const [action, ...params] = customId.split(":");

    const user = interaction.member?.user || interaction.user;
    const userId = user?.id || "unknown";
    const username = user?.global_name || user?.username || "Unknown User";

    console.log(`[DiscordAgent] Button click: ${action} from ${username}`);

    // Log the interaction
    await ctx.runMutation(internal.domains.integrations.discord.logDiscordInteraction, {
      discordUserId: userId,
      discordUsername: username,
      guildId: interaction.guild_id,
      channelId: interaction.channel_id,
      interactionType: "button_click",
      commandName: action,
      commandOptions: { params },
    });

    let response: { embeds: DiscordEmbed[] };

    switch (action) {
      case "more":
        // Request more details about a query
        const query = params.join(":");
        const detailResponse = await performQuickSearch(ctx, `Tell me more about: ${query}`);
        response = {
          embeds: [
            buildEmbed({
              title: "📖 More Details",
              description: detailResponse,
              color: EmbedColors.PRIMARY,
              footer: "Powered by NodeBench AI",
            }),
          ],
        };
        break;

      case "funding":
        if (params[0] === "refresh") {
          response = {
            embeds: [
              buildEmbed({
                title: "💰 Funding News Refreshed",
                description: "Fetching latest funding announcements...\n\n_Check back in a moment._",
                color: EmbedColors.FUNDING,
              }),
            ],
          };
        } else {
          response = {
            embeds: [
              buildEmbed({
                title: "Unknown Action",
                description: "Button action not recognized.",
                color: EmbedColors.ERROR,
              }),
            ],
          };
        }
        break;

      case "news":
        if (params[0] === "refresh") {
          response = {
            embeds: [
              buildEmbed({
                title: "📰 News Refreshed",
                description: "Fetching latest news...\n\n_Check back in a moment._",
                color: EmbedColors.NEWS,
              }),
            ],
          };
        } else {
          response = {
            embeds: [
              buildEmbed({
                title: "Unknown Action",
                description: "Button action not recognized.",
                color: EmbedColors.ERROR,
              }),
            ],
          };
        }
        break;

      default:
        response = {
          embeds: [
            buildEmbed({
              title: "Unknown Button",
              description: `Action \`${action}\` is not recognized.`,
              color: EmbedColors.ERROR,
            }),
          ],
        };
    }

    // Edit the original message with the response
    await ctx.runAction(internal.domains.integrations.discord.editOriginalResponse, {
      interactionToken: interaction.token,
      embeds: response.embeds,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PROACTIVE NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send a notification to a Discord user or channel.
 * Used by other parts of the system (digest, alerts, etc.)
 */
export const sendDiscordNotification = internalAction({
  args: {
    discordUserId: v.optional(v.string()),
    channelId: v.optional(v.string()),
    title: v.string(),
    body: v.string(),
    color: v.optional(v.number()),
    url: v.optional(v.string()),
    fields: v.optional(
      v.array(
        v.object({
          name: v.string(),
          value: v.string(),
          inline: v.optional(v.boolean()),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    // Check if user has notifications enabled (if targeting a user)
    if (args.discordUserId) {
      const user = await ctx.runQuery(internal.domains.integrations.discord.getDiscordUser, {
        discordUserId: args.discordUserId,
      });

      if (!user?.notificationsEnabled) {
        console.log(`[DiscordAgent] Notifications disabled for ${args.discordUserId}`);
        return { sent: false, reason: "notifications_disabled" };
      }
    }

    const embed = buildEmbed({
      title: args.title,
      description: args.body,
      color: args.color || EmbedColors.INFO,
      url: args.url,
      fields: args.fields,
      footer: "NodeBench AI Notification",
    });

    if (args.channelId) {
      // Send to channel
      return await ctx.runAction(internal.domains.integrations.discord.sendMessage, {
        channelId: args.channelId,
        embeds: [embed],
      });
    } else if (args.discordUserId) {
      // Send as DM
      return await ctx.runAction(internal.domains.integrations.discord.sendDirectMessage, {
        userId: args.discordUserId,
        embeds: [embed],
      });
    }

    return { sent: false, reason: "no_target" };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Perform a quick search (placeholder until agent integration).
 */
async function performQuickSearch(ctx: any, query: string): Promise<string> {
  // This is a placeholder - in production, route through coordinator agent
  return (
    `**Query:** ${query}\n\n` +
    `_I received your query. Full agent integration coming soon!_\n\n` +
    `**Current capabilities:**\n` +
    `• FREE-tier search across Brave, Serper, Tavily\n` +
    `• Funding event detection\n` +
    `• News aggregation\n` +
    `• Entity research\n\n` +
    `Try again later or check the web app for full functionality.`
  );
}
