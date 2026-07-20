import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  type EditorState,
  type LexicalNode,
  type TextNode,
  createEditor,
} from "lexical";
import { $createLinkNode, $isLinkNode, LinkNode } from "@lexical/link";

import {
  STYLE_BOLD,
  STYLE_CODE,
  STYLE_ITALIC,
  STYLE_STRIKE,
  STYLE_UNDERLINE,
  type BlockChip,
} from "./BlockChipRenderer";
import {
  $createNotebookMentionNode,
  $isNotebookMentionNode,
  NotebookMentionNode,
} from "./NotebookMentionNode";

function pushTextChip(target: BlockChip[], value: string, styles: number): void {
  if (!value) return;
  const normalizedStyles = styles > 0 ? styles : undefined;
  const previous = target[target.length - 1];
  if (
    previous?.type === "text" &&
    (previous.styles ?? 0) === (normalizedStyles ?? 0)
  ) {
    previous.value += value;
    return;
  }
  target.push({
    type: "text",
    value,
    styles: normalizedStyles,
  });
}

function pushLinkChip(target: BlockChip[], value: string, url: string): void {
  if (!value) return;
  const previous = target[target.length - 1];
  if (previous?.type === "link" && previous.url === url) {
    previous.value += value;
    return;
  }
  target.push({
    type: "link",
    value,
    url,
  });
}

function stylesFromTextNode(node: TextNode): number {
  let styles = 0;
  if (node.hasFormat("bold")) styles |= STYLE_BOLD;
  if (node.hasFormat("italic")) styles |= STYLE_ITALIC;
  if (node.hasFormat("underline")) styles |= STYLE_UNDERLINE;
  if (node.hasFormat("strikethrough")) styles |= STYLE_STRIKE;
  if (node.hasFormat("code")) styles |= STYLE_CODE;
  return styles;
}

function applyChipStyles(node: TextNode, styles: number | undefined): void {
  if (!styles) return;
  if (styles & STYLE_BOLD) node.toggleFormat("bold");
  if (styles & STYLE_ITALIC) node.toggleFormat("italic");
  if (styles & STYLE_UNDERLINE) node.toggleFormat("underline");
  if (styles & STYLE_STRIKE) node.toggleFormat("strikethrough");
  if (styles & STYLE_CODE) node.toggleFormat("code");
}

function appendChipToParagraph(chip: BlockChip, paragraph: ReturnType<typeof $createParagraphNode>) {
  if (chip.type === "linebreak") {
    paragraph.append($createLineBreakNode());
    return;
  }
  if (chip.type === "mention") {
    paragraph.append(
      $createNotebookMentionNode(
        chip.value,
        chip.mentionTarget ?? chip.value,
        chip.mentionTrigger ?? "@",
      ),
    );
    return;
  }
  if (chip.type === "link") {
    const linkNode = $createLinkNode(chip.url ?? chip.value);
    const textNode = $createTextNode(chip.value);
    linkNode.append(textNode);
    paragraph.append(linkNode);
    return;
  }
  if (chip.type === "image") {
    const textNode = $createTextNode(chip.url ?? chip.value);
    applyChipStyles(textNode, STYLE_CODE);
    paragraph.append(textNode);
    return;
  }
  const textNode = $createTextNode(chip.value);
  applyChipStyles(textNode, chip.styles);
  paragraph.append(textNode);
}

export function seedNotebookEditorFromChips(chips: BlockChip[]): void {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  root.append(paragraph);
  if (chips.length === 0) return;
  for (const chip of chips) {
    appendChipToParagraph(chip, paragraph);
  }
}

function visitNode(
  node: LexicalNode,
  target: BlockChip[],
  activeLinkUrl?: string,
): void {
  if ($isNotebookMentionNode(node)) {
    target.push({
      type: "mention",
      value: node.getMentionValue(),
      mentionTarget: node.getMentionTarget(),
      mentionTrigger: node.getMentionTrigger(),
    });
    return;
  }

  if ($isLineBreakNode(node)) {
    target.push({ type: "linebreak", value: "\n" });
    return;
  }

  if ($isLinkNode(node)) {
    const linkUrl = node.getURL();
    for (const child of node.getChildren()) {
      visitNode(child, target, linkUrl);
    }
    return;
  }

  if ($isTextNode(node)) {
    const text = node.getTextContent();
    if (!text) return;
    if (activeLinkUrl) {
      pushLinkChip(target, text, activeLinkUrl);
      return;
    }
    pushTextChip(target, text, stylesFromTextNode(node));
    return;
  }

  if ($isElementNode(node)) {
    for (const child of node.getChildren()) {
      visitNode(child, target, activeLinkUrl);
    }
  }
}

export function chipsFromLexicalEditorState(editorState: EditorState): BlockChip[] {
  return editorState.read(() => {
    const chips: BlockChip[] = [];
    const root = $getRoot();
    for (const child of root.getChildren()) {
      visitNode(child, chips);
    }
    return chips.length > 0 ? chips : [{ type: "text", value: "" }];
  });
}

export function chipsHaveVisibleContent(chips: BlockChip[]): boolean {
  return chips.some((chip) => {
    if (chip.type === "linebreak") return false;
    if (chip.type === "image") return true;
    return chip.value.trim().length > 0;
  });
}

export function buildNotebookEditorStateJson(chips: BlockChip[]) {
  const editor = createEditor({
    nodes: [LinkNode, NotebookMentionNode],
  });
  editor.update(
    () => {
      seedNotebookEditorFromChips(chips);
    },
    { discrete: true },
  );
  return editor.getEditorState().toJSON();
}
