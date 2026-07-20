"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";

const CLEANUP_ANNOUNCEMENT_TAG = "linkedin_archive_cleanup_notice_v1";

function isoDateString(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildCleanupAnnouncementText(nowMs: number): string {
  const date = isoDateString(nowMs);
  return [
    `Maintenance note (${date})`,
    "",
    "If you have seen repeated posts or placeholder company names, we shipped fixes:",
    "- Idempotency guardrails to prevent repeat posts on retries or cron overlap",
    "- Archive query/UI now hides exact duplicates by default",
    "- Funding company enrichment hardening to avoid \"Unknown\" leaking into output",
    "- Demo/mock paths disabled by default in production workflows",
    "",
    "Next step:",
    "- We will remove duplicate archive rows",
    "- We will only attempt LinkedIn deletes for duplicates that are provably safe (post URN referenced by one exact content key only)",
    "",
    "If you spot a wrong or confusing post, reply with the URL and we will correct it with an edit or a follow up post.",
  ].join("\n");
}

/**
 * Posts a cleanup announcement and logs it to linkedinPostArchive.
 * This is intended to be run before any destructive cleanup.
 */
export const postCleanupAnnouncement = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    persona: v.optional(v.string()),
    text: v.optional(v.string()),
    includeAuditSummary: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const persona = args.persona ?? "SYSTEM";
    const now = Date.now();
    const dateString = isoDateString(now);
    const includeAuditSummary = args.includeAuditSummary ?? true;

    let text = (typeof args.text === "string" && args.text.trim().length > 0)
      ? args.text.trim()
      : buildCleanupAnnouncementText(now);

    if (includeAuditSummary && typeof args.text !== "string") {
      const audit = await ctx.runAction(internal.domains.social.linkedinArchiveAudit.runArchiveAudit, {
        pageSize: 200,
        maxRows: 200000,
        includeSamples: false,
      });
      const auditLine = [
        "Audit snapshot:",
        `archiveRows=${(audit as any)?.scanned ?? "n/a"}`,
        `duplicateRows=${(audit as any)?.duplicates?.duplicateRows ?? "n/a"}`,
        `duplicateGroups=${(audit as any)?.duplicates?.duplicateGroups ?? "n/a"}`,
        `reusedPostUrns=${(audit as any)?.postUrnReuse?.reusedPostUrns ?? "n/a"}`,
        `unknownCompany=${(audit as any)?.issues?.unknownCompany ?? "n/a"}`,
      ].join(" ");
      text = `${text}\n\n${auditLine}`.slice(0, 3000);
    }

    const existing = await ctx.runQuery(internal.workflows.dailyLinkedInPostMutations.findArchiveMatchForDatePersonaType, {
      dateString,
      persona,
      postType: "maintenance_notice",
      content: text,
    });
    if (existing.exactMatchId) {
      return { dryRun: true, alreadyExists: true, dateString, persona, tag: CLEANUP_ANNOUNCEMENT_TAG };
    }

    let postId: string | undefined;
    let postUrl: string | undefined;
    if (!dryRun) {
      const res = await ctx.runAction(internal.domains.social.linkedinPosting.createTargetedTextPost, { text, target: "organization" as const });
      if (!res.success) {
        return { dryRun, posted: false, error: res.error ?? "LinkedIn post failed", dateString, persona, tag: CLEANUP_ANNOUNCEMENT_TAG };
      }
      postId = res.postUrn;
      postUrl = res.postUrl;
    }

    const logged = await ctx.runMutation(internal.workflows.dailyLinkedInPostMutations.logLinkedInPost, {
      dateString,
      persona,
      postId,
      postUrl,
      content: text,
      factCheckCount: 0,
      postType: "maintenance_notice",
      metadata: {
        tag: CLEANUP_ANNOUNCEMENT_TAG,
        createdAt: now,
        kind: "archive_cleanup_notice",
        fixes: [
          "idempotency_guardrails",
          "archive_dedupe_ui",
          "company_name_enrichment_hardening",
          "demo_data_disabled",
          "safe_delete_plan",
        ],
      },
    });

    return { dryRun, posted: !dryRun, dateString, persona, postId, postUrl, archiveRowId: logged.id, tag: CLEANUP_ANNOUNCEMENT_TAG };
  },
});
