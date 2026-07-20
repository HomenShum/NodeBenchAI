import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  describeFetchError,
  fetchWithRetry,
  isRetryableHttpStatus,
} from "../lib/fetchWithRetry.mjs";
import { buildVercelBypassHeaders } from "../lib/vercelProtection.mjs";

const root = resolve(import.meta.dirname, "../..");
const readRepoFile = (path: string) =>
  readFileSync(resolve(root, path), "utf8");

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
