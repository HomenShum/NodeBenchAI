import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "../../_generated/api";
import { action, query } from "../../_generated/server";
import { refreshAccessTokenIfNeeded } from "../integrations/gmail";

type EntityWorkspace = {
  entity: {
    slug: string;
    name: string;
    summary: string;
    latestRevision?: number;
  };
  note?: { content?: string | null } | null;
  latest?: {
    _id?: string;
    title?: string;
    summary?: string;
    revision?: number;
    sections?: Array<{ id: string; title: string; body: string }>;
  } | null;
  timeline?: Array<{
    _id?: string;
    title?: string;
    summary?: string;
    revision?: number;
    sections?: Array<{ id: string; title: string; body: string }>;
  }>;
};

function findRevision(
  workspace: EntityWorkspace,
  revisionId?: string | null,
) {
  if (revisionId) {
    const match = workspace.timeline?.find((item) => String(item._id || "") === String(revisionId));
    if (match) return match;
  }
  return workspace.latest ?? workspace.timeline?.[0] ?? null;
}

function getSectionBody(
  revision: ReturnType<typeof findRevision>,
  sectionId: string,
  fallback: string,
) {
  return revision?.sections?.find((section) => section.id === sectionId)?.body?.trim() || fallback;
}

function encodeGmailRawEmail({
  to,
  subject,
  body,
}: {
  to: string;
  subject: string;
  body: string;
}) {
  const raw = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset="UTF-8"', "", body]
    .join("\r\n");

  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildOutreachDraftPayload(
  workspace: EntityWorkspace,
  revisionId?: string | null,
) {
  const current = findRevision(workspace, revisionId);
  const why = getSectionBody(current, "why-it-matters", current?.summary || workspace.entity.summary);
  const next = getSectionBody(
    current,
    "what-to-do-next",
    "Would like to compare notes and understand what changed most recently.",
  );
  const notes = workspace.note?.content?.trim();
  const subject = `${workspace.entity.name} follow-up`;
  const body = [
    "Hi,",
    "",
    `I have been keeping a running NodeBench memory on ${workspace.entity.name}.`,
    "",
    `Current read: ${why}`,
    "",
    `Next step: ${next}`,
    notes ? "" : "",
    notes ? `Notes: ${notes}` : "",
    "",
    `Share page: https://www.nodebenchai.com/entity/${encodeURIComponent(workspace.entity.slug)}`,
    "",
    "Best,",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, body, current };
}

function buildSlackBlocks(workspace: EntityWorkspace, revisionId?: string | null) {
  const { subject, body, current } = buildOutreachDraftPayload(workspace, revisionId);
  const what = getSectionBody(current, "what-it-is", workspace.entity.summary);
  const missing = getSectionBody(current, "what-is-missing", "No explicit gap captured yet.");

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${workspace.entity.name} memory update`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*What it is*\n${what}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Why it matters*\n${body.split("\n").find((line) => line.startsWith("Current read:"))?.replace("Current read: ", "") || workspace.entity.summary}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*What is missing*\n${missing}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Revision ${current?.revision ?? workspace.entity.latestRevision ?? "?"} • https://www.nodebenchai.com/entity/${encodeURIComponent(workspace.entity.slug)}`,
        },
      ],
    },
  ];
}

export const getDeliveryConnections = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        gmail: { connected: false },
        slack: { connected: false },
      };
    }

    const [gmail, slack] = await Promise.all([
      ctx.db.query("googleAccounts").withIndex("by_user", (q) => q.eq("userId", userId)).first(),
      ctx.db.query("slackAccounts").withIndex("by_user", (q) => q.eq("userId", userId)).first(),
    ]);

    return {
      gmail: {
        connected: Boolean(gmail),
        email: gmail?.email,
      },
      slack: {
        connected: Boolean(slack),
        teamName: slack?.teamName,
        channelId: slack?.authedUserId ?? slack?.botUserId,
      },
    };
  },
});

export const createGmailDraftForEntity = action({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    to: v.string(),
    revisionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { ok: false, error: "Sign in to create a Gmail draft." };
    }

    const workspace = (await ctx.runQuery(api.domains.product.entities.getEntityWorkspace, {
      anonymousSessionId: args.anonymousSessionId,
      entitySlug: args.entitySlug,
    })) as EntityWorkspace | null;

    if (!workspace) {
      return { ok: false, error: "Entity not found." };
    }

    const gmailAccount = await ctx.runQuery(internal.domains.integrations.gmail.getAccount, {});
    if (!gmailAccount) {
      return { ok: false, error: "Connect Gmail first." };
    }

    const accessToken = await refreshAccessTokenIfNeeded(ctx, gmailAccount);
    const draft = buildOutreachDraftPayload(workspace, args.revisionId);
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          raw: encodeGmailRawEmail({
            to: args.to,
            subject: draft.subject,
            body: draft.body,
          }),
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Gmail draft failed: ${response.status} ${errorText.slice(0, 180)}`.trim(),
      };
    }

    const payload = await response.json();
    await ctx.runMutation(internal.domains.product.nudges.createNudge, {
      ownerKey: `user:${String(userId)}`,
      type: "reply_draft_ready",
      title: `${workspace.entity.name} outreach draft ready`,
      summary: `A Gmail draft was created for ${args.to}. Reopen the entity memory or Gmail to continue.`,
      actionLabel: "Open entity",
      actionTargetSurface: "reports",
      actionTargetId: workspace.entity.slug,
    });

    return {
      ok: true,
      draftId: payload?.id ? String(payload.id) : undefined,
      subject: draft.subject,
      recipient: args.to,
    };
  },
});

export const sendEntityToSlack = action({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    revisionId: v.optional(v.string()),
    channelId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { ok: false, error: "Sign in to send to Slack." };
    }

    const workspace = (await ctx.runQuery(api.domains.product.entities.getEntityWorkspace, {
      anonymousSessionId: args.anonymousSessionId,
      entitySlug: args.entitySlug,
    })) as EntityWorkspace | null;

    if (!workspace) {
      return { ok: false, error: "Entity not found." };
    }

    const slackAccount = await ctx.runQuery(internal.domains.integrations.integrations.getSlackAccount, {});
    if (!slackAccount?.accessToken) {
      return { ok: false, error: "Connect Slack first." };
    }

    const channelId = args.channelId?.trim() || slackAccount.authedUserId || slackAccount.botUserId;
    if (!channelId) {
      return { ok: false, error: "Slack connection is missing a destination channel." };
    }

    const result = await ctx.runAction(internal.domains.integrations.slack.slackAgent.sendSlackMessage, {
      accessToken: slackAccount.accessToken,
      channelId,
      blocks: buildSlackBlocks(workspace, args.revisionId),
      text: `${workspace.entity.name} memory update`,
    });

    if (!result.ok) {
      return { ok: false, error: result.error || "Slack send failed." };
    }

    return {
      ok: true,
      ts: result.ts,
      channelId,
    };
  },
});
