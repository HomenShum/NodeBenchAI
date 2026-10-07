import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(resolve(root, relativePath), "utf8");

describe("standard-tree release operator contracts", () => {
  it("keeps production preflight on the physical Convex and search-worker paths", () => {
    const preflight = readRepoFile("scripts/preflight-deploy.mjs");

    expect(existsSync(resolve(root, "backend/convex/tsconfig.json"))).toBe(true);
    expect(existsSync(resolve(root, "workers/node/vercel/searchApp.ts"))).toBe(true);
    expect(preflight).toContain(
      '["tsc", "-p", "backend/convex", "--noEmit", "--pretty", "false"]',
    );
    expect(preflight).toContain("workers/node/vercel/searchApp.ts");
    expect(preflight).not.toContain('["tsc", "-p", "convex"');
    expect(preflight).not.toContain("server/vercel/searchApp.ts");
  });

  it("starts scenario-catalog evaluations through the migrated Node worker", () => {
    const evaluator = readRepoFile(
      "scripts/run-scenario-catalog-runtime-eval.ts",
    );

    expect(existsSync(resolve(root, "workers/node/index.ts"))).toBe(true);
    expect(evaluator).toContain("tsx workers/node/index.ts --port");
    expect(evaluator).not.toContain("tsx server/index.ts");
  });
});
