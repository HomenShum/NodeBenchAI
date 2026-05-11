#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const envFile = path.resolve(process.cwd(), ".env.production.local");

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readEnvValue(filePath, key) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const name = trimmed.slice(0, idx).trim();
    if (name !== key) continue;
    return unquote(trimmed.slice(idx + 1));
  }
  return null;
}

const env = { ...process.env };
if (!env.CONVEX_DEPLOY_KEY) {
  const deployKey = readEnvValue(envFile, "CONVEX_DEPLOY_KEY");
  if (deployKey) {
    env.CONVEX_DEPLOY_KEY = deployKey;
    console.log("Loaded CONVEX_DEPLOY_KEY from .env.production.local");
  }
}

if (!env.CONVEX_DEPLOY_KEY) {
  console.error(
    "CONVEX_DEPLOY_KEY is not set. Run `vercel env pull .env.production.local --environment=production` or export a deploy key.",
  );
  process.exit(1);
}

const child = spawn("npx convex deploy -y --typecheck=enable", {
  env,
  shell: true,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`convex deploy terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
