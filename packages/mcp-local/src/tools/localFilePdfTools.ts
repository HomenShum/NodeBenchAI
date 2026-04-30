/**
 * PDF file parsing tools.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { McpTool } from "../types.js";
import { resolveLocalPath, clampInt, getPdfParseModule } from "./localFileHelpers.js";

function decodePdfLiteral(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

function extractFallbackPdfText(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const textMatches = [...raw.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((match) =>
    decodePdfLiteral(match[1] ?? ""),
  );
  if (textMatches.length > 0) return textMatches.join("\n");
  return buffer.toString("utf8").replace(/[^\S\r\n]+/g, " ").trim();
}

async function parsePdfPagesFallback(
  filePath: string,
  args: {
    pageStart?: unknown;
    pageEnd?: unknown;
    pageNumbers?: unknown;
  },
): Promise<{ numPages: number; pages: Array<{ num: number; text: string }>; extractedPages: number[] }> {
  const buffer = await readFile(filePath);
  const text = extractFallbackPdfText(buffer);
  const requested = Array.isArray(args.pageNumbers)
    ? (args.pageNumbers as unknown[]).map((n) => clampInt(n, 0, 0, 100000)).filter((n) => n > 0)
    : [];
  const pageStart = clampInt(args.pageStart, 1, 1, 100000);
  const pageEnd = clampInt(args.pageEnd, 1, 1, 100000);
  const pages = requested.length > 0 ? requested : [Math.min(pageStart, pageEnd)];
  const extractedPages = pages.includes(1) ? [1] : [];
  return {
    numPages: 1,
    extractedPages,
    pages: extractedPages.map((num) => ({ num, text })),
  };
}

export const localFilePdfTools: McpTool[] = [
  {
    name: "read_pdf_text",
    description:
      "Extract text from a local PDF file for selected pages. Returns bounded text with page markers. Deterministic, no network.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to a local .pdf file (absolute or relative to current working directory).",
        },
        pageStart: {
          type: "number",
          description: "1-based start page (inclusive). Defaults to 1.",
          default: 1,
        },
        pageEnd: {
          type: "number",
          description: "1-based end page (inclusive). Defaults to 3.",
          default: 3,
        },
        pageNumbers: {
          type: "array",
          description: "Optional explicit list of 1-based pages to extract (overrides pageStart/pageEnd).",
          items: { type: "number" },
        },
        maxChars: {
          type: "number",
          description: "Maximum characters to return across all extracted pages (text is truncated).",
          default: 12000,
        },
      },
      required: ["path"],
    },
    handler: async (args) => {
      const filePath = resolveLocalPath(args?.path);
      if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

      const maxChars = clampInt(args?.maxChars, 12000, 1000, 200000);

      const pageNumbersRaw = Array.isArray(args?.pageNumbers) ? (args.pageNumbers as unknown[]) : null;
      const explicitPages = pageNumbersRaw
        ? pageNumbersRaw
            .map((n) => clampInt(n, 0, 0, 100000))
            .filter((n) => n > 0)
        : null;
      const pageStart = clampInt(args?.pageStart, 1, 1, 100000);
      const pageEnd = clampInt(args?.pageEnd, 3, 1, 100000);

      let numPages = 0;
      let text = "";
      let extractedPages: number[] = [];

      const mod = await getPdfParseModule().catch(() => null);
      const PDFParse = (mod as any)?.PDFParse;
      if (typeof PDFParse === "function") {
        const buffer = await readFile(filePath);
        const parser = new PDFParse({ data: buffer });

        try {
          const parseParams: any = {
            // Prefer consistent structure; we add our own page markers below.
            lineEnforce: true,
            pageJoiner: "",
            parseHyperlinks: false,
          };

          if (explicitPages && explicitPages.length > 0) {
            parseParams.partial = explicitPages;
          } else {
            const start = Math.min(pageStart, pageEnd);
            const end = Math.max(pageStart, pageEnd);
            parseParams.first = start;
            parseParams.last = end;
          }

          const result = await parser.getText(parseParams);
          numPages = Number((result as any)?.total ?? 0);
          const pages = Array.isArray((result as any)?.pages) ? (result as any).pages : [];
          extractedPages = pages
            .map((p: any) => Number(p?.num ?? 0))
            .filter((n: number) => Number.isFinite(n) && n > 0);
          text = pages
            .map((p: any) => `\n\n[PAGE ${Number(p?.num ?? 0)}]\n${String(p?.text ?? "").trim()}\n`)
            .join("")
            .trim();
        } finally {
          try {
            await parser.destroy();
          } catch {
            // ignore
          }
        }
      } else {
        const fallback = await parsePdfPagesFallback(filePath, { pageStart, pageEnd, pageNumbers: explicitPages });
        numPages = fallback.numPages;
        extractedPages = fallback.extractedPages;
        text = fallback.pages.map((p) => `\n\n[PAGE ${p.num}]\n${p.text.trim()}\n`).join("").trim();
      }

      let truncated = false;
      if (text.length > maxChars) {
        text = text.slice(0, maxChars);
        truncated = true;
      }

      const pagesIncluded = extractedPages;

      return {
        path: filePath,
        numPages,
        pagesIncluded,
        maxChars,
        truncated,
        text,
      };
    },
  },
  {
    name: "pdf_search_text",
    description:
      "Search text inside a local PDF over selected pages. Returns page numbers and bounded snippets around matches. Deterministic, no network.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to a local .pdf file (absolute or relative to current working directory).",
        },
        query: {
          type: "string",
          description: "Text to search for.",
        },
        caseSensitive: {
          type: "boolean",
          description: "If true, match case-sensitively (default false).",
          default: false,
        },
        pageStart: {
          type: "number",
          description: "1-based start page (inclusive). Defaults to 1.",
          default: 1,
        },
        pageEnd: {
          type: "number",
          description: "1-based end page (inclusive). Defaults to 25.",
          default: 25,
        },
        pageNumbers: {
          type: "array",
          description: "Optional explicit list of 1-based pages to search (overrides pageStart/pageEnd).",
          items: { type: "number" },
        },
        maxMatches: {
          type: "number",
          description: "Maximum matches to return across all pages.",
          default: 25,
        },
        snippetChars: {
          type: "number",
          description: "Snippet size (characters) around each match.",
          default: 180,
        },
      },
      required: ["path", "query"],
    },
    handler: async (args) => {
      const filePath = resolveLocalPath(args?.path);
      if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

      const queryRaw = String(args?.query ?? "");
      const query = queryRaw.trim();
      if (!query) throw new Error("query is required");

      const caseSensitive = args?.caseSensitive === true;
      const maxMatches = clampInt(args?.maxMatches, 25, 1, 200);
      const snippetChars = clampInt(args?.snippetChars, 180, 40, 1000);

      const pageNumbersRaw = Array.isArray(args?.pageNumbers) ? (args.pageNumbers as unknown[]) : null;
      const explicitPages = pageNumbersRaw
        ? pageNumbersRaw
            .map((n) => clampInt(n, 0, 0, 100000))
            .filter((n) => n > 0)
        : null;
      const pageStart = clampInt(args?.pageStart, 1, 1, 100000);
      const pageEnd = clampInt(args?.pageEnd, 25, 1, 100000);

      let numPages = 0;
      let extractedPages: number[] = [];
      let pages: Array<{ num: number; text: string }> = [];
      const mod = await getPdfParseModule().catch(() => null);
      const PDFParse = (mod as any)?.PDFParse;
      if (typeof PDFParse === "function") {
        const buffer = await readFile(filePath);
        const parser = new PDFParse({ data: buffer });

        try {
          const parseParams: any = {
            lineEnforce: true,
            pageJoiner: "",
            parseHyperlinks: false,
          };

          if (explicitPages && explicitPages.length > 0) {
            parseParams.partial = explicitPages.slice(0, 200);
          } else {
            const start = Math.min(pageStart, pageEnd);
            const end = Math.max(pageStart, pageEnd);
            parseParams.first = start;
            parseParams.last = end;
          }

          const result = await parser.getText(parseParams);
          numPages = Number((result as any)?.total ?? 0);
          const parsedPages = Array.isArray((result as any)?.pages) ? (result as any).pages : [];
          extractedPages = parsedPages
            .map((p: any) => Number(p?.num ?? 0))
            .filter((n: number) => Number.isFinite(n) && n > 0);
          pages = parsedPages.map((p: any) => ({
            num: Number(p?.num ?? 0),
            text: String(p?.text ?? ""),
          }));
        } finally {
          try {
            await parser.destroy();
          } catch {
            // ignore
          }
        }
      } else {
        const fallback = await parsePdfPagesFallback(filePath, { pageStart, pageEnd, pageNumbers: explicitPages });
        numPages = fallback.numPages;
        extractedPages = fallback.extractedPages;
        pages = fallback.pages;
      }

      const needle = caseSensitive ? query : query.toLowerCase();
      const matches: Array<{ page: number; index: number; snippet: string }> = [];

      for (const p of pages) {
        const haystackRaw = String(p.text ?? "");
        const haystack = caseSensitive ? haystackRaw : haystackRaw.toLowerCase();

        let from = 0;
        while (matches.length < maxMatches) {
          const idx = haystack.indexOf(needle, from);
          if (idx === -1) break;

          const start = Math.max(0, idx - Math.floor(snippetChars / 2));
          const end = Math.min(haystackRaw.length, start + snippetChars);
          const snippet = haystackRaw.slice(start, end).replace(/\s+/g, " ").trim();
          matches.push({ page: p.num, index: idx, snippet });

          from = idx + Math.max(1, needle.length);
        }
        if (matches.length >= maxMatches) break;
      }

      return {
        path: filePath,
        query,
        caseSensitive,
        numPages,
        pagesIncluded: extractedPages,
        maxMatches,
        matchCount: matches.length,
        matches,
      };
    },
  },
];
