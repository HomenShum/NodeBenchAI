/**
 * Scenario tests for `searchableTextRecompute` helpers (PR D).
 *
 * Per .claude/rules/scenario_testing.md — every test names a persona,
 * a goal, prior state, action sequence, scale, and duration. The helpers
 * are pure functions, so we exercise them directly with realistic row
 * shapes for each of the 4 backfilled collections.
 *
 * The helpers are the SINGLE SOURCE OF TRUTH for `searchableText` on
 * every insert AND every patch. They must:
 *   - Be deterministic (DETERMINISTIC rule) — same row → same string.
 *   - Be idempotent under recompute — calling twice produces equal output.
 *   - Cap output at MAX_SEARCHABLE_TEXT_BYTES (BOUND_READ rule).
 *   - Skip empty parts so the search field stays compact.
 *   - Treat soft-deleted blocks as having empty searchableText so the
 *     federated index drops them immediately.
 *
 * These tests are the regression net for PR D — any patch site that
 * forgets the hook will leave its row's searchableText stale, which is
 * an unobservable correctness bug. The scenario tests in
 * `federatedSearch.test.ts` exercise the fan-out shape; this file
 * exercises the projection shape.
 */

import { describe, expect, it } from "vitest";

import {
  recomputeEntitySearchableText,
  recomputeReportSearchableText,
  recomputeBlockSearchableText,
  recomputeSourceSearchableText,
} from "./searchableTextRecompute";
import { MAX_SEARCHABLE_TEXT_BYTES } from "./federatedHelpers";

/* -------------------------------------------------------------------------- */
/* recomputeEntitySearchableText                                               */
/* -------------------------------------------------------------------------- */

describe("recomputeEntitySearchableText — entity projection", () => {
  /**
   * Persona:    Power user creates a new entity from a chat thread
   * Goal:       Entity is immediately findable by name, slug, or summary
   * Prior:      Empty workspace
   * Actions:    Helper composes searchableText from entity fields
   * Scale:      1 row
   * Duration:   Single call (deterministic)
   * Expected:   Joined string with name, slug, summary, savedBecause
   */
  it("composes name + slug + summary + savedBecause", () => {
    const got = recomputeEntitySearchableText({
      name: "Anthropic",
      slug: "anthropic-ai", // distinct from name to avoid case-insensitive dedupe
      summary: "AI safety company building Claude",
      savedBecause: "founder briefing",
    });
    expect(got).toBe(
      "Anthropic | anthropic-ai | AI safety company building Claude | founder briefing",
    );
  });

  /**
   * Persona:    Adversarial mutation patches savedBecause but leaves
   *             searchableText stale.
   * Goal:       Re-running recompute against the patched row produces a
   *             different string (so the backfill / patch hook catches
   *             the staleness).
   * Expected:   recompute(after) !== recompute(before)
   */
  it("changes when any source field changes (HONEST_SCORES)", () => {
    const before = recomputeEntitySearchableText({
      name: "Acme",
      slug: "acme",
      summary: "Stealth",
      savedBecause: "saved",
    });
    const after = recomputeEntitySearchableText({
      name: "Acme",
      slug: "acme",
      summary: "Stealth AI infrastructure for satellites",
      savedBecause: "saved",
    });
    expect(after).not.toBe(before);
  });

  it("handles missing optional savedBecause without crashing", () => {
    const got = recomputeEntitySearchableText({
      name: "OpenAI",
      slug: "openai-corp", // distinct from name to avoid case-insensitive dedupe
      summary: "ChatGPT and GPT-5",
      savedBecause: undefined,
    });
    // savedBecause skipped — not "undefined" stringified. composeSearchableText
    // dedupes case-insensitively so a slug equal to the name (lowercased)
    // would collapse — that's by design.
    expect(got).toBe("OpenAI | openai-corp | ChatGPT and GPT-5");
    expect(got).not.toContain("undefined");
  });

  it("dedupes case-insensitively (slug matching lowered name collapses)", () => {
    // This is a feature: the federated index doesn't waste bytes on the
    // same token written twice in different cases.
    const got = recomputeEntitySearchableText({
      name: "OpenAI",
      slug: "openai", // lowercased name → dedupe drops this
      summary: "AI lab",
      savedBecause: undefined,
    });
    expect(got).toBe("OpenAI | AI lab");
  });

  it("is deterministic across repeated calls (DETERMINISTIC rule)", () => {
    const doc = {
      name: "Stripe",
      slug: "stripe",
      summary: "Payments infrastructure",
      savedBecause: "fintech-research",
    };
    const a = recomputeEntitySearchableText(doc);
    const b = recomputeEntitySearchableText(doc);
    expect(a).toBe(b);
  });

  it("caps oversized summaries at MAX_SEARCHABLE_TEXT_BYTES (BOUND_READ)", () => {
    const huge = "Stripe " + "x".repeat(MAX_SEARCHABLE_TEXT_BYTES + 1000);
    const got = recomputeEntitySearchableText({
      name: "Stripe",
      slug: "stripe",
      summary: huge,
      savedBecause: undefined,
    });
    expect(got.length).toBeLessThanOrEqual(MAX_SEARCHABLE_TEXT_BYTES);
  });
});

/* -------------------------------------------------------------------------- */
/* recomputeReportSearchableText                                               */
/* -------------------------------------------------------------------------- */

describe("recomputeReportSearchableText — report projection", () => {
  /**
   * Persona:    Power user finalizes a chat session into a saved report
   * Goal:       Report is immediately findable by title, query, or entity
   * Prior:      Existing entity, ongoing chat session
   * Actions:    Helper composes searchableText from report fields
   * Scale:      1 row
   * Duration:   Single call
   * Expected:   Joined string with title, summary, query, primaryEntity,
   *             entitySlug
   */
  it("composes title + summary + query + primaryEntity + entitySlug", () => {
    const got = recomputeReportSearchableText({
      title: "Anthropic deep dive",
      summary: "Claude 4.7 launch, $61B valuation",
      query: "what's new at Anthropic",
      primaryEntity: "Anthropic",
      entitySlug: "anthropic-org", // distinct from primaryEntity
    });
    expect(got).toContain("Anthropic deep dive");
    expect(got).toContain("Claude 4.7 launch");
    expect(got).toContain("Anthropic"); // primaryEntity surfaces as a separate token
    expect(got).toContain("anthropic-org"); // entitySlug surfaces too
  });

  it("dedupes case-insensitively so the same entity isn't doubled", () => {
    const got = recomputeReportSearchableText({
      title: "Orbital Labs",
      summary: "satellites",
      query: "Orbital Labs",
      primaryEntity: "Orbital Labs",
      entitySlug: "orbital-labs",
    });
    // "Orbital Labs" appears once at the top of the joined string —
    // composeSearchableText drops the duplicate query + primaryEntity.
    const occurrences = (got.match(/Orbital Labs/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("survives all-optional row (draft with no entity yet)", () => {
    const got = recomputeReportSearchableText({
      title: "Untitled",
      summary: "",
      query: "",
      primaryEntity: undefined,
      entitySlug: undefined,
    });
    expect(got).toBe("Untitled");
    expect(got).not.toContain("undefined");
  });

  /**
   * Persona:    Backfill runs on a row that was just inserted by a
   *             post-PR-D mutation.
   * Goal:       Backfill detects no diff and skips the write.
   * Expected:   recompute() with the SAME inputs returns the SAME string.
   */
  it("is idempotent — same inputs ⇒ same output (backfill skip path)", () => {
    const inputs = {
      title: "Stripe Q1 brief",
      summary: "RPV up 23% YoY",
      query: "stripe revenue",
      primaryEntity: "Stripe",
      entitySlug: "stripe",
    };
    const first = recomputeReportSearchableText(inputs);
    const second = recomputeReportSearchableText(inputs);
    expect(first).toBe(second);
  });
});

/* -------------------------------------------------------------------------- */
/* recomputeBlockSearchableText                                                */
/* -------------------------------------------------------------------------- */

describe("recomputeBlockSearchableText — block chip projection", () => {
  /**
   * Persona:    Agent appends a paragraph to an entity workspace
   * Goal:       The paragraph text is searchable by any token it contains
   * Prior:      Entity workspace exists
   * Actions:    Helper flattens chip array to a single string
   * Scale:      1 row
   * Duration:   Single call
   * Expected:   String contains every chip's `value` token, no chip type
   *             labels leak into the field.
   */
  it("flattens chip array values", () => {
    const got = recomputeBlockSearchableText({
      content: [
        { type: "text", value: "Anthropic raised $13B" },
        { type: "text", value: "from Lightspeed" },
      ],
      deletedAt: undefined,
    });
    expect(got).toContain("Anthropic raised $13B");
    expect(got).toContain("from Lightspeed");
    expect(got).not.toContain("text"); // chip type label must not leak
  });

  /**
   * Persona:    User pastes a hyperlink chip
   * Goal:       Search "openai.com" finds the block, not just the visible
   *             label.
   * Expected:   The link's hostname is surfaced.
   */
  it("surfaces link hostnames so URL-based search works", () => {
    const got = recomputeBlockSearchableText({
      content: [
        { type: "text", value: "See " },
        {
          type: "link",
          value: "OpenAI blog",
          url: "https://www.openai.com/research/gpt-5",
        },
      ],
      deletedAt: undefined,
    });
    expect(got).toContain("OpenAI blog");
    expect(got).toContain("openai.com");
  });

  /**
   * Persona:    User soft-deletes a block via the trash UI
   * Goal:       The soft-deleted row stops appearing in search results
   * Expected:   recompute returns empty string for deletedAt rows so the
   *             federated `search_blocks` index drops the row.
   */
  it("returns empty string for soft-deleted blocks (HONEST_STATUS)", () => {
    const got = recomputeBlockSearchableText({
      content: [{ type: "text", value: "secret note" }],
      deletedAt: Date.now(),
    });
    expect(got).toBe("");
  });

  it("handles mention chips with mentionTarget", () => {
    const got = recomputeBlockSearchableText({
      content: [
        { type: "text", value: "Asked " },
        {
          type: "mention",
          value: "@homen",
          mentionTrigger: "@",
          mentionTarget: "user:homen",
        },
      ],
      deletedAt: undefined,
    });
    expect(got).toContain("@homen");
    expect(got).toContain("user:homen");
  });

  it("handles invalid link URLs gracefully (BOUND_READ)", () => {
    const got = recomputeBlockSearchableText({
      content: [
        {
          type: "link",
          value: "Broken link",
          url: "not-a-valid-url",
        },
      ],
      deletedAt: undefined,
    });
    // value still surfaces; bad URL is silently dropped, no throw.
    expect(got).toContain("Broken link");
  });

  it("returns empty for missing/non-array content", () => {
    expect(
      recomputeBlockSearchableText({
        content: undefined as any,
        deletedAt: undefined,
      }),
    ).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* recomputeSourceSearchableText                                               */
/* -------------------------------------------------------------------------- */

describe("recomputeSourceSearchableText — source artifact projection", () => {
  /**
   * Persona:    Agent crawls a public URL during research
   * Goal:       The fetched URL is findable by title or domain
   * Prior:      Empty source corpus
   * Actions:    Helper composes searchableText from source row
   * Scale:      1 row
   * Duration:   Single call
   * Expected:   String contains title + URL + mimeType
   */
  it("composes title + sourceUrl + mimeType", () => {
    const got = recomputeSourceSearchableText({
      title: "Anthropic blog: Constitutional AI",
      sourceUrl: "https://www.anthropic.com/research/constitutional-ai",
      mimeType: "text/html",
    });
    expect(got).toContain("Constitutional AI");
    expect(got).toContain(
      "https://www.anthropic.com/research/constitutional-ai",
    );
    expect(got).toContain("text/html");
  });

  it("survives missing title (URL-only sources)", () => {
    const got = recomputeSourceSearchableText({
      title: undefined,
      sourceUrl: "https://www.openai.com/news",
      mimeType: "text/html",
    });
    expect(got).toContain("openai.com");
    expect(got).not.toContain("undefined");
  });

  /**
   * Persona:    Backfill on production sourceArtifacts corpus (100k+ rows)
   * Goal:       Re-running the backfill is a no-op
   * Expected:   Same inputs ⇒ same output
   */
  it("is idempotent (backfill no-op on second run)", () => {
    const inputs = {
      title: "OpenAI announces o3",
      sourceUrl: "https://openai.com/o3",
      mimeType: "text/html",
    };
    const a = recomputeSourceSearchableText(inputs);
    const b = recomputeSourceSearchableText(inputs);
    expect(a).toBe(b);
  });
});

/* -------------------------------------------------------------------------- */
/* Long-running scenario — 1000 sequential recomputes don't drift              */
/* -------------------------------------------------------------------------- */

describe("Scenario — long-running recompute accumulation", () => {
  /**
   * Persona:    Backfill scans 1000+ rows in a single mutation
   * Goal:       No state drift, no memory growth, no determinism break
   * Prior:      1000 rows with mixed content
   * Actions:    Recompute each row, collect outputs
   * Scale:      1000 sequential calls in one process
   * Duration:   Sustained CPU burst
   * Expected:   All outputs stable; calling the helper N times on the same
   *             input N times in a row produces N identical strings.
   */
  it("1000 sequential entity recomputes on the same row produce identical output", () => {
    const doc = {
      name: "Stripe",
      slug: "stripe",
      summary: "Payments infrastructure for the internet",
      savedBecause: "fintech",
    };
    const golden = recomputeEntitySearchableText(doc);
    for (let i = 0; i < 1000; i += 1) {
      expect(recomputeEntitySearchableText(doc)).toBe(golden);
    }
  });

  it("1000 different blocks each produce stable output", () => {
    for (let i = 0; i < 1000; i += 1) {
      const got = recomputeBlockSearchableText({
        content: [{ type: "text", value: `Token ${i}` }],
        deletedAt: undefined,
      });
      expect(got).toContain(`Token ${i}`);
    }
  });
});
