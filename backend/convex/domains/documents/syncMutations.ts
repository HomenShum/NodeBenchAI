import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { syncPool } from "../tasks/work";

// Enqueue helpers (mutations) – called from OAuth callback routes
// Use statically imported 'internal' - dynamic imports are not supported in mutations
export const enqueueSlackSync = internalMutation({
  args: {},
  returns: v.object({ workId: v.string() }),
  handler: async (ctx): Promise<{ workId: string }> => {
    const workId = await syncPool.enqueueAction(
      ctx,
      internal.domains.documents.sync.runSlackSync,
      {},
      {}
    );
    return { workId };
  },
});

export const enqueueGithubSync = internalMutation({
  args: {},
  returns: v.object({ workId: v.string() }),
  handler: async (ctx): Promise<{ workId: string }> => {
    const workId = await syncPool.enqueueAction(
      ctx,
      internal.domains.documents.sync.runGithubSync,
      {},
      {}
    );
    return { workId };
  },
});

export const enqueueNotionSync = internalMutation({
  args: {},
  returns: v.object({ workId: v.string() }),
  handler: async (ctx): Promise<{ workId: string }> => {
    const workId = await syncPool.enqueueAction(
      ctx,
      internal.domains.documents.sync.runNotionSync,
      {},
      {}
    );
    return { workId };
  },
});

export const enqueueGmailSync = internalMutation({
  args: {},
  returns: v.object({ workId: v.string() }),
  handler: async (ctx): Promise<{ workId: string }> => {
    const workId = await syncPool.enqueueAction(
      ctx,
      internal.domains.documents.sync.runGmailSync,
      {},
      {}
    );
    return { workId };
  },
});
