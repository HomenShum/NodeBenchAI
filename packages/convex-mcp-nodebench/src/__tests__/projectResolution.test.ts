import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { schemaTools } from "../tools/schemaTools.js";
import { architectTools } from "../tools/architectTools.js";
import { devSetupTools } from "../tools/devSetupTools.js";

const audit = schemaTools.find(tool => tool.name === "convex_audit_schema")!;
const scan = architectTools.find(tool => tool.name === "convex_scan_capabilities")!;
const setup = devSetupTools.find(tool => tool.name === "convex_audit_dev_setup")!;
function project() { return mkdtempSync(join(homedir(), "project-")); }
function backend(root: string, relative: string, tables = 2) {
  const dir = join(root, relative);
  mkdirSync(join(dir, "_generated"), { recursive: true });
  writeFileSync(join(dir, "schema.ts"), `import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({ ${Array.from({ length: tables }, (_, i) => `table${i}: defineTable({ title: v.string() })`).join(",")} });`);
  writeFileSync(join(dir, "queries.ts"), 'export const list = query({ args: {}, returns: v.array(v.string()), handler: async (ctx) => [] });');
  return dir;
}
function configure(root: string, value: unknown) {
  writeFileSync(join(root, "convex.json"), JSON.stringify(value));
}
async function expectSource(root: string, source: string, tables = 2) {
  const result = await audit.handler({ projectDir: root });
  expect(result).not.toHaveProperty("error");
  expect(result).toMatchObject({ summary: { schemaFile: join(source, "schema.ts"), tables } });
  const capabilities = await scan.handler({ projectDir: root });
  expect(capabilities).not.toHaveProperty("error");
  expect(capabilities).toMatchObject({ mode: "directory", convexDir: source, totalFiles: 2 });
}
async function expectUnavailable(root: string) {
  for (const tool of [audit, scan]) {
    const result = await tool.handler({ projectDir: root });
    expect(result).toMatchObject({ error: expect.stringMatching(/directory|config/i) });
    expect(result).not.toHaveProperty("summary");
  }
}

describe("backend resolution for developers and coding agents", () => {
  it.each(["convex", "src/convex", "backend/convex"])("audits a developer's conventional %s layout without a config override", async relative => {
    const root = project(); const source = backend(root, relative);
    await expectSource(root, source);
  });

  it("uses the configured backend even when a stale conventional tree would produce a different audit", async () => {
    const root = project();
    backend(root, "convex", 4); backend(root, "src/convex", 5); backend(root, "backend/convex", 6);
    const source = backend(root, "services/source code", 3);
    configure(root, { functions: "services/source code/" });
    await expectSource(root, source, 3);
    expect(await setup.handler({ projectDir: root })).toMatchObject({ checks: expect.arrayContaining([
      expect.objectContaining({ area: "convex_json", status: "pass" }),
      expect.objectContaining({ area: "initialization", status: "pass" }),
    ]) });
  });

  it("preserves conventional discovery when a valid config has no functions override", async () => {
    const root = project(); const source = backend(root, "backend/convex");
    configure(root, {});
    await expectSource(root, source);
  });

  it("refuses a missing configured directory instead of reassuring the developer about a stale tree", async () => {
    const root = project(); backend(root, "convex");
    configure(root, { functions: "backend/missing" });
    await expectUnavailable(root);
    const result = await setup.handler({ projectDir: root });
    expect(result).toMatchObject({ checks: expect.arrayContaining([expect.objectContaining({ area: "convex_json", status: "fail" })]) });
    expect(result).not.toMatchObject({ checks: expect.arrayContaining([expect.objectContaining({ area: "initialization", status: "pass" })]) });
  });

  it("treats a partially written config as an unavailable project, then recovers on the next call", async () => {
    const root = project(); backend(root, "convex", 4);
    const source = backend(root, "actual/source");
    writeFileSync(join(root, "convex.json"), '{"functions":');
    await expectUnavailable(root);
    configure(root, { functions: "actual/source" });
    await expectSource(root, source);
  });

  it.each([null, [], { functions: null }, { functions: 12 }, { functions: "" }, { functions: "   " }].map(value => [value]))("rejects an invalid config value %j without falling back", async config => {
    const root = project(); backend(root, "convex"); configure(root, config);
    await expectUnavailable(root);
  });

  it("reports a configured regular file as unavailable instead of crashing during directory enumeration", async () => {
    const root = project(); backend(root, "convex");
    writeFileSync(join(root, "not-a-directory"), "reviewed text");
    configure(root, { functions: "not-a-directory" });
    await expectUnavailable(root);
  });

  it("skips a regular file at a conventional candidate and finds the actual source directory", async () => {
    const root = project(); writeFileSync(join(root, "convex"), "not a directory");
    const source = backend(root, "src/convex");
    await expectSource(root, source);
  });

  it("rejects an oversized config before reading an unbounded document or scanning the wrong tree", async () => {
    const root = project(); backend(root, "convex"); backend(root, "actual/source");
    configure(root, { functions: "actual/source", description: "x".repeat(70_000) });
    await expectUnavailable(root);
  });

  it("keeps twenty-four simultaneous project audits isolated across twelve successive configuration changes", async () => {
    const projects = Array.from({ length: 24 }, () => {
      const root = project(); backend(root, "convex", 5);
      return { root, a: backend(root, "source/a", 2), b: backend(root, "source/b", 3) };
    });
    for (let round = 0; round < 12; round++) {
      const side = round % 2 === 0 ? "a" : "b";
      for (const item of projects) configure(item.root, { functions: `source/${side}` });
      await Promise.all(projects.map(item => expectSource(item.root, item[side], side === "a" ? 2 : 3)));
    }
  }, 30_000);
});
