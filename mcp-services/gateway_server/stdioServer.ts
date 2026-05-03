#!/usr/bin/env node
/**
 * NodeBench AI MCP Server — stdio transport
 *
 * Spawned as a local process by MCP clients (Cursor, Claude Desktop, etc.).
 * Reads JSON-RPC from stdin, writes to stdout. No HTTP server involved.
 *
 * Requires env vars:
 *   CONVEX_URL   – Convex HTTP actions URL (https://xxx.convex.site)
 *   MCP_SECRET   – Shared secret for Convex-side dispatcher auth
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
  normalizeToolProfileName,
} from "./tools/toolProfiles.js";
import { callGateway } from "./convexClient.js";

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
const profileName =
  normalizeToolProfileName(process.env.MCP_PROFILE) ??
  normalizeToolProfileName(process.env.MCP_DEFAULT_PROFILE) ??
  "full";
const profileDomainTools = filterToolsForProfile(domainTools, profileName);
const allTools = [...profileDomainTools, ...createMetaTools(profileDomainTools)];
const directToolNames = new Set(financialTools.map((t) => t.name));

const server = new McpServer({
  name: "nodebench-mcp-unified",
  version: "1.0.0",
});

// Register every tool from the shared tool arrays.
// McpServer.tool() with a raw JSON schema object (no zod) works since SDK ^1.0.4.
for (const tool of allTools) {
  server.tool(
    tool.name,
    tool.description,
    tool.inputSchema as any,
    async (args: any) => {
      const isDirect = directToolNames.has(tool.name);

      let ledgerCallId: string | undefined;
      if (isDirect) {
        // Centralised policy + ledger for direct tools (financial): call Convex via dispatcher.
        // Best-effort: if Convex env vars aren't set, don't fail the tool call.
        try {
          const start: any = await callGateway("__mcpToolCallStart", {
            toolName: tool.name,
            toolType: "direct",
            riskTier: "external_read",
            args,
            requestMeta: {
              source: "gateway_server",
              transport: "stdio",
              receivedAtIso: new Date().toISOString(),
            },
          });
          ledgerCallId = start?.callId;
          if (start?.allowed === false) {
            const blockedByDenylist = Boolean(start?.policy?.denylist?.blockedByDenylist);
            const wouldExceed = Boolean(start?.policy?.budgets?.wouldExceed);
            if (blockedByDenylist) throw new Error(`Tool blocked by policy: ${tool.name}`);
            if (wouldExceed) throw new Error(`Tool budget exceeded: ${tool.name}`);
            throw new Error(`Tool blocked by policy: ${tool.name}`);
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
        const result = await tool.handler(args);
        const durationMs = Math.max(0, Date.now() - t0);

        if (ledgerCallId) {
          try {
            await callGateway("__mcpToolCallFinish", {
              callId: ledgerCallId,
              success: true,
              durationMs,
              result: result,
            });
          } catch {
            // best-effort
          }
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          isError: false,
        };
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

        return {
          content: [{ type: "text" as const, text: err?.message || "Internal error" }],
          isError: true,
        };
      }
    }
  );
}

// Connect via stdio (stdin/stdout)
const transport = new StdioServerTransport();
await server.connect(transport);

// Log to stderr (stdout is reserved for MCP protocol)
console.error(
  `nodebench-mcp-unified stdio server ready (${allTools.length} tools, profile=${profileName})`
);
