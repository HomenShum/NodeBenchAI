#!/usr/bin/env npx tsx

/**
 * Runs higher-level E2E validations inside Convex (beyond MCP reachability):
 * - Daily briefing workflow + landing log append
 * - Fast Agent Panel local context injection proof
 * - Anonymous QA eval suite (ground truth queries)
 * - Persona live eval (optional)
 *
 * Usage:
 *   set CONVEX_URL=...; set MCP_SECRET=...
 *   npx tsx scripts/run-system-e2e.ts
 *
 * Flags:
 *   --skip-daily-brief
 *   --skip-local-context
 *   --skip-anon-eval
 *   --skip-persona
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function serializeError(err: unknown): { message: string; stack?: string; raw?: any } {
  if (err instanceof Error) {
    const message = (err.message ?? "").trim() || err.name || "Error";
    return { message, stack: err.stack };
  }
  try {
    const raw = typeof err === "string" ? err : JSON.stringify(err);
    const message = (raw ?? "").trim() || "Unknown error";
    return { message, raw: err };
  } catch {
    return { message: String(err) };
  }
}

async function main() {
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Missing CONVEX_URL (or VITE_CONVEX_URL).");
  }

  const client = new ConvexHttpClient(convexUrl);

  const out: any = {
    ok: true,
    timestamp: Date.now(),
    checks: {},
  };

  if (!hasFlag("--skip-daily-brief")) {
    try {
      const res = await client.action(api.domains.evaluation.systemE2E.validateDailyBriefing, {
        runWorkflow: true,
      });
      out.checks.dailyBrief = res;
      if (!res?.ok) out.ok = false;
    } catch (err) {
      out.ok = false;
      out.checks.dailyBrief = { ok: false, error: serializeError(err) };
    }
  }

  if (!hasFlag("--skip-local-context")) {
    try {
      const res = await client.action(api.domains.evaluation.systemE2E.validateFastAgentLocalContext, {
        timeoutMs: 120_000,
      });
      out.checks.fastAgentLocalContext = res;
      if (!res?.ok) out.ok = false;
    } catch (err) {
      out.ok = false;
      out.checks.fastAgentLocalContext = { ok: false, error: serializeError(err) };
    }
  }

  if (!hasFlag("--skip-anon-eval")) {
    try {
      const res = await client.action(api.domains.evaluation.systemE2E.runAnonymousEvalSuite, {});
      out.checks.anonymousEvalSuite = res;
      if (!res?.ok) out.ok = false;
    } catch (err) {
      out.ok = false;
      out.checks.anonymousEvalSuite = { ok: false, error: serializeError(err) };
    }
  }

  if (!hasFlag("--skip-persona")) {
    try {
      const res = await client.action(api.domains.evaluation.personaLiveEval.runPersonaLiveEval, {});
      out.checks.personaLiveEval = res;
      const scenarios = Array.isArray(res?.scenarios) ? res.scenarios : [];
      const failed = scenarios.filter((s: any) => s?.success !== true);
      if (failed.length > 0) out.ok = false;
    } catch (err) {
      out.ok = false;
      out.checks.personaLiveEval = { ok: false, error: serializeError(err) };
    }
  }

  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  process.exit(out.ok ? 0 : 2);
}

main().catch((err) => {
  const serialized = serializeError(err);
  process.stderr.write(`ERROR: ${serialized.message}\n`);
  if (serialized.stack) process.stderr.write(serialized.stack + "\n");
  process.exit(1);
});
