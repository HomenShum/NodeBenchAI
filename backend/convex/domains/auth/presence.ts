import { mutation, query, internalQuery, internalMutation } from "../../_generated/server";
import { components } from "../../_generated/api";
import { v } from "convex/values";
import { Presence } from "@convex-dev/presence";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id, Doc } from "../../_generated/dataModel";

export const presence = new Presence(components.presence);

export const getUserId = query({
  args: {},
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      console.info("presence.getUserId", {
        hasUser: Boolean(userId),
      });
      return userId;
    } catch (error) {
      console.error("presence.getUserId error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  },
});

export const heartbeat = mutation({
  args: { roomId: v.string(), userId: v.string(), sessionId: v.string(), interval: v.number() },
  returns: v.object({ roomToken: v.string(), sessionToken: v.string() }),
  handler: async (ctx, { roomId, userId, sessionId, interval }) => {
    try {
      console.info("presence.heartbeat start", { roomId, sessionId, interval });
      const authUserId = await getAuthUserId(ctx);
      if (!authUserId) {
        console.warn("presence.heartbeat unauthenticated", { roomId, sessionId });
        throw new Error("Not authenticated");
      }
      if (userId && userId !== (authUserId as unknown as string)) {
        console.warn("presence.heartbeat userId mismatch", {
          providedUserId: userId,
          authUserId,
        });
      }
      const result = await presence.heartbeat(ctx, roomId, authUserId, sessionId, interval);
      console.info("presence.heartbeat success", { roomId, sessionId });
      return result;
    } catch (error) {
      console.error("presence.heartbeat error", {
        roomId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

export const list = query({
  args: { roomToken: v.string() },
  returns: v.array(
    v.object({
      userId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
      name: v.optional(v.string()),
      image: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { roomToken }) => {
    try {
      console.info("presence.list start", { roomTokenLength: roomToken?.length ?? 0 });
      const presenceList = await presence.list(ctx, roomToken);
      
      if (!Array.isArray(presenceList)) {
        console.warn("presence.list nonArray response");
        return [];
      }

      const listWithUserInfo = await Promise.all(
        presenceList.map(async (entry) => {
          try {
            const user = await ctx.db.get(entry.userId) as Doc<"users"> | null;
            if (!user) {
              return entry;
            }
            return {
              ...entry,
              name: user?.name,
              image: user?.image,
            };
          } catch (error) {
            console.error("presence.list userInfo error", {
              userId: entry.userId,
              error: error instanceof Error ? error.message : String(error),
            });
            return entry;
          }
        })
      );
      console.info("presence.list success", { count: listWithUserInfo.length });
      return listWithUserInfo;
    } catch (error) {
      console.error("presence.list error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  },
});

export const disconnect = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    try {
      console.info("presence.disconnect start", { sessionTokenLength: sessionToken?.length ?? 0 });
      const res = await presence.disconnect(ctx, sessionToken);
      console.info("presence.disconnect success");
      return res;
    } catch (error) {
      console.error("presence.disconnect error", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

// Internal utilities and admin helpers

export const listRoom = internalQuery({
  args: {
    roomId: v.string(),
    onlineOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      userId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
      name: v.optional(v.string()),
      image: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { roomId, onlineOnly = false, limit = 104 }) => {
    try {
      console.info("presence.listRoom start", { roomId, onlineOnly, limit });
      const base = await ctx.runQuery(components.presence.public.listRoom, { roomId, onlineOnly, limit });
      const enriched = await Promise.all(
        base.map(async (entry: { userId: string; online: boolean; lastDisconnected: number }) => {
          try {
            const user = await ctx.db.get(entry.userId as Id<"users">) as Doc<"users"> | null;
            if (!user) return entry;
            return { ...entry, name: user.name, image: user.image };
          } catch (e) {
            console.warn("presence.listRoom enrich error", {
              userId: entry.userId,
              error: e instanceof Error ? e.message : String(e),
            });
            return entry;
          }
        })
      );
      console.info("presence.listRoom success", { count: enriched.length });
      return enriched;
    } catch (error) {
      console.error("presence.listRoom error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  },
});

export const listUser = internalQuery({
  args: {
    userId: v.string(),
    onlineOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      roomId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
      title: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { userId, onlineOnly = false, limit = 104 }) => {
    try {
      console.info("presence.listUser start", { userId, onlineOnly, limit });
      const base = await ctx.runQuery(components.presence.public.listUser, { userId, onlineOnly, limit });
      const enriched = await Promise.all(
        base.map(async (entry: { roomId: string; online: boolean; lastDisconnected: number }) => {
          try {
            const doc = await ctx.db.get(entry.roomId as Id<"documents">) as Doc<"documents"> | null;
            if (!doc) return entry;
            return { ...entry, title: doc.title };
          } catch (e) {
            console.warn("presence.listUser enrich error", {
              roomId: entry.roomId,
              error: e instanceof Error ? e.message : String(e),
            });
            return entry;
          }
        })
      );
      console.info("presence.listUser success", { count: enriched.length });
      return enriched;
    } catch (error) {
      console.error("presence.listUser error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  },
});

export const removeRoomUser = internalMutation({
  args: { roomId: v.string(), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { roomId, userId }) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
      throw new Error("Not authenticated");
    }
    // Allow removing self; otherwise require ownership of the document (if exists).
    if (userId !== (authUserId as unknown as string)) {
      try {
        const doc = await ctx.db.get(roomId as Id<"documents">) as Doc<"documents"> | null;
        if (!doc || String(doc.createdBy) !== String(authUserId)) {
          throw new Error("Not authorized to remove other users from this room");
        }
      } catch {
        throw new Error("Not authorized to remove other users from this room");
      }
    }
    await ctx.runMutation(components.presence.public.removeRoomUser, { roomId, userId });
    return null;
  },
});

export const removeRoom = internalMutation({
  args: { roomId: v.string() },
  returns: v.null(),
  handler: async (ctx, { roomId }) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
      throw new Error("Not authenticated");
    }
    // Require owner of the document (if exists)
    try {
      const doc = await ctx.db.get(roomId as Id<"documents">) as Doc<"documents"> | null;
      if (doc && String(doc.createdBy) !== String(authUserId)) {
        throw new Error("Not authorized to remove this room");
      }
    } catch {
      // If not a document-backed room, allow any authenticated user to clear (fallback)
    }
    await ctx.runMutation(components.presence.public.removeRoom, { roomId });
    return null;
  },
});
