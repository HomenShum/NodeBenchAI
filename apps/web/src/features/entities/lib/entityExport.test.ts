import { describe, expect, it } from "vitest";

import {
  buildCrmSummary,
  buildEntityInvitePath,
  buildEntityInviteUrl,
  buildEntityMarkdown,
  buildEntityPath,
  buildEntityPulsePath,
  buildEntityShareUrl,
  buildOutreachDraft,
  type ExportEntityWorkspace,
} from "./entityExport";

const workspace: ExportEntityWorkspace = {
  entity: {
    slug: "softbank",
    name: "SoftBank",
    entityType: "company",
    summary: "Japanese investment holding company.",
    reportCount: 2,
    latestRevision: 4,
  },
  latest: null,
  timeline: [],
};

describe("entityExport share helpers", () => {
  it("builds relative entity paths with optional share tokens", () => {
    expect(buildEntityPath("softbank")).toBe("/entity/softbank");
    expect(buildEntityPath("softbank", "ews_demo")).toBe("/entity/softbank?share=ews_demo");
  });

  it("builds invite paths and urls for pending collaborators", () => {
    expect(buildEntityInvitePath("softbank")).toBe("/entity/softbank");
    expect(buildEntityInvitePath("softbank", "ewi_demo")).toBe("/entity/softbank?invite=ewi_demo");
    expect(buildEntityInviteUrl("softbank", "ewi_demo")).toContain("?invite=ewi_demo");
  });

  it("builds canonical entity pulse paths", () => {
    expect(buildEntityPulsePath("softbank")).toBe("/entity/softbank/pulse");
    expect(buildEntityPulsePath("softbank", "2026-04-20")).toBe("/entity/softbank/pulse/2026-04-20");
  });

  it("threads share tokens through exported copy payloads", () => {
    const shareToken = "ews_demo";
    expect(buildEntityShareUrl("softbank", shareToken)).toContain("?share=ews_demo");
    expect(buildEntityMarkdown(workspace, undefined, shareToken)).toContain("?share=ews_demo");
    expect(buildOutreachDraft(workspace, undefined, shareToken)).toContain("?share=ews_demo");
    expect(JSON.parse(buildCrmSummary(workspace, undefined, shareToken)).shareUrl).toContain(
      "?share=ews_demo",
    );
  });
});
