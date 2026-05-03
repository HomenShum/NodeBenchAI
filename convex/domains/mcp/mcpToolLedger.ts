/**
 * MCP Tool Call Ledger + Policy Enforcement
 *
 * This is the "trusted access" layer for NodeBench MCP:
 * - Every tool call creates a ledger row (who/what/why/when/result).
 * - A lightweight policy engine evaluates risk tiers + budgets before execution.
 * - Budget enforcement is configurable (enforce=false logs only; enforce=true blocks).
 *
 * IMPORTANT:
 * - We store *redacted* previews only (never raw secrets).
 * - This is designed to be used by the /api/mcpGateway dispatcher and by the
 *   unified gateway service for "direct" tools (financial tools that bypass Convex).
 */

import { v } from "convex/values";
import { query, mutation, internalMutation } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";
import { hashSync } from "../../../shared/artifacts";

type RiskTier =
  | "read_only"
  | "external_read"
  | "write_internal"
  | "external_side_effect"
  | "destructive"
  | "unknown";

type PolicyConfig = {
  _id?: Id<"mcpPolicyConfigs">;
  name: string;
  enforce: boolean;
  dailyLimitsByTier?: Record<string, number>;
  dailyLimitsByTool?: Record<string, number>;
  blockedTools?: Record<string, boolean>;
  notes?: string;
  createdAt?: number;
  updatedAt?: number;
};

type UsageScope =
  | "tier"
  | "tool"
  | "profile"
  | "account"
  | "account_tool"
  | "account_profile";

const PRICING_VERSION = "mcp-cost-v1-2026-05";

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, v) => {
    if (!v || typeof v !== "object") return v;
    if (seen.has(v as object)) return "[Circular]";
    seen.add(v as object);
    if (Array.isArray(v)) return v;
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = obj[k];
    return out;
  });
}

const SECRET_KEY_RE = /(token|secret|api[_-]?key|password|authorization)/i;
const SECRET_VALUE_RE = /^(hf_[a-zA-Z0-9]+|sk-[a-zA-Z0-9]+|AIza[a-zA-Z0-9_-]+)$/;

function sanitizeForPreview(
  value: unknown,
  opts: { maxDepth: number; maxString: number; maxArray: number },
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    const s = value.trim();
    if (SECRET_VALUE_RE.test(s)) return "[REDACTED]";
    if (/^bearer\s+/i.test(s)) return "[REDACTED]";
    if (s.length > opts.maxString) return `${s.slice(0, opts.maxString)}...(truncated)`;
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return String(value);

  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    if (depth >= opts.maxDepth) return `[Array(${value.length})]`;
    const out: unknown[] = [];
    const slice = value.slice(0, opts.maxArray);
    for (const item of slice) {
      out.push(sanitizeForPreview(item, opts, depth + 1, seen));
    }
    if (value.length > opts.maxArray) {
      out.push(`...(omitted ${value.length - opts.maxArray} items)`);
    }
    return out;
  }

  if (depth >= opts.maxDepth) return "[Object]";
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    const raw = obj[k];
    out[k] = SECRET_KEY_RE.test(k)
      ? "[REDACTED]"
      : sanitizeForPreview(raw, opts, depth + 1, seen);
  }
  return out;
}

function todayDateKeyUtc(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

const DEFAULT_POLICY: PolicyConfig = {
  name: "default",
  enforce: false,
  dailyLimitsByTier: {
    read_only: 20_000,
    external_read: 2_000,
    write_internal: 1_000,
    external_side_effect: 100,
    destructive: 50,
    unknown: 1_000,
  },
};

async function getOrCreatePolicyConfig(
  ctx: { db: any },
  name = "default",
): Promise<Doc<"mcpPolicyConfigs">> {
  const existing = await ctx.db
    .query("mcpPolicyConfigs")
    .withIndex("by_name", (q: any) => q.eq("name", name))
    .first();

  if (existing) return existing;

  const now = Date.now();
  const id = await ctx.db.insert("mcpPolicyConfigs", {
    name,
    enforce: DEFAULT_POLICY.enforce,
    dailyLimitsByTier: DEFAULT_POLICY.dailyLimitsByTier,
    dailyLimitsByTool: {},
    blockedTools: {},
    notes: "Auto-created default. Edit via UI or Convex dashboard.",
    createdAt: now,
    updatedAt: now,
  });
  return (await ctx.db.get(id)) as Doc<"mcpPolicyConfigs">;
}

async function getUsageCount(
  ctx: { db: any },
  dateKey: string,
  scope: UsageScope,
  key: string,
): Promise<{ row: Doc<"mcpToolUsageDaily"> | null; count: number }> {
  const row = await ctx.db
    .query("mcpToolUsageDaily")
    .withIndex("by_date_scope_key", (q: any) =>
      q.eq("dateKey", dateKey).eq("scope", scope).eq("key", key)
    )
    .first();
  return { row: row ?? null, count: row?.count ?? 0 };
}

async function incrementUsage(
  ctx: { db: any },
  dateKey: string,
  scope: UsageScope,
  key: string,
  accounting: { costUnits: number; estimatedCostUsd: number },
): Promise<void> {
  const now = Date.now();
  const { row } = await getUsageCount(ctx, dateKey, scope, key);
  if (row) {
    await ctx.db.patch(row._id, {
      count: row.count + 1,
      costUnits: (row.costUnits ?? 0) + accounting.costUnits,
      estimatedCostUsd: (row.estimatedCostUsd ?? 0) + accounting.estimatedCostUsd,
      updatedAt: now,
    });
    return;
  }
  await ctx.db.insert("mcpToolUsageDaily", {
    dateKey,
    scope,
    key,
    count: 1,
    costUnits: accounting.costUnits,
    estimatedCostUsd: accounting.estimatedCostUsd,
    updatedAt: now,
  });
}

function toRiskTier(input?: string): RiskTier {
  switch (input) {
    case "read_only":
    case "external_read":
    case "write_internal":
    case "external_side_effect":
    case "destructive":
      return input;
    default:
      return "unknown";
  }
}

function stringFromMeta(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function extractRequestAccountingMeta(requestMeta: unknown): {
  requestId?: string;
  accountKey?: string;
  profileName?: string;
  authMode?: string;
  clientName?: string;
} {
  const meta = requestMeta && typeof requestMeta === "object"
    ? (requestMeta as Record<string, unknown>)
    : {};

  return {
    requestId: stringFromMeta(meta.requestId, 120),
    accountKey: stringFromMeta(meta.accountKey, 180),
    profileName: stringFromMeta(meta.profileName, 80),
    authMode: stringFromMeta(meta.authMode, 40),
    clientName: stringFromMeta(meta.clientName, 160),
  };
}

function estimateToolCost(input: {
  toolName: string;
  toolType: string;
  riskTier: RiskTier;
}): { costUnits: number; estimatedCostUsd: number; pricingVersion: string } {
  const explicitUnitsByTool: Record<string, number> = {
    "nodebench.research_company": 12,
    "nodebench.research_person": 12,
    "nodebench.research_role": 14,
    "nodebench.search_public_sources": 5,
    "nodebench.compile_interview_packet": 4,
    "nodebench.get_matching_context": 2,
    "nodebench.context.pack": 2,
    "nodebench.dossiers.get": 1,
    "nodebench.entities.resolve": 1,
    "nodebench.claims.submit_public": 2,
    "nodebench.claims.verify": 3,
    "nodebench.watch_entity": 1,
    "nodebench.link_private_signal_to_public_entity": 1,
  };

  const defaultUnitsByRisk: Record<RiskTier, number> = {
    read_only: 1,
    external_read: 4,
    write_internal: 3,
    external_side_effect: 8,
    destructive: 12,
    unknown: 2,
  };

  const directToolPremium = input.toolType === "direct" ? 1 : 0;
  const costUnits =
    (explicitUnitsByTool[input.toolName] ?? defaultUnitsByRisk[input.riskTier]) +
    directToolPremium;

  // Unit pricing is deliberately conservative and estimated. Actual provider
  // invoices can be reconciled separately when API/search providers expose usage.
  const estimatedCostUsd = Number((costUnits * 0.001).toFixed(6));

  return { costUnits, estimatedCostUsd, pricingVersion: PRICING_VERSION };
}

export const startToolCallInternal = internalMutation({
  args: {
    toolName: v.string(),
    toolType: v.optional(v.string()),
    riskTier: v.optional(v.string()),
    args: v.optional(v.any()),
    idempotencyKey: v.optional(v.string()),
    requestMeta: v.optional(v.any()),
  },
  returns: v.object({
    allowed: v.boolean(),
    callId: v.id("mcpToolCallLedger"),
    argsHash: v.string(),
    policy: v.any(),
  }),
  handler: async (ctx, input) => {
    const now = Date.now();
    const dateKey = todayDateKeyUtc(now);

    const cfg = await getOrCreatePolicyConfig(ctx, "default");

    const toolName = input.toolName;
    const toolType = input.toolType ?? "unknown";
    const riskTier = toRiskTier(input.riskTier);
    const requestAccountingMeta = extractRequestAccountingMeta(input.requestMeta);
    const toolAccounting = estimateToolCost({ toolName, toolType, riskTier });

    const argsValue = input.args ?? {};
    const argsString = stableStringify(argsValue);
    const argsHash = `args_${hashSync(argsString)}`;

    const argsKeys =
      argsValue && typeof argsValue === "object" && !Array.isArray(argsValue)
        ? Object.keys(argsValue as Record<string, unknown>).sort()
        : [];

    const argsPreview = (() => {
      try {
        const sanitized = sanitizeForPreview(argsValue, {
          maxDepth: 4,
          maxString: 240,
          maxArray: 20,
        });
        const s = stableStringify(sanitized);
        return s.length > 4_000 ? `${s.slice(0, 4_000)}...(truncated)` : s;
      } catch {
        return undefined;
      }
    })();

    const blockedByDenylist = Boolean(cfg.blockedTools?.[toolName]);

    const tierKey = riskTier;
    const toolKey = toolName;

    const { count: tierCount } = await getUsageCount(ctx, dateKey, "tier", tierKey);
    const { count: toolCount } = await getUsageCount(ctx, dateKey, "tool", toolKey);

    const tierLimit =
      (cfg.dailyLimitsByTier?.[tierKey] ?? DEFAULT_POLICY.dailyLimitsByTier?.[tierKey]) ??
      undefined;
    const toolLimit = cfg.dailyLimitsByTool?.[toolKey] ?? undefined;

    const budgetWouldExceed =
      (typeof tierLimit === "number" && tierCount >= tierLimit) ||
      (typeof toolLimit === "number" && toolCount >= toolLimit);

    const enforce = Boolean(cfg.enforce);

    // Denylist always blocks. Budget only blocks when enforce=true.
    const allowed = !blockedByDenylist && (!enforce || !budgetWouldExceed);

    const policy = {
      config: {
        name: cfg.name,
        enforce,
      },
      denylist: {
        blockedByDenylist,
      },
      budgets: {
        dateKey,
        tier: { tierKey, count: tierCount, limit: tierLimit ?? null },
        tool: { toolKey, count: toolCount, limit: toolLimit ?? null },
        wouldExceed: budgetWouldExceed,
      },
      accounting: {
        accountKey: requestAccountingMeta.accountKey ?? null,
        profileName: requestAccountingMeta.profileName ?? null,
        authMode: requestAccountingMeta.authMode ?? null,
        costUnits: toolAccounting.costUnits,
        estimatedCostUsd: toolAccounting.estimatedCostUsd,
        pricingVersion: toolAccounting.pricingVersion,
      },
    };

    const callId = await ctx.db.insert("mcpToolCallLedger", {
      toolName,
      toolType,
      riskTier,
      allowed,
      policy,
      argsHash,
      argsKeys,
      argsPreview,
      idempotencyKey: input.idempotencyKey,
      requestMeta: input.requestMeta,
      requestId: requestAccountingMeta.requestId,
      accountKey: requestAccountingMeta.accountKey,
      profileName: requestAccountingMeta.profileName,
      authMode: requestAccountingMeta.authMode,
      clientName: requestAccountingMeta.clientName,
      startedAt: now,
      costUnits: toolAccounting.costUnits,
      estimatedCostUsd: toolAccounting.estimatedCostUsd,
      pricingVersion: toolAccounting.pricingVersion,
    });

    if (allowed) {
      await incrementUsage(ctx, dateKey, "tier", tierKey, toolAccounting);
      await incrementUsage(ctx, dateKey, "tool", toolKey, toolAccounting);
      if (requestAccountingMeta.profileName) {
        await incrementUsage(ctx, dateKey, "profile", requestAccountingMeta.profileName, toolAccounting);
      }
      if (requestAccountingMeta.accountKey) {
        await incrementUsage(ctx, dateKey, "account", requestAccountingMeta.accountKey, toolAccounting);
        await incrementUsage(
          ctx,
          dateKey,
          "account_tool",
          `${requestAccountingMeta.accountKey}:${toolKey}`,
          toolAccounting,
        );
      }
      if (requestAccountingMeta.accountKey && requestAccountingMeta.profileName) {
        await incrementUsage(
          ctx,
          dateKey,
          "account_profile",
          `${requestAccountingMeta.accountKey}:${requestAccountingMeta.profileName}`,
          toolAccounting,
        );
      }
    }

    return { allowed, callId, argsHash, policy };
  },
});

export const finishToolCallInternal = internalMutation({
  args: {
    callId: v.id("mcpToolCallLedger"),
    success: v.boolean(),
    durationMs: v.number(),
    errorMessage: v.optional(v.string()),
    result: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, input) => {
    const now = Date.now();

    const resultPreview = (() => {
      try {
        const sanitized = sanitizeForPreview(input.result, {
          maxDepth: 4,
          maxString: 240,
          maxArray: 30,
        });
        const s = stableStringify(sanitized);
        return s.length > 6_000 ? `${s.slice(0, 6_000)}...(truncated)` : s;
      } catch {
        return undefined;
      }
    })();

    const resultBytes = (() => {
      try {
        const s = stableStringify(input.result);
        return s.length;
      } catch {
        return undefined;
      }
    })();

    await ctx.db.patch(input.callId, {
      finishedAt: now,
      durationMs: input.durationMs,
      success: input.success,
      errorMessage: input.errorMessage,
      resultPreview: resultPreview,
      resultBytes: resultBytes,
    });

    return null;
  },
});

export const listToolCalls = query({
  args: {
    // Optional UTC date filter (YYYY-MM-DD). When provided, only rows whose startedAt
    // falls within that UTC day are returned.
    dateKey: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    toolName: v.optional(v.string()),
    riskTier: v.optional(v.string()),
    allowed: v.optional(v.boolean()),
    success: v.optional(v.boolean()),
  },
  returns: v.object({
    calls: v.array(v.object({
      _id: v.id("mcpToolCallLedger"),
      toolName: v.string(),
      toolType: v.string(),
      riskTier: v.string(),
      allowed: v.boolean(),
      policy: v.optional(v.any()),
      argsHash: v.string(),
      argsKeys: v.array(v.string()),
      argsPreview: v.optional(v.string()),
      idempotencyKey: v.optional(v.string()),
      requestMeta: v.optional(v.any()),
      requestId: v.optional(v.string()),
      accountKey: v.optional(v.string()),
      profileName: v.optional(v.string()),
      authMode: v.optional(v.string()),
      clientName: v.optional(v.string()),
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
      durationMs: v.optional(v.number()),
      success: v.optional(v.boolean()),
      errorMessage: v.optional(v.string()),
      resultPreview: v.optional(v.string()),
      resultBytes: v.optional(v.number()),
      costUnits: v.optional(v.number()),
      estimatedCostUsd: v.optional(v.number()),
      pricingVersion: v.optional(v.string()),
    })),
    nextCursor: v.optional(v.string()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const cursor = typeof args.cursor === "string" ? args.cursor : null;

    const requestedDateKey = typeof args.dateKey === "string" ? args.dateKey.trim() : "";
    const hasValidDateKey = /^\d{4}-\d{2}-\d{2}$/.test(requestedDateKey);
    const dayStartMs = hasValidDateKey ? Date.parse(`${requestedDateKey}T00:00:00.000Z`) : NaN;
    const hasDateRange = Number.isFinite(dayStartMs);
    const dayEndMs = hasDateRange ? dayStartMs + 24 * 60 * 60 * 1000 : NaN;

    let q;
    if (args.toolName) {
      q = ctx.db
        .query("mcpToolCallLedger")
        .withIndex("by_tool_startedAt", (qq) => {
          let out = qq.eq("toolName", args.toolName!);
          if (hasDateRange) out = out.gte("startedAt", dayStartMs).lt("startedAt", dayEndMs);
          return out;
        })
        .order("desc");
    } else if (args.riskTier) {
      q = ctx.db
        .query("mcpToolCallLedger")
        .withIndex("by_risk_startedAt", (qq) => {
          let out = qq.eq("riskTier", args.riskTier!);
          if (hasDateRange) out = out.gte("startedAt", dayStartMs).lt("startedAt", dayEndMs);
          return out;
        })
        .order("desc");
    } else if (typeof args.allowed === "boolean") {
      q = ctx.db
        .query("mcpToolCallLedger")
        .withIndex("by_allowed_startedAt", (qq) => {
          let out = qq.eq("allowed", args.allowed!);
          if (hasDateRange) out = out.gte("startedAt", dayStartMs).lt("startedAt", dayEndMs);
          return out;
        })
        .order("desc");
    } else {
      q = ctx.db.query("mcpToolCallLedger");
      if (hasDateRange) {
        q = q.withIndex("by_startedAt", (qq) => qq.gte("startedAt", dayStartMs).lt("startedAt", dayEndMs));
      } else {
        q = q.withIndex("by_startedAt");
      }
      q = q.order("desc");
    }

    // Over-fetch; we apply optional in-memory filters (success) after.
    const page = await q.paginate({ cursor, numItems: Math.min(limit * 3, 300) });
    let rows = page.page;

    if (typeof args.success === "boolean") {
      rows = rows.filter((r) => r.success === args.success);
    }
    if (typeof args.allowed === "boolean" && !args.toolName && !args.riskTier) {
      // no-op; index already applied
    }

    const calls = rows.slice(0, limit).map((r) => ({
      _id: r._id,
      toolName: r.toolName,
      toolType: r.toolType,
      riskTier: r.riskTier,
      allowed: r.allowed,
      policy: r.policy,
      argsHash: r.argsHash,
      argsKeys: r.argsKeys,
      argsPreview: r.argsPreview,
      idempotencyKey: r.idempotencyKey,
      requestMeta: r.requestMeta,
      requestId: r.requestId,
      accountKey: r.accountKey,
      profileName: r.profileName,
      authMode: r.authMode,
      clientName: r.clientName,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      durationMs: r.durationMs,
      success: r.success,
      errorMessage: r.errorMessage,
      resultPreview: r.resultPreview,
      resultBytes: r.resultBytes,
      costUnits: r.costUnits,
      estimatedCostUsd: r.estimatedCostUsd,
      pricingVersion: r.pricingVersion,
    }));

    return {
      calls,
      nextCursor: page.isDone ? undefined : page.continueCursor,
      hasMore: !page.isDone,
    };
  },
});

export const getPolicyAndUsage = query({
  args: {
    // Allow inspecting historical usage (e.g. when ledger rows exist for a prior day).
    // Default remains "today" (UTC).
    dateKey: v.optional(v.string()),
  },
  returns: v.object({
    dateKey: v.string(),
    config: v.object({
      name: v.string(),
      enforce: v.boolean(),
      dailyLimitsByTier: v.optional(v.record(v.string(), v.number())),
      dailyLimitsByTool: v.optional(v.record(v.string(), v.number())),
      blockedTools: v.optional(v.record(v.string(), v.boolean())),
      notes: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
    }),
    usageByTier: v.array(v.object({
      tier: v.string(),
      count: v.number(),
      limit: v.optional(v.number()),
    })),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const requested = typeof args.dateKey === "string" ? args.dateKey.trim() : "";
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayDateKeyUtc(now);
    const cfg =
      (await ctx.db
        .query("mcpPolicyConfigs")
        .withIndex("by_name", (q: any) => q.eq("name", "default"))
        .first()) ??
      ({
        name: "default",
        enforce: DEFAULT_POLICY.enforce,
        dailyLimitsByTier: DEFAULT_POLICY.dailyLimitsByTier,
        dailyLimitsByTool: {},
        blockedTools: {},
        notes: "Missing config; using in-memory defaults (will be created on first tool call).",
        updatedAt: undefined,
      } as any);

    const tierRows = await ctx.db
      .query("mcpToolUsageDaily")
      .withIndex("by_date_scope", (q) => q.eq("dateKey", dateKey).eq("scope", "tier"))
      .collect();

    const usageByTier = tierRows
      .map((r) => ({
        tier: r.key,
        count: r.count,
        limit: cfg.dailyLimitsByTier?.[r.key] ?? DEFAULT_POLICY.dailyLimitsByTier?.[r.key],
      }))
      .sort((a, b) => b.count - a.count);

    return {
      dateKey,
      config: {
        name: cfg.name,
        enforce: cfg.enforce,
        dailyLimitsByTier: cfg.dailyLimitsByTier,
        dailyLimitsByTool: cfg.dailyLimitsByTool,
        blockedTools: cfg.blockedTools,
        notes: cfg.notes,
        updatedAt: cfg.updatedAt,
      },
      usageByTier,
    };
  },
});

export const getUsageAndCostSnapshot = query({
  args: {
    dateKey: v.optional(v.string()),
    accountKey: v.optional(v.string()),
    profileName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    dateKey: v.string(),
    pricingVersion: v.string(),
    filters: v.object({
      accountKey: v.optional(v.string()),
      profileName: v.optional(v.string()),
    }),
    totals: v.object({
      calls: v.number(),
      costUnits: v.number(),
      estimatedCostUsd: v.number(),
    }),
    usageByProfile: v.array(v.object({
      profileName: v.string(),
      calls: v.number(),
      costUnits: v.number(),
      estimatedCostUsd: v.number(),
    })),
    usageByTool: v.array(v.object({
      toolName: v.string(),
      calls: v.number(),
      costUnits: v.number(),
      estimatedCostUsd: v.number(),
    })),
    usageByAccount: v.array(v.object({
      accountKey: v.string(),
      calls: v.number(),
      costUnits: v.number(),
      estimatedCostUsd: v.number(),
    })),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const requested = typeof args.dateKey === "string" ? args.dateKey.trim() : "";
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayDateKeyUtc(now);
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);

    const normalizeRow = (row: Doc<"mcpToolUsageDaily">) => ({
      key: row.key,
      calls: row.count,
      costUnits: row.costUnits ?? row.count,
      estimatedCostUsd: row.estimatedCostUsd ?? 0,
    });

    const collectScopeRows = async (scope: UsageScope) => {
      const rows = await ctx.db
        .query("mcpToolUsageDaily")
        .withIndex("by_date_scope", (q) => q.eq("dateKey", dateKey).eq("scope", scope))
        .collect();
      return rows.map(normalizeRow);
    };

    const rankRows = (rows: Awaited<ReturnType<typeof collectScopeRows>>) =>
      rows
        .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.calls - a.calls)
        .slice(0, limit);

    const profileRows = rankRows(await collectScopeRows("profile"));
    const accountRows = rankRows(await collectScopeRows("account"));
    const allToolRows = rankRows(await collectScopeRows("tool"));

    let scopedToolRows = allToolRows;
    if (args.accountKey) {
      const accountToolRows = await collectScopeRows("account_tool");
      const prefix = `${args.accountKey}:`;
      scopedToolRows = rankRows(accountToolRows
        .filter((row) => row.key.startsWith(prefix))
        .map((row) => ({ ...row, key: row.key.slice(prefix.length) })));
    }

    const totalSource = args.accountKey
      ? accountRows.filter((row) => row.key === args.accountKey)
      : args.profileName
        ? profileRows.filter((row) => row.key === args.profileName)
        : accountRows;

    const totals = totalSource.reduce(
      (acc, row) => ({
        calls: acc.calls + row.calls,
        costUnits: acc.costUnits + row.costUnits,
        estimatedCostUsd: Number((acc.estimatedCostUsd + row.estimatedCostUsd).toFixed(6)),
      }),
      { calls: 0, costUnits: 0, estimatedCostUsd: 0 },
    );

    return {
      dateKey,
      pricingVersion: PRICING_VERSION,
      filters: {
        accountKey: args.accountKey,
        profileName: args.profileName,
      },
      totals,
      usageByProfile: profileRows.map((row) => ({
        profileName: row.key,
        calls: row.calls,
        costUnits: row.costUnits,
        estimatedCostUsd: row.estimatedCostUsd,
      })),
      usageByTool: scopedToolRows.map((row) => ({
        toolName: row.key,
        calls: row.calls,
        costUnits: row.costUnits,
        estimatedCostUsd: row.estimatedCostUsd,
      })),
      usageByAccount: accountRows.map((row) => ({
        accountKey: row.key,
        calls: row.calls,
        costUnits: row.costUnits,
        estimatedCostUsd: row.estimatedCostUsd,
      })),
    };
  },
});

async function requireAdmin(ctx: any): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");

  const user = await ctx.db
    .query("users")
    .filter((q: any) => q.eq(q.field("email"), identity.email))
    .first();
  if (!user) throw new Error("User not found");

  const adminUser = await ctx.db
    .query("adminUsers")
    .withIndex("by_userId", (q: any) => q.eq("userId", user._id))
    .first();
  if (!adminUser) throw new Error("Access denied: Not an admin");

  return user._id;
}

export const upsertPolicyConfig = mutation({
  args: {
    name: v.optional(v.string()),
    enforce: v.optional(v.boolean()),
    dailyLimitsByTier: v.optional(v.record(v.string(), v.number())),
    dailyLimitsByTool: v.optional(v.record(v.string(), v.number())),
    blockedTools: v.optional(v.record(v.string(), v.boolean())),
    notes: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    configId: v.id("mcpPolicyConfigs"),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const name = args.name ?? "default";
    const existing = await ctx.db
      .query("mcpPolicyConfigs")
      .withIndex("by_name", (q: any) => q.eq("name", name))
      .first();

    const now = Date.now();
    if (!existing) {
      const id = await ctx.db.insert("mcpPolicyConfigs", {
        name,
        enforce: args.enforce ?? false,
        dailyLimitsByTier: args.dailyLimitsByTier ?? DEFAULT_POLICY.dailyLimitsByTier,
        dailyLimitsByTool: args.dailyLimitsByTool ?? {},
        blockedTools: args.blockedTools ?? {},
        notes: args.notes,
        createdAt: now,
        updatedAt: now,
      });
      return { ok: true, configId: id };
    }

    await ctx.db.patch(existing._id, {
      enforce: args.enforce ?? existing.enforce,
      dailyLimitsByTier: args.dailyLimitsByTier ?? existing.dailyLimitsByTier,
      dailyLimitsByTool: args.dailyLimitsByTool ?? existing.dailyLimitsByTool,
      blockedTools: args.blockedTools ?? existing.blockedTools,
      notes: args.notes ?? existing.notes,
      updatedAt: now,
    });

    return { ok: true, configId: existing._id };
  },
});
