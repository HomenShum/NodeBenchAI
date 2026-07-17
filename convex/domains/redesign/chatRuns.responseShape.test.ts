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

  // Both prompts below are verbatim from the 2026-07-16 authenticated production
  // runs. The possessive one silently rendered the five-section memo in prod while
  // this suite stayed green, because every title case asserted here used "the".
  it("honors the shape of the verbatim production prompts that regressed", () => {
    expect(
      detectRequestedResponseShape(
        "Production recovery QA run 2026-07-16: From the attached Daily Brief, identify one unresolved claim and return only its title. Do not write, share, approve, or modify any data.",
      ),
    ).toEqual({ kind: "title_only" });

    expect(
      detectRequestedResponseShape(
        "Production QA run 2026-07-16: Using the attached Daily Brief, return exactly two bullets: (1) the strongest supported claim with its best source, and (2) one concrete review gap. Do not write, share, approve, or modify any data.",
      ),
    ).toEqual({ kind: "bullets", count: 2 });
  });

  it("detects a title request behind any determiner, not just an article", () => {
    for (const prompt of [
      "Return only its title.",
      "Return only their title.",
      "Just give me his title.",
      "Return only this title.",
      "Return only title.",
      "Provide its title only",
      "Title-only please.",
    ]) {
      expect(detectRequestedResponseShape(prompt)).toEqual({ kind: "title_only" });
    }
  });

  // Issue #569 — every explicit shape beyond title/bullets used to fall
  // through to the five-section memo. These scenarios model an analyst
  // pasting exact-output constraints into the composer.
  it("detects single-sentence, single-paragraph, and word-limit requests", () => {
    expect(detectRequestedResponseShape("Summarize the brief in one sentence.")).toEqual({ kind: "sentence" });
    expect(detectRequestedResponseShape("Give me just one sentence on the risk.")).toEqual({ kind: "sentence" });
    expect(detectRequestedResponseShape("Write a one-sentence summary.")).toEqual({ kind: "sentence" });
    expect(detectRequestedResponseShape("Explain the funding round in a single paragraph.")).toEqual({ kind: "paragraph" });
    expect(detectRequestedResponseShape("One-paragraph answer please.")).toEqual({ kind: "paragraph" });
    expect(detectRequestedResponseShape("Summarize in under 50 words.")).toEqual({ kind: "word_limit", limit: 50 });
    expect(detectRequestedResponseShape("Answer in 30 words or fewer.")).toEqual({ kind: "word_limit", limit: 30 });
    expect(detectRequestedResponseShape("No more than 80 words.")).toEqual({ kind: "word_limit", limit: 80 });
  });

  it("keeps memo for incidental or degenerate shape phrasing", () => {
    // The memo template itself says "one sentence" per heading — user prose
    // that merely mentions sentences/paragraphs must not flip the shape.
    expect(detectRequestedResponseShape("The first sentence of their pitch is misleading.")).toEqual({ kind: "memo" });
    expect(detectRequestedResponseShape("Compare the opening paragraph across both reports.")).toEqual({ kind: "memo" });
    // Degenerate or absurd limits never bind.
    expect(detectRequestedResponseShape("Summarize in under 2 words.")).toEqual({ kind: "memo" });
    expect(detectRequestedResponseShape("Summarize in under 90000 words.")).toEqual({ kind: "memo" });
    // Bullets outrank a word limit when both appear.
    expect(
      detectRequestedResponseShape("Give me exactly 3 bullets, under 50 words."),
    ).toEqual({ kind: "bullets", count: 3 });
  });

  it("returns exactly one sentence while omitting memo-only fields", () => {
    // idx binds the [1] marker to the URL-backed row so the #571 superlative
    // gate recognizes the claim as grounded and leaves the sentence intact.
    const shaped = applyDeterministicResponsePolicy(
      "Summarize the brief in one sentence.",
      memo,
      [{ idx: 1, source: "https://example.com/acme", quote: "Acme launched a new product." }],
    );
    expect(shaped.shortAnswer).toBe("Acme is the strongest supported claim in the current packet. [1]");
    expect(shaped.whyItMatters).toBe("");
    expect(shaped.risks).toEqual([]);
    expect(shaped.nextAction).toBe("");
  });

  it("collapses the memo into one paragraph and keeps the source-needed limitation inline when unsupported", () => {
    const supported = applyDeterministicResponsePolicy(
      "Explain it in a single paragraph.",
      memo,
      [{ source: "https://example.com/acme", quote: "Acme launched a new product." }],
    );
    expect(supported.shortAnswer).not.toContain("\n");
    expect(supported.whyItMatters).toBe("");

    const unsupported = applyDeterministicResponsePolicy(
      "Explain it in a single paragraph.",
      memo,
      [{ source: "Setup" }],
    );
    // Honesty survives the compact shape: the limitation rides inside the
    // paragraph because compact renders hide the risks section entirely.
    expect(unsupported.shortAnswer).toContain("Source needed");
    expect(unsupported.risks).toEqual([]);
  });

  it("enforces an explicit word limit deterministically, including the honesty prefix", () => {
    const longMemo = {
      ...memo,
      shortAnswer:
        "Acme closed the round. The filing lists twelve investors across three continents and two follow-on commitments.",
    };
    const shaped = applyDeterministicResponsePolicy(
      "Summarize in under 8 words.",
      longMemo,
      [{ source: "https://example.com/acme", quote: "Acme closed the round." }],
    );
    expect(shaped.shortAnswer.split(/\s+/).length).toBeLessThanOrEqual(8);
    expect(shaped.whyItMatters).toBe("");

    const unsupported = applyDeterministicResponsePolicy(
      "Summarize in under 8 words.",
      longMemo,
      [{ source: "Setup" }],
    );
    expect(unsupported.shortAnswer.startsWith("Source needed:")).toBe(true);
    expect(unsupported.shortAnswer.split(/\s+/).length).toBeLessThanOrEqual(8);
  });

  it("does not mistake incidental prose about titles for a shape request", () => {
    expect(
      detectRequestedResponseShape("Summarize the report and explain why its title is misleading."),
    ).toEqual({ kind: "memo" });
    expect(
      detectRequestedResponseShape("Compare each vendor's job titles across the market."),
    ).toEqual({ kind: "memo" });
  });

  it("returns one plain title line while omitting memo-only fields", () => {
    const shaped = applyDeterministicResponsePolicy(
      "Provide a title only",
      memo,
      [{ idx: 1, source: "https://example.com/acme", quote: "Acme launched a new product." }],
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
      [{ idx: 1, source: "https://example.com/acme", quote: "Acme launched a new product." }],
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

  it("replaces model-emitted partial URLs with exactly one canonical URL per bullet", () => {
    const canonical = "https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash";
    const shaped = applyDeterministicResponsePolicy(
      `Using ${canonical}, return exactly two bullets. Each bullet must include the supported URL.`,
      {
        shortAnswer: "Gemini 3.5 Flash is stable (https://ai.google.dev/gemini-api/docs",
        whyItMatters: "Production ready https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque",
        risks: [],
        nextAction: "",
      },
      [{ source: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque", quote: "Grounded." }],
    );

    for (const bullet of shaped.shortAnswer.split("\n")) {
      expect(bullet.match(/https?:\/\//g)).toHaveLength(1);
      expect(bullet).toContain(canonical);
      expect(bullet).not.toContain("grounding-api-redirect");
      expect(bullet).not.toContain("https://ai.google.dev/gemini-api/docs:");
    }
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

  // Mixed run: one URL-backed row plus cached section labels. This is the exact
  // shape the 2026-07-16 audit hit ("strongest supported claim with its best
  // source" while the best source rendered as a label like "Setup"). A run-level
  // "some URL exists" gate lets it pass; the claim must be grounded by its own
  // citation.
  const mixedEvidence = [
    { idx: 1, source: "https://example.com/acme-filing", quote: "Acme raised $50M." },
    { idx: 2, source: "Setup", quote: "Act I framing" },
    { idx: 3, source: "Rising Action", quote: "Act II framing" },
  ];

  it("keeps a best-source superlative that cites the URL-backed row", () => {
    const grounded = applyDeterministicResponsePolicy(
      "Analyze Acme",
      { shortAnswer: "Acme is the strongest supported claim [1].", whyItMatters: "", risks: [], nextAction: "" },
      mixedEvidence,
    );

    expect(grounded.shortAnswer).toContain("strongest supported claim");
    expect(grounded.risks).toEqual([]);
  });

  it("rewrites a best-source superlative citing a cached label even when a URL-backed row exists elsewhere", () => {
    const mislabeled = applyDeterministicResponsePolicy(
      "Analyze Acme",
      { shortAnswer: "Acme is the strongest supported claim [2].", whyItMatters: "", risks: [], nextAction: "" },
      mixedEvidence,
    );

    expect(mislabeled.shortAnswer.toLowerCase()).not.toContain("strongest supported claim");
    expect(mislabeled.shortAnswer).toContain("source or claim requiring verification");
    expect(mislabeled.risks.at(-1)).toContain("Source needed:");
  });

  it("rewrites a best-source superlative that carries no citation at all", () => {
    const uncited = applyDeterministicResponsePolicy(
      "Analyze Acme",
      { shortAnswer: "Acme is the best source in the packet.", whyItMatters: "", risks: [], nextAction: "" },
      mixedEvidence,
    );

    expect(uncited.shortAnswer.toLowerCase()).not.toContain("best source");
    expect(uncited.risks.at(-1)).toContain("Source needed:");
  });
});
