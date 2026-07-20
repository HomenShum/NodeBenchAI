import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DESIGN_TOKEN_SOURCE,
  ROUTING_SOURCE_RELATIVE_PATHS,
  WEB_SOURCE_RELATIVE_PATH,
  buildNodeWorkerDevCommand,
  discoverRouteSeedsFromSource,
  resolveDesignContextBaseFiles,
  resolveRepairContextBaseFiles,
  resolveWebSourceRoot,
} from "../lib/standardTreePaths.mjs";
import { runAllDetectors } from "../lib/behavioralDetectors.ts";
import { scanForDesignViolations } from "../ui/designLinter.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");

function runRepoNode(relativeScript, args = []) {
  const env = { ...process.env };
  delete env.FIGMA_ACCESS_TOKEN;
  delete env.FIGMA_DESIGN_SYSTEM_FILE;

  return spawnSync(process.execPath, [relativeScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    timeout: 30_000,
  });
}

describe("standard-tree design and dogfood migration scenarios", () => {
  /**
   * Scenario: Design maintainer validates tokens from a clean migrated checkout.
   * User:      A maintainer running the Figma bootstrap before publishing a library update.
   * Goal:      Extract the real web tokens and preserve their provenance in both reports.
   * Prior state: The deleted repository-level src/ directory is absent.
   * Actions:   Run bootstrap and validation back-to-back without Figma credentials.
   * Scale:     The complete light/dark token set, not a fixture subset.
   * Duration:  One release-preflight burst.
   * Expected:  Both commands succeed and identify apps/web/src/index.css as their source.
   * Edge cases: No token or file key may trigger a network request or hide the code-only result.
   */
  it("keeps Figma extraction and validation grounded in the migrated CSS source", () => {
    expect(existsSync(path.join(repoRoot, "src"))).toBe(false);
    expect(existsSync(path.join(repoRoot, ...DESIGN_TOKEN_SOURCE.split("/")))).toBe(true);

    const bootstrap = runRepoNode("scripts/design/bootstrapFigmaDesignSystem.mjs", ["--json"]);
    expect(bootstrap.status, bootstrap.stderr).toBe(0);
    expect(bootstrap.stdout).toContain(`Extracted from ${DESIGN_TOKEN_SOURCE}`);
    expect(bootstrap.stdout).toContain(`"source": "${DESIGN_TOKEN_SOURCE}"`);
    expect(bootstrap.stdout).toMatch(/"totalUnique":\s*[1-9]\d*/);

    const validation = runRepoNode("scripts/design/validateFigmaSync.mjs", ["--json"]);
    expect(validation.status, validation.stderr).toBe(0);
    const report = JSON.parse(validation.stdout);
    expect(report).toMatchObject({ status: "code-only", source: DESIGN_TOKEN_SOURCE });
    expect(report.codeTokens.total).toBeGreaterThan(50);
  });

  /**
   * Scenario: QA operator runs deterministic analysis across the full web app.
   * User:      A release operator who relies on Layer 0 before paying for Gemini review.
   * Goal:      Prove the scan covered real application files and cannot report a zero-file pass.
   * Prior state: The standard-tree app contains more than one thousand source files.
   * Actions:   Scan the real tree, then repeat against empty and missing source trees.
   * Scale:     Full repository source plus degraded zero-file probes.
   * Duration:  One sustained full-tree scan and two short failure bursts.
   * Expected:  Coverage metadata is nonzero; degraded scans reject instead of scoring 100.
   * Edge cases: A directory can exist yet still contain no eligible source files.
   */
  it("reports nonzero Layer 0 coverage and fails closed on empty or missing trees", async () => {
    const sourceRoot = resolveWebSourceRoot(repoRoot);
    const result = await scanForDesignViolations(sourceRoot);
    expect(result.source).toBe(WEB_SOURCE_RELATIVE_PATH);
    expect(result.filesScanned).toBeGreaterThan(1_000);

    const emptyRoot = await mkdtemp(path.join(tmpdir(), "nodebench-empty-web-src-"));
    try {
      await expect(scanForDesignViolations(emptyRoot)).rejects.toThrow(/scanned zero source files/i);
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }

    await expect(scanForDesignViolations(emptyRoot)).rejects.toThrow(/source directory is unavailable/i);
  }, 90_000);

  /**
   * Scenario: Dogfood maintainer starts from a clean checkout and a sparse icon-only UI.
   * User:      A maintainer whose DOM crawl needs source-derived route seeds and repair context.
   * Goal:      Start the migrated worker, discover app routes, and feed only real web files to repair.
   * Prior state: No .env.local fallback and no root src/ or server/ directories.
   * Actions:   Resolve the worker command, routing seeds, and both repair-context sets.
   * Scale:     All canonical routing sources and both bug/design repair lanes.
   * Duration:  Repeated dogfood iterations reuse the same deterministic path contract.
   * Expected:  Sources and context exist under apps/web/src; no deleted path is referenced.
   * Edge cases: Route discovery remains useful when live navigation exposes fewer than five links.
   */
  it("resolves worker startup, route seeds, and repair context from the standard tree", async () => {
    expect(buildNodeWorkerDevCommand("npx.cmd")).toBe("npx.cmd tsx workers/node/index.ts");
    expect(existsSync(path.join(repoRoot, "workers", "node", "index.ts"))).toBe(true);

    const routeSeeds = await discoverRouteSeedsFromSource(repoRoot);
    expect(routeSeeds.sources).toEqual(ROUTING_SOURCE_RELATIVE_PATHS);
    expect(routeSeeds.paths.length).toBeGreaterThan(20);
    expect(routeSeeds.paths).toEqual(expect.arrayContaining(["/redesign", "/research", "/benchmarks"]));

    const contextFiles = [
      ...resolveRepairContextBaseFiles(repoRoot),
      ...resolveDesignContextBaseFiles(repoRoot),
    ];
    expect(contextFiles.every((file) => existsSync(file))).toBe(true);
    expect(contextFiles.some((file) => file.includes(`${path.sep}src${path.sep}components${path.sep}MainLayout.tsx`))).toBe(false);

    const geminiQa = readFileSync(path.join(repoRoot, "scripts", "ui", "runDogfoodGeminiQa.mjs"), "utf8");
    const walkthrough = readFileSync(path.join(repoRoot, "scripts", "ui", "runDogfoodWalkthroughLocal.mjs"), "utf8");
    expect(geminiQa).toContain("resolveWebSourceRoot(process.cwd())");
    expect(geminiQa).toContain("discoverRouteSeedsFromSource(process.cwd())");
    expect(geminiQa).not.toContain('path.join(process.cwd(), "src")');
    expect(walkthrough).toContain("buildNodeWorkerDevCommand(npxCmd)");
    expect(walkthrough).not.toContain("tsx server/index.ts");

    const detectorFindings = runAllDetectors({
      surface: "research",
      overallScore: 0,
      dimensionScores: {
        dominantJob: 0,
        visibleReasoning: 0,
        speedBehavior: 0,
        qualityDiscipline: 0,
        contextCompounding: 0,
        chromeCollapse: 0,
      },
      topIssues: ["Multiple competing bordered boxes create clutter and inconsistent spacing"],
      interactionBudgets: {
        firstInputVisible: false,
        estimatedTimeToFirstAction: "slow",
        estimatedTimeToFirstValue: "slow",
        layoutStability: "major-shifts",
      },
    });
    expect(detectorFindings.length).toBeGreaterThan(5);
    expect(
      detectorFindings.flatMap((finding) => finding.fileTargets).every(
        (fileTarget) => fileTarget.startsWith(`${WEB_SOURCE_RELATIVE_PATH}/`),
      ),
    ).toBe(true);
  });
});
