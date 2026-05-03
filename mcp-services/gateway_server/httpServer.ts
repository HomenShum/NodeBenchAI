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

function respond(res: http.ServerResponse, status: number, payload: any) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
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

const tokenConfig: TokenProfileConfig = (() => {
  const tokenProfiles = parseTokenProfiles(process.env.MCP_PROFILE_TOKENS);
  const tokens = new Set<string>();
  if (TOKEN) tokens.add(TOKEN);
  for (const token of tokenProfiles.keys()) tokens.add(token);
  return { tokens, tokenProfiles };
})();

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
} {
  const suppliedToken = getSuppliedToken(req);

  if (tokenConfig.tokens.size > 0) {
    if (!suppliedToken || !tokenConfig.tokens.has(suppliedToken)) {
      return { authorized: false, profileName: DEFAULT_PROFILE };
    }

    const scopedProfile = tokenConfig.tokenProfiles.get(suppliedToken);
    if (scopedProfile) return { authorized: true, profileName: scopedProfile };
  }

  return {
    authorized: true,
    profileName: getRequestedProfile(req) ?? DEFAULT_PROFILE,
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
      })),
      categories: ["research", "narrative", "verification", "knowledge", "documents", "planning", "memory", "search", "financial"],
    });
    return;
  }

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Accept, Authorization, x-mcp-token, x-mcp-profile, x-nodebench-profile",
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
            },
          },
        });
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
            profiles: listToolProfiles(),
          },
        });
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
          });
          return;
        }

        const suppliedToken = getSuppliedToken(req);
        const forwardedFor = (req.headers["x-forwarded-for"] as string | undefined) ?? undefined;
        const remoteIp = (req.socket as any)?.remoteAddress as string | undefined;
        const receivedAtIso = new Date().toISOString();

        try {
          const result = await runWithRequestContext(
            {
              jsonrpcId: id,
              method,
              toolName,
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
            },
          });
        } catch (err: any) {
          // Tool execution errors are returned as results with isError, NOT as JSON-RPC errors.
          // JSON-RPC errors are reserved for protocol-level failures.
          respond(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: err?.message || "Internal error" }],
              isError: true,
            },
          });
        }
        return;
      }

      respond(res, 200, {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
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
