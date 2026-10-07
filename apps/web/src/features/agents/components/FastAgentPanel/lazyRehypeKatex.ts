/**
 * Lazy-loader for rehype-katex that preserves a true code-split boundary.
 *
 * WHY THIS FILE EXISTS:
 * Rollup statically analyzes `import('rehype-katex')` even inside function
 * bodies and even in separate wrapper modules. It hoists the transitive
 * dependency graph (katex-vendor, 265 KB / 77 KB gzip) as a bare side-effect
 * import on the parent chunk, defeating lazy loading.
 *
 * This module is force-assigned to the `katex-vendor` manualChunk in
 * vite.config.ts so it stays in an isolated async chunk. The parent chunk
 * (agent-fast-panel) only contains `import('./lazyRehypeKatex')` which
 * Rollup keeps as a true dynamic boundary.
 *
 * DO NOT:
 * - Inline this import into UIMessageBubble.tsx (re-breaks the boundary)
 * - Remove the manualChunks entry for this file in vite.config.ts
 */

let _katexCssLoaded = false;

/**
 * Dynamically loads rehype-katex + its CSS. Returns the rehype plugin.
 */
export async function loadRehypeKatex() {
  const mod = await import('rehype-katex');
  if (!_katexCssLoaded) {
    _katexCssLoaded = true;
    import('katex/dist/katex.min.css');
  }
  return mod.default;
}
