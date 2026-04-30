/**
 * ZIP, DOCX, and PPTX archive parsing tools.
 */

import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync as writeFileSyncFs } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import type { McpTool } from "../types.js";
import { resolveLocalPath, clampInt, getYauzl } from "./localFileHelpers.js";

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(x?[0-9a-fA-F]+);/g, (_m, raw) => {
      const isHex = String(raw).toLowerCase().startsWith("x");
      const n = Number.parseInt(isHex ? String(raw).slice(1) : String(raw), isHex ? 16 : 10);
      if (!Number.isFinite(n)) return _m;
      try {
        return String.fromCodePoint(n);
      } catch {
        return _m;
      }
    });
}

function safeJoinInsideDir(baseDir: string, unsafeRelative: string): string {
  const rel = String(unsafeRelative ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");

  const normalized = path.posix.normalize(rel);
  if (normalized === "." || normalized === "") {
    throw new Error("innerPath resolved to empty path");
  }
  if (normalized.startsWith("../") || normalized === "..") {
    throw new Error(`Refusing zip-slip path: ${unsafeRelative}`);
  }
  if (/[A-Za-z]:/.test(normalized)) {
    throw new Error(`Refusing drive-qualified path: ${unsafeRelative}`);
  }

  const out = path.resolve(baseDir, normalized.replace(/\//g, path.sep));
  const baseResolved = path.resolve(baseDir);
  if (!out.startsWith(baseResolved + path.sep) && out !== baseResolved) {
    throw new Error("Resolved path escapes outputDir");
  }
  return out;
}

type ZipEntryInfo = {
  fileName: string;
  uncompressedSize: number;
  compressedSize: number;
  isDirectory: boolean;
  crc32?: number;
  compressionMethod?: number;
};

type FallbackZipEntryInfo = ZipEntryInfo & {
  localHeaderOffset: number;
};

async function readFallbackZipEntries(zipPath: string, maxEntries: number): Promise<{ entries: FallbackZipEntryInfo[]; truncated: boolean }> {
  const buffer = await readFile(zipPath);
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Invalid ZIP: end of central directory not found");

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: FallbackZipEntryInfo[] = [];
  let offset = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid ZIP: central directory entry is corrupt");
    }
    if (entries.length >= maxEntries) return { entries, truncated: true };

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const crc32 = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);

    entries.push({
      fileName,
      uncompressedSize,
      compressedSize,
      isDirectory: fileName.endsWith("/"),
      crc32,
      compressionMethod,
      localHeaderOffset,
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return { entries, truncated: false };
}

async function readFallbackZipEntryBuffer(
  zipPath: string,
  innerPath: string,
  opts: { maxBytes: number; caseSensitive: boolean }
): Promise<{ buffer: Buffer; entry: ZipEntryInfo }> {
  const { entries } = await readFallbackZipEntries(zipPath, 10000);
  const target = String(innerPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  const want = opts.caseSensitive ? target : target.toLowerCase();
  const entry = entries.find((candidate) => {
    const name = opts.caseSensitive ? candidate.fileName : candidate.fileName.toLowerCase();
    return name === want;
  });
  if (!entry) throw new Error(`zip entry not found: ${target}`);
  if (entry.isDirectory) throw new Error(`zip entry is a directory: ${entry.fileName}`);
  if (entry.uncompressedSize > opts.maxBytes) {
    throw new Error(`zip entry too large (${entry.uncompressedSize} bytes) for maxBytes=${opts.maxBytes}: ${entry.fileName}`);
  }

  const archive = await readFile(zipPath);
  const offset = entry.localHeaderOffset;
  if (archive.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error("Invalid ZIP: local file header is corrupt");
  }
  const fileNameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = archive.subarray(dataStart, dataStart + entry.compressedSize);
  let data: Buffer;
  if (entry.compressionMethod === 0) {
    data = Buffer.from(compressed);
  } else if (entry.compressionMethod === 8) {
    data = inflateRawSync(compressed);
  } else {
    throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod}: ${entry.fileName}`);
  }
  if (data.length > opts.maxBytes) {
    throw new Error(`zip entry exceeded maxBytes=${opts.maxBytes}: ${entry.fileName}`);
  }
  const { localHeaderOffset: _localHeaderOffset, ...publicEntry } = entry;
  return { buffer: data, entry: publicEntry };
}

async function zipListEntries(zipPath: string, maxEntries: number): Promise<{ entries: ZipEntryInfo[]; truncated: boolean }> {
  const yauzl = await getYauzl().catch(() => null);
  if (!yauzl) {
    const fallback = await readFallbackZipEntries(zipPath, maxEntries);
    return {
      truncated: fallback.truncated,
      entries: fallback.entries.map(({ localHeaderOffset: _localHeaderOffset, ...entry }) => entry),
    };
  }
  return await new Promise((resolve, reject) => {
    (yauzl as any).open(zipPath, { lazyEntries: true, autoClose: true }, (err: any, zipfile: any) => {
      if (err || !zipfile) return reject(err ?? new Error("Failed to open zip"));

      const entries: ZipEntryInfo[] = [];
      let done = false;
      let truncated = false;

      const finish = () => {
        if (done) return;
        done = true;
        try {
          zipfile.close();
        } catch {
          // ignore
        }
        resolve({ entries, truncated });
      };

      zipfile.on("error", (e: any) => {
        if (done) return;
        done = true;
        reject(e);
      });
      zipfile.on("end", finish);

      zipfile.readEntry();
      zipfile.on("entry", (entry: any) => {
        if (done) return;
        if (entries.length >= maxEntries) {
          truncated = true;
          finish();
          return;
        }

        const name = String(entry.fileName ?? "");
        const isDirectory = name.endsWith("/");
        entries.push({
          fileName: name,
          uncompressedSize: Number(entry.uncompressedSize ?? 0),
          compressedSize: Number(entry.compressedSize ?? 0),
          isDirectory,
          crc32: typeof entry.crc32 === "number" ? entry.crc32 : undefined,
          compressionMethod: typeof entry.compressionMethod === "number" ? entry.compressionMethod : undefined,
        });
        zipfile.readEntry();
      });
    });
  });
}

async function zipReadEntryBuffer(
  zipPath: string,
  innerPath: string,
  opts: { maxBytes: number; caseSensitive: boolean }
): Promise<{ buffer: Buffer; entry: ZipEntryInfo }> {
  const yauzl = await getYauzl().catch(() => null);
  const target = String(innerPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!target) throw new Error("innerPath is required");
  if (!yauzl) return readFallbackZipEntryBuffer(zipPath, target, opts);

  return await new Promise((resolve, reject) => {
    (yauzl as any).open(zipPath, { lazyEntries: true, autoClose: true }, (err: any, zipfile: any) => {
      if (err || !zipfile) return reject(err ?? new Error("Failed to open zip"));

      let done = false;

      const finishError = (e: any) => {
        if (done) return;
        done = true;
        try {
          zipfile.close();
        } catch {
          // ignore
        }
        reject(e);
      };

      zipfile.on("error", finishError);

      const want = opts.caseSensitive ? target : target.toLowerCase();

      zipfile.readEntry();
      zipfile.on("entry", (entry: any) => {
        if (done) return;

        const nameRaw = String(entry.fileName ?? "");
        const name = opts.caseSensitive ? nameRaw : nameRaw.toLowerCase();

        if (name !== want) {
          zipfile.readEntry();
          return;
        }

        if (nameRaw.endsWith("/")) {
          finishError(new Error(`zip entry is a directory: ${nameRaw}`));
          return;
        }

        const uncompressedSize = Number(entry.uncompressedSize ?? 0);
        if (Number.isFinite(uncompressedSize) && uncompressedSize > opts.maxBytes) {
          finishError(
            new Error(
              `zip entry too large (${uncompressedSize} bytes) for maxBytes=${opts.maxBytes}: ${nameRaw}`
            )
          );
          return;
        }

        zipfile.openReadStream(entry, (streamErr: any, readStream: any) => {
          if (streamErr || !readStream) {
            finishError(streamErr ?? new Error("Failed to open zip entry stream"));
            return;
          }

          const chunks: Buffer[] = [];
          let total = 0;

          readStream.on("data", (chunk: Buffer) => {
            if (done) return;
            total += chunk.length;
            if (total > opts.maxBytes) {
              try {
                readStream.destroy();
              } catch {
                // ignore
              }
              finishError(new Error(`zip entry exceeded maxBytes=${opts.maxBytes}: ${nameRaw}`));
              return;
            }
            chunks.push(chunk);
          });
          readStream.on("error", finishError);
          readStream.on("end", () => {
            if (done) return;
            done = true;
            const buffer = Buffer.concat(chunks);
            const info: ZipEntryInfo = {
              fileName: nameRaw,
              uncompressedSize: Number(entry.uncompressedSize ?? buffer.length),
              compressedSize: Number(entry.compressedSize ?? buffer.length),
              isDirectory: false,
              crc32: typeof entry.crc32 === "number" ? entry.crc32 : undefined,
              compressionMethod: typeof entry.compressionMethod === "number" ? entry.compressionMethod : undefined,
            };
            try {
              zipfile.close();
            } catch {
              // ignore
            }
            resolve({ buffer, entry: info });
          });
        });
      });

      zipfile.on("end", () => {
        if (done) return;
        finishError(new Error(`zip entry not found: ${target}`));
      });
    });
  });
}


function docxXmlToText(xmlRaw: string): string {
  let s = String(xmlRaw ?? "");
  s = s.replace(/<w:tab[^>]*\/>/gi, "\t");
  s = s.replace(/<(w:br|w:cr)[^>]*\/>/gi, "\n");
  s = s.replace(/<\/w:p>/gi, "\n");
  s = s.replace(/<w:t\b[^>]*>/gi, "");
  s = s.replace(/<\/w:t>/gi, "");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeXmlEntities(s);
  s = s.replace(/\r/g, "");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function pptxSlideXmlToText(xmlRaw: string): string {
  let s = String(xmlRaw ?? "");
  s = s.replace(/<a:br[^>]*\/>/gi, "\n");
  s = s.replace(/<\/a:p>/gi, "\n");
  s = s.replace(/<a:t\b[^>]*>/gi, "");
  s = s.replace(/<\/a:t>/gi, "");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeXmlEntities(s);
  s = s.replace(/\r/g, "");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}


export const localFileArchiveTools: McpTool[] = [
  {
    name: "zip_list_files",
    description:
      "List entries in a local ZIP file. Deterministic, no network.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to a local .zip file (absolute or relative to current working directory).",
        },
        maxEntries: {
          type: "number",
          description: "Maximum entries to return.",
          default: 200,
        },
      },
      required: ["path"],
    },
    handler: async (args) => {
      const filePath = resolveLocalPath(args?.path);
      if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

      const maxEntries = clampInt(args?.maxEntries, 200, 1, 5000);
      const result = await zipListEntries(filePath, maxEntries);
      return {
        path: filePath,
        maxEntries,
        returnedEntries: result.entries.length,
        truncated: result.truncated,
        entries: result.entries,
      };
    },
  },
  {
    name: "zip_read_text_file",
    description:
      "Read a text file inside a local ZIP archive and return bounded text. Deterministic, no network.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to a local .zip file (absolute or relative to current working directory).",
        },
        innerPath: {
          type: "string",
          description: "Path of the entry inside the ZIP (use zip_list_files to discover names).",
        },
        caseSensitive: {
          type: "boolean",
          description: "If true, entry match is case-sensitive (default true).",
          default: true,
        },
        encoding: {
          type: "string",
          description: "Text encoding for the entry (default: utf8).",
          default: "utf8",
        },
        maxChars: {
          type: "number",
          description: "Maximum characters to return.",
          default: 12000,
        },
        maxBytes: {
          type: "number",
          description: "Maximum uncompressed bytes to read (safety cap).",
          default: 5000000,
        },
      },
      required: ["path", "innerPath"],
    },
    handler: async (args) => {
      const zipPath = resolveLocalPath(args?.path);
      if (!existsSync(zipPath)) throw new Error(`File not found: ${zipPath}`);

      const innerPath = String(args?.innerPath ?? "").trim();
      if (!innerPath) throw new Error("innerPath is required");

      const caseSensitive = args?.caseSensitive !== false;
      const encoding = String(args?.encoding ?? "utf8") as NodeJS.BufferEncoding;
      const maxChars = clampInt(args?.maxChars, 12000, 200, 200000);
      const maxBytes = clampInt(args?.maxBytes, 5000000, 1000, 50_000_000);

      const { buffer, entry } = await zipReadEntryBuffer(zipPath, innerPath, {
        maxBytes,
        caseSensitive,
      });

      const all = buffer.toString(encoding);
      const truncated = all.length > maxChars;
      const text = truncated ? all.slice(0, maxChars) : all;

      return {
        path: zipPath,
        innerPath: entry.fileName,
        encoding,
        sizeBytes: buffer.length,
        maxChars,
        truncated,
        text,
      };
    },
  },
  {
    name: "zip_extract_file",
    description:
      "Extract a single file from a local ZIP archive to a local output directory (zip-slip safe). Deterministic, no network.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to a local .zip file (absolute or relative to current working directory).",
        },
        innerPath: {
          type: "string",
          description: "Path of the entry inside the ZIP (use zip_list_files to discover names).",
        },
        caseSensitive: {
          type: "boolean",
          description: "If true, entry match is case-sensitive (default true).",
          default: true,
        },
        outputDir: {
          type: "string",
          description:
            "Directory to extract into (absolute or relative). Default: .tmp/nodebench_zip_extract",
          default: ".tmp/nodebench_zip_extract",
        },
        overwrite: {
          type: "boolean",
          description: "If true, overwrites an existing output file (default false).",
          default: false,
        },
        maxBytes: {
          type: "number",
          description: "Maximum uncompressed bytes to extract (safety cap).",
          default: 25000000,
        },
      },
      required: ["path", "innerPath"],
    },
    handler: async (args) => {
      const zipPath = resolveLocalPath(args?.path);
      if (!existsSync(zipPath)) throw new Error(`File not found: ${zipPath}`);

      const innerPath = String(args?.innerPath ?? "").trim();
      if (!innerPath) throw new Error("innerPath is required");

      const outputDir = resolveLocalPath(args?.outputDir ?? ".tmp/nodebench_zip_extract");
      const overwrite = args?.overwrite === true;
      const caseSensitive = args?.caseSensitive !== false;
      const maxBytes = clampInt(args?.maxBytes, 25000000, 1000, 200_000_000);

      const { buffer, entry } = await zipReadEntryBuffer(zipPath, innerPath, {
        maxBytes,
        caseSensitive,
      });

      const extractedPath = safeJoinInsideDir(outputDir, entry.fileName);
      await (await import("node:fs/promises")).mkdir(path.dirname(extractedPath), { recursive: true });

      const alreadyExists = existsSync(extractedPath);
      if (alreadyExists && !overwrite) {
        return {
          path: zipPath,
          innerPath: entry.fileName,
          outputDir,
          extractedPath,
          sizeBytes: buffer.length,
          existed: true,
          overwritten: false,
        };
      }

      await (await import("node:fs/promises")).writeFile(extractedPath, buffer);

      return {
        path: zipPath,
        innerPath: entry.fileName,
        outputDir,
        extractedPath,
        sizeBytes: buffer.length,
        existed: alreadyExists,
        overwritten: alreadyExists ? overwrite : false,
      };
    },
  },
  {
    name: "read_docx_text",
    description:
      "Extract text from a local DOCX (Office OpenXML) file. Deterministic, no network.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to a local .docx file (absolute or relative to current working directory).",
        },
        maxChars: {
          type: "number",
          description: "Maximum characters to return (text is truncated).",
          default: 12000,
        },
        maxBytes: {
          type: "number",
          description: "Maximum uncompressed bytes to read from word/document.xml (safety cap).",
          default: 20000000,
        },
      },
      required: ["path"],
    },
    handler: async (args) => {
      const filePath = resolveLocalPath(args?.path);
      if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

      const maxChars = clampInt(args?.maxChars, 12000, 1000, 200000);
      const maxBytes = clampInt(args?.maxBytes, 20000000, 1000, 200_000_000);

      const { buffer } = await zipReadEntryBuffer(filePath, "word/document.xml", {
        maxBytes,
        caseSensitive: true,
      });

      const xml = buffer.toString("utf8");
      let text = docxXmlToText(xml);

      const truncated = text.length > maxChars;
      if (truncated) text = text.slice(0, maxChars);

      return {
        path: filePath,
        source: "word/document.xml",
        maxChars,
        truncated,
        text,
      };
    },
  },
  {
    name: "read_pptx_text",
    description:
      "Extract text from a local PPTX (Office OpenXML) file. Deterministic, no network.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to a local .pptx file (absolute or relative to current working directory).",
        },
        maxChars: {
          type: "number",
          description: "Maximum characters to return (text is truncated).",
          default: 12000,
        },
        maxSlides: {
          type: "number",
          description: "Maximum slides to process (default: 60).",
          default: 60,
        },
        maxBytesPerSlide: {
          type: "number",
          description: "Maximum uncompressed bytes to read per slide XML (safety cap).",
          default: 10000000,
        },
      },
      required: ["path"],
    },
    handler: async (args) => {
      const filePath = resolveLocalPath(args?.path);
      if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

      const maxChars = clampInt(args?.maxChars, 12000, 1000, 200000);
      const maxSlides = clampInt(args?.maxSlides, 60, 1, 500);
      const maxBytesPerSlide = clampInt(args?.maxBytesPerSlide, 10000000, 1000, 200_000_000);

      const listing = await zipListEntries(filePath, 5000);
      const slides = listing.entries
        .map((e) => e.fileName)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
        .map((n) => {
          const m = n.match(/slide(\d+)\.xml$/i);
          return { name: n, index: m ? Number.parseInt(m[1], 10) : 0 };
        })
        .filter((s) => Number.isFinite(s.index) && s.index > 0)
        .sort((a, b) => a.index - b.index)
        .slice(0, maxSlides);

      let text = "";
      for (const slide of slides) {
        const { buffer } = await zipReadEntryBuffer(filePath, slide.name, {
          maxBytes: maxBytesPerSlide,
          caseSensitive: true,
        });
        const xml = buffer.toString("utf8");
        const slideText = pptxSlideXmlToText(xml);
        text += `\n\n[SLIDE ${slide.index}]\n${slideText}\n`;
        if (text.length > maxChars) break;
      }

      text = text.trim();
      const truncated = text.length > maxChars;
      if (truncated) text = text.slice(0, maxChars);

      return {
        path: filePath,
        slideCount: slides.length,
        slidesIncluded: slides.map((s) => s.index),
        maxChars,
        truncated,
        text,
      };
    },
  },
];
