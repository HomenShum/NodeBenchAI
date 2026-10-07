import {
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
  TextNode,
} from "lexical";

export type SerializedNotebookMentionNode = Spread<
  {
    type: "notebook-mention";
    version: 1;
    mentionTarget: string;
    mentionTrigger: string;
    mentionValue: string;
  },
  SerializedTextNode
>;

export class NotebookMentionNode extends TextNode {
  __mentionTarget: string;
  __mentionTrigger: string;
  __mentionValue: string;

  static getType(): string {
    return "notebook-mention";
  }

  static clone(node: NotebookMentionNode): NotebookMentionNode {
    return new NotebookMentionNode(
      node.__mentionValue,
      node.__mentionTarget,
      node.__mentionTrigger,
      node.__key,
    );
  }

  static importJSON(serializedNode: SerializedNotebookMentionNode): NotebookMentionNode {
    const node = $createNotebookMentionNode(
      serializedNode.mentionValue,
      serializedNode.mentionTarget,
      serializedNode.mentionTrigger,
    );
    node.setFormat(serializedNode.format);
    node.setDetail(serializedNode.detail);
    node.setMode(serializedNode.mode);
    node.setStyle(serializedNode.style);
    return node;
  }

  constructor(
    mentionValue: string,
    mentionTarget: string,
    mentionTrigger = "@",
    key?: NodeKey,
  ) {
    super(`${mentionTrigger}${mentionValue}`, key);
    this.__mentionValue = mentionValue;
    this.__mentionTarget = mentionTarget;
    this.__mentionTrigger = mentionTrigger;
    this.setMode("token");
  }

  exportJSON(): SerializedNotebookMentionNode {
    return {
      ...super.exportJSON(),
      type: "notebook-mention",
      version: 1,
      mentionTarget: this.getMentionTarget(),
      mentionTrigger: this.getMentionTrigger(),
      mentionValue: this.getMentionValue(),
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.className =
      "rounded px-1 text-[var(--accent-primary)] bg-[var(--accent-primary)]/10";
    dom.dataset.mentionTarget = this.__mentionTarget;
    dom.dataset.mentionTrigger = this.__mentionTrigger;
    return dom;
  }

  updateDOM(prevNode: NotebookMentionNode, dom: HTMLElement, config: EditorConfig): boolean {
    const updated = super.updateDOM(prevNode as any, dom, config);
    if (
      prevNode.__mentionTarget !== this.__mentionTarget ||
      prevNode.__mentionTrigger !== this.__mentionTrigger
    ) {
      dom.className =
        "rounded px-1 text-[var(--accent-primary)] bg-[var(--accent-primary)]/10";
      dom.dataset.mentionTarget = this.__mentionTarget;
      dom.dataset.mentionTrigger = this.__mentionTrigger;
    }
    return updated;
  }

  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }

  isTextEntity(): true {
    return true;
  }

  getMentionTarget(): string {
    return this.getLatest().__mentionTarget;
  }

  getMentionTrigger(): string {
    return this.getLatest().__mentionTrigger;
  }

  getMentionValue(): string {
    return this.getLatest().__mentionValue;
  }
}

export function $createNotebookMentionNode(
  mentionValue: string,
  mentionTarget: string,
  mentionTrigger = "@",
): NotebookMentionNode {
  return new NotebookMentionNode(mentionValue, mentionTarget, mentionTrigger);
}

export function $isNotebookMentionNode(
  node: LexicalNode | null | undefined,
): node is NotebookMentionNode {
  return node instanceof NotebookMentionNode;
}
