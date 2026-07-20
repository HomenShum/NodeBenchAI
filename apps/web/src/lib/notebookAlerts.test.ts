/**
 * notebookAlerts.test.ts — verify sampling + fail-open contracts.
 *
 * Scenario: a flapping bug fires 1000 alerts in a minute. Without sampling
 * we'd ring the on-call's phone 1000 times. With sampling we get 1 per code
 * per minute regardless of volume.
 *
 * Fail-open scenario: ntfy.sh is down / CSP blocks fetch / env var unset.
 * Alerting must silently no-op, never throw, never block the caller.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSamplingForTests,
  buildAlertRequest,
  publishNotebookAlert,
  shouldSample,
  validateAlertUrl,
} from "./notebookAlerts";

describe("notebookAlerts sampling", () => {
  beforeEach(() => {
    _resetSamplingForTests();
  });

  it("admits the first alert for a code, rejects repeats within the window", () => {
    const now = 1_000_000;
    expect(shouldSample("REVISION_MISMATCH", now)).toBe(true);
    expect(shouldSample("REVISION_MISMATCH", now + 1)).toBe(false);
    expect(shouldSample("REVISION_MISMATCH", now + 59_999)).toBe(false);
    // Just past the window — admits again.
    expect(shouldSample("REVISION_MISMATCH", now + 60_001)).toBe(true);
  });

  it("samples independently per code", () => {
    const now = 2_000_000;
    expect(shouldSample("SERVER_ERROR", now)).toBe(true);
    // Different code still passes even though SERVER_ERROR was just used.
    expect(shouldSample("BLOCK_NOT_FOUND", now)).toBe(true);
    // Both are suppressed when retried immediately.
    expect(shouldSample("SERVER_ERROR", now + 100)).toBe(false);
    expect(shouldSample("BLOCK_NOT_FOUND", now + 100)).toBe(false);
  });

  it("survives 1000 rapid-fire calls without mutating global state badly", () => {
    // Simulates a flapping loop. Exactly one call per code per window.
    let admitted = 0;
    const now = 3_000_000;
    for (let i = 0; i < 1000; i++) {
      if (shouldSample("FLAPPING_CODE", now + i)) admitted += 1;
    }
    expect(admitted).toBe(1);
  });
});

describe("notebookAlerts fail-open", () => {
  beforeEach(() => {
    _resetSamplingForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("validateAlertUrl rejects empty, non-https, and non-ntfy hosts", () => {
    expect(validateAlertUrl(null)).toBe(null);
    expect(validateAlertUrl("")).toBe(null);
    expect(validateAlertUrl("   ")).toBe(null);
    // SSRF: arbitrary host rejected even over https.
    expect(validateAlertUrl("https://evil.example.com/topic")).toBe(null);
    // http (non-https) rejected.
    expect(validateAlertUrl("http://ntfy.sh/test")).toBe(null);
    // Malformed URL rejected.
    expect(validateAlertUrl("not-a-url")).toBe(null);
    // Valid ntfy.sh endpoint accepted.
    expect(validateAlertUrl("https://ntfy.sh/nodebench-test")).toBe(
      "https://ntfy.sh/nodebench-test",
    );
    // Self-hosted ntfy with "ntfy" in hostname accepted.
    expect(validateAlertUrl("https://ntfy.mycompany.com/topic")).toBe(
      "https://ntfy.mycompany.com/topic",
    );
  });

  it("publishNotebookAlert returns false when url override is null/invalid", () => {
    expect(
      publishNotebookAlert(
        { severity: "P1", code: "TEST_NULL", title: "x" },
        null,
      ),
    ).toBe(false);
    expect(
      publishNotebookAlert(
        { severity: "P1", code: "TEST_BAD", title: "x" },
        "http://evil.example.com",
      ),
    ).toBe(false);
  });

  it("buildAlertRequest serializes headers + body correctly", () => {
    const { body, headers } = buildAlertRequest({
      severity: "P0",
      code: "SERVER_ERROR",
      title: "mutation failed",
      detail: "block save exploded",
      requestId: "abc123",
      context: { blockId: "blk_1" },
    });
    expect(headers.Title).toBe("[P0] SERVER_ERROR: mutation failed");
    expect(headers.Priority).toBe("5"); // P0 → 5
    expect(headers.Tags).toBe("rotating_light");
    expect(body).toContain("block save exploded");
    expect(body).toContain("ref: abc123");
    expect(body).toContain('context: {"blockId":"blk_1"}');
  });

  it("does not throw when fetch itself throws synchronously", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("synthetic network blowup");
      }),
    );
    expect(() =>
      publishNotebookAlert(
        { severity: "P0", code: "TEST_THROW", title: "should not propagate" },
        "https://ntfy.sh/test-topic",
      ),
    ).not.toThrow();
  });

  it("attempts exactly one POST per sampled alert when fetch is healthy", () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    publishNotebookAlert(
      { severity: "P1", code: "TEST_POST", title: "first" },
      "https://ntfy.sh/test-topic",
    );
    // Second call within the window is sampled out — no extra POST.
    publishNotebookAlert(
      { severity: "P1", code: "TEST_POST", title: "second" },
      "https://ntfy.sh/test-topic",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit | undefined];
    const [url, init] = firstCall;
    expect(String(url)).toBe("https://ntfy.sh/test-topic");
    expect((init as unknown as RequestInit).method).toBe("POST");
    const headers = (init as unknown as RequestInit).headers as Record<string, string>;
    expect(headers.Priority).toBe("4"); // P1
    expect(headers.Tags).toBe("warning");
    expect(headers.Title).toContain("TEST_POST");
    expect((init as unknown as RequestInit).keepalive).toBe(true);
  });
});
