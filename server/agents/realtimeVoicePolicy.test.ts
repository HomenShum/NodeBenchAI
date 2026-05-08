import { describe, expect, it } from "vitest";

import {
  buildVoiceFollowUps,
  extractVoiceEntities,
  redactPII,
  selectVoiceModelTier,
} from "./realtimeVoicePolicy";

describe("realtime voice policy", () => {
  it("redacts phone numbers and SSNs before persistence", () => {
    const result = redactPII("Call me at 555-123-4567 about SSN 123-45-6789.");

    expect(result.text).not.toContain("555-123-4567");
    expect(result.text).not.toContain("123-45-6789");
    expect(result.spans.map((span) => span.reason)).toEqual(
      expect.arrayContaining(["phone", "ssn"]),
    );
  });

  it("does not redact ordinary short numeric values", () => {
    const result = redactPII("I scored 555 on the test and ranked 123.");

    expect(result.text).toContain("555");
    expect(result.spans).toHaveLength(0);
  });

  it("downgrades to capture-only when daily voice cap is hit", () => {
    const decision = selectVoiceModelTier({
      userKey: "u1",
      agentMode: true,
      dailyCostUsd: 5,
      dailyCapUsd: 5,
    });

    expect(decision).toMatchObject({
      tier: "openai-whisper",
      captureOnly: true,
      capHit: true,
      gate: "daily_cost_cap_hit",
    });
  });

  it("routes translation and phone-agent modes to explicit tiers before provider setup", () => {
    expect(selectVoiceModelTier({
      userKey: "u1",
      translationMode: true,
      dailyCostUsd: 0,
      dailyCapUsd: 5,
    }).tier).toBe("openai-realtime-translate");

    expect(selectVoiceModelTier({
      userKey: "u1",
      agentMode: true,
      dailyCostUsd: 0,
      dailyCapUsd: 5,
    }).tier).toBe("openai-realtime-2");
  });

  it("extracts event entities and follow-ups from a spoken note", () => {
    const text =
      "Met Alex from Orbital Labs. They build voice-agent eval infra and want healthcare design partners.";
    const entities = extractVoiceEntities(text);
    const followUps = buildVoiceFollowUps(text, entities);

    expect(entities.map((entity) => entity.label)).toContain("Orbital Labs");
    expect(entities.map((entity) => entity.label)).toContain("Alex");
    expect(followUps.length).toBeGreaterThanOrEqual(1);
  });
});
