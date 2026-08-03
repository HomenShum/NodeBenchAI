import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type QueuePayload = {
  content: string;
  postType: string;
  persona: "FOUNDER";
  target: "personal";
  source: "manual";
  priority: number;
  metadata: {
    campaignId: string;
    campaignPostId: string;
    rfsId: string | null;
    claimStatus: "planned";
    sourceUrl: string;
    sourceVerifiedAt: string;
    requiresHumanApproval: true;
  };
};

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const execute = args.includes("--execute");
const deploymentWorkspace = option(args, "--deployment-workspace");
const tsxCli = resolve(repoRoot, "node_modules/tsx/dist/cli.mjs");
const validatorScript = resolve(repoRoot, "scripts/nodekit-rfs/validate-blueprint-posts.mts");

if (!existsSync(tsxCli)) throw new Error(`tsx CLI not found at ${tsxCli}`);

const validation = spawnSync(process.execPath, [tsxCli, validatorScript], {
  cwd: repoRoot,
  encoding: "utf8",
  windowsHide: true,
});
if (validation.status !== 0) {
  process.stderr.write(validation.stderr || validation.stdout || "Blueprint validation failed.\n");
  process.exitCode = validation.status ?? 1;
} else {
  const bundle = JSON.parse(validation.stdout) as { payloads: QueuePayload[] };
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      dryRun: true,
      payloads: bundle.payloads.map((payload) => ({
        campaignPostId: payload.metadata.campaignPostId,
        target: payload.target,
        claimStatus: payload.metadata.claimStatus,
        characters: payload.content.length,
      })),
    }, null, 2)}\n`);
  } else {
    if (!deploymentWorkspace) throw new Error("--execute requires --deployment-workspace <configured NodeBench checkout>");
    const workspace = resolve(deploymentWorkspace);
    const convexCli = resolve(workspace, "node_modules/convex/bin/main.js");
    if (!existsSync(convexCli)) throw new Error(`Convex CLI not found at ${convexCli}`);

    const results: Array<Record<string, unknown>> = [];
    for (const payload of bundle.payloads) {
      const run = spawnSync(process.execPath, [
        convexCli,
        "run",
        "domains/social/linkedinContentQueue:enqueueContent",
        JSON.stringify(payload),
        "--typecheck",
        "disable",
        "--codegen",
        "disable",
      ], {
        cwd: workspace,
        encoding: "utf8",
        windowsHide: true,
      });
      if (run.status !== 0) {
        process.stderr.write(run.stderr || run.stdout || `Queue call failed for ${payload.metadata.campaignPostId}.\n`);
        process.exitCode = run.status ?? 1;
        break;
      }
      results.push({
        campaignPostId: payload.metadata.campaignPostId,
        response: JSON.parse(run.stdout),
      });
    }
    if (process.exitCode === undefined) {
      process.stdout.write(`${JSON.stringify({ queued: true, results }, null, 2)}\n`);
    }
  }
}
