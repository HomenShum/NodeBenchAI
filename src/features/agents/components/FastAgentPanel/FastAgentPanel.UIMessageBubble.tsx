// src/components/FastAgentPanel/FastAgentPanel.UIMessageBubble.tsx
// Message bubble component optimized for UIMessage format from Agent component

import React, { useState, useMemo, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
// KaTeX is 265 KB / 77 KB gzip — lazy-load only when math notation is detected.
// The dynamic import lives in a SEPARATE module (lazyRehypeKatex.ts) so Rollup
// creates an isolated async chunk. If the `import('rehype-katex')` were inline
// here, Rollup would hoist katex-vendor as a static dep of agent-fast-panel.
// See lazyRehypeKatex.ts for the full explanation.
import remarkMath from 'remark-math';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _rehypeKatexPromise: Promise<any> | null = null;

function useRehypeKatex(text: string) {
  const needsMath = /\$[^$]|\\\(|\\begin\{/.test(text);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [plugin, setPlugin] = React.useState<any>(null);

  React.useEffect(() => {
    if (!needsMath) { setPlugin(null); return; }
    let cancelled = false;
    if (!_rehypeKatexPromise) {
      _rehypeKatexPromise = import('./lazyRehypeKatex').then((m) => m.loadRehypeKatex());
    }
    _rehypeKatexPromise.then((p) => { if (!cancelled) setPlugin(() => p); });
    return () => { cancelled = true; };
  }, [needsMath]);

  return needsMath ? plugin : null;
}
import { LazySyntaxHighlighter } from './LazySyntaxHighlighter';
import { User, Bot, Wrench, Image as ImageIcon, AlertCircle, Loader2, RefreshCw, Trash2, ChevronDown, ChevronRight, CheckCircle2, XCircle, Clock, Copy, Check, BrainCircuit, Zap, ExternalLink, Globe, Calendar, Eye, ThumbsUp, ThumbsDown, Pencil, Bookmark, Volume2, VolumeX, Pin, Share2, Search } from 'lucide-react';
import { useVoiceOutput } from '@/hooks/useVoiceOutput';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useSmoothText, type UIMessage } from '@convex-dev/agent/react';
import { cn } from '@/lib/utils';
import { TokenUsageBadge } from './TokenUsageBadge';
import {
  Message as AIMessage,
  MessageContent as AIMessageContent,
} from '@/components/ai-elements/message';
import {
  Reasoning as AIReasoning,
  ReasoningContent as AIReasoningContent,
  ReasoningTrigger as AIReasoningTrigger,
} from '@/components/ai-elements/reasoning';
import {
  Tool as AITool,
  ToolContent as AIToolContent,
  ToolHeader as AIToolHeader,
  ToolInput as AIToolInput,
  ToolOutput as AIToolOutput,
} from '@/components/ai-elements/tool';
import {
  Source as AISource,
  Sources as AISources,
  SourcesContent as AISourcesContent,
  SourcesTrigger as AISourcesTrigger,
} from '@/components/ai-elements/sources';
// Type imports (static)
import { type YouTubeVideo, type SECDocument } from './MediaGallery';
import { type FileViewerFile } from './FileViewer';
// Lazy-loaded heavy components
const YouTubeGallery = lazy(() => import('./MediaGallery').then(m => ({ default: m.YouTubeGallery })));
const MermaidDiagram = lazy(() => import('./MermaidDiagram').then(m => ({ default: m.MermaidDiagram })));
const FileViewer = lazy(() => import('./FileViewer').then(m => ({ default: m.FileViewer })));
import { CompanySelectionCard, type CompanyOption } from './CompanySelectionCard';
import { PeopleSelectionCard, type PersonOption } from './PeopleSelectionCard';
import { EventSelectionCard, type EventOption } from './EventSelectionCard';
import { NewsSelectionCard, type NewsArticleOption } from './NewsSelectionCard';
import { RichMediaSection } from './RichMediaSection';
import {
  extractMediaFromText,
  hasMedia,
  removeMediaMarkersFromText,
  type ExtractedMedia,
} from './utils/mediaExtractor';
import { GoalCard, type TaskStatusItem } from './FastAgentPanel.GoalCard';
import {
  DocumentActionGrid,
  extractDocumentActions,
  removeDocumentActionMarkers,
  type DocumentAction,
} from './DocumentActionCard';
import {
  ArbitrageCitation,
  StatusBadge,
  parseArbitrageCitation,
  parseLegacyCitation,
  type ArbitrageStatus
} from './FastAgentPanel.VisualCitation';
import { ArbitrageReportCard } from './ArbitrageReportCard';
import { MemoryPill } from './MemoryPill';
import { ToolCallTransparency } from './ToolCallTransparency';
import { FusedSearchResults, type FusedResult, type SourceError, type SearchSource } from './FusedSearchResults';
import { StreamingStatus } from './FastAgentPanel.StreamingStatus';
// Phase All: Citation & Entity parsing with adaptive enrichment
import { InteractiveSpanParser } from '@/features/research/components/InteractiveSpanParser';
import type { EntityHoverData } from '@/features/research/components/EntityHoverPreview';
import {
  addCitation,
  addEntity,
  createCitationLibrary,
  createEntityLibrary,
  getOrderedCitations,
  parseCitations,
  parseEntities,
  type CitationLibrary,
  type EntityLibrary
} from '@/features/research/types/index';
import type { CitationType } from '@/features/research/types/citationSchema';
import type { EntityType } from '@/features/research/types/entitySchema';
import { makeWebSourceCitationId } from '../../../../../shared/citations/webSourceCitations';
import { formatBriefDateTime } from '@/lib/briefDate';
import { useMessageHandlers } from './MessageHandlersContext';
import {
  convexToUIParts,
  type ConvexUIRenderPart,
  type DomainCategory,
  type NormalizedToolPart,
} from './adapters/convexToUIParts';

interface FastAgentUIMessageBubbleProps {
  message: UIMessage;
  onMermaidRetry?: (error: string, code: string) => void;
  // Legacy prop-based callbacks (optional - context preferred)
  onRegenerateMessage?: () => void;
  onDeleteMessage?: () => void;
  onCompanySelect?: (company: CompanyOption) => void;
  onPersonSelect?: (person: PersonOption) => void;
  onEventSelect?: (event: EventOption) => void;
  onNewsSelect?: (article: NewsArticleOption) => void;
  onDocumentSelect?: (documentId: string) => void;
  onEditMessage?: (newText: string) => void;
  isParent?: boolean; // Whether this message has child messages
  isChild?: boolean; // Whether this is a child message (specialized agent)
  agentRole?: 'coordinator' | 'documentAgent' | 'mediaAgent' | 'secAgent' | 'webAgent';
  /** Pre-loaded entity enrichment data for medium-detail hover previews */
  entityEnrichment?: Record<string, EntityHoverData>;
  /** Search query to highlight in message text */
  searchHighlight?: string;
  /** Whether this message is bookmarked */
  isBookmarked?: boolean;
  /** Callback to toggle bookmark on this message */
  onToggleBookmark?: () => void;
  /** Whether this message is pinned */
  isMessagePinned?: boolean;
  /** Callback to toggle pin on this message */
  onTogglePin?: () => void;
  /** RLHF feedback vote for this message */
  feedbackVote?: 'up' | 'down' | null;
  /** Callback for RLHF feedback */
  onFeedback?: (vote: 'up' | 'down') => void;
  /** Font size override */
  fontSize?: number;
  /** Edit diff data (old vs new text) */
  editDiff?: { oldText: string; newText: string } | null;
  /** Whether this message is inside the context window */
  isInContext?: boolean;
  /** Compact presentation for the cockpit sidebar variant. */
  compact?: boolean;
}

/**
 * Image component with lazy loading using IntersectionObserver
 * Only loads image when it's about to enter the viewport
 * Memoized to prevent re-renders when parent updates
 */
const SafeImage = React.memo(function SafeImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [isVisible, setIsVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Lazy load using IntersectionObserver
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect(); // Only need to observe once
          }
        });
      },
      {
        rootMargin: '200px 0px', // Start loading 200px before entering viewport
        threshold: 0,
      }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center gap-2 p-4 bg-surface-secondary border border-edge rounded">
        <AlertCircle className="h-5 w-5 text-red-500" />
        <div className="text-sm text-content">
          <div className="font-medium">Failed to load image</div>
          <div className="text-xs text-content-muted mt-1">The file may be too large or unavailable</div>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline text-xs mt-1 inline-block"
          >
            Try opening directly
          </a>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative min-h-[100px]">
      {/* Show placeholder until visible */}
      {!isVisible && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-secondary rounded motion-safe:animate-pulse">
          <div className="w-8 h-8 rounded-lg bg-surface-hover" />
        </div>
      )}
      {/* Only load image once visible */}
      {isVisible && (
        <>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-secondary rounded">
              <Loader2 className="h-6 w-6 motion-safe:animate-spin text-content-muted" />
            </div>
          )}
          <img
            src={src}
            alt={alt}
            className={cn(className, loading && 'opacity-0')}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
          />
        </>
      )}
    </div>
  );
});

/**
 * Type guard to check if output is a structured tool response
 * Structured outputs have: kind, version, summary, data
 */
function isStructuredToolOutput(output: unknown): output is {
  kind: string;
  version: number;
  summary: string;
  data: Record<string, unknown>;
} {
  if (!output || typeof output !== 'object') return false;
  const obj = output as Record<string, unknown>;
  return (
    typeof obj.kind === 'string' &&
    typeof obj.version === 'number' &&
    typeof obj.summary === 'string' &&
    obj.data !== undefined
  );
}

/**
 * Try to parse output as structured JSON
 * Returns parsed object if valid structured output, null otherwise
 */
function tryParseStructuredOutput(output: unknown): {
  kind: string;
  version: number;
  summary: string;
  data: Record<string, unknown>;
} | null {
  // Already an object
  if (isStructuredToolOutput(output)) {
    return output;
  }

  // Try parsing JSON string
  if (typeof output === 'string') {
    try {
      const parsed = JSON.parse(output);
      if (isStructuredToolOutput(parsed)) {
        return parsed;
      }
    } catch {
      // Not valid JSON, will fall back to regex parsing
    }
  }

  return null;
}

/**
 * Parse structured tool output directly (fast path)
 */
function parseStructuredOutput(output: { kind: string; data: Record<string, unknown> }) {
  const { kind, data } = output;

  switch (kind) {
    case 'youtube_search_results':
      return { youtubeVideos: (data.videos as YouTubeVideo[]) || [] };
    case 'sec_filing_results':
      return { secDocuments: (data.documents as SECDocument[]) || [] };
    case 'company_selection':
      return { companySelectionData: data as { prompt: string; companies: CompanyOption[] } };
    case 'people_selection':
      return { peopleSelectionData: data as { prompt: string; people: PersonOption[] } };
    case 'event_selection':
      return { eventSelectionData: data as { prompt: string; events: EventOption[] } };
    case 'news_selection':
      return { newsSelectionData: data as { prompt: string; articles: NewsArticleOption[] } };
    default:
      return {};
  }
}

/**
 * Helper to render tool output with markdown support and gallery layout for images, videos, and SEC documents
 * Memoized to prevent expensive regex parsing on every render
 *
 * Performance optimization:
 * 1. Fast path: If output is structured object, parse directly (no regex)
 * 2. Slow path: Fall back to regex parsing for legacy string outputs
 */
const ToolOutputRenderer = React.memo(function ToolOutputRenderer({
  output,
  onCompanySelect,
  onPersonSelect,
  onEventSelect,
  onNewsSelect,
}: {
  output: unknown;
  onCompanySelect?: (company: CompanyOption) => void;
  onPersonSelect?: (person: PersonOption) => void;
  onEventSelect?: (event: EventOption) => void;
  onNewsSelect?: (article: NewsArticleOption) => void;
}) {
  // Memoize the expensive parsing operations
  const parsedData = useMemo(() => {
    // FAST PATH: Try to parse as structured tool output (no regex needed)
    const structuredOutput = tryParseStructuredOutput(output);
    if (structuredOutput) {
      const structured = parseStructuredOutput(structuredOutput);
      const secDocuments = structured.secDocuments || [];

      // Convert SEC documents to FileViewer format
      const fileViewerFiles: FileViewerFile[] = secDocuments.map(doc => ({
        url: doc.viewerUrl || doc.documentUrl,
        fileType: doc.documentUrl.endsWith('.pdf') ? 'pdf' : 'html' as 'pdf' | 'html' | 'txt',
        title: doc.title,
        metadata: {
          formType: doc.formType,
          date: doc.filingDate,
          source: 'SEC EDGAR',
          accessionNumber: doc.accessionNumber,
        },
      }));

      return {
        youtubeVideos: structured.youtubeVideos || [],
        fileViewerFiles,
        companySelectionData: structured.companySelectionData || null,
        peopleSelectionData: structured.peopleSelectionData || null,
        eventSelectionData: structured.eventSelectionData || null,
        newsSelectionData: structured.newsSelectionData || null,
        hasMultipleImages: false,
        imageUrls: [],
        beforeImages: structuredOutput.summary || '',
        restOfContent: '',
      };
    }

    // SLOW PATH: Legacy regex parsing for string outputs
    const outputText = typeof output === 'string' ? output : JSON.stringify(output, null, 2);

    // Single-pass extraction of all embedded data blocks
    // Pattern matches: <!-- TYPE_DATA\n{json}\n-->
    const DATA_BLOCK_PATTERN = /<!-- (\w+)_DATA\n([\s\S]*?)\n-->/g;
    const extractedData: Record<string, string> = {};
    let match;
    while ((match = DATA_BLOCK_PATTERN.exec(outputText)) !== null) {
      extractedData[match[1]] = match[2];
    }

    // Parse extracted data with safe JSON parsing
    const safeParse = <T,>(key: string): T | null => {
      try {
        return extractedData[key] ? JSON.parse(extractedData[key]) : null;
      } catch {
        return null;
      }
    };

    const youtubeVideos: YouTubeVideo[] = safeParse('YOUTUBE_GALLERY') || [];
    const secDocuments: SECDocument[] = safeParse('SEC_GALLERY') || [];

    // Convert SEC documents to FileViewer format
    const fileViewerFiles: FileViewerFile[] = secDocuments.map(doc => ({
      url: doc.viewerUrl || doc.documentUrl,
      fileType: doc.documentUrl.endsWith('.pdf') ? 'pdf' : 'html' as 'pdf' | 'html' | 'txt',
      title: doc.title,
      metadata: {
        formType: doc.formType,
        date: doc.filingDate,
        source: 'SEC EDGAR',
        accessionNumber: doc.accessionNumber,
      },
    }));

    const companySelectionData = safeParse<{ prompt: string; companies: CompanyOption[] }>('COMPANY_SELECTION');
    const peopleSelectionData = safeParse<{ prompt: string; people: PersonOption[] }>('PEOPLE_SELECTION');
    const eventSelectionData = safeParse<{ prompt: string; events: EventOption[] }>('EVENT_SELECTION');
    const newsSelectionData = safeParse<{ prompt: string; articles: NewsArticleOption[] }>('NEWS_SELECTION');

    // Single-pass image extraction with combined regex
    const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const imageUrls: { url: string; alt: string }[] = [];
    let imgMatch;
    while ((imgMatch = IMAGE_PATTERN.exec(outputText)) !== null) {
      imageUrls.push({ alt: imgMatch[1] || 'Image', url: imgMatch[2] });
    }
    const hasMultipleImages = imageUrls.length > 2;

    // Single replace to remove all data blocks
    const cleanedContent = outputText.replace(/<!-- \w+_DATA\n[\s\S]*?\n-->\n*/g, '');

    // Split content to separate images section from rest
    const parts = cleanedContent.split(/## Images\s*\n*/);
    const beforeImages = parts[0];
    const afterImages = parts[1]?.split(/##/);
    const restOfContent = afterImages ? '##' + afterImages.slice(1).join('##') : '';

    return {
      youtubeVideos,
      fileViewerFiles,
      companySelectionData,
      peopleSelectionData,
      eventSelectionData,
      newsSelectionData,
      hasMultipleImages,
      imageUrls,
      beforeImages,
      restOfContent,
    };
  }, [output]);

  const {
    youtubeVideos,
    fileViewerFiles,
    companySelectionData,
    peopleSelectionData,
    eventSelectionData,
    newsSelectionData,
    hasMultipleImages,
    imageUrls,
    beforeImages,
    restOfContent,
  } = parsedData;

  return (
    <div className="text-xs text-content-secondary mt-1 space-y-2">
      {/* Render company selection prompt */}
      {companySelectionData && onCompanySelect && (
        <CompanySelectionCard
          prompt={companySelectionData.prompt}
          companies={companySelectionData.companies}
          onSelect={onCompanySelect}
        />
      )}

      {/* Render people selection prompt */}
      {peopleSelectionData && onPersonSelect && (
        <PeopleSelectionCard
          prompt={peopleSelectionData.prompt}
          people={peopleSelectionData.people}
          onSelect={onPersonSelect}
        />
      )}

      {/* Render event selection prompt */}
      {eventSelectionData && onEventSelect && (
        <EventSelectionCard
          prompt={eventSelectionData.prompt}
          events={eventSelectionData.events}
          onSelect={onEventSelect}
        />
      )}

      {/* Render news selection prompt */}
      {newsSelectionData && onNewsSelect && (
        <NewsSelectionCard
          prompt={newsSelectionData.prompt}
          articles={newsSelectionData.articles}
          onSelect={onNewsSelect}
        />
      )}

      {/* Render YouTube gallery (lazy-loaded) */}
      {youtubeVideos.length > 0 && (
        <Suspense fallback={<div className="motion-safe:animate-pulse h-32 bg-surface-secondary rounded-lg" />}>
          <YouTubeGallery videos={youtubeVideos} />
        </Suspense>
      )}

      {/* Render FileViewer for SEC documents (lazy-loaded) */}
      {fileViewerFiles.length > 0 && (
        <Suspense fallback={<div className="motion-safe:animate-pulse h-24 bg-surface-secondary rounded-lg" />}>
          <FileViewer files={fileViewerFiles} />
        </Suspense>
      )}

      {/* Render content before images */}
      {beforeImages && (
        <ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]}>
          {beforeImages}
        </ReactMarkdown>
      )}

      {/* Render images gallery */}
      {hasMultipleImages && imageUrls.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-content mt-3 mb-2">
            Images
            <span className="text-xs font-normal text-content-muted ml-2">
              (scroll to see all)
            </span>
          </h2>
          <div className="flex overflow-x-auto gap-3 pb-2 scrollbar-thin scrollbar-thumb-edge scrollbar-track-surface-secondary" style={{ scrollbarWidth: 'thin' }}>
            {imageUrls.map((img, idx) => (
              <div key={idx} className="flex-shrink-0">
                <SafeImage
                  src={img.url}
                  alt={img.alt}
                  className="h-48 w-auto rounded-lg border border-edge cursor-pointer transition-shadow"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Render rest of content */}
      {restOfContent && (
        <ReactMarkdown
          rehypePlugins={[rehypeRaw, rehypeSanitize]}
          components={{
            // Style links
            a: ({ node, ...props }) => (
              <a
                {...props}
                className="text-blue-600 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
            // Style headings
            h2: ({ node, ...props }) => (
              <h2 {...props} className="text-sm font-semibold text-content mt-3 mb-2" />
            ),
            // Style paragraphs
            p: ({ node, ...props }) => (
              <p {...props} className="text-xs text-content-secondary mb-2" />
            ),
            // Style videos
            video: ({ node, ...props }) => (
              <video
                {...props}
                className="max-w-full h-auto rounded-lg border border-edge my-2"
                style={{ maxHeight: '300px' }}
              />
            ),
            // Style audio
            audio: ({ node, ...props }) => (
              <audio {...props} className="w-full my-2" />
            ),
          }}
        >
          {restOfContent}
        </ReactMarkdown>
      )}
    </div>
  );
});

/**
 * FileTextPreview - Shows a preview of text file contents
 * Memoized to prevent re-fetching when parent updates
 */
const FileTextPreview = React.memo(function FileTextPreview({ fileUrl, fileName }: { fileUrl: string; fileName: string }) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    const fetchContent = async () => {
      try {
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error('Failed to fetch file');
        const text = await response.text();
        setContent(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file');
      } finally {
        setLoading(false);
      }
    };
    void fetchContent();
  }, [fileUrl]);

  return (
    <div className="flex flex-col">
      {/* Text File Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-4 py-3 bg-gradient-to-r from-blue-50 to-surface dark:from-blue-900/20 dark:to-surface flex items-center gap-3 border-b border-edge hover:from-blue-100 dark:hover:from-blue-900/30 transition-colors"
      >
        <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300">
          <ImageIcon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="text-sm font-medium text-content truncate">
            {fileName}
          </div>
          <p className="text-xs text-content-muted mt-0.5">Text File</p>
        </div>
        <div className="text-xs text-content-muted">
          {isExpanded ? 'Collapse' : 'Expand'}
        </div>
      </button>
      {/* Text Preview */}
      {isExpanded && (
        <div className="bg-surface-secondary p-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-content-secondary">
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
              <span>Loading file content...</span>
            </div>
          ) : error ? (
            <div className="text-sm text-red-600">
              {error}
            </div>
          ) : (
            <pre className="text-xs bg-surface p-3 rounded border border-edge overflow-x-auto max-h-96 overflow-y-auto">
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
});

// Agent role icons and labels
const agentRoleConfig = {
  coordinator: { icon: '🎯', label: 'Coordinator', color: 'purple' },
  documentAgent: { icon: '📄', label: 'Document Agent', color: 'blue' },
  mediaAgent: { icon: '🎥', label: 'Media Agent', color: 'pink' },
  secAgent: { icon: '📊', label: 'SEC Agent', color: 'green' },
  webAgent: { icon: '🌐', label: 'Web Agent', color: 'cyan' },
};

/**
 * ToolStepsAccordion - Claude-style collapsible "Researching..." block
 * Groups all tool calls under one expandable section.
 * Auto-expands during streaming, auto-collapses when done.
 */
const ToolStepsAccordion = React.memo(function ToolStepsAccordion({
  children,
  toolCount,
  completedCount,
  isStreaming,
}: {
  children: React.ReactNode;
  toolCount: number;
  completedCount: number;
  isStreaming: boolean;
}) {
  const [userToggled, setUserToggled] = useState(false);
  const [userWantsOpen, setUserWantsOpen] = useState(false);
  const prevStreamingRef = useRef(isStreaming);

  const isExpanded = userToggled ? userWantsOpen : isStreaming;

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      setUserToggled(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const handleToggle = () => {
    setUserToggled(true);
    setUserWantsOpen(!isExpanded);
  };

  const allDone = completedCount >= toolCount && !isStreaming;
  const label = isStreaming
    ? `Researching... (${completedCount}/${toolCount} steps)`
    : `Used ${toolCount} tool${toolCount !== 1 ? 's' : ''}`;

  return (
    <div className="mb-3 border border-edge rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full px-3 py-2 flex items-center gap-2 text-xs font-medium text-content-secondary hover:bg-surface-secondary transition-colors bg-surface-secondary"
      >
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-content-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-content-muted" />}
        <Wrench className={cn(
          "w-3.5 h-3.5",
          isStreaming ? "text-violet-500 motion-safe:animate-pulse" : "text-content-muted"
        )} />
        <span>{label}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-content-muted font-normal">
          {isStreaming ? (
            <Loader2 className="w-3 h-3 motion-safe:animate-spin" />
          ) : allDone ? (
            <CheckCircle2 className="w-3 h-3 text-green-500" />
          ) : null}
        </span>
      </button>

      {isExpanded && (
        <div className="px-3 py-2.5 border-t border-edge bg-surface max-h-96 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
});

/**
 * ThinkingAccordion - Claude-style collapsible thinking block
 * Auto-expands during streaming, auto-collapses when done.
 * Shows word count and duration indicator.
 */
const ThinkingAccordion = React.memo(function ThinkingAccordion({
  reasoning,
  isStreaming
}: {
  reasoning: string;
  isStreaming: boolean;
}) {
  const [userToggled, setUserToggled] = useState(false);
  const [userWantsOpen, setUserWantsOpen] = useState(false);
  const prevStreamingRef = useRef(isStreaming);
  const reducedMotion = useReducedMotion();

  // Auto-expand during streaming, auto-collapse when done (Claude pattern)
  const isExpanded = userToggled ? userWantsOpen : isStreaming;

  // Detect streaming → done transition to reset user toggle
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      // Streaming just finished — auto-collapse unless user opened it
      setUserToggled(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  if (!reasoning) return null;

  const wordCount = reasoning.split(/\s+/).filter(Boolean).length;

  return (
    <AIReasoning
      className="group/reasoning mb-3 overflow-hidden rounded-lg border border-edge"
      isStreaming={isStreaming}
      onOpenChange={(open) => {
        setUserToggled(true);
        setUserWantsOpen(open);
      }}
      open={isExpanded}
    >
      <AIReasoningTrigger
        className="w-full bg-surface-secondary px-3 py-2 text-xs font-medium text-content-secondary hover:bg-surface-secondary motion-reduce:transition-none"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 text-content-muted transition-transform motion-reduce:transition-none", !isExpanded && "-rotate-90")} />
        <BrainCircuit className={cn(
          "w-3.5 h-3.5",
          isStreaming ? "text-purple-500" : "text-content-muted",
          isStreaming && !reducedMotion && "motion-safe:animate-pulse",
        )} />
        <span>{isStreaming ? 'Thinking...' : 'Thought process'}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-content-muted font-normal">
          {isStreaming ? (
            <Loader2 className={cn("h-3 w-3", !reducedMotion && "motion-safe:animate-spin")} />
          ) : (
            <span className="tabular-nums">{wordCount} words</span>
          )}
        </span>
      </AIReasoningTrigger>
      <AIReasoningContent className="mt-0 max-h-64 overflow-y-auto border-t border-edge bg-surface px-3 py-2.5 text-[13px] leading-relaxed motion-reduce:animate-none">
        {reasoning}
      </AIReasoningContent>
    </AIReasoning>
  );
});

/**
 * RunCodeButton - In-browser JS/TS code execution with sandboxed eval
 */
const RunCodeButton = React.memo(function RunCodeButton({ code, language }: { code: string; language: string }) {
  const [output, setOutput] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const runCode = useCallback(() => {
    setIsRunning(true);
    setOutput(null);
    const logs: string[] = [];
    const fakeConsole = {
      log: (...args: any[]) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')),
      error: (...args: any[]) => logs.push('[ERROR] ' + args.map(a => String(a)).join(' ')),
      warn: (...args: any[]) => logs.push('[WARN] ' + args.map(a => String(a)).join(' ')),
    };
    try {
      const fn = new Function('console', code);
      const result = fn(fakeConsole);
      if (result !== undefined && logs.length === 0) logs.push(String(result));
      setOutput(logs.join('\n') || '(no output)');
    } catch (err: any) {
      setOutput(`Error: ${err.message}`);
    }
    setIsRunning(false);
  }, [code]);

  return (
    <>
      <button
        type="button"
        onClick={runCode}
        className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 transition-colors"
        disabled={isRunning}
      >
        {isRunning ? '⏳' : '▶'} Run
      </button>
      {output !== null && (
        <div className="absolute left-0 right-0 top-full z-50 mx-3 mt-1 rounded-lg border border-edge bg-gray-900 text-green-400 text-xs font-mono p-2 max-h-[120px] overflow-auto shadow-xl whitespace-pre-wrap">
          {output}
        </div>
      )}
    </>
  );
});

/**
 * CodeBlockWithCopy - Code block with language label and copy button (Claude/ChatGPT pattern)
 */
const CodeBlockWithCopy = React.memo(function CodeBlockWithCopy({
  language,
  children,
}: {
  language: string;
  children: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="relative group/code rounded-lg overflow-hidden border border-edge my-3">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-secondary border-b border-edge">
        <span className="text-xs font-mono text-content-muted">{language}</span>
        <div className="flex items-center gap-2 opacity-0 group-hover/code:opacity-100 transition-opacity">
          {['html', 'svg', 'jsx', 'tsx', 'css'].includes(language) && (
            <button
              type="button"
              onClick={() => {
                const type = (language === 'svg' ? 'svg' : language === 'html' ? 'html' : 'code') as 'html' | 'svg' | 'code';
                window.dispatchEvent(new CustomEvent('fa-open-artifact', { detail: { type, content: children, language } }));
              }}
              className="flex items-center gap-1 text-xs text-violet-500 hover:text-violet-600 transition-colors"
            >
              <ExternalLink className="w-3 h-3" /> Canvas
            </button>
          )}
          {['javascript', 'js', 'typescript', 'ts'].includes(language) && (
            <RunCodeButton code={children} language={language} />
          )}
          <button
            type="button"
            onClick={() => { void handleCopy(); }}
            className="flex items-center gap-1 text-xs text-content-muted hover:text-content transition-colors"
          >
            {copied ? (
              <><Check className="w-3 h-3 text-green-500" /> Copied</>
            ) : (
              <><Copy className="w-3 h-3" /> Copy</>
            )}
          </button>
        </div>
      </div>
      <LazySyntaxHighlighter language={language} PreTag="div">
        {children}
      </LazySyntaxHighlighter>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// FUSION SEARCH RESULT PARSING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Current supported version of the FusionSearchPayload schema.
 * Must match FUSION_SEARCH_PAYLOAD_VERSION from backend.
 */
const SUPPORTED_PAYLOAD_VERSION = 1;

/**
 * Parsed result from fusion search tool output.
 * Includes validation status and error details for debugging.
 */
interface ParsedFusionSearchResult {
  results: FusedResult[];
  sourcesQueried: SearchSource[];
  errors: SourceError[];
  timing: Record<SearchSource, number>;
  totalTimeMs: number;
  /** Whether parsing succeeded with valid versioned payload */
  isValid: boolean;
  /** Parse error message if isValid is false */
  parseError?: string;
  /** Schema version of the parsed payload */
  payloadVersion?: number;
  /** Whether legacy fallback was used (for observability) */
  usedLegacyFallback?: boolean;
}

/**
 * Structured event for observability logging.
 * Used to track legacy payload fallback usage.
 */
interface FusionPayloadEvent {
  event: 'fusion_payload_legacy_fallback' | 'fusion_payload_parse_error' | 'fusion_payload_success';
  toolName?: string;
  source: 'versioned' | 'legacy' | 'unknown';
  shapeSignature: string;
  payloadVersion?: number;
  error?: string;
  timestamp: string;
}

/**
 * Log structured observability event for fusion payload parsing.
 * Does NOT log payload content (PII risk).
 * Note: Disabled in production for performance
 */
function logFusionPayloadEvent(_event: FusionPayloadEvent): void {
  // Disabled for performance - enable only for debugging
  // console.info(`[FusionPayload] ${event.event}`, {
  //   ...event,
  //   _note: 'Payload content intentionally omitted for PII safety',
  // });
}

/**
 * Check if a tool name is a fusion search tool.
 * Used to determine render precedence for fusion results.
 */
function isFusionSearchTool(toolName: string | undefined): boolean {
  if (!toolName) return false;
  return toolName === 'fusionSearch' ||
    toolName === 'quickSearch' ||
    toolName.includes('fusion') && toolName.includes('Search');
}

function formatCitationDateOnly(input?: string): string | null {
  if (!input) return null;
  const ms = Date.parse(input);
  if (!Number.isFinite(ms)) return input;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(ms);
}

function formatCitationDateTime(input?: string): string | null {
  if (!input) return null;
  const ms = Date.parse(input);
  if (!Number.isFinite(ms)) return input;
  return formatBriefDateTime(ms);
}

/** Extract domain from URL for display (e.g., "wired.com" from "https://www.wired.com/story/...") */
function extractDomain(url?: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Format time ago like X.com (e.g., "5m", "2h", "3d") */
function formatTimeAgo(timestamp?: string | number): string {
  if (!timestamp) return '';
  const ms = typeof timestamp === 'string' ? Date.parse(timestamp) : timestamp;
  if (!Number.isFinite(ms)) return '';

  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;

  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Get source config based on citation type */
function getSourceConfig(type: string): { icon: typeof Globe; color: string; bg: string } {
  switch (type.toLowerCase()) {
    case 'news':
      return { icon: Zap, color: 'text-orange-400', bg: 'bg-orange-500/20' };
    case 'academic':
    case 'arxiv':
      return { icon: BrainCircuit, color: 'text-purple-400', bg: 'bg-purple-500/20' };
    default:
      return { icon: Globe, color: 'text-violet-400', bg: 'bg-violet-500/20' };
  }
}

function SourcesCitedDropdown({ library, basisMs }: { library: CitationLibrary; basisMs?: number }) {
  const citations = getOrderedCitations(library);
  if (citations.length === 0) return null;

  const asOf = typeof basisMs === 'number' && Number.isFinite(basisMs) ? formatTimeAgo(basisMs) : null;

  return (
    <details className="mt-4 group rounded-lg border border-slate-200 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/30 overflow-hidden">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center">
            <Globe className="h-4 w-4 text-violet-400" />
          </div>
          <div>
            <span className="block">Sources</span>
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              {citations.length} cited {asOf && `· ${asOf}`}
            </span>
          </div>
        </div>
        <ChevronDown className="h-4 w-4 text-slate-400 group-open:rotate-180 transition-transform duration-200" />
      </summary>

      <div className="border-t border-slate-200 dark:border-slate-700/50">
        {/* Citation list */}
        {citations.map((c, index) => {
          const domain = extractDomain(c.url);
          const config = getSourceConfig(c.type);
          const SourceIcon = config.icon;
          const timeAgo = formatTimeAgo(c.publishedAt);

          return (
            <a
              key={c.id}
              href={c.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "flex items-start gap-3 px-4 py-3 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors group/item cursor-pointer",
                index !== citations.length - 1 && "border-b border-slate-200 dark:border-slate-700/50"
              )}
            >
              {/* Source icon */}
              <div className={cn("w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ring-2 ring-slate-200 dark:ring-slate-700", config.bg)}>
                <SourceIcon className={cn("w-5 h-5", config.color)} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                {/* Header row */}
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={cn("text-sm font-semibold", config.color)}>
                    {domain || c.type}
                  </span>
                  <span className="text-slate-500 dark:text-slate-600">·</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{timeAgo || 'recently'}</span>
                  <span className="ml-auto text-xs font-medium text-slate-400 dark:text-slate-500 bg-slate-200 dark:bg-slate-700/50 px-1.5 py-0.5 rounded">
                    [{c.number}]
                  </span>
                </div>

                {/* Title */}
                <h4 className="text-[15px] font-medium text-slate-800 dark:text-slate-200 leading-snug mb-1 group-hover/item:text-violet-500 dark:group-hover/item:text-violet-400 transition-colors line-clamp-2">
                  {c.label}
                </h4>

                {/* Snippet */}
                {c.fullText && (
                  <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">
                    {c.fullText}
                  </p>
                )}
              </div>
            </a>
          );
        })}
      </div>
    </details>
  );
}

/**
 * Valid search sources for validation.
 */
const VALID_SEARCH_SOURCES = ['linkup', 'sec', 'rag', 'documents', 'news', 'youtube', 'arxiv'] as const;

/**
 * Parse fusion search tool output into structured data for FusedSearchResults component.
 *
 * Supports two payload formats:
 * 1. Versioned FusionSearchPayload (preferred): { kind, version, payload, generatedAt }
 * 2. Legacy SearchResponse (fallback): { results, mode, sourcesQueried, ... }
 *
 * Contract Enforcement:
 * - Versioned payloads are validated strictly with clear error messages
 * - Legacy payloads are supported for backward compatibility but logged
 * - Invalid payloads return isValid=false with parseError details
 */
function parseFusionSearchOutput(output: unknown, toolName?: string): ParsedFusionSearchResult {
  const emptyResult: ParsedFusionSearchResult = {
    results: [],
    sourcesQueried: [],
    errors: [],
    timing: {} as Record<SearchSource, number>,
    totalTimeMs: 0,
    isValid: false,
  };

  /**
   * Helper to compute shape signature for observability (no PII)
   */
  const getShapeSignature = (obj: Record<string, unknown>): string => {
    const keys = Object.keys(obj).sort().slice(0, 5);
    return `{${keys.join(',')}}`;
  };

  if (!output) {
    logFusionPayloadEvent({
      event: 'fusion_payload_parse_error',
      toolName,
      source: 'unknown',
      shapeSignature: 'null',
      error: 'Output is null or undefined',
      timestamp: new Date().toISOString(),
    });
    return { ...emptyResult, parseError: 'Output is null or undefined' };
  }

  try {
    // Handle string output (embedded JSON in HTML comment)
    if (typeof output === 'string') {
      const jsonMatch = output.match(/<!-- FUSION_SEARCH_DATA\n([\s\S]*?)\n-->/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          return parseFusionSearchOutput(parsed, toolName);
        } catch (jsonErr) {
          logFusionPayloadEvent({
            event: 'fusion_payload_parse_error',
            toolName,
            source: 'unknown',
            shapeSignature: 'embedded-json-parse-error',
            error: `Failed to parse embedded JSON: ${jsonErr}`,
            timestamp: new Date().toISOString(),
          });
          return { ...emptyResult, parseError: `Failed to parse embedded JSON: ${jsonErr}` };
        }
      }
      return { ...emptyResult, parseError: 'String output without embedded FUSION_SEARCH_DATA marker' };
    }

    if (typeof output !== 'object') {
      logFusionPayloadEvent({
        event: 'fusion_payload_parse_error',
        toolName,
        source: 'unknown',
        shapeSignature: typeof output,
        error: `Invalid output type: ${typeof output}`,
        timestamp: new Date().toISOString(),
      });
      return { ...emptyResult, parseError: `Invalid output type: ${typeof output}` };
    }

    const data = output as Record<string, unknown>;
    const shapeSignature = getShapeSignature(data);

    // ═══════════════════════════════════════════════════════════════════════
    // VERSIONED PAYLOAD VALIDATION (preferred path)
    // ═══════════════════════════════════════════════════════════════════════
    if (data.kind === 'fusion_search_results') {
      // Validate version
      if (typeof data.version !== 'number') {
        logFusionPayloadEvent({
          event: 'fusion_payload_parse_error',
          toolName,
          source: 'versioned',
          shapeSignature,
          error: `Invalid version type: ${typeof data.version}`,
          timestamp: new Date().toISOString(),
        });
        return { ...emptyResult, parseError: `Invalid version type: ${typeof data.version}` };
      }

      if (data.version > SUPPORTED_PAYLOAD_VERSION) {
        logFusionPayloadEvent({
          event: 'fusion_payload_parse_error',
          toolName,
          source: 'versioned',
          shapeSignature,
          payloadVersion: data.version,
          error: `Unsupported payload version: ${data.version}`,
          timestamp: new Date().toISOString(),
        });
        return {
          ...emptyResult,
          parseError: `Unsupported payload version: ${data.version} (max supported: ${SUPPORTED_PAYLOAD_VERSION})`,
          payloadVersion: data.version,
        };
      }

      // Extract payload
      if (!data.payload || typeof data.payload !== 'object') {
        logFusionPayloadEvent({
          event: 'fusion_payload_parse_error',
          toolName,
          source: 'versioned',
          shapeSignature,
          payloadVersion: data.version,
          error: 'Missing or invalid payload field',
          timestamp: new Date().toISOString(),
        });
        return { ...emptyResult, parseError: 'Missing or invalid payload field' };
      }

      const payload = data.payload as Record<string, unknown>;
      const result = parseSearchResponsePayload(payload, data.version);

      // Log success for versioned payload
      if (result.isValid) {
        logFusionPayloadEvent({
          event: 'fusion_payload_success',
          toolName,
          source: 'versioned',
          shapeSignature,
          payloadVersion: data.version,
          timestamp: new Date().toISOString(),
        });
      }

      return result;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LEGACY PAYLOAD FALLBACK (for backward compatibility)
    // ═══════════════════════════════════════════════════════════════════════
    if (Array.isArray(data.results)) {
      // Log legacy fallback event (structured for observability)
      logFusionPayloadEvent({
        event: 'fusion_payload_legacy_fallback',
        toolName,
        source: 'legacy',
        shapeSignature,
        timestamp: new Date().toISOString(),
      });

      const result = parseSearchResponsePayload(data, undefined);
      return { ...result, usedLegacyFallback: true };
    }

    logFusionPayloadEvent({
      event: 'fusion_payload_parse_error',
      toolName,
      source: 'unknown',
      shapeSignature,
      error: 'Unknown payload structure: missing kind or results',
      timestamp: new Date().toISOString(),
    });
    return { ...emptyResult, parseError: 'Unknown payload structure: missing kind or results' };

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logFusionPayloadEvent({
      event: 'fusion_payload_parse_error',
      toolName,
      source: 'unknown',
      shapeSignature: 'exception',
      error: errorMsg,
      timestamp: new Date().toISOString(),
    });
    // NOTE: Do NOT log `e` directly as it may contain payload content (PII risk)
    console.error('[parseFusionSearchOutput] Unexpected error (details omitted for PII safety)');
    return { ...emptyResult, parseError: `Unexpected error: ${errorMsg}` };
  }
}

/**
 * Parse the inner SearchResponse payload (shared by versioned and legacy paths).
 */
function parseSearchResponsePayload(
  data: Record<string, unknown>,
  version: number | undefined
): ParsedFusionSearchResult {
  const emptyResult: ParsedFusionSearchResult = {
    results: [],
    sourcesQueried: [],
    errors: [],
    timing: {} as Record<SearchSource, number>,
    totalTimeMs: 0,
    isValid: false,
    payloadVersion: version,
  };

  // Validate results array
  if (!Array.isArray(data.results)) {
    return { ...emptyResult, parseError: 'payload.results is not an array' };
  }

  // Parse results with validation
  const results: FusedResult[] = [];
  for (let idx = 0; idx < data.results.length; idx++) {
    const r = data.results[idx] as Record<string, unknown>;

    // Validate source is known (silently fallback to defaults for performance)
    const source = String(r.source || 'linkup');

    results.push({
      id: String(r.id || `result-${idx}`),
      source: source as SearchSource,
      title: String(r.title || 'Untitled'),
      snippet: String(r.snippet || ''),
      url: r.url ? String(r.url) : undefined,
      score: Number(r.score || 0),
      originalRank: Number(r.originalRank || idx + 1),
      fusedRank: r.fusedRank ? Number(r.fusedRank) : undefined,
      contentType: (r.contentType || 'text') as FusedResult['contentType'],
      publishedAt: r.publishedAt ? String(r.publishedAt) : undefined,
      author: r.author ? String(r.author) : undefined,
      metadata: r.metadata as Record<string, unknown> | undefined,
    });
  }

  // Parse sourcesQueried
  const sourcesQueried: SearchSource[] = Array.isArray(data.sourcesQueried)
    ? (data.sourcesQueried as string[]).filter(s => VALID_SEARCH_SOURCES.includes(s as SearchSource)) as SearchSource[]
    : [...new Set(results.map(r => r.source))];

  // Parse errors
  const errors: SourceError[] = Array.isArray(data.errors)
    ? (data.errors as Array<{ source: string; error: string }>).map(e => ({
      source: e.source as SearchSource,
      error: String(e.error),
    }))
    : [];

  const timing = (data.timing || {}) as Record<SearchSource, number>;
  const totalTimeMs = Number(data.totalTimeMs || 0);

  return {
    results,
    sourcesQueried,
    errors,
    timing,
    totalTimeMs,
    isValid: results.length > 0,
    payloadVersion: version,
  };
}

/**
 * ToolStep - Renders a single tool call as a structured step with timeline
 */
type ToolRenderPart = Extract<ConvexUIRenderPart, { kind: 'tool' | 'domain-tool' }>;
type TextRenderPart = Extract<ConvexUIRenderPart, { kind: 'text' }>;
type ReasoningRenderPart = Extract<ConvexUIRenderPart, { kind: 'reasoning' }>;
type DomainRenderPart = Extract<ConvexUIRenderPart, { kind: 'domain' }>;
type ArbitrageReportData = React.ComponentProps<typeof ArbitrageReportCard>['data'];
type ToolOwnerRoute =
  | 'goal-card'
  | 'fused-search'
  | 'memory-pill'
  | 'convex-transparency'
  | 'grouped-custom'
  | 'tool-step';

interface RoutedToolOwner {
  entry: ToolRenderPart;
  route: ToolOwnerRoute;
  fusedSearch?: ReturnType<typeof parseFusionSearchOutput>;
}

function isToolRenderPart(part: ConvexUIRenderPart): part is ToolRenderPart {
  return part.kind === 'tool' || part.kind === 'domain-tool';
}

function getDomainPayload(part: DomainRenderPart['part']): unknown {
  const record = part as Record<string, unknown>;
  return record.output ?? record.result ?? record.data ?? record.value ?? record;
}

function getStandaloneStructuredOutput(entry: DomainRenderPart): unknown {
  const payload = getDomainPayload(entry.part);
  if (tryParseStructuredOutput(payload)) return payload;

  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const data = payload as Record<string, unknown>;
  const normalizedType = entry.part.type.toLowerCase().replace(/[-_]/g, '');
  const kind = entry.categories.includes('selection')
    ? Array.isArray(data.companies) || normalizedType.includes('companyselection')
      ? 'company_selection'
      : Array.isArray(data.people) || normalizedType.includes('peopleselection')
        ? 'people_selection'
        : Array.isArray(data.events) || normalizedType.includes('eventselection')
          ? 'event_selection'
          : Array.isArray(data.articles) || normalizedType.includes('newsselection')
            ? 'news_selection'
            : null
    : entry.categories.includes('media')
      ? Array.isArray(data.videos)
        ? 'youtube_search_results'
        : Array.isArray(data.documents)
          ? 'sec_filing_results'
          : null
      : null;

  if (!kind) return payload;
  return {
    kind,
    version: 1,
    summary: typeof data.summary === 'string' ? data.summary : '',
    data,
  };
}

function distributeVisibleParts<
  T extends TextRenderPart | ReasoningRenderPart,
>(
  visible: string | undefined,
  entries: T[],
  separator = '',
): Map<number, string> {
  const distributed = new Map<number, string>();
  let cursor = 0;
  const materialized = visible ?? '';

  entries.forEach((entry, index) => {
    const rawLength = entry.part.text.length;
    const isLast = index === entries.length - 1;
    const end = isLast ? materialized.length : Math.min(cursor + rawLength, materialized.length);
    distributed.set(entry.originalIndex, materialized.slice(cursor, end));
    cursor = isLast
      ? end
      : Math.min(end + separator.length, materialized.length);
  });

  return distributed;
}

function getNormalizedToolName(part: NormalizedToolPart): string {
  return part.type === 'dynamic-tool'
    ? part.toolName
    : part.type.replace(/^tool-/, '');
}

function isMemoryPlanningToolName(toolName: string): boolean {
  return ['createPlan', 'updatePlanStep', 'writeMemory', 'logEpisodic'].some((name) =>
    toolName.includes(name)
  );
}

function getAvailableToolOutput(part: NormalizedToolPart): unknown {
  return part.state === 'output-available' ? part.output : undefined;
}

function getToolOutputText(part: NormalizedToolPart): string {
  const output = getAvailableToolOutput(part);
  if (typeof output === 'string') return output;
  return output === undefined ? '' : JSON.stringify(output);
}

function getToolMedia(part: NormalizedToolPart): ExtractedMedia {
  return extractMediaFromText(getToolOutputText(part));
}

function getToolDocuments(part: NormalizedToolPart): DocumentAction[] {
  return extractDocumentActions(getToolOutputText(part));
}

function getArbitrageReportData(part: NormalizedToolPart): ArbitrageReportData | null {
  const output = getAvailableToolOutput(part);
  if (output === undefined) return null;

  try {
    const parsed = typeof output === 'string' ? JSON.parse(output) : output;
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    if (
      !('contradictions' in record) &&
      !('rankedSources' in record) &&
      !('deltas' in record) &&
      !('healthResults' in record)
    ) {
      return null;
    }
    return record as ArbitrageReportData;
  } catch {
    return null;
  }
}

function hasGroupedDomainContent(entry: ToolRenderPart): boolean {
  if (entry.kind !== 'domain-tool') return false;

  return (
    (entry.categories.includes('arbitrage') && !!getArbitrageReportData(entry.part)) ||
    (entry.categories.includes('documentAction') && getToolDocuments(entry.part).length > 0) ||
    (entry.categories.includes('media') && hasMedia(getToolMedia(entry.part)))
  );
}

function usesNodeBenchDomainRenderer(output: unknown): boolean {
  const structured = tryParseStructuredOutput(output);
  if (structured) {
    return [
      'youtube_search_results',
      'sec_filing_results',
      'company_selection',
      'people_selection',
      'event_selection',
      'news_selection',
    ].includes(structured.kind);
  }

  return typeof output === 'string' &&
    /<!-- (?:YOUTUBE_GALLERY|SEC_GALLERY|COMPANY_SELECTION|PEOPLE_SELECTION|EVENT_SELECTION|NEWS_SELECTION)_DATA/.test(output);
}

function ToolStep({
  part,
  stepNumber,
  onCompanySelect,
  onPersonSelect,
  onEventSelect,
  onNewsSelect,
  useDomainRenderer = false,
  isLast = false,
  showTimeline = true,
}: {
  part: NormalizedToolPart;
  stepNumber: number;
  onCompanySelect?: (company: CompanyOption) => void;
  onPersonSelect?: (person: PersonOption) => void;
  onEventSelect?: (event: EventOption) => void;
  onNewsSelect?: (article: NewsArticleOption) => void;
  useDomainRenderer?: boolean;
  isLast?: boolean;
  showTimeline?: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const hasOutput = part.state === 'output-available';
  const output = hasOutput ? part.output : undefined;
  const errorText = part.state === 'output-error' ? part.errorText : undefined;
  const toolName = getNormalizedToolName(part);

  // Determine status from the normalized AI SDK v5 state.
  const isComplete = part.state === 'output-available';
  const isError = part.state === 'output-error';
  const isActive = !isComplete && !isError;

  return (
    <div className={cn(
      "relative",
      showTimeline && "pl-8"
    )}>
      {/* Timeline connector */}
      {showTimeline && (
        <>
          {/* Vertical line */}
          {!isLast && (
            <div className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-[var(--border-color)] dark:bg-[var(--border-color)]" />
          )}
          {/* Status circle on the line */}
          <div className={cn(
            "absolute left-1 top-2.5 w-5 h-5 rounded-full border-2 flex items-center justify-center bg-surface dark:bg-surface z-10",
            isActive && "border-violet-500 motion-safe:animate-pulse",
            isComplete && "border-green-500 bg-green-500",
            isError && "border-red-500 bg-red-500"
          )}>
            {isComplete && <Check className="w-3 h-3 text-white" />}
            {isError && <XCircle className="w-2.5 h-2.5 text-white" />}
            {isActive && <div className="w-2 h-2 bg-violet-500 rounded-full" />}
          </div>
        </>
      )}

      {/* AI Elements owns the generic tool disclosure and status semantics. */}
      <AITool className="mb-3 overflow-hidden rounded-lg border-edge bg-surface shadow-sm" data-step-number={stepNumber}>
        {part.type === 'dynamic-tool' ? (
          <AIToolHeader
            className="px-3 py-2.5 motion-reduce:[&_svg]:animate-none"
            state={part.state}
            title={toolName}
            toolName={part.toolName}
            type={part.type}
          />
        ) : (
          <AIToolHeader
            className="px-3 py-2.5 motion-reduce:[&_svg]:animate-none"
            state={part.state}
            title={toolName}
            type={part.type}
          />
        )}
        <AIToolContent className="border-t border-[var(--border-color-light)] bg-surface-secondary/50 px-3 py-2 text-xs motion-reduce:animate-none">
          <AIToolInput input={part.input} />

          {/* Main Output Renderer (Visual) */}
          {hasOutput && useDomainRenderer && usesNodeBenchDomainRenderer(output) ? (
            <div className="mb-2">
              <ToolOutputRenderer
                output={output}
                onCompanySelect={onCompanySelect}
                onPersonSelect={onPersonSelect}
                onEventSelect={onEventSelect}
                onNewsSelect={onNewsSelect}
              />
            </div>
          ) : (
            <AIToolOutput errorText={errorText} output={output} />
          )}

          {/* Collapsible Details (JSON) */}
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1 text-xs text-content-muted hover:text-content transition-colors mt-2"
          >
            {showDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <span>{showDetails ? "Hide Debug Details" : "View Debug Details"}</span>
          </button>

          {showDetails && (
            <div className="mt-2 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
              {/* Arguments */}
              {part.input !== undefined && (
                <div>
                  <div className="font-medium text-content-muted mb-1 text-xs">Input Arguments</div>
                  <pre className="bg-surface p-2 rounded border border-edge overflow-x-auto font-mono text-xs text-content-secondary">
                    {JSON.stringify(part.input, null, 2)}
                  </pre>
                </div>
              )}

              {/* Raw Output */}
              {hasOutput && (
                <div>
                  <div className="font-medium text-content-muted mb-1 text-xs">Raw Output</div>
                  <pre className="bg-surface p-2 rounded border border-edge overflow-x-auto font-mono text-xs text-content-secondary max-h-60">
                    {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </AIToolContent>
      </AITool>
    </div>
  );
}

/**
 * FastAgentUIMessageBubble - Renders a UIMessage with smooth streaming animation
 * Handles all UIMessage part types: text, reasoning, tool calls, files, etc.
 * Supports hierarchical rendering with agent role badges
 */
export function FastAgentUIMessageBubble({
  message,
  onMermaidRetry,
  onRegenerateMessage,
  onDeleteMessage,
  onCompanySelect,
  onPersonSelect,
  onEventSelect,
  onNewsSelect,
  onDocumentSelect,
  onEditMessage,
  isParent,
  isChild,
  agentRole,
  entityEnrichment,
  searchHighlight,
  isBookmarked,
  onToggleBookmark,
  isMessagePinned,
  onTogglePin,
  feedbackVote,
  onFeedback,
  fontSize,
  editDiff,
  isInContext,
  compact = false,
}: FastAgentUIMessageBubbleProps) {
  const uiParts = useMemo(() => convexToUIParts(message), [message]);
  const toolRenderParts = useMemo(
    () => uiParts.renderParts.filter(isToolRenderPart),
    [uiParts.renderParts],
  );
  const toolParts = useMemo(
    () => toolRenderParts.map((entry) => entry.part),
    [toolRenderParts],
  );
  const textRenderParts = useMemo(
    () => uiParts.renderParts.flatMap((entry) => entry.kind === 'text' ? [entry] : []),
    [uiParts.renderParts],
  );
  const reasoningRenderParts = useMemo(
    () => uiParts.renderParts.flatMap((entry) => entry.kind === 'reasoning' ? [entry] : []),
    [uiParts.renderParts],
  );
  const reasoningText = useMemo(
    () => uiParts.renderParts
      .flatMap((entry) => entry.kind === 'reasoning' ? [entry.part.text] : [])
      .join('\n'),
    [uiParts.renderParts],
  );
  const isStreaming = uiParts.isStreaming;
  const isUser = uiParts.from === 'user';
  const routedToolOwners = useMemo<RoutedToolOwner[]>(
    () => toolRenderParts.map((entry) => {
      const { part } = entry;
      const toolName = getNormalizedToolName(part);

      if (
        !isUser && isParent && !isChild &&
        toolName.startsWith('delegateTo')
      ) {
        return { entry, route: 'goal-card' };
      }

      if (part.state === 'output-available' && isFusionSearchTool(toolName)) {
        const fusedSearch = parseFusionSearchOutput(part.output, toolName);
        if (fusedSearch.isValid && fusedSearch.results.length > 0) {
          return { entry, route: 'fused-search', fusedSearch };
        }
      }

      if (isMemoryPlanningToolName(toolName)) {
        return { entry, route: 'memory-pill' };
      }

      if (toolName.startsWith('convex_')) {
        return { entry, route: 'convex-transparency' };
      }

      if (hasGroupedDomainContent(entry)) {
        return { entry, route: 'grouped-custom' };
      }

      return { entry, route: 'tool-step' };
    }),
    [isChild, isParent, isUser, toolRenderParts],
  );
  const goalToolOwners = useMemo(
    () => routedToolOwners.filter(({ route }) => route === 'goal-card'),
    [routedToolOwners],
  );
  const groupedToolOwners = useMemo(
    () => routedToolOwners.filter(({ route }) => route === 'grouped-custom'),
    [routedToolOwners],
  );
  const routedToolOwnerByEntry = useMemo(
    () => new Map(routedToolOwners.map((owner) => [owner.entry, owner] as const)),
    [routedToolOwners],
  );
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Read-aloud TTS via useVoiceOutput (ElevenLabs → browser SpeechSynthesis fallback)
  const voiceOutput = useVoiceOutput();

  // Message collapse/expand for long messages
  const [isCollapsed, setIsCollapsed] = useState(true);
  const COLLAPSE_THRESHOLD = 1200; // chars (~300 words)

  // Emoji reactions
  const [emojiReaction, setEmojiReaction] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const QUICK_EMOJIS = ['👍', '❤️', '🔥', '💡', '🎯', '👀'];

  // Smart actions menu
  const [showSmartActions, setShowSmartActions] = useState(false);

  // Markdown raw/rendered toggle
  const [showRawMarkdown, setShowRawMarkdown] = useState(false);

  // Text selection toolbar
  const [selectionToolbar, setSelectionToolbar] = useState<{ x: number; y: number; text: string } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Streaming token counter
  const streamStartRef = useRef<number | null>(null);
  const [streamTokPerSec, setStreamTokPerSec] = useState<number>(0);

  useEffect(() => {
    if (isStreaming) {
      if (!streamStartRef.current) streamStartRef.current = Date.now();
    } else {
      streamStartRef.current = null;
      setStreamTokPerSec(0);
    }
  }, [isStreaming]);

  // Note: streaming tok/s effect uses streamTextRef updated after visibleText
  const streamTextLenRef = useRef(0);

  // Text selection toolbar handler
  useEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const handleMouseUp = () => {
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 2 && el.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const parentRect = el.getBoundingClientRect();
        setSelectionToolbar({
          x: rect.left - parentRect.left + rect.width / 2,
          y: rect.top - parentRect.top - 8,
          text: sel.toString().trim(),
        });
      } else {
        setSelectionToolbar(null);
      }
    };
    const handleMouseDown = () => setSelectionToolbar(null);
    el.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      el.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  // Get handlers from context (stable references) with prop fallback
  const contextHandlers = useMessageHandlers();
  const effectiveOnCompanySelect = onCompanySelect ?? contextHandlers.onCompanySelect;
  const effectiveOnPersonSelect = onPersonSelect ?? contextHandlers.onPersonSelect;
  const effectiveOnEventSelect = onEventSelect ?? contextHandlers.onEventSelect;
  const effectiveOnNewsSelect = onNewsSelect ?? contextHandlers.onNewsSelect;
  const effectiveOnDocumentSelect = onDocumentSelect ?? contextHandlers.onDocumentSelect;

  // Get agent role configuration
  const roleConfig = agentRole ? agentRoleConfig[agentRole] : null;

  // Extract message identifiers for context-based handlers
  const messageKey = (message as any).key || (message as any)._id;
  const messageId = (message as any)._id || (message as any).id;

  const handleRegenerate = () => {
    if (isRegenerating) return;
    setIsRegenerating(true);

    // Try prop callback first, then context
    if (onRegenerateMessage) {
      onRegenerateMessage();
    } else if (messageKey && contextHandlers.onRegenerateMessage) {
      contextHandlers.onRegenerateMessage(messageKey);
    }

    // Reset after a delay
    setTimeout(() => setIsRegenerating(false), 2000);
  };

  const handleDelete = () => {
    // Try prop callback first, then context
    if (onDeleteMessage) {
      onDeleteMessage();
    } else if (messageId && contextHandlers.onDeleteMessage) {
      contextHandlers.onDeleteMessage(messageId);
    }
    setShowDeleteConfirm(false);
  };

  const handleStartEdit = () => {
    setEditText(visibleText || uiParts.text || '');
    setIsEditing(true);
    setTimeout(() => editTextareaRef.current?.focus(), 0);
  };

  const handleSaveEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== (visibleText || uiParts.text || '')) {
      onEditMessage?.(trimmed);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditText('');
  };

  const handleCopy = async () => {
    try {
      // Helper function to strip all HTML and markdown formatting
      const stripFormatting = (text: string): string => {
        if (!text) return '';

        // First, decode HTML entities using DOM
        const temp = document.createElement('div');
        temp.innerHTML = text;
        let cleaned = temp.textContent || temp.innerText || '';

        // Remove markdown formatting
        cleaned = cleaned
          .replace(/\*\*([^*]+)\*\*/g, '$1')      // Bold **text**
          .replace(/\*([^*]+)\*/g, '$1')          // Italic *text*
          .replace(/__([^_]+)__/g, '$1')          // Bold __text__
          .replace(/_([^_]+)_/g, '$1')            // Italic _text_
          .replace(/~~([^~]+)~~/g, '$1')          // Strikethrough ~~text~~
          .replace(/`([^`]+)`/g, '$1')            // Inline code `code`
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links [text](url)
          .replace(/^#{1,6}\s+/gm, '')            // Headers # Header
          .replace(/^[-*+]\s+/gm, '')             // Unordered list items
          .replace(/^\d+\.\s+/gm, '')             // Ordered list items
          .replace(/^>\s+/gm, '')                 // Blockquotes
          .replace(/```[\s\S]*?```/g, '')         // Code blocks
          .replace(/`{3,}/g, '');                 // Fence markers

        return cleaned.trim();
      };

      // Extract and clean text
      let copyText = stripFormatting(uiParts.text || '');

      // Add media references if present
      const mediaParts = toolParts.filter((part) =>
        part.state === 'output-available' &&
        ['youtubeSearch', 'searchSecFilings', 'linkupSearch'].includes(getNormalizedToolName(part))
      );

      if (mediaParts && mediaParts.length > 0) {
        copyText += '\n\n--- Media References ---\n';
        for (const part of mediaParts) {
          const toolName = getNormalizedToolName(part);
          copyText += `\n${toolName}:\n`;

          // Try to extract URLs from output
          const output = part.state === 'output-available' ? part.output : undefined;
          if (output && typeof output === 'object' && 'value' in output) {
            const value = (output as any).value;
            if (typeof value === 'string') {
              copyText += stripFormatting(value) + '\n';
            }
          }
        }
      }

      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  // Use smooth text streaming - matches documentation pattern exactly
  const [visibleText] = useSmoothText(uiParts.text, {
    startStreaming: isStreaming,
  });
  const messageTokens = (message as any).tokensUsed as
    | { input: number; output: number }
    | undefined;
  const messageModel =
    typeof (message as any).model === 'string'
      ? ((message as any).model as string)
      : undefined;

  // Read-aloud TTS callback — uses ElevenLabs with browser fallback (must be after visibleText)
  const isSpeaking = voiceOutput.isSpeaking;
  const handleReadAloud = useCallback(() => {
    if (isSpeaking) {
      voiceOutput.stop();
      return;
    }
    const text = visibleText || '';
    if (!text) return;
    void voiceOutput.speak(text);
  }, [isSpeaking, visibleText, voiceOutput]);

  // Streaming tok/s effect (must be after visibleText)
  useEffect(() => {
    if (!isStreaming || !streamStartRef.current) return;
    streamTextLenRef.current = visibleText?.length ?? 0;
    const elapsed = (Date.now() - streamStartRef.current) / 1000;
    if (elapsed > 0.5) {
      setStreamTokPerSec(Math.round(streamTextLenRef.current / 4 / elapsed));
    }
  });

  const [visibleReasoning] = useSmoothText(reasoningText, {
    startStreaming: isStreaming,
  });
  const visibleTextByOriginalIndex = useMemo(
    () => distributeVisibleParts(visibleText, textRenderParts),
    [textRenderParts, visibleText],
  );
  const visibleReasoningByOriginalIndex = useMemo(
    () => distributeVisibleParts(visibleReasoning, reasoningRenderParts, '\n'),
    [reasoningRenderParts, visibleReasoning],
  );
  const streamRuntimeSeconds = streamStartRef.current
    ? (Date.now() - streamStartRef.current) / 1000
    : undefined;

  // Build citation + entity libraries for inline hover parsing (from tool results + final text tokens)
  const { citedCitationLibrary, entityLibrary } = useMemo(() => {
    if (isUser) return { citedCitationLibrary: undefined, entityLibrary: undefined };

    // Parse NodeBench live-feed tool output into deterministic citation records so
    // tokens like `{{cite:feed_1|...}}` can resolve to URLs + published dates.
    function parseLiveFeedToolOutput(text: string): Array<{
      id: string;
      title: string;
      url?: string;
      source?: string;
      publishedAt?: string;
      summary?: string;
    }> {
      const raw = String(text ?? "");
      if (!raw.includes("Latest feed items") && !raw.includes("Top Headlines")) return [];

      const lines = raw.split(/\r?\n/);
      type Item = {
        idx: number;
        title: string;
        url?: string;
        source?: string;
        publishedAt?: string;
        summary?: string;
      };
      const items: Item[] = [];
      let cur: Item | null = null;

      const pushCur = () => {
        if (!cur) return;
        items.push(cur);
        cur = null;
      };

      for (const line of lines) {
        const mIndex = /^\s*(\d+)\.\s+(.*)\s*$/.exec(line);
        if (mIndex) {
          pushCur();
          cur = { idx: Number(mIndex[1]), title: mIndex[2] };
          continue;
        }

        if (!cur) continue;

        const mSource = /^\s*(?:-\s*)?Source:\s*(.*?)\s*(?:\||$)/.exec(line);
        if (mSource && !cur.source) {
          cur.source = mSource[1]?.trim();
        }

        const mPublished = /Published:\s*([^|\n]+)\s*$/.exec(line);
        if (mPublished && !cur.publishedAt) {
          cur.publishedAt = mPublished[1]?.trim();
        }

        const mUrl = /^\s*(?:-\s*)?URL:\s*(\S.*)\s*$/.exec(line);
        if (mUrl && !cur.url) {
          cur.url = mUrl[1]?.trim();
        }

        const mSummary = /^\s*(?:-\s*)?Summary:\s*(\S.*)\s*$/.exec(line);
        if (mSummary && !cur.summary) {
          cur.summary = mSummary[1]?.trim();
        }
      }
      pushCur();

      return items
        .filter((i) => Number.isFinite(i.idx) && i.idx > 0 && Boolean(i.title))
        .map((i) => ({
          id: `feed_${i.idx}`,
          title: i.title,
          url: i.url,
          source: i.source,
          publishedAt: i.publishedAt,
          summary: i.summary,
        }));
    }

    // Many assistant responses include a markdown "Sources Cited" section with real links
    // (e.g. `- [Title](https://...) {{cite:feed_1|Title|type:source}}`).
    // If tool-result parts aren't persisted, this is still enough to make the dropdown titles clickable.
    function parseCitationUrlsFromText(text: string): Map<string, string> {
      const urlById = new Map<string, string>();
      const raw = String(text ?? '');
      if (!raw.includes('{{cite:')) return urlById;

      const extractUrl = (line: string | undefined): string | undefined => {
        const rawLine = String(line ?? '').trim();
        if (!rawLine) return undefined;

        const mUrlLine = /\bURL:\s*(https?:\/\/\S+)\s*$/i.exec(rawLine);
        if (mUrlLine?.[1]) return mUrlLine[1].trim();

        const mMdLink = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/.exec(rawLine);
        if (mMdLink?.[1]) return mMdLink[1].trim();

        const mPlain = /(https?:\/\/\S+)/.exec(rawLine);
        if (mPlain?.[1]) return mPlain[1].trim();
        return undefined;
      };

      const lines = raw.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const citeIds: string[] = [];
        const citeRe = /\{\{cite:([^|}]+)(?:\|([^|}]+))?(?:\|type:([^}]+))?\}\}/g;
        let m: RegExpExecArray | null;
        while ((m = citeRe.exec(line))) {
          if (m[1]) citeIds.push(m[1]);
        }
        if (citeIds.length === 0) continue;

        const url =
          extractUrl(line) ??
          extractUrl(lines[i + 1]) ??
          extractUrl(lines[i + 2]);
        if (!url) continue;

        for (const id of citeIds) {
          if (!urlById.has(id)) urlById.set(id, url);
        }
      }

      return urlById;
    }

    // Use the message timestamp as the stable "accessed" time for any sources used in this response.
    // (Avoids confusing per-render Date.now() differences.)
    const accessedAt = new Date(
      typeof message._creationTime === 'number' && Number.isFinite(message._creationTime)
        ? message._creationTime
        : Date.now(),
    ).toISOString();

    // Build a master library from fusion search results (tool outputs embed structured payload markers)
    let masterCitationLibrary = createCitationLibrary();
    const seenCitationIds = new Set<string>();

    const toolResultParts = toolParts.filter((part) => part.state === 'output-available');

    // Ingest live feed tool outputs so `feed_#` citations can resolve to real URLs.
    for (const part of toolResultParts) {
      const toolName = getNormalizedToolName(part);
      const toolOutput = part.state === 'output-available' ? part.output : undefined;
      const outputText = typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput ?? '', null, 2);
      // Tool name may vary depending on how it's registered; also allow content-based detection.
      const looksLikeLiveFeed =
        (toolName && toolName.toLowerCase().includes('l ivefeed'.replace(' ', ''))) ||
        outputText.includes('Latest feed items') ||
        outputText.includes('Top Headlines');
      if (!looksLikeLiveFeed) continue;

      for (const item of parseLiveFeedToolOutput(outputText)) {
        if (!item.id || seenCitationIds.has(item.id)) continue;
        seenCitationIds.add(item.id);

        masterCitationLibrary = addCitation(masterCitationLibrary, {
          id: item.id,
          type: 'source',
          label: (item.title || item.id).slice(0, 120),
          fullText: [item.title, item.summary].filter(Boolean).join(' — ').slice(0, 500),
          url: item.url,
          author: item.source,
          publishedAt: item.publishedAt,
          accessedAt,
        });
      }
    }

    for (const part of toolResultParts) {
      const toolName = getNormalizedToolName(part);
      if (!isFusionSearchTool(toolName)) continue;

      const toolOutput = part.state === 'output-available' ? part.output : undefined;
      const parsed = parseFusionSearchOutput(toolOutput, toolName);
      if (!parsed.isValid) continue;

      for (const r of parsed.results) {
        if (!r.id || seenCitationIds.has(r.id)) continue;
        seenCitationIds.add(r.id);

        masterCitationLibrary = addCitation(masterCitationLibrary, {
          id: r.id,
          type: 'source',
          label: (r.title || r.id).slice(0, 120),
          fullText: [r.title, r.snippet].filter(Boolean).join(' — ').slice(0, 500),
          url: r.url,
          author: r.source,
          publishedAt: r.publishedAt,
          accessedAt,
        });
      }
    }

    // Also ingest Linkup (and other) SOURCE_GALLERY_DATA blocks into the citation library
    // so inline `{{cite:websrc_xxx}}` tokens can resolve to a Sources cited dropdown + hover previews.
    for (const part of toolResultParts) {
      const toolOutput = part.state === 'output-available' ? part.output : undefined;
      const outputText = typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput ?? '', null, 2);

      if (!outputText.includes('SOURCE_GALLERY_DATA')) continue;

      const media = extractMediaFromText(outputText);
      for (const s of media.webSources) {
        const url = String(s.url ?? '').trim();
        if (!url) continue;
        const id = makeWebSourceCitationId(url);
        if (seenCitationIds.has(id)) continue;
        seenCitationIds.add(id);

        masterCitationLibrary = addCitation(masterCitationLibrary, {
          id,
          type: 'source',
          label: (s.title || url).slice(0, 120),
          fullText: [s.title, s.description].filter(Boolean).join(' — ').slice(0, 500),
          url,
          author: s.domain,
          publishedAt: s.publishedAt,
          accessedAt,
        });
      }
    }

    // Build the "cited" library in order of appearance in the final text, so markers are [1], [2], ...
    const finalText = visibleText || uiParts.text || '';
    const urlByCitationId = parseCitationUrlsFromText(finalText);
    const citationTokens = parseCitations(finalText);
    const citeOrder: string[] = [];
    const citeTokenById = new Map<string, typeof citationTokens[number]>();
    for (const token of citationTokens) {
      if (!citeTokenById.has(token.id)) citeTokenById.set(token.id, token);
      if (!citeOrder.includes(token.id)) citeOrder.push(token.id);
    }

    let citedCitationLibrary: CitationLibrary | undefined;
    if (citeOrder.length > 0) {
      citedCitationLibrary = createCitationLibrary();
      for (const id of citeOrder) {
        const token = citeTokenById.get(id);
        const base = masterCitationLibrary.citations[id];
        const tokenType = (token?.type as CitationType | undefined) ?? undefined;
        const type = tokenType ?? base?.type ?? 'source';

        citedCitationLibrary = addCitation(citedCitationLibrary, {
          id,
          type,
          label: token?.label || base?.label || id,
          fullText: base?.fullText || token?.label || id,
          url: base?.url ?? urlByCitationId.get(id),
          author: base?.author,
          publishedAt: base?.publishedAt,
          // Ensure we always show a deterministic date, even for citations that only exist as inline tokens.
          accessedAt: base?.accessedAt ?? accessedAt,
          // Page-indexed document citations: {{cite:id|label|type:document|page:3}}
          pageIndex: token?.pageIndex ?? base?.pageIndex,
        });
      }
    }

    // Build entity library from entity tokens in final text (enables hover popovers via EntityLink)
    let entityLibrary: EntityLibrary | undefined;
    const entityTokens = parseEntities(visibleText || uiParts.text || '');
    if (entityTokens.length > 0) {
      entityLibrary = createEntityLibrary();
      const seenEntityIds = new Set<string>();
      for (const token of entityTokens) {
        if (seenEntityIds.has(token.id)) continue;
        seenEntityIds.add(token.id);

        const type = (token.type as EntityType | undefined) ?? 'topic';
        const name = token.displayName || token.id;
        const enrichment = entityEnrichment?.[token.id] || entityEnrichment?.[name];

        entityLibrary = addEntity(entityLibrary, {
          id: token.id,
          name,
          type,
          description: enrichment?.summary,
          dossierId: enrichment?.dossierId,
          url: enrichment?.url,
          avatarUrl: enrichment?.avatarUrl,
        });
      }
    }

    return { citedCitationLibrary, entityLibrary };
  }, [entityEnrichment, isUser, message._creationTime, toolParts, uiParts.text, visibleText]);

  // Extract media from BOTH tool results AND final text
  const extractedMedia = useMemo(() => {
    if (isUser) return { youtubeVideos: [], secDocuments: [], webSources: [], profiles: [], images: [] };

    // Only grouped-custom owners feed this renderer. Other owners are consumed
    // by FusedSearchResults, MemoryPill, ToolCallTransparency, or ToolStep.
    const toolMedia = groupedToolOwners.reduce<ExtractedMedia>((acc, { entry }) => {
      const media = getToolMedia(entry.part);

      return {
        youtubeVideos: [...acc.youtubeVideos, ...media.youtubeVideos],
        secDocuments: [...acc.secDocuments, ...media.secDocuments],
        webSources: [...acc.webSources, ...media.webSources],
        profiles: [...acc.profiles, ...media.profiles],
        images: [...acc.images, ...media.images],
      };
    }, { youtubeVideos: [], secDocuments: [], webSources: [], profiles: [], images: [] });

    // ALSO extract from final text (for when agent synthesizes response)
    const textMedia = extractMediaFromText(visibleText || '');

    return {
      toolMedia,
      textMedia,
    };
  }, [groupedToolOwners, isUser, visibleText]);

  // Extract document actions from tool results
  const extractedDocuments = useMemo(() => {
    if (isUser) return [];

    const documents = groupedToolOwners.flatMap(({ entry }) =>
      getToolDocuments(entry.part)
    );

    // ALSO extract from final text
    const textDocs = extractDocumentActions(visibleText || '');

    return [...documents, ...textDocs];
  }, [groupedToolOwners, isUser, visibleText]);

  const arbitrageReports = useMemo(() => {
    if (isUser) return [];

    return groupedToolOwners.flatMap(({ entry }) => {
      if (entry.kind !== 'domain-tool' || !entry.categories.includes('arbitrage')) {
        return [];
      }
      const data = getArbitrageReportData(entry.part);
      return data ? [{ data, toolCallId: entry.part.toolCallId }] : [];
    });
  }, [groupedToolOwners, isUser]);

  const groupedDomainAnchor = useMemo(() => {
    const candidates = groupedToolOwners.map(({ entry }) => entry.originalIndex);

    for (const entry of textRenderParts) {
      const text = visibleTextByOriginalIndex.get(entry.originalIndex) ?? '';
      if (hasMedia(extractMediaFromText(text)) || extractDocumentActions(text).length > 0) {
        candidates.push(entry.originalIndex);
      }
    }

    return candidates.length > 0 ? Math.min(...candidates) : null;
  }, [groupedToolOwners, textRenderParts, visibleTextByOriginalIndex]);

  const goalCardAnchor = useMemo(
    () => goalToolOwners.length > 0
      ? Math.min(...goalToolOwners.map(({ entry }) => entry.originalIndex))
      : null,
    [goalToolOwners],
  );

  // Clean text by removing media markers and document action markers (for display purposes)
  const cleanedText = useMemo(() => {
    let cleaned = removeMediaMarkersFromText(visibleText || '');
    cleaned = removeDocumentActionMarkers(cleaned);
    // Also remove arbitrage citation markers for clean display (they're rendered separately)
    cleaned = cleaned.replace(/\{\{arbitrage:[^}]+\}\}/g, '');
    cleaned = cleaned.replace(/\{\{fact:[^}]+\}\}/g, '');
    return cleaned;
  }, [visibleText]);

  // Lazy-load KaTeX only when math notation ($, \begin{) is detected
  const rehypeKatexPlugin = useRehypeKatex(cleanedText || visibleText || '');

  const renderSourcePart = (
    entry: Extract<ConvexUIRenderPart, { kind: 'source' }>,
  ) => {
    const source = entry.part;
    return (
      <div
        data-original-index={entry.originalIndex}
        data-render-part-kind="source"
        key={`source-${entry.originalIndex}`}
      >
        <AISources className="mb-1">
          <AISourcesTrigger count={1} />
          <AISourcesContent className="motion-reduce:animate-none">
            {source.type === 'source-url' ? (
              <AISource
                href={source.url}
                title={source.title ?? source.url}
              />
            ) : (
              <div className="flex items-center gap-2 font-medium">
                <span>{source.title ?? source.filename ?? 'Document source'}</span>
              </div>
            )}
          </AISourcesContent>
        </AISources>
      </div>
    );
  };

  const renderFilePart = (
    entry: Extract<ConvexUIRenderPart, { kind: 'file' }>,
  ) => {
    const part = entry.part;
    const fileUrl = part.url || '';
    const mimeType = part.mediaType || (part as typeof part & { mimeType?: string }).mimeType || '';
    const fileName = part.filename || (part as typeof part & { name?: string }).name || 'File';
    const isImage = mimeType.startsWith('image/');
    const isText = mimeType.startsWith('text/');

    return (
      <div
        className="rounded-lg overflow-hidden border border-edge shadow-sm mb-2"
        data-original-index={entry.originalIndex}
        data-render-part-kind="file"
        key={`file-${entry.originalIndex}`}
      >
        {isImage ? (
          <SafeImage
            src={fileUrl}
            alt={fileName}
            className="max-w-full h-auto"
          />
        ) : isText ? (
          <FileTextPreview fileUrl={fileUrl} fileName={fileName} />
        ) : (
          <div className="px-4 py-3 bg-gradient-to-r from-surface-secondary to-surface flex items-center gap-3 group hover:from-blue-50 dark:hover:from-blue-900/20 hover:to-surface transition-colors">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300">
              <ImageIcon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-content hover:text-blue-600 transition-colors block truncate"
              >
                {fileName}
              </a>
              <p className="text-xs text-content-secondary mt-0.5">File Attachment</p>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderStandaloneDomainPart = (entry: DomainRenderPart) => {
    const payload = getDomainPayload(entry.part);
    const record = payload && typeof payload === 'object'
      ? payload as Record<string, unknown>
      : null;

    if (entry.categories.includes('arbitrage') && record) {
      const isReport = ['contradictions', 'rankedSources', 'deltas', 'healthResults']
        .some((key) => key in record);
      if (isReport) {
        return (
          <div
            data-domain-part-type={entry.part.type}
            data-original-index={entry.originalIndex}
            data-render-part-kind="domain"
            key={`domain-${entry.originalIndex}`}
          >
            <ArbitrageReportCard data={record as ArbitrageReportData} />
          </div>
        );
      }
    }

    if (entry.categories.includes('documentAction')) {
      const directDocument = record &&
        typeof record.documentId === 'string' &&
        typeof record.title === 'string'
        ? [record as unknown as DocumentAction]
        : typeof payload === 'string'
          ? extractDocumentActions(payload)
          : [];
      if (directDocument.length > 0) {
        return (
          <div
            data-domain-part-type={entry.part.type}
            data-original-index={entry.originalIndex}
            data-render-part-kind="domain"
            key={`domain-${entry.originalIndex}`}
          >
            <DocumentActionGrid
              documents={directDocument}
              title="Documents"
              onDocumentSelect={effectiveOnDocumentSelect}
            />
          </div>
        );
      }
    }

    if (entry.categories.includes('goalCard') && record) {
      const goal = typeof record.goal === 'string'
        ? record.goal
        : typeof record.title === 'string'
          ? record.title
          : null;
      if (goal) {
        const tasks = Array.isArray(record.tasks)
          ? record.tasks.flatMap((task, index): TaskStatusItem[] => {
              if (!task || typeof task !== 'object') return [];
              const item = task as Record<string, unknown>;
              const status = ['queued', 'active', 'success', 'failed'].includes(String(item.status))
                ? String(item.status) as TaskStatusItem['status']
                : 'queued';
              return [{
                id: typeof item.id === 'string' ? item.id : `domain-task-${index}`,
                name: typeof item.name === 'string' ? item.name : `Task ${index + 1}`,
                status,
              }];
            })
          : [];
        return (
          <div
            data-domain-part-type={entry.part.type}
            data-original-index={entry.originalIndex}
            data-render-part-kind="domain"
            key={`domain-${entry.originalIndex}`}
          >
            <GoalCard goal={goal} tasks={tasks} isStreaming={isStreaming} />
          </div>
        );
      }
    }

    if (entry.categories.includes('fusedSearch')) {
      const fusedSearch = parseFusionSearchOutput(payload, 'fusionSearch');
      if (fusedSearch.isValid && fusedSearch.results.length > 0) {
        return (
          <div
            data-domain-part-type={entry.part.type}
            data-original-index={entry.originalIndex}
            data-render-part-kind="domain"
            key={`domain-${entry.originalIndex}`}
          >
            <FusedSearchResults
              results={fusedSearch.results}
              sourcesQueried={fusedSearch.sourcesQueried}
              errors={fusedSearch.errors}
              timing={fusedSearch.timing}
              totalTimeMs={fusedSearch.totalTimeMs}
              showCitations={true}
            />
          </div>
        );
      }
    }

    return (
      <div
        data-domain-part-type={entry.part.type}
        data-original-index={entry.originalIndex}
        data-render-part-kind="domain"
        key={`domain-${entry.originalIndex}`}
      >
        <ToolOutputRenderer
          output={getStandaloneStructuredOutput(entry)}
          onCompanySelect={effectiveOnCompanySelect}
          onPersonSelect={effectiveOnPersonSelect}
          onEventSelect={effectiveOnEventSelect}
          onNewsSelect={effectiveOnNewsSelect}
        />
      </div>
    );
  };

  const renderGoalCardOwners = (originalIndex: number) => {
    const tasks: TaskStatusItem[] = goalToolOwners.map(({ entry }) => {
      const part = entry.part;
      const toolName = getNormalizedToolName(part)
        .replace('delegateTo', '')
        .replace('Agent', '') || 'Task';
      const status: TaskStatusItem['status'] = part.state === 'output-available'
        ? 'success'
        : part.state === 'output-error'
          ? 'failed'
          : 'active';
      return {
        id: `delegation-${part.toolCallId}`,
        name: toolName,
        status,
      };
    });
    const goal = uiParts.text.split('\n')[0].substring(0, 150) || 'Processing your request';

    return (
      <div
        data-original-index={originalIndex}
        data-render-part-kind="goal-card"
        key={`goal-card-${originalIndex}`}
      >
        <GoalCard goal={goal} tasks={tasks} isStreaming={isStreaming} />
      </div>
    );
  };

  const renderGroupedDomainOwners = (originalIndex: number) => (
    <div
      className="contents"
      data-grouped-domain-anchor={originalIndex}
      data-grouped-domain-owners={groupedToolOwners.length}
      data-original-index={originalIndex}
      data-render-part-kind="grouped-domain"
      key={`grouped-domain-${originalIndex}`}
    >
      {arbitrageReports.map(({ data, toolCallId }) => (
        <ArbitrageReportCard data={data} key={toolCallId} />
      ))}

      <RichMediaSection media={extractedMedia} showCitations={true} />

      {extractedDocuments.length > 0 && (
        <DocumentActionGrid
          documents={extractedDocuments}
          title="Documents"
          onDocumentSelect={effectiveOnDocumentSelect}
        />
      )}
    </div>
  );

  const renderToolOwner = (owner: RoutedToolOwner) => {
    const { entry, route, fusedSearch } = owner;
    const part = entry.part;
    const toolName = getNormalizedToolName(part);
    const categories: DomainCategory[] = entry.kind === 'domain-tool' ? entry.categories : [];
    const completed = part.state === 'output-available' || part.state === 'output-error';
    const stepNumber = toolRenderParts.findIndex((candidate) => candidate === entry) + 1;

    let content: React.ReactNode;
    if (route === 'fused-search' && fusedSearch) {
      content = (
        <div className="my-3 w-full">
          <FusedSearchResults
            results={fusedSearch.results}
            sourcesQueried={fusedSearch.sourcesQueried}
            errors={fusedSearch.errors}
            timing={fusedSearch.timing}
            totalTimeMs={fusedSearch.totalTimeMs}
            showCitations={true}
          />
        </div>
      );
    } else if (route === 'memory-pill') {
      let type: 'plan_update' | 'test_result' | 'memory_write' = 'memory_write';
      let title = 'Memory Updated';
      let details = '';
      const input = part.input as Record<string, unknown> | undefined;

      if (toolName.includes('createPlan')) {
        type = 'plan_update';
        title = 'New Plan Created';
        details = input?.goal ? `Goal: ${String(input.goal)}` : 'New mission plan initialized';
      } else if (toolName.includes('updatePlanStep')) {
        type = 'plan_update';
        title = 'Plan Updated';
        details = input?.status ? `Step marked as ${String(input.status)}` : 'Plan progress updated';
      } else if (toolName.includes('logEpisodic')) {
        type = 'test_result';
        title = 'Episodic Log';
        details = 'System event recorded';
      } else {
        const key = typeof input?.key === 'string' ? input.key : 'unknown';
        title = key.startsWith('constraint:') ? 'Constraint Added' : 'Memory Updated';
        details = `Key: ${key}`;
      }

      content = (
        <div className="my-2 flex justify-center w-full">
          <MemoryPill
            event={{
              id: `pill-${part.toolCallId}`,
              type,
              title,
              details,
              timestamp: Date.now(),
            }}
          />
        </div>
      );
    } else if (route === 'convex-transparency') {
      const convexToolData = {
        toolName,
        status: (part.state === 'output-available'
          ? 'success'
          : part.state === 'output-error'
            ? 'error'
            : 'running') as 'running' | 'success' | 'error',
        inputSummary: part.input ? JSON.stringify(part.input).substring(0, 120) : undefined,
        outputSummary: part.state === 'output-available' && part.output
          ? (typeof part.output === 'string'
              ? part.output.substring(0, 120)
              : JSON.stringify(part.output).substring(0, 120))
          : undefined,
      };
      content = (
        <div className="my-2 w-full">
          <ToolCallTransparency toolCalls={[convexToolData]} />
        </div>
      );
    } else {
      content = (
        <ToolStep
          part={part}
          stepNumber={stepNumber}
          onCompanySelect={effectiveOnCompanySelect}
          onPersonSelect={effectiveOnPersonSelect}
          onEventSelect={effectiveOnEventSelect}
          onNewsSelect={effectiveOnNewsSelect}
          useDomainRenderer={categories.includes('selection') || categories.includes('media')}
        />
      );
    }

    return (
      <div
        data-original-index={entry.originalIndex}
        data-render-part-kind="tool"
        key={`tool-${part.toolCallId}`}
      >
        <ToolStepsAccordion
          toolCount={1}
          completedCount={completed ? 1 : 0}
          isStreaming={isStreaming}
        >
          <div className="w-full">{content}</div>
        </ToolStepsAccordion>
      </div>
    );
  };

  const renderTextPart = (
    entry: TextRenderPart,
    text: string,
    isFirstText: boolean,
    isLastText: boolean,
  ) => {
    let partText = removeMediaMarkersFromText(text);
    partText = removeDocumentActionMarkers(partText)
      .replace(/\{\{arbitrage:[^}]+\}\}/g, '')
      .replace(/\{\{fact:[^}]+\}\}/g, '');
    const displayText = isUser ? (text || '...') : (partText || text);
    const isOnlyTextPart = textRenderParts.length === 1;
    const isLong = isOnlyTextPart &&
      !isUser &&
      displayText.length > COLLAPSE_THRESHOLD &&
      message.status !== 'streaming';
    const markdownText = isLong && isCollapsed
      ? displayText.slice(0, COLLAPSE_THRESHOLD) + '...'
      : displayText;

    if (isUser && isEditing && !isFirstText) return null;

    return (
      <AIMessageContent
        className="contents"
        data-original-index={entry.originalIndex}
        data-render-part-kind="text"
        key={'text-' + entry.originalIndex}
      >
        {!isUser || displayText || (isEditing && isFirstText) ? (
          <div
            className={cn(
              'relative p-4 rounded-lg shadow-sm transition-all duration-200 text-sm leading-relaxed',
              isUser
                ? isEditing
                  ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-700 text-content rounded-br-none'
                  : 'bg-gradient-to-br from-violet-500 to-violet-600 text-white rounded-br-none shadow-md'
                : 'bg-surface border border-edge text-content rounded-bl-none shadow-sm dark:bg-surface-secondary',
              message.status === 'streaming' && 'motion-safe:animate-pulse-subtle',
              message.status === 'failed' && 'bg-red-50/80 border-red-200 dark:bg-red-900/20 dark:border-red-800',
            )}
          >
            {isUser && isEditing && isFirstText ? (
              <div className="flex flex-col gap-2">
                <textarea
                  ref={editTextareaRef}
                  value={editText}
                  onChange={(event) => setEditText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleSaveEdit();
                    }
                    if (event.key === 'Escape') handleCancelEdit();
                  }}
                  className="w-full bg-transparent text-sm leading-relaxed resize-none outline-none min-h-[40px] placeholder-blue-300"
                  rows={Math.max(1, editText.split('\n').length)}
                />
                <div className="flex items-center gap-2 justify-end">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="action-btn text-xs px-2.5 py-1 rounded-md text-content-muted hover:text-content hover:bg-surface-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    className="press-scale text-xs px-3 py-1 rounded-md bg-violet-500 text-white hover:bg-violet-600 font-medium"
                  >
                    Save &amp; Resend
                  </button>
                </div>
              </div>
            ) : null}

            {!isUser && displayText.includes('<think>') && (() => {
              const thinkMatch = displayText.match(/<think>([\s\S]*?)<\/think>/);
              if (!thinkMatch) return null;
              return (
                <details className="thinking-disclosure mb-2">
                  <summary>Reasoning ({thinkMatch[1].split(/\s+/).length} words)</summary>
                  <div className="mt-1 text-xs leading-relaxed opacity-80 whitespace-pre-wrap">
                    {thinkMatch[1].trim()}
                  </div>
                </details>
              );
            })()}

            {!isUser && isLastText && message.status === 'streaming' && displayText && (
              <div className="w-full h-[2px] bg-[var(--border-color)] rounded-full overflow-hidden mb-1">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all duration-300"
                  style={{ width: Math.min((displayText.length / 2000) * 100, 95) + '%' }}
                />
              </div>
            )}

            {!(isUser && isEditing) && (
              !isUser &&
              isLastText &&
              message.status === 'streaming' &&
              !displayText ? (
                <div
                  aria-label="Assistant response loading"
                  className="space-y-2"
                  data-streaming-placeholder="true"
                >
                  <div className="h-3 w-11/12 rounded bg-surface-hover motion-safe:animate-pulse" />
                  <div className="h-3 w-4/5 rounded bg-surface-hover motion-safe:animate-pulse" />
                  <div className="h-3 w-2/3 rounded bg-surface-hover motion-safe:animate-pulse" />
                </div>
              ) : (
              <div className={cn(!isUser && 'prose-agent')}>
                <ReactMarkdown
                  remarkPlugins={[remarkMath]}
                  rehypePlugins={rehypeKatexPlugin ? [rehypeKatexPlugin] : []}
                  components={{
                    code({ inline, className, children, ...props }: any) {
                      const match = /language-(\w+)/.exec(className || '');
                      const language = match ? match[1] : '';
                      if (!inline && language === 'mermaid') {
                        return (
                          <Suspense fallback={<div className="motion-safe:animate-pulse h-40 bg-surface-secondary rounded-lg flex items-center justify-center text-sm text-content-muted">Loading diagram...</div>}>
                            <MermaidDiagram
                              code={String(children).replace(/\n$/, '')}
                              onRetryRequest={onMermaidRetry}
                              isStreaming={message.status === 'streaming'}
                            />
                          </Suspense>
                        );
                      }
                      return !inline && match ? (
                        <CodeBlockWithCopy language={language}>
                          {String(children).replace(/\n$/, '')}
                        </CodeBlockWithCopy>
                      ) : (
                        <code
                          className={cn(
                            'px-1 py-0.5 rounded text-xs font-mono',
                            isUser ? 'bg-blue-700/50 text-white' : 'bg-surface-hover text-content',
                          )}
                          {...props}
                        >
                          {children}
                        </code>
                      );
                    },
                    a({ href, children }) {
                      return <a href={href} className="text-blue-600 hover:underline font-medium" target="_blank" rel="noopener noreferrer">{children}</a>;
                    },
                    table({ children }) {
                      return <div className="overflow-x-auto my-3 rounded-lg border border-edge"><table className="w-full text-xs border-collapse">{children}</table></div>;
                    },
                    thead({ children }) {
                      return <thead className="bg-surface-secondary">{children}</thead>;
                    },
                    th({ children }) {
                      return <th className="px-3 py-2 text-left font-semibold text-content border-b border-edge text-xs">{children}</th>;
                    },
                    td({ children }) {
                      return <td className="px-3 py-1.5 border-b border-edge text-content-secondary text-xs">{children}</td>;
                    },
                    tr({ children }) {
                      return <tr className="hover:bg-surface-secondary transition-colors">{children}</tr>;
                    },
                    p({ children }) {
                      const textContent = React.Children.toArray(children)
                        .map((child) => typeof child === 'string' ? child : '')
                        .join('');
                      if (parseCitations(textContent).length > 0 || parseEntities(textContent).length > 0) {
                        return (
                          <p className="mb-2">
                            <InteractiveSpanParser
                              text={textContent}
                              citations={citedCitationLibrary}
                              entities={entityLibrary}
                              entityEnrichment={entityEnrichment}
                            />
                          </p>
                        );
                      }
                      if (searchHighlight && textContent.toLowerCase().includes(searchHighlight.toLowerCase())) {
                        const escaped = searchHighlight.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
                        const regex = new RegExp('(' + escaped + ')', 'gi');
                        return (
                          <p className="mb-2">
                            {textContent.split(regex).map((part, index) =>
                              part.toLowerCase() === searchHighlight.toLowerCase()
                                ? <mark key={index} className="bg-yellow-300 dark:bg-yellow-500/40 text-inherit rounded-sm px-0.5">{part}</mark>
                                : <React.Fragment key={index}>{part}</React.Fragment>
                            )}
                          </p>
                        );
                      }
                      return <p className="mb-2">{children}</p>;
                    },
                  }}
                >
                  {markdownText}
                </ReactMarkdown>
                {isLong && (
                  <button
                    type="button"
                    onClick={() => setIsCollapsed((previous) => !previous)}
                    className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline mt-1"
                  >
                    {isCollapsed ? 'Show more ▼' : 'Show less ▲'}
                  </button>
                )}
                {!isUser &&
                  isLastText &&
                  (message.status === 'streaming' || message.status === 'typing') &&
                  displayText && <span className="streaming-caret" />}
              </div>
              )
            )}
          </div>
        ) : null}
      </AIMessageContent>
    );
  };

  const renderOrderedPart = (entry: ConvexUIRenderPart) => {
    if (isToolRenderPart(entry)) {
      const owner = routedToolOwnerByEntry.get(entry);
      if (!owner) return null;

      if (owner.route === 'goal-card') {
        return entry.originalIndex === goalCardAnchor
          ? renderGoalCardOwners(entry.originalIndex)
          : null;
      }
      if (owner.route === 'grouped-custom') {
        return entry.originalIndex === groupedDomainAnchor
          ? renderGroupedDomainOwners(entry.originalIndex)
          : null;
      }
      return renderToolOwner(owner);
    }

    if (entry.kind === 'text') {
      const textIndex = textRenderParts.findIndex((candidate) => candidate === entry);
      const renderedText = renderTextPart(
        entry,
        visibleTextByOriginalIndex.get(entry.originalIndex) ?? '',
        textIndex === 0,
        textIndex === textRenderParts.length - 1,
      );
      if (entry.originalIndex !== groupedDomainAnchor) return renderedText;
      return (
        <React.Fragment key={'text-group-' + entry.originalIndex}>
          {renderedText}
          {renderGroupedDomainOwners(entry.originalIndex)}
        </React.Fragment>
      );
    }

    if (entry.kind === 'reasoning') {
      const reasoning = visibleReasoningByOriginalIndex.get(entry.originalIndex) ?? '';
      if (isUser || !reasoning) return null;
      return (
        <div
          data-original-index={entry.originalIndex}
          data-render-part-kind="reasoning"
          key={'reasoning-' + entry.originalIndex}
        >
          <ThinkingAccordion reasoning={reasoning} isStreaming={isStreaming} />
        </div>
      );
    }

    if (entry.kind === 'source') return renderSourcePart(entry);
    if (entry.kind === 'file') return renderFilePart(entry);
    return renderStandaloneDomainPart(entry);
  };

  const fallbackTextEntry = textRenderParts.length === 0
    ? ({
        kind: 'text',
        originalIndex: uiParts.renderParts.reduce(
          (highest, entry) => Math.max(highest, entry.originalIndex),
          -1,
        ) + 1,
        part: { type: 'text', text: uiParts.text },
      } as TextRenderPart)
    : null;

  return (
    <AIMessage
      from={uiParts.from}
      role="article"
      aria-label={isUser ? "Your message" : "Assistant response"}
      className={cn(
        "max-w-none flex-row group msg-entrance",
        compact ? "gap-2.5 mb-4" : "gap-3 mb-6",
        isUser ? "justify-end" : "justify-start",
        isChild && "ml-0" // Child messages already have margin from parent container
      )}>
      {/* Agent Avatar - Show on LEFT side for agent messages */}
      {!isUser && (
        <div className="flex-shrink-0">
          <div className={cn(
            "w-7 h-7 rounded-full flex items-center justify-center",
            "bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800/40"
          )}>
            <Bot className="w-3.5 h-3.5 text-green-700 dark:text-green-400" />
          </div>
        </div>
      )}

      {/* Message Content */}
      <div ref={bubbleRef} className={cn(
        "flex flex-col gap-2 relative",
        compact ? "max-w-full" : "max-w-[85%]",
        isUser && "items-end"
      )}>
        {/* Text Selection Toolbar */}
        {selectionToolbar && (
          <div
            className="selection-toolbar"
            style={{ left: selectionToolbar.x, top: selectionToolbar.y, transform: 'translate(-50%, -100%)' }}
          >
            <button onClick={() => { navigator.clipboard.writeText(selectionToolbar.text); setSelectionToolbar(null); }}>Copy</button>
            <button onClick={() => { navigator.clipboard.writeText(`> ${selectionToolbar.text}`); setSelectionToolbar(null); }}>Quote</button>
            <button onClick={() => { window.getSelection()?.removeAllRanges(); setSelectionToolbar(null); }}>Dismiss</button>
          </div>
        )}

        {/* Agent Role Badge (for specialized agents) */}
        {roleConfig && !isUser && (
          <div className={cn(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium mb-1",
            "bg-gradient-to-r shadow-sm",
            roleConfig.color === 'purple' && "from-purple-100 to-purple-200 dark:from-purple-900/40 dark:to-purple-800/40 text-purple-700 dark:text-purple-300",
            roleConfig.color === 'blue' && "from-blue-100 to-blue-200 dark:from-blue-900/40 dark:to-blue-800/40 text-blue-700 dark:text-blue-300",
            roleConfig.color === 'pink' && "from-pink-100 to-pink-200 dark:from-pink-900/40 dark:to-pink-800/40 text-pink-700 dark:text-pink-300",
            roleConfig.color === 'green' && "from-green-100 to-green-200 dark:from-green-900/40 dark:to-green-800/40 text-green-700 dark:text-green-300",
            roleConfig.color === 'cyan' && "from-cyan-100 to-cyan-200 dark:from-cyan-900/40 dark:to-cyan-800/40 text-cyan-700 dark:text-cyan-300"
          )}>
            <span className="text-sm">{roleConfig.icon}</span>
            <span>{roleConfig.label}</span>
          </div>
        )}


        {/* Thinking Accordion */}
        {!isUser && (
          <StreamingStatus
            parts={message.parts as Array<Record<string, unknown>>}
            messageText={visibleText}
            isStreaming={isStreaming}
            tokensPerSecond={streamTokPerSec}
            runtimeSeconds={streamRuntimeSeconds}
          />
        )}

        {/* Canonical ordered ownership: never render aggregate projections in parallel. */}
        {uiParts.renderParts.map(renderOrderedPart)}
        {fallbackTextEntry && renderTextPart(
          fallbackTextEntry,
          visibleText ?? '',
          true,
          true,
        )}

        {/* Smart Actions (assistant messages, after content finishes) */}
        {!compact && !isUser && message.status !== 'streaming' && (cleanedText || visibleText) && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            <div className="relative inline-flex">
              <button
                type="button"
                className="smart-action-chip"
                onClick={() => { navigator.clipboard.writeText(cleanedText || visibleText || ''); toast.success('Copied as Markdown'); }}
              >
                📋 Copy
              </button>
              <button
                type="button"
                className="smart-action-chip !px-1.5 !rounded-l-none -ml-px"
                onClick={() => {
                  const text = cleanedText || visibleText || '';
                  const plain = text.replace(/[#*_`~\[\]()>-]/g, '').replace(/\n{2,}/g, '\n');
                  navigator.clipboard.writeText(plain);
                  toast.success('Copied as plain text');
                }}
                title="Copy as plain text"
              >
                T
              </button>
            </div>
            <button
              type="button"
              className="smart-action-chip"
              onClick={() => setShowRawMarkdown(prev => !prev)}
            >
              {showRawMarkdown ? '📄 Rendered' : '{ } Raw'}
            </button>
            <button
              type="button"
              className="smart-action-chip"
              onClick={() => {
                const blob = new Blob([cleanedText || visibleText || ''], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'response.md';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              💾 Save as file
            </button>

            {/* RLHF Feedback Buttons */}
            {onFeedback && (
              <div className="flex items-center gap-0.5 ml-auto">
                <button
                  type="button"
                  className={`smart-action-chip !px-1.5 ${feedbackVote === 'up' ? '!bg-green-100 !text-green-700 dark:!bg-green-900/30 dark:!text-green-400' : ''}`}
                  onClick={() => onFeedback('up')}
                  title="Good response"
                >
                  👍
                </button>
                <button
                  type="button"
                  className={`smart-action-chip !px-1.5 ${feedbackVote === 'down' ? '!bg-red-100 !text-red-700 dark:!bg-red-900/30 dark:!text-red-400' : ''}`}
                  onClick={() => onFeedback('down')}
                  title="Bad response"
                >
                  👎
                </button>
              </div>
            )}
          </div>
        )}

        {/* R4: Inline Actionable Response Cards */}
        {!compact && !isUser && message.status !== 'streaming' && (cleanedText || visibleText) && (
          <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-white/[0.06]">
            <button
              type="button"
              aria-label="Save this response as a memo"
              className="rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-medium text-white/60 hover:bg-white/[0.10] hover:text-white/80 transition-colors"
              onClick={() => {
                contextHandlers.onSaveAsMemo(cleanedText || visibleText || '');
                toast.success('Saved as memo');
              }}
            >
              Save as Memo
            </button>
            <button
              type="button"
              aria-label="Share this response"
              className="rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-medium text-white/60 hover:bg-white/[0.10] hover:text-white/80 transition-colors"
              onClick={() => {
                contextHandlers.onShareMessage(cleanedText || visibleText || '');
                toast.success('Share link copied');
              }}
            >
              Share
            </button>
            <button
              type="button"
              aria-label="Ask for more detail on this response"
              className="rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-medium text-white/60 hover:bg-white/[0.10] hover:text-white/80 transition-colors"
              onClick={() => {
                const summary = (cleanedText || visibleText || '').slice(0, 200);
                contextHandlers.onSendFollowUp(`Go deeper on this: ${summary}...`);
              }}
            >
              Go Deeper
            </button>
          </div>
        )}

        {/* Edit Diff View */}
        {editDiff && (
          <div className="mt-2 rounded-lg border border-edge overflow-hidden text-xs font-mono">
            <div className="px-3 py-1.5 bg-surface-secondary text-content-muted text-xs font-semibold">Edit Diff</div>
            <div className="px-3 py-1.5 bg-red-50 dark:bg-red-900/10 text-red-700 dark:text-red-400 line-through whitespace-pre-wrap">
              {editDiff.oldText}
            </div>
            <div className="px-3 py-1.5 bg-green-50 dark:bg-green-900/10 text-green-700 dark:text-green-400 whitespace-pre-wrap">
              {editDiff.newText}
            </div>
          </div>
        )}

        {/* Multi-turn Context Indicator */}
        {!compact && isInContext === false && !isUser && (
          <div className="mt-1 text-[8px] text-content-muted flex items-center gap-1 opacity-60" title="This message may be outside the model's context window">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
            Outside context window
          </div>
        )}

        {/* Reading Time Estimate */}
        {!compact && !isUser && message.status !== 'streaming' && (() => {
          const text = cleanedText || visibleText || '';
          const wordCount = text.split(/\s+/).length;
          if (wordCount < 80) return null;
          const readMin = Math.ceil(wordCount / 230);
          return (
            <span className="text-xs text-content-muted mt-0.5 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              {readMin} min read
            </span>
          );
        })()}

        {/* AI Confidence Indicator */}
        {!compact && !isUser && message.status !== 'streaming' && (cleanedText || visibleText) && (() => {
          const text = cleanedText || visibleText || '';
          const hedges = (text.match(/\b(might|may|could|possibly|perhaps|likely|unlikely|uncertain|not sure|it seems|appears to|I think|I believe|approximately|roughly)\b/gi) || []).length;
          const totalWords = text.split(/\s+/).length;
          const hedgeRatio = totalWords > 0 ? hedges / totalWords : 0;
          const confidence = hedgeRatio > 0.03 ? 'low' : hedgeRatio > 0.01 ? 'medium' : 'high';
          const confColors = { high: '#22c55e', medium: '#f59e0b', low: '#ef4444' };
          const confLabels = { high: 'High confidence', medium: 'Moderate confidence', low: 'Low confidence' };
          return (
            <div className="flex items-center gap-1.5 mt-0.5" title={`${confLabels[confidence]} — ${hedges} hedging words in ${totalWords} words`}>
              <div className="flex gap-0.5">
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full transition-colors"
                    style={{ background: i <= (confidence === 'high' ? 2 : confidence === 'medium' ? 1 : 0) ? confColors[confidence] : 'var(--border-color)' }}
                  />
                ))}
              </div>
              <span className="text-xs text-content-muted">{confLabels[confidence]}</span>
            </div>
          );
        })()}

        {/* Inline Source Citations with Hover Preview */}
        {!isUser && message.status !== 'streaming' && (cleanedText || visibleText || '').match(/\[\d+\]/) && (() => {
          const text = cleanedText || visibleText || '';
          const citationNums = [...new Set((text.match(/\[(\d+)\]/g) || []).map(c => c.replace(/[\[\]]/g, '')))];
          if (citationNums.length === 0) return null;
          const urls = text.match(/https?:\/\/[^\s)]+/g) || [];
          return (
            <div className="flex flex-wrap gap-1 mt-1.5">
              <span className="text-xs text-content-muted mr-0.5">Sources:</span>
              {citationNums.slice(0, 8).map((num, i) => {
                const url = urls[i] || null;
                let domain = '';
                try { if (url) domain = new URL(url).hostname.replace('www.', ''); } catch { /* */ }
                return (
                  <span key={num} className="relative group/cite">
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[8px] font-bold cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800/40 transition-colors">
                      {num}
                    </span>
                    {url && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/cite:flex flex-col w-[200px] bg-surface border border-edge rounded-lg shadow-xl p-2 z-50 pointer-events-none">
                        <div className="flex items-center gap-1.5 mb-1">
                          <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`} alt="" className="w-3 h-3 rounded" width={12} height={12} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          <span className="text-xs font-medium text-content truncate">{domain}</span>
                        </div>
                        <span className="text-[8px] text-content-muted truncate">{url.slice(0, 60)}</span>
                      </div>
                    )}
                  </span>
                );
              })}
            </div>
          );
        })()}

        {/* Image/File Inline Previews */}
        {!isUser && (cleanedText || visibleText || '').match(/!\[.*?\]\(https?:\/\/[^)]+\)/) && (() => {
          const text = cleanedText || visibleText || '';
          const imgMatches = [...text.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g)];
          if (imgMatches.length === 0) return null;
          return (
            <div className="flex flex-wrap gap-2 mt-2">
              {imgMatches.slice(0, 4).map((match, i) => (
                <a
                  key={i}
                  href={match[2]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg overflow-hidden border border-edge hover:border-blue-400 transition-colors shadow-sm"
                >
                  <img
                    src={match[2]}
                    alt={match[1] || 'Image'}
                    className="max-w-[160px] max-h-[120px] object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </a>
              ))}
            </div>
          );
        })()}

        {/* File Attachment Previews (detect file URLs) */}
        {!isUser && (cleanedText || visibleText || '').match(/\bhttps?:\/\/\S+\.(pdf|csv|xlsx?|docx?|pptx?|json|xml)\b/i) && (() => {
          const text = cleanedText || visibleText || '';
          const fileMatches = [...text.matchAll(/\bhttps?:\/\/\S+\.(pdf|csv|xlsx?|docx?|pptx?|json|xml)\b/gi)];
          if (fileMatches.length === 0) return null;
          const fileIcons: Record<string, string> = { pdf: '📕', csv: '📊', xls: '📊', xlsx: '📊', doc: '📝', docx: '📝', pptx: '📽️', ppt: '📽️', json: '📋', xml: '📋' };
          return (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {fileMatches.slice(0, 4).map((match, i) => {
                const ext = match[1].toLowerCase();
                const filename = match[0].split('/').pop() || `file.${ext}`;
                return (
                  <a
                    key={i}
                    href={match[0]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="smart-action-chip"
                  >
                    <span>{fileIcons[ext] || '📎'}</span>
                    <span className="truncate max-w-[120px]">{decodeURIComponent(filename)}</span>
                  </a>
                );
              })}
            </div>
          );
        })()}

        {/* Rich Link Preview Cards */}
        {!isUser && message.status !== 'streaming' && (cleanedText || visibleText || '').match(/https?:\/\/[^\s)]+/) && (() => {
          const text = cleanedText || visibleText || '';
          const urlMatches = [...new Set(text.match(/https?:\/\/[^\s)]+/g) || [])];
          const imageExts = /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i;
          const fileExts = /\.(pdf|csv|xlsx?|docx?|pptx?|json|xml)$/i;
          const links = urlMatches.filter(u => !imageExts.test(u) && !fileExts.test(u)).slice(0, 3);
          if (links.length === 0) return null;
          return (
            <div className="flex flex-col gap-1.5 mt-2">
              {links.map((url, i) => {
                let domain = '';
                try { domain = new URL(url).hostname.replace('www.', ''); } catch { domain = url.slice(0, 30); }
                return (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-edge bg-surface-secondary hover:bg-surface-hover transition-colors group/link"
                  >
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                      alt=""
                      className="w-4 h-4 rounded flex-shrink-0"
                      width={16}
                      height={16}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-content truncate group-hover/link:underline">{domain}</div>
                      <div className="text-xs text-content-muted truncate">{url.slice(0, 80)}</div>
                    </div>
                    <ExternalLink className="w-3 h-3 text-content-muted flex-shrink-0 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                  </a>
                );
              })}
            </div>
          );
        })()}

        {/* Response telemetry */}
        {!isUser && message.status !== 'streaming' && (() => {
          const siblingCreatedAt = (message as any)._siblingCreationTime;
          const latencyMs =
            message._creationTime && siblingCreatedAt
              ? message._creationTime - siblingCreatedAt
              : null;
          const showLatency =
            typeof latencyMs === 'number' && latencyMs > 0 && latencyMs <= 120000;

          if (!showLatency && !messageTokens) return null;

          return (
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[8px] text-content-muted tabular-nums">
              {showLatency && (
                <span title={`Response latency: ${latencyMs}ms`}>
                  {latencyMs < 1000 ? `${latencyMs}ms` : `${(latencyMs / 1000).toFixed(1)}s`} latency
                </span>
              )}
              {messageTokens && (
                <TokenUsageBadge
                  inputTokens={messageTokens.input}
                  outputTokens={messageTokens.output}
                  model={messageModel}
                  className="text-[10px]"
                />
              )}
            </div>
          );
        })()}

        {/* Raw Markdown View */}
        {showRawMarkdown && !isUser && (cleanedText || visibleText) && (
          <pre className="text-xs font-mono bg-surface-secondary border border-edge rounded-lg p-3 mt-1 overflow-x-auto max-h-[300px] overflow-y-auto text-content-secondary whitespace-pre-wrap">
            {cleanedText || visibleText}
          </pre>
        )}

        {/* Emoji reaction badge */}
        {emojiReaction && (
          <div className="flex items-center gap-1 mt-0.5">
            <button
              type="button"
              onClick={() => setEmojiReaction(null)}
              className="text-sm px-1.5 py-0.5 rounded-full bg-surface-secondary border border-edge hover:bg-surface-secondary transition-colors"
              title="Remove reaction"
            >
              {emojiReaction}
            </button>
          </div>
        )}

        {/* "Sources cited" dropdown (derived from inline citation tokens) */}
        {!isUser && citedCitationLibrary && message.status !== 'streaming' && (
          <SourcesCitedDropdown library={citedCitationLibrary} basisMs={message._creationTime} />
        )}

        {/* Status indicator and actions */}
        <div className="flex items-center gap-2 mt-1">
          {message.status === 'streaming' && (
            <div className="text-xs text-content-muted flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 bg-green-500 rounded-full motion-safe:animate-pulse"></span>
              <span>Streaming...</span>
              {streamTokPerSec > 0 && (
                <span className="tabular-nums text-xs text-content-muted">
                  {streamTokPerSec} tok/s
                </span>
              )}
              {streamStartRef.current && (
                <span className="tabular-nums text-xs text-content-muted">
                  {((Date.now() - streamStartRef.current) / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          )}

          {/* Action buttons for completed messages */}
          {message.status !== 'streaming' && visibleText && (
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              {/* Timestamp + token estimate on hover */}
              {message._creationTime && (
                <span className="text-xs text-content-muted tabular-nums mr-1">
                  {new Date(message._creationTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {!compact && visibleText && (
                <span className="text-xs text-content-muted tabular-nums mr-1" title={`${visibleText.split(/\s+/).length} words, ${visibleText.length} chars, ~${Math.ceil(visibleText.length / 4)} tokens`}>
                  ~{Math.ceil(visibleText.length / 4)} tok &middot; {visibleText.split(/\s+/).length}w
                </span>
              )}
              {/* Edit button for user messages */}
              {isUser && onEditMessage && (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="action-btn text-xs text-content-muted hover:text-content-secondary flex items-center gap-1"
                  title="Edit message"
                  aria-label="Edit message"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}

              {/* Copy button */}
              <button
                type="button"
                onClick={() => { void handleCopy(); }}
                className="action-btn text-xs text-content-muted hover:text-content-secondary flex items-center gap-1"
                title="Copy response"
                aria-label={copied ? "Copied to clipboard" : "Copy response"}
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>

              {/* Read-aloud button for assistant messages */}
              {!isUser && (
                <button
                  type="button"
                  onClick={handleReadAloud}
                  className={cn(
                    "action-btn text-xs flex items-center gap-1",
                    isSpeaking
                      ? "text-violet-500 dark:text-violet-400"
                      : "text-content-muted hover:text-violet-500 dark:hover:text-violet-400"
                  )}
                  title={isSpeaking ? "Stop reading" : "Read aloud"}
                  aria-label={isSpeaking ? "Stop reading aloud" : "Read message aloud"}
                >
                  {isSpeaking ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                </button>
              )}

              {/* Bookmark button */}
              {!compact && onToggleBookmark && (
                <button
                  type="button"
                  onClick={onToggleBookmark}
                  className={cn(
                    "action-btn text-xs flex items-center gap-1",
                    isBookmarked
                      ? "text-amber-500 dark:text-amber-400"
                      : "text-content-muted hover:text-amber-500 dark:hover:text-amber-400"
                  )}
                  title={isBookmarked ? "Remove bookmark" : "Bookmark message"}
                  aria-label={isBookmarked ? "Remove bookmark" : "Bookmark message"}
                >
                  <Bookmark className={cn("h-3 w-3", isBookmarked && "fill-current")} />
                </button>
              )}

              {/* Pin button */}
              {!compact && onTogglePin && (
                <button
                  type="button"
                  onClick={onTogglePin}
                  className={cn(
                    "action-btn text-xs flex items-center gap-1",
                    isMessagePinned
                      ? "text-purple-500 dark:text-purple-400"
                      : "text-content-muted hover:text-purple-500 dark:hover:text-purple-400"
                  )}
                  title={isMessagePinned ? "Unpin message" : "Pin message"}
                  aria-label={isMessagePinned ? "Unpin message" : "Pin message"}
                >
                  <Pin className={cn("h-3 w-3", isMessagePinned && "fill-current")} />
                </button>
              )}

              {/* Emoji reaction picker */}
              {!compact && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(prev => !prev)}
                  className="action-btn text-xs text-content-muted hover:text-content-secondary flex items-center gap-1"
                  title="React with emoji"
                  aria-label="React with emoji"
                >
                  <span className="text-sm">😀</span>
                </button>
                {showEmojiPicker && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowEmojiPicker(false)} />
                    <div className="absolute bottom-6 left-0 z-50 flex gap-1 p-1.5 bg-surface border border-edge rounded-lg shadow-xl">
                      {QUICK_EMOJIS.map(e => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => { setEmojiReaction(e); setShowEmojiPicker(false); }}
                          className="text-base hover:scale-125 transition-transform p-0.5"
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              )}

              {/* Regenerate button for assistant messages */}
              {!compact && !isUser && onRegenerateMessage && (
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={isRegenerating}
                  className="action-btn text-xs text-content-muted hover:text-content-secondary disabled:text-content-muted flex items-center gap-1"
                  title="Regenerate response"
                >
                  <RefreshCw className={`h-3 w-3 ${isRegenerating ? 'motion-safe:animate-spin' : ''}`} />
                </button>
              )}

              {/* Feedback buttons */}
              {!compact && !isUser && (
                <>
                  <button
                    type="button"
                    onClick={() => setFeedback(f => f === 'up' ? null : 'up')}
                    className={cn(
                      "action-btn p-0.5 rounded",
                      feedback === 'up'
                        ? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20"
                        : "text-content-muted hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20"
                    )}
                    title="Good response"
                  >
                    <ThumbsUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFeedback(f => f === 'down' ? null : 'down')}
                    className={cn(
                      "action-btn p-0.5 rounded",
                      feedback === 'down'
                        ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20"
                        : "text-content-muted hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                    )}
                    title="Poor response"
                  >
                    <ThumbsDown className="h-3 w-3" />
                  </button>
                </>
              )}

              {/* Delete button */}
              {!compact && onDeleteMessage && (
                showDeleteConfirm ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1 transition-colors px-2 py-0.5 bg-red-50 rounded"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="text-xs text-content-secondary hover:text-content transition-colors px-2 py-0.5"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="text-xs text-content-muted hover:text-red-600 flex items-center gap-1 transition-colors"
                    title="Delete message"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )
              )}
            </div>
          )}

          {/* ── Inline Action Cards — mobile-first, one-tap actions on assistant responses ── */}
          {!isUser && !compact && visibleText.length > 80 && (
            <div className="flex flex-wrap gap-1.5 mt-2 lg:mt-1.5">
              <button
                type="button"
                onClick={() => {
                  try {
                    const memos = JSON.parse(localStorage.getItem('nodebench_saved_memos') || '[]');
                    memos.push({ id: `memo_${Date.now()}`, text: visibleText.slice(0, 2000), savedAt: new Date().toISOString() });
                    localStorage.setItem('nodebench_saved_memos', JSON.stringify(memos));
                    toast?.('Saved to Memo');
                  } catch { /* silent */ }
                }}
                className="inline-flex items-center gap-1 rounded-md border border-[#d97757]/25 bg-[#d97757]/8 px-2.5 py-1.5 text-[11px] font-medium text-[#d97757] hover:bg-[#d97757]/15 active:scale-[0.97] transition-all min-h-[32px]"
              >
                <Bookmark className="h-3 w-3" />
                Save Memo
              </button>
              <button
                type="button"
                onClick={() => {
                  const shareData = { title: 'NodeBench Analysis', text: visibleText.slice(0, 500) };
                  if (navigator.share) { void navigator.share(shareData); }
                  else { void navigator.clipboard.writeText(visibleText.slice(0, 2000)); toast?.('Copied to clipboard'); }
                }}
                className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-white/50 hover:bg-white/[0.06] hover:text-white/70 active:scale-[0.97] transition-all min-h-[32px]"
              >
                <Share2 className="h-3 w-3" />
                Share
              </button>
              <button
                type="button"
                onClick={() => {
                  const deeperPrompt = `Go deeper on this analysis. Expand on the key findings and add risk assessment:\n\n${visibleText.slice(0, 500)}`;
                  const input = document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="Message"]');
                  if (input) { input.value = deeperPrompt; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); }
                }}
                className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-white/50 hover:bg-white/[0.06] hover:text-white/70 active:scale-[0.97] transition-all min-h-[32px]"
              >
                <Search className="h-3 w-3" />
                Go Deeper
              </button>
            </div>
          )}
        </div>
      </div>

      {/* User Avatar - Show on RIGHT side for user messages */}
      {isUser && (
        <div className="flex-shrink-0">
          <div className="w-7 h-7 rounded-full bg-surface-secondary border border-edge flex items-center justify-center">
            <User className="h-3.5 w-3.5 text-content-secondary" />
          </div>
        </div>
      )}
    </AIMessage>
  );
}
