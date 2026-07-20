"use node";

/**
 * LinkedIn Archive Edits
 *
 * One-time helpers to correct low-risk legacy text issues on LinkedIn by editing post commentary.
 * Default is dryRun=true and returns a preview list.
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

type ProposedEdit = {
  archiveRowId: string;
  postUrn: string;
  dateString: string;
  persona: string;
  postType: string;
  reason: string;
  afterText: string;
  beforeExcerpt: string;
  afterExcerpt: string;
};

function applyDemoUrlFix(text: string): { changed: boolean; updated: string } {
  let changed = false;
  const updated = text.replace(/https?:\/\/[^\s]+/g, (url) => {
    const lower = url.toLowerCase();
    if (lower.includes("example.com") || lower.includes("-demo")) {
      changed = true;
      return "https://accessdata.fda.gov";
    }
    return url;
  });
  return { changed, updated };
}

function applyRoundUnknownFix(text: string): { changed: boolean; updated: string } {
  const updated = text.replace(/\bRound:\s*Unknown\b/g, "Round: Undisclosed");
  return { changed: updated !== text, updated };
}

function applyUnknownPlaceholderFix(text: string): { changed: boolean; updated: string } {
  let updated = text;

  // Funding briefs often have a line like "Unknown - $250M"
  updated = updated.replace(/\bUnknown\s*-\s*\$/g, "Undisclosed - $");

  // Common placeholders
  updated = updated.replace(/\bUnknown Company\b/g, "Undisclosed company");
  updated = updated.replace(/\bCompany:\s*Unknown\b/g, "Company: Undisclosed");
  updated = updated.replace(/\bFunding:\s*Unknown Company\b/g, "Funding: Undisclosed company");

  // Uppercase variants
  updated = updated.replace(/\bUNKNOWN COMPANY\b/g, "Undisclosed company");

  return { changed: updated !== text, updated };
}

export const proposeAndApplyLegacyEdits = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    maxEdits: v.optional(v.number()),
    mode: v.optional(
      v.union(
        v.literal("round_unknown_to_undisclosed"),
        v.literal("unknown_placeholders_to_undisclosed"),
        v.literal("demo_urls_to_fda_accessdata"),
      )
    ),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const maxEdits = Math.min(Math.max(args.maxEdits ?? 25, 1), 250);
    const mode = args.mode ?? "round_unknown_to_undisclosed";

    const proposals: ProposedEdit[] = [];

    let cursor: string | undefined = undefined;
    for (let page = 0; page < 50 && proposals.length < maxEdits; page++) {
      const res = await ctx.runQuery(internal.domains.social.linkedinArchiveQueries.getArchivedPosts, {
        limit: 200,
        cursor,
        dedupe: true,
      });

      for (const row of res.posts as any[]) {
        const postUrn = typeof row.postId === "string" ? row.postId : "";
        if (!postUrn) continue;
        const content = String(row.content ?? "");

        let updated = content;
        let reason = "";
        if (mode === "round_unknown_to_undisclosed") {
          const fix = applyRoundUnknownFix(content);
          if (!fix.changed) continue;
          updated = fix.updated;
          reason = "Replace Round: Unknown with Round: Undisclosed";
        } else if (mode === "unknown_placeholders_to_undisclosed") {
          const fix = applyUnknownPlaceholderFix(content);
          if (!fix.changed) continue;
          updated = fix.updated;
          reason = "Replace Unknown placeholders with Undisclosed";
        } else if (mode === "demo_urls_to_fda_accessdata") {
          const fix = applyDemoUrlFix(content);
          if (!fix.changed) continue;
          updated = fix.updated;
          reason = "Replace demo/example URLs with accessdata.fda.gov";
        }

        // Skip edits that exceed LinkedIn's 3000 char limit (keep conservative headroom).
        if (updated.length > 2900) continue;

        proposals.push({
          archiveRowId: row._id,
          postUrn,
          dateString: row.dateString,
          persona: row.persona,
          postType: row.postType,
          reason,
          afterText: updated,
          beforeExcerpt: content.slice(0, 220),
          afterExcerpt: updated.slice(0, 220),
        });

        if (proposals.length >= maxEdits) break;
      }

      if (!res.hasMore) break;
      cursor = typeof res.nextCursor === "string" ? res.nextCursor : undefined;
    }

    const applied: Array<{ postUrn: string; success: boolean; archivePatched: boolean; error?: string }> = [];
    if (!dryRun) {
      for (const p of proposals) {
        const result = await ctx.runAction(internal.domains.social.linkedinPosting.updatePostText, {
          postUrn: p.postUrn,
          text: p.afterText,
          dryRun: false,
        });
        const ok = Boolean((result as any)?.success);
        const err = (result as any)?.error ? String((result as any).error) : undefined;

        // Keep Convex archive consistent whenever we can. If LinkedIn update fails due to
        // NOT_FOUND, still patch the archive so UI/QA does not regress on placeholder text.
        const shouldPatchArchive =
          ok ||
          (typeof err === "string" &&
            (err.includes("\"code\":\"NOT_FOUND\"") || err.includes("NOT_FOUND") || err.includes("status\":404")));

        if (shouldPatchArchive) {
          await ctx.runMutation(internal.domains.social.linkedinArchiveEditsMutations.patchArchiveRowContent, {
            archiveRowId: p.archiveRowId as any,
            content: p.afterText,
            metadataPatch: {
              editedAt: Date.now(),
              editReason: p.reason,
              editScope: ok ? "linkedin_and_archive" : "archive_only",
              ...(err ? { editError: err } : {}),
            },
          });
        }

        applied.push({ postUrn: p.postUrn, success: ok, archivePatched: shouldPatchArchive, error: err });
      }
    }

    return {
      dryRun,
      mode,
      proposed: proposals.length,
      proposals: proposals.map(({ afterText, ...rest }) => rest),
      applied,
    };
  },
});
