import {
  action,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api, internal } from "../../_generated/api";
import {
  getActiveEntityWorkspaceInviteByToken,
  getActiveEntityWorkspaceMemberByToken,
  getActiveEntityWorkspaceShareByToken,
  getActivePublicEntityShareByToken,
  listActiveEntityWorkspaceShares,
  normalizeWorkspaceEmail,
  requireAuthenticatedProductIdentity,
  requireProductIdentity,
} from "./helpers";
import {
  productWorkspaceInviteDeliveryStatusValidator,
  productWorkspaceShareAccessValidator,
} from "./schema";

function createWorkspaceShareToken(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function createWorkspaceInviteToken() {
  return createWorkspaceShareToken("ewi");
}

function createWorkspaceMemberToken() {
  return createWorkspaceShareToken("ewm");
}

function resolveWorkspaceAppOrigin() {
  const base =
    process.env.APP_URL?.trim() ||
    process.env.CONVEX_SITE_URL?.trim() ||
    "https://www.nodebenchai.com";
  return base.replace(/\/+$/, "");
}

function buildAbsoluteWorkspaceUrl(
  entitySlug: string,
  token: string,
  kind: "invite" | "share",
) {
  const encodedSlug = encodeURIComponent(entitySlug);
  const encodedToken = encodeURIComponent(token);
  const suffix = kind === "invite" ? `?invite=${encodedToken}` : `?share=${encodedToken}`;
  return `${resolveWorkspaceAppOrigin()}/entity/${encodedSlug}${suffix}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function accessLabel(access: "view" | "edit") {
  return access === "edit" ? "Can edit" : "Can view";
}

function buildWorkspaceInviteEmail(args: {
  inviterName: string;
  entityName: string;
  access: "view" | "edit";
  url: string;
  kind: "member" | "invite";
}) {
  const actionLabel = args.access === "edit" ? "open and edit" : "open";
  const joinLabel = args.kind === "invite" ? "Join workspace" : "Open workspace";
  const accessBadge = accessLabel(args.access);
  const safeInviterName = escapeHtml(args.inviterName);
  const safeEntityName = escapeHtml(args.entityName);
  const safeUrl = escapeHtml(args.url);
  return {
    subject: `${args.inviterName} invited you to ${args.entityName} in NodeBench`,
    html: `
      <div style="font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f6f4ef;padding:32px;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e2d7;border-radius:24px;padding:32px;">
          <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#8c725d;font-weight:700;">NodeBench workspace invite</div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.15;color:#181511;">${safeEntityName}</h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:#4a4137;">
            <strong>${safeInviterName}</strong> gave you <strong>${accessBadge}</strong> access. You can ${actionLabel} the research workspace directly.
          </p>
          <div style="margin-top:20px;padding:14px 16px;border-radius:16px;background:#f8f3ea;color:#6b5643;font-size:13px;line-height:1.6;">
            This link opens the exact entity workspace, not a generic home screen.
          </div>
          <div style="margin-top:24px;">
            <a href="${safeUrl}" style="display:inline-block;background:#d97757;color:#fff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:999px;">
              ${joinLabel}
            </a>
          </div>
          <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#6b6258;">
            If the button does not work, copy and paste this link:<br />
            <a href="${safeUrl}" style="color:#b45f44;word-break:break-all;">${safeUrl}</a>
          </p>
        </div>
      </div>
    `,
  };
}

function isValidWorkspaceInviteEmail(value: string) {
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value.trim());
}

async function getOwnerEntityOrThrow(
  ctx: MutationCtx,
  ownerKey: string,
  entitySlug: string,
) {
  const entity = await ctx.db
    .query("productEntities")
    .withIndex("by_owner_slug", (q) => q.eq("ownerKey", ownerKey).eq("slug", entitySlug))
    .first();
  if (!entity) {
    throw new Error("Entity not found");
  }
  return entity;
}

async function getUserByEmail(
  ctx: MutationCtx,
  normalizedEmail: string,
) {
  const user = await ctx.db
    .query("users")
    .filter((q) => q.eq(q.field("email"), normalizedEmail))
    .first();
  return user ?? null;
}

async function getUserById(
  ctx: MutationCtx,
  userId: Id<"users">,
) {
  return (await ctx.db.get(userId)) as Doc<"users"> | null;
}

async function getActiveMemberForUser(
  ctx: MutationCtx | QueryCtx,
  ownerKey: string,
  entityId: Id<"productEntities">,
  userId: Id<"users">,
) {
  const members = await ctx.db
    .query("productEntityWorkspaceMembers")
    .withIndex("by_owner_entity_user", (q) =>
      q.eq("ownerKey", ownerKey).eq("entityId", entityId).eq("userId", userId),
    )
    .collect();
  return members.find((member) => !member.revokedAt) ?? null;
}

async function getActiveInviteForEmail(
  ctx: MutationCtx,
  ownerKey: string,
  entityId: Id<"productEntities">,
  normalizedEmail: string,
) {
  const invites = await ctx.db
    .query("productEntityWorkspaceInvites")
    .withIndex("by_owner_entity_email", (q) =>
      q.eq("ownerKey", ownerKey).eq("entityId", entityId).eq("normalizedEmail", normalizedEmail),
    )
    .collect();
  return invites.find((invite) => !invite.revokedAt && invite.status === "pending") ?? null;
}

type UpsertCollaboratorResult = {
  kind: "member" | "invite";
  email: string;
  access: "view" | "edit";
  token: string;
  entitySlug: string;
  entityName: string;
  rowId: Id<"productEntityWorkspaceMembers"> | Id<"productEntityWorkspaceInvites">;
};

async function upsertEntityWorkspaceCollaboratorRecord(
  ctx: MutationCtx,
  args: {
    ownerKey: string;
    invitedByUserId: Id<"users">;
    entitySlug: string;
    email: string;
    access: "view" | "edit";
  },
): Promise<UpsertCollaboratorResult> {
  const entity = await getOwnerEntityOrThrow(ctx, args.ownerKey, args.entitySlug);
  const normalizedEmail = normalizeWorkspaceEmail(args.email);
  if (!isValidWorkspaceInviteEmail(normalizedEmail)) {
    throw new Error("Valid email required");
  }

  const now = Date.now();
  const user = await getUserByEmail(ctx, normalizedEmail);

  if (user) {
    if (String(user._id) === String(args.invitedByUserId)) {
      throw new Error("You already own this workspace");
    }
    const existingMember = await getActiveMemberForUser(ctx, args.ownerKey, entity._id, user._id);
    const token = existingMember?.token ?? createWorkspaceMemberToken();
    const memberPatch = {
      access: args.access,
      userEmail: normalizedEmail,
      userName: typeof user.name === "string" ? user.name : existingMember?.userName,
      userImage: typeof user.image === "string" ? user.image : existingMember?.userImage,
      invitedByUserId: args.invitedByUserId,
      updatedAt: now,
    };
    let rowId: Id<"productEntityWorkspaceMembers">;
    if (existingMember) {
      await ctx.db.patch(existingMember._id, memberPatch);
      rowId = existingMember._id;
    } else {
      rowId = await ctx.db.insert("productEntityWorkspaceMembers", {
        ownerKey: args.ownerKey,
        entityId: entity._id,
        entitySlug: entity.slug,
        userId: user._id,
        userEmail: normalizedEmail,
        userName: typeof user.name === "string" ? user.name : undefined,
        userImage: typeof user.image === "string" ? user.image : undefined,
        token,
        access: args.access,
        invitedByUserId: args.invitedByUserId,
        createdAt: now,
        updatedAt: now,
      });
    }
    return {
      kind: "member",
      email: normalizedEmail,
      access: args.access,
      token,
      entitySlug: entity.slug,
      entityName: entity.name,
      rowId,
    };
  }

  const existingInvite = await getActiveInviteForEmail(ctx, args.ownerKey, entity._id, normalizedEmail);
  const token = existingInvite?.token ?? createWorkspaceInviteToken();
  let rowId: Id<"productEntityWorkspaceInvites">;
  if (existingInvite) {
    await ctx.db.patch(existingInvite._id, {
      access: args.access,
      invitedByUserId: args.invitedByUserId,
      updatedAt: now,
    });
    rowId = existingInvite._id;
  } else {
    rowId = await ctx.db.insert("productEntityWorkspaceInvites", {
      ownerKey: args.ownerKey,
      entityId: entity._id,
      entitySlug: entity.slug,
      email: normalizedEmail,
      normalizedEmail,
      token,
      access: args.access,
      status: "pending",
      invitedByUserId: args.invitedByUserId,
      createdAt: now,
      updatedAt: now,
    });
  }
  return {
    kind: "invite",
    email: normalizedEmail,
    access: args.access,
    token,
    entitySlug: entity.slug,
    entityName: entity.name,
    rowId,
  };
}

export const upsertEntityWorkspaceCollaboratorInternal = internalMutation({
  args: {
    ownerKey: v.string(),
    invitedByUserId: v.id("users"),
    entitySlug: v.string(),
    email: v.string(),
    access: productWorkspaceShareAccessValidator,
  },
  returns: v.object({
    kind: v.union(v.literal("member"), v.literal("invite")),
    email: v.string(),
    access: productWorkspaceShareAccessValidator,
    token: v.string(),
    entitySlug: v.string(),
    entityName: v.string(),
    rowId: v.union(v.id("productEntityWorkspaceMembers"), v.id("productEntityWorkspaceInvites")),
  }),
  handler: async (ctx, args) =>
    upsertEntityWorkspaceCollaboratorRecord(ctx, args),
});

export const recordEntityWorkspaceCollaboratorNotificationInternal = internalMutation({
  args: {
    kind: v.union(v.literal("member"), v.literal("invite")),
    rowId: v.union(v.id("productEntityWorkspaceMembers"), v.id("productEntityWorkspaceInvites")),
    status: productWorkspaceInviteDeliveryStatusValidator,
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const patch = {
      notificationStatus: args.status,
      notificationUpdatedAt: Date.now(),
      notificationMessageId: args.messageId,
      notificationError: args.error,
    };
    if (args.kind === "member") {
      await ctx.db.patch(args.rowId as Id<"productEntityWorkspaceMembers">, patch);
    } else {
      await ctx.db.patch(args.rowId as Id<"productEntityWorkspaceInvites">, patch);
    }
    return null;
  },
});

export const resolveEntityShareTarget = query({
  args: {
    shareToken: v.string(),
  },
  returns: v.union(
    v.object({
      status: v.literal("not_found"),
    }),
    v.object({
      status: v.literal("revoked"),
    }),
    v.object({
      status: v.literal("expired"),
    }),
    v.object({
      status: v.literal("active"),
      tokenKind: v.union(v.literal("member"), v.literal("share"), v.literal("public")),
      entitySlug: v.string(),
      entityName: v.string(),
      access: productWorkspaceShareAccessValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const memberRow = await ctx.db
      .query("productEntityWorkspaceMembers")
      .withIndex("by_token", (q) => q.eq("token", args.shareToken))
      .first();
    if (memberRow) {
      if (memberRow.revokedAt) {
        return { status: "revoked" as const };
      }
      const entity = await ctx.db.get(memberRow.entityId);
      if (!entity || entity.ownerKey !== memberRow.ownerKey) {
        return { status: "not_found" as const };
      }
      return {
        status: "active" as const,
        tokenKind: "member" as const,
        entitySlug: entity.slug,
        entityName: entity.name,
        access: memberRow.access,
      };
    }

    const shareRow = await ctx.db
      .query("productWorkspaceShares")
      .withIndex("by_token", (q) => q.eq("token", args.shareToken))
      .first();
    if (shareRow) {
      if (shareRow.revokedAt) {
        return { status: "revoked" as const };
      }
      if (shareRow.expiresAt && shareRow.expiresAt < Date.now()) {
        return { status: "expired" as const };
      }
      if (shareRow.resourceType !== "entity_workspace") {
        return { status: "not_found" as const };
      }
      const entity = await ctx.db.get(shareRow.entityId);
      if (!entity || entity.ownerKey !== shareRow.ownerKey) {
        return { status: "not_found" as const };
      }
      return {
        status: "active" as const,
        tokenKind: "share" as const,
        entitySlug: entity.slug,
        entityName: entity.name,
        access: shareRow.access,
      };
    }

    const publicShare = await ctx.db
      .query("publicShares")
      .withIndex("by_token", (q) => q.eq("token", args.shareToken))
      .first();
    if (publicShare) {
      if (publicShare.revokedAt) {
        return { status: "revoked" as const };
      }
      if (publicShare.expiresAt && publicShare.expiresAt < Date.now()) {
        return { status: "expired" as const };
      }
    }

    const activePublicShare = await getActivePublicEntityShareByToken(ctx, args.shareToken);
    if (activePublicShare) {
      const entity = await ctx.db
        .query("productEntities")
        .withIndex("by_owner_slug", (q) =>
          q.eq("ownerKey", activePublicShare.ownerKey).eq("slug", activePublicShare.resourceSlug),
        )
        .first();
      if (!entity) {
        return { status: "not_found" as const };
      }
      return {
        status: "active" as const,
        tokenKind: "public" as const,
        entitySlug: entity.slug,
        entityName: entity.name,
        access: "view" as const,
      };
    }

    return { status: "not_found" as const };
  },
});

export const ensureEntityWorkspaceShare = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    access: productWorkspaceShareAccessValidator,
  },
  returns: v.object({
    token: v.string(),
    access: productWorkspaceShareAccessValidator,
  }),
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const entity = await getOwnerEntityOrThrow(ctx, identity.ownerKey, args.entitySlug);

    const existing = (await listActiveEntityWorkspaceShares(ctx, identity.ownerKey, entity._id)).find(
      (share) => share.access === args.access,
    );
    if (existing) {
      return {
        token: existing.token,
        access: existing.access,
      };
    }

    const now = Date.now();
    const token = createWorkspaceShareToken("ews");
    await ctx.db.insert("productWorkspaceShares", {
      ownerKey: identity.ownerKey,
      resourceType: "entity_workspace",
      entityId: entity._id,
      entitySlug: entity.slug,
      token,
      access: args.access,
      createdAt: now,
      updatedAt: now,
    });
    return {
      token,
      access: args.access,
    };
  },
});

export const revokeEntityWorkspaceShare = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    access: productWorkspaceShareAccessValidator,
  },
  returns: v.object({
    revoked: v.number(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const entity = await getOwnerEntityOrThrow(ctx, identity.ownerKey, args.entitySlug);

    const now = Date.now();
    const shares = await listActiveEntityWorkspaceShares(ctx, identity.ownerKey, entity._id);
    let revoked = 0;
    for (const share of shares) {
      if (share.access !== args.access) continue;
      await ctx.db.patch(share._id, {
        revokedAt: now,
        updatedAt: now,
      });
      revoked += 1;
    }
    return { revoked };
  },
});

export const inviteEntityWorkspaceCollaborator = action({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    email: v.string(),
    access: productWorkspaceShareAccessValidator,
  },
  returns: v.object({
    kind: v.union(v.literal("member"), v.literal("invite")),
    email: v.string(),
    access: productWorkspaceShareAccessValidator,
    token: v.string(),
    delivery: v.object({
      status: productWorkspaceInviteDeliveryStatusValidator,
      copiedFallbackLink: v.boolean(),
      error: v.optional(v.string()),
    }),
  }),
  handler: async (ctx, args) => {
    const rawUserId = await getAuthUserId(ctx);
    if (!rawUserId) {
      throw new Error("Authenticated user required");
    }
    const collaborator = await ctx.runMutation(
      internal.domains.product.shares.upsertEntityWorkspaceCollaboratorInternal,
      {
        ownerKey: `user:${String(rawUserId)}`,
        invitedByUserId: rawUserId,
        entitySlug: args.entitySlug,
        email: args.email,
        access: args.access,
      },
    );

    const inviter = await ctx.runQuery(internal.domains.auth.auth.getUserById, {
      userId: rawUserId,
    });
    const inviterName =
      (typeof inviter?.name === "string" && inviter.name.trim()) ||
      (typeof inviter?.email === "string" && inviter.email.trim()) ||
      "A NodeBench collaborator";
    const targetUrl = buildAbsoluteWorkspaceUrl(
      collaborator.entitySlug,
      collaborator.token,
      collaborator.kind === "invite" ? "invite" : "share",
    );

    let delivery: {
      status: "sent" | "link_only";
      copiedFallbackLink: boolean;
      error?: string;
    } = {
      status: "link_only",
      copiedFallbackLink: true,
    };

    try {
      const emailPayload = buildWorkspaceInviteEmail({
        inviterName,
        entityName: collaborator.entityName,
        access: collaborator.access,
        url: targetUrl,
        kind: collaborator.kind,
      });
      const sendResult = await ctx.runAction(api.domains.integrations.resend.sendEmail, {
        to: collaborator.email,
        subject: emailPayload.subject,
        html: emailPayload.html,
        userId: rawUserId,
      });
      delivery = {
        status: "sent",
        copiedFallbackLink: false,
      };
      await ctx.runMutation(
        internal.domains.product.shares.recordEntityWorkspaceCollaboratorNotificationInternal,
        {
          kind: collaborator.kind,
          rowId: collaborator.rowId,
          status: "sent",
          messageId: sendResult?.emailId,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "Invite email failed");
      delivery = {
        status: "link_only",
        copiedFallbackLink: true,
        error: message,
      };
      await ctx.runMutation(
        internal.domains.product.shares.recordEntityWorkspaceCollaboratorNotificationInternal,
        {
          kind: collaborator.kind,
          rowId: collaborator.rowId,
          status: "link_only",
          error: message,
        },
      );
    }

    return {
      kind: collaborator.kind,
      email: collaborator.email,
      access: collaborator.access,
      token: collaborator.token,
      delivery,
    };
  },
});

export const acceptEntityWorkspaceInvite = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    inviteToken: v.string(),
    entitySlug: v.string(),
  },
  returns: v.object({
    entitySlug: v.string(),
    shareToken: v.string(),
    access: productWorkspaceShareAccessValidator,
  }),
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx, args.anonymousSessionId);
    const user = await getUserById(ctx, identity.rawUserId);
    if (!user?.email) {
      throw new Error("Email sign-in required");
    }
    const invite = await getActiveEntityWorkspaceInviteByToken(ctx, args.inviteToken);
    if (!invite || invite.entitySlug !== args.entitySlug) {
      throw new Error("Invite not found");
    }
    const normalizedUserEmail = normalizeWorkspaceEmail(user.email);
    if (normalizedUserEmail !== invite.normalizedEmail) {
      throw new Error("Invite email mismatch");
    }

    const existingMember = await getActiveMemberForUser(ctx, invite.ownerKey, invite.entityId, identity.rawUserId);
    const now = Date.now();
    const token = existingMember?.token ?? invite.token ?? createWorkspaceMemberToken();
    if (existingMember) {
      await ctx.db.patch(existingMember._id, {
        access: invite.access,
        userEmail: normalizedUserEmail,
        userName: typeof user.name === "string" ? user.name : existingMember.userName,
        userImage: typeof user.image === "string" ? user.image : existingMember.userImage,
        invitedByUserId: invite.invitedByUserId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("productEntityWorkspaceMembers", {
        ownerKey: invite.ownerKey,
        entityId: invite.entityId,
        entitySlug: invite.entitySlug,
        userId: identity.rawUserId,
        userEmail: normalizedUserEmail,
        userName: typeof user.name === "string" ? user.name : undefined,
        userImage: typeof user.image === "string" ? user.image : undefined,
        token,
        access: invite.access,
        invitedByUserId: invite.invitedByUserId,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(invite._id, {
      status: "accepted",
      acceptedAt: now,
      acceptedByUserId: identity.rawUserId,
      updatedAt: now,
    });

    return {
      entitySlug: invite.entitySlug,
      shareToken: token,
      access: invite.access,
    };
  },
});

export const previewEntityWorkspaceInvite = query({
  args: {
    inviteToken: v.string(),
    entitySlug: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      entitySlug: v.string(),
      entityName: v.string(),
      email: v.string(),
      access: productWorkspaceShareAccessValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const invite = await getActiveEntityWorkspaceInviteByToken(ctx, args.inviteToken);
    if (!invite || invite.entitySlug !== args.entitySlug) return null;
    const entity = await ctx.db.get(invite.entityId);
    if (!entity || entity.ownerKey !== invite.ownerKey) return null;
    return {
      entitySlug: entity.slug,
      entityName: entity.name,
      email: invite.email,
      access: invite.access,
    };
  },
});

export const previewEntityWorkspaceAccessToken = query({
  args: {
    shareToken: v.string(),
    entitySlug: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      kind: v.union(v.literal("share"), v.literal("member")),
      entitySlug: v.string(),
      entityName: v.string(),
      access: productWorkspaceShareAccessValidator,
      email: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const member = await getActiveEntityWorkspaceMemberByToken(ctx, args.shareToken);
    if (member && member.entitySlug === args.entitySlug) {
      const entity = await ctx.db.get(member.entityId);
      if (entity && entity.ownerKey === member.ownerKey) {
        return {
          kind: "member",
          entitySlug: entity.slug,
          entityName: entity.name,
          access: member.access,
          email: member.userEmail,
        };
      }
    }

    const share = await getActiveEntityWorkspaceShareByToken(ctx, args.shareToken);
    if (share && share.entitySlug === args.entitySlug) {
      const entity = await ctx.db.get(share.entityId);
      if (entity && entity.ownerKey === share.ownerKey) {
        return {
          kind: "share",
          entitySlug: entity.slug,
          entityName: entity.name,
          access: share.access,
        };
      }
    }
    return null;
  },
});

export const updateEntityWorkspaceMemberAccess = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    userId: v.id("users"),
    access: productWorkspaceShareAccessValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx, args.anonymousSessionId);
    const entity = await getOwnerEntityOrThrow(ctx, identity.ownerKey, args.entitySlug);
    const member = await getActiveMemberForUser(ctx, identity.ownerKey, entity._id, args.userId);
    if (!member) {
      throw new Error("Member not found");
    }
    await ctx.db.patch(member._id, {
      access: args.access,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const revokeEntityWorkspaceMember = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx, args.anonymousSessionId);
    const entity = await getOwnerEntityOrThrow(ctx, identity.ownerKey, args.entitySlug);
    const member = await getActiveMemberForUser(ctx, identity.ownerKey, entity._id, args.userId);
    if (!member) {
      throw new Error("Member not found");
    }
    await ctx.db.patch(member._id, {
      revokedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const updateEntityWorkspaceInviteAccess = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    inviteId: v.id("productEntityWorkspaceInvites"),
    access: productWorkspaceShareAccessValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx, args.anonymousSessionId);
    const entity = await getOwnerEntityOrThrow(ctx, identity.ownerKey, args.entitySlug);
    const invite = await ctx.db.get(args.inviteId);
    if (
      !invite ||
      invite.ownerKey !== identity.ownerKey ||
      invite.entityId !== entity._id ||
      invite.revokedAt ||
      invite.status !== "pending"
    ) {
      throw new Error("Invite not found");
    }
    await ctx.db.patch(invite._id, {
      access: args.access,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const revokeEntityWorkspaceInvite = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    inviteId: v.id("productEntityWorkspaceInvites"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx, args.anonymousSessionId);
    const entity = await getOwnerEntityOrThrow(ctx, identity.ownerKey, args.entitySlug);
    const invite = await ctx.db.get(args.inviteId);
    if (
      !invite ||
      invite.ownerKey !== identity.ownerKey ||
      invite.entityId !== entity._id ||
      invite.revokedAt
    ) {
      throw new Error("Invite not found");
    }
    await ctx.db.patch(invite._id, {
      revokedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});
