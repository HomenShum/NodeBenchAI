import { describe, expect, it } from "vitest";

import { canonicalRedesignChatTarget, pathToChatHash } from "./oneSurfaceRouting";

describe("one-surface routing", () => {
  it("keeps canonical chat and reproducible chat entries on the same runtime tree", () => {
    expect(canonicalRedesignChatTarget("/redesign/chat", "?report=r1")).toBeNull();
    expect(canonicalRedesignChatTarget("/redesign/chat/r/abc_123", "")).toBeNull();
    expect(pathToChatHash("/redesign/chat/r/abc_123")).toBe("abc_123");
  });

  it("contracts former page routes into contextual chat intents", () => {
    expect(canonicalRedesignChatTarget("/redesign", "")).toBe("/redesign/chat");
    expect(canonicalRedesignChatTarget("/redesign/reports", "")).toBe("/redesign/chat?intent=reports");
    expect(canonicalRedesignChatTarget("/redesign/inbox", "")).toBe("/redesign/chat?intent=attention");
    expect(canonicalRedesignChatTarget("/redesign/me", "")).toBe("/redesign/chat?intent=account");
  });

  it("keeps the pure routing helper total for arbitrary in-memory path strings", () => {
    expect(canonicalRedesignChatTarget("/redesign/reports/bad%2", "")).toBe(
      "/redesign/chat?report=bad%252&intent=review-report",
    );
  });

  it("preserves unusual but valid encoded report identifiers", () => {
    expect(canonicalRedesignChatTarget("/redesign/reports/bad%25", "")).toBe(
      "/redesign/chat?report=bad%25&intent=review-report",
    );
    expect(canonicalRedesignChatTarget("/redesign/reports/%E0%A4%A6", "")).toBe(
      "/redesign/chat?report=%E0%A4%A6&intent=review-report",
    );
  });

  it("preserves report and artifact context without mounting a workspace page", () => {
    expect(canonicalRedesignChatTarget("/redesign/reports/report%201", "?fresh=1")).toBe(
      "/redesign/chat?fresh=1&report=report+1&intent=review-report",
    );
    expect(canonicalRedesignChatTarget("/redesign/workspace", "?report=r1&tab=sources")).toBe(
      "/redesign/chat?report=r1&intent=workspace&artifact=sources",
    );
  });

  it("drops retired showcase flags", () => {
    expect(canonicalRedesignChatTarget("/redesign", "?classic=1&edition=0&qa=home-v2-implementation")).toBe(
      "/redesign/chat",
    );
  });
});
