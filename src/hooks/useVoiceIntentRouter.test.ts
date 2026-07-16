import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { parseVoiceIntent, useVoiceIntentRouter } from "./useVoiceIntentRouter";

describe("unsupported voice creation phrases", () => {
  const phrases = [
    "new document",
    "create note",
    "add task",
    "create event",
    "add meeting",
    "classic layout",
    "cockpit layout",
    "switch layout",
  ];

  it.each(phrases)("does not classify %s as a handled UI command", (phrase) => {
    expect(parseVoiceIntent(phrase)).toBeNull();
  });

  it.each(phrases)("returns false for %s so the composer sends it to the agent", (phrase) => {
    const { result } = renderHook(() => useVoiceIntentRouter({}));
    let handled = true;

    act(() => {
      handled = result.current.handleIntent(phrase);
    });

    expect(handled).toBe(false);
  });
});
