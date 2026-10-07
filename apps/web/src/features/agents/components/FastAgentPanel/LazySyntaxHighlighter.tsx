/**
 * Lazy-loaded SyntaxHighlighter component
 * Reduces initial bundle size by loading the Shiki-based CodeBlock primitive on demand.
 * Reimplemented on top of `@/components/ai-elements/code-block` — drops the
 * react-syntax-highlighter dependency usage from this file.
 */

import { Suspense, lazy } from 'react';
import type { BundledLanguage } from 'shiki';

// Lazy load the heavy (Shiki-based) code block primitive so its highlighter
// stays out of the initial bundle, matching this file's original intent.
const CodeBlockLazy = lazy(() =>
  import('@/components/ai-elements/code-block').then((mod) => ({
    default: mod.CodeBlock,
  }))
);

interface LazySyntaxHighlighterProps {
  language: string;
  children: string;
  PreTag?: any;
  className?: string;
}

// Simple fallback that shows code without highlighting
function CodeFallback({ children, className }: { children: string; className?: string }) {
  return (
    <pre className={className}>
      <code className="text-sm font-mono text-slate-300 whitespace-pre-wrap">
        {children}
      </code>
    </pre>
  );
}

/**
 * Lazy-loaded syntax highlighter with fallback
 * Use this instead of importing react-syntax-highlighter directly
 */
export function LazySyntaxHighlighter({
  language,
  children,
  className,
}: LazySyntaxHighlighterProps) {
  return (
    <Suspense fallback={<CodeFallback className={className}>{children}</CodeFallback>}>
      <CodeBlockLazy
        code={children}
        language={language as BundledLanguage}
        className={className}
      />
    </Suspense>
  );
}

export default LazySyntaxHighlighter;
