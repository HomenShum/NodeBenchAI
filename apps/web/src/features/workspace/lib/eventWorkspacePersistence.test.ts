import { describe, expect, it } from "vitest";

import {
  buildFixtureSeedArgs,
  buildLiveCaptureArgs,
  mapLiveSnapshotToMemory,
  resolveEventWorkspaceIdFromContext,
  shouldPersistRouteToEventWorkspace,
} from "./eventWorkspacePersistence";
import { inferCaptureRoute } from "@/features/product/lib/captureRouter";

describe("eventWorkspacePersistence", () => {
  it("builds an idempotent fixture seed payload for the demo workspace", () => {
    const args = buildFixtureSeedArgs("ship-demo-day");

    expect(args).toMatchObject({
      workspaceId: "ship-demo-day",
      eventId: "ship-demo-day",
      source: "fixture_seed",
      runId: "fixture-seed.ship-demo-day",
      runStatus: "complete",
    });
    expect(args.entities.length).toBeGreaterThan(0);
    expect(args.claims.every((claim) => claim.evidenceIds.length > 0)).toBe(true);
  });

  it("builds a live capture payload with private zero-paid event routing", () => {
    const args = buildLiveCaptureArgs({
      workspaceId: "ship-demo-day",
      input: "Met Alex from Orbital Labs. Voice agent eval infra.",
      now: 1777068715905,
    });

    expect(args).toMatchObject({
      workspaceId: "ship-demo-day",
      eventSessionId: "session.ship-demo-day",
      runId: "run.ship-demo-day.1777068715905",
      capture: {
        captureId: "capture.ship-demo-day.1777068715905",
        kind: "text",
        status: "attached",
        extractedEntityIds: ["event.ship-demo-day"],
      },
    });
    expect(args.budgetDecisions[0]).toMatchObject({
      scenario: "At-event capture",
      paidCallsUsed: 0,
      requiresApproval: false,
      persistedLayer: "private_capture",
    });
  });

  it("projects captureRouter entities, claims, and follow-ups into live event rows", () => {
    const route = inferCaptureRoute({
      text: "Met Alex from Orbital Labs. Voice agent eval infra, seed, wants healthcare design partners.",
      mode: "note",
      activeContextLabel: "Ship Demo Day",
    });
    const args = buildLiveCaptureArgs({
      workspaceId: "ship-demo-day",
      input: "Met Alex from Orbital Labs. Voice agent eval infra, seed, wants healthcare design partners.",
      now: 1777068715905,
      route,
    });

    expect(shouldPersistRouteToEventWorkspace(route)).toBe(true);
    expect(resolveEventWorkspaceIdFromContext("Ship Demo Day")).toBe("ship-demo-day");
    expect(args.entities.map((entity) => entity.id)).toEqual(
      expect.arrayContaining(["event.ship-demo-day", "person.alex", "company.orbital-labs"]),
    );
    expect(args.evidence[0]).toMatchObject({
      layer: "private_capture",
      visibility: "private",
      reusable: true,
    });
    expect(args.claims.length).toBeGreaterThan(0);
    expect(args.claims[0].evidenceIds).toContain(args.evidence[0].id);
    expect(args.followUps.some((followUp) => followUp.action.includes("pilot criteria"))).toBe(true);
    expect(args.capture.extractedEntityIds).toContain("company.orbital-labs");
    expect(args.capture.extractedClaimIds.length).toBe(args.claims.length);
  });

  it("maps live Convex rows back into the workspace memory view model", () => {
    const mapped = mapLiveSnapshotToMemory({
      entities: [
        {
          entityKey: "company.orbital-labs",
          uri: "nodebench://org/orbital-labs",
          entityType: "company",
          name: "Orbital Labs",
          layer: "workspace_memory",
          confidence: 0.91,
        },
      ],
      evidence: [],
      claims: [],
      followUps: [],
      budgetDecisions: [],
    });

    expect(mapped.live).toBe(true);
    expect(mapped.entities[0]).toMatchObject({
      id: "company.orbital-labs",
      name: "Orbital Labs",
      type: "company",
    });
  });

  it("returns a clear empty live state while the live snapshot is absent", () => {
    const mapped = mapLiveSnapshotToMemory(null);

    expect(mapped.live).toBe(false);
    expect(mapped.entities).toEqual([]);
    expect(mapped.claims).toEqual([]);
    expect(mapped.captureCount).toBe(0);
  });
});
