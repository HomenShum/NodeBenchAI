/**
 * Export ONLY dailyBrief ntfy payloads (title/body) from `digestCache`.
 *
 * Writes:
 * - docs/architecture/benchmarks/dailybrief-ntfy-latest.json
 * - docs/architecture/benchmarks/dailybrief-ntfy-<out>.json (optional)
 *
 * Usage:
 *   set CONVEX_URL=...; set MCP_SECRET=...
 *   npx tsx scripts/export-dailybrief-ntfy-results.ts
 *   npx tsx scripts/export-dailybrief-ntfy-results.ts --date 2026-01-06 --sentOnly true --out dailybrief-ntfy-2026-01-06
 */

import dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

dotenv.config({ path: ".env.local" });
dotenv.config();

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  const v = String(value).trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return undefined;
}

function tryReadConvexEnvVar(name: string): string | null {
  const local = process.env[name];
  if (local && local.trim()) return local.trim();

  const cli = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "convex.cmd" : "convex");
  const res =
    process.platform === "win32"
      ? spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `& '${cli}' env get ${name}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        })
      : spawnSync(cli, ["env", "get", name], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
  if (res.status !== 0) return null;
  const value = String(res.stdout ?? "").trim();
  return value.length ? value : null;
}

async function main() {
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("Missing CONVEX_URL (or VITE_CONVEX_URL).");

  const secret = tryReadConvexEnvVar("MCP_SECRET");
  if (!secret) throw new Error("Missing MCP_SECRET.");

  const dateString = getArg("--date");
  const sentOnly = parseBool(getArg("--sentOnly")) ?? false;
  const outBase = (getArg("--out") || "").trim();

  const client = new ConvexHttpClient(convexUrl);
  const res = await client.action(api.domains.agents.digestAgent.exportDailyBriefNtfyPayloads, {
    secret,
    dateString: dateString || undefined,
    sentOnly,
  });

  const outDir = join(process.cwd(), "docs", "architecture", "benchmarks");
  mkdirSync(outDir, { recursive: true });

  const outputs: string[] = [];
  const latestPath = join(outDir, "dailybrief-ntfy-latest.json");
  writeFileSync(latestPath, JSON.stringify(res, null, 2) + "\n", "utf8");
  outputs.push(latestPath);

  if (outBase) {
    const safeBase = outBase.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const outPath = join(outDir, `${safeBase}.json`);
    writeFileSync(outPath, JSON.stringify(res, null, 2) + "\n", "utf8");
    outputs.push(outPath);
  }

  process.stdout.write(`Wrote:\n${outputs.map((p) => `- ${p}`).join("\n")}\n`);
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack || err.message || String(err)) : String(err);
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
});
