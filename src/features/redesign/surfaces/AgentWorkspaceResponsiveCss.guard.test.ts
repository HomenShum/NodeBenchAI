import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const primitives = readFileSync(
  resolve(process.cwd(), "src/features/redesign/primitives.css"),
  "utf8",
);
const workspaceCss = readFileSync(
  resolve(process.cwd(), "src/features/redesign/agent-workspace.css"),
  "utf8",
);

const selectorWeight = (selector: string) =>
  (selector.match(/\[[^\]]+\]|\.[-_a-zA-Z0-9]+/g) ?? []).length;

describe("agent workspace responsive CSS contract", () => {
  it("out-ranks the later desktop chat grid when persisted wide mode reaches mobile", () => {
    const desktopSelector = "[data-redesign] .rd-shell--chat-v3 .rd-shell__main";
    const mobileWideSelector =
      '[data-redesign][data-wide="true"] .rd-shell.rd-shell--chat-v3 .rd-shell__main';
    const mobileRuleStart = primitives.indexOf(
      "[data-redesign] .rd-shell.rd-shell--chat-v3 .rd-shell__main,",
    );
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
    expect(selectorWeight(mobileWideSelector)).toBeGreaterThan(
      selectorWeight(desktopSelector),
    );

    const mobileChatRules = primitives.slice(mobileRuleStart, mobileRuleEnd);
    expect(mobileChatRules).toContain(mobileWideSelector);
    expect(mobileChatRules).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(mobileChatRules).toContain(
      '.rd-shell.rd-shell--chat-v3 .rd-shell__main > .rd-pane:first-child',
    );
    expect(mobileChatRules).toContain("padding-inline: 0;");
    expect(mobileChatRules).toContain(
      '[data-redesign][data-wide="true"] .rd-shell.rd-shell--chat-v3 .rd-pane--right.chat-context',
    );
    expect(mobileChatRules).toContain("display: none;");
    expect(mobileChatRules).toContain("width: 0;");
    expect(mobileChatRules).not.toContain("!important");
  });
});
