import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildConversationContext, parseChatLaunchParams } from "../lib/chatContinuation";

describe("reproducible answer continuation", () => {
  it("distinguishes continuation from an explicit re-run", () => {
    expect(parseChatLaunchParams("?continue=1oicws5io3h2")).toEqual({
      prompt: "",
      continuationHash: "1oicws5io3h2",
    });
    expect(parseChatLaunchParams("?q=verify%20this")).toEqual({ prompt: "verify this" });
    expect(parseChatLaunchParams("?continue=../../private")).toEqual({ prompt: "" });
  });

  it("carries a bounded, role-aware transcript with source lineage", () => {
    const context = buildConversationContext([
      { role: "user", text: "What is the production status?" },
      {
        role: "assistant",
        packet: {
          shortAnswer: "It is generally available.",
          whyItMatters: "Production workloads are supported.",
          evidence: [
            { idx: 1, quote: "GA", source: "Docs https://example.com/model" },
            { idx: 2, quote: "Cached", source: "internal-memory" },
          ],
          risks: ["Confirm regional availability"],
          nextAction: "Check quotas.",
          sourceCount: 2,
          trace: [],
        },
      },
    ]);

    expect(context).toEqual([
      { role: "user", text: "What is the production status?" },
      {
        role: "assistant",
        text: "It is generally available.\nProduction workloads are supported.\nRisks: Confirm regional availability\nNext action: Check quotas.",
        sourceUrls: ["https://example.com/model"],
      },
    ]);
  });

  it("keeps private continuation history out of public hash reads", () => {
    const backend = readFileSync("convex/domains/redesign/chatRuns.ts", "utf8");
    const receipt = readFileSync("src/features/redesign/pages/ReproducibleChatPage.tsx", "utf8");
    expect(backend).toContain("conversationContext: _conversationContext");
    expect(backend).toContain("parentRunHash: _parentRunHash");
    expect(receipt).toContain("data-testid=\"continue-reproducible-chat\"");
    expect(receipt).toContain("/redesign/chat?q=");
    expect(receipt).toContain("/redesign/chat?continue=");
  });
});
