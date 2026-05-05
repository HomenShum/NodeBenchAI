/**
 * Custom TipTap Node extensions for NodeBench report notebooks.
 *
 * Each block round-trips through TipTap's schema cleanly:
 *   - parseHTML pulls structured attrs out of the HTML
 *   - renderHTML emits the same `data-block`/`data-status`/etc. markup
 *     so styles in primitives.css apply unchanged
 *
 * Production: these are the same shape Convex serves from `reports.notebookHtml`
 * and the same shape `applyChatPatch` / `applyAgentPatch` write back. The agent
 * runtime emits HTML matching this contract.
 */

import { Node, mergeAttributes } from "@tiptap/core";

export const ClaimBlock = Node.create({
  name: "claimBlock",
  group: "block",
  content: "paragraph+",
  defining: true,

  addAttributes() {
    return {
      label: {
        default: "Claim · review",
        parseHTML: (el) => el.querySelector("[data-claim-label]")?.textContent ?? "Claim · review",
      },
      source: {
        default: "",
        parseHTML: (el) => el.querySelector("[data-claim-source]")?.textContent ?? "",
      },
      status: {
        default: "review",
        parseHTML: (el) => el.getAttribute("data-status") ?? "review",
      },
      cite: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-cite"),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-block="claim"]',
        // Skip the label/source spans — they're stored as attrs, not content
        getContent: (el, schema) => {
          const paragraphs = Array.from((el as HTMLElement).querySelectorAll(":scope > p"));
          return paragraphs.length > 0
            ? schema.nodeFromJSON({
                type: "doc",
                content: paragraphs.map((p) => ({
                  type: "paragraph",
                  content: p.textContent ? [{ type: "text", text: p.textContent }] : [],
                })),
              }).content
            : null;
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const status = (node.attrs.status as string) || "review";
    const cite = node.attrs.cite as string | null;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-block": "claim",
        "data-status": status,
        ...(cite ? { "data-cite": cite } : {}),
      }),
      ["span", { "data-claim-label": "" }, (node.attrs.label as string) ?? "Claim · review"],
      ["div", { class: "rd-notebook__block-content" }, 0],
      ["span", { "data-claim-source": "" }, (node.attrs.source as string) ?? ""],
    ];
  },
});

export const FollowUpBlock = Node.create({
  name: "followUpBlock",
  group: "block",
  content: "paragraph+",
  defining: true,

  addAttributes() {
    return {
      label: {
        default: "Follow-up · this week",
        parseHTML: (el) => el.querySelector("[data-followup-label]")?.textContent ?? "Follow-up · this week",
      },
      due: {
        default: "this-week",
        parseHTML: (el) => el.getAttribute("data-due") ?? "this-week",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-block="follow-up"]',
        getContent: (el, schema) => {
          const paragraphs = Array.from((el as HTMLElement).querySelectorAll(":scope > p"));
          return paragraphs.length > 0
            ? schema.nodeFromJSON({
                type: "doc",
                content: paragraphs.map((p) => ({
                  type: "paragraph",
                  content: p.textContent ? [{ type: "text", text: p.textContent }] : [],
                })),
              }).content
            : null;
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const due = (node.attrs.due as string) || "this-week";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-block": "follow-up",
        "data-due": due,
      }),
      ["span", { "data-followup-label": "" }, (node.attrs.label as string) ?? "Follow-up · this week"],
      ["div", { class: "rd-notebook__block-content" }, 0],
    ];
  },
});

export const SourceListBlock = Node.create({
  name: "sourceListBlock",
  group: "block",
  content: "orderedList",
  defining: true,

  addAttributes() {
    return {
      label: {
        default: "Sources",
        parseHTML: (el) => el.querySelector("[data-source-list-label]")?.textContent ?? "Sources",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-block="source-list"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-block": "source-list",
      }),
      ["span", { "data-source-list-label": "" }, (node.attrs.label as string) ?? "Sources"],
      ["div", { class: "rd-notebook__block-content" }, 0],
    ];
  },
});

export const NotebookCustomBlocks = [ClaimBlock, FollowUpBlock, SourceListBlock];
