import { describe, expect, it } from "vitest";

import { buildChatSessionPath, buildChatShareUrl } from "./threadRouting";

describe("threadRouting", () => {
  it("builds a fresh chat path without stale query params", () => {
    expect(buildChatSessionPath({ entitySlug: "softbank", lens: "founder" })).toBe(
      "/?surface=chat&lens=founder&entity=softbank",
    );
  });

  it("builds a session-bound chat path", () => {
    expect(
      buildChatSessionPath({ entitySlug: "softbank", lens: "founder", sessionId: "session_123" }),
    ).toBe("/?surface=chat&lens=founder&entity=softbank&session=session_123");
  });

  it("prefers the canonical entity route for share urls", () => {
    expect(
      buildChatShareUrl({
        origin: "https://www.nodebenchai.com",
        resolvedEntitySlug: "softbank",
        activeSessionId: "session_123",
        entitySlug: "softbank",
        startedQuery: "What matters most right now?",
        lens: "founder",
      }),
    ).toBe("https://www.nodebenchai.com/entity/softbank");
  });

  it("builds a session share url when no canonical entity route is available", () => {
    expect(
      buildChatShareUrl({
        origin: "https://www.nodebenchai.com",
        entitySlug: "softbank",
        activeSessionId: "session_123",
        lens: "founder",
      }),
    ).toBe("https://www.nodebenchai.com/?surface=chat&entity=softbank&session=session_123");
  });

  it("preserves the query for unsaved threads", () => {
    expect(
      buildChatShareUrl({
        origin: "https://www.nodebenchai.com",
        currentHref: "https://www.nodebenchai.com/?surface=chat",
        entitySlug: "softbank",
        startedQuery: "What is SoftBank and what matters most right now?",
        lens: "founder",
      }),
    ).toBe(
      "https://www.nodebenchai.com/?surface=chat&lens=founder&entity=softbank&q=What+is+SoftBank+and+what+matters+most+right+now%3F",
    );
  });
});
