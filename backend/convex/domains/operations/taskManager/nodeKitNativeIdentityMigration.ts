import { v } from "convex/values";

import { internalMutation } from "../../../_generated/server";

const PAGE_SIZE = 100;
const tableValidator = v.union(
  v.literal("agentTaskSessions"),
  v.literal("agentTaskTraces"),
  v.literal("agentIdentities"),
);

type MigrationTable =
  | "agentTaskSessions"
  | "agentTaskTraces"
  | "agentIdentities";

export function legacyNativeIdentityPatch(
  table: MigrationTable,
  document: Record<string, unknown>,
): Record<string, undefined> | null {
  if (table === "agentTaskSessions" || table === "agentTaskTraces") {
    return document.nativeIdentity === undefined
      ? null
      : { nativeIdentity: undefined };
  }
  const legacyKeys = [
    "identityContractVersion",
    "nativeSessionId",
    "nativeSessionGeneration",
    "nativePeerId",
    "nativeIdentitySnapshotHash",
  ] as const;
  return legacyKeys.some((key) => document[key] !== undefined)
    ? Object.fromEntries(legacyKeys.map((key) => [key, undefined]))
    : null;
}

export const migrateLegacyNativeIdentityPage = internalMutation({
  args: {
    table: tableValidator,
    cursor: v.optional(v.string()),
    dryRun: v.boolean(),
  },
  returns: v.object({
    table: tableValidator,
    dryRun: v.boolean(),
    scanned: v.number(),
    matched: v.number(),
    patched: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      cursor: args.cursor ?? null,
      numItems: PAGE_SIZE,
    });
    let matched = 0;
    let patched = 0;
    for (const document of page.page) {
      const patch = legacyNativeIdentityPatch(
        args.table,
        document as unknown as Record<string, unknown>,
      );
      if (!patch) continue;
      matched += 1;
      if (!args.dryRun) {
        await ctx.db.patch(document._id, patch);
        patched += 1;
      }
    }
    return {
      table: args.table,
      dryRun: args.dryRun,
      scanned: page.page.length,
      matched,
      patched,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
