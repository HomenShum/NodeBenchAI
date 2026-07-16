import { describe, expect, it } from "vitest";

import {
  applyDeterministicResponsePolicy,
  detectRequestedResponseShape,
  modelForTier,
  parseMemo,
  pricingForModel,
  type ParsedMemo,
} from "./chatRuns";

const memo: ParsedMemo = {
  shortAnswer: "Acme is the strongest supported claim in the current packet. [1]",
  whyItMatters: "Its launch changes the competitive baseline.",
  risks: ["The rollout date may change."],
  nextAction: "Pin the strongest claim into the report.",
};

describe("redesign chat runtime response policy", () => {
  it("uses the official stable Gemini 3.5 Flash id for paid fast and auto runs", () => {
    expect(modelForTier("fast")).toBe("gemini-3.5-flash");
    expect(modelForTier("auto")).toBe("gemini-3.5-flash");
    expect(modelForTier("free")).toBe("gemini-3.1-flash-lite");
    expect(modelForTier("deep")).toBe("gemini-3.1-pro-preview");
    expect(pricingForModel("gemini-3.5-flash")).toEqual({ inputUsdPer1m: 1.5, outputUsdPer1m: 9 });
  });

  it("detects title-only and exact numeric or word-count bullet requests", () => {
    expect(detectRequestedResponseShape("Return only the title.")).toEqual({ kind: "title_only" });
    expect(detectRequestedResponseShape("Answer in exactly 3 bullets.")).toEqual({ kind: "bullets", count: 3 });
    expect(detectRequestedResponseShape("Give me exactly four concise bullet points.")).toEqual({ kind: "bullets", count: 4 });
    expect(detectRequestedResponseShape("Research Acme's market position.")).toEqual({ kind: "memo" });
  });

  it("returns one plain title line while omitting memo-only fields", () => {
    const shaped = applyDeterministicResponsePolicy(
      "Provide a title only",
      memo,
      [{ source: "https://example.com/acme", quote: "Acme launched a new product." }],
    );

    expect(shaped.shortAnswer).not.toContain("\n");
    expect(shaped.shortAnswer).not.toMatch(/\[\d+\]/);
    expect(shaped.whyItMatters).toBe("");
    expect(shaped.risks).toEqual([]);
    expect(shaped.nextAction).toBe("");
  });

  it("returns exactly the requested number of bullet lines", () => {
    const shaped = applyDeterministicResponsePolicy(
      "Answer in exactly 3 bullets",
      memo,
      [{ source: "https://example.com/acme", quote: "Acme launched a new product." }],
    );
    const bullets = shaped.shortAnswer.split("\n");

    expect(bullets).toHaveLength(3);
    expect(bullets.every((line) => line.startsWith("- "))).toBe(true);
    expect(shaped.whyItMatters).toBe("");
    expect(shaped.risks).toEqual([]);
    expect(shaped.nextAction).toBe("");
  });

  it("keeps fetched-page chrome out of compact bullets and honors a URL-in-each-bullet contract", () => {
    const shaped = applyDeterministicResponsePolicy(
      "Return exactly two bullets. Each bullet must include the supported URL.",
      {
        shortAnswer: "Gemini 3.5 Flash is the requested model.",
        whyItMatters: "",
        risks: [],
        nextAction: "",
      },
      [{
        source: "https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash",
        quote: "[跳至主要內容](#main-content) [![Gemini API](logo.svg)](/) English Deutsch Español",
      }],
    );
    const bullets = shaped.shortAnswer.split("\n");

    expect(bullets).toHaveLength(2);
    expect(bullets.every((line) => line.includes("https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash"))).toBe(true);
    expect(shaped.shortAnswer).not.toMatch(/跳至主要內容|Gemini API.*logo\.svg|English Deutsch/);
    expect(bullets[1]).toContain("did not return another clean supported detail");
  });

  it("prefers the requested canonical URL over a provider redirect without duplicating citation links", () => {
    const canonical = "https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash";
    const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque-token";
    const shaped = applyDeterministicResponsePolicy(
      `Using ${canonical}, return exactly two bullets. Each bullet must include the supported URL.`,
      {
        shortAnswer: `Gemini 3.5 Flash is listed as stable at [the official model page](${canonical}). [1]`,
        whyItMatters: "",
        risks: [],
        nextAction: "",
      },
      [{ source: redirect, quote: "Provider-grounded result." }],
    );
    const bullets = shaped.shortAnswer.split("\n");

    expect(bullets).toHaveLength(2);
    expect(bullets.every((line) => line.includes(canonical))).toBe(true);
    expect(shaped.shortAnswer).not.toContain(redirect);
    expect(shaped.shortAnswer).not.toMatch(/\[1\]/);
    expect(shaped.shortAnswer).toContain("gemini-3.5-flash");
  });

  it("does not truncate a canonical URL before compact response policy runs", () => {
    const canonical = "https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash";
    const parsed = parseMemo(`- ${"Production status detail ".repeat(10)}${canonical}\n- Second detail`);

    expect(parsed.shortAnswer).toContain(canonical);
    expect(parsed.shortAnswer).not.toMatch(/https:\/\/[^\s]*gemini-$/);
  });

  it("emits a source-needed limitation and removes unsupported strength claims without a URL", () => {
    const shaped = applyDeterministicResponsePolicy(
      "Give me exactly two bullets",
      memo,
      [{ source: "cached memory", quote: "An uncited cached observation." }],
    );

    expect(shaped.shortAnswer.split("\n")).toHaveLength(2);
    expect(shaped.shortAnswer).toContain("Source needed:");
    expect(shaped.shortAnswer.toLowerCase()).not.toMatch(/\b(?:best|strongest)\s+(?:supported\s+)?(?:source|claim|evidence)\b/);

    const defaultMemo = applyDeterministicResponsePolicy("Analyze Acme", memo, []);
    expect(defaultMemo.risks.at(-1)).toContain("Source needed:");
    expect(defaultMemo.nextAction).toContain("Add a supported source URL");
    expect(defaultMemo.shortAnswer.toLowerCase()).not.toContain("strongest supported claim");
  });

  it("does not treat a blocked or unsupported URL as supporting evidence", () => {
    for (const evidence of [
      [{ source: "https://example.com/rejected", quote: "Rejected quote", verificationState: "unsupported" as const }],
      [{ source: "https://example.com/blocked", quote: "Blocked quote", verificationState: "fetch_blocked" as const }],
      [{ source: "https://example.com/blocking", quote: "Blocking quote", blocking: true }],
    ]) {
      const shaped = applyDeterministicResponsePolicy("Analyze Acme", memo, evidence);
      expect(shaped.risks.at(-1)).toContain("Source needed:");
      expect(shaped.shortAnswer.toLowerCase()).not.toContain("strongest supported claim");
      expect(shaped.nextAction).toContain("Add a supported source URL");
    }
  });
});
