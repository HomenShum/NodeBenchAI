/**
 * Slack Agent Handler
 *
 * Processes incoming Slack interactions and manages encounter capture flow.
 * Enables natural language encounter logging and research triggers.
 *
 * Flow:
 * 1. User sends message or uses /encounter command
 * 2. Parse text for entities (people, companies)
 * 3. Resolve against existing entityContexts research
 * 4. Create userEvent with encounter data
 * 5. Trigger fast-pass research
 * 6. Return rich Block Kit response
 *
 * @module integrations/slack/slackAgent
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../../_generated/server";
import { internal, api } from "../../../_generated/api";
import type { SlackSlashCommand, SlackInteractivity, SlackEvent } from "./slackWebhook";
import { buildEncounterConfirmation, buildDigestBlocks, buildHelpBlocks, buildErrorBlocks } from "./slackBlocks";
import type { Id, Doc } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface SlackUser {
  slackUserId: string;
  slackUsername: string;
  slackTeamId: string;
  nodebenchUserId?: Id<"users">;
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle incoming Slack events (messages, app_mention).
 */
export const handleSlackEvent = internalAction({
  args: {
    event: v.any(),
    teamId: v.string(),
    eventId: v.string(),
  },
  handler: async (ctx, args) => {
    const event = args.event as SlackEvent["event"];
    if (!event) return;

    const startTime = Date.now();
    console.log(`[SlackAgent] Processing event: ${event.type}`);

    // Get user info
    const slackUser: SlackUser = {
      slackUserId: event.user || "unknown",
      slackUsername: event.user || "Unknown User",
      slackTeamId: args.teamId,
    };

    // Try to map Slack user to NodeBench user
    const nodebenchUser = await ctx.runQuery(
      internal.domains.integrations.slack.slackAgent.findNodeBenchUser,
      { slackTeamId: args.teamId, slackUserId: event.user || "" }
    );

    if (nodebenchUser) {
      slackUser.nodebenchUserId = nodebenchUser.userId;
    }

    try {
      switch (event.type) {
        case "message":
          // Skip bot messages and message edits
          if ((event as any).subtype) {
            console.log(`[SlackAgent] Skipping message subtype: ${(event as any).subtype}`);
            return;
          }

          // Process as potential encounter capture
          await processMessageAsEncounter(ctx, event, slackUser);
          break;

        case "app_mention":
          // User mentioned the bot - treat as query
          await processAppMention(ctx, event, slackUser);
          break;

        default:
          console.log(`[SlackAgent] Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      console.error(`[SlackAgent] Error processing event:`, error);

      // Log error interaction
      await ctx.runMutation(internal.domains.integrations.slack.slackAgent.logSlackInteraction, {
        ...slackUser,
        channelId: event.channel,
        interactionType: event.type || "unknown",
        messageText: event.text,
        agentResponse: `Error: ${error instanceof Error ? error.message : String(error)}`,
        processingTimeMs: Date.now() - startTime,
      });
    }
  },
});

/**
 * Handle slash commands (/encounter, /research, /digest, /help).
 */
export const handleSlashCommand = internalAction({
  args: {
    command: v.any(),
  },
  handler: async (ctx, args) => {
    const cmd = args.command as SlackSlashCommand;
    const startTime = Date.now();

    console.log(`[SlackAgent] Command ${cmd.command} from ${cmd.user_name}: "${cmd.text}"`);

    // Get user mapping
    const slackUser: SlackUser = {
      slackUserId: cmd.user_id,
      slackUsername: cmd.user_name,
      slackTeamId: cmd.team_id,
    };

    const nodebenchUser = await ctx.runQuery(
      internal.domains.integrations.slack.slackAgent.findNodeBenchUser,
      { slackTeamId: cmd.team_id, slackUserId: cmd.user_id }
    );

    if (nodebenchUser) {
      slackUser.nodebenchUserId = nodebenchUser.userId;
    }

    let response: { blocks: any[]; response_type: "in_channel" | "ephemeral" };
    let encounterId: Id<"userEvents"> | undefined;

    try {
      switch (cmd.command) {
        case "/encounter":
          // Parse and create encounter
          const result = await processEncounterCommand(ctx, cmd.text, slackUser, cmd.channel_id);
          response = result.response;
          encounterId = result.encounterId;
          break;

        case "/research":
          response = await processResearchCommand(ctx, cmd.text, slackUser);
          break;

        case "/digest":
          response = await processDigestCommand(ctx, slackUser);
          break;

        case "/help":
        default:
          response = {
            blocks: buildHelpBlocks(),
            response_type: "ephemeral",
          };
      }
    } catch (error) {
      console.error(`[SlackAgent] Command error:`, error);
      response = {
        blocks: buildErrorBlocks(error instanceof Error ? error.message : "An error occurred"),
        response_type: "ephemeral",
      };
    }

    // Log the interaction
    await ctx.runMutation(internal.domains.integrations.slack.slackAgent.logSlackInteraction, {
      ...slackUser,
      channelId: cmd.channel_id,
      channelName: cmd.channel_name,
      interactionType: "slash_command",
      commandName: cmd.command,
      commandOptions: { text: cmd.text },
      encounterId,
      agentResponse: JSON.stringify(response.blocks).slice(0, 1000),
      processingTimeMs: Date.now() - startTime,
    });

    // Send response via response_url
    await sendSlackResponse(cmd.response_url, response);
  },
});

/**
 * Handle button clicks.
 */
export const handleButtonClick = internalAction({
  args: {
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const payload = args.payload as SlackInteractivity;
    const action = payload.actions?.[0];
    const startTime = Date.now();

    if (!action) {
      console.log("[SlackAgent] No action in button click payload");
      return;
    }

    const slackUser: SlackUser = {
      slackUserId: payload.user.id,
      slackUsername: payload.user.username,
      slackTeamId: payload.team.id,
    };

    console.log(`[SlackAgent] Button click: ${action.action_id} from ${payload.user.username}`);

    let response: { blocks: any[] } | undefined;

    try {
      const [actionType, ...params] = action.action_id.split(":");

      switch (actionType) {
        case "deep_dive":
          // Trigger deep research
          const entityName = action.value || params.join(":");
          response = await triggerDeepDiveFromButton(ctx, entityName, slackUser);
          break;

        case "add_followup":
          // Add follow-up task
          const encounterId = action.value as Id<"userEvents">;
          response = await addFollowUpTask(ctx, encounterId, slackUser);
          break;

        case "dismiss":
          // Just acknowledge
          response = undefined;
          break;

        default:
          console.log(`[SlackAgent] Unknown button action: ${actionType}`);
      }
    } catch (error) {
      console.error("[SlackAgent] Button click error:", error);
      response = {
        blocks: buildErrorBlocks(error instanceof Error ? error.message : "An error occurred"),
      };
    }

    // Log interaction
    await ctx.runMutation(internal.domains.integrations.slack.slackAgent.logSlackInteraction, {
      ...slackUser,
      channelId: payload.channel?.id,
      channelName: payload.channel?.name,
      interactionType: "button_click",
      commandName: action.action_id,
      processingTimeMs: Date.now() - startTime,
    });

    // Update message if we have a response
    if (response && payload.response_url) {
      await sendSlackResponse(payload.response_url, {
        blocks: response.blocks,
        replace_original: true,
      });
    }
  },
});

/**
 * Handle modal submissions.
 */
export const handleModalSubmission = internalAction({
  args: {
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const payload = args.payload as SlackInteractivity;
    const view = payload.view;

    if (!view) {
      console.log("[SlackAgent] No view in modal submission");
      return;
    }

    const slackUser: SlackUser = {
      slackUserId: payload.user.id,
      slackUsername: payload.user.username,
      slackTeamId: payload.team.id,
    };

    console.log(`[SlackAgent] Modal submission: ${view.callback_id} from ${payload.user.username}`);

    // Handle different modal types
    switch (view.callback_id) {
      case "encounter_modal":
        await processEncounterModal(ctx, view, slackUser);
        break;

      default:
        console.log(`[SlackAgent] Unknown modal callback: ${view.callback_id}`);
    }
  },
});

/**
 * Handle shortcuts (global/message).
 */
export const handleShortcut = internalAction({
  args: {
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const payload = args.payload as SlackInteractivity;
    console.log(`[SlackAgent] Shortcut: ${payload.type} from ${payload.user?.username}`);
    // TODO: Implement shortcut handling for quick encounter capture
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND PROCESSORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process /encounter command.
 */
async function processEncounterCommand(
  ctx: any,
  text: string,
  slackUser: SlackUser,
  channelId: string
): Promise<{ response: { blocks: any[]; response_type: "in_channel" | "ephemeral" }; encounterId?: Id<"userEvents"> }> {
  if (!text.trim()) {
    return {
      response: {
        blocks: buildErrorBlocks("Please provide encounter details. Example: `/encounter Met with Jane Smith from Acme Corp - discussing partnership`"),
        response_type: "ephemeral",
      },
    };
  }

  if (!slackUser.nodebenchUserId) {
    return {
      response: {
        blocks: buildErrorBlocks("Your Slack account is not linked to NodeBench. Please connect via Settings > Integrations."),
        response_type: "ephemeral",
      },
    };
  }

  // Parse the encounter text
  const parsed = await ctx.runAction(
    internal.domains.integrations.slack.encounterParser.parseEncounterText,
    { text }
  );

  // Resolve entities against existing research
  const resolved = await ctx.runAction(
    internal.domains.integrations.slack.encounterResolver.resolveEncounterEntities,
    {
      parsed,
      userId: slackUser.nodebenchUserId,
    }
  );

  // Create the encounter
  const encounterId = await ctx.runMutation(
    internal.domains.integrations.slack.encounterMutations.createEncounter,
    {
      userId: slackUser.nodebenchUserId,
      sourceType: "slack" as const,
      sourceId: `${slackUser.slackTeamId}:${channelId}:${Date.now()}`,
      sourceChannelId: channelId,
      encounter: {
        participants: resolved.participants,
        companies: resolved.companies,
        context: parsed.context,
        followUpRequested: parsed.followUpRequested,
        rawText: text,
        researchStatus: "none" as const,
      },
    }
  );

  // Trigger fast-pass research
  if (resolved.participants.length > 0 || resolved.companies.length > 0) {
    await ctx.scheduler.runAfter(0, internal.domains.integrations.slack.encounterResearch.triggerFastPassResearch, {
      encounterId,
      entities: [
        ...resolved.participants.map((p: any) => ({ name: p.name, type: "person" as const, existingEntityId: p.linkedEntityId })),
        ...resolved.companies.map((c: any) => ({ name: c.name, type: "company" as const, existingEntityId: c.linkedEntityId })),
      ],
    });
  }

  // Generate follow-up tasks if requested
  if (parsed.followUpRequested) {
    await ctx.runMutation(
      internal.domains.integrations.slack.encounterMutations.generateFollowUpTasks,
      {
        userId: slackUser.nodebenchUserId,
        encounterId,
        encounter: resolved,
      }
    );
  }

  return {
    response: {
      blocks: buildEncounterConfirmation({
        id: encounterId,
        context: parsed.context || "Meeting",
        participants: resolved.participants,
        companies: resolved.companies,
        researchStatus: "fast_pass",
      }),
      response_type: "in_channel",
    },
    encounterId,
  };
}

/**
 * Process /research command.
 */
async function processResearchCommand(
  ctx: any,
  text: string,
  slackUser: SlackUser
): Promise<{ blocks: any[]; response_type: "in_channel" | "ephemeral" }> {
  if (!text.trim()) {
    return {
      blocks: buildErrorBlocks("Please provide an entity to research. Example: `/research Anthropic`"),
      response_type: "ephemeral",
    };
  }

  // TODO: Trigger research job and return status
  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:mag: *Researching:* ${text}\n\n_This feature is coming soon. Check the NodeBench app for full research capabilities._`,
        },
      },
    ],
    response_type: "ephemeral",
  };
}

/**
 * Process /digest command.
 */
async function processDigestCommand(
  ctx: any,
  slackUser: SlackUser
): Promise<{ blocks: any[]; response_type: "in_channel" | "ephemeral" }> {
  if (!slackUser.nodebenchUserId) {
    return {
      blocks: buildErrorBlocks("Your Slack account is not linked to NodeBench."),
      response_type: "ephemeral",
    };
  }

  // Get today's encounters
  const encounters = await ctx.runQuery(
    internal.domains.integrations.slack.encounterMutations.getRecentEncounters,
    {
      userId: slackUser.nodebenchUserId,
      lookbackHours: 24,
    }
  );

  return {
    blocks: buildDigestBlocks({
      encounters,
      date: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    }),
    response_type: "ephemeral",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE PROCESSORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process a message as potential encounter capture.
 */
async function processMessageAsEncounter(
  ctx: any,
  event: SlackEvent["event"],
  slackUser: SlackUser
): Promise<void> {
  if (!event?.text || !slackUser.nodebenchUserId) return;

  // Check if this looks like an encounter note
  const encounterPatterns = [
    /met with/i,
    /call with/i,
    /meeting with/i,
    /spoke to/i,
    /talked to/i,
    /coffee with/i,
    /lunch with/i,
    /dinner with/i,
    /from .+ corp|inc|llc|ltd/i,
  ];

  const looksLikeEncounter = encounterPatterns.some((p) => p.test(event.text || ""));

  if (looksLikeEncounter) {
    // Parse and store as encounter
    const parsed = await ctx.runAction(
      internal.domains.integrations.slack.encounterParser.parseEncounterText,
      { text: event.text }
    );

    if (parsed.participants.length > 0 || parsed.companies.length > 0) {
      // Resolve and create encounter
      const resolved = await ctx.runAction(
        internal.domains.integrations.slack.encounterResolver.resolveEncounterEntities,
        {
          parsed,
          userId: slackUser.nodebenchUserId,
        }
      );

      await ctx.runMutation(
        internal.domains.integrations.slack.encounterMutations.createEncounter,
        {
          userId: slackUser.nodebenchUserId,
          sourceType: "slack" as const,
          sourceId: event.ts || "",
          sourceChannelId: event.channel || "",
          encounter: {
            participants: resolved.participants,
            companies: resolved.companies,
            context: parsed.context,
            followUpRequested: parsed.followUpRequested,
            rawText: event.text,
            researchStatus: "none" as const,
          },
        }
      );

      console.log(`[SlackAgent] Auto-captured encounter from message: ${parsed.participants.length} participants`);
    }
  }
}

/**
 * Process app mention as query.
 */
async function processAppMention(
  ctx: any,
  event: SlackEvent["event"],
  slackUser: SlackUser
): Promise<void> {
  // TODO: Route through coordinator agent
  console.log(`[SlackAgent] App mention from ${slackUser.slackUsername}: ${event?.text}`);
}

/**
 * Process encounter modal submission.
 */
async function processEncounterModal(
  ctx: any,
  view: SlackInteractivity["view"],
  slackUser: SlackUser
): Promise<void> {
  // TODO: Extract fields from modal and create encounter
  console.log(`[SlackAgent] Encounter modal from ${slackUser.slackUsername}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// BUTTON ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

async function triggerDeepDiveFromButton(
  ctx: any,
  entityName: string,
  slackUser: SlackUser
): Promise<{ blocks: any[] }> {
  if (!slackUser.nodebenchUserId) {
    return { blocks: buildErrorBlocks("Account not linked to NodeBench") };
  }

  try {
    // Trigger DD job directly via orchestrator
    const result = await ctx.runAction(
      internal.domains.agents.dueDiligence.ddOrchestrator.startDueDiligenceJobInternal,
      {
        entityName,
        entityType: "company" as const,
        triggerSource: "manual" as const,
        userId: slackUser.nodebenchUserId,
      }
    );

    const statusMsg = result.status === "existing"
      ? `A deep dive is already in progress for *${entityName}*. Job ID: \`${result.jobId}\``
      : `Deep dive started for *${entityName}*. Job ID: \`${result.jobId}\``;

    return {
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:hourglass_flowing_sand: ${statusMsg}\n\n_I'll update you when the research is complete._`,
          },
        },
      ],
    };
  } catch (error) {
    console.error("[SlackAgent] Deep dive trigger error:", error);
    return {
      blocks: buildErrorBlocks(
        error instanceof Error ? error.message : "Failed to start deep dive"
      ),
    };
  }
}

async function addFollowUpTask(
  ctx: any,
  encounterId: Id<"userEvents">,
  slackUser: SlackUser
): Promise<{ blocks: any[] }> {
  if (!slackUser.nodebenchUserId) {
    return { blocks: buildErrorBlocks("Account not linked") };
  }

  // Create follow-up task
  await ctx.runMutation(
    internal.domains.integrations.slack.encounterMutations.createFollowUpTask,
    {
      userId: slackUser.nodebenchUserId,
      encounterId,
    }
  );

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:white_check_mark: Follow-up task created! Check your NodeBench tasks.`,
        },
      },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find NodeBench user by Slack team and user ID.
 */
export const findNodeBenchUser = internalQuery({
  args: {
    slackTeamId: v.string(),
    slackUserId: v.string(),
  },
  returns: v.union(v.null(), v.object({ userId: v.id("users") })),
  handler: async (ctx, args) => {
    // Find Slack account with matching team ID
    const slackAccounts = await ctx.db
      .query("slackAccounts")
      .collect();

    const account = slackAccounts.find(
      (acc: Doc<"slackAccounts">) =>
        acc.teamId === args.slackTeamId &&
        (acc.authedUserId === args.slackUserId || acc.botUserId === args.slackUserId)
    );

    if (account) {
      return { userId: account.userId };
    }

    return null;
  },
});

/**
 * Log a Slack interaction for audit trail.
 */
export const logSlackInteraction = internalMutation({
  args: {
    slackUserId: v.string(),
    slackUsername: v.string(),
    slackTeamId: v.string(),
    channelId: v.optional(v.string()),
    channelName: v.optional(v.string()),
    interactionType: v.string(),
    commandName: v.optional(v.string()),
    commandOptions: v.optional(v.any()),
    messageText: v.optional(v.string()),
    nodebenchUserId: v.optional(v.id("users")),
    encounterId: v.optional(v.id("userEvents")),
    agentResponse: v.optional(v.string()),
    processingTimeMs: v.optional(v.number()),
  },
  returns: v.id("slackInteractions"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("slackInteractions", {
      slackUserId: args.slackUserId,
      slackUsername: args.slackUsername,
      slackTeamId: args.slackTeamId,
      channelId: args.channelId,
      channelName: args.channelName,
      interactionType: args.interactionType,
      commandName: args.commandName,
      commandOptions: args.commandOptions,
      messageText: args.messageText,
      nodebenchUserId: args.nodebenchUserId,
      encounterId: args.encounterId,
      agentResponse: args.agentResponse,
      processingTimeMs: args.processingTimeMs,
      timestamp: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SLACK API HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send a response to Slack via response_url.
 */
async function sendSlackResponse(
  responseUrl: string,
  payload: {
    blocks?: any[];
    text?: string;
    response_type?: "in_channel" | "ephemeral";
    replace_original?: boolean;
  }
): Promise<void> {
  try {
    const response = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error("[SlackAgent] Failed to send response:", response.status, await response.text());
    }
  } catch (error) {
    console.error("[SlackAgent] Error sending response:", error);
  }
}

/**
 * Send a message to a Slack channel.
 */
export const sendSlackMessage = internalAction({
  args: {
    accessToken: v.string(),
    channelId: v.string(),
    blocks: v.optional(v.any()),
    text: v.optional(v.string()),
    threadTs: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    error: v.optional(v.string()),
    ts: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${args.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: args.channelId,
          blocks: args.blocks,
          text: args.text || "NodeBench notification",
          thread_ts: args.threadTs,
        }),
      });

      const data = await response.json();
      return {
        ok: data.ok,
        error: data.error,
        ts: data.ts,
      };
    } catch (error) {
      console.error("[SlackAgent] Error sending message:", error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Send digest to a user's default Slack channel.
 */
export const sendSlackDigest = internalAction({
  args: {
    userId: v.id("users"),
    digest: v.any(),
  },
  returns: v.object({ sent: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    // Get user's Slack account
    const slackAccounts = await ctx.runQuery(
      internal.domains.integrations.integrations.getSlackAccount,
      {}
    );

    if (!slackAccounts?.accessToken) {
      return { sent: false, error: "No Slack account connected" };
    }

    const blocks = buildDigestBlocks(args.digest);

    const result = await ctx.runAction(
      internal.domains.integrations.slack.slackAgent.sendSlackMessage,
      {
        accessToken: slackAccounts.accessToken,
        channelId: (slackAccounts as any).defaultChannelId || slackAccounts.authedUserId || "",
        blocks,
        text: "Your daily NodeBench digest",
      }
    );

    return {
      sent: result.ok,
      error: result.error,
    };
  },
});
