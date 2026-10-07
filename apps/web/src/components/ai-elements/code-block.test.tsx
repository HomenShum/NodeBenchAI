import { describe, expect, it, vi } from "vitest";

vi.mock("shiki", () => ({
  createHighlighter: vi.fn(async () => ({
    getLoadedLanguages: () => ["typescript"],
    codeToTokens: (code: string) => ({
      bg: "transparent",
      fg: "inherit",
      tokens: [[{ color: "inherit", content: code }]],
    }),
  })),
}));

import { highlightCode } from "./code-block";

type HighlightResult = NonNullable<ReturnType<typeof highlightCode>>;

const resolveHighlight = (code: string): Promise<HighlightResult> =>
  new Promise((resolve) => {
    const immediate = highlightCode(code, "typescript", resolve);
    if (immediate) {
      resolve(immediate);
    }
  });

const renderedText = (result: HighlightResult) =>
  result.tokens.flat().map((token) => token.content).join("");

describe("highlightCode token cache", () => {
  it("does not reuse tokens for equal-length snippets with matching edges", async () => {
    const prefix = "p".repeat(100);
    const suffix = "s".repeat(100);
    const firstCode = `${prefix}const x = 1;${suffix}`;
    const secondCode = `${prefix}const y = 2;${suffix}`;

    expect(firstCode).toHaveLength(secondCode.length);

    const first = await resolveHighlight(firstCode);
    const second = await resolveHighlight(secondCode);

    expect(renderedText(first)).toBe(firstCode);
    expect(renderedText(second)).toBe(secondCode);
  });
});
