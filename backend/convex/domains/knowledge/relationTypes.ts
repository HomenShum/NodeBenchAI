import { mutation } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Seed the `relationTypes` table with default graph edge definitions.
 *
 * Run once via: `npx convex run seedRelationTypes`
 */
export const seedRelationTypes = mutation({
  // No args required for the seed operation
  args: {},
  returns: v.null(),
  handler: async (ctx, _args) => {
    const defaults = [
      { id: "child",      name: "Child",     icon: "📂" },
      { id: "relatedTo",  name: "Related",   icon: "🔗" },
      { id: "hashtag",    name: "Hashtag",   icon: "#" },
      { id: "author",     name: "Author",    icon: "✍️" },
    ] as const;

    for (const r of defaults) {
      // Avoid duplicate rows if the seed has already been run.
      const existing = await ctx.db
        .query("relationTypes")
        .filter((q) => q.eq(q.field("id"), r.id))
        .unique();
      if (!existing) {
        await ctx.db.insert("relationTypes", r);
      }
    }

    return null;
  },
}); 
