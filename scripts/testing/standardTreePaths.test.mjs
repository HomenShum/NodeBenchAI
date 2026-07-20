// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildVitestCommand } from "./runVitestSegment.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");

describe("Scenario: a release operator runs the segmented suite after the standard-tree migration", () => {
  it("routes the required app segment to the web application's real source tree", () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

    expect(packageJson.scripts["test:run"]).toBe("node scripts/testing/runSegmentedVitest.mjs");
    expect(packageJson.scripts["test:run:app"]).toBe(
      "node scripts/testing/runVitestSegment.mjs --cwd . --target apps/web/src --mode dir",
    );
  });

  it("keeps worktree isolation without excluding a requested tests directory", () => {
    const appCommand = buildVitestCommand({ target: "apps/web/src", mode: "dir" });
    const repositoryTestsCommand = buildVitestCommand({ target: "tests", mode: "filter" });

    expect(appCommand).toContain('vitest run --dir "apps/web/src"');
    expect(appCommand).toContain('--exclude ".worktrees/**"');
    expect(repositoryTestsCommand).toContain('vitest run "tests"');
    expect(repositoryTestsCommand).not.toContain('--exclude "tests/**"');
  });
});
