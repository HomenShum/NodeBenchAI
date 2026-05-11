#!/usr/bin/env node
/**
 * Loop a Convex backfill action by cursor until done.
 * Usage:  node scripts/loop-backfill.mjs <function-path> <table> [maxCalls]
 * Example:
 *   node scripts/loop-backfill.mjs domains/search/searchableTextBackfill:runBackfillForTable entities 50
 */
import { spawnSync } from "node:child_process";

const fn = process.argv[2];
const table = process.argv[3];
const maxCalls = Number(process.argv[4] ?? 2000);

if (!fn || !table) {
  console.error("Usage: node loop-backfill.mjs <function-path> <table> [maxCalls]");
  process.exit(2);
}

let cursor = null;
let totalWritten = 0;
let totalScanned = 0;
let totalSkipped = 0;
let totalEmbedded = 0;
let totalFailed = 0;
const startedAt = Date.now();

for (let i = 0; i < maxCalls; i += 1) {
  const payload = cursor === null ? { table } : { table, cursor };
  // Pass JSON via stdin to avoid shell quoting issues on Windows.
  const r = spawnSync(
    "npx.cmd",
    ["convex", "run", fn, "--"],
    {
      encoding: "utf8",
      env: process.env,
      shell: false,
      input: JSON.stringify(payload),
    },
  );
  // Fallback: try with positional arg if --- isn't supported.
  let stdout = r.stdout;
  let stderr = r.stderr;
  let status = r.status;
  if (status !== 0 || !stdout.match(/\{[\s\S]*\}/)) {
    const r2 = spawnSync(
      "npx.cmd",
      ["convex", "run", fn, JSON.stringify(payload)],
      { encoding: "utf8", env: process.env, shell: false },
    );
    stdout = r2.stdout;
    stderr = r2.stderr;
    status = r2.status;
  }
  if (status !== 0) {
    console.error(`call ${i + 1} exit ${status}`);
    console.error(stderr);
    break;
  }
  if (r.status !== 0) {
    console.error(`call ${i + 1} exit ${r.status}`);
    console.error(r.stderr);
    break;
  }
  // Result is printed on stdout as JSON
  const m = stdout.match(/\{[\s\S]*\}/);
  if (!m) {
    console.error(`call ${i + 1} no JSON in output:`, stdout.slice(-300));
    break;
  }
  let result;
  try {
    result = JSON.parse(m[0]);
  } catch {
    console.error(`call ${i + 1} bad JSON:`, m[0].slice(0, 200));
    break;
  }
  totalWritten += result.written ?? result.patched ?? 0;
  totalEmbedded += result.embedded ?? 0;
  totalScanned += result.scanned ?? 0;
  totalSkipped += result.skipped ?? 0;
  totalFailed += result.failed ?? 0;
  cursor = result.cursor;
  const isDone = result.done === true || result.isDone === true;
  process.stdout.write(
    `\rcall ${i + 1} scanned=${totalScanned} written=${totalWritten}${result.embedded !== undefined ? ` embedded=${totalEmbedded}` : ""}${result.failed !== undefined ? ` failed=${totalFailed}` : ""} done=${isDone} t=${((Date.now() - startedAt) / 1000).toFixed(1)}s   `,
  );
  if (isDone) {
    console.log("");
    console.log(JSON.stringify({ table, totalScanned, totalWritten, totalEmbedded, totalSkipped, totalFailed, calls: i + 1, durationS: (Date.now() - startedAt) / 1000 }));
    process.exit(0);
  }
}

console.log("");
console.log("HIT maxCalls — incomplete. cursor:", cursor);
console.log(JSON.stringify({ table, totalScanned, totalWritten, totalEmbedded, totalSkipped, totalFailed, calls: maxCalls, durationS: (Date.now() - startedAt) / 1000 }));
