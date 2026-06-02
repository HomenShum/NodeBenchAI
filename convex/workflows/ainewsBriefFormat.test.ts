import { describe, it, expect } from "vitest";
import {
  type BriefDigest,
  storyKey,
  clip,
  shortenForHeadline,
  joinOxford,
  topStoryTitles,
  buildBriefHeadline,
  buildBriefDek,
  buildProvenanceLine,
  buildTopSourcesLine,
  buildTopStoryLead,
  briefFooterCap,
} from "./ainewsBriefFormat";

/**
 * Scenario-based tests (scenario_testing rule). Each scenario starts from a real
 * digest shape the daily LinkedIn cron actually produces, then asserts the
 * AINews-style output is honest, bounded, and LinkedIn-safe (no pipes introduced,
 * footer never dropped).
 *
 * Reader: someone scanning the published LinkedIn brief on mobile, where the first
 * line (headline) is the hook above the "see more" fold.
 */

const FULL_DIGEST: BriefDigest = {
  narrativeThesis:
    "NVIDIA's open-weight blitz reframes the week: the loud story is robotics, the quiet one is who controls the local AI stack.",
  leadStory: {
    title: "NVIDIA ships Cosmos 3, an omnimodal world model family (open weights)",
    url: "https://example.com/cosmos3",
    whyItMatters:
      "It is the first credible open-weights challenger to closed video+action models, and it ships with datasets and fine-tuning recipes, not just weights.",
  },
  signals: [
    {
      title: "Nemotron 3 Ultra lands as the strongest US open-weight LLM",
      url: "https://example.com/nemotron",
      summary: "A 550B-A55B mixture-of-experts model that posters called the new US open SOTA.",
      hardNumbers: "550B params, 48 Artificial Analysis score",
    },
    {
      title: "RTX Spark personal AI computer announced with Microsoft",
      url: "https://example.com/spark",
      summary: "Grace + Blackwell desktop box aimed squarely at Apple Silicon.",
      hardNumbers: "128GB unified memory, 1 PFLOP FP4",
    },
    {
      title: "MiniMax M3 launches as open-weight 1M-context agent model",
      url: "https://example.com/m3",
      summary: "Headline agent benchmarks repeated across launch partners.",
      hardNumbers: "59.0% SWE-Bench Pro, 74.2% MCP Atlas",
    },
    {
      title: "Lambda first to adopt Quantum-X InfiniBand photonics",
      url: "https://example.com/lambda",
      summary: "Co-packaged optics to cut network power in large clusters.",
      hardNumbers: "Q3450-LD switches",
    },
  ],
  storyCount: 142,
  topSources: ["X / Twitter", "r/LocalLlama", "NVIDIA newsroom"],
  topCategories: ["AI hardware", "Open models"],
};

const SPARSE_DIGEST: BriefDigest = {
  narrativeThesis: "One thing actually moved today.",
  signals: [
    {
      title: "OpenAI announces Stargate Michigan data center",
      summary: "A planned 1GW facility with closed-loop cooling.",
    },
  ],
  // No leadStory, no storyCount, no topSources — the honest-degradation path.
};

const EMPTY_DIGEST: BriefDigest = {
  narrativeThesis: "",
  signals: [],
  topCategories: ["AI policy"],
};

describe("storyKey / dedup", () => {
  it("normalizes punctuation and case so lead == signal collisions are caught", () => {
    expect(storyKey("NVIDIA Cosmos 3!")).toBe(storyKey("nvidia   cosmos 3"));
    expect(storyKey(null)).toBe("");
    expect(storyKey(undefined)).toBe("");
  });
});

describe("clip", () => {
  it("returns short text unchanged and collapses whitespace", () => {
    expect(clip("  hello   world ", 100)).toBe("hello world");
  });
  it("word-clips long text with an ellipsis and never exceeds max", () => {
    const out = clip("a".repeat(20) + " " + "b".repeat(200), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("...")).toBe(true);
  });
});

describe("shortenForHeadline", () => {
  it("strips a trailing parenthetical and trailing punctuation", () => {
    expect(shortenForHeadline("NVIDIA ships Cosmos 3 (open weights)")).toBe("NVIDIA ships Cosmos 3");
    expect(shortenForHeadline("Nemotron 3 Ultra lands today.")).toBe("Nemotron 3 Ultra lands today");
  });
  it("cuts a descriptive sentence title at the first clause boundary into a noun phrase", () => {
    // Comma boundary
    expect(shortenForHeadline("NVIDIA ships Cosmos 3, an omnimodal world model family")).toBe("NVIDIA ships Cosmos 3");
    // Subordinating connective "as"
    expect(shortenForHeadline("Nemotron 3 Ultra lands as the strongest US open-weight LLM")).toBe("Nemotron 3 Ultra lands");
    // Connective "with"
    expect(shortenForHeadline("RTX Spark announced with Microsoft")).toBe("RTX Spark announced");
  });

  it("never breaks on a hyphen inside a compound word or name", () => {
    expect(shortenForHeadline("Quantum-X InfiniBand photonics ship")).toContain("Quantum-X");
    expect(shortenForHeadline("Open-weight model tops the leaderboard")).toContain("Open-weight");
  });

  it("never emits stray brackets or trailing punctuation, and stays under max", () => {
    const out = shortenForHeadline("Some very long story title that runs well beyond the headline budget for a segment", 46);
    expect(out.length).toBeLessThanOrEqual(46);
    expect(out).not.toMatch(/[()[\]]/);
    expect(out).not.toMatch(/[.,;:\-]\s*$/);
  });
});

describe("joinOxford", () => {
  it("formats 1, 2, and 3 item lists correctly", () => {
    expect(joinOxford(["A"])).toBe("A");
    expect(joinOxford(["A", "B"])).toBe("A and B");
    expect(joinOxford(["A", "B", "C"])).toBe("A, B, and C");
    expect(joinOxford(["A", "", "  ", "C"])).toBe("A and C");
  });
});

describe("topStoryTitles", () => {
  it("leads with leadStory then de-duped signals, capped at n", () => {
    const titles = topStoryTitles(FULL_DIGEST, 3);
    expect(titles).toHaveLength(3);
    expect(titles[0]).toContain("Cosmos 3");
  });

  it("de-dups when leadStory equals the top signal", () => {
    const d: BriefDigest = {
      leadStory: { title: "NVIDIA Cosmos 3 launches" },
      signals: [
        { title: "NVIDIA Cosmos 3 launches!" },
        { title: "Nemotron 3 Ultra" },
      ],
    };
    const titles = topStoryTitles(d, 3);
    // Cosmos appears once despite being both lead and signal[0].
    const cosmosCount = titles.filter((t) => /cosmos/i.test(t)).length;
    expect(cosmosCount).toBe(1);
  });

  it("stays bounded at 3 even with 100 signals (scale axis)", () => {
    const many: BriefDigest = {
      signals: Array.from({ length: 100 }, (_, i) => ({ title: `Story number ${i} about a model release` })),
    };
    expect(topStoryTitles(many, 3)).toHaveLength(3);
  });
});

describe("buildBriefHeadline", () => {
  it("produces a bracketed, oxford-joined top-3 headline within the LinkedIn fold budget", () => {
    const h = buildBriefHeadline(FULL_DIGEST);
    expect(h.startsWith("[Daily Brief] ")).toBe(true);
    expect(h).toContain(" and ");
    expect(h.length).toBeLessThanOrEqual(150);
  });

  it("respects a custom persona label", () => {
    expect(buildBriefHeadline(FULL_DIGEST, "Tech Radar").startsWith("[Tech Radar] ")).toBe(true);
  });

  it("falls back to a category roundup when there are no stories", () => {
    expect(buildBriefHeadline(EMPTY_DIGEST)).toBe("[Daily Brief] AI policy roundup");
  });

  it("falls back to a generic line when there is nothing at all", () => {
    expect(buildBriefHeadline({ signals: [] })).toBe("[Daily Brief] What moved in AI and markets today");
  });

  it("stays bounded even when every title is enormous (adversarial)", () => {
    const d: BriefDigest = {
      signals: Array.from({ length: 3 }, () => ({ title: "X".repeat(300) })),
    };
    expect(buildBriefHeadline(d).length).toBeLessThanOrEqual(150);
  });
});

describe("buildBriefDek", () => {
  it("uses the narrative thesis, clipped", () => {
    const dek = buildBriefDek(FULL_DIGEST);
    expect(dek.length).toBeLessThanOrEqual(130);
    expect(dek.length).toBeGreaterThan(0);
  });
  it("derives a dek from narrativeFraming when there is no thesis", () => {
    const d: BriefDigest = {
      narrativeFraming: {
        dominantStory: "robot demos",
        attentionShare: "70%",
        underReportedAngle: "who owns the local AI stack",
      },
    };
    expect(buildBriefDek(d)).toContain("loud story");
  });
  it("returns empty string when there is no narrative material", () => {
    expect(buildBriefDek({ signals: [] })).toBe("");
  });
});

describe("buildProvenanceLine — HONEST_SCORES", () => {
  it("prints real scanned + source counts when both are present (plural)", () => {
    expect(buildProvenanceLine(FULL_DIGEST, 4)).toBe(
      "Scanned 142 stories across 3 sources today. Here are the 4 signals that actually moved:"
    );
  });

  it("uses singular grammar for 1 story / 1 source / 1 signal", () => {
    const d: BriefDigest = { storyCount: 1, topSources: ["X"] };
    expect(buildProvenanceLine(d, 1)).toBe(
      "Scanned 1 story across 1 source today. Here are the 1 signal that actually moved:"
    );
  });

  it("never fabricates a source count when topSources is empty", () => {
    const d: BriefDigest = { storyCount: 88, topSources: [] };
    const line = buildProvenanceLine(d, 3);
    expect(line).toBe("Scanned 88 stories today. Here are the 3 signals that actually moved:");
    expect(line).not.toContain("sources");
  });

  it("never fabricates ANY count when storyCount is missing (degraded path)", () => {
    const line = buildProvenanceLine(SPARSE_DIGEST, 1);
    expect(line).not.toContain("Scanned");
    expect(line).not.toContain("across");
    expect(line).toContain("1 signal that actually moved");
  });

  it("treats 0 / negative / NaN storyCount as no honest count (no '0 stories')", () => {
    for (const bad of [0, -5, Number.NaN]) {
      const line = buildProvenanceLine({ storyCount: bad, topSources: ["X"] }, 2);
      expect(line).not.toContain("Scanned");
      expect(line).not.toMatch(/\b0 stories\b/);
    }
  });
});

describe("buildTopSourcesLine", () => {
  it("lists up to 3 real sources", () => {
    expect(buildTopSourcesLine(FULL_DIGEST)).toBe("Top sources: X / Twitter, r/LocalLlama, NVIDIA newsroom.");
  });
  it("is empty when there are no sources", () => {
    expect(buildTopSourcesLine(SPARSE_DIGEST)).toBe("");
    expect(buildTopSourcesLine({ topSources: ["", "   "] })).toBe("");
  });
});

describe("buildTopStoryLead", () => {
  it("renders the leadStory as prose with its URL and reports the consumed key", () => {
    const { lines, consumedKey } = buildTopStoryLead(FULL_DIGEST);
    expect(lines[0].startsWith("Lead: ")).toBe(true);
    expect(lines[lines.length - 1]).toBe("https://example.com/cosmos3");
    expect(consumedKey).toBe(storyKey(shortenForHeadline(FULL_DIGEST.leadStory!.title)));
  });

  it("falls back to the top signal when there is no leadStory", () => {
    const { lines, consumedKey } = buildTopStoryLead(SPARSE_DIGEST);
    expect(lines[0]).toContain("Stargate Michigan");
    expect(consumedKey).toBe(storyKey(shortenForHeadline(SPARSE_DIGEST.signals![0].title)));
  });

  it("returns nothing when there is no story at all", () => {
    expect(buildTopStoryLead(EMPTY_DIGEST)).toEqual({ lines: [], consumedKey: null });
  });

  it("never introduces a pipe character (LinkedIn breaks on '|')", () => {
    const { lines } = buildTopStoryLead(FULL_DIGEST);
    expect(lines.join("\n")).not.toContain("|");
  });
});

describe("briefFooterCap — the footer must never be dropped", () => {
  const footer = "[1/3] #AI #OpenModels";

  it("appends the footer after a blank line for short posts", () => {
    const out = briefFooterCap(["line one", "line two"], footer, 1450);
    expect(out).toBe(`line one\nline two\n\n${footer}`);
  });

  it("keeps the post within max AND preserves the exact footer when the body is huge", () => {
    const body = Array.from({ length: 80 }, (_, i) => `signal ${i} ` + "x".repeat(40));
    const out = briefFooterCap(body, footer, 1450);
    expect(out.length).toBeLessThanOrEqual(1450);
    expect(out.endsWith(footer)).toBe(true);
  });

  it("emits no footer block when the footer is empty", () => {
    expect(briefFooterCap(["body"], "", 1450)).toBe("body");
    expect(briefFooterCap(["body"], "   ", 1450)).toBe("body");
  });

  it("collapses 3+ consecutive blank lines from optional sections", () => {
    const out = briefFooterCap(["a", "", "", "", "b"], footer, 1450);
    expect(out).toBe(`a\n\nb\n\n${footer}`);
  });
});

describe("end-to-end Post 1 shape (integration of the scaffolding)", () => {
  it("assembles a complete, bounded, footer-preserving Post 1 from a full digest", () => {
    const lines: string[] = [];
    lines.push(buildBriefHeadline(FULL_DIGEST));
    lines.push("");
    const dek = buildBriefDek(FULL_DIGEST);
    if (dek) {
      lines.push(dek);
      lines.push("");
    }
    lines.push(buildProvenanceLine(FULL_DIGEST, 4));
    const ts = buildTopSourcesLine(FULL_DIGEST);
    if (ts) lines.push(ts);
    lines.push("");
    const lead = buildTopStoryLead(FULL_DIGEST);
    lines.push(...lead.lines);

    const post = briefFooterCap(lines, "[1/3] #AIhardware #OpenModels", 1450);

    expect(post.startsWith("[Daily Brief] ")).toBe(true);
    expect(post).toContain("Scanned 142 stories across 3 sources today");
    expect(post).toContain("Top sources:");
    expect(post).toContain("Lead: ");
    expect(post.endsWith("[1/3] #AIhardware #OpenModels")).toBe(true);
    expect(post.length).toBeLessThanOrEqual(1450);
    expect(post).not.toContain("|");
  });
});
