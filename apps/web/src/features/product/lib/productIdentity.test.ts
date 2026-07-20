import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAnonymousProductSessionId } from "./productIdentity";

describe("getAnonymousProductSessionId", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("creates one id and persists it to both localStorage and sessionStorage", () => {
    const randomUuid = "anon-shared-id";
    vi.stubGlobal("crypto", {
      randomUUID: () => randomUuid,
    });

    const sessionId = getAnonymousProductSessionId();

    expect(sessionId).toBe(randomUuid);
    expect(window.localStorage.getItem("nodebench:product-anon-session")).toBe(randomUuid);
    expect(window.sessionStorage.getItem("nodebench:product-anon-session")).toBe(randomUuid);
  });

  it("migrates an existing sessionStorage id into localStorage", () => {
    window.sessionStorage.setItem("nodebench:product-anon-session", "tab-only-id");

    const sessionId = getAnonymousProductSessionId();

    expect(sessionId).toBe("tab-only-id");
    expect(window.localStorage.getItem("nodebench:product-anon-session")).toBe("tab-only-id");
  });

  it("prefers an existing localStorage id so tabs converge on one workspace", () => {
    window.localStorage.setItem("nodebench:product-anon-session", "shared-id");
    window.sessionStorage.setItem("nodebench:product-anon-session", "stale-tab-id");

    const sessionId = getAnonymousProductSessionId();

    expect(sessionId).toBe("shared-id");
    expect(window.sessionStorage.getItem("nodebench:product-anon-session")).toBe("shared-id");
  });
});
