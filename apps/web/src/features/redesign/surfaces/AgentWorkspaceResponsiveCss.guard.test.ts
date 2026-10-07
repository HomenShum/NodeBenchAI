import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const primitives = readFileSync(
  resolve(process.cwd(), "apps/web/src/features/redesign/primitives.css"),
  "utf8",
);
const workspaceCss = readFileSync(
  resolve(process.cwd(), "apps/web/src/features/redesign/agent-workspace.css"),
  "utf8",
);

describe("agent workspace responsive CSS contract", () => {
  it("collapses the contextual inspector without any legacy wide-mode state", () => {
    const desktopSelector = "[data-redesign] .rd-shell--chat-v3 .rd-shell__main";
    const mobileSelector =
      "[data-redesign] .rd-shell.rd-shell--chat-v3 .rd-shell__main";
    const mobileRuleStart = primitives.indexOf(`${mobileSelector} {`);
    const mobileRuleEnd = primitives.indexOf(
      "[data-redesign] .rd-agent-workspace-head { padding: 14px; }",
      mobileRuleStart,
    );

    expect(mobileRuleStart).toBeGreaterThan(-1);
    expect(mobileRuleEnd).toBeGreaterThan(mobileRuleStart);
    expect(
      primitives.lastIndexOf("@media (max-width: 760px) {", mobileRuleStart),
    ).toBeGreaterThan(-1);
    expect(workspaceCss).toContain(`${desktopSelector} {`);

    const mobileChatRules = primitives.slice(mobileRuleStart, mobileRuleEnd);
    expect(mobileChatRules).toContain(mobileSelector);
    expect(mobileChatRules).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(mobileChatRules).toContain(
      '.rd-shell.rd-shell--chat-v3 .rd-shell__main > .rd-pane:first-child',
    );
    expect(mobileChatRules).toContain("padding-inline: 0;");
    expect(mobileChatRules).toContain(
      "[data-redesign] .rd-shell.rd-shell--chat-v3 .rd-pane--right.chat-context",
    );
    expect(mobileChatRules).toContain("display: none;");
    expect(mobileChatRules).toContain("width: 0;");
    expect(mobileChatRules).not.toContain("!important");
    expect(primitives).not.toContain('data-wide="true"');
    expect(workspaceCss).not.toContain('data-wide="true"');
    expect(primitives).not.toMatch(/data-rd-account-slot[^}]*display:\s*none/);
  });
});
