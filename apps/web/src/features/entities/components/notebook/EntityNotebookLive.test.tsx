import { describe, expect, it } from "vitest";

import {
  describeNotebookMutationFailure,
  getNotebookLoadState,
  parseNotebookMutationError,
  shouldRefreshAgentNotebookProjection,
} from "./EntityNotebookLive";

describe("shouldRefreshAgentNotebookProjection", () => {
  it("refreshes when a newer report exists than the latest agent-authored block", () => {
    expect(
      shouldRefreshAgentNotebookProjection(
        [
          {
            _id: "block_1",
            entityId: "entity_1",
            kind: "text",
            authorKind: "agent",
            content: [],
            positionInt: 1,
            positionFrac: "a0",
            revision: 1,
            updatedAt: 100,
          } as any,
        ],
        {
          reportUpdatedAt: 200,
          blocks: [{ id: "derived_1" }],
        },
      ),
    ).toBe(true);
  });

  it("does not refresh when user edits are newer than the saved report", () => {
    expect(
      shouldRefreshAgentNotebookProjection(
        [
          {
            _id: "block_1",
            entityId: "entity_1",
            kind: "text",
            authorKind: "agent",
            content: [],
            positionInt: 1,
            positionFrac: "a0",
            revision: 1,
            updatedAt: 100,
          } as any,
          {
            _id: "block_2",
            entityId: "entity_1",
            kind: "text",
            authorKind: "user",
            content: [],
            positionInt: 2,
            positionFrac: "a1",
            revision: 2,
            updatedAt: 250,
          } as any,
        ],
        {
          reportUpdatedAt: 200,
          blocks: [{ id: "derived_1" }],
        },
      ),
    ).toBe(false);
  });

  it("refreshes empty live blocks when a derived report projection exists", () => {
    expect(
      shouldRefreshAgentNotebookProjection([], {
        reportUpdatedAt: 200,
        blocks: [{ id: "derived_1" }],
      }),
    ).toBe(true);
  });
});

describe("getNotebookLoadState", () => {
  it("locks editing while more paginated blocks remain", () => {
    expect(
      getNotebookLoadState({
        loadedCount: 150,
        totalCount: 320,
        paginationStatus: "CanLoadMore",
      }),
    ).toEqual({
      totalCount: 320,
      remainingCount: 170,
      fullyLoaded: false,
      canLoadMore: true,
      isLoadingMore: false,
    });
  });

  it("unlocks editing once the full notebook is loaded", () => {
    expect(
      getNotebookLoadState({
        loadedCount: 42,
        totalCount: 42,
        paginationStatus: "Exhausted",
      }),
    ).toEqual({
      totalCount: 42,
      remainingCount: 0,
      fullyLoaded: true,
      canLoadMore: false,
      isLoadingMore: false,
    });
  });
});

describe("parseNotebookMutationError", () => {
  it("extracts structured ConvexError payloads", () => {
    const error = new Error(
      '[CONVEX] Server Error Uncaught ConvexError: {"code":"REVISION_MISMATCH","current":7,"expected":6}',
    );

    expect(parseNotebookMutationError(error)).toMatchObject({
      code: "REVISION_MISMATCH",
      current: 7,
      expected: 6,
    });
  });

  it("maps write-window OCC failures to a rate-limited shape", () => {
    const error = new Error(
      '{"code":"OptimisticConcurrencyControlFailure","message":"Documents read from or written to the \\"productBlockWriteWindows\\" table changed during the mutation."}',
    );

    expect(parseNotebookMutationError(error)).toMatchObject({
      code: "RATE_LIMITED",
      retryAfterMs: 10_000,
    });
  });
});

describe("describeNotebookMutationFailure", () => {
  it("turns revision conflicts into collaboration warnings", () => {
    const error = new Error(
      '[CONVEX] Server Error Uncaught ConvexError: {"code":"REVISION_MISMATCH","current":4,"expected":3}',
    );

    expect(describeNotebookMutationFailure("save", error)).toEqual({
      title: "Notebook changed in another tab",
      detail:
        "This block moved from revision 3 to 4 in another tab or agent run. The latest version has been reloaded. Reapply your edit if it still matters.",
      level: "warning",
    });
  });

  it("turns rate limits into a retryable warning", () => {
    const error = new Error(
      '[CONVEX] Server Error Uncaught ConvexError: {"code":"RATE_LIMITED","retryAfterMs":1800}',
    );

    expect(describeNotebookMutationFailure("save", error)).toEqual({
      title: "Notebook write rate limit reached",
      detail: "Too many notebook edits landed in a short burst. Wait about 2s and try again.",
      level: "warning",
    });
  });
});
