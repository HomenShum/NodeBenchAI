import React, { Suspense, useState, useEffect } from 'react';
import { useQuery, useAction } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { Id } from '../../../../convex/_generated/dataModel';
import { ErrorBoundary } from "@shared/components/ErrorBoundary";
import {
  FileText,
  Image as ImageIcon,
  FileVideo,
  FileAudio,
  File,
  Download,
  Eye,
  Loader2,
  AlertCircle,
  Table,
  Sparkles,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  StretchHorizontal,
  StretchVertical,
  Code2,
  ArrowLeft,
} from 'lucide-react';
import type * as XLSX from 'xlsx';
import { CodeViewer } from '../components/CodeViewer';

const UnifiedEditor = React.lazy(() => import("@features/editor/components/UnifiedEditor"));
const Spreadsheet = React.lazy(() => import('react-spreadsheet'));


// Build a display matrix from a worksheet, expanding merged cells so content shows up
type XlsxModule = typeof import('xlsx');
function wsToDisplayAOA(ws: XLSX.WorkSheet, XLSX: XlsxModule): string[][] {
  const ref = (ws as any)['!ref'] || 'A1';
  const R = XLSX.utils.decode_range(ref);
  const rows = R.e.r - R.s.r + 1;
  const cols = R.e.c - R.s.c + 1;
  const out: string[][] = Array.from({ length: rows }, () => Array(cols).fill(""));
  // Fill from cells
  for (const addr in ws) {
    if (!Object.prototype.hasOwnProperty.call(ws, addr)) continue;
    if (addr[0] === '!') continue;
    const cell: any = (ws as any)[addr];
    const pos = XLSX.utils.decode_cell(addr);
    const rr = pos.r - R.s.r;
    const cc = pos.c - R.s.c;
    if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) {
      const v = cell?.v;
      out[rr][cc] = v != null ? String(v) : "";
    }
  }
  // Expand merges for display
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = (ws as any)['!merges'] || [];
  for (const m of merges) {
    const vCell: any = (ws as any)[XLSX.utils.encode_cell(m.s)];
    const v = vCell?.v;
    if (v == null) continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        const rr = r - R.s.r;
        const cc = c - R.s.c;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) {
          out[rr][cc] = String(v);
        }
      }
    }
  }
  return out;
}


interface FileViewerProps {
  documentId: Id<"documents">;
  className?: string;
  onGoBack?: () => void;
}

export const FileViewer: React.FC<FileViewerProps> = ({ documentId, className = "", onGoBack }) => {
  const fileDocument = useQuery(api.domains.documents.fileDocuments.getFileDocument, { documentId });
  const analyzeWithGenAI = useAction(api.domains.documents.fileAnalysis.analyzeFileWithGenAI);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Shared configurable analysis prompt (matches SpreadsheetView behavior)
  const DEFAULT_ANALYSIS_PROMPT = `Analyze this file to extract structured tags and context.
- Domain/Subject area (e.g., finance, AI research)
- Key topics/themes (bullet list)
- Key people and organizations (with roles)
- Important entities (products, projects, places)
- Relationships between entities (who/what is related to whom/what, how)
- Timeline or phases if present
Return concise Markdown with sections and bullet lists. Avoid verbosity.`;
  const [analysisPrompt, setAnalysisPrompt] = useState<string>(() =>
    localStorage.getItem('nb:fileAnalysisPrompt') || DEFAULT_ANALYSIS_PROMPT
  );
  const [savePromptDefault, setSavePromptDefault] = useState(false);
  const [showPromptPopover, setShowPromptPopover] = useState(false);
  const handleOpenAnalysisPopover = () => setShowPromptPopover((s) => !s);
  const handleCloseAnalysisPopover = () => setShowPromptPopover(false);

  // Zoom controls for PDF/Image/Video
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3;
  const ZOOM_STEP = 0.1;
  const [zoom, setZoom] = useState(1);
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit');
  const [fitAxis, setFitAxis] = useState<'height' | 'width'>('height');
  const canZoom = !!fileDocument && (fileDocument.document.fileType === 'pdf' || fileDocument.document.fileType === 'image' || fileDocument.document.fileType === 'video');
  const isImageOrVideo = !!fileDocument && (fileDocument.document.fileType === 'image' || fileDocument.document.fileType === 'video');
  const zoomIn = () => { setZoomMode('manual'); setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))); };
  // Spreadsheet data (for CSV/Excel inline preview)
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [sheetData, setSheetData] = useState<any[][] | null>(null);

  const zoomOut = () => { setZoomMode('manual'); setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))); };
  const zoomFit = () => { setZoomMode('fit'); setZoom(1); };

  // Multi-sheet support for spreadsheet previews
  const [sheetList, setSheetList] = useState<Array<{ name: string; data: any[][] }>>([]);
  const [activeSheet, setActiveSheet] = useState(0);

  // Code content is now managed by CodeViewer component
  // We just need to track if we have a code file for type resolution



  const handleRunAnalysis = async () => {
    try {
      if (!fileDocument?.file?._id) return;
      setIsAnalyzing(true);
      if (savePromptDefault) {
        try { localStorage.setItem('nb:fileAnalysisPrompt', analysisPrompt); } catch { /* noop */ }
      }
      const res: any = await analyzeWithGenAI({
        fileId: fileDocument.file._id,
        analysisPrompt,
        analysisType: fileDocument.document.fileType || "document",
      });
      const analysisText: string = (res && res.analysis) ? res.analysis : (fileDocument.file.analysis || "");
      const md = `### AI Analysis for ${fileDocument.file.fileName}\n\n${analysisText}`;
      try {
        window.dispatchEvent(new CustomEvent('nodebench:applyActions', {
          detail: { actions: [{ type: 'createNode', markdown: md }] },
        }));
      } catch { /* noop */ }
      try {
        window.dispatchEvent(new CustomEvent('nodebench:generateTags', {
          detail: { documentId },
        }));
      } catch { /* noop */ }
    } catch (e) {
      alert('Failed to analyze file with Gemini. Please try again.');
    } finally {
      setIsAnalyzing(false);
      setShowPromptPopover(false);
    }
  };


  // Ensure PDFs use "fit" by default, or a specific zoom percent in manual mode
  const withPdfZoom = (url: string, mode: 'fit' | number) => {
    try {
      const sep = url.includes('#') ? '&' : '#';
      if (mode === 'fit') return `${url}${sep}zoom=page-fit`;
      const percent = Math.max(10, Math.min(500, Math.round(mode)));
      return `${url}${sep}zoom=${percent}`;
    } catch {
      return url;
    }
  };

  // Load CSV data when file is a CSV (and hydrate unified sheetData)
  useEffect(() => {
    if (fileDocument?.file && fileDocument.document.fileType === 'csv' && fileDocument.storageUrl) {
      setSheetLoading(true);
      setSheetError(null);
      setSheetData(null);

      fetch(fileDocument.storageUrl)
        .then((response: Response) => response.text())
        .then((csvText: string) => {
          try {
            const lines = csvText.split('\n').filter((line: string) => line.trim());
            if (lines.length === 0) {
              throw new Error('Empty CSV file');
            }

            const headers = lines[0].split(',').map((h: string) => h.trim().replace(/"/g, ''));
            const rows = lines.slice(1).map((line: string) =>
              line.split(',').map((cell: string) => cell.trim().replace(/"/g, ''))
            );

            const data = [headers, ...rows].map((r: string[]) => r.map((c: string) => ({ value: String(c ?? '') })));
            setSheetList([{ name: 'Sheet1', data }]);
            setActiveSheet(0);
            setSheetData(data);
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Failed to parse CSV';
            setSheetError(msg);
          }
        })
        .catch(() => {
          setSheetError('Failed to load CSV file');
        })
        .finally(() => {
          setSheetLoading(false);
        });
    }
  }, [fileDocument]);
  // Load Excel data when file is an Excel spreadsheet (by type or extension)
  useEffect(() => {
    if (!fileDocument?.file || !fileDocument?.storageUrl) return;
    const name = (fileDocument.file.fileName || '').toLowerCase();
    const isExcel = (fileDocument.document.fileType === 'excel') || /\.xlsx?$/.test(name);
    if (!isExcel) return;
    setSheetLoading(true);
    setSheetError(null);
    setSheetData(null);
    void (async () => {
      try {
        const resp = await fetch(fileDocument.storageUrl!);
        const buf = await resp.arrayBuffer();
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buf, { type: 'array' });
        const sheets = wb.SheetNames.map((name: string) => {
          const ws = wb.Sheets[name] as unknown as XLSX.WorkSheet;
          const aoa = wsToDisplayAOA(ws, XLSX);
          const data = aoa.map(r => r.map(c => ({ value: c })));
          return { name, data };
        });
        setSheetList(sheets);
        setActiveSheet(0);
        setSheetData(sheets[0]?.data ?? null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to load Excel';
        setSheetError(msg);
      } finally {
        setSheetLoading(false);
      }
    })();

  }, [fileDocument]);

  // Code content loading is now handled by CodeViewer component


  if (!fileDocument) {
    return (
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <div className="flex items-center gap-2 text-content-muted">
          <Loader2 strokeWidth={1.25} className="h-4 w-4 motion-safe:animate-spin" />
          Loading file...
        </div>
      </div>
    );
  }

  const { document, file, storageUrl } = fileDocument;
  // Resolve file type using stored type or filename extension
  const fileNameLower = String(file?.fileName || document.title || '').toLowerCase();
  const resolvedType: string = (() => {
    // Detect code/web files FIRST (by extension) - this takes priority
    if (/\.(html?|jsx?|tsx?|css|scss|json|xml|ya?ml|md|py|rb|go|rs|java|c|cpp|h|hpp|swift|kt|sh|bash|sql)$/.test(fileNameLower)) return 'code';

    const ft = String(document.fileType || '').toLowerCase();
    if (["csv", "excel", "image", "video", "audio", "pdf"].includes(ft)) return ft;
    if (fileNameLower.endsWith('.xlsx') || fileNameLower.endsWith('.xls')) return 'excel';
    if (fileNameLower.endsWith('.csv')) return 'csv';
    if (fileNameLower.endsWith('.pdf')) return 'pdf';
    if (/\.(png|jpg|jpeg|webp|gif|svg)$/.test(fileNameLower)) return 'image';
    if (/\.(mp4|mov|webm|avi|mkv)$/.test(fileNameLower)) return 'video';
    if (/\.(mp3|wav|m4a|aac|flac|ogg)$/.test(fileNameLower)) return 'audio';
    return ft || 'file';
  })();

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (fileType: string) => {
    // Align viewer accents to shared tokens while preserving semantic error/media colors.
    switch (fileType) {
      case 'csv':
      case 'excel':
        return <Table className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />;
      case 'image':
        return <ImageIcon className="h-8 w-8 text-cyan-500" />;
      case 'video':
        return <FileVideo className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />;
      case 'audio':
        return <FileAudio className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />;
      case 'pdf':
        return <FileText className="h-8 w-8 text-red-500" />;
      case 'text':
        return <FileText className="h-8 w-8 text-content-secondary" />;
      case 'code':
        return <Code2 className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />;
      default:
        return <File className="h-8 w-8 text-content-muted" />;
    }
  };

  const renderFileContent = () => {
    switch (resolvedType) {
      case 'csv':
      case 'excel':
        return renderSpreadsheetContent();
      case 'image':
        return renderImageContent();
      case 'pdf':
        return renderPDFContent();
      case 'text':
        return renderTextContent();
      case 'video':
        return renderVideoContent();
      case 'audio':
        return renderAudioContent();
      case 'code':
        return renderCodeContent();
      default:
        return renderGenericContent();
    }
  };

  // Code viewer using the reusable CodeViewer component
  const renderCodeContent = () => {
    const fileName = file?.fileName || document.title || 'code.txt';
    return (
      <CodeViewer
        url={storageUrl}
        fileName={fileName}
        className="w-full h-full"
      />
    );
  };

  const renderSpreadsheetContent = () => {
    if (sheetLoading) {
      return (
        <div className="flex items-center justify-center h-32">
          <div className="flex items-center gap-2 text-content-muted">
            <Loader2 strokeWidth={1.25} className="h-4 w-4 motion-safe:animate-spin" />
            Loading spreadsheet...
          </div>
        </div>
      );
    }

    if (sheetError) {
      return (
        <div className="flex items-center justify-center h-32">
          <div className="flex items-center gap-2 text-red-500">
            <AlertCircle strokeWidth={1.25} className="h-4 w-4" />
            {sheetError}
          </div>
        </div>
      );
    }

    const currentData = sheetList.length > 0 ? (sheetList[activeSheet]?.data ?? null) : sheetData;
    if (!currentData) return null;

    return (
      <div className="w-full h-full min-h-0">
        {/* Sheet tabs for Excel workbooks */}
        {sheetList.length > 1 && (
          <div className="flex items-center gap-2 px-2 py-1 border-b border-edge overflow-x-auto">
            {sheetList.map((s, i) => (
              <button
                key={`${s.name}-${i}`}
                onClick={() => setActiveSheet(i)}
                className={`px-2 py-1 text-xs rounded-md whitespace-nowrap ${i === activeSheet ? 'bg-surface-secondary border border-edge text-content' : 'hover:bg-surface-hover text-content-secondary'}`}
                title={s.name}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="w-full h-[calc(100%-2rem)] overflow-auto rounded-lg border border-edge bg-surface p-2">
          <Suspense
            fallback={
              <div className="flex items-center gap-2 text-content-muted p-2">
                <Loader2 strokeWidth={1.25} className="h-4 w-4 motion-safe:animate-spin" />
                Loading spreadsheet...
              </div>
            }
          >
            <Spreadsheet data={currentData} />
          </Suspense>
        </div>
      </div>
    );
  };

  const renderImageContent = () => {
    if (!storageUrl) return renderGenericContent();

    return (
      <div className="w-full h-full min-h-0 overflow-auto flex items-center justify-center">
        <div
          className={
            zoomMode === 'fit'
              ? (fitAxis === 'height' ? "inline-block h-full" : "inline-block w-full")
              : "inline-block"
          }
          style={zoomMode === 'manual' ? { transform: `scale(${zoom})`, transformOrigin: 'center' } : undefined}
        >
          <img
            src={storageUrl}
            alt={file.fileName}
            className={
              zoomMode === 'fit'
                ? (fitAxis === 'height'
                  ? "h-full w-auto object-contain rounded-lg border border-edge"
                  : "w-full h-auto object-contain rounded-lg border border-edge")
                : "max-w-none max-h-none object-contain rounded-lg border border-edge"
            }
          />
        </div>
      </div>
    );
  };

  const renderPDFContent = () => {
    if (!storageUrl) return renderGenericContent();

    return (
      <div className="w-full h-full min-h-0">
        <iframe
          src={zoomMode === 'fit' ? withPdfZoom(storageUrl, 'fit') : withPdfZoom(storageUrl, Math.round(zoom * 100))}
          className="w-full h-full border border-edge rounded-lg"
          title={file.fileName}
        />
      </div>
    );
  };

  const renderTextContent = () => {
    if (!storageUrl) return renderGenericContent();

    return (
      <div className="w-full h-full min-h-0">
        <iframe
          src={storageUrl}
          className="w-full h-full border border-edge rounded-lg bg-surface"
          title={file.fileName}
        />
      </div>
    );
  };

  const renderVideoContent = () => {
    if (!storageUrl) return renderGenericContent();

    return (
      <div className="w-full h-full min-h-0 overflow-auto flex items-center justify-center bg-black rounded-lg border border-edge">
        <div
          className={
            zoomMode === 'fit'
              ? (fitAxis === 'height' ? "inline-block h-full" : "inline-block w-full")
              : "inline-block"
          }
          style={zoomMode === 'manual' ? { transform: `scale(${zoom})`, transformOrigin: 'center' } : undefined}
        >
          <video
            controls
            className={
              zoomMode === 'fit'
                ? (fitAxis === 'height'
                  ? "h-full w-auto object-contain rounded-lg"
                  : "w-full h-auto object-contain rounded-lg")
                : "max-w-none max-h-none rounded-lg"
            }
          >
            <source src={storageUrl} type={document.mimeType} />
            Your browser does not support the video tag.
          </video>
        </div>
      </div>
    );
  };

  const renderAudioContent = () => {
    if (!storageUrl) return renderGenericContent();

    return (
      <div className="flex justify-center">
        <audio
          controls
          className="w-full max-w-md"
        >
          <source src={storageUrl} type={document.mimeType} />
          Your browser does not support the audio tag.
        </audio>
      </div>
    );
  };

  const renderGenericContent = () => {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-4">
        {getFileIcon(resolvedType || 'unknown')}
        <div className="text-center">
          <p className="text-sm text-content-secondary mb-2">
            Preview not available for this file type
          </p>
          {storageUrl && (
            <a
              href={storageUrl}
              download={file.fileName}
              className="inline-flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:text-indigo-300 transition-colors"
            >
              <Download className="h-4 w-4" />
              Download {file.fileName}
            </a>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`w-full h-full bg-surface ${className}`}>
      <div className="flex h-full flex-col">
        {/* Fixed header (constrained width to match app header) */}
        <div className="border-b border-edge">
          <div className="max-w-4xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (onGoBack) {
                      onGoBack();
                    } else {
                      // Fallback: dispatch event for parent to handle
                      window.dispatchEvent(new CustomEvent('nodebench:goBack'));
                    }
                  }}
                  className="p-2 rounded-lg border border-edge hover:bg-surface-hover transition-colors mr-2"
                  title="Go back"
                  aria-label="Go back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                {getFileIcon(resolvedType || 'unknown')}
                <div>
                  <h3 className="text-lg font-medium text-content">
                    {document.title}
                  </h3>
                  <div className="flex items-center gap-4 text-xs text-content-muted">
                    <span>{formatFileSize(file.fileSize)}</span>
                    <span>{document.mimeType}</span>
                    {document.lastModified && (
                      <span>
                        Modified {new Date(document.lastModified).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {canZoom && (
                  <div className="flex items-center gap-1 rounded-lg border border-edge bg-surface/80 backdrop-blur-sm p-1">
                    <button type="button" onClick={zoomOut} className="p-1 rounded-md hover:bg-surface-hover" title="Zoom out" aria-label="Zoom out" disabled={zoomMode === 'manual' ? zoom <= ZOOM_MIN : false}>
                      <ZoomOut strokeWidth={1.25} className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={zoomFit} className="p-1 rounded-md hover:bg-surface-hover" title="Fit to view" aria-label="Fit to view">
                      <RotateCcw strokeWidth={1.25} className="h-4 w-4" />
                    </button>
                    {isImageOrVideo && (
                      <>
                        <button type="button" onClick={() => { setFitAxis('height'); setZoomMode('fit'); }} className={`p-1 rounded-md ${fitAxis === 'height' && zoomMode === 'fit' ? 'bg-indigo-600/10 text-indigo-600 dark:text-indigo-400' : 'hover:bg-surface-hover text-content-secondary'}`} title="Fit height" aria-label="Fit height">
                          <StretchVertical strokeWidth={1.25} className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => { setFitAxis('width'); setZoomMode('fit'); }} className={`p-1 rounded-md ${fitAxis === 'width' && zoomMode === 'fit' ? 'bg-indigo-600/10 text-indigo-600 dark:text-indigo-400' : 'hover:bg-surface-hover text-content-secondary'}`} title="Fit width" aria-label="Fit width">
                          <StretchHorizontal strokeWidth={1.25} className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    <button type="button" onClick={zoomIn} className="p-1 rounded-md hover:bg-surface-hover" title="Zoom in" aria-label="Zoom in" disabled={zoomMode === 'manual' ? zoom >= ZOOM_MAX : false}>
                      <ZoomIn strokeWidth={1.25} className="h-4 w-4" />
                    </button>
                    <span className="ml-1 text-xs text-content-secondary px-1 py-0.5 rounded bg-surface-secondary/70">
                      {zoomMode === 'fit' ? (isImageOrVideo ? `Fit (${fitAxis === 'height' ? 'H' : 'W'})` : 'Fit') : `${Math.round(zoom * 100)}%`}
                    </span>
                  </div>
                )}

                <div className="relative">
                  <button
                    type="button"
                    onClick={handleOpenAnalysisPopover}
                    disabled={isAnalyzing}
                    className="p-2 rounded-lg border border-edge hover:bg-surface-hover transition-colors disabled:opacity-60"
                    title="Analyze with AI and add to Quick notes"
                    aria-label="Analyze file with AI"
                  >
                    {isAnalyzing ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  </button>
                  {showPromptPopover && (
                    <div className="absolute z-20 right-0 mt-2 w-[360px] bg-surface border border-edge rounded-lg shadow-lg p-3" role="dialog" aria-label="File analysis prompt">
                      <div className="text-sm font-medium mb-2 text-content">Analysis prompt</div>
                      <textarea
                        className="w-full h-28 text-xs p-2 rounded border border-edge bg-surface-secondary text-content"
                        value={analysisPrompt}
                        onChange={(e) => setAnalysisPrompt(e.target.value)}
                      />
                      <div className="mt-2 flex items-center justify-between">
                        <label className="flex items-center gap-2 text-xs text-content-muted">
                          <input type="checkbox" checked={savePromptDefault} onChange={(e) => setSavePromptDefault(e.target.checked)} />
                          Remember as default
                        </label>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={handleCloseAnalysisPopover} className="px-2 py-1 text-xs rounded border border-edge hover:bg-surface-hover">Cancel</button>
                          <button type="button" onClick={() => void handleRunAnalysis()} className="px-2 py-1 text-xs rounded bg-[var(--accent-primary)] text-white hover:opacity-90">Analyze</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {storageUrl && (
                  <>
                    <button
                      type="button"
                      onClick={() => window.open(storageUrl, '_blank')}
                      className="p-2 rounded-lg border border-edge hover:bg-surface-hover transition-colors"
                      title="Open in new tab"
                      aria-label="Open in new tab"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <a
                      href={storageUrl}
                      download={file.fileName}
                      className="p-2 rounded-lg border border-edge hover:bg-surface-hover transition-colors"
                      title="Download file"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Mobile-first single-column content surface */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4 sm:px-6">
            <section className="min-h-[420px] overflow-hidden rounded-2xl border border-edge bg-surface-secondary/40 p-4">
              <div className="h-full min-h-[360px] overflow-hidden">
                {renderFileContent()}
              </div>
            </section>
            <section className="rounded-2xl border border-edge bg-surface p-4">
              <div className="mb-3">
                <h4 className="text-sm font-medium text-content">Quick notes</h4>
                <p className="mt-1 text-xs text-content-secondary">
                  Keep notes stacked under the file so mobile never falls back to a split-pane layout.
                </p>
              </div>
              <div className="min-h-[240px]">
                  <ErrorBoundary title="Failed to load notes">
                    <Suspense fallback={<div className="text-xs text-content-secondary">Loading editor…</div>}>
                      <UnifiedEditor documentId={documentId} mode="quickNote" autoCreateIfEmpty />
                    </Suspense>
                  </ErrorBoundary>
                </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileViewer;
