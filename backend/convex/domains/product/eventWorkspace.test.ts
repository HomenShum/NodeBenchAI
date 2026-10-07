import { describe, expect, it } from "vitest";

import { buildEventWorkspaceInputsFromNotebookPatch } from "./eventWorkspace";

describe("event workspace notebook action projection", () => {
  it("projects accepted notebook patches into workspace entities, claims, follow-ups, and captures", () => {
    const projected = buildEventWorkspaceInputsFromNotebookPatch({
      patch: {
        actionId: "notebook.organize_notes.ship-demo-day",
        action: "organize_notes",
        summary: "Grouped 1 capture.",
        proposedEntityChanges: [
          {
            kind: "upsert_entity",
            entityKey: "orbital-labs",
            name: "Orbital Labs",
            entityType: "company",
            confidence: 0.72,
            sourceCaptureIds: ["capture.1"],
          },
        ],
        proposedClaimChanges: [
          {
            kind: "propose_claim_update",
            claimId: "claim.orbital-seed",
            claim: "Orbital Labs is seed-stage.",
            status: "needs_review",
            evidenceIds: [],
            reason: "No evidence ids attached.",
          },
        ],
        proposedFollowUpChanges: [
          {
            kind: "create_followup",
            action: "Ask Alex about pilot criteria.",
            linkedEntityKeys: ["orbital-labs"],
            priority: "high",
            sourceCaptureIds: ["capture.1"],
          },
        ],
        proposedEdgeChanges: [],
        requiresConfirmation: false,
        runTrace: [{ label: "Group captures", detail: "Grouped notes." }],
      },
      captures: [
        {
          captureId: "capture.1",
          rawText: "Met Alex from Orbital Labs. Voice agent eval infra.",
          extractedEntityIds: ["orbital-labs"],
        },
      ],
    });

    expect(projected.entities).toEqual([
      expect.objectContaining({
        id: "orbital-labs",
        uri: "nodebench://entity/orbital-labs",
        type: "company",
        name: "Orbital Labs",
      }),
    ]);
    expect(projected.captures).toEqual([
      expect.objectContaining({
        captureId: "capture.1",
        status: "attached",
        extractedEntityIds: ["orbital-labs"],
      }),
    ]);
    expect(projected.claims).toEqual([
      expect.objectContaining({
        id: "claimorbital-seed",
        subjectId: "orbital-labs",
        status: "needs_evidence",
        promotionGate: "needs_human_review",
      }),
    ]);
    expect(projected.followUps).toEqual([
      expect.objectContaining({
        linkedEntityIds: ["orbital-labs"],
        due: "today",
        priority: "high",
      }),
    ]);
  });
});
