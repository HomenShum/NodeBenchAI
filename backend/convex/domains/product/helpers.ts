import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

type ProductCtx = {
  auth: QueryCtx["auth"] | MutationCtx["auth"];
  db: QueryCtx["db"] | MutationCtx["db"];
};

export type ProductIdentity = {
  ownerKey: string | null;
  rawUserId: Id<"users"> | string | null;
  anonymousSessionId: string | null;
};

export type RequiredProductIdentity = ProductIdentity & {
  ownerKey: string;
};

export type RequiredAuthenticatedProductIdentity = RequiredProductIdentity & {
  rawUserId: Id<"users">;
};

export type ProductEntityWorkspaceAccess = {
  entity: Doc<"productEntities">;
  identity: ProductIdentity;
  mode: "owner" | "share" | "member";
  access: "view" | "edit";
  canEditNotes: boolean;
  canEditNotebook: boolean;
  canManageShare: boolean;
  canManageMembers: boolean;
  shareToken: string | null;
};

function isActiveWorkspaceShare(
  share: Doc<"productWorkspaceShares"> | null | undefined,
  now = Date.now(),
): share is Doc<"productWorkspaceShares"> {
  return Boolean(
    share &&
      !share.revokedAt &&
      (!share.expiresAt || share.expiresAt > now),
  );
}

function isActiveWorkspaceMember(
  member: Doc<"productEntityWorkspaceMembers"> | null | undefined,
): member is Doc<"productEntityWorkspaceMembers"> {
  return Boolean(member && !member.revokedAt);
}

function isActiveWorkspaceInvite(
  invite: Doc<"productEntityWorkspaceInvites"> | null | undefined,
  now = Date.now(),
): invite is Doc<"productEntityWorkspaceInvites"> {
  return Boolean(
    invite &&
      !invite.revokedAt &&
      invite.status === "pending" &&
      (!invite.expiresAt || invite.expiresAt > now),
  );
}

function isActivePublicEntityShare(
  share: Doc<"publicShares"> | null | undefined,
  now = Date.now(),
): share is Doc<"publicShares"> {
  return Boolean(
    share &&
      share.resourceType === "entity" &&
      !share.revokedAt &&
      (!share.expiresAt || share.expiresAt > now),
  );
}

export function normalizeProductShareToken(value?: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeWorkspaceInviteToken(value?: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeWorkspaceEmail(value?: string | null): string {
  return String(value ?? "").trim().toLowerCase();
}

export async function getActiveEntityWorkspaceShareByToken(
  ctx: ProductCtx,
  shareToken?: string | null,
): Promise<Doc<"productWorkspaceShares"> | null> {
  const token = normalizeProductShareToken(shareToken);
  if (!token) return null;
  const share = await ctx.db
    .query("productWorkspaceShares")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  return isActiveWorkspaceShare(share) ? share : null;
}

export async function getActiveEntityWorkspaceMemberByToken(
  ctx: ProductCtx,
  shareToken?: string | null,
): Promise<Doc<"productEntityWorkspaceMembers"> | null> {
  const token = normalizeProductShareToken(shareToken);
  if (!token) return null;
  const member = await ctx.db
    .query("productEntityWorkspaceMembers")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  return isActiveWorkspaceMember(member) ? member : null;
}

export async function getActivePublicEntityShareByToken(
  ctx: ProductCtx,
  shareToken?: string | null,
): Promise<Doc<"publicShares"> | null> {
  const token = normalizeProductShareToken(shareToken);
  if (!token) return null;
  const share = await ctx.db
    .query("publicShares")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  return isActivePublicEntityShare(share) ? share : null;
}

export async function getActiveEntityWorkspaceInviteByToken(
  ctx: ProductCtx,
  inviteToken?: string | null,
): Promise<Doc<"productEntityWorkspaceInvites"> | null> {
  const token = normalizeWorkspaceInviteToken(inviteToken);
  if (!token) return null;
  const invite = await ctx.db
    .query("productEntityWorkspaceInvites")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  return isActiveWorkspaceInvite(invite) ? invite : null;
}

export async function listActiveEntityWorkspaceShares(
  ctx: ProductCtx,
  ownerKey: string,
  entityId: Id<"productEntities">,
): Promise<Doc<"productWorkspaceShares">[]> {
  const shares = await ctx.db
    .query("productWorkspaceShares")
    .withIndex("by_owner_entity", (q) => q.eq("ownerKey", ownerKey).eq("entityId", entityId))
    .collect();
  return shares.filter((share) => isActiveWorkspaceShare(share));
}

export async function listActiveEntityWorkspaceMembers(
  ctx: ProductCtx,
  ownerKey: string,
  entityId: Id<"productEntities">,
): Promise<Doc<"productEntityWorkspaceMembers">[]> {
  const members = await ctx.db
    .query("productEntityWorkspaceMembers")
    .withIndex("by_owner_entity_updated", (q) => q.eq("ownerKey", ownerKey).eq("entityId", entityId))
    .collect();
  return members.filter((member) => isActiveWorkspaceMember(member));
}

export async function listActiveEntityWorkspaceInvites(
  ctx: ProductCtx,
  ownerKey: string,
  entityId: Id<"productEntities">,
): Promise<Doc<"productEntityWorkspaceInvites">[]> {
  const invites = await ctx.db
    .query("productEntityWorkspaceInvites")
    .withIndex("by_owner_entity_updated", (q) => q.eq("ownerKey", ownerKey).eq("entityId", entityId))
    .collect();
  return invites.filter((invite) => isActiveWorkspaceInvite(invite));
}

export async function resolveEntityWorkspaceAccess(
  ctx: ProductCtx,
  args: {
    anonymousSessionId?: string | null;
    shareToken?: string | null;
    entitySlug: string;
  },
): Promise<ProductEntityWorkspaceAccess | null> {
  const identity = await resolveProductIdentitySafely(ctx, args.anonymousSessionId);
  const member = await getActiveEntityWorkspaceMemberByToken(ctx, args.shareToken);
  if (member) {
    const memberEntity = await ctx.db.get(member.entityId);
    if (
      memberEntity &&
      memberEntity.ownerKey === member.ownerKey &&
      memberEntity.slug === args.entitySlug
    ) {
      if (identity.ownerKey && identity.ownerKey === memberEntity.ownerKey) {
        return {
          entity: memberEntity,
          identity,
          mode: "owner",
          access: "edit",
          canEditNotes: true,
          canEditNotebook: true,
          canManageShare: true,
          canManageMembers: Boolean(identity.rawUserId),
          shareToken: args.shareToken ?? member.token,
        };
      }
      if (identity.rawUserId && String(identity.rawUserId) === String(member.userId)) {
        const access = member.access;
        return {
          entity: memberEntity,
          identity,
          mode: "member",
          access,
          canEditNotes: access === "edit",
          canEditNotebook: access === "edit",
          canManageShare: false,
          canManageMembers: false,
          shareToken: member.token,
        };
      }
      return null;
    }
  }

  const share = await getActiveEntityWorkspaceShareByToken(ctx, args.shareToken);
  if (share && share.resourceType === "entity_workspace") {
    const sharedEntity = await ctx.db.get(share.entityId);
    if (sharedEntity && sharedEntity.ownerKey === share.ownerKey && sharedEntity.slug === args.entitySlug) {
      if (identity.ownerKey && identity.ownerKey === sharedEntity.ownerKey) {
        return {
          entity: sharedEntity,
          identity,
          mode: "owner",
          access: "edit",
          canEditNotes: true,
          canEditNotebook: true,
          canManageShare: true,
          canManageMembers: Boolean(identity.rawUserId),
          shareToken: share.token,
        };
      }
      const access = share.access;
      return {
        entity: sharedEntity,
        identity,
        mode: "share",
        access,
        canEditNotes: access === "edit",
        canEditNotebook: access === "edit",
        canManageShare: false,
        canManageMembers: false,
        shareToken: share.token,
      };
    }
  }

  const publicShare = await getActivePublicEntityShareByToken(ctx, args.shareToken);
  if (publicShare) {
    const publicEntity = await ctx.db
      .query("productEntities")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerKey", publicShare.ownerKey).eq("slug", publicShare.resourceSlug),
      )
      .first();
    if (publicEntity && publicEntity.slug === args.entitySlug) {
      if (identity.ownerKey && identity.ownerKey === publicEntity.ownerKey) {
        return {
          entity: publicEntity,
          identity,
          mode: "owner",
          access: "edit",
          canEditNotes: true,
          canEditNotebook: true,
          canManageShare: true,
          canManageMembers: Boolean(identity.rawUserId),
          shareToken: publicShare.token,
        };
      }
      return {
        entity: publicEntity,
        identity,
        mode: "share",
        access: "view",
        canEditNotes: false,
        canEditNotebook: false,
        canManageShare: false,
        canManageMembers: false,
        shareToken: publicShare.token,
      };
    }
  }

  if (identity.ownerKey) {
    const ownedEntity = await ctx.db
      .query("productEntities")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerKey", identity.ownerKey as string).eq("slug", args.entitySlug),
      )
      .first();
    if (ownedEntity) {
      return {
        entity: ownedEntity,
        identity,
        mode: "owner",
        access: "edit",
        canEditNotes: true,
        canEditNotebook: true,
        canManageShare: true,
        canManageMembers: Boolean(identity.rawUserId),
        shareToken: null,
      };
    }
  }

  return null;
}

export async function requireEntityWorkspaceWriteAccessBySlug(
  ctx: ProductCtx,
  args: {
    anonymousSessionId?: string | null;
    shareToken?: string | null;
    entitySlug: string;
  },
): Promise<ProductEntityWorkspaceAccess & { identity: RequiredProductIdentity }> {
  const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
  const access = await resolveEntityWorkspaceAccess(ctx, args);
  if (!access || access.access !== "edit") {
    throw new Error("Entity not found");
  }
  return {
    ...access,
    identity,
  };
}

export async function requireEntityWorkspaceWriteAccessByEntityId(
  ctx: ProductCtx,
  args: {
    anonymousSessionId?: string | null;
    shareToken?: string | null;
    entityId: Id<"productEntities">;
  },
): Promise<{ entity: Doc<"productEntities">; identity: RequiredProductIdentity; mode: "owner" | "share" | "member" }> {
  const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
  const entity = await ctx.db.get(args.entityId);
  if (!entity) {
    throw new Error("Entity not found");
  }
  if (entity.ownerKey === identity.ownerKey) {
    return { entity, identity, mode: "owner" };
  }
  const member = await getActiveEntityWorkspaceMemberByToken(ctx, args.shareToken);
  if (
    member &&
    member.ownerKey === entity.ownerKey &&
    member.entityId === entity._id &&
    member.access === "edit" &&
    identity.rawUserId &&
    String(member.userId) === String(identity.rawUserId)
  ) {
    return { entity, identity, mode: "member" };
  }
  const share = await getActiveEntityWorkspaceShareByToken(ctx, args.shareToken);
  if (
    !share ||
    share.resourceType !== "entity_workspace" ||
    share.access !== "edit" ||
    share.ownerKey !== entity.ownerKey ||
    share.entityId !== entity._id
  ) {
    throw new Error("Entity not found");
  }
  return { entity, identity, mode: "share" };
}

export async function requireBlockReadAccessById(
  ctx: ProductCtx,
  args: {
    anonymousSessionId?: string | null;
    shareToken?: string | null;
  blockId: Id<"productBlocks">;
  },
): Promise<{
  block: Doc<"productBlocks">;
  entity: Doc<"productEntities">;
  identity: ProductIdentity;
  mode: "owner" | "share" | "member";
  access: "view" | "edit";
}> {
  const identity = await resolveProductIdentitySafely(ctx, args.anonymousSessionId);
  const block = await ctx.db.get(args.blockId);
  if (!block || block.deletedAt) {
    throw new Error("Notebook block not found");
  }
  const entity = await ctx.db.get(block.entityId);
  if (!entity || entity.ownerKey !== block.ownerKey) {
    throw new Error("Notebook block not found");
  }
  if (identity.ownerKey && identity.ownerKey === block.ownerKey) {
    return { block, entity, identity, mode: "owner", access: "edit" };
  }
  const member = await getActiveEntityWorkspaceMemberByToken(ctx, args.shareToken);
  if (
    member &&
    member.ownerKey === entity.ownerKey &&
    member.entityId === entity._id &&
    identity.rawUserId &&
    String(member.userId) === String(identity.rawUserId)
  ) {
    return { block, entity, identity, mode: "member", access: member.access };
  }
  const share = await getActiveEntityWorkspaceShareByToken(ctx, args.shareToken);
  if (
    !share ||
    share.resourceType !== "entity_workspace" ||
    share.ownerKey !== entity.ownerKey ||
    share.entityId !== entity._id
  ) {
    const publicShare = await getActivePublicEntityShareByToken(ctx, args.shareToken);
    if (
      !publicShare ||
      publicShare.ownerKey !== entity.ownerKey ||
      publicShare.resourceSlug !== entity.slug
    ) {
      throw new Error("Notebook block not found");
    }
    return { block, entity, identity, mode: "share", access: "view" };
  }
  return { block, entity, identity, mode: "share", access: share.access };
}

export async function requireBlockWriteAccessById(
  ctx: ProductCtx,
  args: {
    anonymousSessionId?: string | null;
    shareToken?: string | null;
    blockId: Id<"productBlocks">;
  },
): Promise<{
  block: Doc<"productBlocks">;
  entity: Doc<"productEntities">;
  identity: RequiredProductIdentity;
  mode: "owner" | "share" | "member";
}> {
  const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
  const block = await ctx.db.get(args.blockId);
  if (!block || block.deletedAt) {
    throw new Error("Notebook block not found");
  }
  const entity = await ctx.db.get(block.entityId);
  if (!entity || entity.ownerKey !== block.ownerKey) {
    throw new Error("Notebook block not found");
  }
  if (identity.ownerKey === block.ownerKey) {
    return { block, entity, identity, mode: "owner" };
  }
  const member = await getActiveEntityWorkspaceMemberByToken(ctx, args.shareToken);
  if (
    member &&
    member.ownerKey === entity.ownerKey &&
    member.entityId === entity._id &&
    member.access === "edit" &&
    identity.rawUserId &&
    String(member.userId) === String(identity.rawUserId)
  ) {
    return { block, entity, identity, mode: "member" };
  }
  const share = await getActiveEntityWorkspaceShareByToken(ctx, args.shareToken);
  if (
    !share ||
    share.resourceType !== "entity_workspace" ||
    share.access !== "edit" ||
    share.ownerKey !== entity.ownerKey ||
    share.entityId !== entity._id
  ) {
    throw new Error("Notebook block not found");
  }
  return { block, entity, identity, mode: "share" };
}

export function toAnonymousProductOwnerKey(anonymousSessionId?: string | null): string | null {
  const trimmedAnonymousSessionId = anonymousSessionId?.trim() || null;
  return trimmedAnonymousSessionId ? `anon:${trimmedAnonymousSessionId}` : null;
}

export async function resolveProductIdentity(
  ctx: ProductCtx,
  anonymousSessionId?: string | null,
): Promise<ProductIdentity> {
  const rawUserId = await getAuthUserId(ctx as any);
  if (rawUserId) {
    return {
      ownerKey: `user:${String(rawUserId)}`,
      rawUserId,
      anonymousSessionId: null,
    };
  }

  const trimmedAnonymousSessionId = anonymousSessionId?.trim() || null;
  if (!trimmedAnonymousSessionId) {
    return {
      ownerKey: null,
      rawUserId: null,
      anonymousSessionId: null,
    };
  }

  return {
    ownerKey: toAnonymousProductOwnerKey(trimmedAnonymousSessionId),
    rawUserId: null,
    anonymousSessionId: trimmedAnonymousSessionId,
  };
}

export async function resolveProductIdentitySafely(
  ctx: ProductCtx,
  anonymousSessionId?: string | null,
): Promise<ProductIdentity> {
  try {
    return await resolveProductIdentity(ctx, anonymousSessionId);
  } catch (error) {
    console.error("[product] resolveProductIdentity failed", error);
    return {
      ownerKey: toAnonymousProductOwnerKey(anonymousSessionId),
      rawUserId: null,
      anonymousSessionId: anonymousSessionId?.trim() || null,
    };
  }
}

export async function resolveProductReadOwnerKeys(
  ctx: ProductCtx,
  anonymousSessionId?: string | null,
): Promise<string[]> {
  const identity = await resolveProductIdentitySafely(ctx, anonymousSessionId);
  const ownerKeys: string[] = [];
  const push = (value?: string | null) => {
    if (!value || ownerKeys.includes(value)) return;
    ownerKeys.push(value);
  };

  push(identity.ownerKey);
  push(toAnonymousProductOwnerKey(anonymousSessionId));

  return ownerKeys;
}

export async function requireProductIdentity(
  ctx: ProductCtx,
  anonymousSessionId?: string | null,
): Promise<RequiredProductIdentity> {
  const identity = await resolveProductIdentity(ctx, anonymousSessionId);
  if (!identity.ownerKey) {
    throw new Error("Authentication or anonymous session required");
  }

  return {
    ownerKey: identity.ownerKey,
    rawUserId: identity.rawUserId,
    anonymousSessionId: identity.anonymousSessionId,
  };
}

export async function requireAuthenticatedProductIdentity(
  ctx: ProductCtx,
  anonymousSessionId?: string | null,
): Promise<RequiredAuthenticatedProductIdentity> {
  const identity = await requireProductIdentity(ctx, anonymousSessionId);
  if (!identity.rawUserId) {
    throw new Error("Authenticated user required");
  }
  return {
    ...identity,
    rawUserId: identity.rawUserId as Id<"users">,
  };
}

export function buildPreviewText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.slice(0, 280);
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value).slice(0, 280);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function summarizeText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim().slice(0, 320);
  }
  return fallback;
}

export function deriveDomainFromUrl(href?: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function looksLikeImageUrl(href?: string): boolean {
  if (!href) return false;
  return /\.(png|jpe?g|webp|gif|bmp|svg)(?:[?#].*)?$/i.test(href);
}

type ProductStorageCtx = Pick<QueryCtx, "db" | "storage"> | Pick<MutationCtx, "db" | "storage">;

export async function resolveProductThumbnailUrl(
  ctx: ProductStorageCtx,
  args: {
    evidenceItemIds?: Array<Id<"productEvidenceItems">>;
    sources?: Array<Doc<"productReports">["sources"][number]>;
  },
): Promise<string | undefined> {
  const urls = await resolveProductThumbnailUrls(ctx, args);
  return urls[0];
}

export async function resolveProductThumbnailUrls(
  ctx: ProductStorageCtx,
  args: {
    evidenceItemIds?: Array<Id<"productEvidenceItems">>;
    sources?: Array<Doc<"productReports">["sources"][number]>;
  },
): Promise<string[]> {
  const seen = new Set<string>();
  const urls: string[] = [];
  const push = (value?: string | null) => {
    const next = value?.trim();
    if (!next || seen.has(next)) return;
    seen.add(next);
    urls.push(next);
  };

  for (const evidenceId of args.evidenceItemIds ?? []) {
    const evidence = await ctx.db.get(evidenceId);
    if (!evidence) continue;
    const storageId =
      typeof evidence.metadata?.storageId === "string"
        ? evidence.metadata.storageId
        : null;
    const mimeType = typeof evidence.mimeType === "string" ? evidence.mimeType : "";
    const isImageEvidence =
      evidence.type === "image" || mimeType.startsWith("image/");

    if (isImageEvidence && storageId) {
      const storageUrl = await ctx.storage.getUrl(storageId);
      push(storageUrl);
    }
  }

  for (const source of args.sources ?? []) {
    push(typeof source?.thumbnailUrl === "string" ? source.thumbnailUrl : undefined);
    for (const candidate of Array.isArray(source?.imageCandidates) ? source.imageCandidates : []) {
      push(typeof candidate === "string" ? candidate : undefined);
    }
    if (looksLikeImageUrl(source?.href)) {
      push(source.href);
    }
  }

  return urls.slice(0, 4);
}
