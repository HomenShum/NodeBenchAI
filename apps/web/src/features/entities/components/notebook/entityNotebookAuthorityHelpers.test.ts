import { describe, expect, it } from "vitest";

import type { Id } from "@convex/_generated/dataModel";
import { acceptDecorationIntoNotebook } from "./acceptDecorationIntoNotebook";
import type { DiligenceDecorationData } from "./DiligenceDecorationPlugin";
import {
  buildNotebookAuthorityRemainderCompletionKey,
  evaluateNotebookAuthorityCandidate,
  hasNotebookAuthorityCandidateChanged,
  readScratchpadBaseRunId,
  recoverNotebookAuthorityCandidate,
  runInFlightOnly,
  shouldAutoCommitNotebookAuthorityProposal,
  shouldSubmitNewNotebookAuthorityAttempt,
  type NotebookAuthorityCandidateEvaluation,
} from "./entityNotebookAuthorityHelpers";
import type { LiveBlock } from "./entityNotebookLiveHelpers";

const blockId = "block_authority_1" as Id<"productBlocks">;
const entityId = "entity_authority_1" as Id<"productEntities">;
const scratchpadId = "scratchpad_authority_1" as Id<"agentScratchpads">;

function emptyTextBlock(overrides: Partial<LiveBlock> = {}): LiveBlock {
  return {
    _id: blockId,
    ownerKey: "user:owner",
    entityId,
    kind: "text",
    authorKind: "user",
    content: [],
    positionInt: 0,
    positionFrac: "a0",
    revision: 4,
    accessMode: "edit",
    updatedAt: 1,
    ...overrides,
  };
}

function decoration(
  overrides: Partial<DiligenceDecorationData> = {},
): DiligenceDecorationData {
  return {
    blockType: "product",
    overallTier: "verified",
    headerText: "Product signal",
    bodyProse: "One concrete, source-backed product finding.",
    scratchpadRunId: "run_real_1",
    version: 7,
    updatedAt: 2,
    sourceRefIds: ["src_1", "src_2"],
    sourceCount: 2,
    ...overrides,
  };
}

function evaluate(
  overrides: Partial<
    Parameters<typeof evaluateNotebookAuthorityCandidate>[0]
  > = {},
): NotebookAuthorityCandidateEvaluation {
  const liveDecoration = decoration();
  const accepted = acceptDecorationIntoNotebook({
    decoration: liveDecoration,
    frozenAt: 1_000,
  });
  if (!accepted.drafts) throw new Error("Expected a real accepted plan.");
  return evaluateNotebookAuthorityCandidate({
    block: emptyTextBlock(),
    displayContent: [],
    drafts: accepted.drafts,
    decorationSourceRefIds: liveDecoration.sourceRefIds,
    decorationScratchpadRunId: liveDecoration.scratchpadRunId,
    scratchpadThreadRunId: "run_real_1",
    scratchpadId,
    entityId,
    blockType: liveDecoration.blockType,
    overallTier: liveDecoration.overallTier,
    decorationVersion: liveDecoration.version,
    decorationUpdatedAt: liveDecoration.updatedAt,
    currentTimeMs: 10_000,
    authorityScopeKey: "review",
    ...overrides,
  });
}

describe("evaluateNotebookAuthorityCandidate", () => {
  it("selects one same-kind replacement from the real multi-draft accept plan", () => {
    const result = evaluate();

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.candidate.selectedDraftIndex).toBe(2);
    expect(result.candidate.operationKey).toMatch(/^notebook-decoration-op:/);
    expect(
      buildNotebookAuthorityRemainderCompletionKey(
        result.candidate.operationKey,
      ),
    ).toBe(`${result.candidate.operationKey}:remainder:v1`);
    expect(result.candidate.proposedContent).toEqual([
      { type: "text", value: "One concrete, source-backed product finding." },
    ]);
    expect(result.candidate.proposedSourceRefIds).toEqual(["src_1", "src_2"]);
    expect(result.candidate.remainingDrafts).toHaveLength(2);
    expect(result.candidate.remainingDrafts.map((draft) => draft.kind)).toEqual(
      ["generated_marker", "heading_3"],
    );
    expect(result.candidate.selectedAttributesRemainExplicit).toBe(true);
  });

  it("binds a section-suffixed projection through its server-origin base run", () => {
    const result = evaluate({
      decorationScratchpadRunId: "run_real_1:section-product",
      decorationScratchpadBaseRunId: readScratchpadBaseRunId({
        kind: "scratchpad-checkpoint",
        scratchpadBaseRunId: "run_real_1",
      }),
    });

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.candidate.operationKey).toMatch(/^notebook-decoration-op:/);
  });

  it("is deterministic for effect retries and changes with the authority scope", () => {
    const first = evaluate();
    const retried = evaluate();
    const delegated = evaluate({ authorityScopeKey: "grant_1" });

    expect(first.eligible && retried.eligible).toBe(true);
    if (!first.eligible || !retried.eligible || !delegated.eligible) return;
    expect(retried.candidate.idempotencyKey).toBe(
      first.candidate.idempotencyKey,
    );
    expect(delegated.candidate.idempotencyKey).not.toBe(
      first.candidate.idempotencyKey,
    );
    expect(first.candidate.idempotencyKey.length).toBeLessThan(200);
    expect(delegated.candidate.operationKey).toBe(first.candidate.operationKey);
  });

  it.each([
    [
      "requires the real scratchpad row id",
      { scratchpadId: null },
      "scratchpad_run_unavailable",
    ],
    [
      "rejects a decoration from a different thread run",
      { scratchpadThreadRunId: "run_other" },
      "scratchpad_run_mismatch",
    ],
    [
      "keeps single-source evidence on the explicit path",
      { overallTier: "single-source" },
      "evidence_tier_insufficient",
    ],
    [
      "rejects invalid evidence timestamps before a proposal can be submitted",
      { decorationUpdatedAt: 0 },
      "decoration_timestamp_invalid",
    ],
    [
      "rejects evidence timestamps beyond the server clock-skew allowance",
      { decorationUpdatedAt: 310_001, currentTimeMs: 10_000 },
      "decoration_timestamp_invalid",
    ],
    [
      "requires real source provenance",
      { decorationSourceRefIds: [] },
      "source_refs_required",
    ],
    [
      "rejects a non-editable target",
      { block: emptyTextBlock({ accessMode: "read" }) },
      "target_not_editable",
    ],
    [
      "rejects a non-empty target",
      {
        block: emptyTextBlock({
          content: [{ type: "text", value: "Existing" }],
        }),
        displayContent: [{ type: "text", value: "Existing" }],
      },
      "target_not_trivially_empty",
    ],
    [
      "rejects optimistic unsaved content",
      { displayContent: [{ type: "text", value: "Typing" }] },
      "target_not_trivially_empty",
    ],
    [
      "rejects target attributes",
      { block: emptyTextBlock({ attributes: { protected: true } }) },
      "target_has_attributes",
    ],
  ])("%s", (_label, overrides, reason) => {
    expect(evaluate(overrides as never)).toEqual({ eligible: false, reason });
  });

  it("fails closed when the selected draft would lose source provenance", () => {
    const liveDecoration = decoration();
    const accepted = acceptDecorationIntoNotebook({
      decoration: liveDecoration,
      frozenAt: 1_000,
    });
    const drafts = accepted.drafts!.map((draft) =>
      draft.kind === "text" ? { ...draft, sourceRefIds: ["src_1"] } : draft,
    );

    expect(evaluate({ drafts })).toEqual({
      eligible: false,
      reason: "source_refs_not_preserved",
    });
  });

  it.each([
    ["trims", [" src_1", "src_2"]],
    ["dedupes", ["src_1", "src_1"]],
  ])(
    "rejects source refs that the client would otherwise %s",
    (_label, sourceRefIds) => {
      expect(evaluate({ decorationSourceRefIds: sourceRefIds })).toEqual({
        eligible: false,
        reason: "source_refs_not_preserved",
      });
    },
  );

  it("keeps draft attributes explicit and rejects them if no remaining draft preserves them", () => {
    const liveDecoration = decoration();
    const accepted = acceptDecorationIntoNotebook({
      decoration: liveDecoration,
      frozenAt: 1_000,
    });
    const drafts = accepted.drafts!.map((draft) =>
      draft.kind === "text" ? draft : { ...draft, attributes: undefined },
    );

    expect(evaluate({ drafts })).toEqual({
      eligible: false,
      reason: "draft_attributes_not_preserved",
    });
  });

  it("refuses a replacement above the server's bounded proposal payload", () => {
    const result = evaluate();
    if (!result.eligible) throw new Error("Expected eligible candidate.");
    const oversizedDrafts = [
      ...result.candidate.remainingDrafts,
      {
        kind: "text" as const,
        content: [{ type: "text" as const, value: "x".repeat(50_001) }],
        sourceRefIds: ["src_1", "src_2"],
      },
    ];

    expect(evaluate({ drafts: oversizedDrafts })).toEqual({
      eligible: false,
      reason: "proposal_content_too_large",
    });
  });

  it("keeps oversized multi-block plans entirely on the explicit path", () => {
    const liveDecoration = decoration({
      bodyProse: Array.from(
        { length: 25 },
        (_, index) => `Source-backed finding ${index + 1}.`,
      ).join("\n\n"),
    });
    const drafts = acceptDecorationIntoNotebook({
      decoration: liveDecoration,
      frozenAt: 1_000,
    }).drafts!;

    expect(evaluate({ drafts })).toEqual({
      eligible: false,
      reason: "remainder_plan_too_large",
    });
  });
});

describe("shouldSubmitNewNotebookAuthorityAttempt", () => {
  it("reuses a persisted review proposal across reloads", () => {
    expect(
      shouldSubmitNewNotebookAuthorityAttempt({
        status: "pending",
        persistedGrantId: null,
      }),
    ).toBe(false);
  });

  it("creates one new attempt when a different live grant becomes available", () => {
    expect(
      shouldSubmitNewNotebookAuthorityAttempt({
        status: "pending",
        persistedGrantId: null,
        activeGrantId: "grant_live",
      }),
    ).toBe(true);
  });

  it("revalidates the persisted proposal when the same grant resumes", () => {
    expect(
      shouldSubmitNewNotebookAuthorityAttempt({
        status: "pending",
        persistedGrantId: "grant_live",
        activeGrantId: "grant_live",
      }),
    ).toBe(false);
  });

  it("never replaces a committed operation with another attempt", () => {
    expect(
      shouldSubmitNewNotebookAuthorityAttempt({
        status: "committed",
        persistedGrantId: "grant_old",
        activeGrantId: "grant_new",
      }),
    ).toBe(false);
  });
});

describe("shouldAutoCommitNotebookAuthorityProposal", () => {
  it("continues a server-delegated proposal without another approval click", () => {
    expect(
      shouldAutoCommitNotebookAuthorityProposal({
        approvalMode: "delegated",
        delegationDenied: false,
      }),
    ).toBe(true);
  });

  it("stops immediately when initial grant validation denied delegation", () => {
    expect(
      shouldAutoCommitNotebookAuthorityProposal({
        approvalMode: "explicit",
        delegationDenied: true,
      }),
    ).toBe(false);
  });
});

describe("hasNotebookAuthorityCandidateChanged", () => {
  function snapshotFromCandidate(
    candidate: Extract<
      NotebookAuthorityCandidateEvaluation,
      { eligible: true }
    >["candidate"],
  ) {
    return {
      operationKey: candidate.operationKey,
      proposalId: "proposal_1",
      receiptId: null,
      blockId: candidate.blockId,
      baseRevision: candidate.baseRevision,
      proposedContent: candidate.proposedContent,
      proposedSourceRefIds: candidate.proposedSourceRefIds,
      runId: candidate.runId,
    };
  }

  it("does not retry an unchanged blocked candidate", () => {
    const evaluated = evaluate();
    if (!evaluated.eligible) throw new Error("Expected eligible candidate.");
    expect(
      hasNotebookAuthorityCandidateChanged(
        snapshotFromCandidate(evaluated.candidate),
        evaluated.candidate,
      ),
    ).toBe(false);
  });

  it.each([
    ["revision", { baseRevision: 5 }],
    [
      "content",
      { proposedContent: [{ type: "text" as const, value: "Updated" }] },
    ],
    ["sources", { proposedSourceRefIds: ["src_1", "src_3"] }],
  ])("allows one retry after the candidate %s changes", (_label, changes) => {
    const evaluated = evaluate();
    if (!evaluated.eligible) throw new Error("Expected eligible candidate.");
    expect(
      hasNotebookAuthorityCandidateChanged(
        snapshotFromCandidate(evaluated.candidate),
        { ...evaluated.candidate, ...changes },
      ),
    ).toBe(true);
  });
});

describe("runInFlightOnly", () => {
  it("dedupes a live commit but retries the same proposal after pause and resume", async () => {
    const inFlight = new Map<
      string,
      Promise<{ receiptId?: string; delegationDenied?: boolean }>
    >();
    let grantState: "paused" | "active" = "paused";
    let calls = 0;
    const commit = () =>
      runInFlightOnly(inFlight, "proposal_1:delegated", async () => {
        calls += 1;
        return grantState === "paused"
          ? { delegationDenied: true }
          : { receiptId: "receipt_1" };
      });

    const [first, concurrent] = await Promise.all([commit(), commit()]);
    expect(first).toEqual({ delegationDenied: true });
    expect(concurrent).toEqual(first);
    expect(calls).toBe(1);

    grantState = "active";
    await expect(commit()).resolves.toEqual({ receiptId: "receipt_1" });
    expect(calls).toBe(2);
  });
});

describe("recoverNotebookAuthorityCandidate", () => {
  it("rebuilds the explicit remainder after reload even when the target is no longer empty", () => {
    const evaluated = evaluate();
    if (!evaluated.eligible) throw new Error("Expected eligible candidate.");
    const original = evaluated.candidate;
    const liveDecoration = decoration();
    const drafts = acceptDecorationIntoNotebook({
      decoration: liveDecoration,
      frozenAt: 1_000,
    }).drafts!;
    const committedBlock = emptyTextBlock({
      revision: original.baseRevision + 1,
      content: original.proposedContent,
      sourceRefIds: original.proposedSourceRefIds,
      authorKind: "agent",
    });

    const recovered = recoverNotebookAuthorityCandidate({
      operation: {
        operationKey: original.operationKey,
        proposalId: "proposal_1",
        receiptId: "receipt_1",
        blockId: original.blockId,
        baseRevision: original.baseRevision,
        proposedContent: original.proposedContent,
        proposedSourceRefIds: original.proposedSourceRefIds,
        runId: original.runId,
      },
      expectedOperationKey: original.operationKey,
      block: committedBlock,
      drafts,
    });
    const recoveredForNewGrant = recoverNotebookAuthorityCandidate({
      operation: {
        operationKey: original.operationKey,
        proposalId: "proposal_1",
        receiptId: "receipt_1",
        blockId: original.blockId,
        baseRevision: original.baseRevision,
        proposedContent: original.proposedContent,
        proposedSourceRefIds: original.proposedSourceRefIds,
        runId: original.runId,
      },
      expectedOperationKey: original.operationKey,
      block: committedBlock,
      drafts,
      authorityScopeKey: "grant_new",
    });

    expect(recovered).toEqual(
      expect.objectContaining({
        operationKey: original.operationKey,
        selectedDraftIndex: original.selectedDraftIndex,
        remainingDrafts: original.remainingDrafts,
      }),
    );
    expect(recoveredForNewGrant?.idempotencyKey).not.toBe(
      recovered?.idempotencyKey,
    );
  });
});
