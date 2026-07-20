/**
 * Pure helpers and shared types extracted from `EntityNotebookLive.tsx`.
 *
 * These live in a sibling module so the main component file stays focused on
 * orchestration (state + effects + JSX). The functions here are referentially
 * transparent and individually unit-testable; moving them out lets the main
 * file drop below its 2.2k-line cap without rewiring any hook behaviour.
 *
 * Re-exported from `EntityNotebookLive.tsx` for backwards compatibility with
 * existing tests that import by component-file path.
 */

import type { Id } from "@convex/_generated/dataModel";
import type { BlockChip } from "./BlockChipRenderer";

export type BlockKind =
  | "text"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bullet"
  | "todo"
  | "quote"
  | "callout"
  | "code"
  | "image"
  | "evidence"
  | "mention"
  | "generated_marker";

export type AuthorKind = "user" | "agent" | "anonymous";
export type AccessMode = "read" | "append" | "edit";

export type LiveBlock = {
  _id: Id<"productBlocks">;
  ownerKey: string;
  entityId: Id<"productEntities">;
  parentBlockId?: Id<"productBlocks">;
  kind: BlockKind;
  authorKind: AuthorKind;
  authorId?: string;
  content: BlockChip[];
  positionInt: number;
  positionFrac: string;
  isChecked?: boolean;
  sourceSessionId?: Id<"productChatSessions">;
  sourceToolStep?: number;
  sourceRefIds?: string[];
  attributes?: Record<string, unknown>;
  revision: number;
  accessMode?: AccessMode;
  isPublic?: boolean;
  updatedAt: number;
};

export type ParsedNotebookMutationError = {
  code?: string;
  current?: number;
  expected?: number;
  retryAfterMs?: number;
  message?: string;
  requestId?: string;
};

export function chipsToPlainText(chips: BlockChip[]): string {
  return chips
    .map((c) => {
      if (c.type === "linebreak") return "\n";
      if (c.type === "mention") return `${c.mentionTrigger ?? "@"}${c.value}`;
      if (c.type === "link") return c.value;
      if (c.type === "image") return "";
      return c.value;
    })
    .join("");
}

export function chipsEqual(left: BlockChip[] | undefined, right: BlockChip[] | undefined): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

export function isSyncEditableBlock(block: Pick<LiveBlock, "kind" | "content">): boolean {
  return (
    block.kind !== "image" &&
    block.kind !== "generated_marker" &&
    !block.content.some((chip) => chip.type === "image")
  );
}

export function isTriviallyEmptyNotebookBlock(
  block: LiveBlock | undefined,
  displayContent: BlockChip[],
): boolean {
  if (!block) return false;
  if (block.kind !== "text") return false;
  if (block.authorKind !== "user") return false;
  if ((block.sourceRefIds?.length ?? 0) > 0) return false;
  return chipsToPlainText(displayContent).trim().length === 0;
}

export function resolvePresenceSelfUserId(
  viewerOwnerKey?: string | null,
  anonymousSessionId?: string | null,
): string | null {
  if (viewerOwnerKey?.trim()) return viewerOwnerKey.trim();
  const trimmed = anonymousSessionId?.trim();
  return trimmed ? `anon:${trimmed}` : null;
}

export function shouldRefreshAgentNotebookProjection(
  blocks: LiveBlock[] | undefined,
  snapshot:
    | {
        reportUpdatedAt?: number;
        blocks?: Array<unknown>;
      }
    | null
    | undefined,
) {
  if (!blocks) return false;
  if (blocks.length === 0) {
    return Array.isArray(snapshot?.blocks) && snapshot!.blocks!.length > 0;
  }
  if (!snapshot?.reportUpdatedAt) return false;

  const latestUserEditAt = blocks
    .filter((block) => block.authorKind === "user")
    .reduce<number | null>((latest, block) => Math.max(latest ?? 0, block.updatedAt ?? 0), null);
  if (latestUserEditAt != null && latestUserEditAt > snapshot.reportUpdatedAt) {
    return false;
  }

  const latestAgentBlockAt = blocks
    .filter((block) => block.authorKind === "agent")
    .reduce<number | null>((latest, block) => Math.max(latest ?? 0, block.updatedAt ?? 0), null);

  if (latestAgentBlockAt == null) {
    return Array.isArray(snapshot.blocks) && snapshot.blocks.length > 0;
  }

  return latestAgentBlockAt < snapshot.reportUpdatedAt;
}

export function getNotebookLoadState(args: {
  loadedCount: number;
  totalCount?: number;
  paginationStatus?: string;
}) {
  const totalCount = Math.max(args.totalCount ?? args.loadedCount, args.loadedCount);
  const paginationStatus = args.paginationStatus ?? "Exhausted";
  const remainingCount = Math.max(totalCount - args.loadedCount, 0);
  return {
    totalCount,
    remainingCount,
    fullyLoaded: paginationStatus === "Exhausted" && remainingCount === 0,
    canLoadMore: paginationStatus === "CanLoadMore" || paginationStatus === "LoadingMore",
    isLoadingMore: paginationStatus === "LoadingMore" || paginationStatus === "LoadingFirstPage",
  };
}


// Pull the Convex Request ID out of a thrown error's message string.
// Returns null if no ID present (e.g. purely client-side error).
export function extractConvexRequestId(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = /\[Request ID:\s*([a-f0-9]+)\]/i.exec(message);
  return match ? match[1] : null;
}

export function parseNotebookMutationError(error: unknown): ParsedNotebookMutationError {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error == null
          ? undefined
          : String(error);

  const requestId = extractConvexRequestId(error) ?? undefined;

  // ConvexError surfaces structured payload on `err.data` (the HTTP client
  // replaces `err.message` with "[Request ID: ...] Server Error"). Prefer
  // reading err.data directly; fall back to regex for legacy serializations.
  if (
    error &&
    typeof error === "object" &&
    (error as { constructor?: { name?: string } }).constructor?.name === "ConvexError"
  ) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object") {
      return { ...(data as ParsedNotebookMutationError), message, requestId };
    }
  }

  if (!message) return { requestId };
  if (
    message.includes("OptimisticConcurrencyControlFailure") &&
    message.includes("productBlockWriteWindows")
  ) {
    return {
      code: "RATE_LIMITED",
      retryAfterMs: 10_000,
      message,
      requestId,
    };
  }
  const match = /ConvexError:\s*(\{.*\})/s.exec(message);
  if (!match) {
    return { message, requestId };
  }
  try {
    const parsed = JSON.parse(match[1]) as ParsedNotebookMutationError;
    return {
      ...parsed,
      message,
      requestId,
    };
  } catch {
    return { message, requestId };
  }
}

export function describeNotebookMutationFailure(
  action: "save" | "mention" | "command",
  error: unknown,
): { title: string; detail?: string; level: "error" | "warning" } {
  const parsed = parseNotebookMutationError(error);
  if (parsed.code === "REVISION_MISMATCH") {
    const revisionDetail =
      typeof parsed.current === "number" && typeof parsed.expected === "number"
        ? `This block moved from revision ${parsed.expected} to ${parsed.current} in another tab or agent run.`
        : "Another tab or agent run updated this block first.";
    return {
      title: "Notebook changed in another tab",
      detail: `${revisionDetail} The latest version has been reloaded. Reapply your edit if it still matters.`,
      level: "warning",
    };
  }
  if (parsed.code === "RATE_LIMITED") {
    const waitSeconds =
      typeof parsed.retryAfterMs === "number" && parsed.retryAfterMs > 0
        ? Math.max(1, Math.ceil(parsed.retryAfterMs / 1000))
        : null;
    return {
      title: "Notebook write rate limit reached",
      detail: waitSeconds
        ? `Too many notebook edits landed in a short burst. Wait about ${waitSeconds}s and try again.`
        : "Too many notebook edits landed in a short burst. Wait a moment and try again.",
      level: "warning",
    };
  }
  if (parsed.code === "CONTENT_TOO_LARGE") {
    return {
      title: "Notebook block is too large",
      detail: "Split this block into smaller sections before saving it again.",
      level: "error",
    };
  }
  const actionLabel =
    action === "mention"
      ? "attach the mention"
      : action === "command"
        ? "finish the notebook command"
        : "save the notebook block";
  // Tail the Convex Request ID onto the detail so support can jump to the
  // exact log line with `npx convex logs --prod | grep <id>`.
  const detailWithId = parsed.requestId
    ? `${parsed.message ?? "Unknown error"} (ref: ${parsed.requestId})`
    : parsed.message;
  return {
    title: `Failed to ${actionLabel}`,
    detail: detailWithId,
    level: "error",
  };
}
