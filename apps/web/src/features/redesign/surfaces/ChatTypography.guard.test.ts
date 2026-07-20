import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const chatMsg = readFileSync(resolve(process.cwd(), "apps/web/src/features/redesign/components/ChatAssistantMessage.tsx"), "utf8");
const replay = readFileSync(resolve(process.cwd(), "apps/web/src/features/redesign/pages/ReproducibleChatPage.tsx"), "utf8");
const workspaceCss = readFileSync(resolve(process.cwd(), "apps/web/src/features/redesign/agent-workspace.css"), "utf8");
const tokens = readFileSync(resolve(process.cwd(), "apps/web/src/features/redesign/tokens.css"), "utf8");

describe("chat typography contract", () => {
  it("keeps structured answers in the compact product type scale", () => {
    // Phase A of docs/design/ONE_CHAT_INTERFACE.md: the prose paragraph lives in
    // the one ChatAssistantMessage both renderers mount.
    expect(chatMsg).toContain('<p className="rd-answer-copy">');
    expect(tokens).toContain("--rd-type-answer: 14px;");
    expect(tokens).toContain("--rd-leading-answer: 1.55;");
    expect(tokens).toContain("--rd-weight-answer: 450;");

    const answerRuleStart = workspaceCss.indexOf("[data-redesign] .rd-answer-copy {");
    const answerRuleEnd = workspaceCss.indexOf("}", answerRuleStart);
    const answerRule = workspaceCss.slice(answerRuleStart, answerRuleEnd);

    expect(answerRuleStart).toBeGreaterThan(-1);
    expect(answerRule).toContain("font-size: var(--rd-type-answer);");
    expect(answerRule).toContain("line-height: var(--rd-leading-answer);");
    expect(answerRule).not.toContain("display: none");
    // The old 18px display prose is gone from the answer anatomy and the replay.
    expect(chatMsg).not.toContain("fontSize: 18");
    expect(replay).not.toContain("fontSize: 18");
  });
});
