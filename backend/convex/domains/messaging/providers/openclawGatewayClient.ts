/**
 * OpenClaw Gateway Client — HTTP client for the local OpenClaw Gateway
 *
 * Uses OpenClaw's OpenAI-compatible API (POST /v1/chat/completions)
 * as the simplest integration path. No WebSocket needed initially.
 *
 * Default: ws://127.0.0.1:18789 (local Gateway)
 * Cloud Convex → local OpenClaw requires tunnel (cloudflared/ngrok).
 *
 * Session key format: agent:main:<channel>:<type>:<identifier>
 * Example: agent:main:whatsapp:dm:+15555550123
 */

import type { OpenClawChannelId } from "../channelProvider.js";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export interface OpenClawSession {
  sessionKey: string;
  channel: string;
  type: string;
  identifier: string;
  status: "active" | "idle" | "disconnected";
}

export interface OpenClawChannelStatus {
  channel: string;
  connected: boolean;
  sessionCount: number;
  lastActivity?: number;
}

export interface OpenClawSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  latencyMs?: number;
}

/* ================================================================== */
/* CLIENT                                                              */
/* ================================================================== */

/** Default Gateway HTTP endpoint (OpenAI-compatible) */
const DEFAULT_GATEWAY_URL = "http://127.0.0.1:18789";

function getGatewayUrl(): string {
  return process.env.OPENCLAW_GATEWAY_URL ?? DEFAULT_GATEWAY_URL;
}

/**
 * Build an OpenClaw session key from components.
 *
 * Format: agent:main:<channel>:<type>:<identifier>
 */
export function buildSessionKey(
  channel: OpenClawChannelId,
  type: "dm" | "group" | "channel",
  identifier: string,
): string {
  return `agent:main:${channel}:${type}:${identifier}`;
}

/**
 * Parse a session key into components.
 */
export function parseSessionKey(sessionKey: string): {
  channel: string;
  type: string;
  identifier: string;
} | null {
  const parts = sessionKey.split(":");
  if (parts.length < 5 || parts[0] !== "agent" || parts[1] !== "main") return null;
  return {
    channel: parts[2],
    type: parts[3],
    identifier: parts.slice(4).join(":"),
  };
}

/**
 * Send a message through the OpenClaw Gateway.
 *
 * Uses the OpenAI-compatible chat completions endpoint:
 *   POST /v1/chat/completions
 *   { model: "openclaw", messages: [{ role: "assistant", content: text }] }
 *
 * The `sessionKey` header tells the Gateway which channel/recipient to route to.
 */
export async function sendMessage(
  sessionKey: string,
  content: string,
): Promise<OpenClawSendResult> {
  const url = `${getGatewayUrl()}/v1/chat/completions`;
  const start = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenClaw-Session": sessionKey,
        ...(process.env.OPENCLAW_API_KEY
          ? { Authorization: `Bearer ${process.env.OPENCLAW_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        model: "openclaw",
        messages: [{ role: "assistant", content }],
      }),
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Gateway error: ${response.status} ${errorText}`,
        latencyMs: Date.now() - start,
      };
    }

    const result = await response.json();
    return {
      success: true,
      messageId: result.id ?? `ocgw-${Date.now()}`,
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.name === "TimeoutError"
        ? "Gateway timeout (10s)"
        : err.message ?? "Gateway send failed",
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * List active sessions on the Gateway.
 */
export async function listSessions(): Promise<OpenClawSession[]> {
  const url = `${getGatewayUrl()}/rpc/sessions.list`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.OPENCLAW_API_KEY
          ? { Authorization: `Bearer ${process.env.OPENCLAW_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) return [];
    const result = await response.json();
    return result.sessions ?? [];
  } catch {
    return [];
  }
}

/**
 * Get channel connection status from the Gateway.
 */
export async function getChannelStatus(): Promise<OpenClawChannelStatus[]> {
  const url = `${getGatewayUrl()}/rpc/channels.status`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.OPENCLAW_API_KEY
          ? { Authorization: `Bearer ${process.env.OPENCLAW_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) return [];
    const result = await response.json();
    return result.channels ?? [];
  } catch {
    return [];
  }
}

/**
 * Health check — ping the Gateway.
 */
export async function ping(): Promise<boolean> {
  try {
    const response = await fetch(`${getGatewayUrl()}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
