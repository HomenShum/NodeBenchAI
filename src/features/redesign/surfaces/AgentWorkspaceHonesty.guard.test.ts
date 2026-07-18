import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("first-class agent workspace honesty contract", () => {
  const chat = read("src/features/redesign/surfaces/ChatSurface.tsx");
  const shell = read("src/features/redesign/RedesignShell.tsx");
  const prototype = read("src/features/redesign/surfaces/HomeV2PrototypeSurface.tsx");
  const workspaceCss = read("src/features/redesign/agent-workspace.css");
  const composer = read("src/features/redesign/components/UniversalComposer.tsx");
  const conversation = read("src/components/ai-elements/conversation.tsx");
  // Phase A of docs/design/ONE_CHAT_INTERFACE.md: the answer anatomy (receipt
  // telemetry, evidence source parsing, "how we got this answer" trace, the
  // honest probe banner) moved out of ChatSurface into the ONE component both
  // renderers mount. The honesty assertions follow the code to its new home.
  const chatMsg = read("src/features/redesign/components/ChatAssistantMessage.tsx");

  it("exposes one runtime-grounded read, write, and verification contract", () => {
    expect(chat).toContain("RunScopeDisclosure");
    expect(chat).toContain('writes: "Review mode · no automatic shared writes"');
    expect(chat).toContain("runtimeContextPacket.selectedContext.length");
    expect(chat).toContain("blockedClaimCount");
    // Source URL parsing + the trace disclosure now live in ChatAssistantMessage.
    expect(chatMsg).toContain("sourceUrlFromText");
    expect(chatMsg).toContain("How we got this answer");
  });

  it("does not simulate execution or advertise toast-only work controls", () => {
    expect(chat).not.toContain("Tick the live batch counters so it feels alive");
    expect(chat).not.toContain("spentUsd + inc");
    expect(chat).not.toContain("batch_${target.universeId}");
    expect(chat).not.toContain("Scroll to bottom on mount");
    expect(chat).not.toContain('>Track updates<');
    expect(chat).not.toContain('>Export<');
    expect(shell).not.toContain("RightInspector");
    expect(chat).not.toContain("traceBarWidth");
    expect(chat).not.toContain("traceDuration");
  });

  it("keeps production chat free of prototype conversations and inferred runtime facts", () => {
    expect(prototype).not.toContain("Sequoia ratch...");
    expect(prototype).not.toContain("Anthropic pric...");
    expect(prototype).not.toContain("ChatThreadGroup");
    expect(chat).not.toContain("buildSeedTurns");
    expect(chat).not.toContain("WORKING_NOTES_MARKDOWN");
    expect(chat).not.toContain("sourceFreshness");
    expect(chat).not.toContain("ChatV2NextActions");
    expect(chat).toContain("hasAnswer = Boolean(activePacket?.shortAnswer)");
    expect(chat).toContain("metrics?.sourceCount ?? run?.groundingChunks.length");
    expect(chat).toContain("hideAttachments");
    // Honest telemetry fallbacks + the probe banner moved into the one answer
    // component; the "never infer cost from duration" guarantee follows them.
    expect(chatMsg).toContain("telemetry not recorded");
    expect(chatMsg).toContain("cost not recorded");
    expect(chatMsg).not.toContain("formatTraceCost");
    expect(chat).not.toContain("formatTraceCost");
    expect(chat).not.toContain('"memory first"');
    expect(chat).not.toContain("onContextChange={() => setCtx");
    expect(chat).not.toContain("claim weakens but doesn't flip");
    expect(chat).not.toContain("Probed: claim weakens");
    expect(chatMsg).toContain("Awaiting a verified result from the active runtime");
    expect(chat).not.toContain("$0.005/sec");
    expect(chat).not.toContain("}, 1800)");
    expect(composer).toContain("entitySuggestions = []");
    expect(composer).toContain("ComposerContextChip");
  });

  it("uses the shared AI Elements transcript and a non-overlapping composer row", () => {
    expect(chat).toContain("ConversationContent");
    expect(chat).toContain("ConversationScrollButton");
    expect(chat).not.toContain("scrollRef");
    expect(chat).not.toContain("unseenCount");
    expect(shell).toContain('import "./agent-workspace.css"');
    expect(shell).toContain("rd-shell--chat-no-inspector");
    expect(shell).toContain('data-product-surface="decision-workspace"');
    expect(workspaceCss).not.toContain('data-wide="true"');
    expect(conversation).toContain('reducedMotion ? "instant" : "smooth"');
  });
});
