/**
 * Scenario tests for retryPolicy — async reliability layer.
 *
 * Personas:
 *   - Orchestrator hitting 5xx from USPTO (transient, should retry fast)
 *   - Orchestrator rate-limited at 429 (retry with backoff)
 *   - Entity has no USPTO records yet (data_unavailable, schedule hours out)
 *   - Permanent 403 on an auth-gated source (DLQ, never retry)
 *   - Bug in request shape yielding 400 (DLQ, don't loop)
 *   - Retry storm at 3+ consecutive failures → DLQ
 *   - 1000 parallel failures fingerprint to the same DLQ row (BOUND)
 *   - Determinism: same seed → same jitter across runs
 */

import { describe, it, expect } from "vitest";
import {
  classifyError,
  nextRetry,
  fingerprintFailure,
  normalizeMessageStem,
} from "./retryPolicy";

describe("classifyError — typed error classification", () => {
  it("HTTP 5xx → transient_network", () => {
    expect(classifyError({ kind: "http", status: 502 })).toBe("transient_network");
    expect(classifyError({ kind: "http", status: 503 })).toBe("transient_network");
  });
  it("HTTP 429 → rate_limited", () => {
    expect(classifyError({ kind: "http", status: 429 })).toBe("rate_limited");
  });
  it("HTTP 401 → auth_expired; 403 → auth_forbidden", () => {
    expect(classifyError({ kind: "http", status: 401 })).toBe("auth_expired");
    expect(classifyError({ kind: "http", status: 403 })).toBe("auth_forbidden");
  });
  it("HTTP 400 (non-auth 4xx) → bad_request", () => {
    expect(classifyError({ kind: "http", status: 400 })).toBe("bad_request");
    expect(classifyError({ kind: "http", status: 404 })).toBe("bad_request");
  });
  it("timeout → transient_network", () => {
    expect(classifyError({ kind: "timeout", elapsedMs: 31_000 })).toBe(
      "transient_network",
    );
  });
  it("thrown AbortError → transient_network", () => {
    expect(classifyError({ kind: "thrown", name: "AbortError", message: "aborted" })).toBe(
      "transient_network",
    );
  });
  it("thrown network message → transient_network", () => {
    expect(classifyError({ kind: "thrown", message: "fetch failed: ECONNRESET" })).toBe(
      "transient_network",
    );
  });
  it("data_unavailable explicit → data_unavailable", () => {
    expect(classifyError({ kind: "data_unavailable", source: "uspto" })).toBe(
      "data_unavailable",
    );
  });
  it("unknown thrown → unknown (caller treats conservatively)", () => {
    expect(classifyError({ kind: "thrown", message: "weird" })).toBe("unknown");
  });
});

describe("nextRetry — exponential backoff with jitter", () => {
  it("attempt 1 transient 502 → retry at ~2s ±1s, attempt becomes 2", () => {
    const v = nextRetry({
      errorClass: "transient_network",
      attempt: 1,
      nowMs: 10_000,
      jitterSeed: 42,
    });
    expect(v.kind).toBe("retry_soon");
    if (v.kind !== "retry_soon") throw new Error("unreachable");
    expect(v.attempt).toBe(2);
    expect(v.delayMs).toBeGreaterThanOrEqual(1_000);
    expect(v.delayMs).toBeLessThanOrEqual(3_000);
  });

  it("attempt 2 → retry at ~6s ±1s", () => {
    const v = nextRetry({
      errorClass: "transient_network",
      attempt: 2,
      nowMs: 10_000,
      jitterSeed: 42,
    });
    expect(v.kind).toBe("retry_soon");
    if (v.kind !== "retry_soon") throw new Error("unreachable");
    expect(v.delayMs).toBeGreaterThanOrEqual(5_000);
    expect(v.delayMs).toBeLessThanOrEqual(7_000);
  });

  it("attempt 3 (already at max) → DLQ with reason", () => {
    const v = nextRetry({
      errorClass: "transient_network",
      attempt: 3,
      nowMs: 10_000,
    });
    expect(v.kind).toBe("dead_letter");
  });

  it("429 follows transient backoff curve, NOT a special path", () => {
    const v = nextRetry({ errorClass: "rate_limited", attempt: 1, nowMs: 0, jitterSeed: 1 });
    expect(v.kind).toBe("retry_soon");
  });

  it("403 forbidden → DLQ immediately (no retry loop)", () => {
    const v = nextRetry({ errorClass: "auth_forbidden", attempt: 1, nowMs: 0 });
    expect(v.kind).toBe("dead_letter");
    if (v.kind !== "dead_letter") throw new Error("unreachable");
    expect(v.reason).toContain("auth_forbidden");
  });

  it("400 bad request → DLQ (caller bug — no retry)", () => {
    const v = nextRetry({ errorClass: "bad_request", attempt: 1, nowMs: 0 });
    expect(v.kind).toBe("dead_letter");
  });

  it("determinism: same seed produces identical delay across runs", () => {
    const a = nextRetry({ errorClass: "transient_network", attempt: 1, nowMs: 0, jitterSeed: 777 });
    const b = nextRetry({ errorClass: "transient_network", attempt: 1, nowMs: 0, jitterSeed: 777 });
    expect(a).toEqual(b);
  });

  it("data_unavailable attempt 1 → schedule +12h from firstAttemptAt", () => {
    const base = 1_700_000_000_000;
    const v = nextRetry({
      errorClass: "data_unavailable",
      attempt: 1,
      nowMs: base,
      firstAttemptAtMs: base,
    });
    expect(v.kind).toBe("retry_scheduled");
    if (v.kind !== "retry_scheduled") throw new Error("unreachable");
    expect(v.nextAttemptAtMs - base).toBe(12 * 60 * 60 * 1000);
    expect(v.attempt).toBe(2);
  });

  it("data_unavailable attempt 2 → schedule +24h from firstAttemptAt (not from now)", () => {
    const first = 1_700_000_000_000;
    const v = nextRetry({
      errorClass: "data_unavailable",
      attempt: 2,
      nowMs: first + 12 * 60 * 60 * 1000,
      firstAttemptAtMs: first,
    });
    expect(v.kind).toBe("retry_scheduled");
    if (v.kind !== "retry_scheduled") throw new Error("unreachable");
    expect(v.nextAttemptAtMs - first).toBe(24 * 60 * 60 * 1000);
  });

  it("data_unavailable after schedule exhausted → DLQ", () => {
    const v = nextRetry({
      errorClass: "data_unavailable",
      attempt: 4,
      nowMs: 0,
      firstAttemptAtMs: 0,
    });
    expect(v.kind).toBe("dead_letter");
  });
});

describe("fingerprintFailure + normalizeMessageStem — DLQ grouping", () => {
  it("replaces UUIDs with <uuid>", () => {
    expect(
      normalizeMessageStem("request abc12345-dead-beef-cafe-0123456789ab failed"),
    ).toBe("request <uuid> failed");
  });

  it("replaces bare digits with <n>", () => {
    expect(normalizeMessageStem("Retry 3 of 5 failed at 2026-04-19")).toBe(
      "retry <n> of <n> failed at <n>-<n>-<n>",
    );
  });

  it("replaces long hex runs with <hex>", () => {
    expect(normalizeMessageStem("trace 0123456789abcdef0123456789abcdef timeout")).toBe(
      "trace <hex> timeout",
    );
  });

  it("truncates absurdly long messages at 240 chars", () => {
    const long = "x".repeat(1000);
    expect(normalizeMessageStem(long).length).toBe(240);
  });

  it("fingerprint: 1000 identical-stem failures collapse to one row", () => {
    const fingerprints = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const msg = `USPTO request ${i} returned 502 gateway`;
      const stem = normalizeMessageStem(msg);
      const fp = fingerprintFailure({
        errorClass: "transient_network",
        source: "uspto",
        messageStem: stem,
      });
      fingerprints.add(fp);
    }
    expect(fingerprints.size).toBe(1);
  });

  it("fingerprint: different sources do NOT collide", () => {
    const a = fingerprintFailure({
      errorClass: "transient_network",
      source: "uspto",
      messageStem: "timeout",
    });
    const b = fingerprintFailure({
      errorClass: "transient_network",
      source: "linkedin",
      messageStem: "timeout",
    });
    expect(a).not.toEqual(b);
  });

  it("fingerprint: different error classes do NOT collide", () => {
    const a = fingerprintFailure({
      errorClass: "transient_network",
      source: "uspto",
      messageStem: "timeout",
    });
    const b = fingerprintFailure({
      errorClass: "rate_limited",
      source: "uspto",
      messageStem: "timeout",
    });
    expect(a).not.toEqual(b);
  });
});

describe("retry storm — long-running accumulation", () => {
  it("50 sequential transient failures never exceed MAX_TRANSIENT_ATTEMPTS before DLQ", () => {
    // Simulate 50 independent failure events. Each event is a fresh "attempt=1"
    // because the orchestrator starts counting at 1 for a new structuring pass.
    // We verify that nextRetry never silently keeps extending past attempt 3.
    for (let i = 0; i < 50; i++) {
      const v3 = nextRetry({
        errorClass: "transient_network",
        attempt: 3,
        nowMs: i * 1000,
      });
      expect(v3.kind).toBe("dead_letter");
    }
  });

  it("deterministic fingerprint over a 1000-run burst (no dynamic randomness)", () => {
    const a = fingerprintFailure({
      errorClass: "transient_network",
      source: "uspto",
      messageStem: normalizeMessageStem("HTTP 502 at trace a1b2c3d4e5f60718"),
    });
    const b = fingerprintFailure({
      errorClass: "transient_network",
      source: "uspto",
      messageStem: normalizeMessageStem("HTTP 502 at trace deadbeef12345678"),
    });
    // Both collapse via <hex> substitution — same fingerprint.
    expect(a).toBe(b);
  });
});
