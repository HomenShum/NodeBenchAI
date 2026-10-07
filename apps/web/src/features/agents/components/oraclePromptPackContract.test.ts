import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(file: string) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

describe("Oracle prompt pack", () => {
  it("ships the required shared Oracle docs", () => {
    const files = ["ORACLE_VISION.md", "ORACLE_STATE.md", "ORACLE_LOOP.md"];
    for (const file of files) {
      expect(fs.existsSync(path.join(root, file)), `${file} should exist`).toBe(true);
      expect(read(file).length).toBeGreaterThan(50);
    }
  });

  it("keeps every bootstrap prompt anchored to the same shared docs", () => {
    const bootstrapFiles = [
      "oracle-bootstrap.codex.md",
      "oracle-bootstrap.cursor.md",
      "oracle-bootstrap.claude-code.md",
      "oracle-bootstrap.lovable.md",
    ];

    for (const file of bootstrapFiles) {
      const content = read(file);
      expect(content).toContain("ORACLE_VISION.md");
      expect(content).toContain("ORACLE_STATE.md");
      expect(content).toContain("ORACLE_LOOP.md");
      expect(content.toLowerCase()).toContain("small");
    }
  });

  it("documents the anti-one-shot closed loop explicitly", () => {
    // The root ORACLE_LOOP.md became a pointer stub during doc consolidation;
    // the operating loop's content lives in the canonical doc. Assert the stub
    // still points there, then assert content where it actually lives. (This
    // test was red on main for exactly this drift — and the pinned tsc command
    // carried an invalid single-dash `-noEmit` flag, now corrected in the doc.)
    expect(read("ORACLE_LOOP.md")).toContain("docs/architecture/oracle/LOOP.md");
    const loop = read("docs/architecture/oracle/LOOP.md");
    expect(loop).toContain("no one-shot");
    expect(loop).toContain("npx tsc -p convex --noEmit --pretty false");
    expect(loop).toContain("npm run dogfood:verify");
    expect(loop).toContain("Do not accept \"looks correct\" as evidence");
    expect(loop).toContain("self-review as sufficient validation");
    expect(loop).toContain("Performance-sensitive changes");
  });

  it("requires anti-sycophancy and measured-evidence rules in the shared docs", () => {
    const vision = read("ORACLE_VISION.md");
    const loop = read("ORACLE_LOOP.md");
    const codexBootstrap = read("oracle-bootstrap.codex.md");

    expect(vision).toContain("measured evidence");
    expect(vision).toContain("what could still be wrong");
    expect(vision).toContain("draft generator, not as an authority");
    expect(loop).toContain("critical invariants");
    expect(loop).toContain("external baseline");
    expect(codexBootstrap).toContain("measured evidence");
  });
});
