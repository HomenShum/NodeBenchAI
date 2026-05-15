#!/usr/bin/env node
/**
 * Canonical production deploy wrapper for nodebenchai.com.
 *
 * Default path: cloud build via `vercel deploy --prod --yes`.
 * This uses Vercel's Linux builder, project env, and linked Convex
 * deploy key, avoiding Windows local-build bugs in @vercel/static-build.
 *
 * Optional local prebuilt path:
 *   NODEBENCH_PREBUILT_DEPLOY=1 npm run deploy:prod
 *
 * The Node wrapper avoids the Windows -> WSL `bash` path, where
 * `/usr/bin/node` can be too old for the current Vercel CLI ESM entrypoint.
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NPX_BIN = process.platform === "win32" ? "npx.cmd" : "npx";
const NODEBENCH_VERCEL_PROJECT_ID = process.env.NODEBENCH_VERCEL_PROJECT_ID ?? "prj_FnTvvOX3N55aofc0Zn6lKSHFNF0b";
const NODEBENCH_VERCEL_ORG_ID = process.env.NODEBENCH_VERCEL_ORG_ID ?? "team_RRpVnMU6vxwAeiOQPTMkKGcZ";
const NODEBENCH_VERCEL_PROJECT_NAME = process.env.NODEBENCH_VERCEL_PROJECT_NAME ?? "nodebench-ai";

function ensureNodeBenchVercelProject() {
  const vercelDir = join(process.cwd(), ".vercel");
  const projectPath = join(vercelDir, "project.json");
  let current = null;

  try {
    current = JSON.parse(readFileSync(projectPath, "utf8"));
  } catch {
    // Fresh worktrees often do not have a Vercel link yet.
  }

  if (
    current?.projectId === NODEBENCH_VERCEL_PROJECT_ID &&
    current?.orgId === NODEBENCH_VERCEL_ORG_ID &&
    current?.projectName === NODEBENCH_VERCEL_PROJECT_NAME
  ) {
    return;
  }

  mkdirSync(vercelDir, { recursive: true });
  writeFileSync(
    projectPath,
    `${JSON.stringify({
      projectId: NODEBENCH_VERCEL_PROJECT_ID,
      orgId: NODEBENCH_VERCEL_ORG_ID,
      projectName: NODEBENCH_VERCEL_PROJECT_NAME,
    }, null, 2)}\n`,
    "utf8",
  );
  console.log(`==> Linked worktree to Vercel project ${NODEBENCH_VERCEL_PROJECT_NAME}`);
}

function runVercel(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(NPX_BIN, ["vercel", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VERCEL_ORG_ID: NODEBENCH_VERCEL_ORG_ID,
        VERCEL_PROJECT_ID: NODEBENCH_VERCEL_PROJECT_ID,
      },
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`vercel ${args.join(" ")} failed with ${signal ?? code}`));
    });
  });
}

async function main() {
  ensureNodeBenchVercelProject();

  console.log("==> Pulling Vercel project settings and production env");
  await runVercel(["pull", "--yes", "--environment=production"]);

  if (process.env.NODEBENCH_PREBUILT_DEPLOY === "1") {
    console.log("==> Pulling root Vite env for local prebuilt deploy");
    await runVercel(["env", "pull", ".env.production.local", "--environment=production"]);

    console.log("==> Building with prod env (Vite inlines VITE_*)");
    await runVercel(["build", "--prod"]);

    console.log("==> Deploying prebuilt artifact to production");
    await runVercel(["deploy", "--prebuilt", "--prod"]);
  } else {
    console.log("==> Deploying with Vercel cloud build");
    await runVercel(["deploy", "--prod", "--yes"]);
  }

  console.log("==> Done. Run scripts/verify-live.ts to confirm the live HTML.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
