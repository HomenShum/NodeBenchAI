import { describe, expect, it } from "vitest";

import {
  acquireExactChatSubmitLock,
  hasSavedEntityReport,
  isExactChatRunInFlight,
  projectExactRuntimeSources,
  requireSuccessfulInboxMutation,
} from "../exactRuntimeContracts";

describe("Exact runtime contracts", () => {
  it("preserves the exact evidence URL instead of reducing it to a domain", () => {
    const url = "https://example.com/evidence/path?q=1#claim";
    expect(projectExactRuntimeSources([{ idx: 4, source: url, quote: "Grounded claim" }])).toEqual([
      expect.objectContaining({ n: 4, domain: "example.com", url }),
    ]);
  });

  it("does not make non-HTTP source labels clickable", () => {
    expect(projectExactRuntimeSources([{ source: "Board memo, page 4" }])[0]?.url).toBeUndefined();
  });

  it("keeps canonical chat single-flight while a run is active", () => {
    expect(isExactChatRunInFlight("thinking", null)).toBe(true);
    expect(isExactChatRunInFlight("ok", "agent-turn-1")).toBe(true);
    expect(isExactChatRunInFlight("idle", null, true)).toBe(true);
    expect(isExactChatRunInFlight("ok", null)).toBe(false);
  });

  it("acquires the submit lock synchronously so rapid submits invoke the runtime once", () => {
    const lock = { current: false };
    let submitCalls = 0;
    const rapidSubmit = () => {
      if (!acquireExactChatSubmitLock(lock)) return;
      submitCalls += 1;
    };

    rapidSubmit();
    rapidSubmit();

    expect(submitCalls).toBe(1);
  });

  it("requires an explicit runtime acknowledgement before removing an inbox item", () => {
    expect(() => requireSuccessfulInboxMutation({ ok: true })).not.toThrow();
    expect(() => requireSuccessfulInboxMutation({ ok: false })).toThrow(/not confirmed/i);
    expect(() => requireSuccessfulInboxMutation(undefined)).toThrow(/not confirmed/i);
  });

  it("does not present an entity with no completed report as a saved report", () => {
    expect(hasSavedEntityReport({ reportCount: 0 })).toBe(false);
    expect(hasSavedEntityReport({})).toBe(false);
    expect(hasSavedEntityReport({ reportCount: 1 })).toBe(true);
    expect(hasSavedEntityReport({ reportCount: 0, latestReportUpdatedAt: 1_700_000_000_000 })).toBe(true);
  });
});
