/**
 * Shared helpers for local file parsing tools.
 * Extracted from localFileTools.ts for modularity.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { safePath } from "../security/index.js";

/**
 * resolveLocalPath — validates and resolves file paths through the security sandbox.
 *
 * Allows: cwd, home dir (for GAIA tasks), temp dir, and monorepo root.
 * Blocks: ~/.ssh, ~/.aws, ~/.ethereum, .env, symlink escape.
 */
function findMonorepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
const _monorepoRoot = findMonorepoRoot();

export function resolveLocalPath(inputPath: string): string {
  return safePath(inputPath, {
    allowHome: true,
    allowTemp: true,
    allowedRoots: [process.cwd(), _monorepoRoot],
  });
}

export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function truncateCell(value: unknown, maxChars: number): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + "...";
}

export function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const s = toText(value).trim();
  if (!s) return null;

  // Strip common formatting (currency, thousands separators, %). Keep digits/sign/decimal/exponent.
  const cleaned = s.replace(/[, $£€¥%]/g, "").replace(/[^\d.+\-eE]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function toIntegerOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);

  const s = toText(value).trim();
  if (!s) return null;

  // For mixed strings (e.g. "102 Main St"), use the first integer-like substring.
  const m = s.match(/-?\d+/);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

export function mean(nums: number[]): number {
  if (!nums.length) throw new Error("mean: empty array");
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export function pstdev(nums: number[]): number {
  if (!nums.length) throw new Error("pstdev: empty array");
  const m = mean(nums);
  const v = nums.reduce((s, n) => s + (n - m) * (n - m), 0) / nums.length;
  return Math.sqrt(v);
}

export function stdev(nums: number[]): number {
  if (nums.length < 2) throw new Error("stdev: need at least 2 values");
  const m = mean(nums);
  const v = nums.reduce((s, n) => s + (n - m) * (n - m), 0) / (nums.length - 1);
  return Math.sqrt(v);
}

export type ColumnRef = string | number;

export const WHERE_OPS = [
  "eq",
  "ne",
  "contains",
  "starts_with",
  "ends_with",
  "matches_regex",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_empty",
  "not_empty",
  "is_even",
  "is_odd",
] as const;

type WhereOp = (typeof WHERE_OPS)[number];

export type WhereClause = {
  column: ColumnRef;
  op: WhereOp;
  value?: string | number | boolean | null;
  caseSensitive?: boolean;
};

export type CompiledWhereClause = {
  columnIndex: number;
  op: WhereClause["op"];
  value: WhereClause["value"];
  caseSensitive: boolean;
};

export function resolveColumnIndex(headers: string[], column: ColumnRef): number {
  if (typeof column === "number" && Number.isFinite(column)) {
    const idx = Math.trunc(column);
    return idx >= 0 && idx < headers.length ? idx : -1;
  }
  const name = String(column ?? "").trim();
  if (!name) return -1;
  const needle = name.toLowerCase();
  return headers.findIndex((h) => String(h ?? "").trim().toLowerCase() === needle);
}

export function compileWhere(headers: string[], whereRaw: unknown): CompiledWhereClause[] {
  if (!Array.isArray(whereRaw)) return [];

  const out: CompiledWhereClause[] = [];
  for (const raw of whereRaw) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as any;
    const column = obj.column as ColumnRef;
    const op = String(obj.op ?? "").trim() as WhereClause["op"];
    if (!op) continue;
    if (!(WHERE_OPS as readonly string[]).includes(op)) continue;

    const columnIndex = resolveColumnIndex(headers, column);
    if (columnIndex < 0) continue;

    out.push({
      columnIndex,
      op,
      value: obj.value ?? null,
      caseSensitive: obj.caseSensitive === true,
    });
  }
  return out;
}

export function rowMatchesWhere(row: unknown[], where: CompiledWhereClause[]): boolean {
  if (where.length === 0) return true;

  for (const clause of where) {
    const cell = row[clause.columnIndex];

    if (clause.op === "is_empty") {
      const s = toText(cell).trim();
      if (s.length !== 0) return false;
      continue;
    }
    if (clause.op === "not_empty") {
      const s = toText(cell).trim();
      if (s.length === 0) return false;
      continue;
    }

    if (clause.op === "contains") {
      const hay = clause.caseSensitive ? toText(cell) : toText(cell).toLowerCase();
      const needle = clause.caseSensitive ? toText(clause.value) : toText(clause.value).toLowerCase();
      if (!hay.includes(needle)) return false;
      continue;
    }

    if (clause.op === "starts_with") {
      const hay = clause.caseSensitive ? toText(cell) : toText(cell).toLowerCase();
      const needle = clause.caseSensitive ? toText(clause.value) : toText(clause.value).toLowerCase();
      if (!hay.startsWith(needle)) return false;
      continue;
    }

    if (clause.op === "ends_with") {
      const hay = clause.caseSensitive ? toText(cell) : toText(cell).toLowerCase();
      const needle = clause.caseSensitive ? toText(clause.value) : toText(clause.value).toLowerCase();
      if (!hay.endsWith(needle)) return false;
      continue;
    }

    if (clause.op === "matches_regex") {
      const pattern = toText(clause.value).trim();
      if (!pattern) return false;
      if (pattern.length > 200) return false;

      let re: RegExp;
      try {
        // caseSensitive=false uses /i
        re = new RegExp(pattern, clause.caseSensitive ? "" : "i");
      } catch {
        return false;
      }
      if (!re.test(toText(cell))) return false;
      continue;
    }

    if (clause.op === "eq" || clause.op === "ne") {
      const a = clause.caseSensitive ? toText(cell).trim() : toText(cell).trim().toLowerCase();
      const b = clause.caseSensitive
        ? toText(clause.value).trim()
        : toText(clause.value).trim().toLowerCase();
      const ok = a === b;
      if (clause.op === "eq" && !ok) return false;
      if (clause.op === "ne" && ok) return false;
      continue;
    }

    if (clause.op === "is_even" || clause.op === "is_odd") {
      const n = toIntegerOrNull(cell);
      if (n === null) return false;
      const isEven = Math.abs(n) % 2 === 0;
      if (clause.op === "is_even" && !isEven) return false;
      if (clause.op === "is_odd" && isEven) return false;
      continue;
    }

    // Numeric comparisons.
    const n = toNumberOrNull(cell);
    const v = toNumberOrNull(clause.value);
    if (n === null || v === null) return false;
    if (clause.op === "gt" && !(n > v)) return false;
    if (clause.op === "gte" && !(n >= v)) return false;
    if (clause.op === "lt" && !(n < v)) return false;
    if (clause.op === "lte" && !(n <= v)) return false;
  }

  return true;
}

type ParsedA1Range = {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
};

function columnLettersToNumber(value: string): number | null {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) return null;

  let out = 0;
  for (const ch of normalized) {
    out = out * 26 + (ch.charCodeAt(0) - 64);
  }
  return out > 0 ? out : null;
}

function parseA1CellRef(value: string): { row: number; col: number } | null {
  const match = value.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;

  const col = columnLettersToNumber(match[1]);
  const row = Number.parseInt(match[2], 10);
  if (!col || !Number.isFinite(row) || row <= 0) return null;

  return { row, col };
}

function parseA1Range(value: string): ParsedA1Range | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const [startRaw, endRaw] = trimmed.split(":");
  const start = parseA1CellRef(startRaw);
  const end = parseA1CellRef(endRaw ?? startRaw);
  if (!start || !end) return null;

  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startCol: Math.min(start.col, end.col),
    endCol: Math.max(start.col, end.col),
  };
}

export async function getReadExcelFile(): Promise<any> {
  try {
    const mod = await import("read-excel-file/node");
    return (mod as any).default ?? mod;
  } catch (err: any) {
    return async (filePath: string) => {
      try {
        const text = await readFile(filePath, "utf8");
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
        if (Array.isArray(parsed?.sheets)) return parsed.sheets;
      } catch {
        // Fall through to the actionable dependency error below.
      }
      throw new Error(
        "Missing optional dependency: read-excel-file. Install it (or run npm install in packages/mcp-local) to use XLSX parsing."
      );
    };
  }
}

export async function getPapaParse(): Promise<any | null> {
  try {
    const mod = await import("papaparse");
    return (mod as any).default ?? mod;
  } catch {
    return null;
  }
}

export async function getPdfParseModule(): Promise<any> {
  try {
    return await import("pdf-parse");
  } catch {
    throw new Error(
      "Missing optional dependency: pdf-parse. Install it (or run npm install in packages/mcp-local) to use PDF parsing."
    );
  }
}

export async function getYauzl(): Promise<any> {
  try {
    const mod = await import("yauzl");
    return (mod as any).default ?? mod;
  } catch {
    throw new Error(
      "Missing optional dependency: yauzl. Install it (or run npm install in packages/mcp-local) to use ZIP/DOCX/PPTX parsing."
    );
  }
}

export async function loadCsvTable(args: any, opts: { filePath: string; maxScanRows: number; maxCols: number; maxCellChars: number }) {
  const encoding = String(args?.encoding ?? "utf8") as NodeJS.BufferEncoding;
  const text = await readFile(opts.filePath, { encoding });

  const hasHeader = args?.hasHeader !== false;
  const delimiter = typeof args?.delimiter === "string" ? args.delimiter : undefined;

  const papa = await getPapaParse();

  let rows: unknown[][] = [];
  let parseErrors: any[] = [];

  if (papa?.parse) {
    const result = papa.parse(text, {
      ...(delimiter ? { delimiter } : {}),
      skipEmptyLines: true,
      dynamicTyping: false,
    });
    rows = Array.isArray(result?.data) ? (result.data as unknown[][]) : [];
    parseErrors = Array.isArray(result?.errors) ? result.errors : [];
  } else {
    // Minimal fallback parser: split by newlines and delimiter (no quote handling).
    const lines = String(text).split(/\r?\n/).filter((l) => l.trim().length > 0);
    rows = lines.map((l) => l.split(delimiter ?? ","));
  }

  const normalizedAll = rows
    .filter((r) => Array.isArray(r))
    .map((r) => (r as unknown[]).slice(0, opts.maxCols).map((c) => truncateCell(c, opts.maxCellChars)));

  const headerRow = hasHeader ? (normalizedAll[0] as any[] | undefined) : undefined;
  const dataRowsAll = hasHeader ? normalizedAll.slice(1) : normalizedAll;
  const dataRows = dataRowsAll.slice(0, opts.maxScanRows);

  const colCount = Math.max(headerRow ? headerRow.length : 0, ...dataRows.map((r) => r.length));
  const headers = headerRow
    ? headerRow.map((h) => String(h ?? "").trim())
    : Array.from({ length: colCount }, (_, i) => `col_${i + 1}`);

  return {
    encoding,
    hasHeader,
    delimiter: delimiter ?? null,
    parseErrors,
    headers,
    dataRows,
  };
}

export async function loadXlsxTable(args: any, opts: { filePath: string; maxScanRows: number; maxCols: number; maxCellChars: number }) {
  const readExcelFile = await getReadExcelFile();
  const workbook = await readExcelFile(opts.filePath);
  const workbookSheets = Array.isArray(workbook) ? workbook : [];

  const sheets: string[] = workbookSheets
    .map((sheet: any) => String(sheet?.sheet ?? "").trim())
    .filter(Boolean);
  if (sheets.length === 0) throw new Error(`No sheets found in workbook: ${opts.filePath}`);

  const requestedSheet = typeof args?.sheetName === "string" ? args.sheetName.trim() : "";
  const sheetName = requestedSheet || sheets[0];
  const sheetEntry = workbookSheets.find((sheet: any) => String(sheet?.sheet ?? "").trim() === sheetName);
  if (!sheetEntry) {
    throw new Error(`Sheet not found: \"${sheetName}\". Available sheets: ${sheets.join(", ")}`);
  }

  const headerRow = clampInt(args?.headerRow, 1, 0, 1000);
  const rangeA1 = typeof args?.rangeA1 === "string" ? args.rangeA1.trim() : "";
  const parsedRange = rangeA1 ? parseA1Range(rangeA1) : null;
  if (rangeA1 && !parsedRange) {
    throw new Error(`Unsupported rangeA1 value: "${rangeA1}". Use explicit ranges like A1:D50.`);
  }

  const startRow = parsedRange?.startRow ?? 1;
  const endRow = parsedRange?.endRow ?? (Array.isArray(sheetEntry.data) ? sheetEntry.data.length : 0);
  const startCol = parsedRange?.startCol ?? 1;
  const availableColCount = Array.isArray(sheetEntry.data)
    ? sheetEntry.data.reduce((max: number, row: unknown) => {
        if (!Array.isArray(row)) return max;
        return Math.max(max, (row as unknown[]).length);
      }, 0)
    : 0;
  const availableEndCol = parsedRange?.endCol ?? availableColCount;
  const boundedEndCol = Math.min(availableEndCol, startCol + opts.maxCols - 1);

  const slicedRows = Array.isArray(sheetEntry.data)
    ? sheetEntry.data.slice(Math.max(0, startRow - 1), Math.max(0, endRow))
    : [];

  const normalizedAll = slicedRows
    .filter((row: unknown) => Array.isArray(row))
    .map((row: unknown) =>
      (row as unknown[])
        .slice(Math.max(0, startCol - 1), Math.max(0, boundedEndCol))
        .map((cell) => truncateCell(cell, opts.maxCellChars))
    )
    .filter((row: unknown[]) => row.some((cell) => toText(cell).trim().length > 0));

  const headerIdx = headerRow > 0 ? headerRow - 1 : -1;
  const header = headerIdx >= 0 ? (normalizedAll[headerIdx] as any[] | undefined) : undefined;
  const dataRowsAll = headerIdx >= 0 ? normalizedAll.slice(headerIdx + 1) : normalizedAll;
  const dataRows = dataRowsAll.slice(0, opts.maxScanRows);

  const colCount = Math.max(header ? header.length : 0, ...dataRows.map((r: unknown[]) => r.length));
  const headers = header
    ? header.map((h) => String(h ?? "").trim())
    : Array.from({ length: colCount }, (_, i) => `col_${i + 1}`);

  return {
    sheets,
    sheetName,
    headerRow,
    rangeA1: rangeA1 || null,
    totalDataRows: dataRowsAll.length,
    truncated: dataRowsAll.length > dataRows.length || availableEndCol > boundedEndCol,
    headers,
    dataRows,
  };
}
