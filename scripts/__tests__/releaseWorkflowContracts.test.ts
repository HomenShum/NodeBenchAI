import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const readRepoFile = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("release workflow contracts", () => {
  it("resolves an exact PR-head Vercel preview and fails closed", () => {
    const workflow = readRepoFile(".github/workflows/tier-b-preview.yml");

    expect(workflow).toContain("VERCEL_HEAD_REF:");
    expect(workflow).toContain("VERCEL_HEAD_SHA:");
    expect(workflow).not.toMatch(/^\s+GITHUB_REF:/m);
    expect(workflow).not.toMatch(/^\s+GITHUB_SHA:/m);
    expect(workflow).toContain('<<< "$payload"');
    expect(workflow).toContain("exactReady || exactError || exactCanceled");
    expect(workflow).toContain("Require resolved preview for shipping changes");
    expect(workflow).not.toContain('preview_status=skipped" >> "$GITHUB_OUTPUT"');
  });

  it("verifies Production through the canonical public hostname", () => {
    const workflow = readRepoFile(".github/workflows/post-deploy-verify.yml");
    const script = readRepoFile("scripts/post-deploy-verify.mjs");

    expect(workflow).toContain('${DEPLOYMENT_ENVIRONMENT,,}');
    expect(workflow).toContain('URL="https://www.nodebenchai.com"');
    expect(workflow).toContain("ALLOW_PROTECTED_PREVIEW_SKIP:");
    expect(script).toContain("allowProtectedPreviewSkip");
    expect(script).toContain(
      "isVercelPreview && !vercelBypassSecret && allowProtectedPreviewSkip",
    );
  });
});
