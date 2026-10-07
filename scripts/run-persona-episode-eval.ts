#!/usr/bin/env npx tsx

/**
 * Persona Episode Eval (raw live agent + tool telemetry)
 *
 * Produces:
 * - docs/architecture/benchmarks/persona-episode-eval-latest.md
 * - docs/architecture/benchmarks/persona-episode-eval-latest.json
 *
 * Usage:
 *   set CONVEX_URL=...; set MCP_SECRET=...
 *   npx tsx scripts/run-persona-episode-eval.ts --model kimi-k2.6 --suite pack --limit 5
 *   npx tsx scripts/run-persona-episode-eval.ts --suite pack --out persona-episode-eval-pack-2026-01-05T000000Z
 */

import dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";
import {
  findOpenAiModelPricing,
  loadOrFetchOpenAiApiPricingSnapshot,
  readOpenAiApiPricingSnapshotFromFile,
} from "./pricing/openaiApiPricing";
import {
  findAnthropicModelPricing,
  loadOrFetchAnthropicApiPricingSnapshot,
  readAnthropicApiPricingSnapshotFromFile,
} from "./pricing/anthropicApiPricing";
import {
  findGoogleGeminiModelPricing,
  loadOrFetchGoogleGeminiApiPricingSnapshot,
  readGoogleGeminiApiPricingSnapshotFromFile,
} from "./pricing/googleGeminiApiPricing";
import { APPROVED_MODELS, MODEL_UI_INFO, type Provider } from "../apps/web/src/shared/llm/approvedModels";
import { modelPricing as sharedModelPricing } from "../shared/llm/modelCatalog";

dotenv.config({ path: ".env.local" });
dotenv.config();

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function getFirstPositionalArg(): string | undefined {
  const xs = process.argv.slice(2);
  for (let i = 0; i < xs.length; i++) {
    const cur = xs[i];
    if (cur.startsWith("-")) {
      // Skip a single value for flags (common pattern: --flag value)
      i += 1;
      continue;
    }
    return cur;
  }
  return undefined;
}

function getGitSha(): string | null {
  const git = process.platform === "win32" ? "git.exe" : "git";
  const res = spawnSync(git, ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (res.status !== 0) return null;
  const sha = String(res.stdout ?? "").trim();
  return sha.length ? sha : null;
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

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function parsePricingMode(value: string | undefined): "off" | "cache" | "latest" {
  const v = String(value ?? "").toLowerCase().trim();
  if (v === "off" || v === "none" || v === "false") return "off";
  if (v === "latest" || v === "live" || v === "force") return "latest";
  return "cache";
}

function inferProviderFromModel(model: string): Provider | null {
  const normalized = String(model ?? "").trim().toLowerCase();
  if ((APPROVED_MODELS as readonly string[]).includes(normalized)) {
    return MODEL_UI_INFO[normalized as (typeof APPROVED_MODELS)[number]].provider;
  }
  if (normalized.startsWith("gpt-") || normalized.startsWith("o")) return "openai";
  if (normalized.startsWith("claude-")) return "anthropic";
  if (normalized.startsWith("gemini-")) return "google";
  return null;
}

async function main() {
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("Missing CONVEX_URL (or VITE_CONVEX_URL).");

  const secret = tryReadConvexEnvVar("MCP_SECRET");
  if (!secret) throw new Error("Missing MCP_SECRET.");

  const model = getArg("--model") || getFirstPositionalArg() || "kimi-k2.6";
  const suiteRaw = (getArg("--suite") || "core").toLowerCase();
  const packPathArg = getArg("--pack-path");
  const suite =
    suiteRaw === "full"
      ? "full"
      : suiteRaw === "next"
        ? "next"
        : suiteRaw === "stress"
          ? "stress"
          : suiteRaw === "pack"
            ? "pack"
            : "core";
  const limit =
    parsePositiveInt(getArg("--limit")) ?? (suite === "stress" ? 2 : suite === "next" ? 5 : suite === "full" ? 3 : 3);
  const offsetStart = parsePositiveInt(getArg("--offset")) ?? 0;
  const pricingMode = parsePricingMode(getArg("--pricing"));
  const gitSha = getGitSha();
  const provider = inferProviderFromModel(model);
  const outBase = (getArg("--out") || "").trim();

  const client = new ConvexHttpClient(convexUrl);
  const authToken = process.env.CONVEX_AUTH_TOKEN;
  if (authToken) client.setAuth(authToken);
  const startedAt = Date.now();
  const batchResults: any[] = [];
  let offset: number | null = offsetStart;
  const paginate = (suite === "full" || suite === "next" || suite === "pack") && getArg("--offset") == null;
  let maxBatches = paginate ? 50 : 1;
  while (offset !== null) {
    let r: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const actionArgs: any = {
          secret,
          model,
          suite,
          offset,
          limit,
        };
        
        // Pass packPath if specified
        if (suite === "pack" && packPathArg) {
          actionArgs.packPath = packPathArg;
        }
        
        r = await client.action(api.domains.evaluation.personaEpisodeEval.runPersonaEpisodeEval, actionArgs);
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
        const backoffMs = 500 * attempt;
        await new Promise((res) => setTimeout(res, backoffMs));
      }
    }
    batchResults.push(r);
    const batchSummary = r?.summary ?? {};
    const nextOffset = r?.window?.nextOffset ?? null;
    process.stdout.write(
      `[batch ${batchResults.length}] suite=${suite} offset=${offset ?? "?"} limit=${limit} total=${batchSummary.total ?? "?"} passed=${batchSummary.passed ?? "?"} failed=${batchSummary.failed ?? "?"} nextOffset=${nextOffset ?? "null"}\n`,
    );
    offset = r?.window?.nextOffset ?? null;

    if (!paginate) break;

    // Safety: cap to avoid accidental infinite loops, but scale to suite size.
    if (batchResults.length === 1) {
      const totalAvailable = Number(r?.window?.totalAvailable ?? 0);
      if (Number.isFinite(totalAvailable) && totalAvailable > 0) {
        maxBatches = Math.min(50, Math.ceil(totalAvailable / limit) + 2);
      }
    }
    if (batchResults.length >= maxBatches) break;
  }

  const runs = batchResults.flatMap((b) => (Array.isArray(b?.runs) ? b.runs : []));
  const passed = runs.filter((r: any) => r?.ok === true).length;
  const total = runs.length;

  let pricing: any = null;
  if (pricingMode !== "off") {
    try {
      if (provider === "openai") {
        const pricingPath = join(process.cwd(), "docs", "architecture", "benchmarks", "openai-api-pricing-latest.json");
        const { snapshot, source, path } = await loadOrFetchOpenAiApiPricingSnapshot({
          forceFetch: pricingMode === "latest",
        });
        const modelPricing = findOpenAiModelPricing(snapshot, model);
        pricing = {
          provider: snapshot.provider,
          sourceUrl: snapshot.sourceUrl,
          fetchedAt: snapshot.fetchedAt,
          cache: { source, path: path ?? pricingPath },
          model: modelPricing ?? null,
        };
      } else if (provider === "anthropic") {
        const pricingPath = join(process.cwd(), "docs", "architecture", "benchmarks", "anthropic-api-pricing-latest.json");
        const { snapshot, source, path } = await loadOrFetchAnthropicApiPricingSnapshot({
          forceFetch: pricingMode === "latest",
        });
        const modelPricing = findAnthropicModelPricing(snapshot, model);
        pricing = {
          provider: snapshot.provider,
          sourceUrl: snapshot.sourceUrl,
          fetchedAt: snapshot.fetchedAt,
          cache: { source, path: path ?? pricingPath },
          model: modelPricing ?? null,
        };
      } else if (provider === "google") {
        const pricingPath = join(process.cwd(), "docs", "architecture", "benchmarks", "google-gemini-api-pricing-latest.json");
        const { snapshot, source, path } = await loadOrFetchGoogleGeminiApiPricingSnapshot({
          forceFetch: pricingMode === "latest",
        });
        const modelPricing = findGoogleGeminiModelPricing(snapshot, model);
        pricing = {
          provider: snapshot.provider,
          sourceUrl: snapshot.sourceUrl,
          fetchedAt: snapshot.fetchedAt,
          cache: { source, path: path ?? pricingPath },
          model: modelPricing ?? null,
          notes: snapshot.notes,
        };
      } else if (provider === "openrouter") {
        const p = sharedModelPricing[model];
        pricing = p
          ? {
              provider: "openrouter",
              sourceUrl: "https://openrouter.ai/api/v1/models",
              fetchedAt: new Date().toISOString(),
              cache: { source: "repo", path: "shared/llm/modelCatalog.ts" },
              model: {
                model,
                inputUsdPer1MTokens: p.inputPer1M,
                outputUsdPer1MTokens: p.outputPer1M,
                cachedInputUsdPer1MTokens: p.cachedInputPer1M ?? null,
                contextWindow: p.contextWindow,
              },
              notes: "Pricing sourced from repo model catalog; verify with OpenRouter /models endpoint as needed.",
            }
          : { error: `Unknown OpenRouter model pricing for '${model}'` };
      } else {
        pricing = { error: `Unknown provider for model '${model}'` };
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const tryCached = () => {
        if (provider === "openai") {
          const pricingPath = join(process.cwd(), "docs", "architecture", "benchmarks", "openai-api-pricing-latest.json");
          const cached = readOpenAiApiPricingSnapshotFromFile(pricingPath);
          if (!cached) return null;
          return {
            provider: cached.provider,
            sourceUrl: cached.sourceUrl,
            fetchedAt: cached.fetchedAt,
            cache: { source: "cache", path: pricingPath },
            model: findOpenAiModelPricing(cached, model),
            warning: `live pricing fetch failed; using cached snapshot (${errMsg})`,
          };
        }
        if (provider === "anthropic") {
          const pricingPath = join(process.cwd(), "docs", "architecture", "benchmarks", "anthropic-api-pricing-latest.json");
          const cached = readAnthropicApiPricingSnapshotFromFile(pricingPath);
          if (!cached) return null;
          return {
            provider: cached.provider,
            sourceUrl: cached.sourceUrl,
            fetchedAt: cached.fetchedAt,
            cache: { source: "cache", path: pricingPath },
            model: findAnthropicModelPricing(cached, model),
            warning: `live pricing fetch failed; using cached snapshot (${errMsg})`,
          };
        }
        if (provider === "google") {
          const pricingPath = join(process.cwd(), "docs", "architecture", "benchmarks", "google-gemini-api-pricing-latest.json");
          const cached = readGoogleGeminiApiPricingSnapshotFromFile(pricingPath);
          if (!cached) return null;
          return {
            provider: cached.provider,
            sourceUrl: cached.sourceUrl,
            fetchedAt: cached.fetchedAt,
            cache: { source: "cache", path: pricingPath },
            model: findGoogleGeminiModelPricing(cached, model),
            notes: cached.notes,
            warning: `live pricing fetch failed; using cached snapshot (${errMsg})`,
          };
        }
        return null;
      };

      pricing = tryCached() ?? { error: errMsg };
    }
  }

  const estimatedInputTokensTotal = runs.reduce((sum: number, r: any) => sum + Number(r?.execution?.estimatedInputTokens ?? 0), 0);
  const estimatedOutputTokensTotal = runs.reduce((sum: number, r: any) => sum + Number(r?.execution?.estimatedOutputTokens ?? 0), 0);

  const providerInputTokensTotal = runs.reduce((sum: number, r: any) => sum + Number(r?.execution?.providerUsage?.promptTokens ?? 0), 0);
  const providerOutputTokensTotal = runs.reduce((sum: number, r: any) => sum + Number(r?.execution?.providerUsage?.completionTokens ?? 0), 0);
  const providerCachedInputTokensTotal = runs.reduce((sum: number, r: any) => sum + Number(r?.execution?.providerUsage?.cachedInputTokens ?? 0), 0);

  const usageForPricing = (() => {
    const totalProvider = providerInputTokensTotal + providerOutputTokensTotal;
    if (totalProvider > 0) {
      return {
        mode: "provider" as const,
        inputTokens: providerInputTokensTotal,
        outputTokens: providerOutputTokensTotal,
        cachedInputTokens: providerCachedInputTokensTotal,
      };
    }
    return {
      mode: "estimated" as const,
      inputTokens: estimatedInputTokensTotal,
      outputTokens: estimatedOutputTokensTotal,
      cachedInputTokens: 0,
    };
  })();

  const estimatedCostUsd = (() => {
    if (!pricing?.model) return null;
    if (pricing.provider === "openai") {
      if (typeof pricing.model.inputUsdPer1MTokens !== "number" || typeof pricing.model.outputUsdPer1MTokens !== "number") return null;

      const cached = Math.max(0, Number(usageForPricing.cachedInputTokens ?? 0) || 0);
      const totalIn = Math.max(0, Number(usageForPricing.inputTokens ?? 0) || 0);
      const uncachedIn = Math.max(0, totalIn - cached);

      const cachedRate =
        typeof pricing.model.cachedInputUsdPer1MTokens === "number"
          ? pricing.model.cachedInputUsdPer1MTokens
          : pricing.model.inputUsdPer1MTokens;

      return (cached / 1_000_000) * cachedRate +
        (uncachedIn / 1_000_000) * pricing.model.inputUsdPer1MTokens +
        (usageForPricing.outputTokens / 1_000_000) * pricing.model.outputUsdPer1MTokens;
    }
    if (pricing.provider === "anthropic") {
      if (typeof pricing.model.baseInputUsdPer1MTokens !== "number" || typeof pricing.model.outputUsdPer1MTokens !== "number") return null;
      return (usageForPricing.inputTokens / 1_000_000) * pricing.model.baseInputUsdPer1MTokens +
        (usageForPricing.outputTokens / 1_000_000) * pricing.model.outputUsdPer1MTokens;
    }
    if (pricing.provider === "google") {
      if (typeof pricing.model.inputUsdPer1MTokens !== "number" || typeof pricing.model.outputUsdPer1MTokens !== "number") return null;
      return (usageForPricing.inputTokens / 1_000_000) * pricing.model.inputUsdPer1MTokens +
        (usageForPricing.outputTokens / 1_000_000) * pricing.model.outputUsdPer1MTokens;
    }
    if (pricing.provider === "openrouter") {
      if (typeof pricing.model.inputUsdPer1MTokens !== "number" || typeof pricing.model.outputUsdPer1MTokens !== "number") return null;

      const cached = Math.max(0, Number(usageForPricing.cachedInputTokens ?? 0) || 0);
      const totalIn = Math.max(0, Number(usageForPricing.inputTokens ?? 0) || 0);
      const uncachedIn = Math.max(0, totalIn - cached);

      const cachedRate =
        typeof pricing.model.cachedInputUsdPer1MTokens === "number"
          ? pricing.model.cachedInputUsdPer1MTokens
          : pricing.model.inputUsdPer1MTokens;

      return (cached / 1_000_000) * cachedRate +
        (uncachedIn / 1_000_000) * pricing.model.inputUsdPer1MTokens +
        (usageForPricing.outputTokens / 1_000_000) * pricing.model.outputUsdPer1MTokens;
    }
    return null;
  })();

  const res = {
    ok: total > 0 && passed === total,
    elapsedMs: batchResults.reduce((sum, b) => sum + Number(b?.elapsedMs ?? 0), 0),
    summary: { total, passed, failed: total - passed },
    window: {
      suite,
      batches: batchResults.length,
      totalAvailable: Number(batchResults[0]?.window?.totalAvailable ?? total),
    },
    pricing,
    estimatedUsage: {
      mode: usageForPricing.mode,
      inputTokens: usageForPricing.inputTokens,
      outputTokens: usageForPricing.outputTokens,
      cachedInputTokens: usageForPricing.cachedInputTokens,
      estimatedCostUsd,
    },
    runs,
    rawBatches: batchResults,
  };

  const elapsedMs = Date.now() - startedAt;
  const out = {
    generatedAt: new Date().toISOString(),
    gitSha,
    convexUrl,
    model,
    elapsedMs,
    result: res,
  };

  const md: string[] = [];
  md.push(`# Persona Episode Eval (Raw Live Agent)`);
  md.push(``);
  md.push(`Generated: ${out.generatedAt}`);
  md.push(`Git SHA: ${gitSha ?? "(unknown)"}`);
  md.push(`Convex: ${convexUrl}`);
  md.push(`Model: ${model}`);
  md.push(`Elapsed: ${elapsedMs}ms`);
  md.push(``);

  const summary = res?.summary ?? {};
  md.push(`## Summary`);
  md.push(`- ok=${Boolean(res?.ok)} total=${summary.total ?? "?"} passed=${summary.passed ?? "?"} failed=${summary.failed ?? "?"}`);
  md.push(``);

  if (res?.pricing?.model && typeof res?.estimatedUsage?.estimatedCostUsd === "number") {
    const p = res.pricing.model;
    md.push(`## Pricing (API)`);
    if (res.pricing.provider === "openai") {
      md.push(`- provider=openai model=${p.model} input=$${p.inputUsdPer1MTokens}/1M cachedInput=$${p.cachedInputUsdPer1MTokens ?? "?"}/1M output=$${p.outputUsdPer1MTokens}/1M`);
    } else if (res.pricing.provider === "openrouter") {
      md.push(`- provider=openrouter model=${p.model} input=$${p.inputUsdPer1MTokens}/1M cachedInput=$${p.cachedInputUsdPer1MTokens ?? "?"}/1M output=$${p.outputUsdPer1MTokens}/1M`);
    } else if (res.pricing.provider === "anthropic") {
      md.push(`- provider=anthropic model=${p.model} baseInput=$${p.baseInputUsdPer1MTokens}/MTok output=$${p.outputUsdPer1MTokens}/MTok cacheHit=$${p.cacheHitUsdPer1MTokens ?? "?"}/MTok`);
    } else if (res.pricing.provider === "google") {
      md.push(`- provider=google model=${p.model} input=$${p.inputUsdPer1MTokens}/1M output=$${p.outputUsdPer1MTokens}/1M (over200k: in=$${p.inputUsdPer1MTokensOver200k ?? "?"} out=$${p.outputUsdPer1MTokensOver200k ?? "?"})`);
    } else {
      md.push(`- provider=${String(res.pricing.provider ?? "?")} model=${p.model}`);
    }
    const usageLabel = res.estimatedUsage.mode === "provider" ? "providerTokens" : "estTokens";
    const cacheSuffix = res.estimatedUsage.mode === "provider" ? ` cachedInputTokens=${res.estimatedUsage.cachedInputTokens ?? 0}` : "";
    md.push(`- ${usageLabel}: input=${res.estimatedUsage.inputTokens} output=${res.estimatedUsage.outputTokens}${cacheSuffix} estCostUsd=$${res.estimatedUsage.estimatedCostUsd.toFixed(4)}`);
    md.push(``);
  } else if (pricingMode !== "off") {
    md.push(`## Pricing (API)`);
    md.push(`- unavailable (pass --pricing latest to refresh; error=${String(res?.pricing?.error ?? "unknown")})`);
    md.push(``);
  }

  const totals = {
    steps: 0,
    toolCalls: 0,
    toolResults: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    providerInputTokens: 0,
    providerOutputTokens: 0,
    providerCachedInputTokens: 0,
  };

  const runRows = Array.isArray(res?.runs) ? res.runs : [];
  for (const r of runRows) {
    totals.steps += Number(r?.execution?.stepsCount ?? 0);
    totals.toolCalls += Array.isArray(r?.execution?.toolCalls) ? r.execution.toolCalls.length : 0;
    totals.toolResults += Array.isArray(r?.execution?.toolResults) ? r.execution.toolResults.length : 0;
    totals.estimatedInputTokens += Number(r?.execution?.estimatedInputTokens ?? 0);
    totals.estimatedOutputTokens += Number(r?.execution?.estimatedOutputTokens ?? 0);
    totals.providerInputTokens += Number(r?.execution?.providerUsage?.promptTokens ?? 0);
    totals.providerOutputTokens += Number(r?.execution?.providerUsage?.completionTokens ?? 0);
    totals.providerCachedInputTokens += Number(r?.execution?.providerUsage?.cachedInputTokens ?? 0);
  }

  md.push(`## Totals (Execution)`);
  md.push(
    `- steps=${totals.steps} toolCalls=${totals.toolCalls} toolResults=${totals.toolResults} estInputTokens=${totals.estimatedInputTokens} estOutputTokens=${totals.estimatedOutputTokens}`,
  );
  if ((totals.providerInputTokens + totals.providerOutputTokens) > 0) {
    md.push(`- providerTokens: input=${totals.providerInputTokens} output=${totals.providerOutputTokens} cachedInput=${totals.providerCachedInputTokens}`);
  }
  md.push(``);

  md.push(`## Runs`);
  md.push(`| Scenario | Persona | Entity | Status | Notes |`);
  md.push(`|---|---|---|---:|---|`);
  for (const r of runRows) {
    const status = r?.ok ? "PASS" : "FAIL";
    const notes = Array.isArray(r?.failureReasons) && r.failureReasons.length ? String(r.failureReasons[0]).slice(0, 140) : "";
    md.push(`| ${String(r?.name ?? r?.id ?? "")} | ${String(r?.expectedPersona ?? "")} | ${String(r?.expectedEntityId ?? "")} | ${status} | ${notes} |`);
  }
  md.push(``);

  const outDir = join(process.cwd(), "docs", "architecture", "benchmarks");
  mkdirSync(outDir, { recursive: true });

  const outputs: Array<{ mdPath: string; jsonPath: string }> = [
    {
      mdPath: join(outDir, "persona-episode-eval-latest.md"),
      jsonPath: join(outDir, "persona-episode-eval-latest.json"),
    },
  ];

  if (outBase) {
    const safeBase = outBase.replace(/[^a-zA-Z0-9._-]+/g, "_");
    outputs.push({
      mdPath: join(outDir, `${safeBase}.md`),
      jsonPath: join(outDir, `${safeBase}.json`),
    });
  }

  for (const o of outputs) {
    writeFileSync(o.mdPath, md.join("\n"), "utf8");
    writeFileSync(o.jsonPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  }

  process.stdout.write(`Wrote:\n${outputs.map((o) => `- ${o.mdPath}\n- ${o.jsonPath}`).join("\n")}\n`);
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack || err.message || String(err)) : String(err);
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
});
