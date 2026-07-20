import { v } from "convex/values";
import { query, internalQuery } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

/**
 * Internal helper: look up a user by email.
 * Used by action files that need a user._id but can't access ctx.db directly.
 */
export const getUserByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.object({ _id: v.id("users") }), v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), args.email))
      .first();
    if (!user) return null;
    return { _id: user._id };
  },
});

// List users for typeahead assignment. This is intentionally simple and unscoped.
// In a team/workspace setup, you would likely filter to teammates.
export const list = query({
  args: {
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const q = (args.query ?? "").toLowerCase().trim();
    const limit = Math.min(Math.max(1, args.limit ?? 10), 50);

    // Minimal scan + filter. For larger user bases, add a search index.
    const rows = await ctx.db.query("users").collect();
    const filtered = rows
      .filter((u: any) => {
        if (!q) return true;
        const name = String(u?.name ?? "").toLowerCase();
        const email = String(u?.email ?? "").toLowerCase();
        return name.includes(q) || email.includes(q) || String(u._id).includes(q);
      })
      .slice(0, limit)
      .map((u: any) => ({ _id: u._id as Id<"users">, name: u?.name, image: u?.image }));

    return filtered;
  },
});
