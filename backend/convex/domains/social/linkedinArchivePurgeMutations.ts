import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

export const deleteArchiveRowsByIds = internalMutation({
  args: {
    ids: v.array(v.id("linkedinPostArchive")),
  },
  handler: async (ctx, args) => {
    let deleted = 0;
    for (const id of args.ids) {
      await ctx.db.delete(id);
      deleted++;
    }
    return { deleted };
  },
});

