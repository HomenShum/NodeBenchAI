#!/usr/bin/env node
/**
 * Web-quality audit (PROMOTION condition 8) against the REAL rendered surface.
 *
 * It audits the production build served by `vite preview`, not the dev server:
 * a Vite dev server ships every module unbundled, so a Lighthouse performance
 * score taken there measures the dev pipeline, not the product. `dist/` is what
 * a user gets.
 *
 * The route audited is `/redesign/chat` — the one canonical surface. It is
 * audited SIGNED OUT, which is what a stranger meets: the shell, starters and
 * composer render; only the paid run behind them needs an account. Anything
 * behind auth cannot be audited by an unauthenticated tool anyway, and pointing
 * the audit at a screen no visitor reaches would be a prettier number about a
 * page nobody sees.
 *
 * PREREQUISITE: a Convex deployment (see docs/START_HERE.md "Before Step 1").
 * Without VITE_CONVEX_URL the build renders the setup card, and the audit would
 * be measuring the error state.
 *
 * Run:    node scripts/audit-web-quality.mjs [--port 4902] [--skip-build]
 * Output: promotion/evidence/web-quality/lighthouse.json
 *         promotion/evidence/web-quality/axe.json
 *         promotion/evidence/web-quality/summary.json  (the two, reduced)
 * Exit:   0 always for the tools themselves; the verdict is in summary.json and
 *         printed. Read it — a score is a measurement, not a pass.
 */
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "promotion", "evidence", "web-quality");
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : d;
};
const PORT = Number(arg("--port", 4902));
const ROUTE = "/redesign/chat";
const URL_UNDER_TEST = `http://127.0.0.1:${PORT}${ROUTE}`;

async function convexUrl() {
  if (process.env.VITE_CONVEX_URL) return process.env.VITE_CONVEX_URL.trim();
  const text = await fs.readFile(path.join(repoRoot, ".env.local"), "utf8").catch(() => "");
  const line = text.split(/\r?\n/).find((l) => l.trim().startsWith("VITE_CONVEX_URL="));
  if (!line) throw new Error("No VITE_CONVEX_URL — see docs/START_HERE.md 'Before Step 1'.");
  return line.slice(line.indexOf("=") + 1).trim();
}

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32", ...opts });

async function waitFor(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`preview server never answered ${url}`);
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const url = await convexUrl();

  if (!process.argv.includes("--skip-build")) {
    // vite directly, not `npm run build`: that script first shells out to
    // `npx esbuild` for a Vercel serverless bundle, which is not part of the
    // rendered page and fails on a shell without esbuild on PATH.
    const built = run(process.execPath, [path.join("node_modules", "vite", "bin", "vite.js"), "build"], {
      env: { ...process.env, VITE_CONVEX_URL: url },
    });
    if (built.status !== 0) throw new Error(`vite build failed with ${built.status}`);
  }

  const preview = spawn(
    process.execPath,
    [path.join(repoRoot, "node_modules", "vite", "bin", "vite.js"), "preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
    { cwd: repoRoot, env: { ...process.env, VITE_CONVEX_URL: url }, stdio: ["ignore", "pipe", "pipe"] },
  );
  preview.stdout.on("data", () => {});
  preview.stderr.on("data", () => {});

  const lighthousePath = path.join(outDir, "lighthouse.json");
  const axePath = path.join(outDir, "axe.json");
  try {
    await waitFor(URL_UNDER_TEST);
    run("npx", [
      "--yes", "lighthouse@13.4.1", URL_UNDER_TEST,
      "--output=json", `--output-path=${lighthousePath}`,
      "--chrome-flags=--headless --no-sandbox",
      "--only-categories=performance,accessibility,best-practices,seo",
    ]);
    // @axe-core/cli resolves --save against its own cwd, so an absolute path
    // gets concatenated onto it. Run it from the output directory instead.
    run("npx", ["--yes", "@axe-core/cli@4.13.0", URL_UNDER_TEST, "--save", "axe.json"], { cwd: outDir });
  } finally {
    preview.kill();
  }

  const lh = JSON.parse(await fs.readFile(lighthousePath, "utf8"));
  const axeRaw = JSON.parse(await fs.readFile(axePath, "utf8"));
  const axeRun = Array.isArray(axeRaw) ? axeRaw[0] : axeRaw;
  const violations = axeRun?.violations ?? [];
  const seriousOrCritical = violations.filter((v) => v.impact === "serious" || v.impact === "critical");

  const summary = {
    capturedAt: new Date().toISOString(),
    url: URL_UNDER_TEST,
    route: ROUTE,
    servedFrom: "vite preview (production build)",
    authState: "signed out",
    lighthouse: {
      version: lh.lighthouseVersion,
      categories: Object.fromEntries(
        Object.entries(lh.categories ?? {}).map(([k, v]) => [k, Math.round((v.score ?? 0) * 100)]),
      ),
      metrics: {
        lcpMs: lh.audits?.["largest-contentful-paint"]?.numericValue ?? null,
        cls: lh.audits?.["cumulative-layout-shift"]?.numericValue ?? null,
        tbtMs: lh.audits?.["total-blocking-time"]?.numericValue ?? null,
        fcpMs: lh.audits?.["first-contentful-paint"]?.numericValue ?? null,
      },
    },
    axe: {
      violationCount: violations.length,
      seriousOrCriticalCount: seriousOrCritical.length,
      violations: violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes?.length ?? 0,
        firstTarget: v.nodes?.[0]?.target?.join(" ") ?? null,
      })),
    },
  };
  await fs.writeFile(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

await main();
