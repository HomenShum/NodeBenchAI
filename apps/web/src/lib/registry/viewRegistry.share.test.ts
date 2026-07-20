import { describe, expect, it } from "vitest";

import { buildCockpitPathForView, resolvePathToCockpitState } from "./viewRegistry";

describe("entity share routing", () => {
  it("preserves share tokens on canonical entity routes", () => {
    expect(
      buildCockpitPathForView({
        view: "entity",
        entity: "ditto-ai",
        extra: { share: "ews_demo" },
      }),
    ).toBe("/entity/ditto-ai?share=ews_demo");

    expect(resolvePathToCockpitState("/entity/ditto-ai", "?share=ews_demo")).toMatchObject({
      canonicalPath: "/entity/ditto-ai?share=ews_demo",
      isLegacyRedirect: false,
    });
  });

  it("preserves invite tokens on canonical entity routes", () => {
    expect(
      buildCockpitPathForView({
        view: "entity",
        entity: "softbank",
        extra: { invite: "ewi_demo" },
      }),
    ).toBe("/entity/softbank?invite=ewi_demo");

    expect(resolvePathToCockpitState("/entity/softbank", "?invite=ewi_demo")).toMatchObject({
      canonicalPath: "/entity/softbank?invite=ewi_demo",
      isLegacyRedirect: false,
    });
  });
});
