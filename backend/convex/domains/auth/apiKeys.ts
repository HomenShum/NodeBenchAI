import { query, mutation, internalQuery, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";

export const getApiKeyStatus = query({
  args: { provider: v.string() },
  returns: v.object({
    provider: v.string(),
    hasKey: v.boolean(),
    createdAt: v.optional(v.number()),
  }),
  handler: async (ctx, { provider }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { provider, hasKey: false };
    const rec = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", userId).eq("provider", provider)
      )
      .first() as Doc<"userApiKeys"> | null;
    return {
      provider,
      hasKey: Boolean(rec?.encryptedApiKey && rec.encryptedApiKey.length > 0),
      createdAt: rec?.createdAt,
    };
  },
});

// Public: retrieve the encrypted API key for the authenticated user.
// Note: returns the stored encrypted string; decryption must happen on the client with user's passphrase.
export const getEncryptedApiKeyPublic = query({
  args: { provider: v.string() },
  returns: v.union(
    v.object({ encryptedApiKey: v.string(), createdAt: v.optional(v.number()) }),
    v.null()
  ),
  handler: async (ctx, { provider }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const rec = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user_provider", (q) => q.eq("userId", userId).eq("provider", provider))
      .first() as Doc<"userApiKeys"> | null;
    if (!rec || !rec.encryptedApiKey) return null;
    return { encryptedApiKey: rec.encryptedApiKey, createdAt: rec.createdAt };
  },
});

// Public: list formats to support migration UX (detect legacy/plaintext vs v2 tokens).
export const listApiKeyFormats = query({
  args: { providers: v.array(v.string()) },
  returns: v.array(
    v.object({
      provider: v.string(),
      hasKey: v.boolean(),
      isLegacy: v.boolean(), // true if present and not starting with "v2:"
      createdAt: v.optional(v.number()),
    })
  ),
  handler: async (ctx, { providers }) => {
    const userId = await getAuthUserId(ctx);
    const out: Array<{ provider: string; hasKey: boolean; isLegacy: boolean; createdAt?: number }> = [];
    for (const provider of providers) {
      if (!userId) {
        out.push({ provider, hasKey: false, isLegacy: false });
        continue;
      }
      const rec = await ctx.db
        .query("userApiKeys")
        .withIndex("by_user_provider", (q) => q.eq("userId", userId).eq("provider", provider))
        .first() as Doc<"userApiKeys"> | null;
      const encrypted = rec?.encryptedApiKey ?? "";
      const hasKey = encrypted.length > 0;
      const isLegacy = hasKey ? !encrypted.startsWith("v2:") : false;
      out.push({ provider, hasKey, isLegacy, createdAt: rec?.createdAt });
    }
    return out;
  },
});

// Public: upsert the already-encrypted API key (client-side E2E encryption)
export const saveEncryptedApiKeyPublic = mutation({
  args: { provider: v.string(), encryptedApiKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { provider, encryptedApiKey }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user_provider", (q) => q.eq("userId", userId).eq("provider", provider))
      .first() as Doc<"userApiKeys"> | null;

    const now = Date.now();
    const isUpdate = !!existing;

    if (existing) {
      // Update existing key
      const beforeState = {
        _id: existing._id,
        provider: existing.provider,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };

      await ctx.db.patch(existing._id, { encryptedApiKey, updatedAt: now });

      // Log the update
      await ctx.runMutation(internal.domains.operations.adminAuditLog.logAdminActionInternal, {
        action: "update_api_key",
        actionCategory: "security_event",
        actor: userId,
        resourceType: "userApiKeys",
        resourceId: existing._id,
        before: beforeState,
        after: { provider, updatedAt: now },
        reason: `User updated API key for provider: ${provider}`,
        metadata: {
          provider,
          previousUpdateAge: existing.updatedAt ? now - existing.updatedAt : null,
        },
      }).catch((err) => {
        console.warn('[saveEncryptedApiKeyPublic] Failed to log audit entry:', err);
      });

    } else {
      // Create new key
      const newKeyId = await ctx.db.insert("userApiKeys", {
        userId,
        provider,
        encryptedApiKey,
        createdAt: now,
        updatedAt: now
      });

      // Log the creation
      await ctx.runMutation(internal.domains.operations.adminAuditLog.logAdminActionInternal, {
        action: "create_api_key",
        actionCategory: "security_event",
        actor: userId,
        resourceType: "userApiKeys",
        resourceId: newKeyId,
        before: null,
        after: { provider, createdAt: now },
        reason: `User created new API key for provider: ${provider}`,
        metadata: {
          provider,
          isFirstKey: true,
        },
      }).catch((err) => {
        console.warn('[saveEncryptedApiKeyPublic] Failed to log audit entry:', err);
      });
    }

    return null;
  },
});

export const listApiKeyStatuses = query({
  args: { providers: v.array(v.string()) },
  returns: v.array(
    v.object({ provider: v.string(), hasKey: v.boolean(), createdAt: v.optional(v.number()) })
  ),
  handler: async (ctx, { providers }) => {
    const results: Array<{ provider: string; hasKey: boolean; createdAt?: number }> = [];
    const userId = await getAuthUserId(ctx);
    for (const provider of providers) {
      if (!userId) {
        results.push({ provider, hasKey: false });
        continue;
      }
      const rec = await ctx.db
        .query("userApiKeys")
        .withIndex("by_user_provider", (q) =>
          q.eq("userId", userId).eq("provider", provider)
        )
        .first() as Doc<"userApiKeys"> | null;
      results.push({ provider, hasKey: Boolean(rec?.encryptedApiKey && rec.encryptedApiKey.length > 0), createdAt: rec?.createdAt });
    }
    return results;
  },
});

export const saveApiKey = mutation({
  args: {
    provider: v.string(),
    apiKey: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, { provider: _provider, apiKey: _apiKey }) => {
    // Deprecated in favor of client-side E2E encryption via saveEncryptedApiKeyPublic.
    // Keeping the endpoint for backward compatibility but fail fast with guidance.
    throw new Error(
      "api.domains.auth.apiKeys.saveApiKey is deprecated. Use api.domains.auth.apiKeys.saveEncryptedApiKeyPublic with a client-encrypted value (see src/lib/e2eCrypto.ts)."
    );
  },
});

export const deleteApiKey = mutation({
  args: { provider: v.string() },
  returns: v.null(),
  handler: async (ctx, { provider }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", userId).eq("provider", provider)
      )
      .first() as Doc<"userApiKeys"> | null;

    if (existing) {
      // Capture state before deletion
      const keySnapshot = {
        _id: existing._id,
        userId: existing.userId,
        provider: existing.provider,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
        // Note: DO NOT log encryptedApiKey value for security
      };

      // Delete the key
      await ctx.db.delete(existing._id);

      // Log the security action
      await ctx.runMutation(internal.domains.operations.adminAuditLog.logAdminActionInternal, {
        action: "delete_api_key",
        actionCategory: "security_event",
        actor: userId,
        resourceType: "userApiKeys",
        resourceId: existing._id,
        before: keySnapshot,
        after: { deleted: true },
        reason: `User deleted API key for provider: ${provider}`,
        metadata: {
          provider,
          keyAge: existing.createdAt ? Date.now() - existing.createdAt : null,
        },
      }).catch((err) => {
        console.warn('[deleteApiKey] Failed to log audit entry:', err);
      });
    }
    return null;
  },
});

// Internal: fetch the encrypted API key string (for server-side decryption)
export const getEncryptedApiKey = internalQuery({
  args: { provider: v.string() },
  returns: v.union(v.object({ encryptedApiKey: v.string(), createdAt: v.optional(v.number()) }), v.null()),
  handler: async (ctx, { provider }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const rec = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user_provider", (q) => q.eq("userId", userId).eq("provider", provider))
      .first() as Doc<"userApiKeys"> | null;
    if (!rec || !rec.encryptedApiKey) return null;
    return { encryptedApiKey: rec.encryptedApiKey, createdAt: rec.createdAt };
  },
});

// Internal: upsert the encrypted API key (value already encrypted by an action)
export const saveEncryptedApiKey = internalMutation({
  args: { provider: v.string(), encryptedApiKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { provider, encryptedApiKey }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const existing = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user_provider", (q) => q.eq("userId", userId).eq("provider", provider))
      .first() as Doc<"userApiKeys"> | null;

    const now = Date.now();

    if (existing) {
      // Update existing key
      const beforeState = {
        _id: existing._id,
        provider: existing.provider,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };

      await ctx.db.patch(existing._id, { encryptedApiKey, updatedAt: now });

      // Log the update
      await ctx.runMutation(internal.domains.operations.adminAuditLog.logAdminActionInternal, {
        action: "update_api_key_internal",
        actionCategory: "security_event",
        actor: userId,
        resourceType: "userApiKeys",
        resourceId: existing._id,
        before: beforeState,
        after: { provider, updatedAt: now },
        reason: `System updated API key for provider: ${provider}`,
        metadata: {
          provider,
          previousUpdateAge: existing.updatedAt ? now - existing.updatedAt : null,
          source: "internal",
        },
      }).catch((err) => {
        console.warn('[saveEncryptedApiKey] Failed to log audit entry:', err);
      });

    } else {
      // Create new key
      const newKeyId = await ctx.db.insert("userApiKeys", {
        userId,
        provider,
        encryptedApiKey,
        createdAt: now,
        updatedAt: now
      });

      // Log the creation
      await ctx.runMutation(internal.domains.operations.adminAuditLog.logAdminActionInternal, {
        action: "create_api_key_internal",
        actionCategory: "security_event",
        actor: userId,
        resourceType: "userApiKeys",
        resourceId: newKeyId,
        before: null,
        after: { provider, createdAt: now },
        reason: `System created new API key for provider: ${provider}`,
        metadata: {
          provider,
          isFirstKey: true,
          source: "internal",
        },
      }).catch((err) => {
        console.warn('[saveEncryptedApiKey] Failed to log audit entry:', err);
      });
    }

    return null;
  },
});
