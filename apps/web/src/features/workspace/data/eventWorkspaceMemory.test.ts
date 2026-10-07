import { describe, expect, it } from "vitest";

import {
  EVENT_WORKSPACE_BUDGET_DECISIONS,
  EVENT_WORKSPACE_CLAIMS,
  EVENT_WORKSPACE_ENTITIES,
  EVENT_WORKSPACE_EVIDENCE,
  EVENT_WORKSPACE_FOLLOW_UPS,
} from "./eventWorkspaceMemory";

describe("event workspace memory fixture", () => {
  it("keeps entities, evidence, claims, and follow-ups connected", () => {
    const entityIds = new Set(EVENT_WORKSPACE_ENTITIES.map((entity) => entity.id));
    const evidenceIds = new Set(EVENT_WORKSPACE_EVIDENCE.map((evidence) => evidence.id));

    expect(EVENT_WORKSPACE_ENTITIES.length).toBeGreaterThanOrEqual(6);
    expect(EVENT_WORKSPACE_CLAIMS.length).toBeGreaterThanOrEqual(4);
    expect(EVENT_WORKSPACE_EVIDENCE.length).toBeGreaterThanOrEqual(5);

    for (const claim of EVENT_WORKSPACE_CLAIMS) {
      expect(entityIds.has(claim.subjectId), claim.id).toBe(true);
      expect(claim.evidenceIds.length).toBeGreaterThan(0);
      for (const evidenceId of claim.evidenceIds) {
        expect(evidenceIds.has(evidenceId), `${claim.id} -> ${evidenceId}`).toBe(true);
      }
    }

    for (const followUp of EVENT_WORKSPACE_FOLLOW_UPS) {
      expect(followUp.linkedEntityIds.length).toBeGreaterThan(0);
      for (const entityId of followUp.linkedEntityIds) {
        expect(entityIds.has(entityId), `${followUp.id} -> ${entityId}`).toBe(true);
      }
    }
  });

  it("preserves privacy and promotion gates for field-note claims", () => {
    const seedClaim = EVENT_WORKSPACE_CLAIMS.find((claim) => claim.id === "claim.orbital-seed-stage");

    expect(seedClaim).toMatchObject({
      status: "field_note",
      visibility: "private",
      promotionGate: "needs_public_source",
    });

    expect(
      EVENT_WORKSPACE_EVIDENCE.some(
        (evidence) => evidence.layer === "private_capture" && evidence.visibility === "private",
      ),
    ).toBe(true);
  });

  it("keeps paid search gated in event-serving budget defaults", () => {
    const eventCapture = EVENT_WORKSPACE_BUDGET_DECISIONS.find(
      (decision) => decision.scenario === "At-event capture",
    );
    const diligence = EVENT_WORKSPACE_BUDGET_DECISIONS.find(
      (decision) => decision.scenario === "Investment-grade diligence",
    );

    expect(eventCapture).toMatchObject({
      paidCallsUsed: 0,
      requiresApproval: false,
      persistedLayer: "private_capture",
    });
    expect(eventCapture?.route).not.toContain("paid_search");

    expect(diligence).toMatchObject({
      paidCallsUsed: 0,
      requiresApproval: true,
      persistedLayer: "team_memory",
    });
    expect(diligence?.route).toContain("paid_search");
  });
});
