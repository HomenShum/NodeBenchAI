import React, { useState, useEffect, useCallback } from 'react';
import { Code2, Play, Copy, Check, Loader2, ExternalLink } from 'lucide-react';

export interface CodeViewerProps {
  /** Raw code content to display */
  content?: string | null;
  /** URL to fetch code content from (if content not provided) */
  url?: string;
  /** File name for title and language detection */
  fileName?: string;
  /** Whether to show the loading state */
  isLoading?: boolean;
  /** Additional className for the container */
  className?: string;
  /** Callback when content is loaded from URL */
  onContentLoaded?: (content: string) => void;
}

/**
 * CodeViewer - A reusable code viewer component with Source/Preview toggle
 * 
 * Features:
 * - Dark VS Code-style theme for source view
 * - Preview mode for HTML files (sandboxed iframe)
 * - Copy-to-clipboard functionality
 * - Automatic language detection from file extension
 * - Loading state with spinner
 */
export const CodeViewer: React.FC<CodeViewerProps> = ({
  content: initialContent,
  url,
  fileName = 'code.txt',
  isLoading: externalLoading = false,
  className = '',
  onContentLoaded,
}) => {
  const [mode, setMode] = useState<'source' | 'preview'>('source');
  const [copied, setCopied] = useState(false);
  const [content, setContent] = useState<string | null>(initialContent ?? null);
  const [loading, setLoading] = useState(false);

  // Determine if this is an HTML file (supports preview)
  const isHtmlFile = /\.html?$/i.test(fileName);
  
  // Detect language from file extension for potential syntax highlighting
  const getLanguage = useCallback(() => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      'js': 'javascript', 'jsx': 'javascript',
      'ts': 'typescript', 'tsx': 'typescript',
      'py': 'python', 'rb': 'ruby',
      'go': 'go', 'rs': 'rust',
      'java': 'java', 'kt': 'kotlin',
      'css': 'css', 'scss': 'scss',
      'html': 'html', 'htm': 'html',
      'json': 'json', 'xml': 'xml',
      'yaml': 'yaml', 'yml': 'yaml',
      'md': 'markdown', 'sh': 'bash', 'bash': 'bash',
      'sql': 'sql', 'c': 'c', 'cpp': 'cpp', 'h': 'c', 'hpp': 'cpp',
      'swift': 'swift',
    };
    return langMap[ext] || 'plaintext';
  }, [fileName]);

  // Update content when prop changes
  useEffect(() => {
    if (initialContent !== undefined) {
      setContent(initialContent);
    }
  }, [initialContent]);

  // Fetch content from URL if not provided
  useEffect(() => {
    if (content !== null || !url) return;
    
    setLoading(true);
    fetch(url)
      .then(res => res.text())
      .then((text: string) => {
        setContent(text);
        setLoading(false);
        onContentLoaded?.(text);
      })
      .catch(() => {
        setContent(null);
        setLoading(false);
      });
  }, [url, content, onContentLoaded]);

  const handleCopy = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const openInNewTab = useCallback(() => {
    if (!content || !isHtmlFile) return;
    const blob = new Blob([content], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank');
  }, [content, isHtmlFile]);

  const isLoadingState = externalLoading || loading;

  if (isLoadingState) {
    return (
      <div className={`flex items-center justify-center h-32 ${className}`}>
        <div className="flex items-center gap-2 text-content-secondary">
          <Loader2 strokeWidth={1.25} className="h-4 w-4 motion-safe:animate-spin" />
          Loading code...
        </div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className={`flex items-center justify-center h-32 text-content-secondary ${className}`}>
        No code content available
      </div>
    );
  }

  const language = getLanguage();

  return (
    <div className={`flex flex-col h-full bg-surface rounded-lg shadow-sm border border-edge overflow-hidden ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-edge bg-surface-secondary">
        <div className="flex items-center gap-2">
          {/* Mode Toggle - only show for HTML files */}
          {isHtmlFile ? (
            <div className="flex bg-surface-hover p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setMode('source')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  mode === 'source'
                    ? 'bg-surface text-content shadow-sm'
                    : 'text-content-secondary hover:text-content'
                }`}
              >
                <Code2 className="h-3.5 w-3.5" />
                Source
              </button>
              <button
                type="button"
                onClick={() => setMode('preview')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  mode === 'preview'
                    ? 'bg-surface text-content shadow-sm'
                    : 'text-content-secondary hover:text-content'
                }`}
              >
                <Play className="h-3.5 w-3.5" />
                Preview
              </button>
            </div>
          ) : (
            <span className="text-xs font-medium text-content-secondary tracking-wide">
              {language}
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1">
          {isHtmlFile && mode === 'preview' && (
            <button
              type="button"
              onClick={openInNewTab}
              className="p-2 text-content-muted hover:text-content-secondary hover:bg-surface-hover rounded-md transition-colors"
              title="Open in new tab"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="p-2 text-content-muted hover:text-content-secondary hover:bg-surface-hover rounded-md transition-colors"
            title={copied ? 'Copied!' : 'Copy code'}
          >
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {mode === 'source' || !isHtmlFile ? (
          <div className="w-full h-full overflow-auto bg-[#1e1e1e]">
            <pre className="p-4 text-sm font-mono text-content-muted leading-relaxed whitespace-pre-wrap break-words">
              <code>{content}</code>
            </pre>
          </div>
        ) : (
          <iframe
            srcDoc={content}
            className="w-full h-full border-none bg-surface"
            title={fileName}
            sandbox="allow-scripts allow-same-origin"
          />
        )}
      </div>
    </div>
  );
};

export default CodeViewer;

