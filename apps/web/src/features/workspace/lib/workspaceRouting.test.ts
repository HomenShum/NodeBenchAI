import { describe, expect, it } from "vitest";

import {
  buildLocalWorkspacePath,
  buildWorkspacePath,
  buildWorkspaceUrl,
  isWorkspaceHostname,
} from "./workspaceRouting";

describe("workspaceRouting", () => {
  it("builds the canonical deep-work path shape", () => {
    expect(buildWorkspacePath({ workspaceId: "orbital-labs", tab: "cards" })).toBe(
      "/w/orbital-labs?tab=cards",
    );
    expect(buildLocalWorkspacePath({ workspaceId: "orbital-labs", tab: "map" })).toBe(
      "/workspace/w/orbital-labs?tab=map",
    );
  });

  it("recognizes the separate workspace host", () => {
    expect(isWorkspaceHostname("nodebench.workspace")).toBe(true);
    expect(isWorkspaceHostname("workspace.nodebenchai.com")).toBe(true);
    expect(isWorkspaceHostname("www.nodebenchai.com")).toBe(false);
  });

  it("uses local workspace route during local development", () => {
    expect(
      buildWorkspaceUrl({
        workspaceId: "demo-day",
        tab: "brief",
        hostname: "localhost",
        origin: "http://localhost:5173",
      }),
    ).toBe("http://localhost:5173/workspace/w/demo-day?tab=brief");
  });

  it("uses workspace.nodebenchai.com from the main production app", () => {
    expect(
      buildWorkspaceUrl({
        workspaceId: "demo-day",
        tab: "chat",
        hostname: "www.nodebenchai.com",
        protocol: "https:",
      }),
    ).toBe("https://workspace.nodebenchai.com/w/demo-day?tab=chat");
  });
});
