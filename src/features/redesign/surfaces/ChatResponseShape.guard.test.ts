import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

/**
 * Phase A of docs/design/ONE_CHAT_INTERFACE.md — the flagship answer is
 * chat-shaped and rendered by ONE component (ChatAssistantMessage) mounted by
 * both ChatSurface and ReproducibleChatPage. These guards pin the same honesty
 * intent the old memo-shaped guard pinned: compact answers must not re-inflate
 * memo furniture, the json/table mono block + pre-wrap prose survive, and the
 * two renderers structurally cannot drift.
 */
describe("compact chat response rendering (one chat interface)", () => {
  const chatMsg = read("src/features/redesign/components/ChatAssistantMessage.tsx");
  const chat = read("src/features/redesign/surfaces/ChatSurface.tsx");
  const replay = read("src/features/redesign/pages/ReproducibleChatPage.tsx");
  const workspaceCss = read("src/features/redesign/agent-workspace.css");

  it("gates every optional section on non-empty content — compact answers stay compact", () => {
    // Row 2 secondary prose renders only when whyItMatters is present.
    expect(chatMsg).toContain("packet.whyItMatters.trim() &&");
    // Row 3 renders only when populated.
    expect(chatMsg).toContain("packet.risks.length > 0 &&");
    expect(chatMsg).toContain("packet.nextAction.trim() &&");
    // Evidence collapsible renders only when non-compact and non-empty.
    expect(chatMsg).toContain("!isCompactResponse && packet.evidence.length > 0 &&");
    // The compact detector is a named helper the guard can pin.
    expect(chatMsg).toContain("computeIsCompactResponse");
    expect(chatMsg).toContain("const isCompactResponse = computeIsCompactResponse(packet)");
  });

  it("keeps the json/table mono block and the pre-wrap prose paragraph", () => {
    expect(chatMsg).toContain("isStructuredAnswer(packet.shortAnswer)");
    expect(chatMsg).toContain('className="rd-answer-structured"');
    expect(chatMsg).toContain('className="rd-answer-copy"');
    // pre-wrap now lives on .rd-answer-copy in CSS (both prose paragraphs use it).
    expect(workspaceCss).toContain("white-space: pre-wrap;");
    // The structured mono block keeps its own style rule.
    expect(workspaceCss).toContain(".rd-answer-structured");
  });

  it("mounts the ONE ChatAssistantMessage from both renderers — no parallel answer markup", () => {
    expect(chat).toContain("ChatAssistantMessage");
    expect(chat).toContain('from "../components/ChatAssistantMessage"');
    expect(replay).toContain("ChatAssistantMessage");
    expect(replay).toContain('from "../components/ChatAssistantMessage"');
    // The replay is an immutable receipt — no live action bar.
    expect(replay).toContain('variant="receipt"');
    // The old memo eyebrows are deleted from the answer anatomy AND the replay
    // page (the field name `shortAnswer` is camelCase and does not match).
    expect(chatMsg).not.toContain("Short answer");
    expect(chatMsg).not.toContain("Why useful");
    expect(replay).not.toContain("Short answer");
    expect(replay).not.toContain("Why useful");
    // The live surface no longer defines a local AnswerPacket.
    expect(chat).not.toContain("function AnswerPacket(");
  });

  it("uses stroke-SVG action icons, never emoji (theme-aware icon rule)", () => {
    // The adversarial verify pass caught 📌/⇄/↗ emoji shipped as action-bar
    // icons on the first cut — color-emoji glyphs ignore the [data-redesign]
    // theme and clash with every other icon. Pin the fix so they can't return.
    for (const emoji of ["📌", "⇄", "↗", "🔎", "📊", "🧾", "✅", "📤"]) {
      expect(chatMsg).not.toContain(emoji);
    }
    expect(chatMsg).toContain("ActionGlyph");
    expect(chatMsg).toContain('stroke="currentColor"');
  });
});
