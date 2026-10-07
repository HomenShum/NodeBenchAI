/**
 * notebookPresence.ts — product-scoped presence for the notebook.
 *
 * Uses @convex-dev/presence so we don't invent our own heartbeat loop. The
 * existing convex/domains/auth/presence.ts wrapper requires an authenticated
 * user; this one also accepts anonymous sessions (which the notebook needs
 * because pre-signup users can edit blocks in entity workspaces).
 *
 * Room id convention: "notebook:<entitySlug>" scoped per owner. Users see
 * who else is editing the same entity. We don't split presence per block
 * because the useful UX signal is "someone else is on this page", not
 * per-block cursors (that needs Y.js awareness — out of scope).
 *
 * Kill switch: NOTEBOOK_PRESENCE_ENABLED=false makes every call no-op.
 */

import { Presence } from "@convex-dev/presence";
import { v } from "convex/values";
import { components } from "../../_generated/api";
import { mutation, query } from "../../_generated/server";
import { resolveEntityWorkspaceAccess } from "./helpers";

const presence = new Presence(components.presence);

function isEnabled(): boolean {
  const flag = process.env.NOTEBOOK_PRESENCE_ENABLED;
  return flag !== "false" && flag !== "0";
}

// Build a stable presence-user id from either the authenticated user or the
// anonymous session. Presence identifies by `userId` string; we use our
// ownerKey as that string so the same user across browser tabs collapses to
// one facepile avatar.
function presenceUserIdFromOwnerKey(ownerKey: string): string {
  return ownerKey;
}

export const notebookHeartbeat = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
    sessionId: v.string(),
    interval: v.number(),
  },
  returns: v.object({
    roomToken: v.string(),
    sessionToken: v.string(),
  }),
  handler: async (ctx, args) => {
    if (!isEnabled()) {
      // Return empty tokens so the client treats presence as disabled.
      return { roomToken: "", sessionToken: "" };
    }
    const workspaceAccess = await resolveEntityWorkspaceAccess(ctx, {
      anonymousSessionId: args.anonymousSessionId,
      shareToken: args.shareToken,
      entitySlug: args.entitySlug,
    });
    if (!workspaceAccess?.identity.ownerKey) {
      return { roomToken: "", sessionToken: "" };
    }
    const userId = presenceUserIdFromOwnerKey(workspaceAccess.identity.ownerKey);
    const roomId = `notebook:${workspaceAccess.entity.ownerKey}:${workspaceAccess.entity.slug}`;
    return await presence.heartbeat(
      ctx,
      roomId,
      userId,
      args.sessionId,
      args.interval,
    );
  },
});

export const notebookPresenceList = query({
  args: {
    roomToken: v.string(),
  },
  returns: v.array(
    v.object({
      userId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
    }),
  ),
  handler: async (ctx, { roomToken }) => {
    if (!isEnabled() || !roomToken) return [];
    try {
      const result = await presence.list(ctx, roomToken);
      if (!Array.isArray(result)) return [];
      return result.map((entry) => ({
        userId: entry.userId,
        online: entry.online,
        lastDisconnected: entry.lastDisconnected,
      }));
    } catch (err) {
      // Presence lookup should never break the notebook render.
      console.warn("notebookPresenceList failed (fail-open):", err);
      return [];
    }
  },
});

export const notebookPresenceDisconnect = mutation({
  args: {
    sessionToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    if (!isEnabled() || !sessionToken) return null;
    try {
      await presence.disconnect(ctx, sessionToken);
    } catch (err) {
      // Called from sendBeacon on tab close — log but don't throw.
      console.warn("notebookPresenceDisconnect failed (fail-open):", err);
    }
    return null;
  },
});
