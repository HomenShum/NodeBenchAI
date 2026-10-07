/**
 * Shared file-type helpers used by both DocumentCard and VisualGlimpse.
 * Extracted to break the static import cycle that prevented VisualGlimpse
 * from being a separate Vite chunk.
 */

import { inferFileType, type FileType } from "@/lib/fileTypes";
import type { DocumentCardData } from "../utils/documentHelpers";

/** Code file extensions for smart detection */
export const CODE_EXTENSIONS = new Set([
  'html', 'htm', 'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java',
  'cpp', 'c', 'h', 'hpp', 'cs', 'swift', 'kt', 'scala', 'php', 'vue', 'svelte',
  'css', 'scss', 'sass', 'less', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini',
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'sql', 'graphql', 'prisma'
]);

/** Smart type detection - ensures code files are detected even if labeled as "text" */
export function getSmartFileType(doc: DocumentCardData, baseType: FileType): FileType {
  const title = String(doc.title || doc.fileName || "").toLowerCase();
  const ext = title.split('.').pop() || "";

  // Force-detect code files even if system labeled them as "text"
  if (CODE_EXTENSIONS.has(ext)) {
    return 'code';
  }

  // Detect Quick Notes (nbdoc type or title pattern)
  if ((doc.documentType as string) === 'document' && !doc.fileSize) {
    if (title.includes('quick note') || title.startsWith('note ')) {
      return 'nbdoc';
    }
  }

  return baseType;
}

/** Infer FileType for theming */
export function inferDocFileType(doc: DocumentCardData): FileType {
  let baseType: FileType;

  if (doc.documentType === "file") {
    const ft = String(doc.fileType || "").toLowerCase();
    if (["video", "audio", "image", "csv", "pdf", "excel", "json", "text", "code", "web", "document"].includes(ft)) {
      baseType = ft as FileType;
    } else {
      baseType = inferFileType({ name: doc.fileName || doc.title });
    }
  } else {
    const lower = String(doc.title || "").toLowerCase();
    const looksLikeFile = /\.(csv|xlsx|xls|pdf|mp4|mov|webm|avi|mkv|jpg|jpeg|png|webp|gif|json|txt|md|markdown|js|ts|tsx|jsx|py|rb|go|rs|html|css|scss|sh)$/.test(lower);
    baseType = looksLikeFile ? inferFileType({ name: doc.title }) : inferFileType({ name: doc.title, isNodebenchDoc: true });
  }

  return getSmartFileType(doc, baseType);
}
