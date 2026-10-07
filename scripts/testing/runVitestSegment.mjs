import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

export function buildVitestCommand({ target = "src", mode = "dir" } = {}) {
  const excludeArgs = ` --exclude ".claude/worktrees/**" --exclude ".worktrees/**"`;
  return mode === "filter"
    ? `npx vitest run "${target}"${excludeArgs}`
    : `npx vitest run --dir "${target}"${excludeArgs}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const relativeCwd = String(args.get("cwd") ?? ".");
  const target = String(args.get("target") ?? "src");
  const mode = String(args.get("mode") ?? "dir");
  const cwd = path.resolve(process.cwd(), relativeCwd);
  const command = buildVitestCommand({ target, mode });

  const child = spawn(command, {
    cwd,
    env: { ...process.env },
    stdio: "inherit",
    shell: true,
    windowsHide: true,
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(Number(code ?? 0)));
  });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
