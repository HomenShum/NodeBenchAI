import { describe, expect, it } from "vitest";

import { inferCaptureRoute } from "./captureRouter";

describe("inferCaptureRoute", () => {
  it("routes demo-day field notes into the active event session", () => {
    const route = inferCaptureRoute({
      text: "Met Alex from Orbital Labs. Voice agent eval infra, seed, wants healthcare design partners.",
      mode: "note",
    });

    expect(route.intent).toBe("capture_field_note");
    expect(route.target).toBe("active_event_session");
    expect(route.gate).toBe("auto_route");
    expect(route.entities.map((entity) => entity.name)).toContain("Alex");
    expect(route.entities.map((entity) => entity.name)).toContain("Orbital Labs");
    expect(route.claims.length).toBeGreaterThan(0);
    expect(route.followUps.some((item) => item.text.includes("pilot criteria"))).toBe(true);
    expect(route.ack).toContain("Saved to active event session");
  });

  it("does not promote event-capture sentence starts and verbs into people", () => {
    const route = inferCaptureRoute({
      text: "Browser workspace smoke: met Lina from Helio Labs at Ship Demo Day. Wants payer workflow design partners.",
      mode: "note",
      activeContextLabel: "Ship Demo Day",
    });

    expect(route.target).toBe("active_event_session");
    expect(route.entities.map((entity) => entity.name)).toEqual(
      expect.arrayContaining(["Lina", "Helio Labs"]),
    );
    expect(route.entities.map((entity) => entity.name)).not.toEqual(
      expect.arrayContaining(["Browser", "Wants"]),
    );
  });

  it("keeps uncertain low-signal captures in review", () => {
    const route = inferCaptureRoute({
      text: "interesting thing from last week",
      mode: "note",
    });

    expect(route.intent).toBe("capture_field_note");
    expect(route.target).toBe("unassigned_buffer");
    expect(route.needsConfirmation).toBe(true);
    expect(route.nextActions).toContain("Confirm target");
  });

  it("classifies recruiter email as an inbox item with evidence", () => {
    const route = inferCaptureRoute({
      text: "Recruiter emailed me about a Staff Engineer role at Acme AI. Need tailored reply.",
      mode: "ask",
      files: [{ name: "job-spec.pdf", size: 1200 }],
    });

    expect(route.target).toBe("inbox_item");
    expect(route.intent).toBe("create_followup");
    expect(route.evidence).toContain("job-spec.pdf");
    expect(route.entities.some((entity) => entity.name.includes("Acme AI"))).toBe(true);
  });
});
