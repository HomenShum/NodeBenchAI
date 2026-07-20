/**
 * Messaging Security — Content scanning, rate limiting, STOP/START propagation
 *
 * Extends the 8-layer defense model to messaging:
 * 1. Content scanning for PII/credential leaks on outbound messages
 * 2. Per-user per-channel rate limiting
 * 3. STOP/START keyword handling across all channels
 * 4. WhatsApp ToS flagging (Baileys = unofficial API)
 * 5. GDPR retention auto-expiry
 * 6. Audit trail for OpenClaw-routed messages
 */

/* ================================================================== */
/* CONTENT SCANNING                                                    */
/* ================================================================== */

/**
 * Patterns that should NEVER appear in outbound messages.
 * Reuses pattern set from openclaw-mcp-nodebench/proxyTools.ts.
 */
const PII_PATTERNS: Array<{ pattern: RegExp; label: string; severity: "block" | "warn" }> = [
  // Credentials
  { pattern: /\b(password|passwd|secret|token|api_key|apikey)\s*[:=]\s*\S+/i, label: "credential_leak", severity: "block" },
  { pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/, label: "aws_key", severity: "block" },
  { pattern: /\bghp_[a-zA-Z0-9]{36}\b/, label: "github_token", severity: "block" },
  { pattern: /\bsk-[a-zA-Z0-9]{20,}\b/, label: "openai_key", severity: "block" },
  { pattern: /\bnpm_[a-zA-Z0-9]{36}\b/, label: "npm_token", severity: "block" },

  // PII
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/, label: "ssn", severity: "block" },
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, label: "credit_card", severity: "block" },

  // Potentially sensitive (warn only)
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, label: "email_address", severity: "warn" },
  { pattern: /\b\+?1?\s?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/, label: "phone_number", severity: "warn" },
];

export interface ScanResult {
  safe: boolean;
  blocked: string[];
  warnings: string[];
}

/**
 * Scan outbound message content for PII/credential leaks.
 *
 * Returns blocked=true if any "block" severity patterns match.
 * Warnings are informational (logged but not blocking).
 */
export function scanOutboundContent(text: string): ScanResult {
  const blocked: string[] = [];
  const warnings: string[] = [];

  for (const { pattern, label, severity } of PII_PATTERNS) {
    if (pattern.test(text)) {
      if (severity === "block") {
        blocked.push(label);
      } else {
        warnings.push(label);
      }
    }
  }

  return {
    safe: blocked.length === 0,
    blocked,
    warnings,
  };
}

/* ================================================================== */
/* RATE LIMITING                                                       */
/* ================================================================== */

/** In-memory rate tracker (per process, not persistent) */
const rateCounts = new Map<string, { count: number; windowStart: number }>();

/**
 * Check if a send is within rate limits.
 *
 * Uses a simple sliding window counter.
 * For persistent rate limiting, use the deliveryJobs table counts.
 */
export function checkRateLimit(
  userId: string,
  channelId: string,
  maxPerMinute: number,
): { allowed: boolean; remaining: number } {
  const key = `${userId}:${channelId}`;
  const now = Date.now();
  const windowMs = 60_000;

  const entry = rateCounts.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    rateCounts.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: maxPerMinute - 1 };
  }

  if (entry.count >= maxPerMinute) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: maxPerMinute - entry.count };
}

/* ================================================================== */
/* STOP/START KEYWORDS                                                 */
/* ================================================================== */

/** Unified STOP keywords across all channels (not just SMS) */
export const STOP_KEYWORDS = new Set([
  "STOP", "UNSUBSCRIBE", "QUIT", "CANCEL", "END", "OPTOUT", "OPT-OUT",
]);

/** Unified START keywords */
export const START_KEYWORDS = new Set([
  "START", "SUBSCRIBE", "YES", "OPTIN", "OPT-IN", "RESUME",
]);

/**
 * Check if a message is a STOP or START command.
 */
export function parseOptKeyword(
  text: string,
): "stop" | "start" | null {
  const normalized = text.trim().toUpperCase();
  if (STOP_KEYWORDS.has(normalized)) return "stop";
  if (START_KEYWORDS.has(normalized)) return "start";
  return null;
}

/* ================================================================== */
/* WHATSAPP TOS WARNING                                                */
/* ================================================================== */

/**
 * Flag channels that use unofficial APIs with ToS risk.
 *
 * WhatsApp (Baileys) violates Meta ToS — users must explicitly opt in.
 * This is surfaced in check_openclaw_setup and the settings UI.
 */
export const TOS_RISK_CHANNELS: Record<string, {
  risk: string;
  recommendation: string;
}> = {
  whatsapp: {
    risk: "Baileys is an unofficial WhatsApp Web API. Meta may ban accounts using unofficial clients.",
    recommendation: "Use WhatsApp Business API (official) for production. Baileys is acceptable for personal/testing use.",
  },
  imessage: {
    risk: "iMessage integration requires macOS host with logged-in Apple ID. Apple may restrict automated messaging.",
    recommendation: "Limit to personal use. Not suitable for bulk messaging.",
  },
};

/* ================================================================== */
/* GDPR RETENTION                                                      */
/* ================================================================== */

/** Default retention period for message logs (30 days) */
export const DEFAULT_RETENTION_DAYS = 30;

/**
 * Check if a message record has exceeded retention period.
 */
export function isExpired(createdAt: number, retentionDays: number = DEFAULT_RETENTION_DAYS): boolean {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return createdAt < cutoff;
}
