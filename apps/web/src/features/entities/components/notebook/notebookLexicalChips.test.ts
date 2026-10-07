import { createEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { LinkNode } from "@lexical/link";

import {
  STYLE_BOLD,
  STYLE_CODE,
  type BlockChip,
} from "./BlockChipRenderer";
import { NotebookMentionNode } from "./NotebookMentionNode";
import {
  buildNotebookEditorStateJson,
  chipsFromLexicalEditorState,
  chipsHaveVisibleContent,
} from "./notebookLexicalChips";

function roundTrip(chips: BlockChip[]) {
  const json = buildNotebookEditorStateJson(chips);
  const editor = createEditor({
    nodes: [LinkNode, NotebookMentionNode],
  });
  const editorState = editor.parseEditorState(JSON.stringify(json));
  editor.setEditorState(editorState);
  return chipsFromLexicalEditorState(editor.getEditorState());
}

describe("notebookLexicalChips", () => {
  it("round-trips styled text, mentions, links, and line breaks", () => {
    const original: BlockChip[] = [
      { type: "text", value: "Core thesis: ", styles: STYLE_BOLD },
      {
        type: "mention",
        value: "Dirk Xu",
        mentionTrigger: "@",
        mentionTarget: "dirk-xu",
      },
      { type: "text", value: " shared ", styles: undefined },
      {
        type: "link",
        value: "Cliffside",
        url: "https://cliffside.ventures/",
      },
      { type: "linebreak", value: "\n" },
      { type: "text", value: "Token package TBD", styles: STYLE_CODE },
    ];

    expect(roundTrip(original)).toEqual(original);
  });

  it("treats empty lines as not visible content and images as visible content", () => {
    expect(
      chipsHaveVisibleContent([
        { type: "text", value: "   " },
        { type: "linebreak", value: "\n" },
      ]),
    ).toBe(false);

    expect(
      chipsHaveVisibleContent([{ type: "image", value: "hero", url: "https://example.com/hero.png" }]),
    ).toBe(true);
  });
});
