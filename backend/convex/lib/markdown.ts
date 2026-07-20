/**
 * @fileoverview Markdown processing utilities for Convex backend.
 * 
 * This file contains helper functions to detect node types from markdown,
 * create BlockNote-compatible JSON structures, and extract plain text.
 * These utilities are shared across different mutations that handle content creation and updates.
 */

/**
 * Detects the node type from a markdown string.
 * @param markdown The markdown content.
 * @returns The detected node type (e.g., 'heading', 'paragraph').
 */
export function detectNodeType(markdown: string): string {
  const trimmed = markdown.trim();
  
  if (trimmed.startsWith('# ')) return 'heading';
  if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) return 'heading';
  if (trimmed.startsWith('- [ ] ') || trimmed.startsWith('- [x] ')) return 'checkListItem';
  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) return 'bulletListItem';
  if (trimmed.match(/^\d+\. /)) return 'numberedListItem';
  if (trimmed.startsWith('```')) return 'codeBlock';
  if (trimmed.startsWith('> ')) return 'quote';
  
  return 'paragraph';
}

/**
 * Creates a BlockNote-compatible JSON structure from markdown.
 * @param nodeType The type of the node.
 * @param markdown The markdown content.
 * @returns A JSON object representing the BlockNote block.
 */
export function createBlockJson(nodeType: string, markdown: string): any {
  const trimmed = markdown.trim();
  
  switch (nodeType) {
    case 'heading': {
      // Derive heading level from leading #'s if present; else default to H1
      let level = 1;
      let text = trimmed;
      const m = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (m) {
        level = Math.min(Math.max(m[1].length, 1), 6);
        text = m[2];
      }
      
      return {
        type: 'heading',
        props: { level },
        content: [{ type: 'text', text: text.trim() }]
      };
    }
    
    case 'checkListItem': {
      // Support either raw markdown "- [ ] text" / "- [x] text" or plain text
      const isUnchecked = /^- \[ \]\s+/.test(trimmed);
      const isChecked = /^- \[x\]\s+/i.test(trimmed);
      const checked = isChecked;
      const text = (isUnchecked || isChecked)
        ? trimmed.replace(/^- \[[ xX]\]\s+/, '').trim()
        : trimmed;
      // Normalize to BlockNote schema: taskList > taskItem
      return {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            checked,
            content: [{ type: 'text', text }],
          },
        ],
      };
    }
    
    case 'bulletListItem': {
      // Accept either markdown bullets ("- ", "* ") or plain text
      const text = /^[-*]\s+/.test(trimmed)
        ? trimmed.replace(/^[-*]\s+/, '').trim()
        : trimmed;
      return {
        type: 'bulletListItem',
        content: [{ type: 'text', text }]
      };
    }
    
    case 'numberedListItem': {
      const text = /^\d+\.\s+/.test(trimmed)
        ? trimmed.replace(/^\d+\.\s+/, '').trim()
        : trimmed;
      return {
        type: 'numberedListItem',
        content: [{ type: 'text', text }]
      };
    }
    
    case 'codeBlock': {
      // Support fenced blocks or plain code content
      if (trimmed.startsWith('```')) {
        const lines = trimmed.split('\n');
        const firstLine = lines[0];
        const language = firstLine.slice(3).trim() || 'text';
        const code = lines.slice(1, -1).join('\n');
        return {
          type: 'codeBlock',
          props: { language },
          content: [{ type: 'text', text: code }]
        };
      }
      const language = 'text';
      const code = trimmed;
      
      return {
        type: 'codeBlock',
        props: { language },
        content: [{ type: 'text', text: code }]
      };
    }
    
    case 'quote': {
      const text = trimmed.startsWith('>')
        ? trimmed.replace(/^>\s*/, '').trim()
        : trimmed;
      return {
        type: 'quote',
        content: [{ type: 'text', text }]
      };
    }
    
    default: {
      return {
        type: 'paragraph',
        content: [{ type: 'text', text: trimmed }]
      };
    }
  }
}

/**
 * Extracts plain text from a markdown string.
 * @param markdown The markdown content.
 * @returns The extracted plain text.
 */
export function extractPlainText(markdown: string): string {
  return markdown
    .replace(/^#+\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Strip checklist markers for both checked and unchecked cases
    .replace(/^- \[[ xX]\]\s+/gm, '')
    .trim();
}

/**
 * Extract plain text from a BlockNote-like block JSON.
 * Traverses shallow and nested content arrays to collect text.
 */
export function extractTextFromBlock(block: any): string {
  const texts: string[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.text === 'string') texts.push(node.text);
    const content = node.content;
    if (Array.isArray(content)) {
      for (const child of content) visit(child);
    }
  };
  visit(block);
  return texts.join(' ').trim();
}

/**
 * Check if a value looks like a single BlockNote block.
 * Minimal shape: { type: string, content?: Array<any> }
 */
function isValidBlockLike(val: any): val is { type: string; content?: any[] } {
  return (
    !!val &&
    typeof val === 'object' &&
    typeof val.type === 'string' &&
    (val.content === undefined || Array.isArray(val.content))
  );
}

/**
 * Normalize a BlockNote-like node for top-level usage:
 * - Wrap inline "text" nodes into a paragraph.
 * - Unwrap wrapper nodes like "doc" or "blockGroup" by taking the first valid child.
 * - Ensure content is always an array if present.
 */
function normalizeBlockLike(input: any): { type: string; content?: any[] } | null {
  if (!isValidBlockLike(input)) return null;

  // Unwrap wrapper nodes by taking the first valid child recursively.
  if ((input.type === 'doc' || input.type === 'blockGroup') && Array.isArray(input.content)) {
    const firstChild = input.content.find((c: any) => isValidBlockLike(c));
    if (firstChild) return normalizeBlockLike(firstChild);
    // No valid child, fallback to paragraph from extracted text
    const text = extractTextFromBlock(input);
    return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] };
  }

  // Wrap inline text as a paragraph
  if (input.type === 'text') {
    return { type: 'paragraph', content: [input] };
  }

  // Map legacy checklist node to BlockNote task structure
  if (input.type === 'checkListItem') {
    const checked = Boolean((input as any).checked ?? (input as any).props?.checked);
    const text = extractTextFromBlock(input);
    return {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          checked,
          content: text ? [{ type: 'text', text }] : [],
        },
      ],
    };
  }

  // Ensure content shape
  const block = { ...input };
  if (!Array.isArray(block.content)) {
    block.content = block.content ? [block.content] : [];
  }
  return block;
}

/**
 * Coerce an arbitrary input (markdown string, array, or object) into
 * a valid single BlockNote block with consistent type and text.
 * If input is a string, it is treated as markdown.
 * If input is an array, the first valid block is used.
 * If input is an object, it must minimally look like a BlockNote block.
 * Falls back to a paragraph built from fallbackText or empty string.
 */
export function coerceToBlockJson(
  input: any,
  fallbackText?: string,
): { block: any; type: string; text: string } {
  try {
    // Case 1: markdown string
    if (typeof input === 'string') {
      const nodeType = detectNodeType(input);
      return {
        block: createBlockJson(nodeType, input),
        type: nodeType,
        text: extractPlainText(input),
      };
    }

    // Case 2: array — take the first valid block (normalized)
    if (Array.isArray(input)) {
      const first = input.find((x) => isValidBlockLike(x));
      if (first) {
        const normalized = normalizeBlockLike(first)!;
        const text = extractTextFromBlock(normalized);
        return { block: normalized, type: normalized.type, text };
      }
    }

    // Case 3: object — accept minimal valid block shape (normalized)
    if (isValidBlockLike(input)) {
      const normalized = normalizeBlockLike(input)!;
      const text = extractTextFromBlock(normalized);
      return { block: normalized, type: normalized.type, text };
    }
  } catch {
    // fall through to fallback
  }

  // Fallback: build from provided fallbackText or empty paragraph
  const safe = (fallbackText ?? '').trim();
  const nodeType = detectNodeType(safe);
  return {
    block: createBlockJson(nodeType, safe),
    type: nodeType,
    text: extractPlainText(safe),
  };
}

export function parseMarkdownToBlocks(markdown: string): any[] {
  const lines = markdown.split('\n');
  const blocks: any[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLang = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Handle code blocks
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim() || 'text';
        codeBlockContent = [];
      } else {
        inCodeBlock = false;
        blocks.push({
          type: 'codeBlock',
          lang: codeBlockLang,
          text: codeBlockContent.join('\n')
        });
      }
      continue;
    }
    
    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }
    
    // Handle headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim()
      });
      continue;
    }
    
    // Handle checklist items: "- [ ] text" or "- [x] text"
    const checklistMatch = line.match(/^-[ ]\[( |x|X)\]\s+(.*)$/);
    if (checklistMatch) {
      const checked = checklistMatch[1].toLowerCase() === 'x';
      const text = checklistMatch[2].trim();
      blocks.push({
        type: 'checkListItem',
        checked,
        text,
      });
      continue;
    }

    // Handle bullet lists
    if (line.match(/^[-*]\s+/)) {
      const text = line.replace(/^[-*]\s+/, '').trim();
      blocks.push({
        type: 'bulletListItem',
        text: text
      });
      continue;
    }
    
    // Handle numbered lists (treat as bullet lists for now)
    if (line.match(/^\d+\.\s+/)) {
      const text = line.replace(/^\d+\.\s+/, '').trim();
      blocks.push({
        type: 'bulletListItem',
        text: text
      });
      continue;
    }
    
    // Handle quotes
    if (line.startsWith('>')) {
      const text = line.replace(/^>\s*/, '').trim();
      blocks.push({
        type: 'quote',
        text: text
      });
      continue;
    }
    
    // Handle horizontal rules
    if (line.match(/^---+$/) || line.match(/^\*\*\*+$/) || line.match(/^___+$/)) {
      blocks.push({
        type: 'horizontalRule'
      });
      continue;
    }
    
    // Handle paragraphs (including empty lines)
    if (line.trim() === '') {
      // Skip empty lines between blocks
      continue;
    } else {
      blocks.push({
        type: 'paragraph',
        text: line.trim()
      });
    }
  }
  
  return blocks;
}