#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
  acc[rawKey] = rawValue ?? true;
  return acc;
}, {});

const target = String(args.target ?? "preview");
const skips = new Set(String(args.skip ?? "").split(",").filter(Boolean));
const jsonOut = Boolean(args.json);

function run(cmd, cmdArgs, options = {}) {
  const started = Date.now();
  const useWindowsCmd = process.platform === "win32" && ["npm", "npx"].includes(cmd);
  const executable = useWindowsCmd ? "cmd.exe" : cmd;
  const args = useWindowsCmd ? ["/d", "/s", "/c", [cmd, ...cmdArgs].join(" ")] : cmdArgs;
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    shell: false,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, ...(options.env ?? {}) },
  });
  return {
    ok: result.status === 0,
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error instanceof Error ? result.error.message : ""),
    durationMs: Date.now() - started,
  };
}

function tail(text, lines = 18) {
  return text.split("\n").slice(-lines).join("\n").trim();
}

function changedTextFiles() {
  const staged = run("git", ["diff", "--cached", "--name-only"]).stdout.split("\n");
  const modified = run("git", ["diff", "--name-only", "HEAD"]).stdout.split("\n");
  return Array.from(new Set([...staged, ...modified].filter(Boolean)));
}

const gates = [
  {
    id: "env",
    name: "Environment",
    check() {
      if (target === "production" && !process.env.CONVEX_DEPLOY_KEY) {
        return {
          ok: false,
          detail: "CONVEX_DEPLOY_KEY is required for production deploys.",
          fix: "Set CONVEX_DEPLOY_KEY in the shell or Vercel Production environment.",
        };
      }
      return { ok: true, detail: `target=${target}` };
    },
  },
  {
    id: "tsc-app",
    name: "TypeScript app",
    check() {
      const result = run("npx", ["tsc", "--noEmit", "--pretty", "false"]);
      return result.ok
        ? { ok: true, detail: "app typecheck passed" }
        : {
            ok: false,
            detail: "app typecheck failed",
            stderr: tail(result.stdout || result.stderr),
            fix: "Run npx tsc --noEmit --pretty false.",
          };
    },
  },
  {
    id: "tsc-convex",
    name: "TypeScript Convex",
    check() {
      const result = run("npx", ["tsc", "-p", "backend/convex", "--noEmit", "--pretty", "false"]);
      return result.ok
        ? { ok: true, detail: "convex typecheck passed" }
        : {
            ok: false,
            detail: "convex typecheck failed",
            stderr: tail(result.stdout || result.stderr),
            fix: "Run npx tsc -p backend/convex --noEmit --pretty false.",
          };
    },
  },
  {
    id: "search-api",
    name: "Search API bundle",
    check() {
      const result = run("npm", ["run", "build:search-api-bundle"]);
      return result.ok
        ? { ok: true, detail: "search API bundle built" }
        : {
            ok: false,
            detail: "search API bundle failed",
            stderr: tail(result.stdout || result.stderr),
            fix: "Check workers/node/vercel/searchApp.ts imports.",
          };
    },
  },
  {
    id: "secrets",
    name: "Secret scan",
    check() {
      const patterns = [
        ["OpenAI key", /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
        ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{30,}/],
        ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
        ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
        ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
      ];
      const ignored = [/package-lock\.json$/, /\/_generated\//, /\.test\.[tj]sx?$/, /\.spec\.[tj]sx?$/];
      const findings = [];

      for (const file of changedTextFiles()) {
        if (ignored.some((pattern) => pattern.test(file))) continue;
        const fullPath = join(ROOT, file);
        if (!existsSync(fullPath)) continue;
        let content = "";
        try {
          content = readFileSync(fullPath, "utf8");
        } catch {
          continue;
        }
        if (content.length > 2_000_000) continue;
        for (const [label, pattern] of patterns) {
          if (pattern.test(content)) findings.push(`${label} in ${file}`);
        }
      }

      return findings.length
        ? {
            ok: false,
            detail: `${findings.length} potential secret matches`,
            stderr: findings.join("\n"),
            fix: "Move secrets to environment variables and rotate real keys.",
          }
        : { ok: true, detail: "no changed-file secret patterns matched" };
    },
  },
  {
    id: "build",
    name: "Production build",
    check() {
      const result = run("npm", ["run", "build"]);
      return result.ok
        ? { ok: true, detail: "build passed" }
        : {
            ok: false,
            detail: "build failed",
            stderr: tail(result.stdout || result.stderr, 24),
            fix: "Run npm run build and fix the first error.",
          };
    },
  },
  {
    id: "size",
    name: "Bundle size",
    check() {
      const budgetPath = join(ROOT, "bundle-budget.json");
      const assetsPath = join(ROOT, "dist", "assets");
      if (!existsSync(budgetPath) || !existsSync(assetsPath)) {
        return { ok: true, detail: "budget or dist/assets missing; skipped" };
      }

      const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
      const files = readdirSync(assetsPath).filter((file) => /\.(js|css)$/.test(file));
      let total = 0;
      const over = [];

      for (const file of files) {
        const bytes = statSync(join(assetsPath, file)).size;
        total += bytes;
        const override = Object.entries(budget.perChunkOverrides ?? {}).find(([needle]) => file.includes(needle));
        const limit = override ? override[1] : budget.perChunkMaxBytes;
        if (bytes > limit) over.push(`${file}: ${bytes} > ${limit}`);
      }
      if (total > budget.totalDistMaxBytes) over.unshift(`total: ${total} > ${budget.totalDistMaxBytes}`);

      return over.length
        ? {
            ok: false,
            detail: `${over.length} bundle budget violations`,
            stderr: over.join("\n"),
            fix: "Trim imports or intentionally adjust bundle-budget.json.",
          }
        : { ok: true, detail: `total=${total} files=${files.length}` };
    },
  },
];

const results = [];
let firstFailure = null;

for (const gate of gates) {
  if (skips.has(gate.id)) {
    results.push({ id: gate.id, name: gate.name, ok: true, skipped: true });
    continue;
  }
  const started = Date.now();
  let result;
  try {
    result = gate.check();
  } catch (error) {
    result = { ok: false, detail: error instanceof Error ? error.message : "gate threw" };
  }
  const entry = { id: gate.id, name: gate.name, durationMs: Date.now() - started, ...result };
  results.push(entry);
  if (!entry.ok) {
    firstFailure = entry;
    break;
  }
}

const failed = results.filter((result) => !result.ok).length;
const summary = { target, failed, firstFailure, results };

if (jsonOut) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  for (const result of results) {
    const marker = result.ok ? "PASS" : "FAIL";
    console.log(`${marker} ${result.name}: ${result.detail ?? ""}`);
    if (result.stderr) console.log(result.stderr);
    if (result.fix && !result.ok) console.log(`Fix: ${result.fix}`);
  }
  console.log(failed === 0 ? "PREFLIGHT PASS" : "PREFLIGHT FAIL");
}

process.exit(failed === 0 ? 0 : 1);
