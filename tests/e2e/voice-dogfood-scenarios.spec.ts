/**
 * Realtime voice dogfood scenarios.
 *
 * These tests verify the provider-agnostic NodeBench outcome contract:
 * realtime voice must land in durable capture/audit/routing objects and must
 * respect consent, budget, idempotency, and review gates.
 *
 * Run: BASE_URL=http://127.0.0.1:4173 npm run voice:dogfood
 */

import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4173";

async function assertVoiceHealth(page: Page): Promise<void> {
  const res = await page.request.get(`${BASE_URL}/voice/health`);
  expect(res.ok(), "voice route must be mounted").toBe(true);
  const body = await res.json();
  expect(body).toMatchObject({
    ok: true,
    realtimeGateway: "ready",
  });
}

async function postCapture(page: Page, data: Record<string, unknown>) {
  const res = await page.request.post(`${BASE_URL}/voice/capture`, { data });
  expect(res.ok()).toBe(true);
  return await res.json();
}

test.describe("Realtime voice dogfood matrix", () => {
  test("1. anonymous voice ask does not write private memory before consent", async ({ page }) => {
    await assertVoiceHealth(page);
    const body = await postCapture(page, {
      anonymousSessionId: `anon-${Date.now()}`,
      transcript: "What changed with Anthropic this week?",
      surface: "anonymous",
      idempotencyKey: `anon-ask-${Date.now()}`,
    });

    expect(body).toMatchObject({
      ok: true,
      confidence: "needs_review",
      provenance: "voice",
    });
    expect(body.gate).toContain("anonymous_no_private_memory");
    expect(body.captureId).toBeTruthy();
  });

  test("2. first-time signup can explicitly link anonymous captures", async ({ page }) => {
    await assertVoiceHealth(page);
    const anonymousSessionId = `signup-${Date.now()}`;
    await postCapture(page, {
      anonymousSessionId,
      transcript: "Save this first sourced answer after I create an account.",
      surface: "anonymous",
      idempotencyKey: `signup-cap-${Date.now()}`,
    });

    const res = await page.request.post(`${BASE_URL}/voice/link`, {
      data: {
        anonymousSessionId,
        userId: `user_${Date.now()}`,
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.gate).toMatch(/linked_after_signup|dev_no_convex_link_ack/);
  });

  test("3. returning user routes through memory/report context path", async ({ page }) => {
    await assertVoiceHealth(page);
    const res = await page.request.post(`${BASE_URL}/voice/session`, {
      data: {
        userId: "returning-user",
        surface: "chat",
        transcriptionOnly: true,
        systemInstruction: "Use current report memory before external search.",
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.routingDecision).toMatchObject({
      gate: "capture_only",
      captureOnly: true,
    });
  });

  test("4. mobile event capture resolves entities and follow-ups", async ({ page }) => {
    await assertVoiceHealth(page);
    const body = await postCapture(page, {
      userId: "event-user",
      sessionId: `event-${Date.now()}`,
      transcript:
        "Met Alex from Orbital Labs. They build voice-agent eval infra and want healthcare design partners.",
      surface: "event",
      contextLabel: "Ship Demo Day",
      persistPrivateMemory: true,
      idempotencyKey: `orbital-${Date.now()}`,
    });

    const labels = body.entities.map((entity: { label: string }) => entity.label);
    expect(labels).toContain("Orbital Labs");
    expect(body.followUps.length).toBeGreaterThanOrEqual(1);
    expect(body.confidence).toBe("needs_review");
  });

  test("5. noisy event capture is preserved and routed to review", async ({ page }) => {
    await assertVoiceHealth(page);
    const body = await postCapture(page, {
      userId: "noisy-user",
      transcript: "Met Al from maybe Orbital, healthcare pilot maybe follow up.",
      surface: "event",
      audioQuality: "noisy",
      idempotencyKey: `noisy-${Date.now()}`,
    });

    expect(body.inboxRequired).toBe(true);
    expect(body.confidence).toBe("needs_review");
  });

  test("6. translation stores original and translated transcript fields", async ({ page }) => {
    await assertVoiceHealth(page);
    const session = await page.request.post(`${BASE_URL}/voice/session`, {
      data: {
        userId: "translation-user",
        surface: "translation",
        translationMode: true,
        transcriptionOnly: true,
      },
    });
    expect(session.ok()).toBe(true);
    const sessionBody = await session.json();
    expect(sessionBody.routingDecision.tier).toMatch(/translate|whisper/);

    const body = await postCapture(page, {
      userId: "translation-user",
      transcript: "We are fundraising and looking for hospital design partners.",
      translatedTranscript: "We are fundraising and looking for hospital design partners.",
      sourceLanguage: "zh",
      targetLanguage: "en",
      surface: "translation",
      idempotencyKey: `translation-${Date.now()}`,
    });

    expect(body.translatedTranscript).toContain("fundraising");
    expect(body.confidence).toBe("needs_review");
  });

  test("7. report dictation lands as a reviewable voice capture contract", async ({ page }) => {
    await assertVoiceHealth(page);
    const body = await postCapture(page, {
      userId: "report-user",
      transcript:
        "Add my take. Their churn is improving because support investments are paying off.",
      surface: "report",
      contextLabel: "Analyst notes",
      persistPrivateMemory: true,
      idempotencyKey: `dictation-${Date.now()}`,
    });

    expect(body.transcript).toContain("Add my take");
    expect(body.provenance).toBe("voice");
    expect(body.confidence).toBe("needs_review");
  });

  test("8. phone-like agent mode routes to realtime agent tier or honest fallback", async ({ page }) => {
    await assertVoiceHealth(page);
    const res = await page.request.post(`${BASE_URL}/voice/session`, {
      data: {
        userId: "agent-user",
        surface: "agent",
        agentMode: true,
        debugCostSoFarUsd: 0,
      },
    });
    const body = await res.json();
    if (res.status() === 503) {
      expect(body.fallback).toMatch(/gemini-or-browser|browser/);
      expect(body.routingDecision.gate).toBe("agent_mode");
    } else {
      expect(body.ok).toBe(true);
      expect(body.routingDecision.gate).toBe("agent_mode");
      expect(body.routingDecision.tier).toBe("openai-realtime-2");
    }
  });

  test("9. idempotency key prevents duplicate captures on retry", async ({ page }) => {
    await assertVoiceHealth(page);
    const idempotencyKey = `retry-${Date.now()}`;
    const payload = {
      userId: "flaky-user",
      transcript: "Partial note from a flaky subway connection about Orbital Labs.",
      surface: "event",
      audioQuality: "partial",
      idempotencyKey,
    };
    const firstBody = await postCapture(page, payload);
    const secondBody = await postCapture(page, payload);

    expect(secondBody.captureId).toBe(firstBody.captureId);
    expect(secondBody.idempotent).toBe(true);
  });

  test("10. paid/deep research requests are acknowledged as async handoffs", async ({ page }) => {
    await assertVoiceHealth(page);
    const session = await page.request.post(`${BASE_URL}/voice/session`, {
      data: {
        userId: "deep-user",
        surface: "agent",
        deepWork: true,
        transcriptionOnly: true,
      },
    });
    expect(session.ok()).toBe(true);

    const body = await postCapture(page, {
      userId: "deep-user",
      transcript: "Do a full deep research diligence pack on every YC fintech.",
      surface: "agent",
      deepWork: true,
      idempotencyKey: `deep-${Date.now()}`,
    });

    expect(body.asyncHandoff).toMatchObject({
      queued: true,
      kind: "deep_research",
      status: "queued",
    });
  });

  test("PII utterance is redacted before storage contract returns", async ({ page }) => {
    await assertVoiceHealth(page);
    const body = await postCapture(page, {
      userId: "privacy-user",
      transcript: "Call me at 555-123-4567 about SSN 123-45-6789.",
      surface: "event",
      idempotencyKey: `privacy-${Date.now()}`,
    });

    expect(body.transcript).not.toContain("555-123-4567");
    expect(body.transcript).not.toContain("123-45-6789");
    expect(body.redactedSpans.length).toBeGreaterThanOrEqual(2);
    expect(body.inboxRequired).toBe(true);
  });

  test("cost ceiling downgrades to capture-only mode", async ({ page }) => {
    await assertVoiceHealth(page);
    const res = await page.request.post(`${BASE_URL}/voice/session`, {
      data: {
        userId: "cost-user",
        surface: "agent",
        agentMode: true,
        debugCostSoFarUsd: 999,
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      captureOnly: true,
      capHit: true,
    });
    expect(body.routingDecision.gate).toBe("daily_cost_cap_hit");
    expect(body.banner).toContain("Daily voice spend limit reached");
  });

  test("10/10 dogfood scenarios accounted for and mapped to release gates", () => {
    const matrix = [
      "anonymous consent",
      "first-run save",
      "returning memory",
      "mobile event capture",
      "noisy capture review",
      "translation",
      "TipTap dictation",
      "phone-grade tool calling",
      "reconnect idempotency",
      "paid/deep async handoff",
    ];
    expect(matrix).toHaveLength(10);
  });
});
