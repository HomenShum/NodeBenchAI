// src/components/FastAgentPanel/MermaidDiagram.tsx
// Renders Mermaid diagrams from code blocks

import React, { useEffect, useRef, useState } from 'react';
import { Code2, Image as ImageIcon, Copy, Check, RefreshCw, Maximize2, Download, X, ZoomIn, ZoomOut } from 'lucide-react';

interface MermaidDiagramProps {
  code: string;
  id?: string;
  onRetryRequest?: (error: string, code: string) => void;
  isStreaming?: boolean;
}

// Load Mermaid from CDN
declare global {
  interface Window {
    mermaid: any;
  }
}

// Initialize mermaid once
let mermaidInitialized = false;
let mermaidLoading = false;

async function loadMermaid() {
  if (window.mermaid) return;

  if (mermaidLoading) {
    // Wait for it to load
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (window.mermaid) {
          clearInterval(check);
          resolve(undefined);
        }
      }, 100);
    });
    return;
  }

  mermaidLoading = true;

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    // Use latest Mermaid from Cloudflare CDN
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.12.0/mermaid.min.js';
    script.onload = () => {
      mermaidLoading = false;
      // Give it a moment to initialize
      setTimeout(() => resolve(undefined), 100);
    };
    script.onerror = () => {
      mermaidLoading = false;
      reject(new Error('Failed to load Mermaid'));
    };
    document.head.appendChild(script);
  });
}

export function MermaidDiagram({ code, id, onRetryRequest, isStreaming = false }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const lastRenderedCode = useRef<string>('');
  const isRendering = useRef<boolean>(false);

  useEffect(() => {
    // Skip if message is still streaming (wait for complete code)
    if (isStreaming) {
      return;
    }

    // Skip if we're already rendering or if this is the same code we just rendered
    if (isRendering.current || lastRenderedCode.current === code) {
      return;
    }

    // Reset retry state when code changes
    setIsRetrying(false);

    const renderDiagram = async () => {
      isRendering.current = true;
      lastRenderedCode.current = code;
      try {
        // Load Mermaid from CDN
        await loadMermaid();

        // Initialize mermaid if not already done
        if (!mermaidInitialized && window.mermaid) {
          // SECURITY: securityLevel MUST be 'strict' — 'loose' allows arbitrary
          // HTML/JS in diagram labels, enabling XSS from user-provided diagram code.
          // htmlLabels must also be false under strict mode.
          window.mermaid.initialize({
            startOnLoad: false,
            theme: 'default',
            securityLevel: 'strict',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: 14,
            flowchart: {
              useMaxWidth: true,
              htmlLabels: false,
              curve: 'basis',
            },
          });
          mermaidInitialized = true;
        }

        // Generate unique ID for this diagram
        const diagramId = id || `mermaid-${Math.random().toString(36).substr(2, 9)}`;

        // Render the diagram
        const { svg: renderedSvg } = await window.mermaid.render(diagramId, code);
        // SECURITY: Belt-and-suspenders — strip any <script>, <foreignObject>, and
        // event handler attributes from SVG even though securityLevel='strict'.
        const sanitizedSvg = renderedSvg
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
          .replace(/\s*on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
        setSvg(sanitizedSvg);
        setError('');
      } catch (err) {
        console.error('[MermaidDiagram] Rendering error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to render diagram';
        setError(errorMessage);
      } finally {
        isRendering.current = false;
      }
    };

    void renderDiagram();
  }, [code, id, isStreaming]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const handleRetry = () => {
    if (onRetryRequest && !isRetrying) {
      setIsRetrying(true);
      onRetryRequest(error, code);
    }
  };

  const handleDownload = async (format: 'svg' | 'png') => {
    if (!svg) return;

    setIsDownloading(true);
    try {
      if (format === 'svg') {
        // Download as SVG
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `mermaid-diagram-${Date.now()}.svg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        // Convert SVG to PNG
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get canvas context');

        const img = new Image();
        const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        img.onload = () => {
          // Set canvas size to match image with 2x resolution for better quality
          canvas.width = img.width * 2;
          canvas.height = img.height * 2;
          ctx.scale(2, 2);

          // White background
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Draw image
          ctx.drawImage(img, 0, 0);

          // Download
          canvas.toBlob((blob) => {
            if (blob) {
              const link = document.createElement('a');
              link.href = URL.createObjectURL(blob);
              link.download = `mermaid-diagram-${Date.now()}.png`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(link.href);
            }
            setIsDownloading(false);
          }, 'image/png');

          URL.revokeObjectURL(url);
        };

        img.onerror = () => {
          console.error('Failed to load SVG for PNG conversion');
          setIsDownloading(false);
          URL.revokeObjectURL(url);
        };

        img.src = url;
      }

      if (format === 'svg') {
        setIsDownloading(false);
      }
    } catch (err) {
      console.error('Failed to download diagram:', err);
      setIsDownloading(false);
    }
  };

  if (error) {
    return (
      <div className="my-4 p-4 bg-red-50 border border-red-200 rounded-lg">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1">
            <div className="text-sm font-medium text-red-800 mb-1">
              Failed to render Mermaid diagram
            </div>
            <div className="text-xs text-red-600 font-mono">
              {error}
            </div>
          </div>
          {onRetryRequest && (
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-content-muted text-white text-xs font-medium rounded transition-colors"
              title="Ask AI to fix the diagram"
            >
              <RefreshCw className={`h-3 w-3 ${isRetrying ? 'motion-safe:animate-spin' : ''}`} />
              {isRetrying ? 'Retrying...' : 'Fix Diagram'}
            </button>
          )}
        </div>
        <details className="mt-2">
          <summary className="text-xs text-red-700 cursor-pointer hover:underline">
            View code
          </summary>
          <pre className="mt-2 text-xs bg-surface p-2 rounded border border-red-200 overflow-x-auto">
            {code}
          </pre>
        </details>
      </div>
    );
  }

  if (!svg && !error) {
    return (
      <div className="my-4 p-4 bg-surface-secondary border border-edge rounded-lg">
        <div className="flex items-center gap-2 text-sm text-content-secondary">
          <div className="motion-safe:animate-spin h-4 w-4 border-2 border-content-muted border-t-transparent rounded-full" />
          <span>Rendering diagram...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="my-4 bg-surface border border-edge rounded-lg overflow-hidden">
      {/* Minimal header bar */}
      <div className="absolute top-2 right-2 z-10 flex gap-0.5 opacity-60 hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsZoomed(true);
          }}
          className="rounded bg-surface p-1.5 shadow-sm transition-colors hover:bg-surface-secondary"
          title="Zoom"
        >
          <Maximize2 className="h-3.5 w-3.5 text-content-secondary" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDownload('png');
          }}
          disabled={isDownloading}
          className="rounded bg-surface p-1.5 shadow-sm transition-colors hover:bg-surface-secondary disabled:opacity-50"
          title="Download PNG"
        >
          <Download className="h-3.5 w-3.5 text-content-secondary" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowCode(!showCode);
          }}
          className="rounded bg-surface p-1.5 shadow-sm transition-colors hover:bg-surface-secondary"
          title="Code"
        >
          <Code2 className="h-3.5 w-3.5 text-content-secondary" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleCopyCode();
          }}
          className="rounded bg-surface p-1.5 shadow-sm transition-colors hover:bg-surface-secondary"
          title="Copy"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-content-secondary" />
          )}
        </button>
      </div>

      {/* Main diagram - clickable to zoom */}
      <div
        className="relative p-4 cursor-pointer hover:bg-surface-hover transition-colors"
        onClick={() => setIsZoomed(true)}
        title="Click to zoom"
      >
        <div
          className="overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      {showCode && (
        <pre className="mt-2 text-xs bg-surface-secondary p-3 rounded border border-edge overflow-x-auto">
          {code}
        </pre>
      )}

      {/* Zoom Modal */}
      {isZoomed && (
        <div
          className="fixed inset-0 bg-black bg-opacity-80 z-50 flex items-center justify-center p-4"
          onClick={() => {
            setIsZoomed(false);
            setZoomLevel(100);
          }}
        >
          <div className="relative w-full h-full max-w-6xl flex flex-col">
            {/* Compact control bar */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1 rounded-lg bg-surface px-2 py-1.5 shadow-lg">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoomLevel(Math.min(200, zoomLevel + 25));
                  }}
                  className="p-1.5 hover:bg-surface-hover rounded transition-colors"
                  title="Zoom in"
                  disabled={zoomLevel >= 200}
                >
                  <ZoomIn className="h-4 w-4 text-content" />
                </button>
                <span className="text-xs font-medium text-content min-w-[3rem] text-center">
                  {zoomLevel}%
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoomLevel(Math.max(50, zoomLevel - 25));
                  }}
                  className="p-1.5 hover:bg-surface-hover rounded transition-colors"
                  title="Zoom out"
                  disabled={zoomLevel <= 50}
                >
                  <ZoomOut className="h-4 w-4 text-content" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoomLevel(100);
                  }}
                  className="p-1.5 hover:bg-surface-hover rounded transition-colors ml-1"
                  title="Reset zoom"
                >
                  <span className="text-xs font-medium text-content">Reset</span>
                </button>
              </div>

              <div className="flex items-center gap-1 rounded-lg bg-surface px-2 py-1.5 shadow-lg">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload('svg');
                  }}
                  disabled={isDownloading}
                  className="p-1.5 hover:bg-surface-hover rounded transition-colors disabled:opacity-50"
                  title="Download SVG"
                >
                  <Download className="h-4 w-4 text-content" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload('png');
                  }}
                  disabled={isDownloading}
                  className="p-1.5 hover:bg-surface-hover rounded transition-colors disabled:opacity-50"
                  title="Download PNG"
                >
                  <Download className="h-4 w-4 text-blue-600" />
                </button>
                <div className="w-px h-4 bg-[var(--border-color)] mx-1" />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsZoomed(false);
                    setZoomLevel(100);
                  }}
                  className="p-1.5 hover:bg-surface-hover rounded transition-colors"
                  title="Close"
                >
                  <X className="h-4 w-4 text-content" />
                </button>
              </div>
            </div>

            {/* Zoomed diagram with scroll */}
            <div className="flex-1 bg-surface rounded-lg shadow-2xl overflow-auto">
              <div
                className="p-6 transition-transform duration-200"
                style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top left' }}
                onClick={(e) => e.stopPropagation()}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
