import { beforeEach, describe, expect, it } from "vitest";
import type { CommandAction } from "./CommandPalette";
import { rankCommandPaletteCommands } from "./commandPaletteUtils";
import {
  CONTROL_PLANE_PREFERRED_PATH_KEY,
  saveBuyerPreferredPath,
} from "@/features/controlPlane/lib/onboardingState";

const makeCommand = (id: string, label = id): CommandAction => ({
  id,
  label,
  description: label,
  icon: null,
  keywords: [],
  section: "navigation",
  action: () => {},
});

describe("rankCommandPaletteCommands", () => {
  beforeEach(() => {
    localStorage.removeItem(CONTROL_PLANE_PREFERRED_PATH_KEY);
  });

  it("biases empty-query results toward the default buyer journey", () => {
    const ranked = rankCommandPaletteCommands(
      [
        makeCommand("nav-me"),
        makeCommand("nav-chat"),
        makeCommand("nav-inbox"),
        makeCommand("nav-home"),
        makeCommand("nav-reports"),
      ],
      "",
    );

    expect(ranked.map((item) => item.id)).toEqual([
      "nav-home",
      "nav-reports",
      "nav-chat",
      "nav-inbox",
      "nav-me",
    ]);
  });

  it("puts the saved preferred path first", () => {
    saveBuyerPreferredPath("mcp-ledger");

    const ranked = rankCommandPaletteCommands(
      [
        makeCommand("nav-reports"),
        makeCommand("nav-chat"),
        makeCommand("nav-inbox"),
        makeCommand("nav-home"),
      ],
      "",
    );

    expect(ranked[0]?.id).toBe("nav-home");
  });

  it("does not reorder typed search results", () => {
    const commands = [
      makeCommand("nav-home"),
      makeCommand("nav-inbox"),
      makeCommand("nav-chat"),
    ];

    expect(rankCommandPaletteCommands(commands, "invest")).toEqual(commands);
  });
});
