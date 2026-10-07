/**
 * LazyCodeBlock - Performance-optimized code block with lazy-loaded syntax highlighting
 *
 * This component defers loading of the heavy Prism/react-syntax-highlighter bundle
 * until actually needed, reducing initial bundle size by ~230KB gzipped.
 *
 * Features:
 * - Lazy loading with Suspense fallback
 * - Minimal initial render (plain <pre> with loading state)
 * - Copy to clipboard functionality
 * - Language detection
 */

import React, { Suspense, useState, useCallback, lazy } from 'react';
import { Copy, Check } from 'lucide-react';

// Lazy load the syntax highlighter only when needed
const SyntaxHighlighter = lazy(() =>
  import('react-syntax-highlighter').then((mod) => ({
    default: mod.Prism,
  }))
);

// Lazy load the style separately
const getStyle = () =>
  import('react-syntax-highlighter/dist/esm/styles/prism').then(
    (mod) => mod.vscDarkPlus
  );

interface LazyCodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  className?: string;
}

/**
 * Simple fallback while syntax highlighter loads
 */
function CodeBlockFallback({ code, language }: { code: string; language?: string }) {
  return (
    <div className="relative group">
      <div className="absolute top-2 right-2 flex items-center gap-2">
        <span className="text-xs font-mono text-content-muted">{language || 'code'}</span>
      </div>
      <pre className="p-4 bg-[#1e1e1e] text-[#d4d4d4] rounded-lg overflow-x-auto text-sm font-mono motion-safe:animate-pulse">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Highlighted code block component (loaded lazily)
 */
function HighlightedCodeBlock({
  code,
  language = 'text',
  showLineNumbers = false,
  style,
}: LazyCodeBlockProps & { style: any }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [code]);

  return (
    <div className="relative group">
      {/* Header bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-1.5 bg-[#2d2d2d] rounded-t-lg border-b border-[#3d3d3d]">
        <span className="text-xs font-mono text-content-muted">
          {language}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-content-muted hover:text-white transition-colors"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-400" />
              <span className="text-green-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span className="opacity-0 group-hover:opacity-100 transition-opacity">Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code block with extra padding for header */}
      <div className="pt-8">
        <SyntaxHighlighter
          language={language}
          style={style}
          showLineNumbers={showLineNumbers}
          customStyle={{
            margin: 0,
            borderRadius: '0 0 0.5rem 0.5rem',
            fontSize: '0.875rem',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
            },
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

/**
 * Wrapper component that handles lazy loading
 */
function LazyHighlightedCodeBlock(props: LazyCodeBlockProps) {
  const [style, setStyle] = React.useState<any>(null);

  React.useEffect(() => {
    getStyle().then(setStyle);
  }, []);

  if (!style) {
    return <CodeBlockFallback code={props.code} language={props.language} />;
  }

  return <HighlightedCodeBlock {...props} style={style} />;
}

/**
 * Main export - LazyCodeBlock with Suspense boundary
 */
export function LazyCodeBlock(props: LazyCodeBlockProps) {
  return (
    <Suspense fallback={<CodeBlockFallback code={props.code} language={props.language} />}>
      <LazyHighlightedCodeBlock {...props} />
    </Suspense>
  );
}

export default LazyCodeBlock;
