/**
 * Authority tiers per diligence block — the "baked-in default allowlist" that
 * makes NodeBench credibility-first for non-technical users.
 *
 * Pattern: credibility-first defaults, post-satisfaction configuration.
 *          No user-authored ENTITY.md required before the first good report.
 *
 * Prior art:
 *   - ChatGPT: self-verified output with evidence + reasoning
 *   - Perplexity: inline citations with source attribution
 *   - Newsroom editorial policy + corrections — Tier 1 authority criterion
 *
 * See: docs/archive/2026-q1/architecture-superseded/BACKGROUND_MODE_AND_RELIABILITY.md
 *      .claude/rules/feedback_security.md (SSRF allowlist overlap)
 *      .claude/rules/async_reliability.md (authority health tracking)
 *      .claude/rules/grounded_eval.md (authority feeds confidence tiers)
 */

/**
 * Block identifier — the 10 canonical diligence blocks.
 * See docs/architecture/DILIGENCE_BLOCKS.md for the full taxonomy.
 */
export type BlockType =
  | "founder"
  | "product"
  | "funding"
  | "news"
  | "hiring"
  | "patent"
  | "publicOpinion"
  | "competitor"
  | "regulatory"
  | "financial";

/**
 * Authority tier — higher = more trusted. Drives confidence tier computation
 * when paired with source count and cross-source agreement.
 */
export type AuthorityTier = "tier1" | "tier2" | "tier3";

/**
 * Authority domain — a pattern that matches a source URL to a tier.
 * `match` can be an exact hostname or a suffix (e.g., "*.gov").
 */
export type AuthorityDomain = {
  match: string; // hostname or suffix pattern
  tier: AuthorityTier;
  note?: string; // human-readable reason for the tier
};

/**
 * Authority config for one block — Tier 1/2/3 allowlist plus DO-NOT-TRUST set.
 * User can override via ENTITY.md (power-user opt-in, post-satisfaction).
 */
export type BlockAuthorityConfig = {
  block: BlockType;
  tier1: AuthorityDomain[]; // official / canonical
  tier2: AuthorityDomain[]; // reputable press / trade publications
  tier3: AuthorityDomain[]; // community / low weight (always requires corroboration)
  denyList: string[]; // never quote directly from these (hostnames or suffix patterns)
};

// ── Block configs ─────────────────────────────────────────────────────

const FOUNDER: BlockAuthorityConfig = {
  block: "founder",
  tier1: [
    { match: "linkedin.com", tier: "tier1", note: "verified bios" },
    { match: "*.gov", tier: "tier1", note: "government filings" },
    { match: "sec.gov", tier: "tier1" },
    { match: "ycombinator.com", tier: "tier1", note: "YC company pages" },
    { match: "crunchbase.com", tier: "tier1", note: "team rosters" },
  ],
  tier2: [
    { match: "techcrunch.com", tier: "tier2" },
    { match: "bloomberg.com", tier: "tier2" },
    { match: "reuters.com", tier: "tier2" },
    { match: "wsj.com", tier: "tier2" },
    { match: "nytimes.com", tier: "tier2" },
  ],
  tier3: [
    { match: "news.ycombinator.com", tier: "tier3", note: "forum mentions require corroboration" },
    { match: "reddit.com", tier: "tier3" },
    { match: "twitter.com", tier: "tier3" },
    { match: "x.com", tier: "tier3" },
  ],
  denyList: [],
};

const PRODUCT: BlockAuthorityConfig = {
  block: "product",
  tier1: [
    { match: "producthunt.com", tier: "tier1" },
    { match: "apps.apple.com", tier: "tier1" },
    { match: "play.google.com", tier: "tier1" },
    // Company's own site is tier1 by default — added dynamically from entity URL
  ],
  tier2: [
    { match: "techcrunch.com", tier: "tier2" },
    { match: "theverge.com", tier: "tier2" },
    { match: "engadget.com", tier: "tier2" },
  ],
  tier3: [
    { match: "reddit.com", tier: "tier3" },
    { match: "news.ycombinator.com", tier: "tier3" },
  ],
  denyList: [],
};

const FUNDING: BlockAuthorityConfig = {
  block: "funding",
  tier1: [
    { match: "sec.gov", tier: "tier1", note: "Form D + EDGAR filings" },
    { match: "crunchbase.com", tier: "tier1" },
    // Company press release under their own domain is tier1
  ],
  tier2: [
    { match: "techcrunch.com", tier: "tier2", note: "round coverage" },
    { match: "bloomberg.com", tier: "tier2" },
    { match: "reuters.com", tier: "tier2" },
    { match: "wsj.com", tier: "tier2" },
    { match: "pitchbook.com", tier: "tier2", note: "free tier only in v1" },
  ],
  tier3: [
    { match: "news.ycombinator.com", tier: "tier3" },
    { match: "reddit.com", tier: "tier3", note: "speculation only — rejected by default" },
  ],
  denyList: [],
};

const NEWS: BlockAuthorityConfig = {
  block: "news",
  tier1: [
    { match: "reuters.com", tier: "tier1", note: "editorial policy + corrections" },
    { match: "bloomberg.com", tier: "tier1" },
    { match: "wsj.com", tier: "tier1" },
    { match: "ft.com", tier: "tier1" },
    { match: "apnews.com", tier: "tier1" },
    { match: "bbc.com", tier: "tier1" },
  ],
  tier2: [
    { match: "techcrunch.com", tier: "tier2" },
    { match: "theverge.com", tier: "tier2" },
    { match: "arstechnica.com", tier: "tier2" },
    { match: "wired.com", tier: "tier2" },
  ],
  tier3: [
    { match: "news.ycombinator.com", tier: "tier3", note: "aggregator — never quoted directly" },
    { match: "reddit.com", tier: "tier3" },
  ],
  denyList: [
    // Known content farms and syndication aggregators. Extend via ENTITY.md override.
  ],
};

const HIRING: BlockAuthorityConfig = {
  block: "hiring",
  tier1: [
    // Company careers page — added dynamically from entity URL
    { match: "linkedin.com", tier: "tier1", note: "posted-by-company jobs only" },
  ],
  tier2: [
    { match: "wellfound.com", tier: "tier2" },
    { match: "builtin.com", tier: "tier2" },
  ],
  tier3: [
    { match: "reddit.com", tier: "tier3" },
  ],
  denyList: [
    // v1: explicit no Glassdoor — TOS blocks scraping. Add only via paid license in v2.
    "glassdoor.com",
  ],
};

const PATENT: BlockAuthorityConfig = {
  block: "patent",
  tier1: [
    { match: "uspto.gov", tier: "tier1" },
    { match: "patents.google.com", tier: "tier1" },
    { match: "epo.org", tier: "tier1" },
    { match: "wipo.int", tier: "tier1" },
  ],
  tier2: [
    { match: "ieee.org", tier: "tier2" },
  ],
  tier3: [],
  denyList: [],
};

const PUBLIC_OPINION: BlockAuthorityConfig = {
  block: "publicOpinion",
  tier1: [
    // Public opinion inherently has no tier1 — always aggregate
  ],
  tier2: [
    { match: "news.ycombinator.com", tier: "tier2" },
    { match: "producthunt.com", tier: "tier2" },
  ],
  tier3: [
    { match: "reddit.com", tier: "tier3", note: "free API tier with rate limits" },
  ],
  denyList: [
    // v1: explicit no X/Twitter — paid API required
    "twitter.com",
    "x.com",
  ],
};

const COMPETITOR: BlockAuthorityConfig = {
  block: "competitor",
  tier1: [
    { match: "crunchbase.com", tier: "tier1" },
    { match: "producthunt.com", tier: "tier1" },
  ],
  tier2: [
    { match: "g2.com", tier: "tier2" },
    { match: "capterra.com", tier: "tier2" },
  ],
  tier3: [
    { match: "reddit.com", tier: "tier3" },
    { match: "news.ycombinator.com", tier: "tier3" },
  ],
  denyList: [],
};

const REGULATORY: BlockAuthorityConfig = {
  block: "regulatory",
  tier1: [
    { match: "sec.gov", tier: "tier1" },
    { match: "ftc.gov", tier: "tier1" },
    { match: "cfpb.gov", tier: "tier1" },
    { match: "courtlistener.com", tier: "tier1", note: "free PACER mirror" },
    { match: "justice.gov", tier: "tier1" },
    { match: "*.gov", tier: "tier1" },
  ],
  tier2: [
    { match: "law360.com", tier: "tier2" },
  ],
  tier3: [],
  denyList: [
    // PACER direct requires payment per page — prefer CourtListener free mirror
  ],
};

const FINANCIAL: BlockAuthorityConfig = {
  block: "financial",
  tier1: [
    { match: "sec.gov", tier: "tier1", note: "public filings only" },
  ],
  tier2: [],
  tier3: [],
  denyList: [
    // v1: no paid proxies
    "similarweb.com",
    "apptopia.com",
    "pitchbook.com", // explicit — paid tier only
  ],
};

// ── Registry ──────────────────────────────────────────────────────────

export const DEFAULT_TIERS: Record<BlockType, BlockAuthorityConfig> = {
  founder: FOUNDER,
  product: PRODUCT,
  funding: FUNDING,
  news: NEWS,
  hiring: HIRING,
  patent: PATENT,
  publicOpinion: PUBLIC_OPINION,
  competitor: COMPETITOR,
  regulatory: REGULATORY,
  financial: FINANCIAL,
};

/**
 * Classify a source URL against a block's authority config.
 *
 * Returns the tier if matched, or "denied" if on the deny list, or "unknown"
 * if no match (caller decides whether to treat as tier3 or skip).
 *
 * Matching rules:
 *  - Exact hostname match (e.g., "sec.gov" matches "www.sec.gov" via suffix normalization)
 *  - Wildcard prefix ("*.gov") matches any subdomain ending in ".gov"
 *  - Hostname normalization strips leading "www." and lowercases
 *  - **Most-specific match wins** — a longer pattern (e.g., "news.ycombinator.com")
 *    beats a shorter parent (e.g., "ycombinator.com"). This prevents subdomains
 *    from inheriting their parent's tier when they shouldn't (HN forum on YC's
 *    parent domain is the canonical example).
 */
export function classifyAuthority(
  url: string,
  block: BlockType,
): AuthorityTier | "denied" | "unknown" {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "unknown";
  }

  const config = DEFAULT_TIERS[block];

  // Collect every candidate match across deny + tier1 + tier2 + tier3 along with
  // its designation. Then pick the MOST SPECIFIC pattern (longest match string).
  type Candidate = {
    pattern: string;
    designation: AuthorityTier | "denied";
  };
  const candidates: Candidate[] = [];

  for (const deny of config.denyList) {
    if (matchesDomain(hostname, deny)) {
      candidates.push({ pattern: deny, designation: "denied" });
    }
  }
  for (const d of config.tier1) {
    if (matchesDomain(hostname, d.match)) {
      candidates.push({ pattern: d.match, designation: "tier1" });
    }
  }
  for (const d of config.tier2) {
    if (matchesDomain(hostname, d.match)) {
      candidates.push({ pattern: d.match, designation: "tier2" });
    }
  }
  for (const d of config.tier3) {
    if (matchesDomain(hostname, d.match)) {
      candidates.push({ pattern: d.match, designation: "tier3" });
    }
  }

  if (candidates.length === 0) return "unknown";

  // Sort by pattern length descending — most specific first.
  // Tie-breaker: deny > tier1 > tier2 > tier3 (safer designation wins).
  const designationOrder: Record<string, number> = {
    denied: 0,
    tier1: 1,
    tier2: 2,
    tier3: 3,
  };
  candidates.sort((a, b) => {
    if (b.pattern.length !== a.pattern.length) {
      return b.pattern.length - a.pattern.length;
    }
    return designationOrder[a.designation] - designationOrder[b.designation];
  });

  return candidates[0].designation;
}

/**
 * Domain-match helper.
 *  - Wildcard "*.example.com" matches "foo.example.com" but not "example.com"
 *    (intentional — the pattern expects a subdomain)
 *  - Non-wildcard "example.com" matches "example.com" AND "sub.example.com"
 *    (suffix match after www-stripping)
 */
function matchesDomain(hostname: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) {
    const suffix = p.slice(2);
    return hostname.endsWith("." + suffix);
  }
  return hostname === p || hostname.endsWith("." + p);
}

/**
 * List all blocks. Useful for iterating in tests + admin UIs.
 */
export const ALL_BLOCK_TYPES: readonly BlockType[] = [
  "founder",
  "product",
  "funding",
  "news",
  "hiring",
  "patent",
  "publicOpinion",
  "competitor",
  "regulatory",
  "financial",
] as const;
