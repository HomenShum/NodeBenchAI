import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as citations from "../../../../shared/citations";

describe("FastAgent citation provenance guard", () => {
  it("does not expose a helper that turns retrieval into claim citations", () => {
    const exports = citations as Record<string, unknown>;

    expect(exports.injectWebSourceCitationsIntoText).toBeUndefined();
    expect(exports.renderWebSourceCitationTokens).toBeUndefined();
  });

  it("never patches arbitrary assistant text with retrieved-source tokens", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "backend/convex/domains/agents/fastAgentPanelStreaming.ts",
      ),
      "utf8",
    );

    expect(source).not.toContain("injectWebSourceCitationsIntoText");
    expect(source).not.toContain("Injected ${injected.tokenCount} web source citation");
    expect(source).not.toContain("extractWebSourcesFromToolResults");
    expect(source).not.toContain("deterministic citation tokens are injected from the source gallery");
    expect(source).not.toContain("the system will auto-inject a few {{cite:websrc_");
    expect(source).not.toContain('if (text.includes("<!-- SOURCE_GALLERY_DATA")');
  });
});
