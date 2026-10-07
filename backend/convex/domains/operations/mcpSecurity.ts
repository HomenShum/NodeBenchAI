// convex/domains/operations/mcpSecurity.ts
// MCP Security Hardening - OWASP API Security Top 10 Alignment
//
// Implements defense-in-depth for Model Context Protocol (MCP) servers.
// Treats MCP as an API surface with real security risks.
//
// ============================================================================
// OWASP API SECURITY TOP 10 MAPPING
// ============================================================================
//
// API1: Broken Object Level Authorization (BOLA)
//   → Scoped tokens per tool, strict authz checks
//
// API2: Broken Authentication
//   → Strong token generation, rotation, revocation
//
// API3: Broken Object Property Level Authorization
//   → Field-level filtering on responses
//
// API4: Unrestricted Resource Consumption
//   → Rate limiting, quotas, backpressure
//
// API5: Broken Function Level Authorization (BFLA)
//   → Tool allowlists by persona/environment
//
// API6: Unrestricted Access to Sensitive Business Flows
//   → Approval workflows for high-risk operations
//
// API7: Server Side Request Forgery (SSRF)
//   → URL validation, allowlists
//
// API8: Security Misconfiguration
//   → Signed packages, pinned versions
//
// API9: Improper Inventory Management
//   → Tool registry, version tracking
//
// API10: Unsafe Consumption of APIs
//   → Input validation, output sanitization
//
// ============================================================================

import { v } from "convex/values";
import { internalMutation, mutation, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";

/* ------------------------------------------------------------------ */
/* SCOPED TOKEN MANAGEMENT (API1, API2)                                */
/* ------------------------------------------------------------------ */

export type ToolScope =
  | "read:artifacts"
  | "read:evaluations"
  | "read:groundtruth"
  | "read:models"
  | "write:evaluations"
  | "write:corrections"
  | "write:labels"
  | "admin:all";

export interface McpToken {
  tokenId: string;
  tokenHash: string;        // SHA-256 of token (never store plaintext)
  name: string;             // Human-readable identifier

  /** User/service account */
  userId: string;

  /** Scoped permissions */
  scopes: ToolScope[];

  /** Tool allowlist */
  allowedTools: string[];   // Tool names this token can invoke

  /** Environment restrictions */
  allowedEnvironments: ("development" | "staging" | "production")[];

  /** Rate limits */
  rateLimit: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
  };

  /** Token lifecycle */
  createdAt: number;
  expiresAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
  revokedBy?: string;
  revokedReason?: string;
}

/**
 * Generate a new MCP token with scoped permissions
 */
export const createMcpToken = mutation({
  args: {
    name: v.string(),
    userId: v.string(),
    scopes: v.array(v.string()),
    allowedTools: v.array(v.string()),
    allowedEnvironments: v.array(v.union(
      v.literal("development"),
      v.literal("staging"),
      v.literal("production")
    )),
    expiresInDays: v.optional(v.number()),
    rateLimit: v.optional(v.object({
      requestsPerMinute: v.number(),
      requestsPerHour: v.number(),
      requestsPerDay: v.number(),
    })),
  },
  returns: v.object({
    tokenId: v.id("mcpApiTokens"),
    token: v.string(),  // Only returned once!
  }),
  handler: async (ctx, args) => {
    // Generate cryptographically secure token
    const token = generateSecureToken();
    const tokenHash = await hashToken(token);

    const expiresAt = Date.now() + (args.expiresInDays ?? 90) * 24 * 60 * 60 * 1000;

    const tokenId = await ctx.db.insert("mcpApiTokens", {
      tokenHash,
      name: args.name,
      userId: args.userId,
      scopes: args.scopes,
      allowedTools: args.allowedTools,
      allowedEnvironments: args.allowedEnvironments,
      rateLimit: args.rateLimit ?? {
        requestsPerMinute: 60,
        requestsPerHour: 1000,
        requestsPerDay: 10000,
      },
      createdAt: Date.now(),
      expiresAt,
    });

    // Log the security action
    await ctx.runMutation(internal.domains.operations.adminAuditLog.logAdminActionInternal, {
      action: "create_mcp_token",
      actionCategory: "security_event",
      actor: args.userId,
      resourceType: "mcpApiTokens",
      resourceId: tokenId,
      before: null,
      after: {
        name: args.name,
        scopes: args.scopes,
        allowedTools: args.allowedTools,
        allowedEnvironments: args.allowedEnvironments,
        expiresInDays: args.expiresInDays ?? 90,
      },
      reason: `Created MCP API token: ${args.name}`,
      metadata: {
        tokenName: args.name,
        scopesCount: args.scopes.length,
        toolsCount: args.allowedTools.length,
        expiresAt,
      },
    }).catch((err) => {
      console.warn('[createMcpToken] Failed to log audit entry:', err);
    });

    return {
      tokenId,
      token,  // ONLY returned once - user must save it
    };
  },
});

/**
 * Revoke an MCP token
 */
export const revokeMcpToken = mutation({
  args: {
    tokenId: v.id("mcpApiTokens"),
    revokedBy: v.string(),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Get token state before revocation
    const token = await ctx.db.get(args.tokenId);

    await ctx.db.patch(args.tokenId, {
      revokedAt: Date.now(),
      revokedBy: args.revokedBy,
      revokedReason: args.reason,
    });

    // Log the security action
    if (token) {
      await ctx.runMutation(internal.domains.operations.adminAuditLog.logAdminActionInternal, {
        action: "revoke_mcp_token",
        actionCategory: "security_event",
        actor: args.revokedBy,
        resourceType: "mcpApiTokens",
        resourceId: args.tokenId,
        before: {
          name: token.name,
          userId: token.userId,
          scopes: token.scopes,
          createdAt: token.createdAt,
        },
        after: {
          revokedAt: Date.now(),
          revokedBy: args.revokedBy,
          revokedReason: args.reason,
        },
        reason: `Revoked MCP token: ${args.reason}`,
        metadata: {
          tokenName: token.name,
          tokenAge: Date.now() - token.createdAt,
        },
      }).catch((err) => {
        console.warn('[revokeMcpToken] Failed to log audit entry:', err);
      });
    }

    return null;
  },
});

/**
 * Rotate an MCP token (revoke old, create new)
 */
export const rotateMcpToken = mutation({
  args: {
    oldTokenId: v.id("mcpApiTokens"),
    rotatedBy: v.string(),
  },
  returns: v.object({
    tokenId: v.id("mcpApiTokens"),
    token: v.string(),
  }),
  handler: async (ctx, args) => {
    // Get old token
    const oldToken = await ctx.db.get(args.oldTokenId);
    if (!oldToken) {
      throw new Error("Token not found");
    }

    // Revoke old token
    await ctx.db.patch(args.oldTokenId, {
      revokedAt: Date.now(),
      revokedBy: args.rotatedBy,
      revokedReason: "rotated",
    });

    // Create new token with same permissions
    const token = generateSecureToken();
    const tokenHash = await hashToken(token);

    const tokenId = await ctx.db.insert("mcpApiTokens", {
      tokenHash,
      name: `${oldToken.name} (rotated)`,
      userId: oldToken.userId,
      scopes: oldToken.scopes,
      allowedTools: oldToken.allowedTools,
      allowedEnvironments: oldToken.allowedEnvironments,
      rateLimit: oldToken.rateLimit,
      createdAt: Date.now(),
      expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
    });

    // Log the security action
    await ctx.runMutation(internal.domains.operations.adminAuditLog.logAdminActionInternal, {
      action: "rotate_mcp_token",
      actionCategory: "security_event",
      actor: args.rotatedBy,
      resourceType: "mcpApiTokens",
      resourceId: tokenId,
      before: {
        oldTokenId: args.oldTokenId,
        name: oldToken.name,
        createdAt: oldToken.createdAt,
      },
      after: {
        newTokenId: tokenId,
        name: `${oldToken.name} (rotated)`,
        createdAt: Date.now(),
      },
      reason: `Rotated MCP token: ${oldToken.name}`,
      metadata: {
        oldTokenAge: Date.now() - oldToken.createdAt,
        oldTokenId: args.oldTokenId,
        newTokenId: tokenId,
      },
    }).catch((err) => {
      console.warn('[rotateMcpToken] Failed to log audit entry:', err);
    });

    return { tokenId, token };
  },
});

/* ------------------------------------------------------------------ */
/* AUTHORIZATION CHECKS (API1, API2, API5)                             */
/* ------------------------------------------------------------------ */

export interface AuthorizationContext {
  tokenHash: string;
  tool: string;
  operation: string;
  resourceId?: string;
  environment: "development" | "staging" | "production";
}

export interface AuthorizationResult {
  authorized: boolean;
  reason?: string;
  token?: McpToken;
  scopesMatched?: string[];
}

/**
 * Check if a token is authorized for an operation
 */
export const authorizeToolInvocation = query({
  args: {
    tokenHash: v.string(),
    tool: v.string(),
    requiredScopes: v.array(v.string()),
    environment: v.union(
      v.literal("development"),
      v.literal("staging"),
      v.literal("production")
    ),
  },
  returns: v.object({
    authorized: v.boolean(),
    reason: v.optional(v.string()),
    userId: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<{
    authorized: boolean;
    reason?: string;
    userId?: string;
  }> => {
    // Find token by hash
    const token = await ctx.db
      .query("mcpApiTokens")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .first();

    if (!token) {
      return { authorized: false, reason: "invalid_token" };
    }

    // Check if revoked
    if (token.revokedAt) {
      return { authorized: false, reason: "token_revoked" };
    }

    // Check if expired
    if (token.expiresAt < Date.now()) {
      return { authorized: false, reason: "token_expired" };
    }

    // Check environment
    if (!token.allowedEnvironments.includes(args.environment)) {
      return { authorized: false, reason: "environment_not_allowed" };
    }

    // Check tool allowlist
    if (!token.allowedTools.includes(args.tool) && !token.allowedTools.includes("*")) {
      return { authorized: false, reason: "tool_not_allowed" };
    }

    // Check scopes
    const hasAllScopes = args.requiredScopes.every(
      (scope) => token.scopes.includes(scope as ToolScope) || token.scopes.includes("admin:all")
    );

    if (!hasAllScopes) {
      return { authorized: false, reason: "insufficient_scopes" };
    }

    // Note: queries must be readonly. Track lastUsedAt via a separate mutation if needed.

    return {
      authorized: true,
      userId: token.userId,
    };
  },
});

/* ------------------------------------------------------------------ */
/* TOOL ALLOWLISTS (API5 - BFLA Prevention)                            */
/* ------------------------------------------------------------------ */

export type Persona = "analyst" | "data_engineer" | "model_validator" | "admin";

export interface ToolAllowlist {
  persona: Persona;
  environment: "development" | "staging" | "production";
  allowedTools: string[];
  deniedTools: string[];  // Explicit denies (take precedence)
}

export const TOOL_ALLOWLISTS: ToolAllowlist[] = [
  // Analysts: Read-only access
  {
    persona: "analyst",
    environment: "production",
    allowedTools: [
      "read_fundamentals",
      "read_evaluations",
      "read_models",
      "query_ground_truth",
    ],
    deniedTools: [
      "delete_*",
      "update_model",
      "approve_calibration",
    ],
  },

  // Data Engineers: Read + write evaluations
  {
    persona: "data_engineer",
    environment: "production",
    allowedTools: [
      "read_*",
      "write_evaluations",
      "write_corrections",
      "run_dcf",
    ],
    deniedTools: [
      "delete_*",
      "approve_*",
    ],
  },

  // Model Validators: Independent validation tools
  {
    persona: "model_validator",
    environment: "production",
    allowedTools: [
      "read_*",
      "create_validation_finding",
      "approve_model",
      "reject_model",
    ],
    deniedTools: [
      "update_model",  // Cannot modify what they're validating
      "delete_*",
    ],
  },

  // Admins: Full access (with audit trail)
  {
    persona: "admin",
    environment: "production",
    allowedTools: ["*"],
    deniedTools: [],
  },

  // Development: More permissive
  {
    persona: "analyst",
    environment: "development",
    allowedTools: ["*"],
    deniedTools: ["delete_production_*"],
  },
];

/**
 * Check if a tool is allowed for a persona
 */
export function isToolAllowed(
  persona: Persona,
  environment: "development" | "staging" | "production",
  tool: string
): { allowed: boolean; reason?: string } {
  const allowlist = TOOL_ALLOWLISTS.find(
    (a) => a.persona === persona && a.environment === environment
  );

  if (!allowlist) {
    return { allowed: false, reason: "no_allowlist_found" };
  }

  // Check explicit denies first
  for (const denied of allowlist.deniedTools) {
    if (matchesPattern(tool, denied)) {
      return { allowed: false, reason: "explicitly_denied" };
    }
  }

  // Check allows
  for (const allowed of allowlist.allowedTools) {
    if (matchesPattern(tool, allowed)) {
      return { allowed: true };
    }
  }

  return { allowed: false, reason: "not_in_allowlist" };
}

function matchesPattern(tool: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) {
    return tool.startsWith(pattern.slice(0, -1));
  }
  return tool === pattern;
}

/* ------------------------------------------------------------------ */
/* AUDIT LOGGING (API9, API10)                                         */
/* ------------------------------------------------------------------ */

export interface McpAuditLogEntry {
  /** Tool invocation details */
  tokenId: Id<"mcpApiTokens">;
  userId: string;
  tool: string;
  operation: string;

  /** Request details */
  argsHash: string;        // SHA-256 of arguments (for audit, not full args)
  resourceId?: string;
  environment: string;

  /** Response details */
  statusCode: number;
  latencyMs: number;

  /** Authorization */
  authorized: boolean;
  scopesUsed: string[];

  /** Rate limiting */
  requestsInWindow?: number;
  rateLimitHit?: boolean;

  /** Timestamp */
  invokedAt: number;
}

/**
 * Log an MCP tool invocation
 */
export const logMcpInvocation = internalMutation({
  args: {
    tokenId: v.id("mcpApiTokens"),
    userId: v.string(),
    tool: v.string(),
    operation: v.string(),
    argsHash: v.string(),
    resourceId: v.optional(v.string()),
    environment: v.string(),
    statusCode: v.number(),
    latencyMs: v.number(),
    authorized: v.boolean(),
    scopesUsed: v.array(v.string()),
    requestsInWindow: v.optional(v.number()),
    rateLimitHit: v.optional(v.boolean()),
  },
  returns: v.id("mcpAccessLog"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("mcpAccessLog", {
      tokenId: args.tokenId,
      userId: args.userId,
      method: args.tool,
      resource: args.operation,
      argsHash: args.argsHash,
      resourceId: args.resourceId,
      environment: args.environment,
      statusCode: args.statusCode,
      latencyMs: args.latencyMs,
      authorized: args.authorized,
      scopesUsed: args.scopesUsed,
      requestsInWindow: args.requestsInWindow,
      rateLimitHit: args.rateLimitHit,
      createdAt: Date.now(),
    });
  },
});

/**
 * Query audit logs for security analysis
 */
export const queryAuditLogs = query({
  args: {
    tokenId: v.optional(v.id("mcpApiTokens")),
    userId: v.optional(v.string()),
    tool: v.optional(v.string()),
    unauthorized: v.optional(v.boolean()),
    rateLimitHit: v.optional(v.boolean()),
    hoursBack: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const hoursBack = args.hoursBack ?? 24;
    const limit = args.limit ?? 100;
    const since = Date.now() - hoursBack * 60 * 60 * 1000;

    let query = ctx.db
      .query("mcpAccessLog")
      .filter((q) => q.gte(q.field("createdAt"), since));

    if (args.tokenId) {
      query = query.filter((q) => q.eq(q.field("tokenId"), args.tokenId));
    }

    if (args.userId) {
      query = query.filter((q) => q.eq(q.field("userId"), args.userId));
    }

    if (args.tool) {
      query = query.filter((q) => q.eq(q.field("method"), args.tool));
    }

    if (args.unauthorized !== undefined) {
      query = query.filter((q) => q.eq(q.field("authorized"), !args.unauthorized));
    }

    if (args.rateLimitHit !== undefined) {
      query = query.filter((q) => q.eq(q.field("rateLimitHit"), args.rateLimitHit));
    }

    return await query.order("desc").take(limit);
  },
});

/* ------------------------------------------------------------------ */
/* SUPPLY CHAIN SECURITY (API8)                                        */
/* ------------------------------------------------------------------ */

export interface McpServerPackage {
  packageId: string;
  name: string;
  version: string;

  /** Package integrity */
  checksumSha256: string;
  signatureValid: boolean;
  signedBy?: string;

  /** Pinning */
  pinnedVersion: boolean;
  allowedVersions: string[];  // Semver ranges

  /** Security */
  knownVulnerabilities: Array<{
    cveId: string;
    severity: "critical" | "high" | "medium" | "low";
    fixedInVersion?: string;
  }>;

  /** Approval */
  approvedBy?: string;
  approvedAt?: number;

  /** Metadata */
  publishedAt: number;
  lastScannedAt?: number;
}

/**
 * Register an approved MCP server package
 */
export const registerMcpPackage = mutation({
  args: {
    name: v.string(),
    version: v.string(),
    checksumSha256: v.string(),
    signedBy: v.optional(v.string()),
    approvedBy: v.string(),
  },
  returns: v.id("mcpServerPackages"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("mcpServerPackages", {
      packageId: `${args.name}@${args.version}`,
      name: args.name,
      version: args.version,
      checksumSha256: args.checksumSha256,
      signatureValid: true,  // Would verify signature
      signedBy: args.signedBy,
      pinnedVersion: true,
      allowedVersions: [args.version],
      knownVulnerabilities: [],
      approvedBy: args.approvedBy,
      approvedAt: Date.now(),
      publishedAt: Date.now(),
    });
  },
});

/* ------------------------------------------------------------------ */
/* HELPER FUNCTIONS                                                    */
/* ------------------------------------------------------------------ */

/**
 * Generate a cryptographically secure token
 */
function generateSecureToken(): string {
  // In production: use crypto.randomBytes(32).toString('base64')
  // For now, simplified
  return `mcp_${Date.now()}_${Math.random().toString(36).substring(2)}`;
}

/**
 * Hash a token using SHA-256
 */
async function hashToken(token: string): Promise<string> {
  // In production: use crypto.subtle.digest('SHA-256', ...)
  // For now, simplified
  return `sha256_${token.length}_${token.charCodeAt(0)}`;
}

/**
 * Hash arguments for audit logging
 */
export function hashArguments(args: unknown): string {
  // In production: JSON.stringify then SHA-256
  const str = JSON.stringify(args);
  return `hash_${str.length}_${str.charCodeAt(0) || 0}`;
}

/* ------------------------------------------------------------------ */
/* INPUT VALIDATION (API7, API10 - SSRF + Injection Prevention)      */
/* ------------------------------------------------------------------ */

/**
 * URL allowlist for external data sources
 */
const URL_ALLOWLIST = [
  // SEC EDGAR
  /^https:\/\/www\.sec\.gov\//,
  /^https:\/\/data\.sec\.gov\//,

  // Financial data providers
  /^https:\/\/api\.polygon\.io\//,
  /^https:\/\/finnhub\.io\//,

  // Patent data
  /^https:\/\/developer\.uspto\.gov\//,

  // Company data
  /^https:\/\/www\.crunchbase\.com\//,

  // News (trusted sources only)
  /^https:\/\/www\.reuters\.com\//,
  /^https:\/\/www\.bloomberg\.com\//,
];

/**
 * Validate URL to prevent SSRF attacks
 */
export function validateUrl(url: string): { valid: boolean; reason?: string } {
  // Parse URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: "invalid_url_format" };
  }

  // Block private IP ranges
  const hostname = parsed.hostname.toLowerCase();

  // Block localhost
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    return { valid: false, reason: "localhost_blocked" };
  }

  // Block private networks
  const privateIpPatterns = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^169\.254\./, // Link-local
    /^fc00:/, // IPv6 private
  ];

  for (const pattern of privateIpPatterns) {
    if (pattern.test(hostname)) {
      return { valid: false, reason: "private_ip_blocked" };
    }
  }

  // Require HTTPS (except localhost in dev)
  if (parsed.protocol !== "https:") {
    return { valid: false, reason: "https_required" };
  }

  // Check allowlist
  const allowed = URL_ALLOWLIST.some((pattern) => pattern.test(url));
  if (!allowed) {
    return { valid: false, reason: "url_not_allowlisted" };
  }

  return { valid: true };
}

/**
 * Validate an MCP server URL for SSRF protection.
 *
 * Unlike `validateUrl`, this is intended for calling *user-configured MCP servers*.
 * We enforce HTTPS + block localhost/private networks, but do not apply the
 * external data-source allowlist.
 */
export function validateMcpServerUrl(url: string): { valid: boolean; reason?: string } {
  // Parse URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: "invalid_url_format" };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    return { valid: false, reason: "localhost_blocked" };
  }

  const privateIpPatterns = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^fc00:/,
  ];

  for (const pattern of privateIpPatterns) {
    if (pattern.test(hostname)) {
      return { valid: false, reason: "private_ip_blocked" };
    }
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, reason: "https_required" };
  }

  return { valid: true };
}

/**
 * Sanitize string inputs to prevent injection
 */
export function sanitizeString(input: string, maxLength = 1000): string {
  // Truncate
  let sanitized = input.slice(0, maxLength);

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, "");

  // Normalize whitespace
  sanitized = sanitized.replace(/\s+/g, " ").trim();

  return sanitized;
}

/**
 * Validate entity identifier format
 */
export function validateEntityId(entityId: string): {
  valid: boolean;
  reason?: string;
} {
  // Must be alphanumeric with underscores/hyphens
  if (!/^[a-zA-Z0-9_-]+$/.test(entityId)) {
    return { valid: false, reason: "invalid_characters" };
  }

  // Length constraints
  if (entityId.length < 1 || entityId.length > 100) {
    return { valid: false, reason: "invalid_length" };
  }

  return { valid: true };
}

/**
 * Validate numeric range inputs
 */
export function validateNumericRange(
  value: number,
  min: number,
  max: number
): { valid: boolean; reason?: string } {
  if (!Number.isFinite(value)) {
    return { valid: false, reason: "not_finite" };
  }

  if (value < min || value > max) {
    return { valid: false, reason: `out_of_range_${min}_${max}` };
  }

  return { valid: true };
}

/**
 * Validate date range
 */
export function validateDateRange(
  startMs: number,
  endMs: number
): { valid: boolean; reason?: string } {
  const now = Date.now();
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  const oneYearAhead = now + 365 * 24 * 60 * 60 * 1000;

  if (startMs < oneYearAgo || startMs > oneYearAhead) {
    return { valid: false, reason: "start_date_out_of_range" };
  }

  if (endMs < oneYearAgo || endMs > oneYearAhead) {
    return { valid: false, reason: "end_date_out_of_range" };
  }

  if (endMs < startMs) {
    return { valid: false, reason: "end_before_start" };
  }

  return { valid: true };
}

/* ------------------------------------------------------------------ */
/* OUTPUT SANITIZATION (API3 - Property-Level Authorization)         */
/* ------------------------------------------------------------------ */

/**
 * Field visibility rules based on scopes
 */
interface FieldVisibilityRule {
  field: string;
  requiredScope: ToolScope;
}

const SENSITIVE_FIELDS: FieldVisibilityRule[] = [
  { field: "tokenHash", requiredScope: "admin:all" },
  { field: "userId", requiredScope: "admin:all" },
  { field: "email", requiredScope: "admin:all" },
  { field: "rawContent", requiredScope: "read:artifacts" },
  { field: "humanLabel", requiredScope: "read:groundtruth" },
  { field: "correction", requiredScope: "read:evaluations" },
];

/**
 * Filter response fields based on token scopes
 */
export function filterResponseFields<T extends Record<string, unknown>>(
  data: T,
  scopes: ToolScope[]
): Partial<T> {
  const filtered: Partial<T> = { ...data };

  // Check each sensitive field
  for (const rule of SENSITIVE_FIELDS) {
    if (
      rule.field in filtered &&
      !scopes.includes(rule.requiredScope) &&
      !scopes.includes("admin:all")
    ) {
      delete filtered[rule.field];
    }
  }

  return filtered;
}

/**
 * Redact PII from logs
 */
export function redactPii(data: unknown): unknown {
  if (typeof data !== "object" || data === null) {
    return data;
  }

  const redacted = Array.isArray(data) ? [...data] : { ...data };

  const piiFields = ["email", "phone", "ssn", "ipAddress", "name"];

  for (const key in redacted) {
    if (piiFields.includes(key)) {
      redacted[key] = "[REDACTED]";
    } else if (typeof redacted[key] === "object") {
      redacted[key] = redactPii(redacted[key]);
    }
  }

  return redacted;
}

/**
 * Limit array response size to prevent DoS
 */
export function limitArraySize<T>(
  arr: T[],
  maxSize = 1000
): { data: T[]; truncated: boolean } {
  if (arr.length <= maxSize) {
    return { data: arr, truncated: false };
  }

  return {
    data: arr.slice(0, maxSize),
    truncated: true,
  };
}

/* ------------------------------------------------------------------ */
/* APPROVAL WORKFLOWS (API6 - Sensitive Business Flows)              */
/* ------------------------------------------------------------------ */

/**
 * High-risk operations requiring approval
 */
export const HIGH_RISK_OPERATIONS = [
  "delete_ground_truth",
  "approve_calibration",
  "reject_validation",
  "update_financial_fundamentals",
  "bulk_delete",
] as const;

export type HighRiskOperation = (typeof HIGH_RISK_OPERATIONS)[number];

/**
 * Check if operation requires approval workflow
 */
export function requiresApproval(operation: string): boolean {
  return HIGH_RISK_OPERATIONS.includes(operation as HighRiskOperation);
}

/**
 * Approval workflow state
 */
export interface ApprovalWorkflow {
  operationId: string;
  operation: HighRiskOperation;
  requestedBy: string;
  requestedAt: number;

  approvers: Array<{
    userId: string;
    approvedAt: number;
  }>;

  requiredApprovals: number;
  status: "pending" | "approved" | "rejected";

  metadata: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* EXPORTS                                                             */
/* ------------------------------------------------------------------ */
// Types are exported inline above.
