#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry } from "./lib/fetchWithRetry.mjs";
import {
  buildVercelBypassHeaders,
  isVercelPreviewUrl,
} from "./lib/vercelProtection.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
  acc[rawKey] = rawValue ?? true;
  return acc;
}, {});

const url = String(args.url ?? process.env.PROD_URL ?? "https://www.nodebenchai.com").replace(/\/$/, "");
const skips = new Set(String(args.skip ?? "").split(",").filter(Boolean));
const jsonOut = Boolean(args.json);
const allowProtectedPreviewSkip =
  args["allow-protected-preview-skip"] === true ||
  String(args["allow-protected-preview-skip"] ?? process.env.ALLOW_PROTECTED_PREVIEW_SKIP ?? "") === "true";

function run(cmd, cmdArgs, env = {}) {
  const started = Date.now();
  const useWindowsCmd = process.platform === "win32" && ["npm", "npx"].includes(cmd);
  const executable = useWindowsCmd ? "cmd.exe" : cmd;
  const args = useWindowsCmd ? ["/d", "/s", "/c", [cmd, ...cmdArgs].join(" ")] : cmdArgs;
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    shell: false,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, ...env },
  });
  return {
    ok: result.status === 0,
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error instanceof Error ? result.error.message : ""),
    durationMs: Date.now() - started,
  };
}

/**
 * Vercel preview deployments are SSO-protected by default — direct fetches
 * return HTTP 401. Set VERCEL_AUTOMATION_BYPASS_SECRET in GitHub Actions
 * secrets and pass it through the `x-vercel-protection-bypass` header (or
 * `?_vercel_share=…` query param) so CI can verify preview URLs.
 *
 * https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
 */
const vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const isVercelPreview = isVercelPreviewUrl(url);

function buildHeaders(extra = {}) {
  return {
    "user-agent": "nodebench-post-deploy-verify/1.0",
    ...extra,
    ...buildVercelBypassHeaders(url, vercelBypassSecret),
  };
}

async function fetchHtml() {
  const { response, attempts } = await fetchWithRetry(url, {
    redirect: "follow",
    headers: buildHeaders(),
  });
  if (response.status === 401 && isVercelPreview && !vercelBypassSecret) {
    throw new Error(
      "HTTP 401 Unauthorized — Vercel preview is SSO-protected. " +
        "Set VERCEL_AUTOMATION_BYPASS_SECRET in repo secrets " +
        "(Vercel Project → Settings → Deployment Protection → Protection Bypass for Automation).",
    );
  }
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} after ${attempts} attempt${attempts === 1 ? "" : "s"}`,
    );
  }
  return response.text();
}

/**
 * Vercel preview deployments are SSO-protected by default. When this script
 * runs against a preview URL without a bypass secret configured, every check
 * will hit HTTP 401 — but that's a misconfiguration of the workflow, not a
 * regression of the deployed app. A known Preview event may explicitly opt in
 * to a recorded skip; every other invocation fails closed.
 *
 * Skipping must be explicitly authorized for a known Preview deployment. A
 * generated production *.vercel.app URL must never silently skip all checks.
 */
const shouldSkipPreviewWithoutBypass =
  isVercelPreview && !vercelBypassSecret && allowProtectedPreviewSkip;

function tail(text, lines = 18) {
  return text.split("\n").slice(-lines).join("\n").trim();
}

const steps = [
  {
    id: "html-shell",
    name: "HTML shell",
    async check() {
      const html = await fetchHtml();
      if (!/<html/i.test(html)) return { ok: false, detail: "response does not look like HTML" };
      if (!/id=["']root["']/i.test(html)) return { ok: false, detail: "SPA root mount point missing" };
      if (!/assets\/.+\.(js|css)/i.test(html)) return { ok: false, detail: "Vite asset references missing" };
      return { ok: true, detail: `html bytes=${html.length}` };
    },
  },
  {
    id: "verify-live",
    name: "Raw live verifier",
    async check() {
      const result = run("npx", ["tsx", "scripts/verify-live.ts", `--url=${url}`]);
      return result.ok
        ? { ok: true, detail: "verify-live passed" }
        : {
            ok: false,
            detail: `verify-live failed exit=${result.code}`,
            stderr: tail(result.stdout || result.stderr),
            fix: "Inspect scripts/verify-live.ts output and the deployed route.",
          };
    },
  },
  {
    id: "live-smoke",
    name: "Hydrated browser smoke",
    async check() {
      const result = run("npm", ["run", "live-smoke"], { BASE_URL: url });
      return result.ok
        ? { ok: true, detail: "live-smoke passed" }
        : {
            ok: false,
            detail: `live-smoke failed exit=${result.code}`,
            stderr: tail(result.stdout || result.stderr, 24),
            fix: "Run npm run live-smoke locally with BASE_URL set to the deployment URL.",
          };
    },
  },
];

const results = [];
let firstFailure = null;

if (shouldSkipPreviewWithoutBypass) {
  const skipDetail =
    "Vercel preview URL with no VERCEL_AUTOMATION_BYPASS_SECRET configured — " +
    "skipping verify (preview SSO returns 401, not a regression).";
  for (const step of steps) {
    results.push({
      id: step.id,
      name: step.name,
      ok: true,
      skipped: true,
      detail: skipDetail,
    });
  }
} else {
  for (const step of steps) {
    if (skips.has(step.id)) {
      results.push({ id: step.id, name: step.name, ok: true, skipped: true });
      continue;
    }
    const started = Date.now();
    let result;
    try {
      result = await step.check();
    } catch (error) {
      result = { ok: false, detail: error instanceof Error ? error.message : "step threw" };
    }
    const entry = { id: step.id, name: step.name, durationMs: Date.now() - started, ...result };
    results.push(entry);
    if (!entry.ok) {
      firstFailure = entry;
      break;
    }
  }
}

const failed = results.filter((result) => !result.ok).length;
const summary = {
  url,
  failed,
  firstFailure,
  explicitPreviewSkipAllowed: allowProtectedPreviewSkip,
  results,
};

if (jsonOut) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  for (const result of results) {
    const marker = result.ok ? "PASS" : "FAIL";
    console.log(`${marker} ${result.name}: ${result.detail ?? ""}`);
    if (result.stderr) console.log(result.stderr);
    if (result.fix && !result.ok) console.log(`Fix: ${result.fix}`);
  }
  console.log(failed === 0 ? "DEPLOY VERIFIED" : "DEPLOY NOT VERIFIED");
}

process.exit(failed === 0 ? 0 : 1);
