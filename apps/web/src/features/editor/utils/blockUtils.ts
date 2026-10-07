/**
 * Block utility functions for UnifiedEditor
 * Extracted from UnifiedEditor.tsx for modularity
 */

/**
 * Recursively extracts plain text from a node structure
 */
export const extractPlainText = (node: any): string => {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractPlainText).join('');
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  if (Array.isArray(node.content)) return node.content.map(extractPlainText).join('');
  if (Array.isArray(node.children)) return node.children.map(extractPlainText).join('');
  return '';
};

/**
 * Checks if blocks are trivially empty (only whitespace)
 */
export const blocksAreTriviallyEmpty = (blocks: any[]): boolean => {
  const plain = (blocks || []).map(extractPlainText).join('');
  return plain.replace(/\s+/g, '').length === 0;
};

/**
 * Extracts text content from a block by walking its structure
 */
export const getBlockText = (block: any): string => {
  const texts: string[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === 'text' && typeof n.text === 'string') { texts.push(n.text); }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  try {
    walk(block);
  } catch {
    // Block walk failed
  }
  return texts.join('');
};

/**
 * Ensures a node is a valid top-level block for BlockNote
 */
export const bnEnsureTopLevelBlock = (maybeBlock: any): any => {
  if (!maybeBlock || typeof maybeBlock !== "object") return { type: "paragraph", content: [] };
  if ((maybeBlock.type === "doc" || maybeBlock.type === "blockGroup") && Array.isArray(maybeBlock.content)) {
    return { _flattenFromDoc: true, content: maybeBlock.content } as any;
  }
  if (maybeBlock.type === "text" && typeof (maybeBlock.text) === "string") {
    return { type: "paragraph", content: [{ type: "text", text: String(maybeBlock.text) }] };
  }
  if (maybeBlock.type && Array.isArray(maybeBlock.content)) {
    return { type: maybeBlock.type, content: maybeBlock.content, props: maybeBlock.props };
  }
  return { type: "paragraph", content: [] };
};

