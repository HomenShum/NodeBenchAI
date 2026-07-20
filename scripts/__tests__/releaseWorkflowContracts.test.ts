import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getDistributionSurfaces } from "../../packages/mcp-local/src/tools/deltaTools.js";
import {
  describeFetchError,
  fetchWithRetry,
  isRetryableHttpStatus,
} from "../lib/fetchWithRetry.mjs";
import { buildVercelBypassHeaders } from "../lib/vercelProtection.mjs";

const root = resolve(import.meta.dirname, "../..");
const readRepoFile = (path: string) =>
  readFileSync(resolve(root, path), "utf8");

const listProductionWorkerSources = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listProductionWorkerSources(path);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      return [];
    }
    return [path];
  });

describe("release workflow contracts", () => {
  it("keeps exact-head previews buildable across multi-commit PRs", () => {
    const ignoreBuild = readRepoFile("scripts/vercel-ignore-build.sh");

    expect(ignoreBuild).toContain("VERCEL_GIT_PREVIOUS_SHA");
    expect(ignoreBuild).toContain('git diff --name-only "$DIFF_BASE" HEAD');
    expect(ignoreBuild).toContain(
      "Build: no previous successful branch deployment to compare",
    );
    expect(ignoreBuild).not.toContain("git diff --name-only HEAD~1 HEAD");
  });

  /**
   * Scenario: a release operator migrates the served app, Convex backend, and
   * Node worker, then lands a 100-file documentation follow-up before Vercel
   * observes the branch. The cumulative preview must build for every physical
   * standard-tree change, skip a later docs-only commit, and fail closed when
   * deployment ancestry is malformed or unavailable.
   *
   * User: release operator. Goal: obtain an exact preview without wasting a
   * deployment on docs-only work. Scale: 100-file sustained follow-up plus
   * independent backend, worker, and root-manifest commits. Duration: six
   * sequential deployment decisions. Degraded cases: invalid and shallow-clone
   * ancestry. Expected: build=1, intentional skip=0.
   */
  it("adjudicates standard-tree preview changes across a sustained release history", () => {
    const ignoreBuild = readRepoFile("scripts/vercel-ignore-build.sh");
    const buildRelevantBlock = ignoreBuild.match(
      /BUILD_RELEVANT=\(([\s\S]*?)\n\)/,
    )?.[1];
    expect(buildRelevantBlock).toBeDefined();
    const buildRelevant = Array.from(
      buildRelevantBlock?.matchAll(/"([^"]+)"/g) ?? [],
      (match) => match[1],
    );
    const shouldBuild = (files: string[]) =>
      files.some((file) =>
        buildRelevant.some((path) => file === path || file.startsWith(`${path}/`)),
      );

    const sustainedDocsFollowUp = Array.from(
      { length: 100 },
      (_, index) => `docs/release-note-${index}.md`,
    );
    expect([
      shouldBuild([
        "backend/convex/schema/contracts.ts",
        ...sustainedDocsFollowUp,
      ]),
      shouldBuild(["convex.json"]),
      shouldBuild(["workers/node/routes/deploy-probe.ts"]),
      shouldBuild(["tsconfig.app.json"]),
      shouldBuild(["docs/docs-only.md"]),
    ]).toEqual([true, true, true, true, false]);

    expect(ignoreBuild).toContain(
      '[[ "$changed_file" == "$path" || "$changed_file" == "$path/"* ]]',
    );
    expect(ignoreBuild).toContain(
      "Build: previous deployment SHA is malformed",
    );
    expect(ignoreBuild).toContain(
      "Build: previous deployment SHA is unavailable in the shallow clone",
    );
    expect(ignoreBuild).toContain(
      "Build: unable to compute the cumulative deployment diff",
    );
    expect(ignoreBuild).not.toContain("grep -qE");
  });

  /**
   * Scenario: a release operator asks Cloud Build to create the Node worker
   * from a clean checkout with no global TypeScript tools or network access at
   * process start. The image must compile once, retain only production
   * dependencies, and boot emitted ESM from the standard tree.
   */
  it("keeps the clean-checkout Node worker image deterministic and offline-safe", () => {
    const dockerfile = readRepoFile("workers/node/Dockerfile");
    const dockerignore = readRepoFile(".dockerignore");
    const cloudbuild = readRepoFile("workers/node/cloudbuild.yaml");
    const codeowners = readRepoFile(".github/CODEOWNERS");

    expect(dockerfile).toContain("FROM node:20-slim AS build");
    expect(dockerfile).toContain("COPY workers/node/ workers/node/");
    expect(dockerfile).toContain("COPY backend/convex/ backend/convex/");
    expect(dockerfile).toContain("RUN npm run build:voice");
    expect(dockerfile).toContain("FROM node:20-slim AS runtime");
    expect(dockerfile).toContain("RUN npm ci --omit=dev");
    expect(dockerfile).toContain(
      "COPY --from=build /app/backend/convex/_generated/api.js dist/backend/convex/_generated/api.js",
    );
    for (const assetCopy of [
      "/app/packages/mcp-local/scripts/install.sh packages/mcp-local/scripts/install.sh",
      "/app/packages/mcp-local/smithery.yaml packages/mcp-local/smithery.yaml",
      "/app/packages/mcp-local/.claude/plugin.json packages/mcp-local/.claude/plugin.json",
      "/app/packages/mcp-local/.cursor/plugin.json packages/mcp-local/.cursor/plugin.json",
      "/app/packages/mcp-local/README.md packages/mcp-local/README.md",
      "/app/apps/web/src/features/mcp/views/McpLedgerPage.tsx apps/web/src/features/mcp/views/McpLedgerPage.tsx",
      "/app/scripts/ui/runDogfoodGeminiQa.mjs scripts/ui/runDogfoodGeminiQa.mjs",
    ]) {
      expect(dockerfile).toContain(`COPY --from=build ${assetCopy}`);
    }
    expect(dockerfile).toContain("ENV NODEBENCH_MCP_PACKAGE_ROOT=/app/packages/mcp-local");
    expect(dockerfile).toContain("ENV NODEBENCH_REPO_ROOT=/app");
    expect(dockerfile).toContain('CMD ["node", "dist/workers/node/index.js"]');
    expect(dockerfile).not.toContain("|| true");
    expect(dockerfile).not.toContain('CMD ["npx"');
    expect(dockerfile).not.toContain("COPY server/");
    expect(dockerfile).not.toContain("COPY convex/");
    expect(cloudbuild).toContain("'-f', 'workers/node/Dockerfile', '.'");
    expect(cloudbuild).not.toContain("server/Dockerfile");
    expect(dockerignore).toContain("packages/mcp-local/.mcpregistry_registry_token");
    expect(dockerignore).toContain("packages/mcp-local/.mcpregistry_github_token");

    const extensionlessImports = listProductionWorkerSources(
      resolve(root, "workers/node"),
    ).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return Array.from(
        source.matchAll(/(?:from\s+|import\()["'](\.{1,2}\/[^"']+)["']/g),
      )
        .map((match) => match[1])
        .filter((specifier) => !/\.(?:cjs|js|json|mjs)$/.test(specifier))
        .map((specifier) => `${file}:${specifier}`);
    });
    expect(extensionlessImports).toEqual([]);

    expect(codeowners).toContain("/backend/convex/ @HomenShum");
    expect(codeowners).toContain("/workers/node/ @HomenShum");
    expect(codeowners).toContain("/apps/web/src/ @HomenShum");
    expect(codeowners).not.toMatch(/^\/(?:convex|server|src)\/ /m);
  });

  it("preserves file-backed MCP distribution evidence in an isolated runtime layout", () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), "nodebench-worker-runtime-"));
    const writeRuntimeAsset = (relativePath: string, content = "runtime contract\n") => {
      const target = resolve(runtimeRoot, relativePath);
      mkdirSync(resolve(target, ".."), { recursive: true });
      writeFileSync(target, content, "utf8");
    };

    try {
      writeRuntimeAsset(
        "packages/mcp-local/package.json",
        JSON.stringify({ name: "nodebench-mcp", version: "3.2.1" }),
      );
      for (const relativePath of [
        "packages/mcp-local/scripts/install.sh",
        "packages/mcp-local/smithery.yaml",
        "packages/mcp-local/.claude/plugin.json",
        "packages/mcp-local/.cursor/plugin.json",
        "packages/mcp-local/README.md",
        "apps/web/src/features/mcp/views/McpLedgerPage.tsx",
        "scripts/ui/runDogfoodGeminiQa.mjs",
      ]) {
        writeRuntimeAsset(relativePath);
      }

      const surfaces = getDistributionSurfaces({
        packageRoot: resolve(runtimeRoot, "packages/mcp-local"),
        repoRoot: runtimeRoot,
      });
      expect(surfaces).toHaveLength(9);
      expect(surfaces.map((surface) => [surface.id, surface.status])).toEqual(
        expect.arrayContaining([
          ["install_script", "ready"],
          ["claude_config", "ready"],
          ["cursor_config", "ready"],
          ["smithery", "ready"],
          ["readme", "ready"],
          ["ledger_ui", "ready"],
          ["dogfood_loop", "ready"],
        ]),
      );
      expect(surfaces.every((surface) => surface.status === "ready")).toBe(true);

      const founderOps = readRepoFile(
        "packages/mcp-local/src/tools/founderStrategicOpsTools.ts",
      );
      expect(founderOps).toContain("McpLedgerPage.tsx");
      expect(founderOps).not.toContain("McpToolLedgerView.tsx");
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("resolves an exact PR-head Vercel preview and fails closed", () => {
    const workflow = readRepoFile(".github/workflows/tier-b-preview.yml");

    expect(workflow).toContain("VERCEL_HEAD_REF:");
    expect(workflow).toContain("VERCEL_HEAD_SHA:");
    expect(workflow).not.toMatch(/^\s+GITHUB_REF:/m);
    expect(workflow).not.toMatch(/^\s+GITHUB_SHA:/m);
    expect(workflow).toContain('<<< "$payload"');
    expect(workflow).toContain("exactReady || exactError || exactCanceled");
    expect(workflow).toContain("Require resolved preview for shipping changes");
    expect(workflow).not.toContain(
      'preview_status=skipped" >> "$GITHUB_OUTPUT"',
    );
  });

  it("reuses an ignored-head preview only after ancestry and served-tree proofs", () => {
    const workflow = readRepoFile(".github/workflows/tier-b-preview.yml");

    expect(workflow).toContain("IGNORED|");
    expect(workflow).toContain(
      'gh api "repos/$GITHUB_REPOSITORY/compare/$candidate_sha...$VERCEL_HEAD_SHA"',
    );
    expect(workflow).toContain(
      'git diff --quiet "$candidate_sha" "$VERCEL_HEAD_SHA"',
    );
    expect(workflow).toContain("preview_source=equivalent-ancestor");
    expect(workflow).toContain("scripts/vercel-build.sh");
    expect(workflow).not.toContain(
      "src convex packages apps public server shared api scripts vercel.json",
    );
  });

  it("verifies Production through the canonical public hostname", () => {
    const workflow = readRepoFile(".github/workflows/post-deploy-verify.yml");
    const script = readRepoFile("scripts/post-deploy-verify.mjs");

    expect(workflow).toContain("${DEPLOYMENT_ENVIRONMENT,,}");
    expect(workflow).toContain('URL="https://www.nodebenchai.com"');
    expect(workflow).toContain("ALLOW_PROTECTED_PREVIEW_SKIP:");
    expect(script).toContain("allowProtectedPreviewSkip");
    expect(script).toContain(
      "isVercelPreview && !vercelBypassSecret && allowProtectedPreviewSkip",
    );
  });

  it("authenticates every preview verifier without a cookie redirect loop", () => {
    const postDeploy = readRepoFile("scripts/post-deploy-verify.mjs");
    const rawVerifier = readRepoFile("scripts/verify-live.ts");
    const liveSmoke = readRepoFile("evals/e2e/live-smoke.spec.ts");

    expect(postDeploy).toContain("buildVercelBypassHeaders");
    expect(postDeploy).not.toContain("x-vercel-set-bypass-cookie");
    expect(rawVerifier).toContain("buildVercelBypassHeaders");
    expect(liveSmoke).toContain("installVercelPreviewBypass");
    expect(liveSmoke).toContain("test.beforeEach");

    expect(
      buildVercelBypassHeaders(
        "https://branch-project.vercel.app/",
        "  test-secret  ",
      ),
    ).toEqual({ "x-vercel-protection-bypass": "test-secret" });
    expect(
      buildVercelBypassHeaders(
        "https://branch-project.vercel.app.attacker.example/",
        "test-secret",
      ),
    ).toEqual({});
    expect(
      buildVercelBypassHeaders("https://www.nodebenchai.com/", "test-secret"),
    ).toEqual({});
  });

  it("authenticates Tier B to protected previews without tracing the secret", () => {
    const workflow = readRepoFile(".github/workflows/tier-b-preview.yml");
    const ci = readRepoFile(".github/workflows/ci.yml");
    const playwright = readRepoFile("playwright.config.ts");
    const previewHelper = readRepoFile("evals/e2e/helpers/vercelPreview.ts");
    const securitySpec = readRepoFile(
      "evals/e2e/vercel-preview-security.spec.ts",
    );

    expect(workflow).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
    );
    expect(workflow).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET is required to test the protected READY preview",
    );
    expect(workflow).toContain("evals/e2e/vercel-preview-security.spec.ts");
    expect(ci).toContain("scripts/__tests__/releaseWorkflowContracts.test.ts");
    expect(ci).toContain("evals/e2e/vercel-preview-security.spec.ts");
    expect(playwright).not.toContain("extraHTTPHeaders");
    expect(playwright).not.toContain('baseURL.endsWith(".vercel.app")');
    expect(playwright).toContain(
      "process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()",
    );
    expect(previewHelper).not.toContain("page.route");
    expect(previewHelper).not.toContain("route.continue");
    expect(previewHelper).not.toContain("setExtraHTTPHeaders");
    expect(previewHelper).not.toContain("Network.setExtraHTTPHeaders");
    expect(previewHelper).toContain("newCDPSession");
    expect(previewHelper).toContain('session.on("Fetch.requestPaused"');
    expect(previewHelper).toContain('session.send("Fetch.continueRequest"');
    expect(previewHelper).toContain('session.send("Fetch.enable"');
    expect(previewHelper).toContain("requestOrigin !== scopedOrigin");
    expect(previewHelper).toContain('"x-vercel-protection-bypass"');
    expect(previewHelper).toContain('"x-vercel-skip-toolbar"');
    expect(previewHelper).not.toContain('"x-vercel-set-bypass-cookie"');
    expect(securitySpec).toContain("installOriginScopedCDPHeaders");
    expect(securitySpec).toContain("redirects from origin A to origin B");
    expect(playwright).toContain(
      'trace: nonemptyBypassSecret ? "off" : "on-first-retry"',
    );
  });
});

describe("post-deploy fetch resilience", () => {
  it("retries transport errors and retryable HTTP statuses with bounded backoff", async () => {
    const socketError = Object.assign(new Error("socket reset"), {
      code: "ECONNRESET",
    });
    const transportError = new TypeError("fetch failed", {
      cause: socketError,
    });
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(transportError)
      .mockResolvedValueOnce(new Response("warming", { status: 503 }))
      .mockResolvedValueOnce(new Response("<html></html>", { status: 200 }));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const result = await fetchWithRetry(
      "https://preview.example.com",
      {},
      {
        fetchImpl,
        retryDelaysMs: [10, 20],
        sleepImpl,
        timeoutMs: 1_000,
      },
    );

    expect(result.response.status).toBe(200);
    expect(result.attempts).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl.mock.calls.map(([delay]) => delay)).toEqual([10, 20]);
  });

  it("returns non-retryable client responses without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("unauthorized", {
        status: 401,
        statusText: "Unauthorized",
      }),
    );
    const sleepImpl = vi.fn().mockResolvedValue(undefined);

    const result = await fetchWithRetry(
      "https://preview.example.com",
      {},
      { fetchImpl, retryDelaysMs: [10, 20], sleepImpl, timeoutMs: 1_000 },
    );

    expect(result.response.status).toBe(401);
    expect(result.attempts).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("fails closed with attempt count and the underlying transport cause", async () => {
    const cause = Object.assign(new Error("connection refused"), {
      code: "ECONNREFUSED",
    });
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new TypeError("fetch failed", { cause }));

    await expect(
      fetchWithRetry(
        "https://preview.example.com",
        {},
        {
          fetchImpl,
          retryDelaysMs: [10],
          sleepImpl: async () => undefined,
          timeoutMs: 1_000,
        },
      ),
    ).rejects.toThrow(
      "Request failed after 2 attempts: fetch failed -> connection refused (ECONNREFUSED)",
    );
  });

  it("limits retries to transient response classes", () => {
    expect([408, 425, 429, 500, 502, 503].every(isRetryableHttpStatus)).toBe(
      true,
    );
    expect([200, 301, 400, 401, 403, 404].some(isRetryableHttpStatus)).toBe(
      false,
    );
    expect(
      describeFetchError(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("socket reset"), {
            code: "ECONNRESET",
          }),
        }),
      ),
    ).toBe("fetch failed -> socket reset (ECONNRESET)");
  });
});
