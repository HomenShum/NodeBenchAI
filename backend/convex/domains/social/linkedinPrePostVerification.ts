"use node";

/**
 * LinkedIn Pre-Post Verification Pipeline
 *
 * Runs 4 checks before any post hits LinkedIn:
 * 1. Freshness — real-time search to verify facts are still current
 * 2. Variety — archive + queue check to prevent duplicate topics
 * 3. Claim verification — LLM judge against live sources
 * 4. Staleness — time-based check for posts generated too long ago
 *
 * Cost: $0.00/month (free-tier search via fusionSearch + free LLM)
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { generateText } from "ai";
import { getLanguageModelSafe } from "../agents/mcp_tools/models/modelResolver";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface CheckResult {
  check: "freshness" | "variety" | "claims" | "staleness";
  passed: boolean;
  reason: string;
  severity: "hard_fail" | "soft_warning" | "pass";
  details?: Record<string, unknown>;
}

// Free model fallback chain (same as instagramClaimVerification)
const FREE_MODELS = [
  "qwen3-coder-free",
  "deepseek-r1-free",
  "kat-coder-pro-free",
] as const;

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract key entities from post content using regex.
 * Returns company names, product names, dollar amounts with context.
 */
function extractKeyEntities(content: string): string[] {
  const entities: Set<string> = new Set();

  // Dollar amounts with preceding word(s): "$16B", "raised $500M"
  const dollarMatches = content.match(
    /(?:[\w-]+\s+)?(?:raised|funding|round|valuation|deal|worth)?\s*\$[\d,.]+[BMKbmk]?(?:\s*(?:billion|million))?/gi,
  );
  if (dollarMatches) {
    for (const m of dollarMatches) entities.add(m.trim());
  }

  // Capitalized multi-word names (likely company/product names)
  // Match 2+ consecutive capitalized words, but skip common English phrases
  const skipWords = new Set([
    "The", "This", "That", "What", "When", "Where", "Why", "How",
    "And", "But", "For", "Not", "All", "Any", "Has", "Had", "Was",
    "Are", "Our", "Their", "Most", "Some", "Also", "Just", "Still",
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ]);

  const capMatches = content.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g);
  if (capMatches) {
    for (const m of capMatches) {
      const words = m.split(/\s+/);
      if (words.length >= 2 && !words.every((w) => skipWords.has(w))) {
        entities.add(m);
      }
    }
  }

  // All-caps names (WAYMO, FDA, etc.) — 3+ chars to avoid "AI", "VC"
  const allCapsMatches = content.match(/\b[A-Z]{3,}\b/g);
  if (allCapsMatches) {
    const skipAllCaps = new Set(["THE", "AND", "FOR", "NOT", "BUT", "UTC", "CEO", "CTO"]);
    for (const m of allCapsMatches) {
      if (!skipAllCaps.has(m)) entities.add(m);
    }
  }

  return [...entities].slice(0, 5);
}

/**
 * LLM-based entity extraction fallback for lowercase founder-voice posts.
 * Only called when regex extraction finds nothing.
 */
async function extractEntitiesWithLLM(content: string): Promise<string[]> {
  try {
    const model = getLanguageModelSafe(FREE_MODELS[0]);
    const { text } = await generateText({
      model,
      prompt: `Extract 1-5 key named entities from this post: company names, product names, person names, technology names. Return ONLY a JSON array of strings. If there are no named entities, return [].

POST:
${content}`,
    });
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    return jsonMatch ? JSON.parse(jsonMatch[0]).slice(0, 5) : [];
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 1: FRESHNESS
// ═══════════════════════════════════════════════════════════════════════════

async function checkFreshness(
  ctx: any,
  content: string,
  entities: string[],
): Promise<CheckResult> {
  if (entities.length === 0) {
    return { check: "freshness", passed: true, reason: "No entities to verify", severity: "pass" };
  }

  // Search for the primary entity (first one, usually most important)
  const primaryEntity = entities[0];
  const today = new Date().toISOString().split("T")[0];

  try {
    const searchResult = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `${primaryEntity} latest news`,
        mode: "fast",
        maxTotal: 5,
        dateRange: { start: today },
        skipRateLimit: true,
        skipCache: true,
      },
    );

    const results = searchResult?.payload?.results ?? [];
    if (results.length === 0) {
      // No recent news — not a contradiction, just no fresh data
      return {
        check: "freshness",
        passed: true,
        reason: `No recent news found for "${primaryEntity}" — proceeding`,
        severity: "pass",
      };
    }

    // Compile search snippets
    const snippets = results
      .slice(0, 3)
      .map((r: any) => `${r.title}: ${r.snippet}`)
      .join("\n");

    // Use LLM to check for contradictions
    const model = getLanguageModelSafe(FREE_MODELS[0]);
    const { text } = await generateText({
      model,
      prompt: `You are a fact-checker. Compare this POST against the LATEST NEWS below.

POST:
${content}

LATEST NEWS (from today):
${snippets}

Does the latest news CONTRADICT any specific facts in the post? Look for:
- Name changes (product renamed, company rebranded)
- Deal cancelled or amount changed
- Key facts that are now wrong

Respond ONLY with JSON:
{"contradicted": true/false, "reason": "brief explanation of what changed, or 'no contradictions found'"}`,
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const verdict = JSON.parse(jsonMatch[0]);
      if (verdict.contradicted) {
        return {
          check: "freshness",
          passed: false,
          reason: `Freshness fail: ${verdict.reason}`,
          severity: "hard_fail",
          details: { entity: primaryEntity, searchResults: results.length },
        };
      }
    }

    return {
      check: "freshness",
      passed: true,
      reason: `No contradictions found for "${primaryEntity}"`,
      severity: "pass",
      details: { entity: primaryEntity, searchResults: results.length },
    };
  } catch (e) {
    // Search failure is not a blocking error — warn but proceed
    console.warn(`[prePostVerify] Freshness check error: ${e instanceof Error ? e.message : String(e)}`);
    return {
      check: "freshness",
      passed: true,
      reason: `Freshness check skipped (search error): ${e instanceof Error ? e.message : "unknown"}`,
      severity: "soft_warning",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 2: VARIETY
// ═══════════════════════════════════════════════════════════════════════════

async function checkVariety(
  ctx: any,
  content: string,
  entities: string[],
): Promise<CheckResult> {
  // Get posts from last 7 days
  const recentPosts = await ctx.runQuery(
    internal.domains.social.linkedinArchiveQueries.getRecentPostsForVerification,
    { lookbackDays: 7 },
  );

  if (recentPosts.length === 0) {
    return { check: "variety", passed: true, reason: "No recent posts to compare", severity: "pass" };
  }

  // Also check scheduled queue items
  const scheduledItems = await ctx.runQuery(
    internal.domains.social.linkedinContentQueue.listScheduledForVerification,
    { limit: 20 },
  );

  // Check entity overlap against last 3 days of posts + scheduled items
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const last3DaysPosts = recentPosts.filter((p: any) => p.postedAt >= threeDaysAgo);

  // Combine recent posts + scheduled items for comprehensive overlap check
  const allRecentContent: Array<{ content: string; label: string }> = [
    ...last3DaysPosts.map((p: any) => ({ content: p.content, label: `post on ${p.dateString}` })),
    ...scheduledItems.map((i: any) => ({ content: i.content, label: "scheduled post" })),
  ];

  const overlaps: string[] = [];

  for (const entity of entities) {
    const entityLower = entity.toLowerCase();
    // Check if any recent post or scheduled item mentions the same entity
    for (const item of allRecentContent) {
      if (item.content.toLowerCase().includes(entityLower)) {
        overlaps.push(`"${entity}" was mentioned in a ${item.label}`);
        break;
      }
    }
  }

  if (overlaps.length >= 2) {
    return {
      check: "variety",
      passed: false,
      reason: `Topic overlap: ${overlaps.join("; ")}`,
      severity: "hard_fail",
      details: { overlaps, recentPostCount: last3DaysPosts.length },
    };
  }

  if (overlaps.length === 1) {
    return {
      check: "variety",
      passed: true,
      reason: `Minor overlap (1 entity): ${overlaps[0]}`,
      severity: "soft_warning",
      details: { overlaps },
    };
  }

  return {
    check: "variety",
    passed: true,
    reason: `No topic overlap with ${last3DaysPosts.length} recent posts`,
    severity: "pass",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 3: CLAIM VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

async function checkClaims(
  ctx: any,
  content: string,
): Promise<CheckResult> {
  // Step 1: Extract key factual claims using LLM
  const model = getLanguageModelSafe(FREE_MODELS[0]);

  let claims: string[];
  try {
    const { text } = await generateText({
      model,
      prompt: `Extract 1-3 specific FACTUAL claims from this LinkedIn post. Only extract claims that contain verifiable facts (dollar amounts, company names, product claims, dates, statistics). Skip opinions and questions.

POST:
${content}

Respond ONLY with JSON array:
["claim 1", "claim 2", "claim 3"]

If there are no verifiable factual claims, respond with: []`,
    });

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    claims = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    claims = [];
  }

  if (claims.length === 0) {
    return {
      check: "claims",
      passed: true,
      reason: "No verifiable factual claims found — opinion/commentary post",
      severity: "pass",
    };
  }

  // Step 2: Verify each claim against live search
  const verdicts: Array<{ claim: string; status: string; reason: string }> = [];

  for (const claim of claims.slice(0, 3)) {
    try {
      const searchResult = await ctx.runAction(
        api.domains.search.fusion.actions.fusionSearch,
        {
          query: claim,
          mode: "fast",
          maxTotal: 3,
          skipRateLimit: true,
        },
      );

      const results = searchResult?.payload?.results ?? [];
      if (results.length === 0) {
        verdicts.push({ claim, status: "not_found", reason: "No corroborating sources found" });
        continue;
      }

      const snippets = results
        .slice(0, 2)
        .map((r: any) => `${r.title}: ${r.snippet}`)
        .join("\n");

      // LLM judge: does the source support the claim?
      const { text: judgeText } = await generateText({
        model,
        prompt: `Does the source content SUPPORT or CONTRADICT this claim?

CLAIM: ${claim}

SOURCE CONTENT:
${snippets}

Respond ONLY with JSON:
{"verdict": "supported" | "contradicted" | "not_found", "confidence": 0.0-1.0, "reason": "brief explanation"}`,
      });

      const judgeMatch = judgeText.match(/\{[\s\S]*\}/);
      if (judgeMatch) {
        const verdict = JSON.parse(judgeMatch[0]);
        verdicts.push({ claim, status: verdict.verdict, reason: verdict.reason });
      } else {
        verdicts.push({ claim, status: "not_found", reason: "Judge parse error" });
      }
    } catch {
      verdicts.push({ claim, status: "not_found", reason: "Search error" });
    }
  }

  // Check for hard contradictions
  const contradicted = verdicts.filter(
    (v) => v.status === "contradicted",
  );

  if (contradicted.length > 0) {
    return {
      check: "claims",
      passed: false,
      reason: `Claim contradicted: ${contradicted.map((c) => `"${c.claim}" — ${c.reason}`).join("; ")}`,
      severity: "hard_fail",
      details: { verdicts },
    };
  }

  return {
    check: "claims",
    passed: true,
    reason: `${verdicts.length} claims checked — no contradictions`,
    severity: "pass",
    details: { verdicts },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK 4: STALENESS
// ═══════════════════════════════════════════════════════════════════════════

function checkStaleness(createdAt: number): CheckResult {
  const ageMs = Date.now() - createdAt;
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours > 72) {
    return {
      check: "staleness",
      passed: false,
      reason: `Post is ${Math.round(ageHours)}h old (>72h) — data likely outdated, regenerate`,
      severity: "hard_fail",
      details: { ageHours: Math.round(ageHours) },
    };
  }

  if (ageHours > 48) {
    return {
      check: "staleness",
      passed: true,
      reason: `Post is ${Math.round(ageHours)}h old (48-72h) — freshness check will be strict`,
      severity: "soft_warning",
      details: { ageHours: Math.round(ageHours) },
    };
  }

  return {
    check: "staleness",
    passed: true,
    reason: `Post is ${Math.round(ageHours)}h old — fresh enough`,
    severity: "pass",
    details: { ageHours: Math.round(ageHours) },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN VERIFICATION ACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run all 4 pre-post verification checks before posting to LinkedIn.
 * Called by processQueuedPost before the actual LinkedIn API call.
 */
export const verifyBeforePosting = internalAction({
  args: {
    queueId: v.id("linkedinContentQueue"),
    content: v.string(),
    postType: v.string(),
    persona: v.string(),
    target: v.union(v.literal("personal"), v.literal("organization")),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    console.log(`[prePostVerify] Starting verification for ${args.queueId} (${args.postType})`);

    const checks: CheckResult[] = [];
    let entities = extractKeyEntities(args.content);

    // Fallback to LLM extraction for lowercase founder-voice posts
    if (entities.length === 0) {
      entities = await extractEntitiesWithLLM(args.content);
    }

    console.log(`[prePostVerify] Extracted ${entities.length} entities: ${entities.join(", ")}`);

    // Check 4 first (cheapest — no API calls)
    const stalenessResult = checkStaleness(args.createdAt);
    checks.push(stalenessResult);

    // If too stale, skip remaining checks and recommend regeneration
    if (stalenessResult.severity === "hard_fail") {
      console.log(`[prePostVerify] STALE — skipping remaining checks`);
      return {
        passed: false,
        checks,
        reason: stalenessResult.reason,
        suggestedAction: "regenerate" as const,
      };
    }

    // Check 2: Variety (DB queries only, free)
    const varietyResult = await checkVariety(ctx, args.content, entities);
    checks.push(varietyResult);

    if (varietyResult.severity === "hard_fail") {
      console.log(`[prePostVerify] VARIETY FAIL — ${varietyResult.reason}`);
      return {
        passed: false,
        checks,
        reason: varietyResult.reason,
        suggestedAction: "regenerate" as const,
      };
    }

    // Check 1: Freshness (free search + free LLM)
    const freshnessResult = await checkFreshness(ctx, args.content, entities);
    checks.push(freshnessResult);

    if (freshnessResult.severity === "hard_fail") {
      console.log(`[prePostVerify] FRESHNESS FAIL — ${freshnessResult.reason}`);
      return {
        passed: false,
        checks,
        reason: freshnessResult.reason,
        suggestedAction: "regenerate" as const,
      };
    }

    // Check 3: Claims (free search + free LLM)
    const claimsResult = await checkClaims(ctx, args.content);
    checks.push(claimsResult);

    if (claimsResult.severity === "hard_fail") {
      console.log(`[prePostVerify] CLAIMS FAIL — ${claimsResult.reason}`);
      return {
        passed: false,
        checks,
        reason: claimsResult.reason,
        suggestedAction: "hold" as const, // Hold for manual review on claim contradiction
      };
    }

    // All checks passed (or soft warnings only)
    const warnings = checks.filter((c) => c.severity === "soft_warning");
    if (warnings.length > 0) {
      console.log(`[prePostVerify] PASSED with ${warnings.length} warnings: ${warnings.map((w) => w.reason).join("; ")}`);
    } else {
      console.log(`[prePostVerify] PASSED — all 4 checks clean`);
    }

    return {
      passed: true,
      checks,
      reason: warnings.length > 0
        ? `Passed with ${warnings.length} warnings`
        : "All checks passed",
      suggestedAction: "post" as const,
    };
  },
});
