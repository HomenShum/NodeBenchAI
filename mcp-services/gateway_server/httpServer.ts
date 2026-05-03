#!/usr/bin/env node
/**
 * NodeBench AI Gateway MCP Server
 *
 * HTTP JSON-RPC 2.0 server that exposes research, narrative, verification,
 * and knowledge graph tools to external MCP agents.
 *
 * Requires:
 *   CONVEX_URL        – Convex deployment URL (e.g. https://xxx.convex.cloud)
 *   MCP_SECRET        – Shared secret for Convex-side dispatcher auth
 *   MCP_HTTP_TOKEN    – (optional) Bearer token for MCP client auth
 */

import http from "http";
import { createHash, randomUUID } from "node:crypto";
import { researchTools } from "./tools/researchTools.js";
import { narrativeTools } from "./tools/narrativeTools.js";
import { verificationTools } from "./tools/verificationTools.js";
import { knowledgeTools } from "./tools/knowledgeTools.js";
import { documentTools } from "./tools/documentTools.js";
import { planningTools } from "./tools/planningTools.js";
import { memoryTools } from "./tools/memoryTools.js";
import { searchTools } from "./tools/searchTools.js";
import { financialTools } from "./tools/financialTools.js";
import { missionTools } from "./tools/missionTools.js";
import { intelligenceTools } from "./tools/intelligenceTools.js";
import { evalTools } from "./tools/evalTools.js";
import { createMetaTools } from "./tools/metaTools.js";
import {
  filterToolsForProfile,
  isPublicToolProfileName,
  listToolProfiles,
  normalizeToolProfileName,
  type ToolProfileName,
} from "./tools/toolProfiles.js";
import { callGateway } from "./convexClient.js";
import { getRequestContext, runWithRequestContext } from "./requestContext.js";

const domainTools = [
  ...researchTools,
  ...narrativeTools,
  ...verificationTools,
  ...knowledgeTools,
  ...documentTools,
  ...planningTools,
  ...memoryTools,
  ...searchTools,
  ...financialTools,
  ...missionTools,
  ...intelligenceTools,
  ...evalTools,
];

const allTools = [...domainTools, ...createMetaTools(domainTools)];
const directToolNames = new Set(financialTools.map((t) => t.name));

const HOST = process.env.MCP_HTTP_HOST || "0.0.0.0";
const PORT = process.env.PORT ? Number(process.env.PORT) : 4002;
const TOKEN = process.env.MCP_HTTP_TOKEN;
const DEFAULT_PROFILE =
  normalizeToolProfileName(process.env.MCP_DEFAULT_PROFILE) ?? "full";
const DEFAULT_ANONYMOUS_PROFILES = "public-research,gmail-research";

type TokenProfileConfig = {
  tokens: Set<string>;
  tokenProfiles: Map<string, ToolProfileName>;
};

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: any };
};

function respond(
  res: http.ServerResponse,
  status: number,
  payload: any,
  headers: Record<string, string> = {}
) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function getSuppliedToken(req: http.IncomingMessage): string | undefined {
  const headerToken = req.headers["x-mcp-token"] as string | undefined;
  if (headerToken) return headerToken;
  const auth = req.headers["authorization"];
  if (!auth) return undefined;
  const authValue = Array.isArray(auth) ? auth[0] : auth;
  if (!authValue) return undefined;
  if (!authValue.toLowerCase().startsWith("bearer ")) return undefined;
  return authValue.slice("bearer ".length);
}

function parseTokenProfiles(value: string | undefined): Map<string, ToolProfileName> {
  const tokenProfiles = new Map<string, ToolProfileName>();
  if (!value) return tokenProfiles;

  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const separator = trimmed.includes("=") ? "=" : ":";
    const [token, profile] = trimmed.split(separator).map((part) => part.trim());
    const normalizedProfile = normalizeToolProfileName(profile);
    if (!token || !normalizedProfile) continue;
    tokenProfiles.set(token, normalizedProfile);
  }

  return tokenProfiles;
}

function parseProfileList(value: string | undefined): Set<ToolProfileName> {
  const profiles = new Set<ToolProfileName>();
  for (const entry of (value || "").split(",")) {
    const normalized = normalizeToolProfileName(entry);
    if (normalized) profiles.add(normalized);
  }
  return profiles;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function inferClientName(req: http.IncomingMessage): string | undefined {
  return (
    firstHeader(req.headers["x-nodebench-client"]) ??
    firstHeader(req.headers["x-mcp-client"]) ??
    firstHeader(req.headers["user-agent"])?.slice(0, 120)
  );
}

function inferClientVersion(req: http.IncomingMessage): string | undefined {
  return firstHeader(req.headers["x-nodebench-client-version"])?.slice(0, 80);
}

function buildAccountKey(input: {
  req: http.IncomingMessage;
  profileName: ToolProfileName;
  authMode: "token" | "anonymous" | "open";
  suppliedToken?: string;
  forwardedFor?: string;
  remoteIp?: string;
}): string {
  if (input.authMode === "token" && input.suppliedToken) {
    return `token:${shortHash(input.suppliedToken)}`;
  }

  if (input.authMode === "anonymous") {
    const publicRequesterBasis = [
      input.profileName,
      input.forwardedFor?.split(",")[0]?.trim() ?? "",
      input.remoteIp ?? "",
      firstHeader(input.req.headers["origin"]) ?? "",
      firstHeader(input.req.headers["user-agent"]) ?? "",
    ].join("|");
    return `anon:${input.profileName}:${shortHash(publicRequesterBasis)}`;
  }

  return `open:${input.profileName}`;
}

function nodebenchMeta(ctx: {
  requestId: string;
  profileName: ToolProfileName;
  authMode: "token" | "anonymous" | "open";
  accountKey: string;
}) {
  return {
    nodebench: {
      requestId: ctx.requestId,
      profile: ctx.profileName,
      authMode: ctx.authMode,
      accountKey: ctx.accountKey,
      accounting: {
        ledger: "mcpToolCallLedger",
        costModel: "mcp-cost-v1-2026-05",
        costType: "estimated",
      },
    },
  };
}

function nodebenchHeaders(ctx?: {
  requestId?: string;
  profileName?: string;
  authMode?: string;
  accountKey?: string;
}): Record<string, string> {
  if (!ctx) return {};
  const headers: Record<string, string> = {};
  if (ctx.requestId) headers["x-nodebench-request-id"] = ctx.requestId;
  if (ctx.profileName) headers["x-nodebench-profile"] = ctx.profileName;
  if (ctx.authMode) headers["x-nodebench-auth-mode"] = ctx.authMode;
  if (ctx.accountKey) headers["x-nodebench-account-key"] = ctx.accountKey;
  return headers;
}

const tokenConfig: TokenProfileConfig = (() => {
  const tokenProfiles = parseTokenProfiles(process.env.MCP_PROFILE_TOKENS);
  const tokens = new Set<string>();
  if (TOKEN) tokens.add(TOKEN);
  for (const token of tokenProfiles.keys()) tokens.add(token);
  return { tokens, tokenProfiles };
})();
const anonymousProfiles = parseProfileList(
  process.env.MCP_ANONYMOUS_PROFILES ??
    process.env.MCP_PUBLIC_PROFILES ??
    DEFAULT_ANONYMOUS_PROFILES
);

function getRequestedProfile(req: http.IncomingMessage): ToolProfileName | undefined {
  const headerProfile =
    (req.headers["x-nodebench-profile"] as string | undefined) ??
    (req.headers["x-mcp-profile"] as string | undefined);
  const normalizedHeader = normalizeToolProfileName(headerProfile);
  if (normalizedHeader) return normalizedHeader;

  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    return normalizeToolProfileName(url.searchParams.get("profile") ?? undefined);
  } catch {
    return undefined;
  }
}

function getProfileTools(profileName: ToolProfileName) {
  const visibleDomainTools = filterToolsForProfile(domainTools, profileName);
  return [...visibleDomainTools, ...createMetaTools(visibleDomainTools)];
}

function getAuthAndProfile(req: http.IncomingMessage): {
  authorized: boolean;
  profileName: ToolProfileName;
  authMode: "token" | "anonymous" | "open";
} {
  const suppliedToken = getSuppliedToken(req);
  const requestedProfile = getRequestedProfile(req);

  if (tokenConfig.tokens.size > 0) {
    if (!suppliedToken && requestedProfile && anonymousProfiles.has(requestedProfile)) {
      return { authorized: true, profileName: requestedProfile, authMode: "anonymous" };
    }

    if (!suppliedToken || !tokenConfig.tokens.has(suppliedToken)) {
      return { authorized: false, profileName: DEFAULT_PROFILE, authMode: "token" };
    }

    const scopedProfile = tokenConfig.tokenProfiles.get(suppliedToken);
    if (scopedProfile) return { authorized: true, profileName: scopedProfile, authMode: "token" };
  }

  return {
    authorized: true,
    profileName: requestedProfile ?? DEFAULT_PROFILE,
    authMode: tokenConfig.tokens.size > 0 ? "token" : "open",
  };
}

const server = http.createServer(async (req, res) => {
  // Health check
  const pathname = (() => {
    try {
      return new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      return req.url;
    }
  })();
  if (req.method === "GET" && (pathname === "/" || pathname === "/health")) {
    respond(res, 200, {
      status: "ok",
      service: "nodebench-mcp-unified",
      tools: allTools.length,
      defaultProfile: DEFAULT_PROFILE,
      profiles: listToolProfiles().map((profile) => ({
        ...profile,
        tools: getProfileTools(profile.name).length,
        anonymous: anonymousProfiles.has(profile.name) && isPublicToolProfileName(profile.name),
      })),
      anonymousProfiles: [...anonymousProfiles],
      accounting: {
        anonymousProfilesAreMetered: true,
        accountKeyHeader: "x-nodebench-account-key",
        requestIdHeader: "x-nodebench-request-id",
        costModel: "mcp-cost-v1-2026-05",
      },
      categories: ["research", "narrative", "verification", "knowledge", "documents", "planning", "memory", "search", "financial"],
    });
    return;
  }

  if (req.method === "GET" && (pathname === "/.well-known/nodebench-mcp.json" || pathname === "/setup/gmail-research")) {
    const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
    const proto = req.headers["x-forwarded-proto"] || (HOST === "0.0.0.0" ? "https" : "http");
    const baseUrl = `${Array.isArray(proto) ? proto[0] : proto}://${Array.isArray(host) ? host[0] : host}`;
    respond(res, 200, {
      service: "nodebench-mcp-unified",
      protocol: "json-rpc-2.0-http",
      defaultProfile: DEFAULT_PROFILE,
      profiles: listToolProfiles().map((profile) => ({
        ...profile,
        url: `${baseUrl}?profile=${profile.name}`,
        tools: getProfileTools(profile.name).length,
        authRequired: !(anonymousProfiles.has(profile.name) && isPublicToolProfileName(profile.name)),
      })),
      recommended: {
        gmailResearch: {
          url: `${baseUrl}?profile=gmail-research`,
          profile: "gmail-research",
          authRequired: !(anonymousProfiles.has("gmail-research") && isPublicToolProfileName("gmail-research")),
          headers: anonymousProfiles.has("gmail-research") ? {} : { "x-mcp-token": "<token>" },
        },
      },
      accounting: {
        frictionlessPublicProfiles: [...anonymousProfiles].filter(isPublicToolProfileName),
        responseHeaders: [
          "x-nodebench-request-id",
          "x-nodebench-profile",
          "x-nodebench-auth-mode",
          "x-nodebench-account-key",
        ],
        responseMetaPath: "result._meta.nodebench",
        costModel: "mcp-cost-v1-2026-05",
      },
    });
    return;
  }

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Accept, Authorization, x-mcp-token, x-mcp-profile, x-nodebench-profile, x-nodebench-client, x-nodebench-client-version, x-request-id",
    });
    res.end();
    return;
  }

  if (req.method !== "POST") {
    respond(res, 405, { error: "Method not allowed" });
    return;
  }

  let body = "";
  req.on("data", (chunk: Buffer) => (body += chunk));

  req.on("end", async () => {
    try {
      const parsed: JsonRpcRequest = JSON.parse(body || "{}");
      const { id = null, method, params } = parsed;

      if (parsed.jsonrpc !== "2.0" || typeof method !== "string") {
        respond(res, 400, {
          jsonrpc: "2.0",
          id,
          error: { code: -32600, message: "Invalid Request" },
        });
        return;
      }

      const authAndProfile = getAuthAndProfile(req);
      if (!authAndProfile.authorized) {
        respond(res, 401, {
          jsonrpc: "2.0",
          id,
          error: { code: -32001, message: "Unauthorized" },
        });
        return;
      }
      const profileName = authAndProfile.profileName;
      const profileTools = getProfileTools(profileName);
      const suppliedToken = getSuppliedToken(req);
      const forwardedFor = firstHeader(req.headers["x-forwarded-for"]);
      const remoteIp = (req.socket as any)?.remoteAddress as string | undefined;
      const requestId = firstHeader(req.headers["x-request-id"]) ?? randomUUID();
      const accountKey = buildAccountKey({
        req,
        profileName,
        authMode: authAndProfile.authMode,
        suppliedToken,
        forwardedFor,
        remoteIp,
      });
      const responseHeaders = nodebenchHeaders({
        requestId,
        profileName,
        authMode: authAndProfile.authMode,
        accountKey,
      });
      const meta = nodebenchMeta({
        requestId,
        profileName,
        authMode: authAndProfile.authMode,
        accountKey,
      });

      // MCP initialize
      if (method === "initialize") {
        respond(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {}, resources: {} },
            serverInfo: {
              name: "nodebench-mcp-unified",
              version: "1.0.0",
              profile: profileName,
              authMode: authAndProfile.authMode,
            },
            _meta: meta,
          },
        }, responseHeaders);
        return;
      }

      // MCP tools/list
      if (method === "tools/list") {
        respond(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            tools: profileTools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
            profile: profileName,
            authMode: authAndProfile.authMode,
            accountKey,
            accounting: meta.nodebench.accounting,
            profiles: listToolProfiles(),
            _meta: meta,
          },
        }, responseHeaders);
        return;
      }

      // MCP tools/call
      if (method === "tools/call") {
        const toolName = params?.name;
        const args = params?.arguments ?? {};
        const tool = profileTools.find((t) => t.name === toolName);
        if (!tool) {
          respond(res, 200, {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: `Tool not found in profile "${profileName}": ${toolName}`,
            },
          }, responseHeaders);
          return;
        }

        const receivedAtIso = new Date().toISOString();

        try {
          const result = await runWithRequestContext(
            {
              requestId,
              jsonrpcId: id,
              method,
              toolName,
              profileName,
              authMode: authAndProfile.authMode,
              accountKey,
              clientName: inferClientName(req),
              clientVersion: inferClientVersion(req),
              origin: firstHeader(req.headers["origin"]),
              externalUserAgent: firstHeader(req.headers["user-agent"]),
              tokenAuthEnabled: tokenConfig.tokens.size > 0,
              tokenPresent: Boolean(suppliedToken),
              remoteIp,
              forwardedFor,
              receivedAtIso,
            },
            async () => {
              const isDirect = Boolean(toolName && directToolNames.has(toolName));
              const ctx = getRequestContext();

              let ledgerCallId: string | undefined;
              if (isDirect) {
                // Centralised policy + ledger for direct tools (financial): call Convex via dispatcher.
                // Best-effort: if Convex env vars aren't set, don't fail the tool call.
                try {
                  const start: any = await callGateway("__mcpToolCallStart", {
                    toolName: toolName,
                    toolType: "direct",
                    riskTier: "external_read",
                    args,
                    requestMeta: {
                      ...ctx,
                      source: "gateway_server",
                      transport: "http",
                    },
                  });
                  ledgerCallId = start?.callId;
                  if (start?.allowed === false) {
                    const blockedByDenylist = Boolean(start?.policy?.denylist?.blockedByDenylist);
                    const wouldExceed = Boolean(start?.policy?.budgets?.wouldExceed);
                    if (blockedByDenylist) throw new Error(`Tool blocked by policy: ${toolName}`);
                    if (wouldExceed) throw new Error(`Tool budget exceeded: ${toolName}`);
                    throw new Error(`Tool blocked by policy: ${toolName}`);
                  }
                } catch (e: any) {
                  const msg = e?.message ?? String(e);
                  // If policy explicitly blocked, fail closed for the direct tool call.
                  if (typeof msg === "string" && msg.startsWith("Tool ")) throw e;
                  // Otherwise (e.g. missing CONVEX_URL / MCP_SECRET), proceed best-effort.
                }
              }

              const t0 = Date.now();
              try {
                const out = await tool.handler(args);
                const durationMs = Math.max(0, Date.now() - t0);

                if (ledgerCallId) {
                  try {
                    await callGateway("__mcpToolCallFinish", {
                      callId: ledgerCallId,
                      success: true,
                      durationMs,
                      result: out,
                    });
                  } catch {
                    // best-effort
                  }
                }

                return out;
              } catch (err: any) {
                const durationMs = Math.max(0, Date.now() - t0);

                if (ledgerCallId) {
                  try {
                    await callGateway("__mcpToolCallFinish", {
                      callId: ledgerCallId,
                      success: false,
                      durationMs,
                      errorMessage: err?.message ?? String(err),
                    });
                  } catch {
                    // best-effort
                  }
                }

                throw err;
              }
            }
          );

          respond(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              isError: false,
              _meta: meta,
            },
          }, responseHeaders);
        } catch (err: any) {
          // Tool execution errors are returned as results with isError, NOT as JSON-RPC errors.
          // JSON-RPC errors are reserved for protocol-level failures.
          respond(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: err?.message || "Internal error" }],
              isError: true,
              _meta: meta,
            },
          }, responseHeaders);
        }
        return;
      }

      respond(res, 200, {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      }, responseHeaders);
    } catch {
      respond(res, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.error(
    `nodebench-mcp-unified listening on http://${HOST}:${PORT} (${allTools.length} tools)`
  );
});
