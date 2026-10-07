/**
 * Slack Webhook Handler
 *
 * HTTP endpoints for Slack Events API, Slash Commands, and Interactivity.
 * Uses HMAC-SHA256 signature verification (different from Discord's Ed25519).
 *
 * Endpoints:
 * - /slack/events - Events API (messages, app_mention)
 * - /slack/commands - Slash commands (/encounter, /research, /digest)
 * - /slack/interactivity - Button clicks, modal submissions
 *
 * @module integrations/slack/slackWebhook
 */

import { httpAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SlackEvent {
  type: string;
  event?: {
    type: string;
    user?: string;
    channel?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
    files?: Array<{
      id: string;
      name: string;
      mimetype: string;
      url_private: string;
    }>;
  };
  team_id?: string;
  event_id?: string;
  event_time?: number;
  challenge?: string; // For URL verification
}

export interface SlackSlashCommand {
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
  user_id: string;
  user_name: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
}

export interface SlackInteractivity {
  type: string; // "block_actions" | "view_submission" | "shortcut"
  trigger_id: string;
  user: {
    id: string;
    username: string;
    name: string;
    team_id: string;
  };
  team: {
    id: string;
    domain: string;
  };
  channel?: {
    id: string;
    name: string;
  };
  actions?: Array<{
    action_id: string;
    block_id: string;
    value?: string;
    type: string;
  }>;
  message?: {
    ts: string;
    text: string;
  };
  response_url?: string;
  view?: {
    id: string;
    type: string;
    callback_id: string;
    private_metadata?: string;
    state?: {
      values: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>>;
    };
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SIGNATURE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert string to hex.
 */
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Timing-safe string comparison.
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verify Slack request signature using HMAC-SHA256 (Web Crypto API).
 * Different from Discord's Ed25519 verification.
 *
 * @see https://api.slack.com/authentication/verifying-requests-from-slack
 */
export async function verifySlackSignature(
  signature: string,
  timestamp: string,
  body: string,
  signingSecret: string
): Promise<boolean> {
  // Reject if timestamp is more than 5 minutes old (replay protection)
  const requestTimestamp = parseInt(timestamp, 10);
  const currentTime = Math.floor(Date.now() / 1000);

  if (Math.abs(currentTime - requestTimestamp) > 300) {
    console.error("[Slack] Request timestamp too old:", currentTime - requestTimestamp, "seconds");
    return false;
  }

  // Construct the base string: v0:timestamp:body
  const baseString = `v0:${timestamp}:${body}`;

  try {
    // Import signing secret as HMAC key
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(signingSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    // Compute HMAC-SHA256
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(baseString)
    );
    const computedSignature = `v0=${toHex(signatureBuffer)}`;

    // Timing-safe comparison to prevent timing attacks
    return timingSafeCompare(signature, computedSignature);
  } catch (error) {
    console.error("[Slack] Signature verification failed:", error);
    return false;
  }
}

/**
 * Get signing secret from environment.
 * Falls back to hardcoded value for development (should be env var in production).
 */
function getSigningSecret(): string | null {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) {
    console.warn("[Slack] SLACK_SIGNING_SECRET not set - signature verification disabled for dev");
    return null;
  }
  return secret;
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENTS API HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * HTTP handler for Slack Events API.
 * Handles: url_verification, message, app_mention
 */
export const slackEventsHandler = httpAction(async (ctx, request) => {
  console.log("[Slack] Events webhook received");

  try {
    const rawBody = await request.text();
    const timestamp = request.headers.get("x-slack-request-timestamp");
    const signature = request.headers.get("x-slack-signature");
    const signingSecret = getSigningSecret();

    // Verify signature (skip in dev if no secret)
    if (signingSecret && timestamp && signature) {
      if (!(await verifySlackSignature(signature, timestamp, rawBody, signingSecret))) {
        console.error("[Slack] Invalid signature");
        return new Response("Invalid signature", { status: 401 });
      }
    }

    const payload: SlackEvent = JSON.parse(rawBody);

    // Handle URL verification challenge (required for Slack app setup)
    if (payload.type === "url_verification" && payload.challenge) {
      console.log("[Slack] URL verification challenge received");
      return new Response(payload.challenge, {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Handle event_callback (actual events)
    if (payload.type === "event_callback" && payload.event) {
      // Schedule async processing (respond within 3 seconds)
      await ctx.scheduler.runAfter(0, internal.domains.integrations.slack.slackAgent.handleSlackEvent, {
        event: payload.event as Record<string, unknown>,
        teamId: payload.team_id || "",
        eventId: payload.event_id || "",
      });

      console.log("[Slack] Scheduled event processing for:", payload.event.type);
    }

    // Acknowledge immediately
    return new Response("", { status: 200 });
  } catch (error) {
    console.error("[Slack] Events webhook error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SLASH COMMANDS HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * HTTP handler for Slack Slash Commands.
 * Commands: /encounter, /research, /digest, /help
 */
export const slackCommandsHandler = httpAction(async (ctx, request) => {
  console.log("[Slack] Slash command received");

  try {
    const rawBody = await request.text();
    const timestamp = request.headers.get("x-slack-request-timestamp");
    const signature = request.headers.get("x-slack-signature");
    const signingSecret = getSigningSecret();

    // Verify signature
    if (signingSecret && timestamp && signature) {
      if (!(await verifySlackSignature(signature, timestamp, rawBody, signingSecret))) {
        console.error("[Slack] Invalid signature for slash command");
        return new Response("Invalid signature", { status: 401 });
      }
    }

    // Parse URL-encoded form data
    const params = new URLSearchParams(rawBody);
    const command: SlackSlashCommand = {
      command: params.get("command") || "",
      text: params.get("text") || "",
      response_url: params.get("response_url") || "",
      trigger_id: params.get("trigger_id") || "",
      user_id: params.get("user_id") || "",
      user_name: params.get("user_name") || "",
      team_id: params.get("team_id") || "",
      team_domain: params.get("team_domain") || "",
      channel_id: params.get("channel_id") || "",
      channel_name: params.get("channel_name") || "",
    };

    console.log(`[Slack] Command ${command.command} from ${command.user_name}: "${command.text}"`);

    // Schedule async processing
    await ctx.scheduler.runAfter(0, internal.domains.integrations.slack.slackAgent.handleSlashCommand, {
      command: command as unknown as Record<string, unknown>,
    });

    // Return immediate acknowledgment (visible only to user)
    // The actual response will be sent via response_url
    return new Response(
      JSON.stringify({
        response_type: "ephemeral",
        text: ":hourglass: Processing your request...",
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Slack] Slash command error:", error);
    return new Response(
      JSON.stringify({
        response_type: "ephemeral",
        text: ":x: Sorry, an error occurred. Please try again.",
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERACTIVITY HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * HTTP handler for Slack Interactivity (buttons, modals).
 */
export const slackInteractivityHandler = httpAction(async (ctx, request) => {
  console.log("[Slack] Interactivity received");

  try {
    const rawBody = await request.text();
    const timestamp = request.headers.get("x-slack-request-timestamp");
    const signature = request.headers.get("x-slack-signature");
    const signingSecret = getSigningSecret();

    // Verify signature
    if (signingSecret && timestamp && signature) {
      if (!(await verifySlackSignature(signature, timestamp, rawBody, signingSecret))) {
        console.error("[Slack] Invalid signature for interactivity");
        return new Response("Invalid signature", { status: 401 });
      }
    }

    // Parse the payload (it's URL-encoded with a 'payload' field containing JSON)
    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get("payload");

    if (!payloadStr) {
      console.error("[Slack] Missing payload in interactivity request");
      return new Response("Missing payload", { status: 400 });
    }

    const payload: SlackInteractivity = JSON.parse(payloadStr);

    console.log(`[Slack] Interactivity type: ${payload.type}, user: ${payload.user?.username}`);

    // Handle different interaction types
    if (payload.type === "block_actions") {
      // Button click
      await ctx.scheduler.runAfter(0, internal.domains.integrations.slack.slackAgent.handleButtonClick, {
        payload: payload as unknown as Record<string, unknown>,
      });
    } else if (payload.type === "view_submission") {
      // Modal submission
      await ctx.scheduler.runAfter(0, internal.domains.integrations.slack.slackAgent.handleModalSubmission, {
        payload: payload as unknown as Record<string, unknown>,
      });

      // For view_submission, we need to acknowledge with an empty response
      // to close the modal, or return errors to keep it open
      return new Response(
        JSON.stringify({ response_action: "clear" }),
        { headers: { "Content-Type": "application/json" } }
      );
    } else if (payload.type === "shortcut" || payload.type === "message_action") {
      // Global/message shortcuts
      await ctx.scheduler.runAfter(0, internal.domains.integrations.slack.slackAgent.handleShortcut, {
        payload: payload as unknown as Record<string, unknown>,
      });
    }

    // Acknowledge
    return new Response("", { status: 200 });
  } catch (error) {
    console.error("[Slack] Interactivity error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});
