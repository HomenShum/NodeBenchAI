import { spawn } from "node:child_process";

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const [key, value] = raw.split("=", 2);
    if (value !== undefined) args.set(key.slice(2), value);
    else args.set(key.slice(2), argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true");
  }
  return args;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function runShell(command, { cwd = process.cwd(), timeoutMs = 300_000 } = {}) {
  const child = spawn(command, {
    cwd,
    env: { ...process.env },
    stdio: "inherit",
    shell: true,
    windowsHide: true,
  });

  return await Promise.race([
    new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(Number(code ?? 0)));
    }),
    new Promise((_, reject) => {
      setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        reject(new Error(`Timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

async function runSegment(segment) {
  console.log(`\n=== ${segment.label} ===`);
  const startedAt = Date.now();

  try {
    const exitCode = await runShell(segment.command, { timeoutMs: segment.timeoutMs });
    return {
      ...segment,
      durationMs: Date.now() - startedAt,
      exitCode,
      status: exitCode === 0 ? "passed" : "failed",
    };
  } catch (error) {
    return {
      ...segment,
      durationMs: Date.now() - startedAt,
      exitCode: 1,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const only = String(args.get("only") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const selected = only.length > 0 ? new Set(only) : null;
  const includeOverstory = String(args.get("include-overstory") ?? "false") === "true";
  const parallel = Math.max(1, Number(args.get("parallel") ?? process.env.NODEBENCH_TEST_SEGMENT_PARALLEL ?? 1));

  const segments = [
    {
      id: "app",
      label: "app-vitest",
      command: "npm run test:run:app",
      timeoutMs: 300_000,
      required: true,
    },
    {
      id: "server",
      label: "server-vitest",
      command: "npm run test:run:server",
      timeoutMs: 300_000,
      required: true,
    },
    {
      id: "shared",
      label: "shared-vitest",
      command: "npm run test:run:shared",
      timeoutMs: 300_000,
      required: true,
    },
    {
      id: "mcp-local",
      label: "mcp-local-vitest",
      command: "node scripts/testing/runVitestSegment.mjs --cwd packages/mcp-local --target src --mode filter",
      timeoutMs: 300_000,
      required: true,
    },
    {
      id: "convex-mcp",
      label: "convex-mcp-vitest",
      command: "npm run test:run:convex-mcp",
      timeoutMs: 300_000,
      required: true,
    },
    {
      id: "openclaw-mcp",
      label: "openclaw-mcp-vitest",
      command: "npm run test:run:openclaw-mcp",
      timeoutMs: 300_000,
      required: true,
    },
    {
      id: "overstory",
      label: "overstory-engine",
      command: "npm run test:run:overstory",
      timeoutMs: 300_000,
      required: false,
    },
  ].filter((segment) => {
    if (segment.id === "overstory" && !includeOverstory && !selected?.has("overstory")) {
      return false;
    }
    return selected ? selected.has(segment.id) : true;
  });

  const results = new Array(segments.length);
  let nextIndex = 0;
  const workerCount = Math.min(parallel, segments.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < segments.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await runSegment(segments[currentIndex]);
      }
    }),
  );

  console.log("\nSegmented test summary:");
  for (const result of results) {
    const suffix = result.error ? ` (${result.error})` : "";
    console.log(`- ${result.label}: ${result.status} in ${formatDuration(result.durationMs)}${suffix}`);
  }

  const failures = results.filter((result) => result.required && result.status === "failed");
  if (failures.length > 0) {
    process.exit(1);
  }
}

await main();
