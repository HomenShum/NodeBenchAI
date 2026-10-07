/**
 * Outbound Pipeline — Events → Provider → User
 *
 * Routes system events (meeting reminders, digests, agent responses)
 * through the unified channel provider abstraction.
 *
 * Flow:
 *   System event → outboundPipeline.routeToChannels()
 *   → Load user channel preferences → Apply fallback chain
 *   → For each channel: provider.formatContent() → create deliveryJob
 *   → deliveryQueue processes with existing retry + exponential backoff
 *   → provider.send() delivers
 *
 * Replaces the hardcoded switch in publishingOrchestrator.ts
 */

"use node";

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type {
  ChannelId,
  RawContent,
  OutboundMessage,
  DeliveryResult,
  FormattedPayload,
} from "./channelProvider.js";
import { getConstraintsForChannel } from "./channelProvider.js";
import { getProvider, getRegisteredChannels } from "./providerRegistry.js";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export interface RouteRequest {
  /** Raw content to deliver */
  content: RawContent;
  /** Target user (for preference lookup) */
  userId?: string;
  /** Explicit channel targets (overrides preference lookup) */
  channels?: ChannelId[];
  /** Recipient identifiers per channel (phone, email, chat ID) */
  recipients?: Partial<Record<ChannelId, string>>;
  /** Source event for audit trail */
  sourceEvent?: { type: string; id: string };
}

export interface RouteResult {
  /** Channels attempted */
  attempted: ChannelId[];
  /** Delivery results per channel */
  results: DeliveryResult[];
  /** Channels that were unavailable and skipped */
  skipped: ChannelId[];
  /** Trace ID for this delivery batch */
  traceId: string;
}

function isOpenClawChannel(channelId: ChannelId) {
  return (
    channelId === "whatsapp" ||
    channelId === "signal" ||
    channelId === "imessage" ||
    channelId === "msteams" ||
    channelId === "matrix" ||
    channelId === "webchat"
  );
}

/* ================================================================== */
/* CORE ROUTING                                                        */
/* ================================================================== */

/**
 * Route content to one or more channels.
 *
 * If `channels` is specified, delivers to those channels.
 * Otherwise, loads user preferences and applies fallback chain.
 */
export async function routeToChannels(request: RouteRequest): Promise<RouteResult> {
  const traceId = request.content.traceId ?? `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Determine target channels
  let targetChannels: ChannelId[];
  if (request.channels && request.channels.length > 0) {
    targetChannels = request.channels;
  } else {
    // Default fallback chain: ui → email → ntfy
    targetChannels = ["ui", "email", "ntfy"];
    // TODO: Phase 3 Step 8 — load from channelPreferences
  }

  const attempted: ChannelId[] = [];
  const skipped: ChannelId[] = [];
  const results: DeliveryResult[] = [];

  for (const channelId of targetChannels) {
    const provider = getProvider(channelId);
    if (!provider) {
      skipped.push(channelId);
      continue;
    }

    // Check availability
    const available = await provider.isAvailable();
    if (!available) {
      skipped.push(channelId);
      continue;
    }

    attempted.push(channelId);

    // Format content for this channel
    const constraints = provider.getConstraints();
    const formatted = provider.formatContent(request.content, constraints);

    // Build outbound message
    const recipient = request.recipients?.[channelId] ?? "";
    const message: OutboundMessage = {
      recipient,
      formatted,
      raw: request.content,
      sourceEvent: request.sourceEvent,
    };

    // Inject recipient into payload where needed
    injectRecipient(formatted, recipient);

    // Send through provider
    try {
      const result = await provider.send(message);
      results.push(result);

      if (!result.success) {
        console.warn(
          `[OutboundPipeline] ${channelId} delivery failed: ${result.error}`,
        );
      }
    } catch (err: any) {
      results.push({
        channelId,
        success: false,
        error: err.message ?? "Provider send error",
      });
    }
  }

  return { attempted, results, skipped, traceId };
}

/**
 * Inject recipient into channel-specific payload fields.
 * Each channel stores the recipient differently:
 *   - email: payload.to
 *   - sms: payload.to
 *   - telegram: payload.chat_id
 *   - discord: (uses recipient as channel ID in send())
 *   - openclaw: payload.sessionKey
 */
function injectRecipient(formatted: FormattedPayload, recipient: string): void {
  const payload = formatted.payload as any;
  if (!payload || !recipient) return;

  switch (formatted.channelId) {
    case "email":
      payload.to = recipient;
      break;
    case "sms":
      payload.to = recipient;
      break;
    case "telegram":
      payload.chat_id = recipient;
      break;
    case "whatsapp":
    case "signal":
    case "imessage":
    case "msteams":
    case "matrix":
    case "webchat":
      payload.sessionKey = recipient;
      break;
    // ntfy, slack, discord, ui — recipient handled differently
  }
}

/* ================================================================== */
/* CONVEX ACTIONS                                                      */
/* ================================================================== */

/**
 * Deliver content to channels (Convex internalAction wrapper).
 *
 * Called by the publishing orchestrator, agent system, or scheduled jobs.
 */
export const deliverToChannels = internalAction({
  args: {
    text: v.string(),
    html: v.optional(v.string()),
    markdown: v.optional(v.string()),
    subject: v.optional(v.string()),
    urgency: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("normal"),
      v.literal("low"),
    ),
    contentType: v.union(
      v.literal("alert"),
      v.literal("digest"),
      v.literal("report"),
      v.literal("notification"),
      v.literal("agent_response"),
    ),
    channels: v.optional(v.array(v.string())),
    recipients: v.optional(v.any()),
    userId: v.optional(v.string()),
    sourceEventType: v.optional(v.string()),
    sourceEventId: v.optional(v.string()),
    agentId: v.optional(v.string()),
    policyId: v.optional(v.string()),
    policyRuleName: v.optional(v.string()),
    policyAction: v.optional(v.union(v.literal("allowed"), v.literal("denied"), v.literal("escalated"))),
    evidenceRefs: v.optional(v.array(v.string())),
    canUndo: v.optional(v.boolean()),
    undoInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const content: RawContent = {
      text: args.text,
      html: args.html,
      markdown: args.markdown,
      subject: args.subject,
      urgency: args.urgency,
      contentType: args.contentType,
    };

    const result = await routeToChannels({
      content,
      channels: args.channels as ChannelId[] | undefined,
      recipients: args.recipients,
      userId: args.userId,
      sourceEvent: args.sourceEventType
        ? { type: args.sourceEventType, id: args.sourceEventId ?? "" }
        : undefined,
    });

    console.log(
      `[OutboundPipeline] Delivered to ${result.attempted.length} channels, ` +
      `skipped ${result.skipped.length}, trace=${result.traceId}`,
    );

    await Promise.all(
      result.results
        .filter((delivery) => isOpenClawChannel(delivery.channelId))
        .map((delivery) =>
          ctx.runAction(internal.domains.agents.receipts.actionReceipts.emitReceipt, {
            agentId: args.agentId ?? "messaging-outbound-pipeline",
            userId: args.userId as Id<"users"> | undefined,
            toolName: `channel_send:${delivery.channelId}`,
            sessionKey: (args.recipients?.[delivery.channelId] as string | undefined) ?? undefined,
            channelId: delivery.channelId,
            direction: delivery.success ? "outbound" : "error",
            deployment: "openclaw-gateway",
            params: {
              traceId: result.traceId,
              sourceEventType: args.sourceEventType,
              sourceEventId: args.sourceEventId,
            },
            actionSummary: `Delivered ${args.contentType} via ${delivery.channelId}`,
            policyId: args.policyId ?? "pol_outbound_messaging_default",
            policyRuleName: args.policyRuleName ?? "Outbound messaging default",
            policyAction: args.policyAction ?? "allowed",
            evidenceRefs: args.evidenceRefs ?? [],
            resultSuccess: delivery.success,
            resultSummary: delivery.success
              ? `Message sent via ${delivery.channelId}`
              : `Message failed via ${delivery.channelId}: ${delivery.error ?? "unknown error"}`,
            resultOutputHash: delivery.messageId,
            canUndo: args.canUndo ?? false,
            undoInstructions: args.undoInstructions,
            violations: delivery.success
              ? []
              : [
                  {
                    ruleId: "rule_openclaw_delivery_failure",
                    ruleName: "OpenClaw delivery failure",
                    severity: "warning",
                    description: delivery.error ?? "OpenClaw delivery failed",
                  },
                ],
          }),
        ),
    );

    return result;
  },
});

/**
 * Deliver a single message to a specific channel (simpler API).
 * Used by agent responses and direct sends.
 */
export const sendToChannel = internalAction({
  args: {
    channelId: v.string(),
    recipient: v.string(),
    text: v.string(),
    subject: v.optional(v.string()),
    urgency: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    agentId: v.optional(v.string()),
    policyId: v.optional(v.string()),
    policyRuleName: v.optional(v.string()),
    evidenceRefs: v.optional(v.array(v.string())),
    canUndo: v.optional(v.boolean()),
    undoInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const provider = getProvider(args.channelId as ChannelId);
    if (!provider) {
      return { success: false, error: `No provider for channel: ${args.channelId}` };
    }

    const content: RawContent = {
      text: args.text,
      subject: args.subject,
      urgency: (args.urgency as RawContent["urgency"]) ?? "normal",
      contentType: "notification",
    };

    const constraints = provider.getConstraints();
    const formatted = provider.formatContent(content, constraints);
    injectRecipient(formatted, args.recipient);

    const message: OutboundMessage = {
      recipient: args.recipient,
      formatted,
      raw: content,
    };

    const result = await provider.send(message);

    if (isOpenClawChannel(args.channelId as ChannelId)) {
      await ctx.runAction(internal.domains.agents.receipts.actionReceipts.emitReceipt, {
        agentId: args.agentId ?? "messaging-send-to-channel",
        userId: args.userId,
        toolName: `channel_send:${args.channelId}`,
        sessionKey: args.recipient,
        channelId: args.channelId,
        direction: result.success ? "outbound" : "error",
        deployment: "openclaw-gateway",
        params: {
          subject: args.subject,
          urgency: args.urgency,
        },
        actionSummary: `Sent direct notification via ${args.channelId}`,
        policyId: args.policyId ?? "pol_outbound_messaging_default",
        policyRuleName: args.policyRuleName ?? "Outbound messaging default",
        policyAction: "allowed",
        evidenceRefs: args.evidenceRefs ?? [],
        resultSuccess: result.success,
        resultSummary: result.success
          ? `Message sent via ${args.channelId}`
          : `Message failed via ${args.channelId}: ${result.error ?? "unknown error"}`,
        resultOutputHash: result.messageId,
        canUndo: args.canUndo ?? false,
        undoInstructions: args.undoInstructions,
        violations: result.success
          ? []
          : [
              {
                ruleId: "rule_openclaw_delivery_failure",
                ruleName: "OpenClaw delivery failure",
                severity: "warning",
                description: result.error ?? "OpenClaw delivery failed",
              },
            ],
      });
    }

    return result;
  },
});
