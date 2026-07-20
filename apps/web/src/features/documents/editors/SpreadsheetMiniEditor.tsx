import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Save, X, Maximize2, Minimize2, Download, Sparkles, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import Papa from "papaparse";
import Spreadsheet, { type Selection, type Point } from "react-spreadsheet";
import * as XLSX from 'xlsx';
import { useSelection } from "@/features/agents/context/SelectionContext";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";


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


export default function SpreadsheetMiniEditor({ documentId, onClose }: { documentId: Id<"documents">; onClose: () => void }) {
  const fileDoc = useQuery(api.domains.documents.fileDocuments.getFileDocument, { documentId });
  const updateDocument = useMutation(api.domains.documents.documents.update);
  const renameFile = useMutation(api.domains.documents.files.renameFile);

  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("");
  const [saveHint, setSaveHint] = useState<"idle" | "saving" | "saved" | "unsaved">("idle");
  const [isSaving, setIsSaving] = useState(false);
  const [isCinemaMode, setIsCinemaMode] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const genUploadUrl = useMutation(api.domains.documents.files.generateUploadUrl);
  const finalizeExcel = useMutation(api.domains.documents.files.finalizeExcelReplace);

  const prepareCsvExport = useMutation(api.domains.documents.files.prepareCsvExport);
  const lastSavedRef = useRef<string>("");

  // Quick table editor state
  const [workbookSheets, setWorkbookSheets] = useState<Array<{ name: string; csv: { headers: string[]; rows: string[][] } }>>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);

  const [fullHeaders, setFullHeaders] = useState<string[] | null>(null);
  const [fullRows, setFullRows] = useState<string[][] | null>(null);
  const [subsetHeaders, setSubsetHeaders] = useState<string[]>([]);
  const [subsetRows, setSubsetRows] = useState<string[][]>([]);

  // Selection state for "Chat with Selection" feature
  const [currentSelection, setCurrentSelection] = useState<Selection | null>(null);
  const { setSelection } = useSelection();
  const { open: openFastAgent } = useFastAgent();

  const isExcel = (() => {
    const name = (fileDoc?.file?.fileName || '').toLowerCase();
    const ft = String(fileDoc?.document?.fileType || '').toLowerCase();
    return ft === 'excel' || /\.(xlsx?)$/.test(name);
  })();

  // Convert cell selection to text content for AI analysis
  const getSelectedContent = useCallback(() => {
    if (!currentSelection || subsetRows.length === 0) return null;

    // Handle range selection
    const range = currentSelection as { start: Point; end: Point };
    if (!range.start || !range.end) return null;

    const startRow = Math.min(range.start.row, range.end.row);
    const endRow = Math.max(range.start.row, range.end.row);
    const startCol = Math.min(range.start.column, range.end.column);
    const endCol = Math.max(range.start.column, range.end.column);

    // Extract selected headers
    const selectedHeaders = subsetHeaders.slice(startCol, endCol + 1);

    // Extract selected rows
    const selectedRows = subsetRows.slice(startRow, endRow + 1).map(row =>
      row.slice(startCol, endCol + 1)
    );

    // Format as markdown table
    const headerRow = `| ${selectedHeaders.join(' | ')} |`;
    const separatorRow = `| ${selectedHeaders.map(() => '---').join(' | ')} |`;
    const dataRows = selectedRows.map(row => `| ${row.join(' | ')} |`).join('\n');

    const content = `${headerRow}\n${separatorRow}\n${dataRows}`;

    // Create range description (e.g., "A1:C5")
    const startColLetter = String.fromCharCode(65 + startCol);
    const endColLetter = String.fromCharCode(65 + endCol);
    const rangeDescription = `${startColLetter}${startRow + 1}:${endColLetter}${endRow + 1}`;

    return {
      content,
      rangeDescription,
      selectedHeaders,
      rowRange: { start: startRow, end: endRow },
      rowCount: endRow - startRow + 1,
      colCount: endCol - startCol + 1,
    };
  }, [currentSelection, subsetHeaders, subsetRows]);

  // Handle "Analyze Selection" button click
  const handleAnalyzeSelection = useCallback(() => {
    const selected = getSelectedContent();
    if (!selected) {
      toast.error('Please select cells to analyze');
      return;
    }

    // Set selection in context
    setSelection({
      content: selected.content,
      metadata: {
        sourceType: 'spreadsheet',
        documentId,
        filename: fileName || 'spreadsheet',
        rangeDescription: selected.rangeDescription,
        columnHeaders: selected.selectedHeaders,
        rowRange: selected.rowRange,
      },
      timestamp: Date.now(),
    });

    // Open Fast Agent panel
    openFastAgent();

    toast.success(`Selected ${selected.rowCount} rows × ${selected.colCount} columns ready for analysis`);
  }, [getSelectedContent, setSelection, documentId, fileName, openFastAgent]);


  useEffect(() => {
    if (!fileDoc) return;
    setTitle(fileDoc.document.title || "");
    setFileName(fileDoc.file.fileName || "");
    lastSavedRef.current = JSON.stringify({ t: fileDoc.document.title || "", f: fileDoc.file.fileName || "" });
  }, [fileDoc]);

  useEffect(() => {
    if (!fileDoc) return;
    const current = JSON.stringify({ t: title, f: fileName });
    setSaveHint(current === lastSavedRef.current ? (saveHint === "saved" ? "saved" : "idle") : "unsaved");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, fileName, fileDoc]);

  const handleSave = useCallback(async () => {
    if (!fileDoc) return;
    const nextTitle = (title || "").trim();
    const nextFileName = (fileName || "").trim();

    if (nextTitle === (fileDoc.document.title || "") && nextFileName === (fileDoc.file.fileName || "")) {
      setSaveHint("idle");
      return;
    }

    try {
      setIsSaving(true);
      setSaveHint("saving");
      // Update doc title if changed
      if (nextTitle !== (fileDoc.document.title || "")) {
        await updateDocument({ id: fileDoc.document._id, title: nextTitle || "Untitled" });
      }
      // Update file name if changed
      if (nextFileName !== (fileDoc.file.fileName || "")) {
        await renameFile({ fileId: fileDoc.file._id, fileName: nextFileName });
      }
      lastSavedRef.current = JSON.stringify({ t: nextTitle || "Untitled", f: nextFileName || fileDoc.file.fileName });
      setSaveHint("saved");
      setTimeout(() => setSaveHint("idle"), 1200);
      toast.success("Spreadsheet details updated");
    } catch (e) {
      console.error(e);
      toast.error("Failed to update spreadsheet details");
      setSaveHint("unsaved");
    } finally {
      setIsSaving(false);
    }
  }, [fileDoc, title, fileName, updateDocument, renameFile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave, onClose]);

  // Load CSV and prepare subset for the mini sheet editor
  useEffect(() => {
    const run = async () => {
      try {
        if (!fileDoc?.storageUrl || isExcel) return;
        const res = await fetch(fileDoc.storageUrl);
        const text = await res.text();
        const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
        const data: string[][] = (parsed.data as any[]).filter((r) => Array.isArray(r)) as string[][];
        if (!data.length) return;
        const headers = data[0] ?? [];
        const rows = data.slice(1);
        setFullHeaders(headers);
        setFullRows(rows);
        // Fit entire CSV content into the mini grid with scroll
        const maxCols = Math.max(headers.length, ...rows.map((r) => r.length));
        const labels = Array.from({ length: maxCols }, (_, i) => (headers[i] ?? `C${i + 1}`));
        const paddedRows = rows.map((r) => {
          const copy = [...r];

          if (copy.length < maxCols) copy.length = maxCols;
          for (let i = 0; i < maxCols; i++) if (copy[i] == null) copy[i] = "";
          return copy;
        });
        setSubsetHeaders(labels);
        setSubsetRows(paddedRows);
      } catch (e) {
        console.error("Failed to load CSV for mini editor", e);
      }
    };
    void run();

  }, [fileDoc?.storageUrl]);

  const csvStringFrom = useCallback((headers: string[], rows: string[][]): string => {
    const esc = (cell: string) => (cell.includes(',') || cell.includes('"') || cell.includes('\n')) ? `"${cell.replace(/"/g, '""')}"` : cell;
    return [headers.map(esc).join(','), ...rows.map((row) => row.map(esc).join(','))].join('\n');
  }, []);
  // Load Excel workbook into mini editor when applicable
  useEffect(() => {
    if (!fileDoc?.storageUrl || !isExcel) return;
    (async () => {
      try {
        const resp = await fetch(fileDoc.storageUrl as string);
        const buf = await resp.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheets = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const aoa: string[][] = wsToDisplayAOA(ws);
          const headers = (aoa?.[0] ?? []).map((v: any) => String(v ?? ''));
          const dataRows = (aoa ?? []).slice(1).map((r: any[]) => (r ?? []).map((v: any) => String(v ?? '')));
          return { name, csv: { headers, rows: dataRows } };
        });
        setWorkbookSheets(sheets);
        setActiveSheetIndex(0);
        setSubsetHeaders(sheets[0]?.csv.headers ?? []);
        setSubsetRows(sheets[0]?.csv.rows ?? []);
      } catch (e) {
        console.error('Excel load (mini) failed', e);
      }
    })();
  }, [fileDoc?.storageUrl, isExcel]);


  const handleSaveSubset = useCallback(async ({ headers, rows }: { headers: string[]; rows: string[][] }) => {
    if (!fileDoc?.file) return;
    try {
      if (isExcel) {
        if (!fileDoc.storageUrl) throw new Error('Missing storage URL');
        const resp = await fetch(fileDoc.storageUrl as string);
        const buf = await resp.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheetName = workbookSheets[activeSheetIndex]?.name || wb.SheetNames[0];
        const ws = wb.Sheets[sheetName] || XLSX.utils.aoa_to_sheet([]);
        const aoa: any[][] = [headers, ...rows];
        const R = aoa.length, C = (aoa[0]?.length ?? 0);
        // Skip non-anchor merged children
        const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = (ws as any)['!merges'] || [];
        const mergedChildren = new Set<string>();
        for (const m of merges) {
          for (let rr = m.s.r; rr <= m.e.r; rr++) {
            for (let cc = m.s.c; cc <= m.e.c; cc++) {
              if (rr === m.s.r && cc === m.s.c) continue;
              mergedChildren.add(XLSX.utils.encode_cell({ r: rr, c: cc }));
            }
          }
        }
        for (let r = 0; r < R; r++) {
          for (let c = 0; c < C; c++) {
            const addr = XLSX.utils.encode_cell({ r, c });
            if (mergedChildren.has(addr)) continue;
            const val = aoa[r][c];
            const prev: any = ws[addr] ?? {};
            const next: any = { ...prev };
            const isFormulaText = typeof val === 'string' && val.startsWith('=');
            if (prev.f) {
              if (isFormulaText) next.f = String(val).slice(1);
            } else {
              if (isFormulaText) {
                next.f = String(val).slice(1);
                delete next.v; delete next.w;
              } else {
                next.v = typeof val === 'number' ? val : String(val ?? '');
              }
            }
            ws[addr] = next;
          }
        }
        ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(R - 1, 0), c: Math.max(C - 1, 0) } });
        const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const uploadUrl = await genUploadUrl();
        const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const up = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
        if (!up.ok) throw new Error(`Upload failed (${up.status})`);
        const { storageId } = await up.json();
        await finalizeExcel({ fileId: fileDoc.file._id, newStorageId: storageId, newFileSize: blob.size });
        toast.success('Saved sheet to workbook');
      } else {
        if (!fullHeaders || !fullRows) return;
        // Merge subset back into a copy of the full data (top-left region)
        const mergedHeaders = [...fullHeaders];
        for (let c = 0; c < headers.length; c++) mergedHeaders[c] = headers[c] ?? '';
        const mergedRows = fullRows.map((r) => [...r]);
        for (let r = 0; r < rows.length; r++) {
          const src = rows[r] ?? [];
          if (!mergedRows[r]) mergedRows[r] = [];
          for (let c = 0; c < headers.length; c++) {
            mergedRows[r][c] = src[c] ?? '';
          }
        }
        const csvContent = csvStringFrom(mergedHeaders, mergedRows);
        // Export as new file for safety (does not overwrite original)
        const base = fileDoc.file.fileName.replace(/\.csv$/i, "");
        const newName = `${base}_quickedit_${Date.now()}.csv`;
        await prepareCsvExport({ originalFileId: fileDoc.file._id, csvContent, newFileName: newName });
        // Download in browser
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = newName; a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${newName}`);
      }
    } catch (e) {
      console.error(e);

      toast.error('Quick edit failed');
    }
  }, [fileDoc?.file, fileDoc?.storageUrl, isExcel, fullHeaders, fullRows, genUploadUrl, finalizeExcel, activeSheetIndex, workbookSheets, prepareCsvExport, csvStringFrom]);

  if (fileDoc === undefined) {
    return (
      <div className="mt-2 border border-edge rounded-lg p-3 bg-surface-secondary">
        <div className="motion-safe:animate-pulse h-4 w-28 bg-surface rounded mb-2" />
        <div className="space-y-2">
          <div className="h-3 bg-surface rounded" />
          <div className="h-3 bg-surface rounded w-5/6" />
        </div>
        <div className="text-xs text-[var(--text-tertiary)] mt-2">Loading preview…</div>
      </div>
    );
  }
  if (!fileDoc) return null;

  // Cinema Mode - Full screen modal
  if (isCinemaMode) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-surface/95 backdrop-blur-xl rounded-lg shadow-2xl border border-edge flex flex-col overflow-hidden w-[90vw] h-[85vh] max-w-6xl">
          {/* Glassy Header */}
          <div className="flex-shrink-0 px-6 py-4 bg-gradient-to-r from-surface-secondary/80 to-surface/80 backdrop-blur-md border-b border-edge">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="flex-1 min-w-0">
                  <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full text-lg font-semibold bg-transparent border-none text-content focus:outline-none focus:ring-0 placeholder:text-content-muted" placeholder="Untitled Spreadsheet" />
                  <div className="flex items-center gap-2 mt-1">
                    <input value={fileName} onChange={(e) => setFileName(e.target.value)} className="text-sm bg-transparent border-none text-content-secondary focus:outline-none focus:ring-0 placeholder:text-content-muted" placeholder="filename.csv" />
                    {saveHint === "unsaved" && <span className="text-xs text-amber-500 font-medium">• Unsaved</span>}
                    {saveHint === "saving" && <span className="text-xs text-content-muted">Saving...</span>}
                    {saveHint === "saved" && <span className="text-xs text-green-500">✓ Saved</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Analyze Selection Button - only visible when cells are selected */}
                {currentSelection && getSelectedContent() && (
                  <button
                    type="button"
                    onClick={handleAnalyzeSelection}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-500 to-indigo-500 hover:from-indigo-600 hover:to-indigo-600 text-white text-sm font-medium rounded-lg transition-all shadow-lg shadow-indigo-500/25"
                    title="Analyze selected cells with AI"
                  >
                    <MessageSquare className="w-4 h-4" />
                    Chat with Selection
                  </button>
                )}
                <button type="button" onClick={() => { setIsAnalyzing(true); toast.info('Select cells and use "Chat with Selection" for AI analysis'); setIsAnalyzing(false); }} disabled={isAnalyzing} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white text-sm font-medium rounded-lg transition-all shadow-lg shadow-purple-500/25 disabled:opacity-50">
                  {isAnalyzing ? <Loader2 className="w-4 h-4 motion-safe:animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Analyze All
                </button>
                <button type="button" onClick={() => { void handleSaveSubset({ headers: subsetHeaders, rows: subsetRows }); }} className="p-2 rounded-lg bg-surface-secondary hover:bg-surface-hover text-content-secondary border border-edge transition-colors" title="Download"><Download className="w-4 h-4" /></button>
                <button type="button" onClick={() => setIsCinemaMode(false)} className="p-2 rounded-lg bg-surface-secondary hover:bg-surface-hover text-content-secondary border border-edge transition-colors" title="Exit Cinema Mode"><Minimize2 className="w-4 h-4" /></button>
                <button type="button" onClick={() => void handleSave()} disabled={saveHint !== "unsaved" || isSaving} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${saveHint === "unsaved" && !isSaving ? "bg-[var(--accent-primary)] text-white hover:opacity-90" : "bg-surface-secondary text-content-muted border border-edge cursor-not-allowed"}`}><Save className="w-4 h-4" />Save</button>
                <button type="button" onClick={onClose} className="p-2 rounded-lg bg-surface-secondary hover:bg-red-500/20 hover:text-red-500 text-content-secondary border border-edge transition-colors" title="Close"><X className="w-4 h-4" /></button>
              </div>
            </div>
          </div>

          {/* Sheet Tabs (for Excel) */}
          {isExcel && workbookSheets.length > 1 && (
            <div className="flex-shrink-0 px-4 py-2 bg-surface-secondary/50 border-b border-edge flex items-center gap-1 overflow-x-auto">
              {workbookSheets.map((s, i) => (
                <button key={`cinema-${s.name}-${i}`} type="button" onClick={() => { setActiveSheetIndex(i); setSubsetHeaders(workbookSheets[i].csv.headers); setSubsetRows(workbookSheets[i].csv.rows); }} className={`px-3 py-1.5 text-sm rounded-lg whitespace-nowrap transition-colors ${i === activeSheetIndex ? 'bg-[var(--accent-primary)] text-white' : 'bg-surface hover:bg-surface-hover text-content-secondary border border-edge'}`}>{s.name}</button>
              ))}
            </div>
          )}

          {/* Spreadsheet Content */}
          <div className="flex-1 overflow-auto p-4 bg-surface-secondary/30">
            {subsetHeaders.length > 0 ? (
              <div className="cinema-spreadsheet rounded-lg border border-edge bg-surface overflow-hidden">
                <Spreadsheet
                  data={subsetRows.map((r) => r.map((c) => ({ value: c })))}
                  columnLabels={subsetHeaders}
                  onChange={(d: any[][]) => {
                    setSubsetRows(d.map((row) => row.map((cell: any) => String(cell?.value ?? ""))));
                    setSaveHint("unsaved");
                  }}
                  onSelect={(selection: Selection) => setCurrentSelection(selection)}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-content-muted">
                <div className="text-center"><Loader2 className="w-8 h-8 motion-safe:animate-spin mx-auto mb-2" /><p>Loading spreadsheet data...</p></div>
              </div>
            )}
          </div>

          {/* Footer with Keyboard Shortcuts */}
          <div className="flex-shrink-0 px-6 py-3 bg-surface-secondary/50 border-t border-edge flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs text-content-muted">
              <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 bg-surface border border-edge rounded shadow-sm font-mono text-xs">Esc</kbd>Close</span>
              <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 bg-surface border border-edge rounded shadow-sm font-mono text-xs">⌘S</kbd>Save changes</span>
            </div>
            <button type="button" onClick={() => void handleSave()} disabled={saveHint !== "unsaved" || isSaving} className={`px-4 py-2 text-sm font-medium rounded-lg transition-all shadow-lg ${saveHint === "unsaved" && !isSaving ? "bg-content text-surface hover:opacity-90 shadow-sm" : "bg-surface-secondary text-content-secondary cursor-not-allowed shadow-none"}`}>Save Changes</button>
          </div>
        </div>
      </div>
    );
  }

  // Mini Mode (default)
  return (
    <div
      className="mt-1 rounded-md p-2 bg-surface border border-edge/60 transition-all relative z-10 pointer-events-auto"
      data-inline-editor="true"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="mb-1 flex items-center justify-between">
        <div className="text-xs text-content-muted">Press Esc to close · Ctrl/Cmd+S to save</div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-content-muted">
            {saveHint === "saving" ? "Saving…" : saveHint === "saved" ? "Saved" : saveHint === "unsaved" ? "Unsaved changes" : ""}
          </div>
          {/* Cinema Mode Toggle */}
          <button
            type="button"
            onClick={() => setIsCinemaMode(true)}
            className="w-7 h-7 rounded-md flex items-center justify-center bg-surface-secondary hover:bg-surface-hover text-content-secondary border border-edge"
            title="Cinema Mode"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => { void handleSave(); }}
            disabled={saveHint !== "unsaved" || isSaving}
            className={`h-7 px-2 rounded-md flex items-center justify-center border text-xs ${saveHint === "unsaved" && !isSaving ? "bg-[var(--accent-primary)] text-white border-transparent hover:opacity-90" : "bg-surface-secondary text-content-secondary border-edge opacity-70 cursor-not-allowed"}`}
            title="Save changes"
          >
            <span className="inline-flex items-center gap-1"><Save className="w-3.5 h-3.5" /> Save</span>
          </button>
          <button
            type="button"
            onClick={() => { void handleSaveSubset({ headers: subsetHeaders, rows: subsetRows }); }}
            disabled={subsetHeaders.length === 0}
            className={`h-7 px-2 rounded-md flex items-center justify-center border text-xs ${subsetHeaders.length > 0 ? "bg-[var(--accent-primary)] text-white border-transparent hover:opacity-90" : "bg-surface-secondary text-content-secondary border-edge opacity-70 cursor-not-allowed"}`}
            title={isExcel ? "Save sheet to workbook" : "Export CSV"}
          >
            <span className="inline-flex items-center gap-1"><Save className="w-3.5 h-3.5" /> {isExcel ? "Save Sheet" : "Export CSV"}</span>
          </button>

          <button
            type="button"
            onClick={() => onClose()}
            className="w-7 h-7 rounded-md flex items-center justify-center bg-surface-secondary hover:bg-surface-hover text-content-secondary border border-edge"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <label className="sr-only">Document title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full h-7 text-xs bg-transparent border border-edge/60 rounded-md px-2 py-1 text-content focus:outline-none focus:ring-1 focus:ring-ring focus:border-indigo-500/30"
            placeholder="Title"
          />
        </div>
        <div>
          <label className="sr-only">File name</label>
          <input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className="w-full h-7 text-xs bg-transparent border border-edge/60 rounded-md px-2 py-1 text-content focus:outline-none focus:ring-1 focus:ring-ring focus:border-indigo-500/30"
            placeholder="File name"
          />
        </div>
      </div>

        {/* Spreadsheet grid */}
        {subsetHeaders.length > 0 && (
          <div className="mini-grid text-xs">
            <div className="max-h-[300px] overflow-auto rounded-md border border-edge bg-surface-secondary">
              <div className="p-1">
                <Spreadsheet
                  data={subsetRows.map((r) => r.map((c) => ({ value: c })))}
                  columnLabels={subsetHeaders}
                  onChange={(d: any[][]) => {
                    setSubsetRows(d.map((row) => row.map((cell: any) => String(cell?.value ?? ""))));
                    setSaveHint("unsaved");
                  }}
                />
              </div>
            </div>
      {/* Workbook sheet tabs (Excel) */}
      {isExcel && workbookSheets.length > 1 && (
        <div className="mb-2 flex items-center gap-1 overflow-x-auto">
          {workbookSheets.map((s, i) => (
            <button
              type="button"
              key={`${s.name}-${i}`}
              onClick={() => { setActiveSheetIndex(i); setSubsetHeaders(workbookSheets[i].csv.headers); setSubsetRows(workbookSheets[i].csv.rows); }}
              className={`px-2 py-1 text-xs rounded ${i === activeSheetIndex ? 'bg-surface-secondary border border-edge' : 'hover:bg-surface-hover text-content-secondary'}`}
              title={s.name}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

          </div>
        )}

    </div>
  );
}
