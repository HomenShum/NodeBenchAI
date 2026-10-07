#!/usr/bin/env node
/**
 * Capture gate for the Convex setup door.
 *
 * The defect this exists to keep dead: `apps/web/src/main.tsx` used to gate the
 * whole application on the *presence* of `VITE_CONVEX_URL`, never its validity.
 * `.env.example` ships `VITE_CONVEX_URL=https://your-project.convex.cloud` and
 * the README says `cp .env.example .env.local`, so the documented first-run
 * path produced a non-empty string, skipped the designed
 * `MissingConvexUrlScreen`, mounted the product against a host Convex refuses
 * to route, and left the surface rendered with a dead socket and an uncaught
 * `[CONVEX FATAL ERROR] Couldn't parse deployment name your-project`.
 *
 * Both env states must now land on the same designed card, silently.
 *
 * Run: node scripts/capture-convex-setup-gate.mjs [--port 4301]
 * Output: promotion/evidence/convex-setup-gate/*.png + report.json
 * Exits nonzero when any case does not show the card, logs a console error,
 * or overflows horizontally.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "promotion", "evidence", "convex-setup-gate");

const portArgIndex = process.argv.indexOf("--port");
const PORT = Number(portArgIndex > -1 ? process.argv[portArgIndex + 1] : 4301);
const ROUTE = "/redesign/chat";
const CARD_HEADING = "Convex backend not configured";
const WIDTHS = [
  { label: "desktop", width: 1280, height: 900 },
  { label: "mobile", width: 375, height: 812 },
];

/**
 * The placeholder is read out of `.env.example` rather than hardcoded, so this
 * gate follows the file the README tells a stranger to copy. If someone fixes
 * the example, this case starts proving the new value instead.
 */
async function readExamplePlaceholder() {
  const text = await fs.readFile(path.join(repoRoot, ".env.example"), "utf8");
  const line = text.split(/\r?\n/).find((l) => l.trim().startsWith("VITE_CONVEX_URL="));
  return line ? line.slice(line.indexOf("=") + 1).trim() : "";
}

function startVite(convexUrl) {
  const child = spawn(
    process.execPath,
    [path.join(repoRoot, "node_modules", "vite", "bin", "vite.js"), "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
    {
      cwd: repoRoot,
      // Explicit, so a developer's own .env.local cannot decide the outcome:
      // Vite lets prefixed process env override the .env files it loads.
      env: { ...process.env, VITE_CONVEX_URL: convexUrl },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer(url, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`dev server never answered ${url} within ${timeoutMs}ms`);
}

async function probe(browser, url, viewport) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 300)));

  // A cold Vite dev server transforms this module graph on first request, and a
  // dep re-optimization mid-navigation forces a reload, so the default 30s
  // navigation budget is not enough on the first page of a fresh clone.
  page.setDefaultNavigationTimeout(180_000);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
  // Long enough for the Convex socket to open and, on the pre-fix tree, fail.
  await page.waitForTimeout(9000);

  const observed = await page.evaluate(() => {
    const surface = document.querySelector("[data-agent-runtime-surface]");
    return {
      h1: document.querySelector("h1")?.textContent ?? null,
      runtimeSurface: surface ? surface.getAttribute("data-agent-runtime-surface") : null,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  observed.consoleErrors = consoleErrors;
  observed.pageErrors = pageErrors;
  return { page, observed };
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const placeholder = await readExamplePlaceholder();
  if (!placeholder) throw new Error(".env.example no longer defines VITE_CONVEX_URL");

  const cases = [
    { id: "unset", label: "no VITE_CONVEX_URL (clean clone)", convexUrl: "" },
    { id: "env-example-placeholder", label: `README path: cp .env.example .env.local (${placeholder})`, convexUrl: placeholder },
  ];

  const results = [];
  const failures = [];
  const browser = await chromium.launch();

  try {
    for (const testCase of cases) {
      const server = startVite(testCase.convexUrl);
      try {
        await waitForServer(`http://127.0.0.1:${PORT}${ROUTE}`);
        for (const viewport of WIDTHS) {
          const { page, observed } = await probe(browser, `http://127.0.0.1:${PORT}${ROUTE}`, viewport);
          const shot = path.join(outDir, `${testCase.id}-${viewport.label}.png`);
          await page.screenshot({ path: shot });
          await page.close();

          const problems = [];
          if (observed.h1 !== CARD_HEADING) {
            problems.push(`expected h1 "${CARD_HEADING}", got ${JSON.stringify(observed.h1)}`);
          }
          if (observed.runtimeSurface) {
            problems.push(`product surface "${observed.runtimeSurface}" mounted against an unusable backend`);
          }
          if (observed.consoleErrors.length || observed.pageErrors.length) {
            problems.push(`console/page errors: ${JSON.stringify([...observed.consoleErrors, ...observed.pageErrors])}`);
          }
          if (observed.scrollWidth > observed.clientWidth) {
            problems.push(`horizontal overflow: scrollWidth ${observed.scrollWidth} > clientWidth ${observed.clientWidth}`);
          }

          results.push({
            case: testCase.id,
            label: testCase.label,
            viewport: `${viewport.width}x${viewport.height}`,
            screenshot: path.relative(repoRoot, shot).replace(/\\/g, "/"),
            observed,
            problems,
          });
          if (problems.length) failures.push(`${testCase.id} @ ${viewport.width}: ${problems.join("; ")}`);
          console.log(
            `${problems.length ? "FAIL" : "ok  "}  ${testCase.id} @ ${viewport.width}x${viewport.height}  h1=${JSON.stringify(observed.h1)}  surface=${JSON.stringify(observed.runtimeSurface)}  consoleErrors=${observed.consoleErrors.length + observed.pageErrors.length}`,
          );
        }
      } finally {
        server.kill();
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  } finally {
    await browser.close();
  }

  const report = {
    capturedAt: new Date().toISOString(),
    route: ROUTE,
    port: PORT,
    envExamplePlaceholder: placeholder,
    expectation:
      "Both an absent VITE_CONVEX_URL and the .env.example placeholder must reach the designed setup card with zero console errors and no horizontal overflow.",
    results,
    verdict: failures.length ? "FAIL" : "PASS",
    failures,
  };
  await fs.writeFile(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (failures.length) {
    console.error(`\nFAIL: ${failures.length} case(s)\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log("\nPASS: both env states reach the designed setup card, zero console errors, no horizontal overflow at 1280 and 375.");
}

await main();
