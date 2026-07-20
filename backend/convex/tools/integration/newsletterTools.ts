/**
 * Newsletter & Topic Tools
 *
 * Tools for tracking hashtags (topics), building dossier metadata, and sending
 * a simple email digest. Designed for Fast Agent integration.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

/** Track a hashtag/topic for the current user (idempotent). */
export const trackTopic = createTool({
  description: `Track a hashtag/topic for daily monitoring.
Adds the hashtag to the user's tracked list (idempotent). Limits apply on free tier.`,
  args: z.object({
    hashtag: z.string().describe("Hashtag to track (without #)"),
  }),
  handler: async (ctx, { hashtag }): Promise<string> => {
    const normalized = hashtag.trim().replace(/^#/, '').toLowerCase();
    const preferences: any = await ctx.runQuery(api.domains.auth.userPreferences.getUserPreferences, {});
    const tracked: string[] = Array.isArray(preferences?.trackedHashtags) ? preferences.trackedHashtags : [];
    if (tracked.includes(normalized)) {
      return `✅ Already tracking #${normalized}. (${tracked.length} topic${tracked.length === 1 ? '' : 's'})`;
    }

    let cap = 4;
    try {
      const sub: any = await ctx.runQuery(api.domains.integrations.polar.getCurrentUserSubscription, {} as any);
      if (sub && sub.status === 'active') {
        cap = 50;
      }
    } catch (err) {
      console.warn('[trackTopic] Could not fetch subscription status', err);
    }

    if (tracked.length >= cap) {
      throw new Error(`Topic limit reached (${cap}). Please upgrade to add more in-depth coverage.`);
    }

    const next = [...tracked, normalized];
    await ctx.runMutation(api.domains.auth.userPreferences.updateUserPreferences, {
      trackedHashtags: next,
    });
    return `✅ Tracking #${normalized}. You now track ${next.length} topic${next.length === 1 ? '' : 's'}: ${next.map((h) => `#${h}`).join(', ')}`;
  },
});

export const listTrackedTopics = createTool({
  description: "List currently tracked hashtag topics.",
  args: z.object({}),
  handler: async (ctx) => {
    const prefs: any = await ctx.runQuery(api.domains.auth.userPreferences.getUserPreferences, {});
    const tracked: string[] = Array.isArray(prefs?.trackedHashtags) ? prefs.trackedHashtags : [];
    if (tracked.length === 0) {
      return "You are not tracking any topics right now.";
    }
    return `Currently tracking ${tracked.length} topic${tracked.length === 1 ? '' : 's'}: ${tracked.map((h) => `#${h}`).join(', ')}`;
  },
});

export const untrackTopic = createTool({
  description: "Remove a tracked hashtag/topic.",
  args: z.object({
    hashtag: z.string().describe("Hashtag to stop tracking"),
  }),
  handler: async (ctx, { hashtag }) => {
    const normalized = hashtag.trim().replace(/^#/, '').toLowerCase();
    const prefs: any = await ctx.runQuery(api.domains.auth.userPreferences.getUserPreferences, {});
    const tracked: string[] = Array.isArray(prefs?.trackedHashtags) ? prefs.trackedHashtags : [];
    if (!tracked.includes(normalized)) {
      return `#${normalized} is not currently tracked.`;
    }
    const next = tracked.filter((h) => h !== normalized);
    await ctx.runMutation(api.domains.auth.userPreferences.updateUserPreferences, {
      trackedHashtags: next,
    });
    return `Removed #${normalized}. Still tracking: ${next.length} topic${next.length === 1 ? '' : 's'}.`;
  },
});

/** Build dossier metadata (summary) for a given dossier document. */
export const buildDossierMetadataTool = createTool({
  description: `Build or refresh metadata summary for a dossier document (Quick Notes).`,
  args: z.object({
    dossierId: z.string().describe("Dossier documentId"),
  }),
  handler: async (ctx, { dossierId }): Promise<string> => {
    const result: any = await ctx.runAction(api.domains.ai.metadataAnalyzer.buildDossierMetadata, {
      dossierId: dossierId,
    });
    return `🪄 Dossier metadata updated. Quick Notes: ${result?.quickNotesId ?? 'n/a'}.`;
  },
});

/** Send a simple email digest for one or more hashtags. */
export const sendNewsletter = createTool({
  description: `Compose and send a simple email digest for one or more hashtags.
Ensures dossiers exist, refreshes metadata, then emails a text summary.`,
  args: z.object({
    hashtags: z.array(z.string()).describe("List of hashtags (without #)"),
    subject: z.string().optional().default('Your Nodebench Dossier Digest'),
    to: z.string().optional().describe('Recipient email; default is the user\'s email'),
  }),
  handler: async (ctx, { hashtags, subject, to }): Promise<string> => {
    const identity = await (ctx as any).auth.getUserIdentity?.();
    if (!identity) throw new Error('Not authenticated');
    const recipient = (to || identity.email || '').trim();
    if (!recipient) throw new Error('No recipient email on file');

    const sections: string[] = [];
    for (const raw of hashtags) {
      const tag = raw.trim().replace(/^#/, '').toLowerCase();
      const search: any = await ctx.runAction(api.domains.search.hashtagDossiers.searchForHashtag, { hashtag: tag });
      if (!search || search.totalCount === 0) {
        sections.push(`#${tag}\nNo documents found for this topic yet.`);
        continue;
      }
      const dossierId: any = await ctx.runMutation(api.domains.search.hashtagDossiers.createHashtagDossier, {
        hashtag: tag,
        matchedDocuments: search.matches,
      });
      await ctx.runAction(api.domains.ai.metadataAnalyzer.buildDossierMetadata, {
        dossierId: dossierId as Id<'documents'>,
      });

      let quickSummaryLines: string[] = [];
      try {
        const nodes = await ctx.runQuery(api.domains.knowledge.nodes.by_document, { docId: dossierId as Id<'documents'> });
        quickSummaryLines = (nodes as any[])
          .map((n) => String(n.text || '').trim())
          .filter(Boolean)
          .slice(0, 3)
          .map((line) => line.replace(/\s+/g, ' '));
      } catch (error) {
        console.warn('[sendNewsletter] Quick notes fetch failed', error);
      }

      const sourceLines = (search.matches || [])
        .slice(0, 5)
        .map((match: any, idx: number) => {
          const badge =
            match.matchType === 'hybrid' || match.matchType === 'hybrid-validated'
              ? '🎯'
              : match.matchType === 'exact-title'
              ? '📍'
              : match.matchType === 'exact-content'
              ? '📄'
              : match.matchType === 'semantic'
              ? '🔍'
              : '🧭';
          const snippet = match.snippet ? ` — ${match.snippet.slice(0, 100)}…` : '';
          return `${idx + 1}. ${badge} ${match.title || 'Untitled'} (${match.matchType || 'match'})${snippet}`;
        });

      const summary = quickSummaryLines.length > 0
        ? quickSummaryLines.join(' | ')
        : 'Digest refreshed — open the dossier for details.';

      sections.push(`## #${tag}
Summary:
${summary}
Sources:
${sourceLines.join('\n')}
Dossier: https://app.nodebench.ai/documents/${String(dossierId)}\n`);
    }

    const body = sections.join('\n\n---\n\n');
    const sent: any = await ctx.runAction(api.domains.integrations.email.sendEmail, {
      to: recipient,
      subject,
      body,
    });
    if (!sent?.success) throw new Error(sent?.error || 'Failed to send');
    return `📬 Sent digest to ${recipient}. id=${sent.id ?? 'n/a'}`;
  },
});
