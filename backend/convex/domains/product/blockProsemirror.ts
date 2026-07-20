import { ProsemirrorSync } from "@convex-dev/prosemirror-sync";
import { components } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { query, mutation, type MutationCtx, type QueryCtx } from "../../_generated/server";
import { v } from "convex/values";

import { requireBlockReadAccessById, requireBlockWriteAccessById, requireProductIdentity } from "./helpers";
import { parseProductBlockSyncId } from "../../../shared/productBlockSync";
import {
  chipsToProsemirrorDoc,
  prosemirrorDocToChips,
} from "../../../shared/notebookBlockProsemirror";
import { productBlockChipValidator } from "./schema";

const prosemirrorSync = new ProsemirrorSync(components.prosemirrorSync);

type BlockLookup = {
  block: Doc<"productBlocks">;
  anonymousSessionId: string | null;
  shareToken: string | null;
};

function parseSyncIdentityOrThrow(id: string) {
  const parsed = parseProductBlockSyncId(id);
  if (!parsed) {
    throw new Error("Invalid notebook block sync id");
  }
  return parsed;
}

async function getBlockForRead(ctx: QueryCtx, syncId: string): Promise<BlockLookup> {
  const parsed = parseSyncIdentityOrThrow(syncId);
  const { block } = await requireBlockReadAccessById(ctx, {
    anonymousSessionId: parsed.anonymousSessionId,
    shareToken: parsed.shareToken,
    blockId: parsed.blockId as Id<"productBlocks">,
  });
  return {
    block,
    anonymousSessionId: parsed.anonymousSessionId,
    shareToken: parsed.shareToken,
  };
}

// Tolerant variant used ONLY by prosemirror-sync's `checkRead`. When a block
// is deleted (e.g. Backspace-merge removes an empty block), any Tiptap
// `useTiptapSync` subscription still polling `latestVersion` for that block's
// sync id races the React unmount and hits a deleted row. The strict reader
// throws "Notebook block not found", which surfaces as a noisy server error
// in the browser console even though the UI is already correct. This helper
// returns `null` for missing/soft-deleted blocks so the sync component can
// short-circuit gracefully; all write paths and the seed query still use the
// strict reader above.
async function checkReadTolerant(ctx: QueryCtx, syncId: string): Promise<void> {
  const parsed = parseProductBlockSyncId(syncId);
  if (!parsed) return;
  const block = await ctx.db.get(parsed.blockId as Id<"productBlocks">);
  if (!block || block.deletedAt) return;
  await requireBlockReadAccessById(ctx, {
    anonymousSessionId: parsed.anonymousSessionId,
    shareToken: parsed.shareToken,
    blockId: parsed.blockId as Id<"productBlocks">,
  });
}

async function getBlockForWrite(ctx: MutationCtx, syncId: string): Promise<BlockLookup> {
  const parsed = parseSyncIdentityOrThrow(syncId);
  const { block } = await requireBlockWriteAccessById(ctx, {
    anonymousSessionId: parsed.anonymousSessionId,
    shareToken: parsed.shareToken,
    blockId: parsed.blockId as Id<"productBlocks">,
  });
  return {
    block,
    anonymousSessionId: parsed.anonymousSessionId,
    shareToken: parsed.shareToken,
  };
}

export async function mirrorNotebookSnapshotIntoBlock(
  ctx: MutationCtx,
  syncId: string,
  snapshot: string,
): Promise<void> {
  const { block, anonymousSessionId } = await getBlockForWrite(ctx, syncId);
  const identity = await requireProductIdentity(ctx, anonymousSessionId);
  const chips = prosemirrorDocToChips(JSON.parse(snapshot));
  if (JSON.stringify(chips) === JSON.stringify(block.content)) {
    return;
  }
  await ctx.db.patch(block._id, {
    content: chips,
    revision: block.revision + 1,
    authorKind: typeof identity.rawUserId === "string" ? "user" : "anonymous",
    authorId:
      typeof identity.rawUserId === "string"
        ? identity.rawUserId
        : identity.anonymousSessionId ?? block.authorId,
    updatedAt: Date.now(),
  });
}

export const {
  getSnapshot,
  submitSnapshot,
  latestVersion,
  getSteps,
  submitSteps,
} = prosemirrorSync.syncApi({
  async checkRead(ctx, id) {
    await checkReadTolerant(ctx as QueryCtx, id);
  },
  async checkWrite(ctx, id) {
    await getBlockForWrite(ctx as MutationCtx, id);
  },
  async onSnapshot(ctx, id, snapshot) {
    await mirrorNotebookSnapshotIntoBlock(ctx as MutationCtx, id, snapshot);
  },
});

export const getBlockSyncSeed = query({
  args: {
    id: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      blockId: v.id("productBlocks"),
      revision: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { block } = await getBlockForRead(ctx, args.id);
    return {
      blockId: block._id,
      revision: block.revision,
      updatedAt: block.updatedAt,
    };
  },
});

export const submitOfflineSnapshot = mutation({
  args: {
    id: v.string(),
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    chips: v.array(productBlockChipValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { anonymousSessionId, shareToken } = await getBlockForWrite(ctx, args.id);
    await requireBlockWriteAccessById(ctx, {
      anonymousSessionId: args.anonymousSessionId ?? anonymousSessionId,
      shareToken: args.shareToken ?? shareToken,
      blockId: parseSyncIdentityOrThrow(args.id).blockId as Id<"productBlocks">,
    });

    const latest = await ctx.runQuery(components.prosemirrorSync.lib.latestVersion, {
      id: args.id,
    });
    const nextVersion = (typeof latest === "number" ? latest : 0) + 1;
    const snapshot = JSON.stringify(chipsToProsemirrorDoc(args.chips));
    await ctx.runMutation(components.prosemirrorSync.lib.submitSnapshot, {
      id: args.id,
      version: nextVersion,
      content: snapshot,
      pruneSnapshots: true,
    });
    await mirrorNotebookSnapshotIntoBlock(ctx, args.id, snapshot);
    return null;
  },
});
