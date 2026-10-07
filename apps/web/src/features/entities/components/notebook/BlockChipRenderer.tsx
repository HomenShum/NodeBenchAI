/**
 * BlockChipRenderer — renders a Chip[] (from productBlocks.content) as
 * inline spans. Used by both read-only blocks and as the initial content
 * for the per-block Lexical editor.
 *
 * Chip types:
 *   - text       → <span> with optional style bitmap (bold/italic/underline/strike/code)
 *   - mention    → clickable @entity or #tag chip that navigates to the target
 *   - link       → external link chip
 *   - linebreak  → <br>
 *   - image      → <img> inline
 */

import { useNavigate } from "react-router-dom";

export type BlockChip = {
  type: "text" | "mention" | "link" | "linebreak" | "image";
  value: string;
  url?: string;
  styles?: number;
  mentionTrigger?: string;
  mentionTarget?: string;
};

export const STYLE_BOLD = 1;
export const STYLE_ITALIC = 2;
export const STYLE_UNDERLINE = 4;
export const STYLE_STRIKE = 8;
export const STYLE_CODE = 16;

type Props = {
  chips: BlockChip[];
  className?: string;
};

function styleClass(styles: number | undefined): string {
  if (!styles) return "";
  const classes: string[] = [];
  if (styles & STYLE_BOLD) classes.push("font-semibold");
  if (styles & STYLE_ITALIC) classes.push("italic");
  if (styles & STYLE_UNDERLINE) classes.push("underline");
  if (styles & STYLE_STRIKE) classes.push("line-through");
  if (styles & STYLE_CODE) classes.push("font-mono text-[0.9em] bg-gray-100 dark:bg-white/[0.06] px-1 rounded");
  return classes.join(" ");
}

function createEditableChipNode(doc: Document, chip: BlockChip): Node {
  if (chip.type === "linebreak") {
    const br = doc.createElement("br");
    br.dataset.chipType = "linebreak";
    return br;
  }
  if (chip.type === "image") {
    const img = doc.createElement("img");
    img.dataset.chipType = "image";
    img.dataset.value = chip.value;
    if (chip.url) img.dataset.url = chip.url;
    img.src = chip.url ?? chip.value;
    img.alt = "";
    img.contentEditable = "false";
    img.className = "my-2 inline-block max-h-64 rounded border border-gray-200 dark:border-white/10";
    return img;
  }
  if (chip.type === "link") {
    const link = doc.createElement("a");
    link.dataset.chipType = "link";
    link.dataset.value = chip.value;
    if (chip.url) {
      link.dataset.url = chip.url;
      link.href = chip.url;
    }
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.contentEditable = "false";
    link.className =
      "text-[var(--accent-primary)] underline decoration-[var(--accent-primary)]/40 underline-offset-2 hover:decoration-[var(--accent-primary)]";
    link.textContent = chip.value;
    return link;
  }
  if (chip.type === "mention") {
    const mention = doc.createElement("span");
    mention.dataset.chipType = "mention";
    mention.dataset.value = chip.value;
    if (chip.mentionTrigger) mention.dataset.mentionTrigger = chip.mentionTrigger;
    if (chip.mentionTarget) mention.dataset.mentionTarget = chip.mentionTarget;
    mention.contentEditable = "false";
    mention.className = "rounded px-1 text-[var(--accent-primary)] bg-[var(--accent-primary)]/10";
    mention.textContent = `${chip.mentionTrigger ?? "@"}${chip.value}`;
    return mention;
  }
  if (!chip.styles) {
    return doc.createTextNode(chip.value);
  }
  const span = doc.createElement("span");
  span.dataset.chipType = "text";
  span.dataset.styles = String(chip.styles);
  span.className = styleClass(chip.styles);
  span.textContent = chip.value;
  return span;
}

export function renderEditableChipContent(root: HTMLElement, chips: BlockChip[]): void {
  const doc = root.ownerDocument ?? document;
  root.replaceChildren(...chips.map((chip) => createEditableChipNode(doc, chip)));
}

function styleBitsFromElement(element: HTMLElement): number {
  const datasetStyles = Number.parseInt(element.dataset.styles ?? "0", 10) || 0;
  switch (element.tagName) {
    case "B":
    case "STRONG":
      return datasetStyles | STYLE_BOLD;
    case "I":
    case "EM":
      return datasetStyles | STYLE_ITALIC;
    case "U":
      return datasetStyles | STYLE_UNDERLINE;
    case "S":
    case "STRIKE":
    case "DEL":
      return datasetStyles | STYLE_STRIKE;
    case "CODE":
      return datasetStyles | STYLE_CODE;
    default:
      return datasetStyles;
  }
}

function pushTextChip(target: BlockChip[], value: string, styles: number): void {
  if (!value) return;
  const normalizedStyles = styles > 0 ? styles : undefined;
  const previous = target[target.length - 1];
  if (previous?.type === "text" && (previous.styles ?? 0) === (normalizedStyles ?? 0)) {
    previous.value += value;
    return;
  }
  target.push({
    type: "text",
    value,
    styles: normalizedStyles,
  });
}

function visitEditableNode(node: Node, inheritedStyles: number, target: BlockChip[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    pushTextChip(target, node.textContent ?? "", inheritedStyles);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node as HTMLElement;
  const chipType = element.dataset.chipType;

  if (chipType === "mention") {
    target.push({
      type: "mention",
      value: element.dataset.value ?? element.textContent?.replace(/^[@#<>]+/, "") ?? "",
      mentionTrigger: element.dataset.mentionTrigger ?? "@",
      mentionTarget: element.dataset.mentionTarget ?? element.dataset.value,
    });
    return;
  }

  if (chipType === "link" || element.tagName === "A") {
    const href = (element as HTMLAnchorElement).href || element.dataset.url;
    target.push({
      type: "link",
      value: element.dataset.value ?? element.textContent ?? href ?? "",
      url: element.dataset.url ?? href,
    });
    return;
  }

  if (chipType === "image" || element.tagName === "IMG") {
    const image = element as HTMLImageElement;
    target.push({
      type: "image",
      value: element.dataset.value ?? image.currentSrc ?? image.src,
      url: element.dataset.url ?? image.currentSrc ?? image.src,
    });
    return;
  }

  if (chipType === "linebreak" || element.tagName === "BR") {
    target.push({ type: "linebreak", value: "\n" });
    return;
  }

  const nextStyles = inheritedStyles | styleBitsFromElement(element);
  for (const child of Array.from(element.childNodes)) {
    visitEditableNode(child, nextStyles, target);
  }
}

export function chipsFromEditableRoot(root: HTMLElement): BlockChip[] {
  const chips: BlockChip[] = [];
  for (const child of Array.from(root.childNodes)) {
    visitEditableNode(child, 0, chips);
  }
  if (chips.length === 0) {
    return [{ type: "text", value: "" }];
  }
  return chips;
}

export function BlockChipRenderer({ chips, className = "" }: Props) {
  const navigate = useNavigate();

  return (
    <span className={className}>
      {chips.map((chip, idx) => {
        if (chip.type === "linebreak") {
          return <br key={idx} />;
        }
        if (chip.type === "image") {
          return (
            <img
              key={idx}
              src={chip.url ?? chip.value}
              alt=""
              className="my-2 inline-block max-h-64 rounded border border-gray-200 dark:border-white/10"
            />
          );
        }
        if (chip.type === "link") {
          return (
            <a
              key={idx}
              href={chip.url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent-primary)] underline decoration-[var(--accent-primary)]/40 underline-offset-2 hover:decoration-[var(--accent-primary)]"
            >
              {chip.value}
            </a>
          );
        }
        if (chip.type === "mention") {
          const trigger = chip.mentionTrigger ?? "@";
          const isHashtag = trigger === "#";
          const target = chip.mentionTarget ?? chip.value;
          const baseClass = isHashtag
            ? "text-amber-500 hover:text-amber-400"
            : "text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 px-1 rounded";
          return (
            <button
              key={idx}
              type="button"
              className={`cursor-pointer transition-colors ${baseClass}`}
              onClick={(e) => {
                e.preventDefault();
                if (!isHashtag && target) {
                  navigate(`/entity/${encodeURIComponent(target)}`);
                }
              }}
            >
              {trigger}
              {chip.value}
            </button>
          );
        }
        // Plain text with optional styles
        return (
          <span key={idx} className={styleClass(chip.styles)}>
            {chip.value}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Convert a plain string into a single text chip. Utility for callers that
 * have raw text (e.g. markdown line) and just want to show it.
 */
export function chipsFromText(text: string): BlockChip[] {
  return [{ type: "text", value: text }];
}

/**
 * Parse a string that may contain @mentions, #tags, and URLs into chips.
 * Used by the slash command handler + the backfill migration.
 *
 * Very simple heuristic version — the persistent authoring path (Lexical)
 * will emit properly-typed chips directly and won't need this.
 */
export function chipsFromMarkup(text: string): BlockChip[] {
  const chips: BlockChip[] = [];
  // Matches @word, #word, <>word, or an http(s):// URL
  const pattern = /(@[\w-]+|#[\w-]+|<>[\w-]+|https?:\/\/[^\s]+)/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const matched = match[0];
    if (start > lastIndex) {
      chips.push({ type: "text", value: text.slice(lastIndex, start) });
    }
    if (matched.startsWith("@")) {
      chips.push({
        type: "mention",
        value: matched.slice(1),
        mentionTrigger: "@",
        mentionTarget: matched.slice(1),
      });
    } else if (matched.startsWith("#")) {
      chips.push({
        type: "mention",
        value: matched.slice(1),
        mentionTrigger: "#",
      });
    } else if (matched.startsWith("<>")) {
      chips.push({
        type: "mention",
        value: matched.slice(2),
        mentionTrigger: "<>",
        mentionTarget: matched.slice(2),
      });
    } else {
      chips.push({ type: "link", value: matched, url: matched });
    }
    lastIndex = start + matched.length;
  }
  if (lastIndex < text.length) {
    chips.push({ type: "text", value: text.slice(lastIndex) });
  }
  return chips.length > 0 ? chips : [{ type: "text", value: text }];
}

export default BlockChipRenderer;
