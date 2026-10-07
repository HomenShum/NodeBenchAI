"use node";

/**
 * Legacy Unknown Company Fixes
 *
 * Goal:
 * - Find LinkedIn posts containing placeholder company names
 * - Propose a corrected version with sources and publishedAtIso when possible
 * - Validate with boolean checks + LLM judge (JSON pass/fail)
 * - Apply via LinkedIn edit when safe, otherwise post a correction note
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

type ArchiveRow = {
  _id: Id<"linkedinPostArchive">;
  dateString: string;
  persona: string;
  postType: string;
  content: string;
  postId?: string;
  postUrl?: string;
  metadata?: any;
  postedAt: number;
};

type SourceUsed = { url: string; title?: string; publishedAtIso?: string; excerpt?: string };

function extractUrls(text: string): string[] {
  const out = new Set<string>();
  const re = /https?:\/\/[^\s)\]]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const url = String(m[0]).trim().replace(/[.,]+$/, "");
    if (url) out.add(url);
  }
  return [...out];
}

function hasEmDash(text: string): boolean {
  return /\u2014|\u2013/.test(text);
}

function hasUnknownCompany(text: string): boolean {
  return (
    /\bUnknown Company\b/i.test(text) ||
    /\bCompany:\s*Unknown\b/i.test(text) ||
    /\bFunding:\s*Unknown\b/i.test(text) ||
    /\bUnknown\s*-\s*\$\d/i.test(text) ||
    /\bUNKNOWN COMPANY\b/i.test(text)
  );
}

function normalizeRoundType(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (t === "pre-seed" || t === "preseed") return "pre-seed";
  if (t === "seed") return "seed";
  if (t === "series-a" || t === "series a") return "series-a";
  if (t === "series-b" || t === "series b") return "series-b";
  if (t === "series-c" || t === "series c") return "series-c";
  if (t === "series-d-plus" || t === "series d+" || t === "series d-plus") return "series-d-plus";
  if (t === "growth") return "growth";
  if (t === "debt") return "debt";
  return "unknown";
}

function parseMoneyToUsdCents(raw: string, suffix: string | null): number | null {
  const n = Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const s = (suffix ?? "").toUpperCase();
  const mult =
    s === "B" ? 1_000_000_000 :
    s === "M" ? 1_000_000 :
    s === "K" ? 1_000 :
    1;
  return Math.round(n * mult * 100);
}

function computeBooleanChecks(args: {
  beforeText: string;
  afterText: string;
  sourcesUsed: SourceUsed[];
  claimsSpecificCompany: boolean;
}): {
  noEmDash: boolean;
  removedUnknownCompany: boolean;
  under3000: boolean;
  hasSourcesForCompanyClaim: boolean;
  allSourcesHavePublishedAtIso: boolean;
} {
  const noEmDash = !hasEmDash(args.afterText);
  const removedUnknownCompany = !hasUnknownCompany(args.afterText);
  const under3000 = args.afterText.length <= 3000;
  const hasSourcesForCompanyClaim = args.claimsSpecificCompany ? args.sourcesUsed.length > 0 : true;
  const allSourcesHavePublishedAtIso = args.sourcesUsed.every((s) => typeof s.publishedAtIso === "string" && s.publishedAtIso.length > 0);
  return { noEmDash, removedUnknownCompany, under3000, hasSourcesForCompanyClaim, allSourcesHavePublishedAtIso };
}

function safeJsonParse<T>(text: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function extractLikelyJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function renderCorrectionText(args: {
  header: string;
  body: string;
  sourcesUsed: SourceUsed[];
  nowIso: string;
}): string {
  const lines: string[] = [];
  lines.push(args.header);
  lines.push("");
  lines.push(args.body.trim());

  if (args.sourcesUsed.length > 0) {
    lines.push("");
    lines.push("Sources:");
    for (const s of args.sourcesUsed.slice(0, 5)) {
      const pub = s.publishedAtIso ? `published ${s.publishedAtIso}` : "published unknown";
      lines.push(`- ${s.url} (${pub})`);
    }
  }

  lines.push("");
  lines.push(`Correction applied ${args.nowIso}`);
  return lines.join("\n").replace(/\u2014|\u2013/g, "-").slice(0, 3000);
}

export const runUnknownCompanyFixes = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    maxItems: v.optional(v.number()),
    preferEdit: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const maxItems = Math.min(Math.max(args.maxItems ?? 25, 1), 200);
    const preferEdit = args.preferEdit ?? true;

    // 1) Scan archive for unknown company rows (deduped for UI-like behavior)
    const all: ArchiveRow[] = [];
    let cursor: string | undefined = undefined;
    for (let page = 0; page < 50; page++) {
      const res = await ctx.runQuery(internal.domains.social.linkedinArchiveQueries.getArchivedPosts, {
        limit: 200,
        cursor,
        dedupe: true,
      });
      for (const row of res.posts as any[]) all.push(row as any);
      if (!res.hasMore) break;
      cursor = typeof res.nextCursor === "string" ? res.nextCursor : undefined;
      if (!cursor) break;
    }

    const unknownRows = all.filter((r) => hasUnknownCompany(r.content));
    const byUrn = new Map<string, ArchiveRow[]>();
    for (const r of unknownRows) {
      const urn = typeof r.postId === "string" ? r.postId : "";
      if (!urn) continue;
      const arr = byUrn.get(urn) ?? [];
      arr.push(r);
      byUrn.set(urn, arr);
    }

    const targetUrns = [...byUrn.keys()].slice(0, maxItems);

    // 2) Fetch live LinkedIn post content when possible
    const fetched = await ctx.runAction(internal.domains.social.linkedinPosting.fetchPosts, {
      postUrns: targetUrns,
      maxFetch: maxItems,
      delayMs: 250,
    });

    const liveByUrn = new Map<string, string>();
    const fetchErrors: Array<{ postUrn: string; error: string }> = [];
    for (const r of (fetched as any).results as any[]) {
      if (r.success && r.postUrn) {
        const commentary = String(r.post?.commentary ?? r.post?.commentaryText ?? "");
        if (commentary) liveByUrn.set(String(r.postUrn), commentary);
      } else if (r.postUrn) {
        fetchErrors.push({ postUrn: String(r.postUrn), error: String(r.error ?? "fetch_failed") });
      }
    }

    // 3) Determine postUrn reuse risk from archive
    const urnToDistinctContents = new Map<string, Set<string>>();
    for (const r of unknownRows) {
      const urn = String(r.postId ?? "");
      if (!urn) continue;
      const set = urnToDistinctContents.get(urn) ?? new Set<string>();
      set.add(`${r.content.length}:${r.content.slice(0, 80)}`);
      urnToDistinctContents.set(urn, set);
    }
    const isUrnReused = (urn: string) => (urnToDistinctContents.get(urn)?.size ?? 0) > 1;

    // 4) Build proposals
    const nowIso = new Date().toISOString();
    const proposals: any[] = [];

    for (const urn of targetUrns) {
      const sample = byUrn.get(urn)?.[0];
      if (!sample) continue;

      const beforeText = liveByUrn.get(urn) ?? sample.content;
      const urls = extractUrls(beforeText);

      let resolvedCompany: string | null = null;
      let sourcesUsed: SourceUsed[] = [];
      let body = beforeText;

      const isFunding = sample.postType === "funding_brief" || sample.postType === "funding_tracker";
      const isFda = sample.postType === "fda" || sample.persona === "FDA";

      if (isFunding) {
        // Try fundingEvents lookup by amount/round when present.
        const m = /Funding:\s*Unknown Company\s*\(\$?([0-9.,]+)\s*([MBK]?)\)\s*--\s*([a-zA-Z0-9+\- ]+)/i.exec(beforeText);
        const amountUsd = m ? parseMoneyToUsdCents(m[1], m[2] || null) : null;
        const roundType = normalizeRoundType(m ? m[3] : null);

        if (amountUsd && roundType) {
          const candidates = await ctx.runQuery(internal.domains.social.linkedinLegacyLookupQueries.getFundingEventsNearDate, {
            dateString: sample.dateString,
            daysBefore: 3,
            daysAfter: 3,
            roundType,
            minConfidence: 0.7,
          });

          const scored = (candidates as any[]).map((c) => {
            const diff = typeof c.amountUsd === "number" ? Math.abs(c.amountUsd - amountUsd) : Number.POSITIVE_INFINITY;
            const rel = Number.isFinite(diff) ? diff / Math.max(amountUsd, 1) : 999;
            const ok = rel <= 0.1;
            const score = (typeof c.confidence === "number" ? c.confidence : 0) - rel;
            return { c, rel, ok, score };
          }).filter((x) => x.ok).sort((a, b) => b.score - a.score);

          const best = scored[0]?.c;
          const second = scored[1]?.c;
          const bestIsUnique = !!best && (!second || (scored[0].score - scored[1].score) >= 0.15);

          if (best && bestIsUnique && typeof best.companyName === "string" && best.companyName.trim().length > 0) {
            resolvedCompany = best.companyName.trim();
            const srcs: string[] = Array.isArray(best.sourceUrls) ? best.sourceUrls : [];
            if (srcs.length > 0) {
              const prepared = await ctx.runAction(internal.domains.narrative.didYouKnowSources.fetchSourcesForDidYouKnow, {
                urls: srcs.slice(0, 5),
                workflowId: `linkedin_unknown_company_fix_${Date.now()}`,
                preferLinkup: true,
                maxUrls: 5,
              });
              sourcesUsed = (prepared as any[]).map((s) => ({
                url: s.url,
                title: s.title,
                publishedAtIso: s.publishedAtIso,
                excerpt: s.excerpt,
              }));
            }
          }
        }

        if (resolvedCompany) {
          body = beforeText.replace(/Funding:\s*Unknown Company/gi, `Funding: ${resolvedCompany}`);
        } else {
          body = beforeText
            .replace(/Funding:\s*Unknown Company/gi, "Funding: Undisclosed company")
            .replace(/\bUnknown Company\b/gi, "Undisclosed company")
            .replace(/\bUnknown\s*-\s*\$/gi, "Undisclosed - $");
        }
      } else if (isFda) {
        const ref = /Reference:\s*([A-Z0-9\-]+)/i.exec(beforeText)?.[1]?.trim() ?? null;
        if (ref) {
          const cache = await ctx.runQuery(internal.domains.social.linkedinLegacyLookupQueries.getFdaCacheByReference, {
            referenceNumber: ref,
          });
          const entityName = typeof (cache as any)?.entityName === "string" ? String((cache as any).entityName).trim() : "";
          if (entityName) resolvedCompany = entityName;
        }

        if (resolvedCompany) {
          body = beforeText.replace(/\bCompany:\s*Unknown\b/gi, `Company: ${resolvedCompany}`);
        } else {
          body = beforeText
            .replace(/\bCompany:\s*Unknown\b/gi, "Company: Undisclosed")
            .replace(/\bUnknown Company\b/gi, "Undisclosed company");
        }

        // Try to attach sources from URLs if present.
        if (urls.length > 0) {
          const prepared = await ctx.runAction(internal.domains.narrative.didYouKnowSources.fetchSourcesForDidYouKnow, {
            urls: urls.slice(0, 5),
            workflowId: `linkedin_unknown_company_fix_${Date.now()}`,
            preferLinkup: true,
            maxUrls: 5,
          });
          sourcesUsed = (prepared as any[]).map((s) => ({
            url: s.url,
            title: s.title,
            publishedAtIso: s.publishedAtIso,
            excerpt: s.excerpt,
          }));
        }
      } else {
        body = beforeText
          .replace(/\bUnknown Company\b/gi, "Undisclosed company")
          .replace(/\bCompany:\s*Unknown\b/gi, "Company: Undisclosed")
          .replace(/\bFunding:\s*Unknown\b/gi, "Funding: Undisclosed")
          .replace(/\bUnknown\s*-\s*\$/gi, "Undisclosed - $");
        if (urls.length > 0) {
          const prepared = await ctx.runAction(internal.domains.narrative.didYouKnowSources.fetchSourcesForDidYouKnow, {
            urls: urls.slice(0, 5),
            workflowId: `linkedin_unknown_company_fix_${Date.now()}`,
            preferLinkup: true,
            maxUrls: 5,
          });
          sourcesUsed = (prepared as any[]).map((s) => ({
            url: s.url,
            title: s.title,
            publishedAtIso: s.publishedAtIso,
            excerpt: s.excerpt,
          }));
        }
      }

      const claimsSpecificCompany = !!resolvedCompany && resolvedCompany !== "FDA";
      const afterText = renderCorrectionText({
        header: "Update",
        body,
        sourcesUsed,
        nowIso,
      });

      const checks = computeBooleanChecks({ beforeText, afterText, sourcesUsed, claimsSpecificCompany });
      const deterministicPassed =
        checks.noEmDash &&
        checks.removedUnknownCompany &&
        checks.under3000 &&
        checks.hasSourcesForCompanyClaim &&
        checks.allSourcesHavePublishedAtIso;

      const judgeResponse = await ctx.runAction(internal.domains.models.autonomousModelResolver.executeWithFallback, {
        taskType: "validation",
        messages: [
          {
            role: "system",
            content:
              "You are a strict validator for correcting a legacy LinkedIn post that contained a placeholder company name. " +
              "Rules: " +
              "1) No invented facts beyond provided excerpts. " +
              "2) If a specific company name is introduced, it must appear in at least one excerpt or be directly implied by a structured funding record. " +
              "3) If company cannot be resolved, use Undisclosed and do not claim identity. " +
              "4) No em or en dashes. " +
              "Return JSON only: {\"passed\": boolean, \"reasons\": string[]} and reasons MUST be non-empty.",
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                beforeText,
                afterText,
                sourcesUsed: sourcesUsed.map((s) => ({ url: s.url, title: s.title, publishedAtIso: s.publishedAtIso, excerpt: s.excerpt })),
                deterministicChecks: checks,
                claimsSpecificCompany,
              },
              null,
              2,
            ),
          },
        ],
        maxTokens: 400,
        temperature: 0,
      });
      const judgeModelUsed = String((judgeResponse as any).modelUsed ?? "");

    let parsed = safeJsonParse<{ passed: boolean; reasons?: string[] }>((judgeResponse as any).content);
    if (!parsed.ok) {
      const extracted = extractLikelyJsonObject((judgeResponse as any).content);
      if (extracted) parsed = safeJsonParse<{ passed: boolean; reasons?: string[] }>(extracted);
    }
      const llmPassed = parsed.ok ? !!(parsed.value as any).passed : false;
      const reasons = parsed.ok && Array.isArray((parsed.value as any).reasons)
        ? (parsed.value as any).reasons.map(String)
        : [];
      const parseError = parsed.ok ? undefined : parsed.error;

      // Do not edit if we cannot read the live post body. Fall back to a correction post instead.
      const safeToEdit = preferEdit && !isUrnReused(urn) && String(urn).startsWith("urn:li:") && liveByUrn.has(urn);

      proposals.push({
        postUrn: urn,
        dateString: sample.dateString,
        postType: sample.postType,
        persona: sample.persona,
        safeToEdit,
        deterministicPassed,
        llmJudgePassed: llmPassed,
        checks,
        reasons,
        parseError,
        judgeModelUsed,
        beforeExcerpt: beforeText.slice(0, 220),
        afterExcerpt: afterText.slice(0, 220),
        sourcesUsed: sourcesUsed.map((s) => ({ url: s.url, title: s.title, publishedAtIso: s.publishedAtIso })),
        afterText,
      });
    }

    // 5) Apply
    const applied: Array<{ postUrn: string; action: string; success: boolean; error?: string }> = [];
    if (!dryRun) {
      for (const p of proposals) {
        const passed = Boolean(p.deterministicPassed) && Boolean(p.llmJudgePassed);
        if (!passed) {
          applied.push({ postUrn: p.postUrn, action: "skip_failed_validation", success: false, error: (p.reasons ?? []).join("; ") || p.parseError || "validation_failed" });
          continue;
        }

        if (p.safeToEdit) {
          const result = await ctx.runAction(internal.domains.social.linkedinPosting.updatePostText, {
            postUrn: p.postUrn,
            text: p.afterText,
            dryRun: false,
          });
          applied.push({ postUrn: p.postUrn, action: "edit_post", success: Boolean((result as any)?.success), error: (result as any)?.error });
        } else {
          const text = p.afterText;
          const res = await ctx.runAction(internal.domains.social.linkedinPosting.createTargetedTextPost, { text, target: "organization" as const });
          if (!(res as any).success) {
            applied.push({ postUrn: p.postUrn, action: "post_correction", success: false, error: String((res as any).error ?? "post_failed") });
            continue;
          }

          await ctx.runMutation(internal.workflows.dailyLinkedInPostMutations.logLinkedInPost, {
            dateString: new Date().toISOString().slice(0, 10),
            persona: "SYSTEM",
            postId: (res as any).postUrn,
            postUrl: (res as any).postUrl,
            content: text,
            factCheckCount: 0,
            postType: "maintenance_correction",
            metadata: {
              kind: "legacy_unknown_company_correction",
              targetPostUrn: p.postUrn,
              deterministicChecks: p.checks,
              llmJudge: { passed: p.llmJudgePassed, reasons: p.reasons, parseError: p.parseError, modelUsed: p.judgeModelUsed },
              sourcesUsed: p.sourcesUsed,
              createdAt: Date.now(),
            },
          });
          applied.push({ postUrn: p.postUrn, action: "post_correction", success: true });
        }
      }
    }

    // Remove afterText from returned proposals for brevity.
    const proposalSummary = proposals.map(({ afterText, ...rest }) => rest);

    return {
      dryRun,
      scanned: all.length,
      unknownRows: unknownRows.length,
      uniquePostUrns: targetUrns.length,
      fetchSucceeded: (fetched as any).succeeded,
      fetchFailed: (fetched as any).failed,
      fetchErrors,
      proposals: proposalSummary,
      applied,
    };
  },
});
