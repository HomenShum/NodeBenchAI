"use node";

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

export const saveApiKeyEncrypted = action({
  args: { provider: v.string(), apiKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { provider, apiKey }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Deprecated: this action now expects the input to already be encrypted on the client.
    const encryptedApiKey = apiKey;
    await ctx.runMutation(internal.domains.auth.apiKeys.saveEncryptedApiKey, { provider, encryptedApiKey });
    return null;
  },
});
