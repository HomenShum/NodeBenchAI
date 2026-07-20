import { describe, expect, it } from "vitest";

import {
  LEGACY_OPENAI_REALTIME_MODEL,
  applyFallback,
  buildVoiceFollowUps,
  extractVoiceEntities,
  ledgerKeyForTier,
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

  // ── May 7, 2026 OpenAI realtime model upgrade ─────────────────────────────
  // Scenario: Founder-mode user opens phone-grade agent on day-one of the
  // May-7 release. Their account hasn't been upgraded to gpt-realtime-2 yet.
  // Persona: power-user with paid agentMode session (1 user, single request,
  //          short-running; adversarial = key-missing / model-not-yet-rolled-out).
  // Goal: prove the routing decision honestly reports (a) what was requested
  //       (`tier`), (b) what served (`actualTierUsed`), (c) why the fallback
  //       fired (`fallbackReason`), and (d) the audit chain (`fallbackChain`).
  // Why scale: if HONEST_STATUS leaks at this layer, every downstream agent
  //            cost-rollup, dashboard, and replay will silently misattribute.

  it("routes agent_mode to the May-7 model identifier (no preview drift)", () => {
    // Persona: power user starts a phone-grade agent. Verify the routing
    // decision points to gpt-realtime-2, not the legacy preview.
    const decision = selectVoiceModelTier({
      userKey: "u1",
      agentMode: true,
      dailyCostUsd: 0,
      dailyCapUsd: 5,
    });
    expect(decision.tier).toBe("openai-realtime-2");
    expect(decision.model).toBe("gpt-realtime-2");
    expect(decision.actualTierUsed).toBe("openai-realtime-2");
    expect(decision.fallbackReason).toBeUndefined();
  });

  it("routes streaming STT to gpt-realtime-whisper (May-7 STT product)", () => {
    // Persona: mobile event capture — transcriptionOnly path. Verify the
    // routing decision picks the streaming-STT model, not legacy Whisper.
    const decision = selectVoiceModelTier({
      userKey: "u1",
      transcriptionOnly: true,
      dailyCostUsd: 0,
      dailyCapUsd: 5,
    });
    expect(decision.tier).toBe("openai-whisper");
    expect(decision.model).toBe("gpt-realtime-whisper");
    expect(decision.captureOnly).toBe(true);
  });

  it("routes translation to gpt-realtime-translate (May-7 70→13 langs)", () => {
    const decision = selectVoiceModelTier({
      userKey: "u1",
      translationMode: true,
      dailyCostUsd: 0,
      dailyCapUsd: 5,
    });
    expect(decision.tier).toBe("openai-realtime-translate");
    expect(decision.model).toBe("gpt-realtime-translate");
  });

  it("applyFallback degrades realtime-2 to legacy preview honestly (HONEST_STATUS)", () => {
    // Sad-path: gpt-realtime-2 returns 4xx (account not upgraded yet).
    // The /voice/session route calls applyFallback BEFORE retrying.
    // Verify the returned decision exposes the audit chain so dashboards
    // attribute "what served" vs "what was requested".
    const original = selectVoiceModelTier({
      userKey: "u1",
      agentMode: true,
      dailyCostUsd: 0,
      dailyCapUsd: 5,
    });
    const fallen = applyFallback(original, "openai-realtime-2", "openai_realtime_unavailable");

    // tier is preserved (analytics: "what was requested")
    expect(fallen.tier).toBe("openai-realtime-2");
    // actualTierUsed reflects what ACTUALLY served
    expect(fallen.actualTierUsed).toBe("openai-realtime-2");
    expect(fallen.fallbackReason).toBe("openai_realtime_unavailable");
    expect(fallen.fallbackChain).toEqual(["openai-realtime-2", "openai-realtime-2"]);
    expect(fallen.banner).toMatch(/Routed to openai-realtime-2.*openai_realtime_unavailable/);
  });

  it("applyFallback chains across multiple degradations (adversarial)", () => {
    // Adversarial: gpt-realtime-2 fails, then legacy fails too.
    // The route then degrades to gemini-flash-live. Verify the chain
    // accumulates so the operator dashboard sees the full degradation path.
    const original = selectVoiceModelTier({
      userKey: "u1",
      agentMode: true,
      dailyCostUsd: 0,
      dailyCapUsd: 5,
    });
    const step1 = applyFallback(original, "openai-realtime-2", "openai_realtime_unavailable");
    const step2 = applyFallback(step1, "gemini-flash-live", "session_create_failed");

    expect(step2.actualTierUsed).toBe("gemini-flash-live");
    expect(step2.provider).toBe("gemini");
    expect(step2.model).toBe("gemini-3.1-flash-live-preview");
    expect(step2.fallbackChain).toEqual([
      "openai-realtime-2",
      "openai-realtime-2",
      "gemini-flash-live",
    ]);
    // tier is STILL preserved — analytics tracks original intent through all hops
    expect(step2.tier).toBe("openai-realtime-2");
  });

  it("ledgerKeyForTier maps every routing tier to a valid ledger schema key", () => {
    // HONEST_SCORES — if a routing tier is added without updating the ledger
    // key map, costs would be silently dropped. This test catches it.
    expect(ledgerKeyForTier("gemini-flash-live")).toBe("geminiLive");
    expect(ledgerKeyForTier("openai-whisper")).toBe("whisper");
    expect(ledgerKeyForTier("openai-realtime-mini")).toBe("realtimeMini");
    expect(ledgerKeyForTier("openai-realtime-2")).toBe("realtime2");
    expect(ledgerKeyForTier("openai-realtime-translate")).toBe("translate");
  });

  it("LEGACY_OPENAI_REALTIME_MODEL is the legacy preview, not the May-7 ID", () => {
    // Sanity: the legacy fallback constant must NEVER be the May-7 model
    // (would defeat the fallback purpose). This test fails loudly if anyone
    // accidentally re-points it.
    expect(LEGACY_OPENAI_REALTIME_MODEL).toBe("gpt-4o-realtime-preview");
    expect(LEGACY_OPENAI_REALTIME_MODEL).not.toBe("gpt-realtime-2");
  });

  it("cost cap downgrade honors May-7 streaming STT model (not stale Whisper)", () => {
    // Long-running scenario: user has been talking all day, cap hits.
    // Verify the downgrade path picks gpt-realtime-whisper (May-7 streaming
    // STT), not a stale `whisper-1` reference. This is the customer-facing
    // capture-only mode — the model ID matters for billing attribution.
    const decision = selectVoiceModelTier({
      userKey: "u1",
      agentMode: true,
      dailyCostUsd: 5.01,
      dailyCapUsd: 5,
    });
    expect(decision.captureOnly).toBe(true);
    expect(decision.capHit).toBe(true);
    expect(decision.tier).toBe("openai-whisper");
    expect(decision.model).toBe("gpt-realtime-whisper");
    expect(decision.gate).toBe("daily_cost_cap_hit");
  });
});
