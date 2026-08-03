import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildNodekitRfsProofloopPlan,
  validateNodekitRfsBenchmarkReceipt,
  validateNodekitRfsRunnerContract,
  type NodekitRfsStageName,
} from "../../packages/mcp-local/src/contracts/nodekitRfsBenchmark.js";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), "utf8").replace(/^\uFEFF/, ""));
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function printIssues(issues: Array<{ path: string; code: string; message: string }>): void {
  for (const entry of issues) {
    process.stderr.write(`${entry.code} ${entry.path}: ${entry.message}\n`);
  }
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "validate-receipt") {
    const file = option(args, "--file");
    if (!file) throw new Error("validate-receipt requires --file <receipt.json>");
    const mode = option(args, "--mode");
    if (mode !== undefined && mode !== "checkpoint" && mode !== "seal") {
      throw new Error("--mode must be checkpoint or seal");
    }
    const checkpoint = option(args, "--checkpoint") as NodekitRfsStageName | undefined;
    const result = validateNodekitRfsBenchmarkReceipt(readJson(file), {
      mode: mode as "checkpoint" | "seal" | undefined,
      checkpoint,
    });
    if (!result.ok) {
      printIssues(result.issues);
      process.exitCode = 1;
    } else {
      process.stdout.write(`valid ${result.value.schemaVersion} ${result.value.runId} status=${result.value.status}\n`);
    }
  } else if (command === "validate-runner-contract") {
    const file = option(args, "--file");
    if (!file) throw new Error("validate-runner-contract requires --file <contract.json>");
    const result = validateNodekitRfsRunnerContract(readJson(file));
    if (!result.ok) {
      printIssues(result.issues);
      process.exitCode = 1;
    } else {
      process.stdout.write(`valid ${result.value.schemaVersion} ${result.value.runId}\n`);
    }
  } else if (command === "build-runner-plan") {
    const file = option(args, "--contract");
    const out = option(args, "--out");
    if (!file || !out) throw new Error("build-runner-plan requires --contract <contract.json> --out <plan.json>");
    const plan = buildNodekitRfsProofloopPlan(readJson(file));
    const outputPath = resolve(out);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    process.stdout.write(`wrote ${outputPath} tasks=${plan.tasks.length}\n`);
  } else {
    throw new Error("expected validate-receipt, validate-runner-contract, or build-runner-plan");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
