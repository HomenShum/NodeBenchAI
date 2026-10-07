#!/usr/bin/env npx tsx

/**
 * Live External API smoke checks (runs inside Convex using Convex env keys).
 *
 * Usage:
 *   set CONVEX_URL=...; set MCP_SECRET=...
 *   npx tsx scripts/run-live-api-smoke.ts
 *
 * Optional:
 *   npx tsx scripts/run-live-api-smoke.ts --include-linkup --linkup-query "DISCO Pharmaceuticals seed funding"
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Missing CONVEX_URL (or VITE_CONVEX_URL).");
  }

  const secret = process.env.MCP_SECRET;
  if (!secret) {
    throw new Error("Missing MCP_SECRET in local environment (used only to authorize the smoke run).");
  }

  const includeLinkup = process.argv.includes("--include-linkup");
  const linkupQuery = getArg("--linkup-query");
  const includeSwarm = process.argv.includes("--include-swarm");
  const swarmModel = getArg("--swarm-model");
  const noPublicApiChecks = process.argv.includes("--no-public-api-checks");
  const requireMcpChecks = process.argv.includes("--require-mcp");
  const tryLocalhostDefaults = process.argv.includes("--try-localhost-mcp");

  const client = new ConvexHttpClient(convexUrl);
  const res = await client.action(api.domains.evaluation.liveApiSmoke.run, {
    secret,
    includePublicApiChecks: noPublicApiChecks ? false : undefined,
    requireMcpChecks: requireMcpChecks || undefined,
    tryLocalhostDefaults: tryLocalhostDefaults || undefined,
    includeLinkup: includeLinkup || undefined,
    linkupQuery: linkupQuery || undefined,
    includeSwarm: includeSwarm || undefined,
    swarmModel: swarmModel || undefined,
  });

  // Never print secrets; only print the structured status.
  const json = JSON.stringify(res, null, 2);
  process.stdout.write(json + "\n");

  process.exit(res?.ok ? 0 : 2);
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
