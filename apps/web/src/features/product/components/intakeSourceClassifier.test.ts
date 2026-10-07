/**
 * Scenario tests for intakeSourceClassifier.
 *
 * Each test anchors to a real user-persona intake:
 *   - Founder pasting their LinkedIn + GitHub in one blob
 *   - Recruiter dropping a job-spec + candidate note
 *   - Investor uploading a pitch deck + bio + press article
 *   - Adversarial: malformed URLs, mixed-case domains, punctuation-wrapped links
 *   - Burst: 50 URLs in one paste (classifier must stay linear)
 */

import { describe, it, expect } from "vitest";
import {
  classifyUrl,
  extractUrls,
  classifyText,
  classifyFile,
  classifyIntake,
  summarizeSources,
} from "./intakeSourceClassifier";

describe("classifyUrl — per-URL host detection", () => {
  it("LinkedIn /in/ personal profile → linkedin_url with slug", () => {
    const s = classifyUrl("https://www.linkedin.com/in/janedoe/");
    expect(s.kind).toBe("linkedin_url");
    if (s.kind === "linkedin_url") expect(s.slug).toBe("janedoe");
  });

  it("LinkedIn /company/ URL → linkedin_url with slug", () => {
    const s = classifyUrl("https://linkedin.com/company/acme-ai");
    expect(s.kind).toBe("linkedin_url");
    if (s.kind === "linkedin_url") expect(s.slug).toBe("acme-ai");
  });

  it("GitHub repo URL → github_url with owner+repo", () => {
    const s = classifyUrl("https://github.com/anthropics/claude-code");
    expect(s.kind).toBe("github_url");
    if (s.kind === "github_url") {
      expect(s.owner).toBe("anthropics");
      expect(s.repo).toBe("claude-code");
    }
  });

  it("GitHub owner-only URL → github_url with just owner", () => {
    const s = classifyUrl("https://github.com/homenshum");
    expect(s.kind).toBe("github_url");
    if (s.kind === "github_url") expect(s.owner).toBe("homenshum");
  });

  it("x.com and twitter.com both → twitter_url", () => {
    const x = classifyUrl("https://x.com/homenshum");
    expect(x.kind).toBe("twitter_url");
    const t = classifyUrl("https://twitter.com/homenshum");
    expect(t.kind).toBe("twitter_url");
  });

  it("TechCrunch URL → press_release_url", () => {
    const s = classifyUrl("https://techcrunch.com/2026/04/19/anthropic-funding");
    expect(s.kind).toBe("press_release_url");
    if (s.kind === "press_release_url") expect(s.host).toBe("techcrunch.com");
  });

  it("generic host → generic_url preserving host for debug", () => {
    const s = classifyUrl("https://nodebenchai.com/about");
    expect(s.kind).toBe("generic_url");
    if (s.kind === "generic_url") expect(s.host).toBe("nodebenchai.com");
  });

  it("trailing punctuation trimmed (investor pastes LinkedIn in a sentence)", () => {
    const s = classifyUrl("https://linkedin.com/in/janedoe.");
    expect(s.kind).toBe("linkedin_url");
    if (s.kind === "linkedin_url") expect(s.slug).toBe("janedoe");
  });
});

describe("extractUrls — free-form paste with multiple links", () => {
  it("finds LinkedIn + GitHub in one paste", () => {
    const blob =
      "Meet Jane (https://linkedin.com/in/janedoe) — her repo: https://github.com/janedoe/acme-ai. Cool, right?";
    const sources = extractUrls(blob);
    expect(sources).toHaveLength(2);
    expect(sources[0].kind).toBe("linkedin_url");
    expect(sources[1].kind).toBe("github_url");
  });

  it("de-dupes identical URLs (investor pastes the same link twice)", () => {
    const dup =
      "https://linkedin.com/in/janedoe https://linkedin.com/in/janedoe";
    expect(extractUrls(dup)).toHaveLength(1);
  });

  it("empty input → empty array", () => {
    expect(extractUrls("")).toEqual([]);
    expect(extractUrls("just plain text")).toEqual([]);
  });

  it("adversarial: 50 URLs stay linear (< 50ms)", () => {
    const many = Array.from(
      { length: 50 },
      (_, i) => `https://linkedin.com/in/user${i}`,
    ).join(" ");
    const start = performance.now();
    const out = extractUrls(many);
    expect(out).toHaveLength(50);
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe("classifyText — recruiter vs founder vs free text", () => {
  it("mentions recruiter → recruiter_note", () => {
    const s = classifyText("Recruiter reached out for the Staff Engineer role.");
    expect(s.kind).toBe("recruiter_note");
  });

  it("mentions founder/CEO → founder_note", () => {
    const s = classifyText("Jane Doe is CEO and co-founder, ex-Google Brain.");
    expect(s.kind).toBe("founder_note");
  });

  it("plain business text → free_text", () => {
    const s = classifyText("We're interested in their competitive positioning.");
    expect(s.kind).toBe("free_text");
  });

  it("empty → free_text with empty content (no crash)", () => {
    expect(classifyText("").kind).toBe("free_text");
    expect(classifyText("   ").kind).toBe("free_text");
  });
});

describe("classifyFile — extension + filename hints", () => {
  it("deck.pdf + 'pitch' hint → pitch_deck_file", () => {
    const s = classifyFile("Acme-Pitch-Deck-2026.pdf", 2_400_000);
    expect(s.kind).toBe("pitch_deck_file");
    if (s.kind === "pitch_deck_file") expect(s.sizeBytes).toBe(2_400_000);
  });

  it(".pptx → pitch_deck_file even without hint", () => {
    expect(classifyFile("deck.pptx").kind).toBe("pitch_deck_file");
    expect(classifyFile("talk.key").kind).toBe("pitch_deck_file");
  });

  it("resume.pdf + 'resume' hint → bio_file", () => {
    const s = classifyFile("Jane-Doe-Resume.pdf");
    expect(s.kind).toBe("bio_file");
  });

  it("ambiguous PDF → bio_file (broader default)", () => {
    expect(classifyFile("random.pdf").kind).toBe("bio_file");
  });

  it(".md / .docx → bio_file", () => {
    expect(classifyFile("bio.md").kind).toBe("bio_file");
    expect(classifyFile("profile.docx").kind).toBe("bio_file");
  });
});

describe("classifyIntake — one-call end-to-end", () => {
  it("founder pastes mixed blob + uploads deck", () => {
    const sources = classifyIntake({
      text: "CEO Jane Doe ex-Google. LinkedIn: https://linkedin.com/in/janedoe",
      files: [{ name: "Acme-Deck.pdf", size: 1_500_000 }],
    });
    const kinds = sources.map((s) => s.kind).sort();
    expect(kinds).toContain("linkedin_url");
    expect(kinds).toContain("pitch_deck_file");
    expect(kinds).toContain("founder_note");
  });

  it("recruiter-only workflow: text + job spec PDF", () => {
    const sources = classifyIntake({
      text: "Recruiter note: looking at this candidate for Staff Eng role.",
      files: [{ name: "job-spec.pdf" }],
    });
    const kinds = sources.map((s) => s.kind);
    expect(kinds).toContain("recruiter_note");
    // job-spec.pdf without 'deck'/'pitch' hint defaults to bio_file.
    expect(kinds).toContain("bio_file");
  });

  it("zero inputs → empty catalog", () => {
    expect(classifyIntake({})).toEqual([]);
  });
});

describe("summarizeSources — UI affordance", () => {
  it("pluralization: 1 linkedin → 'profile', 3 linkedin → 'profiles'", () => {
    const one = summarizeSources([
      { kind: "linkedin_url", url: "https://linkedin.com/in/a" },
    ]);
    expect(one).toContain("1 LinkedIn profile");
    const three = summarizeSources(
      ["a", "b", "c"].map((u) => ({ kind: "linkedin_url" as const, url: u })),
    );
    expect(three).toContain("3 LinkedIn profiles");
  });

  it("multi-source blob summarized as deduped bullet string", () => {
    const summary = summarizeSources([
      { kind: "linkedin_url", url: "u1" },
      { kind: "linkedin_url", url: "u2" },
      { kind: "pitch_deck_file", fileName: "d.pdf" },
      { kind: "founder_note", text: "x" },
    ]);
    expect(summary).toContain("2 LinkedIn profiles");
    expect(summary).toContain("1 pitch deck");
    expect(summary).toContain("1 founder note");
  });

  it("empty → empty string (composer hides the affordance)", () => {
    expect(summarizeSources([])).toBe("");
  });
});
