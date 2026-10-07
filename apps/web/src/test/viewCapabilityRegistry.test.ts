import { describe, expect, it } from "vitest";
import { getViewCapability, VIEW_CAPABILITIES } from "@/lib/registry/viewCapabilityRegistry";
import { ALL_VIEW_IDS } from "@/lib/registry/viewRegistry";
import { VIEW_TOOL_MAP } from "@/lib/registry/viewToolMap";

describe("viewCapabilityRegistry", () => {
  it("defines metadata for every main layout view", () => {
    for (const view of ALL_VIEW_IDS) {
      const capability = getViewCapability(view);
      expect(capability, `missing capability for ${view}`).toBeTruthy();
      expect(capability.title.length, `${view} should have a title`).toBeGreaterThan(0);
      expect(capability.description.length, `${view} should have a description`).toBeGreaterThan(0);
    }
  });

  it("does not expose capability metadata for unregistered route ghosts", () => {
    expect(Object.keys(VIEW_CAPABILITIES).sort()).toEqual([...ALL_VIEW_IDS].sort());
  });

  it("only exposes WebMCP tools for registered views", () => {
    const registered = new Set<string>(ALL_VIEW_IDS);
    for (const viewId of Object.keys(VIEW_TOOL_MAP)) {
      expect(registered.has(viewId), `${viewId} has tools but no registered route`).toBe(true);
    }
  });
});
