/**
 * Inbound Pipeline — OpenClaw Gateway → Convex → Agent
 *
 * Handles incoming messages from any OpenClaw-connected channel
 * (WhatsApp, Signal, iMessage, MS Teams, Matrix, WebChat).
 *
 * Flow:
 *   User sends message → OpenClaw Gateway → Hook handler → POST /openclaw/inbound
 *   → Convex httpAction validates HMAC → handleInboundMessage internalAction
 *   → Resolves user from channel identifier → Gets/creates agent thread
 *   → Invokes coordinator agent → Response sent via outbound pipeline → User
 *
 * Pattern: telegramAgent.ts — always return 200, dispatch work to internalAction.
 *
 * NOTE: httpAction runs in V8 runtime (not Node.js), so we use Web Crypto API
 * instead of Node.js crypto module for HMAC validation.
 */

import { v } from "convex/values";
import { httpAction, internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

/** Inbound message from OpenClaw Gateway webhook */
export interface OpenClawInboundMessage {
  /** Session key: agent:main:<channel>:<type>:<identifier> */
  sessionKey: string;
  /** Channel name (whatsapp, signal, etc.) */
  channel: string;
  /** Sender identifier (phone number, username, chat ID) */
  sender: string;
  /** Message content */
  content: string;
  /** Timestamp from the originating platform */
  timestamp: number;
  /** Optional metadata (attachments, reply-to, etc.) */
  metadata?: Record<string, unknown>;
}

/* ================================================================== */
/* HMAC VALIDATION                                                     */
/* ================================================================== */

/**
 * Validate HMAC-SHA256 signature from OpenClaw Gateway webhook.
 *
 * The Gateway signs the request body with the shared secret
 * (OPENCLAW_WEBHOOK_SECRET env var).
 */
async function validateHmac(body: string, signature: string | null): Promise<boolean> {
  const secret = process.env.OPENCLAW_WEBHOOK_SECRET;
  if (!secret) {
    // If no secret configured, skip validation (development mode)
    console.warn("[InboundPipeline] OPENCLAW_WEBHOOK_SECRET not set — skipping HMAC validation");
    return true;
  }

  if (!signature) return false;

  try {
    const enc = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(body));
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time comparison (not truly constant-time in JS, but best-effort)
    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return diff === 0;
  } catch (err) {
    console.error("[InboundPipeline] HMAC validation error:", err);
    return false;
  }
}

/* ================================================================== */
/* HTTP WEBHOOK HANDLER                                                */
/* ================================================================== */

/**
 * HTTP webhook handler for OpenClaw Gateway inbound messages.
 * Register in convex/http.ts: POST /openclaw/inbound
 *
 * Always returns 200 to prevent Gateway retries.
 * Dispatches actual work to handleInboundMessage internalAction.
 */
export const openclawInboundHandler = httpAction(async (ctx, request) => {
  try {
    const bodyText = await request.text();

    // Validate HMAC signature
    const signature = request.headers.get("X-OpenClaw-Signature");
    if (!(await validateHmac(bodyText, signature))) {
      console.error("[InboundPipeline] HMAC validation failed");
      return new Response("Unauthorized", { status: 401 });
    }

    const message: OpenClawInboundMessage = JSON.parse(bodyText);

    // Dispatch to internalAction for processing
    await ctx.runAction(
      internal.domains.messaging.inboundPipeline.handleInboundMessage,
      {
        sessionKey: message.sessionKey,
        channel: message.channel,
        sender: message.sender,
        content: message.content,
        timestamp: message.timestamp,
        metadata: message.metadata ?? {},
      },
    );

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[InboundPipeline] Webhook error:", error);
    // Return 200 to prevent Gateway retries (same pattern as telegramAgent)
    return new Response("OK", { status: 200 });
  }
});

/* ================================================================== */
/* MESSAGE HANDLER                                                     */
/* ================================================================== */

/**
 * Process an inbound message from OpenClaw Gateway.
 *
 * 1. Log the inbound message
 * 2. Resolve user from channel identifier
 * 3. Handle STOP/START keywords
 * 4. Get or create agent thread
 * 5. Invoke coordinator agent
 * 6. Route response through outbound pipeline
 */
export const handleInboundMessage = internalAction({
  args: {
    sessionKey: v.string(),
    channel: v.string(),
    sender: v.string(),
    content: v.string(),
    timestamp: v.number(),
    metadata: v.any(),
  },
  handler: async (ctx, args) => {
    const { sessionKey, channel, sender, content, timestamp } = args;

    console.log(
      `[InboundPipeline] ${channel}:${sender} → "${content.slice(0, 80)}${content.length > 80 ? "..." : ""}"`,
    );

    // 1. Log inbound message
    await ctx.runMutation(
      internal.domains.messaging.inboundPipeline.logInboundMessage,
      {
        sessionKey,
        channel,
        sender,
        content,
        timestamp,
      },
    );

    // 2. Handle STOP/START keywords (unified across all channels)
    const normalized = content.trim().toUpperCase();
    if (["STOP", "UNSUBSCRIBE", "QUIT", "CANCEL"].includes(normalized)) {
      console.log(`[InboundPipeline] STOP keyword received from ${channel}:${sender}`);
      // TODO: Update channel preferences opt-out (Phase 3 Step 8)
      return;
    }
    if (["START", "SUBSCRIBE", "YES"].includes(normalized)) {
      console.log(`[InboundPipeline] START keyword received from ${channel}:${sender}`);
      // TODO: Update channel preferences opt-in (Phase 3 Step 8)
      return;
    }

    // 3. Resolve user from channel identifier
    const userId = await ctx.runQuery(
      internal.domains.messaging.inboundPipeline.resolveUser,
      { channel, identifier: sender },
    );

    // 4. Route to coordinator agent
    // For now, log the intent. Full agent routing requires Phase 3 (channel context tools).
    console.log(
      `[InboundPipeline] Ready for agent routing: user=${userId ?? "unknown"}, channel=${channel}, content="${content.slice(0, 50)}"`,
    );

    // TODO: Phase 3 Step 9 — invoke coordinator agent with channel context
    // await ctx.runAction(internal.domains.agents.core.coordinatorAgent.handleChannelMessage, {
    //   userId, channel, sender, content, sessionKey,
    // });
  },
});

/* ================================================================== */
/* MUTATIONS + QUERIES                                                 */
/* ================================================================== */

/**
 * Log an inbound message for audit trail.
 */
export const logInboundMessage = internalMutation({
  args: {
    sessionKey: v.string(),
    channel: v.string(),
    sender: v.string(),
    content: v.string(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    // Write to a general message log (reuse deliveryJobs table pattern)
    // For now, just log — full observability in Phase 4 Step 12
    console.log(
      `[InboundPipeline] Logged: ${args.channel}:${args.sender} at ${new Date(args.timestamp).toISOString()}`,
    );
  },
});

/**
 * Resolve a user from a channel identifier (phone number, username, etc.).
 *
 * Looks up channelPreferences to find which user owns this identifier.
 * Returns null if unknown (new user — should trigger onboarding).
 */
export const resolveUser = internalQuery({
  args: {
    channel: v.string(),
    identifier: v.string(),
  },
  handler: async (ctx, { channel, identifier }): Promise<string | null> => {
    // TODO: Phase 3 Step 8 — query channelPreferences table
    // const pref = await ctx.db
    //   .query("channelPreferences")
    //   .withIndex("by_channel_identifier", (q) =>
    //     q.eq("channelId", channel).eq("identifier", identifier)
    //   )
    //   .first();
    // return pref?.userId ?? null;

    return null; // Placeholder until channelPreferences table exists
  },
});
