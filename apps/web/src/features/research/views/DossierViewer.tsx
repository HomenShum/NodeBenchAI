import { useQuery, useAction, useMutation } from "convex/react";
import { useRef, useState, useMemo, useEffect, useCallback, Suspense, lazy } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { PanelGroup, Panel, PanelResizeHandle, type ImperativePanelGroupHandle, type ImperativePanelHandle } from "react-resizable-panels";
import { ChevronLeft, ChevronRight, Sparkles, Loader2, Video, Image as ImageIcon, FileText, Maximize2, Edit3, LayoutList, Search, Home, ChevronDown, Filter, SortAsc, ExternalLink } from "lucide-react";
import { DossierMediaGallery } from "@/features/research/components/dossier/DossierMediaGallery";
import { extractMediaFromTipTap, countMediaAssets, type TipTapDocument } from "@/features/research/components/dossier/tipTapMediaExtractor";
import { ErrorBoundary } from "@shared/components/ErrorBoundary";
import type { VideoAsset, ImageAsset, DocumentAsset } from "@/features/research/components/dossier/mediaExtractor";
import { FocusSyncProvider } from "@/features/research/contexts/FocusSyncContext";
import { useDossierAgentHandlers } from "@/features/research/hooks/useDossierAgentHandlers";
import { isValidConvexId } from "@/lib/ids";

const UnifiedEditor = lazy(() => import("@features/editor/components/UnifiedEditor"));

type ViewMode = 'split' | 'unified';

type DossierViewerVariant = 'classic' | 'newspaper';

interface DossierViewerProps {
  documentId: Id<"documents">;
  isGridMode?: boolean;
  isFullscreen?: boolean;
  /**
   * Layout variant:
   * - classic: existing split/unified dossier layout
   * - newspaper: Daily-Prophet/WSJ-inspired layout (used on ResearchHub only)
   */
  variant?: DossierViewerVariant;
}

/**
 * DossierViewer - Flexible viewer for dossier documents with rich media
 *
 * Two view modes:
 * - Split Panel Mode (default): Left panel shows media gallery (65%), right panel shows transcript (35%)
 * - Unified Editor Mode: Full-width editable UnifiedEditor for direct content editing
 */
export function DossierViewer({ documentId, isGridMode = false, isFullscreen = false, variant = 'classic' }: DossierViewerProps) {
  // Validate id before issuing any Convex query. When invalid, skip the query entirely.
  const isValidId = isValidConvexId(documentId);
  const document = useQuery(api.domains.documents.documents.getById, isValidId ? { documentId } : "skip");

  const linkedAssets = useQuery(api.domains.documents.documents.getLinkedAssets, isValidId ? { dossierId: documentId } : "skip");
  const analyzeSelectedFilesIntoDossier = useAction(api.domains.ai.metadataAnalyzer.analyzeSelectedFilesIntoDossier);

  // Get or create Quick Notes document (separate from main dossier)
  const [quickNotesDocId, setQuickNotesDocId] = useState<Id<"documents"> | null>(null);
  const getOrCreateQuickNotes = useMutation(api.domains.documents.documents.getOrCreateQuickNotes);

  // Fetch or create quick notes on mount
  useEffect(() => {
    if (isValidId && !quickNotesDocId) {
      getOrCreateQuickNotes({ dossierId: documentId })
        .then((doc: any) => {
          if (doc) {
            setQuickNotesDocId(doc._id);
          } else {
            // Quick notes not available (e.g., public dossier without edit permissions)
          }
        })
        .catch((error: any) => {
          console.error('[DossierViewer] Failed to get or create quick notes:', error);
          // Don't show error to user - quick notes are optional
        });
    }
  }, [documentId, quickNotesDocId, getOrCreateQuickNotes]);

  // View mode state - default to split for classic UX, with localStorage persistence
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem('nb:dossierViewMode');
      if (saved && ['split', 'unified'].includes(saved)) {
        return saved as ViewMode;
      }
    } catch (error) {
      console.error('Failed to load view mode:', error);
    }
    return 'split';
  });

  // Save view mode to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem('nb:dossierViewMode', viewMode);
    } catch (error) {
      console.error('Failed to save view mode:', error);
    }
  }, [viewMode]);

  // Panel state - Horizontal (left/right)
  const DEFAULT_H_LAYOUT = [65, 35] as const;
  const hGroupRef = useRef<ImperativePanelGroupHandle>(null);
  const researchPanelRef = useRef<ImperativePanelHandle>(null);
  const lastResearchSizeRef = useRef<number>(DEFAULT_H_LAYOUT[1]);
  const [researchCollapsed, setResearchCollapsed] = useState(false);

  // Media highlighting
  const [highlightedSection, setHighlightedSection] = useState<'videos' | 'images' | 'documents' | null>(null);

  // Analysis state
  const [showAnalysisPopover, setShowAnalysisPopover] = useState(false);

  // Dossier agent handlers for bidirectional focus sync
  const {
    handleChartPointClick,
    handleSectionAskAI,
    handleDossierAnalysis,
  } = useDossierAgentHandlers({
    briefId: documentId,
    documentTitle: document?.title ?? "Dossier",
  });
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [analysisPrompt, setAnalysisPrompt] = useState('');
  const [savePromptDefault, setSavePromptDefault] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });

  // Filter and search state for Classic view
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'videos' | 'images' | 'documents'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'type'>('newest');

  const onHorizontalLayout = (sizes: number[]) => {
    const rightPanelSize = sizes[1] ?? 0;
    // Only save the size if panel is NOT collapsed (so we can restore to it later)
    if (rightPanelSize >= 5) {
      lastResearchSizeRef.current = rightPanelSize;
    }
    setResearchCollapsed(rightPanelSize < 5);
  };

  const resetHorizontal = () => {
    hGroupRef.current?.setLayout?.([...DEFAULT_H_LAYOUT]);
  };

  const toggleResearch = () => {
    const size = researchPanelRef.current?.getSize?.() ?? 0;
    if (size < 5) {
      const target = lastResearchSizeRef.current || DEFAULT_H_LAYOUT[1];
      hGroupRef.current?.setLayout?.([Math.max(0, 100 - target), Math.min(100, target)]);
      researchPanelRef.current?.expand?.();
    } else {
      lastResearchSizeRef.current = size;
      researchPanelRef.current?.collapse?.();
    }
  };

  // Load default analysis prompt from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nb:dossierAnalysisPrompt');
      setAnalysisPrompt(
        saved || 'Analyze this content from the dossier and provide key insights, patterns, and actionable recommendations.'
      );
    } catch {
      setAnalysisPrompt('Analyze this content from the dossier and provide key insights, patterns, and actionable recommendations.');
    }
  }, []);

  // Parse TipTap content
  let tipTapContent: TipTapDocument | null = null;
  try {
    if (typeof document?.content === "string") {
      const parsed = JSON.parse(document.content);
      // Check if it's TipTap format (has type: "doc")
      if (parsed.type === "doc" && Array.isArray(parsed.content)) {
        tipTapContent = parsed as TipTapDocument;
      }
    }
  } catch (error) {
    console.error("Failed to parse dossier content:", error);
  }

  // Extract media assets from TipTap document
  const extractedMedia = useMemo(() => extractMediaFromTipTap(tipTapContent), [tipTapContent]);

  // Also extract linked assets from Convex (child docs under this dossier)
  const linkedMedia = useMemo(() => {
    const videos: VideoAsset[] = [];
    const images: ImageAsset[] = [];
    const documents: DocumentAsset[] = [];

    (linkedAssets ?? []).forEach((asset: any) => {
      const md = asset?.assetMetadata;
      const title: string = asset?.title || '';
      if (!md || !md.sourceUrl) return;

      const url: string = md.sourceUrl;
      switch (md.assetType) {
        case 'youtube': {
          // Parse videoId similar to mediaExtractor
          let videoId = '';
          if (url.includes('youtube.com/watch?v=')) {
            videoId = url.split('v=')[1]?.split('&')[0] || '';
          } else if (url.includes('youtu.be/')) {
            videoId = url.split('youtu.be/')[1]?.split('?')[0] || '';
          } else if (url.includes('youtube.com/embed/')) {
            videoId = url.split('embed/')[1]?.split('?')[0] || '';
          }
          if (videoId) {
            videos.push({
              type: 'youtube',
              videoId,
              url: `https://www.youtube.com/watch?v=${videoId}`,
              thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
              title,
            });
          }
          break;
        }
        case 'image': {
          images.push({ type: 'image', url, caption: title, alt: title });
          break;
        }
        default: {
          // Treat other asset types as document links (pdf, sec-document, news, file, video)
          documents.push({ type: 'document', url, title: title || url, thumbnail: md.thumbnailUrl });
        }
      }
    });

    return { videos, images, documents };
  }, [linkedAssets]);

  // Map asset sourceUrl -> linked asset documentId for server action
  const assetDocIdByUrl = useMemo(() => {
    const m = new Map<string, Id<"documents">>();
    (linkedAssets ?? []).forEach((asset: any) => {
      const url = asset?.assetMetadata?.sourceUrl;
      if (url) m.set(url, asset._id as Id<"documents">);
    });
    return m;
  }, [linkedAssets]);

  // Merge both sources
  const mergedMedia = useMemo(() => ({
    videos: [...extractedMedia.videos, ...linkedMedia.videos],
    images: [...extractedMedia.images, ...linkedMedia.images],
    documents: [...extractedMedia.documents, ...linkedMedia.documents],
  }), [extractedMedia, linkedMedia]);

  const mediaCounts = useMemo(() => countMediaAssets(mergedMedia), [mergedMedia]);

  // Build selectable file list from merged media
  const selectableFiles = useMemo(() => {
    const files: Array<{ id: string; type: 'video' | 'image' | 'document'; title: string; asset: VideoAsset | ImageAsset | DocumentAsset }> = [];

    mergedMedia.videos.forEach((video, idx) => {
      files.push({
        id: `video-${idx}`,
        type: 'video',
        title: video.title || video.caption || `Video ${idx + 1}`,
        asset: video,
      });
    });

    mergedMedia.images.forEach((image, idx) => {
      files.push({
        id: `image-${idx}`,
        type: 'image',
        title: image.caption || image.alt || `Image ${idx + 1}`,
        asset: image,
      });
    });

    mergedMedia.documents.forEach((doc, idx) => {
      files.push({
        id: `document-${idx}`,
        type: 'document',
        title: doc.title || `Document ${idx + 1}`,
        asset: doc,
      });
    });

    return files;
  }, [mergedMedia]);

  // Handle analysis
  const handleAnalyze = async () => {
    if (selectedFiles.size === 0) {
      alert('Please select at least one file to analyze');
      return;
    }

    // Save prompt if requested
    if (savePromptDefault) {
      try {
        localStorage.setItem('nb:dossierAnalysisPrompt', analysisPrompt);
      } catch (error) {
        console.error('Failed to save prompt:', error);
      }
    }

    setIsAnalyzing(true);
    setAnalysisProgress({ current: 0, total: selectedFiles.size });

    // Build selected list and map to linked asset documentIds via sourceUrl
    const selectedFilesList = Array.from(selectedFiles).map(id =>
      selectableFiles.find(f => f.id === id)!
    );

    const docIds = selectedFilesList
      .map(f => {
        const url = (f.asset as any)?.url;
        const docId = url ? assetDocIdByUrl.get(url) : undefined;
        return docId;
      })
      .filter((x): x is Id<'documents'> => Boolean(x));

    if (docIds.length === 0) {
      alert('No linked assets with document references to analyze.');
      setIsAnalyzing(false);
      return;
    }

    try {
      await analyzeSelectedFilesIntoDossier({
        dossierId: documentId,
        documentIds: docIds,
        maxParallel: 5,
      });

      setShowAnalysisPopover(false);
      setSelectedFiles(new Set());
      setAnalysisProgress({ current: docIds.length, total: docIds.length });
    } catch (error) {
      console.error('Analysis failed:', error);
      alert('Analysis failed. Please try again.');
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress({ current: 0, total: 0 });
    }
  };

  const toggleSelectAll = () => {
    if (selectedFiles.size === selectableFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(selectableFiles.map(f => f.id)));
    }
  };

  // Helper function to render text content with marks
  const renderContent = (content: any[] | undefined): React.ReactNode => {
    if (!content) return null;
    return content.map((node, idx) => {
      if (node.type === 'text') {
        let text = node.text || '';
        if (node.marks) {
          for (const mark of node.marks) {
            if (mark.type === 'bold') text = <strong key={idx}>{text}</strong>;
            if (mark.type === 'italic') text = <em key={idx}>{text}</em>;
            if (mark.type === 'code') text = <code key={idx} className="bg-surface-secondary px-1 rounded">{text}</code>;
            if (mark.type === 'link') {
              const href = mark.attrs?.href;
              const isLocalDocument = href?.startsWith('/documents/');

              if (isLocalDocument) {
                // Local document link - handle with single/double click
                const docId = href.split('/documents/')[1] as Id<"documents">;
                text = (
                  <a
                    key={idx}
                    href={href}
                    className="text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                    onClick={(e) => handleDocumentLinkClick(docId, e)}
                  >
                    {text}
                  </a>
                );
              } else {
                // External link - open in new tab
                text = (
                  <a
                    key={idx}
                    href={href}
                    className="text-indigo-600 dark:text-indigo-400 hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {text}
                  </a>
                );
              }
            }
          }
        }
        return <span key={idx}>{text}</span>;
      }
      return null;
    });
  };

  // Helper function to render TipTap nodes as read-only content
  const renderTipTapNode = (node: any): React.ReactNode => {
    switch (node.type) {
      case 'heading': {
        const level = node.attrs?.level || 1;
        const HeadingTag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        return <HeadingTag className={`text-${4 - level}xl font-bold mb-2`}>{renderContent(node.content)}</HeadingTag>;
      }

      case 'paragraph':
        return <p className="mb-2">{renderContent(node.content)}</p>;

      case 'blockquote':
        return <blockquote className="border-l-4 border-indigo-500/30 pl-4 italic my-4">{renderContent(node.content)}</blockquote>;

      case 'codeBlock':
        return <pre className="bg-surface-secondary p-4 rounded my-4 overflow-x-auto"><code>{renderContent(node.content)}</code></pre>;

      case 'video': {
        const videoUrl = node.attrs?.url;
        if (videoUrl && videoUrl.includes('youtube')) {
          const videoId = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
          if (videoId) {
            return (
              <div className="my-4 aspect-video">
                <iframe
                  width="100%"
                  height="100%"
                  src={`https://www.youtube.com/embed/${videoId}`}
                  title="YouTube video"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            );
          }
        }
        return <div className="text-content-muted my-2">Video: {videoUrl}</div>;
      }

      case 'image':
        return <img src={node.attrs?.url} alt={node.attrs?.caption || 'Image'} className="max-w-full h-auto my-4 rounded" />;

      case 'file':
        return (
          <a href={node.attrs?.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline my-2 block">
            📄 {node.attrs?.name || node.attrs?.caption || 'Download file'}
          </a>
        );

      default:
        return null;
    }
  };

  // Click handler for document links with single/double click detection
  const handleDocumentLinkClick = useCallback((docId: Id<"documents">, e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();

    const target = e.currentTarget;
    const clickCount = (e.detail || 1);

    if (clickCount === 1) {
      // Single click - show mini popover
      // Use the existing nodebench:showMentionPopover event that MainLayout listens to
      // Add data attribute so MainLayout can find the anchor element
      target.setAttribute('data-document-id', docId);

      window.dispatchEvent(
        new CustomEvent('nodebench:showMentionPopover', {
          detail: {
            documentId: docId
          }
        })
      );
    } else if (clickCount >= 2) {
      // Double click - open full document
      window.dispatchEvent(
        new CustomEvent('nodebench:openDocument', {
          detail: { documentId: docId }
        })
      );
    }
  }, []);

  // Loading state
  if (!document) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 motion-safe:animate-spin text-indigo-600 dark:text-indigo-400 mx-auto" />
          <p className="text-sm text-content-secondary">Loading report...</p>
        </div>
      </div>
    );
  }

  // Newspaper-style layout used for WelcomeLanding dossiers
  if (variant === 'newspaper') {
    return (
      <div className="h-full overflow-y-auto bg-[#f8f6f1] editorial-layout">
        <div className="max-w-[1100px] mx-auto px-6 py-8">
          <div className="bg-surface shadow-lg border border-edge">
            {/* Masthead */}
            <div className="border-b-4 border-black px-8 pt-6 pb-3">
              <div className="text-center border-b border-edge pb-3 mb-2">
                <h1 className="text-5xl font-bold tracking-tight text-black mb-1">
                  TODAY'S REPORT
                </h1>
                <p className="text-xs text-content">Research Report</p>
              </div>
              <div className="flex items-center justify-between text-xs text-content">
                <span className="tracking-wide">Vol. 1, No. 1</span>
                <span>
                  {new Date(document?._creationTime || Date.now()).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                <span className="tracking-wide">Price: Free</span>
              </div>
            </div>

            {/* Document Title */}
            <div className="px-8 pt-6 pb-4 border-b border-edge">
              <h2 className="text-3xl font-bold text-black leading-tight">
                {document?.title || 'Untitled Research'}
              </h2>
            </div>

            {/* Main Content */}
            <div className="px-8 py-6">
              <div className="prose prose-sm max-w-none">
                {tipTapContent ? (
                  <div className="text-content leading-relaxed">
                    {tipTapContent.content.map((node, idx) => (
                      <div key={idx} className="mb-4">
                        {renderTipTapNode(node)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-content-secondary italic">
                    No content available.
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="mt-6 pt-3 text-xs border-t-2 border-edge text-content">
                <p>Analyzed {mediaCounts.total} media assets • Compiled on {new Date(document?._creationTime || Date.now()).toLocaleDateString("en-US")}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // If in unified editor mode, render full-width editor
  if (viewMode === 'unified') {
    return (
      <div className="h-full flex flex-col bg-surface">
        {/* Header with view mode toggle */}
        <div className="border-b border-edge bg-surface">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold text-content">
                {document?.title || 'Untitled Report'}
              </h2>
              <div className="flex items-center gap-2 text-xs text-content-muted">
                <span>{mediaCounts.total} media assets</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewMode('split')}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded border border-edge bg-surface-secondary hover:bg-surface-hover transition-colors"
                title="Switch to classic split panel view"
              >
                <LayoutList className="h-4 w-4" />
                <span>Classic</span>
              </button>
            </div>
          </div>
        </div>

        {/* Full-width Unified Editor */}
        <div className="flex-1 overflow-hidden">
          <ErrorBoundary title="Failed to load editor">
            <Suspense fallback={<div className="text-xs text-content-secondary">Loading editor…</div>}>
              <UnifiedEditor documentId={documentId} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  // Default: Split panel mode (classic view) - Clean style without gradients
  return (
    <div className="h-full flex flex-col bg-surface-secondary relative overflow-hidden">

      {/* Modern Compact Header with Breadcrumbs */}
      <div className="border-b border-edge bg-surface shadow-sm">
        {/* Top Row: Breadcrumbs + View Toggles */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-edge">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-2 text-xs sm:text-sm text-content-secondary">
            <Home className="h-3.5 w-3.5 text-content-muted" />
            <ChevronRight className="h-3 w-3 text-content-muted" />
            <span className="text-content-muted hidden sm:inline">Reports</span>
            <ChevronRight className="h-3 w-3 text-content-muted hidden sm:inline" />
            <span className="text-content font-semibold truncate max-w-[200px] sm:max-w-xs">
              {document?.title || 'Untitled Report'}
            </span>
          </div>

          {/* View Mode Toggles */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 bg-surface-secondary rounded-lg p-0.5 border border-edge">
              <button
                type="button"
                onClick={() => setViewMode('split')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-md transition-all duration-200 ${viewMode === 'split'
                  ? 'bg-[var(--accent-primary)] text-white shadow-sm'
                  : 'text-content-secondary hover:text-content hover:bg-surface-hover'
                  }`}
                title="Classic view"
                aria-label="Switch to classic view"
              >
                <LayoutList className="h-3.5 w-3.5" />
                <span className="font-medium hidden sm:inline">Classic</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('unified')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-md transition-all duration-200 ${(viewMode as ViewMode) === 'unified'
                  ? 'bg-[var(--accent-primary)] text-white shadow-sm'
                  : 'text-content-secondary hover:text-content hover:bg-surface-hover'
                  }`}
                title="Edit mode"
                aria-label="Switch to edit mode"
              >
                <Edit3 className="h-3.5 w-3.5" />
                <span className="font-medium hidden sm:inline">Edit</span>
              </button>
            </div>
            {/* Ask AI Button */}
            <button
              type="button"
              onClick={() => handleDossierAnalysis()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
              title="Ask AI about this report"
              aria-label="Ask AI about this report"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Ask AI</span>
            </button>
          </div>
        </div>

        {/* Bottom Row: Search + Filters + Stats */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-surface-secondary/30">
          {/* Search Bar */}
          <div className="flex items-center gap-2 flex-1 sm:max-w-md">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-content-muted" />
              <input
                type="text"
                placeholder="Search media..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm bg-surface border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all placeholder:text-content-muted"
                aria-label="Search media"
              />
            </div>

            {/* Filter Dropdown */}
            <div className="relative hidden sm:block">
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 py-2 text-sm bg-surface border border-edge rounded-lg hover:bg-surface-hover transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring whitespace-nowrap"
                title="Filter by type"
                aria-label={`Filter by ${filterType}`}
              >
                <Filter className="h-4 w-4 text-content-secondary" />
                <span className="capitalize text-content-secondary">{filterType}</span>
                <ChevronDown className="h-3.5 w-3.5 text-content-muted" />
              </button>
            </div>

            {/* Sort Dropdown */}
            <div className="relative hidden sm:block">
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 py-2 text-sm bg-surface border border-edge rounded-lg hover:bg-surface-hover transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring whitespace-nowrap"
                title="Sort by"
                aria-label={`Sort by ${sortBy}`}
              >
                <SortAsc className="h-4 w-4 text-content-secondary" />
                <span className="capitalize text-content-secondary">{sortBy}</span>
                <ChevronDown className="h-3.5 w-3.5 text-content-muted" />
              </button>
            </div>
          </div>

          {/* Media Stats - Improved badges */}
          <div className="flex items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg">
              <Video className="h-4 w-4 text-red-600 dark:text-red-400" />
              <span className="font-semibold text-red-700 dark:text-red-300">{mediaCounts.videos}</span>
              <span className="text-red-600 dark:text-red-400 hidden sm:inline">videos</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-lg">
              <ImageIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="font-semibold text-blue-700 dark:text-blue-300">{mediaCounts.images}</span>
              <span className="text-blue-600 dark:text-blue-400 hidden sm:inline">images</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-lg">
              <FileText className="h-4 w-4 text-green-600 dark:text-green-400" />
              <span className="font-semibold text-green-700 dark:text-green-300">{mediaCounts.documents}</span>
              <span className="text-green-600 dark:text-green-400 hidden sm:inline">docs</span>
            </div>
          </div>
        </div>
      </div>

      {/* Modern 2x2 Grid Layout - WelcomeLanding Style */}
      <div className="flex-1 min-h-0 overflow-hidden p-3 sm:p-4 lg:p-6">
        <div className="h-full grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4 opacity-0 animate-[fadeIn_0.6s_ease-out_0.2s_forwards]">
          {/* Top Left: Videos */}
          <div className="border border-edge rounded-lg overflow-hidden flex flex-col bg-surface shadow-sm transition-all duration-300 min-h-[300px] lg:min-h-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-edge bg-surface-secondary/50">
              <h4 className="text-sm font-semibold text-content flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-red-500/10">
                  <Video className="h-4 w-4 text-red-500" />
                </div>
                <span>Videos</span>
              </h4>
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 font-medium border border-red-200 dark:border-red-500/20">
                  {mediaCounts.videos} <span className="hidden sm:inline">videos</span>
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {/* Videos */}
              {mergedMedia.videos.length > 0 ? (
                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {mergedMedia.videos.map((video, idx) => (
                      <div
                        key={idx}
                        className="group cursor-pointer rounded-lg overflow-hidden border border-edge/40 hover:border-edge/60 transition-all duration-300 pressable"
                      >
                        <div className="relative aspect-video bg-gradient-to-br from-surface-secondary to-surface-secondary">
                          <img
                            src={video.thumbnail}
                            alt={video.title || 'Video'}
                            className="w-full h-full object-cover transition-transform duration-500"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-gradient-to-br from-black/30 to-black/10 group-hover:from-black/40 group-hover:to-black/20 transition-all duration-300" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-14 h-14 rounded-full bg-red-500/90 group-hover:bg-red-500 flex items-center justify-center transition-all duration-300">
                              <svg className="h-6 w-6 text-white ml-0.5" fill="white" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </div>
                          </div>
                        </div>
                        {video.title && (
                          <div className="p-3 bg-gradient-to-r from-surface/80 to-surface-secondary/60 ">
                            <p className="text-xs font-medium text-content-secondary line-clamp-2">{video.title}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-content-muted text-sm">
                  No videos available
                </div>
              )}
            </div>
          </div>

          {/* Top Right: Images */}
          <div className="border border-edge rounded-lg overflow-hidden flex flex-col bg-surface shadow-sm transition-all duration-300 min-h-[300px] lg:min-h-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-edge bg-surface-secondary/50">
              <h4 className="text-sm font-semibold text-content flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/10">
                  <ImageIcon className="h-4 w-4 text-blue-500" />
                </div>
                <span>Images</span>
              </h4>
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium border border-blue-200 dark:border-blue-500/20">
                  {mediaCounts.images} <span className="hidden sm:inline">images</span>
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {/* Images */}
              {mergedMedia.images.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {mergedMedia.images.map((image, idx) => (
                    <div
                      key={idx}
                      className="aspect-square cursor-pointer rounded-lg overflow-hidden border border-edge/40 hover:border-edge/60 transition-all duration-300 group relative pressable"
                    >
                      <img
                        src={image.url}
                        alt={image.alt || 'Image'}
                        className="w-full h-full object-cover transition-transform duration-500"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-gradient-to-br from-black/0 to-black/20 group-hover:from-black/10 group-hover:to-black/30 transition-all duration-300" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-content-muted text-sm">
                  No images available
                </div>
              )}
            </div>
          </div>

          {/* Bottom Left: AI Chat Transcript (Read-only Main Dossier Content) */}
          <div className="border border-edge rounded-lg overflow-hidden flex flex-col bg-surface shadow-sm transition-all duration-300 min-h-[300px] lg:min-h-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-edge bg-surface-secondary/50">
              <h4 className="text-sm font-semibold text-content flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-purple-500/10">
                  <Sparkles className="h-4 w-4 text-purple-500" />
                </div>
                <span>AI Chat Transcript</span>
              </h4>
              <button
                type="button"
                onClick={() => setShowAnalysisPopover(!showAnalysisPopover)}
                disabled={isAnalyzing || selectableFiles.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-edge bg-surface hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 text-sm font-medium"
                title="Analyze files"
                aria-label="Analyze files with AI"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 motion-safe:animate-spin text-indigo-600 dark:text-indigo-400" />
                    <span className="hidden sm:inline text-content-secondary">Analyzing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    <span className="hidden sm:inline text-content-secondary">Analyze</span>
                  </>
                )}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {tipTapContent ? (
                <div className="prose prose-sm max-w-none">
                  <div className="text-content">
                    {tipTapContent.content.map((node, idx) => (
                      <div key={idx} className="mb-3">
                        {renderTipTapNode(node)}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-content-muted text-sm">
                  No transcript available
                </div>
              )}
            </div>
          </div>

          {/* Bottom Right: Quick Notes (Editable Separate Document) */}
          <div className="border border-edge rounded-lg overflow-hidden flex flex-col bg-surface shadow-sm transition-all duration-300 min-h-[300px] lg:min-h-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-edge bg-surface-secondary/50">
              <h4 className="text-sm font-semibold text-content flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/10">
                  <Edit3 className="h-4 w-4 text-blue-500" />
                </div>
                <span>Quick Notes</span>
              </h4>
            </div>
            <div className="flex-1 overflow-hidden">
              {quickNotesDocId ? (
                <ErrorBoundary title="Failed to load notes">
                  <Suspense fallback={<div className="text-xs text-content-secondary">Loading editor…</div>}>
                    <UnifiedEditor documentId={quickNotesDocId} mode="quickNote" editable={true} autoCreateIfEmpty={true} />
                  </Suspense>
                </ErrorBoundary>
              ) : (
                <div className="flex items-center justify-center h-full text-content-muted text-sm">
                  Loading quick notes...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Analysis Popover */}
      {showAnalysisPopover && (
        <AnalysisPopover
          files={selectableFiles}
          selectedFiles={selectedFiles}
          onToggleFile={(id) => {
            const newSet = new Set(selectedFiles);
            if (newSet.has(id)) {
              newSet.delete(id);
            } else {
              newSet.add(id);
            }
            setSelectedFiles(newSet);
          }}
          onToggleAll={toggleSelectAll}
          analysisPrompt={analysisPrompt}
          onPromptChange={setAnalysisPrompt}
          savePromptDefault={savePromptDefault}
          onSavePromptDefaultChange={setSavePromptDefault}
          isAnalyzing={isAnalyzing}
          progress={analysisProgress}
          onAnalyze={handleAnalyze}
          onClose={() => setShowAnalysisPopover(false)}
        />
      )}

      {/* Unified Editor Mode */}
      {(viewMode as ViewMode) === 'unified' && (
        <div className="h-full overflow-y-auto opacity-0 animate-[fadeIn_0.6s_ease-out_0.2s_forwards]">
          <div className="max-w-4xl mx-auto px-6 py-8">
            <ErrorBoundary title="Failed to load editor">
              <Suspense fallback={<div className="text-xs text-content-secondary">Loading editor…</div>}>
                <UnifiedEditor documentId={documentId} mode="full" editable={true} autoCreateIfEmpty={true} />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Analysis Popover Component
 */
interface AnalysisPopoverProps {
  files: Array<{ id: string; type: 'video' | 'image' | 'document'; title: string; asset: any }>;
  selectedFiles: Set<string>;
  onToggleFile: (id: string) => void;
  onToggleAll: () => void;
  analysisPrompt: string;
  onPromptChange: (prompt: string) => void;
  savePromptDefault: boolean;
  onSavePromptDefaultChange: (save: boolean) => void;
  onAnalyze: () => void;
  onClose: () => void;
  isAnalyzing: boolean;
  progress: { current: number; total: number };
}

function AnalysisPopover({
  files,
  selectedFiles,
  onToggleFile,
  onToggleAll,
  analysisPrompt,
  onPromptChange,
  savePromptDefault,
  onSavePromptDefaultChange,
  onAnalyze,
  onClose,
  isAnalyzing,
  progress,
}: AnalysisPopoverProps) {
  const allSelected = selectedFiles.size === files.length && files.length > 0;

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'video':
        return <Video className="h-4 w-4 text-red-600" />;
      case 'image':
        return <ImageIcon className="h-4 w-4 text-blue-600" />;
      case 'document':
        return <FileText className="h-4 w-4 text-green-600" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-label="Analyze report files">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-surface rounded-lg max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden shadow-2xl border border-edge">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-edge">
          <h3 className="font-semibold text-content">Analyze Report Files</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-surface-hover rounded-lg transition-colors"
            title="Close"
            aria-label="Close dialog"
          >
            <ChevronRight className="h-5 w-5 rotate-45" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* File Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-content">
                Select Files ({selectedFiles.size} of {files.length})
              </label>
              <button
                type="button"
                onClick={onToggleAll}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto border border-edge rounded-lg p-2">
              {files.map((file) => (
                <label
                  key={file.id}
                  className="flex items-center gap-2 p-2 hover:bg-surface-hover rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(file.id)}
                    onChange={() => onToggleFile(file.id)}
                    className="flex-shrink-0"
                  />
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {getFileIcon(file.type)}
                    <span className="text-sm text-content truncate">{file.title}</span>
                    <span className="text-xs text-[var(--text-tertiary)] bg-surface-secondary px-2 py-0.5 rounded-full flex-shrink-0">
                      {file.type}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Analysis Prompt */}
          <div>
            <label className="text-sm font-medium text-content block mb-2">
              Analysis Prompt
            </label>
            <textarea
              value={analysisPrompt}
              onChange={(e) => onPromptChange(e.target.value)}
              className="w-full h-32 p-3 border border-edge rounded-lg bg-surface text-content resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Enter your analysis prompt..."
            />
          </div>

          {/* Save Default Checkbox */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={savePromptDefault}
              onChange={(e) => onSavePromptDefaultChange(e.target.checked)}
              className="flex-shrink-0"
            />
            <span className="text-sm text-content-secondary">
              Remember as default prompt
            </span>
          </label>

          {/* Progress */}
          {isAnalyzing && (
            <div className="p-3 bg-surface-secondary rounded-lg border border-edge">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="h-4 w-4 motion-safe:animate-spin text-indigo-600 dark:text-indigo-400" />
                <span className="text-sm text-content">
                  Analyzing {progress.current} of {progress.total} files...
                </span>
              </div>
              <div className="w-full bg-surface rounded-full h-2">
                <div
                  className="bg-[var(--accent-primary)] h-2 rounded-full transition-all"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-edge">
          <button
            type="button"
            onClick={onClose}
            disabled={isAnalyzing}
            className="px-4 py-2 rounded-lg border border-edge bg-surface-secondary hover:bg-surface-hover text-content disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAnalyze}
            disabled={isAnalyzing || selectedFiles.size === 0}
            className="px-4 py-2 rounded-lg bg-[var(--accent-primary)] hover:opacity-90 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Analyze
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
