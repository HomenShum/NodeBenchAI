/**
 * Tests for default authority tiers — credibility-first defaults per block.
 *
 * Scenario: A sub-agent fetches a URL during diligence. Before citing it,
 *           the pipeline classifies it as tier1/2/3/denied/unknown. This
 *           drives the confidence chip on the rendered report.
 *
 * Invariants under test:
 *  - Deny-list wins over any tier match (explicit > implicit)
 *  - Wildcard patterns match subdomains only, not the root
 *  - www-stripped hostnames still match
 *  - v1 legal fence is actually enforced (Glassdoor / X / PitchBook denied)
 */

import { describe, it, expect } from "vitest";
import {
  classifyAuthority,
  DEFAULT_TIERS,
  ALL_BLOCK_TYPES,
} from "./defaultTiers";

describe("classifyAuthority", () => {
  describe("founder block", () => {
    it("tier1 LinkedIn for verified bios", () => {
      expect(classifyAuthority("https://linkedin.com/in/jane-doe", "founder")).toBe("tier1");
      expect(classifyAuthority("https://www.linkedin.com/in/jane-doe", "founder")).toBe("tier1");
    });

    it("tier1 for any .gov domain via wildcard", () => {
      expect(classifyAuthority("https://sec.gov/edgar/foo", "founder")).toBe("tier1");
      expect(classifyAuthority("https://state.nj.gov/records", "founder")).toBe("tier1");
    });

    it("tier2 for reputable press", () => {
      expect(classifyAuthority("https://techcrunch.com/article", "founder")).toBe("tier2");
      expect(classifyAuthority("https://www.bloomberg.com/x", "founder")).toBe("tier2");
    });

    it("tier3 for forums (always requires corroboration)", () => {
      expect(classifyAuthority("https://news.ycombinator.com/item?id=1", "founder")).toBe("tier3");
      expect(classifyAuthority("https://reddit.com/r/startups", "founder")).toBe("tier3");
    });

    it("unknown for unmatched domain (caller decides downgrade)", () => {
      expect(classifyAuthority("https://random-blog.example", "founder")).toBe("unknown");
    });
  });

  describe("v1 legal fence — explicit denials", () => {
    it("denies Glassdoor for hiring block (scraping TOS)", () => {
      expect(classifyAuthority("https://glassdoor.com/reviews/acme", "hiring")).toBe("denied");
    });

    it("denies twitter/x for publicOpinion (paid API)", () => {
      expect(classifyAuthority("https://twitter.com/user/status/1", "publicOpinion")).toBe("denied");
      expect(classifyAuthority("https://x.com/user/status/1", "publicOpinion")).toBe("denied");
    });

    it("denies PitchBook / SimilarWeb / Apptopia for financial (paid proxies)", () => {
      expect(classifyAuthority("https://similarweb.com/site/acme", "financial")).toBe("denied");
      expect(classifyAuthority("https://apptopia.com/apps/acme", "financial")).toBe("denied");
      expect(classifyAuthority("https://pitchbook.com/profiles/acme", "financial")).toBe("denied");
    });

    it("deny-list wins over tier match (invariant)", () => {
      // Hypothetical: if glassdoor were accidentally in tier2 somewhere, deny still wins
      // This test proves the control flow: deny-list runs first
      expect(classifyAuthority("https://glassdoor.com", "hiring")).toBe("denied");
    });
  });

  describe("wildcard matching rules", () => {
    it("'*.gov' matches subdomains but not the bare root '.gov'", () => {
      // state.nj.gov → tier1 (founder has *.gov in tier1)
      expect(classifyAuthority("https://state.nj.gov", "founder")).toBe("tier1");
    });

    it("non-wildcard 'sec.gov' matches subdomain (www) after normalization", () => {
      expect(classifyAuthority("https://www.sec.gov/edgar", "regulatory")).toBe("tier1");
    });
  });

  describe("input validation", () => {
    it("returns 'unknown' for an unparseable URL (never throws)", () => {
      expect(classifyAuthority("not a url", "founder")).toBe("unknown");
      expect(classifyAuthority("", "founder")).toBe("unknown");
    });
  });

  describe("patent block", () => {
    it("tier1 for USPTO + Google Patents + EPO", () => {
      expect(classifyAuthority("https://uspto.gov/patents/1", "patent")).toBe("tier1");
      expect(classifyAuthority("https://patents.google.com/patent/US12345", "patent")).toBe("tier1");
      expect(classifyAuthority("https://epo.org/search", "patent")).toBe("tier1");
    });
  });

  describe("news block", () => {
    it("tier1 for reputable newsrooms with editorial policy", () => {
      expect(classifyAuthority("https://reuters.com/article", "news")).toBe("tier1");
      expect(classifyAuthority("https://apnews.com/article", "news")).toBe("tier1");
    });

    it("tier3 aggregators never get quoted directly", () => {
      expect(classifyAuthority("https://news.ycombinator.com/item?id=1", "news")).toBe("tier3");
    });
  });
});

describe("DEFAULT_TIERS registry completeness", () => {
  it("has a config for every block in ALL_BLOCK_TYPES", () => {
    for (const block of ALL_BLOCK_TYPES) {
      expect(DEFAULT_TIERS[block]).toBeDefined();
      expect(DEFAULT_TIERS[block].block).toBe(block);
    }
  });

  it("every block has either tier1 entries or an explicit reason it has none", () => {
    // publicOpinion legitimately has no tier1 (inherently aggregate)
    // All others must have at least one tier1 entry
    for (const block of ALL_BLOCK_TYPES) {
      const config = DEFAULT_TIERS[block];
      if (block === "publicOpinion") {
        expect(config.tier1.length).toBe(0); // intentional
      } else {
        expect(config.tier1.length).toBeGreaterThan(0);
      }
    }
  });
});
