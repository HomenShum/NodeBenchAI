import { describe, expect, it } from "vitest";

import {
  chipsFromEditableRoot,
  renderEditableChipContent,
  STYLE_BOLD,
  STYLE_CODE,
  type BlockChip,
} from "./BlockChipRenderer";

describe("BlockChipRenderer editable DOM helpers", () => {
  it("round-trips structured chips through editable DOM without flattening mentions or links", () => {
    const root = document.createElement("div");
    const chips: BlockChip[] = [
      { type: "text", value: "Prep " },
      { type: "mention", value: "SoftBank", mentionTrigger: "@", mentionTarget: "softbank" },
      { type: "text", value: " using " },
      { type: "link", value: "Crunchbase", url: "https://www.crunchbase.com" },
      { type: "linebreak", value: "\n" },
      { type: "text", value: "bold note", styles: STYLE_BOLD | STYLE_CODE },
    ];

    renderEditableChipContent(root, chips);

    expect(chipsFromEditableRoot(root)).toEqual(chips);
  });

  it("preserves structured chips when surrounding text changes", () => {
    const root = document.createElement("div");
    renderEditableChipContent(root, [
      { type: "text", value: "Before " },
      { type: "mention", value: "SoftBank", mentionTrigger: "@", mentionTarget: "softbank" },
      { type: "text", value: " after" },
    ]);

    const firstTextNode = root.firstChild;
    expect(firstTextNode?.nodeType).toBe(Node.TEXT_NODE);
    if (firstTextNode) {
      firstTextNode.textContent = "Updated ";
    }

    expect(chipsFromEditableRoot(root)).toEqual([
      { type: "text", value: "Updated " },
      { type: "mention", value: "SoftBank", mentionTrigger: "@", mentionTarget: "softbank" },
      { type: "text", value: " after" },
    ]);
  });
});
