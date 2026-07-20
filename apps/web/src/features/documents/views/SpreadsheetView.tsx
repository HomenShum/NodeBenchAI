import React, { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useAction } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { Id } from '../../../../convex/_generated/dataModel';
import { toast } from 'sonner';
import {
  Loader2,
  Eye,
  Download,
  AlertCircle,
  FileSpreadsheet,
  RefreshCw,
  Save,
  FileDown,
  Star,
  Share,
  MoreHorizontal,
  Globe,
  Lock,
  WrapText,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { PresenceIndicator } from "@/shared/components/PresenceIndicator";
import { ZoomState, ZoomControls } from "@/hooks/useZoom";
import { ZoomControls as ZoomControlsComponent } from "@/shared/components/ZoomControls";
import { PanelGroup, Panel, PanelResizeHandle, type ImperativePanelGroupHandle, type ImperativePanelHandle } from "react-resizable-panels";
import { ErrorBoundary } from "@shared/components/ErrorBoundary";

import Spreadsheet from 'react-spreadsheet';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

const UnifiedEditor = React.lazy(() => import("@features/editor/components/UnifiedEditor"));


// Multi-line text editor for spreadsheet cells
const MultiLineDataEditor: React.FC<any> = ({ cell, onChange, exitEditMode }) => {
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  const [val, setVal] = React.useState<string>(String(cell?.value ?? ''));
  React.useEffect(() => { setVal(String(cell?.value ?? '')); }, [cell]);
  // Focus and select on mount
  React.useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  // Auto-resize height to content
  const autoResize = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    const scrollH = el.scrollHeight;
    const min = 36; // ~3 rows
    const max = 240; // cap growth
    el.style.height = Math.max(min, Math.min(max, scrollH)) + 'px';
  }, []);
  React.useEffect(() => { autoResize(); }, [val, autoResize]);
  return (
    <textarea
      ref={ref}
      rows={3}
      style={{ resize: 'none', width: '100%', height: 'auto', fontSize: '10px', lineHeight: '1.2', padding: '4px 6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: 'none', outline: 'none', whiteSpace: 'pre-wrap' }}
      value={val}
      onChange={(e) => { const v = e.target.value; setVal(v); onChange({ ...cell, value: v }); }}
      onInput={autoResize}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); exitEditMode(); }
      }}
      onBlur={exitEditMode}
    />
  );
};

// Build a display matrix from a worksheet, expanding merged cells so content shows up
function wsToDisplayAOA(ws: XLSX.WorkSheet): string[][] {
  const ref = (ws as any)['!ref'] || 'A1';
  const R = XLSX.utils.decode_range(ref);
  const rows = R.e.r - R.s.r + 1;
  const cols = R.e.c - R.s.c + 1;
  const out: string[][] = Array.from({ length: rows }, () => Array(cols).fill(""));
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
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = (ws as any)['!merges'] || [];
  for (const m of merges) {
    const vCell: any = (ws as any)[XLSX.utils.encode_cell(m.s)];
    const v = vCell?.v;
    if (v == null) continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        const rr = r - R.s.r;
        const cc = c - R.s.c;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out[rr][cc] = String(v);
      }
    }
  }
  return out;
}


interface SpreadsheetViewProps {
  documentId: Id<"documents">;
  isGridMode?: boolean;
  isFullscreen?: boolean;
  zoomState?: ZoomState;
  zoomControls?: ZoomControls;
}

interface CSVData {
  headers: string[];
  rows: string[][];
}

// (manual table sort/editing interfaces removed)

interface ModifiedCell {
  row: number;
  col: number;
  originalValue: string;
  newValue: string;
}

// (manual table comment interface removed)

export const SpreadsheetView: React.FC<SpreadsheetViewProps> = ({
  documentId,
  isGridMode = false,
  isFullscreen = false,
  zoomState,
  zoomControls
}) => {
  const fileDocument = useQuery(api.domains.documents.fileDocuments.getFileDocument, { documentId });
  const { document: docData, file, storageUrl } = (fileDocument ?? ({} as any));
  const isMini = isGridMode && !isFullscreen;
  const isExcelFile = (() => {
    const name = (file?.fileName || '').toLowerCase();
    return (docData?.fileType === 'excel') || /\.xlsx?$/.test(name);
  })();

  const exportCsvMutation = useMutation(api.domains.documents.files.prepareCsvExport);
  const genUploadUrl = useMutation(api.domains.documents.files.generateUploadUrl);
  const finalizeCsv = useMutation(api.domains.documents.files.finalizeCsvReplace);
  const finalizeExcel = useMutation(api.domains.documents.files.finalizeExcelReplace);



  // Document header functionality
  const updateDocument = useMutation(api.domains.documents.documents.update);
  const userId = useQuery(api.domains.auth.presence.getUserId);

  const [csvData, setCsvData] = useState<CSVData | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  // (manual table search/sort/pagination/editing state removed)

  // Advanced features state
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  // Multi-sheet support (Excel)
  const [workbookSheets, setWorkbookSheets] = useState<Array<{ name: string; csv: CSVData }>>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);

  const [saveHint, setSaveHint] = useState<'idle'|'unsaved'|'saving'|'saved'>('idle');
  const autoSaveTimer = useRef<number | null>(null);
  const lastSavedCsvStringRef = useRef<string | null>(null);

  // Document header state
  const [isEditing, setIsEditing] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [title, setTitle] = useState(fileDocument?.document?.title || '');
  const [wrapCells, setWrapCells] = useState(true);
  // File analysis (Gemini) configuration & actions
  const analyzeWithGenAI = useAction(api.domains.documents.fileAnalysis.analyzeFileWithGenAI);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisPrompt, setAnalysisPrompt] = useState<string>(
    () => localStorage.getItem('nb:fileAnalysisPrompt') || 'Analyze this spreadsheet. Provide a concise summary, key insights, data quality notes, and recommended next steps. If there are multiple sheets, note notable differences. Output Markdown only.'
  );
  const [showPromptPopover, setShowPromptPopover] = useState(false);
  const [savePromptDefault, setSavePromptDefault] = useState(true);

  const handleOpenAnalysisPopover = () => setShowPromptPopover(true);
  const handleCloseAnalysisPopover = () => setShowPromptPopover(false);

  const handleRunAnalysis = async () => {
    try {
      if (!file?._id) return;
      setIsAnalyzing(true);
      if (savePromptDefault) localStorage.setItem('nb:fileAnalysisPrompt', analysisPrompt);
      const res: any = await analyzeWithGenAI({
        fileId: file._id,
        analysisPrompt,
        analysisType: 'spreadsheet',
      });
      const analysisText: string = (res && res.analysis) ? res.analysis : '';
      const md = `### AI Analysis for ${file.fileName}\n\n${analysisText}`;
      try {
        window.dispatchEvent(new CustomEvent('nodebench:applyActions', { detail: { actions: [{ type: 'createNode', markdown: md }] } }));
      } catch {
        // Event dispatch failed
      }
      toast.success('Analysis added to Quick notes');
    } catch (e) {
      toast.error('Failed to analyze file. Check Gemini API key and try again.');
    } finally {
      setIsAnalyzing(false);
      setShowPromptPopover(false);
    }
  };

  // Local zoom (fallback when external zoomState is not provided)
  const [localScale, setLocalScale] = useState<number>(1);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      const isEditing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      if (isEditing) return; // avoid interfering with cell edits
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setLocalScale((s) => Math.min(2, +(s + 0.05).toFixed(2)));
      } else if (e.key === '-') {
        e.preventDefault();
        setLocalScale((s) => Math.max(0.5, +(s - 0.05).toFixed(2)));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // (manual table column resizing state removed)

  // Spreadsheet state
  const originalCsvRef = useRef<CSVData | null>(null);


  // Notes panel (Quick notes) layout state
  const DEFAULT_H_LAYOUT = [65, 35] as const;

  const hGroupRef = useRef<ImperativePanelGroupHandle>(null);
  const notesPanelRef = useRef<ImperativePanelHandle>(null);
  const lastNotesSizeRef = useRef<number>(DEFAULT_H_LAYOUT[1]);
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const onHorizontalLayout = (sizes: number[]) => {
    lastNotesSizeRef.current = sizes[1] ?? lastNotesSizeRef.current;
    setNotesCollapsed((sizes[1] ?? 0) < 5);
  };
  const resetHorizontal = () => { hGroupRef.current?.setLayout?.(DEFAULT_H_LAYOUT as any); };


  const toggleNotes = () => {
    const size = notesPanelRef.current?.getSize?.() ?? 0;
    if (size < 5) {
      const target = lastNotesSizeRef.current || DEFAULT_H_LAYOUT[1];
      hGroupRef.current?.setLayout?.([Math.max(0, 100 - target), Math.min(100, target)]);
      notesPanelRef.current?.expand?.();
    } else {
      lastNotesSizeRef.current = size;
      notesPanelRef.current?.collapse?.();
    }
  };

  // // NEW: Generate Workflow state
  // const [showWorkflow, setShowWorkflow] = useState(true);
  // const [companyCol, setCompanyCol] = useState<number | null>(null);
  // const [websiteCol, setWebsiteCol] = useState<number | null>(null);
  // const [industryCol, setIndustryCol] = useState<number | null>(null);
  // const [emailCol, setEmailCol] = useState<number | null>(null);
  // const [seedQuery, setSeedQuery] = useState<string>("AI startups last 7 days site:techcrunch.com OR site:news.ycombinator.com");
  // const [artifacts, setArtifacts] = useState<{
  //   rulesMd?: string;
  //   tasksMd?: string;
  //   urlsTxt?: string;
  //   prospectCsv?: string;
  // }>({});
  // const [generating, setGenerating] = useState(false);

  // (manual table comments state removed)

  // (manual table comment tooltip logic removed)

  // Update title when document changes
  useEffect(() => {
    if (fileDocument?.document?.title) {
      setTitle(fileDocument.document.title);
    }
  }, [fileDocument?.document?.title]);

  // (manual table column width initialization removed)

  // (manual table modifiedData initialization removed)

  // (manual table column resizing handlers removed)

  // Document header handlers
  const handleTitleSubmit = async () => {
    if (title.trim() !== fileDocument?.document?.title && fileDocument?.document) {
      await updateDocument({ id: fileDocument.document._id, title: title.trim() || "Untitled" });
    }
    setIsEditing(false);
  };



  const csvToString = (csv: CSVData): string => {
    // Quote all fields to safely handle commas and newlines when wrapping/multi-line editing is enabled
    return Papa.unparse([csv.headers, ...csv.rows], { quotes: true, newline: "\n" });
  };

  const computeDiff = (orig: CSVData | null, curr: CSVData): ModifiedCell[] => {
    if (!orig) {
      // Mark all non-empty cells as new
      const diffs: ModifiedCell[] = [];
      for (let r = 0; r < curr.rows.length; r++) {
        const row = curr.rows[r];
        for (let c = 0; c < Math.max(curr.headers.length, row.length); c++) {
          const nv = row[c] ?? '';
          if (nv) diffs.push({ row: r, col: c, originalValue: '', newValue: nv });
        }
      }
      return diffs;
    }
    const diffs: ModifiedCell[] = [];
    const maxRows = Math.max(orig.rows.length, curr.rows.length);
    const maxCols = Math.max(orig.headers.length, curr.headers.length);
    for (let r = 0; r < maxRows; r++) {
      for (let c = 0; c < maxCols; c++) {
        const ov = orig.rows[r]?.[c] ?? '';
        const nv = curr.rows[r]?.[c] ?? '';
        if (ov !== nv) diffs.push({ row: r, col: c, originalValue: ov, newValue: nv });
      }
    }
    return diffs;
  };

  const handleSaveChanges = useCallback(async (fromAuto: boolean = false) => {
    if (!fileDocument?.file?._id) {
      toast.error('No file to save');
      return;
    }
    setIsSaving(true);
    setSaveHint('saving');
    try {
      if (isExcelFile) {
        // Preserve workbook: load original XLSX, patch only cell values/styles on the active sheet
        if (!fileDocument.storageUrl) throw new Error('Missing storage URL for workbook');
        if (!csvData) throw new Error('Nothing to save');
        const resp = await fetch(fileDocument.storageUrl);
        const buf = await resp.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheetName = workbookSheets[activeSheetIndex]?.name || wb.SheetNames[0];
        const ws = wb.Sheets[sheetName] || XLSX.utils.aoa_to_sheet([]);
        const aoa: any[][] = [csvData.headers, ...csvData.rows];
        const rows = aoa.length;
        const cols = (aoa[0]?.length ?? 0);
        // Skip non-anchor cells inside merges when patching
        const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = (ws as any)['!merges'] || [];
        const mergedChildren = new Set<string>();
        for (const m of merges) {
          for (let rr = m.s.r; rr <= m.e.r; rr++) {
            for (let cc = m.s.c; cc <= m.e.c; cc++) {
              if (rr === m.s.r && cc === m.s.c) continue; // keep anchor
              mergedChildren.add(XLSX.utils.encode_cell({ r: rr, c: cc }));
            }
          }
        }
        // Iterate and update only values, preserving existing styles and (by default) formulas
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const addr = XLSX.utils.encode_cell({ r, c });
            if (mergedChildren.has(addr)) continue; // do not write into merged child cells
            const val = aoa[r][c];
            const prev: any = ws[addr] ?? {};
            const next: any = { ...prev };
            const isFormulaText = typeof val === 'string' && val.startsWith('=');
            if (prev.f) {
              // Preserve existing formula. If user explicitly typed a formula ("=...") replace the formula string.
              if (isFormulaText) {
                next.f = String(val).slice(1);
                delete next.v;
              }
              // else: keep formula and ignore value edit to avoid destroying formulas
            } else {
              if (isFormulaText) {
                next.f = String(val).slice(1);
                delete next.v;
              } else {
                // Assign typed value; try to coerce numeric when safe
                const num = typeof val === 'number' ? val : Number(String(val).trim());
                const isNum = typeof num === 'number' && isFinite(num) && String(val).trim() !== '' && /^-?\d+(?:\.\d+)?$/.test(String(val).trim());
                next.v = isNum ? num : (val ?? '');
                next.t = isNum ? 'n' : 's';
              }
            }
            ws[addr] = next;
          }
        }
        ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows - 1, 0), c: Math.max(cols - 1, 0) } });
        const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const uploadUrl = await genUploadUrl();
        const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const res = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        const { storageId } = await res.json();
        if (!storageId) throw new Error('Upload did not return storageId');
        await finalizeExcel({ fileId: fileDocument.file._id, newStorageId: storageId, newFileSize: blob.size });
        if (!fromAuto) toast.success(`Saved changes to ${fileDocument.file.fileName}`);
        setSaveHint('saved');
        window.setTimeout(() => setSaveHint('idle'), 1200);
      } else {
        const currentCsv = csvData;
        if (!currentCsv) {
          toast.error('Nothing to save');
          setSaveHint('idle');
          return;
        }
        const csvContent = csvToString(currentCsv);
        if (fromAuto && lastSavedCsvStringRef.current === csvContent) {
          setSaveHint('idle');
          return;
        }
        const diffs = computeDiff(originalCsvRef.current, currentCsv);
        const uploadUrl = await genUploadUrl();
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
        const res = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: blob });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        const { storageId } = await res.json();
        if (!storageId) throw new Error('Upload did not return storageId');
        await finalizeCsv({ fileId: fileDocument.file._id, newStorageId: storageId, newFileSize: blob.size, modifiedCells: diffs });
        if (!fromAuto) toast.success(`Saved ${diffs.length} changes to ${fileDocument.file.fileName}`);
        originalCsvRef.current = currentCsv;
        lastSavedCsvStringRef.current = csvContent;
        setSaveHint('saved');
        window.setTimeout(() => setSaveHint('idle'), 1200);
      }
    } catch (error) {
      console.error('Save failed:', error);
      if (!fromAuto) toast.error('Failed to save changes: ' + (error instanceof Error ? error.message : 'Unknown error'));
      setSaveHint('unsaved');
    } finally { setIsSaving(false); }
  }, [isExcelFile, csvData, fileDocument?.file?._id, fileDocument?.file?.fileName, fileDocument?.storageUrl, genUploadUrl, finalizeCsv, finalizeExcel, workbookSheets, activeSheetIndex]);

  // Keyboard shortcut: Ctrl/Cmd+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isSave = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';
      if (isSave) {
        e.preventDefault();
        void handleSaveChanges(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSaveChanges]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void handleTitleSubmit();
    if (e.key === "Escape") {
      setTitle(fileDocument?.document?.title || '');
      setIsEditing(false);
    }
  };

  const handleTogglePublic = async () => {
    if (fileDocument?.document) {
      await updateDocument({ id: fileDocument.document._id, isPublic: !fileDocument.document.isPublic });
    }
  };

  const handleToggleFavorite = async () => {
    if (fileDocument?.document) {
    }
  };

  // Load CSV data
  useEffect(() => {
    if (fileDocument?.file && fileDocument.document.fileType === 'csv' && fileDocument.storageUrl) {
      setCsvLoading(true);
      setCsvError(null);
      fetch(fileDocument.storageUrl)
        .then(response => response.text())
        .then(csvText => {
          try {
            // Let PapaParse auto-detect delimiter/newline for robustness
            const parsed = Papa.parse(csvText, {
              header: false,
              dynamicTyping: false,
              skipEmptyLines: false,
              quoteChar: '"',
              escapeChar: '"',
            }) as any;
            if (parsed.errors && parsed.errors.length > 0) {
            }
            const rowsAll = (parsed.data || []).map((r: string[]) => r.map((c: string) => (c ?? '')));
            if (rowsAll.length === 0) throw new Error('Empty CSV file');
            const headers = rowsAll[0] || [];
            const rows = rowsAll.slice(1);
            const csv: CSVData = { headers, rows };

            setCsvData(csv);
            originalCsvRef.current = csv;
            lastSavedCsvStringRef.current = Papa.unparse([headers, ...rows], { quotes: false, newline: "\n" });
          } catch (error) {
            setCsvError(error instanceof Error ? error.message : 'Failed to parse CSV');
          }
        })
        .catch(() => setCsvError('Failed to load CSV file'))
        .finally(() => setCsvLoading(false));
    }
  }, [fileDocument]);

// Load Excel workbook (multi-sheet)
useEffect(() => {
  if (fileDocument?.file && fileDocument.storageUrl) {
    const name = (fileDocument.file.fileName || '').toLowerCase();
    const isExcel = fileDocument.document.fileType === 'excel' || /\.xlsx?$/.test(name);
    if (!isExcel) return;
    setCsvLoading(true);
    setCsvError(null);
    void (async () => {
      try {
        const url = fileDocument.storageUrl as string;
        const resp = await fetch(url);
        const buf = await resp.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheets = wb.SheetNames.map((sheetName) => {
          const ws = wb.Sheets[sheetName];
          const aoa: string[][] = wsToDisplayAOA(ws);
          const headers = (aoa?.[0] ?? []).map((v: any) => String(v ?? ''));
          const dataRows = (aoa ?? []).slice(1).map((r: any[]) => (r ?? []).map((v: any) => String(v ?? '')));
          return { name: sheetName, csv: { headers, rows: dataRows } };
        });
        setWorkbookSheets(sheets);
        setActiveSheetIndex(0);
        setCsvData(sheets[0]?.csv ?? { headers: [], rows: [] });
      } catch (e) {
        console.error('Excel load failed', e);
        setCsvError(e instanceof Error ? e.message : 'Failed to load Excel workbook');
      } finally {
        setCsvLoading(false);
      }
    })();
  }
}, [fileDocument]);


  // React Spreadsheet grid will handle editing directly; autosave is triggered in onChange.


  // // Auto-map columns on load
  // useEffect(() => {
  //   if (!csvData) return;
  //   const lower = csvData.headers.map(h => h.toLowerCase());
  //   const find = (keys: string[]) => {
  //     for (let i = 0; i < lower.length; i++) {
  //       if (keys.some(k => lower[i].includes(k))) return i;
  //     }
  //     return null;
  //   };
  //   setCompanyCol(prev => prev ?? find(['company', 'name', 'org']));
  //   setWebsiteCol(prev => prev ?? find(['website', 'url', 'domain', 'link']));
  //   setIndustryCol(prev => prev ?? find(['industry', 'sector', 'category']));
  //   setEmailCol(prev => prev ?? find(['email', 'mail']));
  // }, [csvData]);

  // (manual table cell editing handlers removed)

  // (manual table commenting handlers removed)


  const handleExportCsv = async () => {
    if (!fileDocument?.file) { toast.error('No data to export'); return; }
    setIsExporting(true);
    try {
      const currentCsv = csvData;
      if (!currentCsv) { toast.error('No data to export'); return; }
      const csvContent = csvToString(currentCsv);
      const originalName = fileDocument.file.fileName;
      const baseName = originalName.replace(/\.csv$/i, '');
      const newFileName = `${baseName}_modified_${Date.now()}.csv`;

      await exportCsvMutation({ originalFileId: fileDocument.file._id, csvContent, newFileName });
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url; anchor.download = newFileName;
      window.document.body.appendChild(anchor); anchor.click();
      window.document.body.removeChild(anchor); URL.revokeObjectURL(url);
      toast.success(`Exported as ${newFileName}`);
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export CSV: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally { setIsExporting(false); }
  };

  // (manual table row/column modification helpers removed)

  // (manual table filter/sort/paginate removed)

  // // ---------- Generate Workflow helpers ----------
  // const extractUrlsFromCol = (col: number | null, rows: string[][]): string[] => {
  //   if (col === null) return [];
  //   const urlRegex = /https?:\/\/[^\s/$.?#].[^\s"]*/gi;
  //   const set = new Set<string>();
  //   for (const r of rows) {
  //     const cell = (r[col] || '').trim();
  //     if (!cell) continue;
  //     // if cell already looks like a URL, use it; else scan for URLs
  //     if (/^https?:\/\//i.test(cell)) set.add(cell);
  //     else {
  //       const found = cell.match(urlRegex);
  //       if (found) found.forEach(u => set.add(u));
  //     }
  //   }
  //   return Array.from(set);
  // };

  // const buildRulesMd = () => {
  //   const nameH = companyCol != null ? csvData?.headers[companyCol] : 'Company';
  //   const industryH = industryCol != null ? csvData?.headers[industryCol] : 'Industry';
  //   return [
  //     `# Scoring Rules`,
  //     ``,
  //     `- **Primary key**: ${nameH}`,
  //     `- **Industry field**: ${industryH}`,
  //     `- Prefer companies with recent funding, clear ICP match, and active hiring.`,
  //     `- Disqualifiers: no website, stealth with zero signal, obvious non‑ICP.`,
  //     `- Signals: blog cadence, product pages, careers page.`,
  //     ``
  //   ].join('\n');
  // };

  // const buildTasksMd = () => [
  //   `# Tasks`,
  //   ``,
  //   `1. Use Tavily MCP to search initial candidates.`,
  //   `2. Extract website + metadata; append to spreadsheet.`,
  //   `3. Score per rules; export priority list.`,
  //   `4. Save URLs to Convex; schedule daily scrape.`,
  //   ``
  // ].join('\n');

  // const buildProspectCsv = (rows: string[][]) => {
  //   const cols: number[] = [];
  //   if (companyCol != null) cols.push(companyCol);
  //   if (websiteCol != null && websiteCol !== companyCol) cols.push(websiteCol);
  //   if (industryCol != null && !cols.includes(industryCol)) cols.push(industryCol);
  //   const headers = cols.map(i => csvData?.headers[i] ?? `Col${i}`);
  //   const outRows = rows.map(r => cols.map(i => r[i] ?? ''));
  //   const toCsv = (arr: string[][]) =>
  //     [headers.join(','), ...arr.map(row => row.map(cell =>
  //       (cell.includes(',') || cell.includes('"') || cell.includes('\n')) ? `"${cell.replace(/"/g,'""')}"` : cell

  //     ).join(','))].join('\n');
  //   return toCsv(outRows);
  // };

  // const generateArtifacts = async () => {
  //   if (!csvData) return;
  //   setGenerating(true);
  //   try {
  //     const u = extractUrlsFromCol(websiteCol, csvData.rows);
  //     const urlsTxt = u.join('\n');
  //     const rulesMd = buildRulesMd();
  //     const tasksMd = buildTasksMd();
  //     const prospectCsv = buildProspectCsv(csvData.rows);
  //     setArtifacts({ rulesMd, tasksMd, urlsTxt, prospectCsv });
  //     toast.success(`Generated artifacts • ${u.length} URLs`);
  //   } catch (e: any) {
  //     toast.error(e?.message || 'Failed to generate artifacts');
  //   } finally {
  //     setGenerating(false);
  //   }
  // };

  // const downloadText = (name: string, text?: string) => {
  //   if (!text || typeof document === 'undefined') return;
  //   const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  //   const url = URL.createObjectURL(blob);
  //   const a = document.createElement('a');
  //   a.href = url; a.download = name; a.click();
  //   URL.revokeObjectURL(url);
  // };



  // ---------- RENDER ----------
  if (!fileDocument) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-content-muted">
          <Loader2 className="h-5 w-5 motion-safe:animate-spin" />
          Loading spreadsheet...
        </div>
      </div>
    );
  }






  if (csvLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-8 w-8 text-indigo-600 dark:text-indigo-400 motion-safe:animate-spin" />


          <div className="text-center">
            <p className="text-lg font-medium text-content">Loading Spreadsheet</p>
            <p className="text-sm text-content-muted">Parsing CSV data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (csvError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-red-500">
          <AlertCircle className="h-8 w-8" />
          <div className="text-center">
            <p className="text-lg font-medium">Error Loading Spreadsheet</p>
            <p className="text-sm text-content-muted">{csvError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!csvData) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <FileSpreadsheet className="h-8 w-8 text-content-muted mx-auto mb-2" />
          <p className="text-content-secondary">No spreadsheet data available</p>
        </div>
      </div>
    );
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="h-full flex flex-col">
      {/* Document header - only show in fullscreen mode or when not in grid mode */}
      {(!isGridMode || isFullscreen) && (
        <div className="border-b border-edge bg-surface">
          <div className="max-w-4xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {docData.isPublic ? (<Globe className="h-4 w-4 text-[var(--accent-green)]" />) : (<Lock className="h-4 w-4 text-content-muted" />)}
                <span className="text-sm text-content-secondary">{docData.isPublic ? "Public" : "Private"}</span>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { void handleToggleFavorite(); }} className="p-2 hover:bg-surface-hover rounded-md transition-colors" title="Favorite" aria-label="Favorite">
                  <Star className="h-4 w-4 text-content-muted" />
                </button>
                <button type="button" className="p-2 hover:bg-surface-hover rounded-md transition-colors" title="Share" aria-label="Share">
                  <Share className="h-4 w-4 text-content-secondary" />
                </button>
                <div className="relative">
                  <button type="button" onClick={() => setIsMenuOpen(!isMenuOpen)} className="p-2 hover:bg-surface-hover rounded-md transition-colors" title="More options" aria-label="More options" aria-expanded={isMenuOpen}>
                    <MoreHorizontal className="h-4 w-4 text-content-secondary" />
                  </button>
                  {isMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-edge rounded-lg shadow-lg z-10" role="dialog" aria-label="Document options">
                      <button onClick={() => { void handleTogglePublic(); setIsMenuOpen(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-surface-hover transition-colors">
                        {docData.isPublic ? "Make Private" : "Make Public"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-6 w-6 text-green-500" />
              {isEditing ? (
                <input
                  type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => { void handleTitleSubmit(); }} onKeyDown={handleKeyDown}
                  className="text-3xl font-bold text-content bg-transparent border-b-2 border-indigo-500/30 focus:outline-none flex-1"
                  autoFocus
                />

              ) : (
                <h1 className="text-3xl font-bold text-content cursor-pointer hover:bg-surface-hover px-2 py-1 rounded flex-1" onClick={() => setIsEditing(true)}>
                  {docData.title}
                </h1>
              )}
            </div>
            <div className="flex items-center justify-between mt-2 px-2">
              <div className="flex items-center gap-3">
                {userId ? (
                  <PresenceIndicator documentId={documentId} userId={userId} />
                ) : null}
                <div className="flex items-center gap-4 text-sm text-content-muted">
                  <span>{formatFileSize(file.fileSize)}</span>
                  <span>{csvData.rows.length.toLocaleString()} rows × {csvData.headers.length} columns</span>
                  <span className="text-xs opacity-80">{saveHint === 'saving' ? 'Saving…' : saveHint === 'saved' ? 'Saved' : saveHint === 'unsaved' ? 'Unsaved changes' : ''}</span>
                </div>
              </div>
            </div>
            {/* Actions row (minimal, right-aligned) */}
            <div className="mt-2 px-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setWrapCells((w) => !w)}
                className="p-2 rounded-lg border border-edge hover:bg-surface-hover transition-colors"
                title={wrapCells ? 'Disable wrap' : 'Enable wrap'}
                aria-label={wrapCells ? 'Disable text wrap' : 'Enable text wrap'}
              >
                <WrapText className="h-4 w-4" />
              </button>

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
                  <div className="absolute z-20 right-0 mt-2 w-[360px] bg-surface border border-edge rounded-lg shadow-lg p-3" role="dialog" aria-label="Analysis prompt">
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
                  <button type="button" onClick={() => window.open(storageUrl, '_blank')} className="p-2 rounded-lg border border-edge hover:bg-surface-hover transition-colors" title="Open in new tab" aria-label="Open in new tab">
                    <Eye className="h-4 w-4" />
                  </button>
                  <a href={storageUrl} download={file.fileName} className="p-2 rounded-lg border border-edge hover:bg-surface-hover transition-colors" title="Download file">
                    <Download className="h-4 w-4" />
                  </a>
                </>
              )}

              <button type="button" onClick={() => void handleSaveChanges()} disabled={isSaving || isMini} className="p-2 rounded-lg border border-edge hover:bg-surface-hover transition-colors disabled:opacity-50" title={isMini ? "Editing disabled in mini view" : "Save changes"} aria-label="Save changes">
                {isSaving ? (<Loader2 className="h-4 w-4 motion-safe:animate-spin" />) : (<Save className="h-4 w-4" />)}
              </button>

              <button type="button" onClick={() => void handleExportCsv()} disabled={isExporting} className="p-2 rounded-lg border border-edge hover:bg-surface-hover transition-colors disabled:opacity-50" title="Export CSV" aria-label="Export CSV">
                {isExporting ? (<Loader2 className="h-4 w-4 motion-safe:animate-spin" />) : (<FileDown className="h-4 w-4" />)}
              </button>
            </div>
            </div>
          </div>

      )}


      {/* Workbook sheet tabs */}
      {workbookSheets && workbookSheets.length > 1 && (
        <div className="flex-shrink-0 border-b border-edge bg-surface">
          <div className="px-3 py-2 flex items-center gap-2 overflow-x-auto">
            {workbookSheets.map((s, i) => (
              <button
                key={`${s.name}-${i}`}
                onClick={() => { setActiveSheetIndex(i); setCsvData(workbookSheets[i].csv); }}
                className={`px-2 py-1 text-xs rounded-md whitespace-nowrap ${i === activeSheetIndex ? 'bg-surface-secondary border border-edge text-content' : 'hover:bg-surface-hover text-content-secondary'}`}
                title={s.name}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mini editor notice */}
      {isMini && (
        <div className="flex-shrink-0 border-b border-edge bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          <div className="px-4 py-2 text-xs">Quick edits for spreadsheets are not available in the mini editor. Open the document to edit.</div>
        </div>
      )}

      {/* Main content area with horizontal split */}
      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal" autoSaveId="spreadsheet-view:h" onLayout={onHorizontalLayout} ref={hGroupRef}>
          <Panel defaultSize={65} minSize={20}>
              <div className="h-full flex flex-col bg-surface relative">
      {/* Scoped styles to improve table formatting and enable natural sizing */}
      <style>
        {`
        /* EditorJS Table formatting within spreadsheet view */
        .nb-spreadsheet .tc-table {
          width: max-content;
          border-collapse: collapse;
          table-layout: auto;
        }
        .nb-spreadsheet .tc-table th,
        .nb-spreadsheet .tc-table td {
          white-space: nowrap;
          padding: 6px 8px;
          border: 1px solid var(--border-color);
          min-width: 96px; /* ensure columns are visible even if empty */
          vertical-align: top;
        }
        /* When wrapping is enabled */
        .nb-spreadsheet.nb-wrap .tc-table th,
        .nb-spreadsheet.nb-wrap .tc-table td {
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        /* Sticky header support: thead for fallback, first row for EditorJS */
        .nb-spreadsheet .tc-table thead th {
          position: sticky;
          top: 0;
          background: var(--bg-primary);
          z-index: 2;
        }
        .nb-spreadsheet .tc-table tr:first-child th,
        .nb-spreadsheet .tc-table tr:first-child td {
          position: sticky;
          top: 0;
          background: var(--bg-primary);
          z-index: 1;
        }
        /* Allow EditorJS container to size to content */
        .nb-spreadsheet .codex-editor {
          max-width: none !important;
          width: max-content !important;
        }
        /* Reduce default EditorJS paddings for tighter spreadsheet look */
        .nb-spreadsheet .ce-block__content { padding: 0 !important; }
        .nb-spreadsheet .ce-toolbar__plus,
        .nb-spreadsheet .ce-toolbar__settings-btn { display: none; }
        .nb-spreadsheet .ce-block { margin: 0; }
        .nb-spreadsheet .codex-editor__redactor { padding: 0 !important; }

        /* React Spreadsheet: enable multi-line display when wrapped */
        .nb-sheet.nb-wrap .Spreadsheet .Spreadsheet__cell {
          height: auto !important;
          align-items: stretch;
        }
        .nb-sheet.nb-wrap .Spreadsheet .Spreadsheet__data-viewer {
          white-space: normal !important;
          overflow-wrap: anywhere;
          word-break: break-word;
          line-height: 1.2;
          padding: 4px 6px;
        }
        .nb-sheet.nb-wrap .Spreadsheet .Spreadsheet__data-editor {
          align-items: stretch;
        }
        .nb-sheet.nb-wrap .Spreadsheet .Spreadsheet__data-editor textarea {
          white-space: pre-wrap;
          line-height: 1.2;
          padding: 4px 6px;
        }
        .nb-sheet .Spreadsheet .Spreadsheet__data-viewer {
          white-space: nowrap;
        }
        `}
      </style>

    <div className={`flex-1 min-h-0 overflow-auto nb-sheet ${wrapCells ? 'nb-wrap' : ''}`}>
      <div
        className="h-full w-full px-2 py-1"
        style={{
          transform: `scale(${zoomState ? zoomState.scale : localScale})`,
          transformOrigin: 'top left',
        }}
      >
        <div className="overflow-auto border border-edge rounded-md bg-surface">
          <div className="text-xs">
            <Spreadsheet
              data={csvData.rows.map((r) => r.map((c) => ({ value: c })))}
              columnLabels={csvData.headers}
              DataEditor={MultiLineDataEditor}
              onChange={(d) => {
                const newRows = d.map((row) => row.map((cell) => String(cell?.value ?? "")));
                setCsvData((prev) => (prev ? { headers: prev.headers, rows: newRows } : { headers: [], rows: newRows }));
                setSaveHint((prev) => (prev === 'saving' ? prev : 'unsaved'));
                if (!isMini && !isExcelFile) {
                  if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
                  autoSaveTimer.current = window.setTimeout(() => {
                    void handleSaveChanges(true).catch(() => {});
                  }, 2000);
                }
              }}
            />
          </div>
        </div>
      </div>


      {/* Zoom Controls - show when zoom props are available */}
      {zoomState && zoomControls && (
        <ZoomControlsComponent
          zoomState={zoomState}
          zoomControls={zoomControls}
          position="bottom-right"
        />
      )}
    </div>
        </div>
      </Panel>
      <PanelResizeHandle
        className="w-1 bg-[var(--border-color)] hover:bg-indigo-600 transition-colors cursor-col-resize"
        onDoubleClick={resetHorizontal}
        title="Double-click to reset layout"
      />
      <Panel ref={notesPanelRef} defaultSize={35} minSize={0} collapsible>
        <div className="h-full border-l border-edge p-4 overflow-auto">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-content">Quick notes</h4>
            <button
              type="button"
              onClick={toggleNotes}
              className="p-1 rounded border border-edge bg-surface-secondary hover:bg-surface-hover"
              title={notesCollapsed ? 'Expand Quick notes' : 'Collapse Quick notes'}
              aria-label={notesCollapsed ? 'Expand Quick notes' : 'Collapse Quick notes'}
              aria-expanded={!notesCollapsed}
            >
              {notesCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
          <div className="min-h-[240px]">
            <ErrorBoundary title="Failed to load notes">
              <Suspense fallback={<div className="text-xs text-content-secondary">Loading editor…</div>}>
                <UnifiedEditor documentId={documentId} mode="quickNote" autoCreateIfEmpty />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </Panel>
    </PanelGroup>
      </div>
    </div>
  );
};

export default SpreadsheetView;
