/**
 * SpreadsheetPreview — Lazy-loadable spreadsheet preview with xlsx vendor isolation.
 *
 * The 423KB xlsx vendor is loaded only when an Excel file is actually previewed,
 * keeping it out of the default documents route chunk.
 */

import { useMemo, useState, useEffect } from "react";

// xlsx is lazy-loaded only when an Excel file is actually previewed.
// This keeps the 423KB vendor out of the default documents route chunk.
let xlsxModule: typeof import("xlsx") | null = null;
const xlsxPromise = () =>
  xlsxModule
    ? Promise.resolve(xlsxModule)
    : import("xlsx").then((m) => {
        xlsxModule = m;
        return m;
      });

const spreadsheetPreviewCache = new Map<string, string[][] | null>();
const spreadsheetPreviewRequestCache = new Map<
  string,
  Promise<string[][] | null>
>();

// ============================================================================
// CSV Parser Utility - Parses CSV text into rows/columns
// ============================================================================
function parseCsvContent(text: string): string[][] | null {
  if (!text || text.trim().length === 0) return null;

  // Parse first 6 lines, split by comma, clean quotes
  const rows = text
    .split('\n')
    .slice(0, 6)
    .map(row =>
      row.split(',').map(cell =>
        cell.replace(/^"|"$/g, '').trim().substring(0, 20) // Truncate cells
      )
    )
    .filter(row => row.length > 0 && row.some(c => c.length > 0));

  return rows.length > 0 ? rows : null;
}

// ============================================================================
// Excel Parser Utility - Lazily loads xlsx vendor, parses ArrayBuffer
// ============================================================================
async function parseExcelContent(buffer: ArrayBuffer): Promise<string[][] | null> {
  try {
    const XLSX = await xlsxPromise();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return null;

    const worksheet = workbook.Sheets[firstSheetName];
    // Convert to 2D array, limit to first 6 rows
    const jsonData = XLSX.utils.sheet_to_json<string[]>(worksheet, {
      header: 1,
      defval: "",
    });

    // Take first 6 rows, truncate cell content
    const rows = jsonData.slice(0, 6).map((row) =>
      (row as unknown[]).map((cell) =>
        String(cell ?? "").substring(0, 20)
      )
    );

    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

function getSpreadsheetPreviewCacheKey(
  url: string,
  fileType?: string,
): string {
  return `${fileType ?? "unknown"}:${url}`;
}

async function fetchSpreadsheetPreview(
  url: string,
  fileType?: string,
): Promise<string[][] | null> {
  const cacheKey = getSpreadsheetPreviewCacheKey(url, fileType);
  if (spreadsheetPreviewCache.has(cacheKey)) {
    return spreadsheetPreviewCache.get(cacheKey) ?? null;
  }
  if (spreadsheetPreviewRequestCache.has(cacheKey)) {
    return spreadsheetPreviewRequestCache.get(cacheKey) ?? Promise.resolve(null);
  }

  const request = (async () => {
    try {
      const isExcel =
        fileType === "excel" || url.endsWith(".xlsx") || url.endsWith(".xls");

      if (isExcel) {
        const response = await fetch(url);
        if (!response.ok) return null;
        const buffer = await response.arrayBuffer();
        return parseExcelContent(buffer);
      }

      const response = await fetch(url, {
        headers: { Range: "bytes=0-2047" },
      });

      if (!response.ok && response.status !== 206) {
        const fullResponse = await fetch(url);
        if (!fullResponse.ok) return null;
        const text = await fullResponse.text();
        return parseCsvContent(text.substring(0, 2048));
      }

      const text = await response.text();
      return parseCsvContent(text);
    } catch {
      return null;
    }
  })();

  spreadsheetPreviewRequestCache.set(cacheKey, request);
  const result = await request;
  spreadsheetPreviewRequestCache.delete(cacheKey);
  spreadsheetPreviewCache.set(cacheKey, result);
  return result;
}

// ============================================================================
// Spreadsheet URL Fetcher Hook - Fetches CSV or Excel from URL
// ============================================================================
function useSpreadsheetFromUrl(
  url: string | null | undefined,
  fileType?: string
): string[][] | null {
  const [data, setData] = useState<string[][] | null>(null);

  useEffect(() => {
    if (!url) {
      setData(null);
      return;
    }

    let cancelled = false;
    const cacheKey = getSpreadsheetPreviewCacheKey(url, fileType);
    if (spreadsheetPreviewCache.has(cacheKey)) {
      setData(spreadsheetPreviewCache.get(cacheKey) ?? null);
      return;
    }

    void fetchSpreadsheetPreview(url, fileType).then((result) => {
      if (!cancelled) {
        setData(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [url, fileType]);

  return data;
}

// ============================================================================
// Spreadsheet Preview - Shows REAL data when available, or abstract fallback
// ============================================================================
export function SpreadsheetPreview({
  url,
  content,
  fileType,
  structuredPreview,
}: {
  /** URL to fetch CSV/Excel content from (Convex storage URL) */
  url?: string | null;
  /** Raw CSV/text content to parse and display */
  content?: string | null;
  /** File type hint for parsing (csv, excel) */
  fileType?: string;
  /** Pre-parsed structured preview data (LLM-cleaned) */
  structuredPreview?: string[][] | null;
}) {
  // Fetch from URL if available (handles both CSV and Excel)
  const urlData = useSpreadsheetFromUrl(url, fileType);

  // Parse content if available
  const parsedData = useMemo(() => {
    if (content) {
      return parseCsvContent(content);
    }
    return null;
  }, [content]);

  // Priority: structuredPreview (LLM-cleaned) > urlData (fetched) > parsedData (from content) > fallback
  const displayData = structuredPreview || urlData || parsedData;

  // REAL DATA RENDERER - Shows actual CSV content
  if (displayData && displayData.length > 0) {
    const headers = displayData[0];
    const rows = displayData.slice(1, 6);

    return (
      <div className="w-full h-full bg-surface flex flex-col overflow-hidden text-[6px] font-mono leading-none select-none relative">
        {/* Header Row */}
        <div className="flex bg-gradient-to-b from-surface-hover to-surface-secondary border-b border-edge sticky top-0">
          <div className="w-4 shrink-0 border-r border-edge bg-surface-hover" />
          {headers.slice(0, 4).map((header, i) => (
            <div
              key={i}
              className="flex-1 border-r border-edge px-0.5 py-0.5 font-bold text-content-secondary truncate tracking-tighter text-center"
            >
              {header || `Col${i+1}`}
            </div>
          ))}
        </div>

        {/* Data Rows */}
        <div className="flex-1 overflow-hidden">
          {rows.map((row, rIndex) => (
            <div
              key={rIndex}
              className="flex border-b border-edge hover:bg-blue-50/30"
            >
              <div className="w-4 shrink-0 border-r border-edge bg-surface-secondary text-content-muted flex items-center justify-center font-semibold text-[5px]">
                {rIndex + 1}
              </div>
              {row.slice(0, 4).map((cell, cIndex) => (
                <div
                  key={cIndex}
                  className="flex-1 border-r border-edge px-0.5 py-0.5 text-content truncate"
                >
                  {cell}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Fade hint for more content */}
        <div className="absolute bottom-0 inset-x-0 h-3 bg-gradient-to-t from-surface to-transparent pointer-events-none" />
      </div>
    );
  }

  // ABSTRACT FALLBACK - When no real data available
  return (
    <div className="w-full h-full bg-surface p-1.5 flex flex-col gap-0 border-t border-l border-edge overflow-hidden">
      {/* Header Row */}
      <div className="flex w-full shrink-0">
        <div className="w-5 h-3.5 bg-surface-secondary border-r border-b border-edge flex items-center justify-center">
          <span className="text-[5px] text-content-muted">#</span>
        </div>
        {["A", "B", "C", "D"].map((col) => (
          <div
            key={col}
            className="flex-1 h-3.5 bg-surface-secondary border-r border-b border-edge flex items-center justify-center"
          >
            <span className="text-[6px] font-medium text-content-muted">{col}</span>
          </div>
        ))}
      </div>
      {/* Data Rows */}
      {[1, 2, 3, 4, 5].map((row) => (
        <div key={row} className="flex w-full shrink-0">
          <div className="w-5 h-3.5 bg-surface-secondary border-r border-b border-edge flex items-center justify-center">
            <span className="text-[5px] text-content-muted">{row}</span>
          </div>
          <div className="flex-1 h-3.5 border-r border-b border-edge p-0.5 flex items-center">
            <div className={`h-1.5 bg-indigo-100 rounded-[1px] ${row === 1 ? "w-4/5" : row % 2 === 0 ? "w-1/2" : "w-2/3"}`} />
          </div>
          <div className="flex-1 h-3.5 border-r border-b border-edge p-0.5 flex items-center">
            <div className={`h-1.5 bg-blue-50 rounded-[1px] ${row === 1 ? "w-3/5" : "w-1/3"}`} />
          </div>
          <div className="flex-1 h-3.5 border-r border-b border-edge p-0.5 flex items-center">
            <div className={`h-1.5 bg-surface-hover rounded-[1px] ${row % 2 === 0 ? "w-full" : "w-4/5"}`} />
          </div>
          <div className="flex-1 h-3.5 border-b border-edge p-0.5 flex items-center">
            <div className={`h-1.5 bg-amber-50 rounded-[1px] ${row === 3 ? "w-full" : "w-2/5"}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
