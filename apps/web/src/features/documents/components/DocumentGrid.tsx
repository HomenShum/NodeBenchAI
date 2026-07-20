import { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from "react";
import { Id } from "../../../../convex/_generated/dataModel";
import { DocumentView } from "@/features/documents/views/DocumentView";
import { X, ZoomIn, ZoomOut, Maximize2, Calendar } from "lucide-react";
import GridLayout, { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import clsx from "clsx";
import { useContextPills } from "@/hooks/contextPills";
import { FileTypeIcon } from "@/shared/components/FileTypeIcon";
import { inferFileType, type FileType } from "@/lib/fileTypes";
import { getThemeForFileType } from "@/lib/documentThemes";
import TaskEditorPanel from "@/features/calendar/components/TaskEditorPanel";

interface GridTabBase {
  title: string;
  color: string;
  position: number;
}

export type GridTab =
  | (GridTabBase & { kind: "document"; id: Id<"documents"> })
  | (GridTabBase & { kind: "task"; id: Id<"userEvents"> });

interface DocumentGridProps {
  openTabs: GridTab[];
  onCloseTab: (tabId: GridTab["id"]) => void;
  onReorderTabs: (newOrder: GridTab[]) => void;
  selectedTabId?: GridTab["id"] | null;
  onTabSelect?: (tabId: GridTab["id"]) => void;
  fullscreenTabId?: GridTab["id"] | null;
  onToggleFullscreen?: (tabId: GridTab["id"]) => void;
}

// Color system (no changes)
const getDocumentColors = (index: number) => {
    const colorIndex = index % 12;
    const backgroundColors = [ 'bg-indigo-600/10', 'bg-[var(--accent-secondary)]/10', 'bg-indigo-600/8', 'bg-[var(--accent-secondary)]/8', 'bg-indigo-600/12', 'bg-[var(--accent-secondary)]/12', 'bg-indigo-600/6', 'bg-[var(--accent-secondary)]/6', 'bg-indigo-600/14', 'bg-[var(--accent-secondary)]/14', 'bg-indigo-600/9', 'bg-[var(--accent-secondary)]/9', ];
    const dotColors = [ 'bg-blue-500', 'bg-indigo-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-cyan-500', 'bg-red-500', 'bg-yellow-500', 'bg-indigo-500', 'bg-rose-500', 'bg-indigo-500', 'bg-lime-500', ];
    const borderColors = [ 'border-indigo-500/20', 'border-[var(--accent-secondary)]/20', 'border-indigo-500/20', 'border-[var(--accent-secondary)]/20', 'border-indigo-500/20', 'border-[var(--accent-secondary)]/20', 'border-indigo-500/20', 'border-[var(--accent-secondary)]/20', 'border-indigo-500/20', 'border-[var(--accent-secondary)]/20', 'border-indigo-500/20', 'border-[var(--accent-secondary)]/20', ];
    const outlineColors = [ 'rgb(79, 70, 229)', 'var(--accent-secondary)', 'rgb(79, 70, 229)', 'var(--accent-secondary)', 'rgb(79, 70, 229)', 'var(--accent-secondary)', 'rgb(79, 70, 229)', 'var(--accent-secondary)', 'rgb(79, 70, 229)', 'var(--accent-secondary)', 'rgb(79, 70, 229)', 'var(--accent-secondary)', ];
    return { background: backgroundColors[colorIndex], dot: dotColors[colorIndex], border: borderColors[colorIndex], outlineColor: outlineColors[colorIndex] };
};
  
const generateStretchingLayout = (
  docs: GridTab[],
  totalGridCols: number,
  totalGridRows: number
): Layout[] => {
  const docCount = docs.length;
  if (docCount === 0) return [];

  const numCols = Math.ceil(Math.sqrt(docCount));
  const numRows = Math.ceil(docCount / numCols);

  const baseItemH = Math.floor(totalGridRows / numRows);
  const baseItemW = Math.floor(totalGridCols / numCols);

  return docs.map((doc, i) => {
    const rowIndex = Math.floor(i / numCols);
    const colIndex = i % numCols;

    const isLastRow = rowIndex === numRows - 1;
    const isLastColInRow = colIndex === numCols - 1 || i === docCount - 1;

    const yPos = rowIndex * baseItemH;
    const xPos = colIndex * baseItemW;
    
    const itemH = isLastRow ? totalGridRows - yPos : baseItemH;
    const itemW = isLastColInRow ? totalGridCols - xPos : baseItemW;

    return {
      i: doc.id as string,
      x: xPos,
      y: yPos,
      w: itemW,
      h: itemH,
    };
  });
}

export function DocumentGrid({ openTabs, onCloseTab, onReorderTabs, selectedTabId, onTabSelect, fullscreenTabId, onToggleFullscreen }: DocumentGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [isMaxDocsWarningDismissed, setMaxDocsWarningDismissed] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 1200, height: 800 });
  const [documentZoomStates, setDocumentZoomStates] = useState<Record<string, { scale: number }>>({});
  const [isContainerMeasured, setIsContainerMeasured] = useState(false);
  const { setViewingDocs, addPreviouslyViewed } = useContextPills();
  
  // Constants moved to top to ensure proper initialization order
  const TOTAL_GRID_COLS = 12;
  const TOTAL_GRID_ROWS = 24;
  const MARGIN_Y = 8;
  const PADDING_Y = 8;
  
  const tabsToRender = openTabs.slice(0, 16);
  const isOverLimit = openTabs.length > 16;
  const showMaxDocsWarning = isOverLimit && !isMaxDocsWarningDismissed;

  // Type guard to narrow to document tabs
  const isDocumentTab = (t: GridTab): t is Extract<GridTab, { kind: "document" }> => t.kind === "document";

  // Enhanced container size effect with proper initialization (layout effect to avoid initial flash)
  useLayoutEffect(() => {
    const updateSize = () => {
      const el = containerRef.current;
      if (!el) return;
      const newSize = { width: el.offsetWidth, height: el.offsetHeight };
      setContainerSize(newSize);
      setIsContainerMeasured(true);
    };

    // Measure ASAP after mount with retries if ref isn't ready yet
    let cancelled = false;
    let attempts = 0;
    const rafMeasure = () => {
      if (cancelled) return;
      const el = containerRef.current;
      if (el) {
        updateSize();
        return;
      }
      if (attempts < 10) {
        attempts += 1;
        requestAnimationFrame(rafMeasure);
      } else {
        // Fallback: avoid infinite spinner even if no size yet
        setIsContainerMeasured(true);
      }
    };
    const rafId = requestAnimationFrame(rafMeasure);

    // Observe container size changes
    let ro: ResizeObserver | null = null;
    if (typeof window !== 'undefined' && typeof (window as any).ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        updateSize();
      });
      if (containerRef.current) ro.observe(containerRef.current);
    }

    // Window resize & load fallbacks
    const onResize = () => updateSize();
    const onLoad = () => updateSize();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', onResize);
      window.addEventListener('load', onLoad);
    }

    return () => {
      cancelAnimationFrame(rafId);
      cancelled = true;
      if (ro) ro.disconnect();
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('load', onLoad);
      }
    };
  }, []);

  // Calculate and set layouts when documents or container changes (before paint)
  useLayoutEffect(() => {
    const docsToRender = openTabs.slice(0, 16);
    const newLayouts = generateStretchingLayout(
      docsToRender,
      TOTAL_GRID_COLS,
      TOTAL_GRID_ROWS
    );
    setLayouts(newLayouts);
  }, [
    openTabs,
    containerSize.width,
    containerSize.height,
    isContainerMeasured
  ]);

  // Calculate row height - moved to useMemo for performance
  const calculatedRowHeight = useMemo(() => {
    if (!isContainerMeasured || containerSize.height === 0) {
      return 1;
    }
    
    const availableHeight = containerSize.height - (PADDING_Y * 2) - ((TOTAL_GRID_ROWS - 1) * MARGIN_Y);
    return Math.max(1, availableHeight / TOTAL_GRID_ROWS);
  }, [containerSize.height, isContainerMeasured]);

  // Stable key to force GridLayout remount when measurement or document IDs change
  const gridKey = useMemo(() => {
    return tabsToRender.map((d) => d.id).join("|");
  }, [tabsToRender]);

  // Ensure we always provide a valid layout on first render after measurement
  const effectiveLayouts = useMemo(() => {
    if (tabsToRender.length === 0) return [];
    if (layouts.length === tabsToRender.length) return layouts;
    return generateStretchingLayout(
      tabsToRender,
      TOTAL_GRID_COLS,
      TOTAL_GRID_ROWS
    );
  }, [layouts, tabsToRender, TOTAL_GRID_COLS, TOTAL_GRID_ROWS]);

  // Update Context Pills with currently viewed documents in grid
  useEffect(() => {
    if (tabsToRender.length > 0) {
      // Only include documents in viewing pills
      const docTabs = tabsToRender.filter(isDocumentTab);
      setViewingDocs(docTabs.map(d => ({ id: d.id, title: d.title })));
    } else {
      setViewingDocs([]);
    }
  }, [tabsToRender, setViewingDocs]);

  // Track previously viewed when selection changes
  useEffect(() => {
    if (selectedTabId) {
      const tab = openTabs.find(d => d.id === selectedTabId);
      if (tab && tab.kind === "document") addPreviouslyViewed({ id: tab.id, title: tab.title });
    }
  }, [selectedTabId, openTabs, addPreviouslyViewed]);

  // Remove horizontal gaps when showing a single document so it fills the grid
  const isSingleDoc = tabsToRender.length === 1;
  const gridMargin: [number, number] = useMemo(() => [isSingleDoc ? 0 : 8, MARGIN_Y], [isSingleDoc, MARGIN_Y]);
  const gridPadding: [number, number] = useMemo(() => [isSingleDoc ? 0 : PADDING_Y, PADDING_Y], [isSingleDoc, PADDING_Y]);

  // Add styles effect
  useEffect(() => {
    const styleId = 'react-grid-layout-custom-styles';
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .react-grid-item {
        transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
        touch-action: none;
      }
      .react-grid-item.cssTransforms {
        transition-property: transform;
      }
      .react-grid-item.resizing {
        z-index: 100;
        transition: none;
      }
      .react-grid-item.react-grid-placeholder {
        background: rgba(59, 130, 246, 0.1);
        border: 1px dashed rgba(59, 130, 246, 0.3);
        border-radius: 8px;
        transition: all 120ms cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 2;
      }
      /* Fix for button interactions */
      .document-grid-item .document-controls {
        pointer-events: auto;
      }
      .document-grid-item .document-content {
        pointer-events: auto;
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      const existingStyle = document.getElementById(styleId);
      if (existingStyle) document.head.removeChild(existingStyle);
    };
  }, []);

  const handleLayoutChange = useCallback((newLayout: Layout[]) => {
    // Prevent infinite loops by checking if we have valid documents and layout
    if (!openTabs.length || !newLayout.length) {
      return;
    }
    
    // Only process layout changes for documents that actually exist in the new layout
    const validLayoutItems = newLayout.filter(item => 
      openTabs.some(doc => doc.id === item.i)
    );
    
    if (validLayoutItems.length === 0) {
      return;
    }
    
    const docsOnScreen = openTabs.slice(0, 16);
    const docsOffScreen = openTabs.slice(16);
    
    // Only sort documents that have corresponding layout items
    const sortedOnScreenDocs = [...docsOnScreen]
      .filter(doc => validLayoutItems.some(item => item.i === doc.id))
      .sort((a, b) => {
        const layoutA = validLayoutItems.find(l => l.i === a.id);
        const layoutB = validLayoutItems.find(l => l.i === b.id);
        if (!layoutA || !layoutB) return 0;
        if (layoutA.y !== layoutB.y) return layoutA.y - layoutB.y;
        return layoutA.x - layoutB.x;
      });
    
    const finalOrderedDocs = [...sortedOnScreenDocs, ...docsOffScreen]
      .map((doc, index) => ({ ...doc, position: index }));
    
    // Only trigger reorder if there's actually a meaningful change in order
    const currentOrder = openTabs.map(d => d.id).join(',');
    const newOrder = finalOrderedDocs.map(d => d.id).join(',');
    
    if (currentOrder !== newOrder && finalOrderedDocs.length === openTabs.length) {
      onReorderTabs(finalOrderedDocs);
    }
  }, [openTabs, onReorderTabs]);
  
  useEffect(() => { if (!isOverLimit) { setMaxDocsWarningDismissed(false); } }, [isOverLimit]);

  // Handle fullscreen toggle with proper event isolation
  const handleFullscreenClick = useCallback((tabId: GridTab["id"], event: React.MouseEvent) => {
    // Completely stop all event propagation to prevent conflicts with grid layout
    event.preventDefault();
    event.stopPropagation();
    // Note: stopImmediatePropagation is not available on React SyntheticEvent
    
    
    if (onToggleFullscreen) {
      onToggleFullscreen(tabId);
    } else {
      console.error('onToggleFullscreen is not provided!');
    }
  }, [onToggleFullscreen]);

  // Handle close with proper event isolation
  const handleCloseClick = useCallback((tabId: GridTab["id"], event: React.MouseEvent) => {
    // Completely stop all event propagation to prevent conflicts with grid layout
    event.preventDefault();
    event.stopPropagation();
    // Note: stopImmediatePropagation is not available on React SyntheticEvent
    
    
    if (onCloseTab) {
      onCloseTab(tabId);
    } else {
      console.error('onCloseTab is not provided!');
    }
  }, [onCloseTab]);

  // Zoom control handlers
  const handleZoomIn = useCallback((documentId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    setDocumentZoomStates(prev => {
      const current = prev[documentId]?.scale || 1;
      const newScale = Math.min(current + 0.25, 3); // Max zoom 3x
      return {
        ...prev,
        [documentId]: { scale: newScale }
      };
    });
  }, []);

  const handleZoomOut = useCallback((documentId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    setDocumentZoomStates(prev => {
      const current = prev[documentId]?.scale || 1;
      const newScale = Math.max(current - 0.25, 0.25); // Min zoom 0.25x
      return {
        ...prev,
        [documentId]: { scale: newScale }
      };
    });
  }, []);

  const handleZoomToFit = useCallback((documentId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    setDocumentZoomStates(prev => ({
      ...prev,
      [documentId]: { scale: 0.8 } // Default zoom to fit scale
    }));
  }, []);

  // Handle document content click separately to avoid conflicts
  const handleDocumentContentClick = useCallback((tab: GridTab, event: React.MouseEvent) => {
    // Only trigger document select if clicking on the content area, not buttons
    if (!event.defaultPrevented) {
      onTabSelect?.(tab.id);
    }
  }, [onTabSelect]);

  if (openTabs.length === 0) { 
    return ( 
      <div className="flex items-center justify-center h-full"> 
        <div className="text-center max-w-md"> 
          <div className="w-16 h-16 bg-surface-secondary rounded-full flex items-center justify-center mx-auto mb-4"> 
            <svg className="h-8 w-8 text-content-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"> 
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /> 
            </svg> 
          </div> 
          <h2 className="text-base font-semibold text-content mb-2">No tabs open</h2> 
          <p className="text-content-secondary">Select documents or tasks from the sidebar to view them in the grid.</p> 
        </div> 
      </div> 
    ); 
  }
  
  if (fullscreenTabId) { 
    const fullscreenTab = openTabs.find(doc => doc.id === fullscreenTabId); 
    if (fullscreenTab) { 
      const lowerTitle = fullscreenTab.title.toLowerCase();
      const isCalendarDoc = fullscreenTab.kind === "document" && (lowerTitle.includes("calendar") || lowerTitle.includes("schedule"));
      return ( 
        <div className="h-full w-full p-2"> 
          <div className="h-full w-full bg-surface rounded-lg border border-edge shadow-sm overflow-hidden"> 
            <div className="bg-surface/95 backdrop-blur-md border-b border-edge">
              <div className="flex items-center justify-between px-4 py-3"> 
                <div className="flex items-center gap-3">
                  <div className={clsx("w-3 h-3 rounded-full shadow-sm", isCalendarDoc ? "bg-amber-500" : "bg-indigo-600")} />
                  <span className="text-lg font-semibold text-content">{fullscreenTab.title}</span>
                  <span className="text-sm text-content-secondary bg-surface-secondary px-2 py-1 rounded-md">Fullscreen</span>
                </div> 
                <div className="flex items-center gap-2"> 
                  <button 
                    onClick={(e) => handleFullscreenClick(fullscreenTab.id, e)}
                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    className="flex-shrink-0 w-6 h-6 rounded-full bg-surface-secondary hover:bg-blue-500 flex items-center justify-center transition-all group/minimize" 
                    aria-label="Exit fullscreen" 
                    title="Exit fullscreen"
                    type="button"
                  >
                    <svg className="h-4 w-4 text-content-muted group-hover/minimize:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" transform="rotate(45 12 12)" />
                    </svg>
                  </button> 
                  <button 
                    onClick={(e) => handleCloseClick(fullscreenTab.id, e)}
                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    className="flex-shrink-0 w-6 h-6 rounded-full bg-surface-secondary hover:bg-red-500 flex items-center justify-center transition-all group/close" 
                    aria-label="Close document"
                    type="button"
                  >
                    <X className="h-4 w-4 text-content-muted group-hover/close:text-white transition-colors" />
                  </button> 
                </div> 
              </div> 
            </div> 
            <div className="h-[calc(100%-60px)]">
              <div className="h-full overflow-hidden bg-surface">
                {fullscreenTab.kind === "document" ? (
                  <DocumentView documentId={fullscreenTab.id} />
                ) : (
                  <TaskEditorPanel taskId={fullscreenTab.id} embedded onClose={() => onCloseTab?.(fullscreenTab.id)} />
                )}
              </div>
            </div> 
          </div> 
        </div> 
      ); 
    } 
  }

  // Until we've measured, render a lightweight placeholder to avoid mounting children at 0x0
  if (!isContainerMeasured) {
    return (
      <div ref={containerRef} className="h-full w-full relative min-h-0">
        <div className="flex items-center justify-center h-full">
          <div className="motion-safe:animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500/30"></div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full relative min-h-0">
      <GridLayout
        key={gridKey}
        className="layout"
        layout={effectiveLayouts}
        onLayoutChange={handleLayoutChange}
        cols={TOTAL_GRID_COLS}
        rowHeight={calculatedRowHeight}
        width={containerSize.width}
        margin={gridMargin}
        containerPadding={gridPadding}
        compactType="vertical"
        isResizable={false}
        isDraggable={tabsToRender.length > 1}
        draggableCancel=".document-controls, .document-controls *"
      >
        {tabsToRender.map((tab, index) => {
          const isSelected = selectedTabId === tab.id;
          const isFullscreen = fullscreenTabId === tab.id;
          const colors = getDocumentColors(index);
          const lowerTitle = tab.title.toLowerCase();
          const isCalendarDoc = tab.kind === "document" && (lowerTitle.includes("calendar") || lowerTitle.includes("schedule"));
          const typeGuess: FileType = inferFileType({ name: tab.title });
          const theme = getThemeForFileType(typeGuess);
          const dotClass = isCalendarDoc ? "bg-amber-500" : colors.dot;
          
          return (
            <div
              key={tab.id}
              className={clsx(
                'document-grid-item group relative overflow-hidden cursor-pointer transition-all duration-200 ease-out',
                isFullscreen ? (
                  clsx(
                    'rounded-lg border-2',
                    colors.background,
                    colors.border,
                    isCalendarDoc && 'ring-2 ring-amber-400/40 bg-gradient-to-br from-amber-50/10 to-transparent',
                    'hover:outline hover:outline-2 hover:outline-offset-[-1px]',
                    {
                      'outline outline-2 outline-offset-[-1px] shadow-lg': isSelected,
                    }
                  )
                ) : (
                  clsx(
                    'rounded-lg border border-transparent bg-transparent',
                    // Apply subtle hybrid theming for non-calendar docs
                    !isCalendarDoc && `${theme.ring} ${theme.gradient}`,
                    isCalendarDoc && 'ring-1 ring-amber-400/30 bg-gradient-to-br from-amber-50/10 to-transparent',
                    'hover:bg-surface-hover hover:border-edge',
                    {
                      'bg-surface-hover border-edge': isSelected,
                    }
                  )
                )
              )}
              style={isFullscreen ? { '--outline-color': colors.outlineColor } as React.CSSProperties : {}}
            >
              {/* Title bar for grid mode */}
              <div className="absolute top-0 left-0 right-0 z-20 bg-surface/90 backdrop-blur-sm border-b border-edge/30">
                <div className="flex items-center justify-between px-2 py-1">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className={`w-1.5 h-1.5 rounded-full ${dotClass} flex-shrink-0`} />
                    <span className="text-xs font-medium text-content truncate">{tab.title}</span>
                  </div>
                  
                  {/* Control buttons - always visible on hover */}
                  <div className="document-controls flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    {/* Zoom Controls */}
                    <button 
                      onClick={(e) => handleZoomOut(tab.id, e)}
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                      className="flex-shrink-0 w-4 h-4 rounded bg-surface-secondary/90 hover:bg-green-500 flex items-center justify-center transition-all group/zoomout shadow-sm" 
                      aria-label="Zoom out" 
                      title="Zoom Out"
                      type="button"
                    >
                      <ZoomOut className="h-2 w-2 text-content-muted group-hover/zoomout:text-white transition-colors" />
                    </button>
                    <button 
                      onClick={(e) => handleZoomToFit(tab.id, e)}
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                      className="flex-shrink-0 w-4 h-4 rounded bg-surface-secondary/90 hover:bg-purple-500 flex items-center justify-center transition-all group/zoomfit shadow-sm" 
                      aria-label="Zoom to fit" 
                      title="Zoom to Fit"
                      type="button"
                    >
                      <Maximize2 className="h-2 w-2 text-content-muted group-hover/zoomfit:text-white transition-colors" />
                    </button>
                    <button 
                      onClick={(e) => handleZoomIn(tab.id, e)}
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                      className="flex-shrink-0 w-4 h-4 rounded bg-surface-secondary/90 hover:bg-green-500 flex items-center justify-center transition-all group/zoomin shadow-sm" 
                      aria-label="Zoom in" 
                      title="Zoom In"
                      type="button"
                    >
                      <ZoomIn className="h-2 w-2 text-content-muted group-hover/zoomin:text-white transition-colors" />
                    </button>
                    <button 
                      onClick={(e) => handleFullscreenClick(tab.id, e)}
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                      className="flex-shrink-0 w-4 h-4 rounded bg-surface-secondary/90 hover:bg-blue-500 flex items-center justify-center transition-all group/expand shadow-sm" 
                      aria-label="Expand fullscreen" 
                      title="Expand fullscreen"
                      type="button"
                    >
                      <svg className="h-2.5 w-2.5 text-content-muted group-hover/expand:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                      </svg>
                    </button>
                    <button 
                      onClick={(e) => handleCloseClick(tab.id, e)}
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                      className="flex-shrink-0 w-4 h-4 rounded bg-surface-secondary/90 hover:bg-red-500 flex items-center justify-center transition-all group/close shadow-sm" 
                      aria-label="Close document" 
                      title="Close document"
                      type="button"
                    >
                      <X className="h-2.5 w-2.5 text-content-muted group-hover/close:text-white transition-colors" />
                    </button>
                  </div>
                </div>
              </div>
              {isCalendarDoc ? (
                <Calendar className="document-card__bg document-row__bg h-8 w-8 text-amber-400 rotate-12" />
              ) : (
                <span className={`document-card__bg document-row__bg ${theme.watermarkText}`}>
                  <FileTypeIcon type={typeGuess} className="h-8 w-8 rotate-12" />
                </span>
              )}
              
              {/* Content area with proper event handling */}
              <div className={clsx(
                'h-full overflow-hidden bg-surface',
                isFullscreen ? 'pt-10' : 'pt-6'
              )}>
                <div 
                  className="document-content relative h-full" 
                  onClick={(e) => handleDocumentContentClick(tab, e)}
                  style={{
                    transform: `scale(${documentZoomStates[tab.id]?.scale || 1})`,
                    transformOrigin: 'top left',
                    width: documentZoomStates[tab.id]?.scale 
                      ? `${100 / documentZoomStates[tab.id].scale}%` 
                      : '100%',
                    height: documentZoomStates[tab.id]?.scale 
                      ? `${100 / documentZoomStates[tab.id].scale}%` 
                      : '100%',
                  }}
                >
                  {tab.kind === "document" ? (
                    <DocumentView 
                      documentId={tab.id} 
                      isGridMode={true}
                      isFullscreen={isFullscreen}
                    />
                  ) : (
                    <TaskEditorPanel taskId={tab.id} embedded onClose={() => onCloseTab?.(tab.id)} />
                  )}
                  {/* Selection indicators */}
                  {isSelected && !isFullscreen && (
                    <div className="absolute top-1 left-1 z-10">
                      <div className="w-2 h-2 bg-blue-500 rounded-full shadow-sm" />
                    </div>
                  )}
                  {isSelected && isFullscreen && (
                    <div className="absolute top-2 right-2 z-10">
                      <div className="w-3 h-3 bg-indigo-600 rounded-full shadow-sm motion-safe:animate-pulse" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </GridLayout>
      
      {/* Warning modal */}
      {showMaxDocsWarning && ( 
        <div className="absolute inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity" onClick={() => setMaxDocsWarningDismissed(true)}> 
          <div className="bg-surface rounded-lg p-6 shadow-2xl border border-edge max-w-sm text-center" onClick={e => e.stopPropagation()}> 
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-yellow-100 mb-4"> 
              <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg> 
            </div> 
            <h3 className="text-lg font-semibold text-content">Maximum Tabs Reached</h3> 
            <p className="mt-2 text-sm text-content-secondary"> You have {openTabs.length} tabs open, but a single grid can only display 16. Please create a new grid panel to open more. </p> 
            <button onClick={() => setMaxDocsWarningDismissed(true)} className="btn-primary-sm mt-6 w-full py-2 px-4" > OK </button> 
          </div> 
        </div> 
      )}
    </div>
  );
}
