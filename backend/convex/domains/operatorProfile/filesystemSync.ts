import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

/**
 * Sync operator profile to filesystem (~/.nodebench/USER.md).
 * Called via MCP tool — user-triggered only, never automatic.
 *
 * This runs as an internalAction because it doesn't directly touch
 * the filesystem — the MCP tool on the local side handles the actual
 * file write. This action fetches the markdown content for the MCP tool.
 */
export const getProfileForSync = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const profile = await ctx.runQuery(
      internal.domains.operatorProfile.queries.getProfileByUserId,
      { userId }
    );
    if (!profile) {
      return { success: false, error: "No operator profile found" };
    }

    const doc = await ctx.runQuery(
      internal.domains.operatorProfile.queries._getDocumentById,
      { documentId: profile.documentId }
    );

    if (!doc?.content) {
      return { success: false, error: "Profile document has no content" };
    }

    // Mark sync timestamp
    await ctx.runMutation(
      internal.domains.operatorProfile.mutations.markFilesystemSync,
      { profileId: profile._id }
    );

    return {
      success: true,
      markdown: doc.content,
      displayName: profile.identity.displayName,
      lastSyncedAt: Date.now(),
    };
  },
});
