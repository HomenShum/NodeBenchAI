/**
 * Scenario tests for matchesAskShortcut + targetIsTextEditing.
 *
 * Personas / situations:
 *   - User on home page, nothing focused, hits ⌘J → open panel
 *   - User mid-composer, types Cmd+J to line-break → do NOT hijack
 *   - IME composition active (CJK input), user hits J → do NOT hijack
 *   - User holds Cmd+J → one-shot only, no repeat fires
 *   - Cmd+Shift+J / Cmd+Opt+J → reserved, ignored
 *   - Wrong key / no modifier → ignored
 *   - Focused in a checkbox (not a text input) → shortcut still works
 */

import { describe, it, expect } from "vitest";
import {
  matchesAskShortcut,
  targetIsTextEditing,
  type AskShortcutEventLike,
} from "./askShortcut";

function evt(partial: Partial<AskShortcutEventLike>): AskShortcutEventLike {
  return { key: "j", metaKey: false, ctrlKey: false, ...partial };
}

describe("matchesAskShortcut — canonical activations", () => {
  it("Cmd+J on Mac nothing focused → true", () => {
    expect(matchesAskShortcut(evt({ metaKey: true }))).toBe(true);
  });
  it("Ctrl+J on Windows/Linux nothing focused → true", () => {
    expect(matchesAskShortcut(evt({ ctrlKey: true }))).toBe(true);
  });
  it("Uppercase J still matches (caps-lock tolerated)", () => {
    expect(matchesAskShortcut(evt({ metaKey: true, key: "J" }))).toBe(true);
  });
});

describe("matchesAskShortcut — non-matching keys / modifiers", () => {
  it("plain J (no modifier) → false", () => {
    expect(matchesAskShortcut(evt({}))).toBe(false);
  });
  it("Cmd+K (wrong key) → false", () => {
    expect(matchesAskShortcut(evt({ metaKey: true, key: "k" }))).toBe(false);
  });
  it("BOTH cmd + ctrl held → false (ambiguous)", () => {
    expect(matchesAskShortcut(evt({ metaKey: true, ctrlKey: true }))).toBe(false);
  });
  it("Cmd+Shift+J → false (reserved)", () => {
    expect(matchesAskShortcut(evt({ metaKey: true, shiftKey: true }))).toBe(false);
  });
  it("Cmd+Alt+J → false (reserved)", () => {
    expect(matchesAskShortcut(evt({ metaKey: true, altKey: true }))).toBe(false);
  });
});

describe("matchesAskShortcut — IME + repeat guard", () => {
  it("IME composition in flight → false (never hijack during CJK input)", () => {
    expect(
      matchesAskShortcut(evt({ metaKey: true, isComposing: true })),
    ).toBe(false);
  });
  it("repeat=true (user holding key) → false (one-shot only)", () => {
    expect(matchesAskShortcut(evt({ metaKey: true, repeat: true }))).toBe(false);
  });
});

describe("targetIsTextEditing — where NOT to hijack", () => {
  it("plain body-level target → not editing", () => {
    expect(targetIsTextEditing(null)).toBe(false);
    expect(targetIsTextEditing({ tagName: "BODY" })).toBe(false);
  });
  it("<textarea> target → editing", () => {
    expect(targetIsTextEditing({ tagName: "TEXTAREA" })).toBe(true);
  });
  it("<input type='text'> → editing", () => {
    const target = {
      tagName: "INPUT",
      getAttribute: (n: string) => (n === "type" ? "text" : null),
    };
    expect(targetIsTextEditing(target)).toBe(true);
  });
  it("<input type='checkbox'> → NOT editing (shortcut still fires)", () => {
    const target = {
      tagName: "INPUT",
      getAttribute: (n: string) => (n === "type" ? "checkbox" : null),
    };
    expect(targetIsTextEditing(target)).toBe(false);
  });
  it("<input type='button'> → NOT editing", () => {
    const target = {
      tagName: "INPUT",
      getAttribute: (n: string) => (n === "type" ? "button" : null),
    };
    expect(targetIsTextEditing(target)).toBe(false);
  });
  it("contenteditable <div> → editing", () => {
    expect(targetIsTextEditing({ isContentEditable: true })).toBe(true);
  });
});

describe("integration — matchesAskShortcut respects targetIsTextEditing", () => {
  it("Cmd+J while inside <textarea> → false (don't hijack composer)", () => {
    expect(
      matchesAskShortcut(
        evt({ metaKey: true, target: { tagName: "TEXTAREA" } }),
      ),
    ).toBe(false);
  });
  it("Cmd+J while in contenteditable → false", () => {
    expect(
      matchesAskShortcut(
        evt({ metaKey: true, target: { isContentEditable: true } }),
      ),
    ).toBe(false);
  });
  it("Cmd+J while focused on a <button> → true (not a text edit)", () => {
    expect(
      matchesAskShortcut(evt({ metaKey: true, target: { tagName: "BUTTON" } })),
    ).toBe(true);
  });
});
