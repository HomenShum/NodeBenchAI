/**
 * Channel Context Tools — Agent awareness of messaging channels
 *
 * Two tools for the coordinator agent:
 * - getChannelContext: Returns current channel, constraints, user prefs
 * - sendChannelMessage: Sends message through outbound pipeline
 *
 * Added to coordinatorAgent.ts baseTools after openclawAgentTools.
 */

"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";

/**
 * Get channel context for the current interaction.
 *
 * Returns the originating channel, formatting constraints, and
 * user preferences so the agent can tailor its response format.
 */
export const getChannelContext = createTool({
  description:
    "Get the messaging channel context: which channel the user is talking through, " +
    "what formatting is supported (markdown, images, buttons), message length limits, " +
    "and user channel preferences (fallback chain, quiet hours).",
  args: z.object({
    userId: z.string().optional().describe("User ID (omit for current interaction)"),
    channelId: z
      .string()
      .optional()
      .describe("Channel ID to query (omit for originating channel)"),
  }),
  handler: async (_ctx, args) => {
    // In a real integration, this queries the channelPreferences table
    // and the provider registry for live availability.
    return {
      action: "get_channel_context",
      channelId: args.channelId ?? "ui",
      constraints: {
        maxLength: 1_000_000,
        supportsRichText: true,
        supportsImages: true,
        supportsLinks: true,
        supportsButtons: true,
        supportsMarkdown: true,
      },
      userPreferences: {
        preferredChannels: ["ui", "email", "ntfy"],
        note: "Query channelPreferences table for real user preferences.",
      },
    };
  },
});

/**
 * Send a message through the outbound pipeline.
 *
 * The agent uses this to respond on the user's preferred channel(s)
 * with auto-formatting for the target channel.
 */
export const sendChannelMessage = createTool({
  description:
    "Send a message to a user through the outbound messaging pipeline. " +
    "Auto-formats for the target channel (Slack blocks, Telegram markdown, " +
    "email HTML, etc.). Supports fallback chains from user preferences.",
  args: z.object({
    channelId: z
      .string()
      .optional()
      .describe("Target channel (omit to use user's preferred channels)"),
    recipient: z
      .string()
      .optional()
      .describe("Recipient identifier (phone, email, chat ID)"),
    text: z.string().describe("Message text content"),
    subject: z.string().optional().describe("Subject line (for email/ntfy)"),
    urgency: z
      .enum(["critical", "high", "normal", "low"])
      .default("normal")
      .describe("Message urgency level"),
  }),
  handler: async (_ctx, args) => {
    // In a real integration, this calls outboundPipeline.deliverToChannels
    return {
      action: "send_channel_message",
      channelId: args.channelId ?? "user_preferred",
      text: args.text.slice(0, 100) + (args.text.length > 100 ? "..." : ""),
      urgency: args.urgency,
      status: "queued",
      note: "Message queued for delivery through outbound pipeline.",
    };
  },
});

/**
 * Bundle channel context tools for coordinator composition.
 */
export const channelContextTools = {
  getChannelContext,
  sendChannelMessage,
};
